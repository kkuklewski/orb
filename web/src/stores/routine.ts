// One routine's last result on its own screen: what to do with it. Orb's routine access stays
// read-only; Orb writes its own "read" mark, and "Make it a task" writes one Vikunja task after a card.
import { create } from "zustand";
import type { MakeTaskCardEvent, MakeTaskDoneEvent, MakeTaskUndoneEvent, RoutineItem } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { askIn, useSession } from "./session";
import { useFeatures } from "./features";
import { useViews } from "./views";

export const useRoutineScreen = create<{ id: string | null }>(() => ({ id: null }));

export function openRoutine(id: string) {
  useRoutineScreen.setState({ id });
  useViews.setState({ view: "routine" });
  if (!useViews.getState().routines) send({ type: "routines" });
}

export const markRead = (id: string) => send({ type: "routines_seen", id });
export const markRunsRead = () => send({ type: "routines_seen", all: true });

/** A judged problem (broken, action) you dealt with: that run stops counting; the next run is judged afresh.
 *  Failed, stuck and missed runs clear only when a run succeeds. */
export const resolvable = (x: RoutineItem | null | undefined) => !!x && (x.needs === "broken" || x.needs === "action");
export const resolveRun = (id: string, undo = false) => send({ type: "routines_resolve", id, undo });

export const routineById = (id: string | null): RoutineItem | null =>
  (id && useViews.getState().routines?.items.find((x) => x.id === id)) || null;

/** What Claude is shown about this run (plain text; the server fences it as untrusted data). */
export function routineText(x: RoutineItem): string {
  const l = x.last;
  return [`Routine "${x.name}" (a scheduled agent on claude.ai).`,
    l ? `Last run ${l.outcome ?? "unknown"}${l.at ? ` at ${new Date(l.at * 1000).toLocaleString("en-GB")}` : ""}.` : "It has no runs yet.",
    x.why ? `Orb's quick judgement of the run: ${x.why}` : "", "What the run reported:", l?.detail || l?.summary || "(none)"].filter(Boolean).join("\n");
}

/** "Ask Claude about it": a new session in the notes folder; the run goes along as the screen, not in the
 *  question, and the answer shows right under the run (the page stays here). */
export function askAbout(x: RoutineItem) {
  const vault = useFeatures.getState().features?.vault;
  if (!vault) { useSession.setState({ picker: "new" }); return; }
  askIn(vault, `What does the last run of my routine "${x.name}" say, and is there anything I should do about it?`, { name: "Routine", text: routineText(x) }, true);
}

/** "Make it a task" (ADR 0008): the server answers with a card naming the title and the project; only Allow creates
 *  the task, and Undo deletes that one task. One card at a time, for the routine it was asked for. */
export const useMakeTask = create<{ routine: string | null; pending: boolean; card: MakeTaskCardEvent | null;
  done: MakeTaskDoneEvent | null; undone: MakeTaskUndoneEvent | null }>(
  () => ({ routine: null, pending: false, card: null, done: null, undone: null }));

export function makeTask(id: string) {
  useMakeTask.setState({ routine: id, pending: true, card: null, done: null, undone: null });
  send({ type: "make_task", routine: id });
}
export const confirmTask = (id: string, ok: boolean) => send({ type: "make_task_confirm", id, ok });
export const undoTask = (task: number) => send({ type: "make_task_undo", task });

export function wireMakeTask(): () => void {
  const offs = [
    on("make_task_card", (ev) => { if (ev.routine === useMakeTask.getState().routine) useMakeTask.setState({ pending: false, card: ev }); }),
    on("make_task_done", (ev) => { if (ev.id === useMakeTask.getState().card?.id) useMakeTask.setState({ done: ev }); }),
    on("make_task_undone", (ev) => { if (ev.task === useMakeTask.getState().done?.task) useMakeTask.setState({ undone: ev }); }),
    on("error", () => { if (useMakeTask.getState().pending) useMakeTask.setState({ pending: false, routine: null }); }),
  ];
  return () => offs.forEach((off) => off());
}
