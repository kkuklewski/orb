import type { ReactNode } from "react";
import { useFeatures } from "../stores/features";
import { askIn } from "../stores/session";

/** "Ask about this": a new session in the notes folder; the tile's own lines go along as the screen, not in the question. */
export type TileAsk = { question: string; name: string; text: string };

// The ruled card Home is built from: a mono label, a title, rows, and an optional grey footer bar.
export function Card({ label, title, mark, children, foot, id, className, ask }: { ask?: TileAsk; label: string; title: string; mark?: boolean; children?: ReactNode; foot?: ReactNode; id?: string; className?: string }) {
  const vault = useFeatures((s) => s.features?.vault);
  return (
    <article className={"hc" + (className ? " " + className : "")} aria-label={title} id={id}>
      <div className="hc-head">
        <div className={"hc-label mono" + (mark ? " mark" : "")}>{mark && <span className="sq" />}{label}</div>
        <h2>{title}</h2>
        {ask && vault && <button type="button" className="hc-ask mono" onClick={() => askIn(vault, ask.question, { name: ask.name, text: ask.text }, true)}>Ask about this →</button>}
      </div>
      {children}
      {foot && <div className="hc-foot mono">{foot}</div>}
    </article>
  );
}
