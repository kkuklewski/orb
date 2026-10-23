// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandItem, OpenedEvent } from "../protocol.gen";
import { folder, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const S = await import("./session");

const opened = (over: Partial<OpenedEvent> = {}): OpenedEvent => ({
  type: "opened", folder: "/Users/a/code/web", session: "w1", label: "acme/web", rel: "code/web", branch: "main",
  session_id: null, live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [], ...over,
});
const cmd = (name: string, description = "", local = false): CommandItem => ({ name, description, argumentHint: "", local });

beforeEach(() => {
  sent.length = 0;
  S.useSession.setState(S.initialSession());
});

describe("session reducer", () => {
  it("opened sets where you are; events of other sessions are ignored", () => {
    let s = S.reduce(S.initialSession(), opened());
    expect(s).toMatchObject({ folder: "/Users/a/code/web", session: "w1", label: "acme/web", branch: "main" });
    s = S.reduce(s, { type: "commands", session: "other", items: [cmd("x")] });
    expect(s.commands).toEqual([]);
    s = S.reduce(s, { type: "commands", session: "w1", items: [cmd("clear", "", true)] });
    expect(s.commands.map((c) => c.name)).toEqual(["clear"]);
    s = S.reduce(s, { type: "state", session: "w1", busy: true, value: "thinking" });
    expect(s.busy).toBe(true);
  });
});

describe("sidebar lists", () => {
  const folders = [
    { ...folder("zeta", [session("z1", "idle", { last_used: 50 }), session("z2", "idle", { empty: true })]), pinned: true },
    { ...folder("alpha", [session("a1", "done", { last_used: 90, label: "fix login" })]), pinned: true, last_used: 90 },
    { ...folder("beta"), rel: "clients/beta" },
  ];

  it("recents: newest first, never-used sessions only when on screen", () => {
    expect(S.allSessions(folders, null).map((x) => x.key)).toEqual(["a1", "z1"]);
    expect(S.allSessions(folders, "z2").map((x) => x.key)).toContain("z2");
  });

  it("pinned repos by name", () => {
    expect(S.pinnedFolders(folders).map((f) => f.label)).toEqual(["alpha", "zeta"]);
  });

  it("search finds sessions by title or folder, and folders by name or path", () => {
    const r = S.search(folders, "login", null);
    expect(r.sessions.map((x) => x.key)).toEqual(["a1"]);
    expect(S.search(folders, "clients", null).folders.map((f) => f.label)).toEqual(["beta"]);
    expect(S.search(folders, "  ", null)).toEqual({ sessions: [], folders: [] });
  });

  it("picker: recently used first, then by name", () => {
    expect(S.pickerItems(folders, "").map((f) => f.label)).toEqual(["alpha", "beta", "zeta"]);
    expect(S.pickerItems(folders, "BET").map((f) => f.label)).toEqual(["beta"]);
  });
});

describe("slash menu", () => {
  const items = [cmd("clear", "", true), cmd("model", "Switch model", true), cmd("design:accessibility-review"), cmd("compact", "Summarize to save context"), cmd("review")];

  it("opens only for a lone /word at the start", () => {
    expect(S.slashQuery("/")).toBe("");
    expect(S.slashQuery("/Rev")).toBe("rev");
    expect(S.slashQuery("/review now")).toBeNull();
    expect(S.slashQuery("hi /x")).toBeNull();
  });

  it("ranks name prefix, plugin-skill prefix, anywhere, then description", () => {
    expect(S.slashMatches(items, "").length).toBe(5);
    expect(S.slashMatches(items, "acc").map((c) => c.name)).toEqual(["design:accessibility-review"]);
    expect(S.slashMatches(items, "re").map((c) => c.name)).toEqual(["review", "design:accessibility-review"]);
    expect(S.slashMatches(items, "context").map((c) => c.name)).toEqual(["compact"]);
    expect(S.slashMatches(items, "zzz")).toEqual([]);
  });
});

describe("actions", () => {
  it("a pinned repo's row opens it and unfolds it; clicking the open one folds it", () => {
    S.toggleProject("/p/web");
    expect(sent).toEqual([{ type: "open_folder", path: "/p/web", session: undefined }]);
    expect(S.useSession.getState().expanded).toEqual(["/p/web"]);
    S.useSession.setState({ folder: "/p/web" });
    S.toggleProject("/p/web");
    expect(S.useSession.getState().expanded).toEqual([]);
    expect(localStorage.getItem("vd-expanded")).toBe("[]");
  });

  it("picker choice starts a session or pins, and closes", () => {
    S.openPicker("new"); S.choosePath("/p/api");
    S.openPicker("pin"); S.choosePath("/p/web");
    expect(sent).toEqual([{ type: "start_session", path: "/p/api" }, { type: "pin_folder", path: "/p/web", pinned: true }]);
    expect(S.useSession.getState()).toMatchObject({ picker: null, expanded: ["/p/web"] });
  });

  it("typed text needs an open folder; otherwise the picker asks where", () => {
    expect(S.sendText("hello")).toBe(false);
    expect(S.useSession.getState().picker).toBe("new");
    S.useSession.setState({ folder: "/p/web", busy: true, picker: null });
    expect(S.sendText("  hello  ")).toBe(true);
    expect(sent).toEqual([{ type: "user_text", text: "hello", interrupt: true }]);
    expect(S.sendText("   ")).toBe(false);
  });
});
