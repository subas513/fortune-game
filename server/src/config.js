import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const config = {
  root,
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || '0.0.0.0',
  dbFile: process.env.DB_FILE || path.join(root, 'data', 'game.db'),
  // First-run admin bootstrap (only used when no admin exists yet).
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin12345',
  // Optional static key for server-to-server admin calls (header X-Admin-Key). Empty = disabled.
  adminApiKey: process.env.ADMIN_API_KEY || '',
  // Rounds older than this are deleted automatically (hourly). 0 = keep forever.
  roundRetentionDays: Number(process.env.ROUND_RETENTION_DAYS ?? 30),
  playerSessionHours: Number(process.env.PLAYER_SESSION_HOURS || 24),
  staffSessionHours: Number(process.env.STAFF_SESSION_HOURS || 12),
  trustProxy: process.env.TRUST_PROXY === '1',
};
