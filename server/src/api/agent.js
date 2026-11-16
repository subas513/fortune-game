import { Router } from 'express';
import { db } from '../db.js';
import { bus } from '../bus.js';
import { sha256, hashPassword, verifyPassword, burnPasswordCheck, createSession, destroySession, bearer,
  getSession, checkThrottle, recordFailure, clearFailures, destroySubjectSessions } from '../auth.js';
import { deposit, withdraw } from '../wallet.js';
import { bad, conflict, forbidden, notFound, unauthorized } from '../errors.js';
import { listRounds, getRound, verifyRoundServer, serializeRound } from '../rounds.js';
import { vUsername, vPassword, vText, vId, page, range, sPlayer, sAgent, sTx, sGameSession, where, listQuery, summary } from './common.js';

export const agentRouter = Router();

const getAgent = db.prepare('SELECT * FROM agents WHERE id = ?');

// ---- Auth: Bearer session token (from /login) or X-API-Key (server-to-server) ----
agentRouter.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const key = `agent:${req.ip}:${String(username).toLowerCase()}`;
  checkThrottle(key);
  const a = typeof username === 'string' ? db.prepare('SELECT * FROM agents WHERE username = ?').get(username) : null;
  const ok = a ? verifyPassword(String(password || ''), a.pass_hash) : (burnPasswordCheck(String(password || '')), false);
  if (!ok) { recordFailure(key); throw unauthorized('Invalid username or password'); }
  if (a.status !== 'active') throw forbidden('Agent account suspended');
  clearFailures(key);
  const s = createSession('agent', a.id, req.ip);
  res.json({ token: s.token, expiresAt: new Date(s.expiresAt).toISOString(), agent: sAgent(a) });
});

agentRouter.use((req, _res, next) => {
  let agentId = null;
  const apiKey = req.headers['x-api-key'];
  if (apiKey) {
    const a = db.prepare('SELECT id FROM agents WHERE api_key_hash = ?').get(sha256(String(apiKey)));
    if (a) agentId = a.id;
  } else {
    const s = getSession(bearer(req), 'agent');
    if (s) agentId = s.subject_id;
  }
  if (!agentId) return next(unauthorized());
  const agent = getAgent.get(agentId);
  if (!agent || agent.status !== 'active') return next(forbidden('Agent account suspended'));
  req.agent = agent;
  next();
});

agentRouter.post('/logout', (req, res) => { destroySession(bearer(req)); res.json({ ok: true }); });

agentRouter.get('/me', (req, res) => res.json(sAgent(req.agent)));

agentRouter.post('/me/password', (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(String(currentPassword || ''), req.agent.pass_hash)) throw unauthorized('Current password is wrong');
  db.prepare('UPDATE agents SET pass_hash = ? WHERE id = ?').run(hashPassword(vPassword(newPassword)), req.agent.id);
  res.json({ ok: true });
});

// ---- Players ----
function ownPlayer(req) {
  const p = db.prepare('SELECT * FROM players WHERE id = ? AND agent_id = ?').get(vId(req.params.id), req.agent.id);
  if (!p) throw notFound('Player');
  return p;
}

