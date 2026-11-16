import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { RTP_LEVELS, DEFAULT_RTP } from '../../shared/rtp.js';

fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new DatabaseSync(config.dbFile);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash     TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id             INTEGER PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash      TEXT NOT NULL,
  display_name   TEXT NOT NULL DEFAULT '',
  balance        INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  api_key_hash   TEXT UNIQUE,
  api_key_prefix TEXT,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  id             INTEGER PRIMARY KEY,
  agent_id       INTEGER NOT NULL REFERENCES agents(id),
  username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash      TEXT NOT NULL,
  nickname       TEXT NOT NULL DEFAULT '',
  balance        INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  created_at     INTEGER NOT NULL,
  last_login_at  INTEGER,
  last_login_ip  TEXT
);
CREATE INDEX IF NOT EXISTS idx_players_agent ON players(agent_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('admin','agent','player')),
  subject_id  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_subject ON sessions(kind, subject_id);

-- Money ledger: every credit movement that is not gameplay (gameplay is summarized in game_sessions).
CREATE TABLE IF NOT EXISTS transactions (
  id                    INTEGER PRIMARY KEY,
  ts                    INTEGER NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('admin_credit','admin_debit','deposit','withdraw')),
  agent_id              INTEGER NOT NULL REFERENCES agents(id),
  player_id             INTEGER REFERENCES players(id),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  agent_balance_after   INTEGER NOT NULL,
  player_balance_after  INTEGER,
  reference             TEXT UNIQUE,
  note                  TEXT NOT NULL DEFAULT '',
  actor_kind            TEXT NOT NULL,
  actor_id              INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tx_agent ON transactions(agent_id, ts);
CREATE INDEX IF NOT EXISTS idx_tx_player ON transactions(player_id, ts);

CREATE TABLE IF NOT EXISTS rooms (
  id        TEXT PRIMARY KEY,
  game      TEXT NOT NULL DEFAULT 'fish' CHECK (game IN ('fish','slot')),
  variant   TEXT NOT NULL DEFAULT '',
  name      TEXT NOT NULL,
  min_bet   INTEGER NOT NULL,
  max_bet   INTEGER NOT NULL,
  rtp       REAL NOT NULL,
  enabled   INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);

