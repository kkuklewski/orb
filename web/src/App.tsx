import { useEffect, useRef, type ReactNode } from "react";
import { start } from "./ws";
import { useConnection, type Connection } from "./stores/connection";
import { useFeatures, wireFeatures } from "./stores/features";
import { openSetup, useSetup, wireSetup } from "./stores/setup";
import { activityRows, useViews, wireViews, type View } from "./stores/views";
import { Setup } from "./screens/setup/Setup";
import { Activity } from "./screens/Activity";
import { Routines } from "./screens/Routines";
import { Settings } from "./screens/Settings";

// Step 3: setup, Activity, Routines and Settings run here. Chat moves over later
// (docs/react-migration.md); until then Home shows a short status and links to the full app.
const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Reconnecting…",
  refused: "This page's access token is out of date. Open the link Orb printed in the terminal.",
  "no-token": "Open the link Orb printed in the terminal (it ends in #t=…).",
};

export { openSetup };

function Nav() {
  const view = useViews((s) => s.view);
  const { features, folders } = useFeatures();
  const routines = useViews((s) => s.routines);
  const rows = activityRows(folders);
  const waiting = rows.filter((r) => r.status === "approval").length;
  const items: [View, string, ReactNode][] = [
    ["home", "Home", null],
    ["activity", "Activity", rows.length > 0 && <span className={"nav-badge" + (waiting ? " approval" : "")}>{waiting || rows.length}</span>],
    ...(features?.routines ? [["routines", "Routines", routines?.needs ? <span className="nav-badge approval">{routines.needs}</span> : null] as [View, string, ReactNode]] : []),
    ["settings", "Settings", null],
  ];
  return (
    <nav className="next-nav" aria-label="Views">
      {items.map(([v, label, badge]) => (
        <button key={v} type="button" aria-current={view === v ? "page" : undefined} onClick={() => useViews.setState({ view: v })}>{label}{badge}</button>
      ))}
    </nav>
  );
}

export function App() {
  useEffect(() => {
    const offs = [wireFeatures(), wireSetup(), wireViews()];
    const stop = start();
    return () => { stop(); offs.forEach((off) => off()); };
  }, []);

  const state = useConnection((s) => s.state);
  const features = useFeatures((s) => s.features);
  const open = useSetup((s) => s.open);
  const view = useViews((s) => s.view);

  // Not set up: the setup opens by itself. Setup just finished: close it.
  const wasOnboarded = useRef<boolean | null>(null);
  useEffect(() => {
    if (!features) return;
    if (!features.onboarded && !useSetup.getState().open) openSetup(0);
    if (features.onboarded && wasOnboarded.current === false) useSetup.setState({ open: false });
    wasOnboarded.current = features.onboarded;
  }, [features]);

  if (open) return <Setup />;
  return (
    <main className="next">
      <header className="next-top">
        <span className="next-mark" aria-hidden="true" />
        <span className="next-brand">Orb</span>
        <span className="next-tag mono">NEXT · REACT PREVIEW</span>
        {state === "online" && <Nav />}
        {features?.plan && <span className="next-tag mono next-plan">CLAUDE · {features.plan.toUpperCase()}</span>}
      </header>
      {view === "activity" && state === "online" ? <Activity />
        : view === "routines" && state === "online" && features?.routines ? <Routines />
        : view === "settings" && state === "online" ? <Settings />
        : <Home />}
    </main>
  );
}

function Home() {
  const state = useConnection((s) => s.state);
  const { features, folders, build } = useFeatures();
  return (
      <section className="next-body">
        <p className="next-kicker mono">// STEP 3</p>
        <h1>Setup, Activity, Routines and Settings run in React now.</h1>
        <p className="next-status" role="status">
          <span className={`next-dot ${state}`} aria-hidden="true" />
          {LABEL[state]}
        </p>
        {features && (
          <dl className="next-facts mono">
            <dt>repos</dt><dd>{folders.length}</dd>
            <dt>set up</dt><dd>{features.onboarded ? "yes" : "not yet"}</dd>
            <dt>speech</dt><dd>{features.stt} in · {features.tts} out</dd>
            <dt>build</dt><dd>{build}</dd>
          </dl>
        )}
        <p><button type="button" className="onb-btn" disabled={state !== "online"} onClick={() => openSetup(0)}>Open setup</button></p>
        <p className="next-note">Chat stays at <a href="/">/</a> until it moves over.</p>
      </section>
  );
}
