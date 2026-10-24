// One Vikunja task: its screen (full description, the repo its project maps to) and "Start in Orb".
// The page only sends the task's id; the server fetches the task and finds the repo itself.
import { create } from "zustand";
import type { VikunjaListEvent, VikunjaTaskEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useViews } from "./views";

export const useVikunja = create<{ id: number | null; task: VikunjaTaskEvent | null; list: VikunjaListEvent | null }>(
  () => ({ id: null, task: null, list: null }));

export function openVikunjaList() {
  useViews.setState({ view: "vikunjas" });
  send({ type: "vikunja_list" });
}

export function openVikunjaTask(id: number) {
  useVikunja.setState({ id, task: null });
  useViews.setState({ view: "vikunja" });
  send({ type: "vikunja_task", id });
}

/** Archive: Vikunja has no per-task archive, so this marks the task done (done=false brings it back). */
export function archiveVikunjaTask(id: number, done = true) {
  send({ type: "vikunja_done", id, done });
}

export function startVikunjaTask(id: number) {
  send({ type: "vikunja_start", id });
}

export function wireVikunja(): () => void {
  const offs = [
    on("vikunja_task", (ev) => { if (ev.id === useVikunja.getState().id) useVikunja.setState({ task: ev }); }),
    on("vikunja_list", (ev) => useVikunja.setState({ list: ev })),
  ];
  return () => offs.forEach((off) => off());
}
