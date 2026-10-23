import { folderName, newSession, useSession } from "../stores/session";
import { FRONT_TITLE, contextView, cycleMode, mcpRows, metaLine, reconnectMcp, toggleMcp, toggleModel, usageView, useMeta } from "../stores/meta";
import { useVoice } from "../stores/voice";
import { toggleMute } from "../voice/controller";
import { Player } from "../voice/player";

// Where you are, then the session's facts and switches: plan usage left, context, MCP, front model,
// approvals mode, New session, mute.

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

export function TopBar() {
  const { folder, label, rel, branch } = useSession();
  const { info, front, mode, sessionId } = useMeta();
  const muted = useVoice((s) => s.muted);
  const failed = info.mcp_failed ?? 0;
  return (
    <header className="top">
      <button type="button" className="icon-btn ghost open-side" aria-label="Open the sidebar" onClick={() => useSession.setState({ drawer: true })}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="where">
        <div className="where-name" title={folder ? `${label} · ${rel}` : undefined}>{folder ? folderName({ label }) : "No repo open"}</div>
        <div className="where-meta mono">{folder ? metaLine(branch, sessionId, info.model) : "pick one to start"}</div>
      </div>
      <div className="top-tools">
        <Usage />
        {folder && <Context />}
        {folder && info.mcp_total != null && (
          <button type="button" className={"chip-btn mono mcp-chip" + (failed ? " bad" : "")} onClick={toggleMcp}
            title={failed ? `${failed} of ${info.mcp_total} MCP servers failed. Click for details and reconnect.` : `${info.mcp_total} MCP servers; none failed. Click for details.`}>
            {failed ? `MCP ● ${failed} failed` : "MCP ●"}
          </button>
        )}
        {folder && (
          <button type="button" className={"chip-btn mono mode-chip model-chip" + (front === "opus" ? " opus" : front === "haiku" ? " haiku" : "")} onClick={toggleModel} aria-label={`model: ${front}`}
            title={FRONT_TITLE[front]}>
            <span className="chip-key">model: </span>{front}
          </button>
        )}
        {folder && (
          <button type="button" className={"chip-btn mono mode-chip " + mode} onClick={cycleMode} aria-label={`approvals: ${mode}`} title={MODE_TITLE[mode] ?? mode}><span className="chip-key">approvals: </span>{mode}</button>
        )}
        {folder && (
          <button type="button" className="chip-btn new-session" title="Start a fresh session in this folder" onClick={() => { Player.stop(); newSession(); }}>New session</button>
        )}
        <button type="button" className="icon-btn" aria-pressed={muted} aria-label="Mute speech" title="Mute speech (M)" onClick={toggleMute}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4ZM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6Z" /></svg>
          <span className="slash" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
