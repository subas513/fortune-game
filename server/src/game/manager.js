import { WebSocketServer } from 'ws';
import { db } from '../db.js';
import { bus } from '../bus.js';
import { getSession } from '../auth.js';
import { presence } from '../presence.js';
import { betLevels } from '../../../shared/fishTypes.js';
import { MACHINES, spinCost } from '../../../shared/slots.js';
import { slotOutcome } from '../../../shared/fair.js';
import { rtpKey } from '../../../shared/rtp.js';
import { gameDebit, gameCredit } from '../wallet.js';
import { FishRoom } from './fishRoom.js';
import { ensureSeeds, takeRound, roundBytes } from '../fair/seeds.js';
import { isHealthy } from '../fair/health.js';
import { recordRound, roundTx, getRound, serializeRound } from '../rounds.js';

const FLUSH_MS = 10_000;
const SLOT_MIN_INTERVAL_MS = 450;

// ---- Room templates (live objects; rooms hold references so admin changes apply immediately) ----
const templates = new Map();
function loadTemplates() {
  const rows = db.prepare('SELECT * FROM rooms ORDER BY sort').all();
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.id);
    const levels = betLevels(r.min_bet, r.max_bet);
    const lines = r.game === 'slot' ? MACHINES[r.variant]?.lines.length : undefined;
    const rtp = r.rtp;
    const tpl = {
      id: r.id, game: r.game, variant: r.variant, name: r.name, enabled: !!r.enabled, rtp, rtpKey: rtpKey(rtp), betLevels: levels,
      public: {
        id: r.id, game: r.game, variant: r.variant, name: r.name, minBet: r.min_bet, maxBet: r.max_bet, betLevels: levels, lines,
        rtp, rtpKey: rtpKey(rtp),
      },
    };
    if (templates.has(r.id)) Object.assign(templates.get(r.id), tpl);
    else templates.set(r.id, tpl);
  }
  for (const id of templates.keys()) if (!seen.has(id)) templates.get(id).enabled = false;
}
loadTemplates();
bus.on('rooms', () => { loadTemplates(); broadcastLobby(); });

// ---- State ----
const clients = new Map();         // playerId -> Client
const fishRooms = new Map();       // tplId -> Set<FishRoom>
let instanceCounter = 1;

const insGS = db.prepare(`INSERT INTO game_sessions (player_id, agent_id, room_id, started_at, balance_start) VALUES (?, ?, ?, ?, ?) RETURNING id`);
const updGS = db.prepare(`UPDATE game_sessions SET total_bet = ?, total_win = ?, shots = ?, kills = ?, balance_end = ?, ended_at = ? WHERE id = ?`);

function onlineCount(tplId) {
  let n = 0;
  for (const c of clients.values()) if (c.tpl?.id === tplId) n++;
  return n;
}
function lobbyRooms() {
  return [...templates.values()].filter((t) => t.enabled).map((t) => ({ ...t.public, online: onlineCount(t.id) }));
}
function broadcastLobby() {
  const msg = JSON.stringify({ t: 'rooms', rooms: lobbyRooms() });
  for (const c of clients.values()) if (!c.tpl) c.sendRaw(msg);
}

