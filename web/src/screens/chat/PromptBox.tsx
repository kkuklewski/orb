import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The prompt made from the picked list items, editable (add your own lines) and copied for a terminal. Picking or
// dropping an item rebuilds the generated part and keeps what you typed after it; if you edited inside it, the box
// keeps your text and offers Rebuild instead. Over plain http (an iPad on the LAN) there is no Clipboard API: the
// text is selected and copied the old way.

export function PromptBox({ host, generated, count, onClose }: { host: HTMLElement; generated: string; count: number; onClose: () => void }) {
  const [text, setText] = useState(generated);
  const [state, setState] = useState<"" | "copied" | "manual">("");
  const [stale, setStale] = useState(false);
  const base = useRef(generated);  // the generated text `text` was built from
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);  // ready for your own lines at the end
    el.scrollIntoView?.({ block: "nearest" });
  }, []);

  useEffect(() => {
    if (generated === base.current) { setStale(false); return; }
    if (text.startsWith(base.current)) {
      setText(generated + text.slice(base.current.length));
      base.current = generated;
      setStale(false);
    } else setStale(true);
  }, [generated]);  // only a new pick rebuilds, not typing

  const rebuild = () => { setText(generated); base.current = generated; setStale(false); };

  const copy = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch { /* not a secure context, or refused */ }
    if (!ok && box.current) {
      box.current.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
    }
    setState(ok ? "copied" : "manual");
    if (ok) setTimeout(() => setState(""), 1500);
  };

  const hint = state === "manual" ? "Selected: copy it with your keyboard"
    : stale ? "Picks changed after your edits"
    : count > 1 ? `${count} items · add more with >_, or your own lines`
    : "Add more items with >_, or your own lines";

  return createPortal(
    <div className="item-prompt" role="group" aria-label="Prompt for your CLI">
      <textarea ref={box} value={text} aria-label="Prompt" rows={Math.min(14, text.split("\n").length + 2)}
        onChange={(e) => { setText(e.target.value); setState(""); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void copy(); }
        }} />
      <div className="item-prompt-bar">
        <span className="hint">{hint}</span>
        {stale && <button type="button" title="Replace the text with the picked items (drops your edits)" onClick={rebuild}>Rebuild</button>}
        <button type="button" className="primary" onClick={() => void copy()}>{state === "copied" ? "Copied" : "Copy prompt"}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>,
    host,
  );
}
