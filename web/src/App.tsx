import { useEffect, useRef } from "react";
import { start } from "./ws";
import { useConnection, type Connection } from "./stores/connection";
import { useFeatures, wireFeatures } from "./stores/features";
import { openSetup, useSetup, wireSetup } from "./stores/setup";
import { useViews, wireViews } from "./stores/views";
import { folderName, openPicker, useSession, wireSession } from "./stores/session";
import { Setup } from "./screens/setup/Setup";
import { Activity } from "./screens/Activity";
import { Routines } from "./screens/Routines";
import { Settings } from "./screens/Settings";
import { Sidebar } from "./screens/Sidebar";
import { Picker } from "./screens/Picker";
import { Composer } from "./screens/Composer";
import { Home } from "./screens/Home";
import { TaskScreen, TaskToast } from "./screens/Task";
import { wireTasks } from "./stores/tasks";
import { wireHome } from "./stores/home";
import { wireRoute } from "./stores/route";
import { McpPanel, TopBar } from "./screens/TopBar";
import { DockState, VoicePill } from "./screens/Voice";
import { wireMeta } from "./stores/meta";
import { wireVoice } from "./voice/controller";
import { ChatLog } from "./screens/chat/Chat";
import { useChat, wireChat } from "./stores/chat";

// The whole app: shell, chat, voice, setup, Activity, Routines and Settings. It runs at /next until
// step 7 makes it the page at / (docs/react-migration.md).
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
    const offs = [wireFeatures(), wireSetup(), wireViews(), wireSession(), wireChat(), wireMeta(), wireVoice(), wireHome(), wireTasks(), wireRoute()];
    const stop = start();
    return () => { stop(); offs.forEach((off) => off()); };
  }, []);

  const state = useConnection((s) => s.state);
  const features = useFeatures((s) => s.features);
  const open = useSetup((s) => s.open);
  const view = useViews((s) => s.view);
  const drawer = useSession((s) => s.drawer);

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
        {view === "activity" ? <Activity />
          : view === "routines" && features.routines ? <Routines />
          : view === "settings" ? <Settings />
          : view === "home" ? <section className="chat-next"><Home /><Dock pill={false} /></section>
          : view === "task" ? <section className="chat-next"><TaskScreen /><Dock pill /></section>
          : <Chat />}
      </main>
      <Picker />
      <TaskToast />
    </div>
  );
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
              <div className="hero-pill"><VoicePill /></div>
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
      <Dock pill={!!folder && !empty} />
    </section>
  );
}

function Dock({ pill }: { pill: boolean }) {
  return (
    <footer className="dock">
      <DockState />
      <div className="dock-row">
        {pill && <div className="orb-slot"><VoicePill /></div>}
        <Composer />
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
