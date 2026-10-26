import { describe, expect, it } from "vitest";
import { barFor, type BarInput } from "./bar";

const at = (over: Partial<BarInput>): BarInput => ({
  view: "home", folder: null, vault: "/dev/notes", repo: "", label: null, items: null, task: null, routine: null, note: null, ...over,
});

describe("top bar", () => {
  it("reads destination › item on every screen, never 'No repo open'", () => {
    expect(barFor(at({ view: "home" }))).toEqual({ dest: "home", item: null, session: false, homeChat: false });
    expect(barFor(at({ view: "chat" }))).toMatchObject({ dest: "sessions", item: null, session: false });
    expect(barFor(at({ view: "chat", folder: "/dev/web", repo: "web", label: "fix the login" })))
      .toMatchObject({ dest: "sessions", item: "web · fix the login", session: true });
    expect(barFor(at({ view: "chat", folder: "/dev/notes", repo: "notes", label: "plan the week" })))
      .toMatchObject({ dest: "home", item: "Home chat · plan the week", session: true }); // the vault session is the Home chat
    expect(barFor(at({ view: "task", task: "Call acme" }))).toMatchObject({ dest: "brain", item: "Call acme" });
    expect(barFor(at({ view: "routine", routine: "Morning brief" }))).toMatchObject({ dest: "routines", item: "Morning brief" });
    expect(barFor(at({ view: "items", items: { source: "vikunja", id: null, title: null } }))).toMatchObject({ dest: "tasks", item: null });
    expect(barFor(at({ view: "items", items: { source: "notes", id: null, title: null } }))).toMatchObject({ dest: "brain", item: "Waiting for a verdict" });
    expect(barFor(at({ view: "brain" }))).toMatchObject({ dest: "brain", item: null, session: false });
    expect(barFor(at({ view: "note", note: "Alpha" }))).toMatchObject({ dest: "brain", item: "Alpha", session: false });
    expect(barFor(at({ view: "item", items: { source: "vikunja", id: "42", title: "Ship it" } }))).toMatchObject({ dest: "tasks", item: "#42 Ship it" });
    expect(barFor(at({ view: "item", items: { source: "prs", id: "globex/api#7", title: null } }))).toMatchObject({ dest: "home", item: "globex/api#7" });
    expect(barFor(at({ view: "settings" }))).toMatchObject({ dest: "settings", item: null });
  });

  it("shows the Home chat chip on Brain, Tasks and Routines only, and never on a session", () => {
    const chip = (over: Partial<BarInput>) => barFor(at(over)).homeChat;
    expect(chip({ view: "task" })).toBe(true);
    expect(chip({ view: "brain" })).toBe(true);
    expect(chip({ view: "note", note: "Alpha" })).toBe(true);
    expect(chip({ view: "items", items: { source: "vikunja", id: null, title: null } })).toBe(true);
    expect(chip({ view: "routines" })).toBe(true);
    expect(chip({ view: "home" })).toBe(false);
    expect(chip({ view: "sessions" })).toBe(false);
    expect(chip({ view: "settings" })).toBe(false);
    expect(chip({ view: "chat", folder: "/dev/notes", repo: "notes" })).toBe(false);
  });
});
