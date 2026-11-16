// Player connection: HTTP login + a single WebSocket with auto-reconnect and clock sync.

export async function login(username, password) {
  const r = await fetch('/api/game/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'Unable to connect to server');
  return j.token;
}

export function logout(token) {
  return fetch('/api/game/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
}

export class Net {
  constructor(token) {
    this.token = token;
    this.handlers = new Map();
    this.ws = null;
    this.offset = 0;        // serverTime - clientTime
    this.samples = [];
    this.closedByUser = false;
    this.retry = 0;
    this.authed = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }
  emit(type, msg) { this.handlers.get(type)?.forEach((fn) => fn(msg)); this.handlers.get('*')?.forEach((fn) => fn(msg)); }

  now() { return Date.now() + this.offset; }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; ws.send(JSON.stringify({ t: 'auth', token: this.token })); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'pong') return this.onPong(m);
      if (m.t === 'hello') {
        this.authed = true;
        this.offset = m.now - Date.now();
        this.startPing();
      }
      if (m.t === 'authfail' || m.t === 'kicked') this.closedByUser = true;
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      const wasAuthed = this.authed;
      this.authed = false;
      if (this.closedByUser) return;
      this.emit('disconnected', { wasAuthed });
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => !this.closedByUser && this.connect(), delay);
    };
  }

  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send({ t: 'ping', ct: Date.now() });
    ping(); setTimeout(ping, 400); setTimeout(ping, 900);
    this.pingTimer = setInterval(ping, 4000);
  }

  onPong(m) {
    const now = Date.now();
    const rtt = now - m.ct;
    this.rtt = rtt;
    this.samples.push({ rtt, off: m.st - (m.ct + rtt / 2) });
    if (this.samples.length > 8) this.samples.shift();
    // Trust the lowest-latency samples most.
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 3);
    this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}

/** Authenticated player HTTP call (fairness data). */
export async function api(path, token, { method = 'GET', body } = {}) {
  const r = await fetch(`/api/game${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || 'Request failed');
  return j;
}
