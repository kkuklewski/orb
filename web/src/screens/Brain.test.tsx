// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BrainExpiredEvent, BrainListEvent, BrainNoTopicEvent, BrainNote, BrainNoteEvent, ExpiredNote, NoTopicNote } from "../protocol.gen";
import { dispatch } from "../events";
import { useViews } from "../stores/views";
import { useFeatures } from "../stores/features";
import { useSession } from "../stores/session";
import { wireMakeTask } from "../stores/routine";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { Brain, BrainAdjust, BrainSiblings, NotePage } = await import("./Brain");
const { GROUPS, SOON_DAYS, brainRows, daysLeft, expiringSoon, expiryText, localDay, openNote, scoreDot, suggestionGroups, useBrain, wireBrain } =
  await import("../stores/brain");

const note = (file: string, over: Partial<BrainNote> = {}): BrainNote => ({
  file, title: file.replace(/^.*\/|\.md$/g, ""), kind: "capture", mtime: Date.now() / 1000 - 3600, score: null, lane: "", why: "",
  waiting: true, verdict: "", owner_read: "", ...over,
});
const NOTES = [
  note("scrapers/Inbox/alpha.md", { score: 9, lane: "news", why: "new release" }),
  note("inbox/beta.md", { kind: "your note", waiting: false }),
  note("scrapers/Topics/gamma.md", { kind: "AI", score: 3, lane: "learning" }),
];
const list = (notes = NOTES): BrainListEvent => ({ type: "brain_list", notes, error: "" });
const page = (n: BrainNote, over: Partial<BrainNoteEvent> = {}): BrainNoteEvent => ({ ...n, type: "brain_note", body: "# Alpha\n\nThe text.", ...over });
const NO_FILTER = { waiting: false, kinds: [], lanes: [], q: "" };

let off = () => {};
beforeEach(() => {
  sent.length = 0;
  useBrain.setState({ list: null, file: null, note: null, filter: NO_FILTER, snap: null, applied: {}, refused: {}, picked: [], soon: [], expired: null, showExpired: false,
    notopic: null, showNoTopic: false, acted: [] });
  useViews.setState({ view: "home" });
  off = wireBrain();
});
afterEach(() => { off(); cleanup(); });

describe("Brain helpers", () => {
  it("dots the value score: high, middle, low, none", () => {
    expect([9, 8, 7, 5, 4, 0, null].map(scoreDot)).toEqual(["dot v-hi", "dot v-hi", "dot v-mid", "dot v-mid", "dot v-lo", "dot v-lo", "dot"]);
  });

  it("keeps the snapshot's order; a note it hasn't seen goes last", () => {
    const newer = note("inbox/new.md");
    const rows = brainRows([newer, NOTES[2], NOTES[0], NOTES[1]], NO_FILTER, NOTES.map((n) => n.file));
    expect(rows.map((n) => n.title)).toEqual(["alpha", "beta", "gamma", "new"]);
  });
});

describe("Brain list", () => {
  it("asks for the notes and shows one line each: title, kind, when, the dot and the why", () => {
    useViews.setState({ view: "brain" });
    const { container } = render(<Brain />);
    expect(sent).toContainEqual({ type: "brain_list" });
    act(() => dispatch(list()));
    expect(screen.getByText("3 recent · 2 waiting for a verdict")).toBeTruthy();
    expect([...container.querySelectorAll(".rt-name")].map((e) => e.textContent)).toEqual(["alpha", "beta", "gamma"]);
    expect(container.querySelector(".rt-line .dot")?.className).toBe("dot v-hi");
    expect(screen.getByText("new release")).toBeTruthy();
    expect(screen.getAllByText("1h").length).toBe(3);
    expect(container.textContent).not.toMatch(/\bNotes\b/);
  });

  it("the panel's filters and search narrow the list; its order holds while Brain is open", () => {
    useViews.setState({ view: "brain" });
    const { container } = render(<><Brain /><BrainAdjust /></>);
    act(() => dispatch(list()));
    const names = () => [...container.querySelectorAll("#brain-list .rt-name")].map((e) => e.textContent);
    fireEvent.click(screen.getByText("Unreviewed only"));
    expect(names()).toEqual(["alpha", "gamma"]);
    fireEvent.click(screen.getByLabelText("AI"));
    expect(names()).toEqual(["gamma"]);
    fireEvent.click(screen.getByText("All"));
    fireEvent.click(screen.getByLabelText("news"));
    expect(names()).toEqual(["alpha"]);
    act(() => useBrain.setState({ filter: NO_FILTER }));
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "GAM" } });
    expect(names()).toEqual(["gamma"]);
    act(() => useBrain.setState({ filter: NO_FILTER }));
    // alpha gets a verdict: the server's list now has it first by mtime; it keeps its place
    act(() => dispatch(list([{ ...NOTES[1] }, { ...NOTES[2] }, { ...NOTES[0], verdict: "approve 2026-10-25", waiting: false }])));
    expect(names()).toEqual(["alpha", "beta", "gamma"]);
    expect(screen.getByText("approved 2026-10-25 · new release")).toBeTruthy();
    // leaving and coming back takes a new order
    act(() => useViews.setState({ view: "home" }));
    act(() => useViews.setState({ view: "brain" }));
    act(() => dispatch(list([NOTES[1], NOTES[2], NOTES[0]])));
    expect(names()).toEqual(["beta", "gamma", "alpha"]);
  });

  it("without a notes folder, says so and opens its setting", () => {
    useViews.setState({ view: "brain" });
    render(<Brain />);
    act(() => dispatch({ type: "brain_list", notes: [], error: "No notes folder is set up." }));
    fireEvent.click(screen.getByText("Set the folder"));
    expect(useViews.getState()).toMatchObject({ view: "settings", settingsAt: "notes" });
  });
});

