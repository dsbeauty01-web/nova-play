/* shared/motion-detect.js — pure detectors (no DOM, no audio) → tested in Node (test/motion_detect_test.mjs).
   Keypoints in: { lWrist:{x,y,vis}, lElbow, lShoulder, rShoulder, rElbow, rWrist, lHip, rHip, nose } normalized 0..1 (y down).
   Everything is measured in the child's own shoulder widths / torso lengths, so near and far children behave the same.
   Written by the architect. */

const CHAIN = ['lWrist', 'lElbow', 'lShoulder', 'rShoulder', 'rElbow', 'rWrist'];
export const ARM_CHAINS = { left: ['lShoulder', 'lElbow', 'lWrist'], right: ['rShoulder', 'rElbow', 'rWrist'] };
const vis = (p, min) => p && p.vis >= min;

/* ───────── WAVE: a bump travelling along the arm chain, one end to the other ─────────
   Each joint's lift = how far it is ABOVE its own slow average (in shoulder widths).
   The wave front = the chain position of the highest-lifted joint (sub-joint interpolated).
   Success = the front travels across the chain in ONE direction, covering most of it, inside a time window. */
export class WaveDetector {
  /* mode 'arm'  (default — Nova's Wave game): a bump travels along ONE arm, shoulder→elbow→wrist ('out') or wrist→shoulder ('in').
     mode 'body' : a bump travels across the whole body, wrist → far wrist. */
  constructor(o = {}){
    if ((o.mode || 'arm') === 'arm') return new ArmWaveDetector(o);
    this.o = Object.assign({ visMin: 0.35, fastTau: 0.08, slowTau: 1.2, liftMin: 0.07, windowS: 3.0, coverMin: 0.8, minJoints: 4, bumpK: 1.1, ratio: 4, minStepS: 0.05, maxStepS: 0.9, cooldownS: 1.0 }, o);
    this.avg = {}; this.sm = {}; this.lastT = null; this.path = []; this.cool = -1; this.pk = {}; this.events = [];
  }
  reset(){ this.avg = {}; this.sm = {}; this.lastT = null; this.path = []; this.pk = {}; this.events = []; }
  update(k, t){
    const o = this.o; if (!vis(k.lShoulder, o.visMin) || !vis(k.rShoulder, o.visMin)) return { front: null, lifts: null, done: null };
    const sw = Math.max(0.02, Math.abs(k.lShoulder.x - k.rShoulder.x));
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT); this.lastT = t;
    const a = dt ? 1 - Math.exp(-dt / o.slowTau) : 1, af = dt ? 1 - Math.exp(-dt / o.fastTau) : 1;
    const lifts = CHAIN.map(n => {
      const p = k[n]; if (!vis(p, o.visMin)) return 0;
      this.sm[n] = this.sm[n] == null ? p.y : this.sm[n] + af * (p.y - this.sm[n]);          // light smoothing
      this.avg[n] = this.avg[n] == null ? p.y : this.avg[n] + a * (this.sm[n] - this.avg[n]); // slow baseline
      return Math.max(0, (this.avg[n] - this.sm[n]) / sw);
    });
    let bi = 0; for (let i = 1; i < lifts.length; i++) if (lifts[i] > lifts[bi]) bi = i;
    let front = null;
    if (lifts[bi] >= o.liftMin){
      const l = lifts[bi - 1] ?? 0, r = lifts[bi + 1] ?? 0;               // sub-joint position by neighbour weights
      front = bi + (r - l) / Math.max(1e-6, lifts[bi] + l + r);
      front = Math.max(0, Math.min(CHAIN.length - 1, front));
    }
    // peak events: each joint rises above liftMin, peaks, comes back down → {joint index, time of its peak}
    let done = null;
    lifts.forEach((L, i) => {
      const st = this.pk[i] || (this.pk[i] = { up: false, max: 0, rt: 0 });
      if (!st.up && L >= o.liftMin){ st.up = true; st.max = L; st.rt = t; }                     // rise time
      else if (st.up){ if (L > st.max) st.max = L; if (L < o.liftMin * 0.6){ st.up = false; if (st.max >= o.liftMin * o.bumpK) this.events.push({ i, t: st.rt }); } }   // a real bump, not a flicker
    });
    while (this.events.length && t - this.events[0].t > o.windowS) this.events.shift();
    if (t >= this.cool) done = this.check(t);
    return { front, lifts, done };
  }
  /* a wave = peak events whose joints march one way along the chain, one after another in time
     (not all at once: consecutive peaks at least minStepS apart), covering most of the chain */
  check(t){
    const o = this.o, E = [...this.events].sort((a, b) => a.t - b.t); if (E.length < 3) return null;
    const span = CHAIN.length - 1;
    for (const dir of [1, -1]){
      // longest chain ending at the newest event, moving one way, spaced in time
      let best = null;
      for (let s0 = 0; s0 < E.length; s0++){
        const run = [E[s0]];
        for (let j = s0 + 1; j < E.length; j++){
          const a = run[run.length - 1], b = E[j];
          if ((b.i - a.i) * dir >= 1 && b.t - a.t >= o.minStepS && b.t - a.t <= o.maxStepS) run.push(b);
        }
        const cover = Math.abs(run[run.length - 1].i - run[0].i) / span;
        const steps = run.slice(1).map((e, k) => e.t - run[k].t), steady = steps.length && Math.max(...steps) <= o.ratio * Math.min(...steps);
        if (run.length >= o.minJoints && cover >= o.coverMin && steady && (!best || cover > best.cover)) best = { run, cover };
      }
      if (best){
        this.events = []; this.cool = t + o.cooldownS;
        return { dir: dir === 1 ? 'L→R' : 'R→L', ms: Math.round((best.run[best.run.length - 1].t - best.run[0].t) * 1000), joints: best.run.length };
      }
    }
    return null;
  }
}
export const WAVE_CHAIN = CHAIN;

