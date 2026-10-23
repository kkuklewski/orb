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
    useSetup.setState({ step: 3, status: status({ voices: [{ id: "af_heart", name: "Heart", desc: "US · female", grade: "A" }, { id: "af_bella", name: "Bella", desc: "US · female", grade: "A-" }] }) });
    vi.stubGlobal("AudioContext", class { state = "running"; resume() {} });
    render(<Setup />);
    fireEvent.click(screen.getByRole("radio", { name: /Bella/ }));
    expect(sent.slice(-2)).toEqual([{ type: "voice_sample", voice: "af_bella" }, { type: "set_settings", values: { voice: "af_bella" } }]);
    expect(screen.getByRole("radio", { name: /Bella/ }).textContent).toContain("Loading…");
    expect(screen.getByRole("radio", { name: /Bella/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("finishes with set_settings onboarded, and Escape closes only once set up", () => {
    useSetup.setState({ step: 4, status: status() });
    render(<Setup />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSetup.getState().open).toBe(true); // not set up yet: can't leave
    fireEvent.click(screen.getByRole("button", { name: "Start using Orb" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { onboarded: true } });

    act(() => useFeatures.setState({ features: { roots: [], vault: "", brain: false, routines: false, onboarded: true, stt: "browser", tts: "kokoro", plan: "max" } }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSetup.getState().open).toBe(false);
  });
});
