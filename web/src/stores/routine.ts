// One routine's last result on its own screen: what to do with it. Orb's routine access stays
// read-only; the only things written are a line in your notes inbox ("make it a task", with Undo)
// and Orb's own "read" mark.
import { create } from "zustand";
import type { RoutineItem } from "../protocol.gen";
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
export const markAllRead = () => send({ type: "routines_seen", all: true });
export const makeTask = (id: string) => send({ type: "routine_task", id });

export const routineById = (id: string | null): RoutineItem | null =>
  (id && useViews.getState().routines?.items.find((x) => x.id === id)) || null;

/** What Claude is shown about this result (plain text; the server fences it as untrusted data). */
export function routineText(x: RoutineItem): string {
  const l = x.last;
  return [`Routine "${x.name}" (a scheduled agent on claude.ai).`,
    l ? `Last run ${l.outcome ?? "unknown"}${l.at ? ` at ${new Date(l.at * 1000).toLocaleString("en-GB")}` : ""}.` : "It has no runs yet.",
    x.why ? `Orb's quick judgement of the result: ${x.why}` : "", "The result:", l?.detail || l?.summary || "(none)"].filter(Boolean).join("\n");
}

/** "Ask Claude about it": a new session in the notes folder; the result goes along as the screen, not in the
 *  question, and the answer shows right under the result (the page stays here). */
export function askAbout(x: RoutineItem) {
  const vault = useFeatures.getState().features?.vault;
  if (!vault) { useSession.setState({ picker: "new" }); return; }
  askIn(vault, `What does the result of my routine "${x.name}" say, and is there anything I should do about it?`, { name: "Routine", text: routineText(x) }, true);
}
