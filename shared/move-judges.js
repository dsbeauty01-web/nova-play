/* shared/move-judges.js — one judge per ACTION, for every Nova game. Pure (no DOM) → tested in Node (test/move_judges_test.mjs).
   Every judge returns PROGRESS 0..1 per body part (what the lights show while the child moves) + ok (the action is done).
   All distances are in the child's own body units (shoulder widths / torso lengths) — near, far, big, small children behave the same.
   Keypoints in: { nose, lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle } → {x, y, vis}
   normalized 0..1, y DOWN, un-mirrored (the kit's format). "left" = the child's own left.
   Written by the architect. */

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seen = (p, min = 0.35) => !!p && (p.vis ?? 1) >= min;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ───────── keypoint smoother: feed raw kit keypoints, judges read the smoothed ones ───────── */
class OneEuro { constructor(minC = 1.0, beta = 0.02, dC = 1){ this.minC = minC; this.beta = beta; this.dC = dC; this.x = null; this.dx = 0; this.t = null; }
  a(c, dt){ const tau = 1 / (2 * Math.PI * c); return 1 / (1 + tau / dt); }
  f(v, t){ if (this.x === null){ this.x = v; this.t = t; return v; } const dt = Math.max(1e-3, t - this.t); this.t = t;
    const dv = (v - this.x) / dt; this.dx += this.a(this.dC, dt) * (dv - this.dx); const c = this.minC + this.beta * Math.abs(this.dx); this.x += this.a(c, dt) * (v - this.x); return this.x; } }
export class KeypointSmoother {
  constructor(o = {}){ this.o = Object.assign({ minCutoff: 1.0, beta: 0.02 }, o); this.f = {}; }
  update(k, t){ if (!k) return k; const out = {};
    for (const [n, p] of Object.entries(k)){ if (!p || typeof p.x !== 'number'){ out[n] = p; continue; }
      const F = this.f[n] || (this.f[n] = { x: new OneEuro(this.o.minCutoff, this.o.beta), y: new OneEuro(this.o.minCutoff, this.o.beta) });
      out[n] = { x: F.x.f(p.x, t), y: F.y.f(p.y, t), vis: p.vis }; }
    return out; }
}

/* ───────── body frame: everything else is measured in these units ───────── */
export function body(k){
  if (!seen(k?.lShoulder) || !seen(k?.rShoulder)) return null;
  const sw = Math.max(0.02, dist(k.lShoulder, k.rShoulder));
  const sh = mid(k.lShoulder, k.rShoulder);
  const hips = seen(k.lHip) && seen(k.rHip);
  const hp = hips ? mid(k.lHip, k.rHip) : { x: sh.x, y: sh.y + 1.5 * sw };
  const torso = Math.max(0.03, hp.y - sh.y);
  const reach = 1.35 * sw;                                   // a child's arm ≈ 1.35 shoulder widths (shoulder → wrist)
  const feet = seen(k.lAnkle) && seen(k.rAnkle);
  return { sw, sh, hp, torso, reach, hips, feet };
}

/* ───────── ARMS: one progress per arm for each target pose ───────── */
function armUp(k, B, s){          // wrist high above its shoulder, elbow above the shoulder line too
  const S = k[s + 'Shoulder'], E = k[s + 'Elbow'], W = k[s + 'Wrist']; if (!seen(W)) return 0;
  const h = (S.y + B.reach - W.y) / (1.95 * B.reach);        // 0 = hanging down · 0.5 = out to the side · 1 = straight up (a V counts: ~0.87)
  const elbowUp = seen(E) ? clamp((S.y - E.y) / (0.35 * B.reach) + 0.5) : 1;
  return clamp(h) * (0.6 + 0.4 * elbowUp);
}
function armOut(k, B, s){          // wrist far to the side, at shoulder height
  const S = k[s + 'Shoulder'], W = k[s + 'Wrist']; if (!seen(W)) return 0;
  const sideSign = s === 'l' ? Math.sign(k.lShoulder.x - k.rShoulder.x) : Math.sign(k.rShoulder.x - k.lShoulder.x);   // "outward" in image coords
  const out = ((W.x - S.x) * sideSign) / (0.8 * B.reach);
  const level = 1 - clamp(Math.abs(W.y - S.y) / (0.5 * B.reach));
  return clamp(out) * level;
}
function armDown(k, B, s){         // resting: wrist below the shoulder
  const S = k[s + 'Shoulder'], W = k[s + 'Wrist']; if (!seen(W)) return 1;
  return clamp((W.y - S.y) / (0.5 * B.reach));
}
function handOnHead(k, B, s){      // wrist at the top of the head
  const W = k[s + 'Wrist']; if (!seen(W) || !seen(k.nose)) return 0;
  const top = { x: k.nose.x, y: k.nose.y - 0.45 * B.sw };
  return clamp(1 - (dist(W, top) - 0.25 * B.sw) / (0.9 * B.sw));
}

