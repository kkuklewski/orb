// The setup assistant: full screen, a ruled step rail, one step at a time, a step meter.
// Opens by itself when Orb isn't set up; Escape closes it only once it is.
import { useEffect, useRef } from "react";
import { send } from "../../ws";
import { useFeatures } from "../../stores/features";
import { LAST_RULE, LAST_STEP, canAdvance, stepDone, useSetup } from "../../stores/setup";
import { Control, Folders, Notes, SignIn, Voice, Welcome } from "./steps";

const RAIL = ["Sign in", "Folders", "Brain", "Voice", "Control"];
export const NOTES_STEP = 3;

export function goTo(step: number, rule = 0) {
  useSetup.setState({ step: Math.max(0, Math.min(LAST_STEP, step)), rule, sample: null, browsing: false });
}

/** Back one screen: Control's rules first, then the steps. */
export function back() {
  const { step, rule } = useSetup.getState();
  if (step === LAST_STEP && rule > 0) useSetup.setState({ rule: rule - 1 });
  else goTo(step - 1);
}

export function closeSetup() {
  useSetup.setState({ open: false, browsing: false, pickFor: "roots" });
}

export function next() {
  const { step, rule } = useSetup.getState();
  if (step === LAST_STEP && rule < LAST_RULE) return useSetup.setState({ rule: rule + 1 });
  if (step < LAST_STEP) return goTo(step + 1);
  if (useFeatures.getState().features?.onboarded) return closeSetup(); // reopened from Settings
  send({ type: "set_settings", values: { onboarded: true } }); // the server answers with "features"
}

export function Setup() {
  const { step, rule, status, toast } = useSetup();
  const onboarded = useFeatures((s) => !!s.features?.onboarded);
  const card = useRef<HTMLElement>(null);

  useEffect(() => { send({ type: "setup_status" }); }, []);

  // Move focus to the step's main action when the step changes (keyboard and screen readers).
  useEffect(() => {
    const el = card.current?.querySelector<HTMLElement>(".onb-btn.primary:not(:disabled), input, .onb-btn:not(.ghost)");
    el?.focus();
  }, [step, rule]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "Escape" && onboarded) { e.preventDefault(); closeSetup(); }
      else if (e.key === "Enter" && !target.closest("input, textarea, button") && canAdvance(useSetup.getState().step, useSetup.getState().rule, useSetup.getState().status)) {
        e.preventDefault(); next();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onboarded]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useSetup.setState({ toast: null }), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const plan = status?.auth.subscription;
  const Step = [Welcome, SignIn, Folders, Notes, Voice, Control][step];
  return (
    <div className="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <header className="onb-top">
        <span className="onb-brand">Orb</span>
        <span className="mono onb-plan">{plan ? `CLAUDE · ${plan.toUpperCase()}` : ""}</span>
        {onboarded && <button className="onb-close" type="button" aria-label="Close setup" onClick={closeSetup}>×</button>}
      </header>
      <nav className="onb-rail" aria-label="Setup steps">
        {RAIL.map((name, i) => {
          const n = i + 1;
          const cls = "onb-rail-item" + (n === step ? " on" : "") + (stepDone(n, step, status) ? " done" : "");
          return (
            <button key={name} className={cls} aria-current={n === step ? "step" : undefined} onClick={() => goTo(n)}>
              <span className="mono onb-rail-n">{String(n).padStart(2, "0")}</span><span>{name}</span>
            </button>
          );
        })}
      </nav>
      <section className="onb-card enter" key={step} ref={card} aria-live="polite">
        <Step />
      </section>
      {toast && <div className={"onb-toast" + (toast.level === "error" ? " error" : "")} role="status">{toast.text}</div>}
      <footer className="onb-meter mono" aria-hidden="true">
        <span>{step ? `STEP ${String(step).padStart(2, "0")} / ${String(LAST_STEP).padStart(2, "0")}` : "WELCOME"}</span>
        <span className="onb-bar"><i style={{ width: `${(step / LAST_STEP) * 100}%` }} /></span>
      </footer>
    </div>
  );
}
