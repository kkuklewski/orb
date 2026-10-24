import { useEffect, type ReactNode } from "react";
import { isPinned, togglePin, usePins, type Pin, type PinKind } from "../stores/pins";
import { useFeatures } from "../stores/features";
import { askIn } from "../stores/session";

/** "Ask about this": a new session in the notes folder; the tile's own lines go along as the screen, not in the question. */
export type TileAsk = { question: string; name: string; text: string };

// The ruled card Home is built from: a mono label, a title, rows, and an optional grey footer bar.
export function Card({ label, title, mark, children, foot, id, className, ask }: { ask?: TileAsk; label: string; title: string; mark?: boolean; children?: ReactNode; foot?: ReactNode; id?: string; className?: string }) {
  const vault = useFeatures((s) => s.features?.vault);
  return (
    <article className={"hc" + (className ? " " + className : "")} aria-label={title} id={id}>
      <div className="hc-head">
        <div className={"hc-label mono" + (mark ? " mark" : "")}>{mark && <span className="sq" />}{label}</div>
        <h2>{title}</h2>
        {ask && vault && <button type="button" className="hc-ask mono" onClick={() => askIn(vault, ask.question, { name: ask.name, text: ask.text }, true)}>Ask about this →</button>}
      </div>
      {children}
      {foot && <div className="hc-foot mono">{foot}</div>}
    </article>
  );
}

/** A pin toggle for one dashboard row (hover / focus on desktop, always visible on touch; "p" pins the focused row). */
export function PinButton({ kind, id, label }: Pin) {
  const on = usePins((s) => isPinned(s.pins, { kind, id }));
  return (
    <button type="button" className={"pin-btn" + (on ? " on" : "")} aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"}: ${label}`} title={on ? "Unpin (p)" : "Pin (p)"}
      onClick={(e) => { e.stopPropagation(); togglePin({ kind, id, label }); }}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7" /></svg>
    </button>
  );
}

/** A dashboard row that opens something on click and can be pinned. The whole row is clickable with a mouse; the text is the keyboard stop. */
export function PinRow({ pin, onOpen, text, side, dot, className = "", title, sideTitle }: { pin: Pin; onOpen: () => void; text: ReactNode; side?: ReactNode; dot?: ReactNode; className?: string; title?: string; sideTitle?: string }) {
  return (
    <div className={"hc-row pinnable " + className} data-pin-kind={pin.kind} data-pin-id={pin.id} data-pin-label={pin.label} title={title}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a, input")) onOpen(); }}>
      {dot}
      <button type="button" className="hc-text" onClick={onOpen}>{text}</button>
      <span className="hc-side mono" title={sideTitle}>{side}</span>
      <PinButton {...pin} />
    </div>
  );
}

/** "p" pins (or unpins) the dashboard row that has focus. */
export function usePinKey() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "p" || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      const row = el.closest<HTMLElement>("[data-pin-kind]");
      if (!row) return;
      e.preventDefault();
      togglePin({ kind: row.dataset.pinKind as PinKind, id: row.dataset.pinId ?? "", label: row.dataset.pinLabel ?? "" });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}
