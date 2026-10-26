import { useEffect, useId, useState, type ReactNode } from "react";
import { isPinned, pinOfRow, togglePin, usePins, type Pin } from "../stores/pins";
import { useFeatures } from "../stores/features";
import { askIn } from "../stores/session";

/** "Ask about this": a new session in the notes folder; the tile's own lines go along as the screen, not in the question. */
export type TileAsk = { question: string; name: string; text: string };

// The ruled card Home is built from: a mono label, a title, rows, and an optional grey footer bar.
export function Card({ label, title, mark, children, foot, id, className, ask, tabs }: { ask?: TileAsk; tabs?: ReactNode; label: string; title: string; mark?: boolean; children?: ReactNode; foot?: ReactNode; id?: string; className?: string }) {
  const vault = useFeatures((s) => s.features?.vault);
  return (
    <article className={"hc" + (className ? " " + className : "")} aria-label={title} id={id}>
      {tabs}
      <div className="hc-head">
        {label && <div className={"hc-label mono" + (mark ? " mark" : "")}>{mark && <span className="sq" />}{label}</div>}
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

/** "p" pins (or unpins) the dashboard row that has focus. */
export function usePinKey() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "p" || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      const row = el.closest<HTMLElement>("[data-pin-kind]");
      if (!row) return;
      e.preventDefault();
      togglePin(pinOfRow(row));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
}

/** One open row per card: `toggle(id)` opens it and closes the one that was open. */
export function useAccordion() {
  const [open, setOpen] = useState<string | null>(null);
  return { open, toggle: (id: string) => setOpen((o) => (o === id ? null : id)) };
}

/** Height 0 -> auto without measuring (grid rows animate); closed content is inert, so Tab skips it. */
export function Collapse({ open, id, children }: { open: boolean; id?: string; children: ReactNode }) {
  return (
    <div className={"collapse" + (open ? " open" : "")} id={id} inert={!open}>
      <div className="collapse-in">{children}</div>
    </div>
  );
}

/** A Home row that opens in place: collapsed it is one line (dot, text, side note); expanded it shows `facts` and `actions`. */
export function AccRow({ rowId, open, onToggle, text, side, dot, className = "", pin, facts, actions }: {
  rowId: string; open: boolean; onToggle: (id: string) => void; text: ReactNode; side?: ReactNode; dot?: ReactNode; className?: string; pin?: Pin;
  facts?: [string, ReactNode][]; actions?: ReactNode;
}) {
  const panel = useId();
  return (
    <div className={"acc " + className + (open ? " open" : "")} {...(pin ? { "data-pin-kind": pin.kind, "data-pin-id": pin.id, "data-pin-label": pin.label } : {})}>
      <div className="hc-row acc-head">
        {dot ?? <span className="hc-dot" />}
        <button type="button" className="hc-text" aria-expanded={open} aria-controls={panel} onClick={() => onToggle(rowId)}>{text}</button>
        <span className="hc-side mono">{side}</span>
        {pin && <PinButton {...pin} />}
        <span className="acc-chev" aria-hidden="true" />
      </div>
      <Collapse open={open} id={panel}>
        {facts && !!facts.length && (
          <dl className="acc-facts">
            {facts.map(([k, v]) => <div key={k}><dt className="mono">{k}</dt><dd>{v}</dd></div>)}
          </dl>
        )}
        {actions && <div className="acc-actions">{actions}</div>}
      </Collapse>
    </div>
  );
}
