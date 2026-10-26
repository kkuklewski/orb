import { useState } from "react";
import { useFeatures } from "../stores/features";
import { folderName, openPicker, useSession } from "../stores/session";
import { useViews, type View } from "../stores/views";
import { listRows, repoChoices, snapshot, toggleRepo, useSessionsList } from "../stores/sessionsList";
import { StateGroups } from "./Sessions";
import { SessionRow } from "./Sidebar";

// The Panel (ADR 0002): the second level, next to the rail, showing what the main area doesn't. On a list it holds the
// list's adjustments, on an item the item's siblings; Home has none. Screens not moved over yet keep the old panel
// (repos, recents, archived) until their own tickets give them one.

export type PanelKind = "none" | "sessions" | "siblings" | "brain" | "note" | "legacy";

export function panelKind(v: View, folder: string | null): PanelKind {
  if (v === "home") return "none";
  if (v === "sessions") return "sessions";
  if (v === "brain" || v === "note") return v;
  if (v === "chat") return folder ? "siblings" : "legacy";
  return "legacy";
}

export function usePanelKind(): PanelKind {
  const view = useViews((s) => s.view);
  const folder = useSession((s) => s.folder);
  return panelKind(view, folder);
}

/** Sessions' adjustments: search, Group by repo, the repo filter, and New session. */
export function SessionsAdjust() {
  const folders = useFeatures((s) => s.folders);
  const vault = useFeatures((s) => s.features?.vault);
  const current = useSession((s) => s.session);
  const { repos, byRepo, q } = useSessionsList();
  const choices = repoChoices(listRows(folders, vault, current));
  return (
    <div className="panel-body" aria-label="Adjust the list">
      <div className="side-head"><span className="brand">Sessions</span><button type="button" className="panel-new" onClick={() => openPicker("new")}>+ New session</button></div>
      <label className="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" placeholder="Search sessions" aria-label="Search sessions" autoComplete="off" spellCheck={false}
          value={q} onChange={(e) => useSessionsList.setState({ q: e.target.value })} onKeyDown={(e) => { if (e.key === "Escape") useSessionsList.setState({ q: "" }); }} />
      </label>
      <button type="button" className="panel-toggle" aria-pressed={byRepo} onClick={() => useSessionsList.setState({ byRepo: !byRepo })}>
        <span className="panel-check" aria-hidden="true">{byRepo ? "✓" : ""}</span>Group by repo
      </button>
      <fieldset className="panel-repos">
        <legend className="sec-head"><span>Repos</span>{repos.length > 0 && <button type="button" className="row-btn" onClick={() => useSessionsList.setState({ repos: [] })}>All</button>}</legend>
        {choices.map((f) => (
          <label key={f.path} className="panel-repo">
            <input type="checkbox" checked={repos.includes(f.path)} onChange={() => toggleRepo(f.path)} />
            <span>{folderName(f)}</span>
          </label>
        ))}
        {!choices.length && <div className="side-hint">No sessions yet.</div>}
      </fieldset>
    </div>
  );
}

/** A session's siblings, grouped by state with the repo as a label, in places fixed while the panel is open. The
 *  Home chat's sessions are siblings only of each other. */
export function Siblings() {
  const folders = useFeatures((s) => s.folders);
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const { folder, session } = useSession();
  const inVault = !!vault && folder === vault;
  const rows = inVault
    ? listRows(folders.filter((f) => f.path === vault), null, session)
    : listRows(folders, vault, session);
  const [snap] = useState(() => snapshot(rows));
  return (
    <div className="panel-body side-scroll" aria-label="Sessions">
      <div className="side-head"><span className="brand">{inVault ? "Home chat" : "Sessions"}</span><button type="button" className="panel-new" onClick={() => openPicker("new")}>+ New</button></div>
      <StateGroups rows={rows} snap={snap} current={session} row={(x) => <SessionRow key={x.key} x={x} showFolder={!inVault} />} />
    </div>
  );
}