class ArmWaveDetector {
  constructor(o = {}){
    this.o = Object.assign({ visMin: 0.35, fastTau: 0.08, slowTau: 1.2, liftMin: 0.07, bumpK: 1.1, windowS: 3.5, minStepS: 0.05, maxStepS: 1.2, ratio: 4, cooldownS: 1.0, allowTwo: true, twoMinStepS: 0.15, sepK: 0.6 }, o);
    this.reset(); this.cool = -1;
  }
  reset(){ this.avg = {}; this.sm = {}; this.pk = {}; this.events = { left: [], right: [] }; this.lastT = null; this.hist = []; }
  update(k, t){
    const o = this.o; if (!vis(k.lShoulder, o.visMin) || !vis(k.rShoulder, o.visMin)) return { front: null, arm: null, chain: null, lifts: null, done: null };
    const sw = Math.max(0.02, Math.abs(k.lShoulder.x - k.rShoulder.x));
    const dt = this.lastT == null ? 0 : Math.max(0, t - this.lastT); this.lastT = t;
    const a = dt ? 1 - Math.exp(-dt / o.slowTau) : 1, af = dt ? 1 - Math.exp(-dt / o.fastTau) : 1;
    const lift = n => { const p = k[n]; if (!vis(p, o.visMin)) return 0;
      this.sm[n] = this.sm[n] == null ? p.y : this.sm[n] + af * (p.y - this.sm[n]);
      this.avg[n] = this.avg[n] == null ? p.y : this.avg[n] + a * (this.sm[n] - this.avg[n]);
      return Math.max(0, (this.avg[n] - this.sm[n]) / sw); };
    const L = { left: ARM_CHAINS.left.map(lift), right: ARM_CHAINS.right.map(lift) };
    // the arm that is moving = the one with the biggest lift; its front = sub-joint position of the highest point
    const arm = Math.max(...L.left) >= Math.max(...L.right) ? 'left' : 'right', li = L[arm];
    let bi = 0; for (let i = 1; i < 3; i++) if (li[i] > li[bi]) bi = i;
    let front = null;
    if (li[bi] >= o.liftMin){ const l = li[bi - 1] ?? 0, r = li[bi + 1] ?? 0; front = Math.max(0, Math.min(2, bi + (r - l) / Math.max(1e-6, li[bi] + l + r))); }
    (this.hist ||= []).push({ t, left: L.left, right: L.right }); while (this.hist.length && t - this.hist[0].t > o.windowS + 0.5) this.hist.shift();
    // rise events per joint, per arm (same rule as the body wave: a real bump, timed at its rise)
    for (const side of ['left', 'right']) L[side].forEach((v, i) => {
      const key = side + i, st = this.pk[key] || (this.pk[key] = { up: false, max: 0, rt: 0, pt: 0 });
      if (!st.up && v >= o.liftMin){ st.up = true; st.max = v; st.rt = t; st.pt = t; }
      else if (st.up){ if (v > st.max){ st.max = v; st.pt = t; } if (v < o.liftMin * 0.6){ st.up = false; if (st.max >= o.liftMin * o.bumpK) this.events[side].push({ i, t: st.rt, ft: t, pt: st.pt, max: st.max }); } }   // rise, fall, peak
    });
    let done = null;
    for (const side of ['left', 'right']){
      const E = this.events[side]; while (E.length && t - E[0].t > o.windowS) E.shift();
      if (!done && t >= this.cool) done = this.check(side, t);
    }
    return { front, arm: front == null ? null : arm, chain: ARM_CHAINS[arm], lifts: L, done };
  }
  /* success = all 3 joints of ONE arm rose in order (shoulder→elbow→wrist or the reverse), one after another, at a steady pace */
  check(side, t){
    const o = this.o, E = [...this.events[side]].sort((a, b) => a.t - b.t); if (E.length < 2) return null;
    for (let s0 = 0; s0 + 2 < E.length; s0++) for (const dir of [1, -1]){
      const run = [E[s0]];
      for (let j = s0 + 1; j < E.length && run.length < 3; j++){ const p = run[run.length - 1], q = E[j];
        if (q.i - p.i === dir && q.t - p.t >= o.minStepS && q.t - p.t <= o.maxStepS) run.push(q); }
      if (run.length === 3){ const s1 = run[1].t - run[0].t, s2 = run[2].t - run[1].t;
        if (Math.max(s1, s2) <= o.ratio * Math.min(s1, s2)){
          this.events = { left: [], right: [] }; this.cool = t + o.cooldownS;
          return { arm: side, dir: dir === 1 ? 'out' : 'in', ms: Math.round((run[2].t - run[0].t) * 1000) }; } }
    }
    // fallback: kids often wave without popping the shoulder — elbow and wrist rising CLEARLY one after the other
    // (an arm raise lifts them together, so a real gap between them is the tell)
    if (o.allowTwo){
      for (let a = 0; a < E.length; a++) for (let b = a + 1; b < E.length; b++){
        const p = E[a], q = E[b], pair = [p.i, q.i].sort().join('');
        if (pair !== '12' || p.i === q.i) continue;
        const gap = q.t - p.t; if (gap < o.twoMinStepS || gap > o.maxStepS) continue;
        // the tell of a travelling wave: at each joint's peak the OTHER joint is still low (an arm raise lifts both together)
        const at = tt => this.hist.reduce((b, h) => Math.abs(h.t - tt) < Math.abs(b.t - tt) ? h : b, this.hist[0])[side];
        if (at(p.pt)[q.i] > o.sepK * q.max || at(q.pt)[p.i] > o.sepK * p.max) continue;
        this.events = { left: [], right: [] }; this.cool = t + o.cooldownS;
        return { arm: side, dir: p.i === 1 ? 'out' : 'in', ms: Math.round(gap * 1000), joints: 2 };
      }
    }
    return null;
  }
}

