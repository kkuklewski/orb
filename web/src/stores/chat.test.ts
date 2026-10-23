import { describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "../protocol.gen";

vi.mock("../ws", () => ({ send: () => true }));
const { reduce, initialChat, answerText, toolsLabel, phrase, taskText, verdict } = await import("./chat");
type State = ReturnType<typeof initialChat>;

const run = (events: ServerEvent[], s: State = initialChat()) => events.reduce(reduce, s);
const answers = (s: State) => s.items.filter((x) => x.kind === "answer") as Extract<State["items"][number], { kind: "answer" }>[];

const user = (id: string, text = "hi"): ServerEvent => ({ type: "user", id, text, source: "typed" });
const toolIn = (id: string, name: string, input: Record<string, unknown>, summary = name): ServerEvent => ({ type: "tool_input", id, name, input, summary });
const perm = (id: string, tool = "Bash", tool_use_id: string | null = null, input: Record<string, unknown> = { command: "ls" }): ServerEvent =>
  ({ type: "permission", id, tool, input, summary: tool, tool_use_id });

describe("chat reducer", () => {
  it("streams text and the spoken line into one block of the answer", () => {
    const s = run([user("u1"), { type: "text_start", block: "b1" }, { type: "said", block: "b1", delta: "Done. " },
      { type: "text", block: "b1", delta: "**All** " }, { type: "text", block: "b1", delta: "good." }]);
    const [a] = answers(s);
    expect(a.userId).toBe("u1");
    expect(a.parts).toEqual([{ kind: "text", id: "b1", said: "Done. ", text: "**All** good." }]);
    expect(answerText(a)).toBe("Done.\n\n**All** good.");
  });

  it("groups tool steps until text or a card breaks the run", () => {
    const s = run([user("u1"),
      { type: "tool_start", id: "t1", name: "Read" }, toolIn("t1", "Read", { file_path: "/a/app.ts" }, "Read app.ts"),
      toolIn("t2", "Edit", { file_path: "/a/server.py" }),
      { type: "tool_result", tool_use_id: "t1", is_error: false, content: "", truncated: false },
      { type: "text", block: "b1", delta: "ok" },
      toolIn("t3", "Bash", { description: "Run tests" })]);
    const parts = answers(s)[0].parts;
    expect(parts.map((p) => p.kind)).toEqual(["tools", "text", "tools"]);
    const g = parts[0] as Extract<typeof parts[number], { kind: "tools" }>;
    expect(g.running).toBe(true);
    expect(g.rows.map((r) => [r.id, r.summary, r.pending, r.out])).toEqual([["t1", "Read app.ts", false, "(no output)"], ["t2", "Edit", true, null]]);
    expect(toolsLabel(g.rows)).toBe("Read app.ts, edited server.py");
  });

  it("puts an approval card above the steps it belongs to; answering it records the verdict", () => {
    let s = run([user("u1"), toolIn("t1", "Bash", { command: "rm x" }), perm("p1", "Bash", "t1")]);
    expect(answers(s)[0].parts.map((p) => p.kind)).toEqual(["perm", "tools"]);
    s = run([perm("p1", "Bash", "t1")], s); // repeated: ignored
    expect(answers(s)[0].parts).toHaveLength(2);
    s = run([{ type: "permission_done", id: "p1", allow: true, heard: "yes" }], s);
    const p = answers(s)[0].parts[0] as Extract<ReturnType<typeof answers>[number]["parts"][number], { kind: "perm" }>;
    expect(verdict(p)).toBe("Allowed by voice: “yes”");
  });

  it("question cards read their answers; skipping says so", () => {
    const s = run([user("u1"), perm("q1", "AskUserQuestion", null, { questions: [] }), { type: "permission_done", id: "q1", allow: true, answers: { "Which?": "B" } },
      perm("q2", "AskUserQuestion", null, { questions: [] }), { type: "permission_done", id: "q2", allow: false, answers: null }]);
    const ps = answers(s)[0].parts as Extract<ReturnType<typeof answers>[number]["parts"][number], { kind: "perm" }>[];
    expect(ps.map(verdict)).toEqual(["Answered: B", "Skipped"]);
  });

  it("a result ends the answer: steps stop, a spoken-only block becomes its text, errors leave a line", () => {
    const s = run([user("u1"), toolIn("t1", "Read", {}), { type: "said", block: "b1", delta: "All set." },
      { type: "result", subtype: "error_during_execution", is_error: true }]);
    const [a] = answers(s);
    expect(a.done).toBe(true);
    expect(a.parts[0]).toMatchObject({ kind: "tools", running: false, rows: [{ pending: false }] });
    expect(a.parts[1]).toMatchObject({ kind: "text", text: "All set.", said: "" });
    expect(s.items.at(-1)).toMatchObject({ kind: "end", text: "Stopped." });
    expect(s.answer).toBeNull();
  });

  it("a new message starts a new answer", () => {
    const s = run([user("u1"), { type: "text", block: "b1", delta: "one" }, user("u2"), { type: "text", block: "b2", delta: "two" }]);
    expect(s.items.map((x) => x.kind)).toEqual(["user", "answer", "user", "answer"]);
    expect(answers(s).map((a) => [a.userId, a.done])).toEqual([["u1", true], ["u2", false]]);
  });

  it("timing and undo attach to the answer of their request", () => {
    let s = run([user("u1"), { type: "text", block: "b1", delta: "x" }, { type: "result", subtype: "success" },
      { type: "timing", turn: "u1", source: "typed", model: "claude-sonnet-5-5", hops: { ttft: 1200, conn: 40, other: 1 } },
      { type: "undo_available", user_id: "u1", files: ["a.py", "b.py"] }]);
    expect(answers(s)[0]).toMatchObject({ timing: "sonnet-5-5 · conn 0.0 · ttft 1.2", undoFiles: ["a.py", "b.py"] });
    s = run([{ type: "undo_confirm", id: "d1", user_id: "u1", files: ["a.py", "b.py"], note: "git is untouched" },
      { type: "undo_done", id: "d1", ok: true, user_id: "u1" }], s);
    expect(answers(s)[0].undone).toBe(true);
    expect(answers(s)[1].parts[0]).toMatchObject({ kind: "undo", done: { ok: true } });
  });

  it("background tasks: a chip after their call, updated in place", () => {
    let s = run([user("u1"), toolIn("t1", "Task", { description: "Refactor" }), { type: "text", block: "b1", delta: "Handing it to Opus." },
      { type: "task", task_id: "k1", status: "running", coder: true, description: "refactor", tool_use_id: "t1" }]);
    expect(answers(s)[0].parts.map((p) => p.kind)).toEqual(["tools", "task", "text"]);
    s = run([{ type: "task", task_id: "k1", status: "completed", coder: true, description: "refactor", tool_use_id: "t1" }], s);
    const chip = answers(s)[0].parts[1] as { kind: "task"; task: { status: string } };
    expect(chip.task.status).toBe("completed");
    expect(taskText({ task_id: "k1", status: "running", coder: true, description: "refactor" })).toBe("Opus working: refactor");
  });

  it("history replays from scratch, with nothing left pulsing, and shows still-running tasks", () => {
    const before = run([user("old"), { type: "text", block: "x", delta: "old" }]);
    const opened = reduce(before, {
      type: "opened", label: "a/web", branch: null, rel: "web", session_id: null, live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {},
      tasks: [{ task_id: "k9", status: "running", coder: true, description: "tests" }, { task_id: "k8", status: "completed", coder: false }],
    });
    const s = reduce(opened, { type: "history", events: [user("u1") as never, toolIn("t1", "Read", {}) as never,
      { type: "task", task_id: "old", status: "completed" } as never, { type: "text", block: "b1", delta: "hi" } as never] });
    expect(s.items.map((x) => x.kind)).toEqual(["user", "answer"]);
    const [a] = answers(s);
    expect(a.done).toBe(true);
    expect(a.parts.map((p) => p.kind)).toEqual(["tools", "text", "task"]);
    expect(a.parts[0]).toMatchObject({ running: false });
    expect(s.replaying).toBe(false);
  });

  it("notices and errors are lines of their own; held speech shows in the answer", () => {
    const s = run([{ type: "notice", text: "Switched to Opus", level: "ok" }, { type: "error", text: "Boom" }, user("u1"), { type: "held", text: "and also" }]);
    expect(s.items.slice(0, 2)).toMatchObject([{ kind: "notice", level: "ok" }, { kind: "notice", level: "error", text: "Boom" }]);
    expect(answers(s)[0].parts).toEqual([{ kind: "held", text: "and also" }]);
  });

  it("other events leave the state alone", () => {
    const s = initialChat();
    expect(reduce(s, { type: "partial", text: "x" })).toBe(s);
  });
});

describe("tool phrases", () => {
  it("reads like a sentence", () => {
    expect(phrase("Bash", { description: "Run the tests" })).toBe("run the tests");
    expect(phrase("Grep", { pattern: "TODO" })).toBe("searched for “TODO”");
    expect(phrase("WebFetch", { url: "https://docs.example.com/x" })).toBe("fetched docs.example.com");
    expect(phrase("mcp__vikunja__tasks_list", {})).toBe("used tasks list");
    expect(toolsLabel([1, 2, 3, 4].map((i) => ({ id: `${i}`, name: "Read", input: { file_path: `/f${i}` }, summary: "", pending: false, error: false, out: null }))))
      .toBe("Read f1, read f2 and 2 more");
  });
});
