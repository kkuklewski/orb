// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeEvent } from "../protocol.gen";
import { useFeatures } from "./features";
import { useViews } from "./views";
import { useHome } from "./home";
import { initialSession, useSession } from "./session";
import { useConnection } from "./connection";
import { useTasks } from "./tasks";
import { folder, routine, routines, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { currentScreen, wireScreen } = await import("./screen");

const notes: HomeEvent = { type: "home", vault: "/v", open_tasks: 31, snoozed: 0, notes_week: 250,
  tasks: [{ text: "Fix n8n summary serialization", file: "scrapers/Topics/index.md", line: 134, mtime: 1, raw: "- [ ] Fix n8n summary serialization" }],
  notes: [{ title: "Frontend stack", file: "notes/ideas/stack.md", mtime: 1 }] };

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  useFeatures.setState({ features: { brain: false, onboarded: true, roots: [], routines: true, stt: "browser", tts: "kokoro", vault: "/v" },
    folders: [folder("brain", [session("b1", "approval", { label: "What's on my plate today?" })])], services: {}, build: null });
  useViews.setState({ view: "home", routines: routines({ items: [routine({ name: "night-maintenance", last: { id: "r", outcome: "ok" } })] }) });
  useHome.setState({ notes });
  useSession.setState({ ...initialSession(), folder: "/v", session: "b1" });
  useConnection.setState({ state: "online" });
  useTasks.setState({ task: null, detail: null, toast: null, next: null });
});
afterEach(() => vi.useRealTimers());

describe("what the screen says", () => {
  it("Home: the brief, the sessions, routines, tasks with their place in the notes, recent notes", () => {
    const s = currentScreen("home")!;
    expect(s.name).toBe("Home");
    expect(s.text).toContain("One session is waiting for your OK in brain.");
    expect(s.text).toContain("- What's on my plate today? (brain, waiting for an approval)");
    expect(s.text).toContain("- night-maintenance: ok");
    expect(s.text).toContain("- [ ] Fix n8n summary serialization (scrapers/Topics/index.md:134)");
    expect(s.text).toContain("- Frontend stack (notes/ideas/stack.md)");
  });

  it("Home: Vikunja tasks, unsaved repos, pull requests and reminders come with it, within the server's limit", () => {
    useHome.setState({ watch: { type: "home_watch", links: [], reminders: [{ text: "Renew acme domain", due: "2026-11-01", days: -2 }],
      repos: [{ path: "/r/globex", label: "acme/globex", branch: "main", changed: 3, ahead: 2 }],
      prs: [{ repo: "acme/globex", number: 7, title: "Fix login", url: "u", updated: 1, idle_days: 5, stale: true, draft: false }],
      tracker: { total: 40, url: "http://v", tasks: [{ id: 12, title: "Ship the globex invoice", project: "acme", due: "2026-10-30", priority: 3, updated: 1, url: "u" }] }, tracker_error: null } });
    const t = currentScreen("home")!.text;
    expect(t).toContain("- #12 Ship the globex invoice (acme, due 2026-10-30)");
    expect(t).toContain("- acme/globex (main): 3 changed files, 2 unpushed commits");
    expect(t).toContain("- acme/globex#7 Fix login, quiet 5 days");
    expect(t).toContain("- Renew acme domain (due 2026-11-01, overdue)");
    expect(t.indexOf("#12")).toBeLessThan(t.indexOf("Fix n8n summary")); // Vikunja leads, notes are context
    useHome.setState({ watch: { ...useHome.getState().watch!, repos: Array.from({ length: 8 }, (_, i) => ({ path: `/r/${i}`, label: "x".repeat(2000), branch: null, changed: i + 1, ahead: 0 })) } });
    expect(currentScreen("home")!.text.length).toBeLessThanOrEqual(8000);
  });

  it("the chat sends nothing; a task sends its line and the note around it", () => {
    expect(currentScreen("chat")).toBeNull();
    expect(currentScreen("task")).toBeNull(); // not loaded yet
    useTasks.setState({ detail: { type: "task_detail", file: "a.md", line: 3, raw: "- [ ] x", title: "A", heading: "H", mtime: 1, context: [{ n: 3, text: "- [ ] x" }] } });
    expect(currentScreen("task")!.text).toContain("a.md, line 3, under \"H\" in the note \"A\"");
  });
});

describe("sending it", () => {
  it("sends on change only, and says when the chat is showing", () => {
    const off = wireScreen();
    useViews.setState({ view: "home" });
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "screen", name: "Home" });
    useHome.setState({ notes }); // same content
    vi.advanceTimersByTime(400);
    expect(sent).toHaveLength(1);
    useViews.setState({ view: "chat" });
    vi.advanceTimersByTime(400);
    expect(sent.at(-1)).toEqual({ type: "screen", name: null });
    off();
  });

  it("waits for a session and a connection", () => {
    useSession.setState({ session: null });
    const off = wireScreen();
    useViews.setState({ view: "routines" });
    vi.advanceTimersByTime(400);
    expect(sent).toEqual([]);
    useSession.setState({ session: "b1" });
    vi.advanceTimersByTime(400);
    expect(sent.at(-1)).toMatchObject({ type: "screen", name: "Routines" });
    off();
  });
});
