// Drives spikes/echo/index.html in real Chrome with the real mic and speakers.
// Run (from this folder, with a static server on :8799):
//   python3 -m http.server 8799 --bind 127.0.0.1 &  node run.mjs
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { chromium } = require(execSync("npm root -g").toString().trim() + "/playwright");

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
});
const results = {};
for (const ec of ["1", "0"]) {
  const page = await browser.newPage();
  page.on("console", (m) => process.stderr.write(`[ec=${ec}] ${m.text()}\n`));
  await page.goto(`http://127.0.0.1:8799/index.html?ec=${ec}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 90_000, polling: 500 });
  results[ec === "1" ? "echoCancellationOn" : "echoCancellationOff"] = await page.evaluate(() => window.__result);
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));
