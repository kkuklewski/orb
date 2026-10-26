// The Home chat dock (GLOSSARY.md Home chat, ADR 0002): the vault session on the right of Brain, Tasks and Routines,
// toggled by the top bar's Home chat chip. It lies over the screen and never resizes what is under it; the owner can
// drag its width. Open or closed is kept per destination for this page load. Opened on an item (a note, note task,
// routine or task), the chat is told about that item, named in an "about" chip the owner can remove.
import { create } from "zustand";
import { SOURCE_DESTINATION, type Destination } from "./bar";
import type { ItemSource } from "./items";
import { useItems } from "./items";
import { useBrain } from "./brain";
import { useTasks } from "./tasks";
import { useRoutineScreen } from "./routine";
import { useFeatures } from "./features";
import { openFolder, useSession } from "./session";
import { useViews, type View } from "./views";

export const DOCKED: Destination[] = ["brain", "tasks", "routines"];
/** The main area's least width beside the dock (the CSS variable --main-min says the same). */
export const MAIN_MIN = 560;

export const useDock = create<{
  open: Partial<Record<Destination, boolean>>;
  dropped: string | null; // the item whose about chip the owner removed
}>(() => ({ open: {}, dropped: null }));

/** The destination a view belongs to when it can have the dock; null when it can't (Home, Sessions, Settings, a chat). */
export function dockDest(view: View, source: ItemSource | null): Destination | null {
  if (view === "brain" || view === "note" || view === "task") return "brain";
  if (view === "tasks") return "tasks";
  if (view === "routines" || view === "routine") return "routines";
  if ((view === "items" || view === "item") && source) {
    const d = SOURCE_DESTINATION[source];
    return DOCKED.includes(d) ? d : null;
  }
  return null;
}

const here = () => dockDest(useViews.getState().view, useItems.getState().source);

/** The dock shows on this screen. */
export const dockShown = (): boolean => {
  const d = here();
  return !!d && !!useDock.getState().open[d];
};

/** The Home chat is the vault's session: the dock opens it (quietly: the screen stays) when another one is open. Once
 *  only: while a quiet open is on its way, a second one would arrive after `quiet` is spent and switch to the chat. */
export function bindVault() {
  const vault = useFeatures.getState().features?.vault;
  const { folder, quiet } = useSession.getState();
  if (!vault || folder === vault || quiet) return;
  useSession.setState({ quiet: true });
  openFolder(vault);
}

export function toggleDock() {
  const d = here();
  if (!d) return;
  const on = !useDock.getState().open[d];
  useDock.setState((s) => ({ open: { ...s.open, [d]: on }, dropped: on ? null : s.dropped }));
  if (on) { useSession.setState({ drawer: false }); bindVault(); } // on a narrow screen one sheet at a time
}

export function closeDock() {
  const d = here();
  if (d) useDock.setState((s) => ({ open: { ...s.open, [d]: false } }));
}

export interface About { key: string; label: string }

/** The item on screen, if this view is one. */
export function itemOnScreen(view: View): About | null {
  if (view === "note") {
    const { note, file } = useBrain.getState();
    return note && note.file === file ? { key: `note:${note.file}`, label: note.title } : null;
  }
  if (view === "task") {
    const d = useTasks.getState().detail;
    return d ? { key: `task:${d.file}:${d.line}`, label: d.title } : null;
  }
  if (view === "routine") {
    const id = useRoutineScreen.getState().id;
    const r = useViews.getState().routines?.items.find((x) => x.id === id);
    return id ? { key: `routine:${id}`, label: r?.name ?? id } : null;
  }
  if (view === "item") {
    const { item, source, id } = useItems.getState();
    return item && item.source === source && item.id === id ? { key: `item:${source}:${id}`, label: item.title || String(id) } : null;
  }
  return null;
}

/** The about chip: the item on screen, unless the owner removed it. */
export function aboutNow(view: View): About | null {
  const a = itemOnScreen(view);
  return a && a.key !== useDock.getState().dropped ? a : null;
}

export const dropAbout = (key: string) => useDock.setState({ dropped: key });

export type DockLayout = "beside" | "over" | "sheet";

/** Where the dock sits: a sheet from the bottom on a narrow screen; else over the right of the main area, "beside" (four
 *  columns) while the main area keeps `min` px next to it, "over" when the dock covers part of it. Pure, for tests. */
export function dockLayout(mainW: number, dockW: number, narrow: boolean, min = MAIN_MIN): DockLayout {
  if (narrow) return "sheet";
  return mainW - dockW >= min ? "beside" : "over";
}

/** Columns showing: rail, panel (when the screen has one), main and dock; the dock as a sheet isn't a column. */
export const columnCount = (layout: DockLayout, panel: boolean) => (layout === "sheet" ? 1 : 1 + (panel ? 1 : 0) + (layout === "beside" ? 2 : 1));
