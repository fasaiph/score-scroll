// WS-D ($0 MVP) — local library in IndexedDB. Stores the MusicXML text (small) and
// re-renders on open, so there's no asset storage and no account required. Swap this
// module for the API client (Contract 3) when cloud sync lands.

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

    // first-run: seed the two bundled demo scores so the library isn't empty
    seedSamples: async function () {
      var existing = await this.list();
      if (existing.length) return existing;
      var samples = [
        { id: "sample-tokyo", title: "My Name is Tokyo", file: "samples/tokyo.musicxml", bpm: 120, sample: true },
        { id: "sample-losingu", title: "Losing U", file: "samples/losingu.musicxml", bpm: 122, sample: true },
      ];
      for (var i = 0; i < samples.length; i++) {
        try {
          var xml = await fetch(samples[i].file).then(function (r) { return r.text(); });
          await this.save({ id: samples[i].id, title: samples[i].title, instrument: "violin",
            xml: xml, bpm: samples[i].bpm, countIn: 4, sample: true });
        } catch (e) { /* samples are best-effort */ }
      }
      return this.list();
    },
  };
})();