agentRouter.post('/players', (req, res) => {
  const b = req.body || {};
  const username = vUsername(b.username);
  const password = vPassword(b.password);
  const nickname = vText(b.nickname, 'nickname', 20) || username;
  if (db.prepare('SELECT 1 FROM players WHERE username = ?').get(username)) throw conflict('USERNAME_TAKEN', 'Username already exists');
  const p = db.prepare('INSERT INTO players (agent_id, username, pass_hash, nickname, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
    .get(req.agent.id, username, hashPassword(password), nickname, Date.now());
  let tx = null;
  if (b.initialCredits) {
    tx = deposit({ agentId: req.agent.id, playerId: p.id, amount: b.initialCredits, reference: b.reference, note: 'initial credits', actorKind: 'agent', actorId: req.agent.id });
  }
  const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(p.id);
  res.status(201).json({ player: sPlayer(fresh), transaction: sTx(tx) });
});

agentRouter.get('/players', (req, res) => {
  const q = req.query;
  const w = where([
    ['agent_id = ?', req.agent.id],
    ['status = ?', q.status],
    ['(username LIKE ? )', q.search ? `%${q.search}%` : null],
  ]);
  const { total, rows } = listQuery('players', w, 'id DESC', page(q));
  let items = rows.map(sPlayer);
  if (q.online === 'true') items = items.filter((p) => p.online);
  res.json({ total, items });
});

agentRouter.get('/players/:id', (req, res) => res.json(sPlayer(ownPlayer(req))));

agentRouter.patch('/players/:id', (req, res) => {
  const p = ownPlayer(req);
  const b = req.body || {};
  if (b.nickname !== undefined) db.prepare('UPDATE players SET nickname = ? WHERE id = ?').run(vText(b.nickname, 'nickname', 20) || p.username, p.id);
  if (b.password !== undefined) {
    db.prepare('UPDATE players SET pass_hash = ? WHERE id = ?').run(hashPassword(vPassword(b.password)), p.id);
    destroySubjectSessions('player', p.id);
    bus.emit('kick', p.id, 'password_changed');
  }
  if (b.status !== undefined) {
    if (!['active', 'frozen'].includes(b.status)) throw bad('INVALID_STATUS', 'status must be active or frozen');
    db.prepare('UPDATE players SET status = ? WHERE id = ?').run(b.status, p.id);
    if (b.status === 'frozen') { destroySubjectSessions('player', p.id); bus.emit('kick', p.id, 'account_frozen'); }
  }
  res.json(sPlayer(db.prepare('SELECT * FROM players WHERE id = ?').get(p.id)));
});

agentRouter.post('/players/:id/deposit', (req, res) => {
  const p = ownPlayer(req);
  const b = req.body || {};
  const t = deposit({ agentId: req.agent.id, playerId: p.id, amount: b.amount, reference: b.reference, note: b.note, actorKind: 'agent', actorId: req.agent.id });
  res.json(sTx(t));
});

agentRouter.post('/players/:id/withdraw', (req, res) => {
  const p = ownPlayer(req);
  const b = req.body || {};
  // amount: "all" withdraws the full balance.
  const amount = b.amount === 'all' ? db.prepare('SELECT balance FROM players WHERE id = ?').get(p.id).balance : b.amount;
  if (b.amount === 'all' && amount === 0) throw bad('NOTHING_TO_WITHDRAW', 'Player balance is 0');
  const t = withdraw({ agentId: req.agent.id, playerId: p.id, amount, reference: b.reference, note: b.note, actorKind: 'agent', actorId: req.agent.id });
  res.json(sTx(t));
});

agentRouter.post('/players/:id/kick', (req, res) => {
  const p = ownPlayer(req);
  destroySubjectSessions('player', p.id);
  bus.emit('kick', p.id, 'kicked_by_agent');
  res.json({ ok: true });
});

agentRouter.get('/players/:id/transactions', (req, res) => {
  const p = ownPlayer(req);
  const { from, to } = range(req.query);
  const w = where([['player_id = ?', p.id], ['ts >= ?', from], ['ts < ?', to], ['type = ?', req.query.type]]);
  const { total, rows } = listQuery('transactions', w, 'id DESC', page(req.query));
  res.json({ total, items: rows.map(sTx) });
});

agentRouter.get('/players/:id/game-sessions', (req, res) => {
  const p = ownPlayer(req);
  const { from, to } = range(req.query);
  const w = where([['player_id = ?', p.id], ['started_at >= ?', from], ['started_at < ?', to], ['room_id = ?', req.query.roomId]]);
  const { total, rows } = listQuery('game_sessions', w, 'id DESC', page(req.query));
  res.json({ total, items: rows.map(sGameSession) });
});

agentRouter.get('/players/:id/summary', (req, res) => {
  const p = ownPlayer(req);
  res.json(summary({ agentId: req.agent.id, playerId: p.id, ...range(req.query) }));
});

// ---- Agent-wide ----
agentRouter.get('/transactions', (req, res) => {
  const { from, to } = range(req.query);
  const w = where([['agent_id = ?', req.agent.id], ['ts >= ?', from], ['ts < ?', to], ['type = ?', req.query.type],
    ['player_id = ?', req.query.playerId ? vId(req.query.playerId) : null]]);
  const { total, rows } = listQuery('transactions', w, 'id DESC', page(req.query));
  res.json({ total, items: rows.map(sTx) });
});

agentRouter.get('/game-sessions', (req, res) => {
  const { from, to } = range(req.query);
  const w = where([['agent_id = ?', req.agent.id], ['started_at >= ?', from], ['started_at < ?', to], ['room_id = ?', req.query.roomId]]);
  const { total, rows } = listQuery('game_sessions', w, 'id DESC', page(req.query));
  res.json({ total, items: rows.map(sGameSession) });
});

agentRouter.get('/reports/summary', (req, res) => {
  res.json({ agentBalance: req.agent.balance, ...summary({ agentId: req.agent.id, ...range(req.query) }) });
});

// ---- Game rounds (every shot that hit / every spin) ----
agentRouter.get('/players/:id/rounds', (req, res) => {
  const p = ownPlayer(req);
  res.json(listRounds({ playerId: p.id, roomId: req.query.roomId, ...range(req.query), ...page(req.query) }));
});

agentRouter.get('/rounds', (req, res) => {
  res.json(listRounds({ agentId: req.agent.id, roomId: req.query.roomId, playerId: req.query.playerId ? vId(req.query.playerId) : undefined,
    ...range(req.query), ...page(req.query) }));
});

function ownRound(req) {
  const r = getRound(vId(req.params.id));
  if (!r || r.agent_id !== req.agent.id) throw notFound('Round');
  return r;
}
agentRouter.get('/rounds/:id', (req, res) => res.json(serializeRound(ownRound(req))));
/** Replays the round from its seed on the server and checks it matches what was paid. */
agentRouter.get('/rounds/:id/verify', (req, res) => res.json(verifyRoundServer(ownRound(req))));
