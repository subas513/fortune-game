// Procedural art: every creature, background and prop is drawn with Canvas 2D at load time
// into sprite sheets, so the game ships with zero image assets.
import { FISH, WORLD } from '/shared/fishTypes.js';

const TAU = Math.PI * 2;
export const SPRITE_RES = 1.6;     // supersampling for crisp sprites on HiDPI
export const FRAMES = 12;          // animation frames per creature

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w);
  c.height = Math.ceil(h);
  return c;
}

function lin(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}
function rad(ctx, x, y, r0, r1, stops, x1 = x, y1 = y) {
  const g = ctx.createRadialGradient(x, y, r0, x1, y1, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function eye(ctx, x, y, r, iris = '#111') {
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = iris;
  ctx.beginPath(); ctx.arc(x + r * 0.2, y, r * 0.62, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(x + r * 0.35, y - r * 0.3, r * 0.25, 0, TAU); ctx.fill();
}

// ---------------------------------------------------------------------------
// Side-view fish (small reef fish)
// ---------------------------------------------------------------------------
function sideBody(ctx, a, h) {
  ctx.beginPath();
  ctx.moveTo(a, 0);
  ctx.bezierCurveTo(a * 0.9, -h * 1.08, -a * 0.35, -h * 1.02, -a * 0.8, -h * 0.22);
  ctx.quadraticCurveTo(-a * 0.88, 0, -a * 0.8, h * 0.22);
  ctx.bezierCurveTo(-a * 0.35, h * 1.02, a * 0.9, h * 1.08, a, 0);
  ctx.closePath();
}

function tail(ctx, a, h, phase, style, fill) {
  const w = Math.sin(phase * TAU) * 0.32;
  ctx.save();
  ctx.translate(-a * 0.78, 0);
  ctx.rotate(w);
  ctx.fillStyle = fill;
  const tl = a * (style === 'lyre' ? 0.95 : 0.55), th = h * (style === 'lyre' ? 1.25 : 0.95);
  ctx.beginPath();
  if (style === 'round') {
    ctx.moveTo(0, -h * 0.2);
    ctx.bezierCurveTo(-tl * 0.6, -th, -tl * 1.1, -th * 0.6, -tl * 1.05, 0);
    ctx.bezierCurveTo(-tl * 1.1, th * 0.6, -tl * 0.6, th, 0, h * 0.2);
  } else if (style === 'lyre') {
    ctx.moveTo(0, -h * 0.15);
    ctx.bezierCurveTo(-tl * 0.3, -th * 0.8, -tl * 0.9, -th * 1.2, -tl * 1.1, -th);
    ctx.quadraticCurveTo(-tl * 0.55, 0, -tl * 1.1, th);
    ctx.bezierCurveTo(-tl * 0.9, th * 1.2, -tl * 0.3, th * 0.8, 0, h * 0.15);
  } else {
    ctx.moveTo(0, -h * 0.15);
    ctx.quadraticCurveTo(-tl * 0.4, -th * 0.5, -tl, -th);
    ctx.quadraticCurveTo(-tl * 0.55, 0, -tl, th);
    ctx.quadraticCurveTo(-tl * 0.4, th * 0.5, 0, h * 0.15);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // fin rays
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(-tl * 0.85, (th * i) / 2.6); ctx.stroke();
  }
  ctx.restore();
}

function dorsal(ctx, a, h, fill, tall = 0.6, phase = 0) {
  const s = Math.sin(phase * TAU) * 0.05;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(a * 0.25, -h * 0.9);
  ctx.quadraticCurveTo(-a * 0.05, -h * (1 + tall) - s * h, -a * 0.55, -h * (0.75 + tall * 0.6));
  ctx.quadraticCurveTo(-a * 0.4, -h * 0.6, -a * 0.6, -h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(-a * 0.05, h * 0.85);
  ctx.quadraticCurveTo(-a * 0.35, h * (1 + tall * 0.6), -a * 0.6, h * 0.5);
  ctx.closePath();
  ctx.fill();
}

function pectoral(ctx, a, h, fill, phase) {
  const f = Math.sin(phase * TAU * 2) * 0.35;
  ctx.save();
  ctx.translate(a * 0.25, h * 0.25);
  ctx.rotate(0.6 + f);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(-a * 0.15, 0, a * 0.2, h * 0.22, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function sideFish(ctx, phase, o) {
  const { a, h } = o;
  tail(ctx, a, h, phase, o.tail, o.tailFill || o.fin);
  dorsal(ctx, a, h, o.fin, o.tall ?? 0.45, phase);
  ctx.save();
  sideBody(ctx, a, h);
  ctx.fillStyle = lin(ctx, 0, -h, 0, h, [[0, o.top], [0.5, o.mid], [1, o.belly]]);
  ctx.fill();
  ctx.clip();
  if (o.decorate) o.decorate(ctx, a, h, phase);
  // gill line + shine
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = Math.max(1, a * 0.05);
  ctx.beginPath(); ctx.arc(a * 0.75, 0, h * 0.95, Math.PI * 0.78, Math.PI * 1.22); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.ellipse(a * 0.1, -h * 0.5, a * 0.55, h * 0.18, -0.08, 0, TAU); ctx.fill();
  ctx.restore();
  sideBody(ctx, a, h);
  ctx.strokeStyle = o.outline || 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1.2, a * 0.05);
  ctx.stroke();
  pectoral(ctx, a, h, o.fin, phase);
  eye(ctx, a * 0.62, -h * 0.18, Math.max(2.5, h * 0.24));
  // mouth
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(a * 0.97, h * 0.08); ctx.lineTo(a * 0.82, h * 0.16); ctx.stroke();
}

// ---------------------------------------------------------------------------
// Top-down swimmers (sharks, whale): body undulates laterally
// ---------------------------------------------------------------------------
function topBody(ctx, a, wFn, phase, amp) {
  const N = 26, up = [], dn = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;                        // 0 = tail, 1 = nose
    const x = -a + u * 2 * a;
    const off = amp * Math.sin(phase * TAU - u * 4.2) * Math.pow(1 - u, 1.6);
    const w = wFn(u);
    up.push([x, off - w]);
    dn.push([x, off + w]);
  }
  ctx.beginPath();
  ctx.moveTo(up[0][0], up[0][1]);
  for (const p of up) ctx.lineTo(p[0], p[1]);
  for (let i = dn.length - 1; i >= 0; i--) ctx.lineTo(dn[i][0], dn[i][1]);
  ctx.closePath();
  return (u) => amp * Math.sin(phase * TAU - u * 4.2) * Math.pow(1 - u, 1.6); // spine offset
}

function sharkTop(ctx, phase, o) {
  const a = o.a, W = o.w;
  const wFn = (u) => W * Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.95 + 0.04)), 0.8) * (u > 0.85 ? 1 - (u - 0.85) * 2.2 : 1) * (0.25 + u * 0.75);
  const spine = (u) => (o.amp) * Math.sin(phase * TAU - u * 4.2) * Math.pow(1 - u, 1.6);
  // pectoral fins
  ctx.fillStyle = o.fin;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    const bx = a * 0.25, by = spine(0.62) + s * W * 0.7;
    ctx.moveTo(bx + a * 0.08, by);
    ctx.quadraticCurveTo(bx - a * 0.05, by + s * W * 1.6, bx - a * 0.3, by + s * W * 1.9);
    ctx.quadraticCurveTo(bx - a * 0.12, by + s * W * 0.6, bx - a * 0.12, by);
    ctx.fill();
  }
  // tail fin (horizontal from above it's a crescent)
  const tOff = spine(0);
  const tw = Math.sin(phase * TAU) * 0.5;
  ctx.save();
  ctx.translate(-a * 0.98, tOff);
  ctx.rotate(tw);
  ctx.beginPath();
  ctx.moveTo(a * 0.05, 0);
  ctx.quadraticCurveTo(-a * 0.1, -W * 0.3, -a * 0.22, -W * 1.1);
  ctx.quadraticCurveTo(-a * 0.08, 0, -a * 0.22, W * 1.1);
  ctx.quadraticCurveTo(-a * 0.1, W * 0.3, a * 0.05, 0);
  ctx.fill();
  ctx.restore();
  // body
  ctx.save();
  topBody(ctx, a, wFn, phase, o.amp);
  ctx.fillStyle = lin(ctx, 0, -W, 0, W, [[0, o.edge], [0.5, o.spine], [1, o.edge]]);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(-a, -W * 0.15, a * 2, W * 0.12);
  if (o.decorate) o.decorate(ctx, a, W, phase, spine);
  ctx.restore();
  topBody(ctx, a, wFn, phase, o.amp);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // dorsal fin seen from above: a thin dark blade
  ctx.fillStyle = o.dorsal || 'rgba(0,0,0,0.35)';
  const dOff = spine(0.55);
  ctx.beginPath();
  ctx.moveTo(a * 0.2, dOff);
  ctx.quadraticCurveTo(-a * 0.05, dOff - W * 0.22, -a * 0.25, dOff);
  ctx.quadraticCurveTo(-a * 0.05, dOff + W * 0.22, a * 0.2, dOff);
  ctx.fill();
  if (o.head) o.head(ctx, a, W);
  else {
    eye(ctx, a * 0.78, -W * 0.45, W * 0.13, '#000');
    eye(ctx, a * 0.78, W * 0.45, W * 0.13, '#000');
  }
}

