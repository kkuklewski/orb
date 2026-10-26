// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Features, HomeForgetEvent, HomeTasksEvent } from "../protocol.gen";
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
const { dueText } = await import("./HomeForget");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: false, stt: "browser", tts: "kokoro", vault: "", ...over,
});
const forget = (over: Partial<HomeForgetEvent> = {}): HomeForgetEvent => ({
  type: "home_forget",
  reminders: [{ text: "Renew acme.example", due: "2030-03-12", days: 2, url: "https://registrar.example/acme" },
              { text: "Globex contract", due: "2030-04-01", days: 22, url: null },
              { text: "Run the switch script", due: null, days: null, url: null }],
  links: [{ label: "Tracker", url: "http://10.0.0.5:8002" }],
  repos: [{ path: "/Users/a/code/web", label: "acme/web", branch: "main", changed: 3, ahead: 2 }],
  prs: [{ repo: "acme/old", number: 2, title: "Forgotten", url: "https://github.com/acme/old/pull/2", updated: 0, idle_days: 90, stale: true, draft: false },
        { repo: "acme/web", number: 7, title: "Fix login", url: "https://github.com/acme/web/pull/7", updated: 1, idle_days: 5, stale: true, draft: false },
        { repo: "acme/api", number: 9, title: "Fresh", url: "https://github.com/acme/api/pull/9", updated: 2, idle_days: 0, stale: false, draft: false }],
  ...over,
});
const tasks = (over: Partial<HomeTasksEvent> = {}): HomeTasksEvent => ({
  type: "home_tasks", tasks: [{ id: 4, title: "Ship the invoice export", project: "Globex", due: "2030-03-15", priority: 4, updated: 1, url: "http://10.0.0.5:8002/tasks/4" }],
  total: 23, url: "http://10.0.0.5:8002", error: null, ...over,
});

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  offs = [wireSession(), wireHome()];
  useSession.setState(initialSession());
  useViews.setState({ view: "home", settings: null, routines: routines({ items: [] }), routinesNew: new Set() });
  useFeatures.setState({ features: features(), folders: [folder("web")], services: {}, build: null });
  useHome.setState({ notes: null, forget: null, tasks: null });
  clearPins();
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("Don't forget helpers", () => {
  it("due soon counts reminders within a week and pull requests that went quiet this month", () => {
    expect(dueSoon(forget())).toBe(2);
    expect(dueSoon(null)).toBe(0);
  });
  it("days left in words", () => {
    expect([-3, -1, 0, 1, 9].map((days) => dueText({ days }))).toEqual(["3 days overdue", "1 day overdue", "today", "tomorrow", "in 9 days"]);
  });
  it("the brief counts Vikunja tasks when the tracker is set up", () => {
    const text = brief({ waiting: [], done: [], routines: null, notes: null, vault: false, routinesOn: false, tasks: tasks() })
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

describe("Don't forget cards", () => {
  it("shows nothing extra before the server answers", () => {
    render(<Home />);
    expect(screen.queryByRole("article", { name: /due|unsaved|Vikunja/i })).toBeNull();
  });

  it("fills the stats and cards from home_forget and home_tasks", () => {
    render(<Home />);
    act(() => { dispatch(forget()); dispatch(tasks()); });

    const pane = screen.getByRole("article", { name: "2 things need you this week" });
    const renew = within(pane).getByRole("button", { name: /Renew acme.example/ });
    expect(renew.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(renew);
    expect(renew.getAttribute("aria-expanded")).toBe("true");
    expect(within(pane).getByRole("link", { name: "Open link" }).getAttribute("href")).toBe("https://registrar.example/acme");
    expect(within(pane).getByRole("link", { name: "Open link" }).getAttribute("rel")).toContain("noopener");
    fireEvent.click(within(pane).getByRole("button", { name: /PR #7/ }));
    expect(renew.getAttribute("aria-expanded")).toBe("false");  // one row open at a time
    expect(pane.textContent).toContain("in 2 days");
    expect(pane.textContent).toContain("in 22 days");
    expect(pane.textContent).toContain("no date");
    expect(within(pane).queryByRole("button", { name: /PR #9/ })).toBeNull();
    expect(within(pane).queryByRole("button", { name: /PR #2/ })).toBeNull();
    fireEvent.click(within(pane).getByRole("button", { name: /1 more pull request quiet over 30 days/ }));
    expect(sent.at(-1)).toEqual({ type: "item_list", source: "prs" });

    fireEvent.click(within(screen.getByRole("article", { name: "Nothing waiting" })).getByRole("button", { name: "All 23 tasks →" }));
    expect(sent.at(-1)).toEqual({ type: "item_list", source: "vikunja" });
    expect(screen.getByRole("link", { name: "Tracker" }).getAttribute("href")).toBe("http://10.0.0.5:8002");
  });

  it("routines and don't forget share one card, a tab each (no unsaved-work tab); the choice and the arrow keys switch it (R is no key now)", () => {
    useFeatures.setState({ features: features({ routines: true }) });
    render(<Home />);
    act(() => dispatch(forget()));
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Routines", "Don't forget5"]);
    expect(screen.getByRole("tab", { name: /Don't forget/ }).getAttribute("aria-selected")).toBe("true");  // the one that needs you opens first
    expect(screen.queryByRole("article", { name: /unsaved work/ })).toBeNull();
    fireEvent.keyDown(window, { key: "r" });
    expect(screen.getByRole("tab", { name: /Don't forget/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Routines" }));
    expect(screen.getByRole("tab", { name: "Routines" }).getAttribute("aria-selected")).toBe("true");
    expect(localStorage.getItem("orb.home.tab")).toBe("routines");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Routines" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: /Don't forget/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("p pins the row that has focus", () => {
    render(<Home />);
    act(() => dispatch(forget()));
    const text = screen.getByRole("button", { name: /PR #7/ });
    text.focus();
    fireEvent.keyDown(text, { key: "p" });
    expect(usePins.getState().pins).toEqual([{ kind: "pr", id: "acme/web#7", label: "acme/web#7" }]);
  });

  it("a spoken ping (pin_focused) pins the focused row, unpins it on a second ping, and says so when nothing is focused", async () => {
    const { pinFocused } = await import("../stores/pins");
    useViews.setState({ view: "home" });
    render(<Home />);
    act(() => dispatch(forget()));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(pinFocused()).toBeNull();
    const text = screen.getByRole("button", { name: /PR #7/ });
    text.focus();
    expect(pinFocused()).toBe("pinned");
    expect(usePins.getState().pins).toEqual([{ kind: "pr", id: "acme/web#7", label: "acme/web#7" }]);
    expect(pinFocused()).toBe("unpinned");
    expect(usePins.getState().pins).toEqual([]);
  });

  it("hides the cards that have nothing to show", () => {
    render(<Home />);
    act(() => { dispatch(forget({ reminders: [], prs: [], repos: [], links: [] })); dispatch(tasks({ tasks: null, total: 0, url: null })); });
    expect(screen.queryByRole("article", { name: /this week|keep in mind|unsaved|most urgent/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Links" })).toBeNull();
  });

  it("the needs-you card only shows when something waits", () => {
    useFeatures.setState({ folders: [folder("web", [session("w1", "approval", { label: "fix login" })])] });
    render(<Home />);
    expect(screen.getByRole("article", { name: "1 thing needs you" })).toBeTruthy();
    cleanup();
    useFeatures.setState({ folders: [folder("web")] });
    render(<Home />);
    expect(screen.queryByRole("article", { name: /needs? you/ })).toBeNull();
  });
});
