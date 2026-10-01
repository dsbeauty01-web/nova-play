// shared/cue-window.js — graded timing windows (ENGINE-DETECT b0.11 §3).
// PERFECT / GOOD / OK inside the window; outside = null (no score). Never binary.
export function grade(t, target, win) {
  const d = Math.abs(t - target);
  if (d > win) return null;
  return d < win * 0.33 ? 'PERFECT' : d < win * 0.66 ? 'GOOD' : 'OK';
}
// score = base × {PERFECT:1.5, GOOD:1.2, OK:1} × (wrong side ? 0.5 : 1) + (iso ? isoBonus : 0)
export const GRADE_MULT = { PERFECT: 1.5, GOOD: 1.2, OK: 1 };
export function score(base, g, { wrongSide = false, iso = false, isoBonus = 0 } = {}) {
  if (!g) return 0;
  return Math.round(base * GRADE_MULT[g] * (wrongSide ? 0.5 : 1) + (iso ? isoBonus : 0));
}
