// Home: what needs you (sessions, routines), open tasks and recent notes from the notes folder.
// The notes part comes from the server's home.summary (read-only, no model call).
import { create } from "zustand";
import type { FolderItem, HomeEvent, RoutineItem, RoutinesEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useFeatures } from "./features";
import { activityRows, type SessionRow } from "./views";

export const useHome = create<{ notes: HomeEvent | null }>(() => ({ notes: null }));

export function wireHome(): () => void {
  const off = on("home", (ev) => useHome.setState({ notes: ev }));
  return off;
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

/** "6 ok · 1 needs you · next: nightly at 02:00". */
export function routinesLine(r: RoutinesEvent | null, fmt: (ts: number) => string): string {
  if (!r) return "checking…";
  const on = r.items.filter((x) => x.enabled);
  const ok = on.filter((x) => !x.needs && x.last?.outcome === "ok").length;
  const next = on.filter((x) => x.next_run_at).sort((a, b) => a.next_run_at! - b.next_run_at!)[0];
  return [`${ok} ok`, r.needs ? `${r.needs} need${r.needs === 1 ? "s" : ""} you` : null, next ? `next: ${next.name} ${fmt(next.next_run_at!)}` : null]
    .filter(Boolean).join(" · ");
}
