// Pins: dashboard rows the user marked as "this one". They ride along as references (ids, never pasted text)
// in the Home screen note, so the model looks the items up with the desk tools. Reminders have no stable id: no pin.
import { create } from "zustand";
import { useFeatures } from "./features";
import { useHome, vikunjaTasks } from "./home";
import { useSession, askIn, sendText } from "./session";
import { useViews } from "./views";
import { send } from "../ws";

export type PinKind = "task" | "pr" | "routine" | "note" | "repo";
export interface Pin { kind: PinKind; id: string; label: string }

export const DEFAULT_ASK = "Tell me about the pinned items and what to do first.";
const KINDS: Record<PinKind, string> = { task: "task", pr: "PR", routine: "routine", note: "note", repo: "repo" };

export const pinKey = (p: { kind: PinKind; id: string }) => `${p.kind}:${p.id}`;

export const usePins = create<{ pins: Pin[]; keep: boolean }>(() => ({ pins: [], keep: false }));

export const isPinned = (pins: Pin[], p: { kind: PinKind; id: string }) => pins.some((x) => pinKey(x) === pinKey(p));
export const addPin = (p: Pin) => usePins.setState((s) => (isPinned(s.pins, p) ? s : { pins: [...s.pins, p] }));
export const removePin = (p: { kind: PinKind; id: string }) => usePins.setState((s) => ({ pins: s.pins.filter((x) => pinKey(x) !== pinKey(p)) }));
/** The pin a dashboard row stands for (its data-pin-* attributes). */
export const pinOfRow = (row: HTMLElement): Pin => ({ kind: row.dataset.pinKind as PinKind, id: row.dataset.pinId ?? "", label: row.dataset.pinLabel ?? "" });

/** Pins (or unpins) the Home row that has focus, else the one under the pointer (a spoken "ping"). Null when there is none. */
export function pinFocused(): "pinned" | "unpinned" | null {
  if (useViews.getState().view !== "home") return null;
  const row = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>("[data-pin-kind]") ?? document.querySelector<HTMLElement>("[data-pin-kind]:hover");
  if (!row) return null;
  const p = pinOfRow(row);
  const was = isPinned(usePins.getState().pins, p);
  togglePin(p);
  return was ? "unpinned" : "pinned";
}

export const togglePin = (p: Pin) => (isPinned(usePins.getState().pins, p) ? removePin(p) : addPin(p));
export const setKeep = (keep: boolean) => usePins.setState({ keep });
export const clearPins = () => usePins.setState({ pins: [] });

const one = (s: string) => s.replace(/\s+/g, " ").replace(/['"]/g, "").trim().slice(0, 60);

/** The first line of the Home screen text: ids to resolve with the orb tools, never the row's own text as an instruction. */
export function pinsNote(pins: Pin[]): string {
  if (!pins.length) return "";
  const refs = pins.map((p) => (p.kind === "task" || p.kind === "pr" ? `${KINDS[p.kind]} ${p.id}` : `${KINDS[p.kind]} '${one(p.label)}'`));
  return `Pinned by the user: ${refs.join(", ")} (references: resolve them with the orb tools before answering).`;
}

/** Pins whose item is still on the dashboard. A missing data set means "unknown", so its pins stay. */
export function stillThere(pins: Pin[]): Pin[] {
  const w = useHome.getState().forget;
  const tr = vikunjaTasks(useHome.getState().tasks);
  const notes = useHome.getState().notes;
  const routines = useViews.getState().routines;
  return pins.filter((p) => {
    if (p.kind === "task") return !tr || tr.tasks.some((t) => String(t.id) === p.id);
    if (p.kind === "pr") return !w || w.prs.some((x) => `${x.repo}#${x.number}` === p.id);
    if (p.kind === "repo") return !w || w.repos.some((r) => r.path === p.id);
    if (p.kind === "routine") return !routines || routines.items.some((r) => r.id === p.id);
    return !notes || notes.notes.some((n) => n.file === p.id) || (notes.awaiting ?? []).some((n) => n.file === p.id);
  });
}

/** A request with pins: the pinned line goes in the screen note, and the request runs in the notes session (it has the desk tools). */
export function sendWithPins(text: string, homeScreen: () => { name: string; text: string } | null): boolean {
  const pins = stillThere(usePins.getState().pins);
  const ask = text.trim() || DEFAULT_ASK;
  const vault = useFeatures.getState().features?.vault;
  if (!pins.length || !vault) { clearPins(); return sendText(text); }
  usePins.setState({ pins });
  const screen = homeScreen();
  if (useSession.getState().folder === vault && useSession.getState().session) {
    if (screen) send({ type: "screen", name: screen.name, text: screen.text });
    if (!sendText(ask)) return false;
  } else askIn(vault, ask, screen, true);
  if (!usePins.getState().keep) clearPins();
  return true;
}
