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
      <button type="button" className="barge mono" title="Click to cycle barge-in: auto (headphones only) → on → off. On speakers, Esc or ■ stops her."
        onClick={() => setBarge(nextBarge(v.barge))}>{bargeText(v)}</button>
    </div>
  );
}
