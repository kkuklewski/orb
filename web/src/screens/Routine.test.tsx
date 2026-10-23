// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ServerEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialSession, useSession, wireSession } from "../stores/session";
import { useRoutineScreen, routineText } from "../stores/routine";
import { useTasks, wireTasks } from "../stores/tasks";
import { wireChat, initialChat, useChat } from "../stores/chat";
import { parseRoute, routePath } from "../stores/route";
import { routine, routines } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { RoutineScreen } = await import("./Routine");
const { TaskToast } = await import("./Task");
const { Routines } = await import("./Routines");

const DETAIL = "**Inbox cleanup summary**\nI reviewed 16 threads.\n\n(a) Needs your attention today:\n- <img src=x onerror=alert(1)> invoice";
const gmail = (over = {}) => routine({ id: "t1", name: "Gmail morning cleanup", new: true, loud: true, worth: "read", why: "urgent alert sent",
  last: { id: "r1", at: 1_761_200_000, ended: 1_761_200_100, outcome: "ok", summary: "**Inbox cleanup summary** I reviewed", detail: DETAIL, url: "https://claude.ai/code/session_1" }, ...over });

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  offs = [wireTasks(), wireSession(), wireChat()];
  useChat.setState(initialChat());
  useSession.setState(initialSession());
  useFeatures.setState({ features: { brain: false, onboarded: true, roots: [], routines: true, stt: "browser", tts: "kokoro", vault: "/v", plan: "max" }, folders: [], services: {}, build: null });
  useViews.setState({ view: "routine", routines: routines({ read: 1, items: [gmail(), routine({ id: "t2", name: "Etihad check", quiet: true, worth: "skip", why: "no new email" })] }), routinesNew: new Set() });
  useRoutineScreen.setState({ id: "t1" });
  useTasks.setState({ task: null, detail: null, toast: null, next: null });
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("routine result screen", () => {
  it("shows the whole result as plain text, the judge's reason, and where it sits in the list", () => {
    render(<RoutineScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Gmail morning cleanup" })).toBeTruthy();
    expect(screen.getByText("worth reading: urgent alert sent")).toBeTruthy();
    const result = document.querySelector(".routine-text")!;
    expect(result.textContent).toBe(DETAIL);              // all of it, not the 240-char row
    expect(result.querySelector("img")).toBeNull();       // text, never markup
    expect(screen.getByText("1 OF 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next routine" }));
    expect(useRoutineScreen.getState().id).toBe("t2");
  });

  it("Mark read, Open run and the notify choice", () => {
    render(<RoutineScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    expect(sent.at(-1)).toEqual({ type: "routines_seen", id: "t1" });
    expect(screen.getAllByRole("link", { name: "Open run ↗" })[0].getAttribute("href")).toBe("https://claude.ai/code/session_1");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Notify for Gmail morning cleanup" })).getByRole("radio", { name: "Never" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { routines_notify: { t1: "never" } } });
    act(() => useViews.setState({ routines: routines({ items: [gmail({ new: false, loud: false })] }) }));
    expect((screen.getByRole("button", { name: "Read" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("only links to claude.ai", () => {
    act(() => useViews.setState({ routines: routines({ items: [gmail({ last: { id: "r1", outcome: "ok", detail: "x", url: "https://evil.test/x" } })] }) }));
    render(<RoutineScreen />);
    expect(screen.queryByRole("link", { name: /Open run/ })).toBeNull();
  });

  it("Make it a task asks the server, and Undo takes the added line out again", () => {
    render(<><RoutineScreen /><TaskToast /></>);
    fireEvent.click(screen.getByRole("button", { name: "Make it a task" }));
    expect(sent.at(-1)).toEqual({ type: "routine_task", id: "t1" });
    const line = '- [ ] Look at the result of "Gmail morning cleanup" (2026-10-23) https://claude.ai/code/session_1';
    act(() => dispatch({ type: "task_changed", file: "inbox/Orb tasks.md", line: 3, action: "add", raw: line, previous: "" } as ServerEvent));
    expect(screen.getByRole("status").textContent).toContain("Added to your notes: Look at the result of");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "task_action", file: "inbox/Orb tasks.md", line: 3, expect: line, action: "delete" });
  });

  it("Make it a task needs a notes folder", () => {
    useFeatures.setState((s) => ({ features: { ...s.features!, vault: "" } }));
    render(<RoutineScreen />);
    expect((screen.getByRole("button", { name: "Make it a task" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Ask Claude starts a notes session; the result goes along as the screen, not inside the question", () => {
    render(<RoutineScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude about it/ }));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/v" });
    act(() => dispatch({ type: "opened", folder: "/v", session: "n1", label: "notes", rel: "notes", branch: null, session_id: null,
      live: false, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    const [screenMsg, ask] = sent.slice(-2) as { type: string; name?: string; text: string }[];
    expect(screenMsg).toMatchObject({ type: "screen", name: "Routine" });
    expect(screenMsg.text).toContain(DETAIL);
    expect(ask).toMatchObject({ type: "user_text", text: expect.stringContaining('"Gmail morning cleanup"') });
    expect(ask.text).not.toContain("invoice"); // untrusted text never in the question itself
    expect(useViews.getState().view).toBe("routine"); // the answer comes here, the page doesn't change
  });

  it("the answer appears right under the result, with a way into the full chat", () => {
    render(<RoutineScreen />);
    expect(screen.getByText(/Press “Ask Claude about it”, or type below/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude about it/ }));
    act(() => dispatch({ type: "opened", folder: "/v", session: "n1", label: "notes", rel: "notes", branch: null, session_id: null,
      live: false, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    act(() => dispatch({ type: "user", id: "u1", text: "What does the result of my routine say?", source: "typed", screen: "Routine", session: "n1" } as ServerEvent));
    act(() => dispatch({ type: "text", block: "b1", delta: "Check the **Microsoft** login alert today.", session: "n1" } as ServerEvent));
    act(() => dispatch({ type: "result", subtype: "success", session: "n1" } as ServerEvent));
    const thread = screen.getByRole("article", { name: "Ask Claude about this result" });
    expect(within(thread).getByText("What does the result of my routine say?")).toBeTruthy();
    expect(thread.textContent).toContain("Check the Microsoft login alert today.");
    expect(thread.textContent).toContain("about Routine");
    fireEvent.click(within(thread).getByRole("button", { name: "Open in chat →" }));
    expect(useViews.getState().view).toBe("chat");
  });

  it("a question typed in the box while looking at a result is answered here too; other chats don't show up", () => {
    act(() => dispatch({ type: "user", id: "u0", text: "An older chat", source: "typed" } as ServerEvent));
    act(() => dispatch({ type: "text", block: "b0", delta: "Old answer", session: undefined } as unknown as ServerEvent));
    render(<RoutineScreen />);
    expect(screen.queryByText("An older chat")).toBeNull();
    act(() => dispatch({ type: "user", id: "u1", text: "is the Acme one urgent?", source: "typed", screen: "Routine" } as ServerEvent));
    act(() => dispatch({ type: "text", block: "b1", delta: "Probably not." } as ServerEvent));
    expect(screen.getByText("is the Acme one urgent?")).toBeTruthy();
    expect(screen.getByText("Probably not.")).toBeTruthy();
    expect(screen.queryByText("Old answer")).toBeNull();
    act(() => dispatch({ type: "result", subtype: "success" } as ServerEvent));
    act(() => dispatch({ type: "user", id: "u2", text: "and the Microsoft one?", source: "typed", screen: "Routine" } as ServerEvent));
    expect(screen.getByText("is the Acme one urgent?")).toBeTruthy(); // a follow-up adds to the thread, it doesn't replace it
    expect(screen.getByText("and the Microsoft one?")).toBeTruthy();
  });

  it("opens by address", () => {
    expect(parseRoute("/next/r/trig_01AB")).toEqual({ view: "routine", session: null, routine: "trig_01AB" });
    expect(routePath({ view: "routine", session: null, routine: "trig_01AB" })).toBe("/next/r/trig_01AB");
    expect(routineText(gmail())).toContain("urgent alert sent");
  });
});

describe("from the list", () => {
  it("a name opens its screen; opening the list keeps worth-reading results unread; Mark all read", () => {
    useViews.setState({ view: "routines" });
    render(<Routines />);
    expect(sent).toContainEqual({ type: "routines_seen" }); // the server clears only what doesn't notify
    fireEvent.click(screen.getByRole("button", { name: "Gmail morning cleanup" }));
    expect(useViews.getState().view).toBe("routine");
    expect(useRoutineScreen.getState().id).toBe("t1");
    act(() => useViews.setState({ view: "routines" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(sent.at(-1)).toEqual({ type: "routines_seen", all: true });
  });
});
