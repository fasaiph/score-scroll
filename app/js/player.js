// WS-A — shared scroll engine. Drives a rendered notation element + schedule so each
// note crosses a fixed playhead exactly on its beat. Reused by the web and glasses views.
//
// SS.Player(refs) where refs = { lane, strip, notation, playhead, countin, bpmEl,
//   stateEl, barNumEl, barFill }. Callbacks: onBackAtStart() (← at start).

window.SS = window.SS || {};

SS.Player = function (refs) {
  var PLAYHEAD_X = 200, TARGET_H = 280, LANE_H = 300;

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

  var sched = null, scale = 1, pxPerBeat = 100, firstBeat = 0, lastBeat = 0, bars = 1;
  var bpm = 120, playing = false, pos = 0, lastBeatClicked = -999, playFromBeat = 0;
  var rafOn = false;

  function setSchedule(schedule) {
    sched = schedule; bpm = schedule.bpm;
    scale = TARGET_H / schedule.heightPx;
    var p = schedule.points;
    firstBeat = p[0].beat; lastBeat = p[p.length - 1].beat;
    pxPerBeat = ((p[p.length - 1].x - p[0].x) / (lastBeat - firstBeat)) * scale;
    bars = Math.ceil((lastBeat + 1) / schedule.beatsPerBar);
    // scale the notation to the target height; the strip translates, the notation is centered
    refs.notation.style.transformOrigin = "top left";
    refs.notation.style.transform = "scale(" + scale + ")";
    refs.strip.style.top = Math.round((LANE_H - TARGET_H) / 2) + "px";
    refs.bpmEl.textContent = bpm;
    resetToStart(); draw();
    if (!rafOn) { rafOn = true; requestAnimationFrame(frame); }
  }

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

  function barStartOf(beat) {
    var bpb = sched.beatsPerBar, songStartBar = Math.floor(firstBeat / bpb) * bpb;
    return Math.max(songStartBar, Math.floor((beat + 0.001) / bpb) * bpb);
  }

  function setPlaying(p) {
    playing = p;
    refs.stateEl.textContent = p ? "playing" : "paused";
    refs.stateEl.className = "v " + (p ? "playing" : "paused");
    if (p) { audio(); lastT = 0; }
  }
  function resetToStart() { playFromBeat = barStartOf(firstBeat); pos = playFromBeat; lastBeatClicked = Math.floor(pos) - 1; setPlaying(false); }
  function seekBeat(target) {
    target = Math.max(barStartOf(firstBeat), Math.min(lastBeat + 1, target));
    playFromBeat = barStartOf(target); pos = target; lastBeatClicked = Math.floor(pos) - 1;
  }

  function draw() {
    if (!sched) return;
    var anchor = (pos < playFromBeat) ? playFromBeat : pos;
    refs.strip.style.transform = "translate3d(" + (PLAYHEAD_X - stripX(anchor)) + "px,0,0)";
    if (playing && pos < playFromBeat) { refs.countin.textContent = Math.ceil(playFromBeat - pos); refs.countin.style.opacity = 0.95; }
    else refs.countin.style.opacity = 0;
    refs.barNumEl.textContent = Math.min(bars, Math.floor(anchor / sched.beatsPerBar) + 1);
    var prog = Math.max(0, Math.min(1, (anchor - firstBeat) / ((lastBeat - firstBeat) || 1)));
    refs.barFill.style.width = (prog * 100).toFixed(1) + "%";
  }

  var lastT = 0;
  function frame(now) {
    if (!lastT) lastT = now; var dt = (now - lastT) / 1000; lastT = now; if (dt > 0.25) dt = 0.25;
    if (playing && sched) {
      pos += dt * (bpm / 60);
      var b = Math.floor(pos);
      if (b !== lastBeatClicked) { lastBeatClicked = b; click(b % sched.beatsPerBar === 0); }
      if (pos >= lastBeat + 1) resetToStart();
    }
    draw();
    requestAnimationFrame(frame);
  }

  // begin from the current bar's start, after a count-in
  function startCountIn() {
    var shown = (pos < playFromBeat) ? playFromBeat : pos;
    playFromBeat = barStartOf(shown);
    pos = playFromBeat - (sched.countIn || 4);
    lastBeatClicked = Math.floor(pos) - 1;
    setPlaying(true);
  }

  return {
    setSchedule: setSchedule,
    unlockAudio: function () { audio(); },
    toggle: function () { audio(); if (playing) setPlaying(false); else startCountIn(); },
    tempo: function (d) { bpm = Math.max(40, Math.min(220, bpm + d)); refs.bpmEl.textContent = bpm; },
    back: function () {
      var bpb = sched.beatsPerBar, ref = (pos < playFromBeat) ? playFromBeat : pos;
      if (!playing && ref <= barStartOf(firstBeat) + 0.01) { if (refs.onBackAtStart) refs.onBackAtStart(); return; }
      var bs = Math.floor((ref + 1e-6) / bpb) * bpb;
      seekBeat((ref - bs > 0.25) ? bs : bs - bpb);
    },
    skip: function () { var ref = (pos < playFromBeat) ? playFromBeat : pos; seekBeat(barStartOf(ref) + sched.beatsPerBar); },
    isPlaying: function () { return playing; },
  };
};
