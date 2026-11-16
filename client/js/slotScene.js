import { WORLD } from '/shared/fishTypes.js';
import { MACHINES, SYM, windowAt, stripsFor } from '/shared/slots.js';
import { goldText, panel, fmt, FONT, lin, rad, TAU, mk, drawCoin, drawAudioIcon, drawOffSlash } from './art.js';
import { sfx, startMusic, audioPrefs, setSfx, setMusic } from './audio.js';

const { W, H } = WORLD;
const RES = 1.6;
const LINE_COLORS = ['#ff3b3b', '#3bd1ff', '#7dff3b', '#ffd23b', '#ff3bd8', '#ff8a3b', '#3b6bff', '#3bffb0', '#c43bff'];

// ---------------------------------------------------------------------------
// Symbol art (cached per size)
// ---------------------------------------------------------------------------
function drawSeven(ctx, s, colors, outline) {
  ctx.save();
  ctx.font = `900 ${s * 0.95}px "Arial Black", Impact, ${FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000'; ctx.lineWidth = s * 0.14; ctx.strokeText('7', 0, s * 0.04);
  ctx.strokeStyle = outline; ctx.lineWidth = s * 0.08; ctx.strokeText('7', 0, s * 0.04);
  ctx.fillStyle = lin(ctx, 0, -s * 0.4, 0, s * 0.45, colors.map((c, i) => [i / (colors.length - 1), c]));
  ctx.fillText('7', 0, s * 0.04);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.ellipse(-s * 0.06, -s * 0.28, s * 0.22, s * 0.06, -0.1, 0, TAU); ctx.fill();
  ctx.restore();
}

function drawBar(ctx, s, n) {
  const h = s * (n === 1 ? 0.34 : n === 2 ? 0.25 : 0.2), gap = s * 0.05;
  const total = n * h + (n - 1) * gap;
  for (let i = 0; i < n; i++) {
    const y = -total / 2 + i * (h + gap);
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.roundRect(-s * 0.42, y - 2, s * 0.84, h + 4, h * 0.3); ctx.fill();
    ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, '#3a3a3a'], [0.5, '#111'], [1, '#2a2a2a']]);
    ctx.beginPath(); ctx.roundRect(-s * 0.4, y, s * 0.8, h, h * 0.3); ctx.fill();
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = s * 0.02; ctx.stroke();
    ctx.fillStyle = lin(ctx, 0, y, 0, y + h, [[0, '#fff6c0'], [1, '#e0a000']]);
    ctx.font = `900 ${h * 0.78}px "Arial Black", Impact, ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BAR', 0, y + h * 0.54);
  }
}

