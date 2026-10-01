// shared/pulse.js — the durable end-of-game row (fire-and-forget POST /pulse).
// rt_lk appends it to /workspace/pulse.log; grader G4 reads it.
export function pulseSend(row) {
  try {
    fetch('/pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row || {}),
      keepalive: true,               // survive the page unloading at game end
    }).catch(() => {});
  } catch (_) {}
}
