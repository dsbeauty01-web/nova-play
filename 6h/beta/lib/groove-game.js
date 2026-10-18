/* beta/lib/groove-game.js — Groove: move to the beat. Never a fail. Pure (no DOM) → page + Node replay tests.

   Song: freezegame/animal-freeze-song.mp3 — 129.2 BPM, first beat at 0.151 s (measured off the live Freeze:
   animal-freeze.html:350-351, copied into beta/freeze2/script.json "music").

   Signals (pixel space, all ÷ shoulder width, joints One-Euro smoothed):
     energy = mean joint speed of shoulders + elbows + wrists (sw/s), averaged over each beat
     bounce = the shoulder-mid's vertical oscillation; a dip's lowest point within ±150 ms of a beat = on-beat
     sway   = the shoulder-mid's horizontal oscillation (zero crossings), ≥ 0.15 sw from side to side
     arms   = either wrist above the shoulder line
   Scoring: 4 beats = 1 bar. ⭐ for a bar whose energy ≥ the floor. Bonus ⭐ every 8 bars if ≥ 50 % of the
   bounces in them were on-beat. A bar where the body was seen < 80 % of the time SKIPS (no star).
   Feet are never scored. */
import { toJudge } from './kp.js';

export const SONG = { src: '../freezegame/animal-freeze-song.mp3', bpm: 129.2, offsetS: 0.151 };
export const GROOVE = {
  bars: 16, beatsPerBar: 4,
  // floor = 2 × still-body noise. [NIGHT-A 2026-10-17] the 0.25 GUESS starred a FROZEN body on a jittery camera:
  // test/clips/edge/frozen-body.jitter (±3 px noise on a body that cannot move) reads 0.215 sw/s per bar (p50; p90
  // 0.218) → floor 2 × 0.215 = 0.43. Dancing reads 1.55–4.36 (dance-hype), so dancers are untouched.
  energyFloor: 0.43,       // STAND-IN measured on synthetic camera noise — replace with 2 × ref-still noise at Phase 2
  onBeatS: 0.15,           // mission: bounce within ±150 ms of a beat
  swayAmp: 0.15,           // mission: sway ≥ 0.15 sw
  bounceAmp: 0.04,         // GUESS — replace at Phase 2 (a dip this deep, in sw, counts as a bounce)
  bonusEvery: 8, bonusOnBeat: 0.5, bonusMinBounces: 4,
  seenMin: 0.8, lostS: 1.0, teleport: 0.8, introS: 2.0,
};
const JOINTS = ['lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist'];

class OneEuro { constructor(minC = 1.2, beta = 0.02, dC = 1){ this.minC = minC; this.beta = beta; this.dC = dC; this.x = null; this.dx = 0; this.t = null; }
  a(c, dt){ const tau = 1 / (2 * Math.PI * c); return 1 / (1 + tau / dt); }
  f(v, t){ if (this.x === null){ this.x = v; this.t = t; return v; } const dt = Math.max(1e-3, t - this.t); this.t = t;
    const dv = (v - this.x) / dt; this.dx += this.a(this.dC, dt) * (dv - this.dx); const c = this.minC + this.beta * Math.abs(this.dx); this.x += this.a(c, dt) * (v - this.x); return this.x; } }

