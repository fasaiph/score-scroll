// Offline score renderer for the Meta Ray-Ban Display scroller.
// Renders a MusicXML violin part as ONE long horizontal staff, inverts it to
// luminous-on-black, rasterizes to a PNG strip, and extracts a (beat -> x-pixel)
// schedule so the scroll can put each note under the playhead exactly on its beat.
//
// Usage: node render.js <input.musicxml> <outBasename> <bpm>

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Override with CHROME_PATH env var on non-mac / custom installs.
const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const [, , inPath, outBase, bpmArg] = process.argv;
if (!inPath || !outBase) {
  console.error("usage: node render.js <input.musicxml> <outBasename> <bpm>");
  process.exit(1);
}
const bpm = Number(bpmArg) || 120;
const xml = fs.readFileSync(inPath, "utf8");
const osmdJs = fs.readFileSync(
  path.join(__dirname, "node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js"),
  "utf8"
);
const assetsDir = path.join(__dirname, "..", "web", "assets");
fs.mkdirSync(assetsDir, { recursive: true });

const ZOOM = 1.2;          // OSMD zoom -> bigger noteheads for the small display

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=2", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 600, deviceScaleFactor: 2 });

await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:#fff;}
  #wrap{display:inline-block;background:#fff;padding:14px 24px;}
  #osmd{background:#fff;}
</style></head>
<body><div id="wrap"><div id="osmd"></div></div></body></html>`);

await page.addScriptTag({ content: osmdJs });

const result = await page.evaluate(async (xmlStr, zoom) => {
  const div = document.getElementById("osmd");
  const osmd = new window.opensheetmusicdisplay.OpenSheetMusicDisplay(div, {
    autoResize: false,
    backend: "svg",
    drawTitle: false,
    drawSubtitle: false,
    drawComposer: false,
    drawCredits: false,
    drawPartNames: false,
    drawMeasureNumbers: false,
    renderSingleHorizontalStaffline: true,
  });
  osmd.zoom = zoom;
  await osmd.load(xmlStr);
  osmd.render();

  // --- walk the cursor to get (timestamp-in-whole-notes -> pixel x) ---
  const wrap = document.getElementById("wrap");
  const wrapRect = wrap.getBoundingClientRect();
  const pts = [];
  const cur = osmd.cursor;
  cur.reset();
  cur.show();
  let guard = 0;
  const it = cur.iterator;
  while (!it.EndReached && guard < 5000) {
    guard++;
    const ts = it.CurrentSourceTimestamp
      ? it.CurrentSourceTimestamp.RealValue
      : (it.currentTimeStamp ? it.currentTimeStamp.RealValue : null);
    const el = cur.cursorElement;
    let x = null;
    if (el) {
      const r = el.getBoundingClientRect();
      x = (r.left + r.width / 2) - wrapRect.left;
    }
    // is this position a rest (no real notes)?
    let isRest = true;
    try {
      const ves = it.CurrentVoiceEntries || it.currentVoiceEntries;
      if (ves && ves.length) {
        for (const ve of ves) {
          const notes = ve.Notes || ve.notes;
          if (notes) for (const n of notes) { if (!(n.isRest && n.isRest())) isRest = false; }
        }
      }
    } catch (e) {}
    if (ts != null && x != null) pts.push({ ts, x, isRest });
    cur.next();
  }
  cur.hide();

  const wrapRect2 = wrap.getBoundingClientRect();
  return {
    pts,
    width: Math.ceil(wrap.scrollWidth),
    height: Math.ceil(wrap.scrollHeight),
    boxW: Math.ceil(wrapRect2.width),
    boxH: Math.ceil(wrapRect2.height),
  };
}, xml, ZOOM);

console.log(`onsets captured: ${result.pts.length}  strip box: ${result.boxW}x${result.boxH}`);
if (result.pts.length) {
  console.log("first 4:", JSON.stringify(result.pts.slice(0, 4)));
  console.log("last 2:", JSON.stringify(result.pts.slice(-2)));
}

// --- screenshot the strip, inverted to white-on-black ---
await page.evaluate(() => {
  const w = document.getElementById("wrap");
  w.style.filter = "invert(1)";          // white bg -> black, black ink -> white
  document.body.style.background = "#000";
});
const wrapHandle = await page.$("#wrap");
const pngPath = path.join(assetsDir, `${outBase}.png`);
await wrapHandle.screenshot({ path: pngPath });
console.log("wrote", pngPath);

// --- build the schedule JSON ---
// timestamp RealValue is in whole notes; beats(4/4) = RealValue * 4.
const BEATS_PER_WHOLE = 4;
const points = result.pts.map((p) => ({
  beat: +(p.ts * BEATS_PER_WHOLE).toFixed(5),
  x: Math.round(p.x),
  rest: !!p.isRest,
}));
const schedule = {
  name: outBase,
  bpm,
  beatsPerBar: 4,
  widthPx: result.boxW,
  heightPx: result.boxH,
  points,            // [{beat, x, rest}] note onsets, ascending
};
const jsonPath = path.join(assetsDir, `${outBase}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(schedule));
console.log("wrote", jsonPath, `(${points.length} points, lastBeat=${points.length ? points[points.length-1].beat : 0})`);

await browser.close();
