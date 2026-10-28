import { useEffect, useRef, useState } from "react";
import { start } from "./ws";
import { useConnection, type Connection } from "./stores/connection";
import { useFeatures, wireFeatures } from "./stores/features";
import { openSetup, useSetup, wireSetup } from "./stores/setup";
import { escClosesPanel, useViews, wireViews } from "./stores/views";
import { closeDock } from "./stores/dock";
import { openPicker, useSession, wireSession } from "./stores/session";
import { Setup } from "./screens/setup/Setup";
import { Sessions } from "./screens/Sessions";
import { HomeDock, useDockShown } from "./screens/HomeDock";
import { useDragWidth } from "./screens/dragWidth";
import { Tasks } from "./screens/Tasks";
import { Brain, NotePage } from "./screens/Brain";
import { wireBrain } from "./stores/brain";
import { Routines } from "./screens/Routines";
import { Settings } from "./screens/Settings";
import { Sidebar } from "./screens/Sidebar";
import { Picker } from "./screens/Picker";
import { PinChips } from "./screens/PinChips";
import { Composer } from "./screens/Composer";
import { Start } from "./screens/Start";
import { Home } from "./screens/Home";
import { TaskScreen, TaskToast } from "./screens/Task";
import { RoutineScreen } from "./screens/Routine";
import { wireTasks } from "./stores/tasks";
import { wireItems } from "./stores/items";
import { ItemPage } from "./screens/ItemPage";
import { ItemList } from "./screens/ItemList";
import { wireHome } from "./stores/home";
import { wireDrop } from "./stores/drop";
import { wireDelegations } from "./stores/delegation";
import { wireRoute } from "./stores/route";
import { wireScreen } from "./stores/screen";
import { wireMakeTask } from "./stores/routine";
import { McpPanel, TopBar } from "./screens/TopBar";
import { DockState, VoicePill } from "./screens/Voice";
import { wireMeta } from "./stores/meta";
import { wireVoice } from "./voice/controller";
import { ChatLog } from "./screens/chat/Chat";
import { useChat, wireChat } from "./stores/chat";

// The whole app: shell, chat, voice, setup, Sessions, Routines and Settings. It is the page at / (docs/react-migration.md).
const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Reconnecting…",
  refused: "This page's access token is out of date (Orb makes a new one each start). Open the link Orb printed in the terminal.",
  "no-token": "Open the link Orb printed in the terminal (it ends in #t=…).",
};

export { openSetup };

export function App() {
  useEffect(() => {
    const offs = [wireFeatures(), wireSetup(), wireViews(), wireSession(), wireChat(), wireMeta(), wireVoice(), wireHome(), wireDrop(), wireDelegations(), wireTasks(), wireItems(), wireBrain(), wireRoute(), wireScreen(), wireMakeTask()];
    const stop = start();
    return () => { stop(); offs.forEach((off) => off()); };
  }, []);

  const state = useConnection((s) => s.state);
  const features = useFeatures((s) => s.features);
  const open = useSetup((s) => s.open);
  const view = useViews((s) => s.view);
  const drawer = useSession((s) => s.drawer);
  // A task, routine result or item list opens as a panel on the right of the screen it was opened from
  // (Home, Sessions, Routines or Tasks) when the window is wide; "full page" detaches it, close goes back.
  const wide = useWide(1100);
  const detail = ["task", "routine", "item", "items"].includes(view);
  const [full, setFull] = useState(false);
  const baseRef = useRef<"home" | "sessions" | "routines" | "tasks">("home");
  if (view === "home" || view === "sessions" || view === "routines" || view === "tasks") baseRef.current = view;
  useEffect(() => { if (!detail) setFull(false); }, [detail]);
  const base = baseRef.current;
  const docked = useDockShown(); // the Home chat dock is on the right: details open in place
  const peeking = detail && wide && !full && !docked;
  const peekW = useDragWidth("orb-peek-w");
  useEffect(() => {
    if (!peeking) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea")) useViews.setState({ view: base }); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [peeking, base]);

  useEffect(() => {
    if (!docked) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && escClosesPanel(e.target)) closeDock(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [docked]);
  const foot = docked ? null : <Dock pill />; // with the dock open its composer is the one to talk in

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
            <div className="peek-base" onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input, select, textarea, summary, label, [role=button]")) useViews.setState({ view: base }); }}>{base === "sessions" ? <Sessions /> : base === "routines" && features.routines ? <Routines /> : base === "tasks" ? <Tasks /> : <section className="chat-next"><Home /></section>}</div>
            <aside className="peek" aria-label="Details" style={peekW.w ? { width: peekW.w } : undefined}>
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
        ) : view === "sessions" ? <Sessions />
          : view === "routines" && features.routines ? <Routines />
          : view === "tasks" ? <Tasks />
          : view === "brain" ? <Brain />
          : view === "settings" ? <Settings />
          : view === "home" ? <section className="chat-next"><Home /><Dock pill /></section>
          : view === "routine" ? <section className="chat-next"><RoutineScreen />{foot}</section>
          : view === "task" ? <section className="chat-next"><TaskScreen />{foot}</section>
          : view === "items" ? <section className="chat-next"><ItemList />{foot}</section>
          : view === "item" ? <section className="chat-next"><ItemPage />{foot}</section>
          : view === "note" ? <section className="chat-next"><NotePage />{foot}</section>
          : <Chat />}
        {docked && <HomeDock />}
      </main>
      <Picker />
      <TaskToast />
    </div>
  );
}

function useWide(px: number) {
  const q = `(min-width: ${px}px)`;
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q); const f = () => setOn(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, [q]);
  return on;
}

function Chat() {
  const folder = useSession((s) => s.folder);
  const empty = useChat((s) => s.items.length === 0);
  if (folder && empty) return <section className="chat-next start-wrap"><Start /></section>;
  return (
    <section className="chat-next">
      {folder ? <ChatLog /> : (
        <div className="hero-next">
          <p className="next-kicker mono">// NO REPO OPEN</p>
          <h1>Pick a repo to talk about.</h1>
          <p><button type="button" className="onb-btn primary" onClick={() => openPicker("new")}>Choose a repo</button></p>
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
        <Composer lead={pill ? <VoicePill /> : undefined} />
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
