import { useEffect, useState } from "react";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { askIn, folderName, openPicker, suggestRepos, useSession } from "../stores/session";
import { refreshHome, useHome } from "../stores/home";
import type { HomeTask } from "../protocol.gen";
import { changeTask, openTask, sameTask, snoozeDays, undo, useTasks } from "../stores/tasks";

// One task from the notes: the line in its note, and what you can do with it. Done / not doing /
// snooze rewrite that one line (Undo in the bar that follows); the rest hand it to Claude.

const NONE: HomeTask[] = []; // one empty list: a new [] per render would re-render forever

const plain = (raw: string) => raw.replace(/^\s*[-*+] \[.\]\s+/, "").replace(/\s*(✅|❌|⏳)\s*\d{4}-\d{2}-\d{2}/g, "")
  .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, "$1").replace(/\*\*|__/g, "");

export function TaskScreen() {
  const { task, detail } = useTasks();
  const tasks = useHome((s) => s.notes?.tasks ?? NONE);
  const loaded = useHome((s) => !!s.notes);
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const [snooze, setSnooze] = useState(false);
  const [choosing, setChoosing] = useState(false); // "Do it with Claude": pick where, confirm, then go
  useEffect(() => { setSnooze(false); setChoosing(false); }, [task]);
  const folders = useFeatures((s) => s.folders);
  useEffect(() => { if (!loaded) refreshHome(); }, [loaded]); // opened from a link: the list for ↑ ↓ and "next"

  const i = tasks.findIndex((x) => sameTask(x, task));
  const prev = i > 0 ? tasks[i - 1] : null;
  const next = i >= 0 && i < tasks.length - 1 ? tasks[i + 1] : null;

  useEffect(() => { // ↑ ↓ through the list, D done (not while typing)
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowUp" && prev) { e.preventDefault(); openTask(prev); }
      else if (e.key === "ArrowDown" && next) { e.preventDefault(); openTask(next); }
      else if ((e.key === "d" || e.key === "D") && detail?.raw.match(/^\s*[-*+] \[ \]/)) { e.preventDefault(); changeTask(detail, "done"); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prev, next, detail]);

  if (!task) return null;
  const open = !!detail && /^\s*[-*+] \[ \]/.test(detail.raw);
  const state = !detail ? "" : open ? (detail.raw.includes("⏳") ? "SNOOZED" : "OPEN") : detail.raw.match(/\[x\]/i) ? "DONE" : "CLOSED";
  const text = detail ? plain(detail.raw) : tasks[i]?.text ?? "";
  const where = `${task.file}:${task.line}`;
  const ask = (prompt: string) => vault && askIn(vault, prompt);
  const repoAsk = `Help me with this task from my notes (${where}): ${text}. Look at this repo first, then propose how to do it here and what you need from me.`;
  const inRepo = () => { useSession.setState({ pendingAsk: repoAsk }); openPicker("new"); };
  const hint = detail ? `${text} ${detail.heading} ${detail.title}` : text;
  const suggested = suggestRepos(folders, hint, vault);

  return (
    <section className="task" aria-label="Task">
      <div className="home-col">
        <nav className="task-nav mono" aria-label="Task navigation">
          <button type="button" className="linkish" onClick={() => useViews.setState({ view: "home" })}>← HOME</button>
          <span className="task-pos">
            {i >= 0 ? `TASK ${i + 1} OF ${useHome.getState().notes?.open_tasks ?? tasks.length}` : "TASK"}
            <button type="button" className="sqbtn" aria-label="Previous task" disabled={!prev} onClick={() => prev && openTask(prev)}>↑</button>
            <button type="button" className="sqbtn" aria-label="Next task" disabled={!next} onClick={() => next && openTask(next)}>↓</button>
          </span>
        </nav>

        <header className="task-head">
          <div className="mono home-kicker">// TO DO{state ? ` · ${state}` : ""}</div>
          <h1>{text || "…"}</h1>
          {detail && (
            <div className="task-chips mono">
              <span>{task.file.split("/").pop()} · line {task.line}</span>
              {detail.heading && <span>{detail.heading}</span>}
              <span>note changed {new Date(detail.mtime * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </div>
          )}
        </header>

        <section className="task-actions" aria-label="Actions">
          <div className="task-buttons">
            <button type="button" className="hbtn dark big" disabled={!open} onClick={() => detail && changeTask(detail, "done")}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              Mark done <span className="kbd mono">D</span>
            </button>
            <button type="button" className="hbtn big outline" aria-expanded={choosing} onClick={() => setChoosing(!choosing)}>Do it with Claude →</button>
            <div className="task-snooze">
              <button type="button" className="hbtn big outline" aria-expanded={snooze} disabled={!open} onClick={() => setSnooze(!snooze)}>Snooze ▾</button>
              {snooze && (
                <div className="snooze-menu" role="menu" aria-label="Snooze until">
                  {snoozeDays(new Date()).map((d) => (
                    <button key={d.date} type="button" role="menuitem" onClick={() => { setSnooze(false); detail && changeTask(detail, "snooze", d.date); }}>
                      {d.label}<span className="mono">{d.hint}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="hbtn big" disabled={!open} onClick={() => detail && changeTask(detail, "drop")}>Not doing it</button>
          </div>
          {choosing && (
            <div className="task-where" role="group" aria-label="Where to do it">
              <div className="task-where-head mono">WHERE SHOULD CLAUDE WORK ON IT?</div>
              {suggested.map((f, i) => (
                <button key={f.path} type="button" className={"hand" + (i === 0 ? " first" : "")} onClick={() => askIn(f.path, repoAsk)}>
                  <span><b>{folderName(f)}{i === 0 && <span className="tag mono">LOOKS RIGHT</span>}</b><span>{f.rel}{f.branch ? ` · ${f.branch}` : ""} · a new session there starts with this task; the repo fence and its approvals apply.</span></span>
                  <span aria-hidden="true">→</span>
                </button>
              ))}
              <button type="button" className="hand" onClick={inRepo}>
                <span><b>Another repo…</b><span>Pick one from the list.</span></span><span aria-hidden="true">→</span>
              </button>
              <button type="button" className="hand" onClick={() => ask(`Help me with this task from my notes (${where}): ${text}. Read the note first, then tell me how you'd do it and what you need from me.`)}>
                <span><b>In my notes</b><span>No repo: Claude works in the notes folder, where it can read code repos but not change them.</span></span><span aria-hidden="true">→</span>
              </button>
            </div>
          )}
          <p className="mono task-say">Done, snoozed and dropped tasks stay in the note, marked the Obsidian Tasks way. Every change has an Undo.</p>
        </section>

        <section className="task-cols">
          <article className="hc" aria-label="From the note">
            <div className="hc-head">
              <div className="hc-label mono">FROM THE NOTE</div>
              <h2>{detail?.title ?? "Reading the note…"}</h2>
            </div>
            <div className="task-excerpt mono">
              {detail?.context.map((l) => (
                <div key={l.n} className={"ex-line" + (l.n === task.line ? " hit" : "")}><span className="ex-n">{l.n}</span>{l.text || " "}</div>
              ))}
            </div>
            <div className="hc-foot mono"><span>{task.file.split("/").slice(0, -1).join("/") || "/"}</span><button type="button" onClick={() => ask(`Open my note "${task.file}" and summarize it, then list what's still open in it.`)}>Ask about the note →</button></div>
          </article>

          <article className="hc" aria-label="With Claude">
            <div className="hc-head">
              <div className="hc-label mono">WITH CLAUDE</div>
              <h2>Hand it over</h2>
            </div>
            <button type="button" className="hand" onClick={() => ask(`Plan this task from my notes (${where}): ${text}. Read the note and anything it links to, then propose the steps. Don't change any files.`)}>
              <span><b>Plan it</b><span>Claude reads the note and what it links to, then proposes steps. Nothing changes.</span></span><span aria-hidden="true">→</span>
            </button>
            <button type="button" className="hand" onClick={inRepo}>
              <span><b>Do it in a repo</b><span>Pick a repo; a new session there starts with this task.</span></span><span aria-hidden="true">→</span>
            </button>
            <button type="button" className="hand" onClick={() => ask(`Break this task from my notes into smaller tasks (${where}): ${text}. Write them as "- [ ]" lines indented under it in the note; show me the edit first.`)}>
              <span><b>Break it into tasks</b><span>Claude writes sub-tasks under this line in the note; you approve the edit.</span></span><span aria-hidden="true">→</span>
            </button>
          </article>
        </section>
      </div>
    </section>
  );
}

export function TaskToast() {
  const toast = useTasks((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="task-toast" role="status">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      <span>{toast.text}</span>
      {toast.undo && <button type="button" onClick={undo}>Undo</button>}
      <button type="button" aria-label="Dismiss" className="x" onClick={() => useTasks.setState({ toast: null })}>×</button>
    </div>
  );
}
