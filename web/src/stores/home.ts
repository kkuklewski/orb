// Home: what needs you (sessions, routines), open tasks and recent notes from the notes folder.
// The notes part comes from the server's home.summary (read-only, no model call).
import { create } from "zustand";
import type { AwayRecap, DelegationItem, FolderItem, HomeEvent, HomeForgetEvent, HomeTasksEvent, PlanEvent, PlanItem, RoutinesEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { trackerName, useFeatures } from "./features";
import { activityRows, openSessions, useViews, type SessionRow } from "./views";
import { askIn, openFolder } from "./session";
import { openItem, startItem } from "./items";
import { useDelegations } from "./delegation";
import { openBrain, openNoTopic, setFilter } from "./brain";

// forget: the Don't forget pane (reminders, repos with unsaved work, open pull requests) and pinned links (server: forget.summary).
// tasks: the Tasks source as Home sees it, the first open Vikunja tasks and the count, or why it can't be read (server: vikunja.home_event).
// plan: what needs you, from rules, in the order the model gave it (server: needs.py, docs/adr/0001).
// away: the Away recap after 24 hours or more without the owner acting, or null (server: away.py).
export const useHome = create<{ notes: HomeEvent | null; forget: HomeForgetEvent | null; tasks: HomeTasksEvent | null; plan: PlanEvent | null;
  away: AwayRecap | null }>(() => ({ notes: null, forget: null, tasks: null, plan: null, away: null }));

/** The Vikunja tasks Home can count on: null when Vikunja isn't set up, can't be read, or hasn't answered yet. */
export function vikunjaTasks(t: HomeTasksEvent | null): (HomeTasksEvent & { tasks: NonNullable<HomeTasksEvent["tasks"]> }) | null {
  return t?.tasks && !t.error ? (t as HomeTasksEvent & { tasks: NonNullable<HomeTasksEvent["tasks"]> }) : null;
}

/** Home keeps itself current: tasks made in a chat turn, in Vikunja or on another device show up without a reload. */
export const HOME_POLL_MS = 60_000;
const HOME_GAP_MS = 5_000; // a burst (turn end + focus) asks once

export function wireHome(): () => void {
  let asked = 0;
  const refreshIfHome = () => {
    if (useViews.getState().view !== "home" || document.visibilityState === "hidden" || Date.now() - asked < HOME_GAP_MS) return;
    asked = Date.now();
    refreshHome();
  };
  const timer = setInterval(refreshIfHome, HOME_POLL_MS);
  document.addEventListener("visibilitychange", refreshIfHome);
  window.addEventListener("focus", refreshIfHome);
  const offs = [on("home", (ev) => useHome.setState({ notes: ev })), on("home_forget", (ev) => useHome.setState({ forget: ev })),
    on("home_tasks", (ev) => useHome.setState({ tasks: ev })),
    on("plan", (ev) => useHome.setState({ plan: ev })),
    on("away_recap", (ev) => useHome.setState({ away: ev.recap })),
    // Leaving Home with the Away recap on screen counts as having opened it: it goes, on every page.
    useViews.subscribe((s, prev) => { if (prev.view === "home" && s.view !== "home" && useHome.getState().away) awaySeen(); }),
    on("result", (ev) => { if (!ev.replay) refreshIfHome(); }), // a turn ended: it may have made a task
    useViews.subscribe((s, prev) => { if (s.view === "home" && prev.view !== "home") refreshIfHome(); })];
  return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refreshIfHome); window.removeEventListener("focus", refreshIfHome); offs.forEach((off) => off()); };
}

/** A dated reminder this close (days) turns orange and counts as due soon. */
export const SOON = 7;

/** A pull request quiet longer than this (days) counts as left behind, not as due. */
export const LEFT_BEHIND = 30;

/** Pull requests gone quiet: the recent ones (most recently touched first) and the long-forgotten ones. */
export function quietPrs(w: HomeForgetEvent | null) {
  const stale = (w?.prs ?? []).filter((p) => p.stale).sort((a, b) => a.idle_days - b.idle_days);
  return { recent: stale.filter((p) => p.idle_days <= LEFT_BEHIND), old: stale.filter((p) => p.idle_days > LEFT_BEHIND) };
}

