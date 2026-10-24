// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useChat } from "../stores/chat";
import { initialSession, useSession } from "../stores/session";
import { canOpenPanel, escClosesPanel, togglePanelChat, useViews, wireViews } from "../stores/views";

vi.mock("../ws", () => ({ send: () => true }));
const { ChatSheet } = await import("./ChatSheet");

beforeEach(() => {
  useSession.setState({ ...initialSession(), label: "acme/web" });
  useChat.setState({ items: [] });
  useViews.setState({ view: "home" });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("chat panel", () => {
  it("opens over Home, Activity or Routines and closes back to the one it opened over", () => {
    const off = wireViews();
    useViews.setState({ view: "activity" });
    expect(canOpenPanel("activity")).toBe(true);
    togglePanelChat();
    expect(useViews.getState().view).toBe("session");
    togglePanelChat();
    expect(useViews.getState().view).toBe("activity");
    useViews.setState({ view: "settings" });
    togglePanelChat();
    expect(useViews.getState().view).toBe("settings"); // nothing to open it over
    off();
  });

  it("Esc closes it only when no field has text: an empty composer closes, a typed one keeps it", () => {
    const area = document.createElement("textarea");
    document.body.append(area);
    expect(escClosesPanel(document.body)).toBe(true);
    expect(escClosesPanel(area)).toBe(true);
    area.value = "half a thought";
    expect(escClosesPanel(area)).toBe(false);
    const input = document.createElement("input");
    document.body.append(input);
    expect(escClosesPanel(input)).toBe(false);
    area.remove(); input.remove();
  });

  it("showing the sheet adds no keyboard handlers (Space and Esc stay with the one voice handler)", () => {
    const doc = vi.spyOn(document, "addEventListener");
    const win = vi.spyOn(window, "addEventListener");
    render(<ChatSheet />);
    const keys = (s: typeof doc) => s.mock.calls.filter((c) => c[0] === "keydown");
    expect(keys(doc)).toHaveLength(0);
    expect(keys(win)).toHaveLength(0);
    expect(screen.getByText("Nothing said yet. Type or talk below.")).toBeTruthy();
  });

  it("has no input of its own, and its buttons close it or open the full chat", () => {
    useViews.setState({ view: "session" });
    render(<ChatSheet />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open in Chats" }));
    expect(useViews.getState().view).toBe("chat");
  });
});
