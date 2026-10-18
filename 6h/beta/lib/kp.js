/* beta/lib/kp.js — keypoints for every beta game: the play-recording format and the confidence gates.
   Pure (no DOM) → used by the pages AND the Node replay tests, so a replay judges exactly what a camera would.

   Play-recording frame: { t, lShoulder:[x,y,conf], rShoulder, … }   x,y normalized 0..1 of the CAMERA image
   (not mirrored), y grows downward. Recordings keep the raw confidence; the gates below apply when reading.

   Names follow MoveNet's own labels (left_shoulder → lShoulder). Which side of the PLAYER that is was measured,
   not assumed — see test/clips/README.md "Mirror proof" and OWN below. */

export const NAMES = ['nose','lShoulder','rShoulder','lElbow','rElbow','lWrist','rWrist','lHip','rHip','lKnee','rKnee','lAnkle','rAnkle'];
const MN = { nose:0, lShoulder:5, rShoulder:6, lElbow:7, rElbow:8, lWrist:9, rWrist:10, lHip:11, rHip:12, lKnee:13, rKnee:14, lAnkle:15, rAnkle:16 };

/* Law 7 (6-hour mission): keypoint < 0.30 = absent; ankles < 0.45 = absent. */
export const GATE = { min: 0.30, ankle: 0.45 };

/* MoveNet keypoints (pixels) → one recording frame (normalized). No pose → no joints. */
export function fromMoveNet(kps, W, H){
  const f = {}; if (!kps) return f;
  for (const [n, i] of Object.entries(MN)){ const p = kps[i]; if (p) f[n] = [+(p.x / W).toFixed(4), +(p.y / H).toFixed(4), +(p.score ?? 0).toFixed(3)]; }
  return f;
}

/* recording frame → the judges' shape {name:{x,y,vis}} with the gates applied (a gated joint is simply absent).
   Returns null when nothing passes the gate (no person). */
export function toJudge(frame){
  if (!frame) return null; const k = {}; let n = 0;
  for (const name of NAMES){ const p = frame[name]; if (!p) continue;
    const gate = name.endsWith('Ankle') ? GATE.ankle : GATE.min;
    if (p[2] >= gate){ k[name] = { x: p[0], y: p[1], vis: p[2] }; n++; } }
  return n ? k : null;
}

/* hips/knees absent → the games run upper-body-only (nothing below the waist is ever scored anyway). */
export const upperBodyOnly = k => !k || !(k.lHip && k.rHip && k.lKnee && k.rKnee);

/* The player's OWN arms. MEASURED 2026-10-17 (test/clips/README.md "Mirror proof"): on the un-mirrored camera
   image MoveNet's left_* is the person's own LEFT (own-left-up.mp4: Nova raises her own left hand → lWrist rises).
   So the player's own left arm = lShoulder/lElbow/lWrist. The page MIRRORS the picture for display only. */
export const OWN = { left: ['lShoulder','lElbow','lWrist'], right: ['rShoulder','rElbow','rWrist'] };

/* replay: the frame at time t (loops the clip). */
export function frameAt(rec, t){
  const F = rec.frames, dur = F.length / (rec.fps || 30); if (!F.length) return null;
  const u = ((t % dur) + dur) % dur; return F[Math.min(F.length - 1, Math.floor(u * (rec.fps || 30)))];
}

/* medal from stars ÷ JUDGED rounds (skips are not the child's fault, so they don't count against her).
   Mission thresholds: gold ≥ 90 · silver ≥ 60 · bronze otherwise. Truth Law: no star earned → no medal. */
export function medalFor(stars, judged){
  if (!judged || !stars) return null;
  const r = stars / judged; return r >= 0.9 ? 'gold' : r >= 0.6 ? 'silver' : 'bronze';
}
