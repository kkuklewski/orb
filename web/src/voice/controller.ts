// Ties voice to the server: speech start / barge-in / utterance out, audio and state events in,
// and the keys (Space mic, M mute, Esc stop). The rules match the old page's, which the voice
// spike (spikes/voice/run.mjs) checks end to end.
import type { ServerEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { bargeAllowed, flash, persistMuted, useVoice } from "../stores/voice";
import { useFeatures } from "../stores/features";
import { useSession, openPicker } from "../stores/session";
import { addNotice } from "../stores/chat";
import { useSetup } from "../stores/setup";
import { Player } from "./player";
import { BROWSER_STT, haltRecognizer, micLevel, runRecognizer, startMic, stopMic } from "./mic";
import { markSpeechEnd, startClock } from "./clock";
import { wavBase64 } from "./wav";

let utteranceOk = true; // false while the VAD hears what is probably her own voice on speakers

const browserStt = () => useFeatures.getState().features?.stt === "browser" && BROWSER_STT;

// -- VAD callbacks -------------------------------------------------------------------------------

export function onSpeechStart() { // first speech frame: the server holds a pending request
  const v = useVoice.getState();
  if (Player.playing && !bargeAllowed(v)) { utteranceOk = false; return; } // her own voice on speakers: ignore
  utteranceOk = true;
  useVoice.setState({ hearing: true });
  // Speech that starts while she plays on speakers may be her own voice: it may not answer a card.
  send({ type: "speech_start", echo_risk: Player.playing && !v.headphones });
}

export function onSpeechRealStart() { // 300 ms of real speech: talking over her stops her
  if (utteranceOk && Player.playing && bargeAllowed(useVoice.getState())) { Player.stop(); send({ type: "barge_in" }); }
}

export function onSpeechEnd(samples: Float32Array) {
  useVoice.setState({ hearing: false });
  markSpeechEnd();
  if (!utteranceOk) { utteranceOk = true; return; }
  if (browserStt()) return; // the recognizer sends the words
  send({ type: "utterance", wav: wavBase64(samples, 16000) });
  Player.ack(); // heard you: a soft tick right away, so the wait feels shorter
  useVoice.setState({ serverState: "transcribing" });
}

export function onMisfire() {
  if (useVoice.getState().hearing) send({ type: "speech_cancelled" });
  utteranceOk = true;
  useVoice.setState({ hearing: false });
}

function onRecognized(text: string) {
  if (!utteranceOk) return; // her own voice on speakers
  // On speakers the recognizer may have heard her: such words never answer an approval card.
  send({ type: "voice_text", text, echo_risk: !useVoice.getState().headphones || Player.playing });
  Player.ack();
  useVoice.setState({ serverState: "transcribing" });
}

const hooks = { onSpeechStart, onSpeechRealStart, onSpeechEnd, onMisfire };

// -- controls ------------------------------------------------------------------------------------

export async function toggleMic() {
  const v = useVoice.getState();
  if (!useSession.getState().folder && !v.micOn) { openPicker("new"); return; } // nothing to talk to yet
  try {
    if (v.micOn) { haltRecognizer(); await stopMic(); }
    else {
      await startMic(hooks);
      if (browserStt()) runRecognizer(onRecognized, () => addNotice("The browser blocked speech recognition. Allow the microphone, or pick a local engine in Settings."));
    }
  } catch (e) {
    useVoice.setState({ starting: false });
    addNotice(`Microphone: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Esc / ■: she stops now, the turn is interrupted. */
export function stopAll() { Player.stop(); send({ type: "interrupt" }); }

export function toggleMute() {
  const muted = !useVoice.getState().muted;
  useVoice.setState({ muted });
  persistMuted(muted);
  if (muted) Player.stop();
  send({ type: "mute", value: muted });
}

/** The pill: stops her while she speaks, otherwise turns the mic on or off. */
export function pillPress() {
  Player.unlock();
  if (Player.playing) { stopAll(); return; }
  void toggleMic();
}

export function voiceLevel(): number { return Player.src ? Player.level() : micLevel(); }

// -- events --------------------------------------------------------------------------------------

const VOICE_EVENTS = ["hello", "opened", "audio", "speech_reset", "bg_notice", "heard_nothing", "partial", "state", "user", "error"] as const;
const ANY_SESSION = new Set(["hello", "opened", "bg_notice"]);

export function handle(ev: ServerEvent) {
  const cur = useSession.getState().session;
  if (!ANY_SESSION.has(ev.type) && "session" in ev && ev.session && cur && ev.session !== cur) return;
  switch (ev.type) {
    case "hello": send({ type: "mute", value: useVoice.getState().muted }); break;
    case "opened": Player.reset(ev.speech_gen); useVoice.setState({ partial: null, serverState: ev.busy ? "working" : "idle" }); break;
    case "audio": if (!ev.replay) Player.enqueue(ev); break;
    case "speech_reset": Player.reset(ev.gen); break;
    case "bg_notice": Player.notice(ev); flash(ev.text.replace(/\.$/, "")); break;
    case "heard_nothing": flash("Didn't catch that"); break;
    case "partial": useVoice.setState({ partial: ev.text }); break;
    case "state": useVoice.setState({ serverState: ev.value }); break;
    case "user": useVoice.setState({ partial: null }); if (!ev.replay) startClock(ev.id, ev.source); break;
    case "error": if (useVoice.getState().serverState === "transcribing") useVoice.setState({ serverState: "idle" }); break;
  }
}

function onKey(e: KeyboardEvent) {
  if (useSetup.getState().open) return; // the setup assistant owns the keyboard while it's up
  if (useSession.getState().picker || (e.target as HTMLElement)?.closest?.("[role=dialog]")) return;
  const typing = (e.target as HTMLElement)?.closest?.("textarea, input, select");
  if (e.key === "Escape") { if (!e.defaultPrevented) { e.preventDefault(); stopAll(); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space" && !e.repeat) { e.preventDefault(); Player.unlock(); void toggleMic(); }
  else if (e.key === "m" || e.key === "M") toggleMute();
}

export function wireVoice(): () => void {
  const offs = VOICE_EVENTS.map((t) => on(t, handle as never));
  document.addEventListener("keydown", onKey);
  const unlock = () => Player.unlock(); // iOS / Safari: audio may only start after a gesture
  document.addEventListener("pointerdown", unlock, { once: true });
  const dev = () => { if (useVoice.getState().micOn) void import("./mic").then((m) => m.detectHeadphones()); };
  navigator.mediaDevices?.addEventListener?.("devicechange", dev);
  // Engine switched in Settings while listening: start or stop the recognizer to match.
  const offFeatures = useFeatures.subscribe((s, prev) => {
    if (s.features?.stt === prev.features?.stt || !useVoice.getState().micOn) return;
    if (browserStt()) runRecognizer(onRecognized, () => undefined); else haltRecognizer();
  });
  return () => {
    offs.forEach((off) => off());
    offFeatures();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", unlock);
    navigator.mediaDevices?.removeEventListener?.("devicechange", dev);
  };
}
