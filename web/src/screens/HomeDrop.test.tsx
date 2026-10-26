// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Features } from "../protocol.gen";
import { dispatch } from "../events";
import { useFeatures } from "../stores/features";
import { initialSession, useSession, wireSession } from "../stores/session";
import { useDrop, wireDrop } from "../stores/drop";

const sent: Record<string, unknown>[] = [];
vi.mock("../ws", () => ({ send: (m: Record<string, unknown>) => { sent.push(m); return true; } }));

const { HomeDrop } = await import("./HomeDrop");

const features = (over: Partial<Features> = {}): Features => ({
  brain: true, onboarded: true, plan: "max", roots: ["/Users/a/code"], routines: false, stt: "browser", tts: "browser", vault: "/Users/a/notes", ...over,
});

let offs: (() => void)[] = [];
beforeEach(() => {
  sent.length = 0;
  offs = [wireSession(), wireDrop()];
  useSession.setState(initialSession());
  useFeatures.setState({ features: features(), folders: [], services: {}, build: null });
  useDrop.setState({ status: "idle", text: "", items: [] });
});
afterEach(() => { cleanup(); offs.forEach((off) => off()); });

const zone = () => screen.getByRole("article", { name: "Drop zone" });

describe("Home's drop zone", () => {
  it("doesn't show without a notes folder", () => {
    useFeatures.setState({ features: features({ vault: "" }) });
    render(<HomeDrop />);
    expect(screen.queryByRole("article", { name: "Drop zone" })).toBeNull();
  });

  it("sends a pasted link and stays on Home while the job runs, then offers its note", () => {
    render(<HomeDrop />);
    fireEvent.paste(zone(), { clipboardData: { files: [], getData: () => " https://youtu.be/dQw4w9WgXcQ " } });
    expect(sent).toEqual([{ type: "drop", url: "https://youtu.be/dQw4w9WgXcQ" }]);
    act(() => dispatch({ type: "drop_routed", ok: true, route: "youtube", text: "YouTube → transcript", id: "d1" }));
    expect(sent).toHaveLength(1); // no session, no screen change
    expect(screen.getByText("https://youtu.be/dQw4w9WgXcQ")).toBeTruthy();
    expect(screen.getByText("YouTube → transcript · Working…")).toBeTruthy();
    act(() => dispatch({ type: "drop_done", id: "d1", ok: true, text: "Saved: Acme talk", note: "scrapers/Transcripts/2026-10-25-dQw4w9WgXcQ.md" }));
    expect(screen.getByText("YouTube → transcript · Saved: Acme talk")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open note" }));
    expect(sent.at(-2)).toEqual({ type: "brain_get", file: "scrapers/Transcripts/2026-10-25-dQw4w9WgXcQ.md" });
  });

  it("follows a session's drop by its status and opens it on request", () => {
    useFeatures.setState({ folders: [{ path: "/Users/a/notes", label: "notes", sessions: [{ key: "k1", status: "approval", empty: false }] }] as never });
    render(<HomeDrop />);
    fireEvent.change(screen.getByRole("textbox", { name: "Paste a link" }), { target: { value: "https://blog.acme.example/post" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "Paste a link" }).closest("form")!);
    act(() => dispatch({ type: "drop_routed", ok: true, route: "link", text: "Link → saved to Brain", id: "d2", session: "k1", folder: "/Users/a/notes" }));
    expect(screen.getByText("Link → saved to Brain · Needs you")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(sent.at(-1)).toEqual({ type: "open_folder", path: "/Users/a/notes", session: "k1" });
    act(() => dispatch({ type: "drop_done", id: "d2", ok: false, text: "Claude: rate limited" }));
    expect(screen.getByText("Link → saved to Brain · Claude: rate limited")).toBeTruthy();
  });

  it("lists what this install's routes do", () => {
    useFeatures.setState({ features: features({ drops: ["Link → summary", "PDF → read and sorted"] }) });
    render(<HomeDrop />);
    const legend = screen.getByRole("list", { name: "What happens" });
    expect(Array.from(legend.querySelectorAll("li"), (li) => li.textContent)).toEqual(["Link → summary", "PDF → read and sorted"]);
  });

  it("takes a typed link on Enter and says why other text isn't taken", () => {
    render(<HomeDrop />);
    const input = screen.getByRole("textbox", { name: "Paste a link" });
    fireEvent.change(input, { target: { value: "just words" } });
    fireEvent.submit(input.closest("form")!);
    expect(sent).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/Paste one link/);
    fireEvent.change(input, { target: { value: "https://blog.acme.example/post" } });
    fireEvent.submit(input.closest("form")!);
    expect(sent).toEqual([{ type: "drop", url: "https://blog.acme.example/post" }]);
  });

  it("sends a dropped file as base64 and shows a refusal from the server", async () => {
    render(<HomeDrop />);
    const file = new File(["# hi"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(zone(), { dataTransfer: { files: [file], getData: () => "" } });
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ type: "drop", name: "notes.md", data: btoa("# hi") });
    act(() => dispatch({ type: "drop_routed", ok: false, text: "No route for .mp3 files yet: links, text, PDF and images." }));
    expect(screen.getByRole("status").textContent).toMatch(/No route for .mp3/);
    expect(sent).toHaveLength(1); // nothing started
  });

  it("takes one file at a time", () => {
    render(<HomeDrop />);
    const files = [new File(["a"], "a.md"), new File(["b"], "b.md")];
    fireEvent.drop(zone(), { dataTransfer: { files, getData: () => "" } });
    expect(sent).toEqual([]);
    expect(screen.getByRole("status").textContent).toBe("One file at a time.");
  });
});
