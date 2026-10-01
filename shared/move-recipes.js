/* shared/move-recipes.js — ONE recipe per action, for every Nova game: what the lights do at
     cue (before he moves) → live (while he moves, driven by the judge's progress) → ok / near / miss (the result).
   Pages call only this:   const M = createMoves(lights);  M.cue('says.armsUp');  M.live('says.armsUp', k);  M.result('says.armsUp', 'ok');
   The referee (who scores) stays in each game; recipes only SHOW. Colors are fixed meanings:
     cyan = where to go / the moving light · green = this part is right · soft orange = this part must change (never red)
     gold = you did it · ice = hold still.
   Written by the architect. */
import { judgePose, judgeShape, judgeShoulder, ChestSlide, HelloWave, judgePresence, PartMotion, KeypointSmoother } from './move-judges.js';
import { WaveDetector, ARM_CHAINS } from './motion-detect.js';

const part = v => v >= 0.8 ? 'good' : 'move';
const POSE_ACTIONS = ['armsUp', 'armsOut', 'handsHead', 'leftUp', 'rightUp'];
const SHAPES = ['star', 'flamingo', 'frog', 'bear'];

export function createMoves(L, opts = {}){
  const o = Object.assign({ mirror: true, wobbleAt: 0.9 }, opts);
  const smooth = new KeypointSmoother();
  const state = {};                                            // stateful judges per action id
  const now = () => performance.now() / 1000;
  const get = (id, make) => state[id] || (state[id] = make());

  const R = {
    /* ── INTRO ─────────────────────────────────────────────── */
    'intro.presence': {                                        // where to stand: arrows only, no words needed
      live(k){ const p = judgePresence(k); let g = p.state === 'tooClose' ? 'tooClose' : p.state === 'tooFar' ? 'tooFar' : null;
        if (p.state === 'offImageLeft' || p.state === 'offImageRight'){ const onScreenLeft = (p.state === 'offImageLeft') !== o.mirror; g = onScreenLeft ? 'moveRight' : 'moveLeft'; }
        L.guide(g || 'ok'); return p; },
      ok(){ L.guide(null); } },
    'intro.shoulderL': shoulderRecipe('l'), 'intro.shoulderR': shoulderRecipe('r'),
    'intro.hello': {                                           // a hand up swinging → sparkles trail it → "HI!"
      live(k, t){ const j = get('hello', () => new HelloWave()).update(k, t); L.sparkle(j?.hand ? j.hand + 'Wrist' : null); return j; },
      ok(j){ const h = (j?.hand || 'r') + 'Wrist'; L.sparkle(null); L.burst(h, 'gold', 50, 320); L.word('HI!', h); delete state.hello; },
      clear(){ L.sparkle(null); delete state.hello; } },

    /* ── FREEZE ────────────────────────────────────────────── */
    'freeze.dance': { cue(){ L.ice(false); L.speedGlow(true); }, clear(){ L.speedGlow(false); } },      // every moving joint glows with its speed
    'freeze.stop': {                                           // frost climbs from the feet; the wobbling part turns soft orange
      cue(){ L.speedGlow(false); L.ice(true); delete state.parts; state.stopT = now(); },
      live(k, t){ const pm = get('parts', () => new PartMotion()).update(k, t); const hold = Math.min(1, (now() - (state.stopT || now())) / 2.5);
        const wob = pm && pm.topEnergy > o.wobbleAt ? pm.top : null; L.ice(true, { wobble: wob && wob !== 'head' ? wob : null, hold }); return pm; },
      ok(){ L.ice(false); L.snow('nose'); L.word('STATUE!', 'nose', '#bff4ff'); },
      near(){ L.ice(false); L.word('ALMOST!', 'nose', '#9fe8ff'); },
      miss(){ L.ice(false); } },                               // nothing punishing — the recorded "Next one's yours!" does the talking
    ...Object.fromEntries(SHAPES.map(s => ['freeze.shape.' + s, {        // bonus: the animal shape itself
      cue(){ L.pose(s, { l: 0, r: 0 }); },
      live(k){ const j = judgeShape(k, s); if (j) L.pose(s, { l: j.progress, r: j.progress }); return j; },
      ok(){ L.pose(null); L.burst('nose', 'gold', 80, 380); L.word(s.toUpperCase() + '!', 'nose'); },
      miss(){ L.pose(null); }, clear(){ L.pose(null); } }])),

    /* ── NOVA SAYS ─────────────────────────────────────────── */
    ...Object.fromEntries(POSE_ACTIONS.map(p => ['says.' + p, {
      cue(){ L.pose(p, { l: 0, r: 0 }); L.limbs(null); },       // the ghost of the pose appears ON him the moment the command is spoken
      live(k){ const j = judgePose(k, p); if (!j) return null; L.pose(p, j);
        L.limbs({ lArm: j.wrong === 'l' ? 'wrong' : part(j.l), rArm: j.wrong === 'r' ? 'wrong' : part(j.r) }); return j; },
      ok(){ L.pose(null); L.limbs(null); L.burst('lWrist', 'gold', 40, 320); L.burst('rWrist', 'gold', 40, 320); L.word('YES!', 'nose'); },
      near(){ L.pose(null); L.limbs(null); L.word('ALMOST!', 'nose', '#9fe8ff'); },
      miss(){ L.pose(null); L.limbs(null); }, clear(){ L.pose(null); L.limbs(null); } }])),
    'says.trick': {                                            // no "Nova says": the smart move is to stay still
      cue(){ L.pose(null); L.limbs(null); },
      ok(){ L.snow('nose'); L.word('SMART!', 'nose', '#bff4ff'); },       // held still
      miss(){ L.word('GOTCHA!', 'nose', '#ffb27d'); } },                  // moved — playful, orange-ish, no penalty light

    /* ── WAVE (one arm) ────────────────────────────────────── */
    'wave.arm': {
      cue(o2 = {}){ const chain = o2.chain || ARM_CHAINS[o2.arm === 'left' ? 'left' : 'right']; L.waveCue(o2.dir === 'in' ? [...chain].reverse() : chain, o2.ms || 1200); },
      start(){ get('wave', () => new WaveDetector()).reset(); L.comet.start(); },
      live(k, t){ const r = get('wave', () => new WaveDetector()).update(k, t); L.comet.follow(r.front, r.chain); return r; },
      ok(r){ const d = r?.done || r || {}, side = d.arm === 'left' ? 'l' : 'r', end = d.dir === 'in' ? side + 'Shoulder' : side + 'Wrist';
        L.comet.end(); L.burst(end, 'gold'); L.word('YES!', end); },
      miss(){ L.comet.end(); }, clear(){ L.comet.end(); } },

    /* ── UP GROOVE ─────────────────────────────────────────── */
    'groove.bounce': {                                         // the ring closes on the beat; the result lands under the feet
      cue(o2 = {}){ L.beatRing(true, o2.nextBeatAt, o2.lead ?? 0.6); },
      ok(){ L.hit('on'); }, near(){ L.hit('near'); }, miss(){}, clear(){ L.beatRing(false); } },

    /* ── UPPER BODY (isolations) ───────────────────────────── */
    'upper.slide': {
      cue(){ L.rail({ slide: 0, hipsStill: true }); delete state.slide; },
      live(k, t){ const j = get('slide', () => new ChestSlide()).update(k, t); if (j) L.rail(j); return j; },
      ok(j){ const side = (j?.slide ?? 1) > 0 ? 'lShoulder' : 'rShoulder'; L.flash(side); L.burst(side, 'gold', 40, 300); },
      miss(){}, clear(){ L.rail(null); delete state.slide; } },
    'upper.popL': popRecipe('l'), 'upper.popR': popRecipe('r'),
  };

  function shoulderRecipe(s){ const j0 = s + 'Shoulder'; return {
    cue(){ L.meter(j0, 0); },
    live(k){ const j = judgeShoulder(k, s); if (j) L.meter(j0, j.progress); return j; },
    ok(){ L.meter(j0, 1); L.burst(j0, 'gold', 60, 340); L.word('YES!', j0); setTimeout(() => L.meter(null), 500); },
    miss(){ L.meter(null); }, clear(){ L.meter(null); } }; }
  function popRecipe(s){ const j0 = s + 'Shoulder'; return {                  // a pop = lift + a sharp STOP → the star snaps on the shoulder
    cue(){ L.meter(j0, 0); },
    live(k){ const j = judgeShoulder(k, s); if (j) L.meter(j0, j.progress); return j; },
    ok(){ L.meter(null); L.flash(j0); },
    miss(){ L.meter(null); }, clear(){ L.meter(null); } }; }

  return {
    ids: Object.keys(R),
    /* cue(id, opts) — before he moves */
    cue(id, o2){ R[id]?.cue?.(o2); R[id]?.start?.(o2); },
    /* live(id, rawKeypoints, t) — every frame while the action is open; returns the judge's reading (progress etc.) */
    live(id, k, t = now()){ if (!R[id]?.live || !k) return null; const sk = smooth.update(k, t); return R[id].live(sk, t); },
    /* result(id, 'ok'|'near'|'miss', judgeReading?) — the referee's decision → the matching light */
    result(id, outcome, j){ (R[id]?.[outcome] || R[id]?.miss)?.(j); },
    clear(id){ if (id) R[id]?.clear?.(); else { L.clearAll(); for (const k of Object.keys(state)) delete state[k]; } },
  };
}
