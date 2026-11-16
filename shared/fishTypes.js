// Shared between server and client. Pure data + math, no DOM / Node APIs.

export const WORLD = { W: 1280, H: 720 };

// Seat cannon positions in world space. Seats 0/1 are bottom, 2/3 are top.
// Clients sitting in a top seat render the world rotated 180° so they always appear at the bottom.
export const SEATS = [
  { x: 360, y: 720 },
  { x: 920, y: 720 },
  { x: 920, y: 0 },
  { x: 360, y: 0 },
];

export const BULLET = { speed: 980, radius: 9, lifeMs: 18000, maxInFlight: 30, minIntervalMs: 140 };

// kind: undefined = normal | 'bomb' (kills nearby) | 'chain' (kills nearest N) | 'boss' (random multiplier)
// upright: sprite does not rotate with its path (also hit-tested unrotated)
// weight: spawn weight for the random spawner (0 = only spawned by special events)
export const FISH = [
  { id: 0,  key: 'minnow',    name: 'Silver Minnow',    mult: 2,  rx: 20, ry: 9,  speed: 125, weight: 26 },
  { id: 1,  key: 'guppy',     name: 'Sunny Guppy',      mult: 3,  rx: 23, ry: 12, speed: 115, weight: 22 },
  { id: 2,  key: 'clown',     name: 'Ember Clownfish',  mult: 4,  rx: 24, ry: 14, speed: 105, weight: 18 },
  { id: 3,  key: 'tang',      name: 'Azure Tang',       mult: 5,  rx: 26, ry: 17, speed: 100, weight: 15 },
  { id: 4,  key: 'puffer',    name: 'Spiny Puffer',     mult: 6,  rx: 26, ry: 24, speed: 75,  weight: 12 },
  { id: 5,  key: 'lantern',   name: 'Glow Lanternfish', mult: 8,  rx: 34, ry: 18, speed: 95,  weight: 10 },
  { id: 6,  key: 'angel',     name: 'Royal Angelfish',  mult: 10, rx: 28, ry: 30, speed: 85,  weight: 8 },
  { id: 7,  key: 'turtle',    name: 'Jade Turtle',      mult: 15, rx: 44, ry: 34, speed: 62,  weight: 6 },
  { id: 8,  key: 'manta',     name: 'Midnight Manta',   mult: 20, rx: 46, ry: 50, speed: 72,  weight: 5 },
  { id: 9,  key: 'hammer',    name: 'Steel Hammerhead', mult: 30, rx: 72, ry: 26, speed: 85,  weight: 3.5 },
  { id: 10, key: 'goldshark', name: 'Gilded Shark',     mult: 50, rx: 86, ry: 32, speed: 80,  weight: 2 },
  { id: 11, key: 'crab',      name: 'Blast Crab',       mult: 10, rx: 34, ry: 28, speed: 55,  weight: 1.4, kind: 'bomb', radius: 270, upright: true },
  { id: 12, key: 'jelly',     name: 'Thunder Jelly',    mult: 8,  rx: 30, ry: 36, speed: 50,  weight: 1.4, kind: 'chain', chain: 8, upright: true },
  { id: 13, key: 'kraken',    name: 'Crimson Kraken',   mult: [60, 200],  rx: 86, ry: 92, speed: 42, weight: 0, kind: 'boss', upright: true },
  { id: 14, key: 'whale',     name: 'Abyss Whale',      mult: [100, 300], rx: 150, ry: 58, speed: 40, weight: 0, kind: 'boss' },
];

// Laser gun: a second weapon. While firing it streams electric shocks along the aim line; each
// shock costs one bet and is one capture attempt on the first fish in the beam (same odds as a bullet).
export const LASER = { zapMs: 200, halfWidth: 18 };

export const BOSS_IDS = [13, 14];
export const SCENES = ['Coral Reef', 'Sapphire Deep', 'Abyss Garden'];

/** Average multiplier, used for probability; bosses use the mean of their range. */
export function expectedMult(type) {
  const m = FISH[type].mult;
  return Array.isArray(m) ? (m[0] + m[1]) / 2 : m;
}

export function multLabel(type) {
  const m = FISH[type].mult;
  return Array.isArray(m) ? `${m[0]}-${m[1]}x` : `${m}x`;
}

// ---- Path math -----------------------------------------------------------
// A fish path is a cubic bezier: p = [x0,y0,x1,y1,x2,y2,x3,y3], starting at server time t0 and lasting d ms.

export function bezierAt(p, u) {
  const v = 1 - u;
  const a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, e = u * u * u;
  return { x: a * p[0] + b * p[2] + c * p[4] + e * p[6], y: a * p[1] + b * p[3] + c * p[5] + e * p[7] };
}

export function bezierAngle(p, u) {
  const v = 1 - u;
  const dx = 3 * v * v * (p[2] - p[0]) + 6 * v * u * (p[4] - p[2]) + 3 * u * u * (p[6] - p[4]);
  const dy = 3 * v * v * (p[3] - p[1]) + 6 * v * u * (p[5] - p[3]) + 3 * u * u * (p[7] - p[5]);
  return Math.atan2(dy, dx);
}

/** Position/angle of a fish at time `now` (ms, server clock). Returns null when not on its path. */
export function fishState(f, now) {
  const u = (now - f.t0) / f.d;
  if (u < 0 || u > 1) return null;
  const pos = bezierAt(f.p, u);
  pos.a = FISH[f.ty].upright ? 0 : bezierAngle(f.p, u);
  pos.u = u;
  return pos;
}

/** Point-in-rotated-ellipse test with padding. */
export function hitsFish(type, fx, fy, fa, px, py, pad = 0) {
  const t = FISH[type];
  const dx = px - fx, dy = py - fy;
  const c = Math.cos(-fa), s = Math.sin(-fa);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  const rx = t.rx + pad, ry = t.ry + pad;
  return (lx * lx) / (rx * rx) + (ly * ly) / (ry * ry) <= 1;
}

export function onScreen(x, y, margin = 0) {
  return x >= -margin && x <= WORLD.W + margin && y >= -margin && y <= WORLD.H + margin;
}

/** Bet levels for a room: 1,2,3,4,5,6,8,10 pattern scaled across [min,max]. */
export function betLevels(min, max) {
  const steps = [1, 2, 3, 4, 5, 6, 8];
  const out = [];
  for (let mag = 1; mag <= max * 10; mag *= 10) {
    for (const s of steps) {
      const v = s * mag;
      if (v >= min && v <= max && !out.includes(v)) out.push(v);
    }
  }
  if (!out.includes(max)) out.push(max);
  if (!out.includes(min)) out.unshift(min);
  return out.sort((a, b) => a - b);
}

/**
 * Distance along a beam from (ox,oy) at angle a to the fish at (fx,fy), or -1 if the beam misses it.
 * Used to find the first fish a laser beam touches.
 */
export function beamDistance(type, ox, oy, a, fx, fy) {
  const dx = Math.cos(a), dy = Math.sin(a);
  const t = (fx - ox) * dx + (fy - oy) * dy;
  if (t < 0) return -1;
  const d = Math.abs((fx - ox) * dy - (fy - oy) * dx);
  return d <= LASER.halfWidth + (FISH[type].rx + FISH[type].ry) * 0.4 ? t : -1;
}
