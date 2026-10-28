// Brain (GLOSSARY.md Brain, Verdict, owner_read): the vault's newest notes, one note's page, and the Verdict. The list's
// order is snapshotted when Brain opens and kept while the owner stays in Brain, so a note that gets a verdict (and a
// newer mtime) keeps its place. Opening a note writes nothing; leaving it without a verdict sends brain_read once,
// and the server sets owner_read only if it is still unset (ADR 0007). Notes waiting for a verdict are grouped by their
// suggestion (ADR 0006: approve or reject by the vault's rubric, never drop): accept one, or select several and Apply
// suggestions; each verdict is written on its own, a refused one keeps its reason, and every applied one keeps Restore
// (and its place in the group) for the rest of the page's life. Expiry (ADR 0013): the vault archives an unread AI page
// scored 4 or lower 14 days after it was curated; the server sends that day (`expires`) and Orb only shows it, as a
// chip, with the pages within SOON_DAYS in Expiring soon above Reject. Keep is the approve verdict, nothing else. The
// Expired view lists the pages the vault already archived (last 30 days, newest first), read only: Keep there writes the
// approve verdict and the row says "kept"; only the vault can bring a page back, so there is no Restore. The No topic
// view (ticket 820) lists the No-topic captures, oldest first, one at a time: Keep (owner_read, the capture stays an idea)
// Make it a task (the make_task card, ADR 0008: title and day only; Allow marks it read, Undo takes both back), New topic
// (a brief for the notes session, typed in its composer and not sent), or Drop (the reject verdict; Restore undoes it).
// A row acted on stays on the page with its state.
import { create } from "zustand";
import type { BrainExpiredEvent, BrainListEvent, BrainNoTopicEvent, BrainNote, BrainNoteEvent, VerdictNote } from "../protocol.gen";
import { on } from "../events";
import { send } from "../ws";
import { useViews, type View } from "./views";
import { useFeatures } from "./features";
import { draftIn, useSession } from "./session";

export interface BrainFilter { waiting: boolean; kinds: string[]; lanes: string[]; q: string }
export const KINDS = ["AI", "your note", "capture", "unverified view"];
export const LANES = ["news", "learning"];
const NO_FILTER: BrainFilter = { waiting: false, kinds: [], lanes: [], q: "" };

export const useBrain = create<{
  list: BrainListEvent | null;
  file: string | null; // the note on its page
  note: BrainNoteEvent | null;
  filter: BrainFilter;
  snap: string[] | null; // the files in the order they had when Brain opened
  applied: Record<string, Applied>; // notes given their suggested verdict (or kept) on this page: they keep their group and Restore
  refused: Record<string, string>; // the vault write module's reason, per note
  picked: string[]; // notes selected for Apply suggestions
  soon: string[]; // notes shown in Expiring soon on this visit: they stay there once kept or judged
  expired: BrainExpiredEvent | null; // the Expired view's pages
  showExpired: boolean; // Brain shows the Expired view instead of the list
  notopic: BrainNoTopicEvent | null; // the No topic view's captures
  showNoTopic: boolean; // Brain shows the No topic view
  acted: string[]; // captures kept or dropped on this visit: listed again with their state
}>(() => ({ list: null, file: null, note: null, filter: NO_FILTER, snap: null, applied: {}, refused: {}, picked: [], soon: [], expired: null,
  showExpired: false, notopic: null, showNoTopic: false, acted: [] }));

export type Suggested = "approve" | "reject";
export const SUGGESTED: Suggested[] = ["approve", "reject"];
export type Applied = Suggested | "keep" | "task";
export type Group = Suggested | "soon";
/** Brain's groups, top to bottom: Expiring soon sits right above Reject. */
export const GROUPS: Group[] = ["approve", "soon", "reject"];
export const GROUP_NAME: Record<Group, string> = { approve: "Suggested: approve", soon: "Expiring soon", reject: "Suggested: reject" };

/** A page this many days or fewer from its expiry day is Expiring soon. */
export const SOON_DAYS = 3;

