/* beta/lib/copy-game.js — Copy Nova: she shows a pose, the player matches it. Pure (no DOM) → the page and the
   Node replay tests run the same code.

   Judge, per arm (the PLAYER'S OWN arm, beta/lib/arms.js):
     match = |elbow − target| ≤ 25°  AND  |upper − target| ≤ 30°  AND  the wrist on the pose's side of the shoulder line
   Two-arm poses need both arms. One-arm poses need the raised arm, and the other arm must not be up (if seen).
   A match must hold 3 frames in a row AND ≥ 0.6 s → ⭐. Window 6 s.
   [MEASURED 2026-10-17] 3 frames alone (0.12 s) starred poses the player only passed THROUGH: lowering her arms from
   armsUp, Nova's arms match bear for 0.38 s and star for 0.12 s; a real held pose matched 2.04–2.92 s in every clip
   (test/clips/README.md "Copy Nova targets"). 0.6 s sits between them with room on both sides.
   An arm with a joint < 0.30 is unscoreable. If the pose needs it for < 80 % of the window and nothing matched,
   the round SKIPS (no star, "I can't see you"). Otherwise no match = "not yet" (no star, never a fail).

   TARGETS — MEASURED from Nova's own demo clips (test/clips/*.json, MoveNet, pose-hold window, medians;
   table in test/clips/README.md "Copy Nova targets"). Tolerances are the mission's (±25° elbow, ±30° upper). */
import { toJudge, medalFor } from './kp.js';
import { arm } from './arms.js';

export const TOL = { elbow: 25, upper: 30 };     // mission Phase 3
// wrist side vs the shoulder line, in shoulder-widths: 'above' = wristUp > 0 · 'line' = |wristUp| ≤ 0.2 · 'high' = wristUp > 0.2 · 'down' = wristUp < 0
const SIDE = { above: w => w > 0, line: w => Math.abs(w) <= 0.2, high: w => w > 0.2, down: w => w < 0 };

export const POSES = {
  // pose-armsup.webm 1.0–2.6 s: L u149–161 e143–158 · R u161–164 e138–147 · wrists +1.2 sw
  armsUp:    { arms: { left: { upper: 155, elbow: 150, side: 'above' }, right: { upper: 155, elbow: 150, side: 'above' } } },
  // upperbody.webm 0–6 s (arms out): u78–97 e157–180 · wrists −0.19…+0.16 sw. 'line' band 0.2 sw keeps it apart from star (+0.27…+0.62)
  armsOut:   { arms: { left: { upper: 86, elbow: 170, side: 'line' }, right: { upper: 86, elbow: 170, side: 'line' } } },
  // pose-star.webm 1.0–3.5 s: L u96–107 · R u107–123 · e140–170 · wrists +0.27…+0.62 sw
  star:      { arms: { left: { upper: 104, elbow: 162, side: 'high' }, right: { upper: 110, elbow: 162, side: 'high' } } },
  // pose-bear.webm 1.5–3.5 s: u116–124 · e124–136 · wrists +0.94…+1.05 sw
  bear:      { arms: { left: { upper: 118, elbow: 128, side: 'above' }, right: { upper: 122, elbow: 134, side: 'above' } } },
  // own-left-up.webm 1.6–2.6 s: raised L u172–174 e147–156 · other R u4–5 e179, wrist −1.4 · own-right-up.webm: raised R u160–162 e150–155
  leftUp:    { arms: { left: { upper: 167, elbow: 152, side: 'above' } }, otherDown: 'right' },
  rightUp:   { arms: { right: { upper: 167, elbow: 152, side: 'above' } }, otherDown: 'left' },
  // no Nova clip of this pose in the repo // GUESS — replace at Phase 2 (elbows out and up, hands folded onto the head)
  handsHead: { arms: { left: { upper: 120, elbow: 45, side: 'above' }, right: { upper: 120, elbow: 45, side: 'above' } } },
};

export const COPY_PACE = { showS: 1.6, windowS: 6, resultS: 1.6, confirmN: 3, confirmS: 0.6, seenMin: 0.8, lostS: 1.0 };
export const ROUND_POSES = ['armsUp', 'leftUp', 'armsOut', 'rightUp', 'star', 'bear'];

