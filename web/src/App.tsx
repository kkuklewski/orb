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
import { ChatLog } from "./screens/chat/Chat";
import { useChat, wireChat } from "./stores/chat";

// Step 5: the app shell, the chat (typed), setup, Activity, Routines and Settings run here. Voice
// (mic, her voice, barge-in) moves over in step 6 (docs/react-migration.md).
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
    const offs = [wireFeatures(), wireSetup(), wireViews(), wireSession(), wireChat()];
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
        {view === "activity" ? <Activity />
          : view === "routines" && features.routines ? <Routines />
          : view === "settings" ? <Settings />
          : <Chat />}
      </main>
      <Picker />
    </div>
  );
}

function TopBar() {
  const { folder, label, rel, branch } = useSession();
  return (
    <header className="top">
      <button type="button" className="icon-btn ghost open-side" aria-label="Open the sidebar" onClick={() => useSession.setState({ drawer: true })}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <div className="where">
        <div className="where-name" title={folder ? `${label} · ${rel}` : undefined}>{folder ? folderName({ label }) : "No repo open"}</div>
        <div className="where-meta mono">{folder ? [rel, branch].filter(Boolean).join(" · ") : "pick one to start"}</div>
      </div>
      <span className="next-tag mono">NEXT · PREVIEW</span>
    </header>
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
              <p className="next-note">Type below, or / for commands. Voice comes to this page in step 6; until then it works at <a href="/">/</a>.</p>
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
      <div className="dock"><Composer /></div>
    </section>
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
