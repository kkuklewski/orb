// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useViews } from "../stores/views";
import { useFeatures } from "../stores/features";
import { initialSetup, useSetup } from "../stores/setup";
import { folder, routine, routines, session, settings } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { Activity } = await import("./Activity");
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

describe("Activity", () => {
  it("says so when nothing runs", () => {
    render(<Activity />);
    expect(screen.getByText(/Nothing running/)).toBeTruthy();
  });

  it("lists sessions and opens one here", () => {
    useFeatures.setState({ folders: [folder("web", [session("w1", "approval", { label: "fix login" })])] });
    render(<Activity />);
    fireEvent.click(screen.getByRole("button", { name: /fix login/ }));
    expect(sent).toContainEqual({ type: "open_folder", path: "/Users/a/code/web", session: "w1" });
  });
});

describe("Routines", () => {
  it("asks for routines on open and clears new ones, keeping their mark for this visit", () => {
    useViews.setState({ routines: routines({ items: [routine({ new: true })], new: 1 }) });
    const { container } = render(<Routines />);
    expect(sent).toEqual([{ type: "routines" }, { type: "routines_seen" }]);
    expect(container.querySelector(".rt-row.new")).toBeTruthy();
  });

  it("shows rows as plain text, a safe run link only, and checks again on demand", () => {
    useViews.setState({ routines: routines({
      checked_at: Date.now() / 1000,
      items: [
        routine({ id: "a", name: "<b>nightly</b>", needs: "failed", last: { id: "r1", outcome: "failed", summary: "boom", url: "https://claude.ai/code/r1" } }),
        routine({ id: "b", name: "weekly", last: { id: "r2", outcome: "ok", url: "javascript:alert(1)" } }),
      ],
    }) });
    render(<Routines />);
    expect(screen.getByText("<b>nightly</b>")).toBeTruthy();
    expect(screen.getByText("boom")).toBeTruthy();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));
    expect(sent).toContainEqual({ type: "routines", refresh: true });
    act(() => useViews.setState((s) => ({ routines: { ...s.routines!, checking: true } })));
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Routines: only what's worth reading stands out", () => {
  it("marks worth-reading results with the reason, and tucks nothing-to-report results away", () => {
    useViews.setState({ routines: routines({ read: 1, items: [
      routine({ id: "a", name: "Gmail cleanup", new: true, loud: true, worth: "read", why: "urgent alert sent", last: { id: "r1", outcome: "ok", summary: "Reviewed 16 threads" } }),
      routine({ id: "b", name: "Etihad check", quiet: true, worth: "skip", why: "no new email", last: { id: "r2", outcome: "ok", summary: "No new Etihad email today." } }),
    ] }) });
    const { container } = render(<Routines />);
    expect(screen.getByText(/worth reading: urgent alert sent/)).toBeTruthy();
    expect(screen.getByText("Reviewed 16 threads").closest(".rt-row")!.className).not.toContain("quiet");
    const quiet = container.querySelector(".rt-row.quiet")!;
    expect(quiet.textContent).toContain("nothing to report: no new email");
    expect(quiet.querySelector("details")).toBeTruthy(); // the result itself stays one click away
    expect(quiet.querySelector("details")!.textContent).toContain("No new Etihad email today.");
  });
});

describe("Routines: you can overrule the judge", () => {
  it("Auto / Always / Never per routine, sent as one routine's choice", () => {
    useViews.setState({ routines: routines({ items: [
      routine({ id: "a", name: "Gmail cleanup", notify: "never", quiet: true, last: { id: "r1", outcome: "ok", summary: "x" } }),
      routine({ id: "off", name: "Paused one", enabled: false }),
    ] }) });
    render(<Routines />);
    const group = screen.getByRole("radiogroup", { name: "Notify for Gmail cleanup" });
    expect(within(group).getByRole("radio", { name: "Never", checked: true })).toBeTruthy();
    expect(screen.getByText("muted (your choice)")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: "Always" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { routines_notify: { a: "always" } } });
    fireEvent.click(within(group).getByRole("radio", { name: "Auto" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { routines_notify: { a: "auto" } } });
    expect(screen.queryByRole("radiogroup", { name: "Notify for Paused one" })).toBeNull();
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

  it("the judge switch shows only with routines on; off means every result notifies", () => {
    useViews.setState({ settings: settings({ values: { ...settings().values, routines_judge: true } }) });
    useFeatures.setState((st) => ({ features: { ...st.features!, routines: false } }));
    const { rerender } = render(<Settings />);
    expect(screen.queryByRole("radiogroup", { name: "Routine results" })).toBeNull();
    act(() => useFeatures.setState((st) => ({ features: { ...st.features!, routines: true } })));
    rerender(<Settings />);
    expect(screen.getByRole("radio", { name: "Only what's worth reading", checked: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Every result" }));
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

  it("opens setup at the folders step", () => {
    useViews.setState({ settings: settings() });
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: "Open setup" }));
    expect(useSetup.getState()).toMatchObject({ open: true, step: 2 });
  });
});
