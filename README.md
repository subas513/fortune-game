# Tidal Fortune

A real-time multiplayer fish-hunt arcade with 777 slot machines. It runs in the browser as a full-screen game.

- **Game client** (`client/`): full-screen canvas game with login, lobby, 3 fish tables and 2 slot machines. All art and sound are generated in code, so there are no asset files. There is **no registration and no cashier** in the game. Players only log in.
- **Game server** (`server/`): Node.js, WebSocket, and SQLite. The server decides all outcomes. Each room's RTP is set by the admin.
- **Agent/Admin API**: REST API that your back-office system plugs into. Agents create players and deposit or withdraw their credits. See **[API.md](API.md)**.
- **Provably fair and audited**: every result comes from a seeded HMAC-SHA256 stream that agents and admins can replay and verify (players don't see this or the RTP). Every round is written to an append-only, hash-chained log. The server runs RNG self-tests and fingerprints its own build at startup. RTP is fixed at 92%, 94% or 96%. See **[FAIRNESS.md](FAIRNESS.md)**.

## Run

Requires Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
```

```bash
npm run seed
```

```bash
npm start
```

`npm run seed` is optional. It creates demo accounts: agent `demo_agent` / `agent123`, players `player1` and `player2` / `player123`.

Open http://localhost:8080 and log in as `player1` / `player123`.

On first start the server creates the admin account `admin` / `admin12345`. Set `ADMIN_PASSWORD` before the first start, or change the password with `POST /api/admin/me/password`.

### Environment

| Var | Default | |
|---|---|---|
| `PORT` | 8080 | |
| `DB_FILE` | `data/game.db` | SQLite file |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | admin / admin12345 | Used only when no admin exists yet |
| `ADMIN_API_KEY` | (off) | Enables the `X-Admin-Key` header for server-to-server admin calls |
| `CORS_ORIGINS` | (none) | Comma-separated origins allowed to call `/api/agent` and `/api/admin` from a browser |
| `PLAYER_SESSION_HOURS` / `STAFF_SESSION_HOURS` | 24 / 12 | |
| `TRUST_PROXY` | off | Set to `1` behind a reverse proxy so the real client IP is used |
| `ROUND_RETENTION_DAYS` | 30 | Rounds older than this are deleted automatically every hour. `0` keeps them forever. |

## Playing

**Profile**
- Tap your name in the lobby to change your display name or password. Changing the password logs out any other device.

**Fish tables**
- Aim with the mouse or a finger. Tap or hold to fire.
- `+`/`−` (or arrow keys) change the cannon bet. **AUTO** (Space) fires continuously. **LOCK** (L) locks onto a fish: tap one, or the cannon picks the most valuable fish on screen.
- Up to 4 players share a table. Players in the top seats see the table rotated, so their cannon is always at the bottom.
- **⚡ LASER** (or Z) switches between the cannon and the laser gun. While you hold fire (or AUTO / LOCK is on), the laser streams electric shocks into the first fish in its path, or into the locked fish. Each shock costs one bet and has the same catch chance as a bullet hit. A beam that touches nothing costs nothing.
- Special fish: the Blast Crab explodes and catches nearby fish. The Thunder Jelly chains to the 8 nearest fish. Bosses (Crimson Kraken 60–200×, Abyss Whale 100–300×) are announced with a warning.
- Every 3 minutes a tide sweeps the table, switches to the next scene, and brings in a fish parade.

**Slots**
- Space or tapping the reels spins. **AUTO** spins repeatedly. **FAST** speeds up the reels. **MAX** sets the highest bet.
- The `i` button shows the paytable.


## RTP simulation

`tools/rtp-sim.js` replays the certified math for every game locally, using the same provably-fair
outcome functions as the server (`shared/fair.js`) with a deterministic byte stream. It writes
nothing: no server, no database, no wallet.

```bash
npm run sim-rtp                       # every configured room at its live RTP
npm run sim-rtp:sweep                 # every game at 92 / 94 / 96 %
node tools/rtp-sim.js --rounds 5000000 --json
```

Fish tables are simulated for three player aims (`random`, `small`, `boss`); every aim must converge
on the room RTP because capture chance is `rtp / Σ expected multipliers`. Slots are compared with the
exact RTP enumerated from their reel strips. Each row prints the simulated RTP, its 95% confidence
interval, the theoretical value, hit rate and the largest win seen. The run exits non-zero if any row
is more than 4σ from theory.

## Layout

```
shared/            code used by both client and server (fish table, slot reels/paytables, path math,
                   provably-fair outcome derivation in fair.js, RTP levels in rtp.js)
server/src/
  index.js         HTTP + WebSocket bootstrap
  db.js            schema (admins, agents, players, sessions, transactions, rooms, game_sessions)
  wallet.js        balance moves and ledger (atomic, idempotent by reference)
  api/agent.js     agent API          api/admin.js   admin API          api/game.js  player login
  game/manager.js  connections, lobby, routing, live push of balance changes and kicks
  game/fishRoom.js fish table engine (spawning, bullets, capture rounds)
  game/slotEngine.js exact RTP / hit-frequency report per reel set
  fair/seeds.js    provably-fair seed pairs (commit / rotate / reveal)
  fair/health.js   RNG self-tests and continuous checks
  rounds.js        append-only, hash-chained round log + replay
  integrity.js     start-up checks and build fingerprint
client/
  js/art.js        all creature, background and prop drawing (pre-rendered sprite sheets)
  js/fishScene.js  fish table       js/slotScene.js  slot machine
  js/main.js       boot, login, lobby, scaling, input   js/audio.js  synthesized SFX and music
```

## Production notes

- Put the server behind HTTPS (nginx/Caddy) with WebSocket upgrade on `/ws`, and set `TRUST_PROXY=1`.
- SQLite in WAL mode handles a single server process well. Back up `data/game.db` regularly.
- The round log is kept small: ordinary fish hits are stored in batches, and the server deletes rounds older than `ROUND_RETENTION_DAYS` (default 30) every hour. `npm run prune-rounds` does the same by hand. Money transactions and per-visit game totals are never deleted. See FAIRNESS.md.
- Browser verification uses WebCrypto, which only works over HTTPS or on localhost.
- To run several server instances you would need a shared DB (Postgres) and sticky rooms. The wallet functions are the only code that touches balances.
- Make sure fish and slot games involving real-money credits are legal and licensed where you operate.
