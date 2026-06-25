// WS-B keystone — in-browser render.
// Parses MusicXML, renders ONE horizontal staff with OpenSheetMusicDisplay, and
// walks the cursor to extract a (beat -> x-pixel) schedule. No server, no headless
// Chrome, no rasterization: the player scrolls the rendered notation element itself.
//
// SS.render(xml, mountEl, opts) -> Promise<{ schedule, title, instrument }>
//   mountEl gets the rendered (invertible) notation; schedule is the Song Asset
//   contract from planning/ARCHITECTURE.md (points in *rendered* px; player scales).

window.SS = window.SS || {};

SS.render = async function render(xml, mountEl, opts) {
  opts = opts || {};
  const OSMD = window.opensheetmusicdisplay;
  if (!OSMD) throw new Error("OpenSheetMusicDisplay failed to load");

  mountEl.innerHTML = "";
  mountEl.style.transform = "none";   // measure at scale 1 (player rescales later)
  mountEl.style.filter = "none";
  const osmd = new OSMD.OpenSheetMusicDisplay(mountEl, {
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
  osmd.zoom = opts.zoom || 1.2;

  try {
    await osmd.load(xml);
  } catch (e) {
    throw new SS.RenderError("This file couldn't be read as MusicXML. Try re-exporting from MuseScore (File → Export → MusicXML).");
  }
  osmd.render();

  // --- time signature + tempo from the sheet ---
  let beatsPerBar = 4, beatUnit = 4;
  try {
    const ts = osmd.sheet.SourceMeasures[0].ActiveTimeSignature;
    if (ts) { beatsPerBar = ts.Numerator; beatUnit = ts.Denominator; }
  } catch (e) { /* default 4/4 */ }
  let bpm = opts.bpm || 0;
  if (!bpm) { try { bpm = Math.round(osmd.sheet.DefaultStartTempoInBpm) || 0; } catch (e) {} }
  if (!bpm) bpm = 120;

  // --- title / instrument for the library ---
  let title = opts.title || "";
  if (!title) { try { title = (osmd.sheet.TitleString || "").trim(); } catch (e) {} }
  let instrument = "violin";
  try { instrument = (osmd.sheet.Instruments[0].Name || "violin").trim().toLowerCase(); } catch (e) {}

  // --- walk the cursor: (timestamp-in-whole-notes, x-pixel) per onset ---
  const originX = mountEl.getBoundingClientRect().left;
  const pts = [];
  const cur = osmd.cursor;
  cur.reset();
  cur.show();
  const it = cur.iterator;
  let guard = 0;
  while (!it.EndReached && guard < 10000) {
    guard++;
    const tsObj = it.CurrentSourceTimestamp;
    const ts = tsObj ? tsObj.RealValue : null;
    const el = cur.cursorElement;
    let x = null;
    if (el) { const r = el.getBoundingClientRect(); x = (r.left + r.width / 2) - originX; }
    let isRest = true;
    try {
      const ves = it.CurrentVoiceEntries;
      if (ves && ves.length) for (const ve of ves) {
        const notes = ve.Notes; if (notes) for (const n of notes) { if (!(n.isRest && n.isRest())) isRest = false; }
      }
    } catch (e) {}
    if (ts != null && x != null) pts.push({ beat: +(ts * beatUnit).toFixed(5), x: Math.round(x), rest: isRest });
    cur.next();
  }
  cur.hide();

  if (pts.length < 2) throw new SS.RenderError("No playable notes were found in this score.");

  // make the rendered notation luminous (white-on-black) for the additive display
  mountEl.style.filter = "invert(1) contrast(1.7) brightness(1.25)";

  const box = mountEl.getBoundingClientRect();
  const schedule = {
    bpm, beatsPerBar, countIn: opts.countIn || 4,
    widthPx: Math.ceil(box.width), heightPx: Math.ceil(box.height),
    points: pts,
  };
  return { schedule, title: title || "Untitled", instrument };
};

SS.RenderError = class RenderError extends Error {
  constructor(msg) { super(msg); this.name = "RenderError"; this.userFacing = true; }
};