-- One row per player per table visit; updated live while playing.
CREATE TABLE IF NOT EXISTS game_sessions (
  id             INTEGER PRIMARY KEY,
  player_id      INTEGER NOT NULL REFERENCES players(id),
  agent_id       INTEGER NOT NULL REFERENCES agents(id),
  room_id        TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER,
  total_bet      INTEGER NOT NULL DEFAULT 0,
  total_win      INTEGER NOT NULL DEFAULT 0,
  shots          INTEGER NOT NULL DEFAULT 0,
  kills          INTEGER NOT NULL DEFAULT 0,
  balance_start  INTEGER NOT NULL,
  balance_end    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_gs_player ON game_sessions(player_id, started_at);
CREATE INDEX IF NOT EXISTS idx_gs_agent ON game_sessions(agent_id, started_at);

-- Provably-fair seed pairs. Each player has one 'active' pair (server seed hidden, hash shown)
-- and one pre-committed 'next' server seed. Rotating reveals the active server seed.
CREATE TABLE IF NOT EXISTS fair_seeds (
  id                INTEGER PRIMARY KEY,
  player_id         INTEGER NOT NULL REFERENCES players(id),
  status            TEXT NOT NULL CHECK (status IN ('next','active','revealed')),
  server_seed       TEXT NOT NULL,
  server_seed_hash  TEXT NOT NULL UNIQUE,
  client_seed       TEXT,
  nonce             INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  activated_at      INTEGER,
  revealed_at       INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seed_active ON fair_seeds(player_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_seed_next ON fair_seeds(player_id) WHERE status = 'next';
CREATE INDEX IF NOT EXISTS idx_seed_player ON fair_seeds(player_id, id);

-- Every game round (fish capture attempt / slot spin), written in the same transaction as the
-- balance change and before the result is sent. Append-only and hash-chained.
CREATE TABLE IF NOT EXISTS game_rounds (
  id             INTEGER PRIMARY KEY,
  ts             INTEGER NOT NULL,
  player_id      INTEGER NOT NULL REFERENCES players(id),
  agent_id       INTEGER NOT NULL REFERENCES agents(id),
  room_id        TEXT NOT NULL,
  game           TEXT NOT NULL CHECK (game IN ('fish','slot')),
  status         TEXT NOT NULL CHECK (status IN ('settled','rejected')),
  bet            INTEGER NOT NULL,
  win            INTEGER NOT NULL,
  balance_after  INTEGER NOT NULL,
  seed_id        INTEGER REFERENCES fair_seeds(id),
  nonce          INTEGER,
  detail         TEXT NOT NULL,
  chain_hash     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rounds_player ON game_rounds(player_id, id);
CREATE INDEX IF NOT EXISTS idx_rounds_agent ON game_rounds(agent_id, ts);
CREATE INDEX IF NOT EXISTS idx_rounds_room ON game_rounds(room_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_seed_nonce ON game_rounds(seed_id, nonce) WHERE seed_id IS NOT NULL;

-- One entry per cleanup of old rounds (rounds.js pruneRounds). It keeps the chain hash of the last
-- deleted row so the hash chain of the remaining log can still be checked.
CREATE TABLE IF NOT EXISTS round_prune (
  id          INTEGER PRIMARY KEY,
  pruned_at   INTEGER NOT NULL,
  from_id     INTEGER NOT NULL,
  up_to_id    INTEGER NOT NULL,
  rows        INTEGER NOT NULL,
  chain_hash  TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS game_rounds_no_update BEFORE UPDATE ON game_rounds
  BEGIN SELECT RAISE(ABORT, 'game_rounds is append-only'); END;
CREATE TRIGGER IF NOT EXISTS game_rounds_no_delete BEFORE DELETE ON game_rounds
  BEGIN SELECT RAISE(ABORT, 'game_rounds is append-only'); END;
CREATE TRIGGER IF NOT EXISTS transactions_no_update BEFORE UPDATE ON transactions
  BEGIN SELECT RAISE(ABORT, 'transactions is append-only'); END;
CREATE TRIGGER IF NOT EXISTS transactions_no_delete BEFORE DELETE ON transactions
  BEGIN SELECT RAISE(ABORT, 'transactions is append-only'); END;
`);

// ---- migrations for databases created by earlier versions ----
// round_archive (file archiving) was replaced by round_prune (plain deletion); drop it if unused.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='round_archive'").get()
    && db.prepare('SELECT COUNT(*) AS n FROM round_archive').get().n === 0) db.exec('DROP TABLE round_archive');
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('players').includes('pending_round_id')) {
  // Last slot spin the player has not seen yet (resumed on reconnect).
  db.exec('ALTER TABLE players ADD COLUMN pending_round_id INTEGER');
}
// RTP is limited to the fixed levels the game math is built for.
{
  const levels = RTP_LEVELS.map(String).join(',');
  db.prepare(`UPDATE rooms SET rtp = ? WHERE rtp NOT IN (${levels})`).run(DEFAULT_RTP);
}

// Close sessions left open by a crash/restart.
db.prepare('UPDATE game_sessions SET ended_at = started_at WHERE ended_at IS NULL').run();

const roomCount = db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n;
if (roomCount === 0) {
  const ins = db.prepare('INSERT INTO rooms (id, game, variant, name, min_bet, max_bet, rtp, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('reef', 'fish', '', 'Coral Reef', 1, 10, DEFAULT_RTP, 1);
  ins.run('lagoon', 'fish', '', 'Sapphire Lagoon', 10, 100, DEFAULT_RTP, 2);
  ins.run('abyss', 'fish', '', 'Abyss Palace', 100, 1000, DEFAULT_RTP, 3);
  // Slots: min/max bet are per-line bets; total bet = line bet x lines.
  ins.run('lucky777', 'slot', 'classic777', 'Lucky 777', 1, 100, DEFAULT_RTP, 4);
  ins.run('ruby7', 'slot', 'ruby7', 'Ruby Sevens', 1, 50, DEFAULT_RTP, 5);
}

/** Run fn inside an IMMEDIATE transaction (serializes writers). */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());
