import { FISH, WORLD, SEATS, BULLET, LASER, beamDistance, fishState, hitsFish, onScreen, expectedMult, multLabel, SCENES } from '/shared/fishTypes.js';
import { drawFishSprite, drawFishIcon, buildBackground, drawCannon, drawBullet, drawNet, drawCoin, goldText, panel, fmt, FONT, lin, rad, TAU, drawAudioIcon, drawOffSlash } from './art.js';
import { sfx, startMusic, audioPrefs, setSfx, setMusic } from './audio.js';

const { W, H } = WORLD;
const FIRE_MS = 190;
const bgCache = new Map();
const bgFor = (n) => { if (!bgCache.has(n)) bgCache.set(n, buildBackground(n)); return bgCache.get(n); };

export class FishScene {
  constructor(app, joined) {
    this.app = app;
    this.net = app.net;
    this.room = joined.room;
    this.levels = joined.room.betLevels;
    this.mySeat = joined.seat;
    this.flip = this.mySeat >= 2;
    this.scene = joined.scene;
    this.bg = bgFor(this.scene);
    this.fish = new Map();
    this.dying = [];
    this.bullets = [];
    this.nets = [];
    this.coins = [];
    this.texts = [];
    this.fx = [];               // shockwaves, lightning
    this.pending = new Map();   // my unacknowledged shots: id -> bet
    this.nextBulletId = 1;
    this.lastFire = 0;
    this.aim = { x: W / 2, y: H / 2 };
    this.firing = false;
    this.auto = false;
    this.lockMode = false;
    this.lockId = 0;
    this.showInfo = false;
    this.banner = null;         // big win
    this.warning = null;        // boss incoming
    this.tide = null;
    this.lowFundsAt = 0;
    this.time = 0;
    this.shake = 0;

    this.seats = joined.players.map((p, s) => this.makeSeat(p, s));
    for (const f of joined.fish) this.addFish(f);
    this.levelIdx = Math.max(0, this.levels.indexOf(this.seats[this.mySeat].lv));

    this.unsub = [
      this.net.on('fish', (m) => m.list.forEach((f) => this.addFish(f))),
      this.net.on('shot', (m) => this.onShot(m)),
      this.net.on('hit', (m) => this.onRemoteHit(m)),
      this.net.on('kill', (m) => this.onKill(m)),
      this.net.on('nofire', (m) => this.dropPending(m.id)),
      this.net.on('nofunds', (m) => { this.dropPending(m.id); this.noFunds(); }),
      this.net.on('bal', (m) => { if (this.seats[m.s]) this.seats[m.s].bal = m.bal; }),
      this.net.on('lv', (m) => { if (this.seats[m.s]) this.seats[m.s].lv = m.b; }),
      this.net.on('pjoin', (m) => { this.seats[m.s] = this.makeSeat(m.p, m.s); }),
      this.net.on('pleave', (m) => { this.seats[m.s] = this.makeSeat(null, m.s); this.bullets = this.bullets.filter((b) => b.s !== m.s); }),
      this.net.on('boss', (m) => { this.warning = { ty: m.ty, t: 0 }; sfx.warning(); }),
      this.net.on('wpn', (m) => { if (this.seats[m.s]) this.seats[m.s].w = m.w; }),
      this.net.on('zap', (m) => this.onZap(m)),
      this.net.on('scene', (m) => this.startTide(m.n)),
    ];
    this.buildButtons();
    startMusic('sea');
  }

  destroy() { this.unsub.forEach((u) => u()); }

  // ---- coordinate helpers (world <-> view; top-seat players see the world rotated 180°) ----
  vx(x) { return this.flip ? W - x : x; }
  vy(y) { return this.flip ? H - y : y; }
  va(a) { return this.flip ? a + Math.PI : a; }
  seatView(s) { const p = SEATS[s]; return { x: this.vx(p.x), y: this.vy(p.y) }; }

  makeSeat(p, s) {
    const v = this.seatView(s);
    const bottom = v.y > H / 2;
    return p ? { present: true, name: p.name, bal: p.bal, lv: p.lv, angle: bottom ? -Math.PI / 2 : Math.PI / 2, recoil: 0, w: p.w || 'cannon', zap: null }
      : { present: false, angle: bottom ? -Math.PI / 2 : Math.PI / 2, recoil: 0 };
  }

  tierOf(bet) {
    const i = this.levels.indexOf(bet), n = this.levels.length;
    return i < n / 3 ? 0 : i < (2 * n) / 3 ? 1 : 2;
  }

  get bet() { return this.levels[this.levelIdx]; }
  get myBal() {
    let p = 0;
    for (const b of this.pending.values()) p += b;
    return this.seats[this.mySeat].bal - p;
  }

  plateRect(s) {
    const v = this.seatView(s);
    const left = v.x < W / 2;
    // keep clear of the bet −/+ buttons (cannon x ± 104, radius 21)
    const w = 180;
    const x = left ? v.x - 140 - w : v.x + 140;
    const y = v.y > H / 2 ? H - 64 : 10;
    return { x, y, w, h: 54 };
  }

