import { useEffect, useRef, useState } from "react";
import { folderName, openPicker } from "../stores/session";
import { openSessions, useViews } from "../stores/views";
import { openItems } from "../stores/items";
import { openSetup } from "../stores/setup";
import { laterPlan, startPlan, type NeedsYou } from "../stores/home";
import { donePlan } from "../stores/tasks";
import { delegate, delegateBulk, pickRepo } from "../stores/delegation";
import { NOTES_STEP } from "./setup/Setup";
import type { PlanItem } from "../protocol.gen";

// Home's next action: the first item of the plan's queue, big (what it is, why, Start / Done / Later), and Up next as
// one-line rows under it. The server decides the queue (needs.py): Vikunja tasks, tasks in the notes, finished
// results, your pull requests, the notes waiting for a verdict. A row click brings it up, so any item starts in two
// taps. Done (tasks only) writes it done at once, with Undo; Later hides it until tomorrow on every page. Both
// happen on the server, which sends the new plan. What blocks you is the Needs you strip above it (HomeNeeds).
// A Vikunja task can also be delegated (HomeDelegated: the repo picker when its project has none, the grant card).
// An empty queue is one line (HomeEmpty): Nothing waiting, New session.
// Each task on Up next carries the rule's suggestion (suggest.py: take now, delegate or later), a word beside it; a tap
// does that action (Start, Delegate with its grant card, Later). Never Done, and only tasks have one.
// Select (Up next, when it has a task) ticks several tasks: Apply suggestions does each one's action in one pass (Later,
// then one bulk Delegate, whose cards come one per repo and queue past the limit, then Start); Delegate N delegates
// the ticked ones with a known repo (the others say why). The server then asks one card per repo.
// Keys (Home only, not while typing): J K select a row of Up next, Enter starts, S is Later, D is Done; they act on
// the selected row, or on the lead when none is.

const TAG: Record<string, string> = { task: "TASK", note_task: "NOTE", result: "RESULT", pr: "PR", notes_batch: "NOTES" };
const GO: Record<string, string> = { result: "Read the answer", pr: "Review", notes_batch: "Judge them" };
const SUG_TITLE: Record<string, string> = { "take now": "Suggested: start it now (due soon)", delegate: "Suggested: delegate it", later: "Suggested: later (hide it until tomorrow)" };

/** The plan's queue with `front` (a row the owner clicked) brought up. */
export function leadQueue(q: PlanItem[], front: string | null): PlanItem[] {
  const f = front ? q.find((i) => i.key === front) : undefined;
  return f ? [f, ...q.filter((i) => i !== f)] : q;
}

const side = (p: PlanItem) => [p.source, p.due].filter(Boolean).join(" · ");
const canDelegate = (p: PlanItem) => p.kind === "task" && !!p.actions?.includes("delegate");
/** A task Bulk Delegate can take: a Vikunja task whose project maps to a repo here. */
export const bulkable = (p: PlanItem) => canDelegate(p) && !!p.repo;

/** Do what the item's suggestion says: take now -> Start, delegate -> the grant card, later -> Later. */
export function followSuggestion(p: PlanItem) {
  if (p.suggest === "take now") startPlan(p);
  else if (p.suggest === "delegate") (p.repo ? delegate(p.id) : pickRepo(p.id));
  else if (p.suggest === "later") laterPlan(p);
}

/** Apply suggestions on a selection: Later first, then the delegations as one bulk (a card per repo, queued past the
 * limit), then Start last, since starting moves the page to the new session. */
export function applySuggestions(items: PlanItem[]) {
  const by = (w: PlanItem["suggest"]) => items.filter((x) => x.suggest === w);
  by("later").forEach(laterPlan);
  const del = by("delegate").filter(bulkable);
  if (del.length) delegateBulk(del.map((x) => x.id));
  by("take now").forEach(startPlan);
}

/** "2 take now · 1 delegate": what Apply suggestions will do. */
export const suggestCount = (items: PlanItem[]) => (["take now", "delegate", "later"] as const)
  .map((w) => [w, items.filter((x) => x.suggest === w).length] as const).filter(([, n]) => n).map(([w, n]) => `${n} ${w}`).join(" · ");

