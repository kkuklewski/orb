import { useEffect, useState } from "react";
import { useViews } from "../stores/views";
import { OTHER, START, openItems, startItem, startWhere, useItems, type StartWhere } from "../stores/items";
import { useFeatures } from "../stores/features";
import { useHome } from "../stores/home";
import { Ext } from "./HomeForget";
import { CliLine, CliMark } from "./HomeLead";
import { Markdown } from "./chat/Markdown";

// One item (a task, a pull request, a repo with unsaved work). "Start in CLI" runs a background Claude Code session
// (`claude --bg`, the `claude agents` view) in the repo it maps to with the brief as the prompt; "Start in Orb" opens
// a new Orb session there with the brief as the first request (Orb's approval cards and repo fence apply as usual).
// Either goes to the notes folder when no repo is mapped. The settings' "start_in" names the big button. "Copy
// prompt" puts the same brief on the clipboard for Cursor or a terminal. The CLI's answer (useHome.cli) belongs to
// the item it was started from: opening another item clears it.

const label = (where: StartWhere, repo: string | null | undefined, vault: boolean, loaded: boolean) =>
  repo ? `${START[where]} · ${repo}` : loaded && vault ? `${START[where]} · notes folder` : START[where];

export function ItemPage() {
  const { source, id, item } = useItems();
  const vault = useFeatures((s) => s.features?.vault);
  useFeatures((s) => s.features?.start_in);
  const where = startWhere();
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); useHome.setState({ cli: null }); }, [id]);
  if (!source || id === null) return null;
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
            <button type="button" className="hbtn dark big" disabled={!item} onClick={() => startItem(source, id, where)}>
              {where === "cli" && <CliMark />}{label(where, item?.repo, !!vault, !!item)}
            </button>
            <button type="button" className="hbtn big" disabled={!item} onClick={() => startItem(source, id, OTHER[where])}>{OTHER[where] === "cli" && <CliMark />}{START[OTHER[where]]}</button>
            <button type="button" className="hbtn big outline" disabled={!item} onClick={copy}>{copied ? "Copied ✓" : "Copy prompt"}</button>
          </div>
          <p className="mono task-say">
            {item && !item.repo ? (vault ? "No repo is mapped to this here, so it starts in the notes folder. " : "No repo is mapped to this here: choose a notes folder to start it there, or copy the prompt. ") : ""}
            Start in CLI runs a background Claude Code session on this prompt in your terminal (it shows in <code>claude agents</code>);
            Start in Orb opens a new session here that proposes a plan first; nothing changes until you agree.
          </p>
          <CliLine />
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
