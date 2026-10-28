// Does barge-in "auto" see the current default output as headphones? Real devices, no audio played.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require(execFileSync("npm", ["root", "-g"]).toString().trim() + "/playwright");
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-ui-for-media-stream"] });
const p = await b.newPage();
await p.goto("http://127.0.0.1:8765/static/icons/icon.svg"); // any same-origin page for getUserMedia
const r = await p.evaluate(async () => {
  (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop());
  const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
  const def = outs.find((d) => d.deviceId === "default") || outs[0];
  return { outputs: outs.map((d) => d.label), default: def?.label,
    headphones: !!def && /airpods|headphone|headset|buds|beats|earpods|earphone/i.test(def.label) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
