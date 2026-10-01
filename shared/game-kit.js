/* shared/game-kit.js — the common foundation every Nova game page stands on.
   MoveNet (TF.js, WebGL) only. Video-led. Guarded loops. Debug strip. No silent fallbacks.
   Written by the architect; parse-checked. Pages import { createKit } and write only game logic. */
/* [ADAPT 2026-09-23] The +esm CDN wrapper for pose-detection re-exports @mediapipe/pose, whose
   ESM build has no named 'Pose' export — the module throws before the kit runs a single line, so
   the page died at import with an empty console. Exactly the failure the shipped beta kit hit on
   2026-09-13; this is that same proven fix, ported: load both as UMD classic scripts and read
   them off window. old→new: +esm module imports → _cdn() UMD bundles. */
const _cdn = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('script load failed: ' + src)); document.head.appendChild(s); });
const _tfReady = (async () => {
  await _cdn('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js');
  await _cdn('https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js');
  return { tf: window.tf, poseDetection: window.poseDetection };
})();
import { MoverEngine } from '../shared/mover-engine.js';
import { RULES, WaveRule } from '../shared/mover-rules.js';
import { grade } from '../shared/cue-window.js';
import { LightEngine } from '../shared/light-engine.js';

export { RULES, WaveRule, grade };

const MN = { nose:0, lShoulder:5, rShoulder:6, lElbow:7, rElbow:8, lWrist:9, rWrist:10, lHip:11, rHip:12, lKnee:13, rKnee:14, lAnkle:15, rAnkle:16 };
const $ = id => document.getElementById(id);

