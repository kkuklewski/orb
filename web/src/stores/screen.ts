// What the page shows, as plain text for the model: sent whenever the screen changes, and the server
// puts it in front of the next typed or spoken request, so "summarize this page" means this page.
// The chat itself sends nothing (Claude already sees the conversation).
import type { BrainNote, BrainNoteEvent, FolderItem, HomeEvent, HomeForgetEvent, HomeTasksEvent, ItemEvent, ItemListEvent, RoutinesEvent, TaskDetailEvent } from "../protocol.gen";
import { send } from "../ws";
import { useConnection } from "./connection";
import { trackerName, useFeatures } from "./features";
import { useHome, needsYou, brief, delegText, vikunjaTasks } from "./home";
import { useItems } from "./items";
import { pinsNote, usePins } from "./pins";
import { useSession } from "./session";
import { useTasks } from "./tasks";
import { routineById, routineText, useRoutineScreen } from "./routine";
import { brainRows, headerLine, useBrain, verdictText } from "./brain";
import { activityRows, routineStatus, useViews, type View } from "./views";
import { aboutNow, dockShown, itemOnScreen, useDock } from "./dock";

const day = (ts: number) => new Date(ts * 1000).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const flat = (parts: (string | { b: string })[]) => parts.map((p) => (typeof p === "string" ? p : p.b)).join("");

/** The server cuts the screen text at this many characters (server.py SCREEN_MAX), so the least useful lines go last. */
export const SCREEN_MAX = 8000;

export function homeText(folders: FolderItem[], routines: RoutinesEvent | null, notes: HomeEvent | null, vault: string, routinesOn: boolean, forget: HomeForgetEvent | null = null, tasks: HomeTasksEvent | null = null): string {
  const n = needsYou(folders, useHome.getState().plan);
  const pinned = pinsNote(usePins.getState().pins);
  const out = [...(pinned ? [pinned] : []), "Home, a brief of the day.", brief({ waiting: n.waiting, done: n.done, routines, notes, vault: !!vault, routinesOn, tasks }).map(flat).join(" ")];
  const sessions = [...n.waiting, ...n.done, ...n.working];
  if (sessions.length) out.push("Sessions:", ...sessions.map((x) => `- ${x.label || "New session"} (${x.folder.label}, ${x.status === "approval" ? "waiting for an approval" : x.status === "done" ? "finished while away" : "working"})`));
  if (n.delegations.length) out.push("Delegations that need the owner:", ...n.delegations.map((d) => `- ${delegText(d)}`));
  if (n.items.length) out.push("Needs you (blocked or broken until the owner acts, most important first):", ...n.items.map((p) => `- ${p.title}: ${p.reason}`));
  const tr = vikunjaTasks(tasks);
  if (tr?.tasks.length) out.push(`Open tasks in ${trackerName()} (${tr.total}, most urgent first; the task list of record):`, ...tr.tasks.slice(0, 12).map((t) => `- #${t.id} ${t.title} (${t.project || "no project"}${t.due ? `, due ${t.due}` : ""})`));
  if (routinesOn && routines) out.push("Routines (scheduled cloud agents):", ...routines.items.map((x) => `- ${x.name}: ${routineStatus(x)}${x.next_run_at ? `, next ${day(x.next_run_at)}` : ""}`));
  if (forget?.repos.length) out.push("Repos with unsaved work:", ...forget.repos.slice(0, 8).map((r) => `- ${r.label}${r.branch ? ` (${r.branch})` : ""}: ${r.changed} changed file${r.changed === 1 ? "" : "s"}${r.ahead ? `, ${r.ahead} unpushed commit${r.ahead === 1 ? "" : "s"}` : ""}`));
  if (forget?.prs.length) out.push("Open pull requests:", ...forget.prs.slice(0, 8).map((p) => `- ${p.repo}#${p.number} ${p.title}${p.draft ? " (draft)" : ""}, quiet ${p.idle_days} day${p.idle_days === 1 ? "" : "s"}`));
  if (forget?.reminders.length) out.push("Reminders:", ...forget.reminders.slice(0, 8).map((r) => `- ${r.text}${r.due ? ` (due ${r.due}${r.days != null && r.days < 0 ? ", overdue" : ""})` : ""}`));
  // Notes are context: with Vikunja set up its tasks lead and the notes' checkboxes shrink to a few.
  if (notes?.tasks.length) out.push(`Open tasks from the notes (${notes.open_tasks}, newest first; file:line in the notes folder ${vault}):`, ...notes.tasks.slice(0, tr ? 5 : 12).map((t) => `- [ ] ${t.text} (${t.file}:${t.line})`));
  if (notes?.notes.length) out.push("Recently changed notes:", ...notes.notes.map((x) => `- ${x.title} (${x.file})`));
  // Trim whole lines from the end rather than letting the server cut a line in half.
  let text = out.join("\n");
  while (text.length > SCREEN_MAX && out.length > (pinned ? 3 : 2)) { out.pop(); text = out.join("\n"); }
  return text;
}

