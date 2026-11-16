import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { mathReport, simulate } from './game/slotEngine.js';
import { selfTest, healthReport } from './fair/health.js';
import { RTP_LEVELS } from '../../shared/rtp.js';
import { FAIR_VERSION } from '../../shared/fair.js';

// Start-up integrity: RNG self-test, game math check, and a hash of every file that can
// influence outcomes or what players see (so the running build can be matched to a certified one).

const ROOTS = ['shared', 'server/src', 'client'];
const files = {};

function walk(dir) {
  for (const e of fs.readdirSync(path.join(config.root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel);
    else if (/\.(js|html|css|webmanifest)$/.test(e.name)) {
      files[rel] = crypto.createHash('sha256').update(fs.readFileSync(path.join(config.root, rel))).digest('hex');
    }
  }
}

let report = null;

export function runStartupChecks() {
  for (const r of ROOTS) walk(r);
  const sorted = Object.keys(files).sort();
  const buildHash = crypto.createHash('sha256').update(sorted.map((f) => `${f}:${files[f]}`).join('\n')).digest('hex');

  const rng = selfTest();
  const math = mathReport();
  const problems = [];
  for (const [id, levels] of Object.entries(math)) {
    for (const [key, m] of Object.entries(levels)) {
      if (Math.abs(m.exact - m.nominal) > 0.001) problems.push(`${id}@${key}: exact RTP ${m.exact} is not within 0.1% of ${m.nominal}`);
      Object.assign(m, simulate(id, key));
    }
  }
  if (!rng.ok) problems.push(`RNG self-test failed: ${rng.failure?.reason}`);

  report = {
    buildHash, fairVersion: FAIR_VERSION, checkedAt: new Date().toISOString(),
    rtpLevels: RTP_LEVELS,
    fish: { model: 'capture chance = rtp / multiplier (bomb/chain: / sum of multipliers); boss multiplier uniform in range, step 5' },
    slots: math,
    files: Object.fromEntries(sorted.map((f) => [f, files[f]])),
    problems,
  };
  console.log(`[integrity] build ${buildHash.slice(0, 16)}… · ${sorted.length} files · RNG ${rng.ok ? 'OK' : 'FAILED'}`);
  for (const [id, levels] of Object.entries(math)) {
    console.log(`[integrity] ${id}: ` + Object.entries(levels).map(([k, m]) => `${k}%→${(m.exact * 100).toFixed(3)}% (hit ${(m.hitFrequency * 100).toFixed(1)}%)`).join('  '));
  }
  return report;
}

export const integrityReport = () => ({ ...report, rng: healthReport() });
