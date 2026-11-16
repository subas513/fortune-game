import { db, iso } from '../db.js';
import { bad } from '../errors.js';
import { presence } from '../presence.js';

export const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

export function vUsername(v) {
  if (typeof v !== 'string' || !USERNAME_RE.test(v)) throw bad('INVALID_USERNAME', 'username must be 3-24 chars: letters, digits, underscore');
  return v;
}
export function vPassword(v) {
  if (typeof v !== 'string' || v.length < 6 || v.length > 64) throw bad('INVALID_PASSWORD', 'password must be 6-64 chars');
  return v;
}
export function vText(v, field, max = 40) {
  if (v == null) return '';
  if (typeof v !== 'string' || v.length > max) throw bad('INVALID_' + field.toUpperCase(), `${field} must be a string up to ${max} chars`);
  return v.trim();
}
export function vId(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw bad('INVALID_ID', 'invalid id');
  return n;
}
export function page(q) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 500);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return { limit, offset };
}
/** Accepts ISO date or epoch ms. */
export function range(q) {
  const parse = (v, def) => {
    if (v == null || v === '') return def;
    const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
    if (!Number.isFinite(n)) throw bad('INVALID_DATE', `invalid date: ${v}`);
    return n;
  };
  return { from: parse(q.from, 0), to: parse(q.to, Date.now() + 1) };
}

export const sPlayer = (p) => p && ({
  id: p.id,
  username: p.username,
  nickname: p.nickname,
  agentId: p.agent_id,
  balance: p.balance,
  status: p.status,
  online: presence.has(p.id),
  roomId: presence.get(p.id)?.roomId ?? null,
  createdAt: iso(p.created_at),
  lastLoginAt: iso(p.last_login_at),
  lastLoginIp: p.last_login_ip,
});

export const sAgent = (a) => a && ({
  id: a.id,
  username: a.username,
  displayName: a.display_name,
  balance: a.balance,
  status: a.status,
  apiKeyPrefix: a.api_key_prefix,
  createdAt: iso(a.created_at),
  playerCount: db.prepare('SELECT COUNT(*) AS n FROM players WHERE agent_id = ?').get(a.id).n,
});

export const sTx = (t) => t && ({
  id: t.id,
  ts: iso(t.ts),
  type: t.type,
  agentId: t.agent_id,
  playerId: t.player_id,
  amount: t.amount,
  agentBalanceAfter: t.agent_balance_after,
  playerBalanceAfter: t.player_balance_after,
  reference: t.reference,
  note: t.note,
  actor: { kind: t.actor_kind, id: t.actor_id },
  ...(t.replayed ? { replayed: true } : {}),
});

export const sGameSession = (g) => g && ({
  id: g.id,
  playerId: g.player_id,
  agentId: g.agent_id,
  roomId: g.room_id,
  startedAt: iso(g.started_at),
  endedAt: iso(g.ended_at),
  totalBet: g.total_bet,
  totalWin: g.total_win,
  playerNet: g.total_win - g.total_bet,
  shots: g.shots,
  wins: g.kills,
  balanceStart: g.balance_start,
  balanceEnd: g.balance_end,
});

export const sRoom = (r) => ({
  id: r.id, game: r.game, variant: r.variant, name: r.name,
  minBet: r.min_bet, maxBet: r.max_bet, rtp: r.rtp, enabled: !!r.enabled, sort: r.sort,
});

/** Build a WHERE clause from optional filters. */
export function where(filters) {
  const parts = [], args = [];
  for (const [sql, val] of filters) {
    if (val === undefined || val === null || val === '') continue;
    parts.push(sql);
    args.push(val);
  }
  return { sql: parts.length ? 'WHERE ' + parts.join(' AND ') : '', args };
}

export function listQuery(table, w, order, { limit, offset }) {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${w.sql}`).get(...w.args).n;
  const rows = db.prepare(`SELECT * FROM ${table} ${w.sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...w.args, limit, offset);
  return { total, rows };
}

/** Gameplay + cashflow summary for a set of players over a time range. */
export function summary({ agentId, playerId, from, to }) {
  const w = where([['agent_id = ?', agentId], ['player_id = ?', playerId], ['started_at >= ?', from], ['started_at < ?', to]]);
  const g = db.prepare(`SELECT COALESCE(SUM(total_bet),0) AS bet, COALESCE(SUM(total_win),0) AS win,
    COALESCE(SUM(shots),0) AS shots, COUNT(*) AS sessions FROM game_sessions ${w.sql}`).get(...w.args);
  const tw = where([['agent_id = ?', agentId], ['player_id = ?', playerId], ['ts >= ?', from], ['ts < ?', to]]);
  const t = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN type='deposit' THEN amount END),0) AS deposits,
      COALESCE(SUM(CASE WHEN type='withdraw' THEN amount END),0) AS withdrawals,
      COALESCE(SUM(CASE WHEN type='admin_credit' THEN amount END),0) AS adminCredits,
      COALESCE(SUM(CASE WHEN type='admin_debit' THEN amount END),0) AS adminDebits
    FROM transactions ${tw.sql}`).get(...tw.args);
  return {
    from: iso(from), to: iso(to),
    totalBet: g.bet, totalWin: g.win, houseNet: g.bet - g.win,
    actualRtp: g.bet ? +(g.win / g.bet).toFixed(4) : null,
    shotsOrSpins: g.shots, gameSessions: g.sessions,
    deposits: t.deposits, withdrawals: t.withdrawals,
    ...(playerId ? {} : { adminCredits: t.adminCredits, adminDebits: t.adminDebits }),
  };
}
