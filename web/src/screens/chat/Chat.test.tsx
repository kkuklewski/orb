// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ServerEvent } from "../../protocol.gen";
import { initialChat, reduce, useChat } from "../../stores/chat";
import { initialSession, useSession } from "../../stores/session";

const sent: Record<string, unknown>[] = [];
vi.mock("../../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { ChatLog } = await import("./Chat");
const { toSafeHtml } = await import("./Markdown");
const { Composer } = await import("../Composer");

const play = (...events: ServerEvent[]) => act(() => useChat.setState((s) => events.reduce(reduce, s)));
const user = (id: string, text = "hi"): ServerEvent => ({ type: "user", id, text, source: "typed" });
const done: ServerEvent = { type: "result", subtype: "success" };

beforeEach(() => {
  sent.length = 0;
  useChat.setState(initialChat());
  useSession.setState({ ...initialSession(), folder: "/a/web", session: "s1" });
});
afterEach(cleanup);

describe("markdown", () => {
  it("renders GFM and strips anything executable", () => {
    const html = toSafeHtml("**b** <img src=x onerror=alert(1)><script>alert(1)</script>\n\n[x](javascript:alert(1))");
    expect(html).toContain("<strong>b</strong>");
    expect(html).not.toMatch(/onerror|<script|javascript:/);
  });
});

describe("chat log", () => {
  it("shows your message, the spoken line and the written answer with a code block", () => {
    render(<ChatLog />);
    play(user("u1", "check it"), { type: "said", block: "b1", delta: "Looks fine." },
      { type: "text", block: "b1", delta: "Run:\n\n```sh\nnpm test\n```\n" }, done);
    expect(screen.getByText("check it")).toBeTruthy();
    expect(screen.getByText("said aloud")).toBeTruthy();
    expect(screen.getByText("Looks fine.")).toBeTruthy();
    const code = document.querySelector(".code")!;
    expect(code.textContent).toContain("npm test");
    expect(within(code as HTMLElement).getByRole("button", { name: "Copy code" })).toBeTruthy();
  });

  it("collapses tool steps into one line that opens to each step and its output", () => {
    render(<ChatLog />);
    play(user("u1"), { type: "tool_input", id: "t1", name: "Read", input: { file_path: "/a/app.ts" }, summary: "Read app.ts" },
      { type: "tool_result", tool_use_id: "t1", is_error: false, content: "line 1", truncated: true });
    expect(screen.getByText("Read app.ts", { selector: ".label" })).toBeTruthy();
    const step = screen.getByRole("button", { name: "Read app.ts" });
    fireEvent.click(step);
    expect(document.querySelector(".tool-row .out")!.textContent).toBe("line 1\n… (truncated)");
  });

  it("an approval card answers with Allow / Deny and then shows the verdict", () => {
    render(<ChatLog />);
    play(user("u1"), { type: "permission", id: "p1", tool: "Bash", input: { command: "rm -rf build" }, summary: "Bash", title: "Claude wants to run rm" });
    const card = screen.getByRole("group", { name: "Approval needed" });
    expect(within(card).getByText("rm -rf build")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Allow" }));
    expect(sent).toEqual([{ type: "permission", id: "p1", allow: true }]);
    play({ type: "permission_done", id: "p1", allow: true });
    expect(card.className).toContain("done");
    expect(within(card).getByText("Allowed")).toBeTruthy();
  });

  it("a question card sends every answer at once; Skip declines", () => {
    render(<ChatLog />);
    play(user("u1"), { type: "permission", id: "q1", tool: "AskUserQuestion", summary: "",
      input: { questions: [{ question: "Which DB?", options: [{ label: "Postgres" }, { label: "SQLite" }] }, { question: "Tests?", options: [{ label: "Yes" }, { label: "No" }] }] } });
    fireEvent.click(screen.getByRole("button", { name: "SQLite" }));
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    expect(sent).toEqual([{ type: "permission", id: "q1", allow: true, answers: { "Which DB?": "SQLite", "Tests?": "Yes" } }]);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(sent.at(-1)).toEqual({ type: "permission", id: "q1", allow: false });
  });

  it("a plan card shows the plan as markdown, sanitized", () => {
    render(<ChatLog />);
    play(user("u1"), { type: "permission", id: "pl", tool: "ExitPlanMode", summary: "", input: { plan: "## Plan\n\n1. Do it <img src=x onerror=alert(1)>" } });
    const card = screen.getByRole("group", { name: "Plan ready" });
    expect(within(card).getByRole("heading", { name: "Plan" })).toBeTruthy();
    expect(card.innerHTML).not.toContain("onerror");
    fireEvent.click(within(card).getByRole("button", { name: "Keep planning" }));
    expect(sent).toEqual([{ type: "permission", id: "pl", allow: false }]);
  });

  it("a finished answer offers Copy, Read all and Undo; undo goes through its card", () => {
    render(<ChatLog />);
    play(user("u1"), { type: "text", block: "b1", delta: "Changed two files." }, done, { type: "undo_available", user_id: "u1", files: ["a.py", "b.py"] });
    fireEvent.click(screen.getByRole("button", { name: "Read all" }));
    expect(sent).toEqual([{ type: "read_all", text: "Changed two files." }]);
    fireEvent.click(screen.getByRole("button", { name: "Undo (2 files)" }));
    expect(sent.at(-1)).toEqual({ type: "undo_request", user_id: "u1" });
    play({ type: "undo_confirm", id: "d1", user_id: "u1", files: ["a.py", "b.py"], note: "Only these files." });
    const card = screen.getByRole("group", { name: "Undo file changes" });
    fireEvent.click(within(card).getByRole("button", { name: "Restore 2 files" }));
    expect(sent.at(-1)).toEqual({ type: "undo_confirm", id: "d1", ok: true });
    play({ type: "undo_done", id: "d1", ok: true, user_id: "u1" });
    expect((screen.getByRole("button", { name: "Undone" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("notices, errors and the end of a stopped turn", () => {
    render(<ChatLog />);
    play({ type: "notice", text: "Model: Opus", level: "ok" }, { type: "error", text: "Claude Code crashed" }, user("u1"), { type: "result", subtype: "error_during_execution", is_error: true });
    expect(screen.getByRole("alert").textContent).toBe("Claude Code crashed");
    expect(screen.getByText("Stopped.")).toBeTruthy();
  });

  it("user text is never parsed as HTML", () => {
    render(<ChatLog />);
    play(user("u1", "<b>not bold</b>"));
    expect(screen.getByText("<b>not bold</b>")).toBeTruthy();
  });
});

describe("composer while busy", () => {
  it("shows Stop instead of Send when the box is empty", () => {
    useSession.setState({ busy: true });
    render(<Composer />);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(sent).toEqual([{ type: "interrupt" }]);
    fireEvent.change(screen.getByRole("combobox", { name: "Message" }), { target: { value: "also this" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
  });
});
