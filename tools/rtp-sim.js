#!/usr/bin/env node
// Local RTP simulation for every game.
//
// Every round is resolved with the same provably-fair outcome functions the server uses
// (shared/fair.js: fishOutcome / slotOutcome), driven by a deterministic byte stream instead
// of a player's live seed pair. No database writes, no server, no wallet: this measures the
// game math only.
//
//   node tools/rtp-sim.js                    # every configured room at its live RTP
//   node tools/rtp-sim.js --sweep            # every game at 92 / 94 / 96 %
//   node tools/rtp-sim.js --rounds 5000000   # more rounds => tighter confidence interval
//   node tools/rtp-sim.js --json             # machine-readable report
//
// Fish tables are simulated under three player profiles (what a player chooses to shoot):
//   random  - any fish, weighted by how often the room spawns it (bombs/chains catch neighbours)
//   small   - always the cheapest fish (Silver Minnow)
//   boss    - always a boss (Crimson Kraken / Abyss Whale)
// Capture chance is rtp / sum(expected multiplier), so every profile must converge on the
// room RTP. Any profile drifting away would mean the engine no longer honours the math.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { FISH, betLevels } from '../shared/fishTypes.js';
import { fishOutcome, slotOutcome } from '../shared/fair.js';
import { MACHINES, spinCost } from '../shared/slots.js';
import { RTP_LEVELS, rtpKey } from '../shared/rtp.js';
import { exactRtp } from '../server/src/game/slotEngine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOSS_IDS = [13, 14];

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const opt = { rounds: 1_000_000, sweep: false, json: false, seed: 'tidal-fortune-rtp', levels: null, db: path.join(ROOT, 'data', 'game.db'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sweep') opt.sweep = true;
    else if (a === '--json') opt.json = true;
    else if (a === '-h' || a === '--help') opt.help = true;
    else if (a === '--rounds') opt.rounds = Math.max(1_000, Number(argv[++i]) | 0);
    else if (a === '--seed') opt.seed = String(argv[++i] ?? '');
    else if (a === '--levels') opt.levels = String(argv[++i] ?? '').split(',').map((s) => Number(s) / (Number(s) > 1 ? 100 : 1)).filter((v) => RTP_LEVELS.some((l) => Math.abs(l - v) < 1e-9));
    else if (a === '--db') opt.db = path.resolve(argv[++i] ?? '');
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!opt.seed) throw new Error('--seed must not be empty');
  if (opt.levels && opt.levels.length === 0) throw new Error(`--levels must name some of ${RTP_LEVELS.join(', ')}`);
  return opt;
}

const HELP = `Tidal Fortune local RTP simulation

Usage: node tools/rtp-sim.js [options]

  --rounds N    rounds per game/level/profile (default 1000000)
  --sweep       also run every game at every certified RTP level (92/94/96)
  --levels L    comma-separated levels to sweep, e.g. 92,96 (implies --sweep)
  --db PATH     rooms database (default data/game.db; falls back to built-in rooms)
  --seed S      deterministic bytes seed (default "tidal-fortune-rtp")
  --json        print the report as JSON only
  -h, --help    show this help
`;

// ---- deterministic random bytes -------------------------------------------
// xoshiro128** refilled in bulk. Uniform bytes; statistically equivalent to the HMAC-SHA256
// stream the server derives, which is what the outcome functions consume.

function makeRng(label) {
  const h = crypto.createHash('sha256').update(label).digest();
  let s0 = h.readUInt32LE(0) || 0x9e3779b9;
  let s1 = h.readUInt32LE(4) || 0x243f6a88;
  let s2 = h.readUInt32LE(8) || 0xb7e15162;
  let s3 = h.readUInt32LE(12) || 0x85ebca6b;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const next = () => {
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t;
    s2 >>>= 0; s3 = rotl(s3, 11);
    return result;
  };
  for (let i = 0; i < 32; i++) next();
  const buf = new Uint8Array(64);
  return {
    float: () => next() / 2 ** 32,
    int: (n) => Math.floor((next() / 2 ** 32) * n),
    pick: (arr) => arr[Math.floor((next() / 2 ** 32) * arr.length)],
    bytes() {
      for (let i = 0; i < 64; i += 4) {
        const v = next();
        buf[i] = v & 0xff; buf[i + 1] = (v >>> 8) & 0xff; buf[i + 2] = (v >>> 16) & 0xff; buf[i + 3] = (v >>> 24) & 0xff;
      }
      return buf;
    },
  };
}

// ---- fish room model -------------------------------------------------------

const TARGETABLE = FISH.filter((f) => f.weight > 0);      // random players shoot anything spawned
const PLAIN = FISH.filter((f) => f.weight > 0 && !f.kind); // bomb/chain splash victims
const TARGET_SUM = TARGETABLE.reduce((s, f) => s + f.weight, 0);

function weightedType(rng) {
  let r = rng.float() * TARGET_SUM;
  for (const f of TARGETABLE) if ((r -= f.weight) <= 0) return f.id;
  return TARGETABLE[0].id;
}

