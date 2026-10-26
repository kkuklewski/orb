// The five setup screens. Copy and behaviour match the old page (src/orb/static/app.js, Onb).
import { useEffect, useState, type ReactNode } from "react";
import { send } from "../../ws";
import { useFeatures } from "../../stores/features";
import { canContinue, hasRepos, signedIn, useSetup } from "../../stores/setup";
import { BROWSER_STT, BROWSER_TTS, speakInBrowser, unlockAudio } from "../../audio/sample";
import { goTo, next } from "./Setup";
import { FolderBrowser } from "./FolderBrowser";
import { VoiceList } from "./VoiceList";

function Head({ kicker, title, text }: { kicker: string; title: string; text?: string }) {
  return (
    <>
      <p className="mono onb-kicker">{kicker}</p>
      <h2 className="onb-title" id="onb-title">{title}</h2>
      {text && <p className="onb-text">{text}</p>}
    </>
  );
}

function Foot({ label, hint }: { label: string; hint?: string }) {
  const { step, status } = useSetup();
  const ok = canContinue(step, status);
  return (
    <div className="onb-foot">
      {step > 0 && <button type="button" className="onb-btn ghost" onClick={() => goTo(step - 1)}>Back</button>}
      <span className="onb-spacer" />
      <button type="button" className="onb-btn primary" disabled={!ok} title={!ok ? hint : undefined} onClick={next}>{label}</button>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="onb-row">{children}</div>;
}

function Status({ good, children }: { good: boolean; children: ReactNode }) {
  return <p className={"onb-status" + (good ? " good" : "")}><span className="onb-dot" />{children}</p>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="onb-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
    }}>{done ? "Copied" : "Copy"}</button>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Welcome() {
  return (
    <>
      <Head kicker="ORB · POWERED BY CLAUDE" title="Talk to your code."
        text="Orb lets you talk to Claude about the repos on this Mac: ask, plan and change code by voice, and approve every change. Setup takes about a minute." />
      <ul className="onb-points">
        <li>Runs on your own Claude Pro or Max plan</li>
        <li>Only the folders you choose</li>
        <li>Every change asks you first</li>
      </ul>
      <Foot label="Get started" />
    </>
  );
}

export function SignIn() {
  const status = useSetup((s) => s.status);
  const a = status?.auth;
  const ok = signedIn(status);
  const cmd = status?.login_cmd || "claude auth login";
  return (
    <>
      <Head kicker="STEP 01" title="Sign in to Claude"
        text="Orb runs Claude Code with your own subscription. You sign in in Anthropic's own window; Orb never sees your login." />
      {!a ? <Status good={false}>Checking Claude Code…</Status>
        : ok ? <Status good>Signed in · Claude {a.subscription ? cap(a.subscription) : ""} plan</Status>
          : (
            <>
              <Status good={false}>
                {!a.installed ? "Claude Code wasn't found."
                  : a.loggedIn ? "Signed in with a Console account or API key. Orb needs a Claude Pro or Max account."
                    : "Not signed in yet."}
              </Status>
              <p className="onb-text small">Open Terminal, run this, sign in in the browser window it opens, then come back:</p>
              <Row>
                <code className="onb-code">{cmd}</code>
                <CopyButton text={cmd} />
                <button type="button" className="onb-btn" onClick={() => send({ type: "setup_status" })}>Check again</button>
              </Row>
              {a.error && <p className="onb-text small">{a.error}</p>}
            </>
          )}
      <Foot label="Continue" hint="Sign in first" />
    </>
  );
}

