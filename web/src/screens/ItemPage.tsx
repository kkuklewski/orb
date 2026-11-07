import { useEffect, useState } from "react";
import { useViews } from "../stores/views";
import { archiveItem, openItems, startItem, useItems } from "../stores/items";
import { send } from "../ws";
import { trackerName, useFeatures } from "../stores/features";
import { Ext } from "./HomeForget";
import { Markdown } from "./chat/Markdown";

// One item (a task, a pull request, a repo with unsaved work). "Start in Orb" opens a new session in the repo it
// maps to, with the brief as the first request (Orb's approval cards and repo fence apply as usual), or in the Home
// chat (the notes folder) when no repo is mapped; "Copy prompt" puts the same brief on the clipboard for Cursor or a terminal.
// "Mark done": a tracker task is marked done there; a pull request is hidden in Orb until it changes (GitHub untouched).

export function ItemPage() {
  const { source, id, item } = useItems();
  const vault = useFeatures((s) => s.features?.vault);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [id]);
  if (!source || id === null) return null;
  const pr = source === "prs";
  const markDone = (done: boolean) => { archiveItem(source, id, done); send({ type: "item_get", source, id }); }; // handled in order: the change, then the page again
  const copy = () => navigator.clipboard?.writeText(item?.brief ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {});
  return (
    <section className="task" aria-label="Item">
      <div className="home-col">
        <nav className="task-nav mono" aria-label="Item navigation">
          <button type="button" className="linkish" onClick={() => useViews.setState({ view: "home" })}>← HOME</button>
          <button type="button" className="linkish" onClick={() => openItems(source)}>ALL →</button>
        </nav>
        <header className="task-head">
          <div className="mono home-kicker">// {item?.kicker ?? ""}{item?.done ? " · DONE" : ""}</div>
          <h1>{item?.title ?? "…"}</h1>
          {item && (
            <div className="task-chips mono">
              {item.chips.map((c) => <span key={c}>{c}</span>)}
              {item.url && <Ext href={item.url} className="">{item.url_label}</Ext>}
            </div>
          )}
        </header>
        <section className="task-actions" aria-label="Actions">
          <div className="task-buttons">
            <button type="button" className="hbtn dark big" disabled={!item} onClick={() => startItem(source, id)}>
              {item?.repo ? `Start in Orb · ${item.repo}` : item && vault ? "Start in Orb · Home chat" : "Start in Orb"}
            </button>
            <button type="button" className="hbtn big outline" disabled={!item} onClick={copy}>{copied ? "Copied ✓" : "Copy prompt"}</button>
            {item?.can_archive && (
              <button type="button" className="hbtn big outline" onClick={() => markDone(!item.done)}
                title={pr ? "Hides it in Orb until the pull request gets new activity; nothing is written to GitHub" : `Marks the task done in ${trackerName()}`}>
                {item.done ? "Undo done" : "Mark done"}
              </button>
            )}
          </div>
          <p className="mono task-say">
            {item && !item.repo ? (vault ? "No repo is mapped to this here, so it starts in the Home chat. " : "No repo is mapped to this here: choose a notes folder to start it in the Home chat, or copy the prompt. ") : ""}
            Start in Orb opens a new session that proposes a plan first; nothing changes until you agree.
            {item?.can_archive && pr ? (item.done ? " Marked done: hidden in Orb until it gets new activity." : " Mark done hides it in Orb until it gets new activity; GitHub is untouched.") : ""}
          </p>
        </section>
        <article className="hc" aria-label="Details">
          <div className="hc-head">
            <div className="hc-label mono">DETAILS</div>
            <h2>{item ? "What it says" : "Loading…"}</h2>
          </div>
          {item && <div className="vk-desc">{item.body ? <Markdown text={item.body} /> : <p className="hc-empty">Nothing more to show.</p>}</div>}
        </article>
      </div>
    </section>
  );
}
