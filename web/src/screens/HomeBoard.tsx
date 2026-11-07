import type { ReactNode } from "react";
import { useFeatures } from "../stores/features";
import { folderName, openFolder } from "../stores/session";
import { activityRows, dayTime, openSessions, relTime, useViews } from "../stores/views";
import { emailDone, makeTask, openRoutine, resolvable, resolveRun } from "../stores/routine";
import { openItem, openItems } from "../stores/items";
import { laterPlan, leavePlan, startPlan, useHome } from "../stores/home";
import { donePlan, openTask } from "../stores/tasks";
import { delegate, pickRepo, useDelegations } from "../stores/delegation";
import { boardColumns, COLUMNS, noteRef, type BoardCard } from "../stores/board";
import { send } from "../ws";
import type { PlanItem } from "../protocol.gen";
import { canDelegate, GO, TAG as LEAD_TAG } from "./HomeLead";
import { DELEG_TAG, planRow } from "./HomeNeeds";
import { Actions, DelegExtras } from "./HomeDelegated";

// Home's Board (GLOSSARY: Board): the same actions as the Focus look, in four Kanban columns: To do, In progress,
// Review, Done (stores/board.ts sorts them). Each card says what it is, why, and its chips (kind, due, a flag when it
// needs you; red only when a rule says urgent), with the buttons the Focus look gives the same item. A tap on the
// title opens it. Home never allows or denies here either: an approval card opens its session.

type Chip = { text: string; tone?: "needs" | "urgent" };

function Card({ label, title, meta, open, href, chips, acts, extra, tone }: { label: string; title: string; meta?: string | null;
  open?: () => void; href?: string | null; chips: Chip[]; acts?: ReactNode; extra?: ReactNode; tone?: "needs" | "urgent" }) {
  const head = <><span className="kb-title">{title}</span>{meta && <span className="kb-meta">{meta}</span>}</>;
  return (
    <article className={"kb-card" + (tone ? ` ${tone}` : "")} aria-label={label}>
      {open ? <button type="button" className="kb-open" onClick={open}>{head}</button>
        : href ? <a className="kb-open" href={href} target="_blank" rel="noopener noreferrer">{head}</a>
        : <div className="kb-open still">{head}</div>}
      {chips.length > 0 && <div className="kb-chips">{chips.map((c, i) => <span key={i} className={"kb-chip mono" + (c.tone ? ` ${c.tone}` : "")}>{c.text}</span>)}</div>}
      {acts && <div className="kb-acts">{acts}</div>}
      {extra}
    </article>
  );
}

const B = ({ dark, onClick, children }: { dark?: boolean; onClick: () => void; children: ReactNode }) =>
  <button type="button" className={"hbtn" + (dark ? " dark" : "")} onClick={onClick}>{children}</button>;

const planChips = (p: PlanItem, tag: string): Chip[] => [
  { text: tag, tone: p.urgent ? "urgent" : undefined },
  ...(p.pin ? [{ text: p.pin.toUpperCase(), tone: "needs" as const }] : []),
  ...(p.due ? [{ text: p.due, tone: p.urgent ? "urgent" as const : undefined }] : []),
  ...(p.source ? [{ text: p.source }] : []),
  ...(p.held_by ? [{ text: p.held_by }] : []),
];

/** Opening an item you already started goes back to it, without starting it again. */
function reopen(p: PlanItem) {
  const ref = p.kind === "note_task" ? noteRef(p.id) : null;
  if (p.kind === "task") openItem("vikunja", p.id);
  else if (ref) openTask(ref);
  else if (p.kind === "pr") openItem("prs", p.id);
  else startPlan(p);
}

function PlanCard({ p, started }: { p: PlanItem; started?: boolean }) {
  const review = !!GO[p.kind];
  const done = p.actions?.includes("done");
  const tag = LEAD_TAG[p.kind] ?? p.kind.toUpperCase();
  return (
    <Card label={p.title} title={p.title} meta={p.reason} open={() => (started ? reopen(p) : startPlan(p))}
      chips={[...planChips(p, tag), ...(started ? [{ text: "STARTED" }] : []), ...(p.suggest && !started ? [{ text: p.suggest }] : [])]}
      tone={p.urgent ? "urgent" : undefined}
      acts={<>
        {started ? <B dark onClick={() => reopen(p)}>Open</B> : <B dark onClick={() => startPlan(p)}>{GO[p.kind] ?? "Start"}</B>}
        {done && <B onClick={() => donePlan(p)}>Done</B>}
        {canDelegate(p) && !started && <B onClick={() => (p.repo ? delegate(p.id) : pickRepo(p.id))}>Delegate</B>}
        {review && p.actions?.includes("leave") && <B onClick={() => leavePlan(p)}>Leave it</B>}
        <B onClick={() => laterPlan(p)}>Later</B>
      </>} />
  );
}