export function createGrooveGame({ song = SONG, pace = {}, on = () => {}, size = { w: 640, h: 480 } }){
  const P = { ...GROOVE, ...pace }, beatS = 60 / song.bpm, barS = beatS * P.beatsPerBar;
  const F = {}; for (const j of JOINTS) F[j] = { x: new OneEuro(), y: new OneEuro() };
  const S = { phase: 'idle', t0: 0, beat0: 0, bar: 0, prev: null, prevT: 0, stars: 0, skips: 0, judged: 0, bonus: 0, results: [], lastSeen: -1e9, seen: null,
              barE: [], barFrames: 0, barSeen: 0, bounces: [], midY: null, midX: null, trendY: null, trendX: null, dyPrev: 0, lowY: null, lowT: 0, swayDir: 0, swayExt: null, sways: 0, arms: false };
  const emit = (type, d = {}) => on(type, { ...d, bar: S.bar, phase: S.phase });
  const nextBeat = t => { const n = Math.ceil((t - S.beat0) / beatS - 1e-6); return S.beat0 + Math.max(0, n) * beatS; };
  const nearestBeatDist = t => { const n = Math.round((t - S.beat0) / beatS); return Math.abs(t - (S.beat0 + n * beatS)); };

  /* start(t, beat0): beat0 = the game-clock time of the song's first beat (the page knows when the music started) */
  function start(t, beat0 = t + P.introS + song.offsetS){ S.t0 = t; S.beat0 = beat0; S.phase = 'intro'; emit('phase', { beatS }); }

  function feed(frame, t){
    const k = toJudge(frame);
    const sw = k?.lShoulder && k?.rShoulder ? Math.hypot((k.lShoulder.x - k.rShoulder.x) * size.w, (k.lShoulder.y - k.rShoulder.y) * size.h) : 0;
    const present = sw > 0; if (present) S.lastSeen = t;
    seenCheck(t);
    if (S.phase === 'bar') S.barFrames++;
    if (!present){ S.prev = null; return; }
    if (S.phase === 'bar') S.barSeen++;
    const cur = {};
    for (const j of JOINTS) if (k[j]) cur[j] = { x: F[j].x.f(k[j].x * size.w, t), y: F[j].y.f(k[j].y * size.h, t) };
    // energy: mean joint speed ÷ shoulder width
    if (S.prev){ const dt = Math.max(1 / 120, t - S.prevT); let s = 0, n = 0;
      for (const j of JOINTS) if (cur[j] && S.prev[j]){ const d = Math.hypot(cur[j].x - S.prev[j].x, cur[j].y - S.prev[j].y) / sw; if (d > P.teleport) continue; s += d; n++; }
      if (n >= 3 && S.phase === 'bar') S.barE.push(s / n / dt); }
    S.prev = cur; S.prevT = t;
    // bounce + sway from the shoulder-mid, de-trended over ~1 beat
    if (cur.lShoulder && cur.rShoulder){
      const my = (cur.lShoulder.y + cur.rShoulder.y) / 2 / sw, mx = (cur.lShoulder.x + cur.rShoulder.x) / 2 / sw;
      const a = Math.min(1, (t - (S.midT ?? t)) / beatS) || 0.05; S.midT = t;
      S.trendY = S.trendY == null ? my : S.trendY + (my - S.trendY) * a; S.trendX = S.trendX == null ? mx : S.trendX + (mx - S.trendX) * a;
      const dy = my - S.trendY, dx = mx - S.trendX;
      // bounce = the lowest point of a dip (y grows downward): dy rising then falling, deep enough
      if (S.dyLast != null){ const rising = dy > S.dyLast; if (S.wasRising && !rising && S.dyLast > P.bounceAmp && S.phase === 'bar') bounce(S.tLast); S.wasRising = rising; }
      S.dyLast = dy; S.tLast = t;
      // sway = a side-to-side swing of ≥ swayAmp between two turns
      const dir = Math.sign(dx - (S.dxLast ?? dx)); S.dxLast = dx;
      if (dir && dir !== S.swayDir){ if (S.swayExt != null && Math.abs(mx - S.swayExt) >= P.swayAmp && S.phase === 'bar'){ S.sways++; emit('sway', {}); } S.swayExt = mx; S.swayDir = dir; }
      const arms = !!((k.lWrist && k.lWrist.y < k.lShoulder.y) || (k.rWrist && k.rWrist.y < k.rShoulder.y));
      if (arms !== S.arms){ S.arms = arms; if (arms && S.phase === 'bar') emit('arms', {}); }
    }
  }
  function bounce(t){ const onBeat = nearestBeatDist(t) <= P.onBeatS; S.bounces.push({ t, onBeat, bar: S.bar }); emit('bounce', { onBeat }); }
  function seenCheck(t){ const seen = t - S.lastSeen < P.lostS; if (seen !== S.seen){ S.seen = seen; emit('seen', { seen }); } }

  function tick(t){
    seenCheck(t);
    if (S.phase === 'intro' && t >= S.beat0){ S.phase = 'bar'; S.bar = 1; S.barStart = S.beat0; resetBar(); emit('phase', { beatS }); return; }
    if (S.phase !== 'bar' || t < S.barStart + barS) return;
    closeBar(S.barStart + barS);
    if (S.bar >= P.bars){ finish(); return; }
    S.bar++; S.barStart += barS; resetBar(); emit('phase', { beatS });
  }
  function resetBar(){ S.barE = []; S.barFrames = 0; S.barSeen = 0; }
  function closeBar(t){
    const seen = S.barFrames ? S.barSeen / S.barFrames : 0;
    const energy = S.barE.length ? S.barE.reduce((a, b) => a + b, 0) / S.barE.length : 0;
    const bars = S.bounces.filter(b => b.bar === S.bar), on = bars.filter(b => b.onBeat).length;
    let outcome;
    if (seen < P.seenMin){ outcome = 'skip'; S.skips++; }
    else { S.judged++; outcome = energy >= P.energyFloor ? 'star' : 'notyet'; if (outcome === 'star') S.stars++; }
    const r = { bar: S.bar, outcome, t0: +(t - barS).toFixed(3), t1: +t.toFixed(3), energy: +energy.toFixed(3), seen: +seen.toFixed(3), bounces: bars.length, onBeat: on };
    S.results.push(r); emit(outcome, r);
    if (S.bar % P.bonusEvery === 0){                               // bonus: ≥ 50 % of the last 8 bars' bounces on the beat
      /* [NIGHT-A 2026-10-17] only bounces in bars that cleared the energy floor count: a frozen body on a jittery camera
         (edge/frozen-body.jitter) "bounced" on noise, and at ±150 ms random dips land on-beat 65 % of the time → 2 bonus
         stars with no move at all. */
      const moved = new Set(S.results.filter(x => x.outcome === 'star').map(x => x.bar));
      const B = S.bounces.filter(b => b.bar > S.bar - P.bonusEvery && b.bar <= S.bar && moved.has(b.bar)), n = B.filter(b => b.onBeat).length;
      const judgedHere = S.results.slice(-P.bonusEvery).some(x => x.outcome !== 'skip');
      if (judgedHere && B.length >= P.bonusMinBounces && n / B.length >= P.bonusOnBeat){ S.bonus++; S.stars++; emit('bonus', { bounces: B.length, onBeat: n }); }
    }
  }
  function finish(){
    S.phase = 'end';
    const base = S.stars - S.bonus;          // the medal is on the bars (bonus stars are extra)
    const medal = !S.judged || !base ? null : (base / S.judged >= 0.9 ? 'gold' : base / S.judged >= 0.6 ? 'silver' : 'bronze');
    emit('end', { rounds: S.results.length, stars: S.stars, bonus: S.bonus, skips: S.skips, judged: S.judged, medal, results: S.results,
                  bounces: S.bounces.length, onBeat: S.bounces.filter(b => b.onBeat).length, sways: S.sways });
  }
  return { start, feed, tick, state: S, pace: P, nextBeat, beatS, setSize(w, h){ size = { w, h }; } };
}
