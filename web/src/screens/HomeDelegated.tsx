import { useState } from "react";
import { useFeatures } from "../stores/features";
import { openFolder } from "../stores/session";
import { apply, askApply, closeDiff, confirmDelegate, delegate, discard, outward, pickRepo, resume, retry, revert, review, update, useDelegations } from "../stores/delegation";
import type { DelegationItem } from "../protocol.gen";

// Delegations on Home (server: delegation.py). The grant card (what the session may do without asking; Allow starts it),
// the repo picker for a task whose project has no repo, and the Delegated strip under Up next: one row per delegation
// in the order they were delegated, its stage line the only status word (never "Finished"). Ready offers Review (the
// diff) and Apply, which asks once inline; a conflict says which files and changes nothing; applied rows offer Undo.
// Failed or stuck rows offer Retry, a row stopped by a restart Resume (they are in Needs you too, with the same
// actions). Discard drops the branch and the worktree, so it takes a second tap. Past the limit a delegation waits
// as Queued (its line "Queued · 2nd"; no session yet, so no Open session) and starts when a slot frees. A bulk
// Delegate brings one card per repo listing its tasks, one after another. After the tests pass, push and a PR wait for
// an OK (Push and open PR, Skip) unless the repo's outward steps are on; a PR Orb opened is linked from the row. With
// that PR, Apply asks to merge it on the remote (Merge PR #N, Skip; always asks, #876) and Undo opens a revert PR.

