import { useEffect, useRef, useState } from "react";
import { start } from "./ws";
import { useConnection, type Connection } from "./stores/connection";
import { useFeatures, wireFeatures } from "./stores/features";
import { openSetup, useSetup, wireSetup } from "./stores/setup";
import { escClosesPanel, useViews, wireViews } from "./stores/views";
import { folderName, openPicker, useSession, wireSession } from "./stores/session";
import { Setup } from "./screens/setup/Setup";
import { Activity } from "./screens/Activity";
import { Chats } from "./screens/Chats";
import { ChatSheet } from "./screens/ChatSheet";
import { Routines } from "./screens/Routines";
import { Settings } from "./screens/Settings";
import { Sidebar } from "./screens/Sidebar";
import { Picker } from "./screens/Picker";
import { PinChips } from "./screens/PinChips";
import { Composer } from "./screens/Composer";
import { Home } from "./screens/Home";
import { TaskScreen, TaskToast } from "./screens/Task";
import { RoutineScreen } from "./screens/Routine";
import { wireTasks } from "./stores/tasks";
import { wireItems } from "./stores/items";
import { ItemPage } from "./screens/ItemPage";
import { ItemList } from "./screens/ItemList";
import { wireHome } from "./stores/home";
import { wireRoute } from "./stores/route";
import { wireScreen } from "./stores/screen";
import { McpPanel, TopBar } from "./screens/TopBar";
import { DockState, VoicePill } from "./screens/Voice";
import { wireMeta } from "./stores/meta";
import { wireVoice } from "./voice/controller";
import { ChatLog } from "./screens/chat/Chat";
import { useChat, wireChat } from "./stores/chat";

// The whole app: shell, chat, voice, setup, Activity, Routines and Settings. It is the page at / (the old one is at /old; docs/react-migration.md).
const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Reconnecting…",
  refused: "This page's access token is out of date. Open the link Orb printed in the terminal.",
  "no-token": "Open the link Orb printed in the terminal (it ends in #t=…).",
};

export { openSetup };

