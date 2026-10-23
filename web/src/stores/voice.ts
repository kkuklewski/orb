// Voice state the page shows: mic, her playback, what the server is doing, barge-in, mute.
// The audio itself lives in src/voice (plain modules); they report here.
import { create } from "zustand";

export type BargeMode = "auto" | "on" | "off";
export type DockState = "waiting" | "speaking" | "hearing" | "transcribing" | "thinking" | "working" | "listening" | "idle" | "offline";

const local = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

export interface VoiceState {
  micOn: boolean;
  starting: boolean; // asking for the mic / loading the VAD
  hearing: boolean; // speech in progress
  playing: boolean; // her voice (or a notice) is playing
  serverState: string; // last "state" value: idle, thinking, working, transcribing, waiting, …
  partial: string | null;
  headphones: boolean;
  barge: BargeMode;
  muted: boolean;
  flash: string | null;
}

const savedBarge = (): BargeMode => { const v = local.get("vd-barge", "auto"); return v === "on" || v === "off" ? v : "auto"; };

export const initialVoice = (): VoiceState => ({
  micOn: false, starting: false, hearing: false, playing: false, serverState: "idle", partial: null,
  headphones: false, barge: savedBarge(), muted: local.get("vd-muted", "0") === "1", flash: null,
});

export const useVoice = create<VoiceState>(initialVoice);

export function setBarge(mode: BargeMode) { useVoice.setState({ barge: mode }); local.set("vd-barge", mode); }
export const nextBarge = (m: BargeMode): BargeMode => ({ auto: "on", on: "off", off: "auto" } as const)[m];
export function persistMuted(muted: boolean) { local.set("vd-muted", muted ? "1" : "0"); }

let flashTimer: ReturnType<typeof setTimeout> | undefined;
export function flash(text: string) {
  clearTimeout(flashTimer);
  useVoice.setState({ flash: text });
  flashTimer = setTimeout(() => useVoice.setState({ flash: null }), 1800);
}

/** Talking over her stops her: always, never, or (auto) only with headphones, where she can't hear herself. */
export function bargeAllowed(v: Pick<VoiceState, "barge" | "headphones">): boolean {
  return v.barge === "on" || (v.barge === "auto" && v.headphones);
}

/** One state for the dock line and the pill, most important first. */
export function dockState(v: VoiceState, busy: boolean, online = true): DockState {
  if (!online) return "offline";
  if (v.serverState === "waiting") return "waiting";
  if (v.playing) return "speaking";
  if (v.hearing) return "hearing";
  if (v.serverState === "transcribing") return "transcribing";
  if (busy) return v.serverState === "thinking" ? "thinking" : "working";
  if (v.micOn) return "listening";
  return "idle";
}

export function dockLabel(st: DockState, v: VoiceState, hasFolder: boolean): string {
  if (v.flash) return v.flash;
  if (v.starting) return "Starting mic…";
  const label = {
    waiting: "Waiting for your approval", speaking: "Speaking", hearing: "Hearing you", transcribing: "Transcribing",
    thinking: "Thinking", working: "Working", listening: "Listening", idle: hasFolder ? "Idle · tap Talk or type" : "Pick a folder", offline: "Reconnecting…",
  }[st];
  const partial = v.partial && (st === "hearing" || st === "transcribing" || st === "listening") ? ` · “${v.partial.slice(-80)}”` : "";
  return label + partial;
}

export function pillLabel(st: DockState, hasFolder: boolean): string {
  return {
    idle: hasFolder ? "Talk" : "Pick a repo", listening: "Listening", hearing: "Listening", transcribing: "Transcribing",
    thinking: "Thinking", working: "Working", speaking: "Speaking · Stop", waiting: "Needs your OK", offline: "Offline",
  }[st];
}

export function bargeText(v: Pick<VoiceState, "barge" | "headphones">): string {
  return `barge-in: ${v.barge === "auto" ? (v.headphones ? "auto · headphones" : "auto · off on speakers") : v.barge}`;
}

export const HEADPHONES = /airpods|headphone|headset|buds|beats|earpods|earphone/i;