/** Reminders due within SOON days (or overdue) plus pull requests that went quiet in the last month. */
export function dueSoon(w: HomeForgetEvent | null): number {
  if (!w) return 0;
  return w.reminders.filter((r) => r.days !== null && r.days !== undefined && r.days <= SOON).length + quietPrs(w).recent.length;
}

/** Ask the server for the notes summary, and the routines when they're on. */
export function refreshHome() {
  send({ type: "home" });
  if (useFeatures.getState().features?.routines) send({ type: "routines" });
}

/** The Away recap was read: close it here and on every other page. */
export function awaySeen() {
  useHome.setState({ away: null });
  send({ type: "away_seen" });
}

/** Ask for a new ranking of the plan now (the server otherwise asks only when it changed). */
export function rerank() {
  send({ type: "home", rerank: true });
}

/** Start a queue item, each kind its own way: a Vikunja task opens a session from its brief (the server picks the
 *  repo, else the Home chat), a note task goes to the Home chat, a result opens its session (which clears it), a pull
 *  request its page, the notes batch Brain's notes waiting for a verdict (grouped there by suggestion, ADR 0006), the
 *  No-topic captures Brain's No topic view, the old Finished ones Sessions showing only Finished. A started task or PR leaves the queue for today. */
export function startPlan(p: PlanItem) {
  const vault = useFeatures.getState().features?.vault;
  if (p.kind === "task") startItem("vikunja", p.id);
  else if (p.kind === "note_task" && vault) askIn(vault, `Help me get this task from my note "${p.id.slice(0, p.id.lastIndexOf(":"))}" done: ${p.title}`);
  else if (p.kind === "pr") openItem("prs", p.id);
  else if (p.kind === "notes_batch") { setFilter({ waiting: true }); openBrain(); }
  else if (p.kind === "notopic") openNoTopic();
  else if (p.kind === "results_old") openSessions(false, true);
  else if (p.kind === "result") {
    const f = useFeatures.getState().folders.find((x) => x.sessions?.some((s) => s.key === p.id));
    if (f) openFolder(f.path, p.id);
  }
  if (p.kind === "task" || p.kind === "note_task" || p.kind === "pr") send({ type: "plan_start", key: p.key });
}

/** Later: the item leaves the queue until tomorrow, on every page (the server keeps it; nothing is written to Vikunja). */
export const laterPlan = (p: PlanItem) => send({ type: "plan_later", key: p.key });

/** Leave it on a pull request quiet for two weeks: hidden until the PR changes (the server keeps its updatedAt); Orb
 *  never closes, comments on or touches the PR. */
export const leavePlan = (p: PlanItem) => send({ type: "plan_leave", key: p.key });


export const askAboutNote = (file: string) => `Read my note "${file}" and tell me in a few sentences what it says and what, if anything, I still need to do about it.`;

