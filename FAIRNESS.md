# Randomness, fairness and audit

The server decides every money outcome. Players can check each result after the fact, and every result is stored in a tamper-evident log. The design follows what certification labs look for (GLI-19 style). It does not replace an actual lab certification.

## 1. Where the random numbers come from

| Part | What it does |
|---|---|
| Server seed | 32 bytes from the operating system's secure random generator (`crypto.randomBytes`), stored as 64 hex characters |
| Client seed | Chosen by the player (1–64 characters: letters, digits, `_`, `-`). A random one is assigned at first login. |
| Nonce | Counts the rounds played on the current seed pair, starting at 0 |
| Round bytes | `HMAC_SHA256(key = serverSeed, msg = "clientSeed:nonce:0")`, then the same with `:1`, `:2` and `:3`, joined into 128 bytes |

A **round** is one fish capture attempt (one bullet that hits a fish) or one slot spin.

Numbers are read from the round bytes in order:

- `float()`: the next 6 bytes as a big-endian integer, divided by 2⁴⁸. Gives a number in [0, 1).
- `int(n)`: the next 4 bytes as a big-endian integer. Values at or above the largest multiple of `n` below 2³² are thrown away and the next 4 bytes are read instead. Then the value is taken mod `n`. Every result in [0, n) is exactly equally likely.

Fish spawns, swim paths and formations use ordinary `Math.random`. They only change what you see, not what anything pays.

## 2. Commit, reveal, verify

1. Before any play, the player sees `SHA256(serverSeed)` for the active seed and for the **next** seed.
2. Each round uses the next nonce. The round is saved, with the seed id and nonce, in the same database transaction that moves the money, before the result is sent to the player.
3. **NEW SEED** (`POST /api/game/fair/rotate`) reveals the active server seed. The pre-committed next seed becomes active with the player's new client seed, and a fresh next seed is committed.
4. Anyone can then recompute every round played on the revealed seed. The fairness panel in the lobby does this in the browser.

The server can't change a seed after showing its hash. The player can't predict outcomes, because the server seed stays secret until it's retired.

## 3. How each game uses the bytes (`shared/fair.js`)

**Fish:** one roll per hit.
```
victims   = [hit fish] (+ the fish a Blast Crab / Thunder Jelly would also catch)
p         = min(1, rtp / Σ expectedMultiplier(victims))      boss expected multiplier = midpoint of its range
roll      = float()
captured  = roll < p
mults     = for each victim: fixed multiplier, or for a boss: min + 5 × int((max − min) / 5 + 1)
win       = captured ? bet × Σ mults : 0
```
The expected return of every shot is exactly the room RTP, whichever fish is hit.

A **laser gun shock** works exactly like a bullet hit: one bet, one roll, same formula. The round's `detail.weapon` is `laser` instead of `cannon`. A shock aimed at a fish that's already gone is not charged.

**Slots:** one spin.
```
strips = reel set for (machine, RTP level)      // shared/slots.js
stops  = [int(len(strip_1)), int(len(strip_2)), …]
win    = evaluate(window at stops) × line bet
```
No outcome is ever re-drawn or adjusted after the fact. The RTP comes entirely from the reel strips.

## 4. Fixed RTP levels

Rooms can only be set to **92%, 94% or 96%**. Fish tables use the level directly. Each slot machine has a separate reel set per level, and its exact RTP is calculated at startup:

| Machine | 92% level | 94% level | 96% level |
|---|---|---|---|
| Lucky 777 | 91.970% | 94.010% | 95.988% |
| Ruby Sevens | 91.995% | 93.974% | 96.025% |

The server refuses to start if any reel set is more than 0.1% away from its level.

## 5. Health checks and integrity

- **At startup:**
  - SHA-256 and HMAC-SHA256 known-answer tests
  - a 1 MiB bit-balance test and a byte-distribution (chi-square) test on the system random source
  - a check for stuck repeated output
  - a chi-square test on 120,000 `int(7)` draws

  If any of these fails, the server won't start.
