// Glue: library <-> render <-> player / chart, plus input (arrow keys + Enter for
// glasses, clicks for desktop). MVP, $0 path — no accounts, no server.
//
// Screens: library → (score song) player
//                  → (chord song) setup [transpose / capo / metronome] → chart
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var libraryEl = $("library"), playerEl = $("player"), setupEl = $("setup"), chartEl = $("chart");
  var listEl = $("songList"), fileInput = $("fileInput");
  var notation = $("notation");

  var player = SS.Player({
    lane: $("lane"), strip: $("strip"), notation: notation, playhead: $("playhead"),
    countin: $("countin"), bpmEl: $("bpm"), stateEl: $("pState"),
    barNumEl: $("barNum"), barFill: $("barFill"),
    onBackAtStart: function () { showLibrary(); },
  });

  var chart = SS.Chart({
    lines: $("lines"), linesInner: $("linesInner"), nowChord: $("nowChord"), nextChord: $("nextChord"),
    nowDiag: $("nowDiag"), nextDiag: $("nextDiag"), beats: $("beats"), section: $("section"), keyTag: $("cKey"),
    countin: $("cCountin"), bpmEl: $("cBpm"), stateEl: $("cState"), barNumEl: $("cBarNum"), barFill: $("cBarFill"),
    onBackAtStart: function () { showSetup(); },
  });

  var items = [], sel = 0;
  var cur = null;          // { rec, song, set: { transpose, capo, click } } for the open chord song
  var setupRows = [], setupSel = 0;

  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }
  function isChords(rec) { return rec.type === "chords"; }

  // ---------- library ----------
  function refresh() {
    return SS.Library.list().then(function (songs) {
      items = [{ type: "add" }].concat(songs.map(function (s) { return { type: "song", rec: s }; }));
      if (sel >= items.length) sel = items.length - 1;
      renderList();
    });
  }
  function renderList() {
    listEl.innerHTML = "";
    items.forEach(function (it, i) {
      var d = document.createElement("div");
      d.className = "row" + (i === sel ? " sel" : "") + (it.type === "add" ? " add" : "");
      if (it.type === "add") {
        d.innerHTML = "<span>➕ Upload MusicXML / ChordPro</span>";
        d.onclick = function () { sel = i; renderList(); doUpload(); };
      } else {
        var r = it.rec, meta;
        if (isChords(r)) {
          if (!r.key) { try { r.key = SS.Chords.keyToName(SS.Chords.parse(r.chordpro).key); } catch (e2) { r.key = ""; } }
          meta = "chords" + (r.key ? " · " + esc(r.key) : "");
        }
        else meta = r.sample ? "sample" : (r.instrument || "violin");
        d.innerHTML = '<span>' + (isChords(r) ? "🎸" : "🎻") + '</span><span>' + esc(r.title) + '</span>' +
          '<span class="meta">' + meta + '</span>' +
          (r.sample ? "" : '<span class="del" title="delete">🗑️</span>');
        d.onclick = function (e) {
          sel = i;
          if (e.target.classList.contains("del")) { remove(r); return; }
          openSong(r);
        };
      }
      listEl.appendChild(d);
    });
  }

  function remove(rec) {
    SS.Library.remove(rec.id).then(refresh).then(function () { toast("Removed “" + rec.title + "”"); });
  }

  // ---------- upload ----------
  function doUpload() { player.unlockAudio(); fileInput.value = ""; fileInput.click(); }
  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0]; if (!f) return;
    readFile(f).then(function (text) {
      var name = f.name.replace(/\.[^.]+$/, "");
      if (/\.(cho|chopro|crd|pro|txt)$/i.test(f.name)) return openFromChordPro(text, { title: name, persist: true });
      return openFromXml(text, { title: name, persist: true });
    }).catch(function (err) { toast(err && err.userFacing ? err.message : "Couldn't read that file."); });
  });
  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = function () { rej(fr.error); };
      if (/\.mxl$/i.test(file.name)) fr.readAsBinaryString(file); else fr.readAsText(file);
    });
  }

  // ---------- open / play ----------
  function openSong(rec) {
    if (isChords(rec)) return openChords(rec);
    showPlayer(rec.title);
    SS.render(rec.xml, notation, { bpm: rec.bpm, countIn: rec.countIn, title: rec.title })
      .then(function (out) { player.setSchedule(out.schedule); })
      .catch(function (err) { toast(err.userFacing ? err.message : "Couldn't render this score."); showLibrary(); });
  }
  function openFromXml(xml, opts) {
    showPlayer(opts.title);
    return SS.render(xml, notation, { title: opts.title })
      .then(function (out) {
        player.setSchedule(out.schedule);
        if (opts.persist) {
          SS.Library.save({ title: out.title !== "Untitled" ? out.title : opts.title, type: "score",
            instrument: out.instrument, xml: xml, bpm: out.schedule.bpm, countIn: out.schedule.countIn })
            .then(function () { toast("Saved to your library"); });
        }
      });
  }
  function openFromChordPro(text, opts) {
    var song = SS.Chords.parse(text);
    if (!song.bars.length) { toast("No [chords] found in that file."); return Promise.resolve(); }
    var rec = { title: song.title || opts.title, type: "chords", instrument: "guitar", chordpro: text,
      key: SS.Chords.keyToName(song.key), transpose: song.transpose || 0, capo: song.capo || 0, click: false };
    return SS.Library.save(rec).then(function (saved) { toast("Saved to your library"); openChords(saved); });
  }

  // ---------- chord songs: setup screen ----------
  function openChords(rec) {
    var song = SS.Chords.parse(rec.chordpro);
    if (!song.bars.length) { toast("No [chords] found in this song."); return; }
    cur = { rec: rec, song: song, set: {
      transpose: (rec.transpose !== undefined ? rec.transpose : song.transpose) || 0,
      capo: (rec.capo !== undefined ? rec.capo : song.capo) || 0,
      click: !!rec.click,
    } };
    setupSel = 0;
    showSetup();
  }
  function renderSetup() {
    var s = cur.song, st = cur.set, C = SS.Chords;
    $("sTitle").textContent = s.title || cur.rec.title;
    $("sArtist").textContent = s.artist || "";
    var orig = C.keyToName(s.key), sounding = C.soundingKey(s, st.transpose), shapes = C.shapeKey(s, st.transpose, st.capo);
    $("sTranspose").textContent = (st.transpose > 0 ? "+" : "") + st.transpose;
    $("sKey").textContent = orig ? (st.transpose ? orig + " → " + sounding : "key of " + orig) : "";
    $("sCapo").textContent = st.capo;
    $("sShapes").textContent = st.capo ? "play " + shapes + " shapes" : "no capo";
    $("sClick").textContent = st.click ? "on" : "off";
    $("sMeta").textContent = s.bpm + " bpm · " + s.bars.length + " bars";
    var names = s.chordSet.slice(0, 14).map(function (c) { return C.display(c, s, st.transpose, st.capo); });
    var seenN = {}; names = names.filter(function (n) { if (seenN[n]) return false; seenN[n] = 1; return true; });
    $("sChords").innerHTML = names.map(function (n) { return C.diagramSVG(n, { w: 62, h: 70 }); }).join("");
    setupRows.forEach(function (r, i) { r.classList.toggle("sel", i === setupSel); });
  }
  function setupAdjust(dir) {
    var k = setupRows[setupSel].dataset.k, st = cur.set;
    if (k === "transpose") st.transpose = Math.max(-11, Math.min(11, st.transpose + dir));
    else if (k === "capo") st.capo = Math.max(0, Math.min(11, st.capo + dir));
    else if (k === "click") st.click = !st.click;
    else return;
    renderSetup();
  }
  function setupEnter() {
    var k = setupRows[setupSel].dataset.k;
    if (k === "back") { showLibrary(); return; }
    if (k === "click") { cur.set.click = !cur.set.click; renderSetup(); return; }
    startChart();
  }
  function startChart() {
    var rec = cur.rec, st = cur.set;
    rec.transpose = st.transpose; rec.capo = st.capo; rec.click = st.click;
    SS.Library.save(rec);                       // remember per-song settings
    showChart();
    chart.load(cur.song, { transpose: st.transpose, capo: st.capo, click: st.click });
  }

  // ---------- screens ----------
  var screens = [libraryEl, playerEl, setupEl, chartEl];
  function show(el) {
    if (el !== playerEl) player.pause();
    if (el !== chartEl) chart.pause();
    screens.forEach(function (s) { s.classList.toggle("active", s === el); });
    el.focus();
  }
  function showPlayer(title) { $("pTitle").textContent = title || "—"; show(playerEl); }
  function showLibrary() { show(libraryEl); refresh(); }
  function showSetup() { show(setupEl); renderSetup(); }
  function showChart() {
    $("cTitle").firstChild.textContent = (cur.song.title || cur.rec.title);
    show(chartEl);
  }
  function active() { for (var i = 0; i < screens.length; i++) if (screens[i].classList.contains("active")) return screens[i]; return libraryEl; }

  // ---------- input ----------
  document.addEventListener("keydown", function (e) {
    var a = active(), handled = true;
    if (a === libraryEl) {
      if (e.key === "ArrowUp") { sel = (sel - 1 + items.length) % items.length; renderList(); }
      else if (e.key === "ArrowDown") { sel = (sel + 1) % items.length; renderList(); }
      else if (e.key === "Enter") { var it = items[sel]; if (it.type === "add") doUpload(); else openSong(it.rec); }
      else handled = false;
    } else if (a === setupEl) {
      if (e.key === "ArrowUp") { setupSel = (setupSel - 1 + setupRows.length) % setupRows.length; renderSetup(); }
      else if (e.key === "ArrowDown") { setupSel = (setupSel + 1) % setupRows.length; renderSetup(); }
      else if (e.key === "ArrowLeft") setupAdjust(-1);
      else if (e.key === "ArrowRight") setupAdjust(1);
      else if (e.key === "Enter") setupEnter();
      else handled = false;
    } else {
      var p = (a === chartEl) ? chart : player;
      switch (e.key) {
        case "Enter": p.toggle(); break;
        case "ArrowUp": p.tempo(2); break;
        case "ArrowDown": p.tempo(-2); break;
        case "ArrowLeft": p.back(); break;
        case "ArrowRight": p.skip(); break;
        default: handled = false;
      }
    }
    if (handled) e.preventDefault();
  });
  // desktop fallbacks: click toggles play; setup rows are clickable
  playerEl.addEventListener("click", function () { player.toggle(); });
  chartEl.addEventListener("click", function () { chart.toggle(); });
  setupRows = Array.prototype.slice.call(document.querySelectorAll("#sRows .srow"));
  setupRows.forEach(function (r, i) {
    r.addEventListener("click", function (e) {
      setupSel = i; renderSetup();
      var k = r.dataset.k;
      if (k === "transpose" || k === "capo") setupAdjust(e.offsetX < r.clientWidth / 2 ? -1 : 1); else setupEnter();
    });
  });
  window.addEventListener("focus", function () { active().focus(); });

  // ---------- deep link + overlay capture ----------
  // ?chart=<id>[&transpose=N][&capo=N]  opens a chord song straight into the chart (paused at the start)
  function deepLink() {
    var q = {}; location.search.slice(1).split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ""); });
    if (q.score) {                                     // score songs: open the notation player directly
      return SS.Library.get(q.score).then(function (rec) {
        if (!rec || isChords(rec)) return false;
        openSong(rec);
        return true;
      });
    }
    if (!q.chart) return Promise.resolve(false);
    return SS.Library.get(q.chart).then(function (rec) {
      if (!rec || !isChords(rec)) return false;
      openChords(rec);
      if (q.transpose !== undefined) cur.set.transpose = parseInt(q.transpose, 10) || 0;
      if (q.capo !== undefined) cur.set.capo = parseInt(q.capo, 10) || 0;
      cur.set.click = false;
      showChart();
      chart.load(cur.song, { transpose: cur.set.transpose, capo: cur.set.capo, click: false });
      return true;
    });
  }
  function captureTarget() { return chartEl.classList.contains("active") ? chart : player; }
  window.ScoreCapture = {
    info: function () { return captureTarget().info(); },
    seek: function (beat, arg) { captureTarget().capture(beat, arg); },
    transparent: function () {           // for alpha overlay frames: black = transparent on the glasses anyway
      document.documentElement.style.background = "transparent"; document.body.style.background = "transparent";
      $("stage").style.background = "transparent";
    },
  };

  // ---------- boot ----------
  SS.Library.seedSamples().then(refresh).then(deepLink).then(function (opened) { if (!opened) libraryEl.focus(); });
})();
