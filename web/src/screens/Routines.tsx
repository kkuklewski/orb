import { useEffect, useState } from "react";
import { send } from "../ws";
import { openRoutine, markRunsRead } from "../stores/routine";
import { routineDot, routineGroups, routinesSubtitle, routineTime, useViews, whyLine } from "../stores/views";

// Scheduled cloud agents (claude.ai), one line per routine: dot, name, state word, when. Grouped by state, by name
// inside, so a routine keeps its place; the judge's why rides along only where it matters (the top two groups).
// The last run, next run, run link and notify setting are on the routine's own page. All text comes from the runs,
// so it's shown as plain text only.
export function Routines() {
  const { routines: r, routinesNew } = useViews();
  const [showOff, setShowOff] = useState(false);

  useEffect(() => { // opening the list: show what's known, check again if it's old, forget "new"
    const items = useViews.getState().routines?.items ?? [];
    const fresh = new Set(items.filter((x) => x.new).map((x) => x.id));
    useViews.setState({ routinesNew: fresh });
    send({ type: "routines" });
    if (fresh.size) send({ type: "routines_seen" });
  }, []);

  return (
    <div className="view-col">
      <div className="view-head">
        <h2>Routines</h2>
        <span className="mono view-sub">{routinesSubtitle(r)}</span>
        {(r?.read ?? 0) > 0 && <button type="button" className="chip-btn" onClick={markRunsRead}>Mark runs read</button>}
        <button type="button" className="chip-btn" id="routines-refresh" disabled={!!r?.checking}
          onClick={() => send({ type: "routines", refresh: true })}>Check now</button>
      </div>
      <div id="routines-list">
        {(!r || r.items.length === 0) && <div className="side-hint">{r?.checking ? "Checking your routines…" : "No routines found."}</div>}
        {r && routineGroups(r.items).map((g) => {
          const off = g.name === "Off";
          return (
            <section key={g.name} className="rt-group" aria-label={g.name}>
              {off ? (
                <button type="button" className="rt-off mono" aria-expanded={showOff} onClick={() => setShowOff(!showOff)}>{g.items.length} off</button>
              ) : (
                <h3 className="chats-repo">{g.name}<span className="mono">{g.items.length}</span></h3>
              )}
              {(!off || showOff) && g.items.map((x) => {
                const why = g.tail ? whyLine(x) : "";
                return (
                  <button type="button" key={x.id} className={`rt-line${routinesNew.has(x.id) ? " new" : ""}`} data-state={x.state} onClick={() => openRoutine(x.id)}>
                    <span className={routineDot(x)} />
                    <span className="rt-name">{x.name}</span>
                    <span className="rt-state mono">{x.state}</span>
                    <span className="rt-time mono">{routineTime(x)}</span>
                    {why && <span className="rt-tail mono">{why}</span>}
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
