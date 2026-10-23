// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OpenedEvent } from "../protocol.gen";
import { initialSession, useSession } from "./session";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const M = await import("./meta");
const { TopBar, McpPanel } = await import("../screens/TopBar");

const opened = (over: Partial<OpenedEvent> = {}): OpenedEvent => ({
  type: "opened", folder: "/a/web", session: "s1", label: "acme/web", rel: "web", branch: "main", session_id: "0123456789abcdef",
  live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", tasks: [],
  info: { model: "claude-sonnet-5-5", front: "sonnet", permissionMode: "default", mcp_failed: 1, mcp_total: 4, context: { used: 160000, window: 200000 } }, ...over,
});

beforeEach(() => {
  sent.length = 0;
  M.useMeta.setState(M.initialMeta());
  useSession.setState({ ...initialSession(), folder: "/a/web", session: "s1", label: "acme/web", rel: "web", branch: "main" });
});
afterEach(cleanup);

describe("meta reducer", () => {
  it("opened, then session_info and context update in place", () => {
    let s = M.reduce(M.initialMeta(), opened());
    expect(s).toMatchObject({ front: "sonnet", mode: "default", sessionId: "0123456789abcdef" });
    s = M.reduce(s, { type: "session_info", permissionMode: "plan", front: "opus" });
    expect(s).toMatchObject({ front: "opus", mode: "plan", info: { model: "claude-sonnet-5-5" } });
    s = M.reduce(s, { type: "context", used: 10, window: 100 });
    expect(s.info.context).toEqual({ used: 10, window: 100 });
    s = M.reduce(s, { type: "mcp", servers: [{ name: "a", status: "connected" }, { name: "b", status: "failed" }], open: true });
    expect(s).toMatchObject({ mcpOpen: true, info: { mcp_failed: 1, mcp_total: 2 } });
  });
});

describe("views", () => {
  it("context: percent full and its level", () => {
    expect(M.contextView({ used: 160000, window: 200000 })).toMatchObject({ pct: 80, level: "warn" });
    expect(M.contextView({ used: 190000, window: 200000 })!.level).toBe("low");
    expect(M.contextView({ used: 1, window: 200000 })!.pct).toBe(1);
    expect(M.contextView(null)).toBeNull();
  });

  it("usage: what is left, levels, and when it resets", () => {
    const now = new Date(2026, 9, 23, 12, 0).getTime();
    const resets = new Date(2026, 9, 23, 15, 30).getTime() / 1000;
    const u = M.usageView({ five_hour: { utilization: 0.92, resetsAt: resets }, seven_day: { utilization: 0.5 } }, false, now, now)!;
    expect(u.parts.map((p) => [p.name, Math.round(p.left! * 100), p.level])).toEqual([["Session", 8, "low"], ["Week", 50, ""]]);
    expect(u.sub).toBe("session resets 15:30 · updated 12:00 with each answer");
    expect(u.title).toContain("No overage");
    expect(M.usageView(null, false, null)).toBeNull();
  });

  it("MCP rows: problems first, then by name; the meta line", () => {
    expect(M.mcpRows([{ name: "z", status: "connected" }, { name: "a", status: "connected" }, { name: "m", status: "failed" }]).map((x) => x.name)).toEqual(["m", "a", "z"]);
    expect(M.metaLine("main", "0123456789", "claude-opus-5-5")).toBe("branch main  ·  session 01234567  ·  opus-5-5");
    expect(M.metaLine(null, null, null)).toBe("new session");
  });
});

describe("top bar", () => {
  it("shows the session's chips and switches model and approvals", () => {
    act(() => M.useMeta.setState((s) => M.reduce(s, opened())));
    render(<TopBar />);
    expect(screen.getByText("acme/web".split("/")[1])).toBeTruthy();
    expect(screen.getByText(/session 01234567/)).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "model: sonnet" }));
    expect(sent).toContainEqual({ type: "set_model", model: "opus" });
    fireEvent.click(screen.getByRole("button", { name: "approvals: default" }));
    expect(sent).toContainEqual({ type: "set_mode", mode: "auto" });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));
    expect(sent).toContainEqual({ type: "new_session" });
  });

  it("the MCP chip opens the panel, asks for status, and offers Reconnect for failed servers", () => {
    act(() => M.useMeta.setState((s) => M.reduce(s, opened())));
    render(<><TopBar /><McpPanel /></>);
    fireEvent.click(screen.getByRole("button", { name: "MCP ● 1 failed" }));
    expect(sent).toContainEqual({ type: "mcp_status" });
    expect(screen.getByText("checking MCP servers…")).toBeTruthy();
    act(() => M.useMeta.setState((s) => M.reduce(s, { type: "mcp", servers: [{ name: "claude.ai Gmail", status: "failed", error: "auth" }, { name: "ctx7", status: "connected", tools: 2 }] })));
    expect(screen.getByText("Gmail")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    expect(sent).toContainEqual({ type: "mcp_reconnect", name: "claude.ai Gmail" });
  });
});
