// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialSession, useSession } from "../stores/session";
import { useSessionsList } from "../stores/sessionsList";
import { folder, session } from "../test/fixtures";
import type { Features, FolderItem } from "../protocol.gen";

vi.mock("../ws", () => ({ send: () => true }));

const { Sidebar } = await import("./Sidebar");
const { Sessions } = await import("./Sessions");
const { SessionsAdjust, panelKind } = await import("./Panel");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: true, stt: "browser", tts: "kokoro", vault: "", ...over,
});
const VAULT = "/Users/a/code/brain";
const base = (): FolderItem[] => [
  folder("web", [session("w1", "approval", { label: "fix login", last_used: 20 }), session("w2", "idle", { label: "notes", last_used: 10 })]),
  folder("api", [session("a1", "done", { label: "add tests", last_used: 30 }), session("a2", "working", { label: "migrate", last_used: 25 })]),
  folder("brain", [session("b1", "idle", { label: "plan the week", last_used: 40 })]),
];
const regions = (root: HTMLElement = document.body) => within(root).queryAllByRole("region").map((g) => g.getAttribute("aria-label"));
const labels = (name: string) => within(screen.getByRole("region", { name })).getAllByRole("button").flatMap((b) => b.querySelector(".act-label")?.textContent ?? []);

beforeEach(() => {
  localStorage.clear();
  useSession.setState(initialSession());
  useViews.setState({ view: "sessions", settings: null, routines: null, routinesNew: new Set(), running: false });
  useSessionsList.setState({ repos: [], byRepo: false, q: "" });
  useFeatures.setState({ features: features({ vault: VAULT }), folders: base(), services: {}, build: null });
});
afterEach(cleanup);

describe("sessions list by state", () => {
  it("Waiting, Running, Finished, Earlier, each row 'repo · first request', the Home chat's sessions never", () => {
    render(<Sessions />);
    expect(regions()).toEqual(["Waiting", "Running", "Finished", "Earlier"]);
    expect(labels("Waiting")).toEqual(["web · fix login"]);
    expect(labels("Running")).toEqual(["api · migrate"]);
    expect(labels("Finished")).toEqual(["api · add tests"]);
    expect(labels("Earlier")).toEqual(["web · notes"]);
    expect(screen.queryByText(/plan the week/)).toBeNull();
    const row = screen.getByRole("button", { name: /fix login/ });
    expect(row.querySelector(".act-status")?.textContent).toBe("waiting");
  });

  it("Earlier past 20 rows is behind Show older", () => {
    const many = Array.from({ length: 25 }, (_, i) => session(`o${i}`, "idle", { label: `old ${i}`, last_used: 100 - i }));
    useFeatures.setState({ folders: [folder("web", many)] });
    render(<Sessions />);
    expect(labels("Earlier")).toHaveLength(20);
    fireEvent.click(screen.getByRole("button", { name: "Show older (5)" }));
    expect(labels("Earlier")).toHaveLength(25);
  });

  it("a session that changes state changes its word but keeps its place until the list opens again", () => {
    const { unmount } = render(<Sessions />);
    act(() => useFeatures.setState({ folders: base().map((f) => ({ ...f, sessions: f.sessions?.map((s) => s.key === "w2" ? { ...s, status: "working" } : s) })) }));
    expect(labels("Earlier")).toEqual(["web · notes"]);
    expect(screen.getByRole("button", { name: /notes/ }).querySelector(".act-status")?.textContent).toBe("running");
    unmount();
    render(<Sessions />);
    expect(labels("Running")).toEqual(["api · migrate", "web · notes"]);
    expect(regions()).not.toContain("Earlier");
  });

  it("the panel filters by repo, groups by repo and searches", () => {
    render(<><Sessions /><SessionsAdjust /></>);
    const repos = within(screen.getByRole("group", { name: "Repos" }));
    expect(repos.getAllByRole("checkbox").map((c) => c.parentElement?.textContent)).toEqual(["api", "web"]); // the vault isn't a choice
    fireEvent.click(repos.getByRole("checkbox", { name: "api" }));
    expect(screen.queryByText(/fix login/)).toBeNull();
    expect(regions()).toEqual(["Running", "Finished"]);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(regions()).toEqual(["Waiting", "Running", "Finished", "Earlier"]);
    fireEvent.click(screen.getByRole("button", { name: "Group by repo" }));
    expect(screen.getByRole("button", { name: "Group by repo" }).getAttribute("aria-pressed")).toBe("true");
    expect(regions()).toEqual(["api", "web"]);
    expect(screen.getByText("by repo")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search sessions"), { target: { value: "migr" } });
    expect(regions()).toEqual(["api"]);
  });
});

describe("the panel", () => {
  const panel = (c: HTMLElement) => c.querySelector<HTMLElement>(".side-panel");

  it("which panel each screen has; the chat sheet keeps its screen's", () => {
    expect(panelKind("home", null)).toBe("none");
    expect(panelKind("sessions", null)).toBe("sessions");
    expect(panelKind("chat", "/x")).toBe("siblings");
    expect(panelKind("items", null)).toBe("legacy");
  });

  it("Home has no panel and no panel toggle", () => {
    useViews.setState({ view: "home" });
    const { container } = render(<Sidebar />);
    expect(panel(container)).toBeNull();
    expect(container.querySelector<HTMLElement>(".rail-toggle")?.hidden).toBe(true);
  });

  it("Sessions' panel holds its adjustments", () => {
    const { container } = render(<Sidebar />);
    const p = within(panel(container)!);
    expect(p.getByLabelText("Search sessions")).toBeTruthy();
    expect(p.getByRole("button", { name: "Group by repo" })).toBeTruthy();
  });

  it("a session's panel lists its siblings by state with their repo; the Home chat's only each other", () => {
    useViews.setState({ view: "chat" });
    useSession.setState({ folder: "/Users/a/code/web", session: "w1" });
    const { container, unmount } = render(<Sidebar />);
    const p = panel(container)!;
    expect(regions(p)).toEqual(["Waiting", "Running", "Finished", "Earlier"]);
    expect(within(within(p).getByRole("region", { name: "Running" })).getByText("api")).toBeTruthy();
    expect(within(p).queryByText("plan the week")).toBeNull();
    unmount();
    useSession.setState({ folder: VAULT, session: "b1" });
    const vault = panel(render(<Sidebar />).container)!;
    expect(within(vault).getByText("Home chat")).toBeTruthy();
    expect(within(vault).getByText("plan the week")).toBeTruthy();
    expect(within(vault).queryByText("fix login")).toBeNull();
  });
});