class Client {
  constructor(ws, ip) {
    this.ws = ws;
    this.ip = ip;
    this.playerId = 0;
    this.tpl = null;        // current room template
    this.room = null;       // FishRoom instance (fish only)
    this.seat = -1;
    this.stats = null;
    this.gsId = 0;
    this.msgBudget = 80;
    this.lastSpin = 0;
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  sendRaw(s) { if (this.ws.readyState === 1) this.ws.send(s); }

  flush(final = false) {
    if (!this.gsId) return;
    const s = this.stats;
    updGS.run(s.bet, s.win, s.shots, s.kills, this.balance, final ? Date.now() : null, this.gsId);
  }

  enter(tpl) {
    this.tpl = tpl;
    this.stats = { bet: 0, win: 0, shots: 0, kills: 0 };
    this.gsId = insGS.get(this.playerId, this.agentId, tpl.id, Date.now(), this.balance).id;
    presence.set(this.playerId, { roomId: tpl.id, since: Date.now(), ip: this.ip });
  }

  exit() {
    if (!this.tpl) return;
    if (this.room) { this.room.leave(this); this.room = null; }
    this.flush(true);
    this.gsId = 0;
    this.tpl = null;
    presence.set(this.playerId, { roomId: null, since: Date.now(), ip: this.ip });
  }
}

function joinRoom(c, roomId) {
  const tpl = templates.get(String(roomId));
  if (!tpl || !tpl.enabled) return c.send({ t: 'error', code: 'ROOM_UNAVAILABLE', msg: 'This game is not available right now' });
  if (c.tpl) c.exit();
  c.enter(tpl);
  if (tpl.game === 'fish') {
    let set = fishRooms.get(tpl.id);
    if (!set) fishRooms.set(tpl.id, (set = new Set()));
    // Prefer the busiest table that still has a free seat.
    let room = [...set].filter((r) => r.hasFreeSeat()).sort((a, b) => b.playerCount - a.playerCount)[0];
    if (!room) {
      room = new FishRoom(tpl, instanceCounter++, (r) => set.delete(r));
      set.add(room);
    }
    c.room = room;
    room.join(c);
  } else {
    const pending = pendingSpin(c.playerId);
    c.send({ t: 'joined', game: 'slot', room: tpl.public, now: Date.now(), bal: c.balance, pending: pending?.roomId === tpl.id ? pending : null });
  }
}

const setPending = db.prepare('UPDATE players SET pending_round_id = ? WHERE id = ?');

/** The player's last slot spin if they never saw it finish (closed the app, lost connection). */
function pendingSpin(playerId) {
  const id = db.prepare('SELECT pending_round_id AS id FROM players WHERE id = ?').get(playerId)?.id;
  const r = id && serializeRound(getRound(id));
  if (!r) return null;
  return { rid: r.id, roomId: r.roomId, stops: r.detail.stops, lines: r.detail.winLines, win: r.win, bet: r.bet, lineBet: r.detail.lineBet, ts: r.ts };
}

function onSpin(c, msg) {
  const tpl = c.tpl;
  const now = Date.now();
  const lineBet = Number(msg.b);
  if (!tpl.betLevels.includes(lineBet)) return c.send({ t: 'spinerr', id: msg.id, code: 'BAD_BET' });
  if (now - c.lastSpin < SLOT_MIN_INTERVAL_MS) return c.send({ t: 'spinerr', id: msg.id, code: 'TOO_FAST' });
  if (!isHealthy()) return c.send({ t: 'spinerr', id: msg.id, code: 'GAME_CLOSED' });
  const lines = MACHINES[tpl.variant].lines.length;
  const cost = spinCost(tpl.variant, lineBet);
  // Debit, outcome, payout, round record and "unseen spin" marker commit together or not at all.
  const res = roundTx(() => {
    const afterBet = gameDebit(c.playerId, cost);
    if (afterBet == null) return null;
    const seed = takeRound(c.playerId);
    const out = slotOutcome(roundBytes(seed.serverSeed, seed.clientSeed, seed.nonce), tpl.variant, tpl.rtpKey);
    const win = out.totalMult * lineBet;
    const bal = win ? gameCredit(c.playerId, win) : afterBet;
    const rid = recordRound({
      playerId: c.playerId, agentId: c.agentId, roomId: tpl.id, game: 'slot', bet: cost, win, balanceAfter: bal,
      seedId: seed.seedId, nonce: seed.nonce,
      detail: { machine: tpl.variant, level: tpl.rtpKey, lineBet, lines, stops: out.stops, winLines: out.lines },
    });
    setPending.run(rid, c.playerId);
    return { rid, out, win, bal };
  });
  if (!res) return c.send({ t: 'spinerr', id: msg.id, code: 'NO_FUNDS' });
  c.lastSpin = now;
  c.balance = res.bal;
  c.stats.bet += cost;
  c.stats.win += res.win;
  c.stats.shots++;
  if (res.win) c.stats.kills++;
  c.send({ t: 'spin', id: msg.id, rid: res.rid, stops: res.out.stops, lines: res.out.lines, win: res.win, bet: cost, bal: c.balance });
}

function onSpinAck(c, msg) {
  db.prepare('UPDATE players SET pending_round_id = NULL WHERE id = ? AND pending_round_id = ?').run(c.playerId, msg.rid | 0);
}

function handle(c, msg) {
  switch (msg.t) {
    case 'ping': return c.send({ t: 'pong', ct: msg.ct, st: Date.now() });
    case 'rooms': return c.send({ t: 'rooms', rooms: lobbyRooms() });
    case 'join': joinRoom(c, msg.room); return broadcastLobby();
    case 'leave': c.exit(); c.send({ t: 'left', bal: c.balance }); return broadcastLobby();
    case 'spin_ack': return onSpinAck(c, msg);
  }
  if (c.room) {
    if (msg.t === 'fire') return c.room.onFire(c, msg);
    if (msg.t === 'hit') return c.room.onHit(c, msg);
    if (msg.t === 'lv') return c.room.onLevel(c, msg);
    if (msg.t === 'wpn') return c.room.onWeapon(c, msg);
    if (msg.t === 'zap') return c.room.onZap(c, msg);
  } else if (c.tpl?.game === 'slot' && msg.t === 'spin') {
    return onSpin(c, msg);
  }
}

function authenticate(c, token) {
  const s = getSession(token, 'player');
  const p = s && db.prepare('SELECT p.*, a.status AS agent_status FROM players p JOIN agents a ON a.id = p.agent_id WHERE p.id = ?').get(s.subject_id);
  if (!p || p.status !== 'active' || p.agent_status !== 'active') {
    c.send({ t: 'authfail', reason: p && p.status !== 'active' ? 'account_frozen' : 'session_expired' });
    c.ws.close(4001, 'auth');
    return;
  }
  const prev = clients.get(p.id);
  if (prev) {
    prev.send({ t: 'kicked', reason: 'logged_in_elsewhere' });
    prev.exit();
    prev.ws.close(4002, 'replaced');
  }
  ensureSeeds(p.id);
  Object.assign(c, { playerId: p.id, agentId: p.agent_id, username: p.username, nickname: p.nickname || p.username, balance: p.balance });
  clients.set(p.id, c);
  presence.set(p.id, { roomId: null, since: Date.now(), ip: c.ip });
  c.send({
    t: 'hello', now: Date.now(),
    player: { id: p.id, username: p.username, nickname: c.nickname, balance: p.balance },
    rooms: lobbyRooms(),
    pendingSpin: pendingSpin(p.id),
  });
}

// ---- Bus wiring (agent/admin actions) ----
bus.on('balance', (playerId, bal) => {
  const c = clients.get(playerId);
  if (!c) return;
  c.balance = bal;
  c.send({ t: 'wallet', bal });
  if (c.room) c.room.onBalanceChanged(c);
});
bus.on('nickname', (playerId, nick) => {
  const c = clients.get(playerId);
  if (!c) return;
  c.nickname = nick;
  if (c.room && c.seat >= 0) c.room.broadcast({ t: 'pjoin', s: c.seat, p: c.room.seatOf(c) });
});
bus.on('kick', (playerId, reason) => {
  const c = clients.get(playerId);
  if (!c) return;
  c.send({ t: 'kicked', reason });
  c.exit();
  c.ws.close(4003, 'kicked');
});

setInterval(() => { for (const c of clients.values()) c.flush(false); }, FLUSH_MS).unref();
setInterval(() => { for (const c of clients.values()) c.msgBudget = 80; }, 1000).unref();

export function attachGameServer(httpServer, { trustProxy }) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws, req) => {
    const ip = (trustProxy && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
    const c = new Client(ws, ip);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const authTimer = setTimeout(() => { if (!c.playerId) ws.close(4000, 'auth timeout'); }, 10_000);

    ws.on('message', (data) => {
      if (--c.msgBudget < 0) return;
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (!c.playerId) {
        if (msg.t === 'auth') { clearTimeout(authTimer); authenticate(c, msg.token); }
        return;
      }
      try { handle(c, msg); } catch (e) { console.error('[ws] handler error', e); }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (c.playerId && clients.get(c.playerId) === c) {
        c.exit();
        clients.delete(c.playerId);
        presence.delete(c.playerId);
        broadcastLobby();
      }
    });
  });

  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 20_000);
  wss.on('close', () => clearInterval(hb));

  return {
    shutdown() {
      for (const c of clients.values()) { c.exit(); c.ws.close(1001, 'server shutdown'); }
    },
  };
}
