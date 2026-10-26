import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFeatures } from "../stores/features";
import { greeting } from "../stores/home";
import { setFront, useMeta, type Front } from "../stores/meta";
import { folderName, openPicker, pickerItems, startIn, useSession } from "../stores/session";
import { send } from "../ws";
import { Composer } from "./Composer";
import { DockState, VoicePill } from "./Voice";

// A session before its first request, like claude.ai's start: a greeting, the request box in the middle, and under it
// the Project (Brain, the notes vault, by default; another repo starts a session there, the draft stays), the front
// model and the approvals mode. The top bar leaves those two chips out while this shows.

type Mode = "default" | "auto" | "plan";

const FRONTS: { id: Front; name: string; text: string }[] = [
  { id: "haiku", name: "Haiku", text: "The cheapest: notes, status, short answers; coding goes to Opus" },
  { id: "sonnet", name: "Sonnet", text: "Fast answers; hard coding goes to Opus in the background" },
  { id: "opus", name: "Opus", text: "Answers everything; uses the plan fastest" },
];

const MODES: { id: Mode; name: string; text: string }[] = [
  { id: "default", name: "Default", text: "A card for every tool that needs permission" },
  { id: "auto", name: "Auto", text: "Claude Code decides what is safe; cards only for what it escalates" },
  { id: "plan", name: "Plan", text: "Only reads and plans; asks before changing anything" },
];

/** A button with a menu under it; a click outside or Esc closes it. */
function Menu({ label, title, className, align, children }: {
  label: ReactNode; title: string; className?: string; align?: "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  return (
    <div className={"st-menu " + (className ?? "")} ref={ref}>
      <button type="button" className="st-btn" aria-haspopup="menu" aria-expanded={open} title={title} onClick={() => setOpen(!open)}>
        {label}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && <div className={"st-pop" + (align === "end" ? " end" : "")} role="menu" aria-label={title}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Option({ on, name, text, pick }: { on: boolean; name: string; text?: string; pick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} className="st-opt" onClick={pick}>
      <span className="st-opt-name">{name}</span>
      <span className="st-check" aria-hidden="true">{on ? "✓" : ""}</span>
      {text && <span className="st-opt-text">{text}</span>}
    </button>
  );
}

function ProjectMenu() {
  const { folder, label } = useSession();
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const folders = useFeatures((s) => s.folders);
  const [q, setQ] = useState("");
  const n = q.trim().toLowerCase();
  const others = pickerItems(folders, q).filter((f) => f.path !== vault);
  const pinned = others.filter((f) => f.pinned);
  const recent = others.filter((f) => !f.pinned).slice(0, n ? 20 : 8);
  const brain = vault && (!n || "brain notes".includes(n) || vault.toLowerCase().includes(n));
  const here = folder === vault && vault ? "Brain" : folder ? folderName({ label }) : "Project";
  return (
    <Menu label={here} title="Project">
      {(close) => {
        const pick = (path: string) => { close(); setQ(""); startIn(path); };
        return (
          <>
            <input className="st-search" type="search" placeholder="Search projects" aria-label="Search projects" autoFocus autoComplete="off" spellCheck={false}
              value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { const first = brain ? vault : (pinned[0] ?? recent[0])?.path; if (first) pick(first); } }} />
            <div className="st-list">
              {brain && <Option on={folder === vault} name="Brain" text="your notes" pick={() => pick(vault)} />}
              {pinned.length > 0 && <div className="st-sec mono">Pinned</div>}
              {pinned.map((f) => <Option key={f.path} on={f.path === folder} name={folderName(f)} pick={() => pick(f.path)} />)}
              {recent.length > 0 && <div className="st-sec mono">{n ? "Others" : "Recent"}</div>}
              {recent.map((f) => <Option key={f.path} on={f.path === folder} name={folderName(f)} pick={() => pick(f.path)} />)}
              {!brain && !pinned.length && !recent.length && <div className="side-hint">No project matches.</div>}
            </div>
            <button type="button" className="st-opt st-more" onClick={() => { close(); openPicker("new"); }}>
              <span className="st-opt-name">Other folder…</span>
            </button>
          </>
        );
      }}
    </Menu>
  );
}

export function StartBar() {
  const { front, mode } = useMeta();
  const model = FRONTS.find((f) => f.id === front) ?? FRONTS[1];
  const approvals = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <div className="st-bar">
      <ProjectMenu />
      <div className="st-right">
        <Menu label={model.name} title="Model" align="end">
          {(close) => FRONTS.map((f) => <Option key={f.id} on={f.id === front} name={f.name} text={f.text} pick={() => { close(); setFront(f.id); }} />)}
        </Menu>
        <Menu label={approvals.name} title="Approvals" align="end">
          {(close) => MODES.map((m) => <Option key={m.id} on={m.id === mode} name={m.name} text={m.text} pick={() => { close(); send({ type: "set_mode", mode: m.id }); }} />)}
        </Menu>
      </div>
    </div>
  );
}

export function Start() {
  const vault = useFeatures((s) => s.features?.vault ?? "");
  const folder = useSession((s) => s.folder);
  return (
    <div className="start">
      <h1 className="st-hello"><span className="st-mark" aria-hidden="true" />{greeting(new Date().getHours()).replace(/\.$/, "")}</h1>
      <DockState />
      <Composer lead={<VoicePill />} placeholder={folder && folder === vault ? "Ask your notes, or / for commands" : "How can I help? Or / for commands"} />
      <StartBar />
    </div>
  );
}
