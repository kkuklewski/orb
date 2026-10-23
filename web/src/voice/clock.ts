// Turn timing seen from the page: from you stopping talking (or pressing Send) to her first audio
// playing. The server measures its own hops; this adds the last one (playback).
import { send } from "../ws";

export const VAD_MS = 1100; // the VAD's redemptionMs: silence it waits for before ending an utterance

let sentAt: number | null = null;
let speechEndAt: number | null = null;
let clock: { id: string; voice: boolean; start: number; played: boolean } | null = null;

export function markSent() { sentAt = performance.now(); }
export function markSpeechEnd() { speechEndAt = performance.now(); }

/** A request arrived as a "user" event: its clock starts at the matching mark. */
export function startClock(id: string | null | undefined, source: string) {
  if (!id) return;
  const voice = source === "voice";
  clock = { id, voice, start: (voice ? speechEndAt : sentAt) ?? performance.now(), played: false };
}

/** Her first audio of the answer started playing. */
export function clockPlaying() {
  if (!clock || clock.played) return;
  clock.played = true;
  send({ type: "playback", turn: clock.id, vad_ms: clock.voice ? VAD_MS : 0, play_ms: Math.round(performance.now() - clock.start) });
}
