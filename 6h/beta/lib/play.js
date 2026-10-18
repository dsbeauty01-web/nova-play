/* beta/lib/play.js — the page half every beta game shares: language, camera-or-replay source (MoveNet only),
   the top bar (stars only), captions, the medal screen and "Save my play". The JUDGING lives in the pure
   *-game.js modules; this file never decides a star.

   URL switches (none are needed to play):
     ?lang=he|en            language (else the launcher's saved choice, else English)
     ?replay=a,b            play recorded clips test/clips/<a>.json (+ its video) instead of the camera; the
                            page moves to the next clip at each new round (proof videos)
     ?detector=fail         a detector that throws on every frame (proves the game skips and still ends)
     ?fast=1                short rounds (proof videos)
     ?autostart=1           no start button (proof videos)
     ?backend=wasm          MoveNet on the CPU instead of WebGL                                                   */
import { fromMoveNet, frameAt, toJudge } from './kp.js';

export const Q = new URLSearchParams(location.search);

/* ───────── language ───────── */
const LANG_KEY = 'nova.beta.lang';
export function getLang(){
  const q = Q.get('lang'); if (q === 'he' || q === 'en') return q;
  try { const s = localStorage.getItem(LANG_KEY); if (s === 'he' || s === 'en') return s; } catch {}
  return 'en';
}
export function setLang(l){ try { localStorage.setItem(LANG_KEY, l); } catch {} applyLang(l); }
export function applyLang(l){ document.documentElement.lang = l; document.documentElement.dir = l === 'he' ? 'rtl' : 'ltr'; }

export const COMMON = {
  en: { cantSee: "I can't see you — step back", noCamera: "I can't see you — is the camera on?", back: '← Back', again: 'Play again', save: 'Save my play',
        start: 'Play', saved: 'Saved', endNone: "Let's play again together!", endUnseen: "I couldn't see you this time — let's try again!" },
  he: { cantSee: 'אני לא רואה אותך — עוד צעד אחורה', noCamera: 'אני לא רואה אותך — המצלמה דולקת?', back: 'חזרה →', again: 'עוד פעם', save: 'שמירת המשחק',
        start: 'משחקים', saved: 'נשמר', endNone: 'בואו נשחק שוב ביחד!', endUnseen: 'לא ראיתי אותך הפעם — ננסה שוב!' },
};

/* ───────── top bar: stars only, round dots (no numbers) ───────── */
export function createHud(rounds){
  const stars = document.getElementById('stars'), dots = document.getElementById('dots');
  dots.innerHTML = ''; const D = [];
  for (let i = 0; i < rounds; i++){ const d = document.createElement('i'); dots.appendChild(d); D.push(d); }
  return {
    star(){ const s = document.createElement('span'); s.className = 'pop'; s.textContent = '⭐'; stars.appendChild(s); },
    mark(round, kind){ const d = D[round - 1]; if (d) d.className = kind; },
    now(round){ D.forEach((d, i) => d.classList.toggle('now', i === round - 1)); },
    reset(){ stars.textContent = ''; D.forEach(d => d.className = ''); },
  };
}

export function caption(text, cls = ''){ const c = document.getElementById('cap'); c.textContent = text || ''; c.className = cls; }
export function card(text, emo){ const c = document.getElementById('card'); if (!text){ c.classList.remove('on'); return; }
  c.innerHTML = ''; if (emo){ const e = document.createElement('span'); e.className = 'emo'; e.textContent = emo; c.appendChild(e); } c.append(text); c.classList.add('on'); }
export function ring(p, ok = false){ const r = document.getElementById('ring'); if (p == null){ r.classList.remove('on', 'ok'); return; }
  r.classList.add('on'); r.classList.toggle('ok', ok); r.style.setProperty('--p', Math.max(0, Math.min(100, p * 100))); }

