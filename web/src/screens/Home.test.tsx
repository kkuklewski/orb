// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DelegationItem, Features, HomeEvent, PlanEvent, PlanItem, ServerEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialMeta, useMeta } from "../stores/meta";
import { initialSession, useSession, wireSession } from "../stores/session";
import { initialSetup, useSetup, wireSetup } from "../stores/setup";
import { greeting, needsYou, routinesLine, useHome, wireHome } from "../stores/home";
import { useTasks, wireTasks } from "../stores/tasks";
import { initialDelegations, useDelegations, wireDelegations } from "../stores/delegation";
import { useBrain } from "../stores/brain";
import { useRoutineScreen } from "../stores/routine";
import { folder, routine, routines, session, status } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { Home } = await import("./Home");
const { Notes } = await import("./setup/steps");
const { TaskToast } = await import("./Task");
const { Sidebar } = await import("./Sidebar");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: true, stt: "browser", tts: "kokoro", vault: "/Users/a/notes", ...over,
});
const failed: PlanItem = { key: "routine:r4", kind: "routine", id: "r4", title: "Routine ‘Backup’ failed", reason: "Its last run failed.", source: "routine", actions: ["open"] };
const overdue: PlanItem = { key: "vikunja:7", kind: "task", id: "7", title: "Fix checkout", reason: "the client waits on checkout", source: "acme", due: "2026-10-20", priority: 2, actions: ["open"] };
const q = (kind: PlanItem["kind"], key: string, id: string, title: string, reason: string, over: Partial<PlanItem> = {}): PlanItem => ({ key, kind, id, title, reason, actions: ["start"], ...over });
const qTask = q("task", "vikunja:8", "8", "Write the release notes", "Due today.", { source: "acme", due: "2026-10-25", priority: 4, actions: ["start", "done", "later"] });
const qNote = q("note_task", "note:inbox/today.md:3", "inbox/today.md:3", "Send the invoice", "From your note ‘today’.", { source: "today", actions: ["start", "done", "later"] });
const qResult = q("result", "result:w2", "w2", "web: ship invoices", "Finished; the answer is ready to read.", { source: "web" });
const qPr = q("pr", "pr:acme/web#12", "acme/web#12", "Add dark mode", "Open pull request.", { source: "web" });
const qBatch = q("notes_batch", "notes:pending", "pending", "3 notes wait for a verdict", "Judge them in one pass, best first.", { source: "notes" });
const plan = (items: PlanItem[], over: Partial<PlanEvent> = {}): PlanEvent => ({ type: "plan", needs_you: items, ranked_at: null, stale: false, busy: false, error: null, ...over });
const notes = (over: Partial<HomeEvent> = {}): HomeEvent => ({
  type: "home", vault: "/Users/a/notes", open_tasks: 14, notes_week: 9,
  tasks: [{ text: "Send the invoice", file: "inbox/today.md", line: 3, mtime: 1, raw: "- [ ] Send the invoice" }], snoozed: 0,
  notes: [{ title: "Weekly review", file: "reviews/w43.md", mtime: Date.now() / 1000 - 3600 }], ...over,
});

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  offs = [wireSession(), wireHome(), wireSetup(), wireTasks(), wireDelegations()];
  useTasks.setState({ toast: null, next: null });
  useDelegations.setState(initialDelegations());
  useSession.setState(initialSession());
  useViews.setState({ view: "home", settings: null, routines: routines({ items: [routine({ last: { id: "r", outcome: "ok" } })] }), routinesNew: new Set() });
  useFeatures.setState({ features: features(), folders: [folder("web", [session("w1", "approval", { label: "fix login" })])], services: {}, build: null });
  useHome.setState({ notes: null, forget: null, tasks: null, plan: null, away: null });
  useSetup.setState(initialSetup);
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("home stays current", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000);
    offs.forEach((off) => off()); offs = [wireSession(), wireHome(), wireSetup()]; // wire again so the poll uses the fake clock
  });
  afterEach(() => vi.useRealTimers());

  it("a finished turn, a poll and returning to the tab refetch, at most once per burst; replays and other screens don't", () => {
    dispatch({ type: "result", replay: true });
    expect(sent).toEqual([]);
    dispatch({ type: "result" });
    expect(sent).toContainEqual({ type: "home" });
    sent.length = 0;
    dispatch({ type: "result" }); // same burst
    expect(sent).toEqual([]);
    vi.advanceTimersByTime(60_000); // the poll
    expect(sent).toContainEqual({ type: "home" });
    sent.length = 0;
    useViews.setState({ view: "chat" });
    vi.advanceTimersByTime(60_000);
    dispatch({ type: "result" });
    expect(sent).toEqual([]);
    useViews.setState({ view: "home" }); // back on Home
    expect(sent).toContainEqual({ type: "home" });
  });
});

describe("home helpers", () => {
  it("greets by the hour", () => {
    expect([3, 9, 14, 21].map(greeting)).toEqual(["Working late.", "Good morning.", "Good afternoon.", "Good evening."]);
  });
  it("needs you: live sessions by status, the plan's rows as the server sent them", () => {
    const n = needsYou([folder("web", [session("a", "approval"), session("b", "working"), session("c", "idle")])], plan([overdue]));
    expect([n.waiting.length, n.working.length, n.done.length, n.items.map((x) => x.key)]).toEqual([1, 1, 0, ["vikunja:7"]]);
    expect(needsYou([]).items).toEqual([]);
  });
  it("routines line: ok, needing you, the next run", () => {
    const r = routines({ needs: 1, items: [routine({ last: { id: "1", outcome: "ok" }, next_run_at: 200 }), routine({ id: "b", name: "inbox", needs: "failed", next_run_at: 100 })] });
    expect(routinesLine(r, (ts) => `@${ts}`)).toBe("1 ok · 1 needs you · next: inbox @100");
    expect(routinesLine(null, String)).toBe("checking…");
  });
});

