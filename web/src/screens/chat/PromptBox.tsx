import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// The prompt made from one list item, editable (add your own lines) and copied for a terminal. It opens inside the
// item. Over plain http (an iPad on the LAN) there is no Clipboard API: the text is selected and copied the old way.

export function PromptBox({ host, initial, onClose }: { host: HTMLElement; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [state, setState] = useState<"" | "copied" | "manual">("");
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);  // ready for your own lines at the end
    el.scrollIntoView?.({ block: "nearest" });
  }, []);

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

  return createPortal(
    <div className="item-prompt" role="group" aria-label="Prompt for your CLI">
      <textarea ref={box} value={text} aria-label="Prompt" rows={Math.min(12, text.split("\n").length + 2)}
        onChange={(e) => { setText(e.target.value); setState(""); }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); onClose(); }
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void copy(); }
        }} />
      <div className="item-prompt-bar">
        <span className="hint">{state === "manual" ? "Selected: copy it with your keyboard" : "Add your own lines, then copy"}</span>
        <button type="button" className="primary" onClick={() => void copy()}>{state === "copied" ? "Copied" : "Copy prompt"}</button>
        <button type="button" onClick={onClose}>Close</button>
      </div>
    </div>,
    host,
  );
}
