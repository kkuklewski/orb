// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ServerEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialSession, useSession, wireSession } from "../stores/session";
import { useMakeTask, useRoutineScreen, routineText, wireMakeTask } from "../stores/routine";
import { useTasks, wireTasks } from "../stores/tasks";
import { wireChat, initialChat, useChat } from "../stores/chat";
import { parseRoute, routePath } from "../stores/route";
import { routine, routines } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { RoutineScreen } = await import("./Routine");
const { Routines } = await import("./Routines");

const DETAIL = "**Inbox cleanup summary**\nI reviewed 16 threads.\n\n(a) Needs your attention today:\n- <img src=x onerror=alert(1)> invoice";
const gmail = (over = {}) => routine({ id: "t1", name: "Gmail morning cleanup", new: true, loud: true, worth: "read", why: "urgent alert sent", state: "worth reading",
  last: { id: "r1", at: 1_761_200_000, ended: 1_761_200_100, outcome: "ok", summary: "**Inbox cleanup summary** I reviewed", detail: DETAIL, url: "https://claude.ai/code/session_1" }, ...over });

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  offs = [wireTasks(), wireSession(), wireChat(), wireMakeTask()];
  useMakeTask.setState({ routine: null, pending: false, card: null, done: null, undone: null });
  useChat.setState(initialChat());
  useSession.setState(initialSession());
  useFeatures.setState({ features: { brain: false, onboarded: true, roots: [], routines: true, stt: "browser", tts: "kokoro", vault: "/v", plan: "max" }, folders: [], services: {}, build: null });
  useViews.setState({ view: "routine", routines: routines({ read: 1, items: [gmail(), routine({ id: "t2", name: "Etihad check", quiet: true, worth: "skip", why: "no new email" })] }), routinesNew: new Set() });
  useRoutineScreen.setState({ id: "t1" });
  useTasks.setState({ task: null, detail: null, toast: null, next: null });
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("routine page", () => {
  it("shows the whole run as rendered markdown, the judge's reason, and where it sits in the list", () => {
    render(<RoutineScreen />);
    expect(screen.getByRole("heading", { level: 1, name: "Gmail morning cleanup" })).toBeTruthy();
    expect(screen.getByText("worth reading: urgent alert sent")).toBeTruthy();
    const result = document.querySelector(".routine-text")!;
    expect(result.querySelector("strong")?.textContent).toBe("Inbox cleanup summary");  // rendered, not raw **
    expect(result.querySelector("[onerror]")).toBeNull();  // sanitized
    expect(screen.getByText("1 OF 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next routine" }));
    expect(useRoutineScreen.getState().id).toBe("t2");
  });

  it("Mark resolved only on a reported problem, and Undo once resolved", () => {
    render(<RoutineScreen />);
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();  // worth reading: nothing to resolve
    act(() => useViews.setState({ routines: routines({ items: [gmail({ needs: "action", state: "needs you" })] }) }));
    fireEvent.click(screen.getByRole("button", { name: "Mark resolved" }));
    expect(sent.at(-1)).toEqual({ type: "routines_resolve", id: "t1", undo: false });
    act(() => useViews.setState({ routines: routines({ items: [gmail({ resolved: true, state: "nothing to report" })] }) }));
    expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
    expect(screen.getByText("resolved by you; the next run is judged afresh")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resolved · Undo" }));
    expect(sent.at(-1)).toEqual({ type: "routines_resolve", id: "t1", undo: true });
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

  it("shows when it runs next, or the run it missed", () => {
    const at = new Date(2026, 9, 26, 6, 0).getTime() / 1000;
    act(() => useViews.setState({ routines: routines({ items: [gmail({ next_run_at: at })] }) }));
    const { unmount } = render(<RoutineScreen />);
    expect(screen.getByText(/^next .*06:00$/)).toBeTruthy();
    expect(screen.getByText(/^last run /)).toBeTruthy();
    unmount();
    act(() => useViews.setState({ routines: routines({ items: [gmail({ next_run_at: null, missed_at: at, state: "missed", needs: "missed" })] }) }));
    render(<RoutineScreen />);
    expect(screen.getByText(/^missed .*06:00$/)).toBeTruthy();
  });

  it("only links to claude.ai", () => {
    act(() => useViews.setState({ routines: routines({ items: [gmail({ last: { id: "r1", outcome: "ok", detail: "x", url: "https://evil.test/x" } })] }) }));
    render(<RoutineScreen />);
    expect(screen.queryByRole("link", { name: /Open run/ })).toBeNull();
  });

  it("Make it a task asks first, names the project, creates on Allow and can Undo", () => {
    render(<RoutineScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Make it a task" }));
    expect(sent.at(-1)).toEqual({ type: "make_task", routine: "t1" });
    expect(screen.queryByRole("group", { name: "Make it a task" })).toBeNull(); // nothing written before the card
    act(() => dispatch({ type: "make_task_card", id: "c1", routine: "t1", title: 'Look at the run of "Gmail morning cleanup" (23 Oct)', project: "acme" } as ServerEvent));
    const card = screen.getByRole("group", { name: "Make it a task" });
    expect(card.textContent).toContain('Create a Vikunja task in acme: “Look at the run of "Gmail morning cleanup" (23 Oct)”');
    fireEvent.click(within(card).getByRole("button", { name: "Create the task" }));
    expect(sent.at(-1)).toEqual({ type: "make_task_confirm", id: "c1", ok: true });
    act(() => dispatch({ type: "make_task_done", id: "c1", ok: true, task: 42, title: "Look at the run", url: "http://vikunja.test/tasks/42", project: "acme" } as ServerEvent));
    expect(within(card).getByRole("link", { name: "Look at the run ↗" }).getAttribute("href")).toBe("http://vikunja.test/tasks/42");
    fireEvent.click(within(card).getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "make_task_undo", task: 42 });
    act(() => dispatch({ type: "make_task_undone", task: 42, ok: true } as ServerEvent));
    expect(card.textContent).toContain("Removed");
    expect(within(card).queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("Cancel creates nothing; a failure says why; another routine's card doesn't show", () => {
    render(<RoutineScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Make it a task" }));
    act(() => dispatch({ type: "make_task_card", id: "c9", routine: "t2", title: "x", project: "Inbox" } as ServerEvent));
    expect(screen.queryByRole("group", { name: "Make it a task" })).toBeNull();
    act(() => dispatch({ type: "make_task_card", id: "c1", routine: "t1", title: "x", project: "Inbox" } as ServerEvent));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sent.at(-1)).toEqual({ type: "make_task_confirm", id: "c1", ok: false });
    act(() => dispatch({ type: "make_task_done", id: "c1", ok: false } as ServerEvent));
    expect(screen.getByRole("group", { name: "Make it a task" }).textContent).toContain("Cancelled");
    fireEvent.click(screen.getByRole("button", { name: "Make it a task" }));
    act(() => dispatch({ type: "make_task_card", id: "c2", routine: "t1", title: "x", project: "Inbox" } as ServerEvent));
    act(() => dispatch({ type: "make_task_done", id: "c2", ok: false, error: "Vikunja didn't answer" } as ServerEvent));
    expect(screen.getByRole("group", { name: "Make it a task" }).textContent).toContain("Failed: Vikunja didn't answer");
  });

  it("Make it a task is off when the routine has no run", () => {
    act(() => useViews.setState({ routines: routines({ items: [gmail({ last: null })] }) }));
    render(<RoutineScreen />);
    expect((screen.getByRole("button", { name: "Make it a task" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Ask Claude starts a notes session; the run goes along as the screen, not inside the question", () => {
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

  it("the answer appears right under the run, with a way into the full chat", () => {
    render(<RoutineScreen />);
    expect(screen.getByText(/Press “Ask Claude about it”, or type below/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude about it/ }));
    act(() => dispatch({ type: "opened", folder: "/v", session: "n1", label: "notes", rel: "notes", branch: null, session_id: null,
      live: false, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    act(() => dispatch({ type: "user", id: "u1", text: "What does the last run of my routine say?", source: "typed", screen: "Routine", session: "n1" } as ServerEvent));
    act(() => dispatch({ type: "text", block: "b1", delta: "Check the **Microsoft** login alert today.", session: "n1" } as ServerEvent));
    act(() => dispatch({ type: "result", subtype: "success", session: "n1" } as ServerEvent));
    const thread = screen.getByRole("article", { name: "Ask Claude about this run" });
    expect(within(thread).getByText("What does the last run of my routine say?")).toBeTruthy();
    expect(thread.textContent).toContain("Check the Microsoft login alert today.");
    expect(thread.textContent).toContain("about Routine");
    fireEvent.click(within(thread).getByRole("button", { name: "Open in chat →" }));
    expect(useViews.getState().view).toBe("chat");
  });

  it("a question typed in the box while looking at a run is answered here too; other chats don't show up", () => {
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
    expect(parseRoute("/r/trig_01AB")).toEqual({ view: "routine", session: null, routine: "trig_01AB" });
    expect(routePath({ view: "routine", session: null, routine: "trig_01AB" })).toBe("/r/trig_01AB");
    expect(routineText(gmail())).toContain("urgent alert sent");
  });
});

describe("from the list", () => {
  it("a line opens its page; opening the list keeps worth-reading runs unread; Mark runs read", () => {
    useViews.setState({ view: "routines" });
    render(<Routines />);
    expect(sent).toContainEqual({ type: "routines_seen" }); // the server clears only what doesn't notify
    fireEvent.click(screen.getByRole("button", { name: /^Gmail morning cleanup/ }));
    expect(useViews.getState().view).toBe("routine");
    expect(useRoutineScreen.getState().id).toBe("t1");
    act(() => useViews.setState({ view: "routines" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark runs read" }));
    expect(sent.at(-1)).toEqual({ type: "routines_seen", all: true });
  });
});
