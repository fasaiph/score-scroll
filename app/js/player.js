// WS-A — shared scroll engine.
//
// SS.Transport(cfg) is the instrument-agnostic clock: BPM, count-in, optional
// metronome click, bar navigation, HUD (tempo/state/bar/progress). It knows
// nothing about what is on screen — a view supplies cfg.onDraw(anchorBeat, st)
// and positions itself. Two views use it:
//   • SS.Player (below)      — notation strip, (beat -> x) schedule, R->L scroll
//   • SS.Chart  (chart.js)   — chord/lyric chart (guitar + singer)
//
// SS.Transport(cfg) where cfg = { countin, bpmEl, stateEl, barNumEl, barFill,
//   onDraw(anchor, st), onBackAtStart() }.
// transport.load({ bpm, beatsPerBar, firstBeat, lastBeat, countIn, click })

window.SS = window.SS || {};

SS.Transport = function (cfg) {
  // metronome (Web Audio) — must be unlocked from a user gesture
  var ac = null;
  function audio() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === "suspended") ac.resume();
    return ac;
  }
  function click(strong) {
    var a = audio(); if (!a) return; var t = a.currentTime;
    var o = a.createOscillator(), g = a.createGain();
    o.frequency.value = strong ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(strong ? 0.55 : 0.4, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.08);
  }

  var song = null, bpm = 120, bpb = 4, firstBeat = 0, lastBeat = 0, bars = 1, countIn = 4;
  var clickOn = true, playing = false, pos = 0, lastBeatClicked = -999, playFromBeat = 0;
  var rafOn = false, lastT = 0, captureMode = false;   // capture: pos driven externally, rAF inert

  function load(s) {
    song = s; bpm = s.bpm; bpb = s.beatsPerBar || 4;
    firstBeat = s.firstBeat; lastBeat = s.lastBeat; countIn = s.countIn || 4;
    if (s.click !== undefined) clickOn = !!s.click;
    bars = Math.ceil((lastBeat + 1) / bpb);
    cfg.bpmEl.textContent = bpm;
    resetToStart(); draw();
    if (!rafOn) { rafOn = true; requestAnimationFrame(frame); }
  }

  function barStartOf(beat) {
    var songStartBar = Math.floor(firstBeat / bpb) * bpb;
    return Math.max(songStartBar, Math.floor((beat + 0.001) / bpb) * bpb);
  }
  function setPlaying(p) {
    playing = p;
    cfg.stateEl.textContent = p ? "playing" : "paused";
    cfg.stateEl.className = "v " + (p ? "playing" : "paused");
    if (p) { audio(); lastT = 0; }
  }
  function resetToStart() { playFromBeat = barStartOf(firstBeat); pos = playFromBeat; lastBeatClicked = Math.floor(pos) - 1; setPlaying(false); }
  function seekBeat(target) {
    target = Math.max(barStartOf(firstBeat), Math.min(lastBeat + 1, target));
    playFromBeat = barStartOf(target); pos = target; lastBeatClicked = Math.floor(pos) - 1;
  }

  function draw() {
    if (!song) return;
    var countingIn = playing && pos < playFromBeat;
    var anchor = (pos < playFromBeat) ? playFromBeat : pos;
    if (countingIn) { cfg.countin.textContent = Math.ceil(playFromBeat - pos); cfg.countin.style.opacity = 0.95; }
    else cfg.countin.style.opacity = 0;
    cfg.barNumEl.textContent = Math.min(bars, Math.floor(anchor / bpb) + 1);
    var prog = Math.max(0, Math.min(1, (anchor - firstBeat) / ((lastBeat - firstBeat) || 1)));
    cfg.barFill.style.width = (prog * 100).toFixed(1) + "%";
    if (cfg.onDraw) cfg.onDraw(anchor, { pos: pos, playing: playing, countingIn: countingIn, playFromBeat: playFromBeat, beatsPerBar: bpb, bpm: bpm });
  }

  function frame(now) {
    if (captureMode) { requestAnimationFrame(frame); return; }
    if (!lastT) lastT = now; var dt = (now - lastT) / 1000; lastT = now; if (dt > 0.25) dt = 0.25;
    if (playing && song) {
      pos += dt * (bpm / 60);
      var b = Math.floor(pos);
      if (b !== lastBeatClicked) { lastBeatClicked = b; if (clickOn) click(((b % bpb) + bpb) % bpb === 0); }
      if (pos >= lastBeat + 1) resetToStart();
    }
    draw();
    requestAnimationFrame(frame);
  }

  // begin from the current bar's start, after a count-in
  function startCountIn() {
    var shown = (pos < playFromBeat) ? playFromBeat : pos;
    playFromBeat = barStartOf(shown);
    pos = playFromBeat - countIn;
    lastBeatClicked = Math.floor(pos) - 1;
    setPlaying(true);
  }

  return {
    load: load,
    unlockAudio: function () { audio(); },
    toggle: function () { audio(); if (playing) setPlaying(false); else startCountIn(); },
    pause: function () { if (playing) setPlaying(false); },
    tempo: function (d) { bpm = Math.max(40, Math.min(240, bpm + d)); cfg.bpmEl.textContent = bpm; },
    setClick: function (on) { clickOn = !!on; },
    back: function () {
      var ref = (pos < playFromBeat) ? playFromBeat : pos;
      if (!playing && ref <= barStartOf(firstBeat) + 0.01) { if (cfg.onBackAtStart) cfg.onBackAtStart(); return; }
      var bs = Math.floor((ref + 1e-6) / bpb) * bpb;
      seekBeat((ref - bs > 0.25) ? bs : bs - bpb);
    },
    skip: function () { var ref = (pos < playFromBeat) ? playFromBeat : pos; seekBeat(barStartOf(ref) + bpb); },
    isPlaying: function () { return playing; },
    barStartOf: barStartOf,
    // offline overlay capture: render the exact frame for `beat`.
    // opts: { playFrom: anchor bar-start beat (count-in shows while beat < playFrom),
    //         paused: render the paused state (frozen strip, no count-in) }
    capture: function (beat, opts) {
      opts = (opts && typeof opts === "object") ? opts : {};
      captureMode = true;
      playFromBeat = (opts.playFrom !== undefined) ? opts.playFrom : barStartOf(firstBeat);
      playing = !opts.paused;
      var st = opts.paused ? "paused" : "playing";
      cfg.stateEl.textContent = st; cfg.stateEl.className = "v " + st;
      pos = beat; draw();
    },
    info: function () { return { firstBeat: firstBeat, lastBeat: lastBeat, bpm: bpm, countIn: countIn, beatsPerBar: bpb, bars: bars }; },
  };
};

