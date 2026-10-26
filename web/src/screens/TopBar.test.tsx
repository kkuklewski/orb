// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initialSession, useSession } from "../stores/session";
import { useViews } from "../stores/views";
import { useItems } from "../stores/items";
import { useFeatures } from "../stores/features";

const sent: unknown[] = [];
vi.mock("../ws", () => ({ send: (m: unknown) => { sent.push(m); return true; }, on: () => () => {} }));
const { TopBar } = await import("./TopBar");

function narrow(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

beforeEach(() => {
  narrow(false);
  sent.length = 0;
  useSession.setState({ ...initialSession() });
  useViews.setState({ view: "home" });
  useItems.setState({ source: null, id: null, lists: {}, item: null });
  useFeatures.setState({ features: { vault: "/dev/notes" } as never, folders: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const where = () => screen.getByLabelText("You are here").textContent;

describe("TopBar", () => {
  it("names the destination with no session chips when no session is open", () => {
    useViews.setState({ view: "chat" });
    render(<TopBar />);
    expect(where()).toBe("Sessions");
    expect(screen.queryByText("No repo open")).toBeNull();
    expect(screen.queryByText("New session")).toBeNull();
  });

  it("shows the session chips on a session", () => {
    useSession.setState({ ...initialSession(), folder: "/dev/web", label: "acme/web", session: "k1" });
    useFeatures.setState({ folders: [{ label: "acme/web", path: "/dev/web", sessions: [{ key: "k1", label: "fix the login" }] }] as never });
    useViews.setState({ view: "chat" });
    render(<TopBar />);
    expect(where()).toBe("Sessions › web · fix the login");
    expect(screen.getByText("New session")).toBeTruthy();
    expect(screen.queryByText("Home chat")).toBeNull();
  });

  it("drops the session chips on Tasks, offers the Home chat there, and the destination opens its list", () => {
    useSession.setState({ ...initialSession(), folder: "/dev/web", label: "acme/web" });
    useItems.setState({ source: "vikunja", id: "42", lists: { vikunja: { rows: [{ id: "42", title: "Ship it" }] } as never } });
    useViews.setState({ view: "item" });
    render(<TopBar />);
    expect(where()).toBe("Tasks › #42 Ship it");
    expect(screen.queryByText("New session")).toBeNull();
    expect(screen.getByText("Home chat")).toBeTruthy();
    fireEvent.click(screen.getByText("Tasks"));
    expect(useViews.getState().view).toBe("tasks");
  });

  it("collapses to a back arrow and the item when narrow", () => {
    narrow(true);
    useItems.setState({ source: "notes", id: "a.md", lists: { notes: { rows: [{ id: "a.md", title: "Reading list" }] } as never } });
    useViews.setState({ view: "item" });
    render(<TopBar />);
    expect(where()).toBe("Reading list");
    fireEvent.click(screen.getByLabelText("Back to Brain"));
    expect(useViews.getState().view).toBe("items");
    expect(sent).toContainEqual({ type: "item_list", source: "notes" });
  });
});
