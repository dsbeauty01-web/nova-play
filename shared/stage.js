/* shared/stage.js — Nova's STAGE MANAGER. One program owns the show; the live AI only improvises inside the slots it is given.
   Built from what the shipped products do: Duolingo (fixed phases + the system tells Lily when to wrap up), Sword Health (orchestration
   layer owns turn-taking), Baidu (big pre-planned script + pre-coordinated movements, live AI fills the gaps), Praktika (memory retrieved
   after the user's turn), Reachy Mini (moves are commands that never interrupt speech).
   Pure logic with injected adapters → tested in Node (test/stage_test.mjs). Written by the architect. */

export const TIER = { HIGH: 'high', MID: 'mid', LOW: 'low' };

export class Stage {
  /* adapters (all optional except now):
     now()                  → ms clock (performance.now in the page; fake in tests)
     remember(text)         → silent context note to the brain (never makes her speak)
     speakNow(text)         → ask the brain to speak ONE line now (only the stage calls this)
     playClip(id, when?)    → play a recorded line (her voice); returns a promise that resolves when it ends
     setBody(id)            → switch her body/gesture bake
     light(cmd)             → lights/sfx hook
     log(msg)               → debug
     cfg                    → tunables (see DEFAULTS) */
  constructor(adapters = {}){
    this.a = Object.assign({ remember(){}, speakNow(){}, playClip(){ return Promise.resolve(); }, setBody(){}, light(){}, log(){} }, adapters);
    this.cfg = Object.assign({}, Stage.DEFAULTS, adapters.cfg || {});
    this.phaseName = 'idle'; this.live = false;
    this.kidSpeaking = false; this.novaSpeaking = false; this.lastSpeechEnd = -1e9;
    this.events = new Map();            // key → { type, data, conf, t, ttl }
    this.speakQueue = [];               // pending speech requests
    this.spoken = 0; this.lastFlush = -1e9;
    this.gestures = {}; this.gestureUntil = 0; this.restBody = this.cfg.restBody;
    this.facts = [];
    this.awaiting = null;               // a speak request waiting for her audio to actually start
  }
  static DEFAULTS = {
    idleGapMs: 600,          // silence after the last speech before the stage may speak (kids pause mid-thought)
    defaultTtlMs: 2500,      // a camera/game fact older than this is stale — never mentioned
    flushEveryMs: 1000,      // how often fresh facts are written into her memory (silently)
    maxSpeakWaitMs: 3000,    // a speech request waits this long for a quiet moment, then falls back
    highConf: 0.8, midConf: 0.5,
    restBody: 'nova_idle2',
    maxFacts: 12,            // long-term memory size per child
    confirmMs: 3000,         // after asking her to speak: if her audio hasn't started by then, the brain is silent → play the backup
  };
  now(){ return this.a.now(); }

  // ───────── phases: 'live' phases allow her live voice; 'show' phases never do ─────────
  phase(name, { live = false } = {}){
    this.phaseName = name; this.live = live; this.a.log(`[STAGE] phase ${name} live=${live}`);
    if (!live) this.speakQueue = this.speakQueue.filter(r => r.fallbackClip);   // show phase: pending live speech can only fall back
  }

  // ───────── turn state (fed by the bridge: mic VAD + her audio playing/ended) ─────────
  setKidSpeaking(on){ if (this.kidSpeaking && !on) this.lastSpeechEnd = this.now(); this.kidSpeaking = on; }
  setNovaSpeaking(on){
    if (on && this.awaiting){ const w = this.awaiting; this.awaiting = null; w.res('spoken'); }   // confirmed: she really started
    if (this.novaSpeaking && !on) this.lastSpeechEnd = this.now(); this.novaSpeaking = on; }
  get quiet(){ return !this.kidSpeaking && !this.novaSpeaking && (this.now() - this.lastSpeechEnd) >= this.cfg.idleGapMs; }

  // ───────── facts: time-stamped, confidence-tagged, coalesced by key, expiring ─────────
  event(type, data = {}, { key = type, conf = 1, ttlMs = this.cfg.defaultTtlMs } = {}){
    this.events.set(key, { type, data, conf, t: this.now(), ttl: ttlMs });   // same key → the latest wins (bursts collapse)
  }
  fresh(){
    const t = this.now(), out = [];
    for (const [k, e] of this.events){ if (t - e.t > e.ttl) this.events.delete(k); else out.push(e); }
    return out.sort((x, y) => x.t - y.t);
  }
  tier(conf){ return conf >= this.cfg.highConf ? TIER.HIGH : conf >= this.cfg.midConf ? TIER.MID : TIER.LOW; }
  factsNote(){
    const t = this.now(), f = this.fresh(); if (!f.length) return null;
    return 'FACTS (only mention what is listed; confidence decides how specific): ' +
      f.map(e => `[${((t - e.t)/1000).toFixed(1)}s ago · ${this.tier(e.conf)}] ${e.type}${Object.keys(e.data).length ? ' ' + JSON.stringify(e.data) : ''}`).join(' | ');
  }
  flush(force = false){
    if (!force && this.now() - this.lastFlush < this.cfg.flushEveryMs) return null;
    const note = this.factsNote(); this.lastFlush = this.now();
    if (note) this.a.remember(note);
    return note;
  }

