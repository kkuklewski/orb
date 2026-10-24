import type { ReactNode } from "react";
import type { DirtyRepo, Reminder } from "../protocol.gen";
import { askIn } from "../stores/session";
import { dueSoon, LEFT_BEHIND, quietPrs, SOON, useHome } from "../stores/home";
import { Card } from "./HomeCard";
import { openItem, openItems } from "../stores/items";

// Home's "don't forget" cards (server: watch.summary): dated reminders and stale pull requests, repos with
// unsaved work, the open tasks in Vikunja and pinned links. Each hides itself when it has nothing to show.

const PRS_SHOWN = 4;

export const ASK_UNSAVED = "Show me what's uncommitted or not pushed in this repo, and propose how to commit it (grouped into sensible commits). Don't commit or push until I say so.";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export function dueText(r: Pick<Reminder, "days">): string {
  const d = r.days!;
  return d < 0 ? `${plural(-d, "day")} overdue` : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
}

export function repoText(r: DirtyRepo): string {
  return [r.ahead ? `${r.ahead} unpushed` : null, r.changed ? `${r.changed} changed` : null, r.ahead === null ? "no upstream" : null]
    .filter(Boolean).join(" · ");
}

export const Ext = ({ href, children, className = "hc-text" }: { href: string; children: ReactNode; className?: string }) =>
  <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;

export function DontForget() {
  const w = useHome((s) => s.watch);
  if (!w) return null;
  const { recent, old } = quietPrs(w);
  if (!w.reminders.length && !recent.length && !old.length) return null;
  const soon = dueSoon(w);
  const shown = recent.slice(0, PRS_SHOWN);
  const more = recent.length - shown.length + old.length;
  return (
    <Card id="forget" ask={{ name: "Don't forget", question: "What here do I need to act on this week, in order?",
      text: [...w.reminders.map((r) => `${r.text} (${r.days != null ? dueText(r) : "no date"})`), ...shown.map((p) => `PR ${p.repo}#${p.number} ${p.title} (${p.idle_days}d quiet)`)].join("\n") }} label="DON'T FORGET" mark={soon > 0}
      title={soon ? `${plural(soon, "thing")} need${soon === 1 ? "s" : ""} you this week` : `${plural(w.reminders.length + recent.length, "thing")} to keep in mind`}
      foot={<><span>{w.prs.length ? `${plural(w.prs.length, "open pull request")} · ${recent.length + old.length} gone quiet` : "no open pull requests"}</span><span>reminders: settings.json</span></>}>
      {w.reminders.map((r, i) => {
        const near = r.days !== null && r.days !== undefined && r.days <= SOON;
        return (
          <div key={`r${i}`} className={"hc-row" + (near ? " needs" : "")}>
            <span className={"hc-dot" + (near ? " sq" : "")} />
            {r.url ? <Ext href={r.url}>{r.text}</Ext> : <span className="hc-text">{r.text}</span>}
            <span className="hc-side mono">{r.days !== null && r.days !== undefined ? dueText(r) : "no date"}</span>
          </div>
        );
      })}
      {shown.map((p) => (
        <div key={p.url} className="hc-row">
          <span className="hc-dot" />
          <button type="button" className="hc-text" onClick={() => openItem("prs", `${p.repo}#${p.number}`)}>PR #{p.number} · {p.title}</button>
          <span className="hc-side mono" title={`${p.repo}, no activity for ${p.idle_days} days${p.draft ? " (draft)" : ""}`}>{p.repo.split("/").pop()} · {p.idle_days}d</span>
        </div>
      ))}
      {more > 0 && (
        <div className="hc-row">
          <span className="hc-dot" />
          <button type="button" className="hc-text" onClick={() => openItems("prs")}>{more} more pull request{more === 1 ? "" : "s"} {old.length === more ? `quiet over ${LEFT_BEHIND} days` : "gone quiet"}</button>
          <span className="hc-side mono">All →</span>
        </div>
      )}
    </Card>
  );
}

export function Unsaved() {
  const repos = useHome((s) => s.watch?.repos);
  if (!repos?.length) return null;
  const unpushed = repos.filter((r) => r.ahead).length;
  return (
    <Card id="unsaved" ask={{ name: "Not saved yet", question: "Which repos have unsaved work that matters most, and what should I do about each?",
      text: repos.slice(0, 8).map((r) => `${r.label}: ${repoText(r)}`).join("\n") }} label="NOT SAVED YET" title={`${plural(repos.length, "repo")} with unsaved work`}
      foot={<><span>{unpushed ? `${plural(unpushed, "repo")} with commits not pushed` : "everything committed is pushed"}</span><button type="button" onClick={() => openItems("repos")}>All repos →</button></>}>
      {repos.slice(0, 8).map((r) => (
        <button key={r.path} type="button" className="hc-row" title={r.path} onClick={() => askIn(r.path, ASK_UNSAVED)}>
          <span className="hc-dot" />
          <span className="hc-text">{r.label}{r.branch && r.branch !== "main" && r.branch !== "master" ? ` · ${r.branch}` : ""}</span>
          <span className="hc-side mono">{repoText(r)}</span>
        </button>
      ))}
    </Card>
  );
}

export function TrackerTasks() {
  const tr = useHome((s) => s.watch?.tracker);
  if (!tr) return null;
  return (
    <Card id="todo" ask={{ name: "Vikunja tasks", question: "Which of my open tasks should I do first, and why?",
      text: tr.tasks.map((t) => `#${t.id} ${t.title} (${[t.project, t.due ? `due ${t.due}` : null].filter(Boolean).join(", ") || "no project"})`).join("\n") || "none" }} label="TO DO · VIKUNJA" title={`${plural(tr.total, "open task")}, most urgent first`}
      foot={<><span>{tr.total > tr.tasks.length ? `+ ${tr.total - tr.tasks.length} more` : "that's all of them"}</span><button type="button" onClick={() => openItems("vikunja")}>All tasks →</button></>}>
      {tr.tasks.map((t) => (
        <div key={t.id} className={"hc-row" + (t.priority >= 4 ? " needs" : "")}>
          <span className={"hc-dot" + (t.priority >= 4 ? " sq" : "")} />
          <button type="button" className="hc-text" onClick={() => openItem("vikunja", String(t.id))}>{t.title}</button>
          <span className="hc-side mono" title={t.project}>{[t.project, t.due ? `due ${t.due.slice(5)}` : null].filter(Boolean).join(" · ")}</span>
        </div>
      ))}
      {!tr.tasks.length && <p className="hc-empty">No open tasks in Vikunja.</p>}
    </Card>
  );
}

export function Links() {
  const links = useHome((s) => s.watch?.links);
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
