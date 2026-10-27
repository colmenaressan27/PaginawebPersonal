/* =====================================================================
   GALAXHELL — Shoot 'em up (Bullet Hell) + RPG por turnos
   Creado por Santiago Colmenares
   Motor: Vanilla JS + HTML5 Canvas (requestAnimationFrame + delta time)
   ===================================================================== */
'use strict';

/* ---------------------------------------------------------------------
   1. CONSTANTES Y UTILIDADES
   --------------------------------------------------------------------- */
const W = 480;
const H = 640;

const STATE_MENU = 'STATE_MENU';
const STATE_INTRO = 'STATE_INTRO';
const STATE_LEVEL = 'STATE_LEVEL';
const STATE_BOSS_ALERT = 'STATE_BOSS_ALERT';
const STATE_BOSS = 'STATE_BOSS';
const STATE_VICTORY = 'STATE_VICTORY';
const STATE_GAMEOVER = 'STATE_GAMEOVER';

// Caja de combate estilo Undertale (zona donde se mueve el corazón)
const ARENA = { x: 40, y: 290, w: 400, h: 268 };
// Zona libre de vuelo (fase de recorrido)
const FLIGHT_ZONE = { x: 24, y: 290, w: 432, h: 290 };
const HOME = { x: 240, y: 512 };
const HEART_RADIUS = 3;
const PIXEL_FONT = '"Press Start 2P", "Courier New", monospace';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const choose = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const TAU = Math.PI * 2;

// Distancia de un punto a un segmento (colisiones con rayos láser)
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/* ---------------------------------------------------------------------
   2. AUDIO MANAGER
   - Música: Menu.mp3, Levelmusic.mp3, Finalboss.mp3 (loop = true)
   - Efectos retro generados con Web Audio API
   --------------------------------------------------------------------- */
const AudioManager = {
  tracks: {},
  currentKey: null,
  volume: 0.7,
  muted: false,
  unlocked: false,
  ctx: null,
  master: null,
  noiseBuffer: null,
  lastEnemyShot: 0,

  init() {
    const files = { menu: 'Menu.mp3', level: 'Levelmusic.mp3', boss: 'Finalboss.mp3' };
    for (const key in files) {
      const track = new Audio(files[key]);
      track.loop = true;
      track.preload = 'auto';
      this.tracks[key] = track;
    }
    try {
      const saved = JSON.parse(localStorage.getItem('galaxhell_audio') || 'null');
      if (saved && typeof saved.volume === 'number') {
        this.volume = clamp(saved.volume, 0, 1);
        this.muted = !!saved.muted;
      }
    } catch (e) { /* almacenamiento no disponible */ }
    this.applyVolume();
  },

  // Se llama en la primera interacción del usuario (política de autoplay)
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    const firstTime = !this.unlocked;
    this.unlocked = true;
    this.applyVolume();
    if (firstTime && this.currentKey) this._start(this.tracks[this.currentKey]);
  },

  _start(track) {
    if (!track || !this.unlocked) return;
    track.volume = this.muted ? 0 : this.volume;
    track.muted = this.muted;
    const p = track.play();
    if (p && typeof p.catch === 'function') p.catch(() => { /* el navegador bloqueó el audio */ });
  },

  _reset(track) {
    track.pause();
    try { track.currentTime = 0; } catch (e) { /* metadata aún sin cargar */ }
  },

  // Cambia de pista: detiene y reinicia la anterior antes de reproducir la nueva
  play(key) {
    const next = this.tracks[key];
    if (!next) return;
    if (this.currentKey === key && !next.paused) return;
    if (this.currentKey && this.tracks[this.currentKey]) this._reset(this.tracks[this.currentKey]);
    for (const k in this.tracks) if (k !== key && !this.tracks[k].paused) this._reset(this.tracks[k]);
    this.currentKey = key;
    this._start(next);
  },

  stop() {
    for (const k in this.tracks) this._reset(this.tracks[k]);
    this.currentKey = null;
  },

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    this.applyVolume();
    this.save();
  },

  setMuted(m) {
    this.muted = !!m;
    this.applyVolume();
    this.save();
  },

  toggleMute() {
    this.setMuted(!this.muted);
  },

  // Aplica en tiempo real el volumen a las 3 pistas y a los efectos
  applyVolume() {
    for (const k in this.tracks) {
      const t = this.tracks[k];
      t.volume = this.muted ? 0 : this.volume;
      t.muted = this.muted;
    }
    if (this.master && this.ctx) {
      const g = this.muted ? 0 : this.volume * 0.6;
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01);
    }
    if (typeof UI !== 'undefined' && UI.ready) UI.syncAudioControls();
  },

  save() {
    try {
      localStorage.setItem('galaxhell_audio', JSON.stringify({ volume: this.volume, muted: this.muted }));
    } catch (e) { /* sin almacenamiento */ }
  },

  // ---------- Síntesis de efectos ----------
  _osc(type, f0, f1, dur, vol, delay = 0) {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  _noise(dur, vol, f0 = 3000, f1 = 200, delay = 0, filterType = 'lowpass') {
    const c = this.ctx;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.05);
  },

  _arp(notes, type, step, dur, vol) {
    notes.forEach((f, i) => this._osc(type, f, f, dur, vol, i * step));
  },

  sfx(name, opt) {
    if (!this.ctx || this.muted || this.volume <= 0) return;
    switch (name) {
      case 'select': this._osc('square', 660, 660, 0.06, 0.12); break;
      case 'confirm': this._osc('square', 523, 523, 0.07, 0.13); this._osc('square', 784, 784, 0.1, 0.13, 0.07); break;
      case 'cancel': this._osc('square', 420, 240, 0.12, 0.12); break;
      case 'error': this._osc('square', 140, 120, 0.18, 0.14); break;
      case 'laser': this._osc('sawtooth', 1800, 380, 0.16, 0.09); this._osc('square', 950, 220, 0.16, 0.05); break;
      case 'missile': this._noise(0.35, 0.14, 1400, 300, 0, 'bandpass'); this._osc('triangle', 260, 900, 0.3, 0.07); break;
      case 'plasma': this._osc('sawtooth', 110, 900, 0.55, 0.14); this._osc('sine', 55, 420, 0.55, 0.2); break;
      case 'enemyShot': {
        const now = this.ctx.currentTime;
        if (now - this.lastEnemyShot < 0.07) return;
        this.lastEnemyShot = now;
        this._osc('square', 540, 360, 0.05, 0.03);
        break;
      }
      case 'hit': this._osc('square', 240, 55, 0.28, 0.22); this._noise(0.22, 0.2, 2200, 200); break;
      case 'enemyHit': this._noise(0.16, 0.22, 4200, 600); this._osc('square', 320, 110, 0.14, 0.11); break;
      case 'crit': this._arp([880, 1109, 1319, 1760], 'square', 0.05, 0.09, 0.11); break;
      case 'miss': this._osc('square', 320, 140, 0.25, 0.1); break;
      case 'explosion': this._noise(0.65, 0.38, 2600, 60); this._osc('triangle', 130, 30, 0.55, 0.28); break;
      case 'bigExplosion':
        this._noise(1.8, 0.5, 3200, 40); this._osc('sawtooth', 95, 20, 1.5, 0.25); this._osc('sine', 62, 24, 1.8, 0.4);
        break;
      case 'voice': {
        const base = opt || 190;
        this._osc('square', base * rand(0.9, 1.3), base * rand(0.75, 1.05), 0.05, 0.07);
        break;
      }
      case 'text': this._osc('square', 420 * rand(0.96, 1.04), 400, 0.03, 0.035); break;
      case 'siren':
        for (let i = 0; i < 4; i++) {
          const up = i % 2 === 0;
          this._osc('sawtooth', up ? 560 : 1040, up ? 1040 : 560, 0.3, 0.12, i * 0.3);
          this._osc('square', up ? 280 : 520, up ? 520 : 280, 0.3, 0.05, i * 0.3);
        }
        break;
      case 'charge': {
        const d = opt || 0.7;
        this._osc('sine', 180, 1500, d, 0.12); this._osc('square', 90, 760, d, 0.035);
        break;
      }
      case 'blast': this._noise(0.55, 0.32, 5200, 260); this._osc('sawtooth', 170, 45, 0.5, 0.18); break;
      case 'beamWarn': this._osc('square', 980, 980, 0.06, 0.07); this._osc('square', 980, 980, 0.06, 0.07, 0.11); break;
      case 'pickup': this._arp([523, 659, 784, 1047], 'square', 0.05, 0.07, 0.11); break;
      case 'heal': this._arp([392, 523, 659, 784, 1047], 'triangle', 0.06, 0.12, 0.16); break;
      case 'shield': this._osc('sine', 380, 1600, 0.35, 0.14); this._osc('triangle', 800, 1250, 0.3, 0.07, 0.05); break;
      case 'shieldHit': this._osc('triangle', 1700, 880, 0.2, 0.16); break;
      case 'upgrade': this._arp([440, 554, 659, 880, 1109, 1319], 'square', 0.045, 0.08, 0.1); break;
      case 'levelUp': this._arp([523, 659, 784, 1047, 784, 1047], 'square', 0.07, 0.09, 0.1); break;
      case 'rumble': this._noise(2.6, 0.32, 320, 40); this._osc('sine', 46, 28, 2.6, 0.28); break;
      case 'heartBreak': this._osc('square', 300, 290, 0.08, 0.2); this._noise(0.35, 0.2, 3000, 400, 0.55); break;
      case 'warp': this._noise(1.2, 0.12, 400, 3000, 0, 'bandpass'); this._osc('sine', 120, 600, 1.2, 0.06); break;
      default: break;
    }
  },
};

/* ---------------------------------------------------------------------
   3. PIXEL ART — matrices de píxeles renderizadas en el Canvas
   --------------------------------------------------------------------- */
const PALETTE = {
  K: '#05050c', W: '#ffffff', w: '#c8d0e0', g: '#8890a8', G: '#4a5068', D: '#262a3a',
  B: '#2f6bff', b: '#8ab4ff', C: '#29e3ff', R: '#ff2a3a', r: '#a01020', O: '#ff8c1a',
  Y: '#ffe040', y: '#c89a20', P: '#b04aff', p: '#5a1e90', N: '#36e070', n: '#1a8040',
  S: '#f0c090', s: '#c08860', U: '#1e3a6a', u: '#2c5598', M: '#ff60c0',
};

// Nave del jugador (apunta hacia arriba) — 2 frames de propulsor
const SPR_PLAYER_BASE = [
  '.......W.......',
  '......wCw......',
  '......wBw......',
  '.....wbCbw.....',
  '.....wBCBw.....',
  '..R..wBBBw..R..',
  '..w.wwBWBww.w..',
  '..w.wgBBBgw.w..',
  '.wwwwgBBBgwwww.',
  'wwBwwgggggwwBww',
  'wBBwgwwwwwgwBBw',
  'wBwwg.wGw.gwwBw',
  'ww..g.wGw.g..ww',
  'w...G.OYO.G...w',
];
const SPR_PLAYER_FLAME = [
  ['.....OYWYO.....', '......OYO......', '.......O.......'],
  ['......YWY......', '.....OYYYO.....', '......OOO......'],
];

// Corazón rojo (hitbox / alma)
const SPR_HEART = [
  '.RR...RR.',
  'RRRR.RRRR',
  'RWRRRRRRR',
  'RRRRRRRRR',
  '.RRRRRRR.',
  '..RRRRR..',
  '...RRR...',
  '....R....',
];
const SPR_HEART_HALF_L = ['.RR.', 'RRRR', 'RWRR', 'RRRR', '.RRR', '..RR', '...R'];
const SPR_HEART_HALF_R = ['.RR.', 'RRRR', 'RRRR', 'RRRR', 'RRR.', 'RR..', 'R...'];

// Naves enemigas (apuntan hacia abajo)
const SPR_ENEMY_1 = [
  '..G.......G..',
  '..g.......g..',
  '.gwg.....gwg.',
  '.gRgG...GgRg.',
  'gwRwgwwwgwRwg',
  'gRRRwRRRwRRRg',
  '.gwwRRYRRwwg.',
  '..gwRYWYRwg..',
  '...gwRYRwg...',
  '....gwRwg....',
  '.....gOg.....',
];
const SPR_ENEMY_2 = [
  'P.............P',
  'Pp...........pP',
  'PPp...GGG...pPP',
  '.PPp.GwwwG.pPP.',
  '..PPGwCCCwGPP..',
  '..pPGCCWCCGPp..',
  '...pGwCCCwGp...',
  '..PPPGwwwGPPP..',
  '.PPp.pGGGp.pPP.',
  'PPp...pPp...pPP',
  'Pp....PCP....pP',
  'P.....pCp.....P',
  '.......C.......',
];
const SPR_ENEMY_3 = [
  '...GG.........GG...',
  '..GwwG.......GwwG..',
  '..GwnG.......GnwG..',
  '.GGwnGGGGGGGGGnwGG.',
  'GwwwnnwwwwwwwnnwwwG',
  'GwnnnnwgggggwnnnnwG',
  'GwnNNnwgRRRgwnNNnwG',
  '.GwnnnwgRWRgwnnnwG.',
  '..GwnnwgRRRgwnnwG..',
  '...GwnwgggggwnwG...',
  '...GwnGwwwwwGnwG...',
  '..GwG.GwOYOwG.GwG..',
  '..GG...GOYOG...GG..',
  '........GOG........',
];
const SPR_ENEMY_4 = [
  '.........yYy.........',
  '........yYWYy........',
  '..B....GgYYYgG....B..',
  '.BbB..GgwwwwwgG..BbB.',
  'BbCbBGgwwBBBwwgGBbCbB',
  'BbbbBgwwBBCBBwwgBbbbB',
  '.BbBGgwBBCWCBBwgGBbB.',
  '..B.GgwwBBCBBwwgG.B..',
  '....GgywwBBBwwygG....',
  '...GgyyywwwwwyyygG...',
  '..GgyyGGgwwwgGGyygG..',
  '..GyyG..GgwgG..GyyG..',
  '..GyG...OYWYO...GyG..',
  '...G.....OYO.....G...',
  '..........O..........',
];

// Gaster Blaster espacial (calavera mecánica, boca hacia abajo)
const SPR_BLASTER = [
  '....GGGGGGGGG....',
  '..GGwwwwwwwwwGG..',
  '.GwwwwwwwwwwwwwG.',
  'GwwwgwwwwwwwgwwwG',
  'GwwgKKKwwwKKKgwwG',
  'GwgKKCKKwKKCKKgwG',
  'GwgKCWCKwKCWCKgwG',
  'GwgKKCKKgKKCKKgwG',
  'GwwgKKKgwgKKKgwwG',
  '.GwwgggwwwgggwwG.',
  '.GgwwwwgKgwwwwgG.',
  '..GgwwgKKKgwwgG..',
  '..GwGwwwwwwwGwG..',
  '..GwKwKwKwKwKwG..',
  '..GwKKKKKKKKKwG..',
  '...GwKKKKKKKwG...',
  '...GwKwKwKwKwG...',
  '....GwwwwwwwG....',
  '.....GGGGGGG.....',
];

// Cápsula de power-up (X = color del tipo)
const SPR_CAPSULE = [
  '..GwwwG..',
  '.GwXXXwG.',
  'GwXXXXXwG',
  'GXXXXXXXG',
  'GXXXXXXXG',
  'GXXXXXXXG',
  'GXXXXXXXG',
  'GXXXXXXXG',
  'GwXXXXXwG',
  '.GwXXXwG.',
  '..GwwwG..',
];
const GLYPHS_3x5 = {
  H: ['X.X', 'X.X', 'XXX', 'X.X', 'X.X'],
  S: ['XXX', 'X..', 'XXX', '..X', 'XXX'],
  U: ['X.X', 'X.X', 'X.X', 'X.X', 'XXX'],
  M: ['X.X', 'XXX', 'XXX', 'X.X', 'X.X'],
  P: ['XXX', 'X.X', 'XXX', 'X..', 'X..'],
};

