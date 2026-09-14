// Render a chord/lyric chart (app/) as a 600x600 (@2x) HUD overlay for compositing onto
// real glasses POV footage — same idea as render-overlay.js, but for the guitar+singer view.
// Drives the live app deterministically via window.ScoreCapture (app/js/app.js).
//
//   node render-overlay-chart.js <songId> <transpose> <fps> <outDir> <serverPort> [capo]
//   e.g. node render-overlay-chart.js sample-cant-help -3 30 ../build/overlay/ch_A 8765
//   Prefix the id with "score:" for a notation song (transpose/capo ignored):
//        node render-overlay-chart.js score:sample-planet 0 30 ../build/overlay/planet 8765
//
// Frames are written with a transparent background (black = transparent on the glasses
// anyway). Encode with ffmpeg — see encode notes at the bottom.

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , songId, trArg, fpsArg, outDir, portArg, capoArg] = process.argv;
if (!songId || !outDir) { console.error("usage: render-overlay-chart.js <songId> <transpose> <fps> <outDir> <port> [capo]"); process.exit(1); }
const isScore = songId.startsWith("score:");
const id = isScore ? songId.slice(6) : songId;
const transpose = +trArg || 0, capo = +capoArg || 0;
const fps = +fpsArg || 30;
const port = +portArg || 8765;
const maxSec = +process.env.MAX_SECONDS || 0;   // 0 = full song
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=2", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
const q = isScore ? `score=${encodeURIComponent(id)}` : `chart=${encodeURIComponent(id)}&transpose=${transpose}&capo=${capo}`;
const screen = isScore ? "#player.active" : "#chart.active";
await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: "networkidle0" });
await page.waitForFunction(`document.querySelector('${screen}') && window.ScoreCapture && window.ScoreCapture.info().lastBeat>0`, { timeout: 15000 });
await page.evaluate(() => window.ScoreCapture.transparent());
await new Promise(r => setTimeout(r, 300));

const info = await page.evaluate(() => window.ScoreCapture.info());
const startBeat = info.firstBeat - info.countIn;
const endBeat = info.lastBeat + 1;
const bps = info.bpm / 60;
let dur = (endBeat - startBeat) / bps;
if (maxSec) dur = Math.min(dur, maxSec);
const nFrames = Math.ceil(dur * fps);
console.log(`${songId} tr${transpose} capo${capo}: ${info.bpm}bpm, ${info.beatsPerBar}/bar, beats ${startBeat}..${endBeat}, ${dur.toFixed(1)}s -> ${nFrames} frames @${fps}fps`);

for (let f = 0; f < nFrames; f++) {
  const beat = startBeat + (f / fps) * bps;
  await page.evaluate((b, fps) => window.ScoreCapture.seek(b, fps), beat, fps);
  await page.screenshot({
    path: path.join(outDir, "f" + String(f).padStart(5, "0") + ".png"),
    omitBackground: true,
    optimizeForSpeed: true,
  });
  if (f % 120 === 0) process.stdout.write(`  ${f}/${nFrames}\r`);
}
console.log(`\nwrote ${nFrames} frames to ${outDir}`);
await browser.close();

// Encode (ffmpeg from imageio-ffmpeg or any build):
//  ProRes 4444 w/ alpha: ffmpeg -framerate 30 -i f%05d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le out_alpha.mov
//  VP9 webm w/ alpha:    ffmpeg -framerate 30 -i f%05d.png -c:v libvpx-vp9 -pix_fmt yuva420p -crf 30 -b:v 0 out_alpha.webm
//  H.264 on black (Screen/Add blend): ffmpeg -framerate 30 -i f%05d.png -filter_complex "color=black:1200x1200:r=30[bg];[bg][0:v]overlay=shortest=1,format=yuv420p" -c:v libx264 -crf 18 out_screen.mp4
