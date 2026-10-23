// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { HomeEvent, ServerEvent, TaskChangedEvent, TaskDetailEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { useHome } from "../stores/home";
import { initialSession, useSession } from "../stores/session";
import { useTasks, wireTasks, snoozeDays, toastText } from "../stores/tasks";
import { parseRoute, routePath } from "../stores/route";
import { folder } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { TaskScreen, TaskToast } = await import("./Task");

const t = (line: number, text: string) => ({ text, file: "inbox/g7.md", line, mtime: 1, raw: `- [ ] ${text}` });
const home = (tasks = [t(5, "Inventory all agents"), t(6, "Add approval gates"), t(7, "Document fallback")]): HomeEvent =>
  ({ type: "home", vault: "/v", tasks, open_tasks: tasks.length, snoozed: 0, notes: [], notes_week: 0 });
const detail = (line = 6, raw = "- [ ] Add approval gates"): TaskDetailEvent => ({
  type: "task_detail", file: "inbox/g7.md", line, raw, title: "G7 lunch", heading: "Action Checklist", mtime: 1_761_000_000,
  context: [{ n: 5, text: "- [ ] Inventory all agents" }, { n: 6, text: raw }, { n: 7, text: "- [ ] Document fallback" }],
});
const changed = (over: Partial<TaskChangedEvent> = {}): TaskChangedEvent => ({
  type: "task_changed", file: "inbox/g7.md", line: 6, action: "done", raw: "- [x] Add approval gates ✅ 2026-10-23", previous: "- [ ] Add approval gates", ...over,
});

let off: () => void;
beforeEach(() => {
  sent.length = 0;
  off = wireTasks();
  useSession.setState(initialSession());
  useFeatures.setState({ features: { brain: false, onboarded: true, roots: [], routines: false, stt: "browser", tts: "kokoro", vault: "/v" }, folders: [], services: {}, build: null });
  useHome.setState({ notes: home() });
  useTasks.setState({ task: { file: "inbox/g7.md", line: 6 }, detail: null, toast: null, next: null });
  useViews.setState({ view: "task" });
});
afterEach(() => { cleanup(); off(); });

