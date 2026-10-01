/* shared/freeze-fx.js — F7 ducking · F8 the visible instant verdict · F9 Hebrew instant fillers.
   Include on the Freeze page: <script type="module" src="../shared/freeze-fx.js"></script>
   Then wire THREE one-liners (FREEZE-APPROVED):
     NovaFX.attach({ music: <the music element>, her: <her audio element or the LiveKit audio track element> });
     NovaFX.verdict('held'|'almost'|'missed', pts)   // at the SAME frame as the release ding
     NovaFX.holdRing(ms)                              // at the freeze cut (the 2.5s countdown ring)
*/
const q = new URLSearchParams(location.search); const HE = (q.get('lang')||localStorage.getItem('nova-lang')||'en')==='he';
const T = { held: HE?'פסל!':'STATUE!', almost: HE?'כמעט!':'ALMOST!', missed: '' };
let music=null, her=null, base=0.6, duck=0.30, ring=null, ringT0=0, ringMs=0, layer=null;
function ensureLayer(){ if (layer) return layer; layer=document.createElement('div'); layer.id='novafx'; layer.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:120'; document.body.appendChild(layer);
  const st=document.createElement('style'); st.textContent=`
  #novafx .v{position:absolute;left:50%;top:22%;transform:translate(-50%,-50%) scale(.6);font:800 clamp(40px,8vw,96px) "Baloo 2",system-ui;color:#ffc23e;text-shadow:0 0 24px rgba(255,194,62,.8),0 3px 0 #2a2140;opacity:0;animation:nvx .7s ease-out forwards;white-space:nowrap}
  #novafx .v small{display:block;font-size:.42em;color:#ffdf7e;text-shadow:0 0 18px rgba(255,223,126,.8)}
  @keyframes nvx{0%{opacity:0;transform:translate(-50%,-50%) scale(.6)}18%{opacity:1;transform:translate(-50%,-50%) scale(1.12)}30%{transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-70%) scale(1)}}
  #novafx .ring{position:absolute;left:50%;top:50%;width:min(52vh,52vw);height:min(52vh,52vw);margin:calc(-1*min(26vh,26vw)) 0 0 calc(-1*min(26vh,26vw));border-radius:50%;border:8px solid rgba(174,232,255,.9);box-shadow:0 0 30px rgba(174,232,255,.8);opacity:.95}
  #novafx .score{position:absolute;right:3vw;top:3vh;font:800 34px "Baloo 2",system-ui;color:#ffc23e;transform:scale(1);transition:transform .15s}`; document.head.appendChild(st); return layer; }
function tween(el, to, ms){ if(!el) return; const from=el.volume, t0=performance.now(); const step=()=>{ const u=Math.min(1,(performance.now()-t0)/ms); el.volume=from+(to-from)*u; if(u<1) requestAnimationFrame(step); }; step(); }
export const NovaFX = {
  attach({ music:m, her:h, baseVol=0.6, duckVol=0.30 }){ music=m; her=h; base=baseVol; duck=duckVol; if(music) music.volume=base;
    if (her){ her.addEventListener('playing', ()=>tween(music,duck,120)); her.addEventListener('ended', ()=>tween(music,base,300)); her.addEventListener('pause', ()=>tween(music,base,300)); }
    // LiveKit: if her audio arrives as a MediaStreamTrack, poll its level (F7 without an element): pass her=null and call NovaFX.herSpeaking(true/false) from the bridge's speaking event
  },
  herSpeaking(on){ tween(music, on?duck:base, on?120:300); },
  verdict(kind, pts){ ensureLayer(); const v=document.createElement('div'); v.className='v'; v.innerHTML = (T[kind]||'') + (pts? `<small>+${pts}</small>`:''); if(!T[kind] && !pts) return; layer.appendChild(v); setTimeout(()=>v.remove(), 750);
    const s=document.getElementById('score'); if(s){ s.style.transition='transform .15s'; s.style.transform='scale(1.25)'; setTimeout(()=>s.style.transform='scale(1)',160); }
    this.filler(kind); },
  holdRing(ms){ ensureLayer(); if(ring) ring.remove(); ring=document.createElement('div'); ring.className='ring'; layer.appendChild(ring); ringT0=performance.now(); ringMs=ms;
    const step=()=>{ if(!ring) return; const u=Math.min(1,(performance.now()-ringT0)/ringMs); const sz = (52-30*u); ring.style.width=ring.style.height=`min(${sz}vh,${sz}vw)`; ring.style.margin=`calc(-1*min(${sz/2}vh,${sz/2}vw)) 0 0 calc(-1*min(${sz/2}vh,${sz/2}vw))`; if(u<1) requestAnimationFrame(step); else { ring.style.opacity='0'; setTimeout(()=>{ ring?.remove(); ring=null; },200); } }; step(); },
  // F9: instant fillers — pre-generated clips if present (audio/says/filler_{kind}_{lang}.mp3), else a WebAudio blip so the verdict is never silent
  filler(kind){ const lang=HE?'he':'en'; const a=new Audio(`../audio/says/filler_${kind}_${lang}.mp3`); a.volume=1; a.play().catch(()=>{ try{ const c=new (window.AudioContext||window.webkitAudioContext)(); const o=c.createOscillator(), g=c.createGain(); o.frequency.value = kind==='held'?1320: kind==='almost'?880:660; g.gain.value=.14; o.connect(g).connect(c.destination); o.start(); g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.16); o.stop(c.currentTime+.16);}catch(e){} }); },
};
window.NovaFX = NovaFX;
