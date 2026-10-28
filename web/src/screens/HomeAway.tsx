import { awaySeen, useHome, type NeedsYou } from "../stores/home";
import { openExpired } from "../stores/brain";
import { openRoutine } from "../stores/routine";
import { openSessions } from "../stores/views";
import type { AwayLine } from "../protocol.gen";
import { needsLines, row } from "./HomeNeeds";

// Home's Away recap (GLOSSARY): after 24 hours or more without the owner acting, one card at the top of Home: how long
// they were away, the routines that ran ok meanwhile (one line each, "×2" when it ran twice; each opens its Run), the
// vault's "3 pages expired" (opens Brain's Expired view), then "2 sessions finished" (opens Sessions), "1 delegation Ready" (the Delegated strip) and "1 session waits for your
// OK" (now; opens Sessions), at most 8 lines from the server,
// then "N more"; and the first few Needs you rows in today's order, with the total. One-shot: Close, opening a row or
// leaving Home sends away_seen and it goes on every page until they are away again (server: away.py). No Badge.

export const AWAY_TOP = 3;

/** A routine's line: its name, its latest summary (plain text), how often it ran; it opens that routine's Run. */
const routineRow = (x: AwayLine) => ({ key: `away-${x.id}`, tag: "ROUTINE", title: x.title, reason: x.summary ?? "",
  side: (x.count ?? 1) > 1 ? `×${x.count}` : "", open: () => { awaySeen(); openRoutine(x.id); } });

/** Orb's own line: the sessions Finished or waiting for your OK (open Sessions) or the delegations Ready (scrolls to the
 *  Delegated strip). */
const OWN_TAG: Partial<Record<AwayLine["kind"], string>> = { ready: "READY", waiting: "OK?" };
const ownRow = (x: AwayLine) => ({ key: `away-${x.kind}`, tag: OWN_TAG[x.kind] ?? "FINISHED", title: x.title, reason: "", side: "",
  open: () => { awaySeen(); if (x.kind === "ready") document.getElementById("delegated")?.scrollIntoView?.({ block: "start" }); else openSessions(); } });

/** The pages the vault archived meanwhile: opens Brain's Expired view. */
const expiredRow = (x: AwayLine) => ({ key: "away-expired", tag: "EXPIRED", title: x.title, reason: "", side: "",
  open: () => { awaySeen(); openExpired(); } });

const lineRow = (x: AwayLine) => (x.kind === "routine" ? routineRow(x) : x.kind === "expired" ? expiredRow(x) : ownRow(x));

export function AwayRecap({ n }: { n: NeedsYou }) {
  const away = useHome((s) => s.away);
  if (!away) return null;
  const lines = needsLines(n);
  // Opening a row is opening the recap: it goes at once, not only when the page leaves Home.
  const top = lines.slice(0, AWAY_TOP).map((r) => row({ ...r, resolve: undefined, task: undefined, open: r.open && (() => { awaySeen(); r.open!(); }) }));
  return (
    <article className="hc away-recap" aria-label="Away recap">
      <div className="lead-top">
        <div className="lead-label mono on"><span className="lead-dot" aria-hidden="true" />{away.heading}</div>
        <button type="button" className="hc-ask mono" onClick={awaySeen}>Close</button>
      </div>
      {!!away.lines?.length && (
        <div className="needs-rows" aria-label="What ran and finished">
          {away.lines.map((x) => row(lineRow(x)))}
          {!!away.more && <div className="needs-row still away-more mono">{away.more} more</div>}
        </div>
      )}
      {top.length > 0 && <div className="needs-rows">{top}</div>}
      <div className="hc-foot mono">{lines.length ? `Needs you: ${top.length} of ${lines.length}` : "Nothing needs you."}</div>
    </article>
  );
}
