// What the top bar says: "destination › item" (ADR 0002, GLOSSARY.md Destination). The session chips belong to a
// session in the main area only; the Home chat chip to Brain, Tasks and Routines. Pure, for tests.
import type { View } from "./views";
import type { ItemSource } from "./items";

export type Destination = "home" | "sessions" | "brain" | "tasks" | "routines" | "settings";

export const DESTINATION: Record<Destination, string> = {
  home: "Home", sessions: "Sessions", brain: "Brain", tasks: "Tasks", routines: "Routines", settings: "Settings",
};

/** Where each item source lives: Tasks are Vikunja's, notes and note tasks are Brain's, the Don't forget lists Home's. */
export const SOURCE_DESTINATION: Record<ItemSource, Destination> = { vikunja: "tasks", notes: "brain", tasks: "brain", prs: "home", repos: "home" };
const SOURCE_LIST: Record<ItemSource, string | null> = { vikunja: null, notes: "Waiting for a verdict", tasks: "Note tasks", prs: "Pull requests", repos: "Unsaved work" };

export interface BarInput {
  view: View;
  folder: string | null;
  vault: string;
  repo: string; // the open folder's name
  label: string | null; // the open session's label (its first request)
  items: { source: ItemSource; id: string | null; title: string | null } | null;
  task: string | null; // the note task's text
  routine: string | null; // the routine's name
  note: string | null; // the note's title, on its page in Brain
}

export interface Bar {
  dest: Destination;
  item: string | null;
  session: boolean; // the main area is a session: its chips and meta line show
  homeChat: boolean; // the Home chat chip shows
}

function where(s: BarInput): Omit<Bar, "homeChat"> {
  switch (s.view) {
    case "chat": {
      if (!s.folder) return { dest: "sessions", item: null, session: false };
      if (s.vault && s.folder === s.vault) return { dest: "home", item: s.label ? `Home chat · ${s.label}` : "Home chat", session: true }; // the vault session is the Home chat
      return { dest: "sessions", item: s.label ? `${s.repo} · ${s.label}` : s.repo, session: true };
    }
    case "note": return { dest: "brain", item: s.note, session: false };
    case "task": return { dest: "brain", item: s.task || "Note task", session: false };
    case "routine": return { dest: "routines", item: s.routine, session: false };
    case "items": case "item": {
      if (!s.items) return { dest: "home", item: null, session: false };
      const { source, id, title } = s.items;
      if (s.view === "items") return { dest: SOURCE_DESTINATION[source], item: SOURCE_LIST[source], session: false };
      const item = source === "vikunja" && id && /^\d+$/.test(id) ? `#${id}${title ? ` ${title}` : ""}` : title || id;
      return { dest: SOURCE_DESTINATION[source], item, session: false };
    }
    default: return { dest: s.view as Destination, item: null, session: false };
  }
}

export function barFor(s: BarInput): Bar {
  const w = where(s);
  return { ...w, homeChat: !!s.vault && !w.session && ["brain", "tasks", "routines"].includes(w.dest) };
}
