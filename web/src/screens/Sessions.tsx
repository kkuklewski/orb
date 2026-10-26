import { useState, type ReactNode } from "react";
import { useFeatures } from "../stores/features";
import { folderName, openFolder, rel, useSession } from "../stores/session";
import { dotClass, openSessions, useViews } from "../stores/views";
import {
  EARLIER_SHOWN, GROUP_TITLE, adjust, groupOf, byRepo, byState, listRows, snapshot, stateWord, useSessionsList, type ListRow, type Snapshot,
} from "../stores/sessionsList";

/** One session: "repo · first request · when", with its state word (live) and dot. */
export function SessionLine({ x, current }: { x: ListRow; current: string | null }) {
  const word = stateWord(x);
  return (
    <button type="button" className={`act-row chats-row ${x.status}` + (x.key === current ? " active" : "")} onClick={() => openFolder(x.folder.path, x.key)}
      aria-current={x.key === current ? "page" : undefined}>
      <span className={dotClass(x.status, x.live)} />
      <span className="act-label chats-label">
        <span className="chats-repo-label mono">{folderName(x.folder)}</span> · {x.label || "New session"}
        {x.count > 1 && <span className="chats-count mono" title={`${x.count} sessions with this request`}>×{x.count}</span>}
      </span>
      <span className="act-time mono">{rel(x.last_used) || "--"}</span>
      <span className="act-status mono">{word}</span>
    </button>
  );
}

/** Rows grouped by state in the snapshot's places; Earlier past 20 rows behind "show older". */
export function StateGroups({ rows, snap, current, row }: { rows: ListRow[]; snap: Snapshot; current: string | null; row?: (x: ListRow) => ReactNode }) {
  const [older, setOlder] = useState(false);
  return <>{byState(rows, snap).map((g) => {
    const cut = g.group === "earlier" && !older && g.rows.length > EARLIER_SHOWN;
    return (
      <section key={g.group} className="chats-group" aria-label={GROUP_TITLE[g.group]}>
        <h3 className="chats-repo">{GROUP_TITLE[g.group]}<span className="mono">{g.rows.length}</span></h3>
        {(cut ? g.rows.slice(0, EARLIER_SHOWN) : g.rows).map((x) => row ? row(x) : <SessionLine key={x.key} x={x} current={current} />)}
        {cut && <button type="button" className="session new show-older" onClick={() => setOlder(true)}>Show older ({g.rows.length - EARLIER_SHOWN})</button>}
      </section>
    );
  })}</>;
}

/** Every session but the Home chat's, grouped by state (or by repo); its adjustments are in the Panel. Where a row sits
 *  is fixed while the list is open. "Running now" on Home opens it showing only Waiting and Running. */
export function Sessions() {
  const folders = useFeatures((s) => s.folders);
  const vault = useFeatures((s) => s.features?.vault);
  const current = useSession((s) => s.session);
  const running = useViews((s) => s.running);
  const a = useSessionsList();
  const rows = listRows(folders, vault, current);
  const [snap] = useState(() => snapshot(rows));
  let shown = adjust(rows, a);
  if (running) shown = shown.filter((r) => ["waiting", "running"].includes(snap.get(r.key)?.group ?? groupOf(r.status)));
  const filtered = a.q.trim() || a.repos.length > 0;
  return (
    <div className="view-col">
      <div className="view-head"><h2>Sessions</h2><span className="mono view-sub">{running ? "running or waiting for you" : a.byRepo ? "by repo" : "by state"}</span></div>
      {running && (
        <div className="sessions-filter mono">
          <span>Running now</span>
          <button type="button" onClick={() => openSessions(false)} aria-label="Show all sessions">All sessions ✕</button>
        </div>
      )}
      {shown.length === 0 && <div className="side-hint">{filtered ? "Nothing found." : running ? "Nothing running or waiting for you." : "Your sessions show up here."}</div>}
      {a.byRepo
        ? byRepo(shown, snap).map((g) => (
          <section key={g.folder.path} className="chats-group" aria-label={folderName(g.folder)}>
            <h3 className="chats-repo">{folderName(g.folder)}<span className="mono">{g.rows.length}</span></h3>
            {g.rows.map((x) => <SessionLine key={x.key} x={x} current={current} />)}
          </section>
        ))
        : <StateGroups rows={shown} snap={snap} current={current} />}
    </div>
  );
}
