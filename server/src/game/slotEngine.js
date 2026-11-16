import { MACHINES, stripsFor, windowAt, evaluate } from '../../../shared/slots.js';
import { RTP_LEVELS, rtpKey } from '../../../shared/rtp.js';

// Slot math report. Outcomes themselves come from shared/fair.js (slotOutcome) using the
// player's provably-fair seed; this module only proves what each reel set pays.

/**
 * Exact RTP of a machine at a level. Every line sees symbols that are each distributed like
 * their reel strip, so E[line pay] is the same for every line; enumerate per-reel symbol
 * frequencies (symbols^reels combos) instead of all stop combinations.
 */
export function exactRtp(id, level) {
  const M = MACHINES[id];
  const freqs = stripsFor(id, level).map((st) => {
    const f = new Map();
    for (const s of st) f.set(s, (f.get(s) || 0) + 1 / st.length);
    return [...f.entries()];
  });
  const one = { ...M, lines: [M.lines[0]] };
  const syms = new Array(M.reels);
  let ev = 0;
  const rec = (r, p) => {
    if (r === M.reels) { ev += p * evaluate(one, syms.map((x) => [x, x, x])).totalMult; return; }
    for (const [s, q] of freqs[r]) { syms[r] = s; rec(r + 1, p * q); }
  };
  rec(0, 1);
  return ev;
}

/** Hit frequency and top-win odds by simulation (informational). */
export function simulate(id, level, spins = 50_000) {
  const strips = stripsFor(id, level);
  let hits = 0, big = 0;
  const lines = MACHINES[id].lines.length;
  for (let i = 0; i < spins; i++) {
    const stops = strips.map((s) => Math.floor(Math.random() * s.length));
    const m = evaluate(id, windowAt(id, level, stops)).totalMult;
    if (m) hits++;
    if (m >= lines * 20) big++;
  }
  return { hitFrequency: +(hits / spins).toFixed(4), bigWinRate: +(big / spins).toFixed(5) };
}

export function mathReport() {
  const out = {};
  for (const id of Object.keys(MACHINES)) {
    out[id] = {};
    for (const lvl of RTP_LEVELS) {
      const key = rtpKey(lvl);
      out[id][key] = { nominal: lvl, exact: +exactRtp(id, key).toFixed(6), reelLengths: stripsFor(id, key).map((s) => s.length) };
    }
  }
  return out;
}