- **While running:** every new server seed is checked against the previous one for repeats or stuck output. If that fails, betting stops until a restart.
- **Build fingerprint:** the server hashes every file under `shared/`, `server/src/` and `client/`, and logs a combined build hash. `GET /api/admin/integrity` returns the build hash, every file's hash, the RNG test results and the exact math for every game and level. This lets you show that the running build is the one that was certified.

## 6. Round log (`game_rounds`)

- **Append-only:** database triggers block any UPDATE or DELETE.
- **Hash-chained:** `chain_hash = SHA256(previous chain_hash | row fields)`. Editing or removing a row, even by going around the triggers, breaks every hash after it. `GET /api/admin/rounds/chain-check` walks the whole chain.
- **Rejected hits are logged too:** if a reported hit is too far from the fish (lag or tampering), the round is stored with status `rejected`. The bet is lost and no roll is made.
- **Server-side replay:** `GET /api/{agent|admin}/rounds/:id/verify` recomputes a round on the server, even before its seed has been revealed. The secret seed is not exposed.
- **Compact fish logging:** ordinary fish hits are not stored one row each. They're packed into a `batch` row per player: up to 10 seconds or 400 hits, at one bet, one RTP and consecutive round numbers. The row stores the fish types hit (`v`, e.g. `"2,5,11.0.3"`), the hit count, the number of catches and the totals. Replay recomputes every hit in the batch from the seed and checks the totals.
  - These still get their own full row: wins of 20× the bet or more, bomb/chain/boss catches, rejected hits, and every slot spin.
  - In a 300-hit test this wrote 19 rows instead of 300, and every one verified.
  - If the server crashes, up to the last 10 seconds of batched hits can be missing from the log. Balances are not affected: payouts are saved immediately.
- **Retention:** the server deletes rounds older than `ROUND_RETENTION_DAYS` (default 30) once at start and then every hour, 2,000 rows at a time so the game isn't held up. `npm run prune-rounds -- --days N` does it by hand. Each deletion records the chain hash of the last deleted row in `round_prune`, so the chain check still works on what's left. Deleted rounds can't be replayed or disputed. The deposit/withdraw ledger and the per-visit `game_sessions` totals are kept.

## 7. Interrupted spins

A slot spin is fully settled on the server: debit, outcome, payout and round record all happen in one transaction. If the player disconnects before seeing the result, it is shown when they come back: on the reels if they reconnect to the machine, or as a message in the lobby.

## Checking a round yourself (Node)

```js
import crypto from 'node:crypto';
import { BLOCKS, hmacMessage, recomputeRound } from './shared/fair.js';

// `round` is one item from GET /api/game/rounds (after a seed rotation, fairness.serverSeed is filled in)
const { serverSeed, serverSeedHash, clientSeed, nonce } = round.fairness;
console.assert(crypto.createHash('sha256').update(serverSeed).digest('hex') === serverSeedHash);
const bytes = Buffer.concat([...Array(BLOCKS).keys()].map((c) =>
  crypto.createHmac('sha256', serverSeed).update(hmacMessage(clientSeed, nonce, c)).digest()));
console.log(recomputeRound(round, bytes)); // { ok: true, problems: [] , outcome }
```

## What this does not cover

- **No lab certification yet.** That needs an accredited lab (GLI, BMM, eCOGRA, iTech) to review the source code, the math and the RNG output. This setup gives them everything they'll ask for.
- **A few fish decisions happen outside the roll.** Which fish a bomb or chain catches depends on where fish are on the table, and the "too far from the fish" check depends on server positions. Both are recorded with every round but can't be recomputed from the seed alone.
- **Batched fish hits are only checked as a group.** A batch's totals are verified, but which fish a bomb or chain caught, and where a hit landed, are not stored for ordinary hits.
