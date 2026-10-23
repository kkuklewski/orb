// Screenshots of the page at desktop / iPad / phone widths in both themes. Usage: node screens.mjs <folder> <outdir>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const require = createRequire(import.meta.url);
const { chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright");
const [folder, out] = process.argv.slice(2);
const token = readFileSync((process.env.ORB_STATE || homedir() + "/.orb") + "/token", "utf8").trim();
const b = await chromium.launch({ channel: "chrome" });
for (const [name, w, h, mobile] of [["desktop", 1440, 900, false], ["ipad", 820, 1180, true], ["phone", 390, 844, true]]) {
  for (const theme of ["dark", "light"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    const p = await ctx.newPage();
    await p.addInitScript(([f, t]) => { localStorage.setItem("vd-folder", f); localStorage.setItem("vd-theme", t); }, [folder, theme]);
    await p.goto(`http://127.0.0.1:8765/#t=${token}`);
    await p.waitForSelector(".answer .md", { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    await p.screenshot({ path: `${out}/${name}-${theme}.png` });
    console.log(name, theme, "horizontal overflow:", overflow);
    await ctx.close();
  }
}
await b.close();