export const POSES = {
  armsUp:     (k, B) => ({ l: armUp(k, B, 'l'), r: armUp(k, B, 'r') }),
  armsOut:    (k, B) => ({ l: armOut(k, B, 'l'), r: armOut(k, B, 'r') }),
  handsHead:  (k, B) => ({ l: handOnHead(k, B, 'l'), r: handOnHead(k, B, 'r') }),
  leftUp:     (k, B) => ({ l: armUp(k, B, 'l'), r: armDown(k, B, 'r') }),     // the OTHER arm must stay down
  rightUp:    (k, B) => ({ l: armDown(k, B, 'l'), r: armUp(k, B, 'r') }),
};
/* judgePose → { l, r, ok, wrong } — ok when both parts ≥ okAt; wrong = the arm that should NOT be up is up (for one-arm commands) */
export function judgePose(k, name, okAt = 0.8){
  const B = body(k); if (!B || !POSES[name]) return null;
  const p = POSES[name](k, B);
  const wrong = name === 'leftUp' ? (armUp(k, B, 'r') > 0.6 ? 'r' : null) : name === 'rightUp' ? (armUp(k, B, 'l') > 0.6 ? 'l' : null) : null;
  return { ...p, ok: p.l >= okAt && p.r >= okAt && !wrong, wrong, progress: Math.min(p.l, p.r) };
}

/* ───────── LEGS / WHOLE-BODY SHAPES (Freeze animal shapes) ───────── */
export const SHAPES = {
  star(k, B){ const a = POSES.armsUp(k, B), up = (a.l + a.r) / 2;             // arms up in a V + feet apart
    const feet = B.feet ? clamp((Math.abs(k.lAnkle.x - k.rAnkle.x) / B.sw - 1.0) / 0.8) : 0.5; return clamp(up * 0.6 + feet * 0.4); },
  flamingo(k, B){ if (!seen(k.lKnee) || !seen(k.rKnee)) return 0;              // one knee lifted high
    return clamp((Math.abs(k.lKnee.y - k.rKnee.y) / B.torso - 0.12) / 0.3); },
  frog(k, B){ if (!B.hips || !seen(k.lKnee) || !seen(k.rKnee)) return 0;       // squat: hips drop toward the knees, knees wide
    const kneeY = (k.lKnee.y + k.rKnee.y) / 2, low = 1 - clamp((kneeY - B.hp.y) / (0.9 * B.torso));
    const wide = clamp((Math.abs(k.lKnee.x - k.rKnee.x) / B.sw - 0.8) / 0.6); return clamp(low * 0.7 + wide * 0.3); },
  bear(k, B){ const o = POSES.armsOut(k, B); return clamp((o.l + o.r) / 2); },  // big arms out wide
};
export function judgeShape(k, name, okAt = 0.75){ const B = body(k); if (!B || !SHAPES[name]) return null; const v = SHAPES[name](k, B); return { progress: v, ok: v >= okAt }; }

/* ───────── SHOULDER LIFT (intro beat, Upper Body pops) — one shoulder higher than the other ───────── */
export function judgeShoulder(k, side, okAt = 0.75){
  const B = body(k); if (!B) return null;
  const me = k[side + 'Shoulder'], other = k[(side === 'l' ? 'r' : 'l') + 'Shoulder'];
  const v = clamp((other.y - me.y) / (0.2 * B.sw));                           // 1 = lifted a fifth of a shoulder width above the other
  return { progress: v, ok: v >= okAt };
}

/* ───────── CHEST SLIDE (Upper Body isolation) — shoulders slide sideways over still hips ───────── */
export class ChestSlide {
  constructor(o = {}){ this.o = Object.assign({ okAt: 0.8, hipTol: 0.14, tau: 1.5, drift: 0.05 }, o); this.hip0 = null; this.lastT = null; }
  update(k, t){
    const B = body(k); if (!B || !B.hips) return null;
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT); this.lastT = t;
    this.hip0 = this.hip0 == null ? B.hp.x : this.hip0 + (dt ? 1 - Math.exp(-dt / this.o.tau) : 1) * (B.hp.x - this.hip0) * this.o.drift;   // hips' home, drifts very slowly
    const slide = (B.sh.x - B.hp.x) / (0.35 * B.sw);                          // −1..1 : image-left .. image-right
    const hipMove = Math.abs(B.hp.x - this.hip0) / B.sw;
    const hipsStill = hipMove <= this.o.hipTol;
    return { slide: clamp(slide, -1, 1), hipsStill, hipMove: +hipMove.toFixed(3), ok: Math.abs(slide) >= this.o.okAt && hipsStill };
  }
}

