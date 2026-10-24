import { useEffect, useState } from "react";
import { useFeatures } from "../stores/features";
import { useViews, dayTime, relTime } from "../stores/views";
import { askIn, folderName, openFolder, openPicker, useSession } from "../stores/session";
import { send } from "../ws";
import { openSetup } from "../stores/setup";
import { setFront, useMeta, usageView, usageWarning } from "../stores/meta";
import { ASK_TODAY, brief, dueSoon, greeting, needsYou, refreshHome, useHome } from "../stores/home";
import { changeTask, openTask } from "../stores/tasks";
import { openRoutine } from "../stores/routine";
import { VoicePill } from "./Voice";
import { NOTES_STEP } from "./setup/Setup";
import { Card } from "./HomeCard";
import { DontForget, Links, TrackerTasks, Unsaved } from "./HomeWatch";

// The start screen, read top to bottom like a short brief: the day in one paragraph, four numbers,
// then what needs you, the routines, what not to forget (reminders, quiet pull requests, unsaved work),
// your open tasks (Vikunja, else the notes; done right here, or opened), pinned links and the notes that changed. Layout after the Bluejack summary, Field Rank's cards and SSTR's rules.

const noteName = (file: string) => file.split("/").pop()!.replace(/\.md$/, "");
const folderOf = (file: string) => file.split("/").slice(0, -1).join("/") || "/";
const SHOWN = 8;

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function MetaRow({ now }: { now: Date }) {
  const { windows, overage, usageAt } = useMeta();
  const plan = useFeatures((s) => s.features?.plan);
  const u = usageView(windows, overage, usageAt);
  const left = u?.parts.filter((p) => p.left != null).map((p) => `${p.name.toUpperCase()} ${Math.round(p.left! * 100)}% LEFT`).join(" · ");
  const day = now.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase();
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="home-meta mono">
      <span>{day} · {time}</span>
      <span>{["CLAUDE", plan?.toUpperCase(), left].filter(Boolean).join(" · ")}</span>
    </div>
  );
}

/** Under 15% of the plan left: say so, and offer the cheap model (this folder, or new folders when none is open). */
function UsageWarning() {
  const windows = useMeta((s) => s.windows);
  const front = useMeta((s) => s.front);
  const folder = useSession((s) => s.folder);
  const w = usageWarning(windows);
  if (!w) return null;
  const cheap = front === "haiku";
  return (
    <div className="usage-warn" role="alert">
      <span className="sq" aria-hidden="true" />
      <p><strong>{w.name} {Math.round(w.left * 100)}% left</strong>{w.resets ? `, resets ${w.resets}` : ""}. {cheap ? "This folder already uses Haiku, the cheapest model." : "Haiku uses a fraction of it, and still hands coding to Opus."}</p>
      {!cheap && folder && <button type="button" className="hbtn" onClick={() => setFront("haiku")}>Use Haiku here</button>}
      {!cheap && !folder && <button type="button" className="hbtn" onClick={() => send({ type: "set_settings", values: { default_model: "haiku" } })}>Haiku for new folders</button>}
    </div>
  );
}

