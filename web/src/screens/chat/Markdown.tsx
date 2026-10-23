import { memo, useEffect, useRef, useState } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";

// Claude's markdown: marked (GFM) → DOMPurify → the DOM. Code blocks get highlighting (highlight.js,
// loaded the first time a block needs it), their language and a copy button; links open in a new
// tab. While text streams in, rendering is throttled to one pass per 50 ms.
const md = new Marked({ gfm: true, breaks: false });

export function toSafeHtml(text: string): string {
  return DOMPurify.sanitize(md.parse(text, { async: false }));
}

let hljs: Promise<typeof import("highlight.js/lib/common").default> | null = null;
const highlighter = () => (hljs ??= import("highlight.js/lib/common").then((m) => m.default));

const COPY = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3Zm2 0h4a2 2 0 0 1 2 2v4h3V5h-9v3Zm-5 2v9h9v-9H5Z"/></svg>';

export async function copyText(text: string, btn?: HTMLElement | null) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  if (btn) { btn.classList.add("done"); setTimeout(() => btn.classList.remove("done"), 1200); }
}

function enhance(root: HTMLElement) {
  root.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    const wrap = document.createElement("div");
    wrap.className = "code";
    pre.replaceWith(wrap);
    wrap.append(pre);
    const lang = code?.className.match(/language-(\S+)/)?.[1];
    if (code && lang) {
      highlighter().then((h) => {
        if (code.isConnected && h.getLanguage(lang)) { try { h.highlightElement(code); } catch { /* bad grammar */ } }
      }).catch(() => { /* stays plain */ });
    }
    if (lang) { const l = document.createElement("span"); l.className = "lang"; l.textContent = lang; wrap.append(l); }
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "copy"; btn.title = "Copy"; btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = COPY;
    btn.onclick = () => copyText((code ?? pre).textContent ?? "", btn);
    wrap.append(btn);
  });
  root.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener noreferrer"; });
}

function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) { last.current = Date.now(); setShown(value); return; }
    const t = setTimeout(() => { last.current = Date.now(); setShown(value); }, wait);
    return () => clearTimeout(t);
  }, [value, ms]);
  return shown;
}

export const Markdown = memo(function Markdown({ text, live = false, className = "md" }: { text: string; live?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const throttled = useThrottled(text, 50);
  const shown = live ? throttled : text;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = toSafeHtml(shown);
    enhance(el);
  }, [shown]);
  return <div className={className} ref={ref} />;
});
