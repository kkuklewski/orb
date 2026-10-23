// Voice in + barge-in, end to end without a human: Chrome's fake capture device plays mic.wav
// into the page as if it were the microphone (q1, 16 s of silence, q2 while she is answering).
// Needs the server on :8765 (or ORB_PORT / ORB_STATE for a test instance).
// Usage: node run.mjs [--next] <folder> [mic.wav] [listen ms]
//   --next drives the React page at /next through its DOM only (the pill, data-state, New session).
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(join(execFileSync("npm", ["root", "-g"]).toString().trim(), "playwright"));
const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const next = args[0] === "--next";
if (next) args.shift();
const folder = args[0];
const micFile = args[1] || "mic.wav";
const listenMs = Number(args[2] || 62000);
const port = process.env.ORB_PORT || "8765";
const token = readFileSync(join(process.env.ORB_STATE || join(homedir(), ".orb"), "token"), "utf8").trim();

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${resolve(here, micFile)}%noloop`, "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(/#.*/, "")}`); });
await page.addInitScript(([f]) => {
  localStorage.setItem("vd-folder", f);
  localStorage.setItem("vd-barge", "on");
  window.__log = [];
  const t0 = performance.now();
  const log = (dir, type, extra) => window.__log.push({ t: +((performance.now() - t0) / 1000).toFixed(2), dir, type, ...extra });
  window.__mark = log;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    const m = JSON.parse(d);
    log("out", m.type, m.type === "utterance" ? { bytes: m.wav.length } : m.type === "user_text" ? { text: m.text } : {});
    return send.call(this, d);
  };
  const Orig = WebSocket;
  window.WebSocket = function (...a) {
    const ws = new Orig(...a);
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (["user", "audio", "speech_reset", "result", "heard_nothing", "error", "partial", "permission", "permission_done", "held", "timing"].includes(m.type))
        log("in", m.type, { text: m.text || m.heard || m.tool || (m.hops && JSON.stringify(m.hops)), gen: m.gen ?? (m.allow === undefined ? undefined : (m.allow ? "ALLOW" : "DENY")), subtype: m.subtype });
    });
    return ws;
  };
  window.WebSocket.prototype = Orig.prototype;
  Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3 });
}, [folder]);

if (next) {
  await page.goto(`http://127.0.0.1:${port}/next#t=${token}`);
  // vd-folder makes the page reopen the folder; then a fresh session like the old path.
  await page.waitForSelector(".top .new-session", { timeout: 20000 });
  await page.click(".top .new-session");
  await page.waitForTimeout(1500);
  await page.evaluate(() => { let was = false; setInterval(() => { const p = !!document.querySelector('.orb[data-state="speaking"]'); if (p !== was) { was = p; __mark("page", p ? "playback_start" : "playback_stop"); } }, 50); });
  await page.click("button.orb");
  try { await page.waitForSelector('button.orb[aria-pressed="true"]', { timeout: 20000 }); }
  catch (e) {
    console.log("mic did not start. errors:", errors, await page.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent)), await page.textContent(".dock-state"));
    await browser.close(); process.exit(1);
  }
} else {
  await page.goto(`http://127.0.0.1:${port}/#t=${token}`);
  await page.waitForFunction(() => typeof S !== "undefined" && S.ws?.readyState === 1, null, { timeout: 15000 });
  await page.evaluate((f) => openFolder(f), folder);
  await page.waitForFunction((f) => S.folder === f, folder, { timeout: 15000 });
  await page.evaluate(() => send({ type: "new_session" }));
  await page.waitForTimeout(1500);
  // Poll playback so the log shows whether she was speaking when q2 arrived.
  await page.evaluate(() => { let was = false; setInterval(() => { const p = Player.playing; if (p !== was) { was = p; __mark("page", p ? "playback_start" : "playback_stop"); } }, 50); });
  await page.click("#orb"); // the gesture: starts the mic (and the fake capture file)
  try { await page.waitForFunction(() => S.micOn, null, { timeout: 20000 }); }
  catch (e) {
    console.log("mic did not start. errors:", errors, await page.evaluate(() => [...document.querySelectorAll(".notice")].map((n) => n.textContent)), await page.textContent("#state-label"));
    await browser.close(); process.exit(1);
  }
}
await page.evaluate(() => __mark("page", "mic_on"));
await page.waitForTimeout(listenMs);
const out = await page.evaluate(() => ({ log: window.__log,
  chat: [...document.querySelectorAll(".msg-user .bubble, .answer .md")].map((e) => e.textContent.trim().slice(0, 160)) }));
await browser.close();
for (const l of out.log) console.log(String(l.t).padStart(6), l.dir.padEnd(4), l.type, l.text ? JSON.stringify(l.text) : "", l.gen ?? "", l.subtype ?? "", l.bytes ?? "");
console.log("\nchat:"); out.chat.forEach((c) => console.log(" -", c));
console.log("\npage errors:", errors.length ? errors : "none");