/** Today as the vault writes it: the local calendar day. */
export const localDay = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole days from `today` to the expiry day (negative once it's past), null when the page doesn't expire. */
export function daysLeft(n: Pick<BrainNote, "expires">, today = localDay()): number | null {
  if (!n.expires) return null;
  const t = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  return Math.round((t(n.expires) - t(today)) / 86_400_000);
}

/** The chip: "expires in 5 days", "expires today" on the day, "expires tonight" once past it (the vault's nightly run
 *  hasn't archived it yet); "" when the page doesn't expire. */
export function expiryText(n: Pick<BrainNote, "expires">, today = localDay()): string {
  const d = daysLeft(n, today);
  return d == null ? "" : d < 0 ? "expires tonight" : d === 0 ? "expires today" : `expires in ${d} day${d === 1 ? "" : "s"}`;
}

/** The pages within SOON_DAYS of their expiry day. */
export const expiringSoon = (rows: BrainNote[], today = localDay()) =>
  rows.filter((n) => { const d = daysLeft(n, today); return d != null && d <= SOON_DAYS; });

const IN_BRAIN: View[] = ["brain", "note"];

export function openBrain() {
  useBrain.setState({ showExpired: false, showNoTopic: false });
  useViews.setState({ view: "brain" });
  send({ type: "brain_list" });
}

/** Brain's Expired view (the Away recap's "N pages expired" opens it too). */
export function openExpired() {
  useBrain.setState({ showExpired: true, showNoTopic: false });
  useViews.setState({ view: "brain" }); // the view asks for its rows when it shows
}

export const closeExpired = () => useBrain.setState({ showExpired: false });

/** Brain's No topic view (Up next's "N captures have no topic" opens it). */
export function openNoTopic() {
  useBrain.setState({ showNoTopic: true, showExpired: false });
  useViews.setState({ view: "brain" }); // the view asks for its rows when it shows
}

export const closeNoTopic = () => useBrain.setState({ showNoTopic: false });

/** The No topic rows again, with the ones acted on this visit. */
export const askNoTopic = () => send({ type: "brain_notopic", files: useBrain.getState().acted });

const act = (file: string) => useBrain.setState((s) => ({ acted: s.acted.includes(file) ? s.acted : [...s.acted, file] }));

/** Keep a capture as an idea: owner_read, refused like a verdict when the row is stale. */
export function keepIdea(n: BrainNote) {
  if (n.owner_read || n.verdict) return;
  act(n.file);
  send({ type: "brain_keep", file: n.file, seen: n.owner_read });
}

/** Drop a capture: the reject verdict (Restore undoes it). */
export function drop(n: BrainNote) {
  if (n.verdict) return;
  act(n.file);
  verdicts([{ file: n.file, seen: n.verdict, verdict: "reject" }]);
}

/** New topic: the notes session opens with a brief in its composer, unsent; the owner sends it and approves the
 *  writes there. Orb itself writes nothing. */
export function newTopic(n: BrainNote) {
  const vault = useFeatures.getState().features?.vault;
  if (!vault) { useSession.setState({ picker: "new" }); return; }
  draftIn(vault, `Start a Topics page for the capture ${n.file}: read it, suggest a topic name and where it fits, and wait for my OK before you write anything.`);
}

/** A No topic row's state: "made a task", "kept as an idea", "dropped", or "" while it waits. */
export const notopicState = (n: BrainNote, applied: Record<string, Applied>) =>
  applied[n.file] === "task" ? "made a task" : applied[n.file] === "keep" || n.owner_read ? "kept as an idea" : n.verdict.startsWith("reject") ? "dropped" : n.verdict ? verdictText(n.verdict) : "";

/** An expired row's state: "kept" once it has the approve verdict (or got it on this page), else its verdict, else "". */
export const expiredState = (n: BrainNote, applied: Record<string, Applied>) =>
  applied[n.file] === "approve" || n.verdict.startsWith("approve") ? "kept" : n.verdict ? verdictText(n.verdict) : "";

export function openNote(file: string) {
  const s = useBrain.getState();
  if (s.file === file && useViews.getState().view === "note") return;
  if (onNote()) leave(s.note); // another note from the panel
  useBrain.setState({ file, note: s.note?.file === file ? s.note : null });
  useViews.setState({ view: "note" });
  send({ type: "brain_get", file });
  send({ type: "brain_list" }); // the panel's siblings
}

export function setVerdict(verdict: "approve" | "reject" | "restore") {
  const n = useBrain.getState().note;
  if (n) send({ type: "brain_verdict", file: n.file, verdict, seen: n.verdict });
}

/** Brain's groups in the list's order: Expiring soon (`soon`: the pages shown there on this visit), then the notes that
 *  carry a suggestion (or got theirs on this page), by suggested verdict. */
export function suggestionGroups(rows: BrainNote[], applied: Record<string, Applied>, soon: string[] = []): Record<Group, BrainNote[]> {
  const g: Record<Group, BrainNote[]> = { approve: [], soon: [], reject: [] };
  for (const n of rows) {
    const a = applied[n.file];
    const s = soon.includes(n.file) ? "soon" : a === "approve" || a === "reject" ? a : n.waiting ? n.suggest : "";
    if (s === "approve" || s === "reject" || s === "soon") g[s].push(n);
  }
  return g;
}

/** A row still waits for its suggested verdict (it can be accepted or selected). */
export const suggestable = (n: BrainNote) => n.waiting && !n.verdict && (n.suggest === "approve" || n.suggest === "reject");

const verdicts = (notes: VerdictNote[]) => { if (notes.length) send({ type: "brain_apply", notes }); };

/** Accept one note's suggestion. */
export const accept = (n: BrainNote) => { if (suggestable(n)) verdicts([{ file: n.file, seen: n.verdict, verdict: n.suggest as Suggested }]); };

/** Keep an expiring page: the approve verdict (ADR 0013), written like any other, so a stale row is refused the same way. */
export const keep = (n: BrainNote) => { if (!n.verdict) verdicts([{ file: n.file, seen: n.verdict, verdict: "approve" }]); };

/** Undo the verdict a suggestion applied. */
export const restore = (n: BrainNote) => verdicts([{ file: n.file, seen: n.verdict, verdict: "restore" }]);

export const togglePick = (file: string) => useBrain.setState((s) => ({ picked: toggleIn(s.picked, file) }));

/** Select (or, when all are selected, clear) a group's open notes. */
export function pickAll(notes: BrainNote[]) {
  const files = notes.filter(suggestable).map((n) => n.file);
  useBrain.setState((s) => {
    const all = files.every((f) => s.picked.includes(f));
    return { picked: all ? s.picked.filter((f) => !files.includes(f)) : [...new Set([...s.picked, ...files])] };
  });
}

/** Apply suggestions: each selected note gets its own suggested verdict. */
export function applyPicked() {
  const { list, picked } = useBrain.getState();
  const rows = (list?.notes ?? []).filter((n) => picked.includes(n.file) && suggestable(n));
  verdicts(rows.map((n) => ({ file: n.file, seen: n.verdict, verdict: n.suggest as Suggested })));
}

export const setFilter = (f: Partial<BrainFilter>) => useBrain.setState((s) => ({ filter: { ...s.filter, ...f } }));
export const toggleIn = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

/** The list as shown: filtered, in the snapshot's order; a note the snapshot hasn't seen goes after the others. */
export function brainRows(notes: BrainNote[], f: BrainFilter, snap: string[] | null): BrainNote[] {
  const q = f.q.trim().toLowerCase();
  const at = new Map((snap ?? []).map((file, i) => [file, i]));
  return notes
    .map((n, i) => ({ n, i: at.get(n.file) ?? at.size + i }))
    .filter(({ n }) => (!f.waiting || n.waiting) && (!f.kinds.length || f.kinds.includes(n.kind)) && (!f.lanes.length || f.lanes.includes(n.lane))
      && (!q || n.title.toLowerCase().includes(q) || n.file.toLowerCase().includes(q)))
    .sort((a, b) => a.i - b.i)
    .map(({ n }) => n);
}

/** The value-score dot: high (8+), middle (5-7), low (4 or less), none. */
export const scoreDot = (score: number | null | undefined) =>
  score == null ? "dot" : score >= 8 ? "dot v-hi" : score >= 5 ? "dot v-mid" : "dot v-lo";

/** "rejected 2026-10-24" from the verdict as the server reads it. */
export function verdictText(v: string): string {
  const [word, day] = v.split(" ");
  const said = word === "approve" ? "approved" : word === "reject" ? "rejected" : word;
  return day ? `${said} ${day}` : said;
}

/** The note page's header line: score, lane and why. */
export function headerLine(n: BrainNote): string {
  return [n.score != null ? `score ${n.score}` : null, n.lane || null, n.why || null].filter(Boolean).join(" · ");
}

let onPage = false; // a note's page is showing
const onNote = () => onPage;

/** The owner leaves an open note: brain_read, only while it has no verdict and isn't read yet. */
function leave(n: BrainNoteEvent | null) {
  if (n && !n.verdict && !n.owner_read) send({ type: "brain_read", file: n.file, seen: "" });
}

export function wireBrain(): () => void {
  let inBrain = false;
  onPage = false;
  const offs = [
    on("brain_list", (ev) => useBrain.setState((s) => ({ list: ev, snap: s.snap ?? ev.notes.map((n) => n.file),
      soon: [...new Set([...s.soon, ...expiringSoon(ev.notes).map((n) => n.file)])] }))),
    on("brain_applied", (ev) => {
      useBrain.setState((s) => {
        const applied = { ...s.applied }, refused = { ...s.refused };
        for (const a of ev.applied) {
          delete refused[a.file];
          if (a.verdict === "restore") delete applied[a.file]; else applied[a.file] = a.verdict;
        }
        for (const r of ev.refused) refused[r.file] = r.reason;
        const done = new Set(ev.applied.map((a) => a.file));
        return { applied, refused, picked: s.picked.filter((f) => !done.has(f)) };
      });
      if (useBrain.getState().showExpired) send({ type: "brain_expired" }); // a Keep there: the rows again
      if (useBrain.getState().showNoTopic) askNoTopic();
    }),
    on("make_task_done", (ev) => { // a capture's task (ticket 820): Allow marked it read
      if (!ev.capture || !ev.ok) return;
      const file = ev.capture;
      act(file);
      useBrain.setState((s) => ({ applied: { ...s.applied, [file]: "task" } }));
      if (useBrain.getState().showNoTopic) askNoTopic();
    }),
    on("make_task_undone", (ev) => {
      if (!ev.capture || !ev.ok) return;
      const file = ev.capture;
      useBrain.setState((s) => { const applied = { ...s.applied }; delete applied[file]; return { applied }; });
      if (useBrain.getState().showNoTopic) askNoTopic();
    }),
    on("brain_expired", (ev) => useBrain.setState({ expired: ev })),
    on("brain_notopic", (ev) => useBrain.setState({ notopic: ev })),
    on("brain_note", (ev) => { if (ev.file === useBrain.getState().file) useBrain.setState({ note: ev }); }),
    useViews.subscribe((s) => {
      const v = s.view;
      if (IN_BRAIN.includes(v) && !inBrain) { inBrain = true; useBrain.setState({ snap: null, soon: [] }); } // a new visit: a new order
      else if (!IN_BRAIN.includes(v)) { inBrain = false; useBrain.setState({ showExpired: false, showNoTopic: false, acted: [] }); }
      if (v === "note") onPage = true;
      else if (onPage) { onPage = false; leave(useBrain.getState().note); }
    }),
  ];
  return () => offs.forEach((off) => off());
}
