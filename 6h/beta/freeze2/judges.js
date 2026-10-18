/* beta/freeze2/judges.js — the shared judging core (same file Nova Says FAST uses): every judging
   decision, pure (no DOM, no audio) so it is testable in Node. Freeze v2 uses update/calibration/sw
   and the energy thresholds; the Window class below is the Simon-Says command judge, unused here.
   Input: MoveNet keypoints normalized {name:{x,y,vis}} (x,y in 0..1, y grows downward), time in SECONDS.
   Written by the architect. */

export const JOINTS = ['lShoulder','rShoulder','lElbow','rElbow','lWrist','rWrist'];

export function createJudges(T){
  const st = {
    prev:null, prevT:0, energy:0,
    stillLevel:null, reachMax:null,
    stillS:[], reachS:[], sampling:null,
    lastUp:{ L:false, R:false }, lastUpHigh:{ L:false, R:false }, lastUpT:{ L:-9, R:-9 },
    thr:{ move:T.moveFloor, still:T.stillFloor, reach:T.reachDefault, up:T.upHead },
  };
  const vis = (k,j) => !!k && !!k[j] && k[j].vis > T.visMin;
  const sw  = k => (vis(k,'lShoulder') && vis(k,'rShoulder')) ? Math.max(0.05, Math.abs(k.lShoulder.x - k.rShoulder.x)) : null;

  // ── motion energy: displacement per SECOND in shoulder-widths, one-frame teleports rejected ──
  function update(k, t){
    const w = sw(k); if (!w) return;
    if (st.prev){
      const dt = Math.max(0.016, t - st.prevT); let s = 0, n = 0;
      for (const j of JOINTS){
        if (vis(k,j) && vis(st.prev,j)){
          const d = Math.hypot(k[j].x - st.prev[j].x, k[j].y - st.prev[j].y) / w;
          if (d > T.teleport) continue;                     // detection glitch, not a movement
          s += d; n++;
        }
      }
      if (n >= 3) st.energy = st.energy * 0.6 + ((s / n) / dt) * 0.4;
    }
    st.prev = k; st.prevT = t;
    if (st.sampling === 'still') st.stillS.push(st.energy);
    if (st.sampling === 'reach'){ const r = reachOf(k); if (r != null) st.reachS.push(r); }
    for (const side of ['L','R']){ const u = armUpRaw(k, side); if (u != null){ st.lastUp[side] = u; st.lastUpHigh[side] = !!raisedRaw(k, side, st.thr.up); st.lastUpT[side] = t; } }
  }

  // ── calibration on THIS child ──
  const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x,y) => x-y); return s[Math.min(s.length-1, Math.floor(s.length*p))]; };
  function startSample(kind){ st.sampling = kind; }
  function stopSample(){ st.sampling = null; }
  function finishCalibration(){
    st.stillLevel = pct(st.stillS, 0.5) ?? T.stillDefault;
    st.reachMax   = pct(st.reachS, 0.9);
    /* [MEASURED FIX 2026-09-27] thr.move is now CAPPED (T.moveCeil). Unbounded, it was
       still × 4.0, and the "still" sample is not the child — it is mostly MoveNet's own jitter:
       a motionless body (one frame held in front of the real detector) measures p50 0.43, which is
       exactly the 0.4298 / 0.239 readings the two 2026-09-27 sessions flagged as suspicious. 0.43 × 4
       = 1.72, and at 1.72 a dancing body is judged "held" in 90% of 2.5s windows (test/
       freeze2_realdata_test.mjs, real traces). That is the v1.0.1 failure again — every freeze a win.
       The cap keeps the per-child adjustment where it helps and forbids it from leaving the band the
       measurement says works. Nova Says FAST has its own copy of this file and is untouched. */
    st.thr.move   = Math.min(T.moveCeil ?? Infinity, Math.max(T.moveFloor, st.stillLevel * T.moveK));
    st.thr.still  = Math.max(T.stillFloor, st.stillLevel * T.stillK);
    st.thr.reach  = (st.reachMax != null && st.reachMax > 0.3) ? Math.max(T.reachFloor, T.reachFrac * st.reachMax) : T.reachDefault;
    st.thr.up     = (st.reachMax != null && st.reachMax > 0.3) ? Math.min(T.upHead, T.upFrac * st.reachMax) : T.upHead;   // arms up = wrists above the HEAD, not just the shoulders
    return { still:st.stillLevel, reachMax:st.reachMax, thr:{ ...st.thr } };
  }

  // ── poses ──
  function reachOf(k){ const w = sw(k); if (!w) return null; let r = null;
    for (const [wr, sh] of [['lWrist','lShoulder'],['rWrist','rShoulder']]) if (vis(k,wr) && vis(k,sh)){ const v = (k[sh].y - k[wr].y) / w; r = r == null ? v : Math.max(r, v); }
    return r; }
  function raisedRaw(k, side, level){                       // wrist above shoulder by > level (sw) → true/false; null = can't tell
    const w = sw(k); if (!w) return null;
    const wr = side === 'L' ? 'lWrist' : 'rWrist', el = side === 'L' ? 'lElbow' : 'rElbow', sh = side === 'L' ? 'lShoulder' : 'rShoulder';
    if (!vis(k,sh)) return null;
    if (vis(k,wr)) return (k[sh].y - k[wr].y) / w > level;
    if (vis(k,el)) return (k[sh].y - k[el].y) / w > level * T.elbowFrac ? true : null;   // wrist left the frame upward: the elbow is enough (elbow ≈ half the wrist height)
    return null;
  }
  const armUpRaw = (k, side) => raisedRaw(k, side, st.thr.reach);
  function armUp(k, side, t){ const r = armUpRaw(k, side); if (r != null) return r; return (t - st.lastUpT[side] < T.lastUpHoldS) ? st.lastUp[side] : false; }
  const POSES = {
    armsUp:      (k,t) => { const u = s => { const r = raisedRaw(k, s, st.thr.up); return r != null ? r : (t - st.lastUpT[s] < T.lastUpHoldS && st.lastUp[s] && st.lastUpHigh[s]); };
                            return u('L') && u('R'); },
    oneArm:      (k,t) => armUp(k,'L',t) || armUp(k,'R',t),
    armsOut:     (k)   => { const w = sw(k); if (!w || !vis(k,'lWrist') || !vis(k,'rWrist')) return false;
                            const out = s => { const wr = s==='L'?'lWrist':'rWrist', sh = s==='L'?'lShoulder':'rShoulder';
                              return Math.abs(k[wr].x - k[sh].x) / w > T.outX && Math.abs(k[wr].y - k[sh].y) / w < T.outY; };
                            return out('L') && out('R'); },
    handsOnHead: (k)   => { const w = sw(k); if (!w || !vis(k,'lWrist') || !vis(k,'rWrist')) return false;
                            const noseX = vis(k,'nose') ? k.nose.x : (k.lShoulder.x + k.rShoulder.x) / 2;
                            const up = s => { const wr = s==='L'?'lWrist':'rWrist', sh = s==='L'?'lShoulder':'rShoulder', h = (k[sh].y - k[wr].y) / w; return h > T.headUp && h < st.thr.up; };
                            const near = s => Math.abs(k[s==='L'?'lWrist':'rWrist'].x - noseX) / w < T.headX;
                            const close = Math.hypot(k.lWrist.x - k.rWrist.x, k.lWrist.y - k.rWrist.y) / w < T.headClose;
                            return up('L') && up('R') && near('L') && near('R') && close; },
    freeze:      ()    => st.energy < st.thr.still,
  };

  // ── the window: 'hit' | 'miss' | 'gotcha' | 'held' | 'void' ──
  class Window {
    constructor(kind, cmd, t0, dur){ this.kind = kind; this.cmd = cmd; this.t0 = t0; this.t1 = t0 + dur; this.since = null; this.moveSince = null;
      this.poseAtStart = null; this.settledAtStart = null; this.lostSince = null; this.result = null; }
    feed(k, t){
      if (this.result) return this.result;
      if (!sw(k)){ this.lostSince ??= t; if (t - this.lostSince > T.lostVoidS) return (this.result = 'void'); return null; }
      this.lostSince = null;
      const inPose = POSES[this.cmd](k, t);
      if (this.poseAtStart === null){ this.poseAtStart = inPose; this.settledAtStart = st.energy < st.thr.move; }
      if (this.kind === 'real'){
        const hold = this.cmd === 'freeze' ? T.freezeHoldS : T.hitHoldS;
        if (inPose){ this.since ??= t; if (t - this.since >= hold) return (this.result = 'hit'); } else this.since = null;
      } else if (t - this.t0 >= T.trickIgnoreS){
        // caught = he DID the command (a new pose), or — if he was settled when it began — a big movement
        const didIt = inPose && !this.poseAtStart;
        const bigMove = this.settledAtStart && st.energy > st.thr.move * T.gotchaMoveK;
        if (didIt){ this.since ??= t; if (t - this.since >= T.gotchaPoseS) return (this.result = 'gotcha'); } else this.since = null;
        if (bigMove){ this.moveSince ??= t; if (t - this.moveSince >= T.gotchaMoveS) return (this.result = 'gotcha'); } else this.moveSince = null;
      }
      if (t >= this.t1) return (this.result = this.kind === 'real' ? 'miss' : 'held');
      return null;
    }
    timeout(t){ if (!this.result && t >= this.t1 + T.stallS) this.result = 'void'; return this.result; }   // frames stopped: never free stars
  }

  return { st, update, startSample, stopSample, finishCalibration, POSES, Window, sw, vis };
}
