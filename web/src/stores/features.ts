// What this install has turned on (folders, vault, Brain, routines, speech engines, plan, task tracker), the repo
// list, and which local services answer. Filled from hello, then kept current by features / folders.
import { create } from "zustand";
import type { Features, FolderItem, ServerEvent } from "../protocol.gen";
import { on } from "../events";

export interface FeaturesState {
  features: Features | null;
  folders: FolderItem[];
  services: Record<string, boolean>;
  build: string | null;
}

const FEATURE_KEYS = ["roots", "vault", "brain", "routines", "onboarded", "stt", "tts", "plan", "tracker", "profile"] as const;

function pick(ev: Features): Features {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, ev[k]])) as unknown as Features;
}

/** Pure: the next state for one event (exported for tests). */
export function reduce(state: FeaturesState, ev: ServerEvent): FeaturesState {
  switch (ev.type) {
    case "hello":
      return { features: pick(ev), folders: ev.folders, services: ev.services, build: ev.build };
    case "features":
      return { ...state, features: pick(ev) };
    case "folders":
      return { ...state, folders: ev.items };
    default:
      return state;
  }
}

export const useFeatures = create<FeaturesState>(() => ({ features: null, folders: [], services: {}, build: null }));

/** Subscribe the store to its events; returns the unsubscribe. */
export function wireFeatures(): () => void {
  const apply = (ev: ServerEvent) => useFeatures.setState((s) => reduce(s, ev));
  const offs = [on("hello", apply), on("features", apply), on("folders", apply)];
  return () => offs.forEach((off) => off());
}

/** The task tracker's name for the page's words: "Vikunja" or "Jira" (ADR 0010). */
export function trackerName(): string {
  return useFeatures.getState().features?.tracker ?? "Vikunja";
}

/** The same, as a hook: re-renders when the tracker changes. */
export function useTracker(): string {
  return useFeatures((s) => s.features?.tracker ?? "Vikunja");
}