// Retrato del General (24x24) + frames de boca y parpadeo
const SPR_GENERAL = [
  '........................',
  '.......UUUUUUUUUU.......',
  '.....UUUUUUUUUUUUUU.....',
  '....UUUUUUYYYYUUUUUU....',
  '....UUUUUYYRRYYUUUUU....',
  '....UUUUUUYYYYUUUUUU....',
  '...KKKKKKKKKKKKKKKKKK...',
  '...KyyyyyyyyyyyyyyyyK...',
  '....sSSSSSSSSSSSSSSs....',
  '....SSSSSSSSSSSSSSSS....',
  '...sSSgggSSSSSSgggSSs...',
  '...sSSWKSSSSSSSSWKSSs...',
  '...sSSSSSSSssSSSSSSSs...',
  '....SSSSSSSssSSSSSSS....',
  '....SSSwwwwSSwwwwSSS....',
  '....SSwwwwwwwwwwwwSS....',
  '....SSSwwwwwwwwwwSSS....',
  '.....SSSSSSSSSSSSSS.....',
  '......sSSSSSSSSSSs......',
  '....UUUsssssssssUUUU....',
  '..UUUUUUUwSSSSwUUUUUUU..',
  '.UUYUUUUUUwSSwUUUUURYUU.',
  '.UUUUUUUUUUwwUUUUUUYRUU.',
  'UUUUUUUUUUUUUUUUUUUUUUUU',
];
const GENERAL_MOUTHS = [
  { 16: '....SSSwwwwwwwwwwSSS....', 17: '.....SSSSSSSSSSSSSS.....' },
  { 16: '....SSSwwwKKKKwwwSSS....', 17: '.....SSSSSKrrKSSSSS.....' },
  { 16: '....SSSwwKKKKKKwwSSS....', 17: '.....SSSSKrrrrKSSSS.....', 18: '......sSSSKKKKSSSs......' },
];
const GENERAL_BLINK = { 11: '...sSSKKSSSSSSSSKKSSs...' };

// Proyectiles enemigos (X = color)
const BULLET_SHAPES = {
  orb: ['..XXX..', '.XXXXX.', 'XXWWWXX', 'XXWWWXX', 'XXWWWXX', '.XXXXX.', '..XXX..'],
  needle: ['.X.', 'XWX', 'XWX', 'XWX', 'XWX', 'XWX', 'XWX', '.X.', '.X.'],
  diamond: ['..X..', '.XWX.', 'XWWWX', '.XWX.', '..X..'],
};
const BULLET_COLORS = {
  red: '#ff3050', cyan: '#29e3ff', yellow: '#ffe040', purple: '#c060ff', orange: '#ff8c1a',
  green: '#36e070', white: '#c8d0ff', blue: '#3a7bff', pink: '#ff60c0',
};

// Fuente de bloques 5x7 para el logo "GALAXHELL"
const LOGO_FONT = {
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
};

// ---------- Construcción de sprites ----------
function buildSprite(rows, overrides = {}) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      if (!ch || ch === '.' || ch === ' ') continue;
      const color = overrides[ch] || PALETTE[ch];
      if (!color) continue;
      g.fillStyle = color;
      g.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

function buildSilhouette(img, color) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

function withRows(base, replace) {
  return base.map((row, i) => (replace[i] !== undefined ? replace[i] : row));
}

function drawSprite(img, x, y, scale = 1, alpha = 1) {
  const w = img.width * scale;
  const h = img.height * scale;
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function drawSpriteRot(img, x, y, scale, angle, alpha = 1) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, -img.width * scale / 2, -img.height * scale / 2, img.width * scale, img.height * scale);
  ctx.restore();
}

// Generador procedural del Jefe: estación tipo "Estrella de la Muerte"
// con rostro mecánico y boca articulada brillante (estilo Ultrón).
const BOSS_GRID = 64;
const BOSS_SCALE = 3;
function generateBossRows(open) {
  const N = BOSS_GRID, cx = 31.5, cy = 31.5, R = 30.5;
  const grid = Array.from({ length: N }, () => Array(N).fill('.'));
  const bayer = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const inside = (x, y) => Math.hypot(x - cx, y - cy) <= R - 1.2;
  const set = (x, y, ch) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < N && y < N && grid[y][x] !== '.') grid[y][x] = ch;
  };

  // Esfera con sombreado y tramado ordenado (dithering)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > R) continue;
      const nx = dx / R, ny = dy / R;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      let light = -nx * 0.5 - ny * 0.55 + nz * 0.68;
      light += (bayer[y % 4][x % 4] / 16 - 0.5) * 0.2;
      let ch = light > 0.8 ? 'w' : light > 0.52 ? 'g' : light > 0.22 ? 'G' : 'D';
      if (d > R - 1.2) ch = 'K';
      grid[y][x] = ch;
    }
  }
  // Paneles: latitudes y meridianos
  [9, 16, 49, 56].forEach((ly) => {
    for (let x = 0; x < N; x++) if (inside(x, ly) && (x + ly) % 2 === 0) set(x, ly, 'D');
  });
  [-0.62, -0.3, 0.3, 0.62].forEach((k) => {
    for (let y = 2; y < N - 2; y++) {
      const half = Math.sqrt(Math.max(0, R * R - (y - cy) * (y - cy)));
      const x = cx + k * half;
      if (inside(x, y) && (y % 2 === 0)) set(x, y, 'D');
    }
  });
  // Luces de la estación
  [[14, 12], [48, 13], [9, 40], [55, 42], [24, 58], [40, 58], [30, 5], [52, 26], [11, 27]].forEach(([x, y]) => set(x, y, 'Y'));

  // Trinchera ecuatorial (visor)
  for (let x = 0; x < N; x++) {
    if (!inside(x, 33)) continue;
    set(x, 32, 'G'); set(x, 33, 'K'); set(x, 34, 'K'); set(x, 35, 'D');
    if (x % 6 === 0) set(x, 34, 'O');
  }

  // Ojos: platos cóncavos con núcleo rojo brillante
  [[20.5, 23.5, -1], [42.5, 23.5, 1]].forEach(([ex, ey, side]) => {
    for (let y = ey - 7; y <= ey + 7; y++) {
      for (let x = ex - 7; x <= ex + 7; x++) {
        const d = Math.hypot(x - ex, y - ey);
        if (d > 6.6) continue;
        let ch;
        if (d > 5.6) ch = 'K';
        else if (d > 4.4) ch = 'G';
        else if (d > 2.9) ch = 'D';
        else if (d > 1.9) ch = 'R';
        else if (d > 1.0) ch = 'O';
        else ch = 'W';
        set(x, y, ch);
      }
    }
    // Cejas metálicas (expresión furiosa)
    for (let i = 0; i <= 15; i++) {
      const x = side < 0 ? ex - 8 + i : ex + 8 - i;
      const yb = ey - 8 + i * 0.32;
      set(x, yb - 1, 'g');
      set(x, yb, 'K');
      set(x, yb + 1, 'K');
      set(x, yb + 2, 'G');
    }
  });

  // Boca articulada brillante (Ultrón)
  const half = 13;
  for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
    const k = Math.abs(x - cx) / half;
    const yu = Math.round(40 + k * k * 2.5);
    const yl = Math.round(yu + 2 + open * 7 * (1 - k * k * 0.65));
    const seam = (x - Math.round(cx - half)) % 4 === 0;
    // Labio superior
    set(x, yu - 3, seam ? 'K' : 'g');
    set(x, yu - 2, seam ? 'K' : 'G');
    set(x, yu - 1, 'K');
    // Interior brillante
    for (let y = yu; y < yl; y++) {
      const t = (y - yu + 0.5) / Math.max(1, yl - yu);
      const c = Math.abs(t - 0.5) * 2;
      let ch = c < 0.25 ? 'W' : c < 0.55 ? 'Y' : c < 0.85 ? 'O' : 'R';
      if (open < 0.2) ch = k < 0.6 ? 'Y' : 'O';
      if (y === yu && open > 0.3 && x % 3 === 0 && k < 0.92) ch = 'w';
      if (y === yl - 1 && open > 0.3 && x % 3 === 1 && k < 0.92) ch = 'w';
      set(x, y, ch);
    }
    // Mandíbula inferior
    set(x, yl, 'K');
    set(x, yl + 1, seam ? 'K' : 'G');
    set(x, yl + 2, seam ? 'K' : 'g');
    set(x, yl + 3, 'D');
  }
  // Bisagras de la mandíbula
  [cx - half - 1.5, cx + half + 1.5].forEach((hx) => {
    set(hx, 41, 'K'); set(hx, 42, 'Y'); set(hx, 43, 'K');
  });

  return grid.map((r) => r.join(''));
}

// Contenedor de todos los sprites ya rasterizados
const SPR = {};
function buildAllSprites() {
  SPR.player = SPR_PLAYER_FLAME.map((fl) => buildSprite(SPR_PLAYER_BASE.concat(fl)));
  SPR.heart = buildSprite(SPR_HEART);
  SPR.heartWhite = buildSilhouette(SPR.heart, '#ffffff');
  SPR.heartL = buildSprite(SPR_HEART_HALF_L);
  SPR.heartR = buildSprite(SPR_HEART_HALF_R);
  SPR.enemy1 = buildSprite(SPR_ENEMY_1);
  SPR.enemy2 = buildSprite(SPR_ENEMY_2);
  SPR.enemy3 = buildSprite(SPR_ENEMY_3);
  SPR.enemy4 = buildSprite(SPR_ENEMY_4);
  ['enemy1', 'enemy2', 'enemy3', 'enemy4'].forEach((k) => { SPR[k + 'White'] = buildSilhouette(SPR[k], '#ffffff'); });
  SPR.blaster = buildSprite(SPR_BLASTER);
  SPR.blasterWhite = buildSilhouette(SPR.blaster, '#ffffff');
  SPR.boss = [0, 0.34, 0.67, 1].map((o) => buildSprite(generateBossRows(o)));
  SPR.bossWhite = SPR.boss.map((s) => buildSilhouette(s, '#ffffff'));
  SPR.bossShadow = buildSilhouette(SPR.boss[0], '#140818');
  SPR.capsules = {};
  for (const key in ITEMS) {
    const it = ITEMS[key];
    const rows = SPR_CAPSULE.map((r) => r.split(''));
    GLYPHS_3x5[it.letter].forEach((gr, gy) => {
      for (let gx = 0; gx < 3; gx++) if (gr[gx] === 'X') rows[3 + gy][3 + gx] = 'K';
    });
    SPR.capsules[key] = buildSprite(rows.map((r) => r.join('')), { X: it.color });
  }
  SPR.general = [];
  for (let m = 0; m < GENERAL_MOUTHS.length; m++) {
    SPR.general.push(buildSprite(withRows(SPR_GENERAL, GENERAL_MOUTHS[m])));
  }
  SPR.generalBlink = buildSprite(withRows(withRows(SPR_GENERAL, GENERAL_MOUTHS[0]), GENERAL_BLINK));
  SPR.missile = buildSprite(['.W.', 'wWw', 'wRw', 'wRw', 'G.G']);
}

const bulletCache = {};
function getBulletSprite(kind, color) {
  const key = kind + '_' + color;
  if (!bulletCache[key]) {
    bulletCache[key] = buildSprite(BULLET_SHAPES[kind] || BULLET_SHAPES.orb, { X: BULLET_COLORS[color] || color });
  }
  return bulletCache[key];
}

// Logo "GALAXHELL" hecho con bloques de píxel
function drawPixelLogo(cx, cy, block, time) {
  const text = 'GALAXHELL';
  const letterW = 6 * block;
  const totalW = text.length * letterW - block;
  const startX = Math.round(cx - totalW / 2);
  const colors = ['#fff6a0', '#ffe040', '#ffc030', '#ff9a20', '#ff6a20', '#ff3a30', '#d01840'];
  for (let i = 0; i < text.length; i++) {
    const glyph = LOGO_FONT[text[i]];
    const lx = startX + i * letterW;
    const ly = Math.round(cy - 3.5 * block + Math.sin(time * 3 + i * 0.6) * 3);
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (glyph[gy][gx] !== '#') continue;
        const px = lx + gx * block, py = ly + gy * block;
        ctx.fillStyle = '#3a0820';
        ctx.fillRect(px + 3, py + 3, block, block);
        ctx.fillStyle = colors[gy];
        ctx.fillRect(px, py, block, block);
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillRect(px, py, block, 2);
      }
    }
  }
  // Brillo que recorre el logo
  const shineX = startX + ((time * 160) % (totalW + 200)) - 100;
  const grad = ctx.createLinearGradient(shineX - 30, 0, shineX + 30, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = grad;
  ctx.fillRect(startX, cy - 5 * block, totalW, 10 * block);
  ctx.restore();
}

