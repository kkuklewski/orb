// Item pages: a table per source (Vikunja tasks, open pull requests, repos with unsaved work) and one page per
// item. The page only sends the source and the item's id; the server fetches it and finds the repo itself.
import { create } from "zustand";
import type { ItemEvent, ItemListEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useViews } from "./views";

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

export function startItem(source: ItemSource, id: string) {
  send({ type: "item_start", source, id });
}

export function wireItems(): () => void {
  const offs = [
    on("item", (ev) => { const s = useItems.getState(); if (ev.source === s.source && ev.id === s.id) useItems.setState({ item: ev }); }),
    on("item_list", (ev) => useItems.setState((s) => ({ lists: { ...s.lists, [ev.source]: ev } }))),
  ];
  return () => offs.forEach((off) => off());
}
