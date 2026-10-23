// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bargeAllowed, bargeText, dockLabel, dockState, initialVoice, nextBarge, pillLabel, useVoice } from "../stores/voice";
import { initialSession, useSession } from "../stores/session";
import { useFeatures } from "../stores/features";
import { wavBase64 } from "./wav";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

// A Web Audio stand-in: clips "play" until the test ends them.
class FakeSource { buffer: unknown = null; onended: (() => void) | null = null; started = false; stopped = false;
  connect() {} start() { this.started = true; } stop() { this.stopped = true; } }
const sources: FakeSource[] = [];
class FakeCtx {
  state = "running"; sampleRate = 48000; destination = {};
  createAnalyser() { return { fftSize: 0, connect() {}, getFloatTimeDomainData() {} }; }
  createBufferSource() { const s = new FakeSource(); sources.push(s); return s; }
  createBuffer(_c: number, n: number) { return { getChannelData: () => new Float32Array(n) }; }
  decodeAudioData(b: ArrayBuffer) { return Promise.resolve({ bytes: b.byteLength }); }
  resume() { return Promise.resolve(); }
}
vi.stubGlobal("AudioContext", FakeCtx);

const { Player } = await import("./player");
const C = await import("./controller");

const flush = () => new Promise((r) => setTimeout(r, 0));
const clip = (gen: number, seq = 0) => ({ type: "audio" as const, gen, seq, text: "x", data: btoa("RIFFxxxx") });

beforeEach(() => {
  sent.length = 0; sources.length = 0;
  localStorage.clear();
  useVoice.setState(initialVoice());
  useSession.setState({ ...initialSession(), folder: "/a/web", session: "s1" });
  useFeatures.setState({ features: { brain: false, onboarded: true, roots: [], routines: false, stt: "parakeet", tts: "kokoro", vault: "" }, folders: [], services: {}, build: null });
  Player.reset(0);
});

describe("dock state", () => {
  const v = (over = {}) => ({ ...initialVoice(), ...over });
  it("most important first: approval, her voice, your voice, transcribing, work, mic", () => {
    expect(dockState(v({ serverState: "waiting", playing: true }), true)).toBe("waiting");
    expect(dockState(v({ playing: true, hearing: true }), true)).toBe("speaking");
    expect(dockState(v({ hearing: true, serverState: "transcribing" }), false)).toBe("hearing");
    expect(dockState(v({ serverState: "thinking" }), true)).toBe("thinking");
    expect(dockState(v({ serverState: "idle" }), true)).toBe("working");
    expect(dockState(v({ micOn: true }), false)).toBe("listening");
    expect(dockState(v(), false)).toBe("idle");
    expect(dockState(v({ playing: true }), false, false)).toBe("offline");
  });
  it("labels, the live transcript and the pill's word", () => {
    expect(dockLabel("listening", v({ partial: "open the" }), true)).toBe("Listening · “open the”");
    expect(dockLabel("idle", v(), false)).toBe("Pick a folder");
    expect(dockLabel("idle", v({ flash: "Didn't catch that" }), true)).toBe("Didn't catch that");
    expect(pillLabel("speaking", true)).toBe("Speaking · Stop");
    expect(pillLabel("idle", false)).toBe("Pick a repo");
  });
  it("barge-in: auto only with headphones; the toggle cycles", () => {
    expect(bargeAllowed({ barge: "auto", headphones: false })).toBe(false);
    expect(bargeAllowed({ barge: "auto", headphones: true })).toBe(true);
    expect(bargeAllowed({ barge: "on", headphones: false })).toBe(true);
    expect(bargeAllowed({ barge: "off", headphones: true })).toBe(false);
    expect([nextBarge("auto"), nextBarge("on"), nextBarge("off")]).toEqual(["on", "off", "auto"]);
    expect(bargeText({ barge: "auto", headphones: false })).toBe("barge-in: auto · off on speakers");
  });
});

describe("wav", () => {
  it("is a 16-bit mono RIFF with the samples clipped", () => {
    const bytes = Uint8Array.from(atob(wavBase64(new Float32Array([0, 1, -1, 2]), 16000)), (c) => c.charCodeAt(0));
    const v = new DataView(bytes.buffer);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32768, 32767]);
  });
});

