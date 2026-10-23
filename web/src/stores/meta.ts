// The open session's top-bar facts: front model, approvals mode, Claude Code's model, context use,
// plan usage left, MCP servers. Pure view helpers are exported for tests.
import { create } from "zustand";
import type { ContextUsage, McpServer, ServerEvent, SessionInfo, UsageWindow } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useSession } from "./session";

export interface MetaState {
  info: SessionInfo;
  front: string; // sonnet | opus: who answers in this folder
  mode: string; // default | auto | plan
  sessionId: string | null;
  windows: Record<string, UsageWindow> | null;
  overage: boolean;
  usageAt: number | null; // ms
  mcp: McpServer[] | null;
  mcpOpen: boolean;
}

export const initialMeta = (): MetaState => ({ info: {}, front: "sonnet", mode: "default", sessionId: null, windows: null, overage: false, usageAt: null, mcp: null, mcpOpen: false });

export function reduce(s: MetaState, ev: ServerEvent, now = Date.now()): MetaState {
  switch (ev.type) {
    case "opened":
      return { ...s, info: ev.info, front: ev.info.front ?? ev.model, mode: ev.info.permissionMode ?? ev.mode, sessionId: ev.session_id, mcp: null, mcpOpen: false };
    case "session_info": {
      const { type: _t, folder: _f, session: _s, replay: _r, session_id, ...info } = ev;
      const merged: SessionInfo = { ...s.info, ...info };
      return { ...s, info: merged, front: merged.front ?? s.front, mode: merged.permissionMode ?? s.mode, sessionId: session_id ?? s.sessionId };
    }
    case "context":
      return { ...s, info: { ...s.info, context: { used: ev.used, window: ev.window } } };
    case "rate_limit":
      return ev.windows ? { ...s, windows: ev.windows, overage: !!ev.overage, usageAt: now } : s;
    case "mcp": {
      const failed = ev.servers.filter((x) => x.status === "failed").length;
      return { ...s, mcp: ev.servers, mcpOpen: s.mcpOpen || !!ev.open, info: { ...s.info, mcp_failed: failed, mcp_total: ev.servers.length } };
    }
    default:
      return s;
  }
}

export const useMeta = create<MetaState>(initialMeta);

export function wireMeta(): () => void {
  const apply = (ev: ServerEvent) => {
    const cur = useSession.getState().session;
    if (ev.type !== "opened" && ev.type !== "rate_limit" && "session" in ev && ev.session && cur && ev.session !== cur) return;
    useMeta.setState((s) => reduce(s, ev));
  };
  const offs = (["opened", "session_info", "context", "rate_limit", "mcp"] as const).map((t) => on(t, apply as never));
  return () => offs.forEach((off) => off());
}

// -- actions -------------------------------------------------------------------------------------

export const toggleModel = () => send({ type: "set_model", model: useMeta.getState().front === "opus" ? "sonnet" : "opus" });
export const NEXT_MODE: Record<string, "default" | "auto" | "plan"> = { default: "auto", auto: "plan", plan: "default" };
export const cycleMode = () => send({ type: "set_mode", mode: NEXT_MODE[useMeta.getState().mode] ?? "default" });
export function toggleMcp() {
  const open = !useMeta.getState().mcpOpen;
  useMeta.setState({ mcpOpen: open });
  if (open) send({ type: "mcp_status" });
}
export const reconnectMcp = (name: string) => send({ type: "mcp_reconnect", name });

// -- views ---------------------------------------------------------------------------------------

export type Level = "" | "warn" | "low";

export interface ContextView { pct: number; level: Level; title: string }
export function contextView(c: ContextUsage | null | undefined): ContextView | null {
  if (!c || !c.window) return null;
  const pct = c.used / c.window;
  return {
    pct: Math.max(1, Math.round(pct * 100)),
    level: pct > 0.9 ? "low" : pct > 0.75 ? "warn" : "",
    title: `${c.used.toLocaleString("en-GB")} of ${c.window.toLocaleString("en-GB")} tokens in the last call (updates with each answer). Claude Code compacts the conversation when it gets full.`,
  };
}

export interface UsagePart { name: string; left: number | null; level: Level; resets: string }
export interface UsageView { parts: UsagePart[]; sub: string; title: string }

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
const day = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "short" });

/** Max plan usage shown as what is LEFT, with when each window resets. */
export function usageView(w: Record<string, UsageWindow> | null, overage: boolean, at: number | null, now = Date.now()): UsageView | null {
  if (!w || (!w.five_hour && !w.seven_day)) return null;
  const today = new Date(now);
  const left = (x?: UsageWindow) => (x && x.utilization != null ? Math.max(0, 1 - x.utilization) : null);
  const level = (l: number | null): Level => (l == null ? "" : l < 0.1 ? "low" : l < 0.25 ? "warn" : "");
  const resets = (x: UsageWindow | undefined, preferDay: boolean) => {
    if (!x?.resetsAt) return "";
    const d = new Date(x.resetsAt * 1000), same = d.toDateString() === today.toDateString();
    return preferDay && !same ? day(d) : same ? clock(d) : `${day(d)} ${clock(d)}`;
  };
  const part = (name: string, x: UsageWindow | undefined, preferDay: boolean): UsagePart => ({ name, left: left(x), level: level(left(x)), resets: resets(x, preferDay) });
  const parts = [part("Session", w.five_hour, false), part("Week", w.seven_day, true)];
  const updated = clock(new Date(at ?? now));
  const exact = (name: string, x?: UsageWindow) => {
    if (!x || x.utilization == null) return `${name}: no data`;
    const d = x.resetsAt ? new Date(x.resetsAt * 1000) : null;
    return `${name}: ${(x.utilization * 100).toFixed(1)}% used, ${((1 - x.utilization) * 100).toFixed(1)}% left` +
      (d ? `, resets ${d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}` : "");
  };
  return {
    parts,
    sub: [...parts.filter((p) => p.resets).map((p) => `${p.name.toLowerCase()} resets ${p.resets}`), `updated ${updated} with each answer`].join(" · "),
    title: [exact("Session (5-hour window)", w.five_hour), exact("Week (7-day window)", w.seven_day),
      overage ? "Overage in use" : "No overage (no pay-as-you-go)", `Updates with each answer; last update ${updated}.`].join("\n"),
  };
}

const MCP_ORDER: Record<string, number> = { failed: 0, "needs-auth": 1, pending: 2, connected: 3, disabled: 4 };
export function mcpRows(servers: McpServer[]): McpServer[] {
  return servers.slice().sort((a, b) => (MCP_ORDER[a.status ?? ""] ?? 5) - (MCP_ORDER[b.status ?? ""] ?? 5) || (a.name ?? "").localeCompare(b.name ?? ""));
}

export function metaLine(branch: string | null, sessionId: string | null, model: string | null | undefined): string {
  return [branch ? `branch ${branch}` : null, sessionId ? `session ${sessionId.slice(0, 8)}` : "new session", model?.replace(/^claude-/, "")].filter(Boolean).join("  ·  ");
}
