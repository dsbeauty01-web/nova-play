/* shared/nova-lights.js — Nova's light layer for the camera overlay (#fx). One module, every game.
   What makes it look right (from the research): (1) One-Euro smoothing per joint, (2) its own 60fps loop that
   glides between detections and predicts slightly ahead, (3) additive glow sprites (light adds up), (4) time-based
   fading trails. Pure canvas 2D — no libraries.
   Usage:
     import { createLights } from '../shared/nova-lights.js';
     const L = createLights(document.getElementById('fx'), { video: $('usercam') });   // mirror defaults to the kit's (true)
     K.onKid = (out, k) => { L.feed(k); ... }                       // normalized keypoints from the kit
     L.speedGlow(true); L.waveCue(['rShoulder','rElbow','rWrist'], 1200); L.comet.start(); L.comet.follow(r.front, r.chain); L.burst('rWrist', 'gold'); ...
   Written by the architect. */

const NAMES = ['nose','lShoulder','rShoulder','lElbow','rElbow','lWrist','rWrist','lHip','rHip','lKnee','rKnee','lAnkle','rAnkle'];
export const CHAIN = ['lWrist','lElbow','lShoulder','rShoulder','rElbow','rWrist'];

class OneEuro { constructor(minC = 1.2, beta = 0.02, dC = 1){ this.minC = minC; this.beta = beta; this.dC = dC; this.x = null; this.dx = 0; this.t = null; }
  a(c, dt){ const tau = 1 / (2 * Math.PI * c); return 1 / (1 + tau / dt); }
  f(v, t){ if (this.x === null){ this.x = v; this.t = t; return v; } const dt = Math.max(1e-3, t - this.t); this.t = t;
    const dv = (v - this.x) / dt; this.dx += this.a(this.dC, dt) * (dv - this.dx); const c = this.minC + this.beta * Math.abs(this.dx); this.x += this.a(c, dt) * (v - this.x); return this.x; } }
class Joint { constructor(){ this.fx = new OneEuro(); this.fy = new OneEuro(); this.prev = null; this.cur = null; this.conf = 0; }
  feed(x, y, vis, t){ if (vis < 0.3){ this.conf *= 0.8; return; } this.prev = this.cur; this.cur = { x: this.fx.f(x, t), y: this.fy.f(y, t), t }; this.conf = Math.min(1, this.conf + 0.25); }
  at(now){ if (!this.cur || this.conf < 0.2) return null; if (!this.prev) return { x: this.cur.x, y: this.cur.y, vx: 0, vy: 0, speed: 0 };
    const dt = (this.cur.t - this.prev.t) || 1 / 30, vx = (this.cur.x - this.prev.x) / dt, vy = (this.cur.y - this.prev.y) / dt, ahead = Math.min(now - this.cur.t + 0.03, 0.08);
    return { x: this.cur.x + vx * ahead, y: this.cur.y + vy * ahead, vx, vy, speed: Math.hypot(vx, vy) }; } }

function sprite(r, stops){ const c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
  stops.forEach(([o, col]) => gr.addColorStop(o, col)); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return c; }


