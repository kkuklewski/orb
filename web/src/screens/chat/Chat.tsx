import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { send } from "../../ws";
import { answerText, taskText, toolsLabel, useChat, type Answer, type Item, type Part, type ToolRow } from "../../stores/chat";
import { Markdown, copyText } from "./Markdown";
import { PermCard, UndoCard } from "./Cards";

// The conversation. Items and parts are immutable, so only the answer being written re-renders.

function Tool({ r }: { r: ToolRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"tool-row" + (r.pending ? " pending" : "") + (r.error ? " error" : "")}>
      <div className="call" role="button" tabIndex={0} aria-expanded={r.out ? open : undefined}
        onClick={() => r.out && setOpen(!open)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && r.out) { e.preventDefault(); setOpen(!open); } }}>
        {r.summary || r.name}
      </div>
      {open && r.out && <div className="out">{r.out}</div>}
    </div>
  );
}

function PartView({ p, live }: { p: Part; live: boolean }) {
  switch (p.kind) {
    case "text":
      return (
        <>
          {p.said.trim() && <div className="said"><span className="said-label">said aloud</span><span className="said-text">{p.said.trim()}</span></div>}
          <Markdown text={p.text} live={live} />
        </>
      );
    case "tools":
      return (
        <details className={"tools" + (p.running ? " running" : "")}>
          <summary><span className="label">{toolsLabel(p.rows)}</span></summary>
          <div className="tool-rows">{p.rows.map((r) => <Tool key={r.id} r={r} />)}</div>
        </details>
      );
    case "perm": return <PermCard p={p} />;
    case "undo": return <UndoCard p={p} />;
    case "held": return <div className="notice held">Held until the approval card is answered: “{p.text}”</div>;
    case "task": return <div className={`task-chip mono ${p.task.status}`} title={p.task.summary ?? undefined}>{taskText(p.task)}</div>;
  }
}

const AnswerView = memo(function AnswerView({ a, last }: { a: Answer; last: boolean }) {
  const copyBtn = useRef<HTMLButtonElement>(null);
  const hasText = a.parts.some((p) => p.kind === "text");
  const n = a.undoFiles?.length ?? 0;
  return (
    <div className={"answer" + (last ? " last" : "")}>
      {a.parts.map((p, i) => <PartView key={p.kind === "text" ? p.id : `${p.kind}-${i}`} p={p} live={!a.done} />)}
      {a.done && hasText && (
        <div className="answer-tools">
          <button type="button" ref={copyBtn} onClick={() => copyText(answerText(a), copyBtn.current)}>Copy</button>
          <button type="button" title="Read the whole answer aloud" onClick={() => send({ type: "read_all", text: answerText(a) })}>Read all</button>
          {n > 0 && (
            <button type="button" className="undo" disabled={a.undone} title={a.undoFiles!.join("\n")}
              onClick={() => send({ type: "undo_request", user_id: a.userId })}>{a.undone ? "Undone" : `Undo (${n} file${n === 1 ? "" : "s"})`}</button>
          )}
        </div>
      )}
      {a.timing && <div className="timing mono">{a.timing}</div>}
    </div>
  );
});

export function ItemView({ it, last }: { it: Item; last: boolean }) {
  switch (it.kind) {
    case "user":
      return (
        <div className="msg-user">
          {it.source === "voice" && <span className="via">voice</span>}
          {it.screen && <span className="via" title="What that screen showed was sent with this message">about {it.screen}</span>}
          <div className="bubble">{it.text}</div>
        </div>
      );
    case "answer": return <AnswerView a={it} last={last} />;
    case "notice": return <div className={"notice" + (it.level === "error" ? " error" : it.level === "ok" ? " ok" : "")} role={it.level === "error" ? "alert" : undefined}>{it.text}</div>;
    case "end": return <div className="turn-end">{it.text}</div>;
  }
}

export function ChatLog() {
  const items = useChat((s) => s.items);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);
  const lastUser = useRef<number>(-1);
  const lastTop = useRef(0);

  // A new message of yours always scrolls down; otherwise only while you're at the bottom.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const u = items.findLastIndex((x) => x.kind === "user");
    if (u !== lastUser.current) { lastUser.current = u; stick.current = true; }
    if (stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => { // markdown renders after layout (throttled): keep following it
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);

  const lastAnswer = items.findLastIndex((x) => x.kind === "answer" && x.done);
  return (
    <>
      <div className="chat" ref={box} onScroll={(e) => {
        // Only scrolling up lets go of the bottom: content growing under a scroll isn't you leaving.
        const el = e.currentTarget;
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) stick.current = true;
        else if (el.scrollTop < lastTop.current) stick.current = false;
        lastTop.current = el.scrollTop;
        setAway(!stick.current);
      }}>
        <div className="column" role="log" aria-live="polite" aria-label="Conversation">
          {items.map((it, i) => <ItemView key={it.key} it={it} last={i === lastAnswer} />)}
        </div>
      </div>
      {away && items.length > 0 && (
        <button type="button" className="to-bottom" aria-label="Scroll to the newest message"
          onClick={() => { const el = box.current!; el.scrollTop = el.scrollHeight; stick.current = true; setAway(false); }}>↓</button>
      )}
    </>
  );
}
