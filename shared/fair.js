// Provably-fair outcome derivation, shared by the server (to decide outcomes) and the
// browser / any third party (to verify them). Pure functions; the caller supplies the bytes.
//
//   bytes  = HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:0`)
//          ‖ HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:1`)  ‖ … (BLOCKS blocks)
//   commit = SHA256(serverSeed)   (shown to the player before the seed is used)
//
// serverSeed is a 64-char hex string and is used as the HMAC key exactly as written (UTF-8).
// Each round (one fish capture attempt, or one slot spin) uses the next nonce of the player's
// active seed pair. Numbers are read from the byte stream in order:
//   float() = next 6 bytes, big-endian, / 2^48          -> [0, 1)
//   int(n)  = next 4 bytes, big-endian, rejection-sampled so every value in [0, n) is exactly equally likely

import { FISH, expectedMult } from './fishTypes.js';
import { stripsFor, windowAt, evaluate } from './slots.js';
import { isRtpLevel } from './rtp.js';

export const FAIR_VERSION = 1;
export const BLOCKS = 4; // 128 bytes per round
export const hmacMessage = (clientSeed, nonce, cursor) => `${clientSeed}:${nonce}:${cursor}`;
export const CLIENT_SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class Draw {
  constructor(bytes) {
    this.b = bytes;
    this.i = 0;
  }
  take(n) {
    if (this.i + n > this.b.length) throw new Error('fair: round ran out of random bytes');
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + this.b[this.i++];
    return v;
  }
  float() { return this.take(6) / 2 ** 48; }
  int(n) {
    if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new Error(`fair: bad range ${n}`);
    const limit = Math.floor(2 ** 32 / n) * n; // largest multiple of n that fits; reject above it
    for (;;) {
      const v = this.take(4);
      if (v < limit) return v % n;
    }
  }
}

/**
 * Fish capture. `victimTypes[0]` is the fish that was hit; the rest are what a bomb/chain fish
 * would also catch. One roll decides the whole group:
 *   p = min(1, rtp / Σ expectedMult(victims));  captured = roll < p
 * Boss multipliers are then drawn uniformly from their range in steps of 5.
 */
export function fishOutcome(bytes, { rtp, victimTypes }) {
  const d = new Draw(bytes);
  const expTotal = victimTypes.reduce((s, ty) => s + expectedMult(ty), 0);
  const p = Math.min(1, rtp / expTotal);
  const roll = d.float();
  const captured = roll < p;
  const mults = captured
    ? victimTypes.map((ty) => {
      const m = FISH[ty].mult;
      return Array.isArray(m) ? m[0] + 5 * d.int((m[1] - m[0]) / 5 + 1) : m;
    })
    : [];
  return { p, roll, captured, mults, totalMult: mults.reduce((s, m) => s + m, 0) };
}

/** Slot spin: one uniform stop per reel on the reel set for this RTP level. */
export function slotOutcome(bytes, machine, level) {
  const d = new Draw(bytes);
  const stops = stripsFor(machine, level).map((st) => d.int(st.length));
  const res = evaluate(machine, windowAt(machine, level, stops));
  return { stops, totalMult: res.totalMult, lines: res.lines };
}

const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Recompute a logged round from its seed and compare with what was recorded.
 * `round` = { game, bet, win, detail, fairness: { nonce } } as returned by the rounds API.
 * `bytes` = the round's 128 seed bytes, or a function nonce -> bytes (required for batch rows,
 * which cover a run of consecutive nonces).
 */
export function recomputeRound(round, bytes) {
  const d = round.detail;
  const get = typeof bytes === 'function' ? bytes : () => bytes;
  const problems = [];
  let outcome;
  if (round.game === 'fish' && d.kind === 'batch') {
    // One row = n ordinary hits on nonces start..start+n-1 at one bet and RTP.
    if (!isRtpLevel(d.rtp)) problems.push(`RTP ${d.rtp} is not an allowed level`);
    const entries = d.v ? d.v.split(',') : [];
    if (entries.length !== d.n) problems.push('hit count differs');
    const start = round.fairness?.nonce;
    let win = 0, wins = 0;
    entries.forEach((e, i) => {
      const o = fishOutcome(get(start + i), { rtp: d.rtp, victimTypes: e.split('.').map(Number) });
      if (o.captured) { win += d.bet * o.totalMult; wins++; }
    });
    outcome = { win, wins };
    if (win !== round.win) problems.push(`win should be ${win}`);
    if (wins !== d.wins) problems.push(`catches should be ${wins}`);
    if (round.bet !== d.bet * d.n) problems.push('bet does not match bet × hits');
  } else if (round.game === 'fish') {
    if (!isRtpLevel(d.rtp)) problems.push(`RTP ${d.rtp} is not an allowed level`);
    outcome = fishOutcome(get(round.fairness?.nonce), { rtp: d.rtp, victimTypes: d.victims.map((v) => (typeof v === 'number' ? v : v.ty)) });
    const win = outcome.captured ? round.bet * outcome.totalMult : 0;
    if (outcome.roll !== d.roll) problems.push('roll differs');
    if (Math.abs(outcome.p - d.p) > 1e-12) problems.push('capture chance differs');
    if (outcome.captured !== d.captured) problems.push('capture result differs');
    if (!sameArr(outcome.mults, d.mults)) problems.push('multipliers differ');
    if (win !== round.win) problems.push(`win should be ${win}`);
  } else if (round.game === 'slot') {
    outcome = slotOutcome(get(round.fairness?.nonce), d.machine, d.level);
    const win = outcome.totalMult * d.lineBet;
    if (!sameArr(outcome.stops, d.stops)) problems.push('reel stops differ');
    if (win !== round.win) problems.push(`win should be ${win}`);
    if (round.bet !== d.lineBet * d.lines) problems.push('bet does not match line bet × lines');
  } else {
    problems.push(`unknown game ${round.game}`);
  }
  return { ok: problems.length === 0, problems, outcome };
}
