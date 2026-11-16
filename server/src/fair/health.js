import crypto from 'node:crypto';
import { Draw } from '../../../shared/fair.js';

// RNG health monitoring, in the spirit of NIST SP 800-90B / GLI-19:
//  - known-answer tests prove SHA-256 / HMAC-SHA256 behave as specified
//  - statistical start-up tests on the OS entropy source
//  - continuous test on every server seed generated (no repeats / stuck output)
// If anything fails the game stops taking bets (assertHealthy throws) until restart.

const state = { ok: false, checkedAt: null, results: [], failure: null };
let lastSeed = null;

function fail(reason) {
  state.ok = false;
  state.failure = { reason, at: new Date().toISOString() };
  console.error(`[rng] HEALTH FAILURE: ${reason} — betting disabled`);
}

export function selfTest() {
  const results = [];
  const check = (name, pass, info = '') => results.push({ name, pass, info });

  // Known-answer tests (FIPS 180-2 "abc", RFC 4231 test case 2)
  check('sha256 KAT', crypto.createHash('sha256').update('abc').digest('hex') ===
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  check('hmac-sha256 KAT', crypto.createHmac('sha256', 'Jefe').update('what do ya want for nothing?').digest('hex') ===
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');

  // Entropy source: 1 MiB of OS randomness
  const buf = crypto.randomBytes(1 << 20);
  const counts = new Array(256).fill(0);
  let ones = 0;
  for (const b of buf) { counts[b]++; ones += POP[b]; }
  const bits = buf.length * 8;
  const z = Math.abs(ones - bits / 2) / Math.sqrt(bits / 4);
  check('monobit', z < 5, `z=${z.toFixed(2)}`);
  const exp = buf.length / 256;
  const chi = counts.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
  check('byte chi-square (df=255)', chi < 400, `chi2=${chi.toFixed(1)}`);
  let maxRun = 1, run = 1;
  for (let i = 1; i < buf.length; i++) { run = buf[i] === buf[i - 1] ? run + 1 : 1; if (run > maxRun) maxRun = run; }
  check('repetition count', maxRun < 6, `longest run=${maxRun}`);

  // Unbiased integer mapping: 120k draws of int(7) through the provably-fair reader
  const draw = new Draw(crypto.randomBytes(4 * 130_000));
  const c7 = new Array(7).fill(0);
  for (let i = 0; i < 120_000; i++) c7[draw.int(7)]++;
  const e7 = 120_000 / 7;
  const chi7 = c7.reduce((s, c) => s + (c - e7) ** 2 / e7, 0);
  check('int(7) uniformity (df=6)', chi7 < 35, `chi2=${chi7.toFixed(1)}`);

  state.results = results;
  state.checkedAt = new Date().toISOString();
  state.ok = results.every((r) => r.pass);
  state.failure = state.ok ? null : { reason: results.filter((r) => !r.pass).map((r) => r.name).join(', '), at: state.checkedAt };
  return state;
}

const POP = Array.from({ length: 256 }, (_, i) => i.toString(2).split('').filter((b) => b === '1').length);

/** 32 random bytes as hex, with a continuous health test. */
export function newServerSeed() {
  assertHealthy();
  const b = crypto.randomBytes(32);
  if ((lastSeed && b.equals(lastSeed)) || b.every((x) => x === b[0])) {
    fail('entropy source repeated or stuck output');
    assertHealthy();
  }
  lastSeed = b;
  return b.toString('hex');
}

export class RngUnavailable extends Error {}

export function assertHealthy() {
  if (!state.ok) throw new RngUnavailable('RNG health check failed; game is closed');
}

export const healthReport = () => ({ ...state });
export const isHealthy = () => state.ok;
