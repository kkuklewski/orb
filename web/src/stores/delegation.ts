// Delegations (ADR 0003-0005): a Vikunja task handed to a background session in its own worktree. Delegate asks the
// server for the grant card; Allow starts it; the Delegated strip on Home shows each one's stage line (server:
// delegation.py), with Review, Apply (after an inline confirm), Undo, Discard, and the outward card (push and a PR, after
// the tests passed). The server decides every stage.
import { create } from "zustand";
import type { ClientMessage, DelegateCardEvent, DelegationDiffEvent, DelegationItem } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";

type State = {
  items: DelegationItem[];
  card: DelegateCardEvent | null;
  diff: DelegationDiffEvent | null;
  picking: string | null;  // a task without a mapped repo: its id, while the repo picker is open
  confirming: string | null;  // the row whose Apply card is open
  waiting: boolean;  // a request is out; an error that comes back is ours
  error: string | null;
};

export const initialDelegations = (): State => ({ items: [], card: null, diff: null, picking: null, confirming: null, waiting: false, error: null });
export const useDelegations = create<State>(initialDelegations);

const ask = (m: ClientMessage) => { useDelegations.setState({ waiting: true, error: null }); send(m); };

export function wireDelegations(): () => void {
  const offs = [
    on("delegations", (ev) => useDelegations.setState((s) => ({
      items: ev.items, waiting: false,
      confirming: ev.items.some((x) => x.id === s.confirming && x.stage === "ready") ? s.confirming : null,
      diff: ev.items.some((x) => x.id === s.diff?.id) ? s.diff : null,
    }))),
    on("delegate_card", (ev) => useDelegations.setState({ card: ev, picking: null, waiting: false })),
    on("delegation_diff", (ev) => useDelegations.setState({ diff: ev, waiting: false })),
    on("notice", () => useDelegations.setState({ waiting: false })),  // bulk Delegate names the tasks it skipped
    on("error", (ev) => { if (useDelegations.getState().waiting) useDelegations.setState({ error: ev.text, waiting: false }); }),
  ];
  return () => offs.forEach((off) => off());
}

/** Delegate a Vikunja task: with its repo mapped, the grant card; without, the repo picker first (`path` from it). */
export function delegate(task: string | number, path?: string) {
  useDelegations.setState({ picking: null });
  ask({ type: "delegate", task: Number(task), path: path ?? null });
}

/** Bulk Delegate (Up next): tasks with a known repo; one grant card per repo comes back, one after another. */
export const delegateBulk = (tasks: (string | number)[]) => ask({ type: "delegate_bulk", tasks: tasks.map(Number) });

export const pickRepo = (task: string | null) => useDelegations.setState({ picking: task, error: null });

export function confirmDelegate(ok: boolean) {
  const card = useDelegations.getState().card;
  if (!card) return;
  useDelegations.setState({ card: null });
  ask({ type: "delegate_confirm", id: card.id, ok });
}

export const review = (id: string) => ask({ type: "delegation_review", id });
export const closeDiff = () => useDelegations.setState({ diff: null });
export const askApply = (id: string | null) => useDelegations.setState({ confirming: id });
export function apply(id: string) {
  useDelegations.setState({ confirming: null });
  ask({ type: "delegation_apply", id });
}
export const revert = (id: string) => ask({ type: "delegation_revert", id });
/** Failed or stuck: the same session gets what went wrong as its next request. */
export const retry = (id: string) => ask({ type: "delegation_retry", id });
/** Stopped by restart: the same session carries on in its worktree. Nothing resumes without this tap. */
export const resume = (id: string) => ask({ type: "delegation_resume", id });
export const discard = (id: string) => ask({ type: "delegation_discard", id });
/** Ready with push and its PR waiting (Needs you): Allow pushes the branch and opens the PR; Skip keeps it local. */
export const outward = (id: string, allow: boolean) => ask({ type: "delegation_outward", id, allow });
export const update = (id: string) => ask({ type: "delegation_update", id });
/** A PR closed on the remote without merging: reopens it there (gh pr reopen); polling resumes. */
export const reopen = (id: string) => ask({ type: "delegation_reopen", id });