describe("player", () => {
  it("plays clips in order and drops older generations after a reset", async () => {
    Player.enqueue(clip(0)); Player.enqueue(clip(0, 1));
    await flush();
    expect(sources).toHaveLength(1);
    expect(useVoice.getState().playing).toBe(true);
    sources[0].onended!();
    expect(sources).toHaveLength(2);
    C.handle({ type: "speech_reset", gen: 1 });
    expect(sources[1].stopped).toBe(true);
    Player.enqueue(clip(0)); await flush();
    expect(sources).toHaveLength(2); // gen 0 is gone
    Player.enqueue(clip(1)); await flush();
    expect(sources).toHaveLength(3);
  });

  it("a local stop drops everything until the server's next reset; mute drops too", async () => {
    Player.enqueue(clip(0)); await flush();
    Player.stop();
    expect(useVoice.getState().playing).toBe(false);
    Player.enqueue(clip(5)); await flush();
    expect(sources).toHaveLength(1);
    C.handle({ type: "speech_reset", gen: 5 });
    useVoice.setState({ muted: true });
    Player.enqueue(clip(5)); await flush();
    expect(sources).toHaveLength(1);
  });

  it("the first clip of an answer reports playback for the turn", async () => {
    C.handle({ type: "user", id: "u1", text: "hi", source: "typed" });
    Player.enqueue(clip(0)); await flush();
    expect(sent).toContainEqual(expect.objectContaining({ type: "playback", turn: "u1", vad_ms: 0 }));
  });
});

describe("speech rules", () => {
  it("speech start holds a pending request; on speakers while she talks it's ignored", async () => {
    C.onSpeechStart();
    expect(sent).toEqual([{ type: "speech_start", echo_risk: false }]);
    expect(useVoice.getState().hearing).toBe(true);
    C.onSpeechEnd(new Float32Array(160));
    expect(sent.at(-1)).toMatchObject({ type: "utterance" });
    expect(useVoice.getState()).toMatchObject({ hearing: false, serverState: "transcribing" });

    sent.length = 0;
    Player.enqueue(clip(0)); await flush(); // she is speaking, on speakers, barge auto
    C.onSpeechStart(); C.onSpeechRealStart(); C.onSpeechEnd(new Float32Array(160));
    expect(sent).toEqual([]); // her own voice: nothing sent, she keeps talking
    expect(useVoice.getState().playing).toBe(true);
  });

  it("with headphones, talking over her stops her (barge-in)", async () => {
    useVoice.setState({ headphones: true });
    Player.enqueue(clip(0)); await flush();
    C.onSpeechStart();
    expect(sent).toEqual([{ type: "speech_start", echo_risk: false }]);
    C.onSpeechRealStart();
    expect(sent.at(-1)).toEqual({ type: "barge_in" });
    expect(sources[0].stopped).toBe(true);
  });

  it("a misfire cancels the hold; without a recognizer, browser speech falls back to sending audio", () => {
    C.onSpeechStart(); C.onMisfire();
    expect(sent.at(-1)).toEqual({ type: "speech_cancelled" });
    useFeatures.setState((s) => ({ features: { ...s.features!, stt: "browser" } }));
    sent.length = 0;
    C.onSpeechStart(); C.onSpeechEnd(new Float32Array(160));
    expect(sent.map((m) => m.type)).toEqual(["speech_start", "utterance"]); // jsdom has no SpeechRecognition
  });

  it("events: state, partial, opened and other sessions", () => {
    C.handle({ type: "state", value: "thinking", busy: true });
    C.handle({ type: "partial", text: "open" });
    expect(useVoice.getState()).toMatchObject({ serverState: "thinking", partial: "open" });
    C.handle({ type: "partial", text: "other", session: "s2" });
    expect(useVoice.getState().partial).toBe("open");
    C.handle({ type: "user", id: "u2", text: "open it", source: "voice" });
    expect(useVoice.getState().partial).toBeNull();
    C.handle({ type: "heard_nothing" });
    expect(useVoice.getState().flash).toBe("Didn't catch that");
  });

  it("mute is remembered and told to the server; Esc stops her and the turn", async () => {
    C.toggleMute();
    expect(sent).toEqual([{ type: "mute", value: true }]);
    expect(localStorage.getItem("vd-muted")).toBe("1");
    C.toggleMute();
    const off = C.wireVoice();
    Player.enqueue(clip(0)); await flush();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(sent.at(-1)).toEqual({ type: "interrupt" });
    expect(useVoice.getState().playing).toBe(false);
    off();
  });
});
