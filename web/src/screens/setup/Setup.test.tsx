// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialSetup, useSetup } from "../../stores/setup";
import { useFeatures } from "../../stores/features";
import { status } from "../../test/fixtures";

const sent: unknown[] = [];
vi.mock("../../ws", () => ({ send: (m: unknown) => { sent.push(m); return true; } }));

const { Setup } = await import("./Setup");

beforeEach(() => {
  sent.length = 0;
  useSetup.setState({ ...initialSetup, open: true });
  useFeatures.setState({ features: null, folders: [], services: {}, build: null });
});
afterEach(cleanup);

describe("setup assistant", () => {
  it("asks the server for the setup status when it opens", () => {
    render(<Setup />);
    expect(sent).toContainEqual({ type: "setup_status" });
  });

  it("walks welcome → sign in, and won't continue until signed in", () => {
    render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    expect(screen.getByRole("heading", { name: "Is this a work Mac?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Personal Mac/ }));
    expect(sent).toContainEqual({ type: "set_settings", values: { profile: "personal" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Sign in to Claude" })).toBeTruthy();
    expect(screen.getByText("Checking Claude Code…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);

    act(() => useSetup.setState({ status: status({ auth: { ...status().auth, loggedIn: false, subscriptionLogin: false } }) }));
    expect(screen.getByText("Not signed in yet.")).toBeTruthy();
    expect(screen.getByText("claude auth login")).toBeTruthy();

    act(() => useSetup.setState({ status: status() }));
    expect(screen.getByText(/Signed in · Claude Max plan/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("adds a suggested folder and removes one", () => {
    useSetup.setState({ step: 2, status: status({ suggested: [{ path: "/Users/a/dev", repos: 3 }] }) });
    render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: /~\/dev/ }));
    expect(sent).toContainEqual({ type: "set_settings", values: { roots: ["/Users/a/code", "/Users/a/dev"] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { roots: [] } });
  });

  it("plays a voice first, then saves it, and shows Loading… on its row", () => {
    useSetup.setState({ step: 4, part: 1, status: status({ voices: [{ id: "af_heart", name: "Heart", desc: "US · female", grade: "A" }, { id: "af_bella", name: "Bella", desc: "US · female", grade: "A-" }] }) });
    vi.stubGlobal("AudioContext", class { state = "running"; resume() {} });
    render(<Setup />);
    fireEvent.click(screen.getByRole("radio", { name: /Bella/ }));
    expect(sent.slice(-2)).toEqual([{ type: "voice_sample", voice: "af_bella" }, { type: "set_settings", values: { voice: "af_bella" } }]);
    expect(screen.getByRole("radio", { name: /Bella/ }).textContent).toContain("Loading…");
    expect(screen.getByRole("radio", { name: /Bella/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("installs Kokoro with one click, follows its steps, and picks her voice once she answers", () => {
    vi.useFakeTimers();
    const off = { kokoro: false, whisper: false, parakeet: false };
    const k = { voicemode: false, installed: false, autostart: false, exposed: false };
    useSetup.setState({ step: 4, part: 1, status: status({ speech: off, kokoro_install: k }) });
    render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: "Set up Kokoro" }));
    expect(screen.getByText("voicemode service install kokoro")).toBeTruthy(); // by hand, if they'd rather
    fireEvent.click(screen.getByRole("button", { name: "Install Kokoro" }));
    expect(sent).toContainEqual({ type: "kokoro_setup" });

    act(() => useSetup.setState({ status: status({ speech: off, kokoro_install: { ...k, voicemode: true, job: { step: "Installing Kokoro and its voices", running: true } } }) }));
    expect(screen.getByRole("status").textContent).toBe("Installing Kokoro and its voices…");
    expect(screen.queryByRole("button", { name: "Install Kokoro" })).toBeNull();
    sent.length = 0;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(sent).toEqual([{ type: "setup_status" }]);

    act(() => useSetup.setState({ status: status({ speech: { ...off, kokoro: true }, kokoro_install: { ...k, voicemode: true, installed: true, autostart: true, job: { step: "Starting", running: false } } }) }));
    expect(screen.getByText(/Kokoro is running/)).toBeTruthy();
    expect(sent).toContainEqual({ type: "set_settings", values: { tts: "kokoro" } });
    sent.length = 0;
    act(() => { vi.advanceTimersByTime(10000); });
    expect(sent).toEqual([]); // she answers: no more looking
    vi.useRealTimers();
  });

  it("shows a failed step and lets it be tried again", () => {
    const k = { voicemode: true, installed: true, autostart: false, exposed: false, job: { step: "Starting it", running: false, error: "❌ Failed to start kokoro" } };
    useSetup.setState({ step: 4, part: 1, status: status({ speech: { kokoro: false }, kokoro_install: k }) });
    render(<Setup />);
    fireEvent.click(screen.getByRole("button", { name: "Set up Kokoro" }));
    expect(screen.getByText("❌ Failed to start kokoro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(sent).toContainEqual({ type: "kokoro_setup" });
  });

  it("warns when Kokoro listens on the whole network, even while she runs, and fixes it with one click", () => {
    useSetup.setState({ step: 4, part: 1, status: status({ kokoro_install: { voicemode: true, installed: true, autostart: true, exposed: true } }) });
    render(<Setup />);
    expect(screen.getByText(/listens on your whole network/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it on this Mac" }));
    expect(sent).toContainEqual({ type: "kokoro_setup" });
  });

  it("offers no Kokoro setup when she already runs on this Mac only, or off a Mac", () => {
    useSetup.setState({ step: 4, part: 1, status: status() });
    render(<Setup />);
    expect(screen.queryByRole("button", { name: "Set up Kokoro" })).toBeNull();
    cleanup();
    useSetup.setState({ status: status({ speech: { kokoro: false }, kokoro_install: null }) });
    render(<Setup />);
    expect(screen.queryByRole("button", { name: "Set up Kokoro" })).toBeNull();
  });

  it("splits voice in two: how Orb hears you, then her voice", () => {
    useSetup.setState({ step: 4, status: status() });
    render(<Setup />);
    expect(screen.getByRole("heading", { name: "How Orb hears you." })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "LISTENING WITH" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "How Orb talks back." })).toBeTruthy();
    expect(useSetup.getState()).toMatchObject({ step: 4, part: 1 });
    fireEvent.click(screen.getByRole("tab", { name: /Hearing you/ }));
    expect(useSetup.getState().part).toBe(0);
  });

  it("finishes with set_settings onboarded, and Escape closes only once set up", () => {
    useSetup.setState({ step: 5, part: 3, status: status() });
    render(<Setup />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSetup.getState().open).toBe(true); // not set up yet: can't leave
    fireEvent.click(screen.getByRole("button", { name: "Start using Orb" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { onboarded: true } });

    act(() => useFeatures.setState({ features: { roots: [], vault: "", brain: false, routines: false, onboarded: true, stt: "browser", tts: "kokoro", plan: "max" } }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSetup.getState().open).toBe(false);
  });

  it("shows Control's four rules one at a time: Got it moves on, Back goes back, and only the last one finishes", () => {
    useSetup.setState({ step: 5, part: 0, status: status() });
    render(<Setup />);
    expect(screen.getByRole("heading", { name: "You say yes first." })).toBeTruthy();
    for (const title of ["One project at a time.", "Your plan. No extra bills.", "It stays on this Mac."]) {
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(sent).not.toContainEqual({ type: "set_settings", values: { onboarded: true } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useSetup.getState()).toMatchObject({ step: 5, part: 2 });
    fireEvent.click(screen.getByRole("tab", { name: /Approvals/ }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useSetup.getState()).toMatchObject({ step: 4, part: 1 }); // the voice step's last screen
  });
});