// Texto con fuente pixel en el canvas
function drawText(text, x, y, size = 10, color = '#fff', align = 'center', glow = null) {
  ctx.save();
  ctx.font = `${size}px ${PIXEL_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = '#000';
  ctx.fillText(text, Math.round(x) + 2, Math.round(y) + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, Math.round(x), Math.round(y));
  ctx.restore();
}

/* ---------------------------------------------------------------------
   4. ENTRADA (teclado + puntero/táctil)
   --------------------------------------------------------------------- */
const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Escape', 'Backspace',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyM', 'ShiftLeft', 'ShiftRight',
]);

const Input = {
  down: {},
  pressed: {},
  focused: true,
  interacted: false,
  pointer: { active: false, id: null, lastX: 0, lastY: 0, dx: 0, dy: 0, startT: 0, travel: 0 },
  tapped: false,

  init() {
    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'TEXTAREA') return;
      if (tag === 'INPUT' && e.code.startsWith('Arrow')) return; // el slider usa sus flechas
      if (!this.hasFocus()) return;
      onFirstInteraction();
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed[e.code] = true;
      this.down[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.down[e.code] = false;
      if (this.hasFocus() && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault();
    });
    window.addEventListener('blur', () => { this.down = {}; });

    const container = $('galaxhell');
    document.addEventListener('pointerdown', (e) => {
      this.interacted = true;
      this.focused = container.contains(e.target);
      if (this.focused) onFirstInteraction();
    });

    // Arrastre relativo sobre el canvas para mover la nave (táctil / ratón)
    canvas.addEventListener('pointerdown', (e) => {
      const p = this.pointer;
      p.active = true;
      p.id = e.pointerId;
      p.lastX = e.clientX;
      p.lastY = e.clientY;
      p.startT = performance.now();
      p.travel = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* sin captura */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointer;
      if (!p.active || e.pointerId !== p.id) return;
      const rect = canvas.getBoundingClientRect();
      const k = W / rect.width;
      const dx = (e.clientX - p.lastX) * k;
      const dy = (e.clientY - p.lastY) * k;
      p.dx += dx;
      p.dy += dy;
      p.travel += Math.abs(dx) + Math.abs(dy);
      p.lastX = e.clientX;
      p.lastY = e.clientY;
    });
    const end = (e) => {
      const p = this.pointer;
      if (!p.active || e.pointerId !== p.id) return;
      p.active = false;
      if (p.travel < 10 && performance.now() - p.startT < 350) this.tapped = true;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  },

  // Si el juego está incrustado en otra página, solo captura el teclado cuando
  // el jugador hizo clic en él o cuando el juego ocupa la mayor parte de la vista.
  hasFocus() {
    if (this.interacted) return this.focused;
    const r = $('galaxhell').getBoundingClientRect();
    const visible = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    return visible >= r.height * 0.6;
  },

  isDown(...codes) { return codes.some((c) => this.down[c]); },
  wasPressed(...codes) { return codes.some((c) => this.pressed[c]); },
  get confirm() { return this.wasPressed('KeyZ', 'Space', 'Enter'); },
  get cancel() { return this.wasPressed('KeyX', 'Escape', 'Backspace'); },
  get up() { return this.wasPressed('ArrowUp', 'KeyW'); },
  get downP() { return this.wasPressed('ArrowDown', 'KeyS'); },
  get left() { return this.wasPressed('ArrowLeft', 'KeyA'); },
  get right() { return this.wasPressed('ArrowRight', 'KeyD'); },
  axis() {
    let x = 0, y = 0;
    if (this.isDown('ArrowLeft', 'KeyA')) x -= 1;
    if (this.isDown('ArrowRight', 'KeyD')) x += 1;
    if (this.isDown('ArrowUp', 'KeyW')) y -= 1;
    if (this.isDown('ArrowDown', 'KeyS')) y += 1;
    if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    return { x, y };
  },
  get slow() { return this.isDown('ShiftLeft', 'ShiftRight'); },
  endFrame() {
    this.pressed = {};
    this.tapped = false;
    this.pointer.dx = 0;
    this.pointer.dy = 0;
  },
};

/* ---------------------------------------------------------------------
   5. SCHEDULER DE CORRUTINAS (secuencias, turnos y patrones bullet hell)
   yield <segundos>  -> espera
   yield <función>   -> espera hasta que la función devuelva true
   --------------------------------------------------------------------- */
const Scheduler = {
  list: [],
  start(gen, tag = 'main') {
    const co = { gen, wait: 0, cond: null, tag, done: false };
    this.list.push(co);
    this._run(co);
    return co;
  },
  _advance(co) {
    const r = co.gen.next();
    if (r.done) { co.done = true; return; }
    if (typeof r.value === 'function') co.cond = r.value;
    else co.wait += (r.value || 0);
  },
  _run(co) {
    let guard = 0;
    while (!co.done && !co.cond && co.wait <= 0 && guard++ < 500) this._advance(co);
  },
  update(dt) {
    const snapshot = this.list.slice();
    for (const co of snapshot) {
      if (co.done) continue;
      if (co.cond) {
        if (co.cond()) { co.cond = null; co.wait = 0; this._run(co); }
        continue;
      }
      co.wait -= dt;
      if (co.wait <= 0) this._run(co);
    }
    this.list = this.list.filter((c) => !c.done);
  },
  clear(tag) {
    for (const co of this.list) {
      if (tag === undefined || co.tag === tag) co.done = true;
    }
    this.list = this.list.filter((c) => !c.done);
  },
  has(tag) { return this.list.some((c) => c.tag === tag && !c.done); },
};

/* ---------------------------------------------------------------------
   6. FONDO ESPACIAL: estrellas con scroll vertical, nebulosas y partículas
   --------------------------------------------------------------------- */
const Stars = {
  layers: [],
  dust: [],
  nebulas: [],
  warp: 0,
  warpTarget: 0,
  init() {
    const defs = [
      { n: 70, speed: 18, size: 1, colors: ['#5a6080', '#7880a8'] },
      { n: 45, speed: 46, size: 1, colors: ['#a8b0e0', '#ffffff', '#8ab4ff'] },
      { n: 22, speed: 105, size: 2, colors: ['#ffffff', '#ffe8a0', '#a0e8ff'] },
    ];
    this.layers = defs.map((d) => ({
      speed: d.speed,
      size: d.size,
      stars: Array.from({ length: d.n }, () => ({
        x: Math.random() * W, y: Math.random() * H, c: choose(d.colors), tw: Math.random() * TAU,
      })),
    }));
    this.dust = Array.from({ length: 26 }, () => ({
      x: Math.random() * W, y: Math.random() * H, vy: rand(25, 70), vx: rand(-6, 6),
      c: choose(['#ff60c0', '#29e3ff', '#b04aff', '#ffe040']), a: rand(0.2, 0.6),
    }));
    this.nebulas = [
      { x: 110, y: 160, r: 170, c: '90,30,140', speed: 6 },
      { x: 380, y: 470, r: 210, c: '20,60,140', speed: 9 },
      { x: 300, y: -200, r: 150, c: '140,30,60', speed: 7 },
    ];
  },
  update(dt) {
    this.warp = lerp(this.warp, this.warpTarget, Math.min(1, dt * 2.5));
    const mul = 1 + this.warp * 7;
    for (const L of this.layers) {
      for (const s of L.stars) {
        s.y += L.speed * mul * dt;
        s.tw += dt * 3;
        if (s.y > H + 20) { s.y = -10 - Math.random() * 30; s.x = Math.random() * W; }
      }
    }
    for (const d of this.dust) {
      d.y += d.vy * mul * dt;
      d.x += d.vx * dt;
      if (d.y > H + 10) { d.y = -10; d.x = Math.random() * W; }
    }
    for (const n of this.nebulas) {
      n.y += n.speed * (1 + this.warp * 3) * dt;
      if (n.y - n.r > H) { n.y = -n.r - Math.random() * 200; n.x = rand(60, W - 60); }
    }
  },
  draw() {
    for (const n of this.nebulas) {
      const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
      g.addColorStop(0, `rgba(${n.c},0.22)`);
      g.addColorStop(1, `rgba(${n.c},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }
    for (const L of this.layers) {
      for (const s of L.stars) {
        ctx.fillStyle = s.c;
        ctx.globalAlpha = 0.6 + Math.sin(s.tw) * 0.4;
        const streak = this.warp > 0.15 ? L.speed * this.warp * 0.12 : 0;
        ctx.fillRect(Math.round(s.x), Math.round(s.y - streak), L.size, L.size + Math.round(streak));
      }
    }
    for (const d of this.dust) {
      ctx.globalAlpha = d.a;
      ctx.fillStyle = d.c;
      ctx.fillRect(Math.round(d.x), Math.round(d.y), 2, 2);
    }
    ctx.globalAlpha = 1;
  },
};

/* ---------------------------------------------------------------------
   7. ENTIDADES DEL MUNDO
   --------------------------------------------------------------------- */
const World = {
  bullets: [], beams: [], blasters: [], capsules: [], particles: [], texts: [], shots: [], rings: [],
};

function clearWorld() {
  for (const k in World) World[k].length = 0;
}

function currentDamage() {
  return Game.enemy ? Game.enemy.def.dmg : 6;
}

// ---------- Proyectiles enemigos ----------
function spawnBullet(x, y, ang, speed, o = {}) {
  const sp = speed * (Game.diff || 1);
  const b = {
    x, y, ang, speed: sp,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    kind: o.kind || 'orb', color: o.color || 'red', scale: o.scale || 1,
    r: o.r || (o.scale > 1 ? 5.5 : 3), dmg: o.dmg || currentDamage(),
    accel: o.accel || 0, curve: o.curve || 0, wave: o.wave || null, waveX: 0,
    life: 0, fade: 0, dead: false,
  };
  World.bullets.push(b);
  AudioManager.sfx('enemyShot');
  return b;
}

function fadeAllBullets() {
  for (const b of World.bullets) if (!b.fade) b.fade = 0.35;
  for (const bl of World.blasters) if (bl.phase !== 'fade') { bl.phase = 'fade'; bl.t = 0; }
  for (const bm of World.beams) if (bm.phase !== 'fade') { bm.phase = 'fade'; bm.t = 0; }
}

// ---------- Rayos láser (boca del jefe) ----------
function bossMouth() {
  const e = Game.enemy;
  if (!e) return { x: 240, y: 180 };
  return { x: e.x, y: e.y + 30 + e.mouthOpen * 8 };
}

function spawnBeam(o) {
  const b = {
    type: o.type || 'line', ang: o.ang !== undefined ? o.ang : Math.PI / 2,
    from: o.from, to: o.to, width: o.width || 22, warn: o.warn || 0.6, fire: o.fire || 0.4,
    t: 0, phase: 'warn', color: o.color || 'red', dmg: o.dmg || currentDamage() + 2,
    originFn: o.originFn || bossMouth, ox: 0, oy: 0, dead: false,
  };
  if (b.type === 'sweep') b.ang = b.from;
  const or = b.originFn();
  b.ox = or.x; b.oy = or.y;
  World.beams.push(b);
  AudioManager.sfx('beamWarn');
  return b;
}

// ---------- Gaster Blasters espaciales ----------
function spawnBlaster(x, y, o = {}) {
  const p = Game.player;
  const ang = o.angle !== undefined ? o.angle : angleTo(x, y, p.x, p.y);
  const back = 170;
  World.blasters.push({
    sx: x - Math.cos(ang) * back, sy: y - Math.sin(ang) * back,
    x: x - Math.cos(ang) * back, y: y - Math.sin(ang) * back,
    tx: x, ty: y, ang, t: 0, phase: 'enter',
    enter: 0.32, charge: o.charge || 0.78, fire: o.fire || 0.4,
    width: o.width || 30, scale: o.scale || 2, dmg: o.dmg || currentDamage() + 3, dead: false,
  });
}

function blasterMouth(bl) {
  const off = (SPR_BLASTER.length * bl.scale) / 2 - 3;
  return { x: bl.x + Math.cos(bl.ang) * off, y: bl.y + Math.sin(bl.ang) * off };
}

function blasterSpot() {
  const side = randInt(0, 3);
  if (side === 0) return { x: 22, y: rand(ARENA.y + 20, ARENA.y + ARENA.h - 20) };
  if (side === 1) return { x: W - 22, y: rand(ARENA.y + 20, ARENA.y + ARENA.h - 20) };
  if (side === 2) return { x: rand(ARENA.x + 30, ARENA.x + ARENA.w - 30), y: ARENA.y - 34 };
  return { x: rand(ARENA.x + 30, ARENA.x + ARENA.w - 30), y: ARENA.y + ARENA.h + 34 };
}

// ---------- Cápsulas de power-up ----------
function spawnCapsule(type, x, y, o = {}) {
  World.capsules.push({
    type, x, y, vx: o.vx !== undefined ? o.vx : rand(-25, 25), vy: o.vy !== undefined ? o.vy : rand(45, 75),
    t: Math.random() * 3, dead: false,
  });
}

// ---------- Partículas, explosiones y textos flotantes ----------
function spawnParticles(x, y, n, colors, speed = 120, life = 0.7, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const s = rand(speed * 0.3, speed);
    World.particles.push({
      x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), max: life,
      color: choose(colors), size: Math.random() < 0.3 ? size + 1 : size,
    });
  }
}

function explosion(x, y, power = 1, silent = false) {
  spawnParticles(x, y, Math.round(16 * power), ['#ffffff', '#ffe040', '#ff8c1a', '#ff2a3a', '#a01020'], 150 * power, 0.8, 3);
  World.rings.push({ x, y, r: 2, max: 34 * power, life: 0.45, t: 0 });
  if (!silent) AudioManager.sfx('explosion');
}

function floatText(text, x, y, color = '#fff', size = 12, life = 1.2) {
  World.texts.push({ text, x, y, color, size, life, max: life, vy: -38 });
}

function shake(amount) {
  Game.shake = Math.max(Game.shake, amount);
}

function flash(color = '#fff', amount = 0.8) {
  Game.flash = amount;
  Game.flashColor = color;
}

/* ---------------------------------------------------------------------
   8. LIBRERÍA DE PATRONES BULLET HELL (generadores)
   --------------------------------------------------------------------- */
function enemyOrigin() {
  const e = Game.enemy;
  return e ? { x: e.x, y: e.y + e.shotOffset } : { x: 240, y: 120 };
}
function aimAngle(o) {
  return angleTo(o.x, o.y, Game.player.x, Game.player.y);
}
function startPatterns(...gens) {
  gens.forEach((g) => Scheduler.start(g, 'pattern'));
}

const P = {
  *aimed(count, interval, speed, o = {}) {
    for (let i = 0; i < count; i++) {
      const s = enemyOrigin();
      spawnBullet(s.x, s.y, aimAngle(s) + (o.jitter ? rand(-o.jitter, o.jitter) : 0), speed, o);
      yield interval;
    }
  },
  *fan(times, n, spread, speed, interval, o = {}) {
    for (let t = 0; t < times; t++) {
      const s = enemyOrigin();
      const a = aimAngle(s) + (o.offset || 0);
      for (let i = 0; i < n; i++) spawnBullet(s.x, s.y, a + (i - (n - 1) / 2) * spread, speed, o);
      yield interval;
    }
  },
  *ring(times, n, speed, interval, o = {}) {
    let rot = o.startRot !== undefined ? o.startRot : Math.random() * TAU;
    for (let t = 0; t < times; t++) {
      const s = enemyOrigin();
      for (let i = 0; i < n; i++) spawnBullet(s.x, s.y, rot + (i * TAU) / n, speed, o);
      rot += o.rotStep !== undefined ? o.rotStep : TAU / n / 2;
      yield interval;
    }
  },
  *spiral(duration, rate, arms, rotSpeed, speed, o = {}) {
    let a = o.startAngle || 0;
    for (let t = 0; t < duration; t += rate) {
      const s = enemyOrigin();
      for (let k = 0; k < arms; k++) spawnBullet(s.x, s.y, a + (k * TAU) / arms, speed, o);
      a += rotSpeed * rate;
      yield rate;
    }
  },
  *rain(duration, rate, smin, smax, o = {}) {
    for (let t = 0; t < duration; t += rate) {
      const x = rand(ARENA.x + 4, ARENA.x + ARENA.w - 4);
      spawnBullet(x, ARENA.y - 70, Math.PI / 2 + rand(-0.08, 0.08), rand(smin, smax), { kind: 'needle', ...o });
      yield rate;
    }
  },
  *sineRain(duration, rate, speed, o = {}) {
    for (let t = 0; t < duration; t += rate) {
      const x = rand(ARENA.x + 30, ARENA.x + ARENA.w - 30);
      spawnBullet(x, ARENA.y - 60, Math.PI / 2, speed, {
        kind: 'diamond', ...o, wave: { amp: rand(18, 36), freq: rand(3, 5), phase: rand(0, TAU) },
      });
      yield rate;
    }
  },
  *crossfire(duration, rate, speed, o = {}) {
    let side = 0;
    for (let t = 0; t < duration; t += rate) {
      const left = side++ % 2 === 0;
      const x = left ? ARENA.x - 30 : ARENA.x + ARENA.w + 30;
      const y = rand(ARENA.y + 4, ARENA.y + ARENA.h * 0.7);
      const a = left ? rand(0.12, 0.6) : Math.PI - rand(0.12, 0.6);
      spawnBullet(x, y, a, speed, { kind: 'needle', ...o });
      yield rate;
    }
  },
  *gapWall(count, interval, speed, gap, o = {}) {
    for (let i = 0; i < count; i++) {
      const gx = rand(ARENA.x + gap / 2 + 10, ARENA.x + ARENA.w - gap / 2 - 10);
      for (let x = ARENA.x + 8; x < ARENA.x + ARENA.w; x += 17) {
        if (Math.abs(x - gx) > gap / 2) spawnBullet(x, ARENA.y - 60, Math.PI / 2, speed, { kind: 'needle', ...o });
      }
      yield interval;
    }
  },
  *blasters(count, interval, o = {}) {
    for (let i = 0; i < count; i++) {
      const pos = blasterSpot();
      spawnBlaster(pos.x, pos.y, o);
      yield interval;
    }
  },
  *blasterCircle(n, radius = 150, o = {}) {
    const p = Game.player;
    const off = Math.random() * TAU;
    for (let i = 0; i < n; i++) {
      const a = off + (i * TAU) / n;
      const x = clamp(p.x + Math.cos(a) * radius, 18, W - 18);
      const y = clamp(p.y + Math.sin(a) * radius, 200, H - 24);
      spawnBlaster(x, y, { charge: 1.05, ...o });
      yield 0.06;
    }
  },
  *mouthSweep(from, to, fire, warn, color) {
    spawnBeam({ type: 'sweep', from, to, fire, warn, color, width: 26 });
    yield warn + fire + 0.3;
  },
  *mouthShots(count, interval, o = {}) {
    for (let i = 0; i < count; i++) {
      const m = bossMouth();
      spawnBeam({ type: 'line', ang: angleTo(m.x, m.y, Game.player.x, Game.player.y), warn: 0.55, fire: 0.3, width: 20, ...o });
      yield interval;
    }
  },
};

/* ---------------------------------------------------------------------
   9. OBJETOS, ENEMIGOS Y JEFE FINAL
   --------------------------------------------------------------------- */