export function taskText(d: TaskDetailEvent, vault: string): string {
  return [`A task from the notes folder ${vault}: ${d.file}, line ${d.line}, under "${d.heading}" in the note "${d.title}".`,
    `The task line: ${d.raw}`, "The note around it:", ...d.context.map((l) => `${l.n}: ${l.text}`)].join("\n");
}

/** One item page (a task, pull request, repo with unsaved work or note), so "this one" means it. */
export function itemText(i: ItemEvent): string {
  const out = [`${i.kicker}${i.done ? " (done)" : ""}: ${i.title} (id ${i.id}, source ${i.source}${i.repo ? `, repo ${i.repo}` : ""}).`];
  if (i.chips.length) out.push(`Chips: ${i.chips.join(", ")}`);
  if (i.body) out.push("What it says:", i.body.slice(0, 4000));
  return out.join("\n");
}

/** A source's table: one line per row with its cells, cut whole lines from the end at SCREEN_MAX. */
export function itemListText(l: ItemListEvent): string {
  const label = Object.fromEntries(l.columns.map((c) => [c.key, c.label]));
  const lines = l.rows.map((r) => {
    const cells = Object.entries(r.cells).filter(([k, v]) => v && k !== "title" && k !== "repo").map(([k, v]) => `${label[k] ?? k} ${v}`);
    if (r.repo) cells.unshift(`repo ${r.repo}`);
    return `- ${r.title} (id ${r.id}${cells.length ? `, ${cells.join(", ")}` : ""})`;
  });
  const out = [`${l.heading}: ${l.rows.length} item${l.rows.length === 1 ? "" : "s"} (${l.kicker}).`, ...lines];
  while (out.join("\n").length > SCREEN_MAX && out.length > 2) out.pop();
  return out.join("\n");
}

/** Brain's list as the owner sees it: filtered, in its kept order. */
export function brainText(rows: BrainNote[], vault: string): string {
  const out = [`Brain: ${rows.length} recent note${rows.length === 1 ? "" : "s"} in the notes folder ${vault}, as listed (file, kind, score, verdict).`,
    ...rows.map((n) => `- ${n.title} (${n.file}, ${n.kind}${n.score != null ? `, score ${n.score}` : ""}${n.verdict ? `, ${verdictText(n.verdict)}` : n.waiting ? ", waiting for a verdict" : ""})`)];
  while (out.join("\n").length > SCREEN_MAX && out.length > 2) out.pop();
  return out.join("\n");
}