/** Victim list for one capture attempt: [hit fish, ...splash victims]. */
function pickVictims(profile, rng) {
  if (profile === 'small') return [0];
  if (profile === 'boss') return [rng.int(2) ? BOSS_IDS[0] : BOSS_IDS[1]];
  const ty = weightedType(rng);
  const kind = FISH[ty].kind;
  if (kind !== 'bomb' && kind !== 'chain') return [ty];
  const cap = kind === 'chain' ? FISH[ty].chain : 6;
  const extra = rng.int(cap + 1);
  const victims = [ty];
  for (let i = 0; i < extra; i++) victims.push(PLAIN[rng.int(PLAIN.length)].id);
  return victims;
}

function simulateFish(room, level, profile, rounds, seed) {
  const levels = betLevels(room.min_bet, room.max_bet);
  const outRng = makeRng(`${seed}|fish-out|${room.id}|${rtpKey(level)}|${profile}`);
  const selRng = makeRng(`${seed}|fish-pick|${room.id}|${rtpKey(level)}|${profile}`);
  let betTotal = 0, winTotal = 0, hits = 0, sumX = 0, sumX2 = 0, maxMult = 0;
  for (let i = 0; i < rounds; i++) {
    const bet = levels[selRng.int(levels.length)];
    const victims = pickVictims(profile, selRng);
    const res = fishOutcome(outRng.bytes(), { rtp: level, victimTypes: victims });
    const win = res.captured ? bet * res.totalMult : 0;
    const x = win / bet;
    betTotal += bet;
    winTotal += win;
    sumX += x;
    sumX2 += x * x;
    if (win) hits++;
    if (x > maxMult) maxMult = x;
  }
  return stats(rounds, betTotal, winTotal, hits, sumX, sumX2, maxMult);
}

// ---- slot room model -------------------------------------------------------

function simulateSlot(room, level, rounds, seed) {
  const machine = room.variant;
  const key = rtpKey(level);
  const lines = MACHINES[machine].lines.length;
  const levels = betLevels(room.min_bet, room.max_bet);
  const rng = makeRng(`${seed}|slot|${machine}|${key}`);
  let betTotal = 0, winTotal = 0, hits = 0, sumX = 0, sumX2 = 0, maxMult = 0;
  for (let i = 0; i < rounds; i++) {
    const lineBet = levels[rng.int(levels.length)];
    const bet = spinCost(machine, lineBet);
    const res = slotOutcome(rng.bytes(), machine, key);
    const win = res.totalMult * lineBet;
    const x = win / bet;
    betTotal += bet;
    winTotal += win;
    sumX += x;
    sumX2 += x * x;
    if (win) hits++;
    if (x > maxMult) maxMult = x;
  }
  return stats(rounds, betTotal, winTotal, hits, sumX, sumX2, maxMult);
}

function stats(rounds, betTotal, winTotal, hits, sumX, sumX2, maxMult) {
  const rtp = winTotal / betTotal;
  const mean = sumX / rounds;
  const variance = rounds > 1 ? Math.max(0, (sumX2 / rounds - mean * mean) * (rounds / (rounds - 1))) : 0;
  const se = Math.sqrt(variance / rounds);
  return {
    rounds, totalBet: betTotal, totalWin: winTotal,
    rtp, ci95: 1.96 * se, se, hitRate: hits / rounds, maxWinX: maxMult,
  };
}

// ---- rooms -----------------------------------------------------------------

const FALLBACK_ROOMS = [
  { id: 'reef', game: 'fish', variant: '', name: 'Coral Reef', min_bet: 1, max_bet: 10, rtp: 0.96 },
  { id: 'lagoon', game: 'fish', variant: '', name: 'Sapphire Lagoon', min_bet: 10, max_bet: 100, rtp: 0.96 },
  { id: 'abyss', game: 'fish', variant: '', name: 'Abyss Palace', min_bet: 100, max_bet: 1000, rtp: 0.96 },
  { id: 'lucky777', game: 'slot', variant: 'classic777', name: 'Lucky 777', min_bet: 1, max_bet: 100, rtp: 0.96 },
  { id: 'ruby7', game: 'slot', variant: 'ruby7', name: 'Ruby Sevens', min_bet: 1, max_bet: 50, rtp: 0.96 },
];