describe("a note's page", () => {
  it("opens from a line: header line, body as text, siblings in the panel", () => {
    useViews.setState({ view: "brain" });
    render(<Brain />);
    act(() => dispatch(list()));
    fireEvent.click(screen.getByText("alpha"));
    expect(useViews.getState().view).toBe("note");
    expect(sent).toContainEqual({ type: "brain_get", file: NOTES[0].file });
    cleanup();
    const view = render(<><NotePage /><BrainSiblings /></>);
    act(() => dispatch(page(NOTES[0], { body: "# Alpha\n\n<b>not html</b>" })));
    expect(screen.getByText("score 9 · news · new release")).toBeTruthy();
    expect(view.container.querySelector(".note-body h1")?.textContent).toBe("Alpha");
    expect(view.container.querySelector(".note-body script, .note-body [onerror]")).toBeNull();  // sanitized
    expect(view.container.querySelector("[aria-label=\"Brain's notes\"]")?.querySelector("[aria-current=page]")?.textContent).toContain("alpha");
  });

  it("Verdict: approve or reject send what the page saw; a verdict offers Restore", () => {
    act(() => { useBrain.setState({ list: list() }); openNote(NOTES[0].file); });
    render(<NotePage />);
    act(() => dispatch(page(NOTES[0])));
    expect(screen.queryByText("Restore")).toBeNull();
    fireEvent.click(screen.getByText("Reject"));
    expect(sent.at(-1)).toEqual({ type: "brain_verdict", file: NOTES[0].file, verdict: "reject", seen: "" });
    act(() => dispatch(page(NOTES[0], { verdict: "reject 2026-10-25", waiting: false })));
    expect(screen.getByText("rejected 2026-10-25")).toBeTruthy();
    expect(screen.queryByText("Reject")).toBeNull();
    fireEvent.click(screen.getByText("Restore"));
    expect(sent.at(-1)).toEqual({ type: "brain_verdict", file: NOTES[0].file, verdict: "restore", seen: "reject 2026-10-25" });
    act(() => dispatch(page(NOTES[0])));
    expect(screen.getByText("Approve")).toBeTruthy();
  });

  it("marks it read only on leaving, once, and never after a verdict", () => {
    const reads = () => sent.filter((m) => m.type === "brain_read");
    act(() => openNote(NOTES[0].file));
    act(() => dispatch(page(NOTES[0])));
    expect(reads()).toEqual([]); // opening writes nothing
    act(() => openNote(NOTES[2].file)); // another note from the panel: leaving the first
    expect(reads()).toEqual([{ type: "brain_read", file: NOTES[0].file, seen: "" }]);
    act(() => dispatch(page(NOTES[2], { verdict: "approve 2026-10-25" })));
    act(() => useViews.setState({ view: "home" }));
    expect(reads().length).toBe(1); // a judged note isn't marked read
    act(() => openNote(NOTES[0].file));
    act(() => dispatch(page(NOTES[0], { owner_read: "2026-10-25" })));
    act(() => useViews.setState({ view: "brain" }));
    expect(reads().length).toBe(1); // already read: never twice
  });
});