export async function createKit(opts){
  const o = Object.assign({ tier:'kids', mirror:true, refCandidates:[], detectRef:false, music:null, lang:new URLSearchParams(location.search).get('lang')||'en', noteUrl:'/nova/note', pulseUrl:'/pulse', game:'game' }, opts);
  const K = { o, phase:'intro', running:false, DBG:{ kid:0, kidJ:0, ref:0, refJ:0, cues:0, hits:0, err:'' } };
  // ── DOM contract (pages provide these ids): refVid, refAmbient, usercam, fx, fxRef(optional), cap, dbg, banner, gate/start, gateArms/ring, hud score/tag, scorecard ──
  K.refVid=$('refVid'); K.amb=$('refAmbient'); K.cam=$('usercam'); K.cap=$('cap'); K.dbgEl=$('dbg');
  K.banner = msg => { const b=$('banner'); if(b){ b.textContent=msg; b.classList.remove('hidden'); } K.DBG.err=msg; K.dbg(); };
  K.dbg = () => { if(!K.dbgEl) return; const D=K.DBG; K.dbgEl.textContent=`kid ${D.kid}f/${D.kidJ}j | ref ${D.ref}f/${D.refJ}j | cues ${D.cues} hits ${D.hits} | ${K.phase}${D.err?' | ERR '+D.err:''}`; };
  addEventListener('error', e=>{ K.DBG.err='global:'+(e.message||e); K.dbg(); });
  addEventListener('unhandledrejection', e=>{ K.DBG.err='promise:'+(e.reason?.message||e.reason); K.dbg(); });

  // ── engines + lights ──
  K.E = new MoverEngine(); K.ER = o.detectRef ? new MoverEngine() : null;
  K.L = new LightEngine($('fx'), { tier:o.tier, mirror:o.mirror });
  K.LR = (o.detectRef && $('fxRef')) ? new LightEngine($('fxRef'), { tier:o.tier, mirror:false }) : null;
  K.wave = { R:new WaveRule(K.E,'R'), L:new WaveRule(K.E,'L') };
  if (K.ER) K.waveR = { R:new WaveRule(K.ER,'R'), L:new WaveRule(K.ER,'L') };
  K.CH = { R:['rShoulder','rElbow','rWrist'], L:['lShoulder','lElbow','lWrist'] };

  // ── optional pod bridge (voice/lips) — the game must run without it ──
  K.bridge=null; try { const m = await import('../shared/nova-bridge.js'); K.bridge=m; } catch(e){ K.bridge=null; }
  K.say = async (text) => { if (K.cap) K.cap.textContent=text; try { await fetch(o.noteUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({say:text,lang:o.lang})}); } catch(e){} };
  K.note = async (text) => { try { await fetch(o.noteUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({note:text})}); } catch(e){} };
  K.setPhase = (p) => { K.phase=p; document.body.dataset.phase=p; K.dbg();
    try { if (K.bridge?.routeVoice){ if (p==='intro'||p==='between'||p==='ending') K.bridge.routeVoice('engine'); else if (p==='hold') K.bridge.routeVoice('mute'); else K.bridge.routeVoice('air'); } } catch(e){} };

  // ── pose ──
  K.det=null;
  K.initPose = async () => { const { tf, poseDetection } = await _tfReady; await tf.setBackend('webgl'); await tf.ready();
    K.det = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING, enableSmoothing:true }); };
  K.detect = async (el) => { if(!K.det || !(el?.videoWidth>0)) return null; const poses=await K.det.estimatePoses(el,{flipHorizontal:false}); const kp=poses?.[0]?.keypoints; if(!kp) return null;
    const W=el.videoWidth, H=el.videoHeight, out={}; for (const [n,i] of Object.entries(MN)){ const p=kp[i]; if(p) out[n]={x:p.x/W, y:p.y/H, z:0, vis:p.score??0}; } return out; };

  // ── assets ──
  K.pickRef = async () => { for (const u of o.refCandidates){ try{ const r=await fetch(u,{method:'HEAD'}); if(r.ok) return u; }catch(e){} } return null; };
  K.startCamera = async () => { try { const s=await navigator.mediaDevices.getUserMedia({ video:{ width:{ideal:1280}, height:{ideal:720} }, audio:false }); K.cam.srcObject=s; await new Promise(r=>{ if(K.cam.videoWidth>0) r(); else K.cam.onloadedmetadata=()=>r(); }); return true; } catch(e){ K.banner('Camera blocked — allow the camera and reload.'); return false; } };

  // ── presence gate: shoulders + elbows + wrists visible (vis ≥0.6) AND inside the frame ≥1s; draws live joint dots; names what's missing ──
  /* [QA Q2 · 2026-09-26] The gate used to demand ALL SIX joints at vis>0.6 and inside the frame, with
     NO way out — a child standing slightly too close (wrists or elbows out of shot) was locked out of
     the game forever, staring at "step back". That is the same wrong assumption Q2 fixed in the judge:
     the judge degrades (wrist -> elbow -> last verdict), so the gate must not demand more than the
     judge needs. It now asks for both SHOULDERS plus ONE arm joint per side, and — because the spec's
     own rule is "the game is never stuck" — it lets you in anyway after gateMaxMs and says so. */
  K.presenceGate = async () => { const g=$('gateArms'), ring=$('ring'), msg=$('gateMsg'); if(g) g.classList.remove('hidden'); let okSince=null;
    const need=['lShoulder','rShoulder','lElbow','rElbow','lWrist','rWrist'], cv=$('fx'), cx=cv?.getContext('2d');
    const VIS = 0.5, GATE_MAX = o.gateMaxMs ?? 12000, t0 = performance.now();
    await new Promise(res=>{ const tick=async()=>{ try{ const k=await K.detect(K.cam);
        const inFrame = p => p && p.x>0.04 && p.x<0.96 && p.y>0.04 && p.y<0.96;
        const good = n => k?.[n]?.vis>VIS && inFrame(k[n]);
        const seen = need.filter(good);
        const arm = side => good(side+'Wrist') || good(side+'Elbow');      // one joint per arm is enough
        const ok = good('lShoulder') && good('rShoulder') && arm('l') && arm('r');
        if (!ok && performance.now() - t0 > GATE_MAX){                     // never stuck
          K.DBG.err = 'gate: let in degraded after ' + Math.round((performance.now()-t0)/1000) + 's';
          if (msg) msg.textContent = o.lang === 'he' ? 'בסדר, מתחילים!' : "OK — let's go!";
          if (cx&&cv) cx.clearRect(0,0,cv.width,cv.height);
          return setTimeout(res, 700);
        }
        if (cx&&cv&&k){ cv.width=cv.clientWidth*devicePixelRatio; cv.height=cv.clientHeight*devicePixelRatio; cx.clearRect(0,0,cv.width,cv.height);
          for (const n of need){ const p=k[n]; if(!p) continue; const x=(K.o.mirror?1-p.x:p.x)*cv.width, y=p.y*cv.height; cx.fillStyle = good(n) ? '#7ddba3' : '#ffb27d'; cx.shadowBlur=18; cx.shadowColor=cx.fillStyle; cx.beginPath(); cx.arc(x,y,10*devicePixelRatio,0,7); cx.fill(); cx.shadowBlur=0; } }
        // [ADAPT 2026-09-23] the gate spoke English at a Hebrew-speaking child — the first thing
        // a kid sees, in the wrong language, before anyone has said a word. Keyed on o.lang.
        if (msg){ const HEB = o.lang === 'he';
          /* name the thing that is ACTUALLY blocking, in the order the rule checks it — the old
             message said "wrists" whenever any wrist was missing, even when a visible elbow already
             satisfied the rule, so it asked people to fix something that was not the problem. */
          msg.textContent = ok
            ? (HEB ? 'אני רואה אותך — קדימה!' : 'I see you — go!')
            : !(good('lShoulder') && good('rShoulder'))
              ? (HEB ? 'תתרחק/י קצת שאראה את הכתפיים' : 'Step back so I can see your shoulders')
              : (HEB ? 'תתרחק/י שאראה את הידיים' : 'Step back so I can see your arms'); }
        if(ring) ring.classList.toggle('ok', !!ok); if(ok){ okSince ??= performance.now(); if(performance.now()-okSince>1000){ if(cx) cx.clearRect(0,0,cv.width,cv.height); return res(); } } else okSince=null; }catch(e){ K.DBG.err='gate:'+e.message; K.dbg(); } requestAnimationFrame(tick); }; tick(); });
    if(g) g.classList.add('hidden'); };
  // arms currently trackable? (vis ≥0.6 on the whole chain) — pages must gate scoring on this
  K.armsVisible = (k) => ['lShoulder','rShoulder','lElbow','rElbow','lWrist','rWrist'].every(n=>k?.[n]?.vis>0.6);
  /* [QA Q2] What the judge actually needs: both shoulders, and one joint per arm. armsVisible above is
     left untouched because the older pages gate scoring on it; new callers should use this. */
  K.bodyTrackable = (k) => { const v = n => k?.[n]?.vis > 0.5;
    return v('lShoulder') && v('rShoulder') && (v('lWrist') || v('lElbow')) && (v('rWrist') || v('rElbow')); };

  // ── loops (guarded) ──
  K.onKid=null; K.onRef=null; K.onClock=null;
  const loopKid = async () => { if(!K.running) return; try{ if (K.cam.videoWidth>0){ const k=await K.detect(K.cam); K.DBG.kid++; if(k){ K.DBG.kidJ=Object.keys(k).length; const out=K.E.update(k); K.L.setJoints(out); if(K.onKid) K.onKid(out,k); } } }catch(e){ K.DBG.err='kid:'+e.message; } K.dbg(); requestAnimationFrame(loopKid); };
  const loopRef = async () => { if(!K.running) return; try{ if (K.ER && K.refVid && !K.refVid.paused){ const k=await K.detect(K.refVid); K.DBG.ref++; if(k){ K.DBG.refJ=Object.keys(k).length; const out=K.ER.update(k); if(K.LR) K.LR.setJoints(out); if(K.onRef) K.onRef(out,k); } } }catch(e){ K.DBG.err='ref:'+e.message; } requestAnimationFrame(loopRef); };
  const loopClock = () => { if(!K.running) return; try{ if(K.onClock) K.onClock(K.refVid ? K.refVid.currentTime : performance.now()/1000); }catch(e){ K.DBG.err='clock:'+e.message; K.dbg(); } requestAnimationFrame(loopClock); };
  K.start = () => { K.running=true; loopKid(); if(K.ER) loopRef(); loopClock(); };
  K.stop = () => { K.running=false; };

  // ── HUD helpers ──
  K.hud = { score:v=>{ const e=$('score'); if(e) e.textContent=v; }, tag:t=>{ const e=$('tag'); if(e) e.textContent=t; }, dots:(n,total)=>{ const d=$('dots'); if(!d) return; d.innerHTML=''; for(let i=0;i<total;i++){ const s=document.createElement('i'); if(i<n) s.className='on'; d.appendChild(s);} } };
  K.flyText = (s) => { const h=K.L.P('head')||K.L.P('shoulderC'); if(!h||!K.L.flyUp) return; const sw=(K.L.sw?K.L.sw():140); K.L.flyUp({x:h.x, y:h.y - sw*1.3}, s); };   // ABOVE the head, never on the face
  K.scorecard = (score, line) => { const sc=$('scorecard'); if(!sc) return; $('finalScore').textContent=score; $('finalLine').textContent=line; sc.style.display='flex'; };
  K.pulse = (data) => { fetch(o.pulseUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(Object.assign({game:o.game,at:Date.now(),lang:o.lang},data))}).catch(()=>{}); };

  // ── sound: tick/ding via WebAudio (no assets) ──
  K.actx=null; K.blip=(f,ms=80,g=.12)=>{ try{ K.actx ||= new (window.AudioContext||window.webkitAudioContext)(); const c=K.actx,o1=c.createOscillator(),gn=c.createGain(); o1.frequency.value=f; gn.gain.value=g; o1.connect(gn).connect(c.destination); o1.start(); gn.gain.exponentialRampToValueAtTime(.0001,c.currentTime+ms/1000); o1.stop(c.currentTime+ms/1000);}catch(e){} };
  K.tick=(streak=0)=>K.blip(Math.min(1100,660+streak*40),70); K.ding=()=>K.blip(1320,160,.14);

  // ── music bed (WebAudio, no asset): calm groove for wave/upper body; call K.bed.start()/stop()/duck(on) ──
  K.bed = { g:null, on:false, start(bpm=96, vol=0.28){ try{ K.actx ||= new (window.AudioContext||window.webkitAudioContext)(); const c=K.actx; this.g=c.createGain(); this.g.gain.value=vol; this.g.connect(c.destination); this.on=true; this.bpm=bpm; this.beat=60/bpm; this.next=c.currentTime+0.1; this.n=0; this.tick(); }catch(e){} },
    stop(){ this.on=false; if(this.g) this.g.gain.setTargetAtTime(0,K.actx.currentTime,0.15); }, duck(on){ if(this.g) this.g.gain.setTargetAtTime(on?0.12:0.28,K.actx.currentTime,0.08); },
    tick(){ if(!this.on) return; const c=K.actx; while(this.next<c.currentTime+0.5){ const b=this.n%8, t=this.next;
      this.hit(t,140,0.0,0.16,0.7,'sine',40); if(b%4===2) this.noise(t,0.10,1800,0.35); this.noise(t+this.beat*0.5,0.04,7000,0.18);
      const notes=[0,0,7,5,0,3,7,10]; this.hit(t,110*Math.pow(2,notes[b]/12),0.01,0.30,0.30,'triangle');
      if(b===0||b===5) this.hit(t,220*Math.pow(2,[0,3,7][this.n%3]/12),0.02,0.5,0.10,'sine');
      this.next+=this.beat; this.n++; } setTimeout(()=>this.tick(),120); },
    hit(t,f,a,d,peak,type,slideTo){ const c=K.actx,o=c.createOscillator(),g=c.createGain(); o.type=type; o.frequency.setValueAtTime(f,t); if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo,t+0.12); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+a); g.gain.exponentialRampToValueAtTime(0.0001,t+a+d); o.connect(g).connect(this.g); o.start(t); o.stop(t+a+d+0.05); },
    noise(t,d,freq,peak){ const c=K.actx,b=c.createBuffer(1,c.sampleRate*d,c.sampleRate),x=b.getChannelData(0); for(let i=0;i<x.length;i++) x[i]=Math.random()*2-1; const s=c.createBufferSource(); s.buffer=b; const f=c.createBiquadFilter(); f.type=freq>5000?'highpass':'bandpass'; f.frequency.value=freq; const g=c.createGain(); g.gain.setValueAtTime(peak,t); g.gain.exponentialRampToValueAtTime(0.0001,t+d); s.connect(f).connect(g).connect(this.g); s.start(t); } };
  K.sting = () => { K.blip(880,60,.14); setTimeout(()=>K.blip(1320,120,.16),60); };

  // ── standard boot: gate → camera → pose → ref video → presence → go ──
  K.boot = async (onGo) => { const start=$('start'); if(!start) return onGo();
    start.onclick = async () => { $('gate')?.classList.add('hidden');
      const ref = o.refCandidates.length ? await K.pickRef() : null; if (o.refCandidates.length && !ref) return K.banner('Reference video missing: '+o.refCandidates.join(' | '));
      if (!(await K.startCamera())) return;
      try { await K.initPose(); } catch(e){ return K.banner('Pose engine (MoveNet) failed: '+e.message); }
      if (ref){ K.refVid.src=ref; if(K.amb){ K.amb.src=ref; K.amb.muted=true; K.amb.loop=true; K.amb.play().catch(()=>{}); } }
      await K.presenceGate(); onGo(ref); }; };
  return K;
}
