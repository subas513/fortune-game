// Slot machine definitions, shared by server (math) and client (rendering/animation).
// A spin result is one stop index per reel; the visible window for reel r at stop s is
// strip[s], strip[s+1], ..., strip[s+rows-1] (wrapping), top row first.

export const SYM = {
  CHERRY: 0, LEMON: 1, ORANGE: 2, PLUM: 3, BELL: 4, BAR: 5, BAR2: 6, BAR3: 7, SEVEN_BLUE: 8, SEVEN_RED: 9, WILD: 10, MELON: 11, BLANK: 12,
};
export const SYM_NAMES = ['Cherry', 'Lemon', 'Orange', 'Plum', 'Bell', 'Bar', 'Double Bar', 'Triple Bar', 'Blue 7', 'Red 7', 'Ruby Wild', 'Melon', 'Blank'];

const { CHERRY, LEMON, ORANGE, PLUM, BELL, BAR, BAR2, BAR3, SEVEN_BLUE, SEVEN_RED, WILD, MELON, BLANK } = SYM;
const ANY_BAR = [BAR, BAR2, BAR3];
const ANY_7 = [SEVEN_BLUE, SEVEN_RED];

// Build a strip from per-symbol counts and spread symbols out deterministically.
function strip(order, counts, seed) {
  const out = [];
  order.forEach((s, i) => { for (let k = 0; k < counts[i]; k++) out.push(s); });
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function reelSets(order, levels, seed) {
  const out = {};
  for (const [lvl, reels] of Object.entries(levels)) out[lvl] = reels.map((counts, r) => strip(order, counts, seed + r * 17 + Number(lvl)));
  return out;
}

/**
 * Pay rules: { m: [set per position], pay } — matches when the first m.length symbols on a
 * line (left to right) are each in the given set (WILD substitutes when the machine allows).
 * A line pays the single highest matching rule, times the line bet.
 */
export const MACHINES = {
  classic777: {
    title: 'Lucky 777',
    reels: 3,
    rows: 3,
    wild: null,
    lines: [
      [1, 1, 1], // middle
      [0, 0, 0], // top
      [2, 2, 2], // bottom
      [0, 1, 2], // diagonal down
      [2, 1, 0], // diagonal up
    ],
    // Symbol counts per reel for each RTP level (exact RTP is computed at server start).
    reelSets: reelSets([CHERRY, LEMON, BELL, BAR, BAR2, BAR3, SEVEN_BLUE, SEVEN_RED, BLANK], {
      92: [[9, 12, 4, 5, 4, 3, 2, 2, 4], [7, 7, 4, 6, 4, 3, 2, 2, 1], [7, 4, 4, 6, 4, 3, 2, 2, 5]],
      94: [[5, 4, 4, 9, 4, 3, 2, 2, 3], [3, 12, 1, 9, 4, 3, 2, 2, 3], [6, 4, 10, 12, 4, 3, 2, 2, 6]],
      96: [[7, 4, 6, 5, 4, 3, 2, 2, 4], [4, 5, 6, 7, 4, 3, 2, 2, 5], [2, 1, 7, 9, 4, 3, 2, 2, 4]],
    }, 7),
    pays: [
      { m: [[SEVEN_RED], [SEVEN_RED], [SEVEN_RED]], pay: 300, label: '7 7 7 (red)' },
      { m: [[SEVEN_BLUE], [SEVEN_BLUE], [SEVEN_BLUE]], pay: 150, label: '7 7 7 (blue)' },
      { m: [ANY_7, ANY_7, ANY_7], pay: 50, label: 'Any 7 7 7' },
      { m: [[BAR3], [BAR3], [BAR3]], pay: 60, label: 'Triple Bar x3' },
      { m: [[BAR2], [BAR2], [BAR2]], pay: 35, label: 'Double Bar x3' },
      { m: [[BAR], [BAR], [BAR]], pay: 20, label: 'Bar x3' },
      { m: [ANY_BAR, ANY_BAR, ANY_BAR], pay: 5, label: 'Any Bar x3' },
      { m: [[BELL], [BELL], [BELL]], pay: 20, label: 'Bell x3' },
      { m: [[LEMON], [LEMON], [LEMON]], pay: 10, label: 'Lemon x3' },
      { m: [[CHERRY], [CHERRY], [CHERRY]], pay: 25, label: 'Cherry x3' },
      { m: [[CHERRY], [CHERRY]], pay: 4, label: 'Cherry x2' },
      { m: [[CHERRY]], pay: 1, label: 'Cherry x1' },
    ],
  },

  ruby7: {
    title: 'Ruby Sevens',
    reels: 5,
    rows: 3,
    wild: WILD, // substitutes for everything
    lines: [
      [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2],
      [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
      [0, 0, 1, 2, 2], [2, 2, 1, 0, 0],
      [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
    ],
    reelSets: reelSets([CHERRY, LEMON, ORANGE, PLUM, MELON, BELL, BAR, SEVEN_RED, WILD], {
      92: [[8, 6, 4, 13, 4, 4, 3, 2, 3], [11, 7, 10, 4, 1, 4, 3, 2, 3], [8, 9, 8, 8, 6, 4, 3, 2, 3], [6, 10, 7, 10, 7, 4, 3, 2, 3], [7, 1, 7, 10, 2, 4, 3, 2, 3]],
      94: [[7, 7, 5, 8, 4, 4, 3, 2, 3], [8, 6, 10, 8, 2, 4, 3, 2, 3], [8, 9, 8, 7, 10, 4, 3, 2, 3], [9, 8, 5, 4, 7, 4, 3, 2, 3], [9, 4, 5, 7, 4, 4, 3, 2, 3]],
      96: [[10, 8, 8, 5, 11, 4, 3, 2, 3], [8, 12, 8, 7, 4, 4, 3, 2, 3], [5, 5, 9, 6, 9, 4, 3, 2, 3], [6, 6, 4, 4, 5, 4, 3, 2, 3], [10, 3, 4, 8, 5, 4, 3, 2, 3]],
    }, 101),
    pays: [],
  },
};

// ruby7: standard N-of-a-kind pays for 3/4/5 symbols from the left.
{
  const table = [
    [SEVEN_RED, 60, 300, 1500],
    [WILD, 80, 400, 2000],
    [BAR, 25, 100, 400],
    [BELL, 20, 60, 250],
    [MELON, 15, 50, 180],
    [PLUM, 10, 30, 100],
    [ORANGE, 8, 25, 80],
    [LEMON, 6, 20, 60],
    [CHERRY, 5, 15, 50],
  ];
  const pays = MACHINES.ruby7.pays;
  for (const [s, p3, p4, p5] of table) {
    pays.push({ m: Array(5).fill([s]), pay: p5, label: `${SYM_NAMES[s]} x5` });
    pays.push({ m: Array(4).fill([s]), pay: p4, label: `${SYM_NAMES[s]} x4` });
    pays.push({ m: Array(3).fill([s]), pay: p3, label: `${SYM_NAMES[s]} x3` });
  }
}

/** Reel strips for a machine at an RTP level key ('92' | '94' | '96'). */
export function stripsFor(machine, level) {
  const set = MACHINES[machine].reelSets[level];
  if (!set) throw new Error(`no reel set ${machine}@${level}`);
  return set;
}

/** Visible window: grid[reel][row]. */
export function windowAt(machine, level, stops) {
  const M = MACHINES[machine];
  const strips = stripsFor(machine, level);
  return stops.map((s, r) => {
    const st = strips[r];
    const col = [];
    for (let i = 0; i < M.rows; i++) col.push(st[(s + i) % st.length]);
    return col;
  });
}

/** Evaluate a window. Returns { totalMult, lines: [{ line, mult, count, label }] } with mult relative to line bet. */
export function evaluate(machine, grid) {
  const M = typeof machine === 'string' ? MACHINES[machine] : machine;
  const out = [];
  let total = 0;
  M.lines.forEach((rows, li) => {
    const syms = rows.map((row, r) => grid[r][row]);
    let best = null;
    for (const rule of M.pays) {
      let ok = true;
      let allWild = true;
      for (let i = 0; i < rule.m.length; i++) {
        const s = syms[i];
        const isWild = M.wild != null && s === M.wild;
        if (!isWild) allWild = false;
        if (!(rule.m[i].includes(s) || (isWild && !rule.m[i].includes(M.wild)))) { ok = false; break; }
      }
      // A run of wilds only pays as the wild rule itself, not as every symbol it could stand for.
      if (ok && allWild && !rule.m[0].includes(M.wild)) ok = false;
      if (ok && (!best || rule.pay > best.pay)) best = rule;
    }
    if (best) {
      out.push({ line: li, mult: best.pay, count: best.m.length, label: best.label });
      total += best.pay;
    }
  });
  return { totalMult: total, lines: out };
}

export const spinCost = (machine, lineBet) => lineBet * MACHINES[machine].lines.length;
