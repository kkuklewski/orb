import { useEffect, useState, type ReactNode } from "react";
import { send } from "../ws";
import { useFeatures } from "../stores/features";
import { useViews } from "../stores/views";
import { setBarge, useVoice, type BargeMode } from "../stores/voice";
import { unlockAudio } from "../audio/sample";
import { openSetup } from "../stores/setup";

// Settings kept on the server (voice, defaults for new folders, speech, vocabulary) and two choices
// kept in this browser (barge-in, theme). Same sections and copy as the old page.

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="set">
      <h3>{title}</h3>
      {hint && <p className="set-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Seg({ name, options, value, onPick }: { name: string; options: [string, string][]; value: unknown; onPick: (v: string) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={"seg-btn" + (v === value ? " on" : "")} onClick={() => onPick(v)}>{label}</button>
      ))}
    </div>
  );
}

const local = {
  get: (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

function setServer(values: Record<string, unknown>) {
  send({ type: "set_settings", values });
  useViews.setState((s) => (s.settings ? { settings: { ...s.settings, values: { ...s.settings.values, ...values } } } : {})); // shown at once
}

export function Settings() {
  const ev = useViews((s) => s.settings);
  const features = useFeatures((s) => s.features);
  const barge = useVoice((s) => s.barge);
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "dark");
  const [vocab, setVocab] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { send({ type: "get_settings" }); }, []);

  if (!ev) return <div className="view-col"><div className="view-head"><h2>Settings</h2></div><p className="side-hint">Loading…</p></div>;
  const v = ev.values as { voice?: string; default_mode?: string; default_model?: string; coder_effort?: string; routines_judge?: boolean; stt?: string; tts?: string };
  const voices: [string, string][] = ev.recommended.map((x) => [x.id, `${x.name} · ${x.desc}${x.grade ? ` · ${x.grade}` : ""}`]);
  if (ev.voices.includes("chatterbox")) voices.push(["chatterbox", "Chatterbox · Polish and English, slow"]);
  if (!voices.length && v.voice) voices.push([v.voice, v.voice]);
  const token = local.get("vd-token", "");
  const link = `http://${ev.host}:${ev.port}/#t=${token}`;

  return (
    <div className="view-col" id="settings-body">
      <div className="view-head"><h2>Settings</h2><span className="mono view-sub">saved on this Mac; browser choices stay in this browser</span></div>

      <Section title="Her voice" hint="Browser uses this browser's own voices and works anywhere; Kokoro runs on this Mac and sounds more natural.">
        <Seg name="Her voice" value={v.tts} onPick={(m) => setServer({ tts: m })}
          options={[["browser", "Browser"], ["kokoro", "Kokoro"]]} />
      </Section>

      {v.tts === "kokoro" && <Section title="Kokoro voice" hint="English. Only the voices Kokoro rates C+ or better are listed, best first; the grade is Kokoro's own.">
        <div className="set-row">
          <select className="set-select" aria-label="Voice" value={v.voice} onChange={(e) => setServer({ voice: e.target.value })}>
            {voices.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          <button type="button" className="chip-btn" onClick={() => { unlockAudio(); send({ type: "voice_sample", voice: v.voice }); }}>Hear it</button>
        </div>
      </Section>}

      <Section title="Talking over her (barge-in)" hint="Auto stops her when you speak only with headphones; on speakers her own voice could interrupt her, so Esc or ■ stops her.">
        <Seg name="Barge-in" value={barge} onPick={(m) => setBarge(m as BargeMode)}
          options={[["auto", "Auto (headphones)"], ["on", "Always"], ["off", "Off"]]} />
      </Section>

      <Section title="Approvals for new folders" hint="Default asks for every tool that needs permission; Auto lets Claude Code decide; Plan only reads and plans. Each folder can still be switched in the top bar.">
        <Seg name="Approvals" value={v.default_mode} onPick={(m) => setServer({ default_mode: m })}
          options={[["default", "Default"], ["auto", "Auto"], ["plan", "Plan"]]} />
      </Section>

      <Section title="Model for new folders" hint={'Haiku is the cheapest: it answers notes and status questions and hands any coding to Opus. Sonnet answers fast and hands hard coding to Opus in the background. Opus answers everything itself and uses your plan fastest. Each folder can still be switched in the top bar, or by saying "switch to Haiku".'}>
        <Seg name="Model" value={v.default_model} onPick={(m) => setServer({ default_model: m })}
          options={[["haiku", "Haiku + Opus for coding"], ["sonnet", "Sonnet + Opus for coding"], ["opus", "Opus"]]} />
      </Section>

      <Section title="Opus effort for coding" hint="How hard the Opus coder thinks when Haiku or Sonnet hands it a task. Medium is plenty for most code and uses far less of your plan than High. Applies to sessions started from now on.">
        <Seg name="Opus effort" value={v.coder_effort} onPick={(m) => setServer({ coder_effort: m })}
          options={[["low", "Low"], ["medium", "Medium"], ["high", "High"]]} />
      </Section>

      {features?.routines && (
        <Section title="Routine results" hint="Haiku reads each new result once and decides if it's worth your time; only those chime, show a badge and a line on Home. Off: every new result notifies. Failures always notify, and each routine can be set to Always or Never on the Routines page.">
          <Seg name="Routine results" value={v.routines_judge === false ? "off" : "on"} onPick={(m) => setServer({ routines_judge: m === "on" })}
            options={[["on", "Only what's worth reading"], ["off", "Every result"]]} />
        </Section>
      )}

      <Section title="Speech recognition" hint="Browser works anywhere; Parakeet hears you in about 0.1 s on this Mac and asks Whisper when a word may be one of your names; Whisper alone takes about 0.5 s.">
        <Seg name="Speech recognition" value={v.stt} onPick={(m) => setServer({ stt: m })}
          options={[["browser", "Browser"], ["parakeet", "Parakeet (fast)"], ["whisper", "Whisper"]]} />
      </Section>

      <Section title="Whisper vocabulary" hint={`Names Whisper should hear correctly. Built in: ${ev.vocab_seed.join(", ")}, plus your repo names. Add your own, one per line.`}>
        <textarea className="set-text" rows={5} aria-label="Vocabulary" placeholder={"Kimai\nHetzner\n…"} value={vocab ?? ev.vocabulary} onChange={(e) => setVocab(e.target.value)} />
        <div className="set-row">
          <button type="button" className="chip-btn" onClick={() => { send({ type: "set_settings", vocabulary: vocab ?? ev.vocabulary }); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
            {saved ? "Saved" : "Save vocabulary"}
          </button>
        </div>
        <details className="set-details"><summary>Prompt sent to Whisper</summary><pre>{ev.whisper_prompt}</pre></details>
      </Section>

      <Section title="Look" hint="Dark or light.">
        <Seg name="Theme" value={theme} onPick={(t) => { setTheme(t); local.set("vd-theme", t); document.documentElement.dataset.theme = t; }}
          options={[["dark", "Dark"], ["light", "Light"]]} />
      </Section>

      <Section title="Notes folder" hint="Your second brain: Home shows its open tasks and recent notes, and the Brain session works in it.">
        <div className="set-row">
          <code className="set-code">{ev.vault || "none yet"}</code>
          <button type="button" className="chip-btn" onClick={() => openSetup(3)}>{ev.vault ? "Change" : "Choose"}</button>
        </div>
      </Section>

      <Section title="Setup" hint="Folders Orb may open, sign-in and speech engines.">
        <button type="button" className="chip-btn" onClick={() => openSetup(2)}>Open setup</button>
      </Section>

      <Section title="Access" hint="The page only listens on this Mac. The link carries its access token; keep it private.">
        <div className="set-row">
          <code className="set-code">{`http://${ev.host}:${ev.port}/#t=••••••${token.slice(-4)}`}</code>
          <button type="button" className="chip-btn" onClick={async () => {
            try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
          }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      </Section>
    </div>
  );
}
