import crypto from 'node:crypto';
import { Router } from 'express';
import { db } from '../db.js';
import { bus } from '../bus.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, burnPasswordCheck, createSession, destroySession, bearer, getSession,
  checkThrottle, recordFailure, clearFailures, newApiKey, destroySubjectSessions } from '../auth.js';
import { adminAdjustAgent, validateAmount } from '../wallet.js';
import { bad, conflict, notFound, unauthorized } from '../errors.js';
import { vUsername, vPassword, vText, vId, page, range, sPlayer, sAgent, sTx, sGameSession, sRoom, where, listQuery, summary } from './common.js';
import { presence } from '../presence.js';
import { listRounds, getRound, verifyRoundServer, serializeRound, checkChain } from '../rounds.js';
import { integrityReport } from '../integrity.js';
import { RTP_LEVELS, isRtpLevel } from '../../../shared/rtp.js';

export const adminRouter = Router();

adminRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `admin:${req.ip}:${String(username).toLowerCase()}`;
  checkThrottle(key);
  const a = typeof username === 'string' ? db.prepare('SELECT * FROM admins WHERE username = ?').get(username) : null;
  const ok = a ? verifyPassword(String(password || ''), a.pass_hash) : (burnPasswordCheck(String(password || '')), false);
  if (!ok) { recordFailure(key); throw unauthorized('Invalid username or password'); }
  clearFailures(key);
  const s = createSession('admin', a.id, req.ip);
  res.json({ token: s.token, expiresAt: new Date(s.expiresAt).toISOString(), admin: { id: a.id, username: a.username } });
});

adminRouter.use((req, _res, next) => {
  const key = req.headers['x-admin-key'];
  if (config.adminApiKey && typeof key === 'string' && key.length === config.adminApiKey.length &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(config.adminApiKey))) {
    req.adminId = null;
    return next();
  }
  const s = getSession(bearer(req), 'admin');
  if (!s) return next(unauthorized());
  req.adminId = s.subject_id;
  next();
});

adminRouter.post('/logout', (req, res) => { destroySession(bearer(req)); res.json({ ok: true }); });

adminRouter.post('/me/password', (req, res) => {
  if (!req.adminId) throw bad('NO_ADMIN_SESSION', 'Use a login session to change password');
  const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.adminId);
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(String(currentPassword || ''), a.pass_hash)) throw unauthorized('Current password is wrong');
  db.prepare('UPDATE admins SET pass_hash = ? WHERE id = ?').run(hashPassword(vPassword(newPassword)), a.id);
  res.json({ ok: true });
});

// ---- Agents ----
const agentById = (id) => {
  const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(vId(id));
  if (!a) throw notFound('Agent');
  return a;
};

adminRouter.post('/agents', (req, res) => {
  const b = req.body || {};
  const username = vUsername(b.username);
  const password = vPassword(b.password);
  const displayName = vText(b.displayName, 'displayName', 40) || username;
  if (db.prepare('SELECT 1 FROM agents WHERE username = ?').get(username)) throw conflict('USERNAME_TAKEN', 'Username already exists');
  const k = newApiKey();
  const a = db.prepare(`INSERT INTO agents (username, pass_hash, display_name, api_key_hash, api_key_prefix, created_at)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING *`).get(username, hashPassword(password), displayName, k.hash, k.prefix, Date.now());
  let tx = null;
  if (b.initialCredits) tx = adminAdjustAgent({ agentId: a.id, amount: b.initialCredits, direction: 'credit', note: 'initial credits', adminId: req.adminId });
  // The API key is only ever shown here and on rotation.
  res.status(201).json({ agent: sAgent(agentById(a.id)), apiKey: k.key, transaction: sTx(tx) });
});

adminRouter.get('/agents', (req, res) => {
  const w = where([['status = ?', req.query.status], ['username LIKE ?', req.query.search ? `%${req.query.search}%` : null]]);
  const { total, rows } = listQuery('agents', w, 'id DESC', page(req.query));
  res.json({ total, items: rows.map(sAgent) });
});

adminRouter.get('/agents/:id', (req, res) => res.json(sAgent(agentById(req.params.id))));

adminRouter.patch('/agents/:id', (req, res) => {
  const a = agentById(req.params.id);
  const b = req.body || {};
  if (b.displayName !== undefined) db.prepare('UPDATE agents SET display_name = ? WHERE id = ?').run(vText(b.displayName, 'displayName', 40), a.id);
  if (b.password !== undefined) {
    db.prepare('UPDATE agents SET pass_hash = ? WHERE id = ?').run(hashPassword(vPassword(b.password)), a.id);
    destroySubjectSessions('agent', a.id);
  }
  if (b.status !== undefined) {
    if (!['active', 'suspended'].includes(b.status)) throw bad('INVALID_STATUS', 'status must be active or suspended');
    db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(b.status, a.id);
    if (b.status === 'suspended') destroySubjectSessions('agent', a.id);
  }
  res.json(sAgent(agentById(a.id)));
});

