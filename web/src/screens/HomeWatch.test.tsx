// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Features, HomeWatchEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialSession, useSession, wireSession } from "../stores/session";
import { brief, dueSoon, useHome, wireHome } from "../stores/home";
import { clearPins, usePins } from "../stores/pins";
import { folder, routines, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { Home } = await import("./Home");
const { recentRows } = await import("./Sidebar");
const { ASK_UNSAVED, dueText, repoText } = await import("./HomeWatch");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: false, stt: "browser", tts: "kokoro", vault: "", ...over,
});
const watch = (over: Partial<HomeWatchEvent> = {}): HomeWatchEvent => ({
  type: "home_watch",
  reminders: [{ text: "Renew acme.example", due: "2030-03-12", days: 2, url: "https://registrar.example/acme" },
              { text: "Globex contract", due: "2030-04-01", days: 22, url: null },
              { text: "Run the switch script", due: null, days: null, url: null }],
  links: [{ label: "Tracker", url: "http://10.0.0.5:8002" }],
  repos: [{ path: "/Users/a/code/web", label: "acme/web", branch: "main", changed: 3, ahead: 2 }],
  prs: [{ repo: "acme/old", number: 2, title: "Forgotten", url: "https://github.com/acme/old/pull/2", updated: 0, idle_days: 90, stale: true, draft: false },
        { repo: "acme/web", number: 7, title: "Fix login", url: "https://github.com/acme/web/pull/7", updated: 1, idle_days: 5, stale: true, draft: false },
        { repo: "acme/api", number: 9, title: "Fresh", url: "https://github.com/acme/api/pull/9", updated: 2, idle_days: 0, stale: false, draft: false }],
  tracker: { tasks: [{ id: 4, title: "Ship the invoice export", project: "Globex", due: "2030-03-15", priority: 4, updated: 1, url: "http://10.0.0.5:8002/tasks/4" }], total: 23, url: "http://10.0.0.5:8002" },
  tracker_error: null, ...over,
});

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  offs = [wireSession(), wireHome()];
  useSession.setState(initialSession());
  useViews.setState({ view: "home", settings: null, routines: routines({ items: [] }), routinesNew: new Set() });
  useFeatures.setState({ features: features(), folders: [folder("web")], services: {}, build: null });
  useHome.setState({ notes: null, watch: null });
  clearPins();
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("watch helpers", () => {
  it("due soon counts reminders within a week and pull requests that went quiet this month", () => {
    expect(dueSoon(watch())).toBe(2);
    expect(dueSoon(null)).toBe(0);
  });
  it("days left and repo state in words", () => {
    expect([-3, -1, 0, 1, 9].map((days) => dueText({ days }))).toEqual(["3 days overdue", "1 day overdue", "today", "tomorrow", "in 9 days"]);
    expect(repoText({ path: "", label: "", branch: "main", changed: 3, ahead: 2 })).toBe("2 unpushed · 3 changed");
    expect(repoText({ path: "", label: "", branch: "x", changed: 1, ahead: null })).toBe("1 changed · no upstream");
  });
  it("the brief counts Vikunja tasks when the tracker is set up", () => {
    const text = brief({ waiting: [], done: [], routines: null, notes: null, vault: false, routinesOn: false, watch: watch() })
      .flat().map((p) => (typeof p === "string" ? p : p.b)).join("");
    expect(text).toBe("Vikunja holds 23 open tasks.");
  });
  it("recents keep one row per label in a folder, unless it's open or current", () => {
    const f = { path: "/r" };
    const rows = [{ key: "a", label: "Fix login", live: false, folder: f }, { key: "b", label: "fix login ", live: false, folder: f },
                  { key: "c", label: "Fix login", live: true, folder: f }, { key: "d", label: "Fix login", live: false, folder: { path: "/s" } },
                  { key: "e", label: null, live: false, folder: f }, { key: "g", label: null, live: false, folder: f }];
    expect(recentRows(rows, null).map((r) => r.key)).toEqual(["a", "c", "d", "e", "g"]);
    expect(recentRows(rows, "b").map((r) => r.key)).toEqual(["a", "b", "c", "d", "e", "g"]);
  });
});