describe("away recap", () => {
  const recap = (heading = "While you were away · 2 days", back: number | null = 1) => ({ type: "away_recap", recap: { since: 0, back, heading } } as ServerEvent);
  const card = () => screen.queryByRole("article", { name: "Away recap" });

  it("shows only after the server says so, first on Home, with the top 3 of Needs you in today's order and the total", () => {
    const due: PlanItem = { key: "rem:1", kind: "reminder", id: "1", title: "Renew the domain", reason: "Due in 2 days.", source: "notes", actions: ["open"] };
    render(<Home />);
    act(() => dispatch(plan([failed, overdue, due])));
    expect(card()).toBeNull();
    act(() => dispatch(recap()));
    const c = card()!;
    expect(within(c).getByText("While you were away · 2 days")).toBeTruthy();
    const rows = within(c).getAllByRole("button").filter((b) => b.classList.contains("needs-row"));
    expect(rows.map((r) => r.querySelector(".needs-title")!.textContent)).toEqual(["web: fix login", failed.title, overdue.title]);
    expect(within(c).getByText("Needs you: 3 of 4")).toBeTruthy();
    expect(document.querySelector(".home-main")!.firstElementChild).toBe(c);
    expect(c.querySelector(".badge, [class*=badge]")).toBeNull();
  });

  it("lists the routines that ran ok, ×N when more than once, then N more; a line opens that routine's Run", () => {
    render(<Home />);
    const lines = [{ kind: "routine", id: "t1", title: "Curation", summary: "3 created, 1 merged", count: 2 },
      { kind: "routine", id: "t2", title: "Radar", summary: "5 drafts", count: 1 }];
    act(() => dispatch({ type: "away_recap", recap: { since: 0, back: 1, heading: "While you were away · 2 days", lines, more: 4 } } as ServerEvent));
    const list = within(card()!).getByLabelText("What ran and finished");
    const rows = within(list).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["ROUTINECuration3 created, 1 merged×2", "ROUTINERadar5 drafts"]);
    expect(within(list).getByText("4 more")).toBeTruthy();
    fireEvent.click(rows[0]);
    expect(useViews.getState().view).toBe("routine");
    expect(useRoutineScreen.getState().id).toBe("t1");
    expect(sent).toContainEqual({ type: "away_seen" });
  });

  it("then Orb's own lines: Finished opens Sessions, Ready goes to the Delegated strip; no ×N on them", () => {
    render(<Home />);
    const lines = [{ kind: "routine", id: "t1", title: "Curation", summary: "ok", count: 1 },
      { kind: "finished", id: "finished", title: "2 sessions finished", summary: "", count: 2 },
      { kind: "ready", id: "ready", title: "1 delegation Ready", summary: "", count: 1 },
      { kind: "archived", id: "archived", title: "4 old sessions archived", summary: "", count: 4 }];
    act(() => dispatch({ type: "away_recap", recap: { since: 0, back: 1, heading: "While you were away · 2 days", lines, more: 0 } } as ServerEvent));
    const rows = within(within(card()!).getByLabelText("What ran and finished")).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["ROUTINECurationok", "FINISHED2 sessions finished", "READY1 delegation Ready",
      "ARCHIVED4 old sessions archived"]);
    fireEvent.click(rows[2]);
    expect(sent).toContainEqual({ type: "away_seen" });
    expect(useViews.getState().view).toBe("home");
    act(() => dispatch({ type: "away_recap", recap: { since: 0, back: 1, heading: "While you were away · 2 days", lines, more: 0 } } as ServerEvent));
    fireEvent.click(within(card()!).getByText("2 sessions finished"));
    expect(useViews.getState().view).toBe("sessions");
  });

  it("an expired line sits with Orb's lines and opens Brain's Expired view", () => {
    render(<Home />);
    const lines = [{ kind: "routine", id: "t1", title: "Curation", summary: "ok", count: 1 },
      { kind: "expired", id: "expired", title: "2 pages expired", summary: "", count: 2 },
      { kind: "finished", id: "finished", title: "1 session finished", summary: "", count: 1 }];
    act(() => dispatch({ type: "away_recap", recap: { since: 0, back: 1, heading: "While you were away · 2 days", lines, more: 0 } } as ServerEvent));
    const rows = within(within(card()!).getByLabelText("What ran and finished")).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["ROUTINECurationok", "EXPIRED2 pages expired", "FINISHED1 session finished"]);
    fireEvent.click(rows[1]);
    expect(sent).toContainEqual({ type: "away_seen" });
    expect(useViews.getState().view).toBe("brain");
    expect(useBrain.getState().showExpired).toBe(true);
  });

  it("nothing needs you: says so", () => {
    useFeatures.setState({ folders: [] });
    render(<Home />);
    act(() => dispatch(recap("While you were away · 30 hours", null)));
    expect(within(card()!).getByText("Nothing needs you.")).toBeTruthy();
  });

  it("one-shot: Close sends away_seen and hides it; another page's away_seen (a null recap) hides it too", () => {
    render(<Home />);
    act(() => dispatch(recap()));
    fireEvent.click(within(card()!).getByRole("button", { name: "Close" }));
    expect(sent).toContainEqual({ type: "away_seen" });
    expect(card()).toBeNull();
    act(() => dispatch(recap()));
    act(() => dispatch({ type: "away_recap", recap: null }));
    expect(card()).toBeNull();
  });

  it("leaving Home while it shows counts as seen; leaving without it sends nothing", () => {
    render(<Home />);
    act(() => useViews.setState({ view: "chat" }));
    expect(sent).not.toContainEqual({ type: "away_seen" });
    act(() => useViews.setState({ view: "home" }));
    act(() => dispatch(recap()));
    fireEvent.click(within(card()!).getAllByRole("button").find((b) => b.textContent?.includes("fix login"))!);  // opens the session
    expect(sent).toContainEqual({ type: "away_seen" });
    expect(useHome.getState().away).toBeNull();
  });
});

