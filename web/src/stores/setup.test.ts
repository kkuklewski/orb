import { describe, expect, it } from "vitest";
import { canContinue, initialSetup, reduce, stepDone } from "./setup";
import { status } from "../test/fixtures";

describe("setup rules", () => {
  it("needs a subscription sign-in to pass step 1", () => {
    expect(canContinue(1, status())).toBe(true);
    expect(canContinue(1, status({ auth: { ...status().auth, loggedIn: false } }))).toBe(false);
    expect(canContinue(1, status({ auth: { ...status().auth, subscriptionLogin: false, method: "console" } }))).toBe(false);
    expect(canContinue(1, null)).toBe(false);
  });

  it("needs a folder with at least one repo to pass step 2 and to finish", () => {
    const none = status({ roots: [{ path: "/Users/a/empty", exists: true, repos: [] }] });
    expect(canContinue(2, none)).toBe(false);
    expect(canContinue(3, none)).toBe(true); // notes are optional
    expect(canContinue(5, none)).toBe(false);
    expect(canContinue(5, status())).toBe(true);
  });

  it("marks steps done when passed or already met, never the current one", () => {
    expect(stepDone(1, 2, status())).toBe(true); // behind
    expect(stepDone(2, 2, status())).toBe(false); // current
    expect(stepDone(3, 2, status())).toBe(true); // notes are optional
    expect(stepDone(4, 2, status())).toBe(true); // voice has no requirement
    expect(stepDone(5, 2, status())).toBe(false); // the last step is never "done" ahead of time
    expect(stepDone(3, 2, null)).toBe(false); // nothing known yet
  });
});

describe("setup events", () => {
  it("shows a voice sample's error on its row and as a message", () => {
    const s = reduce(initialSetup, { type: "voice_sample", voice: "zz", error: "Kokoro refused that voice (HTTP 400)." });
    expect(s.sample).toEqual({ voice: "zz", state: "error", text: "Kokoro refused that voice (HTTP 400)." });
    expect(s.toast?.level).toBe("error");
  });

  it("marks a sample that arrived as playing", () => {
    expect(reduce(initialSetup, { type: "voice_sample", voice: "af_bella", data: "AAAA", mime: "audio/mpeg" }).sample)
      .toEqual({ voice: "af_bella", state: "playing" });
  });

  it("stops waiting for Finder when it answers, and shows its error", () => {
    const s = reduce({ ...initialSetup, picking: true }, { type: "picked", error: "Use Browse." });
    expect(s.picking).toBe(false);
    expect(s.toast?.text).toBe("Use Browse.");
  });

  it("shows server errors only while the setup is open", () => {
    expect(reduce(initialSetup, { type: "error", text: "x" }).toast).toBeNull();
    expect(reduce({ ...initialSetup, open: true }, { type: "error", text: "x" }).toast).toEqual({ text: "x", level: "error" });
  });
});
