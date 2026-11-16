# Tidal Fortune — Back-office API

This API is for your agent and admin systems. There is no UI for it yet, so your other system calls it directly.
Players never call these endpoints. The game client only uses `POST /api/game/login`, the player fairness endpoints listed at the end, and the WebSocket.

- Base URL: `http://<host>:<port>/api`
- Requests and responses are JSON. Timestamps are ISO-8601 in UTC.
- **Amounts are integer credits.** Your system decides what one credit is worth (for example 1 credit = $0.01).
- Errors look like `{ "error": { "code": "INSUFFICIENT_AGENT_BALANCE", "message": "…" } }` and come with the matching HTTP status (400, 401, 402, 403, 404, 409, 429).
- List endpoints accept `limit` (1–500, default 50) and `offset`, and return `{ total, items }`.
- Date filters `from` and `to` accept ISO dates or epoch milliseconds.

## Money model

```
admin ──credit/debit──▶ agent balance ──deposit──▶ player balance ──(gameplay)──▶ …
                                     ◀─withdraw──
```

- An admin mints credits to an agent. An agent deposits from its own balance to its players and withdraws back to its balance.
- Every movement is written to the `transactions` ledger with the balances after the move.
- Gameplay (bets and wins) is recorded per table visit in **game sessions**.
- **Idempotency:** deposit, withdraw and admin credit/debit accept an optional `reference` (up to 100 chars, unique). If you retry with the same reference and the same parameters, you get the original transaction back with `"replayed": true`. The same reference with different parameters returns `409 REFERENCE_REUSED`. Always send a reference from your system.
- A balance change reaches an online player's screen immediately, including mid-game.

---

## Authentication

| Caller | How |
|---|---|
| Agent (server-to-server) | Header `X-API-Key: tfk_…`. The key is returned once, when the admin creates the agent or rotates its key. |
| Agent (interactive) | `POST /api/agent/login` → `{ token }`, then `Authorization: Bearer <token>` |
| Admin (interactive) | `POST /api/admin/login` → `{ token }`, then `Authorization: Bearer <token>` |
| Admin (server-to-server) | Header `X-Admin-Key: <ADMIN_API_KEY env var>`. Disabled unless that variable is set. |

Too many failed logins from the same IP and username are blocked for 15 minutes (`429`).

---

## Agent endpoints — `/api/agent`

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/login` | `{ username, password }` | Returns `{ token, expiresAt, agent }` |
| POST | `/logout` | | |
| GET | `/me` | | Agent profile and balance |
| POST | `/me/password` | `{ currentPassword, newPassword }` | |
| POST | `/players` | `{ username, password, nickname?, initialCredits?, reference? }` | **Registration.** Username: 3–24 chars (letters, digits, `_`), unique across the platform. Password: 6–64 chars. |
| GET | `/players` | `status?`, `search?`, `online=true?`, `limit`, `offset` | Your players only |
| GET | `/players/:id` | | Includes `online` and the current `roomId` |
| PATCH | `/players/:id` | `{ nickname?, password?, status? }` | `status`: `active` or `frozen`. Freezing or changing the password logs the player out right away. |
| POST | `/players/:id/deposit` | `{ amount, reference?, note? }` | Agent balance → player. Returns `402 INSUFFICIENT_AGENT_BALANCE` if the agent is short. |
| POST | `/players/:id/withdraw` | `{ amount \| "all", reference?, note? }` | Player → agent balance. Returns `402 INSUFFICIENT_PLAYER_BALANCE` if the player is short. |
| POST | `/players/:id/kick` | | Disconnects the player and ends their session |
| GET | `/players/:id/transactions` | `from?`, `to?`, `type?` | Deposits and withdrawals |
| GET | `/players/:id/game-sessions` | `from?`, `to?`, `roomId?` | Bet and win per table visit |
| GET | `/players/:id/summary` | `from?`, `to?` | Totals for one player |
| GET | `/transactions` | `from?`, `to?`, `type?`, `playerId?` | Every transaction under this agent |
| GET | `/game-sessions` | `from?`, `to?`, `roomId?` | |
| GET | `/reports/summary` | `from?`, `to?` | `totalBet`, `totalWin`, `houseNet`, `actualRtp`, `deposits`, `withdrawals`, `agentBalance` |
| GET | `/players/:id/rounds` | `from?`, `to?`, `roomId?` | Every fish capture attempt and slot spin, with its fairness data |
| GET | `/rounds` | `from?`, `to?`, `roomId?`, `playerId?` | Every round played under this agent |
| GET | `/rounds/:id` | | One round |
| GET | `/rounds/:id/verify` | | Recomputes the round on the server from its seed and checks it matches what was paid: `{ verified, problems, round }` |

### Examples

```bash
# create a player with 500 starting credits
curl -X POST localhost:8080/api/agent/players \
  -H "X-API-Key: $AGENT_KEY" -H 'content-type: application/json' \
  -d '{"username":"lucky88","password":"s3cret!","nickname":"Lucky","initialCredits":500,"reference":"crm-signup-1029"}'

# top up
curl -X POST localhost:8080/api/agent/players/42/deposit \
  -H "X-API-Key: $AGENT_KEY" -H 'content-type: application/json' \
  -d '{"amount":2000,"reference":"cashier-77123","note":"cash at counter"}'

