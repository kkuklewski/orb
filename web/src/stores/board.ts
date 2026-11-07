import type { DelegationItem, EmailRow, PlanEvent, PlanItem } from "../protocol.gen";
import type { SessionRow } from "./views";

// Home's Board (the Kanban look, GLOSSARY: Board): every action Home knows of, in four columns. Pure: the page's
// stores in, cards out; HomeBoard draws them and wires the buttons. Nothing here decides anything new: the server's
// plan (needs.py) and the session and delegation lists already say what is waiting, and the board only sorts them.
//   To do        the plan's Needs you rows (setup, vault, routines, reminders, overdue tasks), the Email card's rows,
//                and the queue's tasks (Vikunja and the notes), Up next and past it
//   In progress  sessions waiting for your OK or working, queue items you started today, delegations on their way
//   Review       the queue's results, pull requests and notes batches, delegations Ready to apply
//   Done         what you marked done today (the server keeps the row as it was), delegations applied or merged
// Each card names its project (cardProject); the filter above the columns keeps one project's cards (filterBoard).

export type ColumnId = "todo" | "doing" | "review" | "done";
export const COLUMNS: { id: ColumnId; name: string }[] = [
  { id: "todo", name: "To do" }, { id: "doing", name: "In progress" }, { id: "review", name: "Review" }, { id: "done", name: "Done" },
];

export type BoardCard =
  | { type: "need"; key: string; item: PlanItem }  // a Needs you row from the plan
  | { type: "plan"; key: string; item: PlanItem; started?: boolean }  // a queue item (To do, Review) or one started today
  | { type: "done"; key: string; item: PlanItem }  // marked done today
  | { type: "session"; key: string; row: SessionRow }  // waiting for your OK, or working
  | { type: "deleg"; key: string; d: DelegationItem }
  | { type: "email"; key: string; e: EmailRow };

export type Board = Record<ColumnId, BoardCard[]>;

const REVIEW_KINDS = new Set<PlanItem["kind"]>(["result", "results_old", "pr", "notes_batch", "notopic"]);
const DELEG_DOING = new Set<DelegationItem["stage"]>(["queued", "working", "testing", "pushing", "failed", "stopped"]);
const DELEG_DONE = new Set<DelegationItem["stage"]>(["applied", "merged", "reverted"]);

export interface BoardInput {
  plan: PlanEvent | null;
  sessions: SessionRow[];  // activityRows: approval / working ones go to In progress
  delegations: DelegationItem[];  // all of them, not only the ones that need you
  emails: EmailRow[];
}

/** The four columns. Each item shows once: a key seen in an earlier place is skipped (Needs you before the queue, a
 *  delegation before its own session). Order inside a column is the order each source already has. */
export function boardColumns({ plan, sessions, delegations, emails }: BoardInput): Board {
  const b: Board = { todo: [], doing: [], review: [], done: [] };
  const seen = new Set<string>();
  const put = (col: ColumnId, c: BoardCard) => { if (!seen.has(c.key)) { seen.add(c.key); b[col].push(c); } };
  const own = new Set(delegations.map((d) => d.session));  // a delegation's session is the delegation's card

  for (const p of plan?.needs_you ?? []) put("todo", { type: "need", key: p.key, item: p });
  for (const e of emails) put("todo", { type: "email", key: `email:${e.run}:${e.key}`, e });
  for (const r of sessions) if (r.status === "approval" && !own.has(r.key)) put("doing", { type: "session", key: `session:${r.key}`, row: r });
  for (const d of delegations) if (DELEG_DOING.has(d.stage)) put("doing", { type: "deleg", key: `deleg:${d.id}`, d });
  for (const p of plan?.started ?? []) put("doing", { type: "plan", key: p.key, item: p, started: true });
  for (const r of sessions) if (r.status === "working" && !own.has(r.key)) put("doing", { type: "session", key: `session:${r.key}`, row: r });

  const queue = [...(plan?.next ? [plan.next] : []), ...(plan?.up_next ?? []), ...(plan?.more ?? [])];
  for (const p of queue) put(REVIEW_KINDS.has(p.kind) ? "review" : "todo", { type: "plan", key: p.key, item: p });
  for (const d of delegations) if (d.stage === "ready") put("review", { type: "deleg", key: `deleg:${d.id}`, d });

  for (const p of plan?.done ?? []) put("done", { type: "done", key: `done:${p.key}`, item: p });
  for (const d of delegations) if (DELEG_DONE.has(d.stage)) put("done", { type: "deleg", key: `deleg:${d.id}`, d });
  return b;
}

const last = (s: string | null | undefined) => (s ? s.split("/").pop() || s : null);
const PROJECT_KINDS = new Set<PlanItem["kind"]>(["task", "pr", "result"]);  // source = the repo (pr, result) or the tracker's project (task)

/** The project a card belongs to, as the bottom-right label and the filter say it: the repo's name (a task mapped to a
 *  repo, a pull request, a finished session, a session, a delegation), else a task's tracker project. Setup, vault,
 *  routines, reminders, notes, note tasks and email rows belong to none (null). */
export function cardProject(c: BoardCard): string | null {
  switch (c.type) {
    case "need": case "plan": case "done": {
      const p = c.item;
      return PROJECT_KINDS.has(p.kind) ? last(p.repo) ?? last(p.source) : null;
    }
    case "session": return last(c.row.folder.label);
    case "deleg": return last(c.d.repo);
    case "email": return null;
  }
}

export const NO_PROJECT = "";  // the filter's "Other": cards that belong to no project

/** The projects on the board, A to Z, with how many cards each has; `other` counts the cards with no project. */
export function boardProjects(b: Board): { projects: { name: string; count: number }[]; other: number; total: number } {
  const n = new Map<string, number>();
  let other = 0, total = 0;
  for (const col of COLUMNS) for (const c of b[col.id]) {
    total++;
    const p = cardProject(c);
    if (p === null) other++;
    else n.set(p, (n.get(p) ?? 0) + 1);
  }
  const projects = [...n].map(([name, count]) => ({ name, count })).sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
  return { projects, other, total };
}

/** Only the cards of one project (NO_PROJECT: the ones with none); null keeps them all. */
export function filterBoard(b: Board, project: string | null): Board {
  if (project === null) return b;
  const keep = (c: BoardCard) => (cardProject(c) ?? NO_PROJECT) === project;
  return { todo: b.todo.filter(keep), doing: b.doing.filter(keep), review: b.review.filter(keep), done: b.done.filter(keep) };
}

const PROJECT_KEY = "orb.boardProject";

/** The project this browser last filtered the Board by (null = all). */
export function savedProject(): string | null {
  try { return localStorage.getItem(PROJECT_KEY); } catch { return null; }
}
export function saveProject(p: string | null) {
  try { if (p === null) localStorage.removeItem(PROJECT_KEY); else localStorage.setItem(PROJECT_KEY, p); } catch { /* private window */ }
}

/** A note task's id is "<file>:<line>" (needs.py); the file may hold colons, the line never does. */
export function noteRef(id: string): { file: string; line: number } | null {
  const at = id.lastIndexOf(":");
  const line = Number(id.slice(at + 1));
  return at > 0 && Number.isInteger(line) ? { file: id.slice(0, at), line } : null;
}

const VIEW_KEY = "orb.homeView";
export type HomeView = "focus" | "board";

/** The Home look this browser last picked (Focus by default); a private window forgets it. */
export function savedView(): HomeView {
  try { return localStorage.getItem(VIEW_KEY) === "board" ? "board" : "focus"; } catch { return "focus"; }
}
export function saveView(v: HomeView) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window: the choice lasts for this visit */ }
}
