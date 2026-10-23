import { useEffect } from "react";
import { start } from "./ws";
import { useConnection, type Connection } from "./stores/connection";
import { useFeatures, wireFeatures } from "./stores/features";

// Step 1: typed events into stores. Screens move over from step 2 on (docs/react-migration.md).
const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Reconnecting…",
  refused: "This page's access token is out of date. Open the link Orb printed in the terminal.",
  "no-token": "Open the link Orb printed in the terminal (it ends in #t=…).",
};

export function App() {
  useEffect(() => {
    const unwire = wireFeatures();
    const stop = start();
    return () => { stop(); unwire(); };
  }, []);

  const state = useConnection((s) => s.state);
  const { features, folders, build } = useFeatures();

  return (
    <main className="next">
      <header className="next-top">
        <span className="next-mark" aria-hidden="true" />
        <span className="next-brand">Orb</span>
        <span className="next-tag mono">NEXT · REACT PREVIEW</span>
        {features?.plan && <span className="next-tag mono next-plan">CLAUDE · {features.plan.toUpperCase()}</span>}
      </header>
      <section className="next-body">
        <p className="next-kicker mono">// STEP 1</p>
        <h1>Typed messages, live stores.</h1>
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
        <p className="next-note">Screens move over one at a time. The full app stays at <a href="/">/</a>.</p>
      </section>
    </main>
  );
}
