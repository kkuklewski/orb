// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Features, HomeEvent, ServerEvent } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { initialMeta, useMeta } from "../stores/meta";
import { initialSession, useSession, wireSession } from "../stores/session";
import { initialSetup, useSetup, wireSetup } from "../stores/setup";
import { ASK_TODAY, greeting, needsYou, routinesLine, useHome, wireHome } from "../stores/home";
import { folder, routine, routines, session, status } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
vi.stubGlobal("AudioContext", undefined);

const { Home } = await import("./Home");
const { Notes } = await import("./setup/steps");

const features = (over: Partial<Features> = {}): Features => ({
  brain: false, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: true, stt: "browser", tts: "kokoro", vault: "/Users/a/notes", ...over,
});
const notes = (over: Partial<HomeEvent> = {}): HomeEvent => ({
  type: "home", vault: "/Users/a/notes", open_tasks: 14, notes_week: 9,
  tasks: [{ text: "Send the invoice", file: "inbox/today.md", line: 3, mtime: 1, raw: "- [ ] Send the invoice" }], snoozed: 0,
  notes: [{ title: "Weekly review", file: "reviews/w43.md", mtime: Date.now() / 1000 - 3600 }], ...over,
});

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  offs = [wireSession(), wireHome(), wireSetup()];
  useSession.setState(initialSession());
  useViews.setState({ view: "home", settings: null, routines: routines({ items: [routine({ last: { id: "r", outcome: "ok" } })] }), routinesNew: new Set() });
  useFeatures.setState({ features: features(), folders: [folder("web", [session("w1", "approval", { label: "fix login" })])], services: {}, build: null });
  useHome.setState({ notes: null, watch: null });
  useSetup.setState(initialSetup);
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

describe("home helpers", () => {
  it("greets by the hour", () => {
    expect([3, 9, 14, 21].map(greeting)).toEqual(["Working late.", "Good morning.", "Good afternoon.", "Good evening."]);
  });
  it("needs you: waiting sessions and routines that need attention", () => {
    const n = needsYou([folder("web", [session("a", "approval"), session("b", "working"), session("c", "idle")])], routines({ items: [routine({ needs: "failed" }), routine({ id: "x" })] }));
    expect([n.waiting.length, n.working.length, n.done.length, n.routines.length]).toEqual([1, 1, 0, 1]);
  });
  it("routines line: ok, needing you, the next run", () => {
    const r = routines({ needs: 1, items: [routine({ last: { id: "1", outcome: "ok" }, next_run_at: 200 }), routine({ id: "b", name: "inbox", needs: "failed", next_run_at: 100 })] });
    expect(routinesLine(r, (ts) => `@${ts}`)).toBe("1 ok · 1 needs you · next: inbox @100");
    expect(routinesLine(null, String)).toBe("checking…");
  });
});

