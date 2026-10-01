/* shared/nova-lang.js — F2 + F3: language + gender persist once and ride on EVERY launch URL.
   Include on every page: <script type="module" src="../shared/nova-lang.js"></script>
   Exposes window.NovaLang = { lang, gender, url(href), applyToLinks() } and adds בן/בת buttons to the consent gate if present. */
const q = new URLSearchParams(location.search);
const LS = window.localStorage;
function pick(key, param, valid, fallback){ const v = q.get(param); if (v && valid.includes(v)){ LS.setItem(key, v); return v; } const s = LS.getItem(key); return (s && valid.includes(s)) ? s : fallback; }
const lang   = pick('nova-lang',   'lang', ['en','he'], 'en');
const gender = pick('nova-gender', 'g',    ['m','f'],   '');
const voice  = q.get('voice') || LS.getItem('nova-voice') || ''; if (q.get('voice')) LS.setItem('nova-voice', voice);

function url(href){ try { const u = new URL(href, location.href); u.searchParams.set('lang', lang); if (gender) u.searchParams.set('g', gender); if (voice) u.searchParams.set('voice', voice); return u.toString(); } catch(e){ return href; } }
function applyToLinks(root=document){ root.querySelectorAll('a[href]').forEach(a=>{ const h=a.getAttribute('href'); if (h && !/^(#|mailto:|tel:|javascript:)/.test(h)) a.setAttribute('href', url(h)); }); }
// same-origin navigation helper for launchers: NovaLang.go('/freeze')
function go(href){ location.href = url(href); }
// wrap window.open + iframe src setters used by the commercial app
const _open = window.open; window.open = (h, ...r) => _open.call(window, typeof h==='string' ? url(h) : h, ...r);
document.addEventListener('DOMContentLoaded', () => { applyToLinks(); document.querySelectorAll('iframe[data-nova-src]').forEach(f => f.src = url(f.dataset.novaSrc)); });
if (lang==='he') document.documentElement.setAttribute('lang','he');

// ── consent gate: בן / בת buttons (F2). Renders if an element with id="consentGate" exists. ──
function mountGender(){ const gate = document.getElementById('consentGate'); if (!gate || document.getElementById('genderPick')) return;
  const wrap = document.createElement('div'); wrap.id='genderPick'; wrap.style.cssText='display:flex;gap:14px;justify-content:center;margin:14px 0';
  const mk = (val,label) => { const b=document.createElement('button'); b.type='button'; b.textContent=label; b.dataset.g=val;
    b.style.cssText='font:800 22px "Baloo 2",system-ui;padding:12px 28px;border:3px solid #7c5cbf;border-radius:16px;background:'+(gender===val?'#ffc23e':'#fff')+';color:#2a2140;cursor:pointer';
    b.onclick=()=>{ LS.setItem('nova-gender', val); wrap.querySelectorAll('button').forEach(x=>x.style.background='#fff'); b.style.background='#ffc23e'; window.NovaLang.gender=val; applyToLinks(); }; return b; };
  const title=document.createElement('div'); title.textContent = lang==='he' ? 'מי משחק היום?' : 'Who is playing today?'; title.style.cssText='font:800 20px "Baloo 2",system-ui;margin-top:10px;text-align:center';
  wrap.appendChild(mk('m', lang==='he' ? 'בן' : 'Boy')); wrap.appendChild(mk('f', lang==='he' ? 'בת' : 'Girl'));
  const startBtn = gate.querySelector('button.start, #consentStart, button[type=submit]'); (startBtn?.parentNode || gate).insertBefore(title, startBtn||null); (startBtn?.parentNode || gate).insertBefore(wrap, startBtn||null);
  if (startBtn){ const orig = startBtn.onclick; startBtn.onclick = (e) => { if (!LS.getItem('nova-gender')){ e.preventDefault(); title.style.color='#c0392b'; title.textContent = lang==='he' ? 'בחרו בן או בת כדי להתחיל' : 'Pick boy or girl to start'; return false; } return orig ? orig.call(startBtn,e) : true; }; } }
document.addEventListener('DOMContentLoaded', mountGender);
// [ADAPT 2026-09-13] the consent gate in this app is built lazily by nova-tester-gate.js
// (it only exists once getUserMedia is called), so a DOMContentLoaded-only mount never
// finds it. mountGender is idempotent and exported so the gate can call it at build time.
window.NovaLang = { lang, gender, voice, url, go, applyToLinks, mountGender };
export { lang, gender, voice, url, go, applyToLinks, mountGender };
