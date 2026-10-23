import { describe, expect, it } from "vitest";
import { activityRows, dayTime, dotClass, relTime, routineDot, routinesSubtitle, routineStatus, safeRunUrl, statusText } from "./views";
import { folder, routine, routines, session } from "../test/fixtures";

describe("activity rows", () => {
  it("lists working, waiting, done and live sessions, most urgent first, and skips idle or empty ones", () => {
    const rows = activityRows([
      folder("api", [session("a1", "done", { last_used: 300 }), session("a2", "idle"), session("a3", "idle", { live: true, last_used: 50 })]),
      folder("web", [session("w1", "working", { last_used: 100 }), session("w2", "approval", { last_used: 10 }), session("w3", "working", { empty: true })]),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["w2", "w1", "a1", "a3"]);
    expect(rows[0].folder.label).toBe("web");
  });

  it("names the status and dot like the old page", () => {
    expect(statusText(session("x", "working", { opus: 1 }))).toBe("Opus working");
    expect(statusText(session("x", "approval"))).toBe("needs approval");
    expect(statusText(session("x", "idle", { live: true }))).toBe("open");
    expect(dotClass("approval", false)).toBe("dot approval");
    expect(dotClass("idle", true)).toBe("dot live");
  });
});

describe("routines", () => {
  it("says what needs you before the last outcome", () => {
    expect(routineStatus(routine({ needs: "missed", last: { id: "r", outcome: "ok" } }))).toBe("missed its run");
    expect(routineStatus(routine({ enabled: false }))).toBe("off");
    expect(routineStatus(routine({ last: { id: "r", outcome: "waiting" } }))).toBe("waiting for you");
    expect(routineStatus(routine())).toBe("no runs yet");
    expect(routineDot(routine({ needs: "failed" }))).toBe("dot approval");
    expect(routineDot(routine({ last: { id: "r", outcome: "ok" } }))).toBe("dot done");
  });

  it("subtitle follows the check", () => {
    expect(routinesSubtitle(null)).toBe("scheduled cloud agents");
    expect(routinesSubtitle(routines({ checking: true }))).toBe("checking…");
    expect(routinesSubtitle(routines({ error: "timeout" }))).toBe("last check failed: timeout");
    expect(routinesSubtitle(routines({ checked_at: Date.now() / 1000 - 600 }))).toBe("checked 10m ago · every 30 min");
  });

  it("only shows claude.ai run links", () => {
    expect(safeRunUrl("https://claude.ai/code/x")).toBe("https://claude.ai/code/x");
    expect(safeRunUrl("javascript:alert(1)")).toBeNull();
    expect(safeRunUrl("https://claude.ai.evil.com/x")).toBeNull();
    expect(safeRunUrl(undefined)).toBeNull();
  });

  it("formats times", () => {
    expect(relTime(1000, 1030)).toBe("now");
    expect(relTime(0, 7200)).toBe("2h");
    const now = new Date(2026, 9, 23, 12, 0).getTime();
    expect(dayTime(new Date(2026, 9, 23, 9, 5).getTime() / 1000, now)).toBe("today 09:05");
    expect(dayTime(new Date(2026, 9, 24, 2, 0).getTime() / 1000, now)).toBe("tomorrow 02:00");
  });
});
