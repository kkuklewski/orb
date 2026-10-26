import { useState } from "react";

/** A right-hand panel's width, dragged by a grip on its left edge and kept in localStorage under `key`; double-click resets. */
export function useDragWidth(key: string, min = 360) {
  const [w, setW] = useState<number | null>(() => { try { return Number(localStorage.getItem(key)) || null; } catch { return null; } });
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const right = e.currentTarget.parentElement!.getBoundingClientRect().right;
    const max = Math.max(min + 60, window.innerWidth - 360);
    let last = 0;
    const move = (m: PointerEvent) => { last = Math.round(Math.min(max, Math.max(min, right - m.clientX))); setW(last); };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); if (last) try { localStorage.setItem(key, String(last)); } catch { /* no storage */ } };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  return { w, drag, reset: () => { setW(null); try { localStorage.removeItem(key); } catch { /* no storage */ } } };
}
