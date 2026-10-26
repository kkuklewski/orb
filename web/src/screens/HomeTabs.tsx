import { useId, type KeyboardEvent, type ReactNode } from "react";
import { useFeatures } from "../stores/features";
import { dayTime, openSessions, routineStatus, useViews } from "../stores/views";
import { openRoutine, resolvable, resolveRun } from "../stores/routine";
import { AccRow, Card, useAccordion, type TileAsk } from "./HomeCard";

// Home's status card: Routines and Don't forget share one card, a tab each. A pane that has nothing
// to show has no tab; with no tab chosen, the first one that needs you opens. `line` (how many notes changed this
// week) sits under the panel; with no pane it is the card.

export type Pane = { key: string; tab: string; count?: number; label?: string; title: string; mark?: boolean; ask?: TileAsk; foot?: ReactNode; body: ReactNode };

export const TAB_KEY = "orb.home.tab";
export function savedTab(): string | null {
  try { return localStorage.getItem(TAB_KEY); } catch { return null; }
}
export function saveTab(key: string) {
  try { localStorage.setItem(TAB_KEY, key); } catch { /* private window: the choice lasts for this visit */ }
}

/** The status card. `running` (sessions running or waiting) adds a "Running now" line that opens Sessions showing only those. */
export function TabCard({ id, panes, tab, onTab, line, running }: { id: string; panes: (Pane | null)[]; tab: string | null; onTab: (key: string) => void; line?: string | null; running?: number }) {
  const base = useId();
  const shown = panes.filter((p): p is Pane => !!p);
  const now = running != null && (
    <button type="button" className="hc-running mono" onClick={() => openSessions(true)}>
      <span>Running now: {running}</span><span aria-hidden="true">→</span>
    </button>
  );
  if (!shown.length) return line || now ? <Card id={id} label={line ? "THIS WEEK" : "STATUS"} title={line ?? "Sessions"}>{now}</Card> : null;
  const cur = shown.find((p) => p.key === tab) ?? shown.find((p) => p.mark) ?? shown[0];
  const move = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = shown[(shown.indexOf(cur) + step + shown.length) % shown.length];
    onTab(next.key);
    document.getElementById(`${base}-${next.key}`)?.focus();
  };
  const tabs = shown.length > 1 && (
    <div className="hc-tabs mono" role="tablist" aria-label="Status" onKeyDown={move}>
      {shown.map((p) => (
        <button key={p.key} id={`${base}-${p.key}`} type="button" role="tab" aria-selected={p === cur} aria-controls={`${base}-panel`} tabIndex={p === cur ? 0 : -1} onClick={() => onTab(p.key)}>
          {p.mark && <span className="sq" aria-hidden="true" />}{p.tab}{p.count != null && <span className="n">{p.count}</span>}
        </button>
      ))}
    </div>
  );
  return (
    <Card id={id} className="tabbed" tabs={tabs || undefined} label={cur.label ?? (tabs ? "" : cur.tab.toUpperCase())} title={cur.title} mark={cur.mark} ask={cur.ask} foot={cur.foot}>
      <div role={tabs ? "tabpanel" : undefined} id={`${base}-panel`} aria-labelledby={tabs ? `${base}-${cur.key}` : undefined}>{cur.body}</div>
      {now}
      {line && <p className="hc-week mono">{line}</p>}
    </Card>
  );
}

export function useRoutinesPane(): Pane | null {
  const acc = useAccordion();
  const enabled = useFeatures((s) => s.features?.routines);
  const routines = useViews((s) => s.routines);
  if (!enabled) return null;
  const on = (routines?.items ?? []).filter((x) => x.enabled);
  const need = (routines?.items ?? []).filter((x) => x.needs);
  const ok = on.filter((x) => !x.needs && x.last?.outcome === "ok").length;
  const next = on.filter((x) => x.next_run_at).sort((a, b) => a.next_run_at! - b.next_run_at!)[0];
  const hot = on.filter((r) => r.needs || r.loud);
  const read = on.filter((r) => !r.needs && r.loud).length;
  return {
    key: "routines", tab: "Routines", count: hot.length || undefined, label: "ROUTINES · EVERY 30 MIN", mark: need.length > 0,
    title: routines ? (need.length ? `${need.length} of ${on.length} need you` : `${ok} of ${on.length} ran fine${read ? ` · ${read} worth reading` : ""}`) : "Checking…",
    ask: { name: "Routines", question: "Which of my routines need me, and what should I do about them?",
      text: on.map((r) => `${r.name}: ${r.needs ?? r.last?.outcome ?? "no runs yet"}${r.why ? ` (${r.why})` : ""}`).join("\n") || "No routines are on." },
    foot: <><span>{next ? `next · ${next.name} ${dayTime(next.next_run_at!)}` : "nothing scheduled"}</span><button type="button" onClick={() => useViews.setState({ view: "routines" })}>Routines →</button></>,
    body: <>
      {on.length > 0 && (
        <div className="rt-strip" role="list" aria-label="Routines at a glance">
          {on.map((r) => {
            const state = r.needs ? "needs" : r.loud ? "read" : "fine";
            const said = r.needs || r.loud ? `${r.needs ? routineStatus(r) : "worth reading"}${r.why ? `: ${r.why}` : ""}` : r.last?.outcome ?? "no runs yet";
            return <button key={r.id} type="button" role="listitem" className={`rt-sq ${state}`} title={`${r.name}: ${said}`} aria-label={`${r.name}: ${said}`} onClick={() => openRoutine(r.id)} />;
          })}
        </div>
      )}
      {hot.slice(0, 5).map((r) => (
        <AccRow key={r.id} rowId={r.id} open={acc.open === r.id} onToggle={acc.toggle} pin={{ kind: "routine", id: r.id, label: r.name }} className={r.needs ? "needs" : ""} dot={<span className={"hc-dot sq" + (r.needs ? " hot" : "")} />}
          text={r.name} side={r.needs ? routineStatus(r) : "worth reading"}
          facts={[["Needs", r.needs ? routineStatus(r) : "worth reading"], ...(r.why ? [["Why", r.why] as [string, ReactNode]] : []), ["Last run", r.last?.outcome ?? "no runs yet"], ...(r.next_run_at ? [["Next", dayTime(r.next_run_at)] as [string, ReactNode]] : [])]}
          actions={<>
            <button type="button" className="hbtn dark" onClick={() => openRoutine(r.id)}>Open routine</button>
            {resolvable(r) && <button type="button" className="hbtn" onClick={() => resolveRun(r.id)}>Mark resolved</button>}
          </>} />
      ))}
      {routines && !hot.length && <p className="hc-empty">Nothing to read or decide.</p>}
    </>,
  };
}
