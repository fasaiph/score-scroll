// WS-I — chord/lyric chart view (guitar + singer teleprompter). Layout:
//   header: [diagram NOW] [BIG current chord] › [next chord] [diagram NEXT]
//   beat dots · then lyric lines (chords above) scrolling up so the current
//   line sits on the pink "now" band; the current bar's lyric glows.
// Driven by SS.Transport — same clock/count-in/bar-nav as the notation player.
//
// SS.Chart(refs) where refs = { lines, linesInner, nowChord, nextChord, nowDiag, nextDiag,
//   beats, section, keyTag, countin, bpmEl, stateEl, barNumEl, barFill, onBackAtStart }
// chart.load(song, { transpose, capo, click, bpm })

window.SS = window.SS || {};

SS.Chart = function (refs) {
  var VIEW_W = 540;
  var song = null, opt = { transpose: 0, capo: 0 }, lineEls = [], segEls = [], dispName = {};
  var curBar = -1, curLine = -1, curBeatInBar = -1, scrollY = 0, targetY = 0, lastNow = 0;
  var diagCache = {}, fixedDt = 0;   // fixedDt > 0: deterministic easing for frame capture

  var tr = SS.Transport({
    countin: refs.countin, bpmEl: refs.bpmEl, stateEl: refs.stateEl, barNumEl: refs.barNumEl, barFill: refs.barFill,
    onBackAtStart: refs.onBackAtStart,
    onDraw: onDraw,
  });

  function disp(chord) {
    if (!chord) return "";
    if (dispName[chord] === undefined) dispName[chord] = SS.Chords.display(chord, song, opt.transpose, opt.capo);
    return dispName[chord];
  }
  function diag(name, w, h) {
    var k = name + "|" + w;
    if (!diagCache[k]) diagCache[k] = name ? SS.Chords.diagramSVG(name, { w: w, h: h, label: false }) : "";
    return diagCache[k];
  }

  // Build visual rows. A source line that is wider than the display is wrapped at bar
  // boundaries into several rows; each row scrolls like a line of its own.
  function build() {
    var inner = refs.linesInner; inner.innerHTML = ""; lineEls = []; segEls = []; dispName = {}; rowLine = [];
    song.lines.forEach(function (ln, li) {
      if (ln.kind !== "lyric") { addRow("cl gap", li); return; }
      // make all segs first (in a scratch row) so we can measure them
      var scratch = addRow("cl", li), segs = [];
      if (ln.pickup) segs.push(mkSeg("", ln.pickup, null));
      ln.segs.forEach(function (sg) { segs.push(mkSeg(disp(sg.chord), sg.lyric, sg)); });
      segs.forEach(function (e) { scratch.appendChild(e); });
      var widths = segs.map(function (e) { return e.getBoundingClientRect().width * 1.07; });
      // greedy pack into rows
      var row = scratch, used = 0; scratch.innerHTML = "";
      segs.forEach(function (e, i) {
        if (used > 0 && used + widths[i] > VIEW_W) { row = addRow("cl cont", li); used = 0; }
        row.appendChild(e); used += widths[i];
        if (widths[i] > VIEW_W) row.style.fontSize = Math.max(14, Math.floor(29 * VIEW_W / widths[i])) + "px";
      });
    });
    // beat dots
    refs.beats.innerHTML = "";
    for (var i = 0; i < song.beatsPerBar; i++) { var dot = document.createElement("i"); refs.beats.appendChild(dot); }
    refs.keyTag.textContent = keyTagText();
    curBar = -1; curLine = -1; curBeatInBar = -1;
  }
  var rowLine = [];                       // row index -> source line index
  var barRow = [];                        // bar index -> row index
  function addRow(cls, li) {
    var d = document.createElement("div"); d.className = cls;
    refs.linesInner.appendChild(d); lineEls.push(d); rowLine.push(li);
    return d;
  }
  function mkSeg(chordName, lyric, sg) {
    var e = document.createElement("span");
    e.className = "seg";
    e.innerHTML = '<span class="ch">' + (SS.Chords.esc(chordName) || "&nbsp;") + '</span><span class="ly">' + (SS.Chords.esc(lyric) || "&nbsp;") + "</span>";
    if (sg && sg.bar >= 0) {
      e.dataset.bar = sg.bar;
      for (var b = 0; b < sg.bars; b++) { segEls[sg.bar + b] = e; barRow[sg.bar + b] = lineEls.length - 1; }
    }
    return e;
  }

  function keyTagText() {
    var k = SS.Chords.soundingKey(song, opt.transpose);
    var t = k ? k : "";
    if (opt.capo) t += " · capo " + opt.capo + " (" + SS.Chords.shapeKey(song, opt.transpose, opt.capo) + " shapes)";
    else if (opt.transpose) t += " (" + (opt.transpose > 0 ? "+" : "") + opt.transpose + ")";
    return t;
  }

  function lineOfBar(b) {
    b = Math.max(0, Math.min(song.bars.length - 1, b));
    var e = segEls[b]; if (!e) return 0;
    return lineEls.indexOf(e.parentNode);
  }
  function sectionOf(row) { for (var i = rowLine[row] || 0; i >= 0; i--) if (song.lines[i].label) return song.lines[i].label; return ""; }
  // y offset of a line inside the inner container
  function lineTop(li) { return lineEls[li] ? lineEls[li].offsetTop : 0; }

  function onDraw(anchor, st) {
    if (!song) return;
    var bpb = song.beatsPerBar;
    var bar = Math.min(song.bars.length - 1, Math.max(0, Math.floor(anchor / bpb + 1e-6)));
    var beatInBar = st.countingIn ? -1 : Math.floor(anchor - bar * bpb + 1e-6);
    if (bar !== curBar) {
      if (segEls[curBar]) segEls[curBar].classList.remove("cur");
      if (segEls[bar]) segEls[bar].classList.add("cur");
      curBar = bar;
      var li = lineOfBar(bar);
      if (li !== curLine) {
        if (lineEls[curLine]) lineEls[curLine].classList.remove("cur");
        if (lineEls[li]) lineEls[li].classList.add("cur");
        curLine = li; targetY = -lineTop(li);
        refs.section.textContent = sectionOf(li);
      }
      var nowName = disp(song.bars[bar].chord);
      var nextName = bar + 1 < song.bars.length ? disp(song.bars[bar + 1].chord) : "";
      if (nextName === nowName) {                                   // look past held chords
        for (var k = bar + 2; k < song.bars.length; k++) { var n2 = disp(song.bars[k].chord); if (n2 !== nowName) { nextName = n2; break; } }
        if (nextName === nowName) nextName = "";
      }
      refs.nowChord.textContent = nowName || "—";
      refs.nowChord.className = nowName.length > 4 ? "long" : "";
      refs.nextChord.textContent = nextName || "end";
      refs.nowDiag.innerHTML = diag(nowName, 104, 118);
      refs.nextDiag.innerHTML = diag(nextName, 86, 100);
    }
    if (beatInBar !== curBeatInBar) {
      curBeatInBar = beatInBar;
      refs.beats.style.visibility = st.countingIn ? "hidden" : "visible";
      var dots = refs.beats.children;
      for (var i = 0; i < dots.length; i++) dots[i].className = (i <= beatInBar) ? "on" : "";
    }
    // eased scroll toward the current line
    var now = performance.now(), dt = fixedDt || (lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0); lastNow = now;
    if (Math.abs(targetY - scrollY) < 0.5) scrollY = targetY; else scrollY += (targetY - scrollY) * Math.min(1, dt * 14);
    refs.linesInner.style.transform = "translate3d(0," + scrollY.toFixed(1) + "px,0)";
  }

  function load(s, o) {
    song = s; opt = { transpose: o.transpose || 0, capo: o.capo || 0 };
    build();
    scrollY = targetY = 0; refs.linesInner.style.transform = "translate3d(0,0,0)";
    tr.load({ bpm: o.bpm || s.bpm, beatsPerBar: s.beatsPerBar, firstBeat: 0,
      lastBeat: Math.max(0, s.bars.length * s.beatsPerBar - 1), countIn: s.countIn || 4, click: !!o.click });
  }

  return {
    load: load,
    unlockAudio: tr.unlockAudio, toggle: tr.toggle, pause: tr.pause, tempo: tr.tempo, setClick: tr.setClick,
    back: tr.back, skip: tr.skip, isPlaying: tr.isPlaying,
    // overlay capture: deterministic frame at `beat`, easing stepped by 1/fps
    capture: function (beat, fps) { fixedDt = 1 / (fps || 30); tr.capture(beat); },
    info: tr.info,
  };
};