adminRouter.post('/agents/:id/api-key', (req, res) => {
  const a = agentById(req.params.id);
  const k = newApiKey();
  db.prepare('UPDATE agents SET api_key_hash = ?, api_key_prefix = ? WHERE id = ?').run(k.hash, k.prefix, a.id);
  res.json({ apiKey: k.key, apiKeyPrefix: k.prefix });
});

adminRouter.post('/agents/:id/credit', (req, res) => {
  const a = agentById(req.params.id);
  const b = req.body || {};
  res.json(sTx(adminAdjustAgent({ agentId: a.id, amount: b.amount, direction: 'credit', reference: b.reference, note: b.note, adminId: req.adminId })));
});

adminRouter.post('/agents/:id/debit', (req, res) => {
  const a = agentById(req.params.id);
  const b = req.body || {};
  res.json(sTx(adminAdjustAgent({ agentId: a.id, amount: b.amount, direction: 'debit', reference: b.reference, note: b.note, adminId: req.adminId })));
});

// ---- Players (all agents) ----
const playerById = (id) => {
  const p = db.prepare('SELECT * FROM players WHERE id = ?').get(vId(id));
  if (!p) throw notFound('Player');
  return p;
};

adminRouter.get('/players', (req, res) => {
  const q = req.query;
  const w = where([['agent_id = ?', q.agentId ? vId(q.agentId) : null], ['status = ?', q.status],
    ['username LIKE ?', q.search ? `%${q.search}%` : null]]);
  const { total, rows } = listQuery('players', w, 'id DESC', page(q));
  let items = rows.map(sPlayer);
  if (q.online === 'true') items = items.filter((p) => p.online);
  res.json({ total, items });
});

