// One task from the notes: its screen (the line in context) and what can be done with it. Changes
// go to the server as one-line edits that carry the line as shown (`expect`), so a note that changed
// meanwhile is refused instead of overwritten; every change can be undone from the bar it leaves.
import { create } from "zustand";
import type { HomeTask, TaskChangedEvent, TaskDetailEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useHome } from "./home";
import { useViews } from "./views";

export interface TaskRef { file: string; line: number }
export interface Toast { text: string; undo: TaskChangedEvent | null }

export const useTasks = create<{
  task: TaskRef | null; // the one on screen
  detail: TaskDetailEvent | null;
  toast: Toast | null;
  next: { after: HomeTask | null; index: number } | null; // after done / drop / snooze on the task screen
}>(() => ({ task: null, detail: null, toast: null, next: null }));

const DONE_TEXT: Record<TaskChangedEvent["action"], string> = {
  done: "Done", drop: "Marked as not doing", snooze: "Snoozed", restore: "Put back",
};

/** "Done: Add approval gates…" / "Snoozed until Mon 27 Oct: …". */
export function toastText(ev: TaskChangedEvent): string {
  const until = ev.raw.match(/⏳\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  const when = ev.action === "snooze" && until
    ? ` until ${new Date(`${until}T09:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}` : "";
  const what = ev.raw.replace(/^\s*[-*+] \[.\]\s+/, "").replace(/\s*(✅|❌|⏳)\s*\d{4}-\d{2}-\d{2}/g, "");
  return `${DONE_TEXT[ev.action]}${when}: ${what.length > 60 ? what.slice(0, 59) + "…" : what}`;
}

/** Snooze choices: later today isn't a date, so "tomorrow" is the nearest. */
export function snoozeDays(now: Date): { label: string; hint: string; date: string }[] {
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const add = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return d; };
  const monday = add(((8 - now.getDay()) % 7) || 7);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return [
    { label: "Tomorrow", hint: fmt(add(1)), date: day(add(1)) },
    { label: "Next week", hint: fmt(monday), date: day(monday) },
    { label: "In a month", hint: fmt(add(30)), date: day(add(30)) },
  ];
}

export function openTask(t: TaskRef) {
  useTasks.setState({ task: t, detail: null });
  useViews.setState({ view: "task" });
  send({ type: "task_detail", file: t.file, line: t.line });
}

export const sameTask = (a: TaskRef | null, b: TaskRef | null) => !!a && !!b && a.file === b.file && a.line === b.line;

/** Done, not doing, or snooze; from Home's checkbox or the task screen. */
export function changeTask(t: HomeTask | { file: string; line: number; raw: string }, action: "done" | "drop" | "snooze", until?: string) {
  const list = useHome.getState().notes?.tasks ?? [];
  const onScreen = useViews.getState().view === "task" && sameTask(useTasks.getState().task, t);
  if (onScreen) { // go on to the task that followed (the list may re-sort: the note just became the newest)
    const i = list.findIndex((x) => sameTask(x, t));
    useTasks.setState({ next: { after: list[i + 1] ?? list[i - 1] ?? null, index: Math.max(0, i) } });
  }
  send(until ? { type: "task_action", file: t.file, line: t.line, expect: t.raw, action, until } : { type: "task_action", file: t.file, line: t.line, expect: t.raw, action });
}

export function undo() {
  const ev = useTasks.getState().toast?.undo;
  if (!ev) return;
  useTasks.setState({ toast: null, next: null });
  send({ type: "task_action", file: ev.file, line: ev.line, expect: ev.raw, action: "restore", value: ev.previous });
}

export function wireTasks(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offs = [
    on("task_detail", (ev) => { if (sameTask(useTasks.getState().task, ev)) useTasks.setState({ detail: ev }); }),
    on("task_changed", (ev) => {
      clearTimeout(timer);
      useTasks.setState({ toast: { text: toastText(ev), undo: ev.action === "restore" ? null : ev } });
      timer = setTimeout(() => useTasks.setState({ toast: null }), 10000);
      if (sameTask(useTasks.getState().task, ev)) send({ type: "task_detail", file: ev.file, line: ev.line });
    }),
    on("home", (ev) => { // the list after a change on the task screen: go on to the next task
      const { next } = useTasks.getState();
      if (next === null) return;
      useTasks.setState({ next: null });
      const t = (next.after && ev.tasks.find((x) => sameTask(x, next.after))) ?? ev.tasks[Math.min(next.index, ev.tasks.length - 1)];
      if (t) openTask(t); else useViews.setState({ view: "home" });
    }),
  ];
  return () => { clearTimeout(timer); offs.forEach((off) => off()); };
}
