import { useFeatures } from "../stores/features";
import { askIn, folderName, openFolder } from "../stores/session";
import { openSettings, relTime, useViews, type SessionRow } from "../stores/views";
import { makeTask, openRoutine, resolvable, resolveRun } from "../stores/routine";
import { openItem } from "../stores/items";
import { delegText, rerank, useHome, type NeedsYou } from "../stores/home";
import type { DelegationItem, PlanItem } from "../protocol.gen";
import { Actions } from "./HomeDelegated";

// Home's "Needs you" strip: what is blocked or broken until you act, decided by rules (docs/adr/0001). Sessions
// waiting for an OK first (live from the session list), then delegations that can't finish on their own (named by
// task and repo, with their actions; red 24 hours after the card opened), then the plan's rows from the server: a broken setup, routines with a problem,
// reminders due, then tasks past their due date, rows a rule pinned leading them. A tap opens the item (a broken setup opens Settings at the section
// that fixes it, a reminder its link); an approval opens its session, where the Allow / Deny card lives. A routine in
// a failure streak offers Make it a task first (the server's actions), which opens the routine with its card; once its
// Repair task exists the row names "Task #N" (a link to the task) and opens the routine, with no second card. Home
// itself never allows or denies. Hidden when nothing needs you.

export type Row = { key: string; tag: string; title: string; reason: string; quote?: string | null; side: string; open?: () => void; href?: string | null;
  resolve?: () => void; task?: () => void; repair?: { task: number; href: string | null }; urgent?: boolean; pin?: string | null };

const ago = (ts?: number | null) => (ts ? (relTime(ts) === "now" ? "just now" : `${relTime(ts)} ago`) : "just now");

/** A session waiting for your OK: since its oldest card opened (else its last turn), red from the server's `red_at`
 *  (needs.WAITING_H, ADR 0012). It opens the session; Orb never answers or denies the card. */
function approval(x: SessionRow, now = Date.now() / 1000): Row {
  const repo = folderName(x.folder);
  const since = x.waiting_since ?? x.last_used;
  return { key: x.key, tag: "OK?", title: `${repo}: ${x.label || "New session"}`, reason: `Paused ${ago(since)}, waiting for your OK.`,
    quote: x.ask, side: since ? relTime(since) : "now", urgent: !!x.red_at && now >= x.red_at, open: () => openFolder(x.folder.path, x.key) };
}

const DELEG_TAG: Record<NonNullable<DelegationItem["needs"]>, string> = { card: "OK?", failed: "TESTS", stuck: "STUCK", stopped: "STOPPED", outward: "PUSH?" };

/** A delegation in Needs you: the task and the repo say which one; a card's words show like a session's. */
function DelegationRow({ d }: { d: DelegationItem }) {
  const open = () => openFolder(d.folder, d.session);
  return (
    <div className="needs-row deleg-needs" role="group" aria-label={`Delegation of task #${d.task}`}>
      <span className="needs-tag mono">{DELEG_TAG[d.needs!]}</span>
      <button type="button" className="needs-text" onClick={d.needs === "stopped" ? undefined : open} disabled={d.needs === "stopped"}>
        <span className="needs-title">Delegated #{d.task} {d.title}</span>
        <span className="needs-reason">{d.repo} · {d.line}</span>
        {d.ask && <code className="needs-quote" aria-label="What it asks to do">{d.ask}</code>}
      </button>
      {d.needs !== "card" && <Actions d={d} />}
    </div>
  );
}

const TAG: Partial<Record<PlanItem["kind"], string>> = { setup: "SETUP", vault: "VAULT", routine: "ROUTINE", reminder: "DUE", task: "OVERDUE" };