adminRouter.get('/players/online', (_req, res) => {
  const ids = [...presence.keys()];
  const rows = ids.length ? db.prepare(`SELECT * FROM players WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  res.json({ total: rows.length, items: rows.map(sPlayer) });
});

adminRouter.get('/players/:id', (req, res) => res.json(sPlayer(playerById(req.params.id))));

adminRouter.patch('/players/:id', (req, res) => {
  const p = playerById(req.params.id);
  const b = req.body || {};
  if (b.status !== undefined) {
    if (!['active', 'frozen'].includes(b.status)) throw bad('INVALID_STATUS', 'status must be active or frozen');
    db.prepare('UPDATE players SET status = ? WHERE id = ?').run(b.status, p.id);
    if (b.status === 'frozen') { destroySubjectSessions('player', p.id); bus.emit('kick', p.id, 'account_frozen'); }
  }
  if (b.password !== undefined) {
    db.prepare('UPDATE players SET pass_hash = ? WHERE id = ?').run(hashPassword(vPassword(b.password)), p.id);
    destroySubjectSessions('player', p.id);
    bus.emit('kick', p.id, 'password_changed');
  }
  res.json(sPlayer(playerById(p.id)));
});

adminRouter.post('/players/:id/kick', (req, res) => {
  const p = playerById(req.params.id);
  destroySubjectSessions('player', p.id);
  bus.emit('kick', p.id, 'kicked_by_admin');
  res.json({ ok: true });
});

adminRouter.get('/players/:id/game-sessions', (req, res) => {
  const p = playerById(req.params.id);
  const { from, to } = range(req.query);
  const w = where([['player_id = ?', p.id], ['started_at >= ?', from], ['started_at < ?', to]]);
  const { total, rows } = listQuery('game_sessions', w, 'id DESC', page(req.query));
  res.json({ total, items: rows.map(sGameSession) });
});

// ---- Ledger & reports ----
adminRouter.get('/transactions', (req, res) => {
  const q = req.query;
  const { from, to } = range(q);
  const w = where([['agent_id = ?', q.agentId ? vId(q.agentId) : null], ['player_id = ?', q.playerId ? vId(q.playerId) : null],
    ['type = ?', q.type], ['ts >= ?', from], ['ts < ?', to]]);
  const { total, rows } = listQuery('transactions', w, 'id DESC', page(q));
  res.json({ total, items: rows.map(sTx) });
});

adminRouter.get('/game-sessions', (req, res) => {
  const q = req.query;
  const { from, to } = range(q);
  const w = where([['agent_id = ?', q.agentId ? vId(q.agentId) : null], ['player_id = ?', q.playerId ? vId(q.playerId) : null],
    ['room_id = ?', q.roomId], ['started_at >= ?', from], ['started_at < ?', to]]);
  const { total, rows } = listQuery('game_sessions', w, 'id DESC', page(q));
  res.json({ total, items: rows.map(sGameSession) });
});

adminRouter.get('/reports/summary', (req, res) => {
  const { from, to } = range(req.query);
  const total = summary({ from, to });
  const byAgent = db.prepare(`SELECT a.id, a.username, a.balance,
      COALESCE(SUM(g.total_bet),0) AS bet, COALESCE(SUM(g.total_win),0) AS win
    FROM agents a LEFT JOIN game_sessions g ON g.agent_id = a.id AND g.started_at >= ? AND g.started_at < ?
    GROUP BY a.id ORDER BY a.id`).all(from, to)
    .map((r) => ({ agentId: r.id, username: r.username, agentBalance: r.balance, totalBet: r.bet, totalWin: r.win, houseNet: r.bet - r.win }));
  const byRoom = db.prepare(`SELECT room_id, COALESCE(SUM(total_bet),0) AS bet, COALESCE(SUM(total_win),0) AS win, COUNT(*) AS n
    FROM game_sessions WHERE started_at >= ? AND started_at < ? GROUP BY room_id`).all(from, to)
    .map((r) => ({ roomId: r.room_id, totalBet: r.bet, totalWin: r.win, houseNet: r.bet - r.win,
      actualRtp: r.bet ? +(r.win / r.bet).toFixed(4) : null, sessions: r.n }));
  const liabilities = db.prepare('SELECT COALESCE(SUM(balance),0) AS players FROM players').get().players;
  const agentFloat = db.prepare('SELECT COALESCE(SUM(balance),0) AS a FROM agents').get().a;
  res.json({ ...total, playerBalances: liabilities, agentBalances: agentFloat, onlinePlayers: presence.size, byAgent, byRoom });
});

// ---- Game configuration ----
adminRouter.get('/rooms', (_req, res) => {
  res.json({ items: db.prepare('SELECT * FROM rooms ORDER BY sort').all().map(sRoom) });
});

adminRouter.patch('/rooms/:id', (req, res) => {
  const r = db.prepare('SELECT * FROM rooms WHERE id = ?').get(String(req.params.id));
  if (!r) throw notFound('Room');
  const b = req.body || {};
  const next = { ...r };
  if (b.name !== undefined) next.name = vText(b.name, 'name', 30) || r.name;
  if (b.rtp !== undefined) {
    const v = Number(b.rtp);
    if (!isRtpLevel(v)) throw bad('INVALID_RTP', `rtp must be one of ${RTP_LEVELS.join(', ')}`);
    next.rtp = RTP_LEVELS.find((l) => Math.abs(l - v) < 1e-9);
  }
  if (b.minBet !== undefined) next.min_bet = validateAmount(b.minBet);
  if (b.maxBet !== undefined) next.max_bet = validateAmount(b.maxBet);
  if (next.min_bet > next.max_bet) throw bad('INVALID_BETS', 'minBet must be <= maxBet');
  if (b.enabled !== undefined) next.enabled = b.enabled ? 1 : 0;
  if (b.sort !== undefined) next.sort = Number(b.sort) | 0;
  db.prepare('UPDATE rooms SET name=?, rtp=?, min_bet=?, max_bet=?, enabled=?, sort=? WHERE id=?')
    .run(next.name, next.rtp, next.min_bet, next.max_bet, next.enabled, next.sort, r.id);
  bus.emit('rooms');
  res.json(sRoom(db.prepare('SELECT * FROM rooms WHERE id = ?').get(r.id)));
});

// ---- Game rounds, fairness & integrity ----
adminRouter.get('/rounds', (req, res) => {
  const q = req.query;
  res.json(listRounds({ agentId: q.agentId ? vId(q.agentId) : undefined, playerId: q.playerId ? vId(q.playerId) : undefined,
    roomId: q.roomId, ...range(q), ...page(q) }));
});

adminRouter.get('/rounds/chain-check', (req, res) => {
  res.json(checkChain({ fromId: Number(req.query.fromId) || 1, limit: Math.min(Number(req.query.limit) || 100_000, 1_000_000) }));
});

const roundById = (id) => {
  const r = getRound(vId(id));
  if (!r) throw notFound('Round');
  return r;
};
adminRouter.get('/rounds/:id', (req, res) => res.json(serializeRound(roundById(req.params.id))));
adminRouter.get('/rounds/:id/verify', (req, res) => res.json(verifyRoundServer(roundById(req.params.id))));

/** Build hash, file hashes, RNG self-test results and the exact math of every game at every RTP level. */
adminRouter.get('/integrity', (_req, res) => res.json(integrityReport()));
