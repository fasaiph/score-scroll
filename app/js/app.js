// Glue: library <-> render <-> player, plus input (arrow keys + Enter for glasses,
// clicks for desktop). MVP, $0 path — no accounts, no server.
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };

  var libraryEl = $("library"), playerEl = $("player");
  var listEl = $("songList"), fileInput = $("fileInput");
  var notation = $("notation");

  var player = SS.Player({
    lane: $("lane"), strip: $("strip"), notation: notation, playhead: $("playhead"),
    countin: $("countin"), bpmEl: $("bpm"), stateEl: $("pState"),
    barNumEl: $("barNum"), barFill: $("barFill"),
    onBackAtStart: function () { showLibrary(); },
  });

  var items = [], sel = 0;

  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }

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
        d.innerHTML = "<span>➕ Upload MusicXML</span>";
        d.onclick = function () { sel = i; renderList(); doUpload(); };
      } else {
        var r = it.rec;
        d.innerHTML = '<span>🎻</span><span>' + esc(r.title) + '</span>' +
          '<span class="meta">' + (r.sample ? "sample" : (r.instrument || "violin")) + '</span>' +
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
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]; }); }

  function remove(rec) {
    SS.Library.remove(rec.id).then(refresh).then(function () { toast("Removed “" + rec.title + "”"); });
  }

  // ---------- upload ----------
  function doUpload() { player.unlockAudio(); fileInput.value = ""; fileInput.click(); }
  fileInput.addEventListener("change", function () {
    var f = fileInput.files && fileInput.files[0]; if (!f) return;
    readFile(f).then(function (xml) {
      var name = f.name.replace(/\.(musicxml|xml|mxl)$/i, "");
      return openFromXml(xml, { title: name, persist: true });
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
          SS.Library.save({ title: out.title !== "Untitled" ? out.title : opts.title,
            instrument: out.instrument, xml: xml, bpm: out.schedule.bpm, countIn: out.schedule.countIn })
            .then(function () { toast("Saved to your library"); });
        }
      });
  }

  // ---------- screens ----------
  function showPlayer(title) {
    $("pTitle").textContent = title || "—";
    libraryEl.classList.remove("active"); playerEl.classList.add("active"); playerEl.focus();
  }
  function showLibrary() {
    playerEl.classList.remove("active"); libraryEl.classList.add("active"); libraryEl.focus();
    refresh();
  }

  // ---------- input ----------
  document.addEventListener("keydown", function (e) {
    if (libraryEl.classList.contains("active")) {
      if (e.key === "ArrowUp") { sel = (sel - 1 + items.length) % items.length; renderList(); e.preventDefault(); }
      else if (e.key === "ArrowDown") { sel = (sel + 1) % items.length; renderList(); e.preventDefault(); }
      else if (e.key === "Enter") {
        var it = items[sel];
        if (it.type === "add") doUpload(); else openSong(it.rec);
        e.preventDefault();
      }
      return;
    }
    switch (e.key) {
      case "Enter": player.toggle(); e.preventDefault(); break;
      case "ArrowUp": player.tempo(2); e.preventDefault(); break;
      case "ArrowDown": player.tempo(-2); e.preventDefault(); break;
      case "ArrowLeft": player.back(); e.preventDefault(); break;
      case "ArrowRight": player.skip(); e.preventDefault(); break;
    }
  });
  // desktop fallback: click toggles play on the player screen
  playerEl.addEventListener("click", function () { player.toggle(); });
  window.addEventListener("focus", function () { (libraryEl.classList.contains("active") ? libraryEl : playerEl).focus(); });

  // ---------- boot ----------
  SS.Library.seedSamples().then(refresh).then(function () { libraryEl.focus(); });
})();
