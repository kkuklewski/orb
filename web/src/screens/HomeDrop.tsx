import { useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { FolderItem } from "../protocol.gen";
import { useFeatures } from "../stores/features";
import { openNote } from "../stores/brain";
import { openFolder } from "../stores/session";
import { dropFiles, dropLink, isLink, resetDrop, useDrop, type DropItem } from "../stores/drop";

// Home's drop zone (stores/drop.ts, server intake.py, ADR 0009): drop a file or a link on it, paste a link into it, or
// choose a file. The server picks what happens and runs it in the background; the page stays here and lists the last
// few drops with how they're doing. The legend is what this install's routes can do (features.drops).

function TrayIcon() {
  return (
    <svg viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 6v20M16 18l8 8 8-8" />
      <path d="M6 28l5-12h4M42 28l-5-12h-4M6 28v12h36V28H32a8 8 0 0 1-16 0H6z" />
    </svg>
  );
}

/** A drop's progress: how it ended (drop_done); while a session's drop runs, its status in the folder list. */
export function progress(d: DropItem, folders: FolderItem[]): { text: string; tone: "run" | "ok" | "ask" | "bad" } {
  if (d.state !== "running") return { text: d.text || (d.state === "done" ? "Done" : "Failed"), tone: d.state === "done" ? "ok" : "bad" };
  const s = d.session ? folders.find((f) => f.path === d.folder)?.sessions?.find((x) => x.key === d.session) : undefined;
  if (s?.status === "approval") return { text: "Needs you", tone: "ask" };
  return { text: "Working…", tone: "run" };
}

const linkOf = (dt: DataTransfer) => (dt.getData("text/uri-list").split(/\r?\n/).find((l) => l && !l.startsWith("#")) || dt.getData("text/plain")).trim();

export function HomeDrop() {
  const vault = useFeatures((s) => s.features?.vault);
  const routes = useFeatures((s) => s.features?.drops) ?? [];
  const folders = useFeatures((s) => s.folders);
  const { status, text, items } = useDrop();
  const [over, setOver] = useState(false);
  const [link, setLink] = useState("");
  const file = useRef<HTMLInputElement>(null);
  if (!vault) return null;
  const busy = status === "reading" || status === "sending";

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void dropFiles(e.dataTransfer.files);
    else dropLink(linkOf(e.dataTransfer));
  };
  const paste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length) { e.preventDefault(); void dropFiles(e.clipboardData.files); return; }
    const t = e.clipboardData.getData("text/plain").trim();
    if (isLink(t)) { e.preventDefault(); setLink(""); dropLink(t); }
  };
  const said = busy ? (status === "reading" ? `Reading ${text}…` : `Sending ${text}…`) : status === "refused" ? text : null;

  return (
    <article className={"hc drop" + (over ? " over" : "")} aria-label="Drop zone" aria-busy={busy}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }} onDrop={drop} onPaste={paste}>
      <div className="hc-head">
        <div className="hc-label mono">DROP</div>
      </div>
      <div className="drop-body">
        <span className="drop-icon"><TrayIcon /></span>
        <p className="drop-title">Drop a file or a link</p>
        <form className="drop-form" onSubmit={(e) => { e.preventDefault(); if (link.trim()) { dropLink(link); setLink(""); } }}>
          <input type="url" inputMode="url" value={link} placeholder="Paste a link" aria-label="Paste a link" disabled={busy}
            onChange={(e) => { setLink(e.target.value); if (status === "refused") resetDrop(); }} />
          <button type="button" className="hbtn" disabled={busy} onClick={() => file.current?.click()}>Choose a file</button>
          <input ref={file} type="file" hidden onChange={(e) => { if (e.target.files) void dropFiles(e.target.files); e.target.value = ""; }} />
        </form>
        {said && <p className={"drop-said mono" + (status === "refused" ? " refused" : "")} role="status">{said}</p>}
      </div>
      {items.length > 0 && (
        <ul className="drop-list" aria-label="Recent drops">
          {items.map((d) => {
            const p = progress(d, folders);
            return (
              <li key={d.id} className={"drop-item " + p.tone}>
                <span className="drop-item-main">
                  <span className="drop-item-what" title={d.what}>{d.what}</span>
                  <span className="drop-item-state mono" role="status">{d.label} · {p.text}</span>
                </span>
                {d.session && d.folder ? <button type="button" className="hbtn" onClick={() => openFolder(d.folder!, d.session!)}>Open</button>
                  : d.note ? <button type="button" className="hbtn" onClick={() => openNote(d.note!)}>Open note</button> : null}
              </li>
            );
          })}
        </ul>
      )}
      <ul className="drop-routes mono" aria-label="What happens">
        {routes.map((r) => <li key={r}>{r}</li>)}
      </ul>
    </article>
  );
}
