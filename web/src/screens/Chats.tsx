import { useState } from "react";
import { useFeatures } from "../stores/features";
import { allSessions, folderName, openFolder, rel, useSession } from "../stores/session";
import { chatGroups, dotClass, statusText } from "../stores/views";

/** Every conversation, grouped by repo; running and waiting ones first. */
export function Chats() {
  const folders = useFeatures((s) => s.folders);
  const current = useSession((s) => s.session);
  const [q, setQ] = useState("");
  const groups = chatGroups(allSessions(folders, current), q, current);
  return (
    <div className="view-col">
      <div className="view-head"><h2>Chats</h2><span className="mono view-sub">all conversations, by repo</span></div>
      <label className="chats-search">
        <input type="search" placeholder="Search chats" aria-label="Search chats" autoComplete="off" spellCheck={false}
          value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setQ(""); }} />
      </label>
      {groups.length === 0 && <div className="side-hint">{q.trim() ? "Nothing found." : "Your conversations show up here."}</div>}
      {groups.map((g) => (
        <section key={g.folder.path} className="chats-group" aria-label={folderName(g.folder)}>
          <h3 className="chats-repo">{folderName(g.folder)}<span className="mono">{g.rows.length}</span></h3>
          {g.rows.map((x) => (
            <button type="button" key={x.key} className={`act-row chats-row ${x.status}`} onClick={() => openFolder(g.folder.path, x.key)}>
              <span className="act-time mono">{rel(x.last_used) || "--"}</span>
              <span className={dotClass(x.status, x.live)} />
              <span className="act-label chats-label">{x.label || "New session"}{x.count > 1 && <span className="chats-count mono" title={`${x.count} chats with this request`}>×{x.count}</span>}</span>
              <span className="act-status mono">{x.status === "idle" ? (x.live ? "open" : "") : statusText(x)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