export function Folders() {
  const { status, browsing, picking } = useSetup();
  const [typed, setTyped] = useState("");
  const roots = status?.roots ?? [];
  const home = status?.home ?? "";
  const tilde = (p: string) => (home ? p.replace(home, "~") : p);
  const setRoots = (paths: string[]) => send({ type: "set_settings", values: { roots: paths } });
  const add = (p: string) => setRoots([...roots.map((r) => r.path), p]);
  const addTyped = () => {
    const v = typed.trim().replace(/^~(?=\/|$)/, home);
    if (!v) return;
    if (v === home && !confirm("Give Orb your whole home folder? It would list every repo in it.")) return;
    add(v);
    setTyped("");
  };
  return (
    <>
      <Head kicker="STEP 02" title="Choose your code folders"
        text="Orb lists the git repos inside these folders. A conversation stays in its own repo; touching another needs your OK." />
      <div className="onb-list">
        {roots.map((r) => (
          <div className="onb-item on" key={r.path}>
            <span className="onb-check">✓</span>
            <div className="onb-item-txt">
              <code>{tilde(r.path)}</code>
              <span>{r.exists ? `${r.repos.length} repo${r.repos.length === 1 ? "" : "s"}` : "missing"}</span>
            </div>
            <button type="button" className="onb-btn ghost small" onClick={() => setRoots(roots.map((x) => x.path).filter((p) => p !== r.path))}>Remove</button>
          </div>
        ))}
        {(status?.suggested ?? []).map((sug) => (
          <button type="button" className="onb-item" key={sug.path} onClick={() => add(sug.path)}>
            <span className="onb-check">+</span>
            <div className="onb-item-txt"><code>{tilde(sug.path)}</code><span>{sug.repos} repos · add</span></div>
          </button>
        ))}
      </div>
      <Row>
        <button type="button" className="onb-btn" disabled={picking}
          onClick={() => { useSetup.setState({ picking: true, pickFor: "roots" }); send({ type: "pick_folder" }); }}>
          {picking ? "Waiting for Finder…" : "Choose in Finder…"}
        </button>
        <button type="button" className="onb-btn" onClick={() => {
          const open = !browsing;
          useSetup.setState({ browsing: open });
          if (open && !useSetup.getState().dir) send({ type: "browse" });
        }}>{browsing ? "Hide browser" : "Browse folders"}</button>
      </Row>
      {browsing && <FolderBrowser onAdd={add} chosen={(p) => roots.some((r) => r.path === p)} />}
      <Row>
        <input className="onb-input" placeholder="Another folder, e.g. ~/code" aria-label="Folder path" value={typed}
          onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }} />
        <button type="button" className="onb-btn" onClick={addTyped}>Add</button>
      </Row>
      <p className="onb-text small">Always blocked: secrets/ folders, .env files, keys and credentials, ~/.ssh and ~/.aws.</p>
      <Foot label="Continue" hint="Add a folder with at least one repo" />
    </>
  );
}

export function Notes() {
  const { status, browsing, picking } = useSetup();
  const [typed, setTyped] = useState("");
  const vault = status?.vault ?? null;
  const home = status?.home ?? "";
  const tilde = (p: string) => (home ? p.replace(home, "~") : p);
  const choose = (p: string) => send({ type: "set_settings", values: { vault: p } });
  const chooseTyped = () => {
    const v = typed.trim().replace(/^~(?=\/|$)/, home);
    if (v) { choose(v); setTyped(""); }
  };
  return (
    <>
      <Head kicker="STEP 03" title="Your notes, your second brain"
        text="Point Orb at the folder where you keep your notes: an Obsidian vault, or any folder of Markdown files. Its home screen then shows your open tasks and recent notes, and you can ask about them by voice." />
      <div className="onb-list">
        {vault ? (
          <div className="onb-item on">
            <span className="onb-check">{vault.exists ? "✓" : "!"}</span>
            <div className="onb-item-txt">
              <code>{tilde(vault.path)}</code>
              <span>{vault.exists ? `${vault.notes} note${vault.notes === 1 ? "" : "s"} · ${vault.open_tasks} open task${vault.open_tasks === 1 ? "" : "s"}` : "missing"}</span>
            </div>
            <button type="button" className="onb-btn ghost small" onClick={() => choose("")}>Remove</button>
          </div>
        ) : (
          <p className="onb-text small">No notes folder yet. This step is optional: you can add one later in Settings.</p>
        )}
      </div>
      <Row>
        <button type="button" className="onb-btn" disabled={picking}
          onClick={() => { useSetup.setState({ picking: true, pickFor: "vault" }); send({ type: "pick_folder" }); }}>
          {picking ? "Waiting for Finder…" : "Choose in Finder…"}
        </button>
        <button type="button" className="onb-btn" onClick={() => {
          const open = !browsing;
          useSetup.setState({ browsing: open });
          if (open && !useSetup.getState().dir) send({ type: "browse" });
        }}>{browsing ? "Hide browser" : "Browse folders"}</button>
      </Row>
      {browsing && <FolderBrowser onAdd={choose} chosen={(p) => vault?.path === p} label="Use as notes" warnHome={false} />}
      <Row>
        <input className="onb-input" placeholder="Or type a path, e.g. ~/Documents/Notes" aria-label="Notes folder path" value={typed}
          onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); chooseTyped(); } }} />
        <button type="button" className="onb-btn" onClick={chooseTyped}>Use</button>
      </Row>
      <p className="onb-text small">Orb reads the notes only on this Mac. A notes session may write there too; edits to CLAUDE.md files always need your OK.</p>
      <Foot label={vault ? "Continue" : "Skip for now"} />
    </>
  );
}

