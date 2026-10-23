import type { SetupStatusEvent } from "../protocol.gen";

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
