import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { ApiError } from './errors.js';
import { agentRouter } from './api/agent.js';
import { adminRouter } from './api/admin.js';
import { gameRouter } from './api/game.js';
import { attachGameServer } from './game/manager.js';
import { runStartupChecks } from './integrity.js';
import { pruneRounds } from './rounds.js';

// Refuse to start if the RNG self-test fails or the shipped math doesn't match its RTP level.
const integrity = runStartupChecks();
if (integrity.problems.length) {
  for (const p of integrity.problems) console.error(`[integrity] ${p}`);
  console.error('[integrity] start-up checks failed; not starting');
  process.exit(1);
}

// Bootstrap the first admin account.
if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n === 0) {
  db.prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?, ?, ?)')
    .run(config.adminUsername, hashPassword(config.adminPassword), Date.now());
  console.log(`[setup] created admin "${config.adminUsername}"${process.env.ADMIN_PASSWORD ? '' : ' with the DEFAULT password — change it!'}`);
}

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });

// CORS for the agent/admin back-office API (comma-separated origins, or * ).
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(['/api/agent', '/api/admin'], (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (corsOrigins.includes('*') || corsOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-API-Key, X-Admin-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', express.json({ limit: '32kb' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/game', gameRouter);
app.use('/api/agent', agentRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'No such endpoint')));

// Game client
app.use('/shared', express.static(path.join(config.root, 'shared'), { maxAge: 0 }));
app.use(express.static(path.join(config.root, 'client'), { maxAge: 0 }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
});

const server = http.createServer(app);
const game = attachGameServer(server, { trustProxy: config.trustProxy });

// Delete old rounds once at start and then every hour.
if (config.roundRetentionDays > 0) {
  const prune = () => pruneRounds(config.roundRetentionDays)
    .then((n) => n && console.log(`[rounds] deleted ${n} rounds older than ${config.roundRetentionDays} days`))
    .catch((e) => console.error('[rounds] cleanup failed', e));
  setTimeout(prune, 30_000).unref();
  setInterval(prune, 3600_000).unref();
}

server.listen(config.port, config.host, () => {
  console.log(`[server] Tidal Fortune listening on http://localhost:${config.port}`);
});

function shutdown() {
  console.log('[server] shutting down');
  game.shutdown();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
