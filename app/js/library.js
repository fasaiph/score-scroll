// WS-D ($0 MVP) — local library in IndexedDB. Stores the source text (MusicXML for
// score songs, ChordPro for chord charts — both small) and re-renders on open, so
// there's no asset storage and no account required. Swap this module for the API
// client (Contract 3) when cloud sync lands.
// Record: { id, title, type:"score"|"chords", instrument, xml|chordpro, bpm, countIn,
//           transpose, capo, click, sample, createdAt }

window.SS = window.SS || {};

SS.Library = (function () {
  var DB = "scorescroll", STORE = "songs", db = null;

  function open() {
    return new Promise(function (resolve, reject) {
      if (db) return resolve(db);
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function tx(mode) { return open().then(function (d) { return d.transaction(STORE, mode).objectStore(STORE); }); }
  function asPromise(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }

  return {
    list: function () {
      return tx("readonly").then(function (s) { return asPromise(s.getAll()); })
        .then(function (all) { return all.sort(function (a, b) { return b.createdAt - a.createdAt; }); });
    },
    get: function (id) { return tx("readonly").then(function (s) { return asPromise(s.get(id)); }); },
    save: function (rec) {
      rec.id = rec.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      rec.createdAt = rec.createdAt || Date.now();
      return tx("readwrite").then(function (s) { return asPromise(s.put(rec)); }).then(function () { return rec; });
    },
    remove: function (id) { return tx("readwrite").then(function (s) { return asPromise(s.delete(id)); }); },

    // seed the bundled demo songs (score + chord charts) — adds any that are missing
    seedSamples: async function () {
      var existing = await this.list(), have = {};
      existing.forEach(function (r) { have[r.id] = 1; });
      var samples = [
        { id: "sample-tokyo", title: "My Name is Tokyo", file: "samples/tokyo.musicxml", type: "score", instrument: "violin", bpm: 120 },
        { id: "sample-losingu", title: "Losing U", file: "samples/losingu.musicxml", type: "score", instrument: "violin", bpm: 122 },
        { id: "sample-planet", title: "Planet in the Sky", file: "samples/planet.musicxml", type: "score", instrument: "violin", bpm: 120 },
        { id: "sample-fur-elise", title: "Für Elise", file: "samples/fur-elise.musicxml", type: "score", instrument: "piano", bpm: 144 },
        { id: "sample-cant-help", title: "Can't Help Falling in Love", file: "samples/cant-help-falling-in-love.cho", type: "chords", instrument: "guitar" },
      ];
      // retire samples no longer in the list (uploads are untouched)
      var keep = {}; samples.forEach(function (sm) { keep[sm.id] = 1; });
      for (var j = 0; j < existing.length; j++) {
        if (existing[j].sample && !keep[existing[j].id]) await this.remove(existing[j].id);
      }
      for (var i = 0; i < samples.length; i++) {
        var sm = samples[i]; if (have[sm.id]) continue;
        try {
          var text = await fetch(sm.file).then(function (r) { return r.text(); });
          var rec = { id: sm.id, title: sm.title, type: sm.type, instrument: sm.instrument, sample: true, createdAt: 1 + i };
          if (sm.type === "chords") rec.chordpro = text; else { rec.xml = text; rec.bpm = sm.bpm; rec.countIn = 4; }
          await this.save(rec);
        } catch (e) { /* samples are best-effort */ }
      }
      return this.list();
    },
  };
})();
