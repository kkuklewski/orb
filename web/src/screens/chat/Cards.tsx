import { useState } from "react";
import { send } from "../../ws";
import { verdict, type Part } from "../../stores/chat";
import { Markdown } from "./Markdown";

// Approval, plan and question cards: the buttons are the real answer to Claude Code's can_use_tool.
// Undo cards confirm restoring a request's file edits.

type PermPart = Extract<Part, { kind: "perm" }>;
type UndoPart = Extract<Part, { kind: "undo" }>;
interface Question { question: string; options?: { label: string; description?: string }[] }

const reply = (id: string, allow: boolean, answers?: Record<string, string>) =>
  send(answers ? { type: "permission", id, allow, answers } : { type: "permission", id, allow });

function Ask({ p }: { p: PermPart }) {
  const qs = ((p.ev.input as { questions?: Question[] }).questions ?? []);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const choose = (q: string, label: string) => {
    const next = { ...picked, [q]: label };
    setPicked(next);
    if (Object.keys(next).length === qs.length) reply(p.ev.id, true, next);
  };
  return (
    <>
      {qs.map((q) => (
        <div key={q.question}>
          <div className="q">{q.question}</div>
          <div className="pbtns">
            {(q.options ?? []).map((o) => (
              <button key={o.label} type="button" title={o.description ?? ""} className={picked[q.question] === o.label ? "allow" : undefined}
                onClick={() => choose(q.question, o.label)}>{o.label}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="pbtns"><button type="button" onClick={() => reply(p.ev.id, false)}>Skip</button></div>
    </>
  );
}

export function PermCard({ p }: { p: PermPart }) {
  const ev = p.ev;
  const input = (ev.input ?? {}) as Record<string, unknown>;
  const ask = ev.tool === "AskUserQuestion";
  const plan = ev.tool === "ExitPlanMode";
  const cls = "perm" + (ask ? " ask" : "") + (plan ? " plan-card" : "") + (p.done ? " done" : "");
  const title = ask ? "Claude asks · click or say an option" : plan ? "Plan ready" : "Approval needed";
  const detail = String(input.command ?? input.file_path ?? input.url ?? JSON.stringify(input, null, 2));
  return (
    <div className={cls} role="group" aria-label={title}>
      <div className="ptitle">{title}</div>
      {ask ? <Ask p={p} /> : plan ? (
        <>
          <Markdown text={String(input.plan ?? "")} />
          <div className="pbtns">
            <button type="button" className="allow" onClick={() => reply(ev.id, true)}>Approve plan</button>
            <button type="button" onClick={() => reply(ev.id, false)}>Keep planning</button>
          </div>
        </>
      ) : (
        <>
          <div className="pwhat">{ev.title || `Claude wants to use ${ev.tool}`}</div>
          {ev.description && <div className="where-meta">{ev.description}</div>}
          <pre>{detail}</pre>
          {ev.tool === "Edit" && typeof input.new_string === "string" && <pre>{input.new_string.slice(0, 2000)}</pre>}
          <div className="pbtns">
            <button type="button" className="allow" onClick={() => reply(ev.id, true)}>Allow</button>
            <button type="button" onClick={() => reply(ev.id, false)}>Deny</button>
          </div>
        </>
      )}
      {p.done && <div className="verdict">{verdict(p)}</div>}
    </div>
  );
}

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

export function UndoCard({ p }: { p: UndoPart }) {
  const { ev, done } = p;
  const how = done?.heard ? ` by voice: “${done.heard}”` : "";
  return (
    <div className={"perm undo-card" + (done ? " done" : "")} role="group" aria-label="Undo file changes">
      <div className="ptitle">Undo file changes</div>
      <div className="pwhat">Restore {files(ev.files.length)} to how they were before that request:</div>
      <pre>{ev.files.join("\n")}</pre>
      <div className="where-meta">{ev.note}</div>
      <div className="pbtns">
        <button type="button" className="allow" onClick={() => send({ type: "undo_confirm", id: ev.id, ok: true })}>Restore {files(ev.files.length)}</button>
        <button type="button" onClick={() => send({ type: "undo_confirm", id: ev.id, ok: false })}>Cancel</button>
      </div>
      {done && <div className="verdict">{done.ok ? `Restored${how}` : done.error ? `Failed: ${done.error}` : `Cancelled${how}`}</div>}
    </div>
  );
}
