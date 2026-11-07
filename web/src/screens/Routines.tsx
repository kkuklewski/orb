import { useEffect, useState } from "react";
import type { RoutineItem } from "../protocol.gen";
import { send } from "../ws";
import { openRoutine, markRunsRead, resolvable, resolveRun } from "../stores/routine";
import { dayTime, lineTime, needsReason, routineCards, routineDot, routineGroups, routinesCalm, routinesNeeding, routinesSubtitle,
  routineStatus, routineTime, RUN_WORD, useViews, whyLine } from "../stores/views";

// Scheduled cloud agents (claude.ai) as a dashboard: on top, the Needs you panel says what to act on now (rules only,
// the urgent ones first, ADR 0001); below, one card per routine that is on: state, its last runs as dots, the judge's
// why, what the last run said, when it ran and runs next. Off routines fold away under the cards. All text comes from
// the runs, so it's shown as plain text only.
export function Routines() {
  const { routines: r, routinesNew } = useViews();
  const [showOff, setShowOff] = useState(false);

  useEffect(() => { // opening the screen: show what's known, check again if it's old, forget "new"
    const items = useViews.getState().routines?.items ?? [];
    const fresh = new Set(items.filter((x) => x.new).map((x) => x.id));
    useViews.setState({ routinesNew: fresh });
    send({ type: "routines" });
    if (fresh.size) send({ type: "routines_seen" });
  }, []);

  const items = r?.items ?? [];
  const needing = routinesNeeding(items);
  const cards = routineCards(items);
  const off = routineGroups(items).find((g) => g.name === "Off")?.items ?? [];

  return (
    <div className="view-col">
      <div className="view-head">
        <h2>Routines</h2>
        <span className="mono view-sub">{routinesSubtitle(r)}</span>
        {(r?.read ?? 0) > 0 && <button type="button" className="chip-btn" onClick={markRunsRead}>Mark runs read</button>}
        <button type="button" className="chip-btn" id="routines-refresh" disabled={!!r?.checking}
          onClick={() => send({ type: "routines", refresh: true })}>Check now</button>
      </div>
      {items.length === 0 ? (
        <div className="side-hint">{r?.checking || !r ? "Checking your routines…" : "No routines found."}</div>
      ) : (
        <>
          <section className={"rt-now" + (needing.length ? " hot" : "")} aria-label="Needs you">
            <h3 className="rt-now-head">{needing.length ? "Needs you" : "Nothing needs you"}<span className="mono">{needing.length ? needing.length : routinesCalm(items)}</span></h3>
            {needing.map((x) => <NeedsRow key={x.id} x={x} />)}
          </section>
          <div className="rt-cards" id="routines-list">
            {cards.map((x) => <Card key={x.id} x={x} fresh={routinesNew.has(x.id)} />)}
          </div>
          {off.length > 0 && (
            <section className="rt-group" aria-label="Off">
              <button type="button" className="rt-off mono" aria-expanded={showOff} onClick={() => setShowOff(!showOff)}>{off.length} off</button>
              {showOff && off.map((x) => (
                <button type="button" key={x.id} className="rt-line" data-state={x.state} onClick={() => openRoutine(x.id)}>
                  <span className={routineDot(x)} />
                  <span className="rt-name">{x.name}</span>
                  <span className="rt-state mono">{x.state}</span>
                  <span className="rt-time mono">{routineTime(x)}</span>
                </button>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** One routine that needs you: what's wrong and why; Open goes to its page (Make it a task, Ask Claude, the run's
 *  link), Mark resolved only for a judged problem (a failed or stuck run clears when a run succeeds). */
function NeedsRow({ x }: { x: RoutineItem }) {
  const reason = needsReason(x);
  return (
    <div className={"rt-now-row" + (x.urgent ? " urgent" : "")} data-state={x.state}>
      <button type="button" className="rt-now-main" onClick={() => openRoutine(x.id)}>
        <span className="rt-now-name">{x.name}</span>
        <span className="rt-now-status mono">{routineStatus(x)}{routineTime(x) ? ` · ${routineTime(x)}` : ""}</span>
        {reason && <span className="rt-now-why">{reason}</span>}
      </button>
      <div className="rt-now-acts">
        {x.repair && <span className="mono rt-now-task">Task #{x.repair.task}</span>}
        {resolvable(x) && <button type="button" className="chip-btn" onClick={() => resolveRun(x.id)}>Mark resolved</button>}
        <button type="button" className="chip-btn" onClick={() => openRoutine(x.id)} aria-label={`Open ${x.name}`}>Open</button>
      </div>
    </div>
  );
}

/** One routine at a glance; the whole card opens its page. */
function Card({ x, fresh }: { x: RoutineItem; fresh: boolean }) {
  const runs = x.history ?? [];
  const why = x.needs ? "" : whyLine(x);  // a routine that needs you says why in the panel above
  const said = x.last?.summary || (x.last ? "" : "No runs yet.");
  const when = [x.missed_at ? routineTime(x) : x.last?.at ? `last ${lineTime(x.last.at)}` : "", x.next_run_at ? `next ${dayTime(x.next_run_at)}` : ""].filter(Boolean);
  return (
    <button type="button" className={"rt-card" + (fresh ? " new" : "") + (x.urgent ? " urgent" : "")} data-state={x.state} onClick={() => openRoutine(x.id)}>
      <span className="rt-card-head">
        <span className={routineDot(x)} />
        <span className="rt-name">{x.name}</span>
        <span className="rt-state mono">{x.state}</span>
      </span>
      {runs.length > 0 && (
        <span className="rt-runs" role="img" aria-label={`Last ${runs.length} runs: ${runs.map((d) => RUN_WORD[d.outcome]).join(", ")}`}>
          {runs.map((d, i) => <span key={i} className="rt-run" data-outcome={d.outcome} title={`${RUN_WORD[d.outcome]}${d.at ? ` · ${lineTime(d.at)}` : ""}`} />)}
        </span>
      )}
      {why && <span className="rt-card-why mono">{why}</span>}
      {said && <span className="rt-card-said">{said}</span>}
      {when.length > 0 && <span className="rt-card-when mono">{when.join(" · ")}</span>}
    </button>
  );
}