/* the target pose drawn on the child's own body: arms from the child's shoulders, legs from the hips (angles: 0 down · 90 out · 180 up) */
const GHOST = { armsUp: [170, 170], armsOut: [92, 92], leftUp: [170, 12], rightUp: [12, 170], star: [148, 148], bear: [95, 95], flamingo: [15, 15], frog: [40, 40], handsHead: 'head' };
function ghostPose(name, ls, rs, lh, rh){
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y), U = 0.66 * sw, F = 0.69 * sw, rad = d => d * Math.PI / 180, out = { rings: true };
  const outward = (me, other) => Math.sign(me.x - other.x) || 1;
  const spec = GHOST[name]; if (!spec) return out;
  if (spec === 'head'){ const top = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 - sw * 1.0 };
    for (const [side, S, O] of [['l', ls, rs], ['r', rs, ls]]){ const d = outward(S, O); const e = { x: S.x + d * sw * 0.45, y: S.y - sw * 0.45 }; out[side] = { s: S, e, w: { x: top.x + d * sw * 0.12, y: top.y } }; }
    return out; }
  for (const [side, S, O, ang] of [['l', ls, rs, spec[0]], ['r', rs, ls, spec[1]]]){ const d = outward(S, O);
    const e = { x: S.x + Math.sin(rad(ang)) * U * d, y: S.y + Math.cos(rad(ang)) * U }, w = { x: e.x + Math.sin(rad(ang)) * F * d, y: e.y + Math.cos(rad(ang)) * F };
    out[side] = { s: S, e, w }; }
  const hipL = lh || { x: ls.x - (ls.x - rs.x) * 0.15, y: ls.y + sw * 1.5 }, hipR = rh || { x: rs.x + (ls.x - rs.x) * 0.15, y: rs.y + sw * 1.5 }, T = sw * 1.2;
  if (name === 'star') out.legs = [[hipL, { x: hipL.x + outward(ls, rs) * sw * 0.35, y: hipL.y + T }, { x: hipL.x + outward(ls, rs) * sw * 0.7, y: hipL.y + T * 2 }], [hipR, { x: hipR.x + outward(rs, ls) * sw * 0.35, y: hipR.y + T }, { x: hipR.x + outward(rs, ls) * sw * 0.7, y: hipR.y + T * 2 }]];
  if (name === 'flamingo') out.legs = [[hipL, { x: hipL.x + outward(ls, rs) * sw * 0.35, y: hipL.y + T * 0.35 }, { x: hipL.x, y: hipL.y + T * 0.9 }]];
  if (name === 'frog') out.legs = [[hipL, { x: hipL.x + outward(ls, rs) * sw * 0.6, y: hipL.y + T * 0.5 }, { x: hipL.x + outward(ls, rs) * sw * 0.3, y: hipL.y + T * 1.1 }], [hipR, { x: hipR.x + outward(rs, ls) * sw * 0.6, y: hipR.y + T * 0.5 }, { x: hipR.x + outward(rs, ls) * sw * 0.3, y: hipR.y + T * 1.1 }]];
  if (['star', 'flamingo', 'frog'].includes(name)) out.rings = name === 'star';
  return out;
}