function Seg({ label, options, value, onPick }: {
  label: string; options: [string, string, boolean][]; value: unknown; onPick: (v: string) => void;
}) {
  return (
    <div className="onb-field">
      <span className="mono onb-label">{label}</span>
      <div className="onb-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text, ok]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} disabled={!ok} title={ok ? undefined : "Not installed on this Mac"}
            className={"onb-seg-btn" + (v === value ? " on" : "")} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

// VoiceMode's Kokoro, step by step: Orb only looks at what's there (setup.kokoro_install); the owner runs each command.
const KOKORO_STEPS: [string, string, (k: { voicemode: boolean; installed: boolean; autostart: boolean }, running: boolean) => boolean][] = [
  ["uv tool install voice-mode", "VoiceMode, which installs and runs Kokoro", (k) => k.voicemode],
  ["voicemode service install kokoro", "Kokoro and its voices (a few minutes)", (k) => k.installed],
  ["voicemode service start kokoro", "Start it", (_, running) => running],
  ["voicemode service enable kokoro", "Start it at login", (k) => k.autostart],
];
const KOKORO_POLL_MS = 5000;

function KokoroSetup({ running, onReady }: { running: boolean; onReady: () => void }) {
  const k = useSetup((s) => s.status?.kokoro_install);
  const [open, setOpen] = useState(false);
  useEffect(() => { // while the steps are open, look again every few seconds until she answers
    if (!open || running) return;
    const t = setInterval(() => send({ type: "setup_status" }), KOKORO_POLL_MS);
    return () => clearInterval(t);
  }, [open, running]);
  useEffect(() => { if (open && running) onReady(); }, [open, running]);
  if (!k || (running && !open)) return null;
  if (!open) return <Row><button type="button" className="onb-btn" onClick={() => setOpen(true)}>Set up Kokoro</button></Row>;
  return (
    <div className="onb-kokoro">
      <p className="onb-text small">Kokoro is a local voice: it runs on this Mac, nothing leaves it. English voices only. Run these in Terminal, one at a time; each turns done here on its own.</p>
      <ol className="onb-steps">
        {KOKORO_STEPS.map(([cmd, what, done]) => {
          const ok = done(k, running);
          return (
            <li key={cmd} className={ok ? "done" : undefined}>
              <span className="onb-step-what"><span className="onb-dot" aria-hidden="true" />{what}{ok && <span className="sr-only"> (done)</span>}</span>
              <Row><code className="onb-code">{cmd}</code><CopyButton text={cmd} /></Row>
            </li>
          );
        })}
      </ol>
      {running ? <Status good>Kokoro is running. Her voice is set to Kokoro.</Status>
        : <Row><button type="button" className="onb-btn" onClick={() => send({ type: "setup_status" })}>Check again</button></Row>}
    </div>
  );
}

export function Voice() {
  const status = useSetup((s) => s.status);
  const sp = status?.speech ?? {};
  const values = (status?.values ?? {}) as { stt?: string; tts?: string; voice?: string };
  const set = (key: "stt" | "tts", v: string) => send({ type: "set_settings", values: { [key]: v } });
  const [mic, setMic] = useState("Test microphone");
  const testMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMic("Listening… say something");
      setTimeout(() => { stream.getTracks().forEach((t) => t.stop()); setMic("✓ Microphone works"); }, 2500);
    } catch (e) {
      setMic(`Microphone blocked (${(e as Error).name})`);
    }
  };
  const hear = () => {
    if (values.tts === "browser") speakInBrowser("Hi, I'm Orb. Pick a repo and just talk.");
    else { unlockAudio(); send({ type: "voice_sample" }); }
  };
  return (
    <>
      <Head kicker="STEP 04" title="Her voice, and yours"
        text="Browser speech works right away (Chrome transcribes through Google; Safari can on this Mac). Local engines keep everything on this Mac." />
      <Seg label="HEARING YOU" value={values.stt} onPick={(v) => set("stt", v)}
        options={[["browser", "Browser", BROWSER_STT], ["parakeet", "Parakeet", !!sp.parakeet], ["whisper", "Whisper", !!sp.whisper]]} />
      <Seg label="HER VOICE" value={values.tts} onPick={(v) => set("tts", v)}
        options={[["browser", "Browser", BROWSER_TTS], ["kokoro", "Kokoro", !!sp.kokoro]]} />
      <KokoroSetup running={!!sp.kokoro} onReady={() => set("tts", "kokoro")} />
      {values.tts === "kokoro" && (status?.voices.length ?? 0) > 0 && <VoiceList voices={status!.voices} current={values.voice} />}
      <Row>
        <button type="button" className="onb-btn" onClick={testMic}>{mic}</button>
        <button type="button" className="onb-btn" onClick={hear}>Hear her</button>
      </Row>
      <Foot label="Continue" />
    </>
  );
}