describe("task screen", () => {
  it("shows the task in its note, with its place in the list", () => {
    render(<TaskScreen />);
    act(() => dispatch(detail()));
    expect(screen.getByRole("heading", { level: 1, name: "Add approval gates" })).toBeTruthy();
    expect(screen.getByText("TASK 2 OF 3")).toBeTruthy();
    expect(document.querySelector(".ex-line.hit")!.textContent).toContain("6- [ ] Add approval gates");
    expect(screen.getByText("Action Checklist")).toBeTruthy();
  });

  it("Mark done changes the line, then the next task opens; Undo puts it back", () => {
    render(<><TaskScreen /><TaskToast /></>);
    act(() => dispatch(detail()));
    fireEvent.click(screen.getByRole("button", { name: /Mark done/ }));
    expect(sent.at(-1)).toEqual({ type: "task_action", file: "inbox/g7.md", line: 6, expect: "- [ ] Add approval gates", action: "done" });
    act(() => dispatch(changed()));
    expect(screen.getByRole("status").textContent).toContain("Done: Add approval gates");
    act(() => dispatch(home([t(9, "Other note's task"), t(5, "Inventory all agents"), t(7, "Document fallback")]))); // re-sorted
    expect(useTasks.getState().task).toEqual(t(7, "Document fallback"));
    expect(sent.at(-1)).toEqual({ type: "task_detail", file: "inbox/g7.md", line: 7 });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "task_action", file: "inbox/g7.md", line: 6, expect: "- [x] Add approval gates ✅ 2026-10-23", action: "restore", value: "- [ ] Add approval gates" });
  });

  it("Snooze offers dates and sends the one picked; Not doing it drops", () => {
    render(<TaskScreen />);
    act(() => dispatch(detail()));
    fireEvent.click(screen.getByRole("button", { name: "Snooze ▾" }));
    const tomorrow = snoozeDays(new Date())[0];
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(`^Tomorrow`) }));
    expect(sent.at(-1)).toEqual({ type: "task_action", file: "inbox/g7.md", line: 6, expect: "- [ ] Add approval gates", action: "snooze", until: tomorrow.date });
    fireEvent.click(screen.getByRole("button", { name: "Not doing it" }));
    expect(sent.at(-1)).toMatchObject({ action: "drop" });
  });

  it("a done task can't be done again; arrows move through the list", () => {
    render(<TaskScreen />);
    act(() => dispatch(detail(6, "- [x] Add approval gates ✅ 2026-10-23")));
    expect((screen.getByRole("button", { name: /Mark done/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("// TO DO · DONE")).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(sent.at(-1)).toEqual({ type: "task_detail", file: "inbox/g7.md", line: 7 });
  });

  it("Do it with Claude suggests the repo, and a click there starts the session with the task", () => {
    useFeatures.setState((s) => ({ ...s, folders: [{ ...folder("gates"), label: "kkuklewski/approval-gates", rel: "approval-gates", last_used: 5 }, { ...folder("web"), rel: "aidport/web" }] }));
    render(<TaskScreen />);
    act(() => dispatch(detail()));
    expect(sent.filter((m) => m.type === "start_session")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Do it with Claude →" }));
    const where = screen.getByRole("group", { name: "Where to do it" });
    const first = within(where).getAllByRole("button")[0];
    expect(first.textContent).toContain("gates");
    expect(first.textContent).toContain("LOOKS RIGHT");
    expect(within(where).queryByText(/web/)).toBeNull(); // no shared word: not offered
    fireEvent.click(first);
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/Users/a/code/gates" });
    expect(useSession.getState().pendingAsk).toContain("(inbox/g7.md:6): Add approval gates");
  });

  it("Do it with Claude: another repo opens the picker; in my notes stays in the vault", () => {
    render(<TaskScreen />);
    act(() => dispatch(detail()));
    fireEvent.click(screen.getByRole("button", { name: "Do it with Claude →" }));
    fireEvent.click(screen.getByRole("button", { name: /Another repo/ }));
    expect(useSession.getState().picker).toBe("new");
    expect(sent.filter((m) => m.type === "start_session")).toEqual([]);
    useSession.setState({ picker: null });
    fireEvent.click(screen.getByRole("button", { name: /In my notes/ }));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/v" });
  });

  it("a failed change keeps the task: the server's error is the message", () => {
    render(<TaskScreen />);
    act(() => dispatch(detail()));
    act(() => dispatch({ type: "error", text: "The note changed since Orb read it, so nothing was written. Open it again." } as ServerEvent));
    expect(useTasks.getState().task).toEqual({ file: "inbox/g7.md", line: 6 });
  });
});

describe("opened from a link", () => {
  it("renders before the task list is loaded, and asks for it", () => {
    useHome.setState({ notes: null });
    render(<TaskScreen />);
    expect(sent).toContainEqual({ type: "home" });
    act(() => dispatch(detail()));
    expect(screen.getByRole("heading", { level: 1, name: "Add approval gates" })).toBeTruthy();
    expect(screen.getByText("TASK")).toBeTruthy();
  });
});

describe("task helpers", () => {
  it("toasts say what happened", () => {
    expect(toastText(changed({ action: "snooze", raw: "- [ ] Add approval gates ⏳ 2026-10-27" }))).toMatch(/^Snoozed until Tue 27 Oct: Add approval gates$/);
    expect(toastText(changed({ action: "drop", raw: "- [-] Add approval gates ❌ 2026-10-23" }))).toBe("Marked as not doing: Add approval gates");
  });
  it("snooze days: tomorrow, the next Monday, a month", () => {
    const fri = new Date(2026, 9, 23, 13);
    expect(snoozeDays(fri).map((d) => d.date)).toEqual(["2026-10-24", "2026-10-26", "2026-11-22"]);
    const mon = new Date(2026, 9, 26, 9);
    expect(snoozeDays(mon)[1].date).toBe("2026-11-02");
  });
  it("routes: /next/t/<note>/<line>", () => {
    expect(parseRoute("/next/t/inbox%2Fg7.md/6")).toEqual({ view: "task", session: null, task: { file: "inbox/g7.md", line: 6 } });
    expect(routePath({ view: "task", session: null, task: { file: "inbox/g7.md", line: 6 } })).toBe("/next/t/inbox%2Fg7.md/6");
  });
});