export function App() {
  useEffect(() => {
    const offs = [wireFeatures(), wireSetup(), wireViews(), wireSession(), wireChat(), wireMeta(), wireVoice(), wireHome(), wireTasks(), wireItems(), wireRoute(), wireScreen()];
    const stop = start();
    return () => { stop(); offs.forEach((off) => off()); };
  }, []);

  const state = useConnection((s) => s.state);
  const features = useFeatures((s) => s.features);
  const open = useSetup((s) => s.open);
  const view = useViews((s) => s.view);
  const drawer = useSession((s) => s.drawer);
  // A task, routine result or item list opens as a panel on the right of the screen it was opened from
  // (Home, Activity or Routines) when the window is wide; "full page" detaches it, close goes back.
  const wide = useWide(1100);
  const detail = ["task", "routine", "item", "items"].includes(view);
  const [full, setFull] = useState(false);
  const baseRef = useRef<"home" | "activity" | "routines">("home");
  if (view === "home" || view === "activity" || view === "routines") baseRef.current = view;
  useEffect(() => { if (!detail) setFull(false); }, [detail]);
  const base = baseRef.current;
  const peeking = detail && wide && !full;
  const peekW = usePeekWidth();
  useEffect(() => {
    if (!peeking) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea")) useViews.setState({ view: base }); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [peeking, base]);

  const sheet = view === "session";
  useEffect(() => {
    if (!sheet) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && escClosesPanel(e.target)) useViews.setState({ view: baseRef.current }); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [sheet]);

  // Not set up: the setup opens by itself. Setup just finished: close it.
  const wasOnboarded = useRef<boolean | null>(null);
  useEffect(() => {
    if (!features) return;
    if (!features.onboarded && !useSetup.getState().open) openSetup(0);
    if (features.onboarded && wasOnboarded.current === false) useSetup.setState({ open: false });
    wasOnboarded.current = features.onboarded;
  }, [features]);

  if (open) return <Setup />;
  if (state !== "online" || !features) return <Offline state={state} />;
  return (
    <div className={"app" + (drawer ? " side-open" : "")}>
      <Sidebar />
      <div className="scrim" onClick={() => useSession.setState({ drawer: false })} />
      <main className="main">
        <TopBar />
        <McpPanel />
        {peeking ? (
          <div className="peek-wrap">
            <div className="peek-base" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input, select, textarea, summary, label, [role=button]")) useViews.setState({ view: base }); }}>{base === "activity" ? <Activity /> : base === "routines" && features.routines ? <Routines /> : <section className="chat-next"><Home /></section>}</div>
            <aside className="peek" aria-label="Details" style={peekW.w ? { flexBasis: peekW.w } : undefined}>
              <div className="peek-grip" role="separator" aria-orientation="vertical" aria-label="Resize panel (double-click to reset)" onPointerDown={peekW.drag} onDoubleClick={peekW.reset} />
              <div className="peek-bar mono">
                <button type="button" onClick={() => useViews.setState({ view: base })} aria-label="Close panel">✕ CLOSE</button>
                <button type="button" onClick={() => setFull(true)} aria-label="Open as full page">⤢ FULL PAGE</button>
              </div>
              <div className="peek-body">
                {view === "routine" ? <RoutineScreen /> : view === "task" ? <TaskScreen /> : view === "items" ? <ItemList /> : <ItemPage />}
              </div>
            </aside>
          </div>
        ) : sheet ? (
          <section className="chat-next">
            <div className="sheet-host">
              <div className="sheet-base">{base === "activity" ? <Activity /> : base === "routines" && features.routines ? <Routines /> : <Home />}</div>
              <ChatSheet />
            </div>
            <Dock pill />
          </section>
        ) : view === "activity" ? <Activity />
          : view === "routines" && features.routines ? <Routines />
          : view === "chats" ? <Chats />
          : view === "settings" ? <Settings />
          : view === "home" ? <section className="chat-next"><Home /><Dock pill /></section>
          : view === "routine" ? <section className="chat-next"><RoutineScreen /><Dock pill /></section>
          : view === "task" ? <section className="chat-next"><TaskScreen /><Dock pill /></section>
          : view === "items" ? <section className="chat-next"><ItemList /><Dock pill /></section>
          : view === "item" ? <section className="chat-next"><ItemPage /><Dock pill /></section>
          : <Chat />}
      </main>
      <Picker />
      <TaskToast />
    </div>
  );
}

const PEEK_KEY = "orb-peek-w";
function usePeekWidth() {
  const [w, setW] = useState<number | null>(() => { try { return Number(localStorage.getItem(PEEK_KEY)) || null; } catch { return null; } });
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
    const max = Math.max(420, window.innerWidth - 360);
    let last = 0;
    const move = (m: PointerEvent) => { last = Math.round(Math.min(max, Math.max(360, right - m.clientX))); setW(last); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (last) try { localStorage.setItem(PEEK_KEY, String(last)); } catch { /* no storage */ } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  return { w, drag, reset: () => { setW(null); try { localStorage.removeItem(PEEK_KEY); } catch { /* no storage */ } } };
}

function useWide(px: number) {
  const q = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setOn(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [q]);
  return on;
}

function Chat() {
  const { folder, label } = useSession();
  const empty = useChat((s) => s.items.length === 0);
  return (
    <section className="chat-next">
      {folder && !empty ? <ChatLog /> : (
        <div className="hero-next">
          {folder ? (
            <>
              <p className="next-kicker mono">// {folderName({ label }).toUpperCase()}</p>
              <h1>What should we work on?</h1>
              <p className="next-note mono">or type below · Space toggles the mic · Esc stops</p>
            </>
          ) : (
            <>
              <p className="next-kicker mono">// NO REPO OPEN</p>
              <h1>Pick a repo to talk about.</h1>
              <p><button type="button" className="onb-btn primary" onClick={() => openPicker("new")}>Choose a repo</button></p>
            </>
          )}
        </div>
      )}
      <Dock pill />
    </section>
  );
}

function Dock({ pill }: { pill: boolean }) {
  return (
    <footer className="dock">
      <PinChips />
      <DockState />
      <div className="dock-row">
        <Composer />
        {pill && <div className="mic-float"><VoicePill /></div>}
      </div>
    </footer>
  );
}

function Offline({ state }: { state: Connection }) {
  return (
    <main className="next">
      <header className="next-top">
        <span className="next-mark" aria-hidden="true" />
        <span className="next-brand">Orb</span>
        <span className="next-tag mono">NEXT · PREVIEW</span>
      </header>
      <section className="next-body">
        <p className="next-status" role="status">
          <span className={`next-dot ${state}`} aria-hidden="true" />
          {LABEL[state]}
        </p>
      </section>
    </main>
  );
}
