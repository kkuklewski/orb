// "Prompt" on a list item of an answer: the item, with the heading and parent items it sits under, as a prompt
// to paste into a Claude Code terminal in that repo. Reads the rendered (sanitized) markdown, never the source.

const MINE = ".li-prompt, .item-prompt-host";  // Orb's own additions inside a list item
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const isList = (n: Node): n is HTMLElement => n.nodeName === "UL" || n.nodeName === "OL";

/** Text of a node as a prompt reads well: inline code keeps its backticks, blocks are kept apart. */
function words(n: Node): string {
  if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
  if (!(n instanceof Element) || isList(n) || n.matches(MINE)) return "";
  if (n.nodeName === "CODE") return "`" + (n.textContent ?? "") + "`";
  if (n.nodeName === "BR") return " ";
  const inner = [...n.childNodes].map(words).join("");
  return /^(P|DIV|PRE|BLOCKQUOTE|H[1-6])$/.test(n.nodeName) ? ` ${inner} ` : inner;
}

/** The item's own words, without its nested lists or Orb's buttons. */
const ownText = (li: Element) => squash([...li.childNodes].map(words).join(""));

/** The item and its nested items, one line each, nested ones indented as a markdown list. */
function itemLines(li: Element, depth = 0): string[] {
  const own = ownText(li);
  const lines = own ? [(depth ? "  ".repeat(depth - 1) + "- " : "") + own] : [];
  for (const list of li.children) {
    if (!isList(list)) continue;
    for (const sub of list.children) if (sub.nodeName === "LI") lines.push(...itemLines(sub, depth + 1));
  }
  return lines;
}

/** A heading, or a paragraph that is only bold text ("**Urgent**"), which models use as one. */
function headingText(el: Element): string | null {
  if (/^H[1-6]$/.test(el.nodeName)) return squash(el.textContent ?? "");
  if (el.nodeName !== "P") return null;
  const strong = el.children.length === 1 && el.firstElementChild?.nodeName === "STRONG" ? el.firstElementChild : null;
  const text = squash(el.textContent ?? "");
  return strong && squash(strong.textContent ?? "") === text ? text.replace(/:$/, "") : null;
}

export interface ItemContext { section: string | null; lead: string | null; parents: string[]; item: string }

export function itemContext(li: HTMLElement, root: HTMLElement): ItemContext {
  const parents: string[] = [];
  let top: HTMLElement = li;
  for (let p = li.parentElement; p && p !== root; p = p.parentElement) {
    if (p.nodeName === "LI") { const t = ownText(p).replace(/:$/, ""); if (t) parents.unshift(t); }
    top = p;
  }
  // The list's top-level block: the nearest heading above it, and the sentence just before it if it leads in (ends with ":").
  let section: string | null = null;
  let lead: string | null = null;
  const before = top.previousElementSibling;
  if (before?.nodeName === "P" && !headingText(before) && /:\s*$/.test(before.textContent ?? "")) lead = squash(before.textContent ?? "").replace(/:$/, "");
  for (let s = top.previousElementSibling; s; s = s.previousElementSibling) {
    const h = headingText(s);
    if (h) { section = h; break; }
  }
  return { section, lead, parents, item: itemLines(li).join("\n") };
}

export function buildPrompt(c: ItemContext, where: { repo: string; branch: string | null }): string {
  const lines: string[] = [];
  if (where.repo) lines.push(`Repo: ${where.repo}${where.branch ? `, branch ${where.branch}` : ""}`);
  const under = [c.section, c.lead, ...c.parents].filter(Boolean).join(" › ");
  if (under) lines.push(`From a list of next steps, under: ${under}`);
  return [lines.join("\n"), c.item, "Check where this stands now, then tell me the next step before you change anything."]
    .filter(Boolean).join("\n\n");
}