// ---------------------------------------------------------------------------
// Creature definitions: draw(ctx, phase) with the creature centered and facing +x
// ---------------------------------------------------------------------------
const CRAB_RED = { body: ['#ff6b4a', '#d9261a', '#7a0c06'], leg: '#8a1a10', claw: '#e8321e', tip: '#ff6a50', rim: '#4a0602' };

function crabBody(ctx, ph, c, core) {
  const s = Math.sin(ph * TAU);
  ctx.strokeStyle = c.leg; ctx.lineWidth = 4; ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const lx = -14 + i * 12, w = Math.sin(ph * TAU + i * 1.4) * 4;
      ctx.beginPath(); ctx.moveTo(lx, side * 14); ctx.lineTo(lx - 6 + w, side * 32); ctx.lineTo(lx - 12 + w, side * 40); ctx.stroke();
    }
  }
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(14, side * 16); ctx.lineTo(28, side * 28); ctx.stroke();
    ctx.fillStyle = c.claw;
    ctx.save(); ctx.translate(36, side * 30); ctx.rotate(side * (0.3 + s * 0.15));
    ctx.beginPath(); ctx.ellipse(0, 0, 12, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = c.tip;
    ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(18, -6 - Math.abs(s) * 4); ctx.lineTo(10, 1); ctx.fill();
    ctx.restore();
  }
  ctx.lineCap = 'butt';
  ctx.fillStyle = rad(ctx, 0, -6, 2, 34, [[0, c.body[0]], [0.6, c.body[1]], [1, c.body[2]]]);
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 24, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = c.rim; ctx.lineWidth = 2; ctx.stroke();
  core(0.55 + 0.45 * Math.sin(ph * TAU * 2));
  for (const side of [-1, 1]) eye(ctx, 26, side * 8, 4, '#000');
}

