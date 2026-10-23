// The one WebSocket to Orb's server: token from the link (#t=…) or this browser's storage (the same
// key the old page uses), reconnect with backoff, and a clear state when the token is refused (4403).
// Incoming events go to the typed bus (events.ts); outgoing messages are typed by the protocol.
import type { ClientMessage, ServerEvent } from "./protocol.gen";
import { dispatch } from "./events";
import { useConnection, type Connection } from "./stores/connection";

const TOKEN_KEY = "vd-token";
let ws: WebSocket | null = null;

function readToken(): string {
  const m = location.hash.match(/[#&]t=([^&]+)/);
  try {
    if (m) {
      localStorage.setItem(TOKEN_KEY, m[1]);
      history.replaceState(null, "", location.pathname + location.search);
      return m[1];
    }
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return m ? m[1] : ""; // storage blocked: the link still works for this visit
  }
}

export function send(msg: ClientMessage): boolean {
  if (ws?.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

/** Open the socket and keep it open; returns a stop function (React effects call it on unmount). */
export function start(): () => void {
  const setState = (s: Connection) => useConnection.getState().set(s);
  const token = readToken();
  if (!token) {
    setState("no-token");
    return () => {};
  }
  let backoff = 500;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    setState("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(token)}`);
    ws = sock;
    sock.onopen = () => { backoff = 500; setState("online"); };
    sock.onmessage = (m) => dispatch(JSON.parse(m.data) as ServerEvent);
    sock.onclose = (e) => {
      if (stopped || ws !== sock) return;
      if (e.code === 4403) { setState("refused"); return; }
      setState("offline");
      timer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 8000);
    };
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    const sock = ws;
    ws = null;
    // Closing while it still connects (React's development double-mount) is fine; wait to close it cleanly.
    if (sock?.readyState === WebSocket.CONNECTING) sock.onopen = () => sock.close();
    else sock?.close();
  };
}