export type Lists = { tasks: number; tasksSource: "vikunja" | "tasks" | null; notes: number; error?: string | null; vault: boolean };

export function LeadCard({ n, queue, lists, title }: { n: NeedsYou; queue: PlanItem[]; lists: Lists; title: string }) {
  const [front, setFront] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [ticked, setTicked] = useState<string[] | null>(null);  // Select mode: the plan keys ticked
  const q = leadQueue(queue, front);
  const lead = q[0];
  const rest = q.slice(1);
  const at = rest.findIndex((x) => x.key === sel);
  const picked = ticked ? rest.filter((x) => ticked.includes(x.key)) : [];
  const skip = () => { if (!lead) return; setFront(null); laterPlan(lead); };
  const done = () => { if (!lead) return; setFront(null); donePlan(lead); };
  const act = useRef<(e: KeyboardEvent) => void>(() => {});
  act.current = (e) => {
    const target = at >= 0 ? rest[at] : lead;
    if (!target) return;
    const gone = () => { if (at >= 0) setSel(rest[at + 1]?.key ?? rest[at - 1]?.key ?? null); else setFront(null); };  // a row goes: select its neighbour
    const k = e.key.toLowerCase();
    if (k === "j" && rest.length) setSel(rest[Math.min(at + 1, rest.length - 1)].key);
    else if (k === "k" && at >= 0) setSel(at > 0 ? rest[at - 1].key : null);
    else if (e.key === "Enter") startPlan(target);
    else if (k === "s") { gone(); laterPlan(target); }
    else if (k === "d" && target.actions?.includes("done")) { gone(); donePlan(target); }
    else return;
    e.preventDefault();
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || useViews.getState().view !== "home" || el.isContentEditable  // a task open beside Home has its own D
        || el.closest?.("input, textarea, select, [role=dialog]") || (e.key === "Enter" && el.closest?.("button, a"))) return;
      act.current(e);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  useEffect(() => { document.querySelector(".lead-row.sel")?.scrollIntoView?.({ block: "nearest" }); }, [sel]);

  return (
    <article className="hc lead" aria-label={title} id="next" tabIndex={-1}>
      <div className="lead-top">
        <div className={"lead-label mono" + (lead ? " on" : "")}><span className="lead-dot" aria-hidden="true" />
          {lead ? `NEXT ACTION · ${TAG[lead.kind] ?? lead.kind.toUpperCase()}${side(lead) ? ` · ${side(lead).toUpperCase()}` : ""}` : "NEXT ACTION"}
        </div>
      </div>
      {lead && (
        <div className="lead-body" key={lead.key}>
          <h2 className="lead-head">{lead.title}</h2>
          <p className="lead-sub">{lead.reason}</p>
          <div className="lead-actions">
            <button type="button" className="hbtn dark big lead-go" onClick={() => startPlan(lead)}>{GO[lead.kind] ?? "Start"} <kbd className="kbd">⏎</kbd></button>
            {lead.actions?.includes("done") && <button type="button" className="hbtn big" onClick={done}>Done <kbd className="kbd">D</kbd></button>}
            <button type="button" className="hbtn big" onClick={skip} title="Hide it until tomorrow">Later <kbd className="kbd">S</kbd></button>
            {lead.kind === "task" && lead.actions?.includes("delegate") && (
              <button type="button" className="hbtn big" title="A background session does it in its own worktree; you review and apply"
                onClick={() => (lead.repo ? delegate(lead.id) : pickRepo(lead.id))}>Delegate{lead.repo ? ` to ${lead.repo}` : ""}</button>
            )}
          </div>
        </div>
      )}
      {!!rest.length && rest.some((x) => x.suggest) && (
        <div className="lead-pick mono">
          {ticked ? (
            <>
              <button type="button" className="hbtn dark" disabled={!picked.some((x) => x.suggest)}
                onClick={() => { applySuggestions(picked); setTicked(null); }}>Apply suggestions{picked.length ? ` (${picked.length})` : ""}</button>
              <button type="button" className="hbtn" disabled={!picked.some(bulkable)}
                onClick={() => { delegateBulk(picked.filter(bulkable).map((x) => x.id)); setTicked(null); }}>Delegate {picked.filter(bulkable).length || ""}</button>
              <button type="button" className="hbtn" onClick={() => setTicked(null)}>Cancel</button>
              {picked.length > 0 && <span className="lead-pick-hint">{suggestCount(picked)}</span>}
              {picked.some((x) => !bulkable(x)) && <span className="lead-pick-hint">Only tasks whose project has a repo can be delegated together.</span>}
            </>
          ) : <button type="button" className="hbtn" onClick={() => setTicked([])}>Select</button>}
        </div>
      )}
      {!!rest.length && ticked && (
        <div className="lead-rows" aria-label="Up next">
          {rest.map((x) => (
            <label key={x.key} className={"lead-row pick" + (x.suggest ? "" : " off")} title={x.suggest ? x.reason : "Only tasks can be picked"}>
              <input type="checkbox" disabled={!x.suggest} checked={ticked.includes(x.key)} aria-label={`Select ${x.title}`}
                onChange={(e) => setTicked(e.target.checked ? [...ticked, x.key] : ticked.filter((k) => k !== x.key))} />
              <span className="lead-row-tag mono">{TAG[x.kind] ?? x.kind.toUpperCase()}</span>
              <span className="lead-row-text">{x.title}</span>
              {x.suggest && <span className="lead-sug mono" data-sug={x.suggest}>{x.suggest}</span>}
              <span className="mono">{x.repo ?? side(x)}</span>
            </label>
          ))}
        </div>
      )}
      {!!rest.length && !ticked && (
        <div className="lead-rows" aria-label="Up next">
          {rest.map((x) => (
            <div key={x.key} className="lead-item">
              <button type="button" className={"lead-row" + (x.key === sel ? " sel" : "")} aria-current={x.key === sel || undefined} onClick={() => { setSel(null); setFront(x.key); }} title={x.reason}>
                <span className="lead-row-tag mono">{TAG[x.kind] ?? x.kind.toUpperCase()}</span>
                <span className="lead-row-text">{x.title}</span><span className="mono">{side(x)}</span>
              </button>
              {x.suggest && (
                <button type="button" className="lead-sug mono" data-sug={x.suggest} aria-label={`${x.suggest}: ${x.title}`}
                  title={SUG_TITLE[x.suggest] + (x.suggest === "delegate" && x.repo ? ` to ${x.repo}` : "")}
                  onClick={() => { if (x.key === sel) setSel(null); followSuggestion(x); }}>{x.suggest}</button>
              )}
            </div>
          ))}
        </div>
      )}
      <LeadFoot n={n} lists={lists} />
    </article>
  );
}