export function Home() {
  const features = useFeatures((s) => s.features);
  const folders = useFeatures((s) => s.folders);
  const routines = useViews((s) => s.routines);
  const notes = useHome((s) => s.notes);
  const watch = useHome((s) => s.watch);
  const now = useNow();
  const vault = features?.vault ?? "";
  const hasRepos = folders.length > 0;
  const n = needsYou(folders, routines);
  const first = n.waiting[0] ?? n.done[0];
  const on = (routines?.items ?? []).filter((x) => x.enabled);
  const ok = on.filter((x) => !x.needs && x.last?.outcome === "ok").length;
  const next = on.filter((x) => x.next_run_at).sort((a, b) => a.next_run_at! - b.next_run_at!)[0];
  const waiting = n.waiting.length + n.routines.length;
  useEffect(() => { refreshHome(); }, [vault]);
  const lines = brief({ waiting: n.waiting, done: n.done, routines, notes, vault: !!vault, routinesOn: !!features?.routines, watch });
  const tracker = watch?.tracker;
  const soon = dueSoon(watch);
  const unsaved = watch?.repos.length ?? 0;

  return (
    <section className="home" aria-label="Home">
      <div className="home-col">
        <MetaRow now={now} />
        <UsageWarning />

        <section className="home-hero">
          <div className="mono home-kicker">// TODAY</div>
          <h1>{greeting(now.getHours())}</h1>
          <p className="home-brief">
            {waiting > 0 && <span className="sq" aria-hidden="true" />}
            {lines.map((l, i) => <span key={i}>{l.map((part, j) => (typeof part === "string" ? part : <strong key={j}>{part.b}</strong>))}{" "}</span>)}
          </p>
          <div className="home-talk">
            <VoicePill />
            {vault && <button type="button" className="hbtn" onClick={() => askIn(vault, ASK_TODAY)}>Ask for today's plan →</button>}
            {!hasRepos && <button type="button" className="hbtn" onClick={() => openPicker("new")}>Choose a repo</button>}
            <span className="mono home-hint">Space to talk · Esc stops</span>
          </div>
        </section>

        <section className="home-stats" aria-label="At a glance">
          <button type="button" className="stat" onClick={() => useViews.setState({ view: "activity" })}>
            <span className="stat-label mono">{waiting > 0 && <span className="sq" />}NEEDS YOU</span>
            <span className="stat-num">{waiting}</span>
            <span className="stat-note">{waiting === 1 ? "thing waiting for you" : waiting ? "things waiting for you" : "nothing waiting"}</span>
          </button>
          <a className="stat" href="#todo">
            <span className="stat-label mono">OPEN TASKS</span>
            <span className="stat-num">{tracker ? tracker.total : vault ? notes?.open_tasks ?? "–" : "–"}</span>
            <span className="stat-note">{tracker ? "in Vikunja" : vault ? (notes?.snoozed ? `in your notes · ${notes.snoozed} snoozed` : "in your notes") : "no notes folder yet"}</span>
          </a>
          <a className="stat" href="#forget">
            <span className="stat-label mono">{soon > 0 && <span className="sq" />}DUE SOON</span>
            <span className="stat-num">{watch ? soon : "–"}</span>
            <span className="stat-note">{soon ? "this week or gone quiet" : "nothing due this week"}</span>
          </a>
          <a className="stat" href="#unsaved">
            <span className="stat-label mono">UNSAVED</span>
            <span className="stat-num">{watch ? unsaved : "–"}</span>
            <span className="stat-note">{unsaved === 1 ? "repo not committed or pushed" : "repos not committed or pushed"}</span>
          </a>
          {features?.routines && n.routines.length > 0 && (
            <button type="button" className="stat" onClick={() => useViews.setState({ view: "routines" })}>
              <span className="stat-label mono"><span className="sq" />ROUTINES</span>
              <span className="stat-num">{ok}<small>/{on.length || "–"}</small></span>
              <span className="stat-note">{n.routines.length} need you</span>
            </button>
          )}
        </section>

        {/* daily cards */}

        <section className="home-cards">
          <div className="home-left">
            {first && (
              <Card label={first.status === "approval" ? "NEEDS YOUR OK" : "DONE WHILE YOU WERE AWAY"} title={first.label || "New session"} mark={first.status === "approval"}
                foot={<><span>{n.waiting.length + n.done.length > 1 ? `${n.waiting.length + n.done.length - 1} more` : "nothing else is waiting"}</span><button type="button" onClick={() => useViews.setState({ view: "activity" })}>Activity →</button></>}>
                <div className="hc-meta mono">{folderName(first.folder)} · {first.last_used ? `${relTime(first.last_used)} ago` : "now"}</div>
                <div className="hc-actions">
                  <button type="button" className="hbtn dark" onClick={() => openFolder(first.folder.path, first.key)}>{first.status === "approval" ? "Review card" : "Read the answer"}</button>
                </div>
              </Card>
            )}

            {features?.routines && (
              <Card label="ROUTINES · EVERY 30 MIN" title={routines ? (n.routines.length ? `${n.routines.length} of ${on.length} need you` : `${ok} of ${on.length} ran fine`) : "Checking…"} mark={n.routines.length > 0}
                foot={<><span>{next ? `next · ${next.name} ${dayTime(next.next_run_at!)}` : "nothing scheduled"}</span><button type="button" onClick={() => useViews.setState({ view: "routines" })}>Routines →</button></>}>
                {on.slice(0, 5).map((r) => (
                  <button key={r.id} type="button" className={"hc-row" + (r.needs || r.loud ? " needs" : "")} onClick={() => openRoutine(r.id)}>
                    <span className={"hc-dot" + (r.needs || r.loud ? " sq" : "")} />
                    <span className="hc-text">{r.name}</span>
                    <span className="hc-side mono">{r.needs ?? (r.loud ? "worth reading" : r.quiet ? "nothing to report" : r.last?.at ? `${r.last.outcome ?? "ran"} · ${dayTime(r.last.at).replace(/^today /, "")}` : "no runs yet")}</span>
                  </button>
                ))}
              </Card>
            )}
            <DontForget />
            <Unsaved />
          </div>

          <div className="home-right" id={tracker ? undefined : "todo"}>
            {tracker ? <TrackerTasks /> : vault ? (
              <Card label="TO DO · FROM YOUR NOTES" title={notes ? `${notes.open_tasks} open task${notes.open_tasks === 1 ? "" : "s"}, newest first` : "Reading your notes…"}
                foot={notes && <><span>{notes.open_tasks > SHOWN ? `+ ${notes.open_tasks - Math.min(SHOWN, notes.tasks.length)} more in your notes` : "that's all of them"}</span><button type="button" onClick={() => askIn(vault, ASK_TODAY)}>Ask what's first →</button></>}>
                {notes?.tasks.slice(0, SHOWN).map((t) => (
                  <div key={`${t.file}:${t.line}`} className="hc-row task">
                    <input type="checkbox" checked={false} aria-label={`Mark done: ${t.text}`} onChange={() => changeTask(t, "done")} />
                    <button type="button" className="hc-text" title={`${t.file}:${t.line}`} onClick={() => openTask(t)}>{t.text}</button>
                    <span className="hc-side mono" title={t.file}>{noteName(t.file)}</span>
                  </div>
                ))}
                {notes && !notes.tasks.length && <p className="hc-empty">No open “- [ ]” tasks in your notes.</p>}
              </Card>
            ) : (
              <Card label="TO DO" title="Connect your notes">
                <p className="hc-empty">Point Orb at the folder with your notes (an Obsidian vault or any folder of Markdown). Open tasks and recent notes show up here, and you can work through them by voice.</p>
                <div className="hc-actions"><button type="button" className="hbtn dark" onClick={() => openSetup(NOTES_STEP)}>Choose notes folder</button></div>
              </Card>
            )}
            <Links />
          </div>
        </section>

        {vault && notes && notes.notes.length > 0 && (
          <section className="home-notes" id="notes" aria-label="Recently changed notes">
            <div className="home-notes-head">
              <span className="mono home-kicker">// NOTES</span>
              <h2>{notes.notes_week} changed this week</h2>
              <button type="button" className="mono linkish" onClick={() => openFolder(vault)}>Open notes →</button>
            </div>
            {notes.notes.map((x) => (
              <button key={x.file} type="button" className="note-row" title={x.file} onClick={() => askIn(vault, `Read my note "${x.file}" and tell me in a few sentences what it says and what, if anything, I still need to do about it.`)}>
                <span className="mono">{relTime(x.mtime)}</span>
                <span className="note-title">{x.title}</span>
                <span className="mono note-folder">{folderOf(x.file)}</span>
              </button>
            ))}
          </section>
        )}
      </div>
    </section>
  );
}
