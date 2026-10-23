// The voice orb, after Lia Voice Agent (lialive.ai), rebuilt from a frame study of its hero:
// a crisp pink→blue ring, 6 thin noise-displaced loops that morph continuously around it,
// a horizontal waveform through the centre that fades at both ends, faint outer rings.
// State drives the energy: idle (calm), listening (mic level), thinking (slow sweep),
// speaking (playback level), waiting (amber pulse).
"use strict";

class Orb {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = "idle";
    this.energy = 0.25;
    this.source = () => ({ level: 0, wave: null });
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.loops = Array.from({ length: 6 }, (_, i) => ({
      waves: Array.from({ length: 4 }, (_, k) => ({
        k: 2 + k + (i % 2), phase: Math.random() * 6.28, speed: (0.25 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
        w: 1 / (k + 1.4),
      })),
      alpha: 0.28 + Math.random() * 0.3,
    }));
    this.t0 = performance.now();
    this.refreshPalette();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = (now) => { this.draw(now); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.dpr = dpr;
  }

  setState(s) { this.state = s; }

  // Colours come from CSS (--orb-1/2/3, --orb-glow, --orb-core[-light]) as "r, g, b", so a skin
  // can recolour the orb; call refreshPalette() after a skin or theme change.
  refreshPalette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    this.pal = {
      ring: [v("--orb-1", "224, 64, 251"), v("--orb-2", "139, 92, 246"), v("--orb-3", "79, 139, 255")],
      glow: v("--orb-glow", "139, 92, 246"), core: v("--orb-core", "255, 255, 255"), coreLight: v("--orb-core-light", "76, 29, 149"),
    };
  }

  gradient(ctx, cx, R, alpha) {
    const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
    const [a, b, c] = this.pal.ring;
    g.addColorStop(0, `rgba(${a}, ${alpha})`);
    g.addColorStop(0.5, `rgba(${b}, ${alpha})`);
    g.addColorStop(1, `rgba(${c}, ${alpha})`);
    return g;
  }

  draw(now) {
    const { ctx, canvas, dpr } = this;
    const w = canvas.width, h = canvas.height;
    if (!w || !h || canvas.offsetParent === null) return;
    const t = (now - this.t0) / 1000;
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * 0.27;
    const big = R / dpr > 60;
    const light = document.documentElement.dataset.theme === "light";
    const { level, wave } = this.source();
    const lv = Math.min(1, level * 6);

    const target = { idle: 0.22, listening: 0.32 + lv * 1.1, hearing: 0.45 + lv * 1.2, thinking: 0.5,
      working: 0.45, transcribing: 0.5, speaking: 0.35 + lv * 1.2, waiting: 0.3 }[this.state] ?? 0.22;
    this.energy += (target - this.energy) * 0.12;
    const e = this.reduced ? Math.min(this.energy, 0.3) : this.energy;
    const spin = this.state === "thinking" || this.state === "working" || this.state === "transcribing" ? 1.8 : 1;

    ctx.clearRect(0, 0, w, h);

    // Faint outer rings (only when the orb is big).
    if (big) {
      ctx.lineWidth = dpr;
      ctx.strokeStyle = light ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.05)";
      for (const f of [1.32, 1.62]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); }
    }

    // Glow behind the ring.
    const glow = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.5);
    const ga = (light ? 0.10 : 0.18) * (0.6 + e);
    glow.addColorStop(0, `rgba(${this.pal.glow}, ${ga})`);
    glow.addColorStop(1, `rgba(${this.pal.glow}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Morphing loops.
    const amp = 0.035 + 0.13 * e;
    ctx.lineWidth = Math.max(1, dpr * (big ? 1.1 : 0.9));
    for (const l of this.loops) {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const th = (i / 120) * Math.PI * 2;
        let d = 0;
        for (const wv of l.waves) d += Math.sin(wv.k * th + wv.phase + t * wv.speed * spin) * wv.w;
        const r = R * (1 + amp * d);
        const x = cx + r * Math.cos(th), y = cy + r * Math.sin(th);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = this.gradient(ctx, cx, R * 1.2, l.alpha * (light ? 1.1 : 1));
      ctx.stroke();
    }

    // The crisp ring.
    ctx.save();
    ctx.lineWidth = dpr * (big ? 2.4 : 1.8);
    ctx.shadowColor = this.state === "waiting" ? "rgba(251,191,36,.9)" : `rgba(${this.pal.glow}, .9)`;
    ctx.shadowBlur = (big ? 18 : 8) * dpr * (0.6 + e);
    ctx.strokeStyle = this.state === "waiting" ? `rgba(251,191,36,${0.6 + 0.3 * Math.sin(t * 4)})` : this.gradient(ctx, cx, R, 0.95);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // Thinking: a bright arc sweeping round the ring.
    if (spin > 1 && !this.reduced) {
      const a = t * 2.4;
      ctx.save();
      ctx.lineWidth = dpr * (big ? 3 : 2.2);
      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(${light ? this.pal.coreLight : this.pal.core}, .85)`;
      ctx.shadowColor = `rgba(${this.pal.ring[0]}, .9)`; ctx.shadowBlur = 12 * dpr;
      ctx.beginPath(); ctx.arc(cx, cy, R, a, a + 0.7); ctx.stroke();
      ctx.restore();
    }

    // Horizontal waveform through the centre, fading at the ends.
    const span = R * (big ? 1.55 : 1.25);
    const n = 160;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = cx - span + u * span * 2;
      const win = Math.sin(Math.PI * u) ** 2;
      let s;
      if (wave && wave.length) s = wave[Math.floor(u * (wave.length - 1))] * 3.2;
      else s = Math.sin(u * 38 + t * 5) * 0.35 + Math.sin(u * 13 - t * 3.1) * 0.4 + Math.sin(u * 71 + t * 9) * 0.15;
      const y = cy + s * win * R * (0.05 + 0.32 * e);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const lg = ctx.createLinearGradient(cx - span, 0, cx + span, 0);
    const [w0, , w2] = this.pal.ring;
    lg.addColorStop(0, `rgba(${w0}, 0)`);
    lg.addColorStop(0.25, `rgba(${w0}, .9)`);
    lg.addColorStop(0.5, `rgba(${light ? this.pal.coreLight : this.pal.core}, .95)`);
    lg.addColorStop(0.75, `rgba(${w2}, .9)`);
    lg.addColorStop(1, `rgba(${w2}, 0)`);
    ctx.strokeStyle = lg;
    ctx.lineWidth = dpr * (big ? 1.6 : 1.2);
    ctx.stroke();
  }
}
window.Orb = Orb;
