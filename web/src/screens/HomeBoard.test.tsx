// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DelegationItem, EmailRow, Features, PlanEvent, PlanItem } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { activityRows, useViews } from "../stores/views";
import { initialSession, useSession, wireSession } from "../stores/session";
import { useHome, wireHome } from "../stores/home";
import { useTasks, wireTasks } from "../stores/tasks";
import { initialDelegations, useDelegations, wireDelegations } from "../stores/delegation";
import { boardColumns, boardProjects, cardProject, filterBoard, NO_PROJECT, noteRef } from "../stores/board";
import { folder, routine, routines, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { Home } = await import("./Home");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: true, stt: "browser", tts: "kokoro", vault: "/Users/a/notes", ...over,
});
const q = (kind: PlanItem["kind"], key: string, id: string, title: string, over: Partial<PlanItem> = {}): PlanItem =>
  ({ key, kind, id, title, reason: "Because.", actions: ["start"], ...over });
const task = q("task", "vikunja:8", "8", "Write the release notes", { source: "acme", due: "2026-10-25", actions: ["start", "done", "later", "delegate"], repo: "web" });
const later = q("task", "vikunja:9", "9", "Tidy the footer", { source: "acme", actions: ["start", "done", "later"] });
const note = q("note_task", "note:inbox/today.md:3", "inbox/today.md:3", "Send the invoice", { actions: ["start", "done", "later"] });
const pr = q("pr", "pr:acme/web#12", "acme/web#12", "Add dark mode", { actions: ["start", "later", "leave"] });
const result = q("result", "result:w2", "w2", "web: ship invoices");
const failed = q("routine", "routine:r4", "r4", "Routine ‘Backup’ failed", { source: "routine", actions: ["open"] });
const plan = (over: Partial<PlanEvent> = {}): PlanEvent => ({ type: "plan", needs_you: [], ranked_at: null, stale: false, busy: false, error: null, ...over });
const deleg = (over: Partial<DelegationItem> = {}): DelegationItem => ({
  id: "d1", task: 8, title: "Write the release notes", repo: "web", branch: "orb/8-write", stage: "working",
  line: "Working", session: "s9", folder: "/state/worktrees/web-orb-8", conflict: null, apply_text: "Apply merges orb/8-write.", ...over,
});
const email: EmailRow = { key: "e1", run: "run1", routine: "r1", routine_name: "Mail", text: "Reply to globex about the quote", urgent: true };

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  offs = [wireSession(), wireHome(), wireTasks(), wireDelegations()];
  useTasks.setState({ toast: null, next: null });
  useDelegations.setState(initialDelegations());
  useSession.setState(initialSession());
  useViews.setState({ view: "home", settings: null, routines: routines({ items: [routine({ last: { id: "r", outcome: "ok" } })] }), routinesNew: new Set() });
  useFeatures.setState({ features: features(), folders: [folder("web", [session("w1", "approval", { label: "fix login" }), session("w3", "working", { label: "add search" }), session("s9", "working")])], services: {}, build: null });
  useHome.setState({ notes: null, forget: null, tasks: null, plan: null, away: null });
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("board columns", () => {
  it("sorts every action into To do, In progress, Review and Done, each once", () => {
    const p = plan({ needs_you: [failed, { ...later, urgent: true }], next: task, up_next: [pr, later], more: [note, result],
      started: [q("task", "vikunja:5", "5", "Ship the importer")], done: [q("task", "vikunja:4", "4", "Fix login")] });
    const b = boardColumns({ plan: p, sessions: activityRows(useFeatures.getState().folders), emails: [email],
      delegations: [deleg(), deleg({ id: "d2", stage: "ready", session: "s10" }), deleg({ id: "d3", stage: "merged", session: "s11" })] });
    const keys = (c: typeof b.todo) => c.map((x) => x.key);
    expect(keys(b.todo)).toEqual(["routine:r4", "vikunja:9", "email:run1:e1", "vikunja:8", "note:inbox/today.md:3"]);
    // the delegation's own session (s9) is the delegation's card, not a second one
    expect(keys(b.doing)).toEqual(["session:w1", "deleg:d1", "vikunja:5", "session:w3"]);
    expect(keys(b.review)).toEqual(["pr:acme/web#12", "result:w2", "deleg:d2"]);
    expect(keys(b.done)).toEqual(["done:vikunja:4", "deleg:d3"]);
  });

  it("an empty plan leaves four empty columns", () => {
    const b = boardColumns({ plan: null, sessions: [], delegations: [], emails: [] });
    expect([b.todo, b.doing, b.review, b.done].map((c) => c.length)).toEqual([0, 0, 0, 0]);
  });

  it("names each card's project: the repo, else the task's tracker project; none for notes, routines and email", () => {
    const p = plan({ needs_you: [failed], next: task, up_next: [{ ...pr, source: "web" }, later], more: [note, { ...result, source: "globex/api" }] });
    const b = boardColumns({ plan: p, sessions: activityRows(useFeatures.getState().folders), emails: [email],
      delegations: [deleg({ id: "d2", stage: "ready", session: "s10", repo: "acme/shop" })] });
    const all = [...b.todo, ...b.doing, ...b.review, ...b.done];
    const of = (key: string) => cardProject(all.find((c) => c.key === key)!);
    expect(of("vikunja:8")).toBe("web");  // mapped to a repo: the repo, not the tracker's project
    expect(of("vikunja:9")).toBe("acme");  // no repo: the tracker's project
    expect(of("pr:acme/web#12")).toBe("web");
    expect(of("result:w2")).toBe("api");
    expect(of("deleg:d2")).toBe("shop");
    expect(of("session:w1")).toBe("web");
    expect([of("routine:r4"), of("note:inbox/today.md:3"), of("email:run1:e1")]).toEqual([null, null, null]);
    const { projects, other, total } = boardProjects(b);
    expect(projects).toEqual([{ name: "acme", count: 1 }, { name: "api", count: 1 }, { name: "shop", count: 1 }, { name: "web", count: 5 }]);
    expect([other, total]).toEqual([3, 11]);
    const web = filterBoard(b, "web");
    expect([...web.todo, ...web.doing, ...web.review].map((c) => c.key)).toEqual(["vikunja:8", "session:w1", "session:w3", "session:s9", "pr:acme/web#12"]);
    expect(filterBoard(b, NO_PROJECT).todo.map((c) => c.key)).toEqual(["routine:r4", "email:run1:e1", "note:inbox/today.md:3"]);
    expect(filterBoard(b, null)).toBe(b);
  });

  it("reads a note task's file and line, colons in the path included", () => {
    expect(noteRef("inbox/a:b.md:12")).toEqual({ file: "inbox/a:b.md", line: 12 });
    expect(noteRef("nope")).toBeNull();
  });
});