/* judge one frame against a pose → { ok, need: arms the pose needs and can't see, l, r (0..1 closeness for the rings), wrong } */
export function judgePose(name, k, w, h){
  const P = POSES[name], out = { ok: false, unseen: false, l: 0, r: 0, wrong: null };
  let all = true;
  for (const [side, tgt] of Object.entries(P.arms)){
    const a = k ? arm(k, side, w, h) : null;
    if (!a){ out.unseen = true; all = false; continue; }
    const de = Math.abs(a.elbow - tgt.elbow), du = Math.abs(a.upper - tgt.upper), sideOk = SIDE[tgt.side](a.wristUp);
    const match = de <= TOL.elbow && du <= TOL.upper && sideOk;
    out[side === 'left' ? 'l' : 'r'] = match ? 1 : Math.max(0, 1 - Math.max(de / (TOL.elbow * 3), du / (TOL.upper * 3)));
    if (!match) all = false;
  }
  /* one-arm poses: the OTHER arm must be SEEN down. [NIGHT-A 2026-10-17] it used to pass when that arm was unseen —
     test/clips/edge/pose-armsup.one-arm-hidden (both arms up, left hidden) then starred rightUp. Unseen = unscoreable. */
  if (P.otherDown){ const o = k ? arm(k, P.otherDown, w, h) : null;
    if (!o){ out.unseen = true; all = false; }
    else if (!SIDE.down(o.wristUp)){ all = false; out.wrong = P.otherDown === 'left' ? 'l' : 'r'; } }
  out.ok = all && !out.unseen;
  return out;
}

export function createCopyGame({ poses = ROUND_POSES, pace = {}, on = () => {}, size = { w: 640, h: 480 } }){
  const P = { ...COPY_PACE, ...pace };
  const S = { phase: 'idle', round: 0, until: 0, pose: null, run: 0, frames: 0, seenFrames: 0, stars: 0, skips: 0, judged: 0, results: [], lastSeen: -1e9, seen: null, last: null };
  const emit = (type, d = {}) => on(type, { ...d, round: S.round, phase: S.phase, pose: S.pose });
  const set = (phase, until) => { S.phase = phase; S.until = until; emit('phase', { until }); };

  function start(t){ next(t); }
  function next(t){ S.round++; S.pose = poses[(S.round - 1) % poses.length]; S.run = 0; S.frames = 0; S.seenFrames = 0; S.done = false; set('show', t + P.showS); }

  function feed(frame, t){
    const k = toJudge(frame);
    const present = !!(k && k.lShoulder && k.rShoulder); if (present) S.lastSeen = t;
    seenCheck(t);
    if (S.phase !== 'match' || S.done) { if (S.phase === 'show' && S.pose) S.last = judgePose(S.pose, k, size.w, size.h); return; }
    const j = judgePose(S.pose, k, size.w, size.h); S.last = j;
    S.frames++; if (!j.unseen) S.seenFrames++;
    if (j.ok){ if (!S.run) S.runT = t; S.run++; } else S.run = 0;
    emit('progress', { l: j.l, r: j.r, wrong: j.wrong, ok: j.ok });
    emit('hold', { p: S.run ? Math.min(1, (t - S.runT) / P.confirmS) : 0 });
    if (S.run >= P.confirmN && t - S.runT >= P.confirmS){ S.done = true; S.stars++; S.judged++; result('star', t); }
  }
  function seenCheck(t){ const seen = t - S.lastSeen < P.lostS; if (seen !== S.seen){ S.seen = seen; emit('seen', { seen }); } }

  function tick(t){
    seenCheck(t);
    if (S.phase === 'idle' || S.phase === 'end' || t < S.until) return;
    if (S.phase === 'show'){ S.winT0 = t; set('match', t + P.windowS); return; }
    if (S.phase === 'match' && !S.done){
      const seenFrac = S.frames ? S.seenFrames / S.frames : 0;
      if (seenFrac < P.seenMin){ S.skips++; result('skip', t, seenFrac); } else { S.judged++; result('notyet', t, seenFrac); }
      return;
    }
    if (S.phase === 'result'){ if (S.round >= poses.length) finish(); else next(t); }
  }
  function result(outcome, t, seenFrac){
    const r = { round: S.round, pose: S.pose, outcome, t0: +(S.winT0 ?? t).toFixed(3), t1: +t.toFixed(3), seen: +(seenFrac ?? (S.frames ? S.seenFrames / S.frames : 0)).toFixed(3), frames: S.frames };
    S.results.push(r); set('result', t + P.resultS); emit(outcome, r);
  }
  function finish(){
    S.phase = 'end';
    emit('end', { rounds: S.results.length, stars: S.stars, skips: S.skips, judged: S.judged, medal: medalFor(S.stars, S.judged), results: S.results });
  }
  return { start, feed, tick, state: S, pace: P, setSize(w, h){ size = { w, h }; } };
}
