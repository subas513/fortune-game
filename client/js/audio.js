// Synthesized sound effects and generative background music (WebAudio, no audio files).

let ac = null, master = null, sfxBus = null, musicBus = null;
const prefs = JSON.parse(localStorage.getItem('tf_audio') || '{"sfx":true,"music":true}');
let musicTimer = null, musicMode = null, nextNoteTime = 0, step = 0;

export const audioPrefs = () => ({ ...prefs });

function save() { localStorage.setItem('tf_audio', JSON.stringify(prefs)); }

export function unlockAudio() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ac = new AC();
  master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
  sfxBus = ac.createGain(); sfxBus.gain.value = prefs.sfx ? 0.55 : 0; sfxBus.connect(master);
  musicBus = ac.createGain(); musicBus.gain.value = prefs.music ? 0.22 : 0; musicBus.connect(master);
  if (musicMode) startMusic(musicMode);
}

export function setSfx(on) { prefs.sfx = on; save(); if (sfxBus) sfxBus.gain.value = on ? 0.55 : 0; }
export function setMusic(on) { prefs.music = on; save(); if (musicBus) musicBus.gain.value = on ? 0.22 : 0; }

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

function tone(freq, { type = 'sine', t = 0, a = 0.005, d = 0.2, vol = 0.5, slide = 0, bus = sfxBus, detune = 0 } = {}) {
  if (!ac) return;
  const now = ac.currentTime + t;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, now);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), now + a + d);
  o.detune.value = detune;
  env(g, now, a, vol, d);
  o.connect(g).connect(bus);
  o.start(now);
  o.stop(now + a + d + 0.05);
}

let noiseBuf = null;
function noise({ t = 0, d = 0.2, vol = 0.4, freq = 1200, q = 1, type = 'bandpass' } = {}) {
  if (!ac) return;
  if (!noiseBuf) {
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }
  const now = ac.currentTime + t;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf;
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, now, 0.005, vol, d);
  s.connect(f).connect(g).connect(sfxBus);
  s.start(now, Math.random() * 0.5);
  s.stop(now + d + 0.05);
}

let lastShot = 0;
export const sfx = {
  shoot(tier = 0) {
    if (!ac || ac.currentTime - lastShot < 0.05) return;
    lastShot = ac.currentTime;
    tone(900 - tier * 120, { type: 'square', d: 0.09, vol: 0.12, slide: 0.35 });
    noise({ d: 0.06, vol: 0.12, freq: 3000 });
  },
  hit() { noise({ d: 0.08, vol: 0.12, freq: 900, q: 2 }); },
  coin(big = false) {
    tone(1318, { type: 'triangle', d: 0.12, vol: 0.25 });
    tone(1976, { type: 'triangle', t: 0.07, d: big ? 0.4 : 0.22, vol: 0.25 });
  },
  tick() { tone(2400, { type: 'triangle', d: 0.03, vol: 0.08 }); },
  click() { tone(660, { type: 'triangle', d: 0.06, vol: 0.2 }); },
  bigWin() {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, { type: 'square', t: i * 0.09, d: 0.25, vol: 0.12 }));
    [1047, 1319, 1568].forEach((f) => tone(f, { type: 'triangle', t: 0.6, d: 1.2, vol: 0.18 }));
  },
  explosion() {
    noise({ d: 0.9, vol: 0.6, freq: 300, q: 0.7, type: 'lowpass' });
    tone(110, { type: 'sine', d: 0.6, vol: 0.5, slide: 0.4 });
  },
  zap() {
    for (let i = 0; i < 5; i++) noise({ t: i * 0.05, d: 0.06, vol: 0.25, freq: 2500 + Math.random() * 3000, q: 4 });
  },
  warning() {
    for (let i = 0; i < 3; i++) {
      tone(440, { type: 'sawtooth', t: i * 0.7, a: 0.05, d: 0.5, vol: 0.12, slide: 0.6 });
      tone(660, { type: 'sawtooth', t: i * 0.7 + 0.02, a: 0.05, d: 0.5, vol: 0.08, slide: 0.6 });
    }
  },
  shock() {
    // short electric crackle for each laser shock
    noise({ d: 0.07, vol: 0.16, freq: 3200 + Math.random() * 1500, q: 3 });
    tone(140 + Math.random() * 40, { type: 'sawtooth', d: 0.08, vol: 0.06 });
  },
  wave() { noise({ d: 2.2, vol: 0.35, freq: 600, q: 0.5, type: 'lowpass' }); },
  reelStop() { tone(180, { type: 'square', d: 0.06, vol: 0.18 }); noise({ d: 0.05, vol: 0.12, freq: 1800 }); },
  reelSpin() { tone(300, { type: 'triangle', d: 0.05, vol: 0.05 }); },
  error() { tone(220, { type: 'square', d: 0.15, vol: 0.12 }); tone(180, { type: 'square', t: 0.12, d: 0.2, vol: 0.12 }); },
};

// ---- Generative music --------------------------------------------------------
const SCALES = {
  lobby: { root: 220, scale: [0, 3, 5, 7, 10], tempo: 0.28, chords: [[0, 7, 15], [5, 12, 19], [3, 10, 15], [7, 14, 19]] },
  sea: { root: 196, scale: [0, 2, 4, 7, 9], tempo: 0.22, chords: [[0, 7, 16], [9, 16, 21], [5, 12, 21], [7, 14, 23]] },
  slot: { root: 262, scale: [0, 4, 7, 9, 12], tempo: 0.18, chords: [[0, 7, 16], [5, 12, 21], [7, 14, 23], [0, 7, 16]] },
};
const st = (root, semis) => root * Math.pow(2, semis / 12);

function scheduleMusic() {
  const S = SCALES[musicMode];
  while (nextNoteTime < ac.currentTime + 0.3) {
    const t = nextNoteTime - ac.currentTime;
    const bar = Math.floor(step / 16) % S.chords.length;
    const chord = S.chords[bar];
    if (step % 16 === 0) chord.forEach((s) => tone(st(S.root, s), { type: 'sine', t, a: 0.4, d: S.tempo * 15, vol: 0.12, bus: musicBus, detune: (Math.random() - 0.5) * 8 }));
    if (step % 4 === 0) tone(st(S.root / 2, chord[0]), { type: 'triangle', t, d: S.tempo * 3, vol: 0.22, bus: musicBus });
    if (Math.random() < 0.55) {
      const deg = S.scale[Math.floor(Math.random() * S.scale.length)] + (Math.random() < 0.4 ? 12 : 0);
      tone(st(S.root * 2, deg), { type: 'triangle', t, d: S.tempo * 1.6, vol: 0.07, bus: musicBus });
    }
    nextNoteTime += S.tempo;
    step++;
  }
}

export function startMusic(mode) {
  musicMode = mode;
  if (!ac) return;
  clearInterval(musicTimer);
  nextNoteTime = ac.currentTime + 0.1;
  step = 0;
  musicTimer = setInterval(scheduleMusic, 100);
}
