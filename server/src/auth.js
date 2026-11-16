import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { ApiError, unauthorized } from './errors.js';

// ---- Passwords (scrypt) ---------------------------------------------------
const N = 16384, R = 8, P = 1, KEYLEN = 32;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [algo, n, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: R, p: P });
    return crypto.timingSafeEqual(expected, got);
  } catch {
    return false;
  }
}

// A real hash for a password nobody has, so unknown usernames cost the same time as wrong passwords.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));
export const burnPasswordCheck = (pw) => verifyPassword(pw, DUMMY_HASH);

// ---- Tokens ----------------------------------------------------------------
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

const insSession = db.prepare('INSERT INTO sessions (token_hash, kind, subject_id, created_at, expires_at, ip) VALUES (?, ?, ?, ?, ?, ?)');
const getSessionStmt = db.prepare('SELECT * FROM sessions WHERE token_hash = ?');
const delSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const delSubjectSessions = db.prepare('DELETE FROM sessions WHERE kind = ? AND subject_id = ?');

export function createSession(kind, subjectId, ip, { single = false } = {}) {
  if (single) delSubjectSessions.run(kind, subjectId);
  const token = randomToken();
  const hours = kind === 'player' ? config.playerSessionHours : config.staffSessionHours;
  const now = Date.now();
  insSession.run(sha256(token), kind, subjectId, now, now + hours * 3600_000, ip || null);
  return { token, expiresAt: now + hours * 3600_000 };
}

export function getSession(token, kind) {
  if (!token || typeof token !== 'string') return null;
  const s = getSessionStmt.get(sha256(token));
  if (!s || s.kind !== kind) return null;
  if (s.expires_at < Date.now()) {
    delSession.run(s.token_hash);
    return null;
  }
  return s;
}

export const destroySession = (token) => token && delSession.run(sha256(token));
export const destroySubjectSessions = (kind, id) => delSubjectSessions.run(kind, id);

setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 3600_000).unref();

// ---- Agent API keys ----------------------------------------------------------
export function newApiKey() {
  const key = `tfk_${randomToken(24)}`;
  return { key, hash: sha256(key), prefix: key.slice(0, 10) };
}

// ---- Login throttling (in-memory) ------------------------------------------
const attempts = new Map(); // key -> { n, until }
const WINDOW = 15 * 60_000, MAX = 8;

export function checkThrottle(key) {
  const a = attempts.get(key);
  if (a && a.n >= MAX && a.until > Date.now()) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed logins, try again later');
  }
}
export function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { n: 1, until: Date.now() + WINDOW });
  else a.n++;
}
export const clearFailures = (key) => attempts.delete(key);
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
}, 60_000).unref();

// ---- Express helpers ----------------------------------------------------------
export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export function requireSession(kind) {
  return (req, _res, next) => {
    const s = getSession(bearer(req), kind);
    if (!s) return next(unauthorized());
    req.session = s;
    next();
  };
}