/* ───────── BOUNCE: the bottom of each body bounce (knees bend → body dips → comes back up) ─────────
   Signal = mid-body height (average of shoulders + hips), in torso lengths, smoothed.
   A bottom = the body was going DOWN and turns UP, with a dip of at least minDip since the last top. */
export class BounceDetector {
  /* hysteresis peak-picking: a bottom is confirmed only once the body has come back UP by `hyst`,
     so camera jitter can never fake a bounce; the hit time is the true deepest moment, not the confirm moment */
  constructor(o = {}){
    this.o = Object.assign({ visMin: 0.35, smoothTau: 0.1, minDip: 0.05, hyst: 0.02, maxFallS: 0.9, minGapS: 0.28 }, o);
    this.y = null; this.torso = null; this.lastT = null; this.state = 'up'; this.topY = null; this.topT = null; this.valY = null; this.valT = null; this.lastHit = -9;
  }
  update(k, t){
    const o = this.o;
    if (!vis(k.lShoulder, o.visMin) || !vis(k.rShoulder, o.visMin)) return null;
    const hips = vis(k.lHip, o.visMin) && vis(k.rHip, o.visMin);
    if (this.mode && this.mode !== (hips ? 'hips' : 'upper')){ this.y = null; this.torso = null; this.topY = null; }   // switched source → restart cleanly
    this.mode = hips ? 'hips' : 'upper';
    // body size: torso length when the hips are seen; else 1.5 × shoulder width (a child's torso ≈ 1.5 shoulder widths)
    const tNow = hips ? Math.max(0.05, ((k.lHip.y + k.rHip.y) - (k.lShoulder.y + k.rShoulder.y)) / 2)
                      : Math.max(0.05, Math.abs(k.lShoulder.x - k.rShoulder.x) * 1.5);
    const dt = this.lastT == null ? 0 : Math.max(1e-3, t - this.lastT); this.lastT = t;
    this.torso = this.torso == null ? tNow : this.torso + (dt ? 1 - Math.exp(-dt / 1.5) : 1) * (tNow - this.torso);   // slow: body size, not jitter
    const mid = hips ? (k.lShoulder.y + k.rShoulder.y + k.lHip.y + k.rHip.y) / 4 : (k.lShoulder.y + k.rShoulder.y) / 2;
    const raw = mid / this.torso;                                            // y grows DOWN (a dip = bigger)
    const a = dt ? 1 - Math.exp(-dt / o.smoothTau) : 1;
    this.y = this.y == null ? raw : this.y + a * (raw - this.y);
    const y = this.y;
    if (this.topY == null){ this.topY = y; this.topT = t; this.valY = y; this.valT = t; return null; }
    let hit = null;
    if (this.state === 'up'){                                              // rising: remember the highest point (smallest y)
      if (y < this.topY){ this.topY = y; this.topT = t; } else if (t - this.topT > o.maxFallS){ this.topY = y; this.topT = t; }   // an old top expires
      if (y > this.topY + o.hyst){ this.state = 'down'; this.valY = y; this.valT = t; }
    } else {                                                               // dipping: remember the deepest point
      if (y > this.valY){ this.valY = y; this.valT = t; }
      if (y < this.valY - o.hyst){                                         // it came back up → the bottom is confirmed
        const dip = this.valY - this.topY;
        if (dip >= o.minDip && this.valT - this.topT <= o.maxFallS && this.valT - this.lastHit >= o.minGapS){
          hit = { t: this.valT - o.smoothTau, dip: +dip.toFixed(3) }; this.lastHit = this.valT; }   // minus the smoothing delay
        this.state = 'up'; this.topY = y; this.topT = t;
      }
    }
    return hit;
  }
}

/* ───────── BEAT SCORER: how close a bounce bottom lands to the nearest beat ─────────
   latencyS: camera + model delay (the body really dipped this much earlier than we saw it). */
export function scoreHit(hitT, beatAt, periodS, { latencyS = 0.08, onS = 0.13, nearS = 0.23 } = {}){
  const t = hitT - latencyS;
  const n = Math.round((t - beatAt) / periodS), off = t - (beatAt + n * periodS);
  const a = Math.abs(off);
  return { beat: n, offMs: Math.round(off * 1000), grade: a <= onS ? 'on' : a <= nearS ? 'near' : 'off' };
}