# cash out everything
curl -X POST localhost:8080/api/agent/players/42/withdraw \
  -H "X-API-Key: $AGENT_KEY" -H 'content-type: application/json' \
  -d '{"amount":"all","reference":"cashier-77124"}'
```

---

## Admin endpoints — `/api/admin`

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/login` | `{ username, password }` | |
| POST | `/logout` | | |
| POST | `/me/password` | `{ currentPassword, newPassword }` | |
| POST | `/agents` | `{ username, password, displayName?, initialCredits? }` | Returns `{ agent, apiKey }`. **Store the API key** — it is never shown again. |
| GET | `/agents` | `status?`, `search?` | |
| GET | `/agents/:id` | | |
| PATCH | `/agents/:id` | `{ displayName?, password?, status? }` | `status`: `active` or `suspended`. A suspended agent's API calls and its players' logins are refused. |
| POST | `/agents/:id/api-key` | | Rotate the key; the old key stops working at once |
| POST | `/agents/:id/credit` | `{ amount, reference?, note? }` | Mint credits to the agent |
| POST | `/agents/:id/debit` | `{ amount, reference?, note? }` | Take credits back from the agent |
| GET | `/players` | `agentId?`, `status?`, `search?`, `online=true?` | All players |
| GET | `/players/online` | | Everyone connected right now |
| GET | `/players/:id` | | |
| PATCH | `/players/:id` | `{ status?, password? }` | |
| POST | `/players/:id/kick` | | |
| GET | `/players/:id/game-sessions` | | |
| GET | `/transactions` | `agentId?`, `playerId?`, `type?`, `from?`, `to?` | Full ledger |
| GET | `/game-sessions` | `agentId?`, `playerId?`, `roomId?`, `from?`, `to?` | |
| GET | `/reports/summary` | `from?`, `to?` | Platform totals plus `byAgent`, `byRoom`, outstanding `playerBalances` and `agentBalances`, and `onlinePlayers` |
| GET | `/rooms` | | Game and table configuration |
| PATCH | `/rooms/:id` | `{ name?, rtp?, minBet?, maxBet?, enabled?, sort? }` | Takes effect on live tables right away. `rtp` must be `0.92`, `0.94` or `0.96`. |
| GET | `/rounds` | `agentId?`, `playerId?`, `roomId?`, `from?`, `to?` | Round log |
| GET | `/rounds/:id` | | |
| GET | `/rounds/:id/verify` | | Server-side replay of one round |
| GET | `/rounds/chain-check` | `fromId?`, `limit?` | Walks the round log's hash chain: `{ ok, checked, lastId }`, or `{ ok: false, brokenAtId }` |
| GET | `/integrity` | | Build hash, per-file hashes, RNG self-test results, and the exact RTP and hit frequency of every game at every level |

---

## Games and RTP

| Room id | Game | Bets | Notes |
|---|---|---|---|
| `reef` | Fish table | 1–10 per shot | 4 seats, shared fish |
| `lagoon` | Fish table | 10–100 per shot | |
| `abyss` | Fish table | 100–1,000 per shot | |
| `lucky777` | 3-reel classic 777 slot | 1–100 per line × 5 lines | Top win: 300× the line bet (three red 7s) |
| `ruby7` | 5-reel 777 slot with wilds | 1–50 per line × 9 lines | Top win: 2,000× the line bet (five wilds) |

- The server decides every outcome; the client only draws it.
- RTP can only be set to 92%, 94% or 96%. Each slot machine has its own reel strips for each level.
- Every outcome comes from the player's provably-fair seed pair and is logged in `game_rounds` before the result is sent.
- Full details are in **[FAIRNESS.md](FAIRNESS.md)**.

### Round object

```json
{
  "id": 68, "ts": "2026-11-14T06:43:36.020Z", "playerId": 2, "agentId": 1, "roomId": "ruby7",
  "game": "slot", "status": "settled", "bet": 9, "win": 0, "balanceAfter": 50012,
  "detail": { "machine": "ruby7", "level": "96", "lineBet": 1, "lines": 9, "stops": [50, 25, 2, 6, 6], "winLines": [] },
  "fairness": { "serverSeedHash": "c9cd…", "clientSeed": "1d84…", "nonce": 67, "serverSeed": null },
  "chainHash": "8afc…"
}
```

- `fairness.serverSeed` stays `null` until the player rotates that seed.
- `status` is `rejected` when a fish hit was too far from the fish to count. The bet is lost and no roll is made.
- Ordinary fish hits come as one `detail.kind: "batch"` row per player every few seconds: `n` hits at `detail.bet` each, `wins` catches, `v` the fish types hit, and `fairness.nonce` the first round number. `bet` and `win` are the batch totals. Wins of 20× the bet or more and bomb, chain and boss catches have their own rows.

## Player endpoints — `/api/game` (player Bearer token)

These are used by the fairness panel in the game. They are listed here for completeness.

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | The player's account name and display name |
| PATCH | `/me` | `{ nickname }`: 2–16 letters, numbers, spaces, `_ . -` |
| POST | `/me/password` | `{ currentPassword, newPassword }`: logs out other devices and returns a new `token` for this one |
| GET | `/fair` | Current seed pair (server seed hash, client seed, nonce, next server seed hash) and recently revealed seeds |
| POST | `/fair/rotate` | `{ clientSeed? }`: reveals the current server seed and starts a new pair |
| GET | `/rounds` | `limit?`, `beforeId?`: the player's own rounds |
| GET | `/rounds/:id` | |
