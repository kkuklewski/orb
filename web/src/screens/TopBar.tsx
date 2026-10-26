import { useEffect, useState } from "react";
import { folderName, newSession, useSession } from "../stores/session";
import { FRONT_TITLE, contextView, cycleMode, mcpRows, metaLine, reconnectMcp, toggleMcp, toggleModel, usageView, useMeta } from "../stores/meta";
import { openSessions, useViews } from "../stores/views";
import { toggleDock } from "../stores/dock";
import { useDockShown } from "./HomeDock";
import { useFeatures } from "../stores/features";
import { openItems, useItems } from "../stores/items";
import { useTasks } from "../stores/tasks";
import { useRoutineScreen } from "../stores/routine";
import { openBrain, useBrain } from "../stores/brain";
import { DESTINATION, barFor, type BarInput, type Destination } from "../stores/bar";
import { useVoice } from "../stores/voice";
import { useChat } from "../stores/chat";
import { toggleMute } from "../voice/controller";
import { Player } from "../voice/player";
import { BargeButton } from "./Voice";
import { usePanelKind } from "./Panel";

// Where you are ("destination › item"), then plan usage and mute on every screen; on a session also its facts and
// switches (context, MCP, front model, approvals mode, New session); on Brain, Tasks and Routines the Home chat chip.
// Narrow (iPad portrait, phones): only the item, with a back arrow to its list.

const MODE_TITLE: Record<string, string> = {
  auto: "Auto: Claude Code decides what is safe; cards only for what it escalates. Click for plan.",
  plan: "Plan: Claude only reads and plans; it asks you to approve the plan before changing anything. Click for default.",
  default: "Default: a card for every tool that needs permission. Click for auto (like your terminal).",
};

function Usage() {
  const { windows, overage, usageAt } = useMeta();
  const u = usageView(windows, overage, usageAt);
  if (!u) return null;
  return (
    <div className="usage mono" title={u.title}>
      <div className="u-top">
        {u.parts.map((p, i) => (
          <span key={p.name}>
            {i > 0 && <span className="u-sep">·</span>}
            <span className={"u-part " + p.level}>{p.name} <b>{p.left == null ? "–" : `${Math.round(p.left * 100)}%`}</b> left</span>
          </span>
        ))}
      </div>
      <div className="u-sub">{u.sub}</div>
    </div>
  );
}

function Context() {
  const c = contextView(useMeta((s) => s.info.context));
  if (!c) return null;
  return (
    <div className={"ctx mono" + (c.level ? " " + c.level : "")} title={c.title}>
      <div className="u-top">Context <b>{c.pct}%</b> full</div>
      <div className="u-sub">this session</div>
    </div>
  );
}

export function McpPanel() {
  const { mcp, mcpOpen } = useMeta();
  if (!mcpOpen) return null;
  return (
    <div className="mcp-panel" role="dialog" aria-label="MCP servers">
      <div className="mcp-head mono">MCP servers in this session</div>
      {!mcp && <div className="mcp-row mono">checking MCP servers…</div>}
      {mcp && mcpRows(mcp).map((x) => (
        <div key={x.name ?? ""} className="mcp-row" title={x.error ?? undefined}>
          <span className={"mcp-dot " + (x.status ?? "")} />
          <span className="mcp-name">{(x.name ?? "").replace(/^claude\.ai /, "")}</span>
          <span className="mcp-st mono">{x.status}{x.tools ? ` · ${x.tools} tools` : ""}</span>
          {x.status === "failed" && x.name && (
            <button type="button" className="chip-btn" onClick={(e) => { e.currentTarget.textContent = "…"; reconnectMcp(x.name!); }}>Reconnect</button>
          )}
        </div>
      ))}
    </div>
  );
}

const NARROW = "(max-width: 900px)"; // shell.css: the rail turns into the bottom bar

