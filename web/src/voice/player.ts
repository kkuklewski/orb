// Her voice out: an ordered queue of Kokoro clips (or sentences for the browser's own voice),
// generations so a new turn / interrupt drops older audio, and background notices queued after
// her answer. Plain module; it reports `playing` to the voice store.
import type { AudioEvent, BgNoticeEvent } from "../protocol.gen";
import { useVoice } from "../stores/voice";
import { useFeatures } from "../stores/features";
import { useSession } from "../stores/session";
import { b64bytes } from "./wav";
import { clockPlaying } from "./clock";

type Clip = AudioBuffer | { speak: string };
interface Source { stop(): void; speech?: boolean }

export const BROWSER_TTS = typeof window !== "undefined" && "speechSynthesis" in window;

class PlayerImpl {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  wave = new Float32Array(1024);
  queue: Clip[] = [];
  notices: Clip[] = [];
  src: Source | null = null;
  gen = 0;
  floor = 0;
  lastAudio = 0;
  private chain: Promise<void> = Promise.resolve();
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  get playing() { return !!this.src || this.queue.length > 0; }

  private report() { const p = this.playing; if (useVoice.getState().playing !== p) useVoice.setState({ playing: p }); }

  /** Browsers only start audio after a gesture: call from a click / key / pointer handler. Null without Web Audio. */
  unlock(): AudioContext | null {
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      this.ctx = new C();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** One short soft tone when an utterance is accepted (not while she is speaking). */
  ack() {
    if (useVoice.getState().muted || !this.ctx || this.playing) return;
    const rate = this.ctx.sampleRate, n = Math.floor(rate * 0.09), buf = this.ctx.createBuffer(1, n, rate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { const t = i / rate; d[i] = 0.06 * Math.min(1, t / 0.008) * Math.exp(-t * 40) * Math.sin(2 * Math.PI * 660 * t); }
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.connect(this.ctx.destination); src.start();
  }

  private chime(): AudioBuffer { // two soft rising tones
    const ctx = this.ctx!, rate = ctx.sampleRate, n = Math.floor(rate * 0.32), buf = ctx.createBuffer(1, n, rate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / rate, f = t < 0.14 ? 784 : 1175, local = t < 0.14 ? t : t - 0.16;
      const env = local < 0 ? 0 : Math.min(1, local / 0.01) * Math.exp(-local * 18);
      d[i] = 0.18 * env * Math.sin(2 * Math.PI * f * t);
    }
    return buf;
  }

  /** Background folder news: a chime and a line, queued after her current answer, never cutting into it. */
  notice(ev: BgNoticeEvent) {
    if (useVoice.getState().muted || !this.unlock()) return;
    const bytes = ev.data ? b64bytes(ev.data) : null;
    this.chain = this.chain.then(async () => {
      try {
        this.notices.push(this.chime());
        if (bytes) this.notices.push(await this.ctx!.decodeAudioData(bytes.buffer as ArrayBuffer));
        else if (useFeatures.getState().features?.tts === "browser" && BROWSER_TTS) this.notices.push({ speak: ev.text });
      } catch (e) { console.warn("notice", e); }
      if (!this.src) this.next();
    });
  }

  enqueue(ev: AudioEvent) {
    if (useVoice.getState().muted || ev.gen < this.floor || !this.unlock()) return;
    this.lastAudio = Date.now();
    if (ev.speak) { // browser voice: the server sent only the sentence
      if (!BROWSER_TTS) return;
      this.chain = this.chain.then(() => { if (ev.gen >= this.floor) { this.queue.push({ speak: ev.text }); if (!this.src) this.next(); } });
      return;
    }
    if (!ev.data) return;
    const bytes = b64bytes(ev.data);
    this.chain = this.chain.then(async () => {
      try {
        const buf = await this.ctx!.decodeAudioData(bytes.buffer as ArrayBuffer);
        if (ev.gen < this.floor) return;
        this.queue.push(buf);
        if (!this.src) this.next();
      } catch (e) { console.warn("decode", e); }
    });
  }

  private next() {
    let clip = this.queue.shift();
    const answer = !!clip;
    if (!clip && this.notices.length) {
      // Between two sentences the queue can be empty for a moment: wait until the answer is really over.
      const quiet = Date.now() - this.lastAudio;
      if ((useSession.getState().busy && quiet < 2500) || quiet < 700) {
        this.src = null; this.report();
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => { if (!this.src) this.next(); }, 300);
        return;
      }
      clip = this.notices.shift();
    }
    if (!clip) { this.src = null; this.report(); return; }
    if ("speak" in clip) { // the browser's own voice; stop() cancels it like a clip
      const u = new SpeechSynthesisUtterance(clip.speak);
      const src: Source = { stop: () => speechSynthesis.cancel(), speech: true };
      u.onend = u.onerror = () => { if (this.src === src) this.next(); };
      this.src = src; speechSynthesis.speak(u); this.report();
      if (answer) clockPlaying();
      return;
    }
    const node = this.ctx!.createBufferSource();
    node.buffer = clip;
    node.connect(this.analyser!);
    const src: Source = { stop: () => node.stop() };
    node.onended = () => { if (this.src === src) this.next(); };
    this.src = src; node.start(); this.report();
    if (answer) clockPlaying();
  }

  private halt() {
    this.queue = [];
    if (this.src) { const s = this.src; this.src = null; try { s.stop(); } catch { /* already stopped */ } }
    this.report();
  }

  /** Local and immediate (barge-in, Stop, switching sessions): drop audio until the server's next speech_reset. */
  stop() { this.floor = Infinity; this.halt(); }

  /** The server started generation `gen`: older audio is dropped, newer plays. */
  reset(gen: number) { this.gen = gen; this.floor = gen; this.halt(); }

  level(): number {
    if (!this.src) return 0;
    if (this.src.speech) return 0.04 + 0.03 * Math.abs(Math.sin(performance.now() / 120)); // no samples: a gentle pulse
    this.analyser!.getFloatTimeDomainData(this.wave);
    let s = 0; for (const x of this.wave) s += x * x;
    return Math.sqrt(s / this.wave.length);
  }
}

export const Player = new PlayerImpl();
