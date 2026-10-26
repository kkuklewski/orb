import { useEffect, useState, type ReactNode } from "react";
import { useDelegations } from "../stores/delegation";
import { useFeatures } from "../stores/features";
import { needsCount, needsYou, useHome } from "../stores/home";
import { activityRows, dotClass, openSessions, runningRows, useViews, type View } from "../stores/views";
import {
  allSessions, archiveSession, archivedSessions, folderName, folderSessions, openFolder, openPicker, pinFolder, pinnedFolders, rel, removeSession, search, startSession,
  toggleProject, useSession, type Row,
} from "../stores/session";
import { SessionsAdjust, Siblings, usePanelKind } from "./Panel";
import { BrainAdjust, BrainSiblings } from "./Brain";
import { openBrain } from "../stores/brain";

// The rail of destinations, then the Panel (Panel.tsx): Sessions' adjustments, a session's siblings, nothing on Home;
// the screens not moved over yet keep the old panel: search, pinned repos (each unfolds to its sessions), recents.

const Icon = ({ d }: { d: ReactNode }) => (
  <span className="nav-ic"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{d}</svg></span>
);
const ICONS = {
  home: <><path d="M4 11l8-7 8 7" /><path d="M6 9.5V20h12V9.5" /></>,
  new: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  brain: <><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V6a2 2 0 0 0-3-2Z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1" /></>,
  chats: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  routines: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>,
};

const STATUS: Record<string, string> = { approval: "waiting for you", working: "running", done: "finished" };

const SvgIc = ({ d }: { d: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

export function SessionRow({ x, showFolder }: { x: Row; showFolder?: boolean }) {
  const current = useSession((s) => s.session);
  const [sure, setSure] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [menuSure, setMenuSure] = useState(false);
  const label = x.label || "New session";
  useEffect(() => {
    if (!menu) return;
    const close = () => { setMenu(null); setMenuSure(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); window.removeEventListener("keydown", esc); };
  }, [menu]);
  return (
    <div className={"session-wrap" + (sure ? " sure" : "")} onMouseLeave={() => setSure(false)}
      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      {menu && (
        <div className="ctx-menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { archiveSession(x.folder.path, x.key, !x.archived); setMenu(null); }}>{x.archived ? "Restore" : "Archive"}</button>
          <button type="button" role="menuitem" className="danger"
            onClick={() => { if (menuSure) { removeSession(x.folder.path, x.key); setMenu(null); } else setMenuSure(true); }}>{menuSure ? "Click again to remove" : "Remove"}</button>
        </div>
      )}
      <button type="button" className={"session" + (x.key === current ? " active" : "") + (x.status === "done" ? " unseen" : "")}
        title={`${label} · ${x.folder.label}${STATUS[x.status] ? " · " + STATUS[x.status] : ""}`}
        onClick={() => openFolder(x.folder.path, x.key)}>
        <span className={dotClass(x.status, x.live)} />
        <span className="slabel">{label}</span>
        <span className={showFolder ? "sfolder" : "when"}>{showFolder ? folderName(x.folder) : rel(x.last_used)}</span>
      </button>
      <span className="row-actions">
        {x.archived ? (
          <button type="button" className="row-btn" title="Restore" aria-label="Restore session" onClick={() => archiveSession(x.folder.path, x.key, false)}>
            <SvgIc d={<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>} />
          </button>
        ) : (
          <button type="button" className="row-btn" title="Archive" aria-label="Archive session" onClick={() => archiveSession(x.folder.path, x.key)}>
            <SvgIc d={<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8M10 12h4" /></>} />
          </button>
        )}
        {sure ? (
          <button type="button" className="row-btn danger" aria-label="Confirm remove" onClick={() => removeSession(x.folder.path, x.key)}>Remove?</button>
        ) : (
          <button type="button" className="row-btn" title="Remove" aria-label="Remove session" onClick={() => setSure(true)}>
            <SvgIc d={<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />} />
          </button>
        )}
      </span>
    </div>
  );
}

function showView(v: View) {
  const cur = useViews.getState().view;
  if (v === "sessions" && cur !== v) openSessions(); else useViews.setState({ view: cur === v && v !== "home" ? "home" : v });
  useSession.setState({ drawer: false });
}

/** Recents without repeats: one row per label in a folder (the newest; the list is newest first). A repeat
 *  that is open, running or the current session stays. */
export function recentRows<T extends { key: string; label?: string | null; live: boolean; folder: { path: string } }>(rows: T[], current: string | null): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.label || r.live || r.key === current) return true;
    const id = `${r.folder.path}\n${r.label.trim().toLowerCase()}`;
    return seen.has(id) ? false : (seen.add(id), true);
  });
}

