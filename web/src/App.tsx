import { useEffect, useState } from "react";
import { connect, type Connection, type ServerEvent } from "./ws";

// Step 0: the new page connects and says so. Screens move over from step 2 on (docs/react-migration.md).
const LABEL: Record<Connection, string> = {
  connecting: "Connecting…",
  online: "Online",
  offline: "Reconnecting…",
  refused: "This page's access token is out of date. Open the link Orb printed in the terminal.",
  "no-token": "Open the link Orb printed in the terminal (it ends in #t=…).",
};

export function App() {
  const [state, setState] = useState<Connection>("connecting");
  const [hello, setHello] = useState<ServerEvent | null>(null);

  useEffect(() => connect(setState, (ev) => { if (ev.type === "hello") setHello(ev); }), []);

  const repos = Array.isArray(hello?.folders) ? hello.folders.length : null;
  return (
    <main className="next">
      <header className="next-top">
        <span className="next-mark" aria-hidden="true" />
        <span className="next-brand">Orb</span>
        <span className="next-tag mono">NEXT · REACT PREVIEW</span>
      </header>
      <section className="next-body">
        <p className="next-kicker mono">// STEP 0</p>
        <h1>The new page is wired up.</h1>
        <p className="next-status" role="status">
          <span className={`next-dot ${state}`} aria-hidden="true" />
          {LABEL[state]}
        </p>
        {repos !== null && <p className="next-meta mono">{repos} repos · build {String(hello?.build ?? "")}</p>}
        <p className="next-note">Screens move over one at a time. The full app stays at <a href="/">/</a>.</p>
      </section>
    </main>
  );
}