function LeadFoot({ n, lists }: { n: NeedsYou; lists: Lists }) {
  return (
    <div className="hc-foot mono">
      <span>{n.working.length ? `${n.working.length} running · ${n.working.slice(0, 2).map((x) => folderName(x.folder)).join(", ")}` : "nothing running"}</span>
      <span className="lead-links">
        {lists.tasksSource && lists.tasks > 0 && <button type="button" onClick={() => openItems(lists.tasksSource!)}>All {lists.tasks} tasks →</button>}
        {lists.notes > 0 && <button type="button" onClick={() => openItems("notes")}>All {lists.notes} notes →</button>}
        <button type="button" onClick={() => openSessions()}>Sessions →</button>
      </span>
    </div>
  );
}

/** Nothing queued: one line in place of the lead card ("Nothing waiting" when Needs you is empty too), and a new session. */
export function HomeEmpty({ n, lists, hasRepos, needs }: { n: NeedsYou; lists: Lists; hasRepos: boolean; needs: boolean }) {
  const title = needs ? "Nothing else queued" : "Nothing waiting";
  const note = !hasRepos ? "Choose a repo to start." : lists.error;
  return (
    <article className="hc home-empty" aria-label={title} id="next">
      <div className="empty-line">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
        <span className="empty-actions">
          {!lists.vault && <button type="button" className="hbtn" onClick={() => openSetup(NOTES_STEP)}>Choose notes folder</button>}
          <button type="button" className="hbtn dark" onClick={() => openPicker("new")}>New session <kbd className="kbd">⌘K</kbd></button>
        </span>
      </div>
      <LeadFoot n={n} lists={lists} />
    </article>
  );
}
