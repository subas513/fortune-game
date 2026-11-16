import { WORLD } from '/shared/fishTypes.js';
import { SYM } from '/shared/slots.js';
import { buildSprites, buildBackground, buildCaustics, drawFishSprite, drawFishIcon, drawCoin, fmt, TAU } from './art.js';
import { unlockAudio, startMusic, sfx, audioPrefs, setSfx, setMusic } from './audio.js';
import { Net, login, logout } from './net.js';
import { FishScene } from './fishScene.js';
import { SlotScene, symbolCanvas } from './slotScene.js';
import { initProfile, profileOpen, closeProfile } from './profile.js';

const { W, H } = WORLD;
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const canvas = $('game');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------------------
// Stage scaling: fixed 1280x720 design, letterboxed to the window, HiDPI canvas
// ---------------------------------------------------------------------------
let scale = 1, pxScale = 1;
function fit() {
  scale = Math.min(window.innerWidth / W, window.innerHeight / H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  pxScale = scale * dpr;
  stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
  document.documentElement.style.setProperty('--stage-scale', scale);
  canvas.width = Math.round(W * pxScale);
  canvas.height = Math.round(H * pxScale);
}
window.addEventListener('resize', fit);
fit();

// Stop the page from behaving like a web page.
for (const ev of ['contextmenu', 'gesturestart', 'dragstart', 'selectstart']) {
  document.addEventListener(ev, (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
}
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------------------
// App state + shared UI
// ---------------------------------------------------------------------------
const TOKEN_KEY = 'tf_token';
const app = {
  net: null,
  player: null,
  rooms: [],
  scene: null,
  currentRoom: null,
  caustics: null,
  causticPattern: null,

  toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 2600);
  },

  modal(text, { cancel = false, ok = 'OK' } = {}) {
    return new Promise((resolve) => {
      $('modalText').textContent = text;
      $('modalOk').textContent = ok;
      $('modalCancel').style.display = cancel ? '' : 'none';
      $('modal').classList.remove('hidden');
      const done = (v) => { $('modal').classList.add('hidden'); $('modalOk').onclick = $('modalCancel').onclick = null; sfx.click(); resolve(v); };
      $('modalOk').onclick = () => done(true);
      $('modalCancel').onclick = () => done(false);
    });
  },
  confirm(text) { return app.modal(text, { cancel: true, ok: 'YES' }); },

  toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.then?.(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    } else (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
  },

  drawCaustics(c, t) {
    if (!app.causticPattern) app.causticPattern = c.createPattern(app.caustics, 'repeat');
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = app.causticPattern;
    c.globalAlpha = 0.11;
    c.translate(-((t * 14) % 256), -((t * 9) % 256));
    c.fillRect(0, 0, W + 256, H + 256);
    c.restore();
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.07;
    c.scale(1.7, 1.7);
    c.translate(-((t * 6) % 256) - 40, -(256 - ((t * 11) % 256)));
    c.fillStyle = app.causticPattern;
    c.fillRect(0, 0, W + 512, H + 512);
    c.restore();
  },

  leaveRoom() {
    curtain(true);
    app.net.send({ t: 'leave' });
  },
};

function curtain(on) { $('curtain').classList.toggle('on', on); }

function showScreen(id) {
  for (const s of ['loading', 'login', 'lobby']) $(s).classList.toggle('hidden', s !== id);
}

function setLoading(p, msg) {
  $('loadfill').style.width = `${Math.round(p * 100)}%`;
  $('loadtext').textContent = msg;
}

// ---------------------------------------------------------------------------
// Ambient scene behind login/lobby: client-only fish drifting over the reef
// ---------------------------------------------------------------------------
// Animated backdrop behind login and lobby: a neutral casino stage that hints at every game type
// (slot symbols, coins and the odd sea creature) rather than one game's scenery.
class AmbientScene {
  constructor() {
    this.time = 0;
    this.bg = this.buildBackdrop();
    this.glows = ['255,200,60', '255,70,170', '80,200,255', '170,110,255'].map((c) => this.glowSprite(c));
    this.bokeh = Array.from({ length: 26 }, () => this.newBokeh(true));
    this.items = Array.from({ length: 22 }, () => this.newItem(true));
  }

  buildBackdrop() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    let gr = g.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.5, W * 0.75);
    gr.addColorStop(0, '#3a1a78'); gr.addColorStop(0.45, '#1c0c48'); gr.addColorStop(1, '#06031a');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // faint diamond lattice, like a casino carpet / glass ceiling
    g.strokeStyle = 'rgba(255,210,120,0.05)'; g.lineWidth = 1.5;
    for (let x = -H; x < W + H; x += 64) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke();
      g.beginPath(); g.moveTo(x + H, 0); g.lineTo(x, H); g.stroke();
    }
    // warm stage glow along the bottom
    gr = g.createRadialGradient(W / 2, H + 120, 20, W / 2, H + 120, W * 0.6);
    gr.addColorStop(0, 'rgba(255,170,60,0.35)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // vignette
    gr = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.72);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,10,0.6)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    return c;
  }

  glowSprite(rgb) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${rgb},0.9)`); gr.addColorStop(0.35, `rgba(${rgb},0.35)`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;
  }

  newBokeh(initial) {
    return { x: Math.random() * W, y: initial ? Math.random() * H : H + 80, r: 30 + Math.random() * 90, g: Math.floor(Math.random() * 4),
      vy: 6 + Math.random() * 14, vx: (Math.random() - 0.5) * 8, ph: Math.random() * TAU, a: 0.12 + Math.random() * 0.22 };
  }

  newItem(initial) {
    const r = Math.random();
    const kind = r < 0.5 ? 'coin' : r < 0.85 ? 'sym' : 'fish';
    const z = 0.45 + Math.random() * 0.55; // depth: far items are smaller, dimmer and slower
    const syms = [SYM.SEVEN_RED, SYM.SEVEN_RED, SYM.SEVEN_BLUE, SYM.CHERRY, SYM.BELL, SYM.BAR3, SYM.WILD, SYM.MELON];
    return {
      kind, z,
      sym: syms[Math.floor(Math.random() * syms.length)],
      ty: [1, 2, 3, 6, 8, 10, 12][Math.floor(Math.random() * 7)],
      x: Math.random() * W, y: initial ? Math.random() * H : H + 90,
      vy: (18 + Math.random() * 22) * z, sway: 10 + Math.random() * 30, ph: Math.random() * TAU,
      rot: (Math.random() - 0.5) * 0.6, vr: (Math.random() - 0.5) * 0.6, spin: Math.random() * TAU,
    };
  }

  update(dt) {
    this.time += dt;
    for (let i = 0; i < this.bokeh.length; i++) {
      const b = this.bokeh[i];
      b.y -= b.vy * dt; b.x += b.vx * dt;
      if (b.y < -b.r) this.bokeh[i] = this.newBokeh(false);
    }
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      it.y -= it.vy * dt; it.rot += it.vr * dt; it.spin += dt * 3;
      if (it.y < -100) this.items[i] = this.newItem(false);
    }
  }

  render(c) {
    const t = this.time;
    c.drawImage(this.bg, 0, 0, W, H);

    // slowly turning spotlight rays from above
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.translate(W / 2, -60);
    c.rotate(Math.sin(t * 0.12) * 0.25);
    for (let i = 0; i < 9; i++) {
      const a = Math.PI / 2 + (i - 4) * 0.2;
      const gr = c.createLinearGradient(0, 0, Math.cos(a) * 900, Math.sin(a) * 900);
      gr.addColorStop(0, `rgba(255,220,140,${0.07 + 0.03 * Math.sin(t * 0.8 + i)})`);
      gr.addColorStop(1, 'rgba(255,200,120,0)');
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(0, 0);
      c.lineTo(Math.cos(a - 0.05) * 900, Math.sin(a - 0.05) * 900);
      c.lineTo(Math.cos(a + 0.05) * 900, Math.sin(a + 0.05) * 900);
      c.closePath(); c.fill();
    }
    // soft coloured light orbs
    for (const b of this.bokeh) {
      c.globalAlpha = b.a * (0.7 + 0.3 * Math.sin(t * 0.9 + b.ph));
      c.drawImage(this.glows[b.g], b.x - b.r, b.y + 60 - b.r, b.r * 2, b.r * 2);
    }
    c.restore();

    // floating coins, slot symbols and the odd sea creature (far ones first)
    const list = [...this.items].sort((a, b) => a.z - b.z);
    for (const it of list) {
      const x = it.x + Math.sin(t * 0.6 + it.ph) * it.sway;
      const alpha = 0.35 + 0.55 * it.z;
      if (it.kind === 'coin') {
        c.globalAlpha = alpha;
        drawCoin(c, x, it.y, 16 * it.z + 6, it.spin);
      } else if (it.kind === 'sym') {
        const size = 70 * it.z + 20;
        c.save();
        c.globalAlpha = alpha;
        c.translate(x, it.y); c.rotate(it.rot);
        c.drawImage(symbolCanvas(it.sym, 96), -size / 2, -size / 2, size, size);
        c.restore();
      } else {
        drawFishSprite(c, it.ty, x, it.y, -Math.PI / 2 + Math.sin(t * 1.4 + it.ph) * 0.25, t, { alpha, scale: 0.55 + 0.45 * it.z, shadow: false });
      }
    }
    c.globalAlpha = 1;

    // keep the UI on top readable
    c.fillStyle = 'rgba(4,2,20,0.35)';
    c.fillRect(0, 0, W, H);
  }
}
let ambient = null;

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  unlockAudio();
  const u = $('lu').value.trim(), p = $('lp').value;
  if (!u || !p) { $('loginErr').textContent = 'Please enter your account and password.'; sfx.error(); return; }
  $('loginBtn').disabled = true;
  $('loginErr').textContent = '';
  try {
    const token = await login(u, p);
    const remember = $('lr').checked;
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    (remember ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
    if (remember) localStorage.setItem('tf_user', u); else localStorage.removeItem('tf_user');
    $('lp').value = '';
    setPasswordVisible(false);
    sfx.coin();
    await enterWithToken(token);
  } catch (err) {
    $('loginErr').textContent = err.message;
    sfx.error();
  } finally {
    $('loginBtn').disabled = false;
  }
});

// Eye button: show / hide the password while typing.
function setPasswordVisible(on) {
  $('lp').type = on ? 'text' : 'password';
  $('lpEye').classList.toggle('on', on);
  $('lpEye').title = $('lpEye').ariaLabel = on ? 'Hide password' : 'Show password';
}
$('lpEye').addEventListener('click', () => {
  setPasswordVisible($('lp').type === 'password');
  $('lp').focus();
});

// Profile panel (change name / password)
app.onProfileChanged = () => {
  const p = app.player;
  $('nick').textContent = p.nickname;
  $('avatar').textContent = (p.nickname || '?').slice(0, 1).toUpperCase();
};
initProfile(app, {
  // after a password change the server issues a new token for this device
  setToken(token) {
    if (localStorage.getItem(TOKEN_KEY)) localStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.setItem(TOKEN_KEY, token);
    if (app.net) app.net.token = token;
  },
});

function storedToken() { return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); }
function clearToken() { localStorage.removeItem(TOKEN_KEY); sessionStorage.removeItem(TOKEN_KEY); }

function toLogin(message) {
  closeProfile();
  app.net?.close();
  app.net = null;
  endScene();
  curtain(false);
  $('reconnect').classList.add('hidden');
  showScreen('login');
  $('lu').value = localStorage.getItem('tf_user') || '';
  startMusic('lobby');
  if (message) app.modal(message);
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------
const KICK_TEXT = {
  logged_in_elsewhere: 'Your account was logged in on another device.',
  account_frozen: 'Your account has been frozen. Please contact your agent.',
  password_changed: 'Your password was changed. Please log in again.',
  kicked_by_agent: 'You have been disconnected by your agent.',
  kicked_by_admin: 'You have been disconnected by the operator.',
  session_expired: 'Your session has expired. Please log in again.',
};

// `initial: true` is used during boot: the loading screen stays up until the
// socket is authenticated, and the resolved promise hands back the server's hello.
function connect(token, { initial = false } = {}) {
  app.net?.close();
  const net = new Net(token);
  app.net = net;
  let rejoinRoom = null;
  let restoringSession = initial;
  let settleInitial;
  const initialReady = initial ? new Promise((resolve) => { settleInitial = resolve; }) : null;
  const finishInitial = (result) => {
    restoringSession = false;
    if (!settleInitial) return;
    settleInitial(result);
    settleInitial = null;
  };

  net.on('hello', (m) => {
    app.player = m.player;
    app.rooms = m.rooms;
    $('reconnect').classList.add('hidden');
    if (initial) { finishInitial({ ok: true, hello: m }); return; }
    if (rejoinRoom) { net.send({ t: 'join', room: rejoinRoom }); rejoinRoom = null; return; }
    afterHello(m);
  });
  net.on('authfail', (m) => {
    finishInitial({ ok: false });
    clearToken();
    toLogin(m.reason === 'account_frozen' ? KICK_TEXT.account_frozen : null);
  });
  net.on('kicked', (m) => {
    finishInitial({ ok: false });
    clearToken();
    toLogin(KICK_TEXT[m.reason] || 'You have been disconnected.');
  });
  net.on('disconnected', () => {
    if (app.currentRoom) rejoinRoom = app.currentRoom;
    endScene();
    // During boot the loading screen stays up and the client retries quietly.
    if (!restoringSession) $('reconnect').classList.remove('hidden');
  });
  net.on('rooms', (m) => { app.rooms = m.rooms; renderTiles(); });
  net.on('wallet', (m) => { app.player.balance = m.bal; updateLobbyBalance(); if (!app.scene) app.toast(`Balance updated: ${fmt(m.bal)}`); });
  net.on('error', (m) => { app.toast(m.msg || 'Something went wrong'); curtain(false); });
  net.on('joined', (m) => startScene(m));
  net.on('left', (m) => { app.player.balance = m.bal; endScene(); enterLobby(); });
  net.connect();
  return initialReady;
}

// Runs once the socket is authenticated: show the lobby, then report any spin
// that settled while the player was away.
function afterHello(m) {
  enterLobby();
  const ps = m.pendingSpin;
  if (ps) {
    const name = app.rooms.find((r) => r.id === ps.roomId)?.name || 'a slot machine';
    app.modal(ps.win ? `Your last spin on ${name} finished while you were away. You won ${fmt(ps.win)}!` : `Your last spin on ${name} finished while you were away. No win that time.`);
    app.net.send({ t: 'spin_ack', rid: ps.rid });
  }
}

// Restores a session under the loading screen. Used for a stored token at boot
// and right after a successful login, so slow networks (e.g. 3G WebSocket
// handshakes) still show progress and retry quietly instead of appearing stuck.
async function enterWithToken(token) {
  showScreen('loading');
  setLoading(0.9, 'Connecting to the table…');
  const slow = setTimeout(() => setLoading(0.95, 'Still connecting… check your connection.'), 8000);
  const res = await connect(token, { initial: true });
  clearTimeout(slow);
  if (!res?.ok) return false; // auth failed: toLogin() has already taken over
  setLoading(1, 'Ready!');
  await new Promise((r) => setTimeout(r, 150));
  afterHello(res.hello);
  return true;
}

function enterLobby() {
  app.currentRoom = null;
  showScreen('lobby');
  const p = app.player;
  $('nick').textContent = p.nickname;
  $('uid').textContent = `ID: ${p.username}`;
  $('avatar').textContent = (p.nickname || '?').slice(0, 1).toUpperCase();
  updateLobbyBalance();
  renderTiles();
  syncSoundButton();
  curtain(false);
  startMusic('lobby');
}

function updateLobbyBalance() { $('lobbyBal').textContent = fmt(app.player?.balance ?? 0); }

function startScene(joined) {
  canvas.classList.remove('hand', 'aim');
  endScene();
  app.currentRoom = joined.room.id;
  if (joined.game === 'fish') app.scene = new FishScene(app, joined);
  else app.scene = new SlotScene(app, joined);
  showScreen(null);
  setTimeout(() => curtain(false), 150);
}

function endScene() {
  canvas.classList.remove('hand', 'aim');
  app.scene?.destroy();
  app.scene = null;
}

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
let activeTab = 'all';
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  activeTab = b.dataset.tab;
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
  sfx.click();
  renderTiles();
}));

document.querySelector('.tools').addEventListener('click', async (e) => {
  const act = e.target.closest('button')?.dataset.act;
  if (!act) return;
  sfx.click();
  if (act === 'full') app.toggleFullscreen();
  if (act === 'sound') { setSfx(!audioPrefs().sfx); syncSoundButton(); }
  if (act === 'music') { setMusic(!audioPrefs().music); syncSoundButton(); }
  if (act === 'logout' && (await app.confirm('Log out of Tidal Fortune?'))) {
    const t = storedToken();
    clearToken();
    if (t) logout(t);
    toLogin();
  }
});
function syncSoundButton() {
  document.querySelector('[data-act=sound]').classList.toggle('off', !audioPrefs().sfx);
  document.querySelector('[data-act=music]').classList.toggle('off', !audioPrefs().music);
}

const THUMB_FISH = { reef: [2, 3, 1], lagoon: [8, 6, 5], abyss: [13] };
const thumbCache = new Map();
function thumb(room) {
  if (thumbCache.has(room.id)) return thumbCache.get(room.id);
  const c = document.createElement('canvas');
  c.width = 208 * 2; c.height = 210 * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  if (room.game === 'fish') {
    const sceneIdx = { reef: 0, lagoon: 1, abyss: 2 }[room.id] ?? 0;
    g.drawImage(buildBackground(sceneIdx), 380, 180, 520, 525, 0, 0, 208, 210);
    const list = THUMB_FISH[room.id] || [2];
    if (list.length === 1) drawFishIcon(g, list[0], 104, 108, 180, 170);
    else list.forEach((ty, i) => drawFishIcon(g, ty, [70, 140, 100][i], [70, 100, 160][i], 110, 70));
  } else {
    const grad = g.createRadialGradient(104, 105, 10, 104, 105, 150);
    grad.addColorStop(0, room.variant === 'ruby7' ? '#ff3b6b' : '#8a3bff');
    grad.addColorStop(1, '#12001f');
    g.fillStyle = grad;
    g.fillRect(0, 0, 208, 210);
    const syms = room.variant === 'ruby7' ? [SYM.WILD, SYM.SEVEN_RED, SYM.WILD] : [SYM.SEVEN_RED, SYM.SEVEN_RED, SYM.SEVEN_RED];
    syms.forEach((s, i) => g.drawImage(symbolCanvas(s, 120), 2 + i * 68, 60, 68, 68));
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, 50, 208, 4); g.fillRect(0, 134, 208, 4);
  }
  thumbCache.set(room.id, c);
  return c;
}

function renderTiles() {
  const box = $('tiles');
  box.innerHTML = '';
  app.rooms.forEach((r, i) => {
    const el = document.createElement('div');
    el.className = `tile ${r.game}${activeTab !== 'all' && activeTab !== r.game ? ' hidden' : ''}`;
    el.style.animationDelay = `${i * 0.06}s`;
    const cv = thumb(r);
    const shown = document.createElement('canvas');
    shown.width = cv.width; shown.height = cv.height;
    shown.getContext('2d').drawImage(cv, 0, 0);
    el.appendChild(shown);
    const lineInfo = r.game === 'slot' ? ` · ${r.lines} lines` : '';
    el.insertAdjacentHTML('beforeend', `
      <div class="ribbon">${r.game === 'slot' ? '777' : r.id === 'abyss' ? 'HIGH' : 'HOT'}</div>
      <div class="tname"></div>
      <div class="tbet">Bet ${fmt(r.minBet)} – ${fmt(r.maxBet)}${lineInfo}</div>
      <div class="tonline">● ${r.online} playing</div>`);
    el.querySelector('.tname').textContent = r.name;
    el.addEventListener('click', () => {
      unlockAudio();
      sfx.click();
      curtain(true);
      setTimeout(() => app.net.send({ t: 'join', room: r.id }), 250);
    });
    box.appendChild(el);
  });
}

// ---------------------------------------------------------------------------
// Input -> active scene (stage coordinates)
// ---------------------------------------------------------------------------
function toStage(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (!app.scene) return;
  canvas.setPointerCapture(e.pointerId);
  const p = toStage(e);
  app.scene.pointerDown(p.x, p.y);
});
canvas.addEventListener('pointermove', (e) => {
  if (!app.scene) return;
  const p = toStage(e);
  app.scene.pointerMove(p.x, p.y);
  updateCursor(p.x, p.y);
});

// Cursor over the game canvas: hand over buttons, aiming reticle on fish tables, arrow elsewhere.
function updateCursor(x, y) {
  const s = app.scene;
  const overButton = s?.buttons?.some((b) => Math.hypot(x - b.x, y - b.y) <= b.r + 6)
    || (s?.markerAt && s.markerAt(x, y)) || (s?.picker && s.pickerOptions?.().some((o) => Math.hypot(x - o.x, y - o.y) <= o.r + 6));
  const mode = overButton ? 'hand' : s instanceof FishScene && !s.showInfo ? 'aim' : '';
  canvas.classList.toggle('hand', mode === 'hand');
  canvas.classList.toggle('aim', mode === 'aim');
}
canvas.addEventListener('pointerup', (e) => { if (app.scene) { const p = toStage(e); app.scene.pointerUp(p.x, p.y); } });
canvas.addEventListener('pointercancel', () => app.scene?.pointerUp());
window.addEventListener('keydown', (e) => {
  if (profileOpen() && $('modal').classList.contains('hidden')) {
    if (e.code === 'Escape') closeProfile();
    return;
  }
  if (!$('modal').classList.contains('hidden')) {
    if (e.code === 'Enter') $('modalOk').click();
    if (e.code === 'Escape' && $('modalCancel').style.display !== 'none') $('modalCancel').click();
    return;
  }
  if (app.scene && !(e.target instanceof HTMLInputElement)) app.scene.keyDown(e);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) app.scene?.pointerUp?.(); });

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const s = app.scene || ambient;
  if (s) {
    s.update(dt);
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    s.render(ctx);
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function boot() {
  requestAnimationFrame(frame);
  const step = setLoading;
  step(0.02, 'Summoning sea creatures…');
  await buildSprites((p) => step(0.05 + p * 0.75, 'Summoning sea creatures…'));
  step(0.85, 'Lighting the reef…');
  await new Promise((r) => setTimeout(r, 0));
  app.caustics = buildCaustics();
  ambient = new AmbientScene();
  // A stored session is restored under the loading screen, so a refresh goes
  // straight from the progress bar into the lobby with no "Reconnecting…" flash.
  const token = storedToken();
  if (token) {
    await enterWithToken(token);
  } else {
    step(1, 'Ready!');
    await new Promise((r) => setTimeout(r, 250));
    toLogin();
  }
})();
