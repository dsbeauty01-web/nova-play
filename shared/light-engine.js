// shared/light-engine.js — the shared LIGHT engine (ENGINE-LIGHTS · FINAL language b0.17).
// One canvas engine for every game, driven by the mover-engine + the cue table.
// GOLD is the only thing that glows. Never red.
//
// THE APPROVED LANGUAGE (LIGHTS-FINAL, founder-approved effect by effect):
//   · MOVE cue (shoulder/arm/head) — bloomed orb on the joint + closing ring w/ PERFECT band + ribbon.
//   · WAVE  — the COMET: glowing head + fading tail + sparks riding the arm. Dim/slow = cue, bright/fast = hit.
//   · RIBS/TORSO/HIPS — the HOOP: a perspective ring around the ribs (slides for side, swells F, lights B)
//                       + a dashed white hip hoop that never moves.
//   · FREEZE — just the ICE GLOW on the body silhouette (mask when available, soft ellipse fallback). No ring.
//   · CLAP  — the SNAP: small hand glows + a thin line; contact = a sharp 4-point star + one thin ring, 250ms.
//
// TIMING is wall-clock (born + life ms, dt-scaled motion) so it looks identical at 10fps capture and 60fps device.

function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

export class LightEngine {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.cx = canvas.getContext('2d'); this.mirror = opts.mirror ?? true;
    this.tier = opts.tier ?? 'kids';                                  // 'kids' full juice · 'adult' cool
    this.col = this.tier === 'kids'
      ? { main: '#ffc23e', hot: '#ffe27e', ice: '#bfeeff', warm: '#ffb27d' }
      : { main: '#e6a93a', hot: '#f2c66d', ice: '#bfeeff', warm: '#e0a57a' };
    this.pf = this.tier === 'kids' ? 1 : 0.4;                          // particle factor (adult ×0.4)
    this.joints = {}; this.cues = []; this.parts = []; this.rings = []; this.comets = []; this.snaps = [];
    this.freeze = null; this.maskCanvas = null; this._tc = {}; this.fire = false;
    this.streak = 0; this._last = performance.now(); this.boost = 1;   // boost>1 = brighter bloom on a bright/daylight frame
    this.fit(); addEventListener('resize', () => this.fit()); this.audio = new LightAudio();
    requestAnimationFrame(() => this.draw());
  }
  fit() { this.cv.width = this.cv.clientWidth * devicePixelRatio; this.cv.height = this.cv.clientHeight * devicePixelRatio; }
  setJoints(out) {
    for (const [n, j] of Object.entries(out)) {
      if (!j) continue;
      this.joints[n] = { x: (this.mirror ? 1 - j.x : j.x) * this.cv.width, y: j.y * this.cv.height, dir: j.dir };
    }
  }
  P(n) { return this.joints[n]; }
  setMask(img) { this.maskCanvas = img; }                            // freeze pages pass a MediaPipe segmentation mask each frame
  sw() {
    const a = this.P('lShoulder'), b = this.P('rShoulder');
    if (a && b) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 20) return d; }
    return this.cv.width * 0.16;
  }
  // a single soft additive blob — layered glow comes from calling it a few times (wide→mid→core)
  bloom(x, y, r, col = this.col.main, a = 1, spread = 2) {
    const cx = this.cx, rr = Math.max(1, r * spread), g = cx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, hexA(col, 1)); g.addColorStop(1, hexA(col, 0));
    cx.save(); cx.globalCompositeOperation = 'lighter'; cx.globalAlpha = Math.min(1, a * this.boost); cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, rr, 0, 7); cx.fill(); cx.restore();
  }
  // is any light currently on screen? (the page dims the webcam while this is true)
  active() {
    const now = performance.now();
    if (this.cues.length || this.snaps.length || this.freeze || this.cometCueState) return true;
    for (const s of (this.cometLiveStates || [])) { if (s.lastActive != null && now - s.lastActive < 900) return true; if (s.hitT != null && now - s.hitT < 700) return true; }
    if (this.rings.some(r => now - r.born < r.life)) return true;
    if (this.parts.some(q => q.big && now - q.born < q.life)) return true;   // a grade label is up
    return false;
  }
  roundBand(x, y, hw, h, col, a, blur) { const c = this.cx; c.save(); c.globalAlpha = a; c.fillStyle = col; c.shadowBlur = blur; c.shadowColor = col; c.beginPath(); c.roundRect(x - hw, y - h, hw * 2, h * 2, h); c.fill(); c.restore(); }
  _dust(x, y, { vx = 0, vy = 0, r = 4, col = this.col.main, life = 500, grav = false, spark = false, frost = false }) {
    this.parts.push({ x, y, vx, vy, r, col, born: performance.now(), life, grav, spark, frost });
  }
  _ring(x, y, { r0 = 8, rate = 300, life = 450, col = this.col.main, soft = false, thin = false, ellipse = 0 }) {
    this.rings.push({ x, y, r0, rate, life, col, soft, thin, ellipse, born: performance.now() });
  }
  // ── MOVE cue (orb) ──
  cue({ joint, dir = null, windowMs = 900, leadMs = 1000, still = [] }) {
    this.cues = this.cues.filter(c => c.joint !== joint);
    this.cues.push({ joint, dir, born: performance.now(), windowMs, leadMs, still });
    this.audio.chime();
  }
  clearCue(joint) { this.cues = this.cues.filter(c => c.joint !== joint); }
  hit(joint, quality = 'good', pts = null, gradeWord = null) {
    const p = this.P(joint); if (!p) return;
    const col = quality === 'iso' ? this.col.hot : quality === 'wrong' ? '#cbb7e8' : this.col.main;
    const sw = this.sw(), n = this.tier === 'kids' ? 16 : 7;
    for (let i = 0; i < n; i++) this._dust(p.x, p.y, { vx: (Math.random() - .5) * sw * .06, vy: (Math.random() - .8) * sw * .06, r: sw * .03 * (1 + Math.random()), col, life: 500, grav: true });
    this._ring(p.x, p.y, { r0: sw * .1, rate: sw * 1.9, life: 450, col }); this.clearCue(joint); this.audio.tick(this.streak || 0);
    if (gradeWord) { this.flyUp(p, gradeWord); if (pts != null) this._smallText(p.x, p.y + sw * .3, `+${pts}`, sw); }
    else if (pts != null) this.flyUp(p, `+${pts}`);
  }
  _smallText(x, y, text, sw) { this.parts.push({ x, y, vx: 0, vy: -sw * .012, born: performance.now(), life: 850, text, col: this.col.main, size: Math.max(16, sw * .13) }); }
  isoShimmer() {
    const sw = this.sw();
    for (const n of ['lHip', 'rHip']) { const p = this.P(n); if (!p) continue;
      for (let i = 0; i < Math.round(10 * this.pf); i++) this._dust(p.x, p.y, { vx: (Math.random() - .5) * sw * .03, vy: -Math.random() * sw * .025, r: sw * .02, col: this.col.hot, life: 450, spark: true }); }
  }
  warm(joint = 'hipC') { const p = this.P(joint), sw = this.sw(); if (p) this._ring(p.x, p.y, { r0: sw * .3, rate: sw * .5, life: 1600, col: this.col.warm, soft: true }); }
  ice() { const c = this.P('shoulderC'), sw = this.sw(); if (c) this._ring(c.x, c.y, { r0: sw * .5, rate: sw * 3.6, life: 1000, col: this.col.ice, soft: true }); }  // legacy shim
  setFire(on) { this.fire = on && this.tier === 'kids'; }
  flyUp(p, text) {
    const h = this.P('head') || this.P('nose'), sw = this.sw();
    const size = Math.min(Math.max(sw * 0.30, 34), this.cv.width * 0.11);
    const x = h ? h.x : p.x, y = (h ? h.y : p.y) - size * 1.5;
    this.parts.push({ x, y, vx: 0, vy: -size * .04, born: performance.now(), life: 900, text, big: true, size, col: this.col.hot });
  }

  // ── NOVA-SAYS additions (spec §3/§5) ──
  // GOTCHA = a playful purple ring (#b98cff) expanding from the chest, 500ms.
  // Purple on purpose: gold means "you did well", and this is never red.
  gotchaRipple() {
    const s = this.P('shoulderC'), h = this.P('hipC'), sw = this.sw();
    const p = (s && h) ? { x: (s.x + h.x) / 2, y: (s.y + h.y) / 2 } : s; if (!p) return;
    this._ring(p.x, p.y, { r0: sw * 0.2, rate: sw * 2.4, life: 500, col: '#b98cff', soft: true });
  }
  // miss = everything live eases out quietly — no sound, no flash (silence on misses)
  softFade() {
    const now = performance.now();
    for (const c of this.cues) c.born = Math.min(c.born, now - (c.leadMs + c.windowMs));   // → the draw loop's 400ms fade
    if (this.freeze) this.freezeBreak();                                                    // ice melts over its 600ms break path
  }
  // hard reset between commands/rounds (bursts and rings finish their own short lifetimes)
  clearAll() { this.cues = []; this.cometCueState = null; this.cometLiveStates = []; this.snaps = []; this.freeze = null; }

  // ── A · COMET (wave) — phase-driven, rides the REAL wave (b0.18 WAVE-COMET-ACCURATE) ──
  // geometry helpers
  catmull(pts, n = 32) { if (pts.length < 2) return pts.slice(); const out = []; const P = [pts[0], ...pts, pts[pts.length - 1]], per = Math.max(2, Math.floor(n / (pts.length - 1)));
    for (let i = 1; i < P.length - 2; i++) { for (let s = 0; s < per; s++) { const t = s / per, t2 = t * t, t3 = t2 * t, p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
      out.push({ x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
                 y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3) }); } }
    out.push(pts[pts.length - 1]); return out; }
  pathLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return L; }
  at(pts, u) { const n = pts.length - 1, i = Math.min(n - 1, Math.max(0, Math.floor(u * n))), f = u * n - i, a = pts[i], b = pts[i + 1]; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, ang: Math.atan2(b.y - a.y, b.x - a.x) }; }
  ribbon(pts, uHead, w0, w1, col, alpha) {                                       // tapered "sleeve of light" back along the path
    const cx = this.cx, N = 24, left = [], right = [];
    for (let k = 0; k <= N; k++) { const u = uHead - k * (0.55 / N); if (u < 0) break; const p = this.at(pts, u), w = (w0 + (w1 - w0) * (k / N)) * 0.5;
      const nx = -Math.sin(p.ang) * w, ny = Math.cos(p.ang) * w; left.push({ x: p.x + nx, y: p.y + ny }); right.push({ x: p.x - nx, y: p.y - ny }); }
    if (left.length < 2) return;
    const g = cx.createLinearGradient(left[0].x, left[0].y, left[left.length - 1].x, left[left.length - 1].y); g.addColorStop(0, col); g.addColorStop(1, hexA(col, 0));
    cx.globalAlpha = alpha; cx.fillStyle = g; cx.beginPath(); cx.moveTo(left[0].x, left[0].y); for (const p of left) cx.lineTo(p.x, p.y); for (let i = right.length - 1; i >= 0; i--) cx.lineTo(right[i].x, right[i].y); cx.closePath(); cx.fill(); }
  gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.5; }
  // comet state
  cometCue(chain) { this.cometCueState = { chain, t0: performance.now(), dur: 1400 }; }
  comet(chain, quality = 'good') { this.cometCueState = { chain, t0: performance.now(), dur: 650, quality, bright: true }; }   // legacy one-shot sweep
  cometLive(waveRule, chain) { (this.cometLiveStates ||= []).push({ rule: waveRule, chain, glow: 0 }); }
  cometHit(quality, rule) { const arr = this.cometLiveStates || []; const s = rule ? arr.find(x => x.rule === rule) : arr[arr.length - 1]; if (s) { s.hitT = performance.now(); s.quality = quality; } }
  cometStop() { this.cometLiveStates = []; }
  drawComets(now) {
    const cx = this.cx, sw = this.sw();
    const draw = (chainNames, uHead, strength, quality) => {
      const raw = chainNames.map(n => this.P(n)).filter(Boolean); if (raw.length < 3) return;
      if (this.pathLen(raw) < 1.2 * sw) { const w = this.P(chainNames[2]); if (w) this.bloom(w.x, w.y, sw * 0.08, this.col.main, 0.5 * strength, 2); return; }   // PATH GUARD: arm not extended → soft wrist pulse only (no comet, no ball)
      const pts = this.catmull(raw, 32), headR = Math.max(18, Math.min(sw * 0.22, 48)), col = quality === 'smooth' ? this.col.hot : this.col.main;   // head ≥18px floor
      cx.globalCompositeOperation = 'lighter';
      this.ribbon(pts, uHead, Math.max(10, sw * 0.18), Math.max(6, sw * 0.06), col, 0.55 * strength);   // sleeve of light; width ≥10px floor
      const h = this.at(pts, uHead);
      this.bloom(h.x, h.y, headR, col, 0.35 * strength, 2.2); this.bloom(h.x, h.y, headR * 0.55, col, 0.7 * strength, 1.4); this.bloom(h.x, h.y, headR * 0.3, '#ffffff', strength, 1);
      this._lastComet = { x: h.x, y: h.y, headR, strength, t: performance.now() };   // probe hook for the self-test
      if (strength > 0.8 && Math.random() < 0.5) { const q = this.at(pts, Math.max(0, uHead - Math.random() * 0.4)), g1 = this.gauss(), g2 = this.gauss();
        this._dust(q.x + g1 * sw * 0.06, q.y + g2 * sw * 0.06, { vx: g1 * 0.8, vy: -Math.abs(g2) * 1.2, r: 2, col: this.col.hot, life: 550, spark: true }); }
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    };
    const c = this.cometCueState; if (c) { const u = Math.min(1, (now - c.t0) / c.dur), e = 1 - Math.pow(1 - u, 3); draw(c.chain, e, c.bright ? 0.9 : 0.55, c.quality || 'cue'); if (u >= 1) this.cometCueState = null; }
    for (const s of (this.cometLiveStates || [])) {
      const ph = s.rule.phase(now); if (ph.active) s.lastActive = now;
      const sinceActive = s.lastActive != null ? now - s.lastActive : 1e9, sinceHit = s.hitT != null ? now - s.hitT : 1e9;
      const alive = ph.active ? 1 : Math.max(0, 1 - sinceActive / 900);          // ribbon fades over 900ms after the wave stops
      const strength = Math.max(alive, sinceHit < 700 ? 0.9 : 0);                // a hit keeps the comet lit for 700ms
      if (strength <= 0.03) continue;
      let u = ph.head;
      if (sinceHit < 700) u = Math.min(1.12, ph.head + 0.12 * (1 - sinceHit / 700));   // 700ms fingertip follow-through/overshoot
      draw(s.chain, Math.min(1, u), strength, s.quality || 'good');
    }
    cx.globalAlpha = 1;
  }

  // ── B · HOOP (ribs / torso / hips) ──
  hoopCue({ mover = 'ribs', dir, windowMs = 900, leadMs = 1000 }) { this.cues = this.cues.filter(c => c.id !== 'hoop'); this.cues.push({ id: 'hoop', type: 'hoop', mover, dir, born: performance.now(), windowMs, leadMs }); this.audio.chime(); }
  hoopArc(cx0, cy0, rx, ry, col, aBack, aFront, w) { const c = this.cx; c.lineWidth = w; c.strokeStyle = col; c.shadowColor = col; c.shadowBlur = 14;
    c.globalAlpha = aBack; c.beginPath(); c.ellipse(cx0, cy0, rx, ry, 0, Math.PI, 2 * Math.PI); c.stroke();
    c.globalAlpha = aFront; c.lineWidth = w * 1.4; c.beginPath(); c.ellipse(cx0, cy0, rx, ry, 0, 0, Math.PI); c.stroke(); c.shadowBlur = 0; }
  drawHoopCue(c, now) {
    const cx = this.cx, sw = this.sw(), l = this.P('lShoulder'), r = this.P('rShoulder'), hc = this.P('hipC'); if (!(l && r && hc)) return;
    const ribsY = (l.y + r.y) / 2 + sw * 0.36, mover = c.mover === 'hips' ? { x: hc.x, y: hc.y, rx: sw * 0.5, ry: sw * 0.15 } : { x: (l.x + r.x) / 2, y: ribsY, rx: sw * 0.58, ry: sw * 0.17 };
    const anchor = c.mover === 'hips' ? { x: (l.x + r.x) / 2, y: ribsY, rx: sw * 0.58, ry: sw * 0.17 } : { x: hc.x, y: hc.y, rx: sw * 0.45, ry: sw * 0.13 };
    const age = now - c.born, u = Math.min(1, age / c.leadMs), s = (c.dir === 'R') ^ this.mirror ? -1 : 1;
    cx.globalCompositeOperation = 'lighter';
    if (c.dir === 'L' || c.dir === 'R') { const travel = sw * 0.48;
      for (let k = 3; k >= 0; k--) { const g = Math.max(0, u - k * 0.22); this.hoopArc(mover.x + s * g * travel, mover.y, mover.rx, mover.ry, k === 0 ? this.col.hot : this.col.main, (0.1 + 0.12 * (3 - k)) * 0.6, 0.15 + 0.2 * (3 - k), sw * 0.03); }
      for (let i = 0; i < 3; i++) { const ax = mover.x + s * (mover.rx + sw * 0.1 + i * sw * 0.09); cx.globalAlpha = 0.9 - i * 0.25; cx.fillStyle = this.col.main; cx.beginPath(); cx.moveTo(ax, mover.y - sw * .06); cx.lineTo(ax + s * sw * .07, mover.y); cx.lineTo(ax, mover.y + sw * .06); cx.closePath(); cx.fill(); } }
    else if (c.dir === 'F') { for (let k = 0; k < 4; k++) { const g = Math.max(0, u - (3 - k) * 0.22), sc = 1 + 0.4 * g; this.hoopArc(mover.x, mover.y + g * sw * 0.2, mover.rx * sc, mover.ry * sc, k === 3 ? this.col.hot : this.col.main, 0.08, 0.25 + 0.2 * k, sw * 0.03 * sc); } }
    else if (c.dir === 'B') { for (let k = 0; k < 4; k++) { const g = Math.max(0, u - (3 - k) * 0.22), sc = 1 - 0.25 * g; this.hoopArc(mover.x, mover.y - g * sw * 0.15, mover.rx * sc, mover.ry * sc, k === 3 ? '#e1d2ff' : '#c8b4ff', 0.35 + 0.2 * k, 0.08, sw * 0.03 * sc); } }
    cx.globalCompositeOperation = 'source-over';
    cx.globalAlpha = 0.85; cx.setLineDash([sw * .06, sw * .05]); cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.beginPath(); cx.ellipse(anchor.x, anchor.y, anchor.rx, anchor.ry, 0, 0, 7); cx.stroke(); cx.setLineDash([]);
    const tx = mover.x + ((c.dir === 'L' || c.dir === 'R') ? s * sw * 0.48 : 0), total = c.leadMs + c.windowMs, frac = Math.max(0, 1 - age / total);
    cx.globalAlpha = 0.9; cx.strokeStyle = this.col.hot; cx.lineWidth = sw * 0.035; cx.shadowBlur = 14; cx.shadowColor = this.col.main; cx.beginPath(); cx.arc(tx, mover.y, sw * 0.55 * frac + sw * 0.2, 0, 7); cx.stroke(); cx.shadowBlur = 0;
    cx.globalAlpha = 0.2; cx.fillStyle = this.col.hot; cx.beginPath(); cx.arc(tx, mover.y, sw * 0.25, 0, 7); cx.fill(); cx.globalAlpha = 1;
  }
  hoopHit() { const l = this.P('lShoulder'), r = this.P('rShoulder'); if (l && r) { const sw = this.sw(); this._ring((l.x + r.x) / 2, (l.y + r.y) / 2 + sw * 0.36, { r0: sw * 0.5, rate: sw * 1.8, life: 450, col: this.col.hot, ellipse: (sw * 0.17) / (sw * 0.58) }); } this.cues = this.cues.filter(c => c.id !== 'hoop'); }

  // ── C · FREEZE (ice glow only) ──
  freezeStart(holdMs) { this.freeze = { t0: performance.now(), holdMs, broke: false }; }
  freezeBreak() { if (this.freeze && !this.freeze.broke) { this.freeze.broke = true; this.freeze.tBreak = performance.now(); } }
  freezeEnd(held) { if (!this.freeze) return; held ? (this.freeze.done = performance.now(), this.audio.ding()) : this.freezeBreak(); }
  // legacy aliases so existing pages keep working
  freezeCue(ms) { this.freezeStart(ms); this.audio.chime(); }  freezeHeld() { this.freezeEnd(true); }  freezeBroke() { this.freezeEnd(false); }
  freezeShape() {
    const s = this.P('shoulderC'), h = this.P('hipC'), sw = this.sw();
    if (s && h) { const torso = Math.hypot(s.x - h.x, s.y - h.y); return { x: (s.x + h.x) / 2, y: (s.y + h.y) / 2, rx: sw * .78, ry: torso * .62 + sw * .55 }; }
    return null;
  }
  tint(M, color) { const c = this._tc[color] ||= document.createElement('canvas'); c.width = this.cv.width; c.height = this.cv.height; const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height); x.drawImage(M, 0, 0, c.width, c.height); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height); x.globalCompositeOperation = 'source-over'; return c; }
  drawFreeze(now) {
    const f = this.freeze; if (!f) return; const cx = this.cx, u = Math.min(1, (now - f.t0) / f.holdMs);
    const g = f.broke ? Math.max(0, 0.55 - (now - f.tBreak) / 600) : 0.3 + 0.5 * u;
    if (this.maskCanvas) {
      cx.save(); cx.globalAlpha = 0.28 * g; cx.drawImage(this.tint(this.maskCanvas, '#aee8ff'), 0, 0);
      cx.globalCompositeOperation = 'lighter'; cx.globalAlpha = 0.24 * g; cx.filter = 'blur(16px)'; cx.drawImage(this.tint(this.maskCanvas, '#e8f8ff'), 0, 0); cx.restore();
    } else {                                                         // fallback: soft ice-glow ellipse on the torso (no ring, no specks)
      const sh = this.freezeShape(); if (sh) { cx.save(); cx.globalCompositeOperation = 'lighter'; cx.translate(sh.x, sh.y); cx.scale(sh.rx, sh.ry);
        const rg = cx.createRadialGradient(0, 0, 0, 0, 0, 1); rg.addColorStop(0, hexA(this.col.ice, .0)); rg.addColorStop(.5, hexA(this.col.ice, .55 * g)); rg.addColorStop(1, hexA(this.col.ice, 0));
        cx.fillStyle = rg; cx.beginPath(); cx.arc(0, 0, 1, 0, 7); cx.fill(); cx.restore(); }
    }
    if ((f.done && now - f.done > 800) || (f.broke && g <= 0)) this.freeze = null;
  }

  // ── D · CLAP (snap) ──
  clapCue({ windowMs = 900, leadMs = 900 } = {}) { this.cues = this.cues.filter(c => c.id !== 'clap'); this.cues.push({ id: 'clap', type: 'clap', born: performance.now(), windowMs, leadMs }); }
  drawClapCue(c, now) { const cx = this.cx, sw = this.sw(), l = this.P('lWrist'), r = this.P('rWrist'); if (!(l && r)) return;
    const d = Math.hypot(r.x - l.x, r.y - l.y), close = Math.max(0, 1 - d / (sw * 1.6));
    cx.globalCompositeOperation = 'lighter';
    for (const p of [l, r]) { this.bloom(p.x, p.y, sw * 0.09 + sw * 0.03 * close, this.col.main, 0.8, 2); this.bloom(p.x, p.y, sw * 0.04, this.col.hot, 1, 1); }
    cx.globalAlpha = 0.45 + 0.4 * close; cx.strokeStyle = close > 0.5 ? this.col.hot : this.col.main; cx.lineWidth = 2 + 2 * close; cx.beginPath(); cx.moveTo(l.x, l.y); cx.lineTo(r.x, r.y); cx.stroke();
    cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1; if (now - c.born > c.leadMs + c.windowMs) this.cues = this.cues.filter(x => x !== c); }
  clapHit(/* quality, pts — legacy args ignored */) { const l = this.P('lWrist'), r = this.P('rWrist'); if (!(l && r)) return; const m = { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 }, sw = this.sw();
    this.cues = this.cues.filter(c => c.id !== 'clap'); this.snaps.push({ x: m.x, y: m.y, t0: performance.now(), len: sw * 0.36 });
    this._ring(m.x, m.y, { r0: sw * 0.12, rate: sw * 3, life: 300, col: this.col.hot, thin: true }); this.audio.clap(); }
  drawSnaps(now) { const cx = this.cx; for (const s of this.snaps) { const a = Math.max(0, 1 - (now - s.t0) / 250); cx.globalAlpha = a; cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.shadowBlur = 8; cx.shadowColor = '#fff';
    for (const [ang, f] of [[0, 1], [90, 1], [45, .5], [135, .5]]) { const rad = ang * Math.PI / 180, dx = Math.cos(rad) * s.len * f * (0.6 + 0.4 * a), dy = Math.sin(rad) * s.len * f * (0.6 + 0.4 * a); cx.beginPath(); cx.moveTo(s.x - dx, s.y - dy); cx.lineTo(s.x + dx, s.y + dy); cx.stroke(); }
    cx.shadowBlur = 0; } this.snaps = this.snaps.filter(s => now - s.t0 < 250); cx.globalAlpha = 1; }

  // ── DRAW (order: cues by type → comets → freeze → parts → rings → snaps) ──
  draw() {
    const cx = this.cx, now = performance.now(), sw = this.sw();
    const df = Math.max(0.3, Math.min(3, (now - this._last) / 16.67)); this._last = now;
    cx.clearRect(0, 0, this.cv.width, this.cv.height);
    const lw = k => Math.max(4, k * (sw / 200));   // ring/line stroke floor ≥4px
    this.cues = this.cues.filter(c => (now - c.born) < c.leadMs + c.windowMs + 400);
    for (const c of this.cues) {
      if (c.type === 'hoop') { this.drawHoopCue(c, now); cx.globalAlpha = 1; continue; }
      if (c.type === 'clap') { this.drawClapCue(c, now); cx.globalAlpha = 1; continue; }
      const p = this.P(c.joint); if (!p) continue;                    // MOVE cue (orb)
      const age = (now - c.born), total = c.leadMs + c.windowMs, over = age - total;
      const fade = over > 0 ? Math.max(0, 1 - over / 400) : 1; cx.globalAlpha = fade;
      const orbR = Math.max(22, sw * .30 * (this.fire ? 1.15 : 1)) * (1 + .06 * Math.sin(age / 160)), ringMax = orbR * 2.0;   // orb core ≥22px floor
      const oc = this.fire ? this.col.hot : this.col.main;
      this.bloom(p.x, p.y, orbR * .8, oc, .35 * fade, 4); this.bloom(p.x, p.y, orbR * .5, oc, .6 * fade, 2); this.bloom(p.x, p.y, orbR * .3, this.col.hot, .95 * fade, 1);
      for (let i = 0; i < 7; i++) { const ang = now / 520 + i * (6.283 / 7), rr = orbR * 1.5; this.bloom(p.x + Math.cos(ang) * rr, p.y + Math.sin(ang) * rr, orbR * .12, this.col.hot, .8 * fade, 1); }
      const frac = Math.max(0, 1 - age / total), inPerfect = frac < 0.34;
      cx.save(); cx.strokeStyle = hexA(this.col.hot, .16 * fade); cx.lineWidth = orbR * .7; cx.beginPath(); cx.arc(p.x, p.y, orbR + orbR * .35, 0, 7); cx.stroke(); cx.restore();
      cx.save(); cx.shadowColor = hexA(this.col.hot, 1); cx.shadowBlur = 22; cx.globalAlpha = fade;
      cx.strokeStyle = inPerfect ? hexA(this.col.hot, 1) : hexA(this.col.main, .95); cx.lineWidth = inPerfect ? lw(9) : lw(6);
      cx.beginPath(); cx.arc(p.x, p.y, orbR + (ringMax - orbR) * frac, 0, 7); cx.stroke(); cx.restore();
      cx.save(); cx.shadowColor = hexA(this.col.main, 1); cx.shadowBlur = 16; cx.strokeStyle = hexA(this.col.main, .85); cx.lineWidth = Math.max(10, lw(8)); cx.lineCap = 'round';   // direction ribbon ≥10px
      if (c.dir === 'L' || c.dir === 'R') { const s = (c.dir === 'R') ^ this.mirror ? -1 : 1; cx.beginPath(); cx.moveTo(p.x, p.y); cx.quadraticCurveTo(p.x + s * sw * .5, p.y - sw * .1, p.x + s * sw * .9, p.y - sw * .02); cx.stroke(); }
      if (c.dir === 'UP' || c.dir === 'DOWN') { const s = c.dir === 'UP' ? -1 : 1; cx.beginPath(); cx.moveTo(p.x, p.y); cx.quadraticCurveTo(p.x + sw * .08, p.y + s * sw * .5, p.x + sw * .02, p.y + s * sw * .9); cx.stroke(); }
      cx.restore();
      for (const sn of c.still) { const q = this.P(sn); if (!q) continue;
        cx.save(); cx.globalAlpha = fade * .5; cx.strokeStyle = 'rgba(255,255,255,.6)'; cx.setLineDash([sw * .06, sw * .06]); cx.lineWidth = lw(3); cx.beginPath(); cx.arc(q.x, q.y, sw * .28, 0, 7); cx.stroke(); cx.restore(); }
      cx.globalAlpha = 1;
    }
    this.drawComets(now);
    this.drawFreeze(now);
    // ── particles ──
    for (const q of this.parts) {
      q.x += q.vx * df; q.y += q.vy * df; if (q.grav) q.vy += sw * .04 * df;
      const a = 1 - (now - q.born) / q.life; cx.globalAlpha = Math.max(a, 0);
      if (q.text) {
        cx.textAlign = 'center'; cx.font = `800 ${q.size}px "Baloo 2",system-ui`;
        if (q.big) { cx.save(); cx.shadowColor = hexA(this.col.hot, 1); cx.shadowBlur = 24; cx.lineWidth = Math.max(3, q.size * .06); cx.strokeStyle = 'rgba(28,18,48,.9)'; cx.strokeText(q.text, q.x, q.y); cx.fillStyle = hexA(this.col.hot, 1); cx.fillText(q.text, q.x, q.y); cx.restore(); }
        else { cx.fillStyle = q.col; cx.fillText(q.text, q.x, q.y); }
        cx.textAlign = 'start';
      } else { cx.save(); cx.globalCompositeOperation = 'lighter'; cx.fillStyle = q.col; cx.beginPath(); cx.arc(q.x, q.y, Math.max(.5, q.r), 0, 7); cx.fill(); cx.restore(); }
    }
    this.parts = this.parts.filter(q => (now - q.born) < q.life); cx.globalAlpha = 1;
    // ── rings (feathered; thin = clap, ellipse = hoop) ──
    for (const r of this.rings) {
      const el = (now - r.born) / 1000, rad = r.r0 + r.rate * el, a = 1 - (now - r.born) / r.life;
      cx.save(); cx.globalAlpha = Math.max(a, 0); cx.strokeStyle = r.col; cx.shadowColor = r.col; cx.shadowBlur = r.thin ? 8 : (r.soft ? 16 : 22); cx.lineWidth = r.thin ? 2 : (r.soft ? lw(8) : lw(5));
      cx.beginPath(); r.ellipse ? cx.ellipse(r.x, r.y, rad, rad * r.ellipse, 0, 0, 7) : cx.arc(r.x, r.y, rad, 0, 7); cx.stroke(); cx.restore();
    }
    this.rings = this.rings.filter(r => (now - r.born) < r.life); cx.globalAlpha = 1;
    this.drawSnaps(now);
    requestAnimationFrame(() => this.draw());
  }
}
function pathPoint(pts, u) { const n = pts.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i; const a = pts[i], b = pts[i + 1]; return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
class LightAudio {
  constructor() { this.ctx = null; }
  ensure() { this.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); return this.ctx; }
  blip(freq, ms = 80, gain = .12) { const c = this.ensure(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = freq; o.type = 'sine'; g.gain.value = gain; o.connect(g).connect(c.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + ms / 1000); o.stop(c.currentTime + ms / 1000); }
  tick(streak) { this.blip(Math.min(1100, 660 + streak * 40), 70); }  chime() { this.blip(880, 120, .05); }  ding() { this.blip(1320, 160, .14); }
  clap(gain = .5) {
    const c = this.ensure(), dur = 0.085, len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 0.8;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(bp).connect(g).connect(c.destination); src.start();
  }
}