function readRooms(dbFile) {
  if (!fs.existsSync(dbFile)) return { rooms: FALLBACK_ROOMS, source: 'built-in defaults (no database yet)' };
  let db;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    const rows = db.prepare('SELECT id, game, variant, name, min_bet, max_bet, rtp FROM rooms WHERE enabled = 1 ORDER BY sort, id').all();
    if (rows.length === 0) return { rooms: FALLBACK_ROOMS, source: 'built-in defaults (no enabled rooms)' };
    return { rooms: rows, source: path.relative(ROOT, dbFile) };
  } catch (e) {
    return { rooms: FALLBACK_ROOMS, source: `built-in defaults (database unreadable: ${e.message})` };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// ---- simulation plan -------------------------------------------------------

const PROFILES = ['random', 'small', 'boss'];

function plan(rooms, opt) {
  const jobs = [];
  for (const room of rooms) {
    const levels = opt.sweep ? (opt.levels ?? RTP_LEVELS) : [room.rtp];
    for (const level of levels) {
      if (room.game === 'fish') {
        for (const profile of PROFILES) jobs.push({ room, level, profile, game: 'fish' });
      } else if (room.game === 'slot') {
        if (!MACHINES[room.variant]) throw new Error(`room ${room.id} has unknown slot machine "${room.variant}"`);
        jobs.push({ room, level, profile: null, game: 'slot' });
      }
    }
  }
  return jobs;
}

function theoryFor(job) {
  return job.game === 'fish' ? job.level : exactRtp(job.room.variant, rtpKey(job.level));
}

function run(opt) {
  const { rooms, source } = readRooms(opt.db);
  const jobs = plan(rooms, opt);
  const results = jobs.map((job) => {
    const sim = job.game === 'fish'
      ? simulateFish(job.room, job.level, job.profile, opt.rounds, opt.seed)
      : simulateSlot(job.room, job.level, opt.rounds, opt.seed);
    const theory = theoryFor(job);
    const z = sim.se > 0 ? (sim.rtp - theory) / sim.se : 0;
    return {
      room: job.room.id, game: job.game, machine: job.room.variant || null,
      name: job.room.name, level: job.level, profile: job.profile,
      ...sim, theory, z,
    };
  });
  return { seed: opt.seed, rounds: opt.rounds, sweep: opt.sweep, dbSource: source, rooms, results };
}

// ---- reporting -------------------------------------------------------------

const pct = (v, d = 3) => `${(v * 100).toFixed(d)}%`;
const int = (v) => v.toLocaleString('en-US');
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);

// A 4-sigma band keeps false alarms rare across the many rows; the CI column shows the noise.
const PASS_Z = 4;

function printReport(report) {
  const { results, rounds, seed, dbSource, sweep } = report;
  console.log('');
  console.log('  Tidal Fortune — player RTP simulation');
  console.log(`  rooms: ${dbSource} · seed: ${seed} · ${int(rounds)} rounds per game/level/profile${sweep ? ' · sweep of all certified levels' : ''}`);
  console.log('');

  const head = `  ${pad('Game', 26)} ${pad('Type', 5)} ${pad('RTP', 4)} ${pad('Player', 7)} ${padl('Rounds', 11)} ${padl('Total bet', 15)} ${padl('Total win', 15)} ${padl('Sim RTP', 9)} ${padl('±95%', 7)} ${padl('Theory', 8)} ${padl('Hit %', 7)} ${padl('Max x', 8)}  Verdict`;
  console.log(head);
  console.log(`  ${'-'.repeat(head.length - 2)}`);

  let lastGroup = '';
  let failures = 0;
  for (const r of results) {
    const group = `${r.name}|${r.level}`;
    if (lastGroup && group !== lastGroup && r.game === 'fish') console.log('');
    lastGroup = group;
    const level = rtpKey(r.level);
    const ok = Math.abs(r.z) <= PASS_Z;
    if (!ok) failures++;
    const game = `${r.name}`.slice(0, 26);
    const type = r.game === 'fish' ? 'fish' : 'slot';
    const profile = r.profile ?? '—';
    console.log(
      `  ${pad(game, 26)} ${pad(type, 5)} ${pad(level, 4)} ${pad(profile, 7)} ${padl(int(r.rounds), 11)} ${padl(int(r.totalBet), 15)} ${padl(int(r.totalWin), 15)} ${padl(pct(r.rtp), 9)} ${padl(`±${pct(r.ci95, 2)}`, 7)} ${padl(pct(r.theory), 8)} ${padl(pct(r.hitRate, 2), 7)} ${padl(`${r.maxWinX.toFixed(0)}x`, 8)}  ${ok ? 'PASS' : 'WARN'}`
    );
  }

  console.log('');
  if (failures) {
    console.log(`  ${failures} of ${results.length} rows are more than ${PASS_Z}σ from theory. Increase --rounds if a row is simply noisy.`);
  } else {
    console.log(`  All ${results.length} rows within ${PASS_Z}σ of theory.`);
  }
  console.log('  Fish theory = the room RTP (capture chance is rtp / Σ expected multipliers).');
  console.log('  Slot theory = exact RTP enumerated from the reel strips (slotEngine.exactRtp).');
  console.log('  Fish profiles are different player aims; each must converge on the same RTP.');
  console.log('');
}

// ---- main ------------------------------------------------------------------

function main() {
  const opt = parseArgs(process.argv.slice(2));
  if (opt.help) { process.stdout.write(HELP); return; }
  if (opt.levels) opt.sweep = true;
  const report = run(opt);
  if (opt.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printReport(report);
  }
  const failed = report.results.some((r) => Math.abs(r.z) > PASS_Z);
  if (failed) process.exitCode = 2;
}

main();
