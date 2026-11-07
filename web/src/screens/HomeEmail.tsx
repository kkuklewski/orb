import type { ReactNode } from "react";
import type { EmailRow } from "../protocol.gen";
import { useFeatures } from "../stores/features";
import { dayTime, useViews } from "../stores/views";
import { emailDone, openRoutine } from "../stores/routine";
import { AccRow, Card, useAccordion } from "./HomeCard";

// Home's Email card (GLOSSARY: Email card): the emails your mail routine's newest run says need you, one row each,
// urgent first (emails.py decides, by rule). Orb reads no mailbox: the rows are the routine's own bullets, plain text.
// Done hides a row for good; the last one done resolves the run's "action". No rows: no card.

const SHOWN = 6;

function dueWord(iso: string, now = new Date()): string {
  const d = new Date(`${iso}T12:00:00`);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "overdue";
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
}

export const emailText = (rows: EmailRow[]) =>
  rows.map((r) => `${r.urgent ? "[urgent] " : ""}${r.text}${r.due ? ` (due ${r.due})` : ""}`).join("\n");

export function EmailCard() {
  const acc = useAccordion();
  const enabled = useFeatures((s) => s.features?.routines);
  const rows = useViews((s) => s.routines?.emails) ?? [];
  if (!enabled || !rows.length) return null;
  const urgent = rows.filter((r) => r.urgent).length;
  const first = rows[0];
  const sources = [...new Set(rows.map((r) => r.routine_name))];
  const title = urgent ? `${urgent} urgent · ${rows.length} to look at` : `${rows.length} email${rows.length === 1 ? "" : "s"} to look at`;
  return (
    <Card id="email" label={`EMAIL · ${sources.join(", ").toUpperCase()}`} title={title} mark={urgent > 0}
      ask={{ name: "Email", question: "Which of these emails should I deal with first, and what should I do about each?", text: emailText(rows) }}
      foot={<><span>{first.at ? `checked ${dayTime(first.at)}` : "from the last run"}</span>
        <button type="button" onClick={() => openRoutine(first.routine)}>Open run →</button></>}>
      {rows.slice(0, SHOWN).map((r) => {
        const id = `${r.run}:${r.key}`;
        const side = r.due ? dueWord(r.due) : r.urgent ? "urgent" : "";
        const facts: [string, ReactNode][] = [["From", `${r.routine_name}${r.at ? `, ${dayTime(r.at)}` : ""}`]];
        if (r.due) facts.push(["Due", dueWord(r.due)]);
        if (r.cut) facts.push(["Note", "The run's list was cut short here: open the run for the rest."]);
        return (
          <AccRow key={id} rowId={id} open={acc.open === id} onToggle={acc.toggle} className={r.urgent ? "needs" : ""}
            dot={<span className={"hc-dot sq" + (r.urgent ? " hot" : "")} />} text={r.text} side={side} facts={facts}
            actions={<>
              <button type="button" className="hbtn dark" onClick={() => emailDone(r.run, r.key)}>Done</button>
              <button type="button" className="hbtn" onClick={() => openRoutine(r.routine)}>Open run</button>
            </>} />
        );
      })}
      {rows.length > SHOWN && <p className="hc-empty">{rows.length - SHOWN} more in the run.</p>}
    </Card>
  );
}
