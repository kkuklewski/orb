// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useFeatures } from "../stores/features";
import { initialMeta, useMeta } from "../stores/meta";
import { initialSession, useSession } from "../stores/session";
import { folder, session } from "../test/fixtures";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));
const { StartBar } = await import("./Start");

const notes = { label: "notes", rel: "notes", path: "/Users/a/notes", sessions: [session("n1", "idle", { empty: true })] };

beforeEach(() => {
  sent.length = 0;
  useMeta.setState(initialMeta());
  useSession.setState({ ...initialSession(), folder: notes.path, session: "n1", label: "notes" });
  useFeatures.setState({
    features: { vault: notes.path } as never,
    folders: [
      notes,
      { ...folder("web", [session("w1", "idle"), session("w2", "idle", { empty: true })]), pinned: true },
      { ...folder("api", [session("a1", "done")]), last_used: 30 },
    ],
  });
});
afterEach(cleanup);

const open = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const options = () => screen.getAllByRole("menuitemradio").map((b) => b.querySelector(".st-opt-name")!.textContent);

describe("start page", () => {
  it("is in Brain by default and lists Brain, pinned, then recent projects", () => {
    render(<StartBar />);
    open("Brain");
    expect(options()).toEqual(["Brain", "web", "api"]);
    expect(screen.getByRole("menuitemradio", { name: /Brain/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Search projects"), { target: { value: "ap" } });
    expect(options()).toEqual(["api"]);
  });

  it("another project reuses its unused session, or starts one", () => {
    render(<StartBar />);
    open("Brain");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "web" }));
    expect(sent).toEqual([{ type: "open_folder", path: "/Users/a/code/web", session: "w2" }]);
    open("Brain");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "api" }));
    expect(sent[1]).toEqual({ type: "start_session", path: "/Users/a/code/api" });
  });

  it("picks the model and the approvals mode", () => {
    render(<StartBar />);
    open("Sonnet");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Opus/ }));
    expect(sent).toContainEqual({ type: "set_model", model: "opus" });
    open("Default");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^Auto/ }));
    expect(sent).toContainEqual({ type: "set_mode", mode: "auto" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
