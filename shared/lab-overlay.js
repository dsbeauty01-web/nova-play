/* shared/lab-overlay.js — the TEST LAB status panel, shown inside any game opened with ?lab=1 (nova-lights.js loads it).
   Answers the questions every play-test asks: is tracking fast enough · which voice is live · why is she silent ·
   did she hear me · is the mic alive · is her video on · are the lights on. Small, top-left, never over a face. */
const Q = new URLSearchParams(location.search);
const LAB = (globalThis.__novaLab ||= { feeds: 0 });
const box = document.createElement('div');
box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:9999;font:600 12px/1.5 system-ui,sans-serif;color:#eef;background:rgba(12,6,26,.82);border:1px solid rgba(255,255,255,.18);border-radius:12px;padding:8px 10px;min-width:210px;max-width:290px;pointer-events:auto;backdrop-filter:blur(4px)';
box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:800;margin-bottom:4px">
  <span>🧪 LAB</span><span><a href="../beta/lab" style="color:#ffc23e;text-decoration:none">← lab</a> <button id="labMin" style="background:none;border:0;color:#bbb;cursor:pointer;font-size:14px">–</button></span></div>
  <div id="labRows"></div>`;
document.body.appendChild(box);
const rows = box.querySelector('#labRows');
box.querySelector('#labMin').onclick = () => { rows.style.display = rows.style.display === 'none' ? '' : 'none'; };
const dot = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:6px"></span>`;
const S = { fps: 0, brain: Q.get('brain') || 'default', state: '—', err: '', heard: '', heardAt: 0, mic: 0, micErr: '', video: Q.get('nova') || 'on' };

let last = LAB.feeds, lastT = performance.now();
setInterval(() => { const now = performance.now(); S.fps = Math.round((LAB.feeds - last) * 1000 / (now - lastT)); last = LAB.feeds; lastT = now; render(); }, 1000);

addEventListener('nova:brain', e => { const m = e.detail || {}; if (m.type === 'brain') S.brain = m.backend; if (m.type === 'brain_error') S.err = (m.code ? m.code + ': ' : '') + (m.message || ''); render(); });
addEventListener('nova:status', e => { const m = e.detail || {}; if (m.speaking === true) S.state = 'speaking'; else if (m.speaking === false) S.state = 'listening'; if (m.hearing === true) S.state = 'hearing you'; render(); });
addEventListener('nova:kid', e => { S.heard = String(e.detail || '').slice(0, 60); S.heardAt = performance.now(); render(); });
addEventListener('nova:said', () => { S.state = 'listening'; render(); });
addEventListener('nova:video', e => { S.video = (e.detail?.on ? 'on' : 'off') + (e.detail?.mode === 'rounds' ? ' (rounds)' : ''); render(); });

// mic level — its own read-only capture (the game's mic is untouched)
(async () => { try {
  const st = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true } });
  const ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 512;
  ac.createMediaStreamSource(st).connect(an); const buf = new Float32Array(an.fftSize);
  const resume = () => ac.resume().catch(() => {}); addEventListener('click', resume, { once: true }); addEventListener('keydown', resume, { once: true });
  setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; S.mic = Math.min(1, Math.sqrt(s / buf.length) * 8); }, 120);
} catch (e) { S.micErr = 'mic blocked'; render(); } })();

function render(){
  const fpsC = S.fps >= 15 ? '#7ce8a0' : S.fps >= 8 ? '#ffc85a' : '#ff8a6a';
  const brainC = S.err ? '#ff8a6a' : S.brain === 'off' ? '#bbb' : '#7ce8a0';
  const heard = S.heard && performance.now() - S.heardAt < 8000 ? `“${S.heard}”` : '—';
  const bar = `<span style="display:inline-block;width:110px;height:7px;border-radius:4px;background:rgba(255,255,255,.12);vertical-align:middle;overflow:hidden"><span style="display:block;height:100%;width:${Math.round(S.mic * 100)}%;background:#6fe3ff"></span></span>`;
  rows.innerHTML =
    `<div>${dot(fpsC)}tracking <b>${S.fps}</b> fps</div>` +
    `<div>${dot(brainC)}voice <b>${S.brain}</b> · ${S.state}</div>` +
    (S.err ? `<div style="color:#ffb3a0">⚠ ${S.err.slice(0, 110)}</div>` : '') +
    `<div>👂 ${heard}</div>` +
    `<div>🎤 ${S.micErr || bar}</div>` +
    `<div style="color:#bbb">🎥 her video ${S.video} · 💡 lights ${Q.get('lights') === '0' ? 'off' : 'on'}${Q.get('dots') === '1' ? ' · dots' : ''} · ${Q.get('lang') || 'en'}</div>`;
}
render();
