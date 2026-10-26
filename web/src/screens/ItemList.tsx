import { useEffect, useState, type CSSProperties } from "react";
import type { ItemColumn, ItemRow } from "../protocol.gen";
import { useViews } from "../stores/views";
import { archiveItem, openItem, useItems } from "../stores/items";
import { send } from "../ws";
import { Ext } from "./HomeForget";

// A source's items as a table: the columns come from the server (title, repo = the one "Start in Orb" would
// use, then the source's own). Click a header to sort, type to filter, group by a column; a row opens the item.

const PRIORITY = ["", "low", "medium", "high", "urgent", "DO NOW"];
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const overdue = (d: string) => !!d && d < new Date().toISOString().slice(0, 10);
const VERDICTS = [["approve", "Approve"], ["reject", "Reject"], ["restore", "Restore to pending"]] as const;
type Act = { label: string; note: string; run: () => void }; // a bulk action waiting for its confirmation
const numeric = (k: ItemColumn["kind"]) => k === "priority" || k === "num" || k === "age";

export const cellOf = (r: ItemRow, key: string): string => (key === "title" ? r.title : key === "repo" ? r.repo ?? "" : r.cells[key] ?? "");

/** Empty values (no repo, no due date) sort last in either direction. */
export function sortRows(rows: ItemRow[], col: ItemColumn, dir: 1 | -1): ItemRow[] {
  const val = (r: ItemRow): string | number | null => {
    const v = cellOf(r, col.key);
    return v === "" ? null : numeric(col.kind) ? Number(v) : v;
  };
  return [...rows].sort((a, b) => {
    const x = val(a), y = val(b);
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

/** Rows grouped by a column: the biggest group first, rows with no value last. */
export function groupRows(rows: ItemRow[], key: string): { group: string | null; rows: ItemRow[] }[] {
  const by = new Map<string | null, ItemRow[]>();
  for (const r of rows) { const g = cellOf(r, key) || null; by.set(g, [...(by.get(g) ?? []), r]); }
  return [...by].map(([group, rs]) => ({ group, rows: rs }))
    .sort((a, b) => (a.group === null ? 1 : b.group === null ? -1 : b.rows.length - a.rows.length || a.group.localeCompare(b.group)));
}

export function ItemList() {
  const source = useItems((s) => s.source);
  const list = useItems((s) => (s.source ? s.lists[s.source] : undefined));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [q, setQ] = useState("");
  const [grouped, setGrouped] = useState(true);
  const [last, setLast] = useState<{ id: string; title: string } | null>(null); // for Undo
  const [picked, setPicked] = useState<Set<string>>(new Set()); // Notes list: rows chosen for a bulk verdict
  const [ask, setAsk] = useState<Act | null>(null);
  const [status, setStatus] = useState<string | null>(null); // null = the list's own default
  const listRows = list?.rows;
  useEffect(() => { setPicked((p) => { const keep = new Set([...p].filter((id) => listRows?.some((r) => r.id === id))); return keep.size === p.size ? p : keep; }); }, [listRows]);
  useEffect(() => { setStatus(null); setPicked(new Set()); setAsk(null); }, [source]);
  if (!source) return null;
  const cols = list?.columns ?? [];
  const groupCol = cols.find((c) => c.key === list?.group_key);
  const needle = q.trim().toLowerCase();
  const statusNow = status ?? list?.status_default ?? "";
  const rows = (list?.rows ?? []).filter((r) => (!statusNow || r.status === statusNow) && (!needle || `${r.title} ${r.repo ?? ""} ${Object.values(r.cells).join(" ")}`.toLowerCase().includes(needle)));
  const sortCol = cols.find((c) => c.key === sort?.key);
  const shown = sort && sortCol ? sortRows(rows, sortCol, sort.dir) : rows;
  const useGroups = grouped && !!groupCol;
  const groups = useGroups ? groupRows(shown, groupCol!.key) : [{ group: null as string | null, rows: shown }];
  const judge = !!list?.can_judge;
  const toggle = (rs: ItemRow[], on: boolean) => setPicked((p) => { const n = new Set(p); rs.forEach((r) => (on ? n.add(r.id) : n.delete(r.id))); return n; });
  const pick = judge || !!list?.can_archive; // rows can be ticked for a bulk action
  const noun = judge ? "note" : "task";
  const run = (a: Act) => { a.run(); setPicked(new Set()); setAsk(null); };
  const ids = [...picked];
  // each note with its verdict as shown: the server writes only if that still holds
  const seenNotes = () => ids.map((id) => ({ file: id, seen: (list?.rows ?? []).find((r) => r.id === id)?.cells.verdict ?? "" }));
  const suggested = (list?.rows ?? []).filter((r) => picked.has(r.id) && Number(r.cells.suggested) > 0);
  const actions: Act[] = judge
    ? VERDICTS.map(([v, label]) => ({ label, note: "Writes human_verdict into their frontmatter; nothing is committed.", run: () => send({ type: "notes_verdict", notes: seenNotes(), verdict: v }) }))
    : [{ label: "Archive", note: "Marks them done in Vikunja.", run: () => send({ type: "tasks_bulk", ids, done: true }) }];
  const setPriority = (p: number): Act => ({ label: `Priority ${PRIORITY[p]}`, note: "Changes the priority in Vikunja.", run: () => send({ type: "tasks_bulk", ids, priority: p }) });
  const applySuggested: Act = {
    label: "Apply suggested priority", note: "Sets each task to the priority suggested for it in Vikunja.",
    run: () => { for (const p of new Set(suggested.map((r) => Number(r.cells.suggested)))) send({ type: "tasks_bulk", ids: suggested.filter((r) => Number(r.cells.suggested) === p).map((r) => r.id), priority: p }); },
  };
  const archive = (r: ItemRow) => { setLast({ id: r.id, title: r.title }); archiveItem(source, r.id); };
  const head = (c: ItemColumn) => {
    const on = sort?.key === c.key;
    return (
      <th key={c.key} scope="col" aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => setSort({ key: c.key, dir: on && sort!.dir === 1 ? -1 : 1 })}>{c.label}{on ? (sort!.dir === 1 ? " ↑" : " ↓") : ""}</button>
      </th>
    );
  };
  const cell = (c: ItemColumn, r: ItemRow) => {
    const v = cellOf(r, c.key);
    switch (c.kind) {
      case "title": return <td key={c.key}><button type="button" className="hc-text" onClick={() => openItem(source, r.id)}>{r.title}</button></td>;
      case "repo": return <td key={c.key} className="mono">{v ? <span className="vk-repo">{v}</span> : <span className="vk-none">–</span>}</td>;
      case "chip": return <td key={c.key} className="mono">{v && <span className="vk-chip" style={{ "--h": hue(v) } as CSSProperties}>{v}</span>}</td>;
      case "due": return <td key={c.key} className={`mono${overdue(v) ? " vk-late" : ""}`}>{v}</td>;
      case "priority": return <td key={c.key} className="mono" title={r.cells[`${c.key}_why`] || undefined}>{PRIORITY[Number(v)] ? <span className={`vk-pri p${v}`}>{PRIORITY[Number(v)]}</span> : ""}</td>;
      case "age": return <td key={c.key} className="mono">{v && `${v}d`}</td>;
      case "num": return <td key={c.key} className="mono vk-num">{v}</td>;
      default: return <td key={c.key} className="mono">{v}</td>;
    }
  };
  const span = cols.length + 2 + (list?.can_archive ? 0 : -1) + (pick ? 1 : 0);
  return (
    <section className="task" aria-label="Items">
      <div className="home-col">
        <nav className="task-nav mono" aria-label="Navigation">
          <button type="button" className="linkish" onClick={() => useViews.setState({ view: "home" })}>← HOME</button>
          {list?.url && <Ext href={list.url} className="">{list.url_label}</Ext>}
        </nav>
        <header className="task-head">
          <div className="mono home-kicker">// {list?.kicker ?? ""}</div>
          <h1>{list ? list.heading : "…"}</h1>
        </header>
        {list?.error ? <p className="vk-error" role="alert">{list.error}</p> : (<>
        <div className="vk-tools">
          <input className="vk-filter" type="search" placeholder="Filter" aria-label="Filter items" value={q} onChange={(e) => setQ(e.target.value)} />
          {!!list?.statuses?.length && (
            <select className="vk-filter" aria-label="Status" value={statusNow} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {list.statuses!.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          )}
          {list?.can_suggest && <button type="button" className="vk-arch mono" disabled={list.busy} onClick={() => send({ type: "tasks_suggest" })}>{list.busy ? "Suggesting…" : "Suggest priorities"}</button>}
          {groupCol && <label className="vk-group mono"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by {groupCol.key === "repo" ? "repo" : groupCol.label.toLowerCase()}</label>}
        </div>
        {pick && picked.size > 0 && (
          <div className="vk-undo mono" role="group" aria-label={`Actions for the selected ${noun}s`}>
            {ask ? (
              <>
                <span>{ask.label}: {picked.size} {noun}{picked.size === 1 ? "" : "s"}? {ask.note}</span>
                <button type="button" onClick={() => run(ask)}>Confirm</button>
                <button type="button" onClick={() => setAsk(null)}>Cancel</button>
              </>
            ) : (
              <>
                <span>{picked.size} selected</span>
                {actions.map((a) => <button key={a.label} type="button" onClick={() => setAsk(a)}>{a.label}</button>)}
                {!judge && (
                  <select aria-label="Set priority" value="" onChange={(e) => e.target.value !== "" && setAsk(setPriority(Number(e.target.value)))}>
                    <option value="">Set priority…</option>
                    {PRIORITY.map((name, p) => <option key={p} value={p}>{name || "none"}</option>)}
                  </select>
                )}
                {!judge && suggested.length > 0 && <button type="button" onClick={() => setAsk(applySuggested)}>Apply suggested ({suggested.length})</button>}
                <button type="button" aria-label="Clear selection" onClick={() => setPicked(new Set())}>×</button>
              </>
            )}
          </div>
        )}
        {last && (
          <div className="vk-undo mono" role="status">
            <span>Archived: {last.title.length > 60 ? last.title.slice(0, 59) + "…" : last.title}</span>
            <button type="button" onClick={() => { archiveItem(source, last.id, false); setLast(null); }}>Undo</button>
            <button type="button" aria-label="Dismiss" onClick={() => setLast(null)}>×</button>
          </div>
        )}
        <div className="vk-table-wrap">
          <table className="vk-table">
            <thead><tr>{pick && <th scope="col"><input type="checkbox" aria-label="Select all shown" checked={shown.length > 0 && shown.every((r) => picked.has(r.id))} onChange={(e) => toggle(shown, e.target.checked)} /></th>}<th scope="col" className="vk-n">Lp.</th>{cols.map(head)}{list?.can_archive && <th scope="col"><span className="sr-only">Archive</span></th>}</tr></thead>
            {groups.map((g, gi) => (
              <tbody key={g.group ?? "none"}>
                {useGroups && <tr className="vk-grp"><th scope="colgroup" colSpan={span}>{pick && <><input type="checkbox" aria-label={`Select group ${g.group ?? "None"}`} checked={g.rows.every((r) => picked.has(r.id))} onChange={(e) => toggle(g.rows, e.target.checked)} /></>}{g.group ?? (groupCol!.key === "repo" ? "No repo" : "None")} <span>{g.rows.length}</span></th></tr>}
                {g.rows.map((r, i) => (
                  <tr key={r.id} className={r.hot ? "needs" : ""}>
                    {pick && <td><input type="checkbox" aria-label={`Select: ${r.title}`} checked={picked.has(r.id)} onChange={(e) => toggle([r], e.target.checked)} /></td>}
                    <td className="mono vk-n">{groups.slice(0, gi).reduce((n, x) => n + x.rows.length, 0) + i + 1}</td>
                    {cols.map((c) => cell(c, r))}
                    {list?.can_archive && <td><button type="button" className="vk-arch mono" title="Marks the task done in Vikunja (Undo, or reopen it there)" aria-label={`Archive: ${r.title}`} onClick={() => archive(r)}>Archive</button></td>}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {list && !shown.length && <p className="hc-empty">{list.rows.length ? "Nothing matches." : "Nothing here."}</p>}
        </div>
        </>)}
      </div>
    </section>
  );
}
