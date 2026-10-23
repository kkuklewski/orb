// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Features, HomeEvent, ServerEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialSession, useSession, wireSession } from "../stores/session";
import { initialSetup, useSetup, wireSetup } from "../stores/setup";
import { ASK_TODAY, greeting, needsYou, routinesLine, useHome, wireHome } from "../stores/home";
import { folder, routine, routines, session, status } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { Home } = await import("./Home");
const { Notes } = await import("./setup/steps");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: true, stt: "browser", tts: "kokoro", vault: "/Users/a/notes", ...over,
});
const notes = (over: Partial<HomeEvent> = {}): HomeEvent => ({
  type: "home", vault: "/Users/a/notes", open_tasks: 14, notes_week: 9,
  tasks: [{ text: "Send the invoice", file: "inbox/today.md", line: 3, mtime: 1, raw: "- [ ] Send the invoice" }], snoozed: 0,
  notes: [{ title: "Weekly review", file: "reviews/w43.md", mtime: Date.now() / 1000 - 3600 }], ...over,
});

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  offs = [wireSession(), wireHome(), wireSetup()];
  useSession.setState(initialSession());
  useViews.setState({ view: "home", settings: null, routines: routines({ items: [routine({ last: { id: "r", outcome: "ok" } })] }), routinesNew: new Set() });
  useFeatures.setState({ features: features(), folders: [folder("web", [session("w1", "approval", { label: "fix login" })])], services: {}, build: null });
  useHome.setState({ notes: null });
  useSetup.setState(initialSetup);
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("home helpers", () => {
  it("greets by the hour", () => {
    expect([3, 9, 14, 21].map(greeting)).toEqual(["Working late.", "Good morning.", "Good afternoon.", "Good evening."]);
  });
  it("needs you: waiting sessions and routines that need attention", () => {
    const n = needsYou([folder("web", [session("a", "approval"), session("b", "working"), session("c", "idle")])], routines({ items: [routine({ needs: "failed" }), routine({ id: "x" })] }));
    expect([n.waiting.length, n.working.length, n.done.length, n.routines.length]).toEqual([1, 1, 0, 1]);
  });
  it("routines line: ok, needing you, the next run", () => {
    const r = routines({ needs: 1, items: [routine({ last: { id: "1", outcome: "ok" }, next_run_at: 200 }), routine({ id: "b", name: "inbox", needs: "failed", next_run_at: 100 })] });
    expect(routinesLine(r, (ts) => `@${ts}`)).toBe("1 ok · 1 needs you · next: inbox @100");
    expect(routinesLine(null, String)).toBe("checking…");
  });
});

describe("home screen", () => {
  it("asks for the notes summary and the routines when it opens", () => {
    render(<Home />);
    expect(sent).toEqual([{ type: "home" }, { type: "routines" }]);
  });

  it("reads like a brief: the paragraph, the numbers, the cards and the notes", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    const brief = document.querySelector(".home-brief")!.textContent!;
    expect(brief).toContain("One session is waiting for your OK in web.");
    expect(brief).toContain("Your notes hold 14 open tasks, and 9 notes changed this week.");
    expect(brief).toContain("All 1 routine ran fine.");
    expect(screen.getByRole("article", { name: "fix login" })).toBeTruthy();
    const todo = screen.getByRole("article", { name: "14 open tasks, newest first" });
    expect(within(todo).getByRole("button", { name: "Send the invoice" })).toBeTruthy();
    expect(within(todo).getByText("+ 13 more in your notes")).toBeTruthy();
    expect(screen.getByText("Weekly review")).toBeTruthy();
  });

  it("a task's checkbox marks it done; its text opens the task", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    sent.length = 0;
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark done: Send the invoice" }));
    expect(sent).toEqual([{ type: "task_action", file: "inbox/today.md", line: 3, expect: "- [ ] Send the invoice", action: "done" }]);
    fireEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    expect(sent.at(-1)).toEqual({ type: "task_detail", file: "inbox/today.md", line: 3 });
    expect(useViews.getState().view).toBe("task");
  });

  it("“Ask for today's plan” starts a notes session and sends the question once it opens", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Ask for today's plan →" }));
    expect(sent).toEqual([{ type: "start_session", path: "/Users/a/notes" }]);
    act(() => dispatch({ type: "opened", folder: "/Users/a/notes", session: "n1", label: "notes", rel: "notes", branch: null, session_id: null,
      live: false, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    expect(sent.at(-1)).toMatchObject({ type: "user_text", text: ASK_TODAY });
    expect(useViews.getState().view).toBe("chat");
  });

  it("without a notes folder it offers to connect one", () => {
    useFeatures.setState((s) => ({ features: { ...s.features!, vault: "" } }));
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Choose notes folder" }));
    expect(useSetup.getState()).toMatchObject({ open: true, step: 3 });
    expect(screen.queryByRole("button", { name: "Ask for today's plan →" })).toBeNull();
  });
});

describe("start-up", () => {
  it("reopens the last session quietly: Home stays, a request switches to the chat", () => {
    localStorage.setItem("vd-folder", "/Users/a/code/web");
    localStorage.setItem("vd-session", "w1");
    act(() => dispatch({ type: "hello", build: "x", folders: [folder("web")], services: {}, ...features() } as unknown as ServerEvent));
    expect(sent).toContainEqual({ type: "open_folder", path: "/Users/a/code/web", session: "w1" });
    act(() => dispatch({ type: "opened", folder: "/Users/a/code/web", session: "w1", label: "web", rel: "web", branch: null, session_id: null,
      live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    expect(useViews.getState().view).toBe("home");
    act(() => dispatch({ type: "user", id: "u1", text: "hi", source: "voice", session: "w1" }));
    expect(useViews.getState().view).toBe("chat");
  });
});

describe("setup: notes step", () => {
  it("shows the chosen folder with what's in it, and chooses by path or Finder", () => {
    useSetup.setState({ open: true, step: 3, status: status({ vault: { path: "/Users/a/notes", exists: true, notes: 359, open_tasks: 31 } }) });
    render(<Notes />);
    expect(screen.getByText("359 notes · 31 open tasks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notes folder path"), { target: { value: "~/Brain" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { vault: "/Users/a/Brain" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose in Finder…" }));
    expect(sent.at(-1)).toEqual({ type: "pick_folder" });
    act(() => dispatch({ type: "picked", path: "/Users/a/Vault" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { vault: "/Users/a/Vault" } });
  });

  it("is optional: Skip for now", () => {
    useSetup.setState({ open: true, step: 3, status: status() });
    render(<Notes />);
    expect(screen.getByText(/This step is optional/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Skip for now" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
