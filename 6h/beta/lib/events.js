/* beta/lib/events.js — reaction triggers for the BRAIN (night item D). Every detected moment in every game becomes
   { t, game, event, detail } with event ∈ round_start · hit · skip_unseen · miss · medal, pushed to window.novaEvents
   (and dispatched as a 'nova-event' DOM event) and into the Save-my-play file. Nothing speaks yet — this is what the
   talking avatar will react to. Pure mapping (Node-tested 1:1 against the replay tables); the queue is browser-only. */

/* a game's own event → the brain's event, or null when the brain doesn't care */
export function toNovaEvent(game, type, d = {}){
  const round = d.round ?? d.bar;
  if (type === 'phase'){
    const starts = { freeze: 'dance', copy: 'show', groove: 'bar' }[game];
    return d.phase === starts ? { event: 'round_start', detail: { round, ...(d.pose ? { pose: d.pose } : {}) } } : null;
  }
  if (type === 'star')   return { event: 'hit', detail: { round, ...(d.pose ? { pose: d.pose } : {}) } };
  if (type === 'bonus')  return { event: 'hit', detail: { round, bonus: 'onBeat' } };
  if (type === 'skip')   return { event: 'skip_unseen', detail: { round, seen: d.seen } };
  if (type === 'notyet') return { event: 'miss', detail: { round, ...(d.pose ? { pose: d.pose } : {}) } };   // "not yet" — never said as a fail
  if (type === 'end')    return { event: 'medal', detail: { medal: d.medal, stars: d.stars, rounds: d.rounds, skips: d.skips } };
  return null;
}

/* browser: the queue the avatar will read. Returns emit(type, d) for the page's onEvent. */
export function createNovaEvents(game, sink){
  const q = (globalThis.novaEvents ??= []), t0 = performance.now() / 1000;
  return (type, d) => {
    const e = toNovaEvent(game, type, d); if (!e) return null;
    const ev = { t: +(performance.now() / 1000 - t0).toFixed(3), game, ...e };
    q.push(ev); sink?.(ev);
    try { globalThis.dispatchEvent?.(new CustomEvent('nova-event', { detail: ev })); } catch {}
    return ev;
  };
}
