import { Router } from 'express';
import { db } from '../db.js';
import { bus } from '../bus.js';
import { verifyPassword, burnPasswordCheck, createSession, destroySession, bearer, checkThrottle, recordFailure, clearFailures, requireSession,
  hashPassword, destroySubjectSessions } from '../auth.js';
import { forbidden, unauthorized, notFound, bad } from '../errors.js';
import { publicState, rotate, revealedSeeds } from '../fair/seeds.js';
import { listRounds, getRound, serializeRound } from '../rounds.js';
import { vId, vPassword } from './common.js';

// Player-facing HTTP. There is intentionally no registration and no cashier here:
// accounts and credits are managed exclusively through the agent API.
export const gameRouter = Router();

gameRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `player:${req.ip}:${String(username).toLowerCase()}`;
  checkThrottle(key);
  const p = typeof username === 'string' ? db.prepare('SELECT * FROM players WHERE username = ?').get(username.trim()) : null;
  const ok = p ? verifyPassword(String(password || ''), p.pass_hash) : (burnPasswordCheck(String(password || '')), false);
  if (!ok) { recordFailure(key); throw unauthorized('Wrong account or password'); }
  if (p.status !== 'active') throw forbidden('This account is frozen. Please contact your agent.');
  const agent = db.prepare('SELECT status FROM agents WHERE id = ?').get(p.agent_id);
  if (agent?.status !== 'active') throw forbidden('This account is unavailable. Please contact your agent.');
  clearFailures(key);
  // One active session per player: logging in elsewhere drops the old one.
  bus.emit('kick', p.id, 'logged_in_elsewhere');
  const s = createSession('player', p.id, req.ip, { single: true });
  db.prepare('UPDATE players SET last_login_at = ?, last_login_ip = ? WHERE id = ?').run(Date.now(), req.ip, p.id);
  res.json({ token: s.token, expiresAt: new Date(s.expiresAt).toISOString() });
});

gameRouter.post('/logout', (req, res) => {
  destroySession(bearer(req));
  res.json({ ok: true });
});

// ---- Provably fair (player's own data only) ----
const player = requireSession('player');

gameRouter.get('/fair', player, (req, res) => {
  res.json({ current: publicState(req.session.subject_id), revealed: revealedSeeds(req.session.subject_id, 10) });
});

/** Reveal the current server seed and start a new pair with the given (or a random) client seed. */
gameRouter.post('/fair/rotate', player, (req, res) => {
  res.json(rotate(req.session.subject_id, req.body?.clientSeed));
});

gameRouter.get('/rounds', player, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const beforeId = req.query.beforeId ? vId(req.query.beforeId) : undefined;
  res.json(listRounds({ playerId: req.session.subject_id, limit, beforeId }));
});

gameRouter.get('/rounds/:id', player, (req, res) => {
  const r = getRound(vId(req.params.id));
  if (!r || r.player_id !== req.session.subject_id) throw notFound('Round');
  res.json(serializeRound(r));
});

// ---- Player profile: nickname and password (the only account details a player can change) ----
const NICK_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;

gameRouter.get('/me', player, (req, res) => {
  const p = db.prepare('SELECT id, username, nickname FROM players WHERE id = ?').get(req.session.subject_id);
  res.json({ id: p.id, username: p.username, nickname: p.nickname || p.username });
});

gameRouter.patch('/me', player, (req, res) => {
  const nick = typeof req.body?.nickname === 'string' ? req.body.nickname.trim().replace(/\s+/g, ' ') : '';
  if (!NICK_RE.test(nick)) throw bad('INVALID_NICKNAME', 'Name must be 2-16 letters, numbers, spaces, _ . or -');
  db.prepare('UPDATE players SET nickname = ? WHERE id = ?').run(nick, req.session.subject_id);
  bus.emit('nickname', req.session.subject_id, nick);
  res.json({ nickname: nick });
});

/** Change password. Other sessions are logged out; this device gets a fresh token. */
gameRouter.post('/me/password', player, (req, res) => {
  const id = req.session.subject_id;
  const key = `pwchange:${id}`;
  checkThrottle(key);
  const { currentPassword, newPassword } = req.body || {};
  const p = db.prepare('SELECT pass_hash FROM players WHERE id = ?').get(id);
  if (!verifyPassword(String(currentPassword || ''), p.pass_hash)) { recordFailure(key); throw unauthorized('Current password is wrong'); }
  const pw = vPassword(newPassword);
  if (pw === currentPassword) throw bad('SAME_PASSWORD', 'New password must be different');
  clearFailures(key);
  db.prepare('UPDATE players SET pass_hash = ? WHERE id = ?').run(hashPassword(pw), id);
  destroySubjectSessions('player', id);
  const s = createSession('player', id, req.ip);
  res.json({ ok: true, token: s.token, expiresAt: new Date(s.expiresAt).toISOString() });
});