describe("Brain suggestions", () => {
  const A = note("scrapers/Inbox/alpha.md", { score: 9, lane: "news", why: "new release", suggest: "approve" });
  const B = note("scrapers/Inbox/beta.md", { score: 8, suggest: "approve" });
  const C = note("scrapers/Inbox/gamma.md", { score: 2, lane: "learning", why: "old news", suggest: "reject" });
  const D = note("scrapers/Inbox/delta.md", { score: 6 }); // 5 to 7: no suggestion, the owner reads it
  const applied = (applied: { file: string; verdict: string }[], refused: { file: string; reason: string }[] = []) =>
    dispatch({ type: "brain_applied", applied, refused } as never);
  const judged = (n: BrainNote, verdict: string): BrainNote => ({ ...n, waiting: false, suggest: "", verdict: `${verdict} 2026-10-25` });
  const group = (name: string) => screen.getByRole("region", { name });
  const names = (el: HTMLElement) => [...el.querySelectorAll(".rt-name")].map((e) => e.textContent);

  function show(notes = [A, B, C, D]) {
    useViews.setState({ view: "brain" });
    const r = render(<Brain />);
    act(() => dispatch(list(notes)));
    return r;
  }

  it("groups the notes by suggestion; a row is title, score, lane, why and the word; none reads drop", () => {
    const { container } = show();
    expect(names(group("Suggested: approve"))).toEqual(["alpha", "beta"]);
    expect(names(group("Suggested: reject"))).toEqual(["gamma"]);
    expect(within(group("Suggested: approve")).getByText("score 9 · news · new release")).toBeTruthy();
    expect(within(group("Suggested: reject")).getByRole("button", { name: "reject gamma" }).textContent).toBe("reject");
    expect(screen.getByText("Other notes")).toBeTruthy();
    expect(names(container.querySelector("#brain-list") as HTMLElement).at(-1)).toBe("delta"); // no suggestion: a plain line
    expect(container.textContent).not.toMatch(/drop/i);
  });

  it("accepting a row writes its verdict; the row keeps its place and shows Restore, which undoes it", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "approve alpha" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: A.file, seen: "", verdict: "approve" }] });
    act(() => { applied([{ file: A.file, verdict: "approve" }]); dispatch(list([judged(A, "approve"), B, C, D])); });
    const row = within(group("Suggested: approve"));
    expect(row.getByText("approved 2026-10-25")).toBeTruthy();
    fireEvent.click(row.getByRole("button", { name: "Restore alpha" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: A.file, seen: "approve 2026-10-25", verdict: "restore" }] });
    act(() => { applied([{ file: A.file, verdict: "restore" }]); dispatch(list()); });
    act(() => dispatch(list([A, B, C, D])));
    expect(within(group("Suggested: approve")).getByRole("button", { name: "approve alpha" })).toBeTruthy();
  });

  it("select several and Apply suggestions: each its own verdict; a refused one keeps its row with the reason", () => {
    show();
    fireEvent.click(within(group("Suggested: approve")).getByRole("button", { name: "Select all" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select gamma" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestions (3)" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [
      { file: A.file, seen: "", verdict: "approve" }, { file: B.file, seen: "", verdict: "approve" }, { file: C.file, seen: "", verdict: "reject" }] });
    act(() => {
      applied([{ file: A.file, verdict: "approve" }, { file: C.file, verdict: "reject" }], [{ file: B.file, reason: "The note changed since Orb read it" }]);
      dispatch(list([judged(A, "approve"), B, judged(C, "reject"), D]));
    });
    expect(within(group("Suggested: approve")).getByRole("alert").textContent).toBe("The note changed since Orb read it");
    expect((screen.getByRole("checkbox", { name: "Select beta" }) as HTMLInputElement).checked).toBe(true); // still picked
    expect(screen.getByRole("button", { name: "Apply suggestions (1)" })).toBeTruthy();
    // Restore undoes one verdict applied in bulk.
    fireEvent.click(within(group("Suggested: reject")).getByRole("button", { name: "Restore gamma" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: C.file, seen: "reject 2026-10-25", verdict: "restore" }] });
  });
});

