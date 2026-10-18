// beta/upgroove-game.js — Up Groove (kids · ~90s) built on the shared engines (b0.13).
// Pure game LOGIC: give it a MoverEngine, a lights interface (LightEngine or a stub), a
// `note(text)` voice callback, and a monotonic clock; feed it pose frames. It runs the traced
// ladder (head→shoulder→ribs→hips → double-speed → chain → freestyle), detects each station
// with the mover-rules, grades timing, scores, and fires the gold lights. No DOM, no LiveKit.
import { RULES } from '../shared/mover-rules.js';
import { grade, score as scoreWin } from '../shared/cue-window.js';

// station → detection rule + the joint the gold light rides + the isolation "stay still" refs
export const STATIONS = {
  head:      { rule: 'headSlide',    joint: 'head',      still: ['shoulderC'], pts: 100, thr: 0.22 },
  shoulder:  { rule: 'shoulderPop',  joint: 'shoulderC', still: ['hipC'],       pts: 120, thr: 0.15 },
  ribs:      { rule: 'ribSlide',     joint: 'shoulderC', still: ['hipC', 'head'], pts: 140, thr: 0.18 },
  hips:      { rule: 'hipBounce',    joint: 'hipC',      still: ['shoulderC'],  pts: 130, thr: 0.18 },
};
export const LADDER = [
  { t: 30, part: 'head', line: 'HEAD side to side!' },
  { t: 35, part: 'shoulder', line: 'shoulders now!' },
  { t: 40, part: 'ribs', line: 'RIBS!' },
  { t: 45, part: 'hips', line: 'HIPS!' },
  { t: 50, part: 'double', line: 'again — FASTER!' },        // ladder again, tight windows + fire
  { t: 65, part: 'chain', line: 'fingers... elbows... wrists!' },
  { t: 78, part: 'freestyle', line: 'YOUR moves — go wild!' },
];
const DOUBLE = ['head', 'shoulder', 'ribs', 'hips'];          // the fast reprise

export class UpGroove {
  constructor(E, L, note, opts = {}) {
    this.E = E; this.L = L || stubLights(); this.note = note || (() => {});
    this.tier = 'kids';
    this.score = 0; this.streak = 0; this.maxStreak = 0; this.facts = 0; this.hypeLeft = 4;
    this.windowMs = (opts.windowMs ?? 900);
    this.phase = 'intro';
    this._cued = new Set(); this._done = new Set(); this._active = null; this._dblIdx = 0; this._dblCue = 0;
    this.log = [];
  }
  // called once per frame with the raw named-joint pose `k` and the game clock in SECONDS
  frame(k, tSec) {
    const out = this.E.update(k);
    this.L.setJoints(out);
    if (this.phase === 'intro') { if (tSec >= 8 && !this._cued.has('groove')) { this._cued.add('groove'); this.note('feel the beat first...'); } if (tSec >= 30) this.phase = 'game'; }
    if (this.phase !== 'game') return;

    // fire each ladder station's cue at its time (one voice line + one gold cue)
    for (const st of LADDER) {
      if (tSec >= st.t && !this._cued.has(st.part)) {
        this._cued.add(st.part); this._active = st.part; this._activeAt = st.t; this._graded = false;
        if (this.hypeLeft > 0 || true) this.note(st.line);       // the ladder line is the teach, not "hype"
        this._cueStation(st.part, st.t);
      }
    }
    // detect the active station's move inside its window
    this._detect(tSec);

    if (tSec >= 85 && this.phase === 'game') { this.phase = 'ending'; this.note(`ending: score=${this.score} best=${this.maxStreak}`); }
  }

  _cueStation(part, at) {
    if (part === 'double') { this.L.setFire(true); this._dblIdx = 0; this._dblCue = at; return; }
    if (part === 'chain') { this.L.comet(['rShoulder', 'rElbow', 'rWrist', 'rIndex'], 'good'); return; }
    if (part === 'freestyle') { this.L.setFire(true); return; }
    const s = STATIONS[part]; if (!s) return;
    this.L.cue({ joint: s.joint, dir: null, windowMs: this.windowMs, leadMs: 1000, still: s.still });
  }

  _detect(tSec) {
    const part = this._active; if (!part) return;
    // freestyle: any real movement scores, softly, no window
    if (part === 'freestyle') { const e = this.E.energy(['shoulderC', 'hipC', 'lWrist', 'rWrist', 'head']); if (e != null && e > 0.5 && (tSec * 1000) % 800 < 40) { this._award('freestyle', 60, false); } return; }
    // chain: a wave down the arm
    if (part === 'chain') { return; }                            // (WaveRule wired at the page level with a stateful instance)
    // double-speed: cycle the four stations fast
    if (part === 'double') { const idx = Math.min(DOUBLE.length - 1, Math.floor((tSec - this._activeAt) / 3.2)); const sub = DOUBLE[idx];
      if (idx !== this._dblIdx) { this._dblIdx = idx; const s0 = STATIONS[sub]; this.L.cue({ joint: s0.joint, windowMs: 600, leadMs: 500, still: s0.still }); }
      this._score(sub, tSec, this._activeAt + idx * 3.2, 600, true); return; }
    // normal station: grade against its target time
    this._score(part, tSec, this._activeAt, this.windowMs, false);
  }

  _score(part, tSec, targetSec, winMs, fast) {
    if (this._graded && !fast) return;
    const s = STATIONS[part]; if (!s) return;
    const r = RULES[s.rule]?.(this.E);
    if (!r || !r.hit) return;
    const g = grade(tSec * 1000, targetSec * 1000, winMs);
    if (!g) return;
    this._graded = true;
    const iso = !!r.iso;
    const pts = scoreWin(s.pts, g, { iso, isoBonus: 20 });
    this._award(part, pts, iso, r);
  }

  _award(part, pts, iso, r) {
    this.facts++; this.streak++; this.maxStreak = Math.max(this.maxStreak, this.streak);
    const mult = this.streak >= 2 ? 2 : 1; const gained = pts * mult;
    this.score += gained;
    this.L.streak = this.streak; if (this.streak >= 3) this.L.setFire(true);
    const s = STATIONS[part];
    this.L.hit(s ? s.joint : 'shoulderC', iso ? 'iso' : 'good', gained);
    if (iso) this.L.isoShimmer();
    this.log.push({ part, pts: gained, streak: this.streak, iso, mult });
  }
}

// a no-op lights interface so the logic can run headless / in tests
function stubLights() {
  return { calls: [], streak: 0,
    setJoints() {}, cue(o) { this.calls.push(['cue', o.joint]); }, hit(j, q, p) { this.calls.push(['hit', j, q, p]); },
    isoShimmer() { this.calls.push(['iso']); }, comet(c) { this.calls.push(['comet']); }, setFire(v) { this.calls.push(['fire', v]); },
    ice() {}, warm() {} };
}
