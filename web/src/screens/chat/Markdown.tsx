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

// ```mermaid blocks become diagrams. Mermaid loads on first use and draws with the page's current colours. The
// page's CSP forbids inline styles, so the SVG's <style> goes into a constructable stylesheet (CSSOM, allowed) and
// style="" attributes are re-applied through .style; the SVG is inline, so its labels can be selected and copied.
let mermaid: Promise<typeof import("mermaid").default> | null = null;
const diagrams = new Map<string, SVGElement>();  // source + theme -> drawn SVG (cloned per use)
let diagramSeq = 0;
// A fence tagged mermaid, or (models forget the tag) an untagged one that opens with a diagram keyword.
const DIAGRAM_START = /^\s*(flowchart|graph|sequenceDiagram|stateDiagram(-v2)?|erDiagram|classDiagram|gantt|pie|mindmap|timeline|journey|gitGraph)\b/;
const isDiagram = (code: Element | null) => !!code && (code.classList.contains("language-mermaid") || (!/language-/.test(code.className) && DIAGRAM_START.test(code.textContent ?? "")));

const DIAGRAM_FONT = 'ui-sans-serif, system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

function themeVars() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { background: v("--bg", "#111"), primaryColor: v("--bg-elev", "#1c1c1c"), primaryTextColor: v("--text", "#eee"), primaryBorderColor: v("--line", "#444"),
           lineColor: v("--text-2", "#999"), secondaryColor: v("--side", "#181818"), tertiaryColor: v("--side", "#181818"), fontFamily: DIAGRAM_FONT, fontSize: "14px" };
}

// Inline style="" on the drawn SVG: nothing that loads, overlays or generates content.
const UNSAFE_CSS = /@import|url\(|expression\(|position\s*:\s*(fixed|absolute|sticky)|content\s*:/i;
// The diagram's own <style> sheet: every rule is confined to #orb-dg-N (scopedSheet), so Mermaid's own absolute-positioned
// tooltip is fine; loads (url() other than a #fragment, which Mermaid uses for gradients) and fixed overlays are still refused.
export const UNSAFE_SHEET = /@import|url\((?!\s*["']?#)|expression\(|position\s*:\s*fixed/i;

/** The diagram's CSS as a sheet, only if every rule is scoped to this diagram's own id (or is a keyframes rule): the
 *  sheet is adopted document-wide, so a rule like `body{...}` smuggled in through a theme setting must not get in. */
export function scopedSheet(css: string, id: string): CSSStyleSheet | null {
  const sheet = new CSSStyleSheet();
  try { sheet.replaceSync(css); } catch { return null; }
  const own = (sel: string) => { const t = sel.trim(); return t === `#${id}` || new RegExp(`^#${id}(?![\\w-])`).test(t); };
  const ok = [...sheet.cssRules].every((r) => r instanceof CSSKeyframesRule || (r instanceof CSSStyleRule && r.selectorText.split(",").every(own)));
  return ok ? sheet : null;
}

/** Mermaid reads per-diagram config from `%%{init}%%` directives and from a leading `---` frontmatter block; both can
 *  set theme CSS, so neither is accepted. */
export const hasConfig = (src: string) => /%%\{/.test(src) || /^\s*---/.test(src);

// Settings a diagram's own text may never change, whatever route it takes (directive, frontmatter, init).
const SECURE = ["secure", "securityLevel", "startOnLoad", "suppressErrorRendering", "maxTextSize", "maxEdges", "theme", "themeCSS", "themeVariables", "fontFamily"];

async function drawDiagram(src: string): Promise<SVGElement> {
  const vars = themeVars();
  const key = src + JSON.stringify(vars);
  const hit = diagrams.get(key);
  if (hit) return hit.cloneNode(true) as SVGElement;
  const m = await (mermaid ??= import("mermaid").then((x) => x.default));
  m.initialize({ startOnLoad: false, suppressErrorRendering: true, securityLevel: "strict", theme: "base", themeVariables: vars,
    fontFamily: DIAGRAM_FONT, flowchart: { htmlLabels: false, useMaxWidth: false, padding: 14, nodeSpacing: 40, rankSpacing: 50 },
    sequence: { useMaxWidth: false }, er: { useMaxWidth: false }, state: { useMaxWidth: false }, gantt: { useMaxWidth: false }, secure: SECURE });
  if (hasConfig(src)) throw new Error("diagram directives and frontmatter are not allowed");
  const id = `orb-dg-${diagramSeq++}`;
  let svg: string;
  try {
    await m.parse(src);  // throws on half-written or invalid source, before anything is drawn
    ({ svg } = await m.render(id, src));
  } finally {
    document.getElementById(id)?.remove();  // Mermaid leaves its scratch (or error) element in <body>
    document.getElementById(`d${id}`)?.remove();
  }
  const el = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement as unknown as SVGElement;
  const css = [...el.querySelectorAll("style")].map((st) => { const t = st.textContent ?? ""; st.remove(); return t; }).join("\n");
  if (UNSAFE_SHEET.test(css)) throw new Error("diagram style refused");  // no loads; scoping (below) keeps every rule inside this diagram
  const sheet = scopedSheet(css, id);
  if (!sheet) throw new Error("diagram style refused");  // a rule outside #orb-dg-N
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  diagrams.set(key, el);
  return el.cloneNode(true) as SVGElement;
}

const COPY = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 8V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-3v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3Zm2 0h4a2 2 0 0 1 2 2v4h3V5h-9v3Zm-5 2v9h9v-9H5Z"/></svg>';

export async function copyText(text: string, btn?: HTMLElement | null) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  if (btn) { btn.classList.add("done"); setTimeout(() => btn.classList.remove("done"), 1200); }
}

function enhance(root: HTMLElement) {
  root.querySelectorAll("pre").forEach((pre) => {
    const code = pre.querySelector("code");
    if (isDiagram(code)) {  // a diagram; if it doesn't parse (still streaming), it stays a code block
      drawDiagram(code!.textContent ?? "").then((svg) => {
        if (!pre.isConnected) return;
        svg.querySelectorAll<SVGElement>("[style]").forEach((n) => { const css = n.getAttribute("style") ?? ""; n.removeAttribute("style"); if (!UNSAFE_CSS.test(css)) n.style.cssText = css; });
        const fig = document.createElement("figure");
        fig.className = "diagram";
        fig.append(document.importNode(svg, true));
        pre.replaceWith(fig);
      }).catch(() => { /* not valid (yet): keep the source */ });
      return;
    }
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
