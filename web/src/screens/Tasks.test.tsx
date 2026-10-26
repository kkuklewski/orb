// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ItemListEvent, ItemRow } from "../protocol.gen";
import { useItems } from "../stores/items";
import { useViews } from "../stores/views";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { Tasks, taskGroups, taskState, taskTime } = await import("./Tasks");

const NOW = new Date("2026-10-25T12:00:00");
const row = (id: string, due: string, priority = 0, project = "acme"): ItemRow =>
  ({ id, title: `Task ${id}`, repo: id === "1" ? "acme-web" : null, hot: false, status: "", cells: { project, due, priority: String(priority) } });
const list = (over: Partial<ItemListEvent> = {}): ItemListEvent => ({ type: "item_list", source: "vikunja", kicker: "VIKUNJA", heading: "4 open tasks",
  columns: [], rows: [row("1", "2026-10-20"), row("2", "2026-10-28"), row("3", "", 4), row("4", ""), row("5", "2026-12-01")], can_suggest: true, ...over });

beforeEach(() => { sent.length = 0; useItems.setState({ source: null, id: null, item: null, lists: {} }); useViews.setState({ view: "tasks" }); });
afterEach(cleanup);

describe("Tasks page helpers", () => {
  it("names each task's state and groups them like Routines, soonest first", () => {
    expect(taskState(row("a", "2026-10-24"), NOW)).toBe("overdue");
    expect(taskState(row("a", "2026-10-25"), NOW)).toBe("due today");
    expect(taskState(row("a", "", 5), NOW)).toBe("urgent");
    expect(taskState(row("a", "2026-11-01"), NOW)).toBe("this week");
    expect(taskState(row("a", "2026-11-02"), NOW)).toBe("planned");
    expect(taskState(row("a", ""), NOW)).toBe("open");
    const g = taskGroups(list().rows, NOW);
    expect(g.map((x) => [x.name, x.items.map((r) => r.id)])).toEqual([["Needs you", ["1", "3"]], ["This week", ["2"]], ["Later", ["5"]], ["No date", ["4"]]]);
  });

  it("says how late, today, or the date", () => {
    expect(taskTime(row("a", "2026-10-22"), NOW)).toBe("3 d late");
    expect(taskTime(row("a", "2026-10-25"), NOW)).toBe("today");
    expect(taskTime(row("a", ""), NOW)).toBe("");
  });
});

describe("Tasks page", () => {
  it("asks for the list, then shows the lines; a line opens the task, Table opens the table", () => {
    render(<Tasks />);
    expect(sent).toContainEqual({ type: "item_list", source: "vikunja" });
    act(() => useItems.setState({ lists: { vikunja: list() } }));
    expect(screen.getByText("5 open · from Vikunja")).toBeTruthy();
    expect(screen.getByText("acme · acme-web")).toBeTruthy();
    expect(screen.queryByText("Task 4")).toBeNull(); // no date: folded
    fireEvent.click(screen.getByText("1 without a date"));
    expect(screen.getByText("Task 4")).toBeTruthy();
    fireEvent.click(screen.getByText("Task 1"));
    expect(sent).toContainEqual({ type: "item_get", source: "vikunja", id: "1" });
    fireEvent.click(screen.getByText("Table"));
    expect(useViews.getState().view).toBe("items");
  });

  it("without Vikunja set up, says what's missing and opens its settings", () => {
    useItems.setState({ lists: { vikunja: list({ rows: [], error: "Vikunja not reachable: isn't set up (vikunja_url and ORB_VIKUNJA_TOKEN)." }) } });
    render(<Tasks />);
    expect(screen.getByText("not connected")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("ORB_VIKUNJA_TOKEN");
    expect(screen.queryByText("Table")).toBeNull();
    fireEvent.click(screen.getByText("Vikunja settings"));
    expect(useViews.getState()).toMatchObject({ view: "settings", settingsAt: "vikunja" });
  });
});
