import type { ReactNode } from "react";

// The ruled card Home is built from: a mono label, a title, rows, and an optional grey footer bar.
export function Card({ label, title, mark, children, foot, id }: { label: string; title: string; mark?: boolean; children?: ReactNode; foot?: ReactNode; id?: string }) {
  return (
    <article className="hc" aria-label={title} id={id}>
      <div className="hc-head">
        <div className={"hc-label mono" + (mark ? " mark" : "")}>{mark && <span className="sq" />}{label}</div>
        <h2>{title}</h2>
      </div>
      {children}
      {foot && <div className="hc-foot mono">{foot}</div>}
    </article>
  );
}
