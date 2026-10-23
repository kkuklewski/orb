// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialSession, useSession } from "../stores/session";
import { folder, session } from "../test/fixtures";
import type { Features } from "../protocol.gen";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { Sidebar } = await import("./Sidebar");
const { Picker } = await import("./Picker");
const { Composer } = await import("./Composer");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: true, stt: "browser", tts: "kokoro", vault: "", ...over,
});

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  useSession.setState(initialSession());
  useViews.setState({ view: "chat", settings: null, routines: null, routinesNew: new Set() });
  useFeatures.setState({
    features: features(),
    folders: [
      { ...folder("web", [session("w1", "approval", { label: "fix login", last_used: 20 }), session("w2", "idle", { label: "notes", last_used: 10 })]), pinned: true },
      { ...folder("api", [session("a1", "done", { label: "add tests", last_used: 30 })]), last_used: 30 },
    ],
    services: {}, build: null,
  });
});
afterEach(cleanup);

describe("sidebar", () => {
  it("shows pinned repos, recents and the Activity badge", () => {
    render(<Sidebar />);
    const repos = screen.getByRole("region", { name: "Repos" });
    expect(within(repos).getByRole("button", { name: /web/ })).toBeTruthy();
    expect(within(repos).queryByRole("button", { name: /^api/ })).toBeNull();
    const recents = screen.getByRole("region", { name: "Recents" });
    expect(within(recents).getAllByRole("button").map((b) => b.textContent)).toEqual(["add testsapi", "fix loginweb", "notesweb"]);
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
  });

  it("a pinned repo opens, unfolds to its sessions, and can start or unpin", () => {
    render(<Sidebar />);
    fireEvent.click(within(screen.getByRole("region", { name: "Repos" })).getByRole("button", { name: /web/ }));
    expect(sent).toContainEqual({ type: "open_folder", path: "/Users/a/code/web", session: undefined });
    fireEvent.click(screen.getByRole("button", { name: "+ New session" }));
    expect(sent).toContainEqual({ type: "start_session", path: "/Users/a/code/web" });
    fireEvent.click(screen.getByRole("button", { name: "Unpin repo" }));
    expect(sent).toContainEqual({ type: "pin_folder", path: "/Users/a/code/web", pinned: false });
  });

  it("a recent session opens that session", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: /add tests/ }));
    expect(sent).toContainEqual({ type: "open_folder", path: "/Users/a/code/api", session: "a1" });
  });

  it("search lists matching sessions and folders", () => {
    render(<Sidebar />);
    fireEvent.change(screen.getByLabelText("Search sessions and repos"), { target: { value: "api" } });
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByText("Folders")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search sessions and repos"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing found.")).toBeTruthy();
  });

  it("nav switches views and back; Routines only when turned on", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(useViews.getState().view).toBe("settings");
    fireEvent.click(screen.getByRole("button", { name: /Settings/ }));
    expect(useViews.getState().view).toBe("chat");
    expect(screen.getByRole("button", { name: /Routines/ })).toBeTruthy();
    act(() => useFeatures.setState((s) => ({ features: { ...s.features!, routines: false } })));
    expect(screen.queryByRole("button", { name: /Routines/ })).toBeNull();
  });

  it("New and + open the picker", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(useSession.getState().picker).toBe("new");
    fireEvent.click(screen.getByRole("button", { name: "Pin a repo" }));
    expect(useSession.getState().picker).toBe("pin");
  });
});

describe("picker", () => {
  it("lists repos, filters, Enter takes the first, Escape closes", () => {
    useSession.setState({ picker: "new" });
    render(<Picker />);
    expect(screen.getByRole("dialog", { name: "Pick a repo to talk about" })).toBeTruthy();
    const q = screen.getByLabelText("Search repos");
    fireEvent.change(q, { target: { value: "api" } });
    expect(screen.getAllByRole("button").filter((b) => b.classList.contains("pick")).map((b) => b.querySelector(".pick-name")!.textContent)).toEqual(["api"]);
    fireEvent.keyDown(q, { key: "Enter" });
    expect(sent).toEqual([{ type: "start_session", path: "/Users/a/code/api" }]);
    act(() => useSession.setState({ picker: "pin" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useSession.getState().picker).toBeNull();
  });

  it("a pasted path pins in pin mode", () => {
    useSession.setState({ picker: "pin" });
    render(<Picker />);
    fireEvent.change(screen.getByLabelText("Folder path"), { target: { value: " /tmp/x " } });
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect(sent).toEqual([{ type: "pin_folder", path: "/tmp/x", pinned: true }]);
  });
});

describe("composer and slash menu", () => {
  beforeEach(() => useSession.setState({
    folder: "/Users/a/code/web",
    commands: [
      { name: "clear", description: "Fresh session", argumentHint: "", local: true },
      { name: "model", description: "Switch model", argumentHint: "[sonnet|opus]", local: true },
      { name: "compact", description: "Summarize", argumentHint: "" },
    ],
  }));

  const box = () => screen.getByRole("combobox", { name: "Message" }) as HTMLTextAreaElement;

  it("/ opens the menu; arrows move, Tab completes", () => {
    render(<Composer />);
    fireEvent.change(box(), { target: { value: "/c" } });
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.querySelector(".slash-name")!.textContent)).toEqual(["/clear", "/compact", "/model"]); // "/model": "Switch" has a c
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowDown" }); // wraps
    expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box(), { key: "Tab" });
    expect(box().value).toBe("/clear ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sent).toEqual([]);
  });

  it("Enter on a name typed in full sends it; Esc closes the menu without sending", () => {
    render(<Composer />);
    fireEvent.change(box(), { target: { value: "/mo" } });
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.change(box(), { target: { value: "/clear" } });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(sent).toEqual([{ type: "user_text", text: "/clear", interrupt: false }]);
    expect(box().value).toBe("");
  });

  it("a click picks a command; plain text sends on Enter, Shift+Enter doesn't", () => {
    render(<Composer />);
    fireEvent.change(box(), { target: { value: "/" } });
    fireEvent.click(screen.getByText("/model"));
    expect(box().value).toBe("/model ");
    fireEvent.change(box(), { target: { value: "hello" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(sent).toEqual([]);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(sent).toEqual([{ type: "user_text", text: "hello", interrupt: false }]);
  });

  it("/ outside a text field focuses the box and starts a command", () => {
    render(<Composer />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(box());
    expect(box().value).toBe("/");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
