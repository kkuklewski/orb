// Home: what needs you (sessions, routines), open tasks and recent notes from the notes folder.
// The notes part comes from the server's home.summary (read-only, no model call).
import { create } from "zustand";
import type { FolderItem, HomeEvent, HomeWatchEvent, RoutineItem, RoutinesEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useFeatures } from "./features";
import { activityRows, type SessionRow } from "./views";

// watch: reminders, pinned links, repos with unsaved work, open pull requests, Vikunja (server: watch.summary).
export const useHome = create<{ notes: HomeEvent | null; watch: HomeWatchEvent | null }>(() => ({ notes: null, watch: null }));

export function wireHome(): () => void {
  const offs = [on("home", (ev) => useHome.setState({ notes: ev })), on("home_watch", (ev) => useHome.setState({ watch: ev }))];
  return () => offs.forEach((off) => off());
}

/** A dated reminder this close (days) turns orange and counts as due soon. */
export const SOON = 7;

/** A pull request quiet longer than this (days) counts as left behind, not as due. */
export const LEFT_BEHIND = 30;

/** Pull requests gone quiet: the recent ones (most recently touched first) and the long-forgotten ones. */
export function quietPrs(w: HomeWatchEvent | null) {
  const stale = (w?.prs ?? []).filter((p) => p.stale).sort((a, b) => a.idle_days - b.idle_days);
  return { recent: stale.filter((p) => p.idle_days <= LEFT_BEHIND), old: stale.filter((p) => p.idle_days > LEFT_BEHIND) };
}

/** Reminders due within SOON days (or overdue) plus pull requests that went quiet in the last month. */
export function dueSoon(w: HomeWatchEvent | null): number {
  if (!w) return 0;
  return w.reminders.filter((r) => r.days !== null && r.days !== undefined && r.days <= SOON).length + quietPrs(w).recent.length;
}

/** Ask the server for the notes summary, and the routines when they're on. */
export function refreshHome() {
  send({ type: "home" });
  if (useFeatures.getState().features?.routines) send({ type: "routines" });
}

export const ASK_TODAY = "What's on my plate today? Look at the open tasks in my notes, my recent notes and anything dated today, and give me a short plan: the three things to do first, then what can wait.";

export const askAboutNote = (file: string) => `Read my note "${file}" and tell me in a few sentences what it says and what, if anything, I still need to do about it.`;

export function greeting(hour: number): string {
  return hour < 5 ? "Working late." : hour < 12 ? "Good morning." : hour < 18 ? "Good afternoon." : "Good evening.";
}

export interface NeedsYou { waiting: SessionRow[]; done: SessionRow[]; working: SessionRow[]; routines: RoutineItem[] }

/** Sessions waiting for your OK, done since you looked, still working; routines that failed, wait or got stuck. */
export function needsYou(folders: FolderItem[], routines: RoutinesEvent | null): NeedsYou {
  const rows = activityRows(folders);
  return {
    waiting: rows.filter((r) => r.status === "approval"),
    done: rows.filter((r) => r.status === "done"),
    working: rows.filter((r) => r.status === "working"),
    routines: (routines?.items ?? []).filter((x) => x.needs),
  };
}

export type Part = string | { b: string };
const plural = (n: number, one: string, many: string) => `${n === 1 ? "One" : n} ${n === 1 ? one : many}`;

/** The day in a few plain sentences, the numbers in bold: what waits, what's open, how the routines did. */
export function brief(d: { waiting: SessionRow[]; done: SessionRow[]; routines: RoutinesEvent | null; notes: HomeEvent | null; vault: boolean; routinesOn: boolean; watch?: HomeWatchEvent | null }): Part[][] {
  const out: Part[][] = [];
  const where = (rows: SessionRow[]) => [...new Set(rows.map((r) => r.folder.label.split("/").pop()))].slice(0, 2).join(" and ");
  if (d.waiting.length) out.push([{ b: plural(d.waiting.length, "session", "sessions") }, ` ${d.waiting.length === 1 ? "is" : "are"} waiting for your OK in ${where(d.waiting)}.`]);
  if (d.done.length) out.push([{ b: plural(d.done.length, "session", "sessions") }, ` finished while you were away.`]);
  const tr = d.watch?.tracker;
  if (tr) {
    out.push(["Vikunja holds ", { b: `${tr.total} open task${tr.total === 1 ? "" : "s"}` }, d.vault && d.notes ? [", and ", { b: `${d.notes.notes_week} note${d.notes.notes_week === 1 ? "" : "s"}` }, " changed this week."] : ["."]].flat());
  } else if (d.vault && d.notes) {
    out.push(["Your notes hold ", { b: `${d.notes.open_tasks} open task${d.notes.open_tasks === 1 ? "" : "s"}` }, ", and ", { b: `${d.notes.notes_week} note${d.notes.notes_week === 1 ? "" : "s"}` }, " changed this week."]);
  }
  if (d.routinesOn && d.routines) {
    const on = d.routines.items.filter((x) => x.enabled);
    const bad = on.filter((x) => x.needs);
    const next = on.filter((x) => x.next_run_at).sort((a, b) => a.next_run_at! - b.next_run_at!)[0];
    const then = next ? `; next up is ${next.name} at ${new Date(next.next_run_at! * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.` : ".";
    const toRead = on.filter((x) => x.loud && !x.needs);
    const read = toRead.length ? [` ${toRead.length === 1 ? "One result is" : `${toRead.length} results are`} worth reading (${toRead.map((x) => x.name).slice(0, 2).join(", ")}).`] : [];
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
