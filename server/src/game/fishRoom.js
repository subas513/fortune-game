import { FISH, WORLD, SEATS, BULLET, BOSS_IDS, SCENES, LASER, fishState, hitsFish, onScreen } from '../../../shared/fishTypes.js';
import { fishOutcome } from '../../../shared/fair.js';
import { crand } from './rng.js';
import { gameDebit, gameCredit } from '../wallet.js';
import { takeRound, roundBytes } from '../fair/seeds.js';
import { isHealthy } from '../fair/health.js';
import { recordRound, roundTx } from '../rounds.js';

const { W, H } = WORLD;
const TICK_MS = 200;
// Round log size control: ordinary hits are logged in batches (one row per player every few
// seconds); wins of NOTABLE_MULT× the bet or more, bomb/chain/boss catches and rejected hits get full rows.
const BATCH_MS = 10_000;
const BATCH_MAX = 400;
const NOTABLE_MULT = 20;
const SCENE_MS = 180_000;     // background/tide change
const TIDE_CLEAR_MS = 2600;   // pause after tide before formation
const WEIGHTED = FISH.filter((f) => f.weight > 0);
const WEIGHT_SUM = WEIGHTED.reduce((s, f) => s + f.weight, 0);

function weightedType() {
  let r = crand() * WEIGHT_SUM;
  for (const f of WEIGHTED) { if ((r -= f.weight) <= 0) return f.id; }
  return 0;
}

const R = (v) => Math.round(v);

/** Random entry/exit across the screen. */
function randomPath(type) {
  const t = FISH[type];
  const m = Math.max(t.rx, t.ry) + 30;
  const horizontal = crand() < 0.72;
  let x0, y0, x3, y3;
  if (horizontal) {
    const ltr = crand() < 0.5;
    x0 = ltr ? -m : W + m; x3 = ltr ? W + m : -m;
    y0 = 60 + crand() * (H - 120); y3 = 60 + crand() * (H - 120);
  } else {
    const ttb = crand() < 0.5;
    y0 = ttb ? -m : H + m; y3 = ttb ? H + m : -m;
    x0 = 150 + crand() * (W - 300); x3 = 150 + crand() * (W - 300);
  }
  const x1 = W * (0.15 + crand() * 0.7), y1 = H * (0.15 + crand() * 0.7);
  const x2 = W * (0.15 + crand() * 0.7), y2 = H * (0.15 + crand() * 0.7);
  return [x0, y0, x1, y1, x2, y2, x3, y3];
}

function pathDuration(p, speed) {
  const d = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const chord = d(p[0], p[1], p[6], p[7]);
  const poly = d(p[0], p[1], p[2], p[3]) + d(p[2], p[3], p[4], p[5]) + d(p[4], p[5], p[6], p[7]);
  return ((chord + poly) / 2 / speed) * 1000;
}

function straightPath(x0, y0, x3, y3) {
  return [x0, y0, x0 + (x3 - x0) / 3, y0 + (y3 - y0) / 3, x0 + (2 * (x3 - x0)) / 3, y0 + (2 * (y3 - y0)) / 3, x3, y3];
}

/**
 * One fish table: up to 4 players share the same fish. The server owns fish spawning,
 * bullet accounting and capture decisions; clients only simulate visuals and report
 * which fish their bullet touched.
 */
export class FishRoom {
  constructor(tpl, instanceNo, onEmpty) {
    this.tpl = tpl;              // live room template (rtp/bets can change)
    this.id = `${tpl.id}#${instanceNo}`;
    this.onEmpty = onEmpty;
    this.seats = [null, null, null, null];
    this.fish = new Map();
    this.nextFishId = 1;
    this.scene = { reef: 0, lagoon: 1, abyss: 2 }[tpl.id] ?? Math.floor(crand() * SCENES.length);
    this.sceneAt = Date.now();
    this.pauseSpawnUntil = 0;
    this.nextBossAt = Date.now() + 25_000 + crand() * 20_000;
    this.bossToggle = crand() < 0.5 ? 0 : 1;
    this.timer = null;
  }

  get playerCount() { return this.seats.filter(Boolean).length; }
  hasFreeSeat() { return this.seats.some((s) => !s); }

