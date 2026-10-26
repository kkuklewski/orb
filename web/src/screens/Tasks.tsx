import { useEffect, useState } from "react";
import type { ItemRow } from "../protocol.gen";
import { useTracker } from "../stores/features";
import { openItem, openItems, useItems } from "../stores/items";
import { openSettings } from "../stores/views";
import { send } from "../ws";

// Tasks (Vikunja or Jira, ADR 0010) laid out like Routines: one line per task (dot, title, state word, when), grouped by what it asks of
// you, the project and repo on the line under it. A line opens the task; Table opens the sortable table with the bulk
// actions. No tracker set up: the page says what's missing and where to set it. Task text is shown as plain text.

export type TaskState = "overdue" | "due today" | "urgent" | "this week" | "planned" | "open";
export const TASK_GROUPS: { name: string; states: TaskState[]; fold: boolean }[] = [
  { name: "Needs you", states: ["overdue", "due today", "urgent"], fold: false },
  { name: "This week", states: ["this week"], fold: false },
  { name: "Later", states: ["planned"], fold: false },
  { name: "No date", states: ["open"], fold: true },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dueOf = (r: ItemRow) => (r.cells.due ?? "").slice(0, 10);

export function taskState(r: ItemRow, now = new Date()): TaskState {
  const due = dueOf(r), today = iso(now), week = iso(new Date(now.getTime() + 7 * 86400000));
  if (due && due < today) return "overdue";
  if (due === today) return "due today";
  if (Number(r.cells.priority) >= 4) return "urgent";
  if (due && due <= week) return "this week";
  return due ? "planned" : "open";
}

/** The groups in order, without empty ones: soonest due first, then the highest priority, then by title. */
export function taskGroups(rows: ItemRow[], now = new Date()) {
  const order = (a: ItemRow, b: ItemRow) => (dueOf(a) || "9999").localeCompare(dueOf(b) || "9999")
    || Number(b.cells.priority || 0) - Number(a.cells.priority || 0) || a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  return TASK_GROUPS.map((g) => ({ ...g, items: rows.filter((r) => g.states.includes(taskState(r, now))).sort(order) })).filter((g) => g.items.length);
}

/** The line's time: "today", "yest", "Mon 27 Oct"; "3 d late" for an overdue one; nothing without a date. */
export function taskTime(r: ItemRow, now = new Date()): string {
  const due = dueOf(r);
  if (!due) return "";
  const days = Math.round((new Date(`${iso(now)}T00:00`).getTime() - new Date(`${due}T00:00`).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yest";
  if (days > 1) return `${days} d late`;
  return new Date(`${due}T00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

const dot = (s: TaskState) => (s === "overdue" || s === "due today" || s === "urgent" ? "dot approval" : s === "this week" ? "dot done" : "dot has");

export function Tasks() {
  const list = useItems((s) => s.lists.vikunja);
  const tracker = useTracker();
  const [showOpen, setShowOpen] = useState(false);
  useEffect(() => { send({ type: "item_list", source: "vikunja" }); }, []);
  const groups = taskGroups(list?.rows ?? []);
  const sub = !list ? "loading…" : list.error ? "not connected" : `${list.rows.length} open · from ${tracker}`;

  return (
    <div className="view-col">
      <div className="view-head">
        <h2>Tasks</h2>
        <span className="mono view-sub">{sub}</span>
        {list?.can_suggest && !list.error && (
          <button type="button" className="chip-btn" disabled={list.busy} onClick={() => send({ type: "tasks_suggest" })}>{list.busy ? "Suggesting…" : "Suggest priorities"}</button>
        )}
        {!!list && !list.error && <button type="button" className="chip-btn" onClick={() => openItems("vikunja")}>Table</button>}
        <button type="button" className="chip-btn" onClick={() => send({ type: "item_list", source: "vikunja" })}>Check now</button>
      </div>
      <div id="tasks-list">
        {list?.error ? (
          <div className="tk-setup" role="status">
            <p>{list.error}</p>
            <p className="side-hint">Set the Vikunja or Jira address in Settings and its token in Orb's environment (ORB_VIKUNJA_TOKEN, or ORB_JIRA_EMAIL and ORB_JIRA_TOKEN), then restart Orb. Your open tasks show up here, grouped like Routines.</p>
            <button type="button" className="chip-btn" onClick={() => openSettings("vikunja")}>Task settings</button>
          </div>
        ) : list && !list.rows.length ? <div className="side-hint">No open tasks.</div> : null}
        {groups.map((g) => (
          <section key={g.name} className="rt-group" aria-label={g.name}>
            {g.fold ? (
              <button type="button" className="rt-off mono" aria-expanded={showOpen} onClick={() => setShowOpen(!showOpen)}>{g.items.length} without a date</button>
            ) : (
              <h3 className="chats-repo">{g.name}<span className="mono">{g.items.length}</span></h3>
            )}
            {(!g.fold || showOpen) && g.items.map((r) => {
              const state = taskState(r);
              const tail = [r.cells.project, r.repo].filter(Boolean).join(" · ");
              return (
                <button type="button" key={r.id} className="rt-line" data-state={state} onClick={() => openItem("vikunja", r.id)}>
                  <span className={dot(state)} />
                  <span className="rt-name">{r.title}</span>
                  <span className="rt-state mono">{state}</span>
                  <span className="rt-time mono">{taskTime(r)}</span>
                  {tail && <span className="rt-tail mono">{tail}</span>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