describe("the Board look", () => {
  const col = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}, \\d+$`) });
  const board = () => fireEvent.click(screen.getByRole("button", { name: "Board" }));

  it("Focus / Board switches the look and this browser remembers it", () => {
    render(<Home />);
    expect(screen.getByRole("button", { name: "Focus" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
    board();
    expect(screen.getByRole("region", { name: "Board" })).toBeTruthy();
    expect(localStorage.getItem("orb.homeView")).toBe("board");
    cleanup();
    render(<Home />);
    expect(screen.getByRole("region", { name: "Board" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(screen.queryByRole("region", { name: "Board" })).toBeNull();
    expect(localStorage.getItem("orb.homeView")).toBe("focus");
  });

  it("each column counts its cards and says so when it is empty", () => {
    render(<Home />);
    board();
    act(() => dispatch(plan({ next: task, up_next: [pr] })));
    expect(within(col("To do")).getByRole("article", { name: "Write the release notes" })).toBeTruthy();
    expect(col("In progress").getAttribute("aria-label")).toBe("In progress, 3");  // w1 waits, w3 and s9 work
    expect(within(col("Review")).getByRole("article", { name: "Add dark mode" })).toBeTruthy();
    expect(within(col("Done")).getByText("Nothing here")).toBeTruthy();
  });

  it("To do's buttons do what the Focus look's do", () => {
    render(<Home />);
    board();
    act(() => dispatch(plan({ next: task })));
    const card = within(col("To do")).getByRole("article", { name: "Write the release notes" });
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Start" }));
    expect(sent).toEqual([{ type: "item_start", source: "vikunja", id: "8" }, { type: "plan_start", key: "vikunja:8" }]);
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(sent).toEqual([{ type: "plan_done", key: "vikunja:8" }]);
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Later" }));
    expect(sent).toEqual([{ type: "plan_later", key: "vikunja:8" }]);
  });

  it("a started item opens again without being started twice; Done's Undo opens a done task again", () => {
    render(<Home />);
    board();
    act(() => dispatch(plan({ started: [task], done: [{ ...later, title: "Fixed login" }] })));
    const card = within(col("In progress")).getByRole("article", { name: "Write the release notes" });
    expect(within(card).getByText("STARTED")).toBeTruthy();
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Open" }));
    expect(sent).toEqual([{ type: "item_get", source: "vikunja", id: "8" }]);
    useViews.setState({ view: "home" });
    sent.length = 0;
    fireEvent.click(within(within(col("Done")).getByRole("article", { name: "Fixed login" })).getByRole("button", { name: "Undo" }));
    expect(sent).toEqual([{ type: "plan_done", key: "vikunja:9", undo: true }]);
  });

  it("a pull request waits in Review with Review and Leave it; a ready delegation offers Apply there", () => {
    render(<Home />);
    board();
    act(() => dispatch(plan({ next: pr })));
    act(() => dispatch({ type: "delegations", items: [deleg({ stage: "ready", line: "Ready: tests passed" })] }));
    const review = col("Review");
    sent.length = 0;
    fireEvent.click(within(within(review).getByRole("article", { name: "Add dark mode" })).getByRole("button", { name: "Leave it" }));
    expect(sent).toEqual([{ type: "plan_leave", key: "pr:acme/web#12" }]);
    const d = within(review).getByRole("article", { name: "Delegation of task #8" });
    fireEvent.click(within(d).getByRole("button", { name: "Apply" }));
    expect(within(d).getByRole("group", { name: "Apply" })).toBeTruthy();  // asks once, inline, on the card
  });

  it("a session waiting for an OK opens the session; the board never answers its card", () => {
    render(<Home />);
    board();
    const card = within(col("In progress")).getByRole("article", { name: "fix login" });
    expect(within(card).getByText("OK?")).toBeTruthy();
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Open session" }));
    expect(sent).toEqual([{ type: "open_folder", path: "/Users/a/code/web", session: "w1" }]);
  });

  it("an urgent email sits in To do with Done", () => {
    useViews.setState({ routines: routines({ items: [routine()], emails: [email] }) });
    render(<Home />);
    board();
    const card = within(col("To do")).getByRole("article", { name: email.text });
    expect(within(card).getByText("URGENT")).toBeTruthy();
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(sent[0]).toMatchObject({ key: "e1" });
  });

  it("each card names its project bottom right; the project filter keeps one project's cards and is remembered", () => {
    render(<Home />);
    board();
    act(() => dispatch(plan({ needs_you: [failed], next: task, up_next: [later] })));
    const card = within(col("To do")).getByRole("article", { name: "Write the release notes" });
    expect(card.querySelector(".kb-acts .kb-proj")?.textContent).toBe("web");
    expect(within(card).queryByText("acme")).toBeNull();  // the tracker's project chip gives way to the label
    const bar = screen.getByRole("group", { name: "Filter by project" });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["All6", "acme1", "web4", "Other1"]);
    fireEvent.click(within(bar).getByRole("button", { name: "web, 4" }));
    expect(col("To do").getAttribute("aria-label")).toBe("To do, 1");
    expect(col("In progress").getAttribute("aria-label")).toBe("In progress, 3");
    expect(localStorage.getItem("orb.boardProject")).toBe("web");
    cleanup();
    render(<Home />);
    act(() => dispatch(plan({ needs_you: [failed], next: task, up_next: [later] })));
    expect(col("To do").getAttribute("aria-label")).toBe("To do, 1");
    const again = screen.getByRole("group", { name: "Filter by project" });
    fireEvent.click(within(again).getByRole("button", { name: "Other, 1" }));
    expect(within(col("To do")).getByRole("article", { name: "Routine ‘Backup’ failed" })).toBeTruthy();
    expect(col("In progress").getAttribute("aria-label")).toBe("In progress, 0");
    fireEvent.click(within(again).getByRole("button", { name: "Other, 1" }));  // the same one again: all of them
    expect(col("To do").getAttribute("aria-label")).toBe("To do, 3");
    expect(localStorage.getItem("orb.boardProject")).toBeNull();
  });

  it("a filter on a project no card names any more shows everything", () => {
    localStorage.setItem("orb.boardProject", "gone");
    render(<Home />);
    board();
    act(() => dispatch(plan({ next: task })));
    expect(screen.getByRole("button", { name: /^All/ }).getAttribute("aria-pressed")).toBe("true");
    expect(col("To do").getAttribute("aria-label")).toBe("To do, 1");
  });

  it("a Needs you row is a To do card in the accent", () => {
    render(<Home />);
    board();
    act(() => dispatch(plan({ needs_you: [failed] })));
    const card = within(col("To do")).getByRole("article", { name: "Routine ‘Backup’ failed" });
    expect(card.className).toContain("needs");
    expect(within(card).getByText("ROUTINE")).toBeTruthy();
  });
});
