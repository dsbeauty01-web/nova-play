/* beta/lib/freeze-game.js — Animal Freeze, the honest version. Pure (no DOM, no audio) → the page drives it
   and the Node replay tests run the very same code on recorded plays.

   The judge is beta/freeze2 (measured: docs/FREEZE2-MEASURED.md, test/freeze2_realdata_test.mjs).
   What changed against the live pod/pages/animal-freeze.html:
     · no `judge.ok || Pose.still` fallback — a round scores ONLY when the freeze2 Hold says 'held'
       AND the pose was present ≥ 80% of the freeze window (mission Phase 1.2);
     · no pose / no detector → the round SKIPS: no star, no penalty, the game moves on and always ends;
     · stars only, medal at the end; nothing numeric is emitted for the screen.

   Drive it:  g = createFreezeGame({ tune, on });  g.start(t);  per detection g.feed(frame|null, t);  per tick g.tick(t)
   frame = a play-recording frame (beta/lib/kp.js); null = the detector produced nothing (or threw). t in seconds. */
import { createJudges } from '../freeze2/judges.js';
import { Hold } from '../freeze2/hold.js';
import { toJudge, medalFor } from './kp.js';

export const FREEZE_PACE = {
  rounds: 6,
  // pacing, not judging: how long the music plays before it stops. Not a threshold.
  danceS: [6, 9],
  holdS: 2.5,       // the hold length the freeze2 judge was measured on (realdata test windows; script.json round 1)
  calibS: 2.0,      // freeze2 script.json calibrationS
  resultS: 1.6,     // how long the star/skip moment shows
  seenMin: 0.8,     // mission Phase 1.2: pose present ≥ 80% of the freeze window, or the round skips
  lostS: 1.0,       // no pose this long → "I can't see you — step back"
};

export const ANIMALS = ['flamingo', 'bear', 'frog', 'star', 'statue', 'bear'];

export function createFreezeGame({ tune, pace = {}, on = () => {}, rng = Math.random }){
  const P = { ...FREEZE_PACE, ...pace };
  const T = { ...tune, seenMin: P.seenMin };
  const J = createJudges(T);
  const S = { phase: 'idle', round: 0, until: 0, hold: null, stars: 0, skips: 0, judged: 0, results: [], lastSeen: -1e9, seen: null, t: 0, calib: null };

  const emit = (type, data = {}) => on(type, { ...data, round: S.round, phase: S.phase });
  const set = (phase, until) => { S.phase = phase; S.until = until; emit('phase', { until }); };
  const danceLen = () => P.danceS[0] + rng() * (P.danceS[1] - P.danceS[0]);

  function start(t){ S.t = t; J.startSample('still'); set('calib', t + P.calibS); }

  function feed(frame, t){
    S.t = t;
    const k = toJudge(frame);
    if (k){ J.update(k, t); }
    if (S.phase === 'freeze' && S.hold) S.hold.feed(k && J.sw(k) ? k : null, t);
    const present = !!(k && J.sw(k));
    if (present) S.lastSeen = t;
    seenCheck(t);
  }
  function seenCheck(t){
    const seen = t - S.lastSeen < P.lostS;
    if (seen !== S.seen){ S.seen = seen; emit('seen', { seen }); }
  }

  function tick(t){
    S.t = t; seenCheck(t);
    if (S.phase === 'idle' || S.phase === 'end') return;
    if (t < S.until) return;
    if (S.phase === 'calib'){ J.stopSample(); S.calib = J.finishCalibration(); emit('calibrated', { thrMove: S.calib.thr.move }); nextRound(t); return; }
    if (S.phase === 'dance'){ S.hold = new Hold(J, t, P.holdS, T); set('freeze', t + P.holdS); emit('freeze', { animal: ANIMALS[(S.round - 1) % ANIMALS.length] }); return; }
    if (S.phase === 'freeze'){ judge(t); return; }
    if (S.phase === 'result'){ if (S.round >= P.rounds) finish(); else nextRound(t); }
  }

  function nextRound(t){ S.round++; S.hold = null; set('dance', t + danceLen()); }

  function judge(t){
    const h = S.hold, res = h.result ?? h.finish();
    const seenFrac = h.frames ? h.seen / h.frames : 0;
    let outcome;
    if (res === 'noshow') { outcome = 'skip'; S.skips++; }                  // not seen ≥ 80% → never judged
    else { S.judged++; if (res === 'held') { outcome = 'star'; S.stars++; } else outcome = 'notyet'; }
    const r = { round: S.round, outcome, t0: +h.t0.toFixed(3), t1: +(h.t0 + h.dur).toFixed(3), hold: res, seen: +seenFrac.toFixed(3), frames: h.frames, maxE: +h.maxE.toFixed(3), thrMove: +J.st.thr.move.toFixed(3) };
    S.results.push(r);
    set('result', t + P.resultS);
    emit(outcome, r);
  }

  function finish(){
    S.phase = 'end';
    const summary = { rounds: S.results.length, stars: S.stars, skips: S.skips, judged: S.judged, medal: medalFor(S.stars, S.judged), results: S.results };
    emit('end', summary);
  }

  return { start, feed, tick, state: S, judges: J, pace: P };
}
