// Interaction-storyboard overlay for a notation song (Planet in the Sky):
//   static paused score → tap play (4-3-2-1 count-in) → scroll 1 s → tap pause
//   → swipe → three times (skip 3 bars, discrete jumps) → tap play (count-in
//   from that bar) → play through to the end.
// Gesture cue pills are injected here so the app stays untouched.
//
//   node render-overlay-story.js <songId> <fps> <outDir> <serverPort>
//   e.g. node render-overlay-story.js sample-planet 30 ../build/overlay/planet_story 8765

import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , songId, fpsArg, outDir, portArg] = process.argv;
if (!songId || !outDir) { console.error("usage: render-overlay-story.js <songId> <fps> <outDir> <port>"); process.exit(1); }
const fps = +fpsArg || 30, port = +portArg || 8765;
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=2", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${port}/?score=${encodeURIComponent(songId)}`, { waitUntil: "networkidle0" });
await page.waitForFunction("document.querySelector('#player.active') && window.ScoreCapture && window.ScoreCapture.info().lastBeat>0", { timeout: 15000 });
await page.evaluate(() => window.ScoreCapture.transparent());

// gesture cue pill (same look as the practice-loop demo cues)
await page.evaluate(() => {
  const st = document.createElement("style");
  st.textContent = `
    #cue{position:absolute;left:0;right:0;top:470px;text-align:center;opacity:0;pointer-events:none;}
    #cueGlyph{position:relative;height:46px;}
    #tapRing{position:absolute;left:50%;top:50%;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;
      border:3px solid #fff;box-shadow:0 0 14px rgba(255,94,168,.9);}
    #tapDot{position:absolute;left:50%;top:50%;width:11px;height:11px;margin:-5.5px 0 0 -5.5px;border-radius:50%;background:#fff;}
    #swipeArrow{position:absolute;left:50%;top:50%;margin-top:-16px;font-size:34px;color:#fff;text-shadow:0 0 14px #ff5ea8;}
    #cueLabel{font-size:15px;color:#ffeaf6;text-shadow:0 0 10px rgba(255,94,168,.7);}`;
  document.head.appendChild(st);
  const d = document.createElement("div");
  d.id = "cue";
  d.innerHTML = '<div id="cueGlyph"><div id="tapRing"></div><div id="tapDot"></div><div id="swipeArrow">→</div></div><div id="cueLabel"></div>';
  document.getElementById("stage").appendChild(d);
  window.__cue = (kind, label, prog) => {
    const cue = document.getElementById("cue");
    const hint = document.getElementById("pHint");
    if (hint) hint.style.opacity = kind ? 0.1 : 1;
    if (!kind) { cue.style.opacity = 0; return; }
    cue.style.opacity = 1;
    document.getElementById("cueLabel").textContent = label;
    document.getElementById("tapRing").style.display = kind === "tap" ? "block" : "none";
    document.getElementById("tapDot").style.display = kind === "tap" ? "block" : "none";
    document.getElementById("swipeArrow").style.display = kind === "swipe" ? "block" : "none";
    if (kind === "tap") {
      const r = 1 + 1.6 * prog;
      document.getElementById("tapRing").style.transform = `scale(${r})`;
      document.getElementById("tapRing").style.opacity = String(1 - prog * 0.85);
    } else {
      document.getElementById("swipeArrow").style.transform = `translateX(${-40 + 100 * prog}px)`;
      document.getElementById("swipeArrow").style.opacity = String(prog < 0.85 ? 1 : (1 - prog) / 0.15);
    }
  };
});

const info = await page.evaluate(() => window.ScoreCapture.info());
const bps = info.bpm / 60, BPB = info.beatsPerBar, CI = info.countIn;
console.log(`bpm ${info.bpm}, lastBeat ${info.lastBeat}`);

// ---- storyboard: list of segments, each maps local time -> {beat, opts} ----
const S = [];
function seg(dur, fn) { S.push({ dur, fn }); }
const PAUSE1_BEAT = 2;                 // pause 1 s after scrolling starts (beat 2 @120)
const RESUME_BAR_BEAT = PAUSE1_BEAT - (PAUSE1_BEAT % BPB) + 3 * BPB; // 3 bars ahead -> beat 12
// 1) static, unplayed
seg(2.0, () => ({ beat: 0, opts: { paused: true } }));
// 2) tap -> count-in -> scroll (cue overlaps the last 0.6 s of the static hold)
seg(CI / bps, u => ({ beat: -CI + u * bps, opts: {} }));
seg(PAUSE1_BEAT / bps, u => ({ beat: u * bps, opts: {} }));
// 3) tap -> paused, frozen
seg(1.6, () => ({ beat: PAUSE1_BEAT, opts: { paused: true } }));
// 4) three swipes -> discrete bar jumps (paused), then tap -> count-in -> play to the end
for (let k = 1; k <= 3; k++)
  seg(0.8, () => ({ beat: PAUSE1_BEAT - (PAUSE1_BEAT % BPB) + k * BPB, opts: { paused: true } }));
seg(0.4, () => ({ beat: RESUME_BAR_BEAT, opts: { paused: true } }));
seg(CI / bps, u => ({ beat: RESUME_BAR_BEAT - CI + u * bps, opts: { playFrom: RESUME_BAR_BEAT } }));
const remain = (info.lastBeat + 1 - RESUME_BAR_BEAT) / bps;
seg(remain, u => ({ beat: RESUME_BAR_BEAT + u * bps, opts: { playFrom: RESUME_BAR_BEAT } }));

// cue windows (start time, duration, kind, label) — computed off segment starts
let t = 0; const starts = S.map(s2 => { const v = t; t += s2.dur; return v; });
const DUR = t;
const cues = [
  [starts[1] - 0.7, 0.8, "tap", "tap — play"],
  [starts[3] - 0.3, 0.8, "tap", "tap — pause"],
  [starts[4], 0.7, "swipe", "swipe → — skip a bar"],
  [starts[5], 0.7, "swipe", "swipe → — skip a bar"],
  [starts[6], 0.7, "swipe", "swipe → — skip a bar"],
  [starts[7] - 0.2, 0.8, "tap", "tap — play"],
];
const n = Math.ceil(DUR * fps);
console.log(`${DUR.toFixed(1)}s -> ${n} frames @${fps}fps (resume bar at beat ${RESUME_BAR_BEAT})`);

for (let f = 0; f < n; f++) {
  const tt = f / fps;
  let i = S.length - 1;
  for (let k = 0; k < S.length; k++) if (tt >= starts[k] && tt < starts[k] + S[k].dur) { i = k; break; }
  const { beat, opts } = S[i].fn(tt - starts[i]);
  let cue = null;
  for (const [c0, cd, kind, label] of cues) if (tt >= c0 && tt < c0 + cd) cue = [kind, label, (tt - c0) / cd];
  await page.evaluate((b, o, c) => { window.ScoreCapture.seek(b, o); window.__cue(c && c[0], c && c[1], c && c[2]); }, beat, opts, cue);
  await page.screenshot({ path: path.join(outDir, "f" + String(f).padStart(5, "0") + ".png"), omitBackground: true, optimizeForSpeed: true });
  if (f % 200 === 0) process.stdout.write(`  ${f}/${n}\r`);
}
console.log(`\nwrote ${n} frames to ${outDir}`);
await browser.close();
