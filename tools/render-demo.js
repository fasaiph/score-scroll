// Capture tools/demo-practice-loop.html frame-by-frame via window.DemoCapture.
//   node render-demo.js <fps> <outDir> <serverPort> [query]   (serve the REPO ROOT)
//   query e.g. "plain=1" selects the no-controls storyboard
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const [, , fpsArg, outDir, portArg, query] = process.argv;
const fps = +fpsArg || 30, port = +portArg || 8770;
fs.mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
  args: ["--no-sandbox", "--force-device-scale-factor=2", "--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 2 });
await page.goto(`http://localhost:${port}/tools/demo-practice-loop.html${query ? "?" + query : ""}`, { waitUntil: "networkidle0" });
await page.evaluate(() => { window.__capturing = true; window.DemoCapture.transparent(); });
await new Promise(r => setTimeout(r, 400));
const dur = await page.evaluate(() => window.DemoCapture.info().duration);
const n = Math.ceil(dur * fps);
console.log(`${dur.toFixed(1)}s -> ${n} frames @${fps}fps`);
for (let f = 0; f < n; f++) {
  await page.evaluate(t => window.DemoCapture.seek(t), f / fps);
  await page.screenshot({ path: path.join(outDir, "f" + String(f).padStart(5, "0") + ".png"), omitBackground: true, optimizeForSpeed: true });
  if (f % 200 === 0) process.stdout.write(`  ${f}/${n}\r`);
}
console.log(`\nwrote ${n} frames to ${outDir}`);
await browser.close();