  // ---- lifecycle ----
  join(client) {
    const seat = this.seats.findIndex((s) => !s);
    if (seat < 0) return false;
    this.seats[seat] = client;
    client.seat = seat;
    client.bullets = new Map();
    client.lastShot = 0;
    client.level = this.tpl.betLevels[0];
    client.weapon = 'cannon';
    client.lastZap = 0;
    if (!this.timer) this.start();
    client.send({
      t: 'joined', game: 'fish', room: this.tpl.public, seat, scene: this.scene, now: Date.now(),
      players: this.seatInfo(), fish: [...this.fish.values()].map(this.wire),
    });
    this.broadcast({ t: 'pjoin', s: seat, p: this.seatOf(client) }, client);
    return true;
  }

  leave(client) {
    const seat = this.seats.indexOf(client);
    if (seat < 0) return;
    this.flushBatch(client);
    // Refund bullets still in flight: they never got a chance to hit anything.
    let refund = 0;
    for (const b of client.bullets.values()) refund += b.bet;
    client.bullets.clear();
    if (refund) client.balance = gameCredit(client.playerId, refund);
    if (refund) client.stats.bet -= refund;
    this.seats[seat] = null;
    client.seat = -1;
    this.broadcast({ t: 'pleave', s: seat });
    if (this.playerCount === 0) this.stop();
  }

  start() {
    this.fillInitial();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.fish.clear();
    this.onEmpty(this);
  }

