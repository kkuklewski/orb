// The Sessions list and a session's siblings, grouped by state (ADR 0002, GLOSSARY.md Sessions, Finished): Waiting,
// Running, Finished, Earlier. Where a row sits is snapshotted when the list or panel opens, so a session that changes
// state only changes its word; it moves group the next time the owner comes back. The Home chat's vault sessions are
// never listed. The adjustments (repo filter, Group by repo, search) live in the Panel and are kept here.
import { create } from "zustand";
import type { FolderItem } from "../protocol.gen";
import { allSessions, folderName, type Row } from "./session";

export type Group = "waiting" | "running" | "finished" | "earlier";
export const GROUPS: Group[] = ["waiting", "running", "finished", "earlier"];
export const GROUP_TITLE: Record<Group, string> = { waiting: "Waiting", running: "Running", finished: "Finished", earlier: "Earlier" };
export const EARLIER_SHOWN = 20; // past this, Earlier is behind "show older"

export const groupOf = (status: string): Group =>
  status === "approval" ? "waiting" : status === "working" ? "running" : status === "done" ? "finished" : "earlier";

/** The state word on a row: it follows the session live, while its group stays put. */
export function stateWord(x: { status: string; live: boolean; opus?: unknown }): string {
  if (x.status === "approval") return "waiting";
  if (x.status === "working") return x.opus ? "Opus running" : "running";
  if (x.status === "done") return "finished";
  return x.live ? "open" : "";
}

export type ListRow = Row & { count: number };

/** Every session but the vault's, newest first, one row per first request in a repo (the newest; `count` says how
 *  many). A repeat that is open, running or the current session keeps its own row. */
export function listRows(folders: FolderItem[], vault: string | null | undefined, current: string | null): ListRow[] {
  const seen = new Map<string, ListRow>();
  const out: ListRow[] = [];
  for (const r of allSessions(folders.filter((f) => !vault || f.path !== vault), current)) {
    const id = r.label ? `${r.folder.path}\n${r.label.trim().toLowerCase()}` : null;
    const first = id ? seen.get(id) : undefined;
    if (first && !r.live && r.key !== current && r.status === "idle") { first.count++; continue; }
    const row = { ...r, count: 1 };
    if (id && !first) seen.set(id, row);
    out.push(row);
  }
  return out;
}

export type Snapshot = Map<string, { group: Group; at: number }>;

export function snapshot(rows: { key: string; status: string }[]): Snapshot {
  return new Map(rows.map((r, at) => [r.key, { group: groupOf(r.status), at }]));
}

/** Rows into the four groups, in the snapshot's places; a row the snapshot hasn't seen goes by its state, after the
 *  others. Empty groups are left out. */
export function byState<T extends { key: string; status: string }>(rows: T[], snap: Snapshot): { group: Group; rows: T[] }[] {
  const place = (r: T, i: number) => snap.get(r.key) ?? { group: groupOf(r.status), at: snap.size + i };
  const placed = rows.map((r, i) => ({ r, p: place(r, i) })).sort((a, b) => a.p.at - b.p.at);
  return GROUPS.map((group) => ({ group, rows: placed.filter((x) => x.p.group === group).map((x) => x.r) })).filter((g) => g.rows.length > 0);
}

/** Group by repo instead: repos in the order of their first row. */
export function byRepo<T extends { key: string; folder: FolderItem }>(rows: T[], snap: Snapshot): { folder: FolderItem; rows: T[] }[] {
  const order = (r: T, i: number) => snap.get(r.key)?.at ?? snap.size + i;
  const sorted = rows.map((r, i) => ({ r, at: order(r, i) })).sort((a, b) => a.at - b.at).map((x) => x.r);
  const by = new Map<string, { folder: FolderItem; rows: T[] }>();
  for (const r of sorted) {
    const g = by.get(r.folder.path) ?? { folder: r.folder, rows: [] };
    g.rows.push(r);
    by.set(r.folder.path, g);
  }
  return [...by.values()];
}

export interface Adjustments { repos: string[]; byRepo: boolean; q: string }
export const useSessionsList = create<Adjustments>(() => ({ repos: [], byRepo: false, q: "" }));

/** The repo filter's choices: every repo with a listed session, by name. */
export function repoChoices(rows: Row[]): FolderItem[] {
  const by = new Map<string, FolderItem>();
  for (const r of rows) by.set(r.folder.path, r.folder);
  return [...by.values()].sort((a, b) => folderName(a).localeCompare(folderName(b)));
}

/** The adjustments applied: the repo filter (none ticked: all) and the search on the request and the repo's name. */
export function adjust<T extends Row>(rows: T[], a: Pick<Adjustments, "repos" | "q">): T[] {
  const needle = a.q.trim().toLowerCase();
  return rows.filter((r) => (!a.repos.length || a.repos.includes(r.folder.path))
    && (!needle || `${r.label ?? ""} ${r.folder.label}`.toLowerCase().includes(needle)));
}

export function toggleRepo(path: string) {
  const { repos } = useSessionsList.getState();
  useSessionsList.setState({ repos: repos.includes(path) ? repos.filter((p) => p !== path) : [...repos, path] });
}
