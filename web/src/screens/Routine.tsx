import { useEffect } from "react";
import { useViews, NOTIFY_LABEL, dayTime, routineStatus, safeRunUrl, setNotify, whyLine, type NotifyMode } from "../stores/views";
import { askAbout, makeTask, markRead, useRoutineScreen } from "../stores/routine";
import { useFeatures } from "../stores/features";
import { useChat } from "../stores/chat";
import { useSession } from "../stores/session";
import { ItemView } from "./chat/Chat";

// One routine's last result: the whole text (plain text, never markup: it may quote email or repos),
// why it did or didn't notify, and what to do with it. Orb's routine access is read-only, so there is
// no "run again" here; "Open run" goes to claude.ai.

export function RoutineScreen() {
  const id = useRoutineScreen((s) => s.id);
  const r = useViews((s) => s.routines);
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const x = r?.items.find((i) => i.id === id) ?? null;
  const i = r && x ? r.items.findIndex((n) => n.id === x.id) : -1;

  useEffect(() => { if (!r) void import("../ws").then((m) => m.send({ type: "routines" })); }, [r]); // opened from a link
  const items = useChat((c) => c.items);
  const busy = useSession((c) => c.busy);
  // The conversation about this result: your messages asked about a routine, back to the first of that run.
  let from = -1;
  for (let n = items.length - 1; n >= 0; n--) {
    const it = items[n];
    if (it.kind !== "user") continue;
    if (it.screen !== "Routine") break;
    from = n;
  }
  const thread = from >= 0 ? items.slice(from) : [];
  useEffect(() => { // new words: bring them into view
    if (thread.length) document.querySelector(".routine-thread")?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [thread.length]);

  if (!id) return null;
  if (!x) {
    return (
      <section className="task" aria-label="Routine"><div className="home-col">
        <nav className="task-nav mono"><button type="button" className="linkish" onClick={() => useViews.setState({ view: "routines" })}>← ROUTINES</button></nav>
        <p className="home-empty">{r ? "That routine isn't in the list any more." : "Loading…"}</p>
      </div></section>
    );
  }
  const l = x.last;
  const url = safeRunUrl(l?.url);
  const text = l?.detail || l?.summary || "";
  const unread = x.new;
  const mode = (x.notify ?? "auto") as NotifyMode;
  const prev = r && i > 0 ? r.items[i - 1] : null;
  const next = r && i >= 0 && i < r.items.length - 1 ? r.items[i + 1] : null;
  const go = (n: { id: string } | null) => n && useRoutineScreen.setState({ id: n.id });

  return (
    <section className="task" aria-label="Routine">
      <div className="home-col">
        <nav className="task-nav mono" aria-label="Routine navigation">
          <button type="button" className="linkish" onClick={() => useViews.setState({ view: "routines" })}>← ROUTINES</button>
          <span className="task-pos">
            {i + 1} OF {r!.items.length}
            <button type="button" className="sqbtn" aria-label="Previous routine" disabled={!prev} onClick={() => go(prev)}>↑</button>
            <button type="button" className="sqbtn" aria-label="Next routine" disabled={!next} onClick={() => go(next)}>↓</button>
          </span>
        </nav>

        <header className="task-head">
          <div className="mono home-kicker">// ROUTINE · {routineStatus(x).toUpperCase()}</div>
          <h1>{x.name}</h1>
          <div className="task-chips mono">
            {l?.at && <span>last run {dayTime(l.at)}</span>}
            {x.enabled && x.next_run_at && <span>next {dayTime(x.next_run_at)}</span>}
          </div>
          {whyLine(x) && <p className="rt-why mono routine-why">{x.loud && <span className="sq" aria-hidden="true" />}{whyLine(x)}</p>}
        </header>

        <section className="task-actions" aria-label="Actions">
          <div className="task-buttons">
            <button type="button" className="hbtn dark big" disabled={!unread} onClick={() => markRead(x.id)}>
              {unread ? "Mark read" : "Read"}
            </button>
            <button type="button" className="hbtn big outline" onClick={() => askAbout(x)}>Ask Claude about it →</button>
            <button type="button" className="hbtn big" disabled={!vault || !l} onClick={() => makeTask(x.id)}
              title={vault ? "Adds a line to inbox/Orb tasks.md in your notes" : "Choose a notes folder first (Settings)"}>Make it a task</button>
            {url && <a className="hbtn big" href={url} target="_blank" rel="noopener noreferrer">Open run ↗</a>}
          </div>
          {x.enabled && (
            <div className="rt-notify routine-notify" role="radiogroup" aria-label={`Notify for ${x.name}`}>
              <span className="mono">notify</span>
              {(["auto", "always", "never"] as NotifyMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => setNotify(x.id, m)}>{NOTIFY_LABEL[m]}</button>
              ))}
            </div>
          )}
          <p className="mono task-say">Orb only reads your routines; it can't run, change or pause them. Failures always notify.</p>
        </section>

        <article className="hc routine-result" aria-label="The result">
          <div className="hc-head">
            <div className="hc-label mono">THE RESULT</div>
            <h2>{l ? (l.outcome === "ok" ? "What the run reported" : `The run ${l.outcome ?? "has no outcome"}`) : "No runs yet"}</h2>
          </div>
          <pre className="routine-text">{text || "(the run left no text)"}</pre>
          <div className="hc-foot mono"><span>shown as plain text</span>{url && <a href={url} target="_blank" rel="noopener noreferrer">Open run ↗</a>}</div>
        </article>

        <article className="hc routine-thread" aria-label="Ask Claude about this result">
          <div className="hc-head">
            <div className="hc-label mono">ASK CLAUDE</div>
            <h2>{thread.length ? "About this result" : "Ask about this result"}</h2>
          </div>
          {thread.length > 0 ? (
            <div className="column">
              {thread.map((it, n) => <ItemView key={it.key} it={it} last={n === thread.length - 1} />)}
              {busy && <div className="turn-end mono">working…</div>}
            </div>
          ) : (
            <p className="hc-empty">Press “Ask Claude about it”, or type below. The answer shows here; Claude sees this result, not your other screens.</p>
          )}
          {thread.length > 0 && (
            <div className="hc-foot mono"><span>in a notes session</span><button type="button" onClick={() => useViews.setState({ view: "chat" })}>Open in chat →</button></div>
          )}
        </article>
      </div>
    </section>
  );
}