export function greeting(hour: number): string {
  return hour < 5 ? "Working late." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

export interface NeedsYou { waiting: SessionRow[]; done: SessionRow[]; working: SessionRow[]; delegations: DelegationItem[]; items: PlanItem[] }

/** Sessions waiting for your OK (live, always first), finished, still working; delegations that can't finish on
 *  their own (a card, failed tests, stuck, stopped by restart: the server decides `needs`); then the plan's
 *  needs-you rows (a broken setup, routines with a problem, reminders, overdue tasks), which the server decides by rule. */
export function needsYou(folders: FolderItem[], plan: PlanEvent | null = null, delegations: DelegationItem[] = useDelegations.getState().items): NeedsYou {
  const rows = activityRows(folders);
  return {
    waiting: rows.filter((r) => r.status === "approval"),
    done: rows.filter((r) => r.status === "done"),
    working: rows.filter((r) => r.status === "working"),
    delegations: delegations.filter((d) => d.needs),
    items: plan?.needs_you ?? [],
  };
}

/** A delegation in Needs you as one line for the model: the task, the repo, what it waits for. */
export const delegText = (d: DelegationItem) => `Delegated task #${d.task} ${d.title} (repo ${d.repo}): ${d.line}${d.ask ? `; it asks: ${d.ask}` : ""}`;

/** How many things need you: the Needs you strip's rows, the count on the rail. */
export const needsCount = (n: NeedsYou) => n.waiting.length + n.delegations.length + n.items.length;

export type Part = string | { b: string };
const plural = (n: number, one: string, many: string) => `${n === 1 ? "One" : n} ${n === 1 ? one : many}`;

/** The day in a few plain sentences, the numbers in bold: what waits, what's open, how the routines did. */
export function brief(d: { waiting: SessionRow[]; done: SessionRow[]; routines: RoutinesEvent | null; notes: HomeEvent | null; vault: boolean; routinesOn: boolean; tasks?: HomeTasksEvent | null }): Part[][] {
  const out: Part[][] = [];
  const where = (rows: SessionRow[]) => [...new Set(rows.map((r) => r.folder.label.split("/").pop()))].slice(0, 2).join(" and ");
  if (d.waiting.length) out.push([{ b: plural(d.waiting.length, "session", "sessions") }, ` ${d.waiting.length === 1 ? "is" : "are"} waiting for your OK in ${where(d.waiting)}.`]);
  if (d.done.length) out.push([{ b: plural(d.done.length, "session", "sessions") }, ` finished while you were away.`]);
  const tr = vikunjaTasks(d.tasks ?? null);
  if (tr) {
    out.push([`${trackerName()} holds `, { b: `${tr.total} open task${tr.total === 1 ? "" : "s"}` }, d.vault && d.notes ? [", and ", { b: `${d.notes.notes_week} note${d.notes.notes_week === 1 ? "" : "s"}` }, " changed this week."] : ["."]].flat());
  } else if (d.vault && d.notes) {
    out.push(["Your notes hold ", { b: `${d.notes.open_tasks} open task${d.notes.open_tasks === 1 ? "" : "s"}` }, ", and ", { b: `${d.notes.notes_week} note${d.notes.notes_week === 1 ? "" : "s"}` }, " changed this week."]);
  }
  if (d.routinesOn && d.routines) {
    const on = d.routines.items.filter((x) => x.enabled);
    const bad = on.filter((x) => x.needs);
    const next = on.filter((x) => x.next_run_at).sort((a, b) => a.next_run_at! - b.next_run_at!)[0];
    const then = next ? `; next up is ${next.name} at ${new Date(next.next_run_at! * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : ".";
    const toRead = on.filter((x) => x.loud && !x.needs);
    const read = toRead.length ? [` ${toRead.length === 1 ? "One run is" : `${toRead.length} runs are`} worth reading (${toRead.map((x) => x.name).slice(0, 2).join(", ")}).`] : [];
    out.push(bad.length ? [{ b: plural(bad.length, "routine", "routines") }, ` need${bad.length === 1 ? "s" : ""} a look (${bad[0].name})${then}`, ...read]
      : ["All ", { b: `${on.length} routine${on.length === 1 ? "" : "s"}` }, ` ran fine${then}`, ...read]);
  }
  if (!out.length) out.push(["Nothing is waiting for you. Say what you'd like to work on, or type it below."]);
  return out;
}

/** "6 ok · 1 needs you · next: nightly at 02:00". */
export function routinesLine(r: RoutinesEvent | null, fmt: (ts: number) => string): string {
  if (!r) return "checking…";
  const on = r.items.filter((x) => x.enabled);
  const ok = on.filter((x) => !x.needs && x.last?.outcome === "ok").length;
  const next = on.filter((x) => x.next_run_at).sort((a, b) => a.next_run_at! - b.next_run_at!)[0];
  return [`${ok} ok`, r.needs ? `${r.needs} need${r.needs === 1 ? "s" : ""} you` : null, next ? `next: ${next.name} ${fmt(next.next_run_at!)}` : null]
    .filter(Boolean).join(" · ");
}
