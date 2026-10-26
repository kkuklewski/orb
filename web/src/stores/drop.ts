// Home's drop zone (server: intake.py, ADR 0009). A pasted link or a dropped file goes to the server, which picks the
// route and runs it in the background: a YouTube link is fetched and saved by Orb itself, a link or a file starts a
// notes session with the drop's own grant (its status is the progress meanwhile). drop_done says how either ended. The
// page stays where it is; the zone lists the last few drops.
import { create } from "zustand";
import { on } from "../events";
import { send } from "../ws";

export type DropStatus = "idle" | "reading" | "sending" | "refused";

export interface DropItem {
  id: string;
  label: string; // the route: "YouTube → transcript"
  what: string; // the link or the file name
  at: number; // ms
  state: "running" | "done" | "failed"; // from drop_done
  text?: string;
  note?: string | null;
  session?: string | null;
  folder?: string | null;
}

export const KEEP = 4;

export const useDrop = create<{ status: DropStatus; text: string; items: DropItem[] }>(() => ({ status: "idle", text: "", items: [] }));

/** The server says 16 MB per WebSocket message; base64 makes 10 MB of file about 13.4 MB (intake.MAX_FILE_BYTES). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ONE_LINK = "Paste one link (https://…) or drop a file."; // intake.route_link's refusal, said before sending

/** One http(s) URL and nothing else. */
export const isLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

const busy = () => ["reading", "sending"].includes(useDrop.getState().status);
let sending = ""; // the link or file name the next drop_routed answers

export function wireDrop(): () => void {
  const offs = [
    on("drop_routed", (ev) => {
      if (!ev.ok || !ev.id) { useDrop.setState({ status: "refused", text: ev.text }); return; }
      const item: DropItem = { id: ev.id, label: ev.text, what: sending, at: Date.now(), state: "running", session: ev.session, folder: ev.folder };
      useDrop.setState((s) => ({ status: "idle", text: "", items: [item, ...s.items].slice(0, KEEP) }));
    }),
    on("drop_done", (ev) => {
      useDrop.setState((s) => ({
        items: s.items.map((x) => (x.id === ev.id ? { ...x, state: ev.ok ? "done" : "failed", text: ev.text, note: ev.note } : x)),
      }));
    }),
  ];
  return () => offs.forEach((off) => off());
}

/** A link from a paste or a drag: one http(s) URL, else the reason it isn't taken. */
export function dropLink(text: string) {
  if (busy()) return;
  const url = text.trim();
  if (!isLink(url)) { useDrop.setState({ status: "refused", text: ONE_LINK }); return; }
  sending = url;
  useDrop.setState({ status: "sending", text: url });
  send({ type: "drop", url });
}

function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export async function dropFiles(files: FileList | File[]) {
  if (busy()) return;
  const list = Array.from(files);
  if (!list.length) return;
  if (list.length > 1) { useDrop.setState({ status: "refused", text: "One file at a time." }); return; }
  const file = list[0];
  if (file.size > MAX_FILE_BYTES) { useDrop.setState({ status: "refused", text: `Too big: files up to ${MAX_FILE_BYTES / (1024 * 1024)} MB.` }); return; }
  useDrop.setState({ status: "reading", text: file.name });
  try {
    const data = await base64(file);
    sending = file.name;
    useDrop.setState({ status: "sending", text: file.name });
    send({ type: "drop", name: file.name, data });
  } catch {
    useDrop.setState({ status: "refused", text: `Couldn't read ${file.name}.` });
  }
}

export const resetDrop = () => useDrop.setState({ status: "idle", text: "" });
