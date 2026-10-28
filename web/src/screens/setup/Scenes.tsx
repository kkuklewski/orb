// The pictures on the setup screens. Decorative (each screen's text says it all), drawn in the
// Studio look: hairlines, grey, one orange accent for what's live. Names are made up.
import type { CSSProperties } from "react";

type SceneProps = { plan: string; work: boolean };

const delay = (d: string) => ({ "--d": d }) as CSSProperties; // staggers the entrance

export function ApprovalScene(_: SceneProps) {
  return (
    <div className="sc sc-approve">
      <div className="sc-bubble sc-in" style={delay("0s")}>
        <span className="mono sc-who">YOU</span>Fix the typo on the prices page
      </div>
      <div className="sc-link sc-in" style={delay(".25s")} />
      <div className="sc-ask sc-in" style={delay(".45s")}>
        <p className="mono sc-ask-head"><span className="sc-sq" />NEEDS YOUR OK</p>
        <p className="sc-ask-what">Change <b>prices page</b></p>
        <p className="sc-ask-diff"><s>Montly plan</s> <span>Monthly plan</span></p>
        <div className="sc-ask-btns">
          <span className="sc-btn">Deny</span>
          <span className="sc-btn solid sc-pulse">Allow</span>
        </div>
      </div>
      <div className="sc-voice sc-in" style={delay(".8s")}>
        <span className="sc-wave"><i /><i /><i /><i /><i /></span>
        <span className="mono">or just say “yes”</span>
      </div>
    </div>
  );
}

export function ScopeScene({ work }: SceneProps) {
  return (
    <div className="sc sc-scope">
      <div className="sc-tile on sc-in" style={delay("0s")}>
        <p className="mono sc-tile-state"><span className="sc-sq" />WORKING HERE</p>
        <Folder />
        <p className="sc-tile-name">Acme website</p>
        <ul className="mono sc-files"><li>home page</li><li>prices page</li><li>images</li></ul>
      </div>
      <div className="sc-tile dim sc-in" style={delay(".2s")}>
        <p className="mono sc-tile-state">{work ? "STAYS CLOSED" : "ASKS YOU FIRST"}</p>
        <Folder />
        <p className="sc-tile-name">Globex app</p>
        <p className="sc-tile-note">{work ? "Not on a work Mac" : "Only after you say yes"}</p>
      </div>
      <div className="sc-tile locked sc-in" style={delay(".4s")}>
        <p className="mono sc-tile-state">NEVER OPENED</p>
        <svg className="sc-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="9" y="21" width="30" height="21" rx="3" /><path d="M16 21v-6a8 8 0 0 1 16 0v6" /><circle cx="24" cy="31" r="2.5" /><path d="M24 33.5V37" />
        </svg>
        <p className="sc-tile-name">Passwords &amp; keys</p>
        <p className="sc-tile-note">Even if you ask</p>
      </div>
    </div>
  );
}

function Folder() {
  return (
    <svg className="sc-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 14a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v19a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3z" /><path d="M6 20h36" />
    </svg>
  );
}

export function PlanScene({ plan }: SceneProps) {
  return (
    <div className="sc sc-plan">
      <div className="sc-card sc-in" style={delay("0s")}>
        <div className="sc-card-top"><span className="sc-card-dot" /><span className="mono">CLAUDE</span></div>
        <p className="sc-card-plan">{plan}</p>
        <p className="mono sc-card-foot"><span className="sc-sq" />YOUR PLAN · ALREADY PAID</p>
      </div>
      <div className="sc-side">
        <div className="sc-key sc-in" style={delay(".3s")}>
          <svg className="sc-icon small" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="16" cy="24" r="8" /><path d="M24 24h18M36 24v6M41 24v4" />
          </svg>
          <span><b>Pay-as-you-go key</b><br /><span className="mono">REFUSED</span></span>
        </div>
        <div className="sc-bill sc-in" style={delay(".55s")}>
          <span className="mono">EXTRA CHARGES</span>
          <span className="sc-bill-n">$0</span>
        </div>
      </div>
    </div>
  );
}

export function LocalScene(_: SceneProps) {
  return (
    <div className="sc sc-local">
      <div className="sc-away sc-in" style={delay(".5s")}>
        <span className="sc-away-item"><Globe />Internet</span>
        <span className="sc-away-item"><Wifi />Others on Wi-Fi</span>
        <span className="mono sc-away-x">CAN'T OPEN IT</span>
      </div>
      <div className="sc-ring sc-in" style={delay(".15s")}>
        <svg className="sc-mac" viewBox="0 0 220 150" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="30" y="10" width="160" height="104" rx="6" />
          <path d="M8 124h204l-10 14H18z" />
        </svg>
        <span className="sc-orb" />
        <span className="mono sc-mac-label">THIS MAC</span>
        <div className="sc-pass sc-in" style={delay(".35s")}>
          <span className="sc-sq" /><span className="mono">PRIVATE LINK</span>
        </div>
      </div>
    </div>
  );
}

function Globe() {
  return (
    <svg className="sc-icon small" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="24" cy="24" r="16" /><path d="M8 24h32M24 8c5 5 5 27 0 32M24 8c-5 5-5 27 0 32" />
    </svg>
  );
}

function Wifi() {
  return (
    <svg className="sc-icon small" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 19a23 23 0 0 1 32 0M13 25a16 16 0 0 1 22 0M18 31a9 9 0 0 1 12 0" /><circle cx="24" cy="37" r="1.5" />
    </svg>
  );
}

