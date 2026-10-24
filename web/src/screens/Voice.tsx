import { useEffect, useRef } from "react";
import { useConnection } from "../stores/connection";
import { useSession } from "../stores/session";
import { bargeText, dockLabel, dockState, nextBarge, pillLabel, setBarge, useVoice } from "../stores/voice";
import { pillPress, voiceLevel } from "../voice/controller";

// The voice pill (a recording-light dot, five level bars, one word) and the dock's state line.

function useDock() {
  const v = useVoice();
  const busy = useSession((s) => s.busy);
  const hasFolder = useSession((s) => !!s.folder);
  const online = useConnection((s) => s.state === "online");
  const st = dockState(v, busy, online);
  return { v, st, hasFolder };
}

const SHAPE = [0.45, 0.8, 1, 0.65, 0.35];

export function VoicePill() {
  const { v, st, hasFolder } = useDock();
  const bars = useRef<HTMLSpanElement>(null);
  const live = st === "listening" || st === "hearing" || st === "speaking";

  useEffect(() => { // the bars follow the mic, or her voice while she plays
    const el = bars.current;
    if (!el || !live || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const tick = () => {
      const lv = Math.min(1, voiceLevel() * 7), t = performance.now() / 160;
      [...el.children].forEach((b, i) => { (b as HTMLElement).style.height = `${2 + Math.round(14 * SHAPE[i] * Math.max(lv, 0.08) * (0.75 + 0.25 * Math.sin(t + i * 1.7)))}px`; });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); [...el.children].forEach((b) => ((b as HTMLElement).style.height = "")); };
  }, [live]);

  const label = pillLabel(st, hasFolder);
  return (
    <button type="button" className="orb" data-state={st} aria-pressed={v.micOn} aria-label={st === "speaking" ? "Stop speaking" : v.micOn ? "Turn the mic off" : "Talk"}
      title="Talk (Space) · Esc stops her" onClick={pillPress} disabled={v.starting}>
      <span className="vpill" aria-hidden="true">
        <span className="vp-dot" />
        <span className="vp-bars" ref={bars}><i /><i /><i /><i /><i /></span>
        <span className="vp-label">{v.starting ? "Starting…" : label}</span>
      </span>
    </button>
  );
}

export function DockState() {
  const { v, st, hasFolder } = useDock();
  return (
    <div className="dock-state mono" role="status">
      <span className={"state-dot " + (st === "hearing" ? "listening" : st)} />
      <span>{dockLabel(st, v, hasFolder)}</span>
    </div>
  );
}

// Barge-in = talking over her to cut her off. It lives in the top bar next to the speaker toggle.
export function BargeButton() {
  const v = useVoice();
  const tag = v.barge === "auto" ? "auto" : v.barge;
  return (
    <button type="button" className="icon-btn barge-btn" data-mode={v.barge} aria-pressed={v.barge === "off"} aria-label={bargeText(v)}
      title={`${bargeText(v)}. Barge-in lets you interrupt her by speaking while she talks. Auto arms it only with headphones, because on speakers the mic would hear her. Click to cycle auto → on → off. Esc or ■ always stops her.`}
      onClick={() => setBarge(nextBarge(v.barge))}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
      <span className="barge-tag mono" aria-hidden="true">{tag}</span>
      <span className="slash" aria-hidden="true" />
    </button>
  );
}
