import { useEffect, useState } from "react";
import { useViews } from "../stores/views";
import { startVikunjaTask, useVikunja } from "../stores/vikunja";
import { Ext } from "./HomeWatch";
import { Markdown } from "./chat/Markdown";

// One task from Vikunja. "Start in Orb" opens a new session in the repo mapped to its project, with
// the brief as the first request (Orb's approval cards and repo fence apply as usual); "Copy prompt"
// puts the same brief on the clipboard for Cursor or a terminal.

export function VikunjaTaskScreen() {
  const { id, task } = useVikunja();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [id]);
  if (id === null) return null;
  const copy = () => navigator.clipboard?.writeText(task?.brief ?? "").then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {});
  return (
    <section className="task" aria-label="Vikunja task">
      <div className="home-col">
        <nav className="task-nav mono" aria-label="Task navigation">
          <button type="button" className="linkish" onClick={() => useViews.setState({ view: "home" })}>← HOME</button>
        </nav>
        <header className="task-head">
          <div className="mono home-kicker">// VIKUNJA{task?.done ? " · DONE" : ""}</div>
          <h1>{task?.title ?? "…"}</h1>
          {task && (
            <div className="task-chips mono">
              {task.project && <span>{task.project}</span>}
              {task.due && <span>due {task.due}</span>}
              {task.priority >= 4 && <span>high priority</span>}
              <Ext href={task.url} className="">Open in Vikunja →</Ext>
            </div>
          )}
        </header>
        <section className="task-actions" aria-label="Actions">
          <div className="task-buttons">
            <button type="button" className="hbtn dark big" disabled={!task?.repo} onClick={() => startVikunjaTask(id)}>
              {task?.repo ? `Start in Orb · ${task.repo}` : "Start in Orb"}
            </button>
            <button type="button" className="hbtn big outline" disabled={!task} onClick={copy}>{copied ? "Copied ✓" : "Copy prompt"}</button>
          </div>
          <p className="mono task-say">
            {task && !task.repo ? "This project has no repo mapped here, so only Copy prompt works. " : ""}
            Start in Orb opens a new session that proposes a plan first; nothing changes until you agree.
          </p>
        </section>
        <article className="hc" aria-label="Description">
          <div className="hc-head">
            <div className="hc-label mono">DESCRIPTION</div>
            <h2>{task ? "From the tracker" : "Loading…"}</h2>
          </div>
          {task && <div className="vk-desc">{task.description ? <Markdown text={task.description} /> : <p className="hc-empty">No description.</p>}</div>}
        </article>
      </div>
    </section>
  );
}
