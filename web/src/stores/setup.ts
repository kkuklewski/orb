// The setup assistant's state: what the server reports (sign-in, folders, speech), which step is
// showing, the in-card folder browser, the voice sample on its row, and the setup screen's messages.
import { create } from "zustand";
import type { BrowseEvent, ServerEvent, SetupStatusEvent } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { playBase64 } from "../audio/sample";

export type SampleState = { voice: string; state: "loading" | "playing" | "error"; text?: string };
export type Toast = { text: string; level: "info" | "error" };

export interface SetupState {
  open: boolean;
  step: number; // 0 welcome, 1 sign in, 2 folders, 3 voice, 4 control
  status: SetupStatusEvent | null;
  dir: BrowseEvent | null;
  browsing: boolean;
  picking: boolean;
  sample: SampleState | null;
  toast: Toast | null;
}

export const initialSetup: SetupState = {
  open: false, step: 0, status: null, dir: null, browsing: false, picking: false, sample: null, toast: null,
};

export const LAST_STEP = 4;

export function signedIn(s: SetupStatusEvent | null): boolean {
  return !!(s?.auth.loggedIn && s.auth.subscriptionLogin);
}

export function hasRepos(s: SetupStatusEvent | null): boolean {
  return !!s?.roots.some((r) => r.repos.length > 0);
}

/** Can the user move on from this step? */
export function canContinue(step: number, s: SetupStatusEvent | null): boolean {
  if (step === 1) return signedIn(s);
  if (step === 2) return hasRepos(s);
  if (step === LAST_STEP) return signedIn(s) && hasRepos(s);
  return true;
}

/** A step counts as done on the rail when it's behind the current one, or its requirement is met. */
export function stepDone(n: number, current: number, s: SetupStatusEvent | null): boolean {
  if (n === current) return false;
  if (n < current) return true;
  return s !== null && n < LAST_STEP && canContinue(n, s);
}

/** Pure: the next state for one server event (exported for tests). */
export function reduce(state: SetupState, ev: ServerEvent): SetupState {
  switch (ev.type) {
    case "setup_status":
      return { ...state, status: ev };
    case "browse":
      return { ...state, dir: ev };
    case "picked":
      return { ...state, picking: false, toast: ev.error ? { text: ev.error, level: "error" } : state.toast };
    case "voice_sample":
      if (ev.error) return { ...state, sample: { voice: ev.voice, state: "error", text: ev.error }, toast: { text: ev.error, level: "error" } };
      return { ...state, sample: { voice: ev.voice, state: "playing" } };
    case "error":
    case "notice":
      return state.open ? { ...state, toast: { text: ev.text, level: ev.type === "error" || ev.level === "error" ? "error" : "info" } } : state;
    default:
      return state;
  }
}

export const useSetup = create<SetupState>(() => initialSetup);

export function wireSetup(): () => void {
  const apply = (ev: ServerEvent) => useSetup.setState((s) => reduce(s, ev));
  const offs = (["setup_status", "browse", "picked", "voice_sample", "error", "notice"] as const).map((t) => on(t, apply));
  // Side effects that go with the state changes above.
  offs.push(on("voice_sample", (ev) => {
    if (!ev.data) return;
    playBase64(ev.data).catch(() => useSetup.setState({ sample: { voice: ev.voice, state: "error", text: "This browser couldn't play the sample." } }));
    setTimeout(() => useSetup.setState((s) => (s.sample?.voice === ev.voice && s.sample.state === "playing" ? { sample: null } : {})), 2600);
  }));
  offs.push(on("picked", (ev) => { // Finder gave a folder: add it to the roots
    const roots = useSetup.getState().status?.roots.map((r) => r.path) ?? [];
    if (ev.path && !roots.includes(ev.path)) send({ type: "set_settings", values: { roots: [...roots, ev.path] } });
  }));
  return () => offs.forEach((off) => off());
}