describe("home watch cards", () => {
  it("shows nothing extra before the server answers", () => {
    render(<Home />);
    expect(screen.queryByRole("article", { name: /due|unsaved|Vikunja/i })).toBeNull();
  });

  it("fills the stats and cards from home_watch", () => {
    render(<Home />);
    act(() => dispatch(watch()));

    const forget = screen.getByRole("article", { name: "2 things need you this week" });
    expect(within(forget).getByRole("link", { name: "Renew acme.example" }).getAttribute("href")).toBe("https://registrar.example/acme");
    expect(within(forget).getByRole("link", { name: "Renew acme.example" }).getAttribute("rel")).toContain("noopener");
    expect(forget.textContent).toContain("in 2 days");
    expect(forget.textContent).toContain("in 22 days");
    expect(forget.textContent).toContain("no date");
    expect(within(forget).getByRole("button", { name: /PR #7/ })).toBeTruthy();
    expect(within(forget).queryByRole("button", { name: /PR #9/ })).toBeNull();
    expect(within(forget).queryByRole("button", { name: /PR #2/ })).toBeNull();
    fireEvent.click(within(forget).getByRole("button", { name: /1 more pull request quiet over 30 days/ }));
    expect(sent.at(-1)).toEqual({ type: "item_list", source: "prs" });

    const todo = screen.getByRole("article", { name: "23 open tasks, most urgent first" });
    expect(todo.textContent).toContain("Globex · due 03-15");
    expect(todo.textContent).toContain("+ 22 more");
    expect(screen.getByRole("link", { name: "Tracker" }).getAttribute("href")).toBe("http://10.0.0.5:8002");
  });

  it("a repo with unsaved work opens a session there that asks what to commit", () => {
    render(<Home />);
    act(() => dispatch(watch()));
    const card = screen.getByRole("article", { name: "1 repo with unsaved work" });
    fireEvent.click(within(card).getByRole("button", { name: /^acme\/web/ }));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/Users/a/code/web" });
    act(() => dispatch({ type: "opened", folder: "/Users/a/code/web", session: "s1", label: "web", rel: "web", branch: null, session_id: null,
      live: false, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    expect(sent.at(-1)).toMatchObject({ type: "user_text", text: ASK_UNSAVED });
  });

  it("the pin button pins the repo row without opening its session", () => {
    render(<Home />);
    act(() => dispatch(watch()));
    const card = screen.getByRole("article", { name: "1 repo with unsaved work" });
    fireEvent.click(within(card).getByRole("button", { name: "Pin: acme/web" }));
    expect(sent.some((m) => m.type === "start_session")).toBe(false);
    expect(usePins.getState().pins).toEqual([{ kind: "repo", id: "/Users/a/code/web", label: "acme/web" }]);
    expect(within(card).getByRole("button", { name: "Unpin: acme/web" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("p pins the row that has focus", () => {
    render(<Home />);
    act(() => dispatch(watch()));
    const text = within(screen.getByRole("article", { name: /open task/ })).getByRole("button", { name: "Ship the invoice export" });
    text.focus();
    fireEvent.keyDown(text, { key: "p" });
    expect(usePins.getState().pins).toEqual([{ kind: "task", id: "4", label: "Ship the invoice export" }]);
  });

  it("hides the cards that have nothing to show", () => {
    render(<Home />);
    act(() => dispatch(watch({ reminders: [], prs: [], repos: [], links: [], tracker: null })));
    expect(screen.queryByRole("article", { name: /this week|keep in mind|unsaved|most urgent/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
  });

  it("the needs-you card only shows when something waits", () => {
    useFeatures.setState({ folders: [folder("web", [session("w1", "approval", { label: "fix login" })])] });
    render(<Home />);
    expect(screen.getByRole("article", { name: "1 thing needs you now" })).toBeTruthy();
    cleanup();
    useFeatures.setState({ folders: [folder("web")] });
    render(<Home />);
    expect(screen.queryByRole("article", { name: "Nothing waiting" })).toBeNull();
  });
});
