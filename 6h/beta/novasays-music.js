// beta/novasays-music.js — NOVA-SAYS-V2 §1: the sneaky cartoon-spy groove, synthesized in
// WebAudio (no asset dependency; a real /media/sneaky.mp3 can replace it later — the
// sequencer only needs `bar`). 110 BPM, swing hats, walking bass in A minor, muted stabs.
export class SneakyBed {
  constructor(ctx){ this.ctx=ctx; this.bpm=110; this.beat=60/110; this.bar=this.beat*4; this.g=ctx.createGain(); this.g.gain.value=0.32; this.g.connect(ctx.destination); this.t0=null; this.next=0; this.n=0; }
  start(at){ this.t0=at; this.next=at; this.tick(); }
  stop(){ this.stopped=true; this.g.gain.setTargetAtTime(0,this.ctx.currentTime,0.1); }
  duck(on){ this.g.gain.setTargetAtTime(on?0.14:0.32,this.ctx.currentTime,0.08); }
  barAt(t){ return Math.floor((t-this.t0)/this.bar); }            // which bar is playing at time t
  nextBarStart(t){ return this.t0 + (this.barAt(t)+1)*this.bar; }
  tick(){ if(this.stopped) return; const c=this.ctx; while(this.next < c.currentTime+0.5){ const b=this.n%16, t=this.next;
      this.kick(t); if(b%4===2) this.snare(t);                                   // kick every beat, snare on 3
      this.hat(t+this.beat*0.5*0.66);                                             // swung off-beat hat
      const bassNotes=[0,0,7,5, 0,0,3,5, 0,0,7,10, 8,7,5,3]; this.bass(t, 55*Math.pow(2, bassNotes[b]/12));   // walking bass in A minor
      if(b%8===6) this.stab(t, 220*Math.pow(2,3/12)); if(b%8===7) this.stab(t+this.beat*0.5, 220*Math.pow(2,7/12));
      this.next+=this.beat; this.n++; } setTimeout(()=>this.tick(), 120); }
  env(node,t,a,d,peak){ const g=this.ctx.createGain(); g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(peak,t+a); g.gain.exponentialRampToValueAtTime(0.0001,t+a+d); node.connect(g).connect(this.g); return g; }
  kick(t){ const o=this.ctx.createOscillator(); o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(45,t+0.12); this.env(o,t,0.002,0.18,0.9); o.start(t); o.stop(t+0.2); }
  snare(t){ const n=this.noise(0.12); const f=this.ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1800; n.connect(f); this.env(f,t,0.002,0.11,0.5); n.start(t); }
  hat(t){ const n=this.noise(0.05); const f=this.ctx.createBiquadFilter(); f.type='highpass'; f.frequency.value=7000; n.connect(f); this.env(f,t,0.001,0.04,0.25); n.start(t); }
  bass(t,f){ const o=this.ctx.createOscillator(); o.type='triangle'; o.frequency.value=f; this.env(o,t,0.01,0.28,0.35); o.start(t); o.stop(t+0.32); }
  stab(t,f){ const o=this.ctx.createOscillator(); o.type='square'; o.frequency.value=f; const lp=this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=900; o.connect(lp); this.env(lp,t,0.005,0.16,0.18); o.start(t); o.stop(t+0.2); }
  noise(d){ const b=this.ctx.createBuffer(1,this.ctx.sampleRate*d,this.ctx.sampleRate); const x=b.getChannelData(0); for(let i=0;i<x.length;i++) x[i]=Math.random()*2-1; const s=this.ctx.createBufferSource(); s.buffer=b; return s; }
}