export function createLights(host, opts = {}){
  /* host = the page's camera overlay canvas (#fx). The kit's own LightEngine already draws on it, so we draw on
     OUR OWN canvas stacked exactly on top of it (same parent, same box) — the two never clear each other. */
  const o = Object.assign({ video: null, mirror: true, debug: false, fit: null }, opts);   // fit: null = read the video's CSS object-fit   // mirror:true = same as the kit (keypoints come un-mirrored)
  let canvas = host;
  if (host?.parentNode && typeof document !== 'undefined' && document.createElement){
    canvas = document.createElement('canvas'); canvas.className = 'nova-lights';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:' + ((parseInt(getComputedStyle?.(host)?.zIndex) || 6) + 1);
    host.parentNode.insertBefore(canvas, host.nextSibling);
  }
  const cx = canvas.getContext('2d');
  const SP = {
    gold:  sprite(64, [[0, 'rgba(255,250,220,1)'], [.3, 'rgba(255,205,80,.8)'], [1, 'rgba(255,150,40,0)']]),
    cyan:  sprite(64, [[0, 'rgba(255,255,255,1)'], [.3, 'rgba(120,230,255,.7)'], [1, 'rgba(90,120,255,0)']]),
    halo:  sprite(128, [[0, 'rgba(120,230,255,.5)'], [.4, 'rgba(110,140,255,.16)'], [1, 'rgba(110,80,255,0)']]),
    green: sprite(64, [[0, 'rgba(240,255,240,1)'], [.3, 'rgba(120,240,150,.75)'], [1, 'rgba(60,200,120,0)']]),
    warm:  sprite(64, [[0, 'rgba(255,240,220,1)'], [.3, 'rgba(255,160,90,.75)'], [1, 'rgba(255,110,60,0)']]),
    ice:   sprite(64, [[0, 'rgba(240,252,255,.95)'], [.35, 'rgba(170,235,255,.6)'], [1, 'rgba(120,200,255,0)']]),
  };
  const COL = { cyan: '120,230,255', gold: '255,210,90', green: '120,235,150', warm: '255,160,90', ice: '190,240,255', white: '255,255,255' };
  const J = {}; for (const n of NAMES) J[n] = new Joint();
  let W = 0, H = 0, DPR = 1;
  function resize(){ DPR = Math.min(2, devicePixelRatio || 1); W = canvas.clientWidth; H = canvas.clientHeight; canvas.width = W * DPR; canvas.height = H * DPR; cx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  addEventListener('resize', resize); resize();
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; ro?.observe?.(canvas);   // panels resize between phases

  // normalized video coords → canvas pixels, matching object-fit:cover of the displayed video
  function map(x, y){
    const vw = o.video?.videoWidth || 640, vh = o.video?.videoHeight || 480;
    // match how the page actually shows the camera: 'cover' crops, 'contain' letterboxes (the Wave panel) — read it, never assume
    const fit = o.fit || (typeof getComputedStyle === 'function' && o.video?.nodeType ? getComputedStyle(o.video).objectFit : '') || 'cover';
    const s = fit === 'contain' || fit === 'scale-down' ? Math.min(W / vw, H / vh) : Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2; let X = ox + x * vw * s; const Y = oy + y * vh * s;
    if (o.mirror) X = W - X; return { x: X, y: Y, s };
  }
  const now = () => performance.now() / 1000;
  function glow(img, x, y, sz, a = 1){ cx.globalAlpha = Math.max(0, Math.min(1, a)); cx.drawImage(img, x - sz / 2, y - sz / 2, sz, sz); cx.globalAlpha = 1; }
  function pos(name, t){ const j = J[name]?.at(t); if (!j) return null; const p = map(j.x, j.y); return { x: p.x, y: p.y, speed: j.speed * p.s * (o.video?.videoWidth || 640), vx: j.vx, vy: j.vy }; }
  function bodyScale(t){ const a = pos('lShoulder', t), b = pos('rShoulder', t); return a && b ? Math.max(40, Math.hypot(a.x - b.x, a.y - b.y)) : 120; }

  // ───── state of each effect ─────
  const S = { speed: false, cue: null, comet: { on: false, f: null, tail: [], seen: 0, chain: CHAIN }, parts: [], rings: [], words: [], beat: { on: false, next: null, period: 1, lead: 0.6 }, ripples: [],
    limbs: null, pose: null, meter: null, ice: null, rail: null, halo: 0, guide: null, sparkle: null, flashes: [] };

  function feed(k, t = now()){ for (const n of NAMES){ const p = k?.[n]; if (p) J[n].feed(p.x, p.y, p.vis ?? p.score ?? 1, t); } }

  function burst(where, kind = 'gold', n = 70, speed = 420){ const t = now(); const p = typeof where === 'string' ? pos(where, t) : where; if (!p) return;
    const img = kind === 'green' ? SP.green : kind === 'cyan' ? SP.cyan : SP.gold;
    for (let i = 0; i < n; i++){ const a = Math.random() * Math.PI * 2, s = speed * (0.35 + Math.random()); S.parts.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.5 + Math.random() * 0.45, img, sz: 10 + Math.random() * 16 }); }
    S.rings.push({ x: p.x, y: p.y, t: 0, kind }); }
  function word(text, where, color = '#ffd65a'){ const p = typeof where === 'string' ? pos(where, now()) : where; if (p) S.words.push({ text, x: p.x, y: p.y - 60, t: 0, color }); }

  // ───── the frame ─────
  let last = now();
  function frame(){
    const t = now(), dt = Math.min(0.05, t - last); last = t;
    cx.clearRect(0, 0, W, H);
    const sc = bodyScale(t);
    cx.globalCompositeOperation = 'lighter';

    // 1 · speed glow: every joint glows brighter the faster it moves (EyeToy)
    if (S.speed) for (const n of NAMES){ const p = pos(n, t); if (!p) continue; const e = Math.min(1, p.speed / (sc * 6)); if (e > 0.05) glow(SP.gold, p.x, p.y, sc * (0.35 + 1.1 * e), 0.15 + 0.8 * e); }

    // 2 · wave cue: dots light up along the child's own arm chain, in wave order
    if (S.cue){ const k = (t - S.cue.t0) / S.cue.dur, order = S.cue.chain || (S.cue.dir === 'R→L' ? [...CHAIN].reverse() : CHAIN);
      order.forEach((n, i) => { const p = pos(n, t); if (!p) return; const lit = k * (order.length + 1) - i; const a = lit > 0 ? Math.max(0.35, 1 - (lit - 1) * 0.5) : 0.25;
        glow(SP.halo, p.x, p.y, sc * (lit > 0 && lit < 1.2 ? 1.6 : 0.9), a * 0.8); glow(SP.cyan, p.x, p.y, sc * 0.45, a); });
      if (k >= 1.25) S.cue = null; }

    // 3 · comet: rides the arm chain at the detected wave front, smooth, tapered fading tail (Snap trails)
    if (S.comet.on && S.comet.f != null && t - S.comet.seen < 0.4){   // the front vanished > 0.4s ago → no head where the child isn't
      const C = S.comet.chain, f = Math.max(0, Math.min(C.length - 1, S.comet.f)), i = Math.floor(f), u = f - i;
      const a = pos(C[i], t), b = pos(C[Math.min(i + 1, C.length - 1)], t);
      if (a && b){ const h = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t };
        S.comet.tail.push(h); while (S.comet.tail.length && t - S.comet.tail[0].t > 0.35) S.comet.tail.shift();
        const T = S.comet.tail; cx.lineCap = 'round';
        for (const [wm, col, am] of [[3.2, '110,140,255', .18], [1.6, '120,230,255', .45], [.55, '255,255,255', .9]])
          for (let n = 1; n < T.length; n++){ const p = n / (T.length - 1); cx.strokeStyle = `rgba(${col},${am * p * p})`; cx.lineWidth = Math.max(0.5, sc * 0.12 * wm * Math.pow(p, 1.4)); cx.beginPath(); cx.moveTo(T[n - 1].x, T[n - 1].y); cx.lineTo(T[n].x, T[n].y); cx.stroke(); }
        glow(SP.halo, h.x, h.y, sc * 1.4, .9); glow(SP.cyan, h.x, h.y, sc * 0.55, 1); } }
    else S.comet.tail.length = 0;

    // 4 · beat ring on the chest: an approach ring that closes EXACTLY on the beat (rhythm-game style)
    if (S.beat.on){ const ls = pos('lShoulder', t), rs = pos('rShoulder', t), lh = pos('lHip', t), rh = pos('rHip', t);
      if (ls && rs){ const c = { x: (ls.x + rs.x + (lh?.x ?? ls.x) + (rh?.x ?? rs.x)) / 4, y: (ls.y + rs.y) / 2 * 0.6 + ((lh?.y ?? ls.y + sc) + (rh?.y ?? rs.y + sc)) / 2 * 0.4 };
        const nb = S.beat.next?.(t); if (nb != null){ const k = (nb - t) / S.beat.lead;              // 1 → 0 as the beat arrives
          const r0 = sc * 0.45, r = r0 * (1 + 1.6 * Math.max(0, Math.min(1, k)));
          cx.strokeStyle = `rgba(255,215,100,${0.25 + 0.7 * (1 - Math.max(0, Math.min(1, k)))})`; cx.lineWidth = Math.max(2, sc * 0.05); cx.beginPath(); cx.arc(c.x, c.y, r, 0, 7); cx.stroke();
          cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.lineWidth = 2; cx.beginPath(); cx.arc(c.x, c.y, r0, 0, 7); cx.stroke(); }
        S.beat.center = c; } }

    // 5 · floor ripples under the feet
    S.ripples = S.ripples.filter(r => (r.t += dt) < 0.6);
    for (const r of S.ripples){ const k = r.t / 0.6; cx.strokeStyle = `rgba(${r.gold ? '255,215,100' : '120,230,255'},${1 - k})`; cx.lineWidth = 3; cx.beginPath(); cx.ellipse(r.x, r.y, sc * (0.4 + 1.8 * k), sc * (0.1 + 0.35 * k), 0, 0, 7); cx.stroke(); }

    // ── skeleton helpers for the new effects
    const P = n => pos(n, t);
    const seg = (a, b, col, w, alpha = 1) => { const A = P(a), Bp = P(b); if (!A || !Bp) return; cx.strokeStyle = `rgba(${col},${alpha})`; cx.lineWidth = w; cx.lineCap = 'round'; cx.beginPath(); cx.moveTo(A.x, A.y); cx.lineTo(Bp.x, Bp.y); cx.stroke(); };
    const LIMB = { lArm: [['lShoulder', 'lElbow'], ['lElbow', 'lWrist']], rArm: [['rShoulder', 'rElbow'], ['rElbow', 'rWrist']],
                   lLeg: [['lHip', 'lKnee'], ['lKnee', 'lAnkle']], rLeg: [['rHip', 'rKnee'], ['rKnee', 'rAnkle']], torso: [['lShoulder', 'rShoulder'], ['lShoulder', 'lHip'], ['rShoulder', 'rHip'], ['lHip', 'rHip']] };
    const stateCol = st => st === 'good' ? COL.green : st === 'wrong' ? COL.warm : st === 'move' ? COL.cyan : null;

    // 8 · LIMB COLORS — the part that's right glows green, the part to move glows cyan, the wrong part soft orange (Kinect Star Wars)
    if (S.limbs) for (const [part, st] of Object.entries(S.limbs)){ const col = stateCol(st); if (!col || !LIMB[part]) continue;
      for (const [a, b] of LIMB[part]){ seg(a, b, col, sc * 0.34, 0.22); seg(a, b, col, sc * 0.14, 0.75); } }

    // 9 · POSE GHOST + TARGET RINGS — the pose to make, drawn ON the child's own body; rings at the hands fill as each hand arrives (Your Shape / Hole in the Wall)
    if (S.pose){ const ls = P('lShoulder'), rs = P('rShoulder');
      if (ls && rs){ const G = ghostPose(S.pose.name, ls, rs, P('lHip'), P('rHip')), pr = S.pose;
        const colFor = side => pr.wrong === side ? COL.warm : (pr[side] ?? 0) >= 0.8 ? COL.green : COL.cyan;
        cx.setLineDash([sc * 0.12, sc * 0.1]);
        for (const side of ['l', 'r']){ const g = G[side]; if (!g) continue; cx.strokeStyle = `rgba(${colFor(side)},${0.55 + 0.35 * Math.sin(t * 4)})`; cx.lineWidth = sc * 0.1;
          cx.beginPath(); cx.moveTo(g.s.x, g.s.y); cx.lineTo(g.e.x, g.e.y); cx.lineTo(g.w.x, g.w.y); cx.stroke(); }
        for (const leg of G.legs || []){ cx.strokeStyle = `rgba(${COL.cyan},.55)`; cx.lineWidth = sc * 0.1; cx.beginPath(); cx.moveTo(leg[0].x, leg[0].y); cx.lineTo(leg[1].x, leg[1].y); cx.lineTo(leg[2].x, leg[2].y); cx.stroke(); }
        cx.setLineDash([]);
        for (const side of ['l', 'r']){ const g = G[side]; if (!g || !G.rings) continue; const v = Math.max(0, Math.min(1, pr[side] ?? 0)), col = colFor(side), r = sc * 0.32;
          glow(v >= 0.8 ? SP.green : SP.halo, g.w.x, g.w.y, sc * (1.1 + 0.3 * Math.sin(t * 5)), 0.35 + 0.4 * v);
          cx.strokeStyle = 'rgba(255,255,255,.25)'; cx.lineWidth = sc * 0.06; cx.beginPath(); cx.arc(g.w.x, g.w.y, r, 0, 7); cx.stroke();
          cx.strokeStyle = `rgba(${col},.95)`; cx.lineWidth = sc * 0.08; cx.beginPath(); cx.arc(g.w.x, g.w.y, r, -Math.PI / 2, -Math.PI / 2 + v * Math.PI * 2); cx.stroke(); } } }

    // 10 · METER above a joint — fills as the joint rises (the intro shoulder lift, Upper Body pops) (Tempo range meter)
    if (S.meter){ const J0 = P(S.meter.joint); if (J0){ const v = Math.max(0, Math.min(1, S.meter.progress)), c0 = { x: J0.x, y: J0.y - sc * 0.9 }, r = sc * 0.38, full = v >= 0.99;
      cx.strokeStyle = 'rgba(255,255,255,.2)'; cx.lineWidth = sc * 0.1; cx.beginPath(); cx.arc(c0.x, c0.y, r, 0, 7); cx.stroke();
      cx.strokeStyle = `rgba(${full ? COL.gold : COL.cyan},.95)`; cx.beginPath(); cx.arc(c0.x, c0.y, r, -Math.PI / 2, -Math.PI / 2 + v * Math.PI * 2); cx.stroke();
      glow(full ? SP.gold : SP.cyan, J0.x, J0.y, sc * (0.5 + 0.9 * v), 0.4 + 0.6 * v); } }

    // 11 · ICE — frost climbs from the feet up when the freeze starts; the part that wobbles glows soft orange (never red)
    if (S.ice){ const k = Math.min(1, (t - S.ice.t0) / 0.45), pts = ['lAnkle', 'rAnkle', 'lKnee', 'rKnee', 'lHip', 'rHip', 'lWrist', 'rWrist', 'lElbow', 'rElbow', 'lShoulder', 'rShoulder', 'nose'].map(n => [n, P(n)]).filter(x => x[1]);
      if (pts.length){ const ys = pts.map(x => x[1].y), yMax = Math.max(...ys), yMin = Math.min(...ys) - sc * 0.4, yTop = yMax - (yMax - yMin) * k;
        for (const [n, p] of pts) if (p.y >= yTop) glow(SP.ice, p.x, p.y, sc * 1.1, 0.8);
        for (const part of Object.keys(LIMB)) if (part !== 'torso') for (const [a, b] of LIMB[part]){ const A = P(a), Bq = P(b); if (A && Bq && Math.min(A.y, Bq.y) >= yTop) seg(a, b, COL.ice, sc * 0.2, 0.35); }
        if (S.ice.wobble && LIMB[S.ice.wobble]) for (const [a, b] of LIMB[S.ice.wobble]){ seg(a, b, COL.warm, sc * 0.3, 0.3); seg(a, b, COL.warm, sc * 0.12, 0.85); }
        if (S.ice.hold) { const n = P('nose'); if (n) glow(SP.ice, n.x, n.y + sc, sc * (2.5 + 1.5 * Math.min(1, S.ice.hold)), 0.25 + 0.25 * Math.min(1, S.ice.hold)); } } }

    // 12 · RAIL — chest slide: a light rail across the chest, a bead that rides with the chest, a calm ring on the hips (orange if they move)
    if (S.rail){ const ls = P('lShoulder'), rs = P('rShoulder'), lh = P('lHip'), rh = P('rHip');
      if (ls && rs){ const cy0 = (ls.y + rs.y) / 2 + sc * 0.45, hx = lh && rh ? (lh.x + rh.x) / 2 : (ls.x + rs.x) / 2, half = sc * 1.4;
        for (const [w, a] of [[sc * 0.3, .12], [sc * 0.12, .3], [sc * 0.04, .8]]){ cx.strokeStyle = `rgba(${COL.cyan},${a})`; cx.lineWidth = w; cx.beginPath(); cx.moveTo(hx - half, cy0); cx.lineTo(hx + half, cy0); cx.stroke(); }
        const bx = (ls.x + rs.x) / 2, edge = Math.min(1, Math.abs(S.rail.slide ?? 0) / 0.8);
        glow(SP.halo, bx, cy0, sc * (1.6 + 0.8 * edge), 0.9); glow(edge >= 1 ? SP.gold : SP.cyan, bx, cy0, sc * 0.6, 1);
        if (lh && rh){ cx.strokeStyle = S.rail.hipsStill === false ? `rgba(${COL.warm},.9)` : 'rgba(255,255,255,.5)'; cx.setLineDash([sc * 0.12, sc * 0.1]); cx.lineWidth = sc * 0.06;
          cx.beginPath(); cx.ellipse((lh.x + rh.x) / 2, (lh.y + rh.y) / 2, sc * 0.9, sc * 0.25, 0, 0, 7); cx.stroke(); cx.setLineDash([]); } } }

    // 13 · FLASHES — a star that snaps where a move STOPS (pops / hits) (Snapchat Star Burst)
    S.flashes = S.flashes.filter(f => (f.t += dt) < 0.32);
    for (const f of S.flashes){ const k = f.t / 0.32, a = 1 - k, L0 = sc * (1.1 + 0.9 * (1 - k)) * (k < 0.1 ? k / 0.1 : 1);
      glow(SP.gold, f.x, f.y, sc * 2.2 * (1 - k * 0.5), a); glow(SP.cyan, f.x, f.y, sc, a);
      cx.strokeStyle = `rgba(255,250,220,${a})`; cx.lineWidth = sc * 0.07 * a + 1; cx.lineCap = 'round';
      for (let i = 0; i < 4; i++){ const ang = i * Math.PI / 2 + Math.PI / 4; cx.beginPath(); cx.moveTo(f.x, f.y); cx.lineTo(f.x + Math.cos(ang) * L0, f.y + Math.sin(ang) * L0); cx.stroke(); } }

    // 14 · SPARKLES on a joint (the hello wave) — a few twinkles that trail the hand
    if (S.sparkle){ const J0 = P(S.sparkle.joint); if (J0 && Math.random() < 0.6) S.parts.push({ x: J0.x + (Math.random() - .5) * sc * .6, y: J0.y + (Math.random() - .5) * sc * .6, vx: (Math.random() - .5) * 60, vy: -40 - Math.random() * 60, t: 0, life: 0.5, img: Math.random() < .5 ? SP.gold : SP.cyan, sz: 8 + Math.random() * 10 }); }

    // 15 · FRAME GUIDE — where to stand: arrows that point the way (step back / come closer / move over). No text needed.
    if (S.guide && S.guide !== 'ok'){ const cxm = W / 2, cym = H / 2, pulse = 0.5 + 0.5 * Math.sin(t * 5), a = 0.5 + 0.5 * pulse;
      cx.strokeStyle = `rgba(${COL.cyan},${a})`; cx.lineWidth = Math.max(4, W * 0.008); cx.lineCap = 'round'; cx.lineJoin = 'round';
      const arrow = (x, y, ang, len) => { const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(ex, ey); cx.moveTo(ex, ey);
        cx.lineTo(ex - Math.cos(ang - 0.5) * len * 0.35, ey - Math.sin(ang - 0.5) * len * 0.35); cx.moveTo(ex, ey); cx.lineTo(ex - Math.cos(ang + 0.5) * len * 0.35, ey - Math.sin(ang + 0.5) * len * 0.35); cx.stroke(); };
      const L0 = Math.min(W, H) * 0.12, m = Math.min(W, H) * 0.12;
      if (S.guide === 'tooClose') for (const [x, y] of [[m, m], [W - m, m], [m, H - m], [W - m, H - m]]) arrow(x, y, Math.atan2(cym - y, cxm - x), L0 * (0.8 + 0.2 * pulse));      // corners point IN: step back
      if (S.guide === 'tooFar') for (const [x, y] of [[cxm - L0 * 0.4, cym], [cxm + L0 * 0.4, cym], [cxm, cym - L0 * 0.4], [cxm, cym + L0 * 0.4]]) arrow(x, y, Math.atan2(y - cym, x - cxm), L0 * (0.8 + 0.2 * pulse));   // centre points OUT: come closer
      if (S.guide === 'moveLeft')  arrow(cxm + L0, cym, Math.PI, L0 * 2);
      if (S.guide === 'moveRight') arrow(cxm - L0, cym, 0, L0 * 2); }

    // 6 · particles + shockwave rings
    S.parts = S.parts.filter(p => (p.t += dt) < p.life);
    for (const p of S.parts){ p.vx *= 0.92; p.vy = p.vy * 0.92 + 380 * dt; p.x += p.vx * dt; p.y += p.vy * dt; const a = Math.pow(1 - p.t / p.life, 0.7); glow(p.img, p.x, p.y, p.sz * (0.6 + 0.4 * a), a); }
    S.rings = S.rings.filter(r => (r.t += dt) < 0.4);
    for (const r of S.rings){ const k = r.t / 0.4; cx.strokeStyle = r.kind === 'cyan' ? `rgba(150,235,255,${1 - k})` : `rgba(255,220,120,${1 - k})`; cx.lineWidth = 6 * (1 - k) + 1; cx.beginPath(); cx.arc(r.x, r.y, 18 + sc * 1.6 * k, 0, 7); cx.stroke(); }
    cx.globalCompositeOperation = 'source-over';

    // 7 · words ("+100", "YES!")
    S.words = S.words.filter(w => (w.t += dt) < 0.9);
    for (const w of S.words){ const k = w.t / 0.9, sc2 = k < .15 ? .6 + k / .15 * .55 : 1.15 - .15 * Math.min(1, (k - .15) / .2);
      cx.save(); cx.translate(w.x, w.y - 40 * k); cx.scale(sc2, sc2); cx.globalAlpha = 1 - Math.max(0, (k - .6) / .4); cx.font = '900 44px system-ui'; cx.textAlign = 'center';
      cx.lineWidth = 7; cx.strokeStyle = 'rgba(40,15,0,.8)'; cx.strokeText(w.text, 0, 0); cx.fillStyle = w.color; cx.fillText(w.text, 0, 0); cx.restore(); }

    if (o.debug){ cx.fillStyle = 'rgba(255,255,255,.8)'; for (const n of NAMES){ const p = pos(n, t); if (p){ cx.beginPath(); cx.arc(p.x, p.y, 4, 0, 7); cx.fill(); } } }
    raf = requestAnimationFrame(frame);
  }
  let raf = requestAnimationFrame(frame);

  return {
    feed, burst, word,
    speedGlow(on){ S.speed = !!on; },
    /* waveCue(chain, durMs): dots light up along `chain` in order — e.g. ['rShoulder','rElbow','rWrist'] for a one-arm wave.
       (legacy: waveCue('L→R'|'R→L', durMs) = the whole-body chain) */
    waveCue(chainOrDir = 'L→R', durMs = 1200){ const chain = Array.isArray(chainOrDir) ? chainOrDir : null; S.cue = { dir: chain ? null : chainOrDir, chain, t0: now(), dur: durMs / 1000 }; },
    /* comet.start(chain) → comet.follow(front index along that chain) → comet.end(). The chain can change mid-wave (the detector reports which arm). */
    comet: { start(chain){ S.comet.on = true; S.comet.f = null; S.comet.tail.length = 0; if (chain) S.comet.chain = chain; },
             follow(f, chain){ if (chain && chain !== S.comet.chain && chain.join() !== S.comet.chain.join()){ S.comet.chain = chain; S.comet.f = null; S.comet.tail.length = 0; }
                               if (f != null){ S.comet.f = S.comet.f == null ? f : S.comet.f + (f - S.comet.f) * 0.35; S.comet.seen = now(); } },
             end(){ S.comet.on = false; } },
    /* beat: nextBeatAt(tPerfSec) → the next target beat time (performance seconds) or null; lead = seconds the ring takes to close */
    beatRing(on, nextBeatAt = null, lead = 0.6){ S.beat.on = !!on; S.beat.next = nextBeatAt; S.beat.lead = lead; },
    hit(grade){ const c = S.beat.center; const la = pos('lAnkle', now()), ra = pos('rAnkle', now()); const foot = la && ra ? { x: (la.x + ra.x) / 2, y: Math.max(la.y, ra.y) } : c ? { x: c.x, y: c.y + bodyScale(now()) * 2.2 } : null;
      if (grade === 'on'){ if (c) burst(c, 'gold', 60, 380); if (foot) S.ripples.push({ ...foot, t: 0, gold: true }); if (c) word('+100', c); }
      else if (grade === 'near'){ if (foot) S.ripples.push({ ...foot, t: 0, gold: false }); if (c) S.rings.push({ x: c.x, y: c.y, t: 0, kind: 'cyan' }); } },
    /* limbs({ lArm:'good'|'move'|'wrong'|null, rArm, lLeg, rLeg, torso }) — color body parts; limbs(null) clears */
    limbs(state){ S.limbs = state || null; },
    /* pose(name, judge) — ghost of the target pose on the child + rings at the hands filling with judge.l / judge.r;
       name: armsUp · armsOut · handsHead · leftUp · rightUp · star · bear · flamingo · frog ; pose(null) clears */
    pose(name, judge = {}){ S.pose = name ? { name, l: judge.l ?? 0, r: judge.r ?? 0, wrong: judge.wrong ?? null } : null; },
    /* meter(joint, progress 0..1) — a ring above the joint that fills (shoulder lift); meter(null) clears */
    meter(joint, progress = 0){ S.meter = joint ? { joint, progress } : null; },
    /* ice(on, { wobble:'lArm'|'rArm'|'lLeg'|'rLeg'|null, hold: 0..1 }) — frost from the feet up; call again to update wobble/hold */
    ice(on, st = {}){ if (!on){ S.ice = null; return; } S.ice = { t0: S.ice?.t0 ?? now(), wobble: st.wobble ?? null, hold: st.hold ?? 0 }; },
    /* rail({ slide: −1..1, hipsStill }) — chest slide rail; rail(null) clears */
    rail(st){ S.rail = st || null; },
    /* flash(joint | {x,y}) — the star snap where a move stops */
    flash(where){ const p = typeof where === 'string' ? pos(where, now()) : where; if (p) S.flashes.push({ x: p.x, y: p.y, t: 0 }); },
    /* sparkle(joint | null) — twinkles trailing a joint (hello wave) */
    sparkle(joint){ S.sparkle = joint ? { joint } : null; },
    /* guide('tooClose'|'tooFar'|'moveLeft'|'moveRight'|'ok'|null) — where-to-stand arrows */
    guide(state){ S.guide = state || null; },
    /* snow(joint | {x,y}) — an icy burst (a freeze well held) */
    snow(where){ burst(where, 'cyan', 60, 300); },
    clearAll(){ S.limbs = S.pose = S.meter = S.ice = S.rail = S.sparkle = S.guide = null; S.cue = null; S.comet.on = false; S.beat.on = false; S.speed = false; },
    debug(on){ o.debug = !!on; },
    destroy(){ cancelAnimationFrame(raf); removeEventListener('resize', resize); ro?.disconnect(); cx.clearRect(0, 0, W, H); if (canvas !== host) canvas.remove?.(); },
  };
}
