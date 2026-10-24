// Home, Settings, Activity and Routines: their server state, which view is showing, and the pure helpers
// the screens use (exported for tests).
import { create } from "zustand";
import type { FolderItem, RoutineItem, RoutinesEvent, SessionItem, SettingsEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";

export type View = "home" | "chat" | "task" | "vikunja" | "vikunjas" | "routine" | "activity" | "routines" | "settings";

export const useViews = create<{
  view: View;
  settings: SettingsEvent | null;
  routines: RoutinesEvent | null;
  routinesNew: Set<string>; // "new" dots stay for this visit; the server forgets them at once
}>(() => ({ view: "home", settings: null, routines: null, routinesNew: new Set() }));

export function wireViews(): () => void {
  const offs = [
    on("settings", (ev) => useViews.setState({ settings: ev })),
    on("routines", (ev) => useViews.setState({ routines: ev })),
  ];
  return () => offs.forEach((off) => off());
}

// -- Activity ------------------------------------------------------------------------------------

export type SessionRow = SessionItem & { folder: FolderItem };
const ORDER: Record<string, number> = { approval: 0, working: 1, done: 2, idle: 3 };

/** Sessions working, waiting for an approval, done since you looked, or live; the most urgent first. */
export function activityRows(folders: FolderItem[], limit = 40): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const f of folders) for (const s of f.sessions ?? []) if (!s.empty && (s.status !== "idle" || s.live)) rows.push({ ...s, folder: f });
  rows.sort((a, b) => (ORDER[a.status] ?? 3) - (ORDER[b.status] ?? 3) || (b.last_used ?? 0) - (a.last_used ?? 0));
  return rows.slice(0, limit);
}

export function statusText(s: SessionItem): string {
  if (s.opus && s.status === "working") return "Opus working";
  return ({ approval: "needs approval", working: "working", done: "done since you looked" } as Record<string, string>)[s.status] ?? "open";
}

export function dotClass(status: string, live: boolean): string {
  return "dot" + (({ approval: " approval", working: " busy", done: " done" } as Record<string, string>)[status] ?? (live ? " live" : " has"));
}

// -- Routines ------------------------------------------------------------------------------------

const ROUTINE_TEXT: Record<string, string> = { ok: "ok", failed: "failed", waiting: "waiting for you", stuck: "stuck", running: "running" };
const NEEDS_TEXT: Record<string, string> = { failed: "failed", waiting: "waiting for you", stuck: "looks stuck", missed: "missed its run" };

export function routineState(x: RoutineItem): string {
  return x.needs ?? (!x.enabled ? "off" : x.last?.outcome ?? "none");
}

export function routineStatus(x: RoutineItem): string {
  if (x.needs) return NEEDS_TEXT[x.needs];
  if (!x.enabled) return "off";
  return ROUTINE_TEXT[x.last?.outcome ?? ""] ?? "no runs yet";
}

export function routineDot(x: RoutineItem): string {
  const st = routineState(x);
  return "dot" + (({ failed: " approval", waiting: " approval", stuck: " approval", missed: " approval", running: " busy", ok: " done" } as Record<string, string>)[st] ?? " has");
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

/** Pick when a routine's results notify: Auto lets the judge decide. (Failures always notify.) */
export function setNotify(id: string, mode: NotifyMode) {
  send({ type: "set_settings", values: { routines_notify: { [id]: mode } } });
}

/** The line under a routine: who decided, and why. */
export function whyLine(x: RoutineItem): string {
  if (x.notify === "always") return "always notifies (your choice)";
  if (x.notify === "never") return "muted (your choice)";
  if (x.worth === "read") return `worth reading${x.why ? `: ${x.why}` : ""}`;
  if (x.worth === "skip") return `nothing to report${x.why ? `: ${x.why}` : ""}`;
  return "";
}
