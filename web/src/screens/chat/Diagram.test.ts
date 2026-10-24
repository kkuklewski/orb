// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hasConfig, scopedSheet, UNSAFE_SHEET } from "./Markdown";

describe("diagram hardening", () => {
  it("accepts CSS scoped to the diagram's own id, and keyframes", () => {
    const css = "#orb-dg-3{font-family:sans-serif} #orb-dg-3 .node rect, #orb-dg-3 .label{fill:red} #orb-dg-3 :root{--x:1} @keyframes dash{to{stroke-dashoffset:0}}";
    expect(scopedSheet(css, "orb-dg-3")).not.toBeNull();
  });

  it("refuses any rule outside the diagram", () => {
    for (const css of ["body{display:none}", "#orb-dg-3 a{color:red} .app{display:none}", "#orb-dg-30 a{color:red}", "#orb-dg-3 a{color:red}, html{color:red}",
      "@media print{#orb-dg-3{color:red}}", ":root{--bg:red}", "#orb-dg-3x{color:red}"]) {
      expect(scopedSheet(css, "orb-dg-3"), css).toBeNull();
    }
  });

  it("refuses init directives and frontmatter, however they are spaced", () => {
    for (const src of ["%%{init: {'themeCSS': 'body{x}'}}%%\nflowchart TD\nA-->B", "flowchart TD\n%%{init: {}}%%\nA-->B",
      "---\nconfig:\n  themeCSS: 'body{x}'\n---\nflowchart TD\nA-->B", "\n  ---\nconfig: {}\n---\nflowchart TD"]) {
      expect(hasConfig(src), src).toBe(true);
    }
    expect(hasConfig("flowchart TD\nA-->B")).toBe(false);
    expect(hasConfig("flowchart TD\nA-- text --- B")).toBe(false);
  });

  it("refuses loads in the diagram sheet but allows its own #fragment references", () => {
    expect(UNSAFE_SHEET.test("#orb-dg-1 .n{stroke:url(#orb-dg-1-gradient)}")).toBe(false);
    for (const bad of ["@import 'x.css'", "a{background:url(https://evil.test/x)}", "a{background:url('//evil.test')}", "a{position:fixed}"])
      expect(UNSAFE_SHEET.test(bad)).toBe(true);
  });
});