export const RECENTS = 5;

/** The few Recents shown: approvals and running sessions first, then the newest; the rest live in Sessions. */
export function topRecents<T extends { status: string }>(rows: T[], n = RECENTS): T[] {
  const urgent = (r: T) => (r.status === "approval" ? 0 : r.status === "working" ? 1 : 2);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => urgent(a.r) - urgent(b.r) || a.i - b.i).slice(0, n).map((x) => x.r);
}

export function Sidebar() {
  const { features, folders } = useFeatures();
  const { folder, session, expanded, drawer } = useSession();
  const kind = usePanelKind();
  const view = useViews((s) => s.view);
  const plan = useHome((s) => s.plan);
  const [q, setQ] = useState("");

  // Two signals only: how many things need you (Home, the accent), and a quiet dot while a session runs or waits.
  const delegations = useDelegations((s) => s.items);
  const needs = needsCount(needsYou(folders, plan, delegations));
  const running = runningRows(activityRows(folders)).length > 0;
  const found = search(folders, q, session);
  const allRecent = recentRows(allSessions(folders, session), session);
  const recent = topRecents(allRecent);
  const archived = archivedSessions(folders);
  const [showArchived, setShowArchived] = useState(false);
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem("orb-panel") !== "closed"; } catch { return true; } });
  const togglePanel = () => { setPanel(!panel); try { localStorage.setItem("orb-panel", panel ? "closed" : "open"); } catch { /* per-viewer convenience only */ } };
  const pinned = pinnedFolders(folders);

  return (
    <aside className="sidebar" aria-label="Navigation">
      <nav className="rail" aria-label="Sections">
        <span className="rail-brand" aria-hidden="true">O</span>
        <button type="button" className="rail-toggle" hidden={kind === "none"} aria-pressed={panel} onClick={togglePanel} title="Show or hide the side panel" aria-label="Show or hide the side panel">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15" /></svg>
        </button>
        <button type="button" className={"nav-item" + (view === "home" ? " active" : "")} aria-current={view === "home" ? "page" : undefined} onClick={() => showView("home")}>
          <Icon d={ICONS.home} />Home
          {needs > 0 && <span className="nav-badge needs" title={`${needs} need${needs === 1 ? "s" : ""} you`}>{needs}</span>}
        </button>
        <button type="button" className={"nav-item" + (view === "sessions" ? " active" : "")} aria-current={view === "sessions" ? "page" : undefined} onClick={() => showView("sessions")}>
          <Icon d={ICONS.chats} />Sessions
          {running && <span className="nav-dot" role="img" aria-label="sessions running" />}
        </button>
        {features?.vault && (
          <button type="button" className={"nav-item" + (view === "brain" || view === "note" ? " active" : "")} aria-current={view === "brain" ? "page" : undefined} onClick={() => { openBrain(); useSession.setState({ drawer: false }); }}><Icon d={ICONS.brain} />Brain</button>
        )}
        <button type="button" className={"nav-item" + (view === "tasks" ? " active" : "")} aria-current={view === "tasks" ? "page" : undefined} onClick={() => showView("tasks")} title="Vikunja tasks"><Icon d={ICONS.tasks} />Tasks</button>
        {features?.routines && (
          <button type="button" className={"nav-item" + (view === "routines" ? " active" : "")} aria-current={view === "routines" ? "page" : undefined} onClick={() => showView("routines")}><Icon d={ICONS.routines} />Routines</button>
        )}
        <span className="rail-gap" />
        <button type="button" className={"nav-item" + (view === "settings" ? " active" : "")} aria-current={view === "settings" ? "page" : undefined} onClick={() => showView("settings")}><Icon d={ICONS.settings} />Settings</button>
      </nav>
      {kind !== "none" && (
      <div className="side-panel" hidden={!panel} aria-label="Panel">
      {kind === "sessions" && (panel || drawer) && <SessionsAdjust />}
      {/* a new snapshot each time the panel opens, or the session's kind changes */}
      {kind === "siblings" && (panel || drawer) && <Siblings key={`${folder === features?.vault}:${drawer}`} />}
      {kind === "brain" && (panel || drawer) && <BrainAdjust />}
      {kind === "note" && (panel || drawer) && <BrainSiblings />}
      {kind === "legacy" && <>
      <div className="side-head"><span className="brand">Orb</span><button type="button" className="panel-new" onClick={() => openPicker("new")}><Icon d={ICONS.new} />New</button></div>
      <label className="search">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" placeholder="Search" aria-label="Search sessions and repos" autoComplete="off" spellCheck={false}
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
      </label>
      {q.trim() && (
        <div className="search-results">
          {found.sessions.length > 0 && <div className="res-head">Sessions</div>}
          {found.sessions.map((x) => <SessionRow key={x.key} x={x} showFolder />)}
          {found.folders.length > 0 && <div className="res-head">Folders</div>}
          {found.folders.map((f) => (
            <button key={f.path} type="button" className="session" onClick={() => { openFolder(f.path); setQ(""); }}>
              <span className={dotClass(f.status ?? "idle", !!f.live)} /><span className="slabel">{f.label}</span><span className="sfolder">{f.rel}</span>
            </button>
          ))}
          {!found.sessions.length && !found.folders.length && <div className="side-hint">Nothing found.</div>}
        </div>
      )}
      <div className="side-scroll">
        <section className="side-section" aria-label="Repos">
          <div className="sec-head"><span>Repos</span>
            <button type="button" className="icon-btn ghost sm" title="Pin a repo" aria-label="Pin a repo" onClick={() => openPicker("pin")}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
          {!pinned.length && <div className="side-hint">Pin the repos you use with +</div>}
          {pinned.map((f) => {
            const open = expanded.includes(f.path);
            return (
              <div key={f.path}>
                <button type="button" className={"project" + (f.path === folder ? " active" : "") + (f.status === "done" ? " unseen" : "")}
                  aria-expanded={open} title={`${f.label} · ${f.rel}${f.mcp_failed ? ` · ${f.mcp_failed} MCP server(s) failed` : ""}`}
                  onClick={() => toggleProject(f.path)}>
                  <span className={"chev" + (open ? " open" : "")}>›</span>
                  <span className="pname">{folderName(f)}</span>
                  <span className={dotClass(f.status ?? "idle", !!f.live) + (!f.status || f.status === "idle" ? " quiet" : "")} />
                </button>
                {open && (
                  <div className="sessions">
                    {folderSessions(f, session).map((x) => <SessionRow key={x.key} x={x} />)}
                    <div className="proj-actions">
                      <button type="button" className="session new" onClick={() => startSession(f.path)}>+ New session</button>
                      <button type="button" className="session new" onClick={() => pinFolder(f.path, false)}>Unpin repo</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </section>
        <section className="side-section" aria-label="Recents">
          <div className="sec-head"><span>Recents</span></div>
          {!recent.length && <div className="side-hint">Your conversations show up here.</div>}
          {recent.map((x) => <SessionRow key={x.key} x={x} showFolder />)}
          {allRecent.length > 0 && <button type="button" className="session new all-chats" onClick={() => { openSessions(); useSession.setState({ drawer: false }); }}>All sessions →</button>}
        </section>
        {archived.length > 0 && (
          <section className="side-section" aria-label="Archived">
            <button type="button" className="sec-head sec-toggle" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
              <span>Archived · {archived.length}</span><span className={"chev" + (showArchived ? " open" : "")}>›</span>
            </button>
            {showArchived && archived.map((x) => <SessionRow key={x.key} x={x} showFolder />)}
          </section>
        )}
      </div>
      </>}
      <div className="side-foot">
        <span className="avatar">C</span>
        <span className="who">Claude {features?.plan && <span className="plan">· {features.plan[0].toUpperCase() + features.plan.slice(1)}</span>}</span>
      </div>
      </div>
      )}
    </aside>
  );
}