// ---- Welcome, sign in, folders, notes, voice ----

export function TalkScene() {
  return (
    <div className="sc sc-approve">
      <div className="sc-bubble sc-in" style={delay("0s")}>
        <span className="mono sc-who">YOU</span>What's left on the prices page?
      </div>
      <div className="sc-link sc-in" style={delay(".25s")} />
      <div className="sc-ask sc-in" style={delay(".45s")}>
        <p className="mono sc-ask-head"><span className="sc-dot" />ORB · ACME WEBSITE</p>
        <p className="sc-ask-what">Two things: the yearly price and a typo. Want me to fix them?</p>
        <div className="sc-voice sc-say">
          <span className="sc-wave"><i /><i /><i /><i /><i /></span>
          <span className="mono">SPEAKING</span>
        </div>
      </div>
    </div>
  );
}

export function SignInScene({ ok, plan }: { ok: boolean; plan: string }) {
  return (
    <div className="sc sc-signin">
      <div className="sc-win sc-in" style={delay("0s")}>
        <p className="mono sc-win-bar"><Lock />CLAUDE.AI · ANTHROPIC</p>
        <div className="sc-win-body">
          <span className="sc-field" /><span className="sc-field short" />
          <span className="sc-btn solid">Sign in</span>
        </div>
      </div>
      <div className="sc-arrow sc-in" style={delay(".3s")}><span className="mono">ONLY “YES, SIGNED IN”</span></div>
      <div className={"sc-me sc-in" + (ok ? " on" : "")} style={delay(".5s")}>
        <span className="sc-dot big" />
        <p className="sc-tile-name">Orb</p>
        <p className="mono sc-tile-state">{ok ? <><span className="sc-sq" />{plan.toUpperCase()} PLAN</> : "WAITING FOR YOU"}</p>
      </div>
    </div>
  );
}

export function FoldersScene() {
  return (
    <div className="sc sc-folders">
      <div className="sc-tree sc-in" style={delay("0s")}>
        <p className="sc-tree-root"><Folder /><span className="mono">CODE</span></p>
        <p className="sc-tree-row on sc-in" style={delay(".25s")}><span className="sc-sq" />Acme website<span className="mono">PROJECT</span></p>
        <p className="sc-tree-row on sc-in" style={delay(".4s")}><span className="sc-sq" />Globex app<span className="mono">PROJECT</span></p>
        <p className="sc-tree-row off sc-in" style={delay(".55s")}><Lock />secrets<span className="mono">NEVER OPENED</span></p>
      </div>
    </div>
  );
}

export function NotesScene() {
  return (
    <div className="sc sc-notes">
      <div className="sc-stack sc-in" style={delay("0s")}>
        <p className="sc-note"><span className="mono">MEETING.MD</span>Call with Globex on Friday</p>
        <p className="sc-note"><span className="mono">TODO.MD</span>☐ Send the invoice</p>
        <p className="sc-note"><span className="mono">IDEAS.MD</span>A dark mode for the shop</p>
      </div>
      <div className="sc-link sc-flow sc-in" style={delay(".3s")} />
      <div className="sc-home sc-in" style={delay(".5s")}>
        <p className="mono sc-ask-head"><span className="sc-sq" />HOME · TODAY</p>
        <p className="sc-home-row">☐ Send the invoice</p>
        <p className="sc-home-row">☐ Call Globex · Fri</p>
        <p className="mono sc-home-sub">RECENT NOTES · 3</p>
      </div>
    </div>
  );
}

export function HearScene({ local }: { local: boolean }) {
  return (
    <div className="sc sc-hear">
      <svg className="sc-icon big sc-in" style={delay("0s")} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="17" y="6" width="14" height="24" rx="7" /><path d="M11 23a13 13 0 0 0 26 0M24 36v6M17 42h14" />
      </svg>
      <span className="sc-wave wide sc-in" style={delay(".2s")}><i /><i /><i /><i /><i /><i /><i /></span>
      <div className="sc-heard sc-in" style={delay(".45s")}>
        <p className="sc-ask-what">“Fix the typo on the prices page”</p>
        <p className={"mono sc-tile-state" + (local ? " good" : "")}>{local ? <><span className="sc-sq" />TURNED INTO TEXT ON THIS MAC</> : "SENT TO GOOGLE TO TURN INTO TEXT"}</p>
      </div>
    </div>
  );
}

export function SpeakScene({ engine }: { engine: string }) {
  return (
    <div className="sc sc-hear">
      <div className="sc-heard sc-in" style={delay("0s")}>
        <p className="mono sc-tile-state"><span className="sc-dot" />ORB</p>
        <p className="sc-ask-what">“Done. The typo is fixed.”</p>
      </div>
      <span className="sc-wave wide sc-in" style={delay(".25s")}><i /><i /><i /><i /><i /><i /><i /></span>
      <div className="sc-ear sc-in" style={delay(".45s")}>
        <svg className="sc-icon big" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 30v-6a15 15 0 0 1 30 0v6" /><rect x="7" y="28" width="8" height="12" rx="3" /><rect x="33" y="28" width="8" height="12" rx="3" />
        </svg>
        <span className="mono">{engine.toUpperCase()}</span>
      </div>
    </div>
  );
}

function Lock() {
  return (
    <svg className="sc-icon small" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="11" y="22" width="26" height="18" rx="3" /><path d="M17 22v-5a7 7 0 0 1 14 0v5" />
    </svg>
  );
}