describe("Expiry (ADR 0013)", () => {
  const TODAY = "2026-10-27";
  const day = (n: number) => { const d = new Date(); return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
  const ai = (file: string, expires: string, over: Partial<BrainNote> = {}) =>
    note(`scrapers/Topics/${file}.md`, { kind: "AI", score: 3, waiting: false, expires, ...over });

  it("the chip: in N days, in 1 day, today on the day, tonight once past it; none without an expiry day", () => {
    expect(["2026-11-03", "2026-10-28", TODAY, "2026-10-26", ""].map((expires) => expiryText({ expires }, TODAY)))
      .toEqual(["expires in 7 days", "expires in 1 day", "expires today", "expires tonight", ""]);
    expect(daysLeft({ expires: "2026-11-02" }, TODAY)).toBe(6); // across the clock change
  });

  it("Expiring soon is the pages within 3 days, past ones included; it sits above Reject", () => {
    expect(SOON_DAYS).toBe(3);
    const rows = [ai("in3", "2026-10-30"), ai("in4", "2026-10-31"), ai("past", "2026-10-25"), ai("none", "")];
    expect(expiringSoon(rows, TODAY).map((n) => n.title)).toEqual(["in3", "past"]);
    expect(GROUPS).toEqual(["approve", "soon", "reject"]);
    const g = suggestionGroups([...rows, note("scrapers/Inbox/r.md", { suggest: "reject" })], {}, ["scrapers/Topics/in3.md"]);
    expect([g.soon.map((n) => n.title), g.reject.map((n) => n.title)]).toEqual([["in3"], ["r"]]);
  });

  function show(notes: BrainNote[]) {
    useViews.setState({ view: "brain" });
    const r = render(<Brain />);
    act(() => dispatch(list(notes)));
    return r;
  }
  const group = (name: string) => screen.getByRole("region", { name });
  const regions = () => screen.getAllByRole("region").map((e) => e.getAttribute("aria-label"));

  it("shows the chip on a page that expires, Expiring soon above Reject, and none on a page that doesn't", () => {
    const { container } = show([note("scrapers/Inbox/acme.md", { suggest: "reject", score: 2 }), ai("globex", day(2)), ai("later", day(9)),
      note("inbox/mine.md", { kind: "your note", waiting: false })]);
    expect(regions()).toEqual(["Expiring soon", "Suggested: reject", "Other notes"]);
    expect(within(group("Expiring soon")).getByText("expires in 2 days")).toBeTruthy();
    expect(within(group("Other notes")).getByText("expires in 9 days")).toBeTruthy();
    expect(container.querySelectorAll(".exp-chip").length).toBe(2);
    expect(within(group("Expiring soon")).queryByRole("button", { name: "Select all" })).toBeNull();
  });

  it("Keep sends the approve verdict like any other; the page stays in the group with Restore, a stale one shows why", () => {
    const G = ai("globex", day(0)), A = ai("acme", day(-1));
    show([G, A]);
    expect(within(group("Expiring soon")).getByText("expires tonight")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep globex" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: G.file, seen: "", verdict: "approve" }] });
    act(() => {
      dispatch({ type: "brain_applied", applied: [{ file: G.file, verdict: "approve" }], refused: [] } as never);
      dispatch(list([{ ...G, verdict: "approve 2026-10-27", expires: "" }, A]));
    });
    expect(within(group("Expiring soon")).getByRole("button", { name: "Restore globex" })).toBeTruthy();
    expect(within(group("Expiring soon")).queryByText("expires today")).toBeNull(); // kept: the vault's rule no longer covers it
    fireEvent.click(screen.getByRole("button", { name: "Keep acme" }));
    act(() => dispatch({ type: "brain_applied", applied: [], refused: [{ file: A.file, reason: "The note changed since Orb read it" }] } as never));
    expect(within(group("Expiring soon")).getByRole("alert").textContent).toBe("The note changed since Orb read it");
  });
});

describe("Expired view (ADR 0013)", () => {
  const gone = (file: string, archived: string, over: Partial<ExpiredNote> = {}): ExpiredNote =>
    ({ ...note(`scrapers/Topics/${file}.md`, { kind: "AI", score: 3, waiting: false, why: "thin rewrite" }), archived, ...over });
  const expired = (notes: ExpiredNote[]): BrainExpiredEvent => ({ type: "brain_expired", notes, error: "" });

  it("opens from Brain's head, asks for the pages and lists them as the server sent: title, score, why, archive date", () => {
    useViews.setState({ view: "brain" });
    render(<Brain />);
    act(() => dispatch(list()));
    fireEvent.click(screen.getByRole("button", { name: "Expired" }));
    expect(sent.at(-1)).toEqual({ type: "brain_expired" });
    act(() => dispatch(expired([gone("globex", "2026-10-26"), gone("acme", "2026-10-20", { score: null, why: "" })])));
    const rows = within(screen.getByRole("region", { name: "Expired pages" })).getAllByRole("button", { name: /^Keep / });
    expect(rows.map((b) => b.getAttribute("aria-label"))).toEqual(["Keep globex", "Keep acme"]);
    expect(screen.getByText("score 3 · thin rewrite · archived 2026-10-26")).toBeTruthy();
    expect(screen.getByText("archived 2026-10-20")).toBeTruthy();
    expect(screen.getByText("2 archived by the vault in the last 30 days")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Restore/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "acme" }));
    expect(useBrain.getState().file).toBe("scrapers/Topics/acme.md");
  });

  it("Keep sends approve; the row then says kept and stays, and the view asks again", () => {
    const G = gone("globex", "2026-10-26");
    useViews.setState({ view: "brain" });
    useBrain.setState({ showExpired: true });
    render(<Brain />);
    act(() => dispatch(expired([G])));
    fireEvent.click(screen.getByRole("button", { name: "Keep globex" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: G.file, seen: "", verdict: "approve" }] });
    sent.length = 0;
    act(() => dispatch({ type: "brain_applied", applied: [{ file: G.file, verdict: "approve" }], refused: [] } as never));
    expect(sent).toContainEqual({ type: "brain_expired" });
    act(() => dispatch(expired([{ ...G, verdict: "approve 2026-10-27" }])));
    expect(screen.getByText("kept")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep globex" })).toBeNull();
  });

  it("empty: says so; Back to notes returns to the list", () => {
    useViews.setState({ view: "brain" });
    useBrain.setState({ showExpired: true });
    render(<Brain />);
    act(() => dispatch(expired([])));
    expect(screen.getByText("No page expired in the last 30 days.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to notes" }));
    expect(useBrain.getState().showExpired).toBe(false);
  });
});

