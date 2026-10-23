import { useEffect } from "react";
import { send } from "../ws";
import { openRoutine, markAllRead } from "../stores/routine";
import { NOTIFY_LABEL, dayTime, routineDot, routinesSubtitle, routineState, routineStatus, safeRunUrl, setNotify, useViews, whyLine, type NotifyMode } from "../stores/views";

// Scheduled cloud agents (claude.ai). The server checks every 30 min; failed, stuck or missed ones
// get a badge and a spoken notice. All text comes from the runs, so it's shown as plain text only.
export function Routines() {
  const { routines: r, routinesNew } = useViews();

  useEffect(() => { // opening the panel: show what's known, check again if it's old, forget "new"
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
        {(r?.read ?? 0) > 0 && <button type="button" className="chip-btn" onClick={markAllRead}>Mark all read</button>}
        <button type="button" className="chip-btn" id="routines-refresh" disabled={!!r?.checking}
          onClick={() => send({ type: "routines", refresh: true })}>Check now</button>
      </div>
      <div id="routines-list">
        {(!r || r.items.length === 0) && <div className="side-hint">{r?.checking ? "Checking your routines…" : "No routines found."}</div>}
        {r?.items.map((x) => {
          const l = x.last;
          const url = safeRunUrl(l?.url);
          const meta = [l?.at ? `last ${dayTime(l.at)}` : null, x.enabled && x.next_run_at ? `next ${dayTime(x.next_run_at)}` : null].filter(Boolean).join(" · ");
          return (
            <div key={x.id} className={`rt-row ${routineState(x)}${routinesNew.has(x.id) ? " new" : ""}${x.quiet ? " quiet" : ""}`}>
              <div className="rt-head">
                <span className={routineDot(x)} />
                <button type="button" className="rt-name rt-open" onClick={() => openRoutine(x.id)} title="Open this result">{x.name}</button>
                <span className="rt-status mono">{routineStatus(x)}</span>
              </div>
              <div className="rt-meta mono">
                {meta}
                {url && <>{meta ? " · " : ""}<a className="rt-link" href={url} target="_blank" rel="noopener noreferrer">open run ↗</a></>}
              </div>
              {whyLine(x) && <div className="rt-why mono">{x.loud && <span className="sq" aria-hidden="true" />}{whyLine(x)}</div>}
              {l?.summary && !x.quiet && <div className="rt-summary">{l.summary}</div>}
              {l?.summary && x.quiet && (
                <details className="rt-more"><summary className="mono">show the result</summary><div className="rt-summary open">{l.summary}</div></details>
              )}
              {x.enabled && (
                <div className="rt-notify" role="radiogroup" aria-label={`Notify for ${x.name}`}>
                  <span className="mono">notify</span>
                  {(["auto", "always", "never"] as NotifyMode[]).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={(x.notify ?? "auto") === m} className={(x.notify ?? "auto") === m ? "on" : ""}
                      title={m === "auto" ? "Let Haiku judge each result" : m === "always" ? "Every result notifies" : "Results never notify (failures still do)"}
                      onClick={() => setNotify(x.id, m)}>{NOTIFY_LABEL[m]}</button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
