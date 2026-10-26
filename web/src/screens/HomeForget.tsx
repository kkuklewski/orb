import type { ReactNode } from "react";
import type { Reminder } from "../protocol.gen";
import { dueSoon, LEFT_BEHIND, quietPrs, SOON, useHome } from "../stores/home";
import { AccRow, useAccordion } from "./HomeCard";
import type { Pane } from "./HomeTabs";
import { openItem, openItems } from "../stores/items";

// Home's Don't forget pane (server: forget.summary): dated reminders and stale pull requests (a pane of the status
// card, see HomeTabs), and the pinned links. Each hides itself when it has nothing to show.

const PRS_SHOWN = 4;

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function dueText(r: Pick<Reminder, "days">): string {
  const d = r.days!;
  return d < 0 ? `${plural(-d, "day")} overdue` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

export const Ext = ({ href, children, className = "hc-text" }: { href: string; children: ReactNode; className?: string }) =>
  <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

export function useForgetPane(): Pane | null {
  const acc = useAccordion();
  const w = useHome((s) => s.forget);
  if (!w) return null;
  const { recent, old } = quietPrs(w);
  if (!w.reminders.length && !recent.length && !old.length) return null;
  const soon = dueSoon(w);
  const shown = recent.slice(0, PRS_SHOWN);
  const more = recent.length - shown.length + old.length;
  return {
    key: "forget", tab: "Don't forget", count: w.reminders.length + recent.length + old.length, mark: soon > 0,
    ask: { name: "Don't forget", question: "What here do I need to act on this week, in order?",
      text: [...w.reminders.map((r) => `${r.text} (${r.days != null ? dueText(r) : "no date"})`), ...shown.map((p) => `PR ${p.repo}#${p.number} ${p.title} (${p.idle_days}d quiet)`)].join("\n") },
    title: soon ? `${plural(soon, "thing")} need${soon === 1 ? "s" : ""} you this week` : `${plural(w.reminders.length + recent.length, "thing")} to keep in mind`,
    foot: <><span>{w.prs.length ? `${plural(w.prs.length, "open pull request")} · ${recent.length + old.length} gone quiet` : "no open pull requests"}</span><span>reminders: settings.json</span></>,
    body: <>
      {w.reminders.map((r, i) => {
        const near = r.days !== null && r.days !== undefined && r.days <= SOON;
        const due = r.days !== null && r.days !== undefined ? dueText(r) : "no date";
        return (
          <AccRow key={`r${i}`} rowId={`r${i}`} open={acc.open === `r${i}`} onToggle={acc.toggle} className={near ? "needs" : ""} dot={<span className={"hc-dot" + (near ? " sq" : "")} />}
            text={r.text} side={due} facts={[["Reminder", r.text], ["Due", due]]}
            actions={r.url ? <Ext href={r.url} className="hbtn dark">Open link</Ext> : undefined} />
        );
      })}
      {shown.map((p) => {
        const id = `${p.repo}#${p.number}`;
        return (
          <AccRow key={p.url} rowId={p.url} open={acc.open === p.url} onToggle={acc.toggle} pin={{ kind: "pr", id, label: id }} dot={<span className="hc-dot" />}
            text={<>PR #{p.number} · {p.title}</>} side={<>{p.repo.split("/").pop()} · {p.idle_days}d</>}
            facts={[["Repo", p.repo], ["Quiet", `no activity for ${p.idle_days} days${p.draft ? " (draft)" : ""}`]]}
            actions={<><button type="button" className="hbtn dark" onClick={() => openItem("prs", id)}>Open in Orb</button><Ext href={p.url} className="hbtn">GitHub</Ext></>} />
        );
      })}
      {more > 0 && (
        <div className="hc-row">
          <span className="hc-dot" />
          <button type="button" className="hc-text" onClick={() => openItems("prs")}>{more} more pull request{more === 1 ? "" : "s"} {old.length === more ? `quiet over ${LEFT_BEHIND} days` : "gone quiet"}</button>
          <span className="hc-side mono">All →</span>
        </div>
      )}
    </>,
  };
}

export function Links() {
  const links = useHome((s) => s.forget?.links);
  if (!links?.length) return null;
  return (
    <section className="home-links" aria-label="Links">
      <span className="mono home-kicker">// LINKS</span>
      <div className="link-chips">
        {links.map((l) => <Ext key={l.url} href={l.url} className="link-chip">{l.label}</Ext>)}
      </div>
    </section>
  );
}
