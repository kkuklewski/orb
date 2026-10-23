// The one WebSocket to Orb's server: token from the link (#t=…) or this browser's storage, the same
// key the old page uses, reconnect with backoff, and a clear state when the token is refused (4403).
// Step 1 replaces the untyped events here with types generated from src/orb/protocol.py.

export type Connection = "connecting" | "online" | "offline" | "refused" | "no-token";
export type ServerEvent = { type: string; [key: string]: unknown };

const TOKEN_KEY = "vd-token";

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

export function connect(onState: (s: Connection) => void, onEvent: (ev: ServerEvent) => void): () => void {
  const token = readToken();
  if (!token) {
    onState("no-token");
    return () => {};
  }
  let ws: WebSocket | null = null;
  let backoff = 500;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    onState("connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?t=${encodeURIComponent(token)}`);
    ws.onopen = () => { backoff = 500; onState("online"); };
    ws.onmessage = (m) => onEvent(JSON.parse(m.data) as ServerEvent);
    ws.onclose = (e) => {
      if (stopped) return;
      if (e.code === 4403) { onState("refused"); return; }
      onState("offline");
      timer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 8000);
    };
  };
  open();
  return () => { stopped = true; clearTimeout(timer); ws?.close(); };
}
