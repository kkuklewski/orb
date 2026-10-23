// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenedEvent, ServerEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "./features";
import { useViews } from "./views";
import { initialSession, useSession, wireSession } from "./session";
import { folder, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { parseRoute, routePath, folderOf, wireRoute } = await import("./route");

const folders = [folder("web", [session("w1", "idle"), session("w2", "done")]), folder("api", [session("a1", "idle")])];
const opened = (path: string, key: string): OpenedEvent => ({ type: "opened", folder: path, session: key, label: "x", rel: "x", branch: null,
  session_id: null, live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] });
const hello = () => ({ type: "hello", build: "b", folders, services: {}, brain: false, onboarded: true, roots: [], routines: false, stt: "browser", tts: "kokoro", vault: "" }) as unknown as ServerEvent;

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  history.replaceState(null, "", "/next");
  useSession.setState(initialSession());
  useViews.setState({ view: "home" });
  useFeatures.setState({ features: null, folders, services: {}, build: null });
  offs = [wireSession(), wireRoute()];
});
afterEach(() => offs.forEach((off) => off()));

describe("routes", () => {
  it("parse and build", () => {
    expect(parseRoute("/next")).toEqual({ view: "home", session: null });
    expect(parseRoute("/next/")).toEqual({ view: "home", session: null });
    expect(parseRoute("/next/s/w%201")).toEqual({ view: "chat", session: "w 1" });
    expect(parseRoute("/next/settings")).toEqual({ view: "settings", session: null });
    expect(parseRoute("/next/nonsense")).toEqual({ view: "home", session: null });
    expect(routePath({ view: "chat", session: "w 1" })).toBe("/next/s/w%201");
    expect(routePath({ view: "routines", session: "w1" })).toBe("/next/routines");
    expect(folderOf(folders, "a1")?.label).toBe("api");
  });

  it("the address follows views and the open session", () => {
    useViews.setState({ view: "settings" });
    expect(location.pathname).toBe("/next/settings");
    dispatch(opened("/Users/a/code/web", "w2"));
    expect(location.pathname).toBe("/next/s/w2");
    dispatch(opened("/Users/a/code/api", "a1"));
    expect(location.pathname).toBe("/next/s/a1");
    useViews.setState({ view: "home" });
    expect(location.pathname).toBe("/next");
  });

  it("Back reopens the previous session", () => {
    dispatch(opened("/Users/a/code/web", "w2"));
    dispatch(opened("/Users/a/code/api", "a1"));
    history.replaceState(null, "", "/next/s/w2"); // what Back leaves in the address bar
    dispatchEvent(new PopStateEvent("popstate"));
    expect(sent.at(-1)).toEqual({ type: "open_folder", path: "/Users/a/code/web", session: "w2" });
    history.replaceState(null, "", "/next/activity");
    dispatchEvent(new PopStateEvent("popstate"));
    expect(useViews.getState().view).toBe("activity");
  });

  it("a link to a session opens it at start-up instead of the quiet reopen", () => {
    localStorage.setItem("vd-folder", "/Users/a/code/api");
    history.replaceState(null, "", "/next/s/w2");
    dispatch(hello());
    expect(sent).toEqual([{ type: "open_folder", path: "/Users/a/code/web", session: "w2" }]);
    dispatch(opened("/Users/a/code/web", "w2"));
    expect(useViews.getState().view).toBe("chat");
  });

  it("a link to a view starts there; an unknown session falls back to Home", () => {
    history.replaceState(null, "", "/next/routines");
    dispatch(hello());
    expect(useViews.getState().view).toBe("routines");
    history.replaceState(null, "", "/next/s/gone");
    dispatch(hello());
    expect(useViews.getState().view).toBe("home");
  });
});
