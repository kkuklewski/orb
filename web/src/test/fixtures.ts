import type { FolderItem, RoutineItem, RoutinesEvent, SessionItem, SettingsEvent, SetupStatusEvent } from "../protocol.gen";

// A signed-in Max user with one folder of two repos; override what a test needs.
export const status = (over: Partial<SetupStatusEvent> = {}): SetupStatusEvent => ({
  type: "setup_status",
  auth: { installed: true, loggedIn: true, subscription: "max", method: "claude.ai", subscriptionLogin: true, error: null },
  login_cmd: "claude auth login",
  roots: [{ path: "/Users/a/code", exists: true, repos: ["api", "web"] }],
  suggested: [],
  home: "/Users/a",
  speech: { kokoro: true, whisper: false, parakeet: false },
  voices: [],
  values: { stt: "browser", tts: "kokoro", voice: "af_heart", onboarded: false },
  ...over,
});

export const session = (key: string, status: string, over: Partial<SessionItem> = {}): SessionItem => ({
  key, status, empty: false, live: false, label: `task ${key}`, last_used: 0, ...over,
});

export const folder = (name: string, sessions: SessionItem[] = []): FolderItem => ({
  label: name, rel: name, path: `/Users/a/code/${name}`, sessions,
});

export const routine = (over: Partial<RoutineItem> = {}): RoutineItem => ({
  id: "trig_1", name: "nightly", enabled: true, cron: "0 2 * * *", next_run_at: null, last: null, needs: null, new: false, worth: null, why: "", notify: null, quiet: false, loud: false, ...over,
});

export const routines = (over: Partial<RoutinesEvent> = {}): RoutinesEvent => ({
  type: "routines", items: [], checked_at: null, checking: false, error: null, needs: 0, new: 0, read: 0, ...over,
});

export const settings = (over: Partial<SettingsEvent> = {}): SettingsEvent => ({
  type: "settings",
  values: { voice: "af_heart", default_mode: "default", default_model: "sonnet", stt: "browser", tts: "kokoro" },
  voices: ["af_heart", "af_bella"],
  recommended: [{ id: "af_heart", name: "Heart", desc: "warm", grade: "A" }, { id: "af_bella", name: "Bella", desc: "bright", grade: "A-" }],
  vocabulary: "Kimai", vocab_seed: ["Claude", "Opus"], whisper_prompt: "Claude, Opus, Kimai", vault: "", port: 8765, host: "127.0.0.1",
  ...over,
});
