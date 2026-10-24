import { openItems } from "../stores/items";
import { useEffect, useState } from "react";
import { useFeatures } from "../stores/features";
import { useViews, dayTime, relTime } from "../stores/views";
import { askIn, folderName, openFolder, openPicker, useSession } from "../stores/session";
import { send } from "../ws";
import { openSetup } from "../stores/setup";
import { setFront, useMeta, usageView, usageWarning } from "../stores/meta";
import { ASK_TODAY, needsYou, refreshHome, useHome } from "../stores/home";
import { changeTask, openTask } from "../stores/tasks";
import { openRoutine } from "../stores/routine";
import { VoicePill } from "./Voice";
import { NOTES_STEP } from "./setup/Setup";
import type { HomeAwait } from "../protocol.gen";
import { Card } from "./HomeCard";
import { DontForget, Links, TrackerTasks, Unsaved } from "./HomeWatch";

// The start screen: a header bar (day, voice, jump), then an auto-fill bento of cards. The lead card is what
// needs you now (with the command it will run); the rest is status: routines needing a look, tasks (Vikunja,
// else the notes), what not to forget, unsaved work, notes that changed, pinned links. Keys: T D U R N scroll to a card.

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
  const tracker = watch?.tracker;
  const trackerError = tracker ? null : watch?.tracker_error;  // Vikunja is set up but down: say so, don't show the notes' tasks instead

  const attention = [...n.waiting.slice(1), ...n.done.slice(first === n.waiting[0] ? 0 : 1)];
  const rest = n.waiting.length + n.done.length - 1;
  const waitingNotes = notes?.awaiting ?? [];
  const hot = on.filter((r) => r.needs || r.loud);
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" });

  useEffect(() => {
    const keys: Record<string, string> = { t: "todo", d: "forget", u: "unsaved", r: "routines", n: "notes" };
    const on_ = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return;
      if (keys[e.key]) goTo(keys[e.key]);
    };
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openPicker("new"); } };
    window.addEventListener("keydown", on_); window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", on_); window.removeEventListener("keydown", k); };
  }, []);

  return (
    <section className="home" aria-label="Home">
      <header className="home-bar">
        <span className="home-dot" aria-hidden="true" />
        <strong>Orb</strong>
        <MetaRow now={now} />
        <VoicePill />
        {vault && <button type="button" className="hbtn" onClick={() => askIn(vault, ASK_TODAY)}>Ask for today's plan →</button>}
        <button type="button" className="home-search" onClick={() => openPicker("new")}>
          {hasRepos ? "Search or jump" : "Choose a repo"} <kbd>⌘K</kbd>
        </button>
      </header>
      <UsageWarning />

      <div className="home-grid">
        <Card id="needs" className="lead" ask={{ name: "Needs you", question: "What needs me first here, and what should I do about each item?",
          text: [...n.waiting, ...n.done].slice(0, 12).map((x) => `${folderName(x.folder)}: ${x.label || "New session"} (${x.status === "approval" ? "paused on an approval" : "finished"})`).join("\n") || "Nothing is waiting." }} label={waiting ? "NEEDS YOU" : first ? "DONE WHILE YOU WERE AWAY" : "NEEDS YOU"} mark={waiting > 0}
          title={waiting ? `${waiting} thing${waiting === 1 ? "" : "s"} need${waiting === 1 ? "s" : ""} you now` : first ? "Results are ready to read" : "Nothing is waiting for you"}
          foot={<><span>{n.working.length ? `${n.working.length} running · ${n.working.slice(0, 2).map((x) => folderName(x.folder)).join(", ")}` : "nothing running"}</span><button type="button" onClick={() => useViews.setState({ view: "activity" })}>Activity →</button></>}>
          {first ? (
            <div className="lead-body">
              <div className="lead-head">{first.label || "New session"}</div>
              <div className="lead-sub">{folderName(first.folder)} · {first.last_used ? `${relTime(first.last_used)} ago` : "now"}{first.status === "approval" ? " · paused on an approval" : " · finished"}</div>
              {first.ask && <pre className="lead-ask" aria-label="What it will run"><span className="mono">WHAT IT WILL RUN</span>{first.ask}</pre>}
              <div className="hc-actions lead-actions">
                <button type="button" className="hbtn dark" onClick={() => openFolder(first.folder.path, first.key)}>{first.status === "approval" ? "Review card" : "Read the answer"} <kbd className="kbd">⏎</kbd></button>
              </div>
            </div>
          ) : <p className="hc-empty">{hasRepos ? "You are all caught up." : "Choose a repo to start."}</p>}
          {attention.slice(0, 3).map((x) => (
            <button key={x.key} type="button" className="hc-row" onClick={() => openFolder(x.folder.path, x.key)}>
              <span className="hc-dot sq" />
              <span className="hc-text">{folderName(x.folder)}: {x.label || "New session"}</span>
              <span className="hc-side mono">{x.status === "approval" ? "needs OK" : "read answer"} · {x.last_used ? relTime(x.last_used) : "now"}</span>
            </button>
          ))}
          {rest > 3 && <p className="hc-empty">+ {rest - 3} more in Activity</p>}
        </Card>

        {features?.routines && (
          <Card id="routines" ask={{ name: "Routines", question: "Which of my routines need me, and what should I do about them?",
            text: on.map((r) => `${r.name}: ${r.needs ?? r.last?.outcome ?? "no runs yet"}`).join("\n") || "No routines are on." }} label="ROUTINES · EVERY 30 MIN" title={routines ? (n.routines.length ? `${n.routines.length} of ${on.length} need you` : `${ok} of ${on.length} ran fine`) : "Checking…"} mark={n.routines.length > 0}
            foot={<><span>{hot.length < on.length ? `${on.length - hot.length} fine · ` : ""}{next ? `next · ${next.name} ${dayTime(next.next_run_at!)}` : "nothing scheduled"}</span><button type="button" onClick={() => useViews.setState({ view: "routines" })}>Routines <kbd className="kbd">R</kbd></button></>}>
            {hot.slice(0, 5).map((r) => (
              <button key={r.id} type="button" className="hc-row needs" onClick={() => openRoutine(r.id)}>
                <span className="hc-dot sq" />
                <span className="hc-text">{r.name}</span>
                <span className="hc-side mono">{r.needs ?? "worth reading"}</span>
              </button>
            ))}
            {routines && !hot.length && <p className="hc-empty">Nothing to read or decide.</p>}
          </Card>
        )}

        <div className="home-wide home-tasks" id={tracker ? undefined : "todo"}>
          {tracker ? <TrackerTasks /> : trackerError ? (
            <Card label="TO DO · VIKUNJA" title="Vikunja unreachable">
              <p className="hc-empty">{trackerError}</p>
            </Card>
          ) : vault ? (
            <Card ask={{ name: "Tasks in notes", question: "Which of these tasks should I do first, and why?", text: (notes?.tasks ?? []).slice(0, SHOWN).map((t) => `${t.text} (${noteName(t.file)})`).join("\n") || "none" }} label="TO DO · FROM YOUR NOTES" title={notes ? `${notes.open_tasks} open task${notes.open_tasks === 1 ? "" : "s"}, newest first` : "Reading your notes…"}
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
        </div>

        <DontForget />
        <Unsaved />

        {vault && notes && notes.notes.length > 0 && (
          <div className="home-wide">
            <Card id="notes" ask={{ name: "Notes", question: "What changed in my notes lately, and is anything waiting for me?",
              text: (waitingNotes.length ? waitingNotes : notes.notes).slice(0, SHOWN).map((x) => `${x.title} (${x.file})`).join("\n") }} label="NOTES" mark={waitingNotes.length > 0}
              title={notes.awaiting_count ? `${notes.awaiting_count} note${notes.awaiting_count === 1 ? "" : "s"} wait for your verdict` : `${notes.notes_week} changed this week`}
              foot={<><span>{notes.awaiting_count ? `${notes.notes_week} changed this week` : vault.split("/").pop()}</span><span className="hc-foot-actions">{!!notes.awaiting_count && <button type="button" onClick={() => openItems("notes")}>All {notes.awaiting_count} →</button>}<button type="button" onClick={() => openFolder(vault)}>Open notes <kbd className="kbd">N</kbd></button></span></>}>
              {(waitingNotes.length ? waitingNotes : notes.notes.map((x): HomeAwait => ({ ...x, tag: "" }))).slice(0, SHOWN).map((x) => (
                <button key={x.file} type="button" className="hc-row" title={x.file} onClick={() => askIn(vault, `Read my note "${x.file}" and tell me in a few sentences what it says and what, if anything, I still need to do about it.`)}>
                  <span className={"hc-dot" + (x.tag ? " sq" : "")} />
                  <span className="hc-text">{x.title}</span>
                  <span className="hc-side mono">{x.tag && <span className="note-chip">{x.tag}{x.verified != null ? ` ${x.verified}%` : ""}</span>}{folderOf(x.file)} · {relTime(x.mtime)}</span>
                </button>
              ))}
            </Card>
          </div>
        )}
        <Links />
      </div>
    </section>
  );
}