/** The grant card, the repo picker and a refusal: whichever is up. */
export function DelegateCards() {
  const { card, picking, error } = useDelegations();
  const folders = useFeatures((s) => s.folders);
  return (
    <>
      {error && <p className="deleg-error" role="alert">{error}</p>}
      {picking && (
        <div className="perm" role="group" aria-label="Choose the repo">
          <div className="ptitle">Delegate · choose the repo</div>
          <div className="pwhat">Its project has no repo. Where should it work? (This delegation only.)</div>
          <div className="pbtns deleg-repos">
            {folders.map((f) => <button key={f.path} type="button" onClick={() => delegate(picking, f.path)}>{f.label}</button>)}
            <button type="button" onClick={() => pickRepo(null)}>Cancel</button>
          </div>
        </div>
      )}
      {card && (card.rows?.length ?? 0) > 1 && (
        <div className="perm" role="group" aria-label="Delegate these tasks">
          <div className="ptitle">Delegate {card.rows!.length} tasks to {card.repo}</div>
          <ul className="deleg-tasks">{card.rows!.map((x) => <li key={x.task}>#{x.task} {x.title} <span className="mono">{x.branch}</span></li>)}</ul>
          <div className="where-meta">Each in its own worktree and branch. Without asking each may:</div>
          <ul className="deleg-covers">{card.covers.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="where-meta">Anything else asks you first. Past the limit they wait as Queued.{card.more ? ` Then ${card.more} more repo${card.more === 1 ? "" : "s"}, one card each.` : ""}</div>
          <div className="pbtns">
            <button type="button" className="allow" onClick={() => confirmDelegate(true)}>Allow</button>
            <button type="button" onClick={() => confirmDelegate(false)}>Deny</button>
          </div>
        </div>
      )}
      {card && (card.rows?.length ?? 0) <= 1 && (
        <div className="perm" role="group" aria-label="Delegate this task">
          <div className="ptitle">Delegate task #{card.task}</div>
          <div className="pwhat">{card.title}</div>
          <div className="where-meta">Repo {card.repo} · branch {card.branch}, in its own worktree. Without asking it may:</div>
          <ul className="deleg-covers">{card.covers.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="where-meta">Anything else asks you first.{card.more ? ` Then ${card.more} more repo${card.more === 1 ? "" : "s"}, one card each.` : ""}</div>
          <div className="pbtns">
            <button type="button" className="allow" onClick={() => confirmDelegate(true)}>Allow</button>
            <button type="button" onClick={() => confirmDelegate(false)}>Deny</button>
          </div>
        </div>
      )}
    </>
  );
}

export function DelegatedStrip() {
  const { items, confirming, diff } = useDelegations();
  if (!items.length) return null;
  return (
    <section className="hc deleg" aria-label="Delegated" id="delegated">
      <div className="deleg-label mono">DELEGATED</div>
      {items.map((d) => (
        <div key={d.id} className={"deleg-row " + d.stage}>
          <div className="deleg-main">
            <span className="deleg-title">#{d.task} {d.title}</span>
            <span className="deleg-line mono">{d.repo} · {d.line}</span>
          </div>
          <Actions d={d} />
          {d.conflict && <p className="deleg-conflict" role="alert">{d.conflict}</p>}
          {confirming === d.id && (
            <div className="perm" role="group" aria-label="Apply">
              <div className="pwhat">{d.apply_text}</div>
              <div className="pbtns">
                <button type="button" className="allow" onClick={() => apply(d.id)}>Confirm</button>
                <button type="button" onClick={() => askApply(null)}>Cancel</button>
              </div>
            </div>
          )}
          {diff?.id === d.id && (
            <div className="deleg-diff" role="group" aria-label={`Changes on ${diff.branch}`}>
              <pre>{diff.diff || "No changes."}</pre>
              <button type="button" className="hbtn" onClick={closeDiff}>Close</button>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

export function Actions({ d }: { d: DelegationItem }) {
  const done = d.stage === "applied" || d.stage === "reverted";
  const [sure, setSure] = useState(false);  // Discard drops the branch and its commits: a second tap
  const refused = d.needs === "collision" && !d.update_from;  // an update that would change their lines: Discard only
  return (
    <span className="deleg-actions">
      {!done && d.needs !== "stopped" && d.needs !== "collision" && d.stage !== "queued" && <button type="button" className="hbtn" onClick={() => openFolder(d.folder, d.session)}>Open session</button>}
      {d.needs === "outward" && <button type="button" className="hbtn dark" onClick={() => outward(d.id, true)}>{d.stage === "applied" ? "Push and open revert PR" : d.pr ? "Push" : "Push and open PR"}</button>}
      {d.needs === "merge" && <button type="button" className="hbtn dark" onClick={() => outward(d.id, true)}>Merge PR #{d.pr}</button>}
      {(d.needs === "outward" || d.needs === "merge") && <button type="button" className="hbtn" onClick={() => outward(d.id, false)}>Skip</button>}
      {d.pr && d.pr_url && /^https:\/\//.test(d.pr_url) && <a className="hbtn" href={d.pr_url} target="_blank" rel="noreferrer">PR #{d.pr}</a>}
      {d.update_from && <button type="button" className="hbtn dark" onClick={() => update(d.id)}>Update from {d.update_from}</button>}
      {d.stage === "ready" && !refused && <button type="button" className="hbtn" onClick={() => review(d.id)}>Review</button>}
      {d.stage === "ready" && d.needs !== "collision" && d.needs !== "merge" && <button type="button" className="hbtn dark" onClick={() => askApply(d.id)}>{d.conflict ? "Apply again" : "Apply"}</button>}
      {(d.needs === "failed" || d.needs === "stuck") && <button type="button" className="hbtn dark" onClick={() => retry(d.id)}>Retry</button>}
      {d.needs === "stopped" && <button type="button" className="hbtn dark" onClick={() => resume(d.id)}>Resume</button>}
      {d.stage === "applied" && !d.needs && <button type="button" className="hbtn" onClick={() => revert(d.id)}>Undo</button>}
      {done ? <button type="button" className="hbtn" onClick={() => discard(d.id)}>Dismiss</button>
        : <button type="button" className="hbtn" onClick={() => (sure ? discard(d.id) : setSure(true))} onBlur={() => setSure(false)}>{sure ? "Discard branch and work?" : "Discard"}</button>}
    </span>
  );
}
