// The pictures on Control's four rule screens. Decorative (the rule's text says it all), drawn in the
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
