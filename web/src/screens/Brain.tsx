import { Markdown } from "./chat/Markdown";
import { useEffect } from "react";
import type { BrainNote } from "../protocol.gen";
import { KINDS, LANES, SUGGESTED, accept, applyPicked, brainRows, headerLine, openNote, pickAll, restore, scoreDot, setFilter, setVerdict, suggestable,
  suggestionGroups, toggleIn, togglePick, useBrain, verdictText } from "../stores/brain";
import { openSettings, relTime } from "../stores/views";
import { send } from "../ws";

// Brain: the vault's newest notes, one line each ("title · kind · when") with the value-score dot; the panel holds the
// filters and search. Notes with a suggestion come first, grouped by it (ADR 0006): each row is the title, score, lane,
// why and the suggested word, which accepts it; select several and Apply suggestions. A note's page shows the header
// line (score, lane, why), the Verdict and the note's text. Note text is shown as plain text, never as HTML.

function NoteLine({ n, current }: { n: BrainNote; current?: boolean }) {
  const state = n.verdict ? verdictText(n.verdict).split(" ")[0] : n.waiting ? "waiting" : n.kind;
  return (
    <button type="button" className={"rt-line" + (current ? " current" : "")} aria-current={current ? "page" : undefined} data-state={state} onClick={() => openNote(n.file)}
      title={n.score != null ? `value score ${n.score}` : "not scored"}>
      <span className={scoreDot(n.score)} />
      <span className="rt-name">{n.title}</span>
      <span className="rt-state mono">{n.kind}</span>
      <span className="rt-time mono">{relTime(n.mtime)}</span>
      {(n.verdict || n.why) && <span className="rt-tail mono">{[n.verdict ? verdictText(n.verdict) : null, n.why || null].filter(Boolean).join(" · ")}</span>}
    </button>
  );
}

/** A note with a suggestion: select it, open it, accept the suggested word; once applied, its verdict and Restore. */
function SuggestLine({ n }: { n: BrainNote }) {
  const picked = useBrain((s) => s.picked.includes(n.file));
  const refused = useBrain((s) => s.refused[n.file]);
  const can = suggestable(n);
  return (
    <div className="rt-line sg-line" data-state={n.verdict ? verdictText(n.verdict).split(" ")[0] : "waiting"}>
      <input type="checkbox" aria-label={`Select ${n.title}`} checked={picked} disabled={!can} onChange={() => togglePick(n.file)} />
      <button type="button" className="rt-name sg-open" onClick={() => openNote(n.file)}>{n.title}</button>
      <span className="rt-state mono">{n.verdict ? verdictText(n.verdict) : ""}</span>
      {can ? <button type="button" className="chip-btn sg-act" aria-label={`${n.suggest} ${n.title}`} onClick={() => accept(n)}>{n.suggest}</button>
        : n.verdict ? <button type="button" className="chip-btn sg-act" aria-label={`Restore ${n.title}`} onClick={() => restore(n)}>Restore</button> : <span />}
      {headerLine(n) && <span className="rt-tail mono">{headerLine(n)}</span>}
      {refused && <span className="sg-refused" role="alert">{refused}</span>}
    </div>
  );
}

export function Brain() {
  const { list, filter, snap, applied, picked } = useBrain();
  useEffect(() => { send({ type: "brain_list" }); }, []);
  const all = brainRows(list?.notes ?? [], filter, snap);
  const groups = suggestionGroups(all, applied);
  const grouped = new Set(SUGGESTED.flatMap((k) => groups[k].map((n) => n.file)));
  const rows = all.filter((n) => !grouped.has(n.file));
  const waiting = (list?.notes ?? []).filter((n) => n.waiting).length;
  const sub = !list ? "loading…" : list.error ? "no notes folder" : `${list.notes.length} recent · ${waiting} waiting for a verdict`;
  const narrowed = filter.waiting || filter.kinds.length || filter.lanes.length || filter.q.trim();

  return (
    <div className="view-col">
      <div className="view-head">
        <h2>Brain</h2>
        <span className="mono view-sub">{sub}</span>
        {picked.length > 0 && <button type="button" className="chip-btn" onClick={applyPicked}>Apply suggestions ({picked.length})</button>}
        <button type="button" className="chip-btn" onClick={() => send({ type: "brain_list" })}>Check now</button>
      </div>
      <div id="brain-list">
        {list?.error ? (
          <div className="tk-setup" role="status">
            <p>{list.error}</p>
            <button type="button" className="chip-btn" onClick={() => openSettings("notes")}>Set the folder</button>
          </div>
        ) : list && !all.length ? <div className="side-hint">{narrowed ? "Nothing matches." : "No notes yet."}</div> : null}
        {SUGGESTED.map((k) => groups[k].length > 0 && (
          <section key={k} className="rt-group" aria-label={`Suggested: ${k}`}>
            <h3 className="chats-repo">Suggested: {k}<span className="mono">{groups[k].length}</span>
              {groups[k].some(suggestable) && <button type="button" className="row-btn sg-all" onClick={() => pickAll(groups[k])}>Select all</button>}</h3>
            {groups[k].map((n) => <SuggestLine key={n.file} n={n} />)}
          </section>
        ))}
        {rows.length > 0 && (
          <section className="rt-group" aria-label="Other notes">
            {grouped.size > 0 && <h3 className="chats-repo">Other notes<span className="mono">{rows.length}</span></h3>}
            {rows.map((n) => <NoteLine key={n.file} n={n} />)}
          </section>
        )}
      </div>
    </div>
  );
}