function Cell({ n, label, rule, text, children }: { n: string; label: string; rule: string; text: string; children: ReactNode }) {
  return (
    <div className="onb-spec-cell">
      <p className="mono onb-spec-label"><span className="onb-spec-sq" />{n} · {label}</p>
      <h3 className="onb-spec-rule">{rule}</h3>
      <p className="onb-spec-text">{text}</p>
      {children}
    </div>
  );
}

function Proof({ rows }: { rows: [string, string, string?][] }) {
  return (
    <div className="mono onb-spec-proof" aria-hidden="true">
      {rows.map(([k, v, cls]) => <div className="onb-spec-row" key={k}><span>{k}</span><span className={cls}>{v}</span></div>)}
    </div>
  );
}

export function Control() {
  const status = useSetup((s) => s.status);
  const onboarded = useFeatures((s) => !!s.features?.onboarded);
  const sub = status?.auth.subscription;
  const plan = sub ? cap(sub) : "Pro / Max";
  return (
    <>
      <Head kicker="STEP 05" title="Nothing changes without you." text="Four rules Orb keeps, whatever you ask it." />
      <div className="onb-spec">
        <Cell n="01" label="APPROVALS" rule="Every change asks first." text="Allow or Deny on a card, or answer yes / no by voice on headphones.">
          <div className="onb-spec-proof onb-spec-mini" aria-hidden="true">
            <div className="mono onb-spec-minihead"><span className="onb-spec-sq" />NEEDS YOUR OK</div>
            <div className="onb-spec-minibody"><code>Edit tests/setup.ts</code><span className="onb-spec-btn">Deny</span><span className="onb-spec-btn solid">Allow</span></div>
          </div>
        </Cell>
        <Cell n="02" label="SCOPE" rule="One repo per conversation." text="Other repos need your OK. Secret files are never readable.">
          <Proof rows={[["web/src/", "open"], ["../api/", "asks first", "warn"], [".env", "blocked", "bad"]]} />
        </Cell>
        <Cell n="03" label="BILLING" rule="Your plan. No API keys." text="Runs on your Claude subscription through Claude Code; API keys are refused.">
          <Proof rows={[["plan", plan], ["apiKeySource", "none"]]} />
        </Cell>
        <Cell n="04" label="LOCAL" rule="It stays on this Mac." text="The page only listens here and opens with its private link.">
          <Proof rows={[["listens on", "127.0.0.1"], ["access", "private link only"]]} />
        </Cell>
      </div>
      <Foot label={onboarded ? "Done" : "Start using Orb"} hint={hasRepos(status) ? "Sign in first" : "Sign in and add a folder with a repo first"} />
    </>
  );
}
