// Home, Settings, Sessions and Routines: their server state, which view is showing, and the pure helpers
// the screens use (exported for tests).
import { create } from "zustand";
import type { FolderItem, RoutineItem, RoutinesEvent, SessionItem, SettingsEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";

export type View = "home" | "chat" | "task" | "item" | "items" | "routine" | "sessions" | "routines" | "tasks" | "settings" | "brain" | "note";

export const useViews = create<{
  view: View;
  settings: SettingsEvent | null;
  routines: RoutinesEvent | null;
  routinesNew: Set<string>; // "new" dots stay for this visit; the server forgets them at once
  running: boolean; // Sessions shows only the sessions running or waiting (Home's "Running now", the old /activity)
  finished: boolean; // Sessions shows only the Finished ones not opened (Up next's "N finished sessions not opened")
  settingsAt?: string | null; // the Settings section to scroll to once it shows (a broken setup on Home names it)
}>(() => ({ view: "home", settings: null, routines: null, routinesNew: new Set(), running: false, finished: false }));

/** Sessions, all of them, (running) only those running or waiting for you, or (finished) only the Finished ones. */
export function openSessions(running = false, finished = false) {
  useViews.setState({ view: "sessions", running, finished: finished && !running });
}

/** Settings, scrolled to one section ("claude", "vikunja", "speech", "voice"). */
export function openSettings(at: string) {
  useViews.setState({ view: "settings", settingsAt: at });
}

/** Esc closes the Home chat dock unless something is being typed: a non-empty composer keeps its text. */
export function escClosesPanel(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  const field = el?.closest?.("input, textarea, select") as HTMLInputElement | null;
  return !field || (field.tagName === "TEXTAREA" && field.value === "");
}

export function wireViews(): () => void {
  const offs = [
    on("settings", (ev) => useViews.setState({ settings: ev })),
    on("routines", (ev) => useViews.setState({ routines: ev })),
  ];
  return () => offs.forEach((off) => off());
}

// -- Sessions ------------------------------------------------------------------------------------

export type SessionRow = SessionItem & { folder: FolderItem };
const ORDER: Record<string, number> = { approval: 0, working: 1, done: 2, idle: 3 };

/** Sessions working, waiting for an approval, finished, or live; the most urgent first. */
export function activityRows(folders: FolderItem[], limit = 40): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const f of folders) for (const s of f.sessions ?? []) if (!s.empty && (s.status !== "idle" || s.live)) rows.push({ ...s, folder: f });
  rows.sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || (b.last_used ?? 0) - (a.last_used ?? 0));
  return rows.slice(0, limit);
}

/** Sessions that need watching: running or waiting for an approval (the quiet dot on the rail, "Running now" on Home). */
export const runningRows = (rows: SessionRow[]) => rows.filter((r) => r.status === "approval" || r.status === "working");

/** Sessions view: every session grouped by repo (repos with something running or waiting first, then newest), filtered by `q`
 *  on the label and the repo name. */
export function chatGroups(rows: SessionRow[], q: string, current: string | null = null): { folder: FolderItem; rows: (SessionRow & { count: number })[] }[] {
  const needle = q.trim().toLowerCase();
  const by = new Map<string, { folder: FolderItem; rows: (SessionRow & { count: number })[] }>();
  const seen = new Map<string, SessionRow & { count: number }>(); // one row per label per repo (the newest wins; `rows` is newest first)
  for (const r of rows) {
    if (r.label && !r.live && r.key !== current) {
      const id = `${r.folder.path}\n${r.label.trim().toLowerCase()}`;
      const first = seen.get(id);
      if (first) { first.count++; continue; }
    }
    const row = { ...r, count: 1 };
    if (r.label) seen.set(`${r.folder.path}\n${r.label.trim().toLowerCase()}`, row);
    if (needle && !`${r.label ?? ""} ${r.folder.label}`.toLowerCase().includes(needle)) continue;
    const g = by.get(r.folder.path) ?? { folder: r.folder, rows: [] };
    g.rows.push(row);
    by.set(r.folder.path, g);
  }
  const rank = (g: { rows: SessionRow[] }) => Math.min(...g.rows.map((r) => ORDER[r.status] ?? 3));
  const newest = (g: { rows: SessionRow[] }) => Math.max(...g.rows.map((r) => r.last_used ?? 0));
  const groups = [...by.values()];
  for (const g of groups) g.rows.sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || (b.last_used ?? 0) - (a.last_used ?? 0));
  return groups.sort((a, b) => Math.min(rank(a), 2) - Math.min(rank(b), 2) || newest(b) - newest(a));
}

export function dotClass(status: string, live: boolean): string {
  return "dot" + (({ approval: " approval", working: " busy", done: " done" } as Record<string, string>)[status] ?? (live ? " live" : " has"));
}