const ITEMS = {
  heal: { name: 'Nano-Reparación', letter: 'H', color: '#36e070', desc: 'Curación: recupera 40 HP.' },
  shield: { name: 'Escudo Deflector', letter: 'S', color: '#29e3ff', desc: 'Escudo: bloquea 3 impactos en el próximo turno enemigo.' },
  upgrade: { name: 'Upgrade Láser', letter: 'U', color: '#ffe040', desc: 'Upgrade permanente: +1 láser y más daño por disparo.' },
  missile: { name: 'Misiles Nova', letter: 'M', color: '#ff8c1a', desc: 'Misiles teledirigidos en tus 3 próximos ataques.' },
  plasma: { name: 'Cañón de Plasma', letter: 'P', color: '#b04aff', desc: 'Arma potente: tu próximo ataque hace DOBLE daño.' },
};
const ITEM_KEYS = Object.keys(ITEMS);
const MAX_INVENTORY = 8;

const ENEMIES = [
  {
    id: 'zenith', name: 'CAZA ZÉNITH', sprite: 'enemy1', scale: 3, hp: 45, dmg: 6, y: 130, shotOffset: 16,
    guaranteed: 'upgrade',
    intro: '* ¡Un CAZA ZÉNITH te cierra el paso!',
    flavor: ['* El Caza Zénith recarga sus cañones gemelos.', '* El piloto enemigo parece nervioso.', '* Huele a combustible quemado.'],
    turn(i) {
      const k = i % 3;
      if (k === 0) return { dur: 5.5, gens: [P.fan(9, 3, 0.22, 165, 0.6, { color: 'red' })] };
      if (k === 1) return { dur: 5.5, gens: [P.rain(5.2, 0.13, 130, 190, { color: 'red' })] };
      return { dur: 5.5, gens: [P.aimed(20, 0.26, 210, { kind: 'needle', color: 'orange', jitter: 0.05 })] };
    },
  },
  {
    id: 'vex', name: 'INTERCEPTOR VEX', sprite: 'enemy2', scale: 3, hp: 70, dmg: 7, y: 130, shotOffset: 18,
    guaranteed: 'missile',
    intro: '* ¡El INTERCEPTOR VEX aparece entre zumbidos!',
    flavor: ['* Vex traza piruetas para intimidarte.', '* Los motores de Vex chirrían en frecuencia púrpura.', '* Vex calcula tu trayectoria.'],
    turn(i) {
      const k = i % 3;
      if (k === 0) return { dur: 6, gens: [P.sineRain(5.6, 0.16, 120, { color: 'purple' }), P.aimed(8, 0.7, 200, { color: 'cyan' })] };
      if (k === 1) return { dur: 6, gens: [P.fan(11, 5, 0.2, 175, 0.5, { color: 'purple', kind: 'diamond' }), P.crossfire(5.5, 0.55, 160, { color: 'cyan' })] };
      return { dur: 6, gens: [P.gapWall(7, 0.8, 140, 70, { color: 'cyan' }), P.aimed(9, 0.62, 190, { color: 'purple' })] };
    },
  },
  {
    id: 'kraal', name: 'DESTRUCTOR KRAAL', sprite: 'enemy3', scale: 3, hp: 95, dmg: 8, y: 128, shotOffset: 20,
    guaranteed: 'plasma',
    intro: '* ¡El DESTRUCTOR KRAAL emerge de la nebulosa!',
    flavor: ['* Kraal blinda su casco y apunta a tu corazón.', '* Kraal emite un rugido de estática.', '* El blindaje verde de Kraal brilla.'],
    turn(i) {
      const k = i % 3;
      if (k === 0) return { dur: 6.5, gens: [P.ring(9, 14, 125, 0.68, { color: 'green', rotStep: 0.13 })] };
      if (k === 1) return { dur: 6.5, gens: [P.rain(6, 0.09, 140, 210, { color: 'green' }), P.fan(6, 3, 0.3, 150, 1.0, { color: 'yellow', scale: 2, r: 5.5 })] };
      return { dur: 6.5, gens: [P.crossfire(6.2, 0.16, 175, { color: 'green' }), P.ring(5, 12, 110, 1.2, { color: 'yellow' })] };
    },
  },
  {
    id: 'nebula', name: 'FRAGATA NÉBULA', sprite: 'enemy4', scale: 3, hp: 120, dmg: 9, y: 128, shotOffset: 22,
    guaranteed: 'upgrade',
    intro: '* ¡La FRAGATA NÉBULA despliega sus cañones dorados!',
    flavor: ['* La Fragata Nébula transmite un himno imperial.', '* Sus torretas doradas giran hacia ti.', '* Detectas una firma enorme detrás de la Fragata...'],
    turn(i) {
      const k = i % 4;
      if (k === 0) return { dur: 6.5, gens: [P.spiral(6.2, 0.08, 3, 2.1, 140, { color: 'yellow', kind: 'diamond' })] };
      if (k === 1) return { dur: 6.5, gens: [P.blasters(3, 1.8, { width: 24 }), P.fan(8, 5, 0.18, 160, 0.75, { color: 'blue' })] };
      if (k === 2) return { dur: 6.5, gens: [P.gapWall(6, 0.9, 150, 64, { color: 'yellow' }), P.spiral(5.5, 0.14, 2, -2.6, 120, { color: 'blue' })] };
      return { dur: 6.5, gens: [P.ring(7, 16, 120, 0.85, { color: 'blue' }), P.sineRain(6, 0.22, 120, { color: 'yellow' })] };
    },
  },
];

const BEAM_COLORS = {
  red: { edge: '#ff3050', glow: 'rgba(255,48,80,0.35)' },
  blue: { edge: '#3a7bff', glow: 'rgba(58,123,255,0.35)' },
  orange: { edge: '#ff8c1a', glow: 'rgba(255,140,26,0.35)' },
  white: { edge: '#c8f4ff', glow: 'rgba(160,240,255,0.35)' },
};

function caption(text, color = '#fff', time = 2.2) {
  Battle.caption = { text, color, t: time, max: time };
}

// Ataque especial de apertura (estilo Sans): secuencia larga sin pausa
function* bossOpening() {
  caption('¡LLUVIA DE METEOROS!', '#ff3050');
  startPatterns(P.rain(3.2, 0.045, 170, 250, { color: 'red' }), P.aimed(5, 0.55, 230, { color: 'yellow', scale: 2, r: 5.5 }));
  yield 4.6; // pausa para que la lluvia salga de la caja antes del rayo azul
  caption('¡AZUL = NO TE MUEVAS!', '#3a7bff');
  startPatterns(P.mouthSweep(2.35, 0.8, 1.5, 0.9, 'blue'));
  yield 2.6;
  caption('¡NARANJA = MUÉVETE!', '#ff8c1a');
  startPatterns(P.mouthSweep(0.8, 2.35, 1.5, 0.9, 'orange'));
  yield 2.6;
  caption('¡RÁFAGAS CRUZADAS!', '#ff3050');
  startPatterns(P.crossfire(4, 0.075, 220, { color: 'red' }), P.ring(4, 16, 140, 1.0, { color: 'purple' }));
  yield 4.2;
  caption('¡GASTER BLASTERS!', '#c8f4ff');
  startPatterns(P.blasters(9, 0.4));
  yield 4.0;
  startPatterns(P.blasterCircle(6, 150), P.spiral(3.0, 0.07, 4, 2.4, 135, { color: 'yellow', kind: 'diamond' }));
  yield 3.2;
}

function* bossSweeps(rage) {
  const first = Math.random() < 0.5 ? 'blue' : 'orange';
  const second = first === 'blue' ? 'orange' : 'blue';
  const label = (c) => (c === 'blue' ? '¡AZUL = NO TE MUEVAS!' : '¡NARANJA = MUÉVETE!');
  caption(label(first), BEAM_COLORS[first].edge);
  yield* P.mouthSweep(0.85, 2.3, 1.3, 0.8, first);
  startPatterns(P.rain(1.0, rage ? 0.1 : 0.14, 140, 190, { color: 'white' }));
  yield* P.mouthShots(rage ? 4 : 3, 0.6);
  yield 0.8; // deja caer la lluvia antes del siguiente barrido
  caption(label(second), BEAM_COLORS[second].edge);
  yield* P.mouthSweep(2.3, 0.85, 1.3, 0.8, second);
}

function* bossDesperation() {
  caption('¡ÚLTIMO RECURSO!', '#ff2a3a', 3);
  startPatterns(P.spiral(4.5, 0.08, 5, 1.7, 120, { color: 'red' }), P.blasters(5, 0.8));
  yield 4.8;
  caption('¡NARANJA = MUÉVETE!', '#ff8c1a');
  startPatterns(P.rain(2.4, 0.1, 140, 200, { color: 'orange' }));
  yield* P.mouthSweep(0.85, 2.3, 1.4, 0.8, 'orange');
  startPatterns(P.blasterCircle(8, 160));
  yield 2.2;
  startPatterns(P.crossfire(3, 0.07, 220, { color: 'red' }), P.ring(3, 22, 130, 0.9, { color: 'purple' }));
  yield 3.2;
  startPatterns(P.blasterCircle(6, 140), P.aimed(6, 0.3, 240, { color: 'yellow' }));
  yield 2.5;
}

const BOSS = {
  id: 'nemesis', name: 'ESTACIÓN NÉMESIS', sprite: 'boss', isBoss: true, scale: BOSS_SCALE,
  hp: 520, dmg: 10, y: 150, shotOffset: 30, firstStrike: true,
  intro: '* NÉMESIS: «Pequeño piloto... hoy vas a pasar un MAL rato.»',
  flavor: [
    '* NÉMESIS: «¿Sigues respirando? Qué molesto.»',
    '* NÉMESIS: «Mis cañones calavera nunca fallan dos veces.»',
    '* NÉMESIS: «Tu determinación es... irrelevante.»',
    '* La estación gira lentamente. Sus ojos rojos te siguen.',
    '* Huele a ozono y a metal fundido.',
  ],
  rageText: '* NÉMESIS: «¡IMPOSIBLE! ¡Sistemas al límite!»',
  desperateText: '* NÉMESIS: «¡SI YO CAIGO, TÚ CAES CONMIGO!»',
  turn(i, e) {
    if (i === 0) return { dur: 21.9, gens: [bossOpening()] };
    if (e.hp < e.maxHp * 0.3 && !e.desperationUsed) {
      e.desperationUsed = true;
      return { dur: 15.6, gens: [bossDesperation()] };
    }
    const rage = e.hp < e.maxHp * 0.5;
    Game.diff = rage ? 1.15 : 1;
    const k = (i - 1) % 4;
    if (k === 0) return { dur: 7, gens: [P.blasters(rage ? 11 : 8, rage ? 0.45 : 0.62), P.aimed(10, 0.6, 200, { color: 'red' })] };
    if (k === 1) return { dur: 7, gens: [P.spiral(6.6, rage ? 0.05 : 0.065, 4, 2.0, 130, { color: 'purple' }), P.ring(5, 20, 115, 1.25, { color: 'yellow', kind: 'diamond' })] };
    if (k === 2) return { dur: 7.8, gens: [bossSweeps(rage)] };
    return { dur: 7.5, gens: [P.crossfire(7, rage ? 0.1 : 0.13, 195, { color: 'red' }), P.blasters(rage ? 6 : 4, 1.3)] };
  },
};

/* ---------------------------------------------------------------------
   10. DIÁLOGOS DEL GENERAL (intercomunicador estilo Star Fox)
   --------------------------------------------------------------------- */
const GENERAL = 'GRAL. ORIÓN';
const INTRO_LINES = [
  { text: '¡Piloto Santiago! Aquí el General Orión, comando de la Flota Estelar. ¿Me recibe?' },
  { text: 'El Imperio NÉMESIS cruzó la Nebulosa del Infierno. Usted pilota nuestra última nave. Misión: atravesar el sector y destruir su estación de batalla.' },
  { text: 'Controles: FLECHAS o WASD para mover la nave. Z o ESPACIO para confirmar y para detener la barra de ataque. X o ESC para volver. SHIFT para moverse con precisión.' },
  { text: 'El combate es por turnos. En SU turno aparecerán dos botones junto a su nave: [ ATACAR ] y [ OBJETO ].' },
  { text: 'Al ATACAR, detenga el cursor en el CENTRO de la barra para un disparo CRÍTICO. Los extremos hacen menos daño.' },
  { text: 'En el turno ENEMIGO esquive los proyectiles. Solo el CORAZÓN ROJO del centro de su nave recibe daño. ¡Protéjalo!' },
  { text: 'Recoja las CÁPSULAS que sueltan los enemigos: H cura, S escudo, U mejora láser, M misiles y P plasma. Úselas desde [ OBJETO ].' },
  { text: 'Último consejo: los rayos AZULES no dañan si se queda QUIETO; los NARANJAS, si se MUEVE. ¡Buena suerte, piloto!' },
];
const ALERT_LINES = [
  { text: '¡Piloto! ¡Detectamos una firma de energía colosal! ¡Es la estación NÉMESIS en persona!' },
  { text: 'Sus cañones calavera cargan antes de disparar: ¡muévase en cuanto vea la línea de advertencia! ¡Y vigile esa boca!' },
];
const VICTORY_LINES = [
  { text: '¡Lo logró, piloto! ¡La estación NÉMESIS ha sido reducida a polvo estelar!' },
  { text: 'La galaxia está a salvo gracias a usted. ¡Regrese a la base, héroe! Esta noche se brinda en su honor.' },
];

const Dialog = {
  active: false,
  done: true,
  lines: [],
  idx: 0,
  full: '',
  chars: 0,
  timer: 0,
  mouth: 0,
  mouthT: 0,
  blinkT: 2.5,
  blinking: 0,
  staticT: 0,
  cooldown: 0,
  skippable: false,

  init() {
    this.el = $('dialogBox');
    this.textEl = $('dialogText');
    this.nameEl = $('dialogName');
    this.nextEl = $('dialogNext');
    this.skipEl = $('dialogSkip');
    this.pcanvas = $('portraitCanvas');
    this.pctx = this.pcanvas.getContext('2d');
    this.pctx.imageSmoothingEnabled = false;
    this.el.addEventListener('click', () => { if (this.cooldown <= 0) this.advance(); });
  },

  start(lines, opts = {}) {
    this.lines = lines;
    this.idx = 0;
    this.active = true;
    this.done = false;
    this.cooldown = 0.3;
    this.skippable = !!opts.skippable;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('urgent', !!opts.urgent);
    this.skipEl.classList.toggle('hidden', !this.skippable);
    this.staticT = 0.4;
    this.beginLine();
  },

  beginLine() {
    const l = this.lines[this.idx];
    this.nameEl.textContent = l.name || GENERAL;
    this.full = l.text;
    this.chars = 0;
    this.timer = 0;
    this.textEl.textContent = '';
    this.nextEl.classList.add('waiting');
  },

  get typing() { return this.chars < this.full.length; },

  update(dt) {
    if (!this.active) return;
    this.cooldown -= dt;
    this.staticT -= dt;
    if (this.typing) {
      this.timer += dt;
      const step = 1 / 44;
      while (this.timer >= step && this.typing) {
        this.timer -= step;
        this.chars++;
        const ch = this.full[this.chars - 1];
        if (ch !== ' ' && this.chars % 2 === 0) AudioManager.sfx('voice', 165);
        if ('.,!?:;'.includes(ch)) this.timer -= 0.09;
      }
      this.textEl.textContent = this.full.slice(0, this.chars);
      if (!this.typing) this.nextEl.classList.remove('waiting');
      this.mouthT -= dt;
      if (this.mouthT <= 0) { this.mouth = randInt(0, 2); this.mouthT = 0.075; }
    } else {
      this.mouth = 0;
    }
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinking = 0.13; this.blinkT = rand(2, 4.2); }
    this.blinking -= dt;
    this.drawPortrait();

    if (this.cooldown <= 0) {
      if (this.skippable && Input.wasPressed('Escape')) { AudioManager.sfx('cancel'); this.finish(); return; }
      if (Input.confirm) this.advance();
    }
  },

  drawPortrait() {
    const g = this.pctx;
    const t = Game.time;
    g.fillStyle = '#071a3a';
    g.fillRect(0, 0, 48, 48);
    g.fillStyle = '#0d2a5a';
    for (let y = 0; y < 48; y += 6) g.fillRect(0, y, 48, 1);
    const img = this.blinking > 0 && !this.typing ? SPR.generalBlink : SPR.general[this.mouth];
    const bob = this.typing ? Math.round(Math.sin(t * 18) * 0.6) : 0;
    g.drawImage(img, 0, bob, 48, 48);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    const off = Math.floor(t * 20) % 2;
    for (let y = off; y < 48; y += 2) g.fillRect(0, y, 48, 1);
    if (this.staticT > 0) {
      for (let i = 0; i < 260; i++) {
        g.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#5a6080';
        g.fillRect(randInt(0, 47), randInt(0, 47), 1, 1);
      }
    }
  },

  advance() {
    if (!this.active) return;
    if (this.typing) {
      this.chars = this.full.length;
      this.textEl.textContent = this.full;
      this.nextEl.classList.remove('waiting');
      return;
    }
    this.idx++;
    AudioManager.sfx('select');
    if (this.idx >= this.lines.length) this.finish();
    else this.beginLine();
  },

  finish() {
    this.active = false;
    this.done = true;
    this.el.classList.add('hidden');
  },
};

