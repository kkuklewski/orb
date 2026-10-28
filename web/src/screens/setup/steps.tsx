// The five setup screens. Copy and behaviour carried over from the old page (Onb).
import { useEffect, useState, type ReactNode } from "react";
import { send } from "../../ws";
import { useFeatures } from "../../stores/features";
import { LAST_RULE, canAdvance, hasRepos, signedIn, useSetup } from "../../stores/setup";
import { BROWSER_STT, BROWSER_TTS, speakInBrowser, unlockAudio } from "../../audio/sample";
import { back, next } from "./Setup";
import { FolderBrowser } from "./FolderBrowser";
import { VoiceList } from "./VoiceList";
import { ApprovalScene, LocalScene, PlanScene, ScopeScene } from "./ControlScenes";

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
  const { step, rule, status } = useSetup();
  const ok = canAdvance(step, rule, status);
  return (
    <div className="onb-foot">
      {step > 0 && <button type="button" className="onb-btn ghost" onClick={back}>Back</button>}
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

const PROFILE_TEXT: Record<string, string> = {
  work: "Work: no claude.ai connectors, speech stays on this Mac, each repo stays in its own session, the page answers on this Mac only.",
  personal: "Personal: Brain and your other connectors when you turn them on, browser speech, a card before a session reaches another repo, Tailscale serve.",
};

export function Welcome() {
  const profile = (useSetup((s) => s.status)?.values as { profile?: string } | undefined)?.profile ?? "work";
  return (
    <>
      <Head kicker="ORB · POWERED BY CLAUDE" title="Talk to your code."
        text="Orb lets you talk to Claude about the repos on this Mac: ask, plan and change code by voice, and approve every change. Setup takes about a minute." />
      <ul className="onb-points">
        <li>Runs on your own Claude Pro or Max plan</li>
        <li>Only the folders you choose</li>
        <li>Every change asks you first</li>
      </ul>
      <Seg label="THIS MAC" value={profile} onPick={(v) => send({ type: "set_settings", values: { profile: v } })}
        options={[["work", "Work machine", true], ["personal", "Personal", true]]} />
      <p className="onb-text small">{PROFILE_TEXT[profile]} You can change it later in Settings.</p>
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
  label: string; options: [string, string, boolean, string?][]; value: unknown; onPick: (v: string) => void;
}) {
  return (
    <div className="onb-field">
      <span className="mono onb-label">{label}</span>
      <div className="onb-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text, ok, why]) => (
          <button key={v} type="button" role="radio" aria-checked={v === value} disabled={!ok} title={ok ? undefined : why ?? "Not installed on this Mac"}
            className={"onb-seg-btn" + (v === value ? " on" : "")} onClick={() => onPick(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

// VoiceMode's Kokoro: one click (kokoro_setup.py runs these, then keeps it on 127.0.0.1), or the commands by hand.
const KOKORO_CMDS = [
  "uv tool install voice-mode",
  "voicemode service install kokoro",
  "sed -i '' 's/--host 0.0.0.0/--host 127.0.0.1/' ~/.voicemode/services/kokoro/start-*.sh",
  "voicemode service enable kokoro",
];
const KOKORO_POLL_MS = 5000;

function KokoroSetup({ running, onReady }: { running: boolean; onReady: () => void }) {
  const k = useSetup((s) => s.status?.kokoro_install);
  const [open, setOpen] = useState(false);
  const job = k?.job;
  const busy = !!job?.running;
  useEffect(() => { // while it installs or starts, look again every few seconds until she answers
    if (!(open || busy) || (running && !busy)) return;
    const t = setInterval(() => send({ type: "setup_status" }), KOKORO_POLL_MS);
    return () => clearInterval(t);
  }, [open, busy, running]);
  useEffect(() => { if (open && running && !k?.exposed) onReady(); }, [open, running, k?.exposed]);
  if (!k) return null;
  const go = () => { setOpen(true); send({ type: "kokoro_setup" }); };
  const progress = job && (job.error ? <Status good={false}>{job.error}</Status>
    : <p className="onb-text small" role="status">{job.step}…</p>);
  if (k.exposed) return (
    <div className="onb-kokoro">
      <Status good={false}>Kokoro listens on your whole network, so other devices can use it. Orb can keep it on this Mac.</Status>
      {busy ? progress : <>{job?.error && progress}<Row><button type="button" className="onb-btn" onClick={go}>Keep it on this Mac</button></Row></>}
    </div>
  );
  if (running && !open) return null;
  if (!open) return <Row><button type="button" className="onb-btn" onClick={() => setOpen(true)}>Set up Kokoro</button></Row>;
  return (
    <div className="onb-kokoro">
      <p className="onb-text small">Kokoro is a local voice: it runs on this Mac and nothing leaves it. English voices only. Orb installs it with VoiceMode (a few minutes, about 2 GB) and keeps it to this Mac.</p>
      {running ? <Status good>Kokoro is running. Her voice is set to Kokoro.</Status>
        : busy || (job && !job.error) ? progress
        : <>{progress}<Row><button type="button" className="onb-btn" onClick={go}>{job?.error ? "Try again" : "Install Kokoro"}</button></Row></>}
      {!running && !busy && (
        <details className="onb-kokoro-manual">
          <summary>Or run it yourself in Terminal</summary>
          <ol className="onb-steps">
            {KOKORO_CMDS.map((cmd) => <li key={cmd}><Row><code className="onb-code">{cmd}</code><CopyButton text={cmd} /></Row></li>)}
          </ol>
        </details>
      )}
    </div>
  );
}

export function Voice() {
  const status = useSetup((s) => s.status);
  const sp = status?.speech ?? {};
  const values = (status?.values ?? {}) as { profile?: string; stt?: string; tts?: string; voice?: string };
  const work = values.profile !== "personal";
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
        text={work ? "Parakeet and Whisper hear you on this Mac; without them, type. Browser speech recognition is off on a work machine: Chrome sends the audio to Google."
          : "Parakeet and Whisper hear you on this Mac. Browser speech works right away, but Chrome sends the audio to Google."} />
      <Seg label="HEARING YOU" value={values.stt} onPick={(v) => set("stt", v)}
        options={[["parakeet", "Parakeet", !!sp.parakeet], ["whisper", "Whisper", !!sp.whisper],
          ["browser", "Browser (Google)", BROWSER_STT && !work, work ? "Off on a work machine: Chrome sends the audio to Google" : undefined]]} />
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

// Control: the four rules, one screen each, each with its own picture (ControlScenes.tsx).
const RULES = [
  { name: "Approvals", title: "You say yes first.", Scene: ApprovalScene,
    text: () => "Orb never changes a file on its own. It shows you what it wants to do and waits. Tap Allow or Deny, or with headphones on, just say yes or no." },
  { name: "Your projects", title: "One project at a time.", Scene: ScopeScene,
    text: (work: boolean) => (work
      ? "A conversation stays inside the project you opened it in. Your other projects stay closed. Files with passwords and keys are never opened, even if you ask."
      : "A conversation stays inside the project you opened it in. Before it looks at another project, Orb asks you. Files with passwords and keys are never opened, even if you ask.") },
  { name: "Your plan", title: "Your plan. No extra bills.", Scene: PlanScene,
    text: () => "Orb runs on the Claude plan you already pay for. It refuses pay-as-you-go API keys, so nothing gets billed on top." },
  { name: "This Mac", title: "It stays on this Mac.", Scene: LocalScene,
    text: () => "Orb's page opens only on this Mac, through a private link. Nobody else on your Wi-Fi or the internet can open it." },
];

export function Control() {
  const { status, rule } = useSetup();
  const onboarded = useFeatures((s) => !!s.features?.onboarded);
  const work = ((status?.values as { profile?: string } | undefined)?.profile ?? "work") === "work";
  const sub = status?.auth.subscription;
  const plan = sub ? cap(sub) : "Pro / Max";
  const r = RULES[rule] ?? RULES[0];
  const last = rule === LAST_RULE;
  return (
    <>
      <Head kicker={`STEP 05 · RULE ${rule + 1} OF ${RULES.length}`} title={r.title} />
      <div className="onb-rules" role="tablist" aria-label="Orb's rules">
        {RULES.map((x, i) => (
          <button key={x.name} type="button" role="tab" aria-selected={i === rule}
            className={"onb-rules-tab" + (i === rule ? " on" : "") + (i < rule ? " seen" : "")}
            onClick={() => useSetup.setState({ rule: i })}>
            <span className="mono">{String(i + 1).padStart(2, "0")}</span>{x.name}
          </button>
        ))}
      </div>
      <div className="onb-rule" key={rule}>
        <div className="onb-scene" aria-hidden="true"><r.Scene plan={plan} work={work} /></div>
        <p className="onb-text onb-rule-text">{r.text(work)}</p>
      </div>
      <Foot label={!last ? "Got it" : onboarded ? "Done" : "Start using Orb"}
        hint={hasRepos(status) ? "Sign in first" : "Sign in and add a folder with a repo first"} />
    </>
  );
}