/** One note on its page: where it is, its header line and verdict, then its text (cut to fit). */
export function noteText(n: BrainNoteEvent, vault: string): string {
  const head = [`A note in the notes folder ${vault}: ${n.file}, "${n.title}" (${n.kind}).`, headerLine(n),
    n.verdict ? `Verdict: ${verdictText(n.verdict)}.` : n.waiting ? "Waiting for the owner's verdict (approve or reject)." : ""].filter(Boolean).join(" ");
  return `${head}\n\n${n.body}`.slice(0, SCREEN_MAX);
}

/** The current screen's name and text; null when it's the chat (or nothing worth sending). */
export function currentScreen(view: View): { name: string; text: string } | null {
  const f = useFeatures.getState();
  const vault = f.features?.vault ?? "";
  if (view === "home") return { name: "Home", text: homeText(f.folders, useViews.getState().routines, useHome.getState().notes, vault, !!f.features?.routines, useHome.getState().forget, useHome.getState().tasks) };
  if (view === "task") {
    const d = useTasks.getState().detail;
    return d ? { name: "Task", text: taskText(d, vault) } : null;
  }
  if (view === "routine") {
    const x = routineById(useRoutineScreen.getState().id);
    return x ? { name: "Routine", text: routineText(x) } : null;
  }
  if (view === "item") {
    const i = useItems.getState().item;
    return i ? { name: "Item", text: itemText(i) } : null;
  }
  if (view === "items") {
    const { source, lists } = useItems.getState();
    const l = source ? lists[source] : undefined;
    return l ? { name: "Items", text: itemListText(l) } : null;
  }
  if (view === "brain") {
    const b = useBrain.getState();
    return b.list ? { name: "Brain", text: brainText(brainRows(b.list.notes, b.filter, b.snap), vault) } : null;
  }
  if (view === "note") {
    const { note, file } = useBrain.getState();
    return note && note.file === file ? { name: "Note", text: noteText(note, vault) } : null;
  }
  if (view === "sessions") {
    const rows = activityRows(f.folders);
    return { name: "Sessions", text: ["Sessions: the ones working, waiting or done.", ...rows.map((x) => `- ${x.label || "New session"} (${x.folder.label}): ${x.status}`)].join("\n") };
  }
  if (view === "tasks") {
    const l = useItems.getState().lists.vikunja;
    return l ? { name: "Tasks", text: itemListText(l) } : null;
  }
  if (view === "routines") {
    const r = useViews.getState().routines;
    return { name: "Routines", text: ["Routines: scheduled cloud agents on claude.ai.", ...(r?.items ?? []).map((x) => `- ${x.name}: ${routineStatus(x)}${x.last?.summary ? `. Last run: ${x.last.summary.slice(0, 300)}` : ""}`)].join("\n") };
  }
  return null;
}

/** What to send: the current screen, except that with the Home chat dock open on an item, the item goes only while its
 *  about chip is there (removing the chip drops it). */
export function screenFor(view: View): { name: string; text: string } | null {
  if (!dockShown() || !itemOnScreen(view)) return currentScreen(view);
  return aboutNow(view) ? currentScreen(view) : null;
}

export function wireScreen(): () => void {
  let last = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const push = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (useConnection.getState().state !== "online" || !useSession.getState().session) return;
      const s = screenFor(useViews.getState().view);
      const key = s ? `${s.name}\n${s.text}` : "";
      if (key === last) return;
      last = key;
      send(s ? { type: "screen", name: s.name, text: s.text } : { type: "screen", name: null });
    }, 300);
  };
  const offs = [useViews.subscribe(push), useHome.subscribe(push), useTasks.subscribe(push), useItems.subscribe(push), useFeatures.subscribe(push), useRoutineScreen.subscribe(push), useBrain.subscribe(push), usePins.subscribe(push), useDock.subscribe(push),
    useSession.subscribe((s, prev) => { if (s.session !== prev.session) { last = ""; push(); } }), // a session opened: tell it
    useConnection.subscribe((s, prev) => { if (s.state !== prev.state) { last = ""; push(); } })];
  return () => { clearTimeout(timer); offs.forEach((off) => off()); };
}
