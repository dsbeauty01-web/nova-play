/* beta/lib/arms.js — per-arm geometry for pose matching. Pure. Pixel space (x·w, y·h), so a portrait camera
   doesn't bend the angles. Arms are the PLAYER'S OWN (kp.js OWN, mirror measured).
     upper  = angle of shoulder→elbow from straight DOWN, degrees: 0 down · 90 out to the side · 180 up
     elbow  = the inside angle at the elbow: 180 straight · 90 square · small = folded
     wristUp= how far the wrist is ABOVE the shoulder, in shoulder-widths (negative = below)
   Returns null for an arm whose shoulder, elbow or wrist is absent (< 0.30) — that arm is unscoreable. */
import { OWN } from './kp.js';

const deg = r => r * 180 / Math.PI;
export function arm(k, side, w = 1, h = 1){
  const [sn, en, wn] = OWN[side];
  const S = k?.[sn], E = k?.[en], W = k?.[wn], L = k?.lShoulder, R = k?.rShoulder;
  if (!S || !E || !W || !L || !R) return null;
  const P = p => ({ x: p.x * w, y: p.y * h });
  const s = P(S), e = P(E), wr = P(W), sw = Math.max(1e-6, Math.hypot(P(L).x - P(R).x, P(L).y - P(R).y));
  const ux = e.x - s.x, uy = e.y - s.y;
  const upper = deg(Math.acos(Math.max(-1, Math.min(1, uy / Math.max(1e-6, Math.hypot(ux, uy))))));
  const a = { x: s.x - e.x, y: s.y - e.y }, b = { x: wr.x - e.x, y: wr.y - e.y };
  const elbow = deg(Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / Math.max(1e-6, Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))))));
  return { upper, elbow, wristUp: (s.y - wr.y) / sw };
}
