import crypto from 'node:crypto';
import { db, tx, iso } from '../db.js';
import { BLOCKS, hmacMessage, CLIENT_SEED_RE } from '../../../shared/fair.js';
import { newServerSeed } from './health.js';
import { bad } from '../errors.js';

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomClientSeed = () => crypto.randomBytes(8).toString('hex');

/** The 128 bytes that decide one round. */
export function roundBytes(serverSeed, clientSeed, nonce) {
  const parts = [];
  for (let c = 0; c < BLOCKS; c++) parts.push(crypto.createHmac('sha256', serverSeed).update(hmacMessage(clientSeed, nonce, c)).digest());
  return Buffer.concat(parts);
}

const getActive = db.prepare("SELECT * FROM fair_seeds WHERE player_id = ? AND status = 'active'");
const getNext = db.prepare("SELECT * FROM fair_seeds WHERE player_id = ? AND status = 'next'");
const insSeed = db.prepare(`INSERT INTO fair_seeds (player_id, status, server_seed, server_seed_hash, client_seed, created_at, activated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const bumpNonce = db.prepare('UPDATE fair_seeds SET nonce = nonce + 1 WHERE id = ? RETURNING nonce');

function createSeed(playerId, status, clientSeed = null) {
  const s = newServerSeed();
  const now = Date.now();
  insSeed.run(playerId, status, s, sha256(s), clientSeed, now, status === 'active' ? now : null);
}

/** Make sure the player has an active pair and a committed next seed. */
export function ensureSeeds(playerId) {
  if (getActive.get(playerId) && getNext.get(playerId)) return;
  tx(() => {
    if (!getActive.get(playerId)) createSeed(playerId, 'active', randomClientSeed());
    if (!getNext.get(playerId)) createSeed(playerId, 'next');
  });
}

/**
 * Reserve the next nonce of the player's active seed. Must run inside the same transaction that
 * records the round, so a rolled-back round never consumes a nonce.
 */
export function takeRound(playerId) {
  let s = getActive.get(playerId);
  if (!s) {
    createSeed(playerId, 'active', randomClientSeed());
    if (!getNext.get(playerId)) createSeed(playerId, 'next');
    s = getActive.get(playerId);
  }
  const nonce = bumpNonce.get(s.id).nonce - 1;
  return { seedId: s.id, serverSeed: s.server_seed, serverSeedHash: s.server_seed_hash, clientSeed: s.client_seed, nonce };
}

export function publicState(playerId) {
  ensureSeeds(playerId);
  const a = getActive.get(playerId), n = getNext.get(playerId);
  return { serverSeedHash: a.server_seed_hash, clientSeed: a.client_seed, nonce: a.nonce, nextServerSeedHash: n.server_seed_hash, activeSince: iso(a.activated_at) };
}

/** Reveal the active server seed, promote the pre-committed next seed, commit a new next seed. */
export function rotate(playerId, clientSeed) {
  if (clientSeed == null || clientSeed === '') clientSeed = randomClientSeed();
  if (typeof clientSeed !== 'string' || !CLIENT_SEED_RE.test(clientSeed)) {
    throw bad('INVALID_CLIENT_SEED', 'client seed must be 1-64 characters: letters, digits, _ or -');
  }
  ensureSeeds(playerId);
  const revealed = tx(() => {
    const a = getActive.get(playerId), n = getNext.get(playerId);
    const now = Date.now();
    db.prepare("UPDATE fair_seeds SET status = 'revealed', revealed_at = ? WHERE id = ?").run(now, a.id);
    db.prepare("UPDATE fair_seeds SET status = 'active', client_seed = ?, activated_at = ? WHERE id = ?").run(clientSeed, now, n.id);
    createSeed(playerId, 'next');
    return { serverSeed: a.server_seed, serverSeedHash: a.server_seed_hash, clientSeed: a.client_seed, roundsPlayed: a.nonce, revealedAt: iso(now) };
  });
  return { revealed, current: publicState(playerId) };
}

export function revealedSeeds(playerId, limit = 20) {
  return db.prepare("SELECT * FROM fair_seeds WHERE player_id = ? AND status = 'revealed' ORDER BY id DESC LIMIT ?").all(playerId, limit)
    .map((s) => ({ serverSeed: s.server_seed, serverSeedHash: s.server_seed_hash, clientSeed: s.client_seed, roundsPlayed: s.nonce, activatedAt: iso(s.activated_at), revealedAt: iso(s.revealed_at) }));
}
