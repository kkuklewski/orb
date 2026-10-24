import { clearPins, pinKey, removePin, sendWithPins, setKeep, usePins } from "../stores/pins";
import { currentScreen } from "../stores/screen";
import { useViews } from "../stores/views";

const KIND: Record<string, string> = { task: "task", pr: "PR", routine: "routine", note: "note", repo: "repo" };

/** The pins above the composer: each removable, a keep toggle, and "Ask about these" (the default ask when the box is empty). */
export function PinChips() {
  const { pins, keep } = usePins();
  const onHome = useViews((s) => s.view) === "home";
  if (!pins.length || !onHome) return null;
  return (
    <div className="pin-chips" role="group" aria-label="Pinned items">
      <span className="pin-count mono">{pins.length} pinned</span>
      {pins.map((p) => (
        <span key={pinKey(p)} className="pin-chip" title={p.label}>
          <span className="mono">{KIND[p.kind]}</span> {p.label.slice(0, 28)}
          <button type="button" aria-label={`Remove pin: ${p.label}`} onClick={() => removePin(p)}>✕</button>
        </span>
      ))}
      <label className="pin-keep mono"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> keep</label>
      <button type="button" className="pin-clear mono" onClick={clearPins}>clear</button>
      <button type="button" className="pin-ask mono" onClick={() => sendWithPins("", () => currentScreen("home"))}>Ask about these →</button>
    </div>
  );
}
