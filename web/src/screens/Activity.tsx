import { useFeatures } from "../stores/features";
import { openFolder } from "../stores/session";
import { activityRows, dotClass, statusText } from "../stores/views";

const time = (ts?: number | null) => (ts ? new Date(ts * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "--:--");

export function Activity() {
  const folders = useFeatures((s) => s.folders);
  const rows = activityRows(folders);
  return (
    <div className="view-col">
      <div className="view-head"><h2>Activity</h2><span className="mono view-sub">sessions working, waiting for you or done</span></div>
      <div id="activity-list">
        {rows.length === 0 && (
          <div className="side-hint">Nothing running. Sessions that work in the background, wait for an approval or finish while you're elsewhere show up here.</div>
        )}
        {rows.map((x) => (
          <button type="button" key={x.key} className={`act-row ${x.status}`} onClick={() => openFolder(x.folder.path, x.key)}>
            <span className="act-time mono">{time(x.last_used)}</span>
            <span className={dotClass(x.status, x.live)} />
            <span className="act-folder">{x.folder.label.split("/").pop()}</span>
            <span className="act-label">{x.label || "New session"}</span>
            <span className="act-status mono">{statusText(x)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