  addFish(f) {
    const p = this.flip ? f.p.map((v, i) => (i % 2 === 0 ? W - v : H - v)) : f.p;
    this.fish.set(f.id, { id: f.id, ty: f.ty, p, t0: f.t0, d: f.d, flash: 0, s: null });
  }

  // ---- UI buttons ----
  buildButtons() {
    const me = this.seatView(this.mySeat);
    const by = H - 34;
    this.buttons = [
      { id: 'minus', x: me.x - 104, y: by, r: 21, label: '−', act: () => this.changeLevel(-1) },
      { id: 'plus', x: me.x + 104, y: by, r: 21, label: '+', act: () => this.changeLevel(1) },
      // play controls: vertical column on the right edge (mirrors the menu column on the left)
      { id: 'auto', x: W - 40, y: 290, r: 30, label: 'AUTO', on: () => this.auto, act: () => this.toggleAuto() },
      { id: 'lock', x: W - 40, y: 360, r: 30, label: 'LOCK', on: () => this.lockMode, act: () => this.toggleLock() },
      { id: 'weapon', x: W - 40, y: 430, r: 30, label: '⚡', sub: 'LASER', on: () => this.seats[this.mySeat].w === 'laser', act: () => this.toggleWeapon() },
      { id: 'exit', x: 34, y: 250, r: 24, label: '⏏', act: () => this.exit() },
      { id: 'info', x: 34, y: 308, r: 24, label: 'i', act: () => { this.showInfo = !this.showInfo; } },
      { id: 'sound', x: 34, y: 366, r: 24, label: '', icon: 'sfx', off: () => !audioPrefs().sfx, act: () => setSfx(!audioPrefs().sfx) },
      { id: 'music', x: 34, y: 424, r: 24, label: '', icon: 'music', off: () => !audioPrefs().music, act: () => setMusic(!audioPrefs().music) },
      { id: 'full', x: 34, y: 482, r: 24, label: '⛶', act: () => this.app.toggleFullscreen() },
    ];
  }

  /** −/+ wrap around: + on the highest bet goes to the lowest, − on the lowest goes to the highest. */
  changeLevel(d) {
    const n = this.levels.length;
    this.levelIdx = (((this.levelIdx + d) % n) + n) % n;
    this.seats[this.mySeat].lv = this.bet;
    this.net.send({ t: 'lv', b: this.bet });
    sfx.click();
  }
  toggleAuto() { this.auto = !this.auto; sfx.click(); }
  toggleLock() {
    this.lockMode = !this.lockMode;
    if (!this.lockMode) this.lockId = 0;
    sfx.click();
  }
  async exit() {
    if (await this.app.confirm('Leave this table and return to the lobby?')) this.app.leaveRoom();
  }

