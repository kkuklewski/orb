// Folders under the home folder (or /Volumes), listed by the server: click to go in, "Use this folder"
// to add it. The browser's own folder picker never reveals a real path, so this is how to choose one.
import { send } from "../../ws";
import { useSetup } from "../../stores/setup";

export function FolderBrowser({ onAdd }: { onAdd: (path: string) => void }) {
  const dir = useSetup((s) => s.dir);
  const roots = useSetup((s) => s.status?.roots ?? []);
  if (!dir) return <div className="onb-browser"><p className="onb-text small">Loading…</p></div>;

  const go = (path: string) => send({ type: "browse", path });
  const inHome = dir.path.startsWith(dir.home + "/");
  const rel = dir.path === dir.home ? "" : inHome ? dir.path.slice(dir.home.length + 1) : dir.path.replace(/^\//, "");
  const parts = rel ? rel.split("/") : [];
  const added = roots.some((r) => r.path === dir.path);

  return (
    <div className="onb-browser">
      <div className="onb-crumbs mono">
        <button type="button" className="onb-crumb" onClick={() => go(dir.home)}>~</button>
        {parts.map((part, i) => {
          const target = (inHome ? dir.home + "/" : "/") + parts.slice(0, i + 1).join("/");
          return (
            <span key={target}>
              <span className="onb-crumb-sep">/</span>
              <button type="button" className={"onb-crumb" + (i === parts.length - 1 ? " on" : "")} onClick={() => go(target)}>{part}</button>
            </span>
          );
        })}
      </div>
      <div className="onb-dirs">
        {dir.parent && <button type="button" className="onb-dir up" onClick={() => go(dir.parent!)}>↑  ..</button>}
        {dir.entries.map((e) => (
          <button type="button" className="onb-dir" key={e.path} onClick={() => go(e.path)}>
            <span className="onb-dir-ic">{e.repo ? "◆" : "▸"}</span>
            <span className="onb-dir-name">{e.name}</span>
            {e.repo && <span className="mono onb-dir-tag">repo</span>}
          </button>
        ))}
        {dir.entries.length === 0 && <p className="onb-text small">No folders here.</p>}
      </div>
      <div className="onb-row">
        <code className="onb-browser-path">{dir.path.replace(dir.home, "~")}</code>
        <span className="onb-spacer" />
        <button type="button" className="onb-btn primary small" disabled={added} onClick={() => {
          if (dir.path === dir.home && !confirm("Give Orb your whole home folder? It would list every repo in it.")) return;
          onAdd(dir.path);
        }}>{added ? "✓ Added" : `Use ${dir.path === dir.home ? "~" : "this folder"}`}</button>
      </div>
    </div>
  );
}
