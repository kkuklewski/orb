// The setup screens, written for people who don't code: one ask per screen, each with a picture (Scenes.tsx).
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { send } from "../../ws";
import { useFeatures } from "../../stores/features";
import { PARTS, canAdvance, hasRepos, lastPart, signedIn, useSetup } from "../../stores/setup";
import { BROWSER_STT, BROWSER_TTS, speakInBrowser, unlockAudio } from "../../audio/sample";
import { back, next } from "./Setup";
import { FolderBrowser } from "./FolderBrowser";
import { VoiceList } from "./VoiceList";
import {
  ApprovalScene, FoldersScene, HearScene, LocalScene, NotesScene, PlanScene, ScopeScene, SignInScene, SpeakScene, TalkScene,
} from "./Scenes";

function Head({ kicker, title, text }: { kicker: string; title: string; text?: string }) {
  return (
    <>
      <p className="mono onb-kicker">{kicker}</p>
      <h2 className="onb-title" id="onb-title">{title}</h2>
      {text && <p className="onb-text">{text}</p>}
    </>
  );
}

/** "STEP 04 · 1 OF 2" on a step with several screens. */
function kicker(step: number, part: number, noun = "") {
  const n = PARTS[step] ?? 1;
  return `STEP ${String(step).padStart(2, "0")}` + (n > 1 ? ` · ${noun}${part + 1} OF ${n}` : "");
}

/** The tabs over a step's screens: where you are, what's seen, a tap to jump. */
function Parts({ names, label }: { names: string[]; label: string }) {
  const part = useSetup((s) => s.part);
  return (
    <div className="onb-rules" role="tablist" aria-label={label} style={{ "--n": names.length } as CSSProperties}>
      {names.map((name, i) => (
        <button key={name} type="button" role="tab" aria-selected={i === part}
          className={"onb-rules-tab" + (i === part ? " on" : "") + (i < part ? " seen" : "")}
          onClick={() => useSetup.setState({ part: i })}>
          <span className="mono">{String(i + 1).padStart(2, "0")}</span>{name}
        </button>
      ))}
    </div>
  );
}

/** The picture: decorative, the text says it all. `small` on screens that also hold controls. */
function Scene({ children, small }: { children: ReactNode; small?: boolean }) {
  return <div className={"onb-scene" + (small ? " small" : "")} aria-hidden="true">{children}</div>;
}