  // ---- input ----
  pointerDown(x, y) {
    if (this.showInfo) { this.showInfo = false; return; }
    for (const b of this.buttons) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r + 6) { b.act(); return; }
    }
    this.aim = { x, y };
    if (this.lockMode) {
      const f = this.fishAt(x, y);
      if (f) { this.lockId = f.id; sfx.click(); return; }
    }
    this.firing = true;
    this.aimCannon();
    this.tryFire(performance.now());
  }
  pointerMove(x, y) { this.aim = { x, y }; }
  pointerUp() { this.firing = false; }
  keyDown(e) {
    if (e.code === 'Space') { this.toggleAuto(); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'ArrowRight') this.changeLevel(1);
    else if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') this.changeLevel(-1);
    else if (e.code === 'KeyL') this.toggleLock();
    else if (e.code === 'KeyZ') this.toggleWeapon();
    else if (e.code === 'Escape') { if (this.showInfo) this.showInfo = false; else this.exit(); }
  }

  fishAt(x, y) {
    let best = null;
    for (const f of this.fish.values()) {
      if (!f.s) continue;
      if (hitsFish(f.ty, f.s.x, f.s.y, f.s.a, x, y, 14) && (!best || expectedMult(f.ty) > expectedMult(best.ty))) best = f;
    }
    return best;
  }

  pickLockTarget() {
    let best = null;
    for (const f of this.fish.values()) {
      if (!f.s || !onScreen(f.s.x, f.s.y, -30)) continue;
      if (!best || expectedMult(f.ty) > expectedMult(best.ty)) best = f;
    }
    return best;
  }

  /** Point my cannon at the locked fish or the pointer. Returns the locked fish, if any. */
  aimCannon() {
    const mv = this.seatView(this.mySeat);
    let lockFish = this.lockMode && this.lockId ? this.fish.get(this.lockId) : null;
    if (this.lockMode && (!lockFish || !lockFish.s || !onScreen(lockFish.s.x, lockFish.s.y, -20))) {
      lockFish = this.pickLockTarget();
      this.lockId = lockFish ? lockFish.id : 0;
    }
    const target = lockFish?.s ? lockFish.s : this.aim;
    const a = Math.atan2(target.y - mv.y, target.x - mv.x);
    this.seats[this.mySeat].angle = Math.max(-Math.PI + 0.1, Math.min(-0.1, a));
    return lockFish;
  }

  // ---- shooting ----
  tryFire(now) {
    if (this.seats[this.mySeat].w === 'laser') return this.tryZap(now);
    if (now - this.lastFire < FIRE_MS) return;
    const mine = this.bullets.filter((b) => b.mine).length;
    if (mine >= BULLET.maxInFlight) return;
    if (this.myBal < this.bet) { this.noFunds(); return; }
    this.lastFire = now;
    const seat = this.seats[this.mySeat];
    const a = seat.angle;
    const id = this.nextBulletId++;
    const lk = this.lockMode ? this.lockId : 0;
    this.spawnBullet(this.mySeat, id, a, this.bet, lk, true);
    this.pending.set(id, this.bet);
    seat.recoil = 1;
    this.net.send({ t: 'fire', id, a: this.va(a), b: this.bet, lk });
    sfx.shoot(this.tierOf(this.bet));
  }

  spawnBullet(s, id, a, bet, lk, mine) {
    const v = this.seatView(s);
    this.bullets.push({
      id, s, mine, bet, lk, tier: this.tierOf(bet), born: performance.now(),
      x: v.x + Math.cos(a) * 80, y: v.y + Math.sin(a) * 80,
      vx: Math.cos(a) * BULLET.speed, vy: Math.sin(a) * BULLET.speed,
    });
  }

  dropPending(id) {
    this.pending.delete(id);
    this.bullets = this.bullets.filter((b) => !(b.mine && b.id === id));
  }

  noFunds() {
    // stop everything that fires on its own: AUTO, LOCK (which also fires) and a held trigger
    this.auto = false;
    this.lockMode = false;
    this.lockId = 0;
    this.firing = false;
    const now = performance.now();
    if (now - this.lowFundsAt > 3000) {
      this.lowFundsAt = now;
      this.app.toast('Not enough credits.');
      sfx.error();
    }
  }

  // ---- network events ----
  onShot(m) {
    const seat = this.seats[m.s];
    if (!seat) return;
    seat.bal = m.bal;
    seat.lv = m.b;
    if (m.s === this.mySeat) { this.pending.delete(m.id); return; }
    const a = this.va(m.a);
    seat.angle = a;
    seat.recoil = 1;
    this.spawnBullet(m.s, m.id, a, m.b, m.lk, false);
  }

  onRemoteHit(m) {
    const i = this.bullets.findIndex((b) => !b.mine && b.s === m.s && b.id === m.id);
    if (i >= 0) {
      const b = this.bullets[i];
      this.bullets.splice(i, 1);
      this.nets.push({ x: this.vx(m.x), y: this.vy(m.y), t: 0, tier: b.tier });
    }
  }

  onKill(m) {
    const seat = this.seats[m.s];
    if (seat) seat.bal = m.bal;
    const mine = m.s === this.mySeat;
    const plate = this.plateRect(m.s);
    const target = { x: plate.x + 30, y: plate.y + 27 };
    const ox = this.vx(m.x), oy = this.vy(m.y);
    const totalMult = m.m.reduce((a, b) => a + b, 0);
    const victims = [];
    m.f.forEach((id, i) => {
      const f = this.fish.get(id);
      if (!f) return;
      const s = f.s || { x: ox, y: oy, a: 0 };
      victims.push(s);
      this.dying.push({ ty: f.ty, x: s.x, y: s.y, a: s.a, t: 0, mult: m.m[i] });
      this.fish.delete(id);
      if (this.lockId === id) this.lockId = 0;
      const n = m.m[i] ? Math.max(2, Math.min(14, Math.round(m.m[i] / 3))) : 0;
      for (let k = 0; k < n; k++) {
        this.coins.push({ x: s.x + (Math.random() - 0.5) * 40, y: s.y + (Math.random() - 0.5) * 40, sx: s.x, sy: s.y,
          tx: target.x, ty: target.y, t: -k * 0.05 - Math.random() * 0.15, dur: 0.9 + Math.random() * 0.3, spin: Math.random() * TAU, mine });
      }
    });
    this.texts.push({ x: ox, y: oy - 20, text: `+${fmt(m.w)}`, t: 0, size: mine ? (totalMult >= 30 ? 44 : 32) : 22, mine });
    if (m.k === 'bomb') { this.fx.push({ kind: 'shock', x: ox, y: oy, t: 0 }); this.shake = 0.5; sfx.explosion(); }
    if (m.k === 'chain') { this.fx.push({ kind: 'bolt', x: ox, y: oy, to: victims.slice(1), t: 0 }); sfx.zap(); }
    if (mine) {
      sfx.coin(totalMult >= 20);
      if (totalMult >= 30) {
        this.banner = { amount: m.w, t: 0, label: totalMult >= 150 ? 'MEGA WIN' : totalMult >= 80 ? 'SUPER WIN' : 'BIG WIN' };
        sfx.bigWin();
        if (totalMult >= 80) this.shake = 0.6;
      }
    }
  }

  // ---- laser gun ----
  toggleWeapon() {
    const me = this.seats[this.mySeat];
    me.w = me.w === 'laser' ? 'cannon' : 'laser';
    this.net.send({ t: 'wpn', w: me.w });
    this.app.toast(me.w === 'laser' ? 'LASER GUN: hold to shock fish (1 bet per shock)' : 'CANNON');
    sfx.click();
  }

  /** First fish the beam touches from my muzzle, or the locked fish. */
  beamTarget() {
    const v = this.seatView(this.mySeat), a = this.seats[this.mySeat].angle;
    if (this.lockMode && this.lockId) {
      const lf = this.fish.get(this.lockId);
      if (lf?.s && onScreen(lf.s.x, lf.s.y, -10)) return lf;
    }
    const ox = v.x + Math.cos(a) * 80, oy = v.y + Math.sin(a) * 80;
    let best = null, bd = Infinity;
    for (const f of this.fish.values()) {
      if (!f.s || !onScreen(f.s.x, f.s.y, -10)) continue;
      const d = beamDistance(f.ty, ox, oy, a, f.s.x, f.s.y);
      if (d >= 0 && d < bd) { bd = d; best = f; }
    }
    return best;
  }

  tryZap(now) {
    if (now - this.lastFire < LASER.zapMs) return;
    const target = this.beamTarget();
    if (!target) return; // beam hits nothing: no charge
    if (this.myBal < this.bet) { this.noFunds(); return; }
    this.lastFire = now;
    target.flash = 1;
    this.net.send({ t: 'zap', a: this.va(this.seats[this.mySeat].angle), b: this.bet, f: target.id, x: Math.round(this.vx(target.s.x)), y: Math.round(this.vy(target.s.y)) });
    sfx.shock();
  }

  onZap(m) {
    const seat = this.seats[m.s];
    if (!seat) return;
    seat.bal = m.bal;
    seat.lv = m.b;
    if (m.s === this.mySeat) return;
    seat.angle = this.va(m.a);
    seat.zap = { f: m.f, until: performance.now() + 320 };
    const f = this.fish.get(m.f);
    if (f) f.flash = 1;
  }

  renderLaserCannon(ctx, v, seat, t) {
    const a = seat.angle;
    const pulse = 0.5 + 0.5 * Math.sin(t * 10);
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rad(ctx, 0, 0, 10, 90, [[0, `rgba(120,240,255,${0.35 + 0.25 * pulse})`], [1, 'rgba(80,120,255,0)']]);
    ctx.beginPath(); ctx.arc(0, 0, 90, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.rotate(a);
    ctx.fillStyle = lin(ctx, 0, -14, 0, 14, [[0, '#e8ffff'], [0.5, '#2a8cff'], [1, '#0a2a7a']]);
    ctx.beginPath(); ctx.roundRect(10, -13, 74, 26, 8); ctx.fill();
    ctx.strokeStyle = '#bff4ff'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = `rgba(200,255,255,${0.4 + 0.6 * ((Math.sin(t * 12 - i) + 1) / 2)})`;
      ctx.fillRect(28 + i * 16, -9, 7, 18);
    }
    // forked emitter
    ctx.strokeStyle = '#dff'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(84, -10); ctx.lineTo(96, -14); ctx.moveTo(84, 10); ctx.lineTo(96, 14); ctx.stroke();
    ctx.fillStyle = rad(ctx, 92, 0, 0, 16, [[0, '#fff'], [0.4, `rgba(120,240,255,${0.6 + 0.4 * pulse})`], [1, 'rgba(80,120,255,0)']]);
    ctx.beginPath(); ctx.arc(92, 0, 16, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** Crackling electric beam from a seat's muzzle to (tx,ty). */
  drawLightning(ctx, x0, y0, x1, y1, mine, hit) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    const segs = Math.max(6, Math.round(len / 28));
    const path = (amp) => {
      const pts = [[x0, y0]];
      for (let i = 1; i < segs; i++) {
        const u = i / segs, j = (Math.random() - 0.5) * amp * Math.sin(u * Math.PI);
        pts.push([x0 + (x1 - x0) * u + nx * j, y0 + (y1 - y0) * u + ny * j]);
      }
      pts.push([x1, y1]);
      return pts;
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = mine ? 'rgba(90,170,255,0.35)' : 'rgba(90,170,255,0.22)';
    ctx.lineWidth = LASER.halfWidth * 1.6;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    for (const [amp, w, col] of [[34, 5, 'rgba(140,220,255,0.8)'], [22, 3, 'rgba(200,250,255,0.95)'], [12, 2, '#ffffff']]) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); path(amp).forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke();
    }
    if (hit) {
      ctx.fillStyle = rad(ctx, x1, y1, 0, 46, [[0, 'rgba(255,255,255,0.95)'], [0.35, 'rgba(140,230,255,0.6)'], [1, 'rgba(80,120,255,0)']]);
      ctx.beginPath(); ctx.arc(x1, y1, 46, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(220,250,255,0.9)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const an = Math.random() * TAU, r = 18 + Math.random() * 26;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + Math.cos(an) * r * 0.5 + (Math.random() - 0.5) * 8, y1 + Math.sin(an) * r * 0.5); ctx.lineTo(x1 + Math.cos(an) * r, y1 + Math.sin(an) * r); ctx.stroke();
      }
    }
    ctx.restore();
  }

  renderBeams(ctx) {
    const now = performance.now();
    for (let s = 0; s < 4; s++) {
      const seat = this.seats[s];
      if (!seat?.present || seat.w !== 'laser') continue;
      const v = this.seatView(s), a = seat.angle;
      const ox = v.x + Math.cos(a) * 96, oy = v.y + Math.sin(a) * 96;
      if (s === this.mySeat) {
        if (!seat.beamOn) continue;
        const f = this.beamTarget();
        if (f) this.drawLightning(ctx, ox, oy, f.s.x, f.s.y, true, true);
        else {
          // nothing in the beam: reach to the screen edge
          const k = Math.min(...[Math.cos(a) > 0 ? (W - ox) / Math.cos(a) : Math.cos(a) < 0 ? -ox / Math.cos(a) : Infinity,
            Math.sin(a) > 0 ? (H - oy) / Math.sin(a) : Math.sin(a) < 0 ? -oy / Math.sin(a) : Infinity]);
          this.drawLightning(ctx, ox, oy, ox + Math.cos(a) * k, oy + Math.sin(a) * k, true, false);
        }
      } else if (seat.zap && now < seat.zap.until) {
        const f = this.fish.get(seat.zap.f);
        if (f?.s) this.drawLightning(ctx, ox, oy, f.s.x, f.s.y, false, true);
      }
    }
  }

  startTide(n) {
    this.tide = { t: 0, next: n, nextBg: bgFor(n) };
    sfx.wave();
  }

  // ---- simulation ----
  update(dt) {
    this.time += dt;
    const now = this.net.now();
    const pnow = performance.now();

    for (const [id, f] of this.fish) {
      f.s = fishState(f, now);
      if (!f.s && now > f.t0 + f.d) this.fish.delete(id);
      if (f.flash > 0) f.flash -= dt * 4;
    }

    // tide sweeps right -> left
    if (this.tide) {
      this.tide.t += dt;
      const front = W + 150 - (this.tide.t / 2.4) * (W + 300);
      this.tide.front = front;
      for (const [id, f] of this.fish) {
        if (f.s && f.s.x > front) { this.dying.push({ ty: f.ty, x: f.s.x, y: f.s.y, a: f.s.a, t: 0.3, flee: true }); this.fish.delete(id); }
      }
      if (this.tide.t >= 2.4) {
        this.scene = this.tide.next;
        this.bg = this.tide.nextBg;
        this.tide = null;
        this.app.toast(`Entering ${SCENES[this.scene]}`);
      }
    }

    // my cannon
    const lockFish = this.aimCannon();
    if (this.firing || this.auto || (this.lockMode && lockFish)) this.tryFire(pnow);
    // laser beam stays visible while the trigger is held (or AUTO / LOCK keep it firing)
    const me = this.seats[this.mySeat];
    me.beamOn = me.w === 'laser' && this.myBal >= this.bet && (this.firing || this.auto || (this.lockMode && !!lockFish));

    for (const s of this.seats) if (s.recoil > 0) s.recoil = Math.max(0, s.recoil - dt * 6);

    // bullets
    const R = BULLET.radius;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      if (pnow - b.born > BULLET.lifeMs) { this.bullets.splice(i, 1); continue; }
      const lf = b.lk ? this.fish.get(b.lk) : null;
      if (b.lk && lf?.s) {
        const dx = lf.s.x - b.x, dy = lf.s.y - b.y, d = Math.hypot(dx, dy) || 1;
        b.vx = (dx / d) * BULLET.speed; b.vy = (dy / d) * BULLET.speed;
      } else if (b.lk) b.lk = 0;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx); }
      if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx); }
      if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy); }
      if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy); }
      let hit = null;
      if (b.lk) { if (lf?.s && hitsFish(lf.ty, lf.s.x, lf.s.y, lf.s.a, b.x, b.y, R)) hit = lf; }
      else {
        for (const f of this.fish.values()) {
          if (f.s && hitsFish(f.ty, f.s.x, f.s.y, f.s.a, b.x, b.y, R)) { hit = f; break; }
        }
      }
      if (hit) {
        this.bullets.splice(i, 1);
        this.nets.push({ x: b.x, y: b.y, t: 0, tier: b.tier });
        hit.flash = 1;
        if (b.mine) {
          this.net.send({ t: 'hit', id: b.id, f: hit.id, x: Math.round(this.vx(b.x)), y: Math.round(this.vy(b.y)) });
          sfx.hit();
        }
      }
    }

    const age = (arr, rate, max = 1) => { for (let i = arr.length - 1; i >= 0; i--) { arr[i].t += dt * rate; if (arr[i].t >= max) arr.splice(i, 1); } };
    age(this.nets, 2.2);
    age(this.dying, 1.1);
    age(this.texts, 0.8);
    age(this.fx, 1.3);
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.t += dt;
      c.spin += dt * 12;
      if (c.t > c.dur + 0.6) {
        this.coins.splice(i, 1);
        if (c.mine && Math.random() < 0.35) sfx.tick();
      }
    }
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 3.2) this.banner = null; }
    if (this.warning) { this.warning.t += dt; if (this.warning.t > 3.2) this.warning = null; }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt);
  }

  // ---- rendering ----
  render(ctx) {
    const t = this.time;
    ctx.save();
    if (this.shake > 0) ctx.translate((Math.random() - 0.5) * 16 * this.shake, (Math.random() - 0.5) * 16 * this.shake);

    // background (+ new scene revealed behind the tide front)
    ctx.drawImage(this.bg, 0, 0, W, H);
    if (this.tide) {
      ctx.save();
      ctx.beginPath(); ctx.rect(this.tide.front, 0, W - this.tide.front + 200, H); ctx.clip();
      ctx.drawImage(this.tide.nextBg, 0, 0, W, H);
      ctx.restore();
    }
    this.app.drawCaustics(ctx, t);

    // creatures: small first, big on top
    const list = [...this.fish.values()].filter((f) => f.s).sort((a, b) => FISH[a.ty].rx - FISH[b.ty].rx);
    for (const f of list) drawFishSprite(ctx, f.ty, f.s.x, f.s.y, f.s.a, t, { flash: f.flash });
    for (const d of this.dying) {
      if (d.flee) drawFishSprite(ctx, d.ty, d.x - d.t * 300, d.y, d.a, t, { alpha: 1 - d.t, shadow: false });
      else drawFishSprite(ctx, d.ty, d.x, d.y, d.a, t * 3, { alpha: d.t < 0.6 ? 1 : (1 - d.t) / 0.4, spin: d.t * 9, scale: 1 + Math.sin(d.t * Math.PI) * 0.15, flash: 0.6, shadow: false });
    }

    // lock reticle
    const lf = this.lockMode && this.lockId ? this.fish.get(this.lockId) : null;
    if (lf?.s) {
      const mv = this.seatView(this.mySeat);
      ctx.save();
      ctx.setLineDash([6, 10]);
      ctx.strokeStyle = 'rgba(255,80,80,0.55)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mv.x, mv.y); ctx.lineTo(lf.s.x, lf.s.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.translate(lf.s.x, lf.s.y);
      ctx.rotate(t * 2);
      const r = Math.max(FISH[lf.ty].rx, FISH[lf.ty].ry) * 0.9 + 12;
      ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, r, i * Math.PI / 2 + 0.2, i * Math.PI / 2 + 1.2); ctx.stroke(); }
      ctx.restore();
    }

    for (const n of this.nets) drawNet(ctx, n.x, n.y, n.t, n.tier);
    this.renderBeams(ctx);
    for (const b of this.bullets) drawBullet(ctx, b.x, b.y, b.vx, b.vy, b.tier, b.mine);
    this.renderFx(ctx);

    // tide foam front
    if (this.tide) {
      const x = this.tide.front;
      ctx.fillStyle = lin(ctx, x - 120, 0, x + 60, 0, [[0, 'rgba(255,255,255,0)'], [0.7, 'rgba(220,250,255,0.75)'], [1, 'rgba(255,255,255,0)']]);
      ctx.fillRect(x - 120, 0, 180, H);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < 26; i++) {
        const y = (i / 26) * H + Math.sin(t * 6 + i) * 8;
        ctx.beginPath(); ctx.arc(x + Math.sin(i * 3.1 + t * 9) * 18, y, 4 + (i % 4) * 2, 0, TAU); ctx.fill();
      }
    }

    // seats
    for (let s = 0; s < 4; s++) this.renderSeat(ctx, s, t);

    for (const c of this.coins) {
      if (c.t < 0) continue;
      let x, y;
      if (c.t < 0.35) { const k = c.t / 0.35; x = c.sx + (c.x - c.sx) * k; y = c.sy + (c.y - c.sy) * k - Math.sin(k * Math.PI) * 30; }
      else { const k = Math.min(1, (c.t - 0.35) / c.dur), e = k * k * (3 - 2 * k); x = c.x + (c.tx - c.x) * e; y = c.y + (c.ty - c.y) * e; }
      drawCoin(ctx, x, y, c.mine ? 11 : 8, c.spin);
    }
    for (const tx of this.texts) {
      const a = tx.t < 0.7 ? 1 : 1 - (tx.t - 0.7) / 0.3;
      ctx.globalAlpha = a;
      goldText(ctx, tx.text, tx.x, tx.y - tx.t * 50, tx.size * (tx.t < 0.15 ? 0.6 + tx.t / 0.15 * 0.4 : 1), tx.mine ? {} : { colors: ['#ffffff', '#cfe8ff', '#8fb8e8'], glow: null, stroke: '#0a1a40' });
      ctx.globalAlpha = 1;
    }

    this.renderButtons(ctx);
    ctx.restore();

    if (this.warning) this.renderWarning(ctx);
    if (this.banner) this.renderBanner(ctx);
    if (this.showInfo) this.renderInfo(ctx);
  }

  renderFx(ctx) {
    for (const e of this.fx) {
      if (e.kind === 'shock') {
        const r = e.t * 300;
        ctx.globalAlpha = 1 - e.t;
        ctx.fillStyle = rad(ctx, e.x, e.y, 0, r + 1, [[0, 'rgba(255,255,200,0.9)'], [0.6, 'rgba(255,140,0,0.5)'], [1, 'rgba(255,60,0,0)']]);
        ctx.beginPath(); ctx.arc(e.x, e.y, r + 1, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 6 * (1 - e.t);
        ctx.beginPath(); ctx.arc(e.x, e.y, r * 1.1 + 1, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (e.kind === 'bolt') {
        ctx.globalAlpha = 1 - e.t;
        ctx.strokeStyle = '#fffaa0'; ctx.lineWidth = 3;
        ctx.shadowColor = '#7ff'; ctx.shadowBlur = 12;
        for (const v of e.to) {
          ctx.beginPath(); ctx.moveTo(e.x, e.y);
          for (let k = 1; k <= 6; k++) {
            const u = k / 6;
            ctx.lineTo(e.x + (v.x - e.x) * u + (k < 6 ? (Math.random() - 0.5) * 30 : 0), e.y + (v.y - e.y) * u + (k < 6 ? (Math.random() - 0.5) * 30 : 0));
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }
  }

  renderSeat(ctx, s, t) {
    const seat = this.seats[s];
    const v = this.seatView(s);
    const mine = s === this.mySeat;
    const pr = this.plateRect(s);
    if (!seat.present) {
      ctx.globalAlpha = 0.5;
      drawCannon(ctx, v.x, v.y, seat.angle, 0, 0, t, false);
      ctx.globalAlpha = 1;
      panel(ctx, pr.x, pr.y, pr.w, pr.h, 12, { fill: 'rgba(5,10,25,0.45)', stroke: 'rgba(160,180,220,0.35)' });
      ctx.fillStyle = 'rgba(200,215,240,0.6)';
      ctx.font = `700 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Waiting for player…', pr.x + pr.w / 2, pr.y + pr.h / 2);
      return;
    }
    drawCannon(ctx, v.x, v.y, seat.angle, this.tierOf(seat.lv), seat.recoil, t, mine);
    if (seat.w === 'laser') this.renderLaserCannon(ctx, v, seat, t);
    // bet value on the platform
    const by = v.y > H / 2 ? v.y - 46 : v.y + 46;
    panel(ctx, v.x - 34, by - 13, 68, 26, 13, { fill: 'rgba(0,0,0,0.65)', stroke: mine ? '#ffd23f' : 'rgba(180,200,240,0.6)', lw: 1.5 });
    ctx.fillStyle = mine ? '#ffe680' : '#dfe9ff';
    ctx.font = `800 15px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmt(seat.lv), v.x, by + 1);
    // player plate
    panel(ctx, pr.x, pr.y, pr.w, pr.h, 12, mine ? { fill: 'rgba(40,20,0,0.78)', stroke: '#ffd23f', lw: 2.5 } : {});
    drawCoin(ctx, pr.x + 26, pr.y + 34, 11, t * 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = mine ? '#ffe9a8' : '#bcd0f5';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillText(seat.name.slice(0, 16), pr.x + 46, pr.y + 15);
    ctx.fillStyle = '#fff';
    ctx.font = `900 21px ${FONT}`;
    ctx.fillText(fmt(mine ? this.myBal : seat.bal), pr.x + 46, pr.y + 36);
  }

  renderButtons(ctx) {
    for (const b of this.buttons) {
      const on = b.on ? b.on() : false;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(2, 3, b.r, 0, TAU); ctx.fill();
      ctx.fillStyle = on ? rad(ctx, -b.r * 0.3, -b.r * 0.4, 1, b.r * 1.3, [[0, '#fff6b0'], [0.5, '#ffb800'], [1, '#a05a00']])
        : rad(ctx, -b.r * 0.3, -b.r * 0.4, 1, b.r * 1.3, [[0, '#7fb4ff'], [0.5, '#1f4fb0'], [1, '#0a1a4a']]);
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = on ? '#fff3b0' : 'rgba(170,210,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.ellipse(0, -b.r * 0.45, b.r * 0.65, b.r * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = on ? '#3a1a00' : '#fff';
      const small = b.label.length > 2;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (b.sub) {
        ctx.font = `900 17px ${FONT}`;
        ctx.fillText(b.label, 0, -5);
        ctx.font = `900 9px ${FONT}`;
        ctx.fillText(b.sub, 0, 12);
      } else if (b.icon) {
        drawAudioIcon(ctx, b.icon, b.r, '#fff');
      } else {
        ctx.font = `900 ${small ? 12 : 22}px ${FONT}`;
        ctx.fillText(b.label, 0, small ? 1 : 2);
      }
      if (b.off?.()) drawOffSlash(ctx, b.r);
      ctx.restore();
    }
  }

  renderWarning(ctx) {
    const w = this.warning, t = w.t;
    const a = Math.min(1, t * 3, (3.2 - t) * 3);
    const pulse = 0.5 + 0.5 * Math.sin(t * 12);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = lin(ctx, 0, 0, 0, H, [[0, `rgba(255,0,0,${0.35 * pulse})`], [0.15, 'rgba(255,0,0,0)'], [0.85, 'rgba(255,0,0,0)'], [1, `rgba(255,0,0,${0.35 * pulse})`]]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(40,0,0,0.6)';
    ctx.fillRect(0, H / 2 - 70, W, 140);
    ctx.fillStyle = `rgba(255,60,60,${0.6 + 0.4 * pulse})`;
    ctx.fillRect(0, H / 2 - 72, W, 4); ctx.fillRect(0, H / 2 + 68, W, 4);
    goldText(ctx, 'WARNING', W / 2, H / 2 - 28, 54, { colors: ['#fff0f0', '#ff4d4d', '#a00000'], stroke: '#300', glow: 'rgba(255,0,0,0.8)' });
    goldText(ctx, `${FISH[w.ty].name.toUpperCase()} APPROACHING · ${multLabel(w.ty)}`, W / 2, H / 2 + 30, 26);
    ctx.restore();
  }

  renderBanner(ctx) {
    const b = this.banner, t = b.t;
    const a = Math.min(1, t * 4, (3.2 - t) * 3);
    const sc = t < 0.3 ? 0.5 + (t / 0.3) * 0.6 : 1.1 - Math.min(0.1, (t - 0.3) * 0.3);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = rad(ctx, W / 2, H / 2, 10, 420, [[0, 'rgba(255,200,40,0.45)'], [1, 'rgba(255,160,0,0)']]);
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    ctx.rotate(t * 0.6);
    ctx.fillStyle = 'rgba(255,230,120,0.18)';
    for (let i = 0; i < 16; i++) { ctx.rotate(TAU / 16); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(500, -40); ctx.lineTo(500, 40); ctx.fill(); }
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H / 2);
    ctx.scale(sc, sc);
    goldText(ctx, b.label, 0, -40, 86);
    const shown = Math.min(b.amount, Math.floor(b.amount * Math.min(1, t / 1.4)));
    goldText(ctx, fmt(shown), 0, 50, 64, { colors: ['#ffffff', '#fff2a8', '#ffc400'] });
    ctx.restore();
  }

  renderInfo(ctx) {
    ctx.fillStyle = 'rgba(0,5,20,0.82)';
    ctx.fillRect(0, 0, W, H);
    panel(ctx, 120, 60, W - 240, H - 120, 22, { fill: 'rgba(10,25,60,0.95)', stroke: '#ffd23f', lw: 3 });
    goldText(ctx, 'PAYTABLE', W / 2, 100, 40);
    const cols = 6, cw = (W - 300) / cols, ch = 150;
    FISH.forEach((f, i) => {
      const cx = 150 + (i % cols) * cw + cw / 2, cy = 145 + Math.floor(i / cols) * ch;
      panel(ctx, cx - cw / 2 + 8, cy, cw - 16, ch - 14, 12, { fill: 'rgba(0,0,0,0.35)', stroke: 'rgba(120,170,255,0.5)', lw: 1 });
      drawFishIcon(ctx, f.id, cx, cy + 58, cw - 40, 66, this.time);
      ctx.fillStyle = '#cfe0ff'; ctx.font = `700 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.name, cx, cy + 102);
      goldText(ctx, multLabel(f.id), cx, cy + 122, 20, { glow: null });
      if (f.kind === 'bomb') { ctx.fillStyle = '#ffb080'; ctx.font = `700 11px ${FONT}`; ctx.fillText('Explodes nearby fish', cx, cy + 20); }
      if (f.kind === 'chain') { ctx.fillStyle = '#9ff'; ctx.font = `700 11px ${FONT}`; ctx.fillText(`Chains ${f.chain} fish`, cx, cy + 20); }
      if (f.kind === 'boss') { ctx.fillStyle = '#ff8080'; ctx.font = `700 11px ${FONT}`; ctx.fillText('BOSS', cx, cy + 20); }
    });
    ctx.fillStyle = 'rgba(220,230,255,0.7)'; ctx.font = `600 14px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(`Win = cannon bet × multiplier   ·   Space: auto fire   ·   ↑↓: bet   ·   L: lock   ·   tap to close`, W / 2, H - 82);
  }
}
