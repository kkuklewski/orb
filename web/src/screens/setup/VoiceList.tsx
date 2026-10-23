// Kokoro's recommended voices (best first, with Kokoro's own grade). Picking one saves it and plays a
// sample; the row shows Loading…, Playing or Failed. A muted page says so instead of staying silent.
import { useEffect } from "react";
import type { Voice } from "../../protocol.gen";
import { send } from "../../ws";
import { useSetup } from "../../stores/setup";
import { unlockAudio } from "../../audio/sample";

const LABEL = { loading: "Loading…", playing: "Playing", error: "Failed" } as const;

export function pickVoice(id: string, muted = false) {
  unlockAudio();
  if (!muted) send({ type: "voice_sample", voice: id }); // first, so the sample never waits behind the save
  send({ type: "set_settings", values: { voice: id } });
  useSetup.setState((s) => ({
    status: s.status ? { ...s.status, values: { ...s.status.values, voice: id } } : s.status, // shown at once
    sample: muted ? { voice: id, state: "error", text: "Speech is muted: turn the speaker back on to hear her." } : { voice: id, state: "loading" },
  }));
}

export function VoiceList({ voices, current }: { voices: Voice[]; current?: string }) {
  const sample = useSetup((s) => s.sample);

  useEffect(() => { // no answer from Kokoro in 15 s: say so on the row
    if (sample?.state !== "loading") return;
    const voice = sample.voice;
    const t = setTimeout(() => useSetup.setState((s) => s.sample?.voice === voice && s.sample.state === "loading"
      ? { sample: { voice, state: "error", text: "No answer from Kokoro in 15 s. Is it running?" } } : {}), 15000);
    return () => clearTimeout(t);
  }, [sample]);

  return (
    <div className="onb-voices" role="radiogroup" aria-label="Her voice">
      {voices.map((v) => {
        const st = sample?.voice === v.id ? sample : null;
        return (
          <button key={v.id} type="button" role="radio" aria-checked={v.id === current} title={st?.state === "error" ? st.text : undefined}
            className={"onb-voice" + (v.id === current ? " on" : "") + (st ? ` ${st.state}` : "")} onClick={() => pickVoice(v.id)}>
            <span className="onb-voice-dot" />
            <span className="onb-voice-txt"><strong>{v.name}</strong><span>{v.desc}</span></span>
            <span className="mono onb-voice-grade">{st ? LABEL[st.state] : v.grade ?? ""}</span>
          </button>
        );
      })}
    </div>
  );
}