describe("home screen", () => {
  it("asks for the notes summary and the routines when it opens", () => {
    render(<Home />);
    expect(sent).toEqual([{ type: "home" }, { type: "routines" }]);
  });

  it("leads with what needs you, then the status cards and the notes", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    const lead = screen.getByRole("article", { name: "1 thing needs you now" });
    expect(within(lead).getByText("fix login")).toBeTruthy();
    expect(screen.getByRole("article", { name: "1 of 1 ran fine" })).toBeTruthy();
    const todo = screen.getByRole("article", { name: "14 open tasks, newest first" });
    expect(within(todo).getByRole("button", { name: "Send the invoice" })).toBeTruthy();
    expect(within(todo).getByText("+ 13 more in your notes")).toBeTruthy();
    expect(screen.getByText("Weekly review")).toBeTruthy();
  });

  it("when Vikunja is set up but down, it says so instead of listing the notes' tasks", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    act(() => useHome.setState({ watch: { type: "home_watch", reminders: [], links: [], repos: [], prs: [], tracker: null,
      tracker_error: "Vikunja didn't answer: timed out" } }));
    const card = screen.getByRole("article", { name: "Vikunja unreachable" });
    expect(within(card).getByText("Vikunja didn't answer: timed out")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send the invoice" })).toBeNull();
  });

  it("a task's checkbox marks it done; its text opens the task", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    sent.length = 0;
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark done: Send the invoice" }));
    expect(sent).toEqual([{ type: "task_action", file: "inbox/today.md", line: 3, expect: "- [ ] Send the invoice", action: "done" }]);
    fireEvent.click(screen.getByRole("button", { name: "Send the invoice" }));
    expect(sent.at(-1)).toEqual({ type: "task_detail", file: "inbox/today.md", line: 3 });
    expect(useViews.getState().view).toBe("task");
  });

  it("“Ask for today's plan” starts a notes session and sends the question once it opens", () => {
    render(<Home />);
    act(() => dispatch(notes() as ServerEvent));
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Ask for today's plan →" }));
    expect(sent).toEqual([{ type: "start_session", path: "/Users/a/notes" }]);
    act(() => dispatch({ type: "opened", folder: "/Users/a/notes", session: "n1", label: "notes", rel: "notes", branch: null, session_id: null,
      live: false, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    expect(sent.at(-1)).toMatchObject({ type: "user_text", text: ASK_TODAY });
    expect(useViews.getState().view).toBe("chat");
  });

  it("a tile's Ask about this sends its question in the notes folder, with the tile's lines as the screen", () => {
    useHome.setState({ notes: notes() });
    render(<Home />);
    fireEvent.click(within(screen.getByRole("article", { name: /open task/ })).getByRole("button", { name: "Ask about this →" }));
    expect(sent.at(-1)).toEqual({ type: "start_session", path: "/Users/a/notes" });
    const p = useSession.getState();
    expect(p.pendingAsk).toMatch(/which of these tasks/i);
    expect(p.pendingScreen).toEqual({ name: "Tasks in notes", text: "Send the invoice (today)" });
    expect(p.pendingStay).toBe(true);
  });

  it("without a notes folder it offers to connect one", () => {
    useFeatures.setState((s) => ({ features: { ...s.features!, vault: "" } }));
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Choose notes folder" }));
    expect(useSetup.getState()).toMatchObject({ open: true, step: 3 });
    expect(screen.queryByRole("button", { name: "Ask for today's plan →" })).toBeNull();
  });
});

describe("routine results on Home", () => {
  it("the routines card lists only the results worth reading", () => {
    useViews.setState({ routines: routines({ items: [
      routine({ id: "a", name: "Gmail cleanup", new: true, loud: true, worth: "read", last: { id: "r1", outcome: "ok" } }),
      routine({ id: "b", name: "Etihad check", quiet: true, worth: "skip", last: { id: "r2", outcome: "ok" } }),
    ] }) });
    render(<Home />);
    expect(screen.getByText("Gmail cleanup")).toBeTruthy();
    expect(screen.queryByText("Etihad check")).toBeNull();
  });
});

describe("usage warning", () => {
  const low = { five_hour: { utilization: 0.9, resetsAt: Date.now() / 1000 + 3600 } };
  it("appears under 15% and offers Haiku for the open folder", () => {
    useMeta.setState({ ...initialMeta(), windows: {} });
    const { rerender } = render(<Home />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => useMeta.setState({ windows: low }));
    rerender(<Home />);
    expect(screen.getByRole("alert").textContent).toContain("Session 10% left");
    act(() => useSession.setState({ folder: "/Users/a/code/web" }));
    fireEvent.click(screen.getByRole("button", { name: "Use Haiku here" }));
    expect(sent.at(-1)).toEqual({ type: "set_model", model: "haiku" });
  });

  it("with no folder open it offers Haiku for new folders; on Haiku already, no button", () => {
    useMeta.setState({ ...initialMeta(), windows: low });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Haiku for new folders" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { default_model: "haiku" } });
    act(() => useMeta.setState({ front: "haiku" }));
    expect(screen.queryByRole("button", { name: /Haiku/ })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("already uses Haiku");
  });
});

describe("start-up", () => {
  it("reopens the last session quietly: Home stays, a request switches to the chat", () => {
    localStorage.setItem("vd-folder", "/Users/a/code/web");
    localStorage.setItem("vd-session", "w1");
    act(() => dispatch({ type: "hello", build: "x", folders: [folder("web")], services: {}, ...features() } as unknown as ServerEvent));
    expect(sent).toContainEqual({ type: "open_folder", path: "/Users/a/code/web", session: "w1" });
    act(() => dispatch({ type: "opened", folder: "/Users/a/code/web", session: "w1", label: "web", rel: "web", branch: null, session_id: null,
      live: true, busy: false, speech_gen: 0, mode: "default", model: "sonnet", info: {}, tasks: [] }));
    expect(useViews.getState().view).toBe("home");
    act(() => dispatch({ type: "user", id: "u1", text: "hi", source: "voice", session: "w1" }));
    expect(useViews.getState().view).toBe("chat");
  });
});

describe("setup: notes step", () => {
  it("shows the chosen folder with what's in it, and chooses by path or Finder", () => {
    useSetup.setState({ open: true, step: 3, status: status({ vault: { path: "/Users/a/notes", exists: true, notes: 359, open_tasks: 31 } }) });
    render(<Notes />);
    expect(screen.getByText("359 notes · 31 open tasks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notes folder path"), { target: { value: "~/Brain" } });
    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(sent).toContainEqual({ type: "set_settings", values: { vault: "/Users/a/Brain" } });
    fireEvent.click(screen.getByRole("button", { name: "Choose in Finder…" }));
    expect(sent.at(-1)).toEqual({ type: "pick_folder" });
    act(() => dispatch({ type: "picked", path: "/Users/a/Vault" }));
    expect(sent.at(-1)).toEqual({ type: "set_settings", values: { vault: "/Users/a/Vault" } });
  });

  it("is optional: Skip for now", () => {
    useSetup.setState({ open: true, step: 3, status: status() });
    render(<Notes />);
    expect(screen.getByText(/This step is optional/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Skip for now" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Item pages", () => {
  const tracker = { tasks: [{ id: 7, title: "Fix the login", project: "acme", due: null, priority: 0, updated: 1, url: "http://v/tasks/7" }], total: 1, url: "http://v" };
  const detail = { type: "item", source: "vikunja", id: "7", title: "Fix the login", kicker: "VIKUNJA", chips: ["acme"], body: "Users get logged out.\n\n**bold** step",
    url: "http://v/tasks/7", url_label: "Open in Vikunja →", repo: "acme/web", brief: "Help me with a task…", done: false, can_archive: true } as const;

  it("a task opens its page; Start in Orb sends only the source and id; Copy prompt copies the brief", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { ItemPage } = await import("./ItemPage");
    const off = (await import("../stores/items")).wireItems();
    render(<Home />);
    act(() => useHome.setState({ watch: { type: "home_watch", reminders: [], links: [], repos: [], prs: [], tracker, tracker_error: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Fix the login" }));
    expect(sent.at(-1)).toEqual({ type: "item_get", source: "vikunja", id: "7" });
    expect(useViews.getState().view).toBe("item");
    cleanup();
    render(<ItemPage />);
    act(() => dispatch(detail as unknown as ServerEvent));
    expect(screen.getByText("Users get logged out.")).toBeTruthy();
    expect(document.querySelector(".vk-desc strong")?.textContent).toBe("bold");
    fireEvent.click(screen.getByRole("button", { name: "Start in Orb · acme/web" }));
    expect(sent.at(-1)).toEqual({ type: "item_start", source: "vikunja", id: "7" });
    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    expect(writeText).toHaveBeenCalledWith("Help me with a task…");
    act(() => dispatch({ ...detail, repo: null } as unknown as ServerEvent));
    expect((screen.getByRole("button", { name: "Start in Orb" }) as HTMLButtonElement).disabled).toBe(true);
    off();
  });
});

describe("Item table", () => {
  const col = (key: string, label: string, kind = "text") => ({ key, label, kind });
  const row = (id: string, title: string, repo: string | null, priority = 0) => ({ id, title, repo, hot: priority >= 4, cells: { project: "acme", due: "", priority: String(priority) } });
  const list = (rows: ReturnType<typeof row>[]) => ({ type: "item_list", source: "vikunja", kicker: "VIKUNJA", heading: `${rows.length} open tasks`, rows,
    columns: [col("title", "Task", "title"), col("repo", "Repo", "repo"), col("project", "Project", "chip"), col("due", "Due", "due"), col("priority", "Priority", "priority")],
    group_key: "repo", can_archive: true, url: "http://v", url_label: "OPEN VIKUNJA →" }) as unknown as ServerEvent;
  const setup = async (source: "vikunja" | "prs" | "repos" = "vikunja") => {
    const { ItemList } = await import("./ItemList");
    const items = await import("../stores/items");
    const off = items.wireItems();
    items.useItems.setState({ source, lists: {} });
    render(<ItemList />);
    return off;
  };
  const titles = () => screen.getAllByRole("row").map((r) => r.querySelector("td button")?.textContent).filter(Boolean);

  it("groups by repo (biggest first, no repo last), sorts, filters, opens an item", async () => {
    const off = await setup();
    act(() => dispatch(list([row("1", "Beta", null), row("2", "Alpha", "acme/web"), row("3", "Gamma", "acme/api", 4), row("4", "Delta", "acme/api")])));
    expect([...document.querySelectorAll(".vk-grp th")].map((h) => h.textContent)).toEqual(["acme/api 2", "acme/web 1", "No repo 1"]);
    expect(titles()).toEqual(["Gamma", "Delta", "Alpha", "Beta"]);
    expect([...document.querySelectorAll("td.vk-n")].map((c) => c.textContent)).toEqual(["1", "2", "3", "4"]); // Lp. runs on across groups
    fireEvent.click(screen.getByLabelText("Group by repo"));
    expect(document.querySelectorAll(".vk-grp")).toHaveLength(0);
    expect(titles()).toEqual(["Beta", "Alpha", "Gamma", "Delta"]);
    fireEvent.click(screen.getByRole("button", { name: "Repo" }));
    expect(titles()).toEqual(["Gamma", "Delta", "Alpha", "Beta"]); // no repo goes last
    fireEvent.change(screen.getByLabelText("Filter items"), { target: { value: "web" } });
    expect(titles()).toEqual(["Alpha"]);
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(sent.at(-1)).toEqual({ type: "item_get", source: "vikunja", id: "2" });
    off();
  });

  it("Archive marks the task done and offers Undo", async () => {
    const off = await setup();
    act(() => dispatch(list([row("5", "Old chore", "acme/web")])));
    sent.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Archive: Old chore" }));
    expect(sent.at(-1)).toEqual({ type: "item_done", source: "vikunja", id: "5", done: true });
    expect(screen.getByRole("status").textContent).toContain("Archived: Old chore");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(sent.at(-1)).toEqual({ type: "item_done", source: "vikunja", id: "5", done: false });
    expect(screen.queryByRole("status")).toBeNull();
    off();
  });

  it("another source gets the same table: its own columns, grouping by a column, no Archive", async () => {
    const off = await setup("prs");
    const pr = (id: string, title: string, repository: string, idle: string) => ({ id, title, repo: null, hot: false, cells: { repository, state: "", idle } });
    act(() => dispatch({ type: "item_list", source: "prs", kicker: "GITHUB", heading: "3 open pull requests", group_key: "repository", can_archive: false, url: null, url_label: null,
      columns: [col("title", "Pull request", "title"), col("repo", "Local repo", "repo"), col("repository", "Repository", "chip"), col("idle", "Idle", "age")],
      rows: [pr("a/x#1", "#1 · One", "a/x", "9"), pr("a/y#2", "#2 · Two", "a/y", "30"), pr("a/y#3", "#3 · Three", "a/y", "2")] } as unknown as ServerEvent));
    expect([...document.querySelectorAll(".vk-grp th")].map((h) => h.textContent)).toEqual(["a/y 2", "a/x 1"]);
    expect(screen.queryByRole("button", { name: /Archive/ })).toBeNull();
    expect(screen.getByLabelText("Group by repository")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Group by repository"));
    fireEvent.click(screen.getByRole("button", { name: "Idle" }));
    fireEvent.click(screen.getByRole("button", { name: "Idle ↑" })); // descending: numeric, not text
    expect(titles()).toEqual(["#2 · Two", "#1 · One", "#3 · Three"]);
    expect(screen.getByText("30d")).toBeTruthy();
    off();
  });
});