function Foot({ label, hint }: { label: string; hint?: string }) {
  const { step, part, status } = useSetup();
  const ok = canAdvance(step, part, status);
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

const MACS: { id: string; name: string; points: string[]; icon: ReactNode }[] = [
  { id: "work", name: "Work Mac", icon: <path d="M8 16h32v22H8zM18 16v-5h12v5M8 25h32" />, points: [
    "Your voice is turned into text on this Mac only",
    "No claude.ai connectors",
    "Each project kept fully apart",
    "Orb's page opens on this Mac only",
  ] },
  { id: "personal", name: "Personal Mac", icon: <path d="M8 22 24 9l16 13M12 19v19h24V19M20 38V27h8v11" />, points: [
    "Your Brain and other claude.ai connectors, when you turn them on",
    "Browser speech (Chrome sends your voice to Google)",
    "Asks before a conversation looks at another project",
    "Open Orb from your own devices (Tailscale)",
  ] },
];

export function Welcome() {
  const part = useSetup((s) => s.part);
  const profile = (useSetup((s) => s.status)?.values as { profile?: string } | undefined)?.profile ?? "work";
  if (part === 0) return (
    <>
      <Head kicker="ORB · POWERED BY CLAUDE" title="Talk to your code."
        text="Orb lets you talk to Claude about the projects on this Mac. Ask questions, plan changes and make them, out loud or by typing. Nothing changes without your OK. Setup takes about a minute." />
      <div className="onb-rule"><Scene><TalkScene /></Scene></div>
      <Foot label="Get started" />
    </>
  );
  return (
    <>
      <Head kicker="WELCOME · 2 OF 2" title="Is this a work Mac?"
        text="This decides how careful Orb is with your code and your voice. You can change it later in Settings." />
      <div className="onb-macs onb-rule" role="radiogroup" aria-label="This Mac">
        {MACS.map((m) => (
          <button key={m.id} type="button" role="radio" aria-checked={m.id === profile} className={"onb-mac" + (m.id === profile ? " on" : "")}
            onClick={() => send({ type: "set_settings", values: { profile: m.id } })}>
            <span className="onb-mac-head">
              <svg className="sc-icon" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">{m.icon}</svg>
              <b>{m.name}</b><span className="onb-mac-radio" />
            </span>
            <ul>{m.points.map((t) => <li key={t}>{t}</li>)}</ul>
          </button>
        ))}
      </div>
      <Foot label="Continue" />
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
        text="Orb uses your own Claude subscription. You sign in on Anthropic's own page, so Orb never sees your password." />
      <Scene small><SignInScene ok={ok} plan={a?.subscription ? cap(a.subscription) : "Pro"} /></Scene>
      {!a ? <Status good={false}>Checking Claude Code…</Status>
        : ok ? <Status good>Signed in · Claude {a.subscription ? cap(a.subscription) : ""} plan</Status>
          : (
            <>
              <Status good={false}>
                {!a.installed ? "Claude Code wasn't found."
                  : a.loggedIn ? "You're signed in with a developer (Console) account or an API key. Orb needs a Claude Pro or Max account."
                    : "Not signed in yet."}
              </Status>
              <p className="onb-text small">Open the Terminal app, paste this line and press Return. Sign in on the page that opens, then come back here.</p>
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
      <Head kicker="STEP 02" title="Where are your projects?"
        text="Pick the folder that holds your code projects. Orb finds every project inside it (each folder tracked with git), and each conversation stays inside one project." />
      <Scene small><FoldersScene /></Scene>
      <div className="onb-list">
        {roots.map((r) => (
          <div className="onb-item on" key={r.path}>
            <span className="onb-check">✓</span>
            <div className="onb-item-txt">
              <code>{tilde(r.path)}</code>
              <span>{r.exists ? `${r.repos.length} project${r.repos.length === 1 ? "" : "s"}` : "not found"}</span>
            </div>
            <button type="button" className="onb-btn ghost small" onClick={() => setRoots(roots.map((x) => x.path).filter((p) => p !== r.path))}>Remove</button>
          </div>
        ))}
        {(status?.suggested ?? []).map((sug) => (
          <button type="button" className="onb-item" key={sug.path} onClick={() => add(sug.path)}>
            <span className="onb-check">+</span>
            <div className="onb-item-txt"><code>{tilde(sug.path)}</code><span>{sug.repos} project{sug.repos === 1 ? "" : "s"} · add</span></div>
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
        <input className="onb-input" placeholder="Or type a folder, e.g. ~/code" aria-label="Folder path" value={typed}
          onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }} />
        <button type="button" className="onb-btn" onClick={addTyped}>Add</button>
      </Row>
      <p className="onb-text small">Always off-limits, even inside these folders: secrets folders, .env files, keys and passwords, ~/.ssh and ~/.aws.</p>
      <Foot label="Continue" hint="Add a folder with at least one project" />
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
        text="Keep notes in Obsidian or plain Markdown files? Point Orb at that folder. Its home screen then shows your open tasks and recent notes, and you can ask about them out loud." />
      <Scene small><NotesScene /></Scene>
      <div className="onb-list">
        {vault ? (
          <div className="onb-item on">
            <span className="onb-check">{vault.exists ? "✓" : "!"}</span>
            <div className="onb-item-txt">
              <code>{tilde(vault.path)}</code>
              <span>{vault.exists ? `${vault.notes} note${vault.notes === 1 ? "" : "s"} · ${vault.open_tasks} open task${vault.open_tasks === 1 ? "" : "s"}` : "not found"}</span>
            </div>
            <button type="button" className="onb-btn ghost small" onClick={() => choose("")}>Remove</button>
          </div>
        ) : (
          <p className="onb-text small">No notes folder yet. This step is optional; you can add one later in Settings.</p>
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
      <p className="onb-text small">Orb reads your notes only on this Mac. A notes conversation can write there too; changes to its instruction files (CLAUDE.md) always need your OK.</p>
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
  const part = useSetup((s) => s.part);
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
  const tabs = <Parts names={["Hearing you", "Her voice"]} label="Voice" />;
  if (part === 0) return (
    <>
      <Head kicker={kicker(4, part)} title="How Orb hears you." />
      {tabs}
      <div className="onb-rule">
        <Scene small><HearScene local={values.stt !== "browser"} /></Scene>
        <p className="onb-text onb-rule-text">{work
          ? "Parakeet and Whisper turn your voice into text right here on this Mac. If neither is installed, you can type instead. Browser speech is off on a work Mac, because Chrome sends your voice to Google."
          : "Parakeet and Whisper turn your voice into text right here on this Mac. Browser speech works right away, but Chrome sends your voice to Google to do it."}</p>
      </div>
      <Seg label="LISTENING WITH" value={values.stt} onPick={(v) => set("stt", v)}
        options={[["parakeet", "Parakeet", !!sp.parakeet], ["whisper", "Whisper", !!sp.whisper],
          ["browser", "Browser (Google)", BROWSER_STT && !work, work ? "Off on a work Mac: Chrome sends your voice to Google" : undefined]]} />
      <Row><button type="button" className="onb-btn" onClick={testMic}>{mic}</button></Row>
      <Foot label="Continue" />
    </>
  );
  return (
    <>
      <Head kicker={kicker(4, part)} title="How Orb talks back." />
      {tabs}
      <div className="onb-rule">
        <Scene small><SpeakScene engine={values.tts === "kokoro" ? "Kokoro · on this Mac" : "Browser voice"} /></Scene>
        <p className="onb-text onb-rule-text">Pick the voice Orb answers with. Browser voices work right away. Kokoro sounds more natural and runs on this Mac (English voices only).</p>
      </div>
      <Seg label="HER VOICE" value={values.tts} onPick={(v) => set("tts", v)}
        options={[["browser", "Browser", BROWSER_TTS], ["kokoro", "Kokoro", !!sp.kokoro]]} />
      <KokoroSetup running={!!sp.kokoro} onReady={() => set("tts", "kokoro")} />
      {values.tts === "kokoro" && (status?.voices.length ?? 0) > 0 && <VoiceList voices={status!.voices} current={values.voice} />}
      <Row><button type="button" className="onb-btn" onClick={hear}>Hear her</button></Row>
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
  const { status, part: rule } = useSetup();
  const onboarded = useFeatures((s) => !!s.features?.onboarded);
  const work = ((status?.values as { profile?: string } | undefined)?.profile ?? "work") === "work";
  const sub = status?.auth.subscription;
  const plan = sub ? cap(sub) : "Pro / Max";
  const r = RULES[rule] ?? RULES[0];
  const last = rule === lastPart(5);
  return (
    <>
      <Head kicker={kicker(5, rule, "RULE ")} title={r.title} />
      <Parts names={RULES.map((x) => x.name)} label="Orb's rules" />
      <div className="onb-rule" key={rule}>
        <div className="onb-scene" aria-hidden="true"><r.Scene plan={plan} work={work} /></div>
        <p className="onb-text onb-rule-text">{r.text(work)}</p>
      </div>
      <Foot label={!last ? "Got it" : onboarded ? "Done" : "Start using Orb"}
        hint={hasRepos(status) ? "Sign in first" : "Sign in and add a folder with a repo first"} />
    </>
  );
}