/* ───────── medal screen ───────── */
export function medalScreen({ medal, stars, judged, skips, lang, onAgain, onBack, onSave }){
  const L = COMMON[lang], el = document.getElementById('end');
  document.getElementById('medal').textContent = medal === 'gold' ? '🥇' : medal === 'silver' ? '🥈' : medal === 'bronze' ? '🥉' : '💜';
  document.getElementById('medalStars').textContent = '⭐'.repeat(stars);
  document.getElementById('endLine').textContent = medal ? '' : (judged === 0 && skips > 0 ? L.endUnseen : L.endNone);
  document.getElementById('again').textContent = L.again; document.getElementById('back2').textContent = L.back; document.getElementById('save').textContent = '⬇ ' + L.save;
  document.getElementById('again').onclick = onAgain; document.getElementById('back2').onclick = onBack; document.getElementById('save').onclick = onSave;
  el.classList.add('on');
}

/* ───────── the source: the camera through MoveNet, or a recorded play ─────────
   onFrame(frame | null, t) once per camera frame; frame = a play-recording frame, null = nothing detected / detector failed. */
const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js';
const PD = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js';
const script = src => new Promise((ok, no) => { if ([...document.scripts].some(s => s.src === src)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('load ' + src)); document.head.appendChild(s); });

export async function createSource(video, onFrame, { base = '../' } = {}){
  const replay = (Q.get('replay') || '').split(',').filter(Boolean), failMode = Q.get('detector') === 'fail';
  const S = { kind: replay.length ? 'replay' : 'camera', modelOk: false, failures: 0, i: 0, rec: null, running: false, w: 0, h: 0 };

  async function loadClip(i){
    const name = replay[i % replay.length];
    S.rec = await (await fetch(`${base}test/clips/${name}.json`)).json();
    video.src = `${base}${S.rec.src}`; video.loop = true; video.muted = true; S.w = S.rec.w; S.h = S.rec.h;
    await video.play().catch(() => {});
  }

  let det = null;
  if (S.kind === 'replay'){ await loadClip(0); S.modelOk = !failMode; }
  else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      video.srcObject = stream; video.muted = true; await video.play();
    } catch (e) { S.cameraError = String(e?.message || e); }
    if (!failMode && !S.cameraError){
      try { await script(TF); await script(PD);
        if (Q.get('backend') === 'wasm'){   // ?backend=wasm: same model on the CPU (devices or test browsers without a GPU)
          await script('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.20.0/dist/tf-backend-wasm.min.js');
          tf.wasm.setWasmPaths('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.20.0/dist/'); await tf.setBackend('wasm'); }
        await tf.ready();
        det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, enableSmoothing: true });
        S.modelOk = true;
      } catch (e) { S.modelError = String(e?.message || e); }      // no model → every frame is null → every round skips
    }
  }

  /* [NIGHT-F 2026-10-17] frame-skip: MoveNet runs on the page's main thread, so a slow detection also starves the
     light layer. MEASURED (test/proof/perf.mjs, CPU-only WASM): 17.6 fps at 1×, 5.0 fps at 4× throttle for lights AND
     judging. When a detection takes > 25 ms (EMA), detect only every 2nd frame — the frames in between go to the
     lights. Judging is fps-independent (energy per second; holds in seconds) — test/replay/fps.mjs proves the Laws
     at 30 · 12 · 6 fps. ?skip=1 turns it off. */
  let busy = false, nFrame = 0, detMs = 0;
  const allowSkip = Q.get('skip') !== '1';
  /* [2026-10-18 MEASURED] feed the game ONE update per NEW video frame, never per screen refresh. rAF runs at 60 Hz,
     the camera gives ~30 fps: every other detection saw the same frame and reported zero motion, which dragged the
     judge's energy to zero (Refael's real arm-waving: 13% held per-frame → 100% held at 60 Hz = "freeze always
     scores"). Chrome's requestVideoFrameCallback fires once per new frame; elsewhere we gate on video.currentTime. */
  let newFrame = true, lastVT = -1, lastReplayFrame = null;
  if (typeof video.requestVideoFrameCallback === 'function'){ newFrame = false; const onVF = () => { newFrame = true; video.requestVideoFrameCallback(onVF); }; video.requestVideoFrameCallback(onVF); }
  async function step(){
    if (!S.running) return;
    const t = performance.now() / 1000;
    nFrame++;
    if (S.kind === 'camera' && allowSkip && detMs > 25 && nFrame % 2){ requestAnimationFrame(step); return; }
    if (S.kind === 'camera' && !failMode){
      const fresh = typeof video.requestVideoFrameCallback === 'function' ? newFrame : video.currentTime !== lastVT;
      if (!fresh){ requestAnimationFrame(step); return; }
      newFrame = false; lastVT = video.currentTime;
    }
    if (!busy){
      busy = true;
      let frame = null;
      try {
        if (failMode) throw new Error('detector failed (test mode)');
        if (S.kind === 'replay'){
          // [2026-10-18] the replay clock: the clip's video when it is really playing, otherwise the wall clock —
          // a keypoint-only recording (every "Save my play" file, Refael's real-camera clips) has no video, and a
          // clock stuck at 0 replays ONE frame forever = zero motion = a fake "held" every round.
          const videoClock = video.readyState >= 2 && !video.paused && video.duration > 0 && isFinite(video.duration);
          if (!videoClock && S.t0 == null) S.t0 = t;
          frame = frameAt(S.rec, videoClock ? video.currentTime : (t - S.t0));
          if (frame === lastReplayFrame){ busy = false; requestAnimationFrame(step); return; }   // same recorded frame → not a new update
          lastReplayFrame = frame; }
        else if (det && video.videoWidth){ const d0 = performance.now(); const poses = await det.estimatePoses(video, { flipHorizontal: false });
          detMs = detMs ? detMs * 0.8 + (performance.now() - d0) * 0.2 : performance.now() - d0; S.detMs = detMs; S.w = video.videoWidth; S.h = video.videoHeight;
          frame = fromMoveNet(poses?.[0]?.keypoints, video.videoWidth, video.videoHeight); }
      } catch { S.failures++; frame = null; }
      busy = false;
      globalThis.__fedFrames = (globalThis.__fedFrames || 0) + 1;     // frames handed to the game (perf probe, night-F)
      onFrame(frame, t);
    }
    requestAnimationFrame(step);
  }
  return {
    get state(){ return S; },
    start(){ S.running = true; requestAnimationFrame(step); },
    stop(){ S.running = false; },
    async next(){ if (S.kind === 'replay' && replay.length > 1){ S.i++; await loadClip(S.i); } },
  };
}

