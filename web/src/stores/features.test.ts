import { describe, expect, it } from "vitest";
import type { FolderItem, HelloEvent } from "../protocol.gen";
import { dispatch, on } from "../events";
import { reduce, type FeaturesState } from "./features";

const empty: FeaturesState = { features: null, folders: [], services: {}, build: null };
const repo: FolderItem = { path: "/code/api", label: "acme/api", rel: "api", sessions: [] };
const hello: HelloEvent = {
  type: "hello", build: "abc123", folders: [repo], services: { kokoro: true }, rate_limit: null,
  roots: ["/code"], vault: "", brain: false, routines: false, onboarded: true, stt: "browser", tts: "kokoro", plan: "max",
};

describe("features store", () => {
  it("takes features, folders, services and build from hello", () => {
    const s = reduce(empty, hello);
    expect(s.features).toEqual({ roots: ["/code"], vault: "", brain: false, routines: false, onboarded: true, stt: "browser", tts: "kokoro", plan: "max" });
    expect(s.folders).toEqual([repo]);
    expect(s.services).toEqual({ kokoro: true });
    expect(s.build).toBe("abc123");
  });

  it("keeps folders when only features change, and the reverse", () => {
    const s = reduce(reduce(empty, hello), { ...hello, type: "features", onboarded: false } as never);
    expect(s.features?.onboarded).toBe(false);
    expect(s.folders).toEqual([repo]);
    expect(reduce(s, { type: "folders", items: [] }).folders).toEqual([]);
  });

  it("ignores other events", () => {
    const s = reduce(empty, hello);
    expect(reduce(s, { type: "notice", text: "hi" })).toBe(s);
  });
});

describe("event bus", () => {
  it("delivers only the subscribed type, and stops after unsubscribe", () => {
    const got: string[] = [];
    const off = on("notice", (ev) => got.push(ev.text));
    dispatch({ type: "notice", text: "one" });
    dispatch({ type: "error", text: "not mine" });
    off();
    dispatch({ type: "notice", text: "two" });
    expect(got).toEqual(["one"]);
  });

  it("keeps going when a handler throws", () => {
    const got: string[] = [];
    const offs = [on("error", () => { throw new Error("boom"); }), on("error", (ev) => got.push(ev.text))];
    dispatch({ type: "error", text: "still delivered" });
    offs.forEach((off) => off());
    expect(got).toEqual(["still delivered"]);
  });
});
