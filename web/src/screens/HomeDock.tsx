import { useEffect, useRef, useState } from "react";
import { useChat } from "../stores/chat";
import { useFeatures } from "../stores/features";
import { useItems } from "../stores/items";
import { useBrain } from "../stores/brain";
import { useTasks } from "../stores/tasks";
import { useRoutineScreen } from "../stores/routine";
import { useSession } from "../stores/session";
import { useViews } from "../stores/views";
import { MAIN_MIN, aboutNow, bindVault, closeDock, columnCount, dockDest, dockLayout, dropAbout, useDock, type DockLayout } from "../stores/dock";
import { ChatLog } from "./chat/Chat";
import { Composer } from "./Composer";
import { DockState, VoicePill } from "./Voice";
import { useDragWidth } from "./dragWidth";
import { usePanelKind } from "./Panel";

/** The dock shows on this screen (re-renders when the view, its item source or the dock's state changes). */
export function useDockShown(): boolean {
  const view = useViews((s) => s.view);
  const source = useItems((s) => s.source);
  const open = useDock((s) => s.open);
  const d = dockDest(view, source);
  return !!d && !!open[d];
}

function useAbout() {
  const view = useViews((s) => s.view);
  useDock((s) => s.dropped);
  useBrain((s) => s.note); useTasks((s) => s.detail); useRoutineScreen((s) => s.id); useItems((s) => s.item); // the item it names
  return aboutNow(view);
}

const DEFAULT_W = 440;
const narrowQ = "(max-width: 900px)";
const mainMin = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--main-min")) || MAIN_MIN;

/** Where it sits for the main area's width: measured here, decided by dockLayout. */
function useLayout(ref: React.RefObject<HTMLElement | null>, dockW: number): DockLayout {
  const [mainW, setMainW] = useState(0);
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(narrowQ).matches ?? false);
  useEffect(() => {
    const m = window.matchMedia?.(narrowQ);
    const f = () => setNarrow(m.matches);
    m?.addEventListener("change", f);
    const main = ref.current?.parentElement;
    const ro = typeof ResizeObserver === "function" && main ? new ResizeObserver(() => setMainW(main.clientWidth)) : null;
    if (main) { setMainW(main.clientWidth); ro?.observe(main); }
    return () => { m?.removeEventListener("change", f); ro?.disconnect(); };
  }, [ref]);
  return dockLayout(mainW, dockW, narrow, mainMin());
}

/** The Home chat on the right of Brain, Tasks and Routines: over the screen (it never resizes what is under it), with its own
 *  scroll, composer and voice pill. */
export function HomeDock() {
  const ref = useRef<HTMLElement>(null);
  const width = useDragWidth("orb-dock-w");
  const layout = useLayout(ref, width.w ?? DEFAULT_W);
  const panel = usePanelKind() !== "none";
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const folder = useSession((s) => s.folder);
  const empty = useChat((s) => s.items.length === 0);
  const about = useAbout();
  useEffect(() => { if (vault && folder !== vault) bindVault(); }, [vault, folder]); // back on a screen with the dock: the Home chat again

  return (
    <aside ref={ref} className="home-dock" aria-label="Home chat" data-layout={layout} data-cols={columnCount(layout, panel)}
      style={width.w && layout !== "sheet" ? { width: width.w } : undefined}>
      {layout !== "sheet" && <div className="peek-grip" role="separator" aria-orientation="vertical" aria-label="Resize the Home chat (double-click to reset)" onPointerDown={width.drag} onDoubleClick={width.reset} />}
      <div className="peek-bar mono">
        <span className="dock-title">HOME CHAT</span>
        <button type="button" onClick={closeDock} aria-label="Close the Home chat">✕ CLOSE</button>
      </div>
      <div className="dock-log">
        {!vault ? <p className="side-hint">Set the Brain folder in Settings: the Home chat works in it.</p>
          : empty || folder !== vault ? <p className="side-hint">Ask about what's on screen. Type or talk below.</p> : <ChatLog />}
      </div>
      <footer className="dock">
        {about && (
          <div className="about-chip mono">
            <span className="about-text">about: {about.label}</span>
            <button type="button" aria-label={`Don't send ${about.label} with the next request`} onClick={() => dropAbout(about.key)}>✕</button>
          </div>
        )}
        <DockState />
        <div className="dock-row"><Composer lead={<VoicePill />} /></div>
      </footer>
    </aside>
  );
}