/* ───────── HELLO WAVE (greeting) — a hand up and swinging side to side ───────── */
export class HelloWave {
  constructor(o = {}){ this.o = Object.assign({ swings: 2, minAmp: 0.22, windowS: 1.6 }, o); this.hist = []; }
  update(k, t){
    const B = body(k); if (!B) return null;
    let best = null;
    for (const s of ['l', 'r']){ const W = k[s + 'Wrist'], S = k[s + 'Shoulder']; if (seen(W) && W.y < S.y - 0.2 * B.sw) best = best && k[best + 'Wrist'].y < W.y ? best : s; }
    if (!best){ this.hist = []; return { hand: null, progress: 0, ok: false }; }
    const x = k[best + 'Wrist'].x / B.sw; this.hist.push({ t, x, s: best }); while (this.hist.length && t - this.hist[0].t > this.o.windowS) this.hist.shift();
    // count turnarounds: the hand travels ≥ minAmp one way, then ≥ minAmp back (small jitter never counts)
    let swings = 0, dir = 0, ref = null;
    for (const h of this.hist){ if (h.s !== best) continue; if (ref == null){ ref = h.x; continue; }
      const d = h.x - ref;
      if (dir === 0){ if (Math.abs(d) >= this.o.minAmp){ dir = Math.sign(d); ref = h.x; } }
      else if (Math.sign(d) === dir) ref = h.x;                              // still going the same way → extend
      else if (Math.abs(d) >= this.o.minAmp){ swings++; dir = -dir; ref = h.x; } }   // turned back far enough
    return { hand: best, progress: clamp(swings / this.o.swings), ok: swings >= this.o.swings };
  }
}

/* ───────── PRESENCE: where the child stands (the "step back / come closer / move over" cue) ───────── */
export function judgePresence(k, o = {}){
  const c = Object.assign({ closeSW: 0.34, farSW: 0.1, sideTol: 0.18, needFeet: false }, o);
  const B = body(k); if (!B) return { state: 'missing' };
  if (B.sw > c.closeSW) return { state: 'tooClose', sw: B.sw };
  if (B.sw < c.farSW) return { state: 'tooFar', sw: B.sw };
  if (B.sh.x < 0.5 - c.sideTol) return { state: 'offImageLeft', x: B.sh.x };
  if (B.sh.x > 0.5 + c.sideTol) return { state: 'offImageRight', x: B.sh.x };
  if (c.needFeet && !B.feet) return { state: 'feetHidden' };
  return { state: 'ok', sw: B.sw };
}

/* ───────── MOVING PART during a hold: which limb broke the freeze (for the orange "wobble" light) ───────── */
export class PartMotion {
  constructor(o = {}){ this.o = Object.assign({ tau: 0.12 }, o); this.prev = null; this.lastT = null; this.e = { lArm: 0, rArm: 0, lLeg: 0, rLeg: 0, head: 0 }; }
  update(k, t){
    const B = body(k); if (!B){ this.prev = null; return null; }
    const parts = { lArm: ['lElbow', 'lWrist'], rArm: ['rElbow', 'rWrist'], lLeg: ['lKnee', 'lAnkle'], rLeg: ['rKnee', 'rAnkle'], head: ['nose'] };
    const dt = this.lastT == null ? 0 : Math.max(1e-3, t - this.lastT); this.lastT = t;
    if (this.prev && dt){ const a = 1 - Math.exp(-dt / this.o.tau);
      for (const [p, js] of Object.entries(parts)){ let v = 0, n = 0; for (const j of js){ const c = k[j], q = this.prev[j]; if (seen(c) && seen(q)){ v += dist(c, q) / B.sw / dt; n++; } } if (n) this.e[p] += a * (v / n - this.e[p]); } }
    this.prev = JSON.parse(JSON.stringify(k));
    let top = null; for (const [p, v] of Object.entries(this.e)) if (!top || v > this.e[top]) top = p;
    return { energy: { ...this.e }, top, topEnergy: this.e[top] };
  }
}
