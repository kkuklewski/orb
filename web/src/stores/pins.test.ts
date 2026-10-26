// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFeatures } from "./features";
import { useHome } from "./home";
import { useViews } from "./views";
import { initialSession, useSession } from "./session";
import { useConnection } from "./connection";
import { folder, routines, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { DEFAULT_ASK, addPin, clearPins, pinsNote, removePin, sendWithPins, setKeep, togglePin, usePins } = await import("./pins");
const { currentScreen, SCREEN_MAX } = await import("./screen");

const task = { kind: "task", id: "74", label: "Ship the acme invoice" } as const;
const pr = { kind: "pr", id: "globex/web#18", label: "globex/web#18" } as const;
const forget = { type: "home_forget", links: [], reminders: [], repos: [],
  prs: [{ repo: "globex/web", number: 18, title: "Backlog", url: "u", updated: 1, idle_days: 9, stale: true, draft: false }] } as const;
const tasks = { type: "home_tasks", total: 2, url: "v", error: null,
  tasks: [{ id: 74, title: "Ship the acme invoice", project: "acme", due: null, priority: 1, updated: 1, url: "u" }] } as const;

beforeEach(() => {
  sent.length = 0;
  clearPins(); setKeep(false);
  useFeatures.setState({ features: { brain: false, onboarded: true, roots: [], routines: true, stt: "browser", tts: "kokoro", vault: "/v" }, folders: [folder("brain", [session("b1", "done")])], services: {}, build: null });
  useViews.setState({ view: "home", routines: routines({ items: [] }) });
  useHome.setState({ notes: null, forget: structuredClone(forget) as never, tasks: structuredClone(tasks) as never });
  useSession.setState({ ...initialSession(), folder: "/v", session: "b1" });
  useConnection.setState({ state: "online" });
});

describe("pins", () => {
  it("add, remove and toggle by kind + id; adding twice keeps one", () => {
    addPin(task); addPin(task); addPin(pr);
    expect(usePins.getState().pins).toHaveLength(2);
    togglePin(task);
    expect(usePins.getState().pins).toEqual([pr]);
    removePin(pr);
    expect(usePins.getState().pins).toEqual([]);
  });

  it("the Home screen text starts with the pinned references, ids and no row text", () => {
    addPin(task); addPin(pr); addPin({ kind: "routine", id: "r1", label: "Gmail 'morning'\ncleanup" });
    const t = currentScreen("home")!.text;
    expect(t.split("\n")[0]).toBe("Pinned by the user: task 74, PR globex/web#18, routine 'Gmail morning cleanup' (references: resolve them with the orb tools before answering).");
    expect(t).not.toContain("Ship the acme invoice'");
    expect(pinsNote([])).toBe("");
  });

  it("stays under the server's cap with pins and long lists", () => {
    addPin(task);
    useHome.setState({ forget: { ...forget, repos: Array.from({ length: 8 }, (_, i) => ({ path: `/r/${i}`, label: "x".repeat(2000), branch: null, changed: 1, ahead: 0 })) } as never });
    const t = currentScreen("home")!.text;
    expect(t.length).toBeLessThanOrEqual(SCREEN_MAX);
    expect(t.startsWith("Pinned by the user")).toBe(true);
  });

  it("an empty send with pins sends the default ask with the pinned line as the screen, then clears the pins", () => {
    addPin(task);
    expect(sendWithPins("", () => currentScreen("home"))).toBe(true);
    const shot = sent.find((m) => m.type === "screen") as { text: string };
    expect(shot.text.startsWith("Pinned by the user: task 74")).toBe(true);
    expect(sent.at(-1)).toMatchObject({ type: "user_text", text: DEFAULT_ASK });
    expect(usePins.getState().pins).toEqual([]);
  });

  it("keep leaves the pins after the turn", () => {
    addPin(task); setKeep(true);
    sendWithPins("what's blocking this?", () => currentScreen("home"));
    expect(sent.at(-1)).toMatchObject({ type: "user_text", text: "what's blocking this?" });
    expect(usePins.getState().pins).toEqual([task]);
  });

  it("a pin whose item vanished is dropped at send time, not before", () => {
    addPin(task); addPin(pr);
    useHome.setState({ forget: { ...forget, prs: [] } as never });
    expect(usePins.getState().pins).toHaveLength(2);
    sendWithPins("go", () => currentScreen("home"));
    const shot = sent.find((m) => m.type === "screen") as { text: string };
    expect(shot.text).toContain("task 74");
    expect(shot.text).not.toContain("globex/web#18");
  });

  it("from another session the request opens one in the notes folder", () => {
    useSession.setState({ folder: "/other", session: "o1" });
    addPin(task);
    sendWithPins("", () => currentScreen("home"));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/v" });
    expect(useSession.getState().pendingAsk).toBe(DEFAULT_ASK);
  });
});
