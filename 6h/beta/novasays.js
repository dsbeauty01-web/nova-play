// beta/novasays.js — NOVA-SAYS-V2 game library (NOVA-SAYS-V2.md §2-§4 · beta-b0.25-novasays2).
// V2 REPLACES V1: beat-locked rhythm game — 7 commands (only what the bank + engine do
// PERFECTLY), pre-recorded command lines (founder-approved law exception), chains in
// round 4, correct Simon-Says scoring. PURE logic only: the page supplies E/lights/audio;
// test/novasays_bench.js imports this file and drives it deterministically.
import { RULES } from '../shared/mover-rules.js';

// ── §2 THE COMMANDS ─────────────────────────────────────────────────────────
// demo ids verified on the live volume 2026-09-11 (gest_star/lefthand/righthand/clap/bear).
// jump + head are body-only: the light shows the target. head's rule carries the motion
// gate IN the rule (wrist mag>0.3 — v2 spec; replaces v1's makeArmGate for this command).
// ctx = { audio, } supplied by the page (clap onset fusion).
export const CMDS = [
  { id:'armsUp',   sayEN:'arms UP!',            sayHE:'ידיים למעלה!',   rule:(E)=>RULES.armRaise(E)?.side==='BOTH'?{hit:true}:null,                 light:{joints:['lWrist','rWrist'],dir:'UP'}, demo:'gest_star' },
  { id:'leftUp',   sayEN:'LEFT arm up!',        sayHE:'יד שמאל למעלה!', rule:(E)=>['L','BOTH'].includes(RULES.armRaise(E)?.side)?{hit:true}:null,   light:{joints:['lWrist'],dir:'UP'},          demo:'gest_lefthand' },
  { id:'rightUp',  sayEN:'RIGHT arm up!',       sayHE:'יד ימין למעלה!', rule:(E)=>['R','BOTH'].includes(RULES.armRaise(E)?.side)?{hit:true}:null,   light:{joints:['rWrist'],dir:'UP'},          demo:'gest_righthand' },
  { id:'clap',     sayEN:'CLAP!',               sayHE:'מחיאת כף!',      rule:(E,ctx)=>RULES.clap(E, ctx?.audio?.lastOnset ?? null),                 light:'clap',                                demo:'gest_clap' },
  { id:'freeze',   sayEN:'FREEZE!',             sayHE:'קפוא!',          rule:(E)=>RULES.freeze(E,0.12).still?{hit:true}:null,                       light:'ice',                                 demo:'gest_bear', hold:1.0 },
  { id:'jump',     sayEN:'JUMP!',               sayHE:'קפיצה!',         rule:(E)=>RULES.jump(E),                                                    light:{joints:['hipC'],dir:'UP'},            demo:null },
  { id:'head',     sayEN:'hands on your HEAD!', sayHE:'ידיים על הראש!', rule:(E)=>RULES.handsOnHead(E)&&E.last.lWrist.mag>0.3?{hit:true}:null,      light:{joints:['head'],dir:null},            demo:null },
];

// pre-recorded clip name for a step: audio/says/{id}_{real|trick}_{en|he}.mp3
export const clipName = (step, lang) => `${step.cmd.id}_${step.trick ? 'trick' : 'real'}_${lang === 'he' ? 'he' : 'en'}.mp3`;
export const ALL_CLIPS = [
  ...CMDS.flatMap(c => ['real', 'trick'].flatMap(k => ['en', 'he'].map(l => `${c.id}_${k}_${l}.mp3`))),
  'gotcha_en.mp3', 'gotcha_he.mp3', 'giggle.mp3',
];

// ── §3 ROUNDS + SEQUENCER — every command owns exactly its bars ─────────────
export const ROUNDS = [
  { n:1, label:'ROUND 1 · SLOW',      count:8,  barsPerCmd:2,   tricks:1, chains:0 },   // bar A: line + demo · bar B: your move
  { n:2, label:'ROUND 2 · FASTER',    count:10, barsPerCmd:1.5, tricks:3, chains:0 },
  { n:3, label:"ROUND 3 · YOU'RE THE BOSS", boss:true, count:6 },
  { n:4, label:'ROUND 4 · LIGHTNING', count:12, barsPerCmd:1,   tricks:5, chains:2 },   // chains = "Nova says arms up AND clap"
];

export function buildRound(R, rnd = Math.random) {
  const seq = []; const trickSlots = new Set();
  while (trickSlots.size < (R.tricks || 0)) trickSlots.add(1 + Math.floor(rnd() * (R.count - 1)));   // never a trick first
  let last = null;
  for (let i = 0; i < R.count; i++) {
    let c; do { c = CMDS[Math.floor(rnd() * CMDS.length)]; } while (c === last); last = c;
    const chain = (R.chains && !trickSlots.has(i) && i > 2 && seq.filter(s => s.chain).length < R.chains)
      ? CMDS.filter(x => x !== c && x.id !== 'freeze')[Math.floor(rnd() * 5)] : null;
    seq.push({ cmd: c, chain, trick: trickSlots.has(i) });
  }
  return seq;
}

// ── §4 CORRECT SIMON-SAYS SCORING (pure — never negative, always fair) ──────
//   real+hit  → 10 (+5 fast <40% of span); hold wiggled → 5; chain both = ×2, chain half = /2;
//               streak≥5 doubles.   real+miss → 0, streak resets, silence.
//   trick+moved → GOTCHA: 0, streak resets, never minus, never ends the game.
//   trick+held  → 15 (streak≥5 doubles).
export function scoreStep(step, r, span, streak) {
  const c = step.cmd;
  if (!step.trick) {
    if (r?.hit) {
      const fast = r.ms < span * 0.4;
      let pts = 10 + (fast ? 5 : 0);
      if (c.hold && !r.held) pts = 5;
      if (step.chain) pts = r.chainDone ? pts * 2 : Math.round(pts / 2);
      streak++; if (streak >= 5) pts *= 2;
      return { event:'hit', pts, streak, fast, chainDone: !!r.chainDone };
    }
    return { event:'miss', pts:0, streak:0, fast:false };
  }
  if (r?.hit) return { event:'gotcha', pts:0, streak:0, fast:false };
  let pts = 15; streak++; if (streak >= 5) pts *= 2;
  return { event:'trickHeld', pts, streak, fast:false };
}

// stars per round: (hits + trickHeld) / count → ★ ≥40% · ★★ ≥70% · ★★★ ≥90%
export function starsFor(stats, count) {
  const landed = (stats.hits + stats.trickHeld) / count;
  return landed >= 0.9 ? 3 : landed >= 0.7 ? 2 : landed >= 0.4 ? 1 : 0;
}

// ── §7 BOSS-ROUND PARSER (v1's proven code, trimmed to the 7 v2 commands) ───
const KEYS = {
  leftUp:['left','שמאל'], rightUp:['right','ימין'], head:['head','ראש'],
  clap:['clap','כפיים','כף'], freeze:['freeze','statue','קפוא','פסל','לקפוא'],
  jump:['jump','קפיצה','לקפוץ','קפצי','קפוץ'], armsUp:['arms','both','ידיים'],
};
const MATCH_ORDER = ['leftUp','rightUp','head','clap','freeze','jump','armsUp'];   // specific first
export function parseCommand(text) {
  const t = (text || '').toLowerCase();
  if (!t.trim()) return null;
  const novaSays = /nova says|נובה אומרת/.test(t);
  for (const id of MATCH_ORDER) {
    if (KEYS[id].some(k => t.includes(k))) return { novaSays, cmd: CMDS.find(x => x.id === id) };
  }
  return null;
}