// ---------------------------------------------------------------------------
// SS.Player(refs) — notation view. Drives a rendered notation element + schedule
// so each note crosses a fixed playhead exactly on its beat.
// refs = { lane, strip, notation, playhead, countin, bpmEl, stateEl, barNumEl,
//   barFill, onBackAtStart }.
SS.Player = function (refs) {
  var PLAYHEAD_X = 200, TARGET_H = 280, LANE_H = 300;
  var sched = null, scale = 1, pxPerBeat = 100;

  function stripX(beat) {
    var p = sched.points, n = p.length;
    if (beat <= p[0].beat) return (p[0].x - (p[0].beat - beat) * (pxPerBeat / scale)) * scale;
    if (beat >= p[n - 1].beat) return (p[n - 1].x + (beat - p[n - 1].beat) * (pxPerBeat / scale)) * scale;
    for (var i = 0; i < n - 1; i++) {
      if (beat >= p[i].beat && beat <= p[i + 1].beat) {
        var t = (beat - p[i].beat) / (p[i + 1].beat - p[i].beat);
        return (p[i].x + t * (p[i + 1].x - p[i].x)) * scale;
      }
    }
    return p[n - 1].x * scale;
  }

  var tr = SS.Transport({
    countin: refs.countin, bpmEl: refs.bpmEl, stateEl: refs.stateEl, barNumEl: refs.barNumEl, barFill: refs.barFill,
    onBackAtStart: refs.onBackAtStart,
    onDraw: function (anchor) {
      if (!sched) return;
      refs.strip.style.transform = "translate3d(" + (PLAYHEAD_X - stripX(anchor)) + "px,0,0)";
    },
  });

  function setSchedule(schedule) {
    sched = schedule;
    scale = TARGET_H / schedule.heightPx;
    var p = schedule.points, firstBeat = p[0].beat, lastBeat = p[p.length - 1].beat;
    pxPerBeat = ((p[p.length - 1].x - p[0].x) / (lastBeat - firstBeat)) * scale;
    // scale the notation to the target height; the strip translates, the notation is centered
    refs.notation.style.transformOrigin = "top left";
    refs.notation.style.transform = "scale(" + scale + ")";
    refs.strip.style.top = Math.round((LANE_H - TARGET_H) / 2) + "px";
    tr.load({ bpm: schedule.bpm, beatsPerBar: schedule.beatsPerBar, firstBeat: firstBeat, lastBeat: lastBeat,
      countIn: schedule.countIn || 4, click: true });
  }

  return {
    setSchedule: setSchedule,
    unlockAudio: tr.unlockAudio, toggle: tr.toggle, pause: tr.pause, tempo: tr.tempo,
    back: tr.back, skip: tr.skip, isPlaying: tr.isPlaying,
    capture: tr.capture, info: tr.info,
  };
};