describe("home screen", () => {
  it("Needs you lists the OK first, then the plan's rows with their reason, and can re-rank", () => {
    render(<Home />);
    act(() => dispatch(plan([failed, overdue], { ranked_at: Date.now() / 1000 - 60 })));
    const strip = screen.getByRole("article", { name: "3 things need you" });
    const rows = within(strip).getAllByRole("button").filter((b) => b.classList.contains("needs-row"));
    expect(rows.map((r) => r.querySelector(".needs-title")?.textContent)).toEqual(["web: fix login", "Routine ‘Backup’ failed", "Fix checkout"]);
    expect(rows[2].textContent).toContain("the client waits on checkout");
    expect(strip.textContent).toContain("ranked 1m ago");
    expect(within(strip).queryByRole("button", { name: /^(Allow|Deny)/ })).toBeNull();
    sent.length = 0;
    fireEvent.click(within(strip).getByRole("button", { name: "Re-rank" }));
    expect(sent).toEqual([{ type: "home", rerank: true }]);
  });

  it("a Needs you row opens what it is about: the session, the routine, the task", () => {
    render(<Home />);
    act(() => dispatch(plan([failed, overdue], { stale: true })));
    const strip = screen.getByRole("article", { name: "3 things need you" });
    expect(strip.textContent).toContain("rule order");
    sent.length = 0;
    fireEvent.click(within(strip).getByText("web: fix login"));
    expect(sent).toEqual([{ type: "open_folder", path: "/Users/a/code/web", session: "w1" }]);
    fireEvent.click(within(strip).getByText("Routine ‘Backup’ failed"));
    expect(useViews.getState().view).toBe("routine");
    fireEvent.click(within(strip).getByText("Fix checkout"));
    expect(useViews.getState().view).toBe("item");
    expect(sent).toContainEqual({ type: "item_get", source: "vikunja", id: "7" });
  });

  it("a routine in a failure streak offers Make it a task first, which opens the routine with its card", () => {
    const streak: PlanItem = { key: "routine:acme-sync", kind: "routine", id: "acme-sync", title: "Routine ‘acme-sync’ failed",
      reason: "3 failed runs in a row since 2026-10-24", source: "routine", actions: ["make_task", "open"] };
    const once: PlanItem = { ...failed, key: "routine:globex-digest", id: "globex-digest", title: "Routine ‘globex-digest’ failed" };
    render(<Home />);
    act(() => dispatch(plan([streak, once])));
    const strip = screen.getByRole("article", { name: "3 things need you" });
    const row = within(strip).getByRole("group", { name: "Routine ‘acme-sync’ failed" });
    expect(row.textContent).toContain("3 failed runs in a row since 2026-10-24");
    expect(within(row).getAllByRole("button").filter((b) => b.classList.contains("hbtn")).map((b) => b.textContent)).toEqual(["Make it a task"]);
    expect(within(strip).queryByRole("group", { name: "Routine ‘globex-digest’ failed" })).toBeNull();  // no streak: a plain row
    expect(within(strip).getAllByRole("button", { name: "Make it a task" })).toHaveLength(1);
    sent.length = 0;
    fireEvent.click(within(row).getByRole("button", { name: "Make it a task" }));
    expect(useViews.getState().view).toBe("routine");
    expect(useRoutineScreen.getState().id).toBe("acme-sync");
    expect(sent).toContainEqual({ type: "make_task", routine: "acme-sync" });
  });

  it("a routine whose Repair task is open names Task #N with its link and opens the routine, with no Make it a task", () => {
    const open: PlanItem = { key: "routine:acme-sync", kind: "routine", id: "acme-sync", title: "Routine ‘acme-sync’ failed",
      reason: "3 failed runs in a row since 2026-10-24 · Task #42", source: "routine", actions: ["open"], repair: 42, url: "https://tasks.example/tasks/42" };
    const unread: PlanItem = { ...open, key: "routine:globex-digest", id: "globex-digest", title: "Routine ‘globex-digest’ failed",
      reason: "Its last run failed · Task #7", repair: 7, url: null };
    render(<Home />);
    act(() => dispatch(plan([open, unread])));
    const strip = screen.getByRole("article", { name: "3 things need you" });
    const row = within(strip).getByRole("group", { name: "Routine ‘acme-sync’ failed" });
    expect(row.textContent).toContain("3 failed runs in a row since 2026-10-24 · Task #42");
    const link = within(row).getByRole("link", { name: "Task #42" });
    expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual(["https://tasks.example/tasks/42", "_blank", "noopener noreferrer"]);
    expect(within(strip).queryByRole("button", { name: "Make it a task" })).toBeNull();
    const other = within(strip).getByRole("group", { name: "Routine ‘globex-digest’ failed" });
    expect(within(other).queryByRole("link")).toBeNull();  // the tracker didn't answer: the number only
    expect(other.textContent).toContain("Task #7");
    sent.length = 0;
    fireEvent.click(within(row).getByText("Routine ‘acme-sync’ failed"));
    expect(useViews.getState().view).toBe("routine");
    expect(useRoutineScreen.getState().id).toBe("acme-sync");
    expect(sent).not.toContainEqual({ type: "make_task", routine: "acme-sync" });
  });

  it("a broken setup opens Settings at its section; a reminder due opens its link, or is just a line without one", () => {
    const signedOut: PlanItem = { key: "setup:claude", kind: "setup", id: "claude", title: "Claude Code is signed out", reason: "No session can run until you sign in again.", source: "setup", actions: ["open"] };
    const renew: PlanItem = { key: "reminder:2026-10-25:Renew", kind: "reminder", id: "2026-10-25", title: "Renew acme.example", reason: "Due today.", source: "reminder", due: "2026-10-25", url: "https://registrar.example/acme", actions: ["open"] };
    const call: PlanItem = { key: "reminder:2026-10-24:Call", kind: "reminder", id: "2026-10-24", title: "Call globex", reason: "Was due yesterday.", source: "reminder", due: "2026-10-24", actions: [] };
    render(<Home />);
    act(() => dispatch(plan([signedOut, renew, call], { stale: true })));
    const strip = screen.getByRole("article", { name: "4 things need you" });
    expect([...strip.querySelectorAll(".needs-tag")].map((t) => t.textContent)).toEqual(["OK?", "SETUP", "DUE", "DUE"]);
    const link = within(strip).getByRole("link", { name: /Renew acme.example/ });
    expect([link.getAttribute("href"), link.getAttribute("target"), link.getAttribute("rel")]).toEqual(["https://registrar.example/acme", "_blank", "noopener noreferrer"]);
    expect(within(strip).queryByRole("button", { name: /Call globex/ })).toBeNull();
    expect(strip.textContent).toContain("Was due yesterday.");
    fireEvent.click(within(strip).getByRole("button", { name: /Claude Code is signed out/ }));
    expect(useViews.getState()).toMatchObject({ view: "settings", settingsAt: "claude" });
  });

  it("a vault conflict is a red VAULT row whose Open goes to the notes folder, with nothing typed", () => {
    const vault: PlanItem = { key: "vault:conflict", kind: "vault", id: "vault", title: "Vault: behind 1, ahead 1, 1 conflict · fetched 28 Oct", reason: "Orb writes no notes until it's resolved", source: "vault", actions: ["open"], urgent: true };
    render(<Home />);
    act(() => dispatch(plan([vault], { stale: true })));
    const strip = screen.getByRole("article", { name: "2 things need you" });
    const tag = [...strip.querySelectorAll(".needs-tag")].at(-1)!;
    expect([tag.textContent, tag.classList.contains("urgent")]).toEqual(["VAULT", true]);
    expect(strip.textContent).toContain("Orb writes no notes until it's resolved");
    fireEvent.click(within(strip).getByRole("button", { name: /Vault: behind 1, ahead 1, 1 conflict/ }));
    expect(sent.at(-1)).toEqual({ type: "open_folder", path: "/Users/a/notes", session: undefined });
    expect(useSession.getState().pendingAsk).toBeFalsy();
  });

  it("only an urgent row's tag is red; the others stay grey", () => {
    render(<Home />);
    act(() => dispatch(plan([{ ...failed, urgent: true }, overdue], { stale: true })));
    const strip = screen.getByRole("article", { name: "3 things need you" });
    const tags = [...strip.querySelectorAll(".needs-tag")];
    expect(tags.map((t) => [t.textContent, t.classList.contains("urgent")])).toEqual([["OK?", false], ["ROUTINE", true], ["OVERDUE", false]]);
  });

  it("a pinned row says its class word in the side column, lowercase and in the column's grey", () => {
    const signedOut: PlanItem = { key: "setup:claude", kind: "setup", id: "claude", title: "Claude Code is signed out", reason: "Sign in again.", source: "setup", actions: ["open"], urgent: true, pin: "security" };
    render(<Home />);
    act(() => dispatch(plan([signedOut, { ...overdue, pin: "client" }, { ...overdue, key: "vikunja:9", id: "9", title: "Send invoice" }], { stale: true })));
    const strip = screen.getByRole("article", { name: "4 things need you" });
    const sides = [...strip.querySelectorAll(".needs-side")];
    expect(sides.map((x) => x.textContent)).toEqual(["now", "security", "client", "2026-10-20"]);
    expect(sides.map((x) => x.className)).toEqual(Array(4).fill("needs-side mono"));  // no colour of its own
    expect([...strip.querySelectorAll(".needs-tag")].map((t) => t.classList.contains("urgent"))).toEqual([false, true, false, false]);
  });

  it("an overdue task with a pin label says money in the side column, pinned like client", () => {
    render(<Home />);
    act(() => dispatch(plan([{ ...overdue, pin: "money", urgent: true }, { ...overdue, key: "vikunja:9", id: "9", title: "Send invoice", source: "globex" }])));
    const strip = screen.getByRole("article", { name: "3 things need you" });  // the waiting session's row first
    expect([...strip.querySelectorAll(".needs-side")].map((x) => x.textContent)).toEqual(["now", "money", "2026-10-20"]);
    expect([...strip.querySelectorAll(".needs-tag")].map((t) => t.classList.contains("urgent"))).toEqual([false, true, false]);  // red at 48h past due
  });

  it("Needs you is hidden when nothing needs you, and says when ranking failed", () => {
    useFeatures.setState({ folders: [folder("web", [session("w3", "done", { label: "read the logs" })])] });
    render(<Home />);
    expect(screen.queryByRole("article", { name: /need/ })).toBeNull();
    act(() => dispatch(plan([overdue], { stale: true, error: "Couldn't rank: down" })));
    const strip = screen.getByRole("article", { name: "1 thing needs you" });
    expect(strip.textContent).toContain("Couldn't rank: down Rule order.");
  });

  it("asks for the notes summary and the routines when it opens", () => {
    render(<Home />);
    expect(sent).toEqual([{ type: "home" }, { type: "routines" }]);
  });

  it("the Next action is the plan's first item, big, with Up next under it; a row click brings one up", () => {
    render(<Home />);
    act(() => dispatch(plan([], { next: qTask, up_next: [qNote, qResult] })));
    const lead = screen.getByRole("article", { name: "Next action" });
    const head = () => within(lead).getByRole("heading", { level: 2 }).textContent;
    expect(head()).toBe("Write the release notes");
    expect(lead.textContent).toContain("NEXT ACTION · TASK · ACME · 2026-10-25");
    expect(lead.textContent).toContain("Due today.");
    const upNext = within(lead).getByLabelText("Up next");
    expect(within(upNext).getAllByRole("button").map((b) => b.querySelector(".lead-row-text")?.textContent)).toEqual(["Send the invoice", "web: ship invoices"]);
    expect(within(lead).queryByText(/fix login/)).toBeNull();  // an OK is in Needs you, not here
    fireEvent.click(within(upNext).getByRole("button", { name: /ship invoices/ }));
    expect(head()).toBe("web: ship invoices");
    expect(within(lead).getByRole("button", { name: /^Read the answer/ })).toBeTruthy();
    fireEvent.click(within(lead).getByRole("button", { name: /Write the release notes/ }));
    expect(head()).toBe("Write the release notes");
  });

  it("Later (button or S) asks the server to hide the lead until tomorrow; the plan it sends back shows the next one", () => {
    render(<Home />);
    act(() => dispatch(plan([], { next: qTask, up_next: [qNote, qResult] })));
    const lead = screen.getByRole("article", { name: "Next action" });
    const head = () => within(lead).getByRole("heading", { level: 2 }).textContent;
    sent.length = 0;
    fireEvent.click(within(lead).getByRole("button", { name: /^Later/ }));
    expect(sent).toEqual([{ type: "plan_later", key: "vikunja:8" }]);
    expect(head()).toBe("Write the release notes");  // nothing local: the server's plan decides
    act(() => dispatch(plan([], { next: qNote, up_next: [qResult] })));
    expect(head()).toBe("Send the invoice");
    sent.length = 0;
    fireEvent.keyDown(window, { key: "s" });
    expect(sent).toEqual([{ type: "plan_later", key: "note:inbox/today.md:3" }]);
    act(() => dispatch(plan([], { next: qResult, up_next: [] })));
    fireEvent.click(within(lead).getByRole("button", { name: /^Later/ }));  // even the last item can wait
    expect(sent.at(-1)).toEqual({ type: "plan_later", key: "result:w2" });
  });

  it("Done is offered only on tasks: a Vikunja task is written done with Undo, a notes task is ticked", () => {
    render(<><Home /><TaskToast /></>);
    const lead = () => screen.getByRole("article", { name: "Next action" });
    for (const item of [qResult, qPr, qBatch]) {
      act(() => dispatch(plan([], { next: item, up_next: [] })));
      expect(within(lead()).queryByRole("button", { name: /^Done/ })).toBeNull();
    }
    act(() => dispatch(plan([], { next: qTask, up_next: [qNote] })));
    sent.length = 0;
    fireEvent.click(within(lead()).getByRole("button", { name: /^Done/ }));
    expect(sent).toEqual([{ type: "plan_done", key: "vikunja:8" }]);
    const bar = screen.getByRole("status");
    expect(bar.textContent).toContain("Done: Write the release notes");
    fireEvent.click(within(bar).getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "plan_done", key: "vikunja:8", undo: true });
    expect(screen.queryByRole("status")).toBeNull();
    act(() => dispatch(plan([], { next: qNote, up_next: [] })));
    sent.length = 0;
    fireEvent.click(within(lead()).getByRole("button", { name: /^Done/ }));
    expect(sent).toEqual([{ type: "plan_done", key: "note:inbox/today.md:3" }]);
    act(() => dispatch({ type: "task_changed", file: "inbox/today.md", line: 3, action: "done", raw: "- [x] Send the invoice ✅ 2026-10-25", previous: "- [ ] Send the invoice" }));
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "task_action", file: "inbox/today.md", line: 3, expect: "- [x] Send the invoice ✅ 2026-10-25", action: "restore", value: "- [ ] Send the invoice" });
  });

  it("keys: J K select a row of Up next, Enter S D act on it (or on the lead); not while typing or with a task open beside Home", () => {
    render(<><Home /><input aria-label="typing" /></>);
    act(() => dispatch(plan([], { next: qTask, up_next: [qNote, qResult, qPr] })));
    const rows = () => within(screen.getByLabelText("Up next")).getAllByRole("button");
    const selected = () => rows().filter((r) => r.getAttribute("aria-current")).map((r) => r.textContent);
    const key = (k: string, el: Element | Window = window) => { sent.length = 0; fireEvent.keyDown(el, { key: k }); return [...sent]; };
    expect(key("d")).toEqual([{ type: "plan_done", key: "vikunja:8" }]);  // no row selected: D is the lead's Done
    expect(key("j")).toEqual([]);
    expect(selected()).toEqual([expect.stringContaining("Send the invoice")]);
    key("j"); key("j"); key("j");  // stops at the last row
    expect(selected()).toEqual([expect.stringContaining("Add dark mode")]);
    key("k");
    expect(selected()).toEqual([expect.stringContaining("web: ship invoices")]);
    expect(key("d")).toEqual([]);  // a result can't be done
    expect(key("s")).toEqual([{ type: "plan_later", key: "result:w2" }]);
    expect(selected()).toEqual([expect.stringContaining("Add dark mode")]);  // its neighbour is selected
    expect(key("Enter")).toEqual([{ type: "item_get", source: "prs", id: "acme/web#12" }, { type: "plan_start", key: "pr:acme/web#12" }]);
    useViews.setState({ view: "home" });
    key("k"); key("k"); key("k");
    expect(selected()).toEqual([]);  // back on the lead
    expect(key("Enter")).toEqual([{ type: "item_start", source: "vikunja", id: "8" }, { type: "plan_start", key: "vikunja:8" }]);
    useViews.setState({ view: "home" });
    expect(key("s", screen.getByLabelText("typing"))).toEqual([]);
    expect(key("d", screen.getByLabelText("typing"))).toEqual([]);
    act(() => useViews.setState({ view: "task" }));
    expect(key("d")).toEqual([]);  // the task beside Home owns D
    expect(key("r")).toEqual([]);  // the old tab keys are gone
  });

  it("Start does the right thing for every kind", () => {
    useFeatures.setState({ folders: [folder("web", [session("w2", "done", { label: "ship invoices" })])] });
    render(<Home />);
    const start = (item: PlanItem) => {
      act(() => dispatch(plan([], { next: item, up_next: [] })));
      sent.length = 0;
      fireEvent.click(screen.getByRole("article", { name: "Next action" }).querySelector<HTMLButtonElement>(".lead-go")!);
      return [...sent];
    };
    expect(start(qTask)).toEqual([{ type: "item_start", source: "vikunja", id: "8" }, { type: "plan_start", key: "vikunja:8" }]);
    expect(start(qPr)).toEqual([{ type: "item_get", source: "prs", id: "acme/web#12" }, { type: "plan_start", key: "pr:acme/web#12" }]);
    expect(useViews.getState().view).toBe("item");
    useViews.setState({ view: "home" });
    expect(start(qBatch)).toEqual([{ type: "brain_list" }]);
    expect(useViews.getState().view).toBe("brain");
    useViews.setState({ view: "home" });
    expect(start(qResult)).toEqual([{ type: "open_folder", path: "/Users/a/code/web", session: "w2" }]);
    expect(start(qNote)).toEqual([{ type: "start_session", path: "/Users/a/notes" }, { type: "plan_start", key: "note:inbox/today.md:3" }]);
    expect(useSession.getState().pendingAsk).toBe("Help me get this task from my note \"inbox/today.md\" done: Send the invoice");
  });

  it("the no-topic item opens Brain's No topic view (ticket 820)", () => {
    const qNt = q("notopic", "notes:notopic", "notopic", "3 captures have no topic", "Keep, drop or sort them one at a time.", { source: "notes" });
    render(<Home />);
    act(() => dispatch(plan([], { next: qNt })));
    const lead = screen.getByRole("article", { name: "Next action" });
    expect(lead.textContent).toContain("NEXT ACTION · NOTES");
    fireEvent.click(within(lead).getByRole("button", { name: /^Sort them/ }));
    expect(useViews.getState().view).toBe("brain");
    expect(useBrain.getState().showNoTopic).toBe(true);
  });

  it("the kind says what Start does: Review a pull request, Judge the notes", () => {
    render(<Home />);
    act(() => dispatch(plan([], { next: qPr, up_next: [qBatch] })));
    const lead = screen.getByRole("article", { name: "Next action" });
    expect(within(lead).getByRole("button", { name: /^Review/ })).toBeTruthy();
    fireEvent.click(within(within(lead).getByLabelText("Up next")).getByRole("button"));
    expect(within(lead).getByRole("button", { name: /^Judge them/ })).toBeTruthy();
    expect(lead.textContent).toContain("NEXT ACTION · NOTES");
    sent.length = 0;
    fireEvent.click(within(lead).getByRole("button", { name: /^Judge them/ }));
    expect(useViews.getState().view).toBe("brain"); // triage happens in Brain's list, grouped by suggestion (ADR 0006)
    expect(useBrain.getState().filter.waiting).toBe(true);
    expect(sent).toContainEqual({ type: "brain_list" });
  });

  it("the Tasks and Notes cards are gone; All N links reach the full lists", () => {
    render(<Home />);
    act(() => dispatch(notes({ awaiting_count: 3 }) as ServerEvent));
    expect(screen.queryByRole("article", { name: /open task/ })).toBeNull();
    expect(screen.queryByText("Weekly review")).toBeNull();
    const lead = screen.getByRole("article", { name: "Nothing else queued" });
    sent.length = 0;
    fireEvent.click(within(lead).getByRole("button", { name: "All 14 tasks →" }));
    expect(sent).toEqual([{ type: "item_list", source: "tasks" }]);
    fireEvent.click(within(lead).getByRole("button", { name: "All 3 notes →" }));
    expect(sent.at(-1)).toEqual({ type: "item_list", source: "notes" });
    act(() => useHome.setState({ tasks: { type: "home_tasks", tasks: [], total: 22, url: "http://v", error: null } }));
    fireEvent.click(within(lead).getByRole("button", { name: "All 22 tasks →" }));
    expect(sent.at(-1)).toEqual({ type: "item_list", source: "vikunja" });
  });

  it("when Vikunja is set up but down, the empty Next action says so", () => {
    render(<Home />);
    act(() => useHome.setState({ tasks: { type: "home_tasks", tasks: [], total: 0, url: null, error: "Vikunja not reachable: didn't answer: timed out" } }));
    expect(within(screen.getByRole("article", { name: "Nothing else queued" })).getByText("Vikunja not reachable: didn't answer: timed out")).toBeTruthy();
  });

  it("an empty queue is one line: Nothing waiting with New session, or Nothing else queued under Needs you", () => {
    useFeatures.setState({ folders: [folder("web")] });
    render(<Home />);
    expect(screen.queryByRole("article", { name: /needs you/ })).toBeNull();
    const empty = screen.getByRole("article", { name: "Nothing waiting" });
    expect(screen.queryByRole("article", { name: "Next action" })).toBeNull();
    fireEvent.click(within(empty).getByRole("button", { name: /^New session/ }));
    expect(useSession.getState().picker).toBe("new");
    act(() => useFeatures.setState({ folders: [folder("web", [session("w1", "approval", { label: "fix login" })])] }));
    expect(screen.getByRole("article", { name: "Nothing else queued" })).toBeTruthy();
    act(() => dispatch(plan([], { next: qTask })));
    expect(screen.queryByRole("article", { name: /^Nothing/ })).toBeNull();
    expect(screen.getByRole("article", { name: "Next action" })).toBeTruthy();
  });

  it("the header keeps ⌘K and drops “Ask for today's plan”; the status card says how many notes changed this week", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    expect(screen.queryByRole("button", { name: /Ask for today's plan/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Search or jump/ }));
    expect(useSession.getState().picker).toBe("new");
    expect(document.getElementById("status")?.textContent).toContain("9 notes changed this week");
    act(() => dispatch(notes({ notes_week: 1 }) as ServerEvent));
    expect(document.getElementById("status")?.textContent).toContain("1 note changed this week");
  });

  it("Needs you's Ask about this sends its question in the notes folder, with its rows as the screen", () => {
    render(<Home />);
    fireEvent.click(within(screen.getByRole("article", { name: "1 thing needs you" })).getByRole("button", { name: "Ask about this →" }));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/Users/a/notes" });
    const p = useSession.getState();
    expect(p.pendingAsk).toMatch(/what needs me first/i);
    expect(p.pendingScreen).toMatchObject({ name: "Needs you", text: expect.stringContaining("web: fix login") });
    expect(p.pendingStay).toBe(true);
  });

  it("without a notes folder it offers to connect one", () => {
    useFeatures.setState((s) => ({ features: { ...s.features!, vault: "" } }));
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Choose notes folder" }));
    expect(useSetup.getState()).toMatchObject({ open: true, step: 3 });
    expect(screen.queryByRole("button", { name: "Ask for today's plan →" })).toBeNull();
  });
});