/* ---------------------------------------------------------------------
   11. INTERFAZ HTML (HUD, menús flotantes, inventario y pantallas)
   --------------------------------------------------------------------- */
const UI = {
  ready: false,
  nav: [],
  navIndex: 0,
  logFull: '',
  logShown: 0,
  logTimer: 0,
  floatSel: 0,
  itemSel: 0,
  itemKeys: [],

  init() {
    const ids = [
      'mainMenu', 'menuButtons', 'optionsPanel', 'btnStart', 'btnOptions', 'btnMute', 'volumeSlider', 'volumeValue',
      'btnBack', 'audioHint', 'hud', 'enemyBar', 'enemyName', 'enemyHpFill', 'enemyHpGhost', 'enemyHpText',
      'playerLv', 'playerHpFill', 'playerHpText', 'statusIcons', 'battleLog', 'floatMenu', 'btnAttack', 'btnItem',
      'itemMenu', 'itemList', 'itemDesc', 'alertOverlay', 'gameOverScreen', 'btnRetry', 'btnGoMenu',
      'victoryScreen', 'victoryStats', 'btnVictoryMenu', 'quickMute', 'playerBar',
    ];
    this.el = {};
    ids.forEach((id) => { this.el[id] = $(id); });
    const E = this.el;

    const bind = (el, fn) => el.addEventListener('click', (e) => {
      e.currentTarget.blur();
      onFirstInteraction();
      fn(e);
    });
    bind(E.btnStart, () => { AudioManager.sfx('confirm'); startNewGame(); });
    bind(E.btnOptions, () => { AudioManager.sfx('confirm'); this.showOptions(true); });
    bind(E.btnBack, () => { AudioManager.sfx('cancel'); this.showOptions(false); });
    bind(E.btnMute, () => { AudioManager.toggleMute(); AudioManager.sfx('select'); });
    bind(E.quickMute, () => { AudioManager.toggleMute(); AudioManager.sfx('select'); });
    E.volumeSlider.addEventListener('input', () => {
      onFirstInteraction();
      AudioManager.setVolume(Number(E.volumeSlider.value) / 100);
      if (AudioManager.muted && Number(E.volumeSlider.value) > 0) AudioManager.setMuted(false);
    });
    bind(E.btnRetry, () => { AudioManager.sfx('confirm'); retryFromCheckpoint(); });
    bind(E.btnGoMenu, () => { AudioManager.sfx('cancel'); changeState(STATE_MENU); });
    bind(E.btnVictoryMenu, () => { AudioManager.sfx('confirm'); changeState(STATE_MENU); });
    bind(E.btnAttack, () => { if (Battle.phase === 'playerMenu') { this.setFloatSel(0); Battle.choice = 'attack'; AudioManager.sfx('confirm'); } });
    bind(E.btnItem, () => { if (Battle.phase === 'playerMenu') { this.setFloatSel(1); Battle.choice = 'item'; AudioManager.sfx('confirm'); } });
    E.itemList.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li || Battle.phase !== 'itemMenu') return;
      Battle.itemChoice = li.dataset.key;
      AudioManager.sfx('confirm');
    });
    // Resaltar con el ratón
    [E.btnStart, E.btnOptions, E.btnMute, E.volumeSlider, E.btnBack, E.btnRetry, E.btnGoMenu, E.btnVictoryMenu].forEach((b) => {
      b.addEventListener('pointerenter', () => {
        const i = this.nav.indexOf(b);
        if (i >= 0) this.setNavIndex(i);
      });
    });
    this.ready = true;
    this.syncAudioControls();
  },

  show(el, v) { el.classList.toggle('hidden', !v); },

  syncAudioControls() {
    const E = this.el;
    if (!E) return;
    const pct = Math.round(AudioManager.volume * 100);
    E.volumeSlider.value = pct;
    E.volumeValue.textContent = AudioManager.muted ? 'SILENCIO' : pct + '%';
    E.btnMute.textContent = AudioManager.muted ? '[ SONIDO: SILENCIADO ]' : '[ SONIDO: ACTIVADO ]';
    E.btnMute.classList.toggle('is-muted', AudioManager.muted);
    E.quickMute.classList.toggle('is-muted', AudioManager.muted);
    E.quickMute.setAttribute('aria-pressed', String(AudioManager.muted));
  },

  // ---------- Navegación por teclado de menús HTML ----------
  setNav(list, index = 0) {
    this.nav = list;
    this.setNavIndex(index);
  },
  setNavIndex(i) {
    this.nav.forEach((el) => el.classList.remove('selected'));
    if (!this.nav.length) return;
    this.navIndex = (i + this.nav.length) % this.nav.length;
    this.nav[this.navIndex].classList.add('selected');
  },
  navUpdate() {
    if (!this.nav.length) return;
    const cur = this.nav[this.navIndex];
    const isSlider = cur && cur.tagName === 'INPUT';
    if (isSlider && (Input.left || Input.right)) {
      const delta = Input.left ? -0.05 : 0.05;
      AudioManager.setVolume(Math.round((AudioManager.volume + delta) * 20) / 20);
      if (AudioManager.muted && delta > 0) AudioManager.setMuted(false);
      AudioManager.sfx('select');
      return;
    }
    if (Input.up || Input.left) { this.setNavIndex(this.navIndex - 1); AudioManager.sfx('select'); }
    if (Input.downP || Input.right) { this.setNavIndex(this.navIndex + 1); AudioManager.sfx('select'); }
    if (Input.confirm && cur && !isSlider) cur.click();
    if (Input.cancel && !this.el.optionsPanel.classList.contains('hidden')) this.el.btnBack.click();
  },

  // ---------- Pantallas ----------
  showMainMenu(v) {
    this.show(this.el.mainMenu, v);
    if (v) {
      this.showOptions(false);
      this.show(this.el.audioHint, !AudioManager.unlocked);
    }
  },
  showOptions(v) {
    this.show(this.el.optionsPanel, v);
    this.show(this.el.menuButtons, !v);
    if (v) this.setNav([this.el.btnMute, this.el.volumeSlider, this.el.btnBack], 0);
    else this.setNav([this.el.btnStart, this.el.btnOptions], 0);
    this.syncAudioControls();
  },
  showAlert(v) { this.show(this.el.alertOverlay, v); },
  showGameOver(v) {
    this.show(this.el.gameOverScreen, v);
    if (v) this.setNav([this.el.btnRetry, this.el.btnGoMenu], 0);
  },
  showVictory(v, stats) {
    this.show(this.el.victoryScreen, v);
    if (v) {
      this.el.victoryStats.innerHTML = stats.map(([k, val]) => `<li><span>${k}</span><span>${val}</span></li>`).join('');
      this.setNav([this.el.btnVictoryMenu], 0);
    }
  },

  // ---------- HUD ----------
  showHud(v) { this.show(this.el.hud, v); },
  updatePlayer() {
    const p = Game.player;
    if (!p) return;
    const pct = clamp(p.hp / p.maxHp, 0, 1) * 100;
    this.el.playerHpFill.style.width = pct + '%';
    this.el.playerHpFill.classList.toggle('low', pct <= 30);
    this.el.playerHpText.textContent = `${Math.max(0, Math.ceil(p.hp))}/${p.maxHp}`;
    this.el.playerLv.textContent = `LV ${p.lv}`;
    const badges = [`<span class="gh-badge laser">LÁSER x${1 + p.weaponLevel}</span>`];
    if (p.missileShots > 0) badges.push(`<span class="gh-badge missile">MISIL x${p.missileShots}</span>`);
    if (p.plasmaArmed) badges.push('<span class="gh-badge plasma">PLASMA</span>');
    if (p.shield > 0) badges.push(`<span class="gh-badge shield">ESCUDO ${p.shield}</span>`);
    this.el.statusIcons.innerHTML = badges.join('');
  },
  setEnemy(e) {
    this.show(this.el.enemyBar, true);
    this.el.enemyName.textContent = e.def.name;
    this.el.enemyBar.classList.toggle('boss', !!e.def.isBoss);
    this.updateEnemy(e, true);
  },
  updateEnemy(e, instant = false) {
    const pct = clamp(e.hp / e.maxHp, 0, 1) * 100;
    const E = this.el;
    if (instant) {
      E.enemyHpFill.style.transition = 'none';
      E.enemyHpGhost.style.transition = 'none';
    }
    E.enemyHpFill.style.width = pct + '%';
    E.enemyHpGhost.style.width = pct + '%';
    E.enemyHpText.textContent = `${Math.max(0, Math.ceil(e.hp))}/${e.maxHp}`;
    if (instant) {
      void E.enemyHpFill.offsetWidth;
      E.enemyHpFill.style.transition = '';
      E.enemyHpGhost.style.transition = '';
    }
  },
  hideEnemy() { this.show(this.el.enemyBar, false); },

  // ---------- Caja de texto de batalla (Undertale) ----------
  log(text) {
    this.logFull = text || '';
    this.logShown = 0;
    this.logTimer = 0;
    this.el.battleLog.textContent = '';
    this.show(this.el.battleLog, !!text);
  },
  updateLog(dt) {
    if (this.logShown >= this.logFull.length) return;
    this.logTimer += dt;
    const step = 1 / 55;
    while (this.logTimer >= step && this.logShown < this.logFull.length) {
      this.logTimer -= step;
      this.logShown++;
      if (this.logShown % 3 === 0 && this.logFull[this.logShown - 1] !== ' ') AudioManager.sfx('text');
    }
    this.el.battleLog.textContent = this.logFull.slice(0, this.logShown);
  },

  // ---------- Menú flotante alrededor de la nave ----------
  showFloatMenu(v) {
    this.show(this.el.floatMenu, v);
    if (v) this.setFloatSel(this.floatSel);
  },
  positionFloatMenu(x, y) {
    const E = this.el;
    E.btnAttack.style.left = ((x - 112) / W) * 100 + '%';
    E.btnAttack.style.top = (y / H) * 100 + '%';
    E.btnItem.style.left = ((x + 112) / W) * 100 + '%';
    E.btnItem.style.top = (y / H) * 100 + '%';
  },
  setFloatSel(i) {
    this.floatSel = (i + 2) % 2;
    this.el.btnAttack.classList.toggle('selected', this.floatSel === 0);
    this.el.btnItem.classList.toggle('selected', this.floatSel === 1);
  },

  // ---------- Inventario ----------
  openItemMenu() {
    this.show(this.el.itemMenu, true);
    this.itemSel = 0;
    this.renderItems();
  },
  renderItems() {
    const inv = Game.player.inventory;
    const counts = {};
    inv.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
    this.itemKeys = ITEM_KEYS.filter((k) => counts[k]);
    this.el.itemList.innerHTML = this.itemKeys.map((k, i) => {
      const it = ITEMS[k];
      return `<li data-key="${k}" class="${i === this.itemSel ? 'selected' : ''}">` +
        `<span class="gh-item-icon" style="background:${it.color}">${it.letter}</span>` +
        `<span class="gh-item-name">${it.name}</span><span class="gh-item-qty">x${counts[k]}</span></li>`;
    }).join('');
    const sel = this.itemKeys[this.itemSel];
    this.el.itemDesc.textContent = sel ? ITEMS[sel].desc : '';
  },
  moveItemSel(d) {
    if (!this.itemKeys.length) return;
    this.itemSel = (this.itemSel + d + this.itemKeys.length) % this.itemKeys.length;
    this.renderItems();
    AudioManager.sfx('select');
  },
  closeItemMenu() { this.show(this.el.itemMenu, false); },

  hideBattleUI() {
    this.showFloatMenu(false);
    this.closeItemMenu();
    this.log('');
  },
};

/* ---------------------------------------------------------------------
   12. ESTADO GLOBAL DEL JUEGO Y SISTEMA DE COMBATE POR TURNOS
   --------------------------------------------------------------------- */
const Game = {
  state: null,
  time: 0,
  stateTime: 0,
  shake: 0,
  flash: 0,
  flashColor: '#fff',
  diff: 1,
  player: null,
  enemy: null,
  enemyIndex: 0,
  checkpoint: null,
  stats: null,
};

const Battle = {
  phase: 'none',
  choice: null,
  itemChoice: null,
  bar: null,
  caption: null,
  turnIndex: 0,
  arenaA: 0,
  arenaTarget: 0,
  deathStage: 0,
  fwT: 0,
};

function resetBattle() {
  Battle.phase = 'none';
  Battle.choice = null;
  Battle.itemChoice = null;
  Battle.bar = null;
  Battle.caption = null;
  Battle.turnIndex = 0;
  Battle.deathStage = 0;
}

function createPlayer() {
  return {
    x: HOME.x, y: H + 40, hp: 100, maxHp: 100, lv: 1,
    weaponLevel: 0, missileShots: 0, plasmaArmed: false, shield: 0,
    invuln: 0, inventory: ['heal', 'heal', 'shield'], moving: false, dead: false, flameT: 0,
  };
}

function clonePlayer(p) {
  return { ...p, inventory: p.inventory.slice(), dead: false, invuln: 0, shield: 0, moving: false };
}

function saveCheckpoint(boss) {
  Game.checkpoint = { player: clonePlayer(Game.player), enemyIndex: Game.enemyIndex, boss };
}

function randomDrop() {
  const r = Math.random();
  if (r < 0.35) return 'heal';
  if (r < 0.55) return 'shield';
  if (r < 0.7) return 'missile';
  if (r < 0.85) return 'upgrade';
  return 'plasma';
}

function spawnEnemy(def) {
  const img = def.isBoss ? SPR.boss[0] : SPR[def.sprite];
  const h = img.height * def.scale;
  Game.enemy = {
    def, x: 240, baseY: -h / 2 - 10, y: -h / 2 - 10, targetY: def.y,
    w: img.width * def.scale, h, hp: def.hp, maxHp: def.hp,
    hitFlash: 0, arrived: false, dead: false, dying: 0, visible: true,
    mouthOpen: 0, mouthTarget: 0, talk: 0, shotOffset: def.shotOffset, swayT: 0,
    desperationUsed: false, rageAnnounced: false,
  };
}

// ---------- Recolección de cápsulas ----------
function collectItem(type) {
  const p = Game.player;
  const it = ITEMS[type];
  if (p.inventory.length < MAX_INVENTORY) {
    p.inventory.push(type);
    floatText('+ ' + it.name.toUpperCase(), p.x, p.y - 30, it.color, 9, 1.5);
    AudioManager.sfx('pickup');
  } else if (type === 'heal') {
    p.hp = Math.min(p.maxHp, p.hp + 15);
    floatText('+15 HP', p.x, p.y - 30, '#36e070', 10, 1.3);
    AudioManager.sfx('heal');
  } else {
    floatText('INVENTARIO LLENO', p.x, p.y - 30, '#aaaaaa', 9, 1.3);
    AudioManager.sfx('error');
  }
  spawnParticles(p.x, p.y, 10, [it.color, '#ffffff'], 90, 0.5, 2);
  UI.updatePlayer();
  if (Battle.phase === 'itemMenu') UI.renderItems();
}

