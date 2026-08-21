// WS-I — chords + lyrics (guitar / singer). Pure functions, no DOM except diagram SVG strings.
//
//   SS.Chords.parse(chordproText)            -> Song   (one [chord] = one bar)
//   SS.Chords.transposeName(name, semis, useFlats)
//   SS.Chords.keyName(song, transpose)       -> "Bm"
//   SS.Chords.shape(name)                    -> { frets:[...6], base, barre } | null
//   SS.Chords.diagramSVG(name, opts)         -> "<svg…>"
//
// Song = { title, artist, key, bpm, beatsPerBar, countIn, capo, lines:[Line], bars:[Bar], chordSet:[names] }
//   Line = { kind:"lyric"|"gap", label ("Verse 1"), pickup, segs:[{ chord, lyric, bar, bars }], firstBar, barCount }
//   Bar  = { chord, line, seg, beat }            // beat = bar index * beatsPerBar
// Timing convention (chosen for this product): every [Chord] marker starts a new bar.
//   [Am*2] holds a chord for 2 bars.  Lyrics before a line's first chord are a pickup into bar 1
//   of that line (rendered, no time of their own). Lines with no chords take no time and are
//   shown as continuations of the previous line (or as section labels via {c: …}).

window.SS = window.SS || {};

SS.Chords = (function () {
  var NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  function pitchClass(root) {
    if (!root) return null;
    var pc = PC[root[0].toUpperCase()]; if (pc === undefined) return null;
    for (var i = 1; i < root.length; i++) { if (root[i] === "#") pc++; else if (root[i] === "b") pc--; }
    return ((pc % 12) + 12) % 12;
  }
  // "C#m7/G#" -> { root:"C#", qual:"m7", bass:"G#" }
  function splitChord(name) {
    var m = /^([A-Ga-g][#b]*)([^/]*)(?:\/([A-Ga-g][#b]*))?$/.exec(String(name).trim());
    if (!m) return null;
    return { root: m[1][0].toUpperCase() + m[1].slice(1), qual: m[2] || "", bass: m[3] ? m[3][0].toUpperCase() + m[3].slice(1) : "" };
  }
  function spell(pc, useFlats) { return (useFlats ? NOTES_FLAT : NOTES_SHARP)[((pc % 12) + 12) % 12]; }

  // keys whose scale is spelled with flats (major tonic pcs / minor tonic pcs)
  var FLAT_MAJOR = { 5: 1, 10: 1, 3: 1, 8: 1, 1: 1, 6: 1 };       // F Bb Eb Ab Db Gb
  var FLAT_MINOR = { 2: 1, 7: 1, 0: 1, 5: 1, 10: 1, 3: 1 };      // Dm Gm Cm Fm Bbm Ebm
  function parseKey(k) {
    var m = /^([A-Ga-g][#b]?)\s*(m|min|minor|-)?/.exec(String(k || "").trim());
    if (!m) return null;
    return { pc: pitchClass(m[1][0].toUpperCase() + m[1].slice(1)), minor: !!m[2] };
  }
  function keyUsesFlats(key) { return !!(key && (key.minor ? FLAT_MINOR : FLAT_MAJOR)[key.pc]); }
  function keyToName(key) { return key ? spell(key.pc, keyUsesFlats(key)) + (key.minor ? "m" : "") : ""; }
  function transposeKey(key, semis) { return key ? { pc: ((key.pc + semis) % 12 + 12) % 12, minor: key.minor } : null; }

  function transposeName(name, semis, useFlats) {
    var c = splitChord(name); if (!c) return name;             // N.C., %, etc. pass through
    if (!semis) return name;
    var r = spell(pitchClass(c.root) + semis, useFlats);
    var out = r + c.qual;
    if (c.bass) out += "/" + spell(pitchClass(c.bass) + semis, useFlats);
    return out;
  }

  // ---------- ChordPro parser ----------
  function parse(text) {
    var song = { title: "", artist: "", key: null, bpm: 0, beatsPerBar: 4, countIn: 4, capo: 0, transpose: 0, lines: [], bars: [], chordSet: [] };
    var lines = String(text).replace(/\r/g, "").split("\n");
    var barIdx = 0, lastLyricLine = null, seen = {}, pendingLabel = "";
    lines.forEach(function (raw) {
      var s = raw.replace(/\s+$/, "");
      if (/^\s*#/.test(s)) return;                                  // comment
      var d = /^\s*\{\s*([a-zA-Z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/.exec(s);
      if (d) {
        var k = d[1].toLowerCase(), v = (d[2] || "").trim();
        if (k === "title" || k === "t") song.title = v;
        else if (k === "artist" || k === "subtitle" || k === "st") song.artist = v;
        else if (k === "key") song.key = parseKey(v);
        else if (k === "tempo") song.bpm = parseFloat(v) || 0;
        else if (k === "capo") song.capo = parseInt(v, 10) || 0;
        else if (k === "transpose") song.transpose = parseInt(v, 10) || 0;   // default semitone shift (our extension)
        else if (k === "countin" || k === "count_in") song.countIn = parseInt(v, 10) || 4;
        else if (k === "time") {
          var t = /(\d+)\s*\/\s*(\d+)/.exec(v);
          if (t) {
            var num = +t[1], den = +t[2];
            // compound meters (6/8, 9/8, 12/8): pulse = dotted quarter
            song.beatsPerBar = (den === 8 && num % 3 === 0) ? num / 3 : num;
          }
        }
        else if (k === "c" || k === "comment" || k === "ci" || k === "cb") pendingLabel = v;
        else if (/^(start_of_|so)/.test(k)) {
          var name = v || k.replace(/^start_of_/, "").replace(/^so/, "");
          name = { c: "Chorus", v: "Verse", b: "Bridge", chorus: "Chorus", verse: "Verse", bridge: "Bridge" }[name] || name;
          pendingLabel = name;
        }
        return;                                                      // end_of_*, others: ignore
      }
      if (!s.trim()) { if (lastLyricLine && !pendingLabel) song.lines.push({ kind: "gap", firstBar: barIdx, barCount: 0 }); return; }

      // lyric line: split on [chord] markers
      var segs = [], re = /\[([^\]]*)\]/g, m, last = 0, pickup = "";
      var firstIdx = s.search(/\[/);
      if (firstIdx < 0) {                                            // lyric-only continuation (no time)
        song.lines.push({ kind: "lyric", segs: [{ chord: "", lyric: s, bar: -1, bars: 0 }], pickup: "", firstBar: barIdx, barCount: 0, label: pendingLabel });
        pendingLabel = ""; return;
      }
      pickup = s.slice(0, firstIdx);
      var marks = [];
      while ((m = re.exec(s))) marks.push({ chord: m[1].trim(), at: m.index, end: m.index + m[0].length });
      var lineFirstBar = barIdx;
      marks.forEach(function (mk, i) {
        var lyric = s.slice(mk.end, i + 1 < marks.length ? marks[i + 1].at : s.length);
        var hold = 1, hm = /^(.*?)\s*\*\s*(\d+)$/.exec(mk.chord);
        var chord = mk.chord;
        if (hm) { chord = hm[1]; hold = Math.max(1, parseInt(hm[2], 10)); }
        if (chord === "%" && song.bars.length) chord = song.bars[song.bars.length - 1].chord;
        var seg = { chord: chord, lyric: lyric, bar: barIdx, bars: hold };
        segs.push(seg);
        for (var h = 0; h < hold; h++) { song.bars.push({ chord: chord, line: song.lines.length, seg: segs.length - 1, beat: barIdx * song.beatsPerBar }); barIdx++; }
        if (chord && !seen[chord] && splitChord(chord)) { seen[chord] = 1; song.chordSet.push(chord); }
      });
      var line = { kind: "lyric", segs: segs, pickup: pickup, firstBar: lineFirstBar, barCount: barIdx - lineFirstBar, label: pendingLabel };
      pendingLabel = ""; song.lines.push(line); lastLyricLine = line;
    });
    if (!song.key && song.chordSet.length) {                         // infer key from the first chord
      var c0 = splitChord(song.chordSet[0]);
      song.key = { pc: pitchClass(c0.root), minor: /^(m|min|-)(?!aj)/.test(c0.qual) };
    }
    if (!song.bpm) song.bpm = 100;
    return song;
  }

  // ---------- chord shapes ----------
  // frets low E -> high E, 'x' = muted. Open-position voicings first; everything else = barre math.
  var OPEN = {
    "C": "x32010", "D": "xx0232", "E": "022100", "F": "133211", "G": "320003", "A": "x02220", "B": "x24442",
    "Am": "x02210", "Bm": "x24432", "Cm": "x35543", "Dm": "xx0231", "Em": "022000", "Fm": "133111", "Gm": "355333",
    "A7": "x02020", "B7": "x21202", "C7": "x32310", "D7": "xx0212", "E7": "020100", "F7": "131211", "G7": "320001",
    "Am7": "x02010", "Bm7": "x24232", "Cm7": "x35343", "Dm7": "xx0211", "Em7": "022030", "Fm7": "131111", "Gm7": "353333",
    "Cmaj7": "x32000", "Dmaj7": "xx0222", "Emaj7": "021100", "Fmaj7": "xx3210", "Gmaj7": "320002", "Amaj7": "x02120", "Bmaj7": "x24342",
    "Asus4": "x02230", "Dsus4": "xx0233", "Esus4": "022200", "Gsus4": "330013", "Csus4": "x33011",
    "Asus2": "x02200", "Dsus2": "xx0230", "Esus2": "024400", "Gsus2": "300033", "Csus2": "x30013",
    "Cadd9": "x32033", "Gadd9": "320203", "Dadd9": "xx0230", "Aadd9": "x02420", "Eadd9": "022102",
    "A5": "x022xx", "E5": "022xxx", "D5": "xx023x", "G5": "355xxx", "C5": "x355xx",
    "Bdim": "x2343x", "Ddim": "xx0101", "Gdim": "3x232x", "Edim": "0120xx", "Bm7b5": "x2323x", "Adim7": "x01212",
    "Caug": "x3211x", "Eaug": "032110", "Gaug": "321003", "Aaug": "x03221",
    "D/F#": "2x0232", "C/G": "332010", "G/B": "x20033", "Am/G": "302210", "C/E": "032010", "D/A": "x00232", "F/C": "x33211", "Em/D": "xx0000",
    "G/D": "xx0003", "E/G#": "4x2100", "A/C#": "x4222x", "Em/B": "x22000", "Am/E": "002210", "F/A": "x03211", "G/F#": "2x0003", "C/B": "x22010",
    "Bm/A": "x04432", "Dm/F": "1x0231", "A/E": "002220", "D/C": "x30232", "Cmaj7/G": "332000", "G/A": "x00003", "Am/C": "x32210", "E/B": "x22100",
    "E6": "022120", "A6": "x02222", "D6": "xx0202", "G6": "320000", "C6": "x32210",
    "A9": "x02423", "E9": "020102", "D9": "xx0210", "G9": "320001", "C9": "x32330",
    "Am6": "x02212", "Em6": "022020", "Dm6": "xx0201",
    "Am9": "x02000", "Em9": "022002", "Dm9": "xx0210",
  };
  // barre forms (offsets from the barre fret). E-form root on string 6, A-form root on string 5.
  var FORMS = {
    "":     { E: [0, 2, 2, 1, 0, 0],  A: ["x", 0, 2, 2, 2, 0] },
    "m":    { E: [0, 2, 2, 0, 0, 0],  A: ["x", 0, 2, 2, 1, 0] },
    "7":    { E: [0, 2, 0, 1, 0, 0],  A: ["x", 0, 2, 0, 2, 0] },
    "m7":   { E: [0, 2, 0, 0, 0, 0],  A: ["x", 0, 2, 0, 1, 0] },
    "maj7": { E: [0, "x", 1, 1, 0, "x"], A: ["x", 0, 2, 1, 2, 0] },
    "sus4": { E: [0, 2, 2, 2, 0, 0],  A: ["x", 0, 2, 2, 3, 0] },
    "sus2": { E: [0, 2, 4, 4, 0, 0],  A: ["x", 0, 2, 4, 3, 0] },
    "5":    { E: [0, 2, 2, "x", "x", "x"], A: ["x", 0, 2, 2, "x", "x"] },
    "dim":  { E: [0, "x", 2, 0, 2, "x"], A: ["x", 0, 1, 2, 1, "x"] },
    "dim7": { E: [0, "x", 2, 0, 2, "x"], A: ["x", 0, 1, 2, 1, "x"] },
    "m7b5": { E: [0, "x", 0, 0, "x", "x"], A: ["x", 0, 1, 0, 1, "x"] },
    "aug":  { E: [0, "x", 2, 1, 1, "x"], A: ["x", 0, 3, 2, 2, "x"] },
    "6":    { E: [0, 2, 2, 1, 2, 0],  A: ["x", 0, 2, 2, 2, 2] },
    "9":    { E: [0, 2, 0, 1, 0, 2],  A: ["x", 0, 2, 0, 2, 2] },
    "add9": { E: [0, 2, 2, 1, 0, 2],  A: ["x", 0, 2, 4, 2, 0] },
    "m6":   { E: [0, 2, 2, 0, 2, 0],  A: ["x", 0, 2, 2, 1, 2] },
  };
  function normQual(q) {
    q = q.replace(/\s+/g, "").replace("Δ", "maj").replace("°", "dim").replace("ø", "m7b5").replace("+", "aug");
    if (q === "" || q === "maj" || q === "M") return "";
    if (q === "m" || q === "min" || q === "-" || q === "mi") return "m";
    if (q === "M7" || q === "maj7" || q === "ma7") return "maj7";
    if (q === "m7" || q === "min7" || q === "-7" || q === "mi7") return "m7";
    if (q === "sus" || q === "sus4") return "sus4";
    if (q === "dom7") return "7";
    if (FORMS[q]) return q;
    // unknown extensions: fall back to the nearest family we can draw
    if (/^m(aj)?9|^maj9/.test(q)) return "maj7";
    if (/^m/.test(q) && !/^maj/.test(q)) return /7|9|11|13/.test(q) ? "m7" : "m";
    if (/7|9|11|13/.test(q)) return "7";
    return "";
  }
  function shapeFromString(str) {
    var frets = str.split("").map(function (c) { return c === "x" ? "x" : parseInt(c, 10); });
    return finish(frets);
  }
  function finish(frets, barre) {
    var nums = frets.filter(function (f) { return f !== "x" && f > 0; });
    var mx = Math.max.apply(null, nums.length ? nums : [0]), mn = Math.min.apply(null, nums.length ? nums : [0]);
    var base = (mx > 5) ? mn : 1;   // show from fret `base`
    return { frets: frets, base: base, barre: barre || 0 };
  }
  function shape(name) {
    var c = splitChord(name); if (!c) return null;
    if (OPEN[name]) return shapeFromString(OPEN[name]);
    var q = normQual(c.qual);
    var rootSharp = spell(pitchClass(c.root), false), rootFlat = spell(pitchClass(c.root), true);
    var cands = [rootSharp + q, rootFlat + q, rootSharp + c.qual, rootFlat + c.qual];
    for (var i = 0; i < cands.length; i++) if (OPEN[cands[i]]) return shapeFromString(OPEN[cands[i]]);
    var form = FORMS[q] || FORMS[""];
    var pc = pitchClass(c.root);
    var fE = ((pc - 4) % 12 + 12) % 12, fA = ((pc - 9) % 12 + 12) % 12;   // E-form / A-form barre frets
    if (fE === 0) fE = 12; if (fA === 0) fA = 12;
    var useE = fE <= fA, f = useE ? fE : fA, offs = useE ? form.E : form.A;
    var frets = offs.map(function (o) { return o === "x" ? "x" : f + o; });
    return finish(frets, f);
  }

  // ---------- diagram (SVG string) ----------
  function diagramSVG(name, opts) {
    opts = opts || {};
    var w = opts.w || 104, h = opts.h || 118, col = opts.color || "#ffeaf6", acc = opts.accent || "#ff9ed8";
    var sh = shape(name);
    var left = 22, top = 30, sw = (w - 32) / 5, fh = (h - top - 8) / 4, r = Math.min(6, sw * 0.36);
    var s = '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" class="cdiag">';
    if (opts.label !== false) s += '<text x="' + (w / 2) + '" y="17" fill="' + acc + '" font-size="17" font-weight="700" text-anchor="middle">' + esc(name) + '</text>';
    if (!sh) {
      s += '<text x="' + (w / 2) + '" y="' + (h / 2 + 8) + '" fill="' + col + '" font-size="13" text-anchor="middle" opacity=".6">no shape</text>';
      return s + '</svg>';
    }
    if (sh.base === 1) s += '<rect x="' + left + '" y="' + (top - 3) + '" width="' + (sw * 5) + '" height="3" fill="' + col + '"/>';
    else s += '<text x="' + (left - 4) + '" y="' + (top + fh * 0.5 + 4) + '" fill="' + col + '" font-size="10" text-anchor="end" opacity=".85">' + sh.base + 'fr</text>';
    for (var i = 0; i < 6; i++) s += '<line x1="' + (left + i * sw) + '" y1="' + top + '" x2="' + (left + i * sw) + '" y2="' + (top + fh * 4) + '" stroke="' + col + '" stroke-width="1.2" opacity=".8"/>';
    for (var f = 0; f <= 4; f++) s += '<line x1="' + left + '" y1="' + (top + f * fh) + '" x2="' + (left + sw * 5) + '" y2="' + (top + f * fh) + '" stroke="' + col + '" stroke-width="1" opacity=".5"/>';
    if (sh.barre) {
      var bx = [], by = top + (sh.barre - sh.base + 0.5) * fh;
      sh.frets.forEach(function (fr, i) { if (fr === sh.barre) bx.push(left + i * sw); });
      if (bx.length > 1) s += '<rect x="' + (bx[0] - r) + '" y="' + (by - r * 0.8) + '" width="' + (bx[bx.length - 1] - bx[0] + 2 * r) + '" height="' + (r * 1.6) + '" rx="' + r + '" fill="' + acc + '" opacity=".85"/>';
    }
    sh.frets.forEach(function (fr, i) {
      var x = left + i * sw;
      if (fr === "x") s += '<text x="' + x + '" y="' + (top - 7) + '" fill="' + col + '" font-size="11" text-anchor="middle" opacity=".8">×</text>';
      else if (fr === 0) s += '<circle cx="' + x + '" cy="' + (top - 9) + '" r="3.5" fill="none" stroke="' + col + '" stroke-width="1.2"/>';
      else s += '<circle cx="' + x + '" cy="' + (top + (fr - sh.base + 0.5) * fh) + '" r="' + r + '" fill="' + acc + '"/>';
    });
    return s + '</svg>';
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }

  return {
    parse: parse, splitChord: splitChord, pitchClass: pitchClass,
    parseKey: parseKey, keyToName: keyToName, transposeKey: transposeKey, keyUsesFlats: keyUsesFlats,
    transposeName: transposeName, shape: shape, diagramSVG: diagramSVG, esc: esc,
    // display name of a chord given transpose (sounding) and capo (shape played)
    display: function (name, song, transpose, capo) {
      var k = transposeKey(song.key, transpose - capo);
      return transposeName(name, transpose - capo, keyUsesFlats(k));
    },
    soundingKey: function (song, transpose) { return keyToName(transposeKey(song.key, transpose)); },
    shapeKey: function (song, transpose, capo) { return keyToName(transposeKey(song.key, transpose - capo)); },
  };
})();
