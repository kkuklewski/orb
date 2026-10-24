import { useEffect, useRef, useState, type ReactNode } from "react";
import { sendText, slashMatches, slashQuery, useSession } from "../stores/session";
import { useVoice } from "../stores/voice";
import { sendWithPins, usePins } from "../stores/pins";
import { currentScreen } from "../stores/screen";
import { useViews } from "../stores/views";
import { stopAll } from "../voice/controller";
import { Player } from "../voice/player";

// The typed request box. "/" at the start opens the session's commands (skills, plugin skills,
// Claude Code built-ins, Orb's own); ↑↓ move, Tab/Enter complete, Esc closes. The text is sent as
// typed and Claude Code expands it, except Orb's own (/clear, /model, /mcp, /rewind), which the
// server runs. Typed input only: voice never goes through here.
export function Composer({ lead }: { lead?: ReactNode }) {
  const commands = useSession((s) => s.commands);
  const busy = useSession((s) => s.busy);
  const playing = useVoice((s) => s.playing);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [closed, setClosed] = useState(false); // Esc closes the menu until the text changes
  const box = useRef<HTMLTextAreaElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const q = slashQuery(text);
  const shown = q === null || closed ? [] : slashMatches(commands, q);
  const open = shown.length > 0;
  const idx = open ? Math.min(active, shown.length - 1) : 0;

  const change = (v: string) => { setText(v); setActive(0); setClosed(false); };

  useEffect(() => { // "/" anywhere (not while typing) starts a command
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || (e.target as HTMLElement)?.closest?.("textarea, input, [role=dialog]")) return;
      e.preventDefault();
      box.current?.focus();
      setText((t) => (t ? t : "/"));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { // grow with the text, up to 200px
    const el = box.current;
    if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 200) + "px"; el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden"; }
  }, [text]);

  useEffect(() => { menu.current?.querySelector(".slash-item.active")?.scrollIntoView?.({ block: "nearest" }); }, [idx, open]);

  const pick = (i: number) => {
    const c = shown[i];
    if (!c) return;
    setText(`/${c.name} `); setClosed(true);
    box.current?.focus();
  };

  const hasPins = usePins((s) => s.pins.length > 0);
  const onHome = useViews((s) => s.view) === "home";
  const pinned = hasPins && onHome;
  const submit = () => {
    if (!text.trim() && !pinned) return;
    Player.unlock(); Player.stop(); // a typed request cuts her off, like speaking would
    if (pinned ? sendWithPins(text, () => currentScreen("home")) : sendText(text)) setText("");
  };

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {open && (
        <div className="slash-menu" id="slash-menu" role="listbox" aria-label="Slash commands" ref={menu}>
          {shown.map((c, i) => (
            <div key={c.name} id={`slash-opt-${i}`} role="option" aria-selected={i === idx} className={"slash-item" + (i === idx ? " active" : "")}
              title={c.description || ""} onMouseDown={(e) => e.preventDefault()} onPointerEnter={(e) => { if (e.pointerType === "mouse") setActive(i); }} onClick={() => pick(i)}>
              <span className="slash-name mono">/{c.name}</span>
              <span className="slash-hint mono">{c.argumentHint || ""}</span>
              <span className="slash-tag mono">{c.local ? "orb" : ""}</span>
              <span className="slash-desc">{c.description || ""}</span>
            </div>
          ))}
        </div>
      )}
      {lead}
      <textarea ref={box} className="composer-input" rows={1} placeholder="Type, or / for commands" aria-label="Message"
        role="combobox" aria-expanded={open} aria-controls="slash-menu" aria-autocomplete="list" aria-activedescendant={open ? `slash-opt-${idx}` : undefined}
        value={text} onChange={(e) => change(e.target.value)}
        onBlur={() => setTimeout(() => { if (document.activeElement !== box.current) setClosed(true); }, 200)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (open) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive((idx + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length); return; }
            if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setClosed(true); return; }
            if ((e.key === "Tab" || e.key === "Enter") && !e.shiftKey) {
              const exact = shown[idx]?.name.toLowerCase() === q;
              if (!(e.key === "Enter" && exact)) { e.preventDefault(); pick(idx); return; } // "/clear" typed in full: Enter sends it
            }
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
        }} />
      {(busy || playing) && !text.trim() ? (
        <button type="button" className="stop" aria-label="Stop" title="Stop this answer (Esc)" onClick={stopAll}>■</button>
      ) : (
      <button type="submit" className="send" aria-label="Send" disabled={!text.trim() && !pinned}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </button>
      )}
    </form>
  );
}