function fruit(ctx, s, body, hi, lo, shape) {
  ctx.fillStyle = rad(ctx, -s * 0.12, -s * 0.12, s * 0.02, s * 0.45, [[0, hi], [0.5, body], [1, lo]]);
  ctx.beginPath();
  if (shape === 'lemon') ctx.ellipse(0, 0, s * 0.38, s * 0.28, -0.2, 0, TAU);
  else if (shape === 'melon') ctx.ellipse(0, 0, s * 0.4, s * 0.32, 0, 0, TAU);
  else ctx.arc(0, 0, s * 0.33, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = s * 0.025; ctx.stroke();
}

function leaf(ctx, x, y, s, rot) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = lin(ctx, 0, -s * 0.06, 0, s * 0.06, [[0, '#7dff6a'], [1, '#1e8a1e']]);
  ctx.beginPath(); ctx.ellipse(s * 0.12, 0, s * 0.14, s * 0.06, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

const SYMBOL_DRAW = {
  [SYM.CHERRY]: (ctx, s) => {
    ctx.strokeStyle = '#2d7a1e'; ctx.lineWidth = s * 0.04; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-s * 0.18, s * 0.05); ctx.quadraticCurveTo(-s * 0.05, -s * 0.3, s * 0.08, -s * 0.36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.2, s * 0.1); ctx.quadraticCurveTo(s * 0.15, -s * 0.2, s * 0.08, -s * 0.36); ctx.stroke();
    leaf(ctx, s * 0.08, -s * 0.36, s, -0.4);
    for (const [x, y] of [[-s * 0.18, s * 0.14], [s * 0.18, s * 0.2]]) {
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = rad(ctx, -s * 0.06, -s * 0.06, s * 0.01, s * 0.2, [[0, '#ffb3b3'], [0.4, '#e3001b'], [1, '#6a0010']]);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.17, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#3a0008'; ctx.lineWidth = s * 0.02; ctx.stroke();
      ctx.restore();
    }
  },
  [SYM.LEMON]: (ctx, s) => { fruit(ctx, s, '#ffe600', '#fffbb0', '#c9a400', 'lemon'); leaf(ctx, s * 0.28, -s * 0.12, s, -0.6); },
  [SYM.ORANGE]: (ctx, s) => {
    fruit(ctx, s, '#ff8c00', '#ffd59a', '#b85000');
    ctx.fillStyle = 'rgba(120,50,0,0.25)';
    for (let i = 0; i < 14; i++) { const a = i * 2.4, r = (i % 4) * s * 0.07; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, s * 0.012, 0, TAU); ctx.fill(); }
    leaf(ctx, 0, -s * 0.32, s, -0.8);
  },
  [SYM.PLUM]: (ctx, s) => { fruit(ctx, s, '#7a1fbf', '#e0b0ff', '#2e0057'); leaf(ctx, 0, -s * 0.32, s, -1.1); },
  [SYM.MELON]: (ctx, s) => {
    fruit(ctx, s, '#2fb83a', '#b8ffb0', '#0b5a14', 'melon');
    ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, s * 0.4, s * 0.32, 0, 0, TAU); ctx.clip();
    ctx.strokeStyle = 'rgba(0,60,0,0.55)'; ctx.lineWidth = s * 0.05;
    for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(i * s * 0.12, 0, s * 0.06, s * 0.34, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
  },
  [SYM.BELL]: (ctx, s) => {
    ctx.fillStyle = rad(ctx, -s * 0.1, -s * 0.15, s * 0.02, s * 0.5, [[0, '#fffbe0'], [0.45, '#ffcc00'], [1, '#a06a00']]);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.36);
    ctx.bezierCurveTo(s * 0.24, -s * 0.36, s * 0.24, -s * 0.05, s * 0.28, s * 0.14);
    ctx.quadraticCurveTo(s * 0.36, s * 0.24, s * 0.38, s * 0.27);
    ctx.lineTo(-s * 0.38, s * 0.27);
    ctx.quadraticCurveTo(-s * 0.36, s * 0.24, -s * 0.28, s * 0.14);
    ctx.bezierCurveTo(-s * 0.24, -s * 0.05, -s * 0.24, -s * 0.36, 0, -s * 0.36);
    ctx.fill();
    ctx.strokeStyle = '#5a3a00'; ctx.lineWidth = s * 0.025; ctx.stroke();
    ctx.fillStyle = '#c98a00'; ctx.beginPath(); ctx.arc(0, s * 0.32, s * 0.07, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.ellipse(-s * 0.1, -s * 0.12, s * 0.05, s * 0.15, 0.2, 0, TAU); ctx.fill();
  },
  [SYM.BAR]: (ctx, s) => drawBar(ctx, s, 1),
  [SYM.BAR2]: (ctx, s) => drawBar(ctx, s, 2),
  [SYM.BAR3]: (ctx, s) => drawBar(ctx, s, 3),
  [SYM.SEVEN_BLUE]: (ctx, s) => drawSeven(ctx, s, ['#d6f0ff', '#2b8cff', '#0a2a9e'], '#ffffff'),
  [SYM.SEVEN_RED]: (ctx, s) => {
    ctx.fillStyle = rad(ctx, 0, 0, 0, s * 0.5, [[0, 'rgba(255,120,0,0.5)'], [1, 'rgba(255,0,0,0)']]);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.fill();
    drawSeven(ctx, s, ['#ffe0e0', '#ff2a2a', '#8a0000'], '#ffd23f');
  },
  [SYM.BLANK]: (ctx, s) => {
    // classic machines have empty stops between symbols; mark them with a faint emblem
    ctx.strokeStyle = 'rgba(120,90,40,0.18)'; ctx.lineWidth = s * 0.02;
    ctx.beginPath(); ctx.moveTo(0, -s * 0.12); ctx.lineTo(s * 0.12, 0); ctx.lineTo(0, s * 0.12); ctx.lineTo(-s * 0.12, 0); ctx.closePath(); ctx.stroke();
  },
  [SYM.WILD]: (ctx, s) => {
    ctx.fillStyle = rad(ctx, 0, 0, 0, s * 0.5, [[0, 'rgba(255,60,120,0.55)'], [1, 'rgba(255,0,80,0)']]);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, TAU); ctx.fill();
    const pts = [[0, -0.36], [0.3, -0.12], [0.18, 0.3], [-0.18, 0.3], [-0.3, -0.12]].map(([x, y]) => [x * s, y * s]);
    ctx.fillStyle = lin(ctx, 0, -s * 0.36, 0, s * 0.3, [[0, '#ff9ac0'], [0.5, '#e0003a'], [1, '#6a0018']]);
    ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ffe9f0'; ctx.lineWidth = s * 0.02;
    ctx.stroke();
    ctx.beginPath(); pts.forEach(([x, y]) => { ctx.moveTo(0, -s * 0.02); ctx.lineTo(x, y); }); ctx.stroke();
    ctx.font = `900 ${s * 0.2}px "Arial Black", Impact, ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = s * 0.05; ctx.strokeStyle = '#3a0010'; ctx.strokeText('WILD', 0, s * 0.36);
    ctx.fillStyle = '#ffe680'; ctx.fillText('WILD', 0, s * 0.36);
  },
};

const symCache = new Map();
export function symbolCanvas(sym, size) {
  const key = `${sym}:${size}`;
  if (symCache.has(key)) return symCache.get(key);
  const c = mk(size * RES, size * RES);
  const ctx = c.getContext('2d');
  ctx.scale(RES, RES);
  ctx.translate(size / 2, size / 2);
  SYMBOL_DRAW[sym](ctx, size);
  symCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------
const easeOutBack = (k) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };

export class SlotScene {
  constructor(app, joined) {
    this.app = app;
    this.net = app.net;
    this.room = joined.room;
    this.machineId = joined.room.variant;
    this.M = MACHINES[this.machineId];
    this.level = joined.room.rtpKey;
    this.strips = stripsFor(this.machineId, this.level);
    this.levels = joined.room.betLevels;
    this.levelIdx = 0;
    this.balance = joined.bal;
    this.shownBal = joined.bal;
    this.time = 0;
    this.auto = false;
    this.autoLeft = 0;
    this.picker = false;
    this.turbo = false;
    this.state = 'idle';     // idle | spinning | stopping | showing
    this.spinId = 0;
    this.result = null;
    this.win = 0;
    this.shownWin = 0;
    this.lineCycle = 0;
    this.particles = [];
    this.banner = null;
    this.showInfo = false;

    const n = this.M.reels;
    this.cell = n === 3 ? 128 : 116;
    this.reelW = n === 3 ? 168 : 142;
    this.winW = this.reelW * n;
    this.winH = this.cell * this.M.rows;
    this.wx = Math.round((W - this.winW) / 2);
    // centre the board between the title (bottom ~92) and the control bar (top ~597)
    this.wy = Math.round((92 + 597) / 2 - this.winH / 2);
    this.reels = this.strips.map((strip) => ({ strip, pos: Math.floor(Math.random() * strip.length), v: 0, mode: 'still', from: 0, to: 0, t0: 0, dur: 0 }));

    this.unsub = [
      this.net.on('spin', (m) => this.onResult(m)),
      this.net.on('spinerr', (m) => this.onSpinError(m)),
      this.net.on('wallet', (m) => { this.balance = m.bal; if (this.state === 'idle') this.shownBal = m.bal; }),
    ];
    this.buildButtons();
    startMusic('slot');
    if (joined.pending) this.resume(joined.pending);
  }

  /** Show a spin the player never saw finish (connection lost / app closed mid-spin). */
  resume(p) {
    this.levelIdx = Math.max(0, this.levels.indexOf(p.lineBet));
    this.reels.forEach((r, i) => { r.pos = p.stops[i]; r.mode = 'still'; });
    this.result = { rid: p.rid, stops: p.stops, lines: p.lines, win: p.win, bal: this.balance, bet: p.bet };
    this.state = 'stopping';
    this.app.toast(p.win ? `Your last spin finished while you were away: won ${p.win.toLocaleString('en-US')}` : 'Showing your last spin');
  }

  destroy() { this.unsub.forEach((u) => u()); }

  get lineBet() { return this.levels[this.levelIdx]; }
  get totalBet() { return this.lineBet * this.M.lines.length; }

  buildButtons() {
    const y = 650;
    this.buttons = [
      { id: 'spin', x: 1090, y: y - 8, r: 58, label: 'SPIN', big: true, act: () => this.spin() },
      { id: 'auto', x: 960, y, r: 34, label: 'AUTO', on: () => this.auto, act: () => this.toggleAuto() },
      { id: 'turbo', x: 1210, y: y + 12, r: 28, label: 'FAST', on: () => this.turbo, act: () => { this.turbo = !this.turbo; sfx.click(); } },
      { id: 'minus', x: 488, y, r: 22, label: '−', act: () => this.changeBet(-1) },
      { id: 'plus', x: 702, y, r: 22, label: '+', act: () => this.changeBet(1) },
      { id: 'max', x: 790, y, r: 30, label: 'MAX', act: () => this.maxBet() }, // works after a spin, not mid-spin
      { id: 'exit', x: 46, y: 46, r: 26, label: '⏏', act: () => this.exit() },
      { id: 'info', x: 108, y: 46, r: 26, label: 'i', act: () => { this.showInfo = !this.showInfo; } },
      { id: 'lines', x: 176, y: 46, r: 30, label: `${this.M.lines.length}`, sub: 'LINES',
        on: () => !!this.pinned?.all, act: () => this.showAllLines() },
      { id: 'music', x: W - 170, y: 46, r: 26, label: '', icon: 'music', off: () => !audioPrefs().music, act: () => setMusic(!audioPrefs().music) },
      { id: 'sound', x: W - 108, y: 46, r: 26, label: '', icon: 'sfx', off: () => !audioPrefs().sfx, act: () => setSfx(!audioPrefs().sfx) },
      { id: 'full', x: W - 46, y: 46, r: 26, label: '⛶', act: () => this.app.toggleFullscreen() },
    ];
  }

  /** −/+ wrap around: + on the highest bet goes to the lowest, − on the lowest goes to the highest. */
  changeBet(d) {
    if (this.state !== 'idle' && this.state !== 'showing') return;
    const n = this.levels.length;
    this.levelIdx = (((this.levelIdx + d) % n) + n) % n;
    sfx.click();
  }

  maxBet() {
    if (this.state !== 'idle' && this.state !== 'showing') return;
    this.levelIdx = this.levels.length - 1;
    sfx.click();
  }

  /** AUTO button: stop auto-spin if running, otherwise open/close the spin-count picker. */
  toggleAuto() {
    sfx.click();
    if (this.auto) { this.stopAuto(); return; }
    this.picker = !this.picker;
  }

  /** Start auto-spin for n spins (Infinity = until stopped). autoLeft counts the spin in progress. */
  startAuto(n) {
    this.picker = false;
    this.auto = true;
    this.autoLeft = n;
    this.autoCounting = false;
    sfx.click();
    if (this.state === 'idle' || this.state === 'showing') this.spin();
  }

  stopAuto() {
    this.auto = false;
    this.autoCounting = false;
  }

  pickerOptions() {
    const vals = [10, 25, 50, 100, 500, Infinity];
    const cx = 960, x0 = cx - 64, y0 = 508;
    return vals.map((v, i) => ({ v, x: x0 + (i % 3) * 64, y: y0 + Math.floor(i / 3) * 52, r: 22 }));
  }

  renderPicker(ctx) {
    const px = 844, py = 440, pw = 232, ph = 160;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(px + 4, py + 6, pw, ph, 18); ctx.fill();
    panel(ctx, px, py, pw, ph, 18, { fill: 'rgba(40,6,20,0.96)', stroke: '#ffd23f', lw: 3 });
    // pointer down to the AUTO button
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath(); ctx.moveTo(950, py + ph - 1); ctx.lineTo(970, py + ph - 1); ctx.lineTo(960, py + ph + 11); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ffcf5a'; ctx.font = `900 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('AUTO SPINS', px + pw / 2, py + 22);
    for (const o of this.pickerOptions()) {
      const inf = o.v === Infinity;
      ctx.fillStyle = rad(ctx, o.x - 7, o.y - 9, 1, o.r * 1.3, inf ? [[0, '#fff6b0'], [0.5, '#ffb800'], [1, '#a05a00']] : [[0, '#ff9ab0'], [0.5, '#c0103a'], [1, '#4a0010']]);
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,200,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = inf ? '#3a1a00' : '#fff';
      ctx.font = `900 ${inf ? 26 : o.v >= 100 ? 15 : 18}px ${FONT}`;
      ctx.fillText(inf ? '∞' : String(o.v), o.x, o.y + (inf ? 0 : 1));
    }
    ctx.restore();
  }

  async exit() {
    if (this.state === 'spinning' || this.state === 'stopping') return;
    this.stopAuto();
    this.picker = false;
    if (await this.app.confirm('Leave this machine and return to the lobby?')) this.app.leaveRoom();
  }

  spin() {
    if (this.state === 'spinning' || this.state === 'stopping') return;
    if (this.auto && this.autoCounting) {
      if (this.autoLeft !== Infinity) this.autoLeft--;
      if (this.autoLeft <= 0) { this.stopAuto(); return; } // chosen number of spins done
    }
    if (this.balance < this.totalBet) {
      this.stopAuto();
      this.app.toast('Not enough credits.');
      sfx.error();
      return;
    }
    this.finishShowing();
    this.state = 'spinning';
    this.result = null;
    this.win = 0;
    this.shownWin = 0;
    this.balance -= this.totalBet;
    this.shownBal = this.balance;
    this.spinStart = this.time;
    for (const r of this.reels) { r.mode = 'spin'; r.v = 0; }
    if (this.auto) this.autoCounting = true;
    this.spinId++;
    this.net.send({ t: 'spin', id: this.spinId, b: this.lineBet });
    this.timeout = setTimeout(() => { if (this.state === 'spinning') this.onSpinError({ id: this.spinId, code: 'TIMEOUT' }); }, 8000);
    sfx.click();
  }

  onSpinError(m) {
    if (m.id !== this.spinId) return;
    clearTimeout(this.timeout);
    this.balance += this.totalBet;
    this.shownBal = this.balance;
    this.auto = false;
    const now = this.time;
    this.reels.forEach((r, i) => this.scheduleStop(r, Math.floor(Math.random() * r.strip.length), now + i * 0.1));
    this.state = 'stopping';
    this.result = { lines: [], win: 0, bal: this.balance, failed: true };
    const msg = { NO_FUNDS: 'Not enough credits.', TOO_FAST: 'Please wait…', TIMEOUT: 'Connection is slow, spin cancelled.' }[m.code] || 'Spin failed.';
    this.app.toast(msg);
  }

  onResult(m) {
    if (m.id !== this.spinId) return;
    clearTimeout(this.timeout);
    this.result = m;
    this.state = 'stopping';
    const minSpin = this.turbo ? 0.25 : 0.7;
    const base = Math.max(this.time, this.spinStart + minSpin);
    const gap = this.turbo ? 0.12 : 0.32;
    // anticipation: slow down the last reel when the first reels already line up something big
    this.reels.forEach((r, i) => this.scheduleStop(r, m.stops[i], base + i * gap + (i === this.reels.length - 1 && this.teaser(m) ? 0.9 : 0)));
  }

  teaser(m) {
    const grid = windowAt(this.machineId, this.level, m.stops);
    const sevens = [SYM.SEVEN_RED, SYM.SEVEN_BLUE, SYM.WILD];
    return grid[0].some((s) => sevens.includes(s)) && grid[1].some((s) => sevens.includes(s));
  }

  scheduleStop(r, stop, at) {
    r.stopAt = at;
    r.target = stop;
  }

  finishShowing() {
    if (this.state === 'showing') { this.shownBal = this.balance; this.shownWin = this.win; }
  }

  // ---- input ----
  pointerDown(x, y) {
    if (this.showInfo) { this.showInfo = false; return; }
    if (this.picker) {
      const o = this.pickerOptions().find((p) => Math.hypot(x - p.x, y - p.y) <= p.r + 6);
      if (o) { this.startAuto(o.v); return; }
      this.picker = false; // any other tap (including AUTO again) just closes the picker
      return;
    }
    const m = this.markerAt(x, y);
    if (m) { this.showLine(m.li); return; }
    for (const b of this.buttons) if (Math.hypot(x - b.x, y - b.y) <= b.r + 6) { b.act(); return; }
    // tapping the reels also spins (and skips the win count-up)
    if (x > this.wx && x < this.wx + this.winW && y > this.wy && y < this.wy + this.winH) {
      if (this.state === 'showing' && this.shownWin < this.win) this.finishShowing();
      else this.spin();
    }
  }
  pointerMove(x, y) {
    const m = this.showInfo ? null : this.markerAt(x, y);
    this.hoverLine = m ? m.li : null;
  }
  pointerUp() {}
  keyDown(e) {
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (this.state === 'showing' && this.shownWin < this.win) this.finishShowing(); else this.spin(); }
    else if (e.code === 'ArrowUp' || e.code === 'ArrowRight') this.changeBet(1);
    else if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') this.changeBet(-1);
    else if (e.code === 'KeyA') this.toggleAuto();
    else if (e.code === 'KeyL') this.showAllLines();
    else if (/^Digit[1-9]$/.test(e.code) && Number(e.code.slice(5)) <= this.M.lines.length) this.showLine(Number(e.code.slice(5)) - 1);
    else if (e.code === 'Escape') { if (this.picker) this.picker = false; else if (this.showInfo) this.showInfo = false; else this.exit(); }
  }

  // ---- simulation ----
  update(dt) {
    this.time += dt;
    const SPEED = 26; // symbols per second
    let allStill = true;
    for (const r of this.reels) {
      const L = r.strip.length;
      if (r.mode === 'spin') {
        r.v = Math.min(SPEED, r.v + dt * 90);
        r.pos -= r.v * dt;
        if (r.pos < 0) r.pos += L * 1000;
        if (r.stopAt != null && this.time >= r.stopAt) {
          // land on target: choose an end position at least 3 symbols ahead, congruent to the stop
          let to = Math.floor(r.pos) - 3;
          while (((to % L) + L) % L !== r.target) to--;
          r.mode = 'land'; r.from = r.pos; r.to = to; r.t0 = this.time; r.dur = this.turbo ? 0.22 : 0.42;
          r.stopAt = null;
        }
        allStill = false;
      } else if (r.mode === 'land') {
        const k = Math.min(1, (this.time - r.t0) / r.dur);
        r.pos = r.from + (r.to - r.from) * easeOutBack(k);
        if (k >= 1) { r.mode = 'still'; r.pos = ((r.to % L) + L) % L; sfx.reelStop(); }
        allStill = false;
      }
    }
    if (this.state === 'spinning' && Math.floor(this.time * 12) !== Math.floor((this.time - dt) * 12)) sfx.reelSpin();

    if (this.state === 'stopping' && allStill) {
      this.state = 'showing';
      this.showAt = this.time;
      const m = this.result;
      this.win = m.win || 0;
      this.balance = m.bal;
      if (m.rid) this.net.send({ t: 'spin_ack', rid: m.rid }); // the player has now seen this result
      if (this.win > 0) {
        sfx.coin(true);
        const x = this.win / this.totalBet;
        if (x >= 15) { this.banner = { label: x >= 60 ? 'MEGA WIN' : x >= 30 ? 'SUPER WIN' : 'BIG WIN', t: 0, amount: this.win }; sfx.bigWin(); }
        const n = Math.min(60, 8 + Math.round(x * 3));
        for (let i = 0; i < n; i++) {
          this.particles.push({ x: W / 2 + (Math.random() - 0.5) * this.winW, y: this.wy + this.winH, vx: (Math.random() - 0.5) * 500, vy: -300 - Math.random() * 500, t: -Math.random() * 0.6, spin: Math.random() * TAU });
        }
      } else {
        this.shownBal = this.balance;
      }
    }

    if (this.state === 'showing') {
      // count the win up into the balance
      if (this.shownWin < this.win) {
        const step = Math.max(1, Math.ceil(this.win / (this.banner ? 90 : 40)));
        this.shownWin = Math.min(this.win, this.shownWin + step);
        this.shownBal = this.balance - this.win + this.shownWin;
        if (Math.floor(this.time * 20) !== Math.floor((this.time - dt) * 20)) sfx.tick();
      } else {
        this.shownBal = this.balance;
      }
      const hold = this.win > 0 ? (this.banner ? 3.2 : 1.4) : 0.35;
      if (this.auto && this.time - this.showAt > hold && this.shownWin >= this.win) this.spin();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t < 0) continue;
      p.vy += 900 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.spin += dt * 10;
      if (p.y > H + 30) this.particles.splice(i, 1);
    }
    if (this.banner) { this.banner.t += dt; if (this.banner.t > 3.4) this.banner = null; }
  }

  // ---- rendering ----
  render(ctx) {
    const t = this.time;
    // cabinet backdrop
    ctx.fillStyle = rad(ctx, W / 2, H * 0.4, 40, W * 0.8, this.machineId === 'ruby7'
      ? [[0, '#5a0a2a'], [0.6, '#2a0418'], [1, '#0a0008']]
      : [[0, '#3a1470'], [0.6, '#1a0838'], [1, '#05010f']]);
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.translate(W / 2, H * 0.42);
    ctx.rotate(t * 0.08);
    ctx.fillStyle = '#ffd23f';
    for (let i = 0; i < 18; i++) { ctx.rotate(TAU / 18); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(900, -50); ctx.lineTo(900, 50); ctx.fill(); }
    ctx.restore();

    // title
    goldText(ctx, this.M.title.toUpperCase(), W / 2, 62, 58, this.machineId === 'ruby7' ? { colors: ['#ffe0ea', '#ff3b6b', '#9a0030'], stroke: '#2a0010', glow: 'rgba(255,40,90,0.7)' } : {});

    // frame with chasing bulbs
    const fx = this.wx - 26, fy = this.wy - 22, fw = this.winW + 52, fh = this.winH + 44;
    ctx.fillStyle = lin(ctx, 0, fy, 0, fy + fh, [[0, '#ffe680'], [0.5, '#b07000'], [1, '#ffe680']]);
    ctx.beginPath(); ctx.roundRect(fx, fy, fw, fh, 26); ctx.fill();
    ctx.fillStyle = '#1a0a00';
    ctx.beginPath(); ctx.roundRect(fx + 8, fy + 8, fw - 16, fh - 16, 20); ctx.fill();
    const bulbs = 40;
    for (let i = 0; i < bulbs; i++) {
      const k = i / bulbs;
      const per = 2 * (fw + fh);
      let d = k * per, bx, by;
      if (d < fw) { bx = fx + d; by = fy; } else if ((d -= fw) < fh) { bx = fx + fw; by = fy + d; } else if ((d -= fh) < fw) { bx = fx + fw - d; by = fy + fh; } else { d -= fw; bx = fx; by = fy + fh - d; }
      const on = (i + Math.floor(t * (this.state === 'showing' && this.win ? 14 : 5))) % 3 === 0;
      ctx.fillStyle = on ? rad(ctx, bx, by, 0, 8, [[0, '#fff'], [0.4, '#ffe14d'], [1, 'rgba(255,180,0,0)']]) : 'rgba(120,70,0,0.9)';
      ctx.beginPath(); ctx.arc(bx, by, on ? 8 : 4, 0, TAU); ctx.fill();
    }

    // reels
    ctx.save();
    ctx.beginPath(); ctx.rect(this.wx, this.wy, this.winW, this.winH); ctx.clip();
    for (let i = 0; i < this.reels.length; i++) this.renderReel(ctx, i);
    // glass shading
    ctx.fillStyle = lin(ctx, 0, this.wy, 0, this.wy + this.winH, [[0, 'rgba(0,0,0,0.55)'], [0.18, 'rgba(0,0,0,0)'], [0.82, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.55)']]);
    ctx.fillRect(this.wx, this.wy, this.winW, this.winH);
    ctx.restore();
    for (let i = 1; i < this.reels.length; i++) {
      ctx.fillStyle = lin(ctx, 0, this.wy, 0, this.wy + this.winH, [[0, '#7a4a00'], [0.5, '#ffd23f'], [1, '#7a4a00']]);
      ctx.fillRect(this.wx + i * this.reelW - 2, this.wy, 4, this.winH);
    }

    const preview = this.previewLines();
    for (const m of this.lineMarkers()) {
      const on = preview.includes(m.li);
      const r = on ? 14 : 11;
      if (on) {
        ctx.fillStyle = rad(ctx, m.x, m.y, 0, 24, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
        ctx.beginPath(); ctx.arc(m.x, m.y, 24, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(m.x, m.y, r + 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = LINE_COLORS[m.li % LINE_COLORS.length];
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.font = `900 ${on ? 14 : 12}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(m.li + 1), m.x, m.y + 1);
    }
    const winShowing = this.state === 'showing' && this.result?.lines?.length > 0 && this.hoverLine == null;
    const busy = this.state === 'spinning' || this.state === 'stopping';
    if (preview.length) this.renderPreview(ctx, preview, (busy || winShowing) && this.hoverLine == null);

    if (winShowing) this.renderWinLines(ctx);

    this.renderControls(ctx);
    if (this.picker) this.renderPicker(ctx);

    for (const p of this.particles) if (p.t >= 0) drawCoin(ctx, p.x, p.y, 14, p.spin);
    if (this.banner) this.renderBanner(ctx);
    if (this.showInfo) this.renderInfo(ctx);
  }

  renderReel(ctx, i) {
    const r = this.reels[i];
    const L = r.strip.length;
    const x = this.wx + i * this.reelW;
    ctx.fillStyle = lin(ctx, x, 0, x + this.reelW, 0, [[0, '#d8d0c0'], [0.5, '#fffdf5'], [1, '#d8d0c0']]);
    ctx.fillRect(x, this.wy, this.reelW, this.winH);
    const base = Math.floor(r.pos);
    const frac = r.pos - base;
    const blur = r.mode === 'spin' && r.v > 10;
    const winCells = this.winningCells();
    for (let k = -1; k <= this.M.rows; k++) {
      const idx = (((base + k) % L) + L) % L;
      const sym = r.strip[idx];
      const cy = this.wy + (k - frac) * this.cell + this.cell / 2;
      const img = symbolCanvas(sym, this.cell);
      let s = 0.86;
      const row = k;
      const lit = !blur && r.mode === 'still' && winCells.has(`${i}:${row}`);
      if (lit) s *= 1 + Math.sin(this.time * 8) * 0.06;
      const size = this.cell * s;
      if (blur) {
        ctx.globalAlpha = 0.45;
        ctx.drawImage(img, x + this.reelW / 2 - size / 2, cy - size / 2 - this.cell * 0.18, size, size);
        ctx.drawImage(img, x + this.reelW / 2 - size / 2, cy - size / 2 + this.cell * 0.18, size, size);
        ctx.globalAlpha = 0.6;
      }
      if (lit) {
        ctx.fillStyle = rad(ctx, x + this.reelW / 2, cy, 4, this.cell * 0.6, [[0, 'rgba(255,240,120,0.85)'], [1, 'rgba(255,200,0,0)']]);
        ctx.fillRect(x, cy - this.cell / 2, this.reelW, this.cell);
      }
      ctx.drawImage(img, x + this.reelW / 2 - size / 2, cy - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
  }

  winningCells() {
    const set = new Set();
    if (this.state !== 'showing' || !this.result?.lines?.length) return set;
    const ln = this.result.lines[Math.floor((this.time - this.showAt) / 1.2) % this.result.lines.length];
    const rows = this.M.lines[ln.line];
    for (let r = 0; r < ln.count; r++) set.add(`${r}:${rows[r]}`);
    return set;
  }

  /** Payline number badges on both sides of the reels; lines sharing an end row are spread apart. */
  lineMarkers() {
    if (this._markers) return this._markers;
    const out = [];
    for (const side of [0, 1]) {
      const groups = new Map();
      this.M.lines.forEach((rows, li) => {
        const row = side === 0 ? rows[0] : rows[rows.length - 1];
        if (!groups.has(row)) groups.set(row, []);
        groups.get(row).push(li);
      });
      for (const [row, lis] of groups) {
        lis.forEach((li, k) => out.push({
          li, side,
          x: side === 0 ? this.wx - 48 : this.wx + this.winW + 48,
          y: this.wy + row * this.cell + this.cell / 2 + (k - (lis.length - 1) / 2) * 26,
        }));
      }
    }
    return (this._markers = out);
  }

  markerAt(x, y) {
    let best = null, bd = 16;
    for (const m of this.lineMarkers()) {
      const d = Math.hypot(x - m.x, y - m.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  /**
   * Lines shown on the reels: a hovered marker, else the pinned line / all lines (LINES button).
   * Pinned lines stay until tapped again; "all" first walks through each line once.
   */
  previewLines() {
    if (this.hoverLine != null) return [this.hoverLine];
    const p = this.pinned;
    if (!p) return [];
    if (p.all) {
      const n = this.M.lines.length, step = 0.55;
      const k = Math.floor((this.time - p.start) / step);
      return k < n ? [k] : [...Array(n).keys()];
    }
    return [p.line];
  }

  /** Tap a line number: pin that line; tap the same number again to hide it. */
  showLine(li) {
    this.pinned = this.pinned && !this.pinned.all && this.pinned.line === li ? null : { line: li };
    sfx.click();
  }

  /** LINES button: pin all lines; tap again to hide them. */
  showAllLines() {
    this.pinned = this.pinned?.all ? null : { all: true, start: this.time };
    sfx.click();
  }

  linePoints(li) {
    const rows = this.M.lines[li];
    const pts = rows.map((row, r) => [this.wx + r * this.reelW + this.reelW / 2, this.wy + row * this.cell + this.cell / 2]);
    const ms = this.lineMarkers().filter((m) => m.li === li);
    const left = ms.find((m) => m.side === 0), right = ms.find((m) => m.side === 1);
    return [[left.x + 12, left.y], ...pts, [right.x - 12, right.y]];
  }

  /** `dim`: reels are spinning or a win is being shown, so pinned lines step back. */
  renderPreview(ctx, lis, dim = false) {
    const single = lis.length === 1;
    ctx.save();
    if (dim) ctx.globalAlpha = 0.35;
    if (single && !dim) {
      // light up the cells this line reads
      const rows = this.M.lines[lis[0]];
      ctx.fillStyle = 'rgba(255,240,150,0.18)';
      rows.forEach((row, r) => ctx.fillRect(this.wx + r * this.reelW + 3, this.wy + row * this.cell + 3, this.reelW - 6, this.cell - 6));
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const li of lis) {
      const pts = this.linePoints(li);
      const col = LINE_COLORS[li % LINE_COLORS.length];
      ctx.globalAlpha = (single ? 1 : 0.85) * (dim ? 0.35 : 1);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = single ? 11 : 7;
      ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = single ? 7 : 4;
      ctx.shadowColor = col; ctx.shadowBlur = 12;
      ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke();
      ctx.shadowBlur = 0;
      if (single && !dim) {
        ctx.fillStyle = '#fff';
        for (const [x, y] of pts.slice(1, -1)) { ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); }
      }
    }
    ctx.restore();
  }

  renderWinLines(ctx) {
    const lines = this.result.lines;
    const per = 1.2;
    const phase = (this.time - this.showAt) / per;
    const cur = lines[Math.floor(phase) % lines.length];
    const k = phase - Math.floor(phase);                         // 0..1 within the current line's turn
    // amounts are based on the bet of the spin being shown, not the bet selector
    const lineBet = this.result.bet ? this.result.bet / this.M.lines.length : this.lineBet;
    const color = (ln) => LINE_COLORS[ln.line % LINE_COLORS.length];

    const drawPath = (ln, alpha, width) => {
      const pts = this.linePoints(ln.line);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = width + 4;
      ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke();
      ctx.strokeStyle = color(ln); ctx.lineWidth = width;
      ctx.beginPath(); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.stroke();
      ctx.globalAlpha = 1;
    };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = '#fff'; ctx.shadowBlur = 10;
    for (const ln of lines) if (ln !== cur) drawPath(ln, 0.3, 4);
    drawPath(cur, 1, 7);
    ctx.restore();

    // amount tags beside the line numbers for every winning line
    for (const ln of lines) {
      const m = this.lineMarkers().find((mk) => mk.li === ln.line && mk.side === 0);
      const on = ln === cur;
      const txt = fmt(ln.mult * lineBet);
      ctx.font = `900 ${on ? 15 : 13}px ${FONT}`;
      const w = Math.max(44, ctx.measureText(txt).width + 18), h = on ? 24 : 20;
      const x = m.x - 18 - w, y = m.y - h / 2;
      panel(ctx, x, y, w, h, h / 2, { fill: on ? 'rgba(60,30,0,0.92)' : 'rgba(0,0,0,0.75)', stroke: color(ln), lw: on ? 2.5 : 1.5 });
      ctx.fillStyle = on ? '#ffe14d' : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, x + w / 2, y + h / 2 + 1);
    }

    // big amount badge on the current line, between its winning symbols
    const pts = this.linePoints(cur.line);
    const idx = Math.max(1, Math.ceil(cur.count / 2));
    const bx = (pts[idx][0] + pts[idx + 1][0]) / 2, by = (pts[idx][1] + pts[idx + 1][1]) / 2;
    const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.55 : k < 0.25 ? 1.15 - ((k - 0.15) / 0.1) * 0.15 : 1;
    ctx.save();
    ctx.translate(bx, by);
    ctx.scale(pop, pop);
    // badge: line name + combo on top, win amount below (replaces the old strip under the reels)
    const amount = fmt(cur.mult * lineBet);
    const label = `LINE ${cur.line + 1} · ${cur.label.toUpperCase()}`;
    ctx.font = `900 30px ${FONT}`;
    const aw = ctx.measureText(amount).width;
    ctx.font = `800 12px ${FONT}`;
    const bw = Math.max(aw, ctx.measureText(label).width) + 34, bh = 58;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath(); ctx.roundRect(-bw / 2 + 3, -bh / 2 + 4, bw, bh, 20); ctx.fill();
    panel(ctx, -bw / 2, -bh / 2, bw, bh, 20, { fill: lin(ctx, 0, -bh / 2, 0, bh / 2, [[0, '#4a1c00'], [1, '#1a0800']]), stroke: color(cur), lw: 4 });
    ctx.fillStyle = '#ffe9b0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -14);
    goldText(ctx, amount, 0, 9, 28, { glow: null, stroke: '#3a1200' });
    ctx.restore();
  }


  renderControls(ctx) {
    const y = 650;
    ctx.fillStyle = lin(ctx, 0, 592, 0, H, [[0, 'rgba(30,10,0,0.0)'], [0.2, 'rgba(20,6,0,0.85)'], [1, 'rgba(10,3,0,0.95)']]);
    ctx.fillRect(0, 580, W, H - 580);
    ctx.fillStyle = lin(ctx, 0, 598, W, 598, [[0, 'rgba(255,210,63,0)'], [0.5, '#ffd23f'], [1, 'rgba(255,210,63,0)']]);
    ctx.fillRect(0, 597, W, 2);

    const box = (x, w, label, value, color = '#fff', size = 24) => {
      panel(ctx, x, y - 30, w, 62, 12, { fill: 'rgba(0,0,0,0.7)', stroke: 'rgba(255,210,63,0.8)' });
      ctx.fillStyle = '#ffcf5a'; ctx.font = `800 12px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x + w / 2, y - 16);
      ctx.fillStyle = color; ctx.font = `900 ${size}px ${FONT}`;
      ctx.fillText(value, x + w / 2, y + 12);
    };
    box(40, 230, 'CREDITS', fmt(this.shownBal));
    if (this.shownWin) box(290, 150, 'WIN', fmt(this.shownWin), '#ffe14d');
    else box(290, 150, 'WIN', 'GOOD LUCK!', '#9fe0ff', 19);
    box(522, 146, `BET  (${fmt(this.lineBet)} × ${this.M.lines.length} lines)`, fmt(this.totalBet));
    drawCoin(ctx, 66, y + 10, 12, this.time * 2);

    for (const b of this.buttons) {
      const on = b.on ? b.on() : false;
      const stopBtn = b.id === 'spin' && this.auto;
      const disabled = b.id === 'spin' && !this.auto && (this.state === 'spinning' || this.state === 'stopping');
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath(); ctx.arc(2, 4, b.r, 0, TAU); ctx.fill();
      let stops;
      if (b.big) stops = disabled ? [[0, '#c0c0c0'], [0.5, '#707070'], [1, '#303030']]
        : stopBtn ? [[0, '#ffb0b0'], [0.5, '#d01818'], [1, '#4a0000']] : [[0, '#b0ffb0'], [0.5, '#16b030'], [1, '#044a10']];
      else stops = on ? [[0, '#fff6b0'], [0.5, '#ffb800'], [1, '#a05a00']] : [[0, '#ff9ab0'], [0.5, '#c0103a'], [1, '#4a0010']];
      ctx.fillStyle = rad(ctx, -b.r * 0.3, -b.r * 0.4, 1, b.r * 1.3, stops);
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = b.big ? '#ffe680' : 'rgba(255,230,200,0.9)'; ctx.lineWidth = b.big ? 5 : 2; ctx.stroke();
      if (b.big && !disabled) {
        ctx.strokeStyle = `rgba(255,255,160,${0.4 + 0.4 * Math.sin(this.time * 5)})`; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, b.r + 6, 0, TAU); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath(); ctx.ellipse(0, -b.r * 0.45, b.r * 0.65, b.r * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = on ? '#3a1a00' : '#fff';
      const small = b.label.length > 2;
      ctx.font = `900 ${b.big ? 28 : small ? 13 : 22}px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (stopBtn) {
        ctx.font = `900 24px ${FONT}`;
        ctx.fillText('STOP', 0, -9);
        const inf = this.autoLeft === Infinity;
        ctx.font = `900 ${inf ? 28 : 20}px ${FONT}`;
        ctx.fillStyle = '#ffe680';
        ctx.fillText(inf ? '∞' : String(this.autoLeft), 0, 18);
      } else if (b.sub) {
        ctx.fillText(b.label, 0, -5);
        ctx.font = `900 10px ${FONT}`;
        ctx.fillText(b.sub, 0, 13);
      } else if (b.icon) {
        drawAudioIcon(ctx, b.icon, b.r, '#fff');
      } else ctx.fillText(b.label, 0, 2);
      if (b.off?.()) drawOffSlash(ctx, b.r);
      ctx.restore();
    }
    // allow the big button to stop auto-spin
    this.buttons[0].act = () => (this.auto ? this.toggleAuto() : this.spin());
  }

  renderBanner(ctx) {
    const b = this.banner, t = b.t;
    const a = Math.min(1, t * 4, (3.4 - t) * 3);
    const sc = t < 0.3 ? 0.5 + (t / 0.3) * 0.6 : 1.1 - Math.min(0.1, (t - 0.3) * 0.3);
    ctx.save();
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    ctx.translate(W / 2, H / 2 - 20);
    ctx.scale(sc, sc);
    goldText(ctx, b.label, 0, -50, 96);
    goldText(ctx, fmt(Math.min(b.amount, this.shownWin)), 0, 50, 70, { colors: ['#ffffff', '#fff2a8', '#ffc400'] });
    ctx.restore();
  }

  renderInfo(ctx) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(0, 0, W, H);
    panel(ctx, 140, 50, W - 280, H - 100, 22, { fill: 'rgba(40,10,40,0.96)', stroke: '#ffd23f', lw: 3 });
    goldText(ctx, `${this.M.title.toUpperCase()} · PAYTABLE`, W / 2, 92, 34);
    const pays = this.M.pays;
    const cols = this.M.reels === 3 ? 2 : 3;
    const rowsPer = Math.ceil(pays.length / cols);
    const cw = (W - 340) / cols, rh = Math.min(36, (H - 260) / rowsPer);
    const maxLen = Math.max(...pays.map((p) => p.m.length));
    pays.forEach((p, i) => {
      const c = Math.floor(i / rowsPer), r = i % rowsPer;
      const x = 170 + c * cw, y = 140 + r * rh;
      const syms = p.m.map((set) => set[0]);
      const icon = this.M.reels === 5 ? 24 : rh;
      syms.forEach((s, k) => ctx.drawImage(symbolCanvas(s, 64), x + k * (icon + 2), y + (rh - icon) / 2, icon, icon));
      ctx.fillStyle = '#fff'; ctx.font = `700 ${this.M.reels === 5 ? 14 : 15}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(p.label, x + maxLen * (icon + 2) + 8, y + rh / 2);
      ctx.fillStyle = '#ffe14d'; ctx.font = `900 16px ${FONT}`; ctx.textAlign = 'right';
      ctx.fillText(`${p.pay}×`, x + cw - 24, y + rh / 2);
    });
    // payline diagrams
    const top = 140 + rowsPer * rh + 22;
    goldText(ctx, 'PAYLINES', W / 2, top, 20, { glow: null });
    const n = this.M.lines.length, cs = this.M.reels === 3 ? 18 : 13;
    const gw = this.M.reels * cs, gh = this.M.rows * cs, gap = 22;
    const startX = W / 2 - (n * gw + (n - 1) * gap) / 2;
    this.M.lines.forEach((rows, li) => {
      const gx = startX + li * (gw + gap), gy = top + 34;
      const col = LINE_COLORS[li % LINE_COLORS.length];
      for (let r = 0; r < this.M.reels; r++) {
        for (let k = 0; k < this.M.rows; k++) {
          ctx.fillStyle = rows[r] === k ? col : 'rgba(255,255,255,0.12)';
          ctx.fillRect(gx + r * cs + 1, gy + k * cs + 1, cs - 2, cs - 2);
        }
      }
      ctx.fillStyle = col; ctx.font = `900 13px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(li + 1), gx + gw / 2, gy - 10);
    });
    ctx.fillStyle = 'rgba(255,230,230,0.75)'; ctx.font = `600 14px ${FONT}`; ctx.textAlign = 'center';
    const wildNote = this.M.wild != null ? 'Ruby Wild substitutes for every symbol. ' : '';
    ctx.fillText(`${wildNote}Pays left to right on ${this.M.lines.length} lines, × line bet. Highest win per line.`, W / 2, H - 88);
    ctx.fillText('Tap a line number beside the reels (or press 1–9) to show or hide that line. Tap to close.', W / 2, H - 68);
  }
}
