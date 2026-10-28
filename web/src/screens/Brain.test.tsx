// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { BrainListEvent, BrainNote, BrainNoteEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useViews } from "../stores/views";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { Brain, BrainAdjust, BrainSiblings, NotePage } = await import("./Brain");
const { brainRows, openNote, scoreDot, useBrain, wireBrain } = await import("../stores/brain");

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
  useBrain.setState({ list: null, file: null, note: null, filter: NO_FILTER, snap: null, applied: {}, refused: {}, picked: [] });
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
