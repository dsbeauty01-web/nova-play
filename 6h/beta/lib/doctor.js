/* beta/lib/doctor.js — Camera Doctor: the pre-game "where do I stand?" screen every game runs first.
   Never blocks: it moves on by itself after 6 s (or as soon as the player has been seen right for 1 s).
   No numbers on screen — only Nova's words, a soft body outline and the guide() arrows of shared/nova-lights.js.

   The rule (night brief, item B): "I can see you ✓" when the shoulders are 15–50 % of the picture's width and
   both shoulders + the nose are ≥ 0.5 confidence, held for 1 s. [CLI-FILL] also asks for the knees: the launcher
   says "stand so your whole body is in the picture", so a half body gets "step back" instead of ✓.
   Arrows are in SCREEN terms — the picture is mirrored, so a player on the camera's left is on the screen's right. */
import { toJudge } from './kp.js';

export const DOCTOR = { minW: 0.15, maxW: 0.50, conf: 0.5, edge: 0.30, holdS: 1.0, maxS: 6 };

/* one frame → 'ok' | 'cantSee' | 'tooClose' | 'tooFar' | 'moveLeft' | 'moveRight' | 'halfBody' */
export function doctorState(frame){
  const f = frame || {}, c = n => f[n]?.[2] ?? 0;
  if (c('lShoulder') < DOCTOR.conf || c('rShoulder') < DOCTOR.conf || c('nose') < DOCTOR.conf) return 'cantSee';
  const w = Math.abs(f.lShoulder[0] - f.rShoulder[0]), mid = (f.lShoulder[0] + f.rShoulder[0]) / 2;
  if (w > DOCTOR.maxW) return 'tooClose';
  if (w < DOCTOR.minW) return 'tooFar';
  if (mid < DOCTOR.edge) return 'moveLeft';            // camera-left = screen-right → walk toward the screen's left
  if (mid > 1 - DOCTOR.edge) return 'moveRight';
  // half body = the knees aren't in the picture. MEASURED: on test/clips/doc-half-body (legs cropped off at the hips)
  // MoveNet still reports both hips at 0.40–0.43 conf ON the crop line, but the knees drop to 0.08 → knees decide.
  const k = toJudge(frame); if (!(k?.lHip && k?.rHip && k?.lKnee && k?.rKnee)) return 'halfBody';
  return 'ok';
}
/* which nova-lights guide() arrows to draw */
export const ARROW = { cantSee: null, tooClose: 'tooClose', halfBody: 'tooClose', tooFar: 'tooFar', moveLeft: 'moveLeft', moveRight: 'moveRight', ok: 'ok' };

export const DOC_TXT = {
  en: { cantSee: "I can't see you — come into the picture", tooClose: 'Step back a little', halfBody: 'Step back so I can see your legs too',
        tooFar: 'Come a bit closer', moveLeft: 'Move this way ←', moveRight: 'Move this way →', ok: 'I can see you ✓', skip: 'Start ▶' },
  he: { cantSee: 'אני לא רואה אותך — בואו לתוך התמונה', tooClose: 'עוד צעד אחורה', halfBody: 'עוד צעד אחורה, שאראה גם את הרגליים',
        tooFar: 'קצת יותר קרוב', moveLeft: '← לכאן', moveRight: 'לכאן →', ok: 'אני רואה אותך ✓', skip: 'מתחילים ▶' },
};

/* the timing, pure: feed(state, t) → { state, ready, done } — ready after holdS of 'ok', done at ready or maxS */
export function createDoctor(t0){
  let okSince = null, ready = false;
  return { feed(state, t){ if (state === 'ok'){ okSince ??= t; if (t - okSince >= DOCTOR.holdS) ready = true; } else okSince = null;
                           return { state, ready, done: ready || t - t0 >= DOCTOR.maxS, progress: Math.min(1, (t - t0) / DOCTOR.maxS) }; } };
}

/* the screen. Needs #doctor (with .msg, .bar i, .go) in the page — see play.css. Resolves when done. */
export function runDoctor({ lights, lang, onFrameHook }){
  const el = document.getElementById('doctor'); if (!el) return Promise.resolve();
  const T = DOC_TXT[lang] || DOC_TXT.en, msg = el.querySelector('.msg'), bar = el.querySelector('.bar i'), go = el.querySelector('.go');
  el.classList.add('on'); go.textContent = T.skip; msg.textContent = T.cantSee;
  const D = createDoctor(performance.now() / 1000);
  return new Promise(resolve => {
    let last = null, finished = false;
    const end = () => { if (finished) return; finished = true; lights.guide(null); el.classList.remove('on'); onFrameHook(null); resolve(); };
    go.onclick = end;
    onFrameHook(frame => {
      const s = doctorState(frame), r = D.feed(s, performance.now() / 1000);
      bar.style.transform = `scaleX(${r.progress})`;
      if (s !== last){ last = s; msg.textContent = T[s]; msg.className = 'msg ' + (s === 'ok' ? 'good' : 'wait'); lights.guide(ARROW[s]); el.dataset.state = s; }
      if (r.done) setTimeout(end, r.ready ? 600 : 0);     // let the ✓ show for a moment
    });
    setTimeout(end, (DOCTOR.maxS + 0.5) * 1000);           // frames or not, it never blocks
  });
}
