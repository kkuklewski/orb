import { useEffect, type RefObject } from "react";

// Home tiles pack like masonry: the grid has tiny rows and each tile spans as many as its height needs, so a short
// tile never leaves a hole under it and `grid-auto-flow: dense` pulls the next tile up into any free space.
export const ROW = 8;   // px, = grid-auto-rows in home.css
export const GAP = 16;  // px, space under every tile

export const rowSpan = (height: number) => Math.max(1, Math.ceil((height + GAP) / ROW));

export function useMasonry(grid: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = grid.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const place = (t: HTMLElement) => {
      if (!t.classList.contains("usage-warn")) t.style.gridRowEnd = `span ${rowSpan(t.getBoundingClientRect().height)}`;
    };
    const ro = new ResizeObserver((entries) => entries.forEach((e) => place(e.target as HTMLElement)));
    const watch = () => ([...el.children] as HTMLElement[]).forEach((t) => { place(t); ro.observe(t); });
    watch();
    const mo = new MutationObserver(watch);  // tiles come and go as data loads
    mo.observe(el, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [grid]);
}