describe("No topic view (ticket 820)", () => {
  const cap = (name: string, created: string, over: Partial<NoTopicNote> = {}): NoTopicNote =>
    ({ ...note(`inbox/captures/${name}.md`, { waiting: false }), created, ...over });
  const orphans = (notes: NoTopicNote[]): BrainNoTopicEvent => ({ type: "brain_notopic", notes, error: "" });
  const A = cap("acme-idea", "2026-10-10"), G = cap("globex-task", "2026-10-27");

  it("Brain's head counts them; the chip opens the view, oldest first, Keep and Drop per row, nothing to select", () => {
    useViews.setState({ view: "brain" });
    render(<Brain />);
    expect(sent).toContainEqual({ type: "brain_notopic", files: [] });
    act(() => { dispatch(list()); dispatch(orphans([A, G])); });
    fireEvent.click(screen.getByRole("button", { name: "No topic 2" }));
    const region = screen.getByRole("region", { name: "No-topic captures" });
    expect(within(region).getAllByRole("button", { name: /^Keep / }).map((b) => b.getAttribute("aria-label"))).toEqual(["Keep acme-idea", "Keep globex-task"]);
    expect(within(region).getAllByRole("button", { name: /^Drop / })).toHaveLength(2);
    expect(within(region).queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Apply/ })).toBeNull();
    expect(screen.getByText("capture · 2026-10-10")).toBeTruthy();
  });

  it("Keep sends brain_keep; the row says kept and stays, asked again with the files acted on", () => {
    useViews.setState({ view: "brain" });
    useBrain.setState({ showNoTopic: true });
    render(<Brain />);
    act(() => dispatch(orphans([A, G])));
    fireEvent.click(screen.getByRole("button", { name: "Keep acme-idea" }));
    expect(sent.at(-1)).toEqual({ type: "brain_keep", file: A.file, seen: "" });
    sent.length = 0;
    act(() => dispatch({ type: "brain_applied", applied: [{ file: A.file, verdict: "keep" }], refused: [] } as never));
    expect(sent).toContainEqual({ type: "brain_notopic", files: [A.file] });
    act(() => dispatch(orphans([{ ...A, owner_read: "2026-10-28" }, G])));
    expect(screen.getByText("kept as an idea")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Keep acme-idea" })).toBeNull();
  });

  it("Drop sends the reject verdict; the row says dropped with Restore, which sends restore", () => {
    useViews.setState({ view: "brain" });
    useBrain.setState({ showNoTopic: true });
    render(<Brain />);
    act(() => dispatch(orphans([G])));
    fireEvent.click(screen.getByRole("button", { name: "Drop globex-task" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: G.file, seen: "", verdict: "reject" }] });
    act(() => dispatch({ type: "brain_applied", applied: [{ file: G.file, verdict: "reject" }], refused: [] } as never));
    act(() => dispatch(orphans([{ ...G, verdict: "reject 2026-10-28" }])));
    expect(screen.getByText("dropped")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore globex-task" }));
    expect(sent.at(-1)).toEqual({ type: "brain_apply", notes: [{ file: G.file, seen: "reject 2026-10-28", verdict: "restore" }] });
  });

  it("a refused Keep shows its reason; leaving Brain closes the view and forgets the rows acted on", () => {
    useViews.setState({ view: "brain" });
    useBrain.setState({ showNoTopic: true });
    render(<Brain />);
    act(() => dispatch(orphans([A])));
    fireEvent.click(screen.getByRole("button", { name: "Keep acme-idea" }));
    act(() => dispatch({ type: "brain_applied", applied: [], refused: [{ file: A.file, reason: "The note changed since Orb read it." }] } as never));
    expect(screen.getByRole("alert").textContent).toBe("The note changed since Orb read it.");
    act(() => useViews.setState({ view: "home" }));
    expect(useBrain.getState()).toMatchObject({ showNoTopic: false, acted: [] });
  });

  it("every row has Make it a task and New topic; a task capture leads with Make it a task and shows its own kind", () => {
    useViews.setState({ view: "brain" });
    useBrain.setState({ showNoTopic: true });
    render(<Brain />);
    act(() => dispatch(orphans([A, { ...G, capture: "task" }])));
    const acts = (name: string) => [...screen.getByRole("button", { name: `Keep ${name}` }).parentElement!.querySelectorAll("button")].map((b) => b.textContent);
    expect(acts("acme-idea")).toEqual(["Keep", "Make it a task", "New topic", "Drop"]);
    expect(acts("globex-task")).toEqual(["Make it a task", "Keep", "New topic", "Drop"]);
    expect(screen.getByText("task · 2026-10-27")).toBeTruthy();
  });

  it("Make it a task asks the server for the card, shows it under that row only; Allow marks it made, Undo takes it back", () => {
    const offTask = wireMakeTask();
    useViews.setState({ view: "brain" });
    useBrain.setState({ showNoTopic: true });
    render(<Brain />);
    act(() => dispatch(orphans([A, G])));
    fireEvent.click(screen.getByRole("button", { name: "Make a task of acme-idea" }));
    expect(sent.at(-1)).toEqual({ type: "make_task", capture: A.file });
    act(() => dispatch({ type: "make_task_card", id: "c1", routine: "", capture: A.file, title: "acme-idea", project: "Inbox" } as never));
    const card = screen.getByRole("group", { name: "Make it a task" });
    expect(card.closest(".nt-line")!.textContent).toContain("acme-idea");
    expect(screen.getAllByRole("group", { name: "Make it a task" })).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "Create the task" }));
    expect(sent.at(-1)).toEqual({ type: "make_task_confirm", id: "c1", ok: true });
    sent.length = 0;
    act(() => dispatch({ type: "make_task_done", id: "c1", ok: true, task: 9, title: "acme-idea", project: "Inbox", url: "", error: "", capture: A.file } as never));
    expect(sent).toContainEqual({ type: "brain_notopic", files: [A.file] });
    expect(screen.getByText("made a task")).toBeTruthy();
    sent.length = 0;
    act(() => dispatch({ type: "make_task_undone", task: 9, ok: true, capture: A.file } as never));
    expect(sent).toContainEqual({ type: "brain_notopic", files: [A.file] });
    expect(screen.queryByText("made a task")).toBeNull();
    offTask();
  });

  it("New topic opens the notes session with the brief in its composer, nothing sent to the model", () => {
    useFeatures.setState({ features: { vault: "/Users/a/notes" } as never, folders: [] });
    useViews.setState({ view: "brain" });
    useBrain.setState({ showNoTopic: true });
    render(<Brain />);
    act(() => dispatch(orphans([A])));
    fireEvent.click(screen.getByRole("button", { name: "New topic for acme-idea" }));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/Users/a/notes" });
    expect(useSession.getState().pendingDraft).toContain(A.file);
    expect(sent.some((m) => m.type === "user_text")).toBe(false);
  });
});
