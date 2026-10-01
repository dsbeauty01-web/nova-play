// shared/mover-engine.js — the joint-mover engine (ENGINE-DETECT b0.11).
// One shared DETECTION engine for every game, on top of pose-adapter's named joints.
// Per frame, per joint: where (smoothed) · which way + how fast (velocity → L/R/UP/DOWN) ·
// how big (relative to THIS kid's calibrated range) · isolated? (did reference joints stay still).
// Every dance move is a one-line RULE on top (see mover-rules.js). Games never touch raw joints.

export const REF = {            // derived points from named joints (toNova output)
  shoulderC: k => mid(k.lShoulder, k.rShoulder),
  hipC:      k => mid(k.lHip, k.rHip),
  head:      k => k.nose,
};
const mid = (a, b) => (a && b) ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vis: Math.min(a.vis, b.vis) } : null;

export class MoverEngine {
  constructor(opts = {}) {
    this.alpha = opts.alpha ?? 0.4;            // EMA weight of the new frame
    this.visMin = opts.visMin ?? 0.5;
    this.state = {};                           // name → {x,y,vx,vy,t,mag}
    this.cal = null;                           // per-kid calibration
    this.calBuf = {};                          // name → samples during calibration window
    this.calibrating = false;
    this.last = null;
  }
  // ── calibration (a no-score window: intro/demo) ──
  startCal() { this.calibrating = true; this.calBuf = {}; }
  finishCal() {
    const cal = { range: {}, base: {} };
    for (const [n, arr] of Object.entries(this.calBuf)) {
      const xs = arr.map(p => p.x).sort((a, b) => a - b), ys = arr.map(p => p.y).sort((a, b) => a - b);
      const p = (s, q) => s[Math.floor(s.length * q)];
      cal.range[n] = { x: Math.max(0.02, p(xs, .9) - p(xs, .1)), y: Math.max(0.02, p(ys, .9) - p(ys, .1)) };
      cal.base[n] = { x: p(xs, .5), y: p(ys, .5) };
    }
    cal.body = cal.range.shoulderC ? Math.max(cal.range.shoulderC.x, 0.06) : 0.1;   // the kid's own scale
    this.cal = cal; this.calibrating = false;
    try { console.log('[CAL]', JSON.stringify(cal)); } catch (_) {}
    return cal;
  }
  // ── per frame ──
  update(k, t = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const pts = { ...k, shoulderC: REF.shoulderC(k), hipC: REF.hipC(k), head: REF.head(k) };
    const out = {};
    for (const [n, p] of Object.entries(pts)) {
      if (!p || p.vis < this.visMin) continue;
      const s = this.state[n];
      if (!s) { this.state[n] = { x: p.x, y: p.y, vx: 0, vy: 0, t }; continue; }
      const dt = Math.max(1, t - s.t) / 1000;
      const x = s.x * (1 - this.alpha) + p.x * this.alpha, y = s.y * (1 - this.alpha) + p.y * this.alpha;
      const vx = (x - s.x) / dt, vy = (y - s.y) / dt;                 // normalized units / second
      Object.assign(s, { x, y, vx, vy, t });
      if (this.calibrating) (this.calBuf[n] ||= []).push({ x, y });
      const dx = this.cal ? (x - (this.cal.base[n]?.x ?? x)) : 0, dy = this.cal ? (y - (this.cal.base[n]?.y ?? y)) : 0;
      const scale = this.cal?.body ?? 0.1;
      out[n] = {
        x, y, vx, vy,
        dx: dx / scale, dy: dy / scale,                                  // displacement from base, in body-units
        dir: dirOf(vx, vy),                                              // 'L'|'R'|'UP'|'DOWN'|null
        mag: Math.hypot(vx, vy) / scale,                                 // speed in body-units/s
        vis: p.vis,
      };
    }
    this.last = out; return out;
  }
  // ── the primitives every rule uses ──
  moved(n, axis, thr = 0.35) {
    const j = this.last?.[n]; if (!j) return null;                       // |displacement| beyond thr body-units
    const d = axis === 'x' ? j.dx : j.dy;
    return Math.abs(d) >= thr ? (d > 0 ? (axis === 'x' ? 'R' : 'DOWN') : (axis === 'x' ? 'L' : 'UP')) : null;
  }
  still(n, thr = 0.12) { const j = this.last?.[n]; return j ? j.mag < thr : null; }
  isolated(mover, refs, thr = 0.12) { return refs.every(r => this.still(r, thr)); }
  energy(names) { const js = names.map(n => this.last?.[n]).filter(Boolean); return js.length ? js.reduce((s, j) => s + j.mag, 0) / js.length : null; }
  dist(a, b) { const A = this.last?.[a], B = this.last?.[b]; return (A && B) ? Math.hypot(A.x - B.x, A.y - B.y) : null; }
}
function dirOf(vx, vy, min = 0.15) { if (Math.hypot(vx, vy) < min) return null; return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'R' : 'L') : (vy > 0 ? 'DOWN' : 'UP'); }