/* ───────── Save my play: everything needed to replay and audit the game ───────── */
export function createRecorder(game, lang){
  const R = { when: new Date().toISOString(), v: 1, game, lang, ua: navigator.userAgent, w: 0, h: 0, detector: 'movenet-lightning-tfjs4.20-smooth', frames: [], events: [], novaEvents: [], summary: null, t0: null };
  return {
    frame(f, t, src){ if (R.t0 == null) R.t0 = t; R.w = src?.w || R.w; R.h = src?.h || R.h; if (R.frames.length < 30 * 60 * 6) R.frames.push({ t: +(t - R.t0).toFixed(3), ...(f || {}) }); },
    event(type, d, t){ R.events.push({ t: R.t0 == null ? 0 : +(t - R.t0).toFixed(3), type, ...d }); },
    nova(ev){ R.novaEvents.push(ev); },                 // the brain's events (beta/lib/events.js)
    end(summary, src){ R.summary = summary; R.source = src?.kind; R.modelOk = src?.modelOk; R.failures = src?.failures; },
    save(){ const blob = new Blob([JSON.stringify(R)], { type: 'application/json' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${game}-${R.when.replace(/[:.]/g, '-')}-play.json`; document.body.appendChild(a); a.click(); a.remove(); },
    data: R,
  };
}

/* ───────── voice + music ───────── */
export function audio(src, vol = 1){ const a = new Audio(src); a.volume = vol; a.play().catch(() => {}); return a; }

/* is a body there right now? (for the caption + guide arrows; never used to award anything) */
export function present(frame){ const k = toJudge(frame); return !!(k && k.lShoulder && k.rShoulder); }
/* where-to-stand guide from the shoulders. tooClose = shoulders wider than 45% of the picture, tooFar = narrower than 8%.
   // GUESS — replace at Phase 2 (only drives the arrows, never a star) */
export function guideFor(frame){
  const k = toJudge(frame); if (!k || !k.lShoulder || !k.rShoulder) return 'tooClose';
  const w = Math.abs(k.lShoulder.x - k.rShoulder.x); return w > 0.45 ? 'tooClose' : w < 0.08 ? 'tooFar' : 'ok';
}
