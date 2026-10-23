import { useEffect } from "react";
import { useFeatures } from "../stores/features";
import { useViews, dayTime, relTime, dotClass, statusText } from "../stores/views";
import { askIn, folderName, openFolder, openPicker } from "../stores/session";
import { openSetup } from "../stores/setup";
import { ASK_TODAY, askAboutNote, greeting, needsYou, refreshHome, routinesLine, useHome } from "../stores/home";
import { VoicePill } from "./Voice";
import { NOTES_STEP } from "./setup/Setup";

const noteName = (file: string) => file.split("/").pop()!.replace(/\.md$/, "");

// The start screen: say or type what you want, see what needs you, what's to do in your notes,
// how the routines are doing and which notes changed lately.

function Panel({ kicker, title, children, action }: { kicker: string; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="home-panel" aria-label={title}>
      <div className="home-head"><span className="mono home-kicker">// {kicker}</span><h2>{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function NeedsYouPanel() {
  const folders = useFeatures((s) => s.folders);
  const routines = useViews((s) => s.routines);
  const n = needsYou(folders, routines);
  const rows = [...n.waiting, ...n.done, ...n.working].slice(0, 6);
  const count = n.waiting.length + n.done.length + n.routines.length;
  return (
    <Panel kicker="NEEDS YOU" title={count ? `${count} thing${count === 1 ? "" : "s"}` : "Nothing waiting"}>
      {rows.map((x) => (
        <button key={x.key} type="button" className={`home-row ${x.status}`} onClick={() => openFolder(x.folder.path, x.key)}>
          <span className={dotClass(x.status, x.live)} />
          <span className="home-row-main">{x.label || "New session"}</span>
          <span className="mono home-row-meta">{folderName(x.folder)} · {statusText(x)}</span>
        </button>
      ))}
      {n.routines.map((r) => (
        <button key={r.id} type="button" className="home-row approval" onClick={() => useViews.setState({ view: "routines" })}>
          <span className="dot approval" />
          <span className="home-row-main">{r.name}</span>
          <span className="mono home-row-meta">routine · {r.needs}</span>
        </button>
      ))}
      {!rows.length && !n.routines.length && <p className="home-empty">No session is waiting for an approval and nothing finished while you were away.</p>}
    </Panel>
  );
}

function TodoPanel({ vault }: { vault: string }) {
  const notes = useHome((s) => s.notes);
  if (!vault) {
    return (
      <Panel kicker="TO DO" title="Connect your notes">
        <p className="home-empty">Point Orb at the folder with your notes (an Obsidian vault or any folder of Markdown). Open tasks and recent notes show up here, and you can ask about them by voice.</p>
        <button type="button" className="onb-btn primary small" onClick={() => openSetup(NOTES_STEP)}>Choose notes folder</button>
      </Panel>
    );
  }
  const ask = <button type="button" className="chip-btn home-ask" onClick={() => askIn(vault, ASK_TODAY)}>Ask: what's on today?</button>;
  return (
    <Panel kicker="TO DO" title={notes ? `${notes.open_tasks} open task${notes.open_tasks === 1 ? "" : "s"}` : "Reading your notes…"} action={ask}>
      {notes?.tasks.map((t) => (
        <button key={`${t.file}:${t.line}`} type="button" className="home-row task" title={`${t.file}:${t.line}`}
          onClick={() => askIn(vault, askAboutNote(t.file))}>
          <span className="home-box" aria-hidden="true" />
          <span className="home-row-main">{t.text}</span>
          <span className="mono home-row-meta">{noteName(t.file)}</span>
        </button>
      ))}
      {notes && !notes.tasks.length && <p className="home-empty">No open “- [ ]” tasks in your notes.</p>}
      {notes && notes.open_tasks > notes.tasks.length && <p className="mono home-more">+ {notes.open_tasks - notes.tasks.length} more in your notes</p>}
    </Panel>
  );
}

function RoutinesPanel() {
  const r = useViews((s) => s.routines);
  return (
    <Panel kicker="ROUTINES" title="Scheduled agents" action={<button type="button" className="chip-btn" onClick={() => useViews.setState({ view: "routines" })}>Open</button>}>
      <p className="mono home-line">{routinesLine(r, dayTime)}</p>
    </Panel>
  );
}

function NotesPanel({ vault }: { vault: string }) {
  const notes = useHome((s) => s.notes);
  if (!vault || !notes) return null;
  return (
    <Panel kicker="NOTES" title={`${notes.notes_week} changed this week`} action={<button type="button" className="chip-btn" onClick={() => openFolder(vault)}>Open notes</button>}>
      {notes.notes.map((n) => (
        <button key={n.file} type="button" className="home-row" title={n.file} onClick={() => askIn(vault, askAboutNote(n.file))}>
          <span className="mono home-row-time">{relTime(n.mtime)}</span>
          <span className="home-row-main">{n.title}</span>
          <span className="mono home-row-meta">{n.file.split("/").slice(0, -1).join("/") || "/"}</span>
        </button>
      ))}
    </Panel>
  );
}

export function Home() {
  const features = useFeatures((s) => s.features);
  const hasRepos = useFeatures((s) => s.folders.length > 0);
  const vault = features?.vault ?? "";

  useEffect(() => { refreshHome(); }, [vault]);

  return (
    <section className="home" aria-label="Home">
      <div className="home-col">
        <div className="home-hero">
          <p className="mono home-kicker">// ORB</p>
          <h1>{greeting(new Date().getHours())}</h1>
          <div className="home-talk">
            <VoicePill />
            <span className="mono home-hint">{hasRepos ? "Space to talk · type below · Esc stops" : "Add a code folder in setup to start"}</span>
          </div>
          {!hasRepos && <button type="button" className="onb-btn" onClick={() => openPicker("new")}>Choose a repo</button>}
        </div>
        <div className="home-grid">
          <NeedsYouPanel />
          <TodoPanel vault={vault} />
          {features?.routines && <RoutinesPanel />}
          <NotesPanel vault={vault} />
        </div>
      </div>
    </section>
  );
}
