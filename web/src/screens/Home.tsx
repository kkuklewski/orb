import { useEffect, useState } from "react";
import { useFeatures } from "../stores/features";
import { openPicker, useSession } from "../stores/session";
import { send } from "../ws";
import { setFront, useMeta, usageView, usageWarning } from "../stores/meta";
import { needsCount, needsYou, refreshHome, useHome, vikunjaTasks } from "../stores/home";
import { useDelegations } from "../stores/delegation";
import { usePinKey } from "./HomeCard";
import { Links, useForgetPane } from "./HomeForget";
import { HomeEmpty, LeadCard } from "./HomeLead";
import { NeedsStrip } from "./HomeNeeds";
import { DelegateCards, DelegatedStrip } from "./HomeDelegated";
import { saveTab, savedTab, TabCard, useRoutinesPane } from "./HomeTabs";

// The start screen: a header bar (day, jump), then one column under 1180px: the Needs you strip (HomeNeeds: what is
// blocked until you act, by rule), the Next action with Up next under it (HomeLead: tasks, tasks in the notes,
// results, pull requests, the notes batch; "All N" links reach the full lists), the Delegated strip (HomeDelegated),
// the status card (HomeTabs: a tab each for routines and what not to forget, and how many notes changed this week).
// From 1180px the status card moves to a right column. Nothing waiting and nothing queued: one line instead of the lead card. Pinned links at the bottom.
// Keys: ⌘K opens the picker; J K, Enter, S (Later) and D (Done) work the queue (HomeLead).

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
  const notes = useHome((s) => s.notes);
  const vk = useHome((s) => s.tasks);
  const plan = useHome((s) => s.plan);
  const now = useNow();
  const vault = features?.vault ?? "";
  const hasRepos = folders.length > 0;
  const delegations = useDelegations((s) => s.items);
  const n = needsYou(folders, plan, delegations);
  usePinKey();
  useEffect(() => { refreshHome(); }, [vault]);
  const tracker = vikunjaTasks(vk);
  const queue = plan?.next ? [plan.next, ...(plan.up_next ?? [])] : [];
  const lists = { tasks: tracker ? tracker.total : notes?.open_tasks ?? 0, tasksSource: tracker ? "vikunja" as const : vault ? "tasks" as const : null,
    notes: notes?.awaiting_count ?? 0, error: vk?.error, vault: !!vault };  // Vikunja set up but down: say so
  const [tab, setTabState] = useState<string | null>(savedTab);
  const setTab = (key: string) => { setTabState(key); saveTab(key); };
  const panes = [useRoutinesPane(), useForgetPane()];
  const needs = needsCount(n) > 0;  // the Needs you strip shows
  const week = vault && notes ? `${notes.notes_week} note${notes.notes_week === 1 ? "" : "s"} changed this week` : null;

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openPicker("new"); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  return (
    <section className="home" aria-label="Home">
      <header className="home-bar">
        <span className="home-dot" aria-hidden="true" />
        <strong>Orb</strong>
        <MetaRow now={now} />
        <button type="button" className="home-search" onClick={() => openPicker("new")}>
          {hasRepos ? "Search or jump" : "Choose a repo"} <kbd>⌘K</kbd>
        </button>
      </header>
      <UsageWarning />
      <div className="home-cols">
        <div className="home-main">
          <NeedsStrip n={n} />
          {queue.length ? <LeadCard n={n} queue={queue} lists={lists} title="Next action" />
            : <HomeEmpty n={n} lists={lists} hasRepos={hasRepos} needs={needs} />}
          <DelegateCards />
          <DelegatedStrip />
        </div>
        <TabCard id="status" panes={panes} tab={tab} onTab={setTab} line={week} running={n.waiting.length + n.working.length} />
      </div>
      <Links />
    </section>
  );
}
