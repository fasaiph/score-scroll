// Render the HUD (scrolling score) as a sequence of 600x600 frames for compositing
// onto real glasses POV footage. Drives the live app deterministically via the
// window.ScoreCapture API in web/index.html.
//
//   node render-overlay.js <songIndex> <mode: alpha|black> <fps> <outDir> <serverPort>

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , idxArg, mode, fpsArg, outDir, portArg] = process.argv;
const idx = +idxArg || 0;
const fps = +fpsArg || 30;
const port = +portArg || 8930;
fs.mkdirSync(outDir, { recursive: true });

const SONG_IDS = ["losingu", "tokyo"];
const sid = SONG_IDS[idx];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=2", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${port}/?song=${idx}`, { waitUntil: "networkidle0" });
// wait for schedule + strip image to be ready
await page.waitForFunction("window.ScoreCapture && window.ScoreCapture.info().lastBeat>0", { timeout: 8000 });

if (mode === "alpha") {
  await page.evaluate((s) => window.ScoreCapture.useAlphaStrip("assets/" + s + "_alpha.png"), sid);
  await new Promise(r => setTimeout(r, 400)); // let the transparent strip load
}

const info = await page.evaluate(() => window.ScoreCapture.info());
const startBeat = info.firstBeat - info.countIn;
const endBeat = info.lastBeat + 1;
const bps = info.bpm / 60;
const dur = (endBeat - startBeat) / bps;
const nFrames = Math.ceil(dur * fps);
console.log(`${sid} ${mode}: ${info.bpm}bpm, beats ${startBeat}..${endBeat}, ${dur.toFixed(1)}s -> ${nFrames} frames @${fps}fps`);

for (let f = 0; f < nFrames; f++) {
  const beat = startBeat + (f / fps) * bps;
  await page.evaluate((b) => window.ScoreCapture.seek(b), beat);
  await page.screenshot({
    path: path.join(outDir, "f" + String(f).padStart(5, "0") + ".png"),
    omitBackground: mode === "alpha",
    optimizeForSpeed: true,
  });
  if (f % 120 === 0) process.stdout.write(`  ${f}/${nFrames}\r`);
}
console.log(`\n${sid} ${mode}: wrote ${nFrames} frames to ${outDir}`);
await browser.close();