function planRow(p: PlanItem, canResolve: (id: string) => boolean): Row {
  // A pinned row (docs/adr/0012) says its class in the side column, in the column's own grey: it leads, it isn't louder.
  const row = { key: p.key, tag: TAG[p.kind] ?? p.kind.toUpperCase(), title: p.title, reason: p.reason, side: p.pin ?? p.due ?? p.source ?? "", urgent: !!p.urgent, pin: p.pin };
  if (p.kind === "setup") return { ...row, side: p.pin ?? "", open: () => openSettings(p.id) };
  // The vault clone (needs.vault_row): Open is a session in the vault folder; Orb never pulls, merges or fixes it.
  if (p.kind === "vault") {
    const vault = useFeatures.getState().features?.vault;
    return { ...row, side: "", open: vault ? () => openFolder(vault) : undefined };
  }
  if (p.kind === "reminder") return { ...row, href: p.url && /^https?:\/\//.test(p.url) ? p.url : null };
  if (p.kind === "routine") return { ...row, open: () => openRoutine(p.id), resolve: canResolve(p.id) ? () => resolveRun(p.id) : undefined,
    task: p.actions?.[0] === "make_task" ? () => { openRoutine(p.id); makeTask(p.id); } : undefined,
    repair: p.repair ? { task: p.repair, href: p.url && /^https?:\/\//.test(p.url) ? p.url : null } : undefined };
  return { ...row, open: () => openItem("vikunja", p.id) };
}

/** Every Needs you row in the strip's order, as one line each (the Away recap shows the first few). */
export function needsLines(n: NeedsYou, canResolve: (id: string) => boolean = () => false): Row[] {
  const deleg = (d: DelegationItem): Row => ({ key: d.id, tag: DELEG_TAG[d.needs!], title: `Delegated #${d.task} ${d.title}`, reason: `${d.repo} · ${d.line}`,
    side: "", open: d.needs === "stopped" ? undefined : () => openFolder(d.folder, d.session) });
  return [...n.waiting.map((x) => approval(x)), ...n.delegations.map(deleg), ...n.items.map((p) => planRow(p, canResolve))];
}

/** Grey by default; bold red only when a rule says urgent (needs.py), so the few that are stand out. */
const Tag = ({ r }: { r: Row }) => <span className={"needs-tag mono" + (r.urgent ? " urgent" : "")}>{r.tag}</span>;

function RowBody({ r }: { r: Row }) {
  return (
    <>
      <Tag r={r} />
      <span className="needs-text">
        <span className="needs-title">{r.title}</span>
        <span className="needs-reason">{r.reason}</span>
        {r.quote && <code className="needs-quote" aria-label="What it will run">{r.quote}</code>}
      </span>
      <span className="needs-side mono">{r.side}</span>
    </>
  );
}

export function NeedsStrip({ n }: { n: NeedsYou }) {
  const vault = useFeatures((s) => s.features?.vault);
  const routines = useViews((s) => s.routines?.items);
  const canResolve = (id: string) => resolvable(routines?.find((x) => x.id === id));
  const waiting = n.waiting.map((x) => approval(x)), items = n.items.map((p) => planRow(p, canResolve));
  const count = waiting.length + n.delegations.length + items.length;
  if (!count) return null;
  const title = `${count} thing${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you`;
  const ask = [...waiting.map((r) => `${r.title}: ${r.reason}`), ...n.delegations.map(delegText), ...items.map((r) => `${r.title}: ${r.reason}`)].join("\n");
  return (
    <article className="hc needs-strip" aria-label={title} id="needs">
      <div className="lead-top">
        <div className="lead-label mono on"><span className="lead-dot" aria-hidden="true" />NEEDS YOU · {count}</div>
        {vault && <button type="button" className="hc-ask mono" onClick={() => askIn(vault, "What needs me first here, and what should I do about each item?", { name: "Needs you", text: ask }, true)}>Ask about this →</button>}
      </div>
      <div className="needs-rows">
        {waiting.map(row)}
        {n.delegations.map((d) => <DelegationRow key={d.id} d={d} />)}
        {items.map(row)}
      </div>
      {n.items.length > 0 && <div className="hc-foot mono"><RankedBy /></div>}
    </article>
  );
}

/** A routine with its own buttons on the right (Make it a task on a failure streak, its open Repair task's link,
 *  Mark resolved on a reported problem); the text opens it. */
const actionRow = (r: Row) => (
  <div key={r.key} className="needs-row deleg-needs" role="group" aria-label={r.title}>
    <Tag r={r} />
    <button type="button" className="needs-text" onClick={r.open}>
      <span className="needs-title">{r.title}</span>
      <span className="needs-reason">{r.reason}</span>
    </button>
    <span className="deleg-actions">{r.pin && <span className="needs-side mono">{r.pin}</span>}
      {r.task && <button type="button" className="hbtn" onClick={r.task}>Make it a task</button>}
      {r.repair && (r.repair.href ? <a className="hbtn" href={r.repair.href} target="_blank" rel="noopener noreferrer">Task #{r.repair.task}</a>
        : <span className="needs-side mono">Task #{r.repair.task}</span>)}
      {r.resolve && <button type="button" className="hbtn" onClick={r.resolve}>Mark resolved</button>}
    </span>
  </div>
);

export const row = (r: Row) => r.resolve || r.task || r.repair ? actionRow(r) : r.open ? <button key={r.key} type="button" className="needs-row" onClick={r.open}><RowBody r={r} /></button>
  : r.href ? <a key={r.key} className="needs-row" href={r.href} target="_blank" rel="noopener noreferrer"><RowBody r={r} /></a>
  : <div key={r.key} className="needs-row still"><RowBody r={r} /></div>;

/** "ranked 5m ago · Re-rank" (or "rule order"): whether the model's order is shown, and a button to ask it again. */
function RankedBy() {
  const r = useHome((s) => s.plan);
  if (!r) return null;
  const said = r.busy ? "ranking…" : r.error ? `${r.error} Rule order.` : r.stale || !r.ranked_at ? "rule order" : `ranked ${ago(r.ranked_at)}`;
  return (
    <span className="lead-ranked" title={r.error ?? "Rules decide what needs you; a model orders it and says why"}>
      {said}{!r.busy && <> · <button type="button" onClick={rerank}>Re-rank</button></>}
    </span>
  );
}
