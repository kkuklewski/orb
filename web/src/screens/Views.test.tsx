// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useViews } from "../stores/views";
import { useFeatures } from "../stores/features";
import { initialSetup, useSetup } from "../stores/setup";
import { useHome } from "../stores/home";
import { routine, routines, settings } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { Routines } = await import("./Routines");
const { Settings } = await import("./Settings");

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  useViews.setState({ view: "chat", settings: null, routines: null, routinesNew: new Set() });
  useFeatures.setState({ features: null, folders: [], services: {}, build: null });
  useSetup.setState(initialSetup);
});
afterEach(cleanup);

// Times are built from local dates so "today" / "yest" don't depend on the time zone the tests run in.
const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime() / 1000;
const ok = (id: string, t: number) => ({ id, at: t, outcome: "ok" as const, summary: `summary ${id}`, url: `https://claude.ai/code/${id}` });
const lines = (c: HTMLElement) => [...c.querySelectorAll(".rt-line")].map((l) => [...l.children].map((x) => x.textContent).join(" | "));

describe("Routines", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("asks for routines on open and clears new ones, keeping their mark for this visit", () => {
    useViews.setState({ routines: routines({ items: [routine({ new: true })], new: 1 }) });
    const { container } = render(<Routines />);
    expect(sent).toEqual([{ type: "routines" }, { type: "routines_seen" }]);
    expect(container.querySelector(".rt-line.new")).toBeTruthy();
  });

  it("one line per routine: dot, name, state word, time; grouped by state, by name inside; off folded away", () => {
    useViews.setState({ routines: routines({ read: 1, items: [
      routine({ id: "z", name: "zeta digest", state: "nothing to report", worth: "skip", why: "no new email", last: ok("r1", at(25, 6, 10)) }),
      routine({ id: "m", name: "Mail check", state: "missed", needs: "missed", missed_at: at(25, 6, 0), why: "", last: ok("r2", at(22, 6)) }),
      routine({ id: "g", name: "Gmail cleanup", state: "worth reading", loud: true, worth: "read", why: "urgent alert sent", last: ok("r3", at(24, 6, 10)) }),
      routine({ id: "a", name: "audit", state: "failed", needs: "failed", last: { id: "r4", at: at(25, 2), outcome: "failed", summary: "boom" } }),
      routine({ id: "b", name: "Backups", state: "nothing to report", last: ok("r5", at(20, 3)) }),
      routine({ id: "o", name: "Old sync", enabled: false, state: "off" }),
      routine({ id: "p", name: "paused one", enabled: false, state: "off" }),
    ] }) });
    const { container } = render(<Routines />);
    expect([...container.querySelectorAll(".rt-group")].map((g) => g.getAttribute("aria-label"))).toEqual(["Needs you", "Worth reading", "Nothing to report", "Off"]);
    expect(lines(container)).toEqual([
      " | audit | failed | 02:00",
      " | Mail check | missed | missed 06:00",
      " | Gmail cleanup | worth reading | yest 06:10 | worth reading: urgent alert sent",
      " | Backups | nothing to report | 5 d ago",
      " | zeta digest | nothing to report | 06:10",  // no why tail below the top two groups
    ]);
    expect(container.querySelector(".rt-summary, .rt-notify, a")).toBeNull(); // summary, notify and run link live on the routine's page
    expect(screen.queryByText(/next /)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 off" }));
    expect(lines(container).slice(-2)).toEqual([" | Old sync | off | ", " | paused one | off | "]);
  });

  it("names are plain text, Mark runs read only while runs wait, and Check now asks again", () => {
    useViews.setState({ routines: routines({ checked_at: NOW / 1000, items: [routine({ name: "<b>nightly</b>" })] }) });
    render(<Routines />);
    expect(screen.getByText("<b>nightly</b>")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Mark runs read" })).toBeNull();
    act(() => useViews.setState((s) => ({ routines: { ...s.routines!, read: 2 } })));
    fireEvent.click(screen.getByRole("button", { name: "Mark runs read" }));
    expect(sent.at(-1)).toEqual({ type: "routines_seen", all: true });
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(sent).toContainEqual({ type: "routines", refresh: true });
    act(() => useViews.setState((s) => ({ routines: { ...s.routines!, checking: true } })));
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("no routine text says result", () => {
    useViews.setState({ routines: routines({ read: 1, items: [routine({ state: "worth reading", loud: true, worth: "read", why: "x", last: ok("r", at(25, 1)) })] }) });
    const { container } = render(<Routines />);
    expect(container.textContent).not.toMatch(/result/i);
  });
});

describe("Settings", () => {
  it("asks for settings, then shows them", () => {
    render(<Settings />);
    expect(sent).toContainEqual({ type: "get_settings" });
    expect(screen.getByText("Loading…")).toBeTruthy();
    act(() => useViews.setState({ settings: settings() }));
    expect(screen.getByRole("radio", { name: "Browser", checked: true })).toBeTruthy();
    expect((screen.getByLabelText("Voice") as HTMLSelectElement).value).toBe("af_heart");
  });

  it("saves server choices and shows them at once", () => {
    useViews.setState({ settings: settings() });
    render(<Settings />);
    fireEvent.click(screen.getByRole("radio", { name: "Parakeet (fast)" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { stt: "parakeet" } });
    expect(screen.getByRole("radio", { name: "Parakeet (fast)" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "af_bella" } });
    expect(sent).toContainEqual({ type: "set_settings", values: { voice: "af_bella" } });
  });

  it("hides the Kokoro voice list when her voice comes from the browser", () => {
    useViews.setState({ settings: settings() });
    render(<Settings />);
    const browserVoice = screen.getByRole("radiogroup", { name: "Her voice" }).querySelector("button")!;
    fireEvent.click(browserVoice);
    expect(sent).toContainEqual({ type: "set_settings", values: { tts: "browser" } });
    expect(screen.queryByLabelText("Voice")).toBeNull();
  });

  it("model for new folders has Haiku, and the Opus coder's effort is a setting", () => {
    useViews.setState({ settings: settings({ values: { ...settings().values, coder_effort: "medium" } }) });
    render(<Settings />);
    fireEvent.click(screen.getByRole("radio", { name: "Haiku + Opus for coding" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { default_model: "haiku" } });
    expect(screen.getByRole("radio", { name: "Medium", checked: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "High" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { coder_effort: "high" } });
  });

  it("the judge switch shows only with routines on; off means every run notifies", () => {
    useViews.setState({ settings: settings({ values: { ...settings().values, routines_judge: true } }) });
    useFeatures.setState((st) => ({ features: { ...st.features!, routines: false } }));
    const { rerender } = render(<Settings />);
    expect(screen.queryByRole("radiogroup", { name: "Routine runs" })).toBeNull();
    act(() => useFeatures.setState((st) => ({ features: { ...st.features!, routines: true } })));
    rerender(<Settings />);
    expect(screen.getByRole("radio", { name: "Only what's worth reading", checked: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Every run" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { routines_judge: false } });
  });

  it("keeps barge-in and theme in this browser, and saves the vocabulary", () => {
    useViews.setState({ settings: settings() });
    render(<Settings />);
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(localStorage.getItem("vd-barge")).toBe("off");
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.change(screen.getByLabelText("Vocabulary"), { target: { value: "Kimai\nHetzner" } });
    fireEvent.click(screen.getByRole("button", { name: "Save vocabulary" }));
    expect(sent).toContainEqual({ type: "set_settings", vocabulary: "Kimai\nHetzner" });
  });

  it("never shows the whole access token", () => {
    localStorage.setItem("vd-token", "secret-token-1234");
    useViews.setState({ settings: settings() });
    const { container } = render(<Settings />);
    expect(container.textContent).not.toContain("secret-token");
    expect(container.textContent).toContain("1234");
  });

  it("opened from a broken setup on Home, it lands on the section that fixes it", () => {
    useViews.setState({ settings: null, settingsAt: "vikunja" });
    render(<Settings />);
    act(() => useViews.setState({ settings: settings() }));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Tasks (Vikunja)" }));
    expect(useViews.getState().settingsAt).toBeNull();
  });

  it("the Vikunja section saves the address and says why it can't be read", () => {
    useViews.setState({ settings: settings() });
    useHome.setState({ tasks: { type: "home_tasks", tasks: [], total: 0, url: null, error: "Vikunja not reachable: didn't answer: down" } });
    render(<Settings />);
    expect(screen.getByRole("alert").textContent).toBe("Vikunja not reachable: didn't answer: down");
    fireEvent.change(screen.getByLabelText("Vikunja address"), { target: { value: " http://10.0.0.5:8002 " } });
    fireEvent.click(within(screen.getByRole("region", { name: "Tasks (Vikunja)" })).getByRole("button", { name: "Save the Vikunja address" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { vikunja_url: "http://10.0.0.5:8002" } });
    expect(sent.at(-1)).toEqual({ type: "home" });
    act(() => useHome.setState({ tasks: { type: "home_tasks", tasks: [], total: 1, url: "http://10.0.0.5:8002", error: null } }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Reachable · 1 open task")).toBeTruthy();
  });

  it("with Jira as the tracker the section names it and saves the Jira address", () => {
    useViews.setState({ settings: settings() });
    useFeatures.setState({ features: { roots: [], vault: "", brain: false, routines: false, onboarded: true, stt: "browser", tts: "browser", plan: "max", tracker: "Jira" } });
    render(<Settings />);
    fireEvent.change(screen.getByLabelText("Jira address"), { target: { value: " https://acme.atlassian.net " } });
    fireEvent.click(within(screen.getByRole("region", { name: "Tasks (Jira)" })).getByRole("button", { name: "Save the Jira address" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { jira_url: "https://acme.atlassian.net" } });
  });

  it("the Claude Code section opens setup at the sign-in step", () => {
    useViews.setState({ settings: settings() });
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));
    expect(useSetup.getState()).toMatchObject({ open: true, step: 1 });
  });

  it("opens setup at the folders step", () => {
    useViews.setState({ settings: settings() });
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: "Open setup" }));
    expect(useSetup.getState()).toMatchObject({ open: true, step: 2 });
  });
});