function useNarrow() {
  const [on, setOn] = useState(() => window.matchMedia?.(NARROW).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(NARROW);
    if (!m) return;
    const f = () => setOn(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return on;
}

/** Tapping the destination: back to its list (the list the item came from, for Brain's two). */
function openList(dest: Destination, s: BarInput) {
  if (dest === "tasks") return useViews.setState({ view: "tasks" });
  if (dest === "sessions") return openSessions();
  if (dest === "brain") {
    if ((s.view === "items" || s.view === "item") && s.items) return openItems(s.items.source);
    if (s.view === "task") return openItems("tasks");
    return openBrain();
  }
  useViews.setState({ view: dest });
}

function useBarInput(): BarInput {
  const view = useViews((s) => s.view);
  const { folder, label: repo, session } = useSession();
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const label = useFeatures((s) => s.folders.flatMap((f) => f.sessions ?? []).find((x) => x.key === session)?.label ?? null);
  const { source, id, item, lists } = useItems();
  const title = item && item.source === source && item.id === id ? item.title : lists[source!]?.rows.find((r) => r.id === id)?.title ?? null;
  const task = useTasks((s) => s.detail?.title ?? null);
  const routineId = useRoutineScreen((s) => s.id);
  const routine = useViews((s) => s.routines?.items.find((x) => x.id === routineId)?.name ?? routineId);
  const note = useBrain((s) => s.note?.title ?? s.list?.notes.find((n) => n.file === s.file)?.title ?? s.file);
  return {
    view, folder, vault, repo: folderName({ label: repo }), label,
    items: source ? { source, id, title } : null, task, routine, note,
  };
}

export function TopBar() {
  const { label, rel, branch } = useSession();
  const { info, front, mode, sessionId } = useMeta();
  const muted = useVoice((s) => s.muted);
  const failed = info.mcp_failed ?? 0;
  const input = useBarInput();
  const bar = barFor(input);
  const kind = usePanelKind();
  const docked = useDockShown();
  const narrow = useNarrow();
  const back = narrow && bar.item != null;
  const session = bar.session;
  const fresh = useChat((s) => s.items.length === 0); // the start page has the model and approvals menus
  const dest = DESTINATION[bar.dest];
  return (
    <header className="top">
      <button type="button" className="icon-btn ghost open-side" aria-label="Open the panel" hidden={kind === "none"} onClick={() => useSession.setState({ drawer: true })}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="where">
        {back && (
          <button type="button" className="icon-btn ghost where-back" aria-label={`Back to ${dest}`} onClick={() => openList(bar.dest, input)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
        )}
        <div className="where-text">
          <div className="where-name" aria-label="You are here" title={session ? `${label} · ${rel}` : undefined}>
            {!back && <button type="button" className="where-dest" onClick={() => openList(bar.dest, input)}>{dest}</button>}
            {bar.item != null && <>{!back && <span className="where-sep" aria-hidden="true"> › </span>}<span className="where-item">{bar.item}</span></>}
          </div>
          {session && <div className="where-meta mono">{metaLine(branch, sessionId, info.model)}</div>}
        </div>
      </div>
      <div className="top-tools">
        <Usage />
        {session && <Context />}
        {session && info.mcp_total != null && (
          <button type="button" className={"chip-btn mono mcp-chip" + (failed ? " bad" : "")} onClick={toggleMcp}
            title={failed ? `${failed} of ${info.mcp_total} MCP servers failed. Click for details and reconnect.` : `${info.mcp_total} MCP servers; none failed. Click for details.`}>
            {failed ? `MCP ● ${failed} failed` : "MCP ●"}
          </button>
        )}
        {session && !fresh && (
          <button type="button" className={"chip-btn mono mode-chip model-chip" + (front === "opus" ? " opus" : front === "haiku" ? " haiku" : "")} onClick={toggleModel} aria-label={`model: ${front}`}
            title={FRONT_TITLE[front]}>
            <span className="chip-key">model: </span>{front}
          </button>
        )}
        {session && !fresh && (
          <button type="button" className={"chip-btn mono mode-chip " + mode} onClick={cycleMode} aria-label={`approvals: ${mode}`} title={MODE_TITLE[mode] ?? mode}><span className="chip-key">approvals: </span>{mode}</button>
        )}
        {bar.homeChat && (
          <button type="button" className="chip-btn mono home-chat-chip" aria-pressed={docked} onClick={toggleDock} title="Show the Home chat beside this screen">Home chat</button>
        )}
        {session && (
          <button type="button" className="chip-btn new-session" title="Start a fresh session in this folder" onClick={() => { Player.stop(); newSession(); }}>New session</button>
        )}
        <BargeButton />
        <button type="button" className="icon-btn" aria-pressed={muted} aria-label="Mute speech" title="Mute speech (M)" onClick={toggleMute}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" /></svg>
          <span className="slash" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