  // ───────── speech: the ONLY way she speaks live. Waits for a quiet moment in a live phase ─────────
  requestSpeak(text, { maxWaitMs = this.cfg.maxSpeakWaitMs, fallbackClip = null, withFacts = true } = {}){
    return new Promise(res => this.speakQueue.push({ text, withFacts, fallbackClip, deadline: this.now() + maxWaitMs, res }));
  }
  /* call every frame / every 100ms */
  tick(){
    this.flush();
    if (this.awaiting && this.now() >= this.awaiting.until){           // the brain never answered
      const w = this.awaiting; this.awaiting = null; this.novaSpeaking = false; this.lastSpeechEnd = this.now();
      if (w.fallbackClip){ this.a.log(`[STAGE] brain silent → backup ${w.fallbackClip}`); this.a.playClip(w.fallbackClip); w.res('fallback'); }
      else { this.a.log('[STAGE] brain silent → nothing said'); w.res('silent'); }
    }
    if (this.gestureUntil && this.now() >= this.gestureUntil){ this.gestureUntil = 0; this.a.setBody(this.restBody); }
    if (!this.speakQueue.length) return;
    const r = this.speakQueue[0];
    if (this.awaiting) return;                                          // one line at a time: wait for the last one to start or time out
    if (this.live && this.quiet){
      this.speakQueue.shift();
      if (r.withFacts){ const n = this.factsNote(); if (n) this.a.remember(n); }
      this.novaSpeaking = true; this.spoken++; this.a.log(`[STAGE] speak "${r.text.slice(0,50)}"`);
      this.awaiting = { res: r.res, until: this.now() + this.cfg.confirmMs, fallbackClip: r.fallbackClip };
      this.a.speakNow(r.text); return;
    }
    if (this.now() >= r.deadline){
      this.speakQueue.shift();
      if (r.fallbackClip){ this.a.log(`[STAGE] fallback ${r.fallbackClip}`); this.a.playClip(r.fallbackClip); r.res('fallback'); }
      else { this.a.log('[STAGE] dropped (no quiet moment)'); r.res('dropped'); }
    }
  }

  // ───────── gestures are COMMANDS: they change her body, never her speech ─────────
  loadGestures(lib){ this.gestures = lib || {}; }
  gesture(id){
    const g = this.gestures[id]; if (!g) { this.a.log(`[STAGE] unknown gesture ${id}`); return false; }
    this.a.setBody(g.bake); this.gestureUntil = this.now() + g.durMs;   // back to rest when the bake ends — speech untouched
    return true;
  }

  // ───────── cue sheets (the Baidu backbone): lines + gestures + lights on a timeline ─────────
  /* sheet: [{ atMs, clip?, gesture?, light?, peakAlign? }]  — times relative to start.
     peakAlign=true: the gesture is started early so its PEAK lands on atMs (uses the gesture's peakMs). */
  runCue(sheet, schedule = (fn, ms) => setTimeout(fn, ms)){
    const items = [];
    for (const c of sheet){
      if (c.gesture){ const g = this.gestures[c.gesture]; const lead = (c.peakAlign && g) ? g.peakMs : 0;
        items.push({ at: Math.max(0, c.atMs - lead), fn: () => this.gesture(c.gesture), what: `gesture ${c.gesture}` }); }
      if (c.clip) items.push({ at: c.atMs, fn: () => this.a.playClip(c.clip), what: `clip ${c.clip}` });
      if (c.light) items.push({ at: c.atMs, fn: () => this.a.light(c.light), what: `light ${c.light}` });
    }
    items.sort((x, y) => x.at - y.at);
    for (const it of items) schedule(it.fn, it.at);
    return items.map(i => `${i.at}ms ${i.what}`);
  }

  // ───────── praise that can't be wrong: specificity follows the camera's confidence ─────────
  /* templates: { high: [clipIds], mid: [clipIds], low: [] } → returns the clip id to play (or null = stay quiet) */
  praise(templates, conf, pick = a => a[Math.floor(Math.random() * a.length)]){
    const list = templates[this.tier(conf)] || []; return list.length ? pick(list) : null;
  }

  // ───────── short memory between sessions (a few stated facts per child) ─────────
  loadMemory(list){ this.facts = Array.isArray(list) ? list.slice(-this.cfg.maxFacts) : []; }
  addFact(fact){ const f = String(fact).trim(); if (!f) return; this.facts = this.facts.filter(x => x !== f); this.facts.push(f); if (this.facts.length > this.cfg.maxFacts) this.facts.shift(); }
  memoryNote(){ return this.facts.length ? 'WHAT YOU REMEMBER ABOUT THIS CHILD (from earlier sessions): ' + this.facts.join(' · ') : null; }
}
