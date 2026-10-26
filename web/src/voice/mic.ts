// Voice in. The VAD (Silero v5 in an AudioWorklet, its files self-hosted and hash-checked by
// vendor.py) finds where speech starts and ends; the utterance goes to the server as a 16 kHz WAV.
// With browser speech recognition (Settings → stt "browser") the recognizer supplies the words and
// the VAD still drives holds and barge-in. vad-web and ONNX Runtime load on first use.
import type { MicVAD } from "@ricky0123/vad-web";
import { HEADPHONES, useVoice } from "../stores/voice";
import { Player } from "./player";
import { VAD_MS } from "./clock";

export interface MicHooks {
  onSpeechStart(): void;
  onSpeechRealStart(): void;
  onSpeechEnd(samples: Float32Array): void;
  onMisfire(): void;
}

let vad: MicVAD | null = null;
let analyser: AnalyserNode | null = null;
const wave = new Float32Array(1024);

export async function detectHeadphones() {
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
    const def = outs.find((d) => d.deviceId === "default") ?? outs[0];
    useVoice.setState({ headphones: !!def && HEADPHONES.test(def.label) });
  } catch { useVoice.setState({ headphones: false }); }
}

export async function startMic(hooks: MicHooks) {
  const ctx = Player.unlock();
  if (!ctx) throw new Error("this browser has no Web Audio");
  if (!vad) {
    useVoice.setState({ starting: true });
    try {
      const { MicVAD } = await import("@ricky0123/vad-web");
      const vendor = location.origin + "/static/vendor/"; // absolute, or ORT resolves it against a CDN
      const getStream = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        void detectHeadphones();
        return stream;
      };
      vad = await MicVAD.new({
        model: "v5", audioContext: ctx, baseAssetPath: vendor, onnxWASMBasePath: vendor,
        getStream, resumeStream: () => getStream(),
        positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, preSpeechPadMs: 500, redemptionMs: VAD_MS, minSpeechMs: 300,
        onSpeechStart: hooks.onSpeechStart, onSpeechRealStart: hooks.onSpeechRealStart,
        onSpeechEnd: hooks.onSpeechEnd, onVADMisfire: hooks.onMisfire,
      });
    } finally {
      useVoice.setState({ starting: false });
    }
  }
  await vad.start();
  useVoice.setState({ micOn: true });
}

export async function stopMic() {
  if (vad) await vad.pause();
  useVoice.setState({ micOn: false, hearing: false });
}

export function micLevel(): number {
  if (!useVoice.getState().micOn || !analyser) return 0;
  analyser.getFloatTimeDomainData(wave);
  let s = 0; for (const x of wave) s += x * x;
  return Math.sqrt(s / wave.length);
}

// -- browser speech recognition -------------------------------------------------------------------

interface Recognition { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
type RecognitionCtor = new () => Recognition;

const RecCtor = (): RecognitionCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};
export const BROWSER_STT = typeof window !== "undefined" && !!RecCtor();

let rec: Recognition | null = null;
let recOn = false;

/** Final phrases go to `onText`; `onBlocked` when the browser refuses (no mic permission, no service). */
export function runRecognizer(onText: (text: string) => void, onBlocked: () => void) {
  const C = RecCtor();
  if (!C) return;
  if (!rec) {
    rec = new C();
    rec.continuous = true; rec.interimResults = false; rec.lang = navigator.language || "en-US";
    rec.onend = () => { if (recOn) try { rec!.start(); } catch { /* already running */ } }; // Chrome stops after a silence
  }
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r.isFinal ? r[0].transcript.trim() : "";
      if (text) onText(text);
    }
  };
  rec.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { recOn = false; onBlocked(); } };
  recOn = true;
  try { rec.start(); } catch { /* already running */ }
}

export function haltRecognizer() { recOn = false; try { rec?.stop(); } catch { /* not running */ } }