/** Brain's adjustments in the Panel: Unreviewed only, kind, lane, Search notes. */
export function BrainAdjust() {
  const filter = useBrain((s) => s.filter);
  return (
    <div className="panel-body" aria-label="Adjust the list">
      <div className="side-head"><span className="brand">Brain</span></div>
      <label className="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" placeholder="Search notes" aria-label="Search notes" autoComplete="off" spellCheck={false}
          value={filter.q} onChange={(e) => setFilter({ q: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") setFilter({ q: "" }); }} />
      </label>
      <button type="button" className="panel-toggle" aria-pressed={filter.waiting} onClick={() => setFilter({ waiting: !filter.waiting })}>
        <span className="panel-check" aria-hidden="true">{filter.waiting ? "✓" : ""}</span>Unreviewed only
      </button>
      <fieldset className="panel-repos">
        <legend className="sec-head"><span>Kind</span>{filter.kinds.length > 0 && <button type="button" className="row-btn" onClick={() => setFilter({ kinds: [] })}>All</button>}</legend>
        {KINDS.map((k) => (
          <label key={k} className="panel-repo"><input type="checkbox" checked={filter.kinds.includes(k)} onChange={() => setFilter({ kinds: toggleIn(filter.kinds, k) })} /><span>{k}</span></label>
        ))}
      </fieldset>
      <fieldset className="panel-repos">
        <legend className="sec-head"><span>Lane</span>{filter.lanes.length > 0 && <button type="button" className="row-btn" onClick={() => setFilter({ lanes: [] })}>All</button>}</legend>
        {LANES.map((l) => (
          <label key={l} className="panel-repo"><input type="checkbox" checked={filter.lanes.includes(l)} onChange={() => setFilter({ lanes: toggleIn(filter.lanes, l) })} /><span>{l}</span></label>
        ))}
      </fieldset>
    </div>
  );
}

/** A note's siblings in the Panel: Brain's list, filtered, in the order it had when Brain opened. */
export function BrainSiblings() {
  const { list, filter, snap, file } = useBrain();
  const rows = brainRows(list?.notes ?? [], filter, snap);
  return (
    <div className="panel-body side-scroll" aria-label="Brain's notes">
      <div className="side-head"><span className="brand">Brain</span></div>
      {rows.map((n) => <NoteLine key={n.file} n={n} current={n.file === file} />)}
      {list && !rows.length && <div className="side-hint">Nothing matches.</div>}
    </div>
  );
}

/** One note: the header line, the Verdict, then the note's text. */
export function NotePage() {
  const { file, note } = useBrain();
  if (!note || note.file !== file) return <div className="view-col"><div className="side-hint">Opening the note…</div></div>;
  const head = headerLine(note);
  const [word] = note.verdict.split(" ");
  return (
    <div className="view-col note-page">
      <div className="view-head">
        <h2>{note.title}</h2>
        <span className="mono view-sub">{note.kind} · {relTime(note.mtime)}</span>
      </div>
      {head && <p className="note-head mono"><span className={scoreDot(note.score)} /> {head}</p>}
      <div className="note-verdict" role="group" aria-label="Verdict">
        <span className="mono view-sub">{note.verdict ? verdictText(note.verdict) : note.waiting ? "waiting for your verdict" : "Verdict"}</span>
        {word !== "approve" && <button type="button" className="chip-btn" onClick={() => setVerdict("approve")}>Approve</button>}
        {word !== "reject" && <button type="button" className="chip-btn" onClick={() => setVerdict("reject")}>Reject</button>}
        {note.verdict && <button type="button" className="chip-btn" onClick={() => setVerdict("restore")}>Restore</button>}
      </div>
      <Markdown className="md note-body" text={note.body} />
    </div>
  );
}