// ---------- Uso de objetos ----------
function useItem(key) {
  const p = Game.player;
  const idx = p.inventory.indexOf(key);
  if (idx < 0) return;
  p.inventory.splice(idx, 1);
  Game.stats.itemsUsed++;
  const it = ITEMS[key];
  switch (key) {
    case 'heal': {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + 40);
      const healed = Math.round(p.hp - before);
      UI.log(`* Usaste ${it.name}. ¡Recuperaste ${healed} HP!`);
      floatText('+' + healed + ' HP', p.x, p.y - 34, '#36e070', 12, 1.4);
      spawnParticles(p.x, p.y, 24, ['#36e070', '#9dff6a', '#ffffff'], 110, 0.9, 2);
      AudioManager.sfx('heal');
      break;
    }
    case 'shield':
      p.shield = 3;
      UI.log('* ¡Escudo Deflector activado! Bloqueará 3 impactos en el próximo turno enemigo.');
      spawnParticles(p.x, p.y, 20, ['#29e3ff', '#ffffff'], 120, 0.7, 2);
      AudioManager.sfx('shield');
      break;
    case 'upgrade':
      if (p.weaponLevel < 3) {
        p.weaponLevel++;
        UI.log(`* ¡Upgrade Láser instalado! Ahora disparas ${1 + p.weaponLevel} láseres con más potencia.`);
      } else {
        p.hp = Math.min(p.maxHp, p.hp + 25);
        UI.log('* Tu láser ya está al máximo. El upgrade se convierte en +25 HP.');
      }
      spawnParticles(p.x, p.y, 24, ['#ffe040', '#ffffff'], 130, 0.8, 2);
      AudioManager.sfx('upgrade');
      break;
    case 'missile':
      p.missileShots += 3;
      UI.log('* ¡Misiles Nova cargados! Acompañarán tus 3 próximos ataques.');
      spawnParticles(p.x, p.y, 20, ['#ff8c1a', '#ffe040'], 120, 0.7, 2);
      AudioManager.sfx('upgrade');
      break;
    case 'plasma':
      p.plasmaArmed = true;
      UI.log('* ¡Cañón de Plasma cargado! Tu próximo ataque hará DOBLE daño.');
      spawnParticles(p.x, p.y, 26, ['#b04aff', '#ff60c0', '#ffffff'], 130, 0.8, 2);
      AudioManager.sfx('plasma');
      break;
    default: break;
  }
  UI.updatePlayer();
}

// ---------- Ataque del jugador ----------
function computeAttack(mult, crit) {
  const p = Game.player;
  let dmg = (10 + p.weaponLevel * 5) * mult;
  let missiles = 0;
  if (p.missileShots > 0) {
    missiles = 2 + Math.floor(p.weaponLevel / 2);
    dmg += missiles * 7 * Math.max(0.6, mult);
    p.missileShots--;
  }
  const plasma = p.plasmaArmed;
  if (plasma) { dmg *= 2; p.plasmaArmed = false; }
  UI.updatePlayer();
  return { dmg: Math.max(1, Math.round(dmg)), crit, lasers: (1 + p.weaponLevel) * (crit ? 2 : 1), missiles, plasma };
}

function firePlayerAttack(atk) {
  const p = Game.player, e = Game.enemy;
  const n = Math.min(atk.lasers, 8);
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * 7;
    World.shots.push({
      kind: 'laser', sx: p.x + ox, sy: p.y - 18, x: p.x + ox, y: p.y - 18,
      tx: e.x + rand(-e.w * 0.22, e.w * 0.22), ty: e.y + rand(-e.h * 0.12, e.h * 0.2),
      t: -i * 0.07, dur: 0.22, color: atk.crit ? '#ffe040' : '#29e3ff', started: false, dead: false,
    });
  }
  for (let i = 0; i < atk.missiles; i++) {
    const side = i % 2 ? 1 : -1;
    World.shots.push({
      kind: 'missile', sx: p.x + side * 14, sy: p.y, x: p.x, y: p.y,
      cx: p.x + side * rand(110, 170), cy: p.y - rand(60, 140),
      tx: e.x + rand(-e.w * 0.2, e.w * 0.2), ty: e.y + rand(-e.h * 0.1, e.h * 0.15),
      t: -0.12 - i * 0.12, dur: 0.6, started: false, dead: false, ang: -Math.PI / 2,
    });
  }
  if (atk.plasma) {
    World.shots.push({
      kind: 'plasma', sx: p.x, sy: p.y - 20, x: p.x, y: p.y - 20, tx: e.x, ty: e.y,
      t: -0.25 - n * 0.07, dur: 0.45, started: false, dead: false,
    });
  }
}

function damageEnemy(atk) {
  const e = Game.enemy;
  e.hp = Math.max(0, e.hp - atk.dmg);
  e.hitFlash = 0.35;
  shake(atk.crit ? 10 : 5);
  floatText('-' + atk.dmg, e.x + rand(-24, 24), e.y - e.h * 0.25, atk.crit ? '#ffe040' : '#ffffff', atk.crit ? 22 : 16, 1.4);
  if (atk.crit) {
    floatText('¡CRÍTICO!', e.x, e.y - e.h * 0.25 - 28, '#ff3050', 14, 1.4);
    AudioManager.sfx('crit');
    Game.stats.crits++;
  }
  if (atk.plasma) flash('#b04aff', 0.35);
  AudioManager.sfx('enemyHit');
  if (e.def.isBoss) e.talk = 0.5;
  UI.updateEnemy(e);
}

// ---------- Daño al jugador ----------
function hurtPlayer(dmg) {
  const p = Game.player;
  if (!p || p.invuln > 0 || p.dead) return;
  if (p.shield > 0) {
    p.shield--;
    p.invuln = 0.6;
    AudioManager.sfx('shieldHit');
    spawnParticles(p.x, p.y, 12, ['#29e3ff', '#ffffff'], 110, 0.4, 2);
    floatText('¡BLOQUEADO!', p.x, p.y - 26, '#29e3ff', 9, 0.9);
    UI.updatePlayer();
    return;
  }
  p.hp -= dmg;
  Game.stats.damageTaken += dmg;
  p.invuln = 1.0;
  shake(7);
  flash('#ff2a3a', 0.22);
  AudioManager.sfx('hit');
  floatText('-' + dmg, p.x + 18, p.y - 18, '#ff3050', 11, 0.8);
  if (p.hp <= 0) {
    p.hp = 0;
    UI.updatePlayer();
    playerDeath();
    return;
  }
  UI.updatePlayer();
}

function playerDeath() {
  const p = Game.player;
  p.dead = true;
  Scheduler.clear();
  fadeAllBullets();
  UI.hideBattleUI();
  Battle.phase = 'dead';
  Battle.bar = null;
  AudioManager.stop();
  Scheduler.start((function* deathSequence() {
    Battle.deathStage = 1;
    explosion(p.x, p.y, 1.2);
    yield 1.0;
    Battle.deathStage = 2;
    AudioManager.sfx('heartBreak');
    yield 0.9;
    Battle.deathStage = 3;
    spawnParticles(p.x, p.y, 10, ['#ff2a3a', '#a01020'], 150, 1.5, 3);
    yield 1.4;
    changeState(STATE_GAMEOVER);
  })(), 'death');
}

/* ---------------------------------------------------------------------
   13. FLUJOS DE COMBATE (corrutinas)
   --------------------------------------------------------------------- */
function* flightPhase(duration, capsules, title) {
  Battle.phase = 'flight';
  Battle.arenaTarget = 0;
  Stars.warpTarget = 1;
  UI.log('');
  AudioManager.sfx('warp');
  if (title) caption(title, '#ffe040', 2.6);
  for (let i = 0; i < capsules; i++) {
    yield 0.4 + i * 0.7;
    spawnCapsule(randomDrop(), rand(70, 410), -14, { vy: rand(115, 135), vx: rand(-30, 30) });
  }
  yield Math.max(0.5, duration - capsules * 1.1);
  Stars.warpTarget = 0;
}

function* levelFlow(retry) {
  if (retry) yield* flightPhase(1.6, 0, '¡NO TE RINDAS!');
  else yield* flightPhase(4.5, 2, 'SECTOR 1: NEBULOSA DEL INFIERNO');
  while (Game.enemyIndex < ENEMIES.length) {
    saveCheckpoint(false);
    yield* fight(ENEMIES[Game.enemyIndex]);
    Game.enemyIndex++;
    if (Game.enemyIndex < ENEMIES.length) yield* flightPhase(4.4, 1, '¡NAVE ENEMIGA DETECTADA!');
    else yield* flightPhase(3.6, 1, 'SECTOR DESPEJADO...');
  }
  changeState(STATE_BOSS_ALERT);
}

function* fight(def) {
  spawnEnemy(def);
  UI.setEnemy(Game.enemy);
  Battle.phase = 'enemyEnter';
  Battle.arenaTarget = 1;
  Battle.turnIndex = 0;
  Game.diff = 1;
  yield () => Game.enemy.arrived;
  UI.log(def.intro);
  if (def.isBoss) Game.enemy.talk = 2.2;
  yield 2.0;
  if (def.firstStrike) yield* enemyTurn();
  while (true) {
    yield* playerTurn();
    if (Game.enemy.hp <= 0) {
      yield* (def.isBoss ? bossDeath() : enemyDeath());
      return;
    }
    yield* enemyTurn();
  }
}

function* playerTurn() {
  const e = Game.enemy, def = e.def;
  Battle.phase = 'playerMenu';
  Battle.choice = null;
  let text = choose(def.flavor);
  if (def.isBoss && e.hp < e.maxHp * 0.5 && !e.rageAnnounced) { e.rageAnnounced = true; text = def.rageText; }
  if (def.isBoss && e.hp < e.maxHp * 0.3 && !e.desperationUsed) text = def.desperateText;
  if (def.isBoss && text.includes('NÉMESIS:')) e.talk = 2.0;
  UI.log(text);
  UI.positionFloatMenu(Game.player.x, Game.player.y);
  UI.showFloatMenu(true);
  while (true) {
    yield () => Battle.choice !== null;
    const c = Battle.choice;
    Battle.choice = null;
    if (c === 'attack') {
      UI.showFloatMenu(false);
      UI.log('');
      yield* attackSequence();
      return;
    }
    if (c === 'item') {
      if (!Game.player.inventory.length) {
        AudioManager.sfx('error');
        UI.log('* No tienes objetos. ¡Recoge las cápsulas que sueltan los enemigos!');
        continue;
      }
      UI.showFloatMenu(false);
      UI.openItemMenu();
      Battle.phase = 'itemMenu';
      Battle.itemChoice = null;
      yield () => Battle.itemChoice !== null;
      const key = Battle.itemChoice;
      Battle.itemChoice = null;
      UI.closeItemMenu();
      if (key === 'cancel') {
        Battle.phase = 'playerMenu';
        UI.showFloatMenu(true);
        UI.log(text);
        continue;
      }
      Battle.phase = 'usingItem';
      useItem(key);
      yield 1.8;
      return;
    }
  }
}

function* attackSequence() {
  const e = Game.enemy;
  Battle.phase = 'attackBar';
  Battle.bar = { pos: 0, speed: e.def.isBoss ? 1.05 : 0.85, stopped: false, result: null };
  yield () => Battle.bar.stopped || Battle.bar.pos >= 1;
  const bar = Battle.bar;
  let mult = 0, crit = false;
  if (bar.stopped) {
    const d = Math.abs(bar.pos - 0.5) * 2;
    if (d < 0.07) { mult = 2.2; crit = true; } else mult = Math.max(0.35, 1.55 - 1.2 * d);
  }
  bar.pos = Math.min(bar.pos, 1);
  bar.result = crit ? 'crit' : bar.stopped ? 'hit' : 'miss';
  yield 0.4;
  Battle.phase = 'shooting';
  if (!bar.stopped) {
    AudioManager.sfx('miss');
    floatText('¡FALLASTE!', e.x, e.y, '#aaaaaa', 14, 1.2);
    yield 1.0;
    Battle.bar = null;
    return;
  }
  const atk = computeAttack(mult, crit);
  firePlayerAttack(atk);
  Battle.bar = null;
  yield () => World.shots.length === 0;
  damageEnemy(atk);
  yield 1.1;
}

function* capsuleDuringTurn(dur) {
  yield rand(1, Math.max(1.2, dur - 2.5));
  spawnCapsule(randomDrop(), rand(ARENA.x + 30, ARENA.x + ARENA.w - 30), ARENA.y - 16, { vy: 55, vx: rand(-20, 20) });
}

function* enemyTurn() {
  const e = Game.enemy;
  Battle.phase = 'enemyTurnStart';
  UI.log('');
  Battle.arenaTarget = 1;
  yield 0.45;
  Battle.phase = 'enemyTurn';
  const turn = e.def.turn(Battle.turnIndex, e);
  Battle.turnIndex++;
  if (Math.random() < 0.32) Scheduler.start(capsuleDuringTurn(turn.dur), 'pattern');
  turn.gens.forEach((g) => Scheduler.start(g, 'pattern'));
  yield turn.dur;
  Scheduler.clear('pattern');
  fadeAllBullets();
  if (Game.player.shield > 0) { Game.player.shield = 0; UI.updatePlayer(); }
  Battle.phase = 'enemyTurnEnd';
  yield 0.5;
}

function* enemyDeath() {
  const e = Game.enemy;
  Battle.phase = 'enemyDeath';
  UI.log('');
  e.dying = 1;
  for (let i = 0; i < 7; i++) {
    explosion(e.x + rand(-e.w / 2.5, e.w / 2.5), e.y + rand(-e.h / 2.5, e.h / 2.5), 0.8);
    shake(5);
    yield 0.12;
  }
  explosion(e.x, e.y, 1.7);
  flash('#ffffff', 0.5);
  shake(10);
  e.visible = false;
  e.dead = true;
  UI.hideEnemy();
  spawnCapsule(e.def.guaranteed, e.x - 26, e.y, { vx: -28, vy: 62 });
  spawnCapsule(randomDrop(), e.x + 26, e.y, { vx: 28, vy: 62 });
  const p = Game.player;
  p.lv++;
  p.maxHp += 10;
  p.hp = Math.min(p.maxHp, p.hp + 10);
  Game.stats.kills++;
  AudioManager.sfx('levelUp');
  UI.updatePlayer();
  UI.log(`* ¡${e.def.name} destruido! Tu LV subió a ${p.lv}. ¡Recoge las cápsulas!`);
  yield 2.2;
  Game.enemy = null;
}

function* bossAlertFlow() {
  UI.showAlert(true);
  for (let i = 0; i < 3; i++) {
    AudioManager.sfx('siren');
    flash('#ff0000', 0.28);
    shake(3);
    yield 1.25;
  }
  UI.showAlert(false);
  Dialog.start(ALERT_LINES, { urgent: true });
  yield () => Dialog.done;
  changeState(STATE_BOSS);
}

function* bossFlow(retry) {
  saveCheckpoint(true);
  if (!retry) AudioManager.sfx('rumble');
  yield* fight(BOSS);
  changeState(STATE_VICTORY);
}

function* bossDeath() {
  const e = Game.enemy;
  Battle.phase = 'enemyDeath';
  UI.hideBattleUI();
  AudioManager.stop();
  e.dying = 1;
  caption('¡NÉMESIS SE DESINTEGRA!', '#ffe040', 3.2);
  for (let i = 0; i < 26; i++) {
    explosion(e.x + rand(-e.w / 2.2, e.w / 2.2), e.y + rand(-e.h / 2.2, e.h / 2.2), rand(0.7, 1.5), i % 2 === 1);
    shake(8);
    if (i % 5 === 0) flash('#ffffff', 0.35);
    yield 0.13;
  }
  AudioManager.sfx('bigExplosion');
  flash('#ffffff', 1.2);
  shake(24);
  for (let k = 0; k < 4; k++) explosion(e.x + rand(-20, 20), e.y + rand(-20, 20), 2.8, true);
  spawnParticles(e.x, e.y, 140, ['#ffffff', '#ffe040', '#ff8c1a', '#ff2a3a', '#8890a8', '#4a5068'], 330, 2.3, 4);
  e.visible = false;
  e.dead = true;
  UI.hideEnemy();
  yield 2.8;
  Game.enemy = null;
}

