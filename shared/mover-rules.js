// shared/mover-rules.js — the move library (one-line RULES on the MoverEngine, ENGINE-DETECT b0.11).
// Each rule reads engine primitives (moved/still/isolated/energy/dist) and returns a hit or null.
import { MoverEngine } from './mover-engine.js';

export const RULES = {
  // ISOLATIONS — mover + must-be-still references. Return {hit:true, side, iso} or null.
  shoulderPop:  E => { const l = E.moved('lShoulder', 'y', 0.3), r = E.moved('rShoulder', 'y', 0.3);
                       const side = l === 'UP' && r === 'UP' ? 'BOTH' : l === 'UP' ? 'L' : r === 'UP' ? 'R' : null;
                       return side ? { hit: true, side, iso: E.isolated('shoulderC', ['hipC']) } : null; },
  shoulderSlide: E => { const d = E.moved('shoulderC', 'x', 0.35); return d ? { hit: true, side: d, iso: E.isolated('shoulderC', ['hipC', 'head']) } : null; },
  ribSlide:     E => { const d = E.moved('shoulderC', 'x', 0.35);       // TRUE rib isolation: ribs travel, hips AND head stay
                       return d ? { hit: true, side: d, iso: E.isolated('shoulderC', ['hipC', 'head'], 0.10) } : null; },
  hipSlide:     E => { const d = E.moved('hipC', 'x', 0.35); return d ? { hit: true, side: d, iso: E.isolated('hipC', ['shoulderC']) } : null; },
  hipBounce:    E => { const d = E.moved('hipC', 'y', 0.25); return d ? { hit: true, side: d, iso: E.isolated('hipC', ['shoulderC']) } : null; },
  headSlide:    E => { const d = E.moved('head', 'x', 0.3); return d ? { hit: true, side: d, iso: E.isolated('head', ['shoulderC']) } : null; },
  headNod:      E => { const d = E.moved('head', 'y', 0.25); return d ? { hit: true, side: d, iso: E.isolated('head', ['shoulderC']) } : null; },
  armRaise:     E => { const l = E.moved('lWrist', 'y', 0.6), r = E.moved('rWrist', 'y', 0.6); const s = l === 'UP' && r === 'UP' ? 'BOTH' : l === 'UP' ? 'L' : r === 'UP' ? 'R' : null; return s ? { hit: true, side: s } : null; },
  // FREEZE
  freeze:       (E, thr = 0.12) => ({ still: E.energy(['shoulderC', 'hipC', 'lWrist', 'rWrist', 'head']) < thr }),
  // CLAP — wrists converge fast (fuse with audio transient if available: onsetMs within ±120ms → confident)
  clap:         (E, audioOnsetMs = null, t = (typeof performance !== 'undefined' ? performance.now() : Date.now())) => {
                       const d = E.dist('lWrist', 'rWrist'); const fast = (E.last?.lWrist?.mag ?? 0) > 0.8;
                       const visual = d != null && d < 0.06 && fast; if (!visual) return null;
                       const fused = audioOnsetMs != null && Math.abs(t - audioOnsetMs) < 120; return { hit: true, confidence: fused ? 1 : 0.6 }; },
  // JUMP — both hips rise fast together
  jump:         E => (E.last?.hipC?.dir === 'UP' && E.last.hipC.mag > 1.2) ? { hit: true } : null,
  // NOVA-SAYS §1 — touch rules (wrist-to-target proximity in normalized units)
  handsOnHead: E => { const l = E.dist('lWrist', 'head'), r = E.dist('rWrist', 'head'); return (l != null && r != null && l < 0.18 && r < 0.18) ? { hit: true } : null; },
  handsOnHips: E => { const l = E.dist('lWrist', 'lHip'), r = E.dist('rWrist', 'rHip'); return (l != null && r != null && l < 0.14 && r < 0.14) ? { hit: true } : null; },
  touchKnees:  E => { const l = E.dist('lWrist', 'lKnee'), r = E.dist('rWrist', 'rKnee'); return (l != null && r != null && l < 0.16 && r < 0.16) ? { hit: true } : null; },
};

// WAVE — traveling peak along the arm chain (order + even spacing = smooth). Stateful.
export class WaveRule {
  constructor(E, arm) { this.E = E; this.chain = arm === 'R' ? ['rShoulder', 'rElbow', 'rWrist', 'rIndex'] : ['lShoulder', 'lElbow', 'lWrist', 'lIndex']; this.h = {}; this.lastT = 0; }
  push(t) { for (const n of this.chain) { const j = this.E.last?.[n]; if (!j) continue; const arr = (this.h[n] ||= []); if (arr.length && arr[arr.length - 1].t === t) continue; arr.push({ t, y: j.y }); this.h[n] = arr.filter(p => t - p.t < 1200); } }   // dedupe same-t (check+phase both push)
  peakT(n) { const h = this.h[n]; if (!h || h.length < 5) return null; for (let i = h.length - 3; i > 1; i--) if (h[i].y < h[i - 1].y && h[i].y < h[i + 1].y && (h[i - 1].y - h[i].y) > 0.02) return h[i].t; return null; }
  check(t = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.push(t); if (t - this.lastT < 600) return null;
    const chain = this.chain.filter(n => this.E.last?.[n]);            // rIndex exists only on MediaPipe → chain adapts (3 or 4 links)
    const peaks = chain.map(n => this.peakT(n)); if (peaks.some(p => p == null)) return null;
    const gaps = peaks.slice(1).map((p, i) => p - peaks[i]); if (!gaps.every(g => g > 40 && g < 400)) return null;
    const spread = Math.max(...gaps) - Math.min(...gaps); this.lastT = t;
    const other = this.chain[0] === 'rShoulder' ? 'lWrist' : 'rWrist';
    const result = { hit: true, quality: spread < 90 ? 'smooth' : spread < 180 ? 'good' : 'rough', gaps, iso: this.E.still(other, 0.2) };
    this.lastResult = result;   // b0.13: the page uses r === waveR.lastResult to name the arm
    return result;
  }
  // b0.18: expose the live wave PHASE so the comet light rides the detected human wave, not a timer.
  // head = 0..1 along the chain, following the most recent joint peak and gliding toward the next.
  phase(t = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    // READS ONLY — check() is the sole feeder (called once per pose frame). If phase() also pushed,
    // callers running it at 60fps rAF would densify the history and starve peakT's adjacent-drop test.
    const chain = this.chain.filter(n => this.E.last?.[n]);
    const peaks = chain.map(n => this.peakT(n));
    let last = -1; for (let i = 0; i < peaks.length; i++) if (peaks[i] != null && t - peaks[i] < 700) last = i;   // most recent joint that peaked within 700ms
    if (last < 0) return { head: 0, active: false, peaks, links: chain.length };
    const since = t - peaks[last], glide = Math.min(1, since / 220);                                             // ~220ms per link, eased
    const eased = 1 - Math.pow(1 - glide, 3);                                                                    // easeOutCubic
    const head = Math.min(1, (last + eased) / Math.max(1, chain.length - 1));
    return { head, active: true, peaks, links: chain.length };
  }
}
