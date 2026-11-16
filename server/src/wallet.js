import { db, tx } from './db.js';
import { bus } from './bus.js';
import { bad, conflict, notFound, ApiError } from './errors.js';

// All amounts are integer credits. Gameplay debits/credits hit players.balance directly
// (summarized per visit in game_sessions); agent/admin movements are also written to `transactions`.

const debitStmt = db.prepare('UPDATE players SET balance = balance - ? WHERE id = ? AND balance >= ? RETURNING balance');
const creditStmt = db.prepare('UPDATE players SET balance = balance + ? WHERE id = ? RETURNING balance');
const agentDebitStmt = db.prepare('UPDATE agents SET balance = balance - ? WHERE id = ? AND balance >= ? RETURNING balance');
const agentCreditStmt = db.prepare('UPDATE agents SET balance = balance + ? WHERE id = ? RETURNING balance');
const insTx = db.prepare(`INSERT INTO transactions
  (ts, type, agent_id, player_id, amount, agent_balance_after, player_balance_after, reference, note, actor_kind, actor_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`);
const byRef = db.prepare('SELECT * FROM transactions WHERE reference = ?');

/** Gameplay: take a bet. Returns new balance, or null if insufficient. */
export function gameDebit(playerId, amount) {
  const r = debitStmt.get(amount, playerId, amount);
  return r ? r.balance : null;
}

/** Gameplay: pay a win / refund. Returns new balance. */
export function gameCredit(playerId, amount) {
  if (amount <= 0) return db.prepare('SELECT balance FROM players WHERE id = ?').get(playerId)?.balance ?? 0;
  return creditStmt.get(amount, playerId).balance;
}

export function validateAmount(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 1e12) throw bad('INVALID_AMOUNT', 'amount must be a positive integer');
  return n;
}

function validateRef(ref) {
  if (ref == null || ref === '') return null;
  if (typeof ref !== 'string' || ref.length > 100) throw bad('INVALID_REFERENCE', 'reference must be a string up to 100 chars');
  return ref;
}

/** If `reference` was already used, return the original tx (idempotent replay) if it matches, else conflict. */
function replay(ref, expect) {
  if (!ref) return null;
  const t = byRef.get(ref);
  if (!t) return null;
  if (t.type !== expect.type || t.amount !== expect.amount || t.player_id !== (expect.playerId ?? null) || t.agent_id !== expect.agentId) {
    throw conflict('REFERENCE_REUSED', 'reference already used for a different transaction');
  }
  return { ...t, replayed: true };
}

/** Agent -> player. */
export function deposit({ agentId, playerId, amount, reference, note = '', actorKind, actorId }) {
  amount = validateAmount(amount);
  reference = validateRef(reference);
  const result = tx(() => {
    const prev = replay(reference, { type: 'deposit', amount, playerId, agentId });
    if (prev) return prev;
    const p = db.prepare('SELECT id FROM players WHERE id = ? AND agent_id = ?').get(playerId, agentId);
    if (!p) throw notFound('Player');
    const a = agentDebitStmt.get(amount, agentId, amount);
    if (!a) throw new ApiError(402, 'INSUFFICIENT_AGENT_BALANCE', 'Agent balance too low');
    const pb = creditStmt.get(amount, playerId).balance;
    return insTx.get(Date.now(), 'deposit', agentId, playerId, amount, a.balance, pb, reference, String(note).slice(0, 500), actorKind, actorId ?? null);
  });
  if (!result.replayed) bus.emit('balance', playerId, result.player_balance_after);
  return result;
}

/** Player -> agent. */
export function withdraw({ agentId, playerId, amount, reference, note = '', actorKind, actorId }) {
  amount = validateAmount(amount);
  reference = validateRef(reference);
  const result = tx(() => {
    const prev = replay(reference, { type: 'withdraw', amount, playerId, agentId });
    if (prev) return prev;
    const p = db.prepare('SELECT id FROM players WHERE id = ? AND agent_id = ?').get(playerId, agentId);
    if (!p) throw notFound('Player');
    const pr = debitStmt.get(amount, playerId, amount);
    if (!pr) throw new ApiError(402, 'INSUFFICIENT_PLAYER_BALANCE', 'Player balance too low');
    const ab = agentCreditStmt.get(amount, agentId).balance;
    return insTx.get(Date.now(), 'withdraw', agentId, playerId, amount, ab, pr.balance, reference, String(note).slice(0, 500), actorKind, actorId ?? null);
  });
  if (!result.replayed) bus.emit('balance', playerId, result.player_balance_after);
  return result;
}

/** Admin mints credits to an agent (or removes them). */
export function adminAdjustAgent({ agentId, amount, direction, reference, note = '', adminId }) {
  amount = validateAmount(amount);
  reference = validateRef(reference);
  const type = direction === 'debit' ? 'admin_debit' : 'admin_credit';
  return tx(() => {
    const prev = replay(reference, { type, amount, agentId });
    if (prev) return prev;
    if (!db.prepare('SELECT id FROM agents WHERE id = ?').get(agentId)) throw notFound('Agent');
    let bal;
    if (type === 'admin_credit') bal = agentCreditStmt.get(amount, agentId).balance;
    else {
      const r = agentDebitStmt.get(amount, agentId, amount);
      if (!r) throw new ApiError(402, 'INSUFFICIENT_AGENT_BALANCE', 'Agent balance too low');
      bal = r.balance;
    }
    return insTx.get(Date.now(), type, agentId, null, amount, bal, null, reference, String(note).slice(0, 500), 'admin', adminId ?? null);
  });
}
