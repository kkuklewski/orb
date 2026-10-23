// Routines panel at desktop and phone width. Usage: node screens.mjs <port> <state-dir> <outdir>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright");
const [port, state, out] = process.argv.slice(2);
const token = readFileSync(`${state}/token`, "utf8").trim();
const b = await chromium.launch({ channel: "chrome" });
for (const [name, w, h, mobile] of [["desktop", 1440, 900, false], ["phone", 390, 844, true]]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile });
    const p = await ctx.newPage();
    await p.addInitScript((t) => localStorage.setItem("vd-theme", t), theme);
    await p.goto(`http://127.0.0.1:${port}/#t=${token}`);
    await p.waitForTimeout(1200);
    if (mobile) await p.evaluate(() => document.querySelector("#app").classList.add("side-open"));
    await p.screenshot({ path: `${out}/${name}-${theme}-side.png` });
    await p.evaluate(() => document.querySelector("#nav-routines").click());
    await p.waitForTimeout(800);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await p.screenshot({ path: `${out}/${name}-${theme}.png` });
    console.log(name, theme, "overflow:", overflow);
    await ctx.close();
  }
}
await b.close();
