import { useEffect, useRef, useState } from "react";
import { useFeatures } from "../stores/features";
import { choosePath, closePicker, pickerItems, rel, useSession } from "../stores/session";

// The only other place with every repo: "new" starts a session there, "pin" pins it to the sidebar.
// A folder outside the list can be pasted as a path (the server still checks it's allowed).
export function Picker() {
  const mode = useSession((s) => s.picker);
  const hasFolder = useSession((s) => !!s.folder);
  const folders = useFeatures((s) => s.folders);
  const [q, setQ] = useState("");
  const [path, setPath] = useState("");
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode) { setQ(""); setPath(""); setTimeout(() => search.current?.focus(), 0); } }, [mode]);
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closePicker(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode]);

  if (!mode) return null;
  const items = pickerItems(folders, q);
  const title = mode === "pin" ? "Pin a repo" : hasFolder ? "New session" : "Pick a repo to talk about";

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) closePicker(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button type="button" className="icon-btn ghost" aria-label="Close" onClick={closePicker}>✕</button></div>
        <input ref={search} className="modal-search" type="search" placeholder="Search repos and folders" aria-label="Search repos" autoComplete="off" spellCheck={false}
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && items[0]) choosePath(items[0].path); }} />
        <div className="picker-list">
          {items.map((f) => (
            <button key={f.path} type="button" className="pick" onClick={() => choosePath(f.path)}>
              <span className="pick-name">{f.label}</span>
              <span className="pick-rel">{f.rel}{f.branch ? ` · ${f.branch}` : ""}</span>
              <span className="pick-when">{f.pinned ? "pinned" : rel(f.last_used)}</span>
            </button>
          ))}
          {!items.length && <div className="side-hint">No repo matches. Paste a folder path below.</div>}
        </div>
        <form className="add-folder" onSubmit={(e) => { e.preventDefault(); const p = path.trim(); if (p) choosePath(p); }}>
          <input type="text" placeholder="/path/to/folder" aria-label="Folder path" autoComplete="off" spellCheck={false} value={path} onChange={(e) => setPath(e.target.value)} />
          <button type="submit" className="chip-btn" disabled={!path.trim()}>{mode === "pin" ? "Pin" : "Open"}</button>
        </form>
      </div>
    </div>
  );
}
