// Item pages: a table per source (Vikunja tasks, open pull requests, repos with unsaved work) and one page per
// item. The page only sends the source and the item's id; the server fetches it and finds the repo itself.
import { create } from "zustand";
import type { ItemEvent, ItemListEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useViews } from "./views";
import { useFeatures } from "./features";

export type ItemSource = ItemListEvent["source"];
export const SOURCES: ItemSource[] = ["vikunja", "prs", "repos", "notes", "tasks"];

export const useItems = create<{ source: ItemSource | null; id: string | null; lists: Partial<Record<ItemSource, ItemListEvent>>; item: ItemEvent | null }>(
  () => ({ source: null, id: null, lists: {}, item: null }));

export function openItems(source: ItemSource) {
  useItems.setState({ source });
  useViews.setState({ view: "items" });
  send({ type: "item_list", source });
}

export function openItem(source: ItemSource, id: string) {
  useItems.setState({ source, id, item: null });
  useViews.setState({ view: "item" });
  send({ type: "item_get", source, id });
}

/** Archive: Vikunja has no per-task archive, so this marks the task done (done=false brings it back). */
export function archiveItem(source: ItemSource, id: string, done = true) {
  send({ type: "item_done", source, id, done });
}

/** Start the item in its repo (the server finds it): `where` cli = a background Claude Code session in the terminal,
 *  browser = a new Orb session; left out, the server uses the settings' "start_in". */
export function startItem(source: ItemSource, id: string, where?: StartWhere) {
  send(where ? { type: "item_start", source, id, where } : { type: "item_start", source, id });
}

export type StartWhere = "cli" | "browser";

/** Where Start goes by default: the settings' "start_in" (cli for a new install). */
export const startWhere = (): StartWhere => useFeatures.getState().features?.start_in ?? "cli";
/** The two Start buttons: a background Claude Code session in the terminal (`claude --bg`, the `claude agents` view)
 *  or a new Orb session; `OTHER` names the secondary button beside the default one. */
export const START: Record<StartWhere, string> = { cli: "Start in CLI", browser: "Start in Orb" };
export const START_TITLE: Record<StartWhere, string> = {
  cli: "A background Claude Code session in this repo, in your terminal: it shows in `claude agents`",
  browser: "A new Orb session in this repo that proposes a plan first",
};
export const OTHER: Record<StartWhere, StartWhere> = { cli: "browser", browser: "cli" };

export function wireItems(): () => void {
  const offs = [
    on("item", (ev) => { const s = useItems.getState(); if (ev.source === s.source && ev.id === s.id) useItems.setState({ item: ev }); }),
    on("item_list", (ev) => useItems.setState((s) => ({ lists: { ...s.lists, [ev.source]: ev } }))),
  ];
  return () => offs.forEach((off) => off());
}
