// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ItemListEvent } from "../protocol.gen";
import { useItems } from "../stores/items";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { ItemList } = await import("./ItemList");

const row = (id: string, topic: string, verdict = "") => ({ id, title: `Note ${id}`, repo: null, cells: { topic, published: "2026-06-14", verdict } });
const list = (over: Partial<ItemListEvent> = {}): ItemListEvent => ({ type: "item_list", source: "notes", kicker: "NOTES", heading: "3 notes wait for your verdict", can_judge: true, group_key: "topic",
  columns: [{ key: "title", label: "Note", kind: "title" }, { key: "topic", label: "Topic", kind: "chip" }, { key: "published", label: "Published" }, { key: "verdict", label: "Verdict" }],
  rows: [row("a.md", "security"), row("b.md", "security"), row("c.md", "career")], ...over });

beforeEach(() => { sent.length = 0; useItems.setState({ source: "notes", id: null, item: null, lists: { notes: list() } }); });
afterEach(cleanup);

describe("Notes list: bulk verdict", () => {
  it("selects a group, asks for confirmation with the count, then sends the files", () => {
    render(<ItemList />);
    expect(screen.queryByRole("group", { name: "Verdict for the selected notes" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Select group security"));
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(sent).toEqual([]); // nothing is written before the confirmation
    expect(screen.getByText(/Reject: 2 notes\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([{ type: "notes_verdict", notes: [{ file: "a.md", seen: "" }, { file: "b.md", seen: "" }], verdict: "reject" }]);
    expect(screen.queryByText("2 selected")).toBeNull();
  });

  it("Cancel sends nothing, and a selection drops rows that left the list", () => {
    render(<ItemList />);
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.click(screen.getByRole("button", { name: "Restore to pending" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sent).toEqual([]);
    expect(screen.getByText("3 selected")).toBeTruthy();
    act(() => useItems.setState({ lists: { notes: list({ rows: [row("c.md", "career")] }) } }));
    expect(screen.getByText("1 selected")).toBeTruthy();
  });

  it("sends each note's verdict as shown, so a note judged since is refused; there is no Defer", () => {
    useItems.setState({ lists: { notes: list({ rows: [row("a.md", "security", "reject 2026-10-24"), row("b.md", "security")] }) } });
    render(<ItemList />);
    expect(screen.queryByRole("button", { name: "Defer" })).toBeNull();
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.click(screen.getByRole("button", { name: "Restore to pending" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([{ type: "notes_verdict", notes: [{ file: "a.md", seen: "reject 2026-10-24" }, { file: "b.md", seen: "" }], verdict: "restore" }]);
  });

  it("other lists have no checkboxes", () => {
    useItems.setState({ lists: { notes: list({ can_judge: false }) } });
    render(<ItemList />);
    expect(screen.queryByLabelText("Select all shown")).toBeNull();
  });
});

const task = (id: string, status: string, suggested = "") => ({ id, title: `Task ${id}`, repo: null, status, cells: { project: "acme", priority: status === "ranked" ? "3" : "0", suggested, suggested_why: suggested ? "client waits" : "" } });
const tasks = (over: Partial<ItemListEvent> = {}): ItemListEvent => ({ type: "item_list", source: "vikunja", kicker: "VIKUNJA", heading: "3 open tasks", can_archive: true, can_suggest: true, group_key: "project",
  statuses: ["unranked", "ranked"],
  columns: [{ key: "title", label: "Task", kind: "title" }, { key: "project", label: "Project", kind: "chip" }, { key: "priority", label: "Priority", kind: "priority" }, { key: "suggested", label: "Suggested", kind: "priority" }],
  rows: [task("1", "unranked", "4"), task("2", "unranked", "2"), task("3", "ranked")], ...over });

describe("Tasks list shares the Notes behaviours", () => {
  beforeEach(() => useItems.setState({ source: "vikunja", lists: { vikunja: tasks() } }));

  it("when Vikunja can't be read, the reason stands where the rows would, with no tools", () => {
    act(() => useItems.setState({ lists: { vikunja: tasks({ heading: "Tasks", rows: [], url: null, can_suggest: false, error: "Vikunja not reachable: didn't answer: timed out" }) } }));
    render(<ItemList />);
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Vikunja not reachable: didn't answer: timed out");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByLabelText("Filter items")).toBeNull();
  });

  it("a Created column sorts the tasks by date, oldest first then newest, undated last", () => {
    const dated = (id: string, created: string) => ({ ...task(id, "unranked"), cells: { ...task(id, "unranked").cells, created } });
    act(() => useItems.setState({ lists: { vikunja: tasks({
      columns: [...tasks().columns, { key: "created", label: "Created" }],
      rows: [dated("1", "2026-10-02"), dated("2", ""), dated("3", "2026-09-14")] }) } }));
    render(<ItemList />);
    const order = () => screen.getAllByText(/^Task \d$/).map((e) => e.textContent);
    const head = () => screen.getByRole("columnheader", { name: /Created/ });
    fireEvent.click(screen.getByRole("button", { name: "Created" }));
    expect(head().getAttribute("aria-sort")).toBe("ascending");
    expect(order()).toEqual(["Task 3", "Task 1", "Task 2"]);
    fireEvent.click(screen.getByRole("button", { name: /Created/ }));
    expect(head().getAttribute("aria-sort")).toBe("descending");
    expect(order()).toEqual(["Task 1", "Task 3", "Task 2"]);
  });

  it("archives the ticked tasks after a confirmation", () => {
    render(<ItemList />);
    fireEvent.click(screen.getByLabelText("Select group acme"));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(sent).toEqual([]);
    expect(screen.getByText(/Archive: 3 tasks\?/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([{ type: "tasks_bulk", ids: ["1", "2", "3"], done: true }]);
  });

  it("sets a priority, and applies the suggested ones per priority", () => {
    render(<ItemList />);
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.change(screen.getByLabelText("Set priority"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([{ type: "tasks_bulk", ids: ["1", "2", "3"], priority: 5 }]);
    sent.length = 0;
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.click(screen.getByRole("button", { name: "Apply suggested (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(sent).toEqual([{ type: "tasks_bulk", ids: ["1"], priority: 4 }, { type: "tasks_bulk", ids: ["2"], priority: 2 }]);
  });

  it("filters by status, and asks for suggestions", () => {
    render(<ItemList />);
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ranked" } });
    expect(screen.queryByText("Task 1")).toBeNull();
    expect(screen.getByText("Task 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Suggest priorities" }));
    expect(sent).toEqual([{ type: "tasks_suggest" }]);
    act(() => useItems.setState({ lists: { vikunja: tasks({ busy: true }) } }));
    expect((screen.getByRole("button", { name: "Suggesting…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Notes start on their pending rows; All shows the judged ones too", () => {
    const n = list({ statuses: ["pending", "judged"], status_default: "pending", rows: [{ ...row("a.md", "x"), status: "pending" }, { ...row("b.md", "x", "reject 2026-10-01"), status: "judged" }] });
    useItems.setState({ source: "notes", lists: { notes: n } });
    render(<ItemList />);
    expect(screen.queryByText("Note b.md")).toBeNull();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "" } });
    expect(screen.getByText("Note b.md")).toBeTruthy();
  });
});