describe("routine results on Home", () => {
  it("the routines card lists only the results worth reading", () => {
    useViews.setState({ routines: routines({ items: [
      routine({ id: "a", name: "Gmail cleanup", new: true, loud: true, worth: "read", last: { id: "r1", outcome: "ok" } }),
      routine({ id: "b", name: "Etihad check", quiet: true, worth: "skip", last: { id: "r2", outcome: "ok" } }),
    ] }) });
    render(<Home />);
    expect(screen.getByText("Gmail cleanup")).toBeTruthy();
    expect(screen.queryByText("Etihad check")).toBeNull();
  });
});

describe("usage warning", () => {
  const low = { five_hour: { utilization: 0.9, resetsAt: Date.now() / 1000 + 3600 } };
  it("appears under 15% and offers Haiku for the open folder", () => {
    useMeta.setState({ ...initialMeta(), windows: {} });
    const { rerender } = render(<Home />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => useMeta.setState({ windows: low }));
    rerender(<Home />);
    expect(screen.getByRole("alert").textContent).toContain("Session 10% left");
    act(() => useSession.setState({ folder: "/Users/a/code/web" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Haiku here" }));
    expect(sent.at(-1)).toEqual({ type: "set_model", model: "haiku" });
  });

  it("with no folder open it offers Haiku for new folders; on Haiku already, no button", () => {
    useMeta.setState({ ...initialMeta(), windows: low });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Haiku for new folders" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { default_model: "haiku" } });
    act(() => useMeta.setState({ front: "haiku" }));
    expect(screen.queryByRole("button", { name: /Haiku/ })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("already uses Haiku");
  });
});

describe("start-up", () => {
  it("reopens the last session quietly: Home stays, a request switches to the chat", () => {
    localStorage.setItem("vd-folder", "/Users/a/code/web");
    localStorage.setItem("vd-session", "w1");
    act(() => dispatch({ type: "hello", build: "x", folders: [folder("web")], services: {}, ...features() } as unknown as ServerEvent));
    expect(sent).toContainEqual({ type: "open_folder", path: "/Users/a/code/web", session: "w1" });
    act(() => dispatch({ type: "opened", folder: "/Users/a/code/web", session: "w1", label: "web", rel: "web", branch: null, session_id: null,
      live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    expect(useViews.getState().view).toBe("home");
    act(() => dispatch({ type: "user", id: "u1", text: "hi", source: "voice", session: "w1" }));
    expect(useViews.getState().view).toBe("chat");
  });
});

describe("setup: notes step", () => {
  it("shows the chosen folder with what's in it, and chooses by path or Finder", () => {
    useSetup.setState({ open: true, step: 3, status: status({ vault: { path: "/Users/a/notes", exists: true, notes: 359, open_tasks: 31 } }) });
    render(<Notes />);
    expect(screen.getByText("359 notes · 31 open tasks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notes folder path"), { target: { value: "~/Brain" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { vault: "/Users/a/Brain" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose in Finder…" }));
    expect(sent.at(-1)).toEqual({ type: "pick_folder" });
    act(() => dispatch({ type: "picked", path: "/Users/a/Vault" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { vault: "/Users/a/Vault" } });
  });

  it("is optional: Skip for now", () => {
    useSetup.setState({ open: true, step: 3, status: status() });
    render(<Notes />);
    expect(screen.getByText(/This step is optional/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Skip for now" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Item pages", () => {
  const detail = { type: "item", source: "vikunja", id: "7", title: "Fix the login", kicker: "VIKUNJA", chips: ["acme"], body: "Users get logged out.\n\n**bold** step",
    url: "http://v/tasks/7", url_label: "Open in Vikunja →", repo: "acme/web", brief: "Help me with a task…", done: false, can_archive: true } as const;

  it("a task opens its page; Start in Orb sends only the source and id; Copy prompt copies the brief", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { ItemPage } = await import("./ItemPage");
    const off = (await import("../stores/items")).wireItems();
    render(<Home />);
    act(() => dispatch(plan([overdue], { next: qTask, up_next: [] })));
    fireEvent.click(screen.getByText("Fix checkout"));
    expect(sent.at(-1)).toEqual({ type: "item_get", source: "vikunja", id: "7" });
    expect(useViews.getState().view).toBe("item");
    cleanup();
    render(<ItemPage />);
    act(() => dispatch(detail as unknown as ServerEvent));
    expect(screen.getByText("Users get logged out.")).toBeTruthy();
    expect(document.querySelector(".vk-desc strong")?.textContent).toBe("bold");
    fireEvent.click(screen.getByRole("button", { name: "Start in Orb · acme/web" }));
    expect(sent.at(-1)).toEqual({ type: "item_start", source: "vikunja", id: "7" });
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith("Help me with a task…");
    act(() => dispatch({ ...detail, repo: null } as unknown as ServerEvent));
    fireEvent.click(screen.getByRole("button", { name: "Start in Orb · Home chat" }));  // no repo: the server starts it in the notes folder
    expect(sent.at(-1)).toEqual({ type: "item_start", source: "vikunja", id: "7" });
    act(() => useFeatures.setState((s) => ({ features: { ...s.features!, vault: "" } })));
    expect((screen.getByRole("button", { name: "Start in Orb" }) as HTMLButtonElement).disabled).toBe(false);
    off();
  });
});

describe("Item table", () => {
  const col = (key: string, label: string, kind = "text") => ({ key, label, kind });
  const row = (id: string, title: string, repo: string | null, priority = 0) => ({ id, title, repo, hot: priority >= 4, cells: { project: "acme", due: "", priority: String(priority) } });
  const list = (rows: ReturnType<typeof row>[]) => ({ type: "item_list", source: "vikunja", kicker: "VIKUNJA", heading: `${rows.length} open tasks`, rows,
    columns: [col("title", "Task", "title"), col("repo", "Repo", "repo"), col("project", "Project", "chip"), col("due", "Due", "due"), col("priority", "Priority", "priority")],
    group_key: "repo", can_archive: true, url: "http://v", url_label: "OPEN VIKUNJA →" }) as unknown as ServerEvent;
  const setup = async (source: "vikunja" | "prs" | "repos" = "vikunja") => {
    const { ItemList } = await import("./ItemList");
    const items = await import("../stores/items");
    const off = items.wireItems();
    items.useItems.setState({ source, lists: {} });
    render(<ItemList />);
    return off;
  };
  const titles = () => screen.getAllByRole("row").map((r) => r.querySelector("td button")?.textContent).filter(Boolean);

  it("groups by repo (biggest first, no repo last), sorts, filters, opens an item", async () => {
    const off = await setup();
    act(() => dispatch(list([row("1", "Beta", null), row("2", "Alpha", "acme/web"), row("3", "Gamma", "acme/api", 4), row("4", "Delta", "acme/api")])));
    expect([...document.querySelectorAll(".vk-grp th")].map((h) => h.textContent)).toEqual(["acme/api 2", "acme/web 1", "No repo 1"]);
    expect(titles()).toEqual(["Gamma", "Delta", "Alpha", "Beta"]);
    expect([...document.querySelectorAll("td.vk-n")].map((c) => c.textContent)).toEqual(["1", "2", "3", "4"]); // Lp. runs on across groups
    fireEvent.click(screen.getByLabelText("Group by repo"));
    expect(document.querySelectorAll(".vk-grp")).toHaveLength(0);
    expect(titles()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);
    fireEvent.click(screen.getByRole("button", { name: "Repo" }));
    expect(titles()).toEqual(["Gamma", "Delta", "Alpha", "Beta"]); // no repo goes last
    fireEvent.change(screen.getByLabelText("Filter items"), { target: { value: "web" } });
    expect(titles()).toEqual(["Alpha"]);
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(sent.at(-1)).toEqual({ type: "item_get", source: "vikunja", id: "2" });
    off();
  });

  it("Archive marks the task done and offers Undo", async () => {
    const off = await setup();
    act(() => dispatch(list([row("5", "Old chore", "acme/web")])));
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Archive: Old chore" }));
    expect(sent.at(-1)).toEqual({ type: "item_done", source: "vikunja", id: "5", done: true });
    expect(screen.getByRole("status").textContent).toContain("Archived: Old chore");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "item_done", source: "vikunja", id: "5", done: false });
    expect(screen.queryByRole("status")).toBeNull();
    off();
  });

  it("another source gets the same table: its own columns, grouping by a column, no Archive", async () => {
    const off = await setup("prs");
    const pr = (id: string, title: string, repository: string, idle: string) => ({ id, title, repo: null, hot: false, cells: { repository, state: "", idle } });
    act(() => dispatch({ type: "item_list", source: "prs", kicker: "GITHUB", heading: "3 open pull requests", group_key: "repository", can_archive: false, url: null, url_label: null,
      columns: [col("title", "Pull request", "title"), col("repo", "Local repo", "repo"), col("repository", "Repository", "chip"), col("idle", "Idle", "age")],
      rows: [pr("a/x#1", "#1 · One", "a/x", "9"), pr("a/y#2", "#2 · Two", "a/y", "30"), pr("a/y#3", "#3 · Three", "a/y", "2")] } as unknown as ServerEvent));
    expect([...document.querySelectorAll(".vk-grp th")].map((h) => h.textContent)).toEqual(["a/y 2", "a/x 1"]);
    expect(screen.queryByRole("button", { name: /Archive/ })).toBeNull();
    expect(screen.getByLabelText("Group by repository")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Group by repository"));
    fireEvent.click(screen.getByRole("button", { name: "Idle" }));
    fireEvent.click(screen.getByRole("button", { name: "Idle ↑" })); // descending: numeric, not text
    expect(titles()).toEqual(["#2 · Two", "#1 · One", "#3 · Three"]);
    expect(screen.getByText("30d")).toBeTruthy();
    off();
  });
});

describe("delegation", () => {
  const mapped: PlanItem = { ...qTask, actions: ["start", "done", "later", "delegate"], repo: "web" };
  const unmapped: PlanItem = { ...mapped, repo: null };
  const row = (over: Partial<DelegationItem> = {}): DelegationItem => ({
    id: "d1", task: 8, title: "Write the release notes", repo: "web", branch: "orb/8-write-the-release-notes", stage: "working",
    line: "Working", session: "s9", folder: "/state/worktrees/web-orb-8", conflict: null,
    apply_text: "Apply merges branch orb/8-write-the-release-notes and marks task #8 done.", ...over,
  });
  const strip = () => screen.getByRole("region", { name: "Delegated" });

  it("a mapped task offers Delegate to its repo; a note task never does", () => {
    render(<Home />);
    act(() => dispatch(plan([], { next: mapped, up_next: [qNote] })));
    const lead = screen.getByRole("article", { name: "Next action" });
    sent.length = 0;
    fireEvent.click(within(lead).getByRole("button", { name: "Delegate to web" }));
    expect(sent).toEqual([{ type: "delegate", task: 8, path: null }]);
    act(() => dispatch(plan([], { next: { ...qNote, actions: ["start", "done", "later", "delegate"] }, up_next: [] })));
    expect(within(lead).queryByRole("button", { name: /Delegate/ })).toBeNull();
  });

  it("an unmapped task asks for the repo first, then the grant card; Deny starts nothing", () => {
    render(<Home />);
    act(() => dispatch(plan([], { next: unmapped, up_next: [] })));
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Delegate" }));
    expect(sent).toEqual([]);
    const picker = screen.getByRole("group", { name: "Choose the repo" });
    fireEvent.click(within(picker).getByRole("button", { name: "web" }));
    expect(sent).toEqual([{ type: "delegate", task: 8, path: "/Users/a/code/web" }]);
    expect(screen.queryByRole("group", { name: "Choose the repo" })).toBeNull();

    act(() => dispatch({ type: "delegate_card", id: "c1", task: 8, title: "Write the release notes", repo: "web", branch: "orb/8-write-the-release-notes",
      covers: ["Edit files in its own worktree", "Run the test command: npm test", "git add and git commit on orb/8-write-the-release-notes"] }));
    const card = screen.getByRole("group", { name: "Delegate this task" });
    expect(card.textContent).toContain("Repo web · branch orb/8-write-the-release-notes");
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toContain("Run the test command: npm test");
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Deny" }));
    expect(sent).toEqual([{ type: "delegate_confirm", id: "c1", ok: false }]);
    expect(screen.queryByRole("group", { name: "Delegate this task" })).toBeNull();
  });

  it("bulk: Select ticks only tasks; Delegate takes the ones with a known repo and says why for the rest; one card per repo; queued rows wait", () => {
    const t9: PlanItem = { ...mapped, key: "vikunja:9", id: "9", title: "Tidy the footer", suggest: "delegate" };
    render(<Home />);
    act(() => dispatch(plan([], { next: qNote, up_next: [{ ...mapped, suggest: "delegate" }, { ...unmapped, key: "vikunja:5", id: "5", title: "No repo task", suggest: "later" },
      { ...qNote, suggest: "later" }, t9, qPr] })));
    const lead = screen.getByRole("article", { name: "Next action" });
    fireEvent.click(within(lead).getByRole("button", { name: "Select" }));
    expect((within(lead).getByLabelText("Select Add dark mode") as HTMLInputElement).disabled).toBe(true);  // only tasks
    expect((within(lead).getByRole("button", { name: "Delegate" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(lead).getByLabelText("Select No repo task"));
    expect(within(lead).getByText("Only tasks whose project has a repo can be delegated together.")).toBeTruthy();
    expect((within(lead).getByRole("button", { name: "Delegate" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(lead).getByLabelText("Select No repo task"));
    fireEvent.click(within(lead).getByLabelText("Select Write the release notes"));
    fireEvent.click(within(lead).getByLabelText("Select Tidy the footer"));
    sent.length = 0;
    fireEvent.click(within(lead).getByRole("button", { name: "Delegate 2" }));
    expect(sent).toEqual([{ type: "delegate_bulk", tasks: [8, 9] }]);
    expect(within(lead).queryByLabelText("Select Tidy the footer")).toBeNull();  // back to the rows

    act(() => dispatch({ type: "delegate_card", id: "c2", task: 8, title: "Write the release notes", repo: "web", branch: "orb/8-a", more: 1,
      rows: [{ task: 8, title: "Write the release notes", branch: "orb/8-a" }, { task: 9, title: "Tidy the footer", branch: "orb/9-b" }],
      covers: ["Edit files in its own worktree", "git add and git commit on each task's own branch"] }));
    const card = screen.getByRole("group", { name: "Delegate these tasks" });
    expect(within(card).getByText("Delegate 2 tasks to web")).toBeTruthy();
    expect(card.textContent).toContain("#9 Tidy the footer");
    expect(card.textContent).toContain("Then 1 more repo, one card each.");
    sent.length = 0;
    fireEvent.click(within(card).getByRole("button", { name: "Allow" }));
    expect(sent).toEqual([{ type: "delegate_confirm", id: "c2", ok: true }]);

    act(() => dispatch({ type: "delegations", items: [row(), row({ id: "d2", task: 9, title: "Tidy the footer", stage: "queued", line: "Queued · 1st" })] }));
    const queued = within(strip()).getByText("#9 Tidy the footer").closest(".deleg-row") as HTMLElement;
    expect(queued.textContent).toContain("web · Queued · 1st");
    expect(within(queued).queryByRole("button", { name: "Open session" })).toBeNull();
    expect(within(queued).getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("suggestions: each task on Up next carries its word; a tap does it; Apply suggestions does them all in one pass", () => {
    const now: PlanItem = { ...qTask, key: "vikunja:3", id: "3", title: "Pay the bill", suggest: "take now" };
    const del: PlanItem = { ...mapped, suggest: "delegate" };
    const del2: PlanItem = { ...mapped, key: "vikunja:9", id: "9", title: "Tidy the footer", suggest: "delegate" };
    const later: PlanItem = { ...qNote, suggest: "later" };
    const rem: PlanItem = { key: "reminder:2026-10-24:Renew", kind: "reminder", id: "2026-10-24", title: "Renew the domain", reason: "Due today.", actions: [] };
    render(<Home />);
    act(() => dispatch(plan([rem], { next: qPr, up_next: [now, del, later, del2, qResult] })));
    const rows = screen.getByRole("article", { name: "Next action" }).querySelector(".lead-rows") as HTMLElement;
    expect([...rows.querySelectorAll(".lead-sug")].map((b) => b.textContent)).toEqual(["take now", "delegate", "later", "delegate"]);  // the result has none
    expect(screen.getByText("Renew the domain")).toBeTruthy();
    expect(document.querySelectorAll(".lead-sug")).toHaveLength(4);  // the reminder in Needs you never gets one

    sent.length = 0;
    fireEvent.click(within(rows).getByRole("button", { name: "take now: Pay the bill" }));
    expect(sent).toEqual([{ type: "item_start", source: "vikunja", id: "3" }, { type: "plan_start", key: "vikunja:3" }]);
    sent.length = 0;
    fireEvent.click(within(rows).getByRole("button", { name: "delegate: Write the release notes" }));
    expect(sent).toEqual([{ type: "delegate", task: 8, path: null }]);  // the grant card follows from the server
    sent.length = 0;
    fireEvent.click(within(rows).getByRole("button", { name: "later: Send the invoice" }));
    expect(sent).toEqual([{ type: "plan_later", key: "note:inbox/today.md:3" }]);

    const lead = screen.getByRole("article", { name: "Next action" });
    fireEvent.click(within(lead).getByRole("button", { name: "Select" }));
    expect((within(lead).getByRole("button", { name: "Apply suggestions" }) as HTMLButtonElement).disabled).toBe(true);
    for (const t of ["Pay the bill", "Write the release notes", "Send the invoice", "Tidy the footer"]) fireEvent.click(within(lead).getByLabelText(`Select ${t}`));
    expect(within(lead).getByText("1 take now · 2 delegate · 1 later")).toBeTruthy();
    sent.length = 0;
    fireEvent.click(within(lead).getByRole("button", { name: "Apply suggestions (4)" }));
    // Later first, then one bulk Delegate (one card per repo, queued past the limit), then Start, which moves the page
    expect(sent).toEqual([{ type: "plan_later", key: "note:inbox/today.md:3" }, { type: "delegate_bulk", tasks: [8, 9] },
      { type: "item_start", source: "vikunja", id: "3" }, { type: "plan_start", key: "vikunja:3" }]);
    expect(within(lead).queryByLabelText("Select Pay the bill")).toBeNull();
  });

  it("a refusal shows on Home", () => {
    render(<Home />);
    act(() => dispatch(plan([], { next: mapped, up_next: [] })));
    fireEvent.click(screen.getByRole("button", { name: "Delegate to web" }));
    act(() => dispatch({ type: "error", text: "Task #8 is already delegated." }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain("Task #8 is already delegated.");
  });

  it("the strip shows each stage line; Ready offers Review and Apply, which asks once", () => {
    render(<Home />);
    act(() => dispatch({ type: "delegations", items: [row()] }));
    expect(strip().textContent).toContain("#8 Write the release notes");
    expect(strip().textContent).toContain("web · Working");
    expect(within(strip()).queryByRole("button", { name: "Apply" })).toBeNull();
    sent.length = 0;
    fireEvent.click(within(strip()).getByRole("button", { name: "Open session" }));
    expect(sent).toEqual([{ type: "open_folder", path: "/state/worktrees/web-orb-8", session: "s9" }]);

    act(() => dispatch({ type: "delegations", items: [row({ stage: "ready", line: "Ready: branch orb/8-write-the-release-notes, tests passed" })] }));
    expect(strip().textContent).toContain("Ready: branch orb/8-write-the-release-notes, tests passed");
    sent.length = 0;
    fireEvent.click(within(strip()).getByRole("button", { name: "Review" }));
    expect(sent).toEqual([{ type: "delegation_review", id: "d1" }]);
    act(() => dispatch({ type: "delegation_diff", id: "d1", branch: "orb/8-write-the-release-notes", diff: " notes.md | 2 +-\n+new line" }));
    expect(within(strip()).getByRole("group", { name: "Changes on orb/8-write-the-release-notes" }).textContent).toContain("+new line");

    sent.length = 0;
    fireEvent.click(within(strip()).getByRole("button", { name: "Apply" }));
    expect(sent).toEqual([]);
    const confirm = within(strip()).getByRole("group", { name: "Apply" });
    expect(confirm.textContent).toContain("Apply merges branch orb/8-write-the-release-notes and marks task #8 done.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([{ type: "delegation_apply", id: "d1" }]);

    act(() => dispatch({ type: "delegations", items: [row({ stage: "ready", conflict: "These files conflict: notes.md. Nothing was merged." })] }));
    expect(within(strip()).getByRole("alert").textContent).toContain("notes.md");
    expect(within(strip()).getByRole("button", { name: "Apply again" })).toBeTruthy();
  });

  it("applied rows offer Undo and Dismiss; Discard takes a second tap", () => {
    render(<Home />);
    act(() => dispatch({ type: "delegations", items: [row({ stage: "applied", line: "Applied to main; task #8 done." }), row({ id: "d2", task: 9, stage: "failed", line: "Tests failed: FAILED test_x" })] }));
    const rows = strip().querySelectorAll(".deleg-row");
    sent.length = 0;
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Undo" }));
    fireEvent.click(within(rows[0] as HTMLElement).getByRole("button", { name: "Dismiss" }));
    expect(sent).toEqual([{ type: "delegation_revert", id: "d1" }, { type: "delegation_discard", id: "d1" }]);
    expect(within(rows[0] as HTMLElement).queryByRole("button", { name: "Open session" })).toBeNull();
    sent.length = 0;
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Discard" }));
    expect(sent).toEqual([]);
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "Discard branch and work?" }));
    expect(sent).toEqual([{ type: "delegation_discard", id: "d2" }]);
  });
  it("Needs you names each stuck, failed, stopped or waiting delegation by task and repo, with its actions; the rail counts them", () => {
    render(<><Sidebar /><Home /></>);
    act(() => dispatch({ type: "delegations", items: [
      row({ needs: "card", line: "Waiting for your OK", ask: "Run make deploy" }),
      row({ id: "d2", task: 9, title: "Fix login", repo: "api", stage: "failed", needs: "failed", line: "Tests failed: FAILED test_login" }),
      row({ id: "d3", task: 10, title: "Bump deps", stage: "working", needs: "stuck", line: "Stuck 20 min" }),
      row({ id: "d4", task: 11, title: "Docs", stage: "stopped", needs: "stopped", line: "Stopped by restart" }),
      row({ id: "d5", task: 12, title: "Still going" }),
    ] }));
    const needs = screen.getByRole("article", { name: "5 things need you" });  // the waiting session + four delegations
    expect(within(needs).queryByText(/Still going/)).toBeNull();
    const item = (task: number) => within(needs).getByRole("group", { name: `Delegation of task #${task}` });

    expect(item(8).textContent).toContain("Delegated #8 Write the release notes");
    expect(item(8).textContent).toContain("web · Waiting for your OK");
    expect(within(item(8)).getByLabelText("What it asks to do").textContent).toBe("Run make deploy");
    expect(within(item(8)).queryByRole("button", { name: "Discard" })).toBeNull();  // the card is answered in its session
    sent.length = 0;
    fireEvent.click(within(item(8)).getByText(/Delegated #8/));
    expect(sent).toEqual([{ type: "open_folder", path: "/state/worktrees/web-orb-8", session: "s9" }]);

    expect(item(9).textContent).toContain("api · Tests failed: FAILED test_login");
    sent.length = 0;
    fireEvent.click(within(item(9)).getByRole("button", { name: "Retry" }));
    fireEvent.click(within(item(10)).getByRole("button", { name: "Retry" }));
    fireEvent.click(within(item(11)).getByRole("button", { name: "Resume" }));
    expect(sent).toEqual([{ type: "delegation_retry", id: "d2" }, { type: "delegation_retry", id: "d3" }, { type: "delegation_resume", id: "d4" }]);
    expect(within(item(11)).queryByRole("button", { name: "Open session" })).toBeNull();  // nothing runs until Resume
    expect(within(item(11)).queryByRole("button", { name: "Retry" })).toBeNull();
    expect(within(item(10)).getByRole("button", { name: "Discard" })).toBeTruthy();

    expect(screen.getByRole("button", { name: /^Home/ }).textContent).toContain("5");
    act(() => dispatch({ type: "delegations", items: [row({ id: "d5", task: 12, title: "Still going" })] }));
    expect(screen.getByRole("article", { name: "1 thing needs you" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Home/ }).textContent).toContain("1");
  });
  it("push and a PR wait in Needs you after the tests pass: Push and open PR or Skip; an opened PR is linked", () => {
    render(<><Sidebar /><Home /></>);
    act(() => dispatch({ type: "delegations", items: [
      row({ stage: "ready", needs: "outward", line: "Ready: branch orb/8-notes, tests passed", ask: "Push branch orb/8-notes and open a PR for task #8?" }),
      row({ id: "d2", task: 9, stage: "ready", line: "Ready: PR #12, tests passed", pr: 12, pr_url: "https://git.example/acme/web/pull/12", apply_text: "Apply merges PR #12 and marks task #9 done." }),
    ] }));
    const needs = screen.getByRole("article", { name: "2 things need you" });  // the waiting session + the push
    const item = within(needs).getByRole("group", { name: "Delegation of task #8" });
    expect(item.textContent).toContain("PUSH?");
    expect(within(item).getByLabelText("What it asks to do").textContent).toBe("Push branch orb/8-notes and open a PR for task #8?");
    sent.length = 0;
    fireEvent.click(within(item).getByRole("button", { name: "Push and open PR" }));
    fireEvent.click(within(item).getByRole("button", { name: "Skip" }));
    expect(sent).toEqual([{ type: "delegation_outward", id: "d1", allow: true }, { type: "delegation_outward", id: "d1", allow: false }]);
    expect(within(item).getByRole("button", { name: "Discard" })).toBeTruthy();

    const ready = strip().querySelectorAll(".deleg-row")[1] as HTMLElement;
    expect(within(ready).getByRole("link", { name: "PR #12" }).getAttribute("href")).toBe("https://git.example/acme/web/pull/12");
    fireEvent.click(within(ready).getByRole("button", { name: "Apply" }));
    expect(within(ready).getByText("Apply merges PR #12 and marks task #9 done.")).toBeTruthy();
  });
});