function* introFlow() {
  yield 0.8;
  Dialog.start(INTRO_LINES, { skippable: true });
  yield () => Dialog.done;
  changeState(STATE_LEVEL);
}

function* victoryFlow() {
  yield 1.0;
  Dialog.start(VICTORY_LINES);
  yield () => Dialog.done;
  UI.showHud(false);
  const s = Game.stats;
  UI.showVictory(true, [
    ['TIEMPO', formatTime(s.playTime)],
    ['NAVES DESTRUIDAS', s.kills + 1],
    ['GOLPES CRÍTICOS', s.crits],
    ['DAÑO RECIBIDO', s.damageTaken],
    ['OBJETOS USADOS', s.itemsUsed],
    ['REINTENTOS', s.retries],
    ['NIVEL FINAL', 'LV ' + Game.player.lv],
  ]);
}

/* ---------------------------------------------------------------------
   14. MÁQUINA DE ESTADOS
   --------------------------------------------------------------------- */
function changeState(next, opts = {}) {
  Scheduler.clear();
  if (Dialog.active) Dialog.finish();
  Game.state = next;
  Game.stateTime = 0;
  UI.showMainMenu(false);
  UI.showGameOver(false);
  UI.show(UI.el.victoryScreen, false);
  UI.showAlert(false);
  UI.setNav([]);

  switch (next) {
    case STATE_MENU:
      Game.enemy = null;
      Game.diff = 1;
      clearWorld();
      resetBattle();
      Battle.arenaA = 0;
      Battle.arenaTarget = 0;
      Stars.warpTarget = 0;
      UI.showHud(false);
      UI.hideBattleUI();
      UI.hideEnemy();
      UI.showMainMenu(true);
      AudioManager.play('menu');
      break;

    case STATE_INTRO:
      clearWorld();
      resetBattle();
      Stars.warpTarget = 0.55;
      UI.showHud(false);
      AudioManager.play('menu');
      Scheduler.start(introFlow());
      break;

    case STATE_LEVEL:
      clearWorld();
      resetBattle();
      Game.enemy = null;
      Game.diff = 1;
      UI.hideEnemy();
      UI.hideBattleUI();
      UI.showHud(true);
      UI.updatePlayer();
      AudioManager.play('level');
      Scheduler.start(levelFlow(!!opts.retry));
      break;

    case STATE_BOSS_ALERT:
      AudioManager.stop();
      UI.hideBattleUI();
      UI.hideEnemy();
      UI.showHud(true);
      UI.updatePlayer();
      Battle.phase = 'alert';
      Battle.arenaTarget = 0;
      Stars.warpTarget = 0;
      Scheduler.start(bossAlertFlow());
      break;

    case STATE_BOSS:
      if (opts.retry) clearWorld();
      resetBattle();
      Game.enemy = null;
      Game.diff = 1;
      UI.hideBattleUI();
      UI.showHud(true);
      UI.updatePlayer();
      AudioManager.play('boss');
      Scheduler.start(bossFlow(!!opts.retry));
      break;

    case STATE_VICTORY:
      UI.hideBattleUI();
      UI.hideEnemy();
      Battle.phase = 'victory';
      Battle.arenaTarget = 0;
      Stars.warpTarget = 0.25;
      Game.diff = 1;
      AudioManager.play('menu');
      Scheduler.start(victoryFlow());
      break;

    case STATE_GAMEOVER:
      UI.hideBattleUI();
      UI.hideEnemy();
      UI.showHud(false);
      Battle.phase = 'gameover';
      Battle.arenaTarget = 0;
      UI.showGameOver(true);
      break;

    default: break;
  }
}

function startNewGame() {
  Game.player = createPlayer();
  Game.enemyIndex = 0;
  Game.checkpoint = null;
  Game.stats = { playTime: 0, damageTaken: 0, crits: 0, itemsUsed: 0, retries: 0, kills: 0 };
  changeState(STATE_INTRO);
}

function retryFromCheckpoint() {
  const cp = Game.checkpoint;
  if (!cp) { startNewGame(); return; }
  Game.player = clonePlayer(cp.player);
  Game.player.hp = Game.player.maxHp;
  Game.player.x = HOME.x;
  Game.player.y = H + 30;
  Game.enemyIndex = cp.enemyIndex;
  Game.stats.retries++;
  Game.enemy = null;
  clearWorld();
  changeState(cp.boss ? STATE_BOSS : STATE_LEVEL, { retry: true });
}

function onFirstInteraction() {
  if (AudioManager.unlocked) {
    if (AudioManager.ctx && AudioManager.ctx.state === 'suspended') AudioManager.ctx.resume();
    return;
  }
  AudioManager.unlock();
  if (UI.ready) UI.show(UI.el.audioHint, false);
}

/* ---------------------------------------------------------------------
   15. ACTUALIZACIÓN (delta time)
   --------------------------------------------------------------------- */
const FREE_ARENA = new Set(['enemyTurn', 'enemyTurnStart', 'enemyTurnEnd', 'enemyEnter']);
const FREE_FLIGHT = new Set(['flight', 'enemyDeath']);
const BATTLE_STATES = new Set([STATE_LEVEL, STATE_BOSS_ALERT, STATE_BOSS, STATE_VICTORY, STATE_GAMEOVER]);

function updateBattleInput(dt) {
  if (Battle.phase === 'playerMenu') {
    if (Input.left || Input.right) {
      UI.setFloatSel(UI.floatSel + (Input.left ? -1 : 1));
      AudioManager.sfx('select');
    }
    if (Input.confirm) {
      Battle.choice = UI.floatSel === 0 ? 'attack' : 'item';
      AudioManager.sfx('confirm');
    }
  } else if (Battle.phase === 'itemMenu') {
    if (Input.up) UI.moveItemSel(-1);
    if (Input.downP) UI.moveItemSel(1);
    if (Input.confirm && UI.itemKeys.length) {
      Battle.itemChoice = UI.itemKeys[UI.itemSel];
      AudioManager.sfx('confirm');
    } else if (Input.cancel) {
      Battle.itemChoice = 'cancel';
      AudioManager.sfx('cancel');
    }
  } else if (Battle.phase === 'attackBar' && Battle.bar && !Battle.bar.stopped) {
    Battle.bar.pos += Battle.bar.speed * dt;
    if (Input.confirm || Input.tapped) {
      Battle.bar.stopped = true;
      AudioManager.sfx('confirm');
    }
  }
}

function updatePlayerEntity(dt) {
  const p = Game.player;
  if (!p) return;
  p.flameT += dt;
  if (p.dead) return;
  p.invuln = Math.max(0, p.invuln - dt);
  const px = p.x, py = p.y;
  if (Game.state === STATE_INTRO) {
    p.x = lerp(p.x, HOME.x, Math.min(1, dt * 2));
    p.y = lerp(p.y, 400, Math.min(1, dt * 1.2));
  } else if (Game.state === STATE_VICTORY) {
    p.x = lerp(p.x, 240 + Math.sin(Game.time * 1.3) * 30, Math.min(1, dt * 2));
    p.y = lerp(p.y, 420 + Math.sin(Game.time * 2) * 8, Math.min(1, dt * 2));
  } else if (FREE_ARENA.has(Battle.phase) || FREE_FLIGHT.has(Battle.phase)) {
    const z = FREE_FLIGHT.has(Battle.phase) ? FLIGHT_ZONE : ARENA;
    const a = Input.axis();
    const sp = Input.slow ? 95 : 205;
    p.x += a.x * sp * dt + Input.pointer.dx;
    p.y += a.y * sp * dt + Input.pointer.dy;
    const m = 9;
    p.x = clamp(p.x, z.x + m, z.x + z.w - m);
    p.y = clamp(p.y, z.y + m, z.y + z.h - m);
  } else {
    p.x = lerp(p.x, HOME.x, Math.min(1, dt * 6));
    p.y = lerp(p.y, HOME.y, Math.min(1, dt * 6));
  }
  p.moving = Math.hypot(p.x - px, p.y - py) > 0.15;
  if (Battle.phase === 'playerMenu') UI.positionFloatMenu(p.x, p.y);
}

function updateEnemyEntity(dt) {
  const e = Game.enemy;
  if (!e) return;
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  e.talk = Math.max(0, e.talk - dt);
  e.swayT += dt;
  if (!e.arrived) {
    e.baseY = lerp(e.baseY, e.targetY, Math.min(1, dt * (e.def.isBoss ? 0.9 : 2.6)));
    if (e.def.isBoss) Game.shake = Math.max(Game.shake, 3);
    if (Math.abs(e.baseY - e.targetY) < 1.5) {
      e.baseY = e.targetY;
      e.arrived = true;
      if (e.def.isBoss) { shake(12); AudioManager.sfx('explosion'); }
    }
  }
  e.y = e.baseY + Math.sin(e.swayT * 2) * (e.def.isBoss ? 3 : 5);
  const tx = Battle.phase === 'enemyTurn' && !e.def.isBoss ? 240 + Math.sin(e.swayT * 0.9) * 70 : 240;
  e.x = lerp(e.x, tx, Math.min(1, dt * 2));
  let target = e.mouthTarget;
  if (e.dying) target = 1;
  else if (e.talk > 0) target = 0.45 + 0.45 * Math.sin(Game.time * 20);
  e.mouthOpen = lerp(e.mouthOpen, target, Math.min(1, dt * 12));
  e.mouthTarget = 0;
}

function updateWorld(dt) {
  const p = Game.player;
  const canHurt = p && !p.dead && (Game.state === STATE_LEVEL || Game.state === STATE_BOSS);

  // Proyectiles
  for (const b of World.bullets) {
    if (b.fade > 0) {
      b.fade -= dt;
      if (b.fade <= 0) b.dead = true;
      continue;
    }
    b.life += dt;
    if (b.accel || b.curve) {
      b.speed = Math.max(20, b.speed + b.accel * dt);
      b.ang += b.curve * dt;
      b.vx = Math.cos(b.ang) * b.speed;
      b.vy = Math.sin(b.ang) * b.speed;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.waveX = b.wave ? Math.sin(b.life * b.wave.freq + b.wave.phase) * b.wave.amp : 0;
    if (b.x < -70 || b.x > W + 70 || b.y < -130 || b.y > H + 40) b.dead = true;
    else if (canHurt && dist(b.x + b.waveX, b.y, p.x, p.y) < b.r + HEART_RADIUS) {
      b.dead = true;
      hurtPlayer(b.dmg);
      spawnParticles(b.x, b.y, 5, [BULLET_COLORS[b.color] || '#fff', '#ffffff'], 70, 0.3, 2);
    }
  }
  World.bullets = World.bullets.filter((b) => !b.dead);

  // Rayos de la boca del jefe
  for (const bm of World.beams) {
    bm.t += dt;
    const o = bm.originFn();
    bm.ox = o.x;
    bm.oy = o.y;
    if (bm.phase === 'warn' && bm.t >= bm.warn) {
      bm.phase = 'fire';
      bm.t = 0;
      AudioManager.sfx('blast');
      shake(5);
    } else if (bm.phase === 'fire') {
      if (bm.type === 'sweep') bm.ang = lerp(bm.from, bm.to, easeInOut(clamp(bm.t / bm.fire, 0, 1)));
      if (bm.t >= bm.fire) { bm.phase = 'fade'; bm.t = 0; }
    } else if (bm.phase === 'fade' && bm.t >= 0.25) {
      bm.dead = true;
    }
    if (Game.enemy && bm.phase !== 'fade') Game.enemy.mouthTarget = 1;
    if (bm.phase === 'fire' && canHurt) {
      const x2 = bm.ox + Math.cos(bm.ang) * 1100;
      const y2 = bm.oy + Math.sin(bm.ang) * 1100;
      if (segDist(p.x, p.y, bm.ox, bm.oy, x2, y2) < bm.width / 2 - 3) {
        const safe = (bm.color === 'blue' && !p.moving) || (bm.color === 'orange' && p.moving);
        if (!safe) hurtPlayer(bm.dmg);
      }
    }
  }
  World.beams = World.beams.filter((b) => !b.dead);

  // Gaster Blasters
  for (const bl of World.blasters) {
    bl.t += dt;
    if (bl.phase === 'enter') {
      const k = easeOutCubic(Math.min(1, bl.t / bl.enter));
      bl.x = lerp(bl.sx, bl.tx, k);
      bl.y = lerp(bl.sy, bl.ty, k);
      if (bl.t >= bl.enter) { bl.phase = 'charge'; bl.t = 0; AudioManager.sfx('charge', bl.charge); }
    } else if (bl.phase === 'charge') {
      if (bl.t >= bl.charge) { bl.phase = 'fire'; bl.t = 0; AudioManager.sfx('blast'); shake(4); }
    } else if (bl.phase === 'fire') {
      if (bl.t >= bl.fire) { bl.phase = 'fade'; bl.t = 0; }
    } else if (bl.phase === 'fade') {
      bl.x -= Math.cos(bl.ang) * 240 * dt;
      bl.y -= Math.sin(bl.ang) * 240 * dt;
      if (bl.t >= 0.45) bl.dead = true;
    }
    if (bl.phase === 'fire' && canHurt) {
      const m = blasterMouth(bl);
      const x2 = m.x + Math.cos(bl.ang) * 1100;
      const y2 = m.y + Math.sin(bl.ang) * 1100;
      if (segDist(p.x, p.y, m.x, m.y, x2, y2) < bl.width / 2 - 3) hurtPlayer(bl.dmg);
    }
  }
  World.blasters = World.blasters.filter((b) => !b.dead);

  // Cápsulas (con imán cercano)
  for (const c of World.capsules) {
    c.t += dt;
    if (p && !p.dead) {
      const d = dist(c.x, c.y, p.x, p.y);
      if (d < 80) {
        c.x = lerp(c.x, p.x, Math.min(1, dt * 4));
        c.y = lerp(c.y, p.y, Math.min(1, dt * 4));
      }
      if (d < 20 && BATTLE_STATES.has(Game.state) && Game.state !== STATE_GAMEOVER) {
        c.dead = true;
        collectItem(c.type);
        continue;
      }
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.vx *= 0.99;
    if (c.x < 12 || c.x > W - 12) { c.vx *= -1; c.x = clamp(c.x, 12, W - 12); }
    if (c.y > H + 20) c.dead = true;
  }
  World.capsules = World.capsules.filter((c) => !c.dead);

  // Disparos del jugador (animación de ataque)
  for (const s of World.shots) {
    s.t += dt;
    if (s.t < 0) continue;
    if (!s.started) {
      s.started = true;
      AudioManager.sfx(s.kind === 'laser' ? 'laser' : s.kind);
    }
    const k = clamp(s.t / s.dur, 0, 1);
    if (s.kind === 'missile') {
      const u = 1 - k;
      const nx = u * u * s.sx + 2 * u * k * s.cx + k * k * s.tx;
      const ny = u * u * s.sy + 2 * u * k * s.cy + k * k * s.ty;
      s.ang = Math.atan2(ny - s.y, nx - s.x);
      s.x = nx;
      s.y = ny;
      World.particles.push({ x: s.x, y: s.y, vx: rand(-15, 15), vy: rand(-15, 15), life: 0.35, max: 0.35, color: choose(['#ff8c1a', '#ffe040', '#8890a8']), size: 2 });
    } else {
      const kk = s.kind === 'plasma' ? k * k : k;
      s.x = lerp(s.sx, s.tx, kk);
      s.y = lerp(s.sy, s.ty, kk);
    }
    if (k >= 1) {
      s.dead = true;
      if (Game.enemy) Game.enemy.hitFlash = 0.12;
      if (s.kind === 'laser') {
        spawnParticles(s.x, s.y, 6, [s.color, '#ffffff'], 90, 0.35, 2);
        AudioManager.sfx('enemyHit');
        shake(2);
      } else {
        explosion(s.x, s.y, s.kind === 'plasma' ? 1.8 : 0.8);
      }
    }
  }
  World.shots = World.shots.filter((s) => !s.dead);

  // Partículas, ondas y textos
  for (const pt of World.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.97;
    pt.vy *= 0.97;
    pt.life -= dt;
  }
  World.particles = World.particles.filter((pt) => pt.life > 0);
  for (const r of World.rings) r.t += dt;
  World.rings = World.rings.filter((r) => r.t < r.life);
  for (const tx of World.texts) {
    tx.y += tx.vy * dt;
    tx.vy *= 0.96;
    tx.life -= dt;
  }
  World.texts = World.texts.filter((tx) => tx.life > 0);
}

function update(dt) {
  Game.time += dt;
  Game.stateTime += dt;
  if (Input.wasPressed('KeyM')) AudioManager.toggleMute();

  Stars.update(dt);
  Scheduler.update(dt);
  Dialog.update(dt);
  UI.updateLog(dt);

  switch (Game.state) {
    case STATE_MENU:
    case STATE_GAMEOVER:
      UI.navUpdate();
      break;
    case STATE_VICTORY:
      if (!UI.el.victoryScreen.classList.contains('hidden')) UI.navUpdate();
      Battle.fwT -= dt;
      if (Battle.fwT <= 0) {
        Battle.fwT = rand(0.35, 0.8);
        const colors = choose([['#ff2a3a', '#ffe040'], ['#29e3ff', '#ffffff'], ['#b04aff', '#ff60c0'], ['#36e070', '#ffe040']]);
        spawnParticles(rand(60, 420), rand(70, 300), 34, colors, 170, 1.3, 2);
      }
      break;
    default:
      break;
  }

  if (Game.state === STATE_LEVEL || Game.state === STATE_BOSS) {
    updateBattleInput(dt);
    Game.stats.playTime += dt;
  }
  updatePlayerEntity(dt);
  updateWorld(dt);
  updateEnemyEntity(dt);

  Battle.arenaA = lerp(Battle.arenaA, Battle.arenaTarget, Math.min(1, dt * 6));
  if (Battle.caption) {
    Battle.caption.t -= dt;
    if (Battle.caption.t <= 0) Battle.caption = null;
  }
  Game.shake = Math.max(0, Game.shake - dt * 30);
  Game.flash = Math.max(0, Game.flash - dt * 2.5);
  Input.endFrame();
}

/* ---------------------------------------------------------------------
   16. RENDERIZADO
   --------------------------------------------------------------------- */
function strokePixelRect(x, y, w, h, t, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x - t, y - t, w + t * 2, t);
  ctx.fillRect(x - t, y + h, w + t * 2, t);
  ctx.fillRect(x - t, y, t, h);
  ctx.fillRect(x + w, y, t, h);
}

function drawBeamRect(x, y, ang, len, width, colorKey) {
  const c = BEAM_COLORS[colorKey] || BEAM_COLORS.red;
  const core = colorKey === 'white' ? 0.5 : 0.22;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = c.glow;
  ctx.fillRect(0, -width * 0.85, len, width * 1.7);
  ctx.fillStyle = c.edge;
  ctx.fillRect(0, -width / 2, len, width);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, -width * core / 2, len, width * core);
  ctx.restore();
}

