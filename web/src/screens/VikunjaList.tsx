import { useState } from "react";
import type { VikunjaRow } from "../protocol.gen";
import { useViews } from "../stores/views";
import { archiveVikunjaTask, openVikunjaTask, useVikunja } from "../stores/vikunja";
import { Ext } from "./HomeWatch";

// Every open Vikunja task as a table: task, repo (the one "Start in Orb" would use), project, due, priority.
// Click a header to sort, type to filter; a row opens the task.

type Key = "title" | "repo" | "project" | "due" | "priority";
const COLS: { key: Key; label: string }[] = [
  { key: "title", label: "Task" }, { key: "repo", label: "Repo" }, { key: "project", label: "Project" },
  { key: "due", label: "Due" }, { key: "priority", label: "Priority" },
];
const PRIORITY = ["", "low", "medium", "high", "urgent", "DO NOW"];

/** Empty values (no repo, no due date) sort last in either direction. */
export function sortRows(rows: VikunjaRow[], key: Key, dir: 1 | -1): VikunjaRow[] {
  const val = (r: VikunjaRow): string | number | null => (key === "priority" ? r.priority : r[key] ?? null);
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === null || x === "") return y === null || y === "" ? 0 : 1;
    if (y === null || y === "") return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/** Rows grouped by repo: the biggest group first, tasks with no repo last. */
export function groupRows(rows: VikunjaRow[]): { repo: string | null; rows: VikunjaRow[] }[] {
  const by = new Map<string | null, VikunjaRow[]>();
  for (const r of rows) by.set(r.repo ?? null, [...(by.get(r.repo ?? null) ?? []), r]);
  return [...by].map(([repo, rs]) => ({ repo, rows: rs }))
    .sort((a, b) => (a.repo === null ? 1 : b.repo === null ? -1 : b.rows.length - a.rows.length || a.repo.localeCompare(b.repo)));
}

export function VikunjaList() {
  const list = useVikunja((s) => s.list);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 } | null>(null);
  const [q, setQ] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [last, setLast] = useState<{ id: number; title: string } | null>(null); // for Undo
  const needle = q.trim().toLowerCase();
  const rows = (list?.tasks ?? []).filter((r) => !needle || `${r.title} ${r.repo ?? ""} ${r.project}`.toLowerCase().includes(needle));
  const shown = sort ? sortRows(rows, sort.key, sort.dir) : rows;
  const groups = grouped ? groupRows(shown) : [{ repo: null as string | null, rows: shown, flat: true }];
  const archive = (r: VikunjaRow) => { setLast({ id: r.id, title: r.title }); archiveVikunjaTask(r.id); };
  const head = (c: { key: Key; label: string }) => {
    const on = sort?.key === c.key;
    return (
      <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => setSort({ key: c.key, dir: on && sort!.dir === 1 ? -1 : 1 })}>{c.label}{on ? (sort!.dir === 1 ? " ↑" : " ↓") : ""}</button>
      </th>
    );
  };
  return (
    <section className="task" aria-label="Vikunja tasks">
      <div className="home-col">
        <nav className="task-nav mono" aria-label="Navigation">
          <button type="button" className="linkish" onClick={() => useViews.setState({ view: "home" })}>← HOME</button>
          {list && <Ext href={list.url} className="">OPEN VIKUNJA →</Ext>}
        </nav>
        <header className="task-head">
          <div className="mono home-kicker">// VIKUNJA</div>
          <h1>{list ? `${list.total} open tasks` : "…"}</h1>
        </header>
        <div className="vk-tools">
          <input className="vk-filter" type="search" placeholder="Filter by task, repo or project" aria-label="Filter tasks" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="vk-group mono"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by repo</label>
        </div>
        {last && (
          <div className="vk-undo mono" role="status">
            <span>Archived: {last.title.length > 60 ? last.title.slice(0, 59) + "…" : last.title}</span>
            <button type="button" onClick={() => { archiveVikunjaTask(last.id, false); setLast(null); }}>Undo</button>
            <button type="button" aria-label="Dismiss" onClick={() => setLast(null)}>×</button>
          </div>
        )}
        <div className="vk-table-wrap">
          <table className="vk-table">
            <thead><tr>{COLS.map(head)}<th scope="col"><span className="sr-only">Archive</span></th></tr></thead>
            {groups.map((g) => (
              <tbody key={g.repo ?? "none"}>
                {grouped && <tr className="vk-grp"><th scope="colgroup" colSpan={COLS.length + 1}>{g.repo ?? "No repo"} <span>{g.rows.length}</span></th></tr>}
                {g.rows.map((r) => (
                  <tr key={r.id} className={r.priority >= 4 ? "needs" : ""}>
                    <td><button type="button" className="hc-text" onClick={() => openVikunjaTask(r.id)}>{r.title}</button></td>
                    <td className="mono">{r.repo ?? <span className="vk-none">–</span>}</td>
                    <td className="mono">{r.project}</td>
                    <td className="mono">{r.due ?? ""}</td>
                    <td className="mono">{PRIORITY[r.priority] ?? ""}</td>
                    <td><button type="button" className="vk-arch mono" title="Marks the task done in Vikunja (Undo, or reopen it there)" aria-label={`Archive: ${r.title}`} onClick={() => archive(r)}>Archive</button></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {list && !shown.length && <p className="hc-empty">No tasks match.</p>}
        </div>
      </div>
    </section>
  );
}