function NeedCard({ p }: { p: PlanItem }) {
  const routines = useViews((s) => s.routines?.items);
  const r = planRow(p, (id) => resolvable(routines?.find((x) => x.id === id)));
  return (
    <Card label={r.title} title={r.title} meta={r.reason} open={r.open} href={r.href} tone={r.urgent ? "urgent" : "needs"}
      chips={[{ text: r.tag, tone: r.urgent ? "urgent" : "needs" }, ...(r.pin ? [{ text: r.pin.toUpperCase(), tone: "needs" as const }] : []),
        ...(p.due ? [{ text: p.due, tone: r.urgent ? "urgent" as const : undefined }] : [])]}
      acts={(r.task || r.repair || r.resolve) && <>
        {p.kind === "routine" && <B onClick={() => openRoutine(p.id)}>Open</B>}
        {r.task && <B dark onClick={() => { openRoutine(p.id); makeTask(p.id); }}>Make it a task</B>}
        {r.repair && (r.repair.href ? <a className="hbtn" href={r.repair.href} target="_blank" rel="noopener noreferrer">Task #{r.repair.task}</a>
          : <span className="kb-chip mono">Task #{r.repair.task}</span>)}
        {r.resolve && <B onClick={() => resolveRun(p.id)}>Mark resolved</B>}
      </>} />
  );
}

function KCard({ c }: { c: BoardCard }) {
  switch (c.type) {
    case "need": return <NeedCard p={c.item} />;
    case "plan": return <PlanCard p={c.item} started={c.started} />;
    case "done": {
      const p = c.item;
      return (
        <Card label={p.title} title={p.title} meta={p.source ?? null} chips={[{ text: LEAD_TAG[p.kind] ?? p.kind.toUpperCase() }, { text: "DONE" }]}
          acts={p.kind === "task" && <B onClick={() => send({ type: "plan_done", key: p.key, undo: true })}>Undo</B>} />
      );
    }
    case "session": {
      const x = c.row;
      const waiting = x.status === "approval";
      const since = waiting ? x.waiting_since ?? x.last_used : x.last_used;
      const red = waiting && !!x.red_at && Date.now() / 1000 >= x.red_at;
      const title = `${folderName(x.folder)}: ${x.label || "New session"}`;
      return (
        <Card label={title} title={title} meta={waiting ? "Waiting for your OK." : "Working on it."} open={() => openFolder(x.folder.path, x.key)}
          tone={red ? "urgent" : waiting ? "needs" : undefined}
          chips={[{ text: waiting ? "OK?" : "WORKING", tone: red ? "urgent" : waiting ? "needs" : undefined }, ...(since ? [{ text: relTime(since) }] : [])]}
          extra={x.ask && <code className="kb-quote" aria-label="What it asks to do">{x.ask}</code>}
          acts={<B dark onClick={() => openFolder(x.folder.path, x.key)}>Open session</B>} />
      );
    }
    case "deleg": {
      const d = c.d;
      const title = `#${d.task} ${d.title}`;
      return (
        <Card label={`Delegation of task #${d.task}`} title={title} meta={`${d.repo} · ${d.line}`} tone={d.needs ? "needs" : undefined}
          open={d.needs === "stopped" || d.stage === "queued" ? undefined : () => openFolder(d.folder, d.session)}
          chips={[{ text: "DELEGATED" }, ...(d.needs ? [{ text: DELEG_TAG[d.needs], tone: "needs" as const }] : []), ...(d.pr ? [{ text: `PR #${d.pr}` }] : [])]}
          acts={<Actions d={d} />} extra={<DelegExtras d={d} />} />
      );
    }
    case "email": {
      const e = c.e;
      return (
        <Card label={e.text} title={e.text} meta={`${e.routine_name}${e.at ? `, ${dayTime(e.at)}` : ""}`} tone={e.urgent ? "urgent" : undefined}
          open={() => openRoutine(e.routine)}
          chips={[{ text: "EMAIL" }, ...(e.urgent ? [{ text: "URGENT", tone: "urgent" as const }] : []), ...(e.due ? [{ text: e.due }] : [])]}
          acts={<><B dark onClick={() => emailDone(e.run, e.key)}>Done</B><B onClick={() => openRoutine(e.routine)}>Open run</B></>} />
      );
    }
  }
}

export function HomeBoard({ lists }: { lists: { tasks: number; tasksSource: "vikunja" | "tasks" | null } }) {
  const plan = useHome((s) => s.plan);
  const folders = useFeatures((s) => s.folders);
  const delegations = useDelegations((s) => s.items);
  const emails = useViews((s) => s.routines?.emails) ?? [];
  const board = boardColumns({ plan, sessions: activityRows(folders), delegations, emails });
  return (
    <section className="kb" aria-label="Board">
      <div className="kb-cols">
        {COLUMNS.map(({ id, name }) => (
          <section key={id} className={"kb-col " + id} aria-label={`${name}, ${board[id].length}`}>
            <header className="kb-head">
              <span className="kb-name">{name}</span>
              <span className="kb-count mono">{board[id].length}</span>
            </header>
            <div className="kb-list">
              {board[id].length ? board[id].map((c) => <KCard key={c.key} c={c} />) : <p className="kb-empty">Nothing here</p>}
            </div>
          </section>
        ))}
      </div>
      <div className="kb-foot mono">
        {lists.tasksSource && lists.tasks > 0 && <button type="button" onClick={() => openItems(lists.tasksSource!)}>All {lists.tasks} tasks →</button>}
        <button type="button" onClick={() => openSessions()}>Sessions →</button>
      </div>
    </section>
  );
}
