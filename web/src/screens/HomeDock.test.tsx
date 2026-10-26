// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialSession, useSession } from "../stores/session";
import { useViews } from "../stores/views";
import { useItems } from "../stores/items";
import { useFeatures } from "../stores/features";
import { useBrain } from "../stores/brain";
import { useChat } from "../stores/chat";
import { useConnection } from "../stores/connection";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; }, on: () => () => {} }));
const { TopBar } = await import("./TopBar");
const { HomeDock, useDockShown } = await import("./HomeDock");
const { columnCount, dockLayout, useDock } = await import("../stores/dock");
const { wireScreen } = await import("../stores/screen");
const { wireSession } = await import("../stores/session");
const { dispatch } = await import("../events");

const VAULT = "/dev/notes";
function narrow(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

/** The top bar and the dock as App places them. */
function Page() {
  return <><TopBar />{useDockShown() && <HomeDock />}</>;
}
const chip = () => screen.queryByRole("button", { name: "Home chat" });
const dock = () => screen.queryByRole("complementary", { name: "Home chat" });

beforeEach(() => {
  narrow(false);
  sent.length = 0;
  localStorage.clear();
  useSession.setState({ ...initialSession(), folder: "/dev/web", session: "w1" });
  useViews.setState({ view: "home", routines: null });
  useItems.setState({ source: null, id: null, lists: {}, item: null });
  useFeatures.setState({ features: { vault: VAULT } as never, folders: [] });
  useBrain.setState({ list: null, file: null, note: null });
  useChat.setState({ items: [] });
  useDock.setState({ open: {}, dropped: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Home chat dock", () => {
  it("the chip toggles it on Brain, Tasks and Routines; Home and a session have no chip", () => {
    render(<Page />);
    expect(chip()).toBeNull(); // Home: the chat is the main area
    act(() => useViews.setState({ view: "brain" }));
    fireEvent.click(chip()!);
    expect(dock()).toBeTruthy();
    expect(chip()!.getAttribute("aria-pressed")).toBe("true");
    expect(sent).toContainEqual({ type: "open_folder", path: VAULT, session: undefined }); // the Home chat is the vault's session
    expect(useSession.getState().quiet).toBe(true); // opening it keeps the screen
    fireEvent.click(chip()!);
    expect(dock()).toBeNull();
    act(() => useViews.setState({ view: "chat" }));
    expect(chip()).toBeNull();
    expect(dock()).toBeNull();
  });

  it("opens the vault's session once and keeps the screen when it opens", () => {
    const off = wireSession();
    useViews.setState({ view: "brain" });
    render(<Page />);
    fireEvent.click(chip()!);
    expect(sent.filter((m) => m.type === "open_folder")).toHaveLength(1); // the chip and the dock's own check send one
    act(() => dispatch({ type: "opened", folder: VAULT, session: "v1", label: "notes", rel: "notes", branch: null, session_id: null, live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] } as never));
    expect(useViews.getState().view).toBe("brain");
    expect(dock()).toBeTruthy();
    expect(sent.filter((m) => m.type === "open_folder")).toHaveLength(1);
    off();
  });

  it("remembers open or closed per destination", () => {
    useViews.setState({ view: "routines" });
    render(<Page />);
    fireEvent.click(chip()!);
    act(() => useViews.setState({ view: "tasks" }));
    expect(dock()).toBeNull();
    act(() => useViews.setState({ view: "routine" })); // a routine's page is in Routines
    expect(dock()).toBeTruthy();
    act(() => useViews.setState({ view: "home" }));
    expect(dock()).toBeNull();
    act(() => useViews.setState({ view: "routines" }));
    expect(dock()).toBeTruthy();
  });

  it("has its own composer and voice pill, and sends to the Home chat", () => {
    useSession.setState({ ...initialSession(), folder: VAULT, session: "v1" });
    useViews.setState({ view: "brain" });
    render(<Page />);
    fireEvent.click(chip()!);
    expect(sent.find((m) => m.type === "open_folder")).toBeUndefined(); // already the vault's session
    const box = screen.getByRole("combobox", { name: "Message" });
    fireEvent.change(box, { target: { value: "which of these matter?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(sent).toContainEqual({ type: "user_text", text: "which of these matter?", interrupt: false });
    expect(dock()!.querySelector(".vpill")).toBeTruthy();
  });

  it("opened on a note names it in an about chip; the next request carries it until the chip is removed", () => {
    vi.useFakeTimers();
    useConnection.setState({ state: "online" });
    useSession.setState({ ...initialSession(), folder: VAULT, session: "v1" });
    const n = { file: "inbox/a.md", title: "Alpha", kind: "capture", mtime: 0, score: 8, lane: "news", why: "", waiting: true, verdict: "", owner_read: "", body: "The text." };
    useBrain.setState({ file: n.file, note: { ...n, type: "brain_note" } as never });
    useViews.setState({ view: "note" });
    const off = wireScreen();
    render(<Page />);
    fireEvent.click(chip()!);
    expect(screen.getByText("about: Alpha")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(400); });
    expect(sent.filter((m) => m.type === "screen").at(-1)).toMatchObject({ name: "Note" });
    fireEvent.click(screen.getByRole("button", { name: "Don't send Alpha with the next request" }));
    expect(screen.queryByText("about: Alpha")).toBeNull();
    act(() => { vi.advanceTimersByTime(400); });
    expect(sent.filter((m) => m.type === "screen").at(-1)).toEqual({ type: "screen", name: null });
    off();
  });

  it("a list has no about chip", () => {
    useViews.setState({ view: "brain" });
    render(<Page />);
    fireEvent.click(chip()!);
    expect(screen.queryByText(/^about:/)).toBeNull();
  });

  it("four columns while the main area keeps 560 px beside it, over the main area below that, a sheet when narrow", () => {
    expect(dockLayout(1400, 440, false)).toBe("beside");
    expect(columnCount("beside", true)).toBe(4);
    expect(dockLayout(900, 440, false)).toBe("over");
    expect(columnCount("over", true)).toBe(3);
    expect(dockLayout(1400, 440, true)).toBe("sheet");
    expect(dockLayout(1000, 440, false)).toBe("beside"); // exactly 560 left
    expect(dockLayout(999, 440, false)).toBe("over");
  });

  it("is a sheet on a narrow screen, with no resize grip", () => {
    narrow(true);
    useViews.setState({ view: "tasks" });
    render(<Page />);
    fireEvent.click(chip()!);
    expect(dock()!.dataset.layout).toBe("sheet");
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("opening it closes the panel's sheet: one at a time", () => {
    narrow(true);
    useSession.setState({ drawer: true });
    useViews.setState({ view: "tasks" });
    render(<Page />);
    fireEvent.click(chip()!);
    expect(useSession.getState().drawer).toBe(false);
  });
});