  // ---- helpers ----
  seatOf(c) { return { name: c.nickname, bal: c.balance, lv: c.level, w: c.weapon }; }
  seatInfo() { return this.seats.map((c) => (c ? this.seatOf(c) : null)); }
  wire(f) { return { id: f.id, ty: f.ty, p: f.p.map(R), t0: f.t0, d: R(f.d) }; }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const c of this.seats) if (c && c !== except) c.sendRaw(data);
  }

  addFish(ty, p, t0, speedMul = 1) {
    const f = { id: this.nextFishId++, ty, p, t0, d: pathDuration(p, FISH[ty].speed * speedMul) };
    this.fish.set(f.id, f);
    return f;
  }

  // ---- spawning ----
  fillInitial() {
    const now = Date.now();
    const out = [];
    for (let i = 0; i < 22; i++) {
      const ty = weightedType();
      const p = randomPath(ty);
      const f = this.addFish(ty, p, now, 1);
      f.t0 = now - f.d * (0.1 + crand() * 0.6); // already mid-swim
      out.push(f);
    }
  }

  spawnSingle(now) {
    const ty = weightedType();
    return [this.addFish(ty, randomPath(ty), now)];
  }

  spawnSchool(now) {
    const ty = Math.floor(crand() * 4); // small fish
    const n = 4 + Math.floor(crand() * 5);
    const base = randomPath(ty);
    const line = crand() < 0.5;
    const out = [];
    for (let i = 0; i < n; i++) {
      const ox = line ? 0 : (crand() - 0.5) * 70, oy = line ? 0 : (crand() - 0.5) * 70;
      const p = base.map((v, k) => v + (k % 2 === 0 ? ox : oy));
      out.push(this.addFish(ty, p, now + (line ? i * 420 : crand() * 500)));
    }
    return out;
  }

  spawnBoss(now) {
    const ty = BOSS_IDS[this.bossToggle++ % BOSS_IDS.length];
    const ltr = crand() < 0.5;
    const m = FISH[ty].rx + 40;
    const y0 = H * (0.3 + crand() * 0.4), y3 = H * (0.3 + crand() * 0.4);
    const p = [ltr ? -m : W + m, y0, W * 0.35, H * (0.2 + crand() * 0.6), W * 0.65, H * (0.2 + crand() * 0.6), ltr ? W + m : -m, y3];
    const f = this.addFish(ty, p, now + 3000); // 3s warning lead time
    this.broadcast({ t: 'boss', ty, at: f.t0 });
    return [f];
  }

  /** After a tide: lines of fish parading across the screen. */
  spawnFormation(now) {
    const out = [];
    const ltr = crand() < 0.5;
    const xs = ltr ? -60 : W + 60, xe = ltr ? W + 60 : -60;
    const rows = [
      { y: 110, ty: 0, n: 14, gap: 260 }, { y: 610, ty: 0, n: 14, gap: 260 },
      { y: 220, ty: 2, n: 9, gap: 400 }, { y: 500, ty: 2, n: 9, gap: 400 },
      { y: 360, ty: [7, 6, 9, 8, 6, 10, 7], n: 7, gap: 900 },
    ];
    for (const r of rows) {
      for (let i = 0; i < r.n; i++) {
        const ty = Array.isArray(r.ty) ? r.ty[i % r.ty.length] : r.ty;
        out.push(this.addFish(ty, straightPath(xs, r.y, xe, r.y), now + i * r.gap, 1.1));
      }
    }
    return out;
  }

  tick() {
    const now = Date.now();
    for (const c of this.seats) if (c?.batch && now - c.batch.at > BATCH_MS) this.flushBatch(c);
    // Expire fish that finished their path, and stale bullets (refund).
    for (const [id, f] of this.fish) if (now > f.t0 + f.d + 500) this.fish.delete(id);
    for (const c of this.seats) {
      if (!c) continue;
      let refund = 0;
      for (const [bid, b] of c.bullets) if (now - b.t > BULLET.lifeMs + 6000) { refund += b.bet; c.bullets.delete(bid); }
      if (refund) {
        c.balance = gameCredit(c.playerId, refund);
        c.stats.bet -= refund;
        this.broadcast({ t: 'bal', s: c.seat, bal: c.balance });
      }
    }

    // Scene change: tide sweeps all fish away, then a formation enters.
    if (now - this.sceneAt > SCENE_MS) {
      this.scene = (this.scene + 1) % SCENES.length;
      this.sceneAt = now;
      this.fish.clear();
      this.pauseSpawnUntil = now + TIDE_CLEAR_MS;
      this.formationAt = now + TIDE_CLEAR_MS;
      this.broadcast({ t: 'scene', n: this.scene, at: now });
      return;
    }
    if (this.formationAt && now >= this.formationAt) {
      this.formationAt = 0;
      this.pauseSpawnUntil = now + 14_000;
      this.sendSpawn(this.spawnFormation(now));
      return;
    }
    if (now < this.pauseSpawnUntil) return;

    const spawned = [];
    if (now >= this.nextBossAt && ![...this.fish.values()].some((f) => BOSS_IDS.includes(f.ty))) {
      spawned.push(...this.spawnBoss(now));
      this.nextBossAt = now + 70_000 + crand() * 40_000;
    }
    const target = Math.min(40, 22 + this.playerCount * 4);
    if (this.fish.size < target) {
      const r = crand();
      spawned.push(...(r < 0.22 ? this.spawnSchool(now) : this.spawnSingle(now)));
    }
    if (spawned.length) this.sendSpawn(spawned);
  }

  sendSpawn(list) {
    this.broadcast({ t: 'fish', list: list.map(this.wire) });
  }

  // ---- player actions ----
  onLevel(c, msg) {
    const b = Number(msg.b);
    if (!this.tpl.betLevels.includes(b)) return;
    c.level = b;
    this.broadcast({ t: 'lv', s: c.seat, b });
  }

  onFire(c, msg) {
    const now = Date.now();
    const id = msg.id | 0, a = Number(msg.a), bet = Number(msg.b);
    if (!Number.isFinite(a) || !this.tpl.betLevels.includes(bet)) return;
    if (c.weapon !== 'cannon' || c.bullets.has(id) || c.bullets.size >= BULLET.maxInFlight) return c.send({ t: 'nofire', id });
    if (now - c.lastShot < BULLET.minIntervalMs) return c.send({ t: 'nofire', id });
    if (!isHealthy()) {
      c.send({ t: 'error', code: 'GAME_CLOSED', msg: 'The game is temporarily closed. Please try again later.' });
      return c.send({ t: 'nofire', id });
    }
    const bal = gameDebit(c.playerId, bet);
    if (bal == null) return c.send({ t: 'nofunds', id });
    c.lastShot = now;
    c.balance = bal;
    c.level = bet;
    const lk = this.fish.has(msg.lk | 0) ? msg.lk | 0 : 0;
    c.bullets.set(id, { bet, t: now, lk });
    c.stats.bet += bet;
    c.stats.shots++;
    this.broadcast({ t: 'shot', s: c.seat, id, a: +a.toFixed(4), b: bet, lk, bal });
  }

  onHit(c, msg) {
    const now = Date.now();
    const bid = msg.id | 0, fid = msg.f | 0, x = Number(msg.x), y = Number(msg.y);
    const b = c.bullets.get(bid);
    if (!b || !Number.isFinite(x) || !Number.isFinite(y)) return;
    c.bullets.delete(bid);
    this.broadcast({ t: 'hit', s: c.seat, id: bid, x: R(x), y: R(y) }, c);

    const fish = this.fish.get(fid);
    if (!fish || now > fish.t0 + fish.d) {
      // Target already gone (caught by someone else): give the shot back.
      c.balance = gameCredit(c.playerId, b.bet);
      c.stats.bet -= b.bet;
      this.broadcast({ t: 'bal', s: c.seat, bal: c.balance });
      return;
    }
    // Plausibility: the reported impact must be near the fish at roughly "now" (allowing latency).
    let st = null;
    for (const dt of [0, 120, 240, 400]) {
      const s = fishState(fish, now - dt);
      if (s && hitsFish(fish.ty, s.x, s.y, s.a, x, y, BULLET.radius + 45)) { st = s; break; }
    }
    if (!st) {
      // Bullet consumed without a roll; logged so disputes can see why.
      roundTx(() => recordRound({
        playerId: c.playerId, agentId: c.agentId, roomId: this.tpl.id, game: 'fish', status: 'rejected',
        bet: b.bet, win: 0, balanceAfter: c.balance,
        detail: { fishType: fish.ty, hit: { x: R(x), y: R(y) }, reason: 'impact point not near the fish' },
      }));
      return;
    }

    this.resolveCapture(c, fish, st, b.bet, now);
  }

  resolveCapture(c, fish, st, bet, now, weapon = 'cannon') {
    const t = FISH[fish.ty];
    const victims = [fish];
    if (t.kind === 'bomb' || t.kind === 'chain') {
      const cands = [];
      for (const f of this.fish.values()) {
        if (f === fish || FISH[f.ty].kind) continue; // only plain fish join a bomb/chain
        const s = fishState(f, now);
        if (!s || !onScreen(s.x, s.y, -10)) continue;
        cands.push({ f, d: Math.hypot(s.x - st.x, s.y - st.y) });
      }
      if (t.kind === 'bomb') victims.push(...cands.filter((k) => k.d <= t.radius).map((k) => k.f));
      else victims.push(...cands.sort((a, b) => a.d - b.d).slice(0, t.chain).map((k) => k.f));
    }
    if (!isHealthy()) {
      c.balance = gameCredit(c.playerId, bet);
      c.stats.bet -= bet;
      this.broadcast({ t: 'bal', s: c.seat, bal: c.balance });
      return;
    }
    // One provably-fair roll per hit (shared/fair.js). Capture chance = rtp / Σ multipliers, so the
    // expected return of every shot is exactly the room RTP. The round is written in the same
    // transaction as the payout, before anything is broadcast.
    const rtp = this.tpl.rtp;
    const res = roundTx(() => {
      const seed = takeRound(c.playerId);
      const types = victims.map((f) => f.ty);
      const out = fishOutcome(roundBytes(seed.serverSeed, seed.clientSeed, seed.nonce), { rtp, victimTypes: types });
      const win = out.captured ? bet * out.totalMult : 0;
      const bal = gameCredit(c.playerId, win);
      // Only notable rounds get their own row; ordinary hits are packed into one row per batch.
      const notable = out.captured && (!!t.kind || victims.length > 1 || win >= bet * NOTABLE_MULT);
      const b = c.batch;
      if (b && (notable || b.seedId !== seed.seedId || b.start + b.n !== seed.nonce || b.rtp !== rtp || b.bet !== bet || b.n >= BATCH_MAX)) {
        this.recordBatch(c);
      }
      if (notable) {
        recordRound({
          playerId: c.playerId, agentId: c.agentId, roomId: this.tpl.id, game: 'fish',
          bet, win, balanceAfter: bal, seedId: seed.seedId, nonce: seed.nonce,
          detail: { weapon, kind: t.kind || '', victims: types, rtp, p: out.p, roll: out.roll, captured: true, mults: out.mults },
        });
      } else {
        if (!c.batch) c.batch = { seedId: seed.seedId, start: seed.nonce, n: 0, rtp, bet, v: [], betSum: 0, winSum: 0, wins: 0, at: Date.now() };
        const nb = c.batch;
        nb.n++; nb.v.push(types.join('.')); nb.betSum += bet; nb.winSum += win; nb.bal = bal;
        if (win) nb.wins++;
      }
      return { out, win, bal };
    });
    c.balance = res.bal;
    if (!res.out.captured) return;

    const mults = res.out.mults;
    const win = res.win;
    for (const f of victims) this.fish.delete(f.id);
    c.stats.win += win;
    c.stats.kills += victims.length;
    this.broadcast({
      t: 'kill', s: c.seat, f: victims.map((f) => f.id), m: mults, w: win, b: bet,
      x: R(st.x), y: R(st.y), k: t.kind || '', bal: c.balance,
    });
  }

  /** Write the player's pending batch of ordinary hits as one round row (call inside a transaction). */
  recordBatch(c) {
    const b = c.batch;
    if (!b) return;
    c.batch = null;
    recordRound({
      playerId: c.playerId, agentId: c.agentId, roomId: this.tpl.id, game: 'fish',
      bet: b.betSum, win: b.winSum, balanceAfter: b.bal, seedId: b.seedId, nonce: b.start,
      detail: { kind: 'batch', rtp: b.rtp, bet: b.bet, n: b.n, wins: b.wins, v: b.v.join(',') },
    });
  }

  flushBatch(c) {
    if (c.batch) roundTx(() => this.recordBatch(c));
  }

  /** Switch between the cannon and the laser gun. */
  onWeapon(c, msg) {
    const w = msg.w === 'laser' ? 'laser' : 'cannon';
    if (w === c.weapon) return;
    c.weapon = w;
    this.broadcast({ t: 'wpn', s: c.seat, w });
  }

  /**
   * One laser shock: costs one bet and is one capture attempt on the fish the beam is touching,
   * with exactly the same odds as a bullet hit. Nothing is charged if the target is already gone.
   */
  onZap(c, msg) {
    const now = Date.now();
    const bet = Number(msg.b), fid = msg.f | 0, x = Number(msg.x), y = Number(msg.y), a = Number(msg.a);
    if (c.weapon !== 'laser' || !this.tpl.betLevels.includes(bet) || ![x, y, a].every(Number.isFinite)) return;
    if (now - c.lastZap < LASER.zapMs - 40) return c.send({ t: 'nozap' });
    if (!isHealthy()) return c.send({ t: 'error', code: 'GAME_CLOSED', msg: 'The game is temporarily closed. Please try again later.' });
    const fish = this.fish.get(fid);
    if (!fish || now > fish.t0 + fish.d) return c.send({ t: 'nozap' });
    let st = null;
    for (const dt of [0, 120, 240, 400]) {
      const s2 = fishState(fish, now - dt);
      if (s2 && hitsFish(fish.ty, s2.x, s2.y, s2.a, x, y, 60)) { st = s2; break; }
    }
    if (!st) return c.send({ t: 'nozap' });
    const bal = gameDebit(c.playerId, bet);
    if (bal == null) return c.send({ t: 'nofunds', id: 0 });
    c.lastZap = now;
    c.balance = bal;
    c.level = bet;
    c.stats.bet += bet;
    c.stats.shots++;
    this.broadcast({ t: 'zap', s: c.seat, f: fid, a: +a.toFixed(4), b: bet, bal });
    this.resolveCapture(c, fish, st, bet, now, 'laser');
  }

  onBalanceChanged(c) {
    this.broadcast({ t: 'bal', s: c.seat, bal: c.balance });
  }
}
