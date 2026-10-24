// What the page shows, as plain text for the model: sent whenever the screen changes, and the server
// puts it in front of the next typed or spoken request, so "summarize this page" means this page.
// The chat itself sends nothing (Claude already sees the conversation).
import type { FolderItem, HomeEvent, HomeWatchEvent, RoutinesEvent, TaskDetailEvent } from "../protocol.gen";
import { send } from "../ws";
import { useConnection } from "./connection";
import { useFeatures } from "./features";
import { useHome, needsYou, brief } from "./home";
import { useSession } from "./session";
import { useTasks } from "./tasks";
import { routineById, routineText, useRoutineScreen } from "./routine";
import { activityRows, routineStatus, useViews, type View } from "./views";

const day = (ts: number) => new Date(ts * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const flat = (parts: (string | { b: string })[]) => parts.map((p) => (typeof p === "string" ? p : p.b)).join("");

/** The server cuts the screen text at this many characters (server.py SCREEN_MAX), so the least useful lines go last. */
export const SCREEN_MAX = 8000;

export function homeText(folders: FolderItem[], routines: RoutinesEvent | null, notes: HomeEvent | null, vault: string, routinesOn: boolean, watch: HomeWatchEvent | null = null): string {
  const n = needsYou(folders, routines);
  const out = ["Home, a brief of the day.", brief({ waiting: n.waiting, done: n.done, routines, notes, vault: !!vault, routinesOn, watch }).map(flat).join(" ")];
  const sessions = [...n.waiting, ...n.done, ...n.working];
  if (sessions.length) out.push("Sessions:", ...sessions.map((x) => `- ${x.label || "New session"} (${x.folder.label}, ${x.status === "approval" ? "waiting for an approval" : x.status === "done" ? "finished while away" : "working"})`));
  const tr = watch?.tracker;
  if (tr?.tasks.length) out.push(`Open tasks in Vikunja (${tr.total}, most urgent first; the task list of record):`, ...tr.tasks.slice(0, 12).map((t) => `- #${t.id} ${t.title} (${t.project || "no project"}${t.due ? `, due ${t.due}` : ""})`));
  if (routinesOn && routines) out.push("Routines (scheduled cloud agents):", ...routines.items.map((x) => `- ${x.name}: ${routineStatus(x)}${x.next_run_at ? `, next ${day(x.next_run_at)}` : ""}`));
  if (watch?.repos.length) out.push("Repos with unsaved work:", ...watch.repos.slice(0, 8).map((r) => `- ${r.label}${r.branch ? ` (${r.branch})` : ""}: ${r.changed} changed file${r.changed === 1 ? "" : "s"}${r.ahead ? `, ${r.ahead} unpushed commit${r.ahead === 1 ? "" : "s"}` : ""}`));
  if (watch?.prs.length) out.push("Open pull requests:", ...watch.prs.slice(0, 8).map((p) => `- ${p.repo}#${p.number} ${p.title}${p.draft ? " (draft)" : ""}, quiet ${p.idle_days} day${p.idle_days === 1 ? "" : "s"}`));
  if (watch?.reminders.length) out.push("Reminders:", ...watch.reminders.slice(0, 8).map((r) => `- ${r.text}${r.due ? ` (due ${r.due}${r.days != null && r.days < 0 ? ", overdue" : ""})` : ""}`));
  // Notes are context: with Vikunja set up its tasks lead and the notes' checkboxes shrink to a few.
  if (notes?.tasks.length) out.push(`Open tasks from the notes (${notes.open_tasks}, newest first; file:line in the notes folder ${vault}):`, ...notes.tasks.slice(0, tr ? 5 : 12).map((t) => `- [ ] ${t.text} (${t.file}:${t.line})`));
  if (notes?.notes.length) out.push("Recently changed notes:", ...notes.notes.map((x) => `- ${x.title} (${x.file})`));
  // Trim whole lines from the end rather than letting the server cut a line in half.
  let text = out.join("\n");
  while (text.length > SCREEN_MAX && out.length > 2) { out.pop(); text = out.join("\n"); }
  return text;
}

export function taskText(d: TaskDetailEvent, vault: string): string {
  return [`A task from the notes folder ${vault}: ${d.file}, line ${d.line}, under "${d.heading}" in the note "${d.title}".`,
    `The task line: ${d.raw}`, "The note around it:", ...d.context.map((l) => `${l.n}: ${l.text}`)].join("\n");
}

/** The current screen's name and text; null when it's the chat (or nothing worth sending). */
export function currentScreen(view: View): { name: string; text: string } | null {
  const f = useFeatures.getState();
  const vault = f.features?.vault ?? "";
  if (view === "home") return { name: "Home", text: homeText(f.folders, useViews.getState().routines, useHome.getState().notes, vault, !!f.features?.routines, useHome.getState().watch) };
  if (view === "task") {
    const d = useTasks.getState().detail;
    return d ? { name: "Task", text: taskText(d, vault) } : null;
  }
  if (view === "routine") {
    const x = routineById(useRoutineScreen.getState().id);
    return x ? { name: "Routine", text: routineText(x) } : null;
  }
  if (view === "activity") {
    const rows = activityRows(f.folders);
    return { name: "Activity", text: ["Activity: sessions working, waiting or done.", ...rows.map((x) => `- ${x.label || "New session"} (${x.folder.label}): ${x.status}`)].join("\n") };
  }
  if (view === "routines") {
    const r = useViews.getState().routines;
    return { name: "Routines", text: ["Routines: scheduled cloud agents on claude.ai.", ...(r?.items ?? []).map((x) => `- ${x.name}: ${routineStatus(x)}${x.last?.summary ? `. Last run: ${x.last.summary.slice(0, 300)}` : ""}`)].join("\n") };
  }
  return null;
}

export function wireScreen(): () => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const push = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (useConnection.getState().state !== "online" || !useSession.getState().session) return;
      const s = currentScreen(useViews.getState().view);
      const key = s ? `${s.name}\n${s.text}` : "";
      if (key === last) return;
      last = key;
      send(s ? { type: "screen", name: s.name, text: s.text } : { type: "screen", name: null });
    }, 300);
  };
  const offs = [useViews.subscribe(push), useHome.subscribe(push), useTasks.subscribe(push), useFeatures.subscribe(push), useRoutineScreen.subscribe(push),
    useSession.subscribe((s, prev) => { if (s.session !== prev.session) { last = ""; push(); } }), // a session opened: tell it
    useConnection.subscribe((s, prev) => { if (s.state !== prev.state) { last = ""; push(); } })];
  return () => { clearTimeout(timer); offs.forEach((off) => off()); };
}
