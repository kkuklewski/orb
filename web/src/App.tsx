import { useEffect, useRef } from "react";
import { start } from "./ws";
import { useConnection, type Connection } from "./stores/connection";
import { useFeatures, wireFeatures } from "./stores/features";
import { useSetup, wireSetup } from "./stores/setup";
import { Setup } from "./screens/setup/Setup";

// Step 2: the setup assistant is the first real screen. The rest moves over from step 3 on
// (docs/react-migration.md); until then this page shows a short status and the setup.
const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Reconnecting…",
  refused: "This page's access token is out of date. Open the link Orb printed in the terminal.",
  "no-token": "Open the link Orb printed in the terminal (it ends in #t=…).",
};

export function openSetup(step = 0) {
  useSetup.setState({ open: true, step, sample: null, toast: null });
}

export function App() {
  useEffect(() => {
    const offs = [wireFeatures(), wireSetup()];
    const stop = start();
    return () => { stop(); offs.forEach((off) => off()); };
  }, []);

  const state = useConnection((s) => s.state);
  const { features, folders, build } = useFeatures();
  const open = useSetup((s) => s.open);

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
        {features?.plan && <span className="next-tag mono next-plan">CLAUDE · {features.plan.toUpperCase()}</span>}
      </header>
      <section className="next-body">
        <p className="next-kicker mono">// STEP 2</p>
        <h1>Setup runs in React now.</h1>
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
        <p className="next-note">The rest of the app stays at <a href="/">/</a> until its screens move over.</p>
      </section>
    </main>
  );
}