const DRAW = {
  minnow: (ctx, ph) => sideFish(ctx, ph, {
    a: 20, h: 9, tail: 'fork', top: '#46667f', mid: '#b8cfdd', belly: '#f2f7fa', fin: 'rgba(160,200,225,0.9)',
    decorate: (c, a, h) => { c.fillStyle = 'rgba(40,140,255,0.6)'; c.fillRect(-a, -h * 0.05, a * 2, h * 0.18); },
  }),
  guppy: (ctx, ph) => sideFish(ctx, ph, {
    a: 22, h: 12, tail: 'lyre', top: '#ff8a00', mid: '#ffd23a', belly: '#fff4b8', fin: '#ff7a1a', tall: 0.8,
    tailFill: lin(ctx, -22, 0, -50, 0, [[0, '#ff8f1f'], [0.5, '#ff2d55'], [1, '#9b30ff']]),
  }),
  clown: (ctx, ph) => sideFish(ctx, ph, {
    a: 24, h: 14, tail: 'round', top: '#e65100', mid: '#ff7b16', belly: '#ffb15c', fin: '#ff7417', outline: '#2a1200',
    decorate: (c, a, h) => {
      for (const x of [a * 0.45, -a * 0.1, -a * 0.6]) {
        c.fillStyle = '#1b0d00'; c.fillRect(x - a * 0.13, -h * 1.2, a * 0.26, h * 2.4);
        c.fillStyle = '#fff'; c.fillRect(x - a * 0.09, -h * 1.2, a * 0.18, h * 2.4);
      }
    },
  }),
  tang: (ctx, ph) => sideFish(ctx, ph, {
    a: 25, h: 17, tail: 'fork', top: '#0c2f9e', mid: '#1f5dff', belly: '#58a0ff', fin: '#1438b8', tailFill: '#ffd60a', tall: 0.3,
    decorate: (c, a, h) => {
      c.fillStyle = '#071440';
      c.beginPath(); c.moveTo(a * 0.4, -h * 0.4);
      c.bezierCurveTo(0, -h * 1.2, -a * 0.6, -h * 0.6, -a * 0.75, h * 0.1);
      c.bezierCurveTo(-a * 0.4, -h * 0.2, 0, -h * 0.5, a * 0.4, -h * 0.4); c.fill();
    },
  }),
  lantern: (ctx, ph) => {
    // lure
    const bob = Math.sin(ph * TAU) * 3;
    ctx.strokeStyle = '#6b4fb0'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(20, -14); ctx.quadraticCurveTo(38, -40 + bob, 52, -18 + bob); ctx.stroke();
    ctx.fillStyle = rad(ctx, 52, -18 + bob, 0, 16, [[0, 'rgba(255,255,220,1)'], [0.3, 'rgba(120,255,255,0.9)'], [1, 'rgba(0,200,255,0)']]);
    ctx.beginPath(); ctx.arc(52, -18 + bob, 16, 0, TAU); ctx.fill();
    sideFish(ctx, ph, {
      a: 33, h: 18, tail: 'round', top: '#1b0c3a', mid: '#3d2378', belly: '#7b5bc4', fin: '#4b2f8f', tall: 0.25,
      decorate: (c, a, h, p) => {
        for (let i = 0; i < 7; i++) {
          const x = a * 0.5 - i * a * 0.2, y = h * 0.45;
          const g = 0.6 + 0.4 * Math.sin(p * TAU + i);
          c.fillStyle = `rgba(110,255,240,${g})`;
          c.beginPath(); c.arc(x, y, 2.3, 0, TAU); c.fill();
        }
      },
    });
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(31 - i * 4, 2); ctx.lineTo(29 - i * 4, 7); ctx.lineTo(27 - i * 4, 2); ctx.fill(); }
  },
  angel: (ctx, ph) => {
    const a = 26, h = 22, sw = Math.sin(ph * TAU) * 3;
    ctx.fillStyle = '#ffcf33';
    ctx.beginPath(); ctx.moveTo(a * 0.3, -h * 0.8); ctx.quadraticCurveTo(-a * 0.2, -h * 2.1, -a * 1.3 + sw, -h * 1.6); ctx.quadraticCurveTo(-a * 0.5, -h * 0.7, -a * 0.6, -h * 0.3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(a * 0.3, h * 0.8); ctx.quadraticCurveTo(-a * 0.2, h * 2.1, -a * 1.3 - sw, h * 1.6); ctx.quadraticCurveTo(-a * 0.5, h * 0.7, -a * 0.6, h * 0.3); ctx.fill();
    sideFish(ctx, ph, {
      a, h, tail: 'fork', top: '#ffb700', mid: '#ffe066', belly: '#fff3a8', fin: '#ffcf33', tailFill: '#2457e6', tall: 0.2,
      decorate: (c, a2, h2) => {
        c.fillStyle = '#1f48d0';
        for (const x of [a2 * 0.35, -a2 * 0.15, -a2 * 0.6]) { c.beginPath(); c.ellipse(x, 0, a2 * 0.08, h2 * 1.3, 0.15, 0, TAU); c.fill(); }
      },
    });
  },
  puffer: (ctx, ph) => {
    const r = 24 * (1 + Math.sin(ph * TAU) * 0.04);
    tail(ctx, 24, 10, ph, 'round', '#d9a640');
    ctx.fillStyle = '#c4902a';
    for (let i = 0; i < 18; i++) {
      const an = (i / 18) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(an - 0.12) * r * 0.95, Math.sin(an - 0.12) * r * 0.95);
      ctx.lineTo(Math.cos(an) * r * 1.28, Math.sin(an) * r * 1.28);
      ctx.lineTo(Math.cos(an + 0.12) * r * 0.95, Math.sin(an + 0.12) * r * 0.95);
      ctx.fill();
    }
    ctx.fillStyle = rad(ctx, -r * 0.2, -r * 0.4, 2, r * 1.2, [[0, '#ffeaa0'], [0.55, '#eabf55'], [1, '#a8761c']]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,240,0.85)';
    ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 0.75, r * 0.45, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(110,70,10,0.55)';
    for (const [x, y] of [[-10, -12], [-2, -16], [-14, -2], [4, -9], [-6, -5]]) { ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = 'rgba(80,50,0,0.5)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    eye(ctx, r * 0.5, -r * 0.3, 6.5);
    ctx.fillStyle = '#b4472a'; ctx.beginPath(); ctx.ellipse(r * 0.95, r * 0.12, 3, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,160,0.9)';
    ctx.beginPath(); ctx.ellipse(-2, 4, 7, 4 + Math.sin(ph * TAU * 2) * 2, 0.5, 0, TAU); ctx.fill();
  },
  turtle: (ctx, ph) => {
    const s = Math.sin(ph * TAU);
    ctx.fillStyle = '#6fa868';
    ctx.strokeStyle = 'rgba(0,40,0,0.5)'; ctx.lineWidth = 1.5;
    const flipper = (x, y, side, len, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(side * ang);
      ctx.beginPath(); ctx.ellipse(-len * 0.3, side * len * 0.5, len * 0.28, len * 0.62, side * -0.5, 0, TAU);
      ctx.fill(); ctx.stroke(); ctx.restore();
    };
    flipper(14, -16, -1, 30, 0.3 + s * 0.45);
    flipper(14, 16, 1, 30, 0.3 + s * 0.45);
    flipper(-24, -12, -1, 16, 0.2 - s * 0.3);
    flipper(-24, 12, 1, 16, 0.2 - s * 0.3);
    ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(-48, s * 3); ctx.lineTo(-36, 4); ctx.fill();
    // head
    ctx.fillStyle = '#7fbb74';
    ctx.beginPath(); ctx.ellipse(40, 0, 12, 9, 0, 0, TAU); ctx.fill(); ctx.stroke();
    eye(ctx, 44, -6, 3, '#000'); eye(ctx, 44, 6, 3, '#000');
    // shell
    ctx.fillStyle = rad(ctx, -4, -6, 4, 40, [[0, '#4fbf7a'], [0.6, '#1f7a4a'], [1, '#0f4a2c']]);
    ctx.beginPath(); ctx.ellipse(-2, 0, 34, 27, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#0a2e1a'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.save(); ctx.beginPath(); ctx.ellipse(-2, 0, 34, 27, 0, 0, TAU); ctx.clip();
    ctx.strokeStyle = 'rgba(200,255,150,0.55)'; ctx.lineWidth = 2;
    const hex = (cx, cy, r) => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const an = (i / 6) * TAU; ctx.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r); } ctx.closePath(); ctx.stroke(); };
    hex(-2, 0, 10); for (let i = 0; i < 6; i++) { const an = (i / 6) * TAU + Math.PI / 6; hex(-2 + Math.cos(an) * 19, Math.sin(an) * 17, 9); }
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.ellipse(-8, -10, 18, 8, -0.2, 0, TAU); ctx.fill();
    ctx.restore();
  },
  manta: (ctx, ph) => {
    const f = Math.sin(ph * TAU);
    const span = 50 * (0.85 + 0.15 * Math.abs(f));
    const tip = f * 10;
    // tail
    ctx.strokeStyle = '#11182c'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-30, 0); ctx.quadraticCurveTo(-60, f * 8, -86, -f * 6); ctx.stroke();
    const wing = () => {
      ctx.beginPath();
      ctx.moveTo(34, 0);
      ctx.quadraticCurveTo(20, -span * 0.5, -6 + tip, -span);
      ctx.quadraticCurveTo(-10, -span * 0.45, -34, 0);
      ctx.quadraticCurveTo(-10, span * 0.45, -6 + tip, span);
      ctx.quadraticCurveTo(20, span * 0.5, 34, 0);
      ctx.closePath();
    };
    wing();
    ctx.fillStyle = lin(ctx, 0, -span, 0, span, [[0, '#3b5a8f'], [0.35, '#16213d'], [0.5, '#0b1124'], [0.65, '#16213d'], [1, '#3b5a8f']]);
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,200,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = 'rgba(220,240,255,0.35)';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(8, s * 16, 7, 3, s * 0.6, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#0b1124';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(38, s * 8, 9, 3.5, s * 0.3, 0, TAU); ctx.fill(); }
    eye(ctx, 30, -12, 2.5, '#000'); eye(ctx, 30, 12, 2.5, '#000');
  },
  hammer: (ctx, ph) => sharkTop(ctx, ph, {
    a: 70, w: 18, amp: 7, edge: '#a9b9c4', spine: '#4c5c69', fin: '#5d6e7b',
    head: (c, a, W) => {
      c.fillStyle = lin(c, 0, -W * 2, 0, W * 2, [[0, '#8fa0ad'], [0.5, '#4c5c69'], [1, '#8fa0ad']]);
      c.beginPath();
      c.moveTo(a * 0.82, -W * 0.5); c.lineTo(a * 0.9, -W * 2.1); c.quadraticCurveTo(a * 1.04, -W * 2.2, a * 1.05, -W * 1.4);
      c.quadraticCurveTo(a * 1.08, 0, a * 1.05, W * 1.4); c.quadraticCurveTo(a * 1.04, W * 2.2, a * 0.9, W * 2.1);
      c.lineTo(a * 0.82, W * 0.5); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 2; c.stroke();
      eye(c, a * 0.97, -W * 1.95, 3.2, '#000'); eye(c, a * 0.97, W * 1.95, 3.2, '#000');
    },
  }),
  goldshark: (ctx, ph) => {
    ctx.fillStyle = rad(ctx, 0, 0, 10, 100, [[0, 'rgba(255,220,90,0.35)'], [1, 'rgba(255,200,40,0)']]);
    ctx.beginPath(); ctx.ellipse(0, 0, 100, 50, 0, 0, TAU); ctx.fill();
    sharkTop(ctx, ph, {
      a: 84, w: 24, amp: 8, edge: '#fff0a8', spine: '#c98a00', fin: '#e0a412', dorsal: 'rgba(120,70,0,0.55)',
      decorate: (c, a, W, p) => {
        for (let i = 0; i < 9; i++) {
          const x = -a * 0.7 + i * a * 0.18, tw = 0.5 + 0.5 * Math.sin(p * TAU * 2 + i * 1.7);
          c.fillStyle = `rgba(255,255,255,${tw * 0.9})`;
          c.beginPath(); c.moveTo(x, -4); c.lineTo(x + 2, 0); c.lineTo(x, 4); c.lineTo(x - 2, 0); c.fill();
        }
      },
    });
  },
  crab: (ctx, ph) => crabBody(ctx, ph, CRAB_RED, (g) => {
    // glowing volatile core
    ctx.fillStyle = rad(ctx, 0, 0, 0, 16, [[0, `rgba(255,255,200,${g})`], [0.5, `rgba(255,170,0,${g * 0.9})`], [1, 'rgba(255,60,0,0)']]);
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(255,200,60,${g})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-18, -8); ctx.lineTo(-6, -2); ctx.lineTo(-12, 8); ctx.moveTo(18, -6); ctx.lineTo(6, 2); ctx.lineTo(14, 10); ctx.stroke();
  }),
  jelly: (ctx, ph) => {
    const p = Math.sin(ph * TAU);
    const bw = 30 * (1 + p * 0.08), bh = 26 * (1 - p * 0.1);
    ctx.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      const x = -bw * 0.75 + (i * bw * 1.5) / 6;
      ctx.strokeStyle = `rgba(150,220,255,${0.55 - Math.abs(i - 3) * 0.05})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, 0);
      for (let k = 1; k <= 6; k++) ctx.lineTo(x + Math.sin(ph * TAU + k * 0.9 + i) * 5, k * 8);
      ctx.stroke();
    }
    ctx.fillStyle = rad(ctx, 0, -bh * 0.5, 2, bw * 1.3, [[0, 'rgba(255,255,255,0.95)'], [0.35, 'rgba(120,230,255,0.85)'], [1, 'rgba(110,60,255,0.55)']]);
    ctx.beginPath(); ctx.moveTo(-bw, 4);
    ctx.bezierCurveTo(-bw, -bh * 1.4, bw, -bh * 1.4, bw, 4);
    ctx.quadraticCurveTo(0, -4, -bw, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(220,250,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    // electric arcs
    ctx.strokeStyle = 'rgba(255,255,140,0.95)'; ctx.lineWidth = 1.6;
    for (let k = 0; k < 2; k++) {
      const an = ph * TAU * 2 + k * Math.PI;
      ctx.beginPath(); let x = Math.cos(an) * 8, y = -bh * 0.4;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) { x += Math.cos(an + j) * 9; y += Math.sin(an * 1.3 + j) * 7 - 2; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  },
  kraken: (ctx, ph) => {
    ctx.fillStyle = rad(ctx, 0, -20, 10, 120, [[0, 'rgba(255,40,40,0.25)'], [1, 'rgba(255,0,0,0)']]);
    ctx.beginPath(); ctx.arc(0, 0, 120, 0, TAU); ctx.fill();
    ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const bx = -50 + i * 14.3;
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const u = k / 10;
        pts.push([bx * (1 + u * 0.6) + Math.sin(ph * TAU + i * 0.8 + u * 4) * 14 * u, 10 + u * 82]);
      }
      for (const [w, col] of [[14, '#6a0a12'], [10, '#c4202e']]) {
        ctx.strokeStyle = col;
        for (let k = 0; k < pts.length - 1; k++) {
          ctx.lineWidth = w * (1 - k / 11);
          ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k + 1][0], pts[k + 1][1]); ctx.stroke();
        }
      }
      ctx.fillStyle = '#ffb3b8';
      for (let k = 2; k < 9; k += 2) { ctx.beginPath(); ctx.arc(pts[k][0] + 2, pts[k][1], 2.2 * (1 - k / 12), 0, TAU); ctx.fill(); }
    }
    ctx.lineCap = 'butt';
    const pulse = 1 + Math.sin(ph * TAU) * 0.03;
    ctx.fillStyle = rad(ctx, -14, -60, 6, 90, [[0, '#ff6a6a'], [0.5, '#c0182a'], [1, '#4a0410']]);
    ctx.beginPath(); ctx.ellipse(0, -36 * pulse, 56, 62 * pulse, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a0006'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = 'rgba(255,200,200,0.25)';
    for (const [x, y, r] of [[-20, -70, 8], [10, -82, 6], [24, -55, 5], [-30, -40, 5]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
    for (const s of [-1, 1]) {
      ctx.fillStyle = rad(ctx, s * 22, -12, 0, 16, [[0, '#fff7a0'], [0.4, '#ffcc00'], [1, 'rgba(255,120,0,0)']]);
      ctx.beginPath(); ctx.arc(s * 22, -12, 16, 0, TAU); ctx.fill();
      ctx.fillStyle = '#200'; ctx.beginPath(); ctx.ellipse(s * 22, -12, 2.5, 7, 0, 0, TAU); ctx.fill();
    }
    // crown
    ctx.fillStyle = lin(ctx, 0, -110, 0, -88, [[0, '#fff3a0'], [1, '#d18f00']]);
    ctx.beginPath(); ctx.moveTo(-26, -90);
    for (let i = 0; i <= 4; i++) { ctx.lineTo(-26 + i * 13, i % 2 ? -100 : -116); }
    ctx.lineTo(26, -90); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#7a4a00'; ctx.lineWidth = 1.5; ctx.stroke();
  },
  whale: (ctx, ph) => {
    ctx.fillStyle = rad(ctx, 0, 0, 20, 170, [[0, 'rgba(90,180,255,0.25)'], [1, 'rgba(60,120,255,0)']]);
    ctx.beginPath(); ctx.ellipse(0, 0, 175, 90, 0, 0, TAU); ctx.fill();
    sharkTop(ctx, ph, {
      a: 150, w: 46, amp: 10, edge: '#5aa6e8', spine: '#123a6e', fin: '#1d4f8f', dorsal: 'rgba(0,10,40,0.3)',
      decorate: (c, a, W, p, spine) => {
        c.strokeStyle = 'rgba(255,214,90,0.85)'; c.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
          const u = 0.3 + i * 0.1, x = -a + u * 2 * a, y = spine(u);
          c.beginPath(); c.moveTo(x + 10, y - W * 0.7); c.lineTo(x - 6, y); c.lineTo(x + 10, y + W * 0.7); c.stroke();
        }
        const g = 0.5 + 0.5 * Math.sin(p * TAU);
        c.fillStyle = `rgba(140,240,255,${0.4 + g * 0.5})`;
        for (let i = 0; i < 5; i++) { const u = 0.35 + i * 0.1; c.beginPath(); c.arc(-a + u * 2 * a, spine(u), 4, 0, TAU); c.fill(); }
      },
      head: (c, a, W) => {
        c.fillStyle = lin(c, a * 0.75, -W, a * 0.75, W, [[0, '#ffe07a'], [0.5, '#c88a00'], [1, '#ffe07a']]);
        c.beginPath(); c.moveTo(a * 0.62, -W * 0.85); c.quadraticCurveTo(a * 0.72, 0, a * 0.62, W * 0.85);
        c.lineTo(a * 0.7, W * 0.8); c.quadraticCurveTo(a * 0.8, 0, a * 0.7, -W * 0.8); c.fill();
        eye(c, a * 0.8, -W * 0.62, 5, '#002'); eye(c, a * 0.8, W * 0.62, 5, '#002');
      },
    });
  },
};

// ---------------------------------------------------------------------------
// Sprite sheets
// ---------------------------------------------------------------------------
export const sprites = [];   // [type] -> { frames, shadows, w, h }

export async function buildSprites(onProgress) {
  const total = FISH.length;
  for (let i = 0; i < total; i++) {
    const t = FISH[i];
    const pad = 1.9;
    const w = (t.rx * 2 * pad + 80), h = (t.ry * 2 * pad + 80);
    const frames = [], shadows = [];
    for (let f = 0; f < FRAMES; f++) {
      const c = mk(w * SPRITE_RES, h * SPRITE_RES);
      const ctx = c.getContext('2d');
      ctx.scale(SPRITE_RES, SPRITE_RES);
      ctx.translate(w / 2, h / 2);
      DRAW[t.key](ctx, f / FRAMES);
      frames.push(c);
      const s = mk(c.width, c.height);
      const sc = s.getContext('2d');
      sc.drawImage(c, 0, 0);
      sc.globalCompositeOperation = 'source-in';
      sc.fillStyle = 'rgba(0,10,30,1)';
      sc.fillRect(0, 0, s.width, s.height);
      shadows.push(s);
    }
    sprites[i] = { frames, shadows, w, h };
    onProgress?.((i + 1) / total);
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Draw a creature sprite at (x,y) with heading a. Non-upright creatures never swim upside down. */
export function drawFishSprite(ctx, ty, x, y, a, time, { alpha = 1, scale = 1, flash = 0, shadow = true, spin = 0 } = {}) {
  const sp = sprites[ty];
  if (!sp) return;
  const t = FISH[ty];
  const fps = t.kind === 'boss' ? 7 : 10 + (t.speed / 20);
  const fi = Math.floor(time * fps + ty * 3.3) % FRAMES;
  const draw = (img, ox, oy) => {
    ctx.save();
    ctx.translate(x + ox, y + oy);
    if (!t.upright) {
      ctx.rotate(a + spin);
      if (Math.cos(a) < 0) ctx.scale(1, -1);
    } else if (spin) ctx.rotate(spin);
    ctx.scale(scale / SPRITE_RES, scale / SPRITE_RES);
    ctx.drawImage(img, (-sp.w / 2) * SPRITE_RES, (-sp.h / 2) * SPRITE_RES);
    ctx.restore();
  };
  if (shadow) {
    ctx.globalAlpha = 0.22 * alpha;
    draw(sp.shadows[fi], 14, 22);
  }
  ctx.globalAlpha = alpha;
  draw(sp.frames[fi], 0, 0);
  if (flash > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, flash) * 0.6;
    draw(sp.frames[fi], 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}

/** Static icon of a creature (for paytables / lobby). */
export function drawFishIcon(ctx, ty, cx, cy, maxW, maxH, time = 0) {
  const sp = sprites[ty];
  if (!sp) return;
  const t = FISH[ty];
  const s = Math.min(maxW / (t.rx * 2.6), maxH / (t.ry * 2.6), 1.4);
  drawFishSprite(ctx, ty, cx, cy, 0, time, { scale: s, shadow: false });
}

// ---------------------------------------------------------------------------
// Sea floor backgrounds (top-down) + caustics
// ---------------------------------------------------------------------------
function seeded(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const SCENE_STYLE = [
  { sand: ['#2f8f9a', '#1d6f80', '#0d4458'], speck: '255,240,200', coral: ['#ff6f91', '#ff9f43', '#f368e0', '#ffd166'], tint: 'rgba(0,80,110,0.25)' },
  { sand: ['#2a5fb0', '#173f86', '#0a1f4f'], speck: '200,230,255', coral: ['#4dd2ff', '#7c83fd', '#00e0b0', '#c0f0ff'], tint: 'rgba(0,30,90,0.3)' },
  { sand: ['#4b2a7a', '#2b1650', '#120826'], speck: '230,200,255', coral: ['#b967ff', '#ff4fd8', '#00f5d4', '#fee440'], tint: 'rgba(40,0,70,0.32)', crystals: true },
];

function coral(ctx, rnd, x, y, col, size) {
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  const branch = (bx, by, ang, len, w, depth) => {
    const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo((bx + ex) / 2 + (rnd() - 0.5) * len * 0.4, (by + ey) / 2 + (rnd() - 0.5) * len * 0.4, ex, ey); ctx.stroke();
    if (depth > 0) {
      const n = 2 + Math.floor(rnd() * 2);
      for (let i = 0; i < n; i++) branch(ex, ey, ang + (rnd() - 0.5) * 1.6, len * (0.6 + rnd() * 0.2), w * 0.7, depth - 1);
    } else {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(ex, ey, w * 0.9, 0, TAU); ctx.fill();
    }
  };
  const n = 5 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) branch(x, y, (i / n) * TAU + rnd() * 0.5, size * (0.5 + rnd() * 0.5), size * 0.16, 2);
}

function anemone(ctx, rnd, x, y, col, r) {
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU + rnd() * 0.2, l = r * (0.7 + rnd() * 0.5);
    ctx.strokeStyle = col; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 0.4) * l * 0.6, y + Math.sin(a + 0.4) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.beginPath(); ctx.arc(x, y, r * 0.25, 0, TAU); ctx.fill();
}

function rock(ctx, rnd, x, y, r, base) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.35, r * 1.05, r * 0.85, 0, 0, TAU); ctx.fill();
  ctx.beginPath();
  const n = 9;
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, rr = r * (0.75 + rnd() * 0.35); ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85); }
  ctx.closePath();
  ctx.fillStyle = rad(ctx, x - r * 0.35, y - r * 0.4, r * 0.1, r * 1.3, [[0, 'rgba(255,255,255,0.35)'], [0.4, base], [1, 'rgba(0,0,0,0.6)']]);
  ctx.fill();
  ctx.restore();
}

function starfish(ctx, x, y, r, col, rot) {
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot + (i / 10) * TAU, rr = i % 2 ? r * 0.42 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.arc(x, y, r * 0.18, 0, TAU); ctx.fill();
}

export function buildBackground(scene) {
  const { W, H } = WORLD;
  const st = SCENE_STYLE[scene % SCENE_STYLE.length];
  const c = mk(W, H);
  const ctx = c.getContext('2d');
  const rnd = seeded(1234 + scene * 999);
  ctx.fillStyle = rad(ctx, W / 2, H / 2, 50, W * 0.75, [[0, st.sand[0]], [0.6, st.sand[1]], [1, st.sand[2]]]);
  ctx.fillRect(0, 0, W, H);
  // ripples in the sand
  ctx.strokeStyle = `rgba(${st.speck},0.05)`;
  ctx.lineWidth = 3;
  for (let i = 0; i < 70; i++) {
    const y = rnd() * H, x = rnd() * W, l = 80 + rnd() * 200;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + l * 0.3, y - 10, x + l * 0.6, y + 10, x + l, y); ctx.stroke();
  }
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `rgba(${st.speck},${rnd() * 0.12})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // decorations hug the edges, leaving the middle open for play
  const edgePoint = () => {
    const side = rnd();
    if (side < 0.35) return [rnd() * W, rnd() * 120];
    if (side < 0.7) return [rnd() * W, H - rnd() * 120];
    if (side < 0.85) return [rnd() * 140, rnd() * H];
    return [W - rnd() * 140, rnd() * H];
  };
  for (let i = 0; i < 16; i++) { const [x, y] = edgePoint(); rock(ctx, rnd, x, y, 18 + rnd() * 40, st.sand[2]); }
  for (let i = 0; i < 14; i++) { const [x, y] = edgePoint(); coral(ctx, rnd, x, y, st.coral[i % st.coral.length], 26 + rnd() * 30); }
  for (let i = 0; i < 8; i++) { const [x, y] = edgePoint(); anemone(ctx, rnd, x, y, st.coral[(i + 1) % st.coral.length], 16 + rnd() * 14); }
  for (let i = 0; i < 7; i++) starfish(ctx, rnd() * W, rnd() * H, 8 + rnd() * 8, st.coral[i % st.coral.length], rnd() * TAU);
  if (st.crystals) {
    for (let i = 0; i < 12; i++) {
      const [x, y] = edgePoint();
      for (let k = 0; k < 4; k++) {
        const a = rnd() * TAU, l = 14 + rnd() * 26;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a);
        ctx.fillStyle = lin(ctx, 0, -5, 0, 5, [[0, 'rgba(180,255,255,0.9)'], [1, 'rgba(120,60,255,0.7)']]);
        ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(l, 0); ctx.lineTo(0, 5); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.fillStyle = st.tint;
  ctx.fillRect(0, 0, W, H);
  // vignette
  ctx.fillStyle = rad(ctx, W / 2, H / 2, H * 0.45, W * 0.72, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,20,0.55)']]);
  ctx.fillRect(0, 0, W, H);
  return c;
}

/** Tileable caustic light pattern via wrapped Worley noise (F2 - F1 cell edges). */
export function buildCaustics(size = 256, seed = 7) {
  const c = mk(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rnd = seeded(seed);
  const pts = Array.from({ length: 14 }, () => [rnd() * size, rnd() * size]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let f1 = 1e9, f2 = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(x - px), dy = Math.abs(y - py);
        if (dx > size / 2) dx = size - dx;
        if (dy > size / 2) dy = size - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const e = Math.max(0, 1 - (f2 - f1) / 16);
      const v = Math.pow(e, 4) * 255 * (0.55 + 0.45 * Math.min(1, f1 / 40));
      const i = (y * size + x) * 4;
      img.data[i] = 200; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Props: coins, cannons, nets
// ---------------------------------------------------------------------------
export function drawCoin(ctx, x, y, r, spin = 0) {
  const sx = Math.max(0.15, Math.abs(Math.cos(spin)));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  ctx.fillStyle = '#9a6400';
  ctx.beginPath(); ctx.arc(0, r * 0.12, r, 0, TAU); ctx.fill();
  ctx.fillStyle = rad(ctx, -r * 0.3, -r * 0.35, r * 0.1, r * 1.1, [[0, '#fff6c2'], [0.45, '#ffd23f'], [1, '#c98a00']]);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(140,90,0,0.8)'; ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath(); ctx.arc(0, 0, r * 0.68, 0, TAU); ctx.stroke();
  if (r > 6) {
    ctx.fillStyle = 'rgba(150,95,0,0.85)';
    ctx.font = `900 ${r * 1.05}px "Trebuchet MS", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, r * 0.05);
  }
  ctx.restore();
}

const TIER = [
  { body: ['#f4c27a', '#a0602a', '#5a3010'], glow: 'rgba(255,170,80,', barrels: 1, gem: '#ff8a3d' },
  { body: ['#f2f6ff', '#8ea3c0', '#3d4b66'], glow: 'rgba(120,200,255,', barrels: 2, gem: '#3dc5ff' },
  { body: ['#fff4b0', '#e0a000', '#7a4a00'], glow: 'rgba(255,220,80,', barrels: 3, gem: '#ff3d7f' },
];

/** Cannon at a screen-edge seat. `facing` is +1 when the cannon sits on the bottom edge. */
export function drawCannon(ctx, x, y, angle, tier, recoil, time, mine) {
  const T = TIER[Math.min(tier, TIER.length - 1)];
  const facing = y > WORLD.H / 2 ? 1 : -1;
  ctx.save();
  ctx.translate(x, y);
  // platform
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath(); ctx.arc(0, 0, 78, 0, TAU); ctx.fill();
  ctx.fillStyle = lin(ctx, 0, -70 * facing, 0, 0, [[0, '#4a5a80'], [1, '#141a2e']]);
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, TAU); ctx.fill();
  ctx.strokeStyle = mine ? '#ffd23f' : '#8a96b8'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, 66, 0, TAU); ctx.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + time * 0.3;
    ctx.fillStyle = mine ? `rgba(255,220,100,${0.4 + 0.4 * Math.sin(time * 4 + i)})` : 'rgba(180,190,220,0.4)';
    ctx.beginPath(); ctx.arc(Math.cos(a) * 58, Math.sin(a) * 58, 2.6, 0, TAU); ctx.fill();
  }
  // barrels
  ctx.save();
  ctx.rotate(angle);
  ctx.translate(-recoil * 10, 0);
  const n = T.barrels, bw = n === 1 ? 22 : n === 2 ? 15 : 12, gap = bw + 2;
  ctx.fillStyle = `${T.glow}${0.25 + 0.15 * Math.sin(time * 5)})`;
  ctx.beginPath(); ctx.ellipse(48, 0, 50, 16 + n * 6, 0, 0, TAU); ctx.fill();
  for (let i = 0; i < n; i++) {
    const oy = (i - (n - 1) / 2) * gap;
    ctx.fillStyle = lin(ctx, 0, oy - bw / 2, 0, oy + bw / 2, [[0, T.body[0]], [0.5, T.body[1]], [1, T.body[2]]]);
    ctx.beginPath(); ctx.roundRect(8, oy - bw / 2, 76, bw, 4); ctx.fill();
    ctx.fillStyle = T.body[2];
    ctx.fillRect(74, oy - bw / 2 - 2, 14, bw + 4);
    ctx.fillStyle = T.body[0];
    ctx.fillRect(30, oy - bw / 2, 4, bw);
  }
  ctx.restore();
  // turret hub
  ctx.fillStyle = rad(ctx, -8, -8, 2, 36, [[0, T.body[0]], [0.6, T.body[1]], [1, T.body[2]]]);
  ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = rad(ctx, -3, -3, 1, 14, [[0, '#fff'], [0.3, T.gem], [1, 'rgba(0,0,0,0.6)']]);
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
  ctx.restore();
}

export function bulletColor(tier) {
  return ['#ffb066', '#7fd8ff', '#ffe066'][Math.min(tier, 2)];
}

export function drawBullet(ctx, x, y, vx, vy, tier, mine) {
  const col = bulletColor(tier);
  const a = Math.atan2(vy, vx);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rad(ctx, 0, 0, 0, 22, [[0, col], [1, 'rgba(0,0,0,0)']]);
  ctx.globalAlpha = mine ? 0.8 : 0.5;
  ctx.beginPath(); ctx.ellipse(-8, 0, 26, 12, 0, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.ellipse(-2, 0, 6, 4, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

export function drawNet(ctx, x, y, t, tier) {
  // t: 0..1 lifetime
  const r = 26 + Math.min(1, t * 3) * 34;
  const alpha = 1 - Math.max(0, (t - 0.5) * 2);
  const col = bulletColor(tier);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 0.8);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = col; ctx.lineWidth = 2;
  for (let ring = 1; ring <= 3; ring++) {
    ctx.beginPath();
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * TAU; ctx.lineTo(Math.cos(a) * r * ring / 3, Math.sin(a) * r * ring / 3); }
    ctx.stroke();
  }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke(); }
  ctx.globalAlpha = alpha * 0.25;
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
export const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export function goldText(ctx, text, x, y, size, { align = 'center', stroke = '#5a2a00', glow = 'rgba(255,200,40,0.6)', colors } = {}) {
  ctx.save();
  ctx.font = `900 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = size * 0.5; }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(3, size * 0.16);
  ctx.strokeText(text, x, y);
  ctx.shadowBlur = 0;
  const c = colors || ['#fffbe0', '#ffd23f', '#e08a00'];
  ctx.fillStyle = lin(ctx, 0, y - size / 2, 0, y + size / 2, [[0, c[0]], [0.5, c[1]], [1, c[2]]]);
  ctx.fillText(text, x, y);
  ctx.restore();
}

export const fmt = (n) => Math.floor(n).toLocaleString('en-US');

export function panel(ctx, x, y, w, h, r = 12, { fill = 'rgba(8,16,40,0.78)', stroke = 'rgba(255,210,90,0.85)', lw = 2 } = {}) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
}

/** Speaker (sound effects) or notes (music) icon centred at 0,0 for a round button of radius r. */
export function drawAudioIcon(ctx, kind, r, color) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color;
  const k = r / 24;
  ctx.scale(k, k);
  if (kind === 'sfx') {
    ctx.beginPath(); ctx.moveTo(-11, -4); ctx.lineTo(-5, -4); ctx.lineTo(2, -10); ctx.lineTo(2, 10); ctx.lineTo(-5, 4); ctx.lineTo(-11, 4); ctx.closePath(); ctx.fill();
    ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(3, 0, 6, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.arc(3, 0, 11, -0.9, 0.9); ctx.stroke();
  } else {
    ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(-4, 7); ctx.lineTo(-4, -9); ctx.lineTo(9, -12); ctx.lineTo(9, 4); ctx.stroke();
    ctx.fillRect(-4, -9.6, 13, 3.6);
    ctx.beginPath(); ctx.ellipse(-7.5, 7.5, 4.2, 3.2, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(5.5, 4.5, 4.2, 3.2, -0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Red "off" slash across a round button of radius r. */
export function drawOffSlash(ctx, r) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.62); ctx.lineTo(r * 0.62, r * 0.62); ctx.stroke();
  ctx.strokeStyle = '#ff4d5a'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.62); ctx.lineTo(r * 0.62, r * 0.62); ctx.stroke();
  ctx.restore();
}

export { mk, lin, rad, TAU };
