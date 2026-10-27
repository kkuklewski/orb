import { awaySeen, useHome, type NeedsYou } from "../stores/home";
import { needsLines, row } from "./HomeNeeds";

// Home's Away recap (GLOSSARY): after 24 hours or more without the owner acting, one card at the top of Home: how long
// they were away and the first few Needs you rows in today's order, with the total. One-shot: Close, opening a row or
// leaving Home sends away_seen and it goes on every page until they are away again (server: away.py). No Badge.

export const AWAY_TOP = 3;

export function AwayRecap({ n }: { n: NeedsYou }) {
  const away = useHome((s) => s.away);
  if (!away) return null;
  const lines = needsLines(n);
  // Opening a row is opening the recap: it goes at once, not only when the page leaves Home.
  const top = lines.slice(0, AWAY_TOP).map((r) => row({ ...r, resolve: undefined, open: r.open && (() => { awaySeen(); r.open!(); }) }));
  return (
    <article className="hc away-recap" aria-label="Away recap">
      <div className="lead-top">
        <div className="lead-label mono on"><span className="lead-dot" aria-hidden="true" />{away.heading}</div>
        <button type="button" className="hc-ask mono" onClick={awaySeen}>Close</button>
      </div>
      {top.length > 0 && <div className="needs-rows">{top}</div>}
      <div className="hc-foot mono">{lines.length ? `Needs you: ${top.length} of ${lines.length}` : "Nothing needs you."}</div>
    </article>
  );
}