function glowCircle(x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function renderMenu() {
  const t = Game.time;
  drawPixelLogo(240, 78, 8, t);
  drawText("SHOOT 'EM UP  x  RPG POR TURNOS", 240, 136, 8, '#29e3ff');
  const glow = Math.floor(t * 2) % 2 ? '#ff60c0' : '#29e3ff';
  drawText('CREADO POR SANTIAGO COLMENARES', 240, 164, 10, '#ffe040', 'center', glow);
  drawSprite(SPR.enemy2, 58 + Math.sin(t * 0.7) * 18, 206 + Math.sin(t * 1.4) * 6, 2, 0.55);
  drawSprite(SPR.enemy1, 422 + Math.sin(t * 0.8 + 1) * 18, 208 + Math.sin(t * 1.2) * 6, 2, 0.55);
  const y = 600 + Math.sin(t * 2.2) * 4;
  drawSprite(SPR.player[Math.floor(t * 12) % 2], 240, y, 2);
  drawSprite(SPR.heart, 240, y + 1, 1);
}

function renderIntro() {
  drawText('OPERACIÓN GALAXHELL', 240, 70, 14, '#ffe040', 'center', '#ff8c1a');
  if (Math.floor(Game.time * 2.5) % 2 === 0) drawText('>> TRANSMISIÓN ENTRANTE <<', 240, 104, 9, '#36e070');
  if (Game.player) renderPlayer(Game.player);
}

function renderArena() {
  const a = Battle.arenaA;
  if (a < 0.02) return;
  ctx.globalAlpha = a * 0.6;
  ctx.fillStyle = '#000000';
  ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
  ctx.globalAlpha = a;
  strokePixelRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h, 4, '#ffffff');
  ctx.globalAlpha = 1;
}

function renderEnemy(e) {
  const white = e.hitFlash > 0 && Math.floor(Game.time * 30) % 2 === 0;
  const img = white ? SPR[e.def.sprite + 'White'] : SPR[e.def.sprite];
  let x = e.x, y = e.y;
  if (e.dying) { x += rand(-3, 3); y += rand(-3, 3); }
  ctx.fillStyle = Math.floor(Game.time * 20) % 2 ? '#ff8c1a' : '#ffe040';
  ctx.fillRect(Math.round(e.x - 7), Math.round(e.y - e.h / 2 - 6), 4, 6);
  ctx.fillRect(Math.round(e.x + 3), Math.round(e.y - e.h / 2 - 6), 4, 6);
  drawSprite(img, x, y, e.def.scale);
}

function renderBoss(e) {
  const frame = Math.min(3, Math.round(e.mouthOpen * 3));
  let x = e.x, y = e.y;
  if (e.dying) { x += rand(-4, 4); y += rand(-4, 4); }
  glowCircle(x, y, 150, '255,30,70', 0.16 + Math.sin(Game.time * 2) * 0.04);
  const white = e.hitFlash > 0 && Math.floor(Game.time * 30) % 2 === 0;
  drawSprite(white ? SPR.bossWhite[frame] : SPR.boss[frame], x, y, BOSS_SCALE);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.35 + Math.sin(Game.time * 5) * 0.15;
  [20.5, 42.5].forEach((gx) => glowCircle(x + (gx + 0.5 - 32) * BOSS_SCALE, y + (24 - 32) * BOSS_SCALE, 20, '255,40,40', pulse));
  glowCircle(x, y + 28 + e.mouthOpen * 10, 34 + e.mouthOpen * 26, '255,150,40', 0.18 + e.mouthOpen * 0.35);
  ctx.restore();
}

function renderCapsules() {
  for (const c of World.capsules) {
    const bob = Math.sin(c.t * 4) * 2;
    ctx.globalAlpha = 0.35 + Math.sin(c.t * 6) * 0.2;
    ctx.fillStyle = ITEMS[c.type].color;
    ctx.beginPath();
    ctx.arc(c.x, c.y + bob, 15, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    drawSprite(SPR.capsules[c.type], c.x, c.y + bob, 2);
  }
}

function renderBeams() {
  for (const bm of World.beams) {
    const c = BEAM_COLORS[bm.color] || BEAM_COLORS.red;
    if (bm.phase === 'warn') {
      ctx.save();
      ctx.translate(bm.ox, bm.oy);
      ctx.rotate(bm.ang);
      ctx.globalAlpha = Math.floor(bm.t * 14) % 2 ? 0.9 : 0.35;
      ctx.fillStyle = c.edge;
      ctx.fillRect(0, -1, 1100, 2);
      ctx.restore();
      glowCircle(bm.ox, bm.oy, 10 + (bm.t / bm.warn) * 18, '255,220,160', 0.6);
    } else {
      const w = bm.phase === 'fire' ? bm.width * (1 + Math.sin(Game.time * 60) * 0.06) : bm.width * (1 - bm.t / 0.25);
      drawBeamRect(bm.ox, bm.oy, bm.ang, 1100, Math.max(0, w), bm.color);
      glowCircle(bm.ox, bm.oy, 30, '255,255,255', 0.6);
    }
  }
}

function renderBlasters() {
  for (const bl of World.blasters) {
    const m = blasterMouth(bl);
    if (bl.phase === 'charge') {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(bl.ang);
      ctx.globalAlpha = Math.floor(bl.t * 16) % 2 ? 0.7 : 0.25;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, -1, 1100, 2);
      ctx.restore();
      glowCircle(m.x, m.y, 4 + (bl.t / bl.charge) * 16, '160,240,255', 0.8);
    } else if (bl.phase === 'fire' || (bl.phase === 'fade' && bl.t < 0.25)) {
      const w = bl.phase === 'fire' ? bl.width * (1 + Math.sin(Game.time * 60) * 0.08) : bl.width * (1 - bl.t / 0.25);
      drawBeamRect(m.x, m.y, bl.ang, 1100, Math.max(0, w), 'white');
    }
    const flashW = bl.phase === 'charge' && bl.t > bl.charge - 0.15 && Math.floor(Game.time * 30) % 2 === 0;
    const alpha = bl.phase === 'fade' ? clamp(1 - bl.t / 0.45, 0, 1) : 1;
    drawSpriteRot(flashW ? SPR.blasterWhite : SPR.blaster, bl.x, bl.y, bl.scale, bl.ang - Math.PI / 2, alpha);
  }
}

function renderBullets() {
  for (const b of World.bullets) {
    const img = getBulletSprite(b.kind, b.color);
    const s = b.scale > 1 ? 3 : 2;
    const alpha = b.fade > 0 ? clamp(b.fade / 0.35, 0, 1) : 1;
    const x = b.x + b.waveX;
    if (b.kind === 'needle') drawSpriteRot(img, x, b.y, s, Math.atan2(b.vy, b.vx) - Math.PI / 2, alpha);
    else drawSprite(img, x, b.y, s, alpha);
  }
}

function renderShots() {
  for (const s of World.shots) {
    if (s.t < 0) continue;
    if (s.kind === 'laser') {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(angleTo(s.sx, s.sy, s.tx, s.ty));
      ctx.fillStyle = s.color;
      ctx.fillRect(-18, -2, 18, 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-15, -1, 13, 2);
      ctx.restore();
    } else if (s.kind === 'missile') {
      drawSpriteRot(SPR.missile, s.x, s.y, 2, s.ang + Math.PI / 2);
    } else {
      const k = clamp(s.t / s.dur, 0, 1);
      glowCircle(s.x, s.y, 22 + k * 14, '190,80,255', 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(s.x - 5), Math.round(s.y - 5), 10, 10);
    }
  }
}

function renderPlayer(p) {
  if (p.dead) {
    if (Battle.deathStage === 1) drawSprite(SPR.heart, p.x, p.y, 2);
    else if (Battle.deathStage === 2) {
      drawSprite(SPR.heartL, p.x - 6, p.y, 2);
      drawSprite(SPR.heartR, p.x + 6, p.y, 2);
    }
    return;
  }
  const soul = (Game.state === STATE_LEVEL || Game.state === STATE_BOSS) && Battle.phase.startsWith('enemyTurn');
  const blink = p.invuln > 0 && Math.floor(Game.time * 20) % 2 === 0;
  if (!blink) drawSprite(SPR.player[Math.floor(p.flameT * 12) % 2], p.x, p.y, 2, soul ? 0.5 : 1);
  glowCircle(p.x, p.y + 1, soul ? 12 : 8, '255,42,58', 0.45);
  drawSprite(blink ? SPR.heartWhite : SPR.heart, p.x, p.y + 1, 1);
  if (p.shield > 0) {
    ctx.strokeStyle = `rgba(41,227,255,${0.5 + Math.sin(Game.time * 8) * 0.25})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 17, 0, TAU);
    ctx.stroke();
  }
}

function renderAttackBar() {
  const bar = Battle.bar;
  const x = 60, y = 392, w = 360, h = 56;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, h);
  const bands = [[1.0, '#5a1020'], [0.75, '#a01020'], [0.5, '#ff8c1a'], [0.28, '#ffe040'], [0.07, '#36e070']];
  for (const [f, c] of bands) {
    const bw = w * f;
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(x + (w - bw) / 2), y + 6, Math.round(bw), h - 12);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < w; i += 6) ctx.fillRect(x + i, y + 6, 2, h - 12);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + w / 2 - 1, y + 2, 2, h - 4);
  strokePixelRect(x, y, w, h, 3, '#ffffff');
  const cx = Math.round(x + clamp(bar.pos, 0, 1) * w);
  const blink = bar.stopped && Math.floor(Game.time * 16) % 2 === 0;
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - 5, y - 7, 10, h + 14);
  ctx.fillStyle = blink ? '#ffe040' : '#ffffff';
  ctx.fillRect(cx - 3, y - 5, 6, h + 10);
  if (bar.result === 'crit') drawText('¡CRÍTICO!', 240, y - 20, 12, '#ffe040', 'center', '#ff8c1a');
  else if (bar.result === 'hit') drawText('¡IMPACTO!', 240, y - 20, 10, '#ffffff');
  else if (bar.result === 'miss') drawText('FALLO', 240, y - 20, 10, '#888888');
  else drawText('Z / ESPACIO: ¡DISPARA!', 240, y + h + 20, 8, '#c8d0e0');
}

function renderCaption() {
  const c = Battle.caption;
  if (!c) return;
  const visible = c.t < c.max - 0.6 || Math.floor(Game.time * 8) % 2 === 0;
  if (!visible) return;
  ctx.globalAlpha = Math.min(1, c.t / 0.4);
  ctx.save();
  ctx.font = `11px ${PIXEL_FONT}`;
  const tw = ctx.measureText(c.text).width + 24;
  ctx.restore();
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(Math.round(240 - tw / 2), 256, Math.round(tw), 24);
  ctx.fillStyle = c.color;
  ctx.fillRect(Math.round(240 - tw / 2), 256, Math.round(tw), 2);
  ctx.fillRect(Math.round(240 - tw / 2), 278, Math.round(tw), 2);
  drawText(c.text, 240, 268, 11, c.color === '#3a7bff' ? '#8ab4ff' : c.color, 'center', c.color);
  ctx.globalAlpha = 1;
}

function renderBattle() {
  const e = Game.enemy;
  renderArena();
  if (e && e.visible) {
    if (e.def.isBoss) renderBoss(e);
    else renderEnemy(e);
  }
  renderCapsules();
  renderBeams();
  renderBlasters();
  renderBullets();
  renderShots();
  if (Game.player && Game.state !== STATE_GAMEOVER) renderPlayer(Game.player);
  if (Battle.bar) renderAttackBar();
  renderCaption();
}

function renderEffects() {
  for (const r of World.rings) {
    const k = easeOutCubic(r.t / r.life);
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = '#ffe8a0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(r.x, r.y, 2 + (r.max - 2) * k, 0, TAU);
    ctx.stroke();
  }
  for (const pt of World.particles) {
    ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
  for (const tx of World.texts) {
    ctx.globalAlpha = clamp(tx.life / (tx.max * 0.5), 0, 1);
    drawText(tx.text, tx.x, tx.y, tx.size, tx.color);
  }
  ctx.globalAlpha = 1;
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#04030c';
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  if (Game.shake > 0.3) ctx.translate(Math.round(rand(-1, 1) * Game.shake), Math.round(rand(-1, 1) * Game.shake));
  Stars.draw();
  if (Game.state === STATE_MENU) renderMenu();
  else if (Game.state === STATE_INTRO) renderIntro();
  else renderBattle();
  renderEffects();
  ctx.restore();
  if (Game.state === STATE_BOSS_ALERT) {
    ctx.fillStyle = `rgba(255,0,30,${0.12 + Math.sin(Game.time * 8) * 0.08})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (Game.flash > 0) {
    ctx.globalAlpha = Math.min(1, Game.flash);
    ctx.fillStyle = Game.flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

/* ---------------------------------------------------------------------
   17. BUCLE PRINCIPAL (requestAnimationFrame + delta time) E INICIO
   --------------------------------------------------------------------- */
let lastFrame = performance.now();
function loop(now) {
  let dt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.05) dt = 0.05;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function init() {
  buildAllSprites();
  AudioManager.init();
  Stars.init();
  Input.init();
  Dialog.init();
  UI.init();
  changeState(STATE_MENU);
  requestAnimationFrame((t) => { lastFrame = t; loop(t); });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
