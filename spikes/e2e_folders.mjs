// Folder switching, background sessions and several sessions per folder, in real Chrome.
// Usage: node e2e_folders.mjs <home folder> <scratch folder>
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright");
const [home, scratch] = process.argv.slice(2);
const token = readFileSync(join(process.env.ORB_STATE || join(homedir(), ".orb"), "token"), "utf8").trim();
const b = await chromium.launch({ channel: "chrome", args: ["--autoplay-policy=no-user-gesture-required"] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.addInitScript((f) => {
  localStorage.setItem("vd-folder", f); localStorage.removeItem("vd-session");
  window.__notices = [];
  const Orig = WebSocket;
  window.WebSocket = function (...a) { const ws = new Orig(...a); ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.type === "bg_notice") __notices.push(`${m.text} (audio: ${!!m.data})`); }); return ws; };
  window.WebSocket.prototype = Orig.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3 });
}, home);
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(5), ...a);
const header = () => p.textContent("#where-name");
const folderStatus = (path) => p.evaluate((x) => S.folders.find((f) => f.path === x)?.status, path);
const waitIdle = () => p.waitForFunction(() => !S.busy && S.serverState !== "waiting", null, { timeout: 120000 });

await p.goto(`http://127.0.0.1:8765/#t=${token}`);
await p.waitForFunction((f) => typeof S !== "undefined" && S.folder === f, home);
// Pin both folders so they show under Projects (the sidebar lists only pinned folders).
await p.evaluate(([a, b]) => { send({ type: "pin_folder", path: a, pinned: true }); send({ type: "pin_folder", path: b, pinned: true }); }, [home, scratch]);
await p.waitForFunction((f) => S.folders.some((x) => x.path === f && x.pinned), scratch, { timeout: 10000 });
log("opened home:", await header());

// 1. Add the scratch folder by path, ask where it works.
await p.click("#nav-new"); await p.fill("#add-path", scratch); await p.press("#add-path", "Enter");
await p.waitForFunction((f) => S.folder === f, scratch);
log("switched by path box:", await header(), "| session", await p.evaluate(() => S.session.slice(0, 8)));
await p.fill("#input", "Which directory are you working in? One sentence, no tools."); await p.press("#input", "Enter");
await p.waitForFunction(() => S.busy, null, { timeout: 20000 }).catch(() => {}); await waitIdle();
log("answer:", (await p.evaluate(() => [...document.querySelectorAll(".answer")].pop()?.innerText || "")).replace(/\s+/g, " ").slice(0, 200));

// 2. Switch to home by clicking its sidebar row: header + history must change.
await p.click(`.project[data-path="${home}"]`);
await p.waitForFunction((f) => S.folder === f, home, { timeout: 10000 });
log("clicked home row:", await header(), "| chat items:", await p.evaluate(() => column.children.length));

// 3. Background: start a turn in scratch that needs approval, switch away before the card.
await p.click(`.project[data-path="${scratch}"]`); await p.waitForFunction((f) => S.folder === f, scratch);
await p.fill("#input", "Use the Write tool to create bg.txt containing ok, then confirm in one sentence."); await p.press("#input", "Enter");
await p.click(`.project[data-path="${home}"]`); await p.waitForFunction((f) => S.folder === f, home);
log("switched away while scratch works; status:", await folderStatus(scratch));
await p.waitForFunction((f) => S.folders.find((x) => x.path === f)?.status === "approval", scratch, { timeout: 90000 });
log("scratch status:", await folderStatus(scratch), "| notices:", await p.evaluate(() => __notices));
// Answer it by switching there and clicking Allow.
await p.click(`.project[data-path="${scratch}"]`); await p.waitForFunction((f) => S.folder === f, scratch);
await p.waitForSelector(".perm:not(.done) button.allow"); await p.click(".perm:not(.done) button.allow");
log("allowed in scratch; switching away again");
await p.click(`.project[data-path="${home}"]`); await p.waitForFunction((f) => S.folder === f, home);
await p.waitForFunction((f) => S.folders.find((x) => x.path === f)?.status === "done", scratch, { timeout: 90000 });
log("scratch status:", await folderStatus(scratch), "| notices:", await p.evaluate(() => __notices));
await p.click(`.project[data-path="${scratch}"]`); await p.waitForFunction((f) => S.folder === f, scratch);
await p.waitForTimeout(500);
log("viewed scratch; status now:", await folderStatus(scratch), "| last answer:",
  (await p.evaluate(() => [...document.querySelectorAll(".answer")].pop()?.innerText || "")).replace(/\s+/g, " ").slice(0, 160));

// 4. Several sessions per folder.
await p.click(".proj-actions .session.new"); await p.waitForFunction(() => column.children.length === 0, null, { timeout: 10000 });
await p.fill("#input", "Say hello in three words, no tools."); await p.press("#input", "Enter");
await p.waitForFunction(() => S.busy, null, { timeout: 20000 }).catch(() => {}); await waitIdle();
const sessions = await p.evaluate((f) => S.folders.find((x) => x.path === f).sessions.map((x) => `${x.label} [${x.status}]`), scratch);
log("sessions in scratch:", JSON.stringify(sessions));
await p.click("#projects .session:not(.active):not(.new)"); await p.waitForTimeout(800);
log("reopened older session; chat items:", await p.evaluate(() => column.children.length));
await p.screenshot({ path: join(tmpdir(), "orb-sessions.png") });
await p.evaluate(([a, b]) => { send({ type: "pin_folder", path: a, pinned: false }); send({ type: "pin_folder", path: b, pinned: false }); }, [home, scratch]);
await p.waitForTimeout(500);
console.log("page errors:", errors.length ? errors : "none");
await b.close();

// Unpin again: test folders shouldn't stay in the sidebar.