// -- Routines ------------------------------------------------------------------------------------

const ROUTINE_TEXT: Record<string, string> = { ok: "ok", failed: "failed", waiting: "waiting for you", stuck: "stuck", running: "running" };
const NEEDS_TEXT: Record<string, string> = { failed: "failed", waiting: "waiting for you", stuck: "looks stuck", missed: "missed its run", broken: "reports a problem", action: "needs you to act" };


export function routineStatus(x: RoutineItem): string {
  if (x.needs) return NEEDS_TEXT[x.needs];
  if (!x.enabled) return "off";
  return ROUTINE_TEXT[x.last?.outcome ?? ""] ?? "no runs yet";
}

export function routineDot(x: RoutineItem): string {
  if (x.needs) return "dot approval";
  if (!x.enabled) return "dot";
  return "dot" + (({ running: " busy", ok: " done" } as Record<string, string>)[x.last?.outcome ?? ""] ?? " has");
}

export type RoutineState = RoutineItem["state"];
/** The list's groups, in the decided order (GLOSSARY: Routine state); `tail` shows the judge's why on the line. */
export const ROUTINE_GROUPS: { name: string; states: RoutineState[]; tail: boolean }[] = [
  { name: "Needs you", states: ["failed", "stuck", "missed", "needs you"], tail: true },
  { name: "Worth reading", states: ["worth reading"], tail: true },
  { name: "Nothing to report", states: ["nothing to report"], tail: false },
  { name: "Off", states: ["off"], tail: false },
];

/** Routines by group, by name inside, so a routine keeps its place from day to day. Empty groups are left out. */
export function routineGroups(items: RoutineItem[]) {
  const byName = (a: RoutineItem, b: RoutineItem) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
  return ROUTINE_GROUPS.map((g) => ({ ...g, items: items.filter((x) => g.states.includes(x.state)).sort(byName) })).filter((g) => g.items.length);
}

/** A line's time: "06:10" today, "yest 06:10", "3 d ago"; a missed routine says when it should have run. */
export function lineTime(ts: number, now = Date.now()): string {
  const d = new Date(ts * 1000), today = new Date(now), yest = new Date(now - 86400000);
  if (d.toDateString() === today.toDateString() || ts * 1000 > now) return hhmm(ts);
  if (d.toDateString() === yest.toDateString()) return `yest ${hhmm(ts)}`;
  const days = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  return `${days} d ago`;
}

export function routineTime(x: RoutineItem, now = Date.now()): string {
  if (x.state === "missed" && x.missed_at) return `missed ${lineTime(x.missed_at, now)}`;
  return x.last?.at ? lineTime(x.last.at, now) : "";
}

export function relTime(ts: number, now = Date.now() / 1000): string {
  const s = now - ts;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const hhmm = (ts: number) => new Date(ts * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function dayTime(ts: number, now = Date.now()): string {
  const d = new Date(ts * 1000), today = new Date(now), tomorrow = new Date(now + 86400000);
  const day = d.toDateString() === today.toDateString() ? "today" : d.toDateString() === tomorrow.toDateString() ? "tomorrow"
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `${day} ${hhmm(ts)}`;
}

export function routinesSubtitle(r: RoutinesEvent | null): string {
  if (!r) return "scheduled cloud agents";
  if (r.checking) return "checking…";
  if (r.error) return `last check failed: ${r.error}`;
  return r.checked_at ? `checked ${relTime(r.checked_at)} ago · every 30 min` : "not checked yet";
}

/** Only claude.ai links are ever shown (the server checks too). */
export function safeRunUrl(url: string | undefined): string | null {
  return url && /^https:\/\/claude\.ai\//.test(url) ? url : null;
}

export type NotifyMode = "auto" | "always" | "never";
export const NOTIFY_LABEL: Record<NotifyMode, string> = { auto: "Auto", always: "Always", never: "Never" };

/** Pick when a routine's runs notify: Auto lets the judge decide. (Failures always notify.) */
export function setNotify(id: string, mode: NotifyMode) {
  send({ type: "set_settings", values: { routines_notify: { [id]: mode } } });
}

/** The line under a routine: who decided, and why. */
export function whyLine(x: RoutineItem): string {
  if (x.resolved) return "resolved by you; the next run is judged afresh";
  if (x.needs === "broken" || x.needs === "action") return x.why ?? "";  // a problem shows whatever your setting says
  if (x.notify === "always") return "always notifies (your choice)";
  if (x.notify === "never") return "muted (your choice)";
  if (x.worth === "read") return `worth reading${x.why ? `: ${x.why}` : ""}`;
  if (x.worth === "skip") return `nothing to report${x.why ? `: ${x.why}` : ""}`;
  return "";
}
