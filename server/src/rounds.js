import crypto from 'node:crypto';
import { db, iso, tx } from './db.js';
import { roundBytes } from './fair/seeds.js';
import { recomputeRound } from '../../shared/fair.js';

// Append-only round log with a hash chain: chain_hash = SHA256(prev_chain_hash | canonical row).
// Editing or deleting any row (even bypassing the triggers) breaks every hash after it.

const GENESIS = '0'.repeat(64);
let lastHash = db.prepare('SELECT chain_hash FROM game_rounds ORDER BY id DESC LIMIT 1').get()?.chain_hash || GENESIS;

const ins = db.prepare(`INSERT INTO game_rounds
  (id, ts, player_id, agent_id, room_id, game, status, bet, win, balance_after, seed_id, nonce, detail, chain_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const nextId = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS id FROM game_rounds');

function canonical(r) {
  return [r.id, r.ts, r.player_id, r.agent_id, r.room_id, r.game, r.status, r.bet, r.win, r.balance_after,
    r.seed_id ?? '', r.nonce ?? '', r.detail].join('|');
}
const chain = (prev, r) => crypto.createHash('sha256').update(`${prev}|${canonical(r)}`).digest('hex');

/** Record a round. Call inside the transaction that moves the money. Returns the round id. */
export function recordRound({ playerId, agentId, roomId, game, status = 'settled', bet, win, balanceAfter, seedId = null, nonce = null, detail }) {
  const r = {
    id: nextId.get().id, ts: Date.now(), player_id: playerId, agent_id: agentId, room_id: roomId, game, status,
    bet, win, balance_after: balanceAfter, seed_id: seedId, nonce, detail: JSON.stringify(detail),
  };
  const h = chain(lastHash, r);
  ins.run(r.id, r.ts, r.player_id, r.agent_id, r.room_id, r.game, r.status, r.bet, r.win, r.balance_after, r.seed_id, r.nonce, r.detail, h);
  lastHash = h; // only reached if the insert succeeded; a later rollback is handled by resyncChain()
  return r.id;
}

/** Re-read the chain head (after a rolled-back transaction). */
export function resyncChain() {
  lastHash = db.prepare('SELECT chain_hash FROM game_rounds ORDER BY id DESC LIMIT 1').get()?.chain_hash || GENESIS;
}

const withSeed = `SELECT r.*, s.server_seed_hash, s.client_seed, s.status AS seed_status,
  CASE WHEN s.status = 'revealed' THEN s.server_seed END AS revealed_server_seed
  FROM game_rounds r LEFT JOIN fair_seeds s ON s.id = r.seed_id`;

export function serializeRound(r) {
  return r && {
    id: r.id, ts: iso(r.ts), playerId: r.player_id, agentId: r.agent_id, roomId: r.room_id, game: r.game, status: r.status,
    bet: r.bet, win: r.win, balanceAfter: r.balance_after, detail: JSON.parse(r.detail),
    fairness: r.seed_id == null ? null : {
      serverSeedHash: r.server_seed_hash, clientSeed: r.client_seed, nonce: r.nonce,
      serverSeed: r.revealed_server_seed ?? null, // null until the player rotates this seed
    },
    chainHash: r.chain_hash,
  };
}

export function getRound(id) {
  return db.prepare(`${withSeed} WHERE r.id = ?`).get(id);
}

export function listRounds({ playerId, agentId, roomId, from = 0, to = Date.now() + 1, limit = 50, offset = 0, beforeId }) {
  const parts = ['r.ts >= ?', 'r.ts < ?'], args = [from, to];
  if (playerId) { parts.push('r.player_id = ?'); args.push(playerId); }
  if (agentId) { parts.push('r.agent_id = ?'); args.push(agentId); }
  if (roomId) { parts.push('r.room_id = ?'); args.push(roomId); }
  if (beforeId) { parts.push('r.id < ?'); args.push(beforeId); }
  const where = `WHERE ${parts.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM game_rounds r ${where}`).get(...args).n;
  const rows = db.prepare(`${withSeed} ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
  return { total, items: rows.map(serializeRound) };
}

/** Server-side replay: recompute the outcome from the (possibly still secret) seed. */
export function verifyRoundServer(row) {
  const s = serializeRound(row);
  if (s.status !== 'settled' || row.seed_id == null) return { verified: s.status === 'rejected', note: 'rejected hit: bet lost before any roll', round: s };
  const seed = db.prepare('SELECT server_seed FROM fair_seeds WHERE id = ?').get(row.seed_id);
  const res = recomputeRound(s, (n) => roundBytes(seed.server_seed, row.client_seed, n));
  return { verified: res.ok, problems: res.problems, round: s };
}

/** Walk the chain (from the first row still in the database, or a given id) and report the first broken link. */
export function checkChain({ fromId = 1, limit = 100_000 } = {}) {
  const first = db.prepare('SELECT MIN(id) AS id FROM game_rounds').get().id;
  if (first == null) return { ok: true, checked: 0, lastId: null };
  const start = Math.max(fromId, first);
  // previous link: the row before `start`, or the saved hash of the last deleted row
  let prev = db.prepare('SELECT chain_hash FROM game_rounds WHERE id < ? ORDER BY id DESC LIMIT 1').get(start)?.chain_hash
    ?? db.prepare('SELECT chain_hash FROM round_prune WHERE up_to_id < ? ORDER BY up_to_id DESC LIMIT 1').get(start)?.chain_hash
    ?? GENESIS;
  let checked = 0, lastId = null;
  for (const r of db.prepare('SELECT * FROM game_rounds WHERE id >= ? ORDER BY id LIMIT ?').iterate(start, limit)) {
    if (chain(prev, r) !== r.chain_hash) return { ok: false, brokenAtId: r.id, checked };
    prev = r.chain_hash;
    checked++;
    lastId = r.id;
  }
  return { ok: true, checked, fromId: start, lastId, head: prev };
}

/** Transaction wrapper for anything that records rounds: keeps the in-memory chain head correct on rollback. */
export function roundTx(fn) {
  try {
    return tx(fn);
  } catch (e) {
    resyncChain();
    throw e;
  }
}

// ---- Retention: delete rounds older than N days ---------------------------------------------
const PRUNE_CHUNK = 2000;

/**
 * Delete one chunk of rounds older than `days`. Returns the number deleted (0 = nothing left).
 * The newest row is never deleted (it is the live chain head). The hash of the last deleted row is
 * saved in round_prune so checkChain() still works on what's left.
 */
export function pruneChunk(days) {
  const cutoff = Date.now() - days * 86_400_000;
  const head = db.prepare('SELECT MAX(id) AS id FROM game_rounds').get().id;
  if (head == null) return 0;
  const ids = db.prepare('SELECT id, chain_hash FROM game_rounds WHERE ts < ? AND id < ? ORDER BY id LIMIT ?').all(cutoff, head, PRUNE_CHUNK);
  if (!ids.length) return 0;
  const lo = ids[0].id, last = ids[ids.length - 1];
  tx(() => {
    db.exec('DROP TRIGGER IF EXISTS game_rounds_no_delete');
    db.prepare('DELETE FROM game_rounds WHERE id BETWEEN ? AND ?').run(lo, last.id);
    db.exec(`CREATE TRIGGER game_rounds_no_delete BEFORE DELETE ON game_rounds
      BEGIN SELECT RAISE(ABORT, 'game_rounds is append-only'); END`);
    db.prepare('INSERT INTO round_prune (pruned_at, from_id, up_to_id, rows, chain_hash) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), lo, last.id, ids.length, last.chain_hash);
    db.prepare('UPDATE players SET pending_round_id = NULL WHERE pending_round_id <= ?').run(last.id);
  });
  return ids.length;
}

/** Delete everything older than `days`, a chunk at a time, yielding between chunks so the game keeps running. */
export async function pruneRounds(days) {
  let total = 0, n;
  while ((n = pruneChunk(days)) > 0) {
    total += n;
    await new Promise((r) => setImmediate(r));
  }
  if (total) db.exec('PRAGMA incremental_vacuum'); // no-op unless auto_vacuum is enabled
  return total;
}
