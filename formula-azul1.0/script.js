/* ═══════════════════════════════════════════════════════════════════════
   FÓRMULA AZUL · ESCUADRÓN DE LIMPIEZA — NIVEL 1
   script.js · PARTE 1 (Entrega 2)
   ───────────────────────────────────────────────────────────────────────
   · Gestor de audio (Web Audio API): introgame.mp3 ⇄ level1track.mp3 con
     crossfade, efectos de sonido sintetizados y paneo estéreo por jugador.
   · Red en tiempo real PC ⇄ celulares con PeerJS (WebRTC DataChannel).
   · Mando pistola: giroscopio calibrado (baseAlpha/baseBeta), recarga por
     sacudida con bloqueo de mira de 250 ms, gatillos a dos manos y
     patrones de vibración (recoil).
   · Flujo de la máquina: encendido, attract mode, sala, intro, partida,
     continuar, pausa, ajustes y récords.

   La PARTE 2 (Entrega 3) añade el motor Three.js y se conecta llamando a
   registerWorld(factory). Mientras no exista, la partida usa el «Campo de
   Tiro» 2D de este archivo para probar mandos, recarga, granadas, daño y
   botiquines de punta a punta.

   Regla de oro: este archivo NUNCA usa .style. Todo cambio visual es una
   clase CSS del contrato que está al inicio de style.css.
   ═══════════════════════════════════════════════════════════════════════ */


/* ───────────────────────────── 1. CONFIGURACIÓN ───────────────────────── */

const CONFIG = Object.freeze({
  VERSION: '1.0.0',
  INTERNAL_W: 320,
  INTERNAL_H: 240,

  // Red
  PEER_PREFIX: 'formula-azul-n1-',
  ROOM_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  ROOM_LENGTH: 4,
  PEER_ID_RETRIES: 5,
  PING_INTERVAL_MS: 2000,
  RECONNECT_DELAY_MS: 2000,

  // Reglas del soldado
  LIFE_MAX: 5,
  AMMO_MAX: 12,
  GRENADES_MAX: 3,
  FIRE_INTERVAL_MS: 90,
  RELOAD_MS: 600,
  GRENADE_COOLDOWN_MS: 900,
  CONTINUE_SECONDS: 9,

  // Sensores del mando
  AIM_MAX_ANGLE: 30,
  AIM_MAX_ANGLE_MIN: 15,
  AIM_MAX_ANGLE_MAX: 45,
  AIM_SMOOTHING: 0.35,
  AIM_SEND_EPSILON: 0.002,
  SHAKE_THRESHOLD: 22,
  SHAKE_DEBOUNCE_MS: 500,
  AIM_LOCK_MS: 250,
  CALIBRATE_HOLD_MS: 600,
  SENSOR_TIMEOUT_MS: 1800,

  // Patrones de vibración (ms vibrando, ms pausa, …)
  VIBRATION: Object.freeze({
    SHOT: [40, 15, 10],
    GRENADE: [150, 40, 250],
    RELOAD: [25, 120, 70],
    EMPTY: [12],
    LAUNCH: [22],
    HIT: [90, 40, 90],
    HEAL: [20, 40, 20, 40, 60],
    CALIBRATED: [30, 60, 30],
    CONNECTED: [50, 50, 50],
    UI: [15],
  }),

  // Audio
  MUSIC_FADE_S: 1.2,
  MUSIC_DUCK: 0.35,

  // Flujo de la máquina
  POWER_ON_MS: 720,
  INTRO_LINE_MS: 3400,
  STAGE_BANNER_MS: 2600,
  RESULTS_INPUT_DELAY_MS: 1500,
  ATTRACT_SCORES_EVERY_MS: 9000,
  ATTRACT_SCORES_FOR_MS: 4500,
  HISCORE_SLOTS: 5,

  STORAGE: Object.freeze({
    SETTINGS: 'fa.settings.v1',
    HISCORES: 'fa.hiscores.v1',
    GUN: 'fa.gun.v1',
  }),

  PLAYERS: Object.freeze({
    1: Object.freeze({ name: 'VEGA', color: '#3ff6ff' }),
    2: Object.freeze({ name: 'SOLANO', color: '#ffd23f' }),
  }),
});

const PLAYER_IDS = Object.freeze([1, 2]);
const DAMAGE_CLASSES = Object.freeze(['damage-lvl-1', 'damage-lvl-2', 'damage-critical']);
const VIB = CONFIG.VIBRATION;


/* ───────────────────────────── 2. UTILIDADES ──────────────────────────── */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now();
const round3 = (value) => Math.round(value * 1000) / 1000;
const pad6 = (value) => String(Math.max(0, Math.floor(value))).padStart(6, '0');

/** Lleva cualquier diferencia de ángulos al rango [-180, 180). */
function wrapAngle(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** Quita y vuelve a poner una clase para reiniciar su animación CSS. */
function restartClass(element, className) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

/** Pasa la mira de coordenadas normalizadas [-1, 1] a píxeles internos 320×240. */
function ndcToPixel(aim) {
  return {
    x: ((aim.x + 1) / 2) * CONFIG.INTERNAL_W,
    y: ((1 - aim.y) / 2) * CONFIG.INTERNAL_H,
  };
}

/** Pasa píxeles internos 320×240 a coordenadas normalizadas [-1, 1]. */
function pixelToNdc(x, y) {
  return {
    x: clamp((x / CONFIG.INTERNAL_W) * 2 - 1, -1, 1),
    y: clamp(1 - (y / CONFIG.INTERNAL_H) * 2, -1, 1),
  };
}

function randomRoomCode() {
  const alphabet = CONFIG.ROOM_ALPHABET;
  const values = new Uint32Array(CONFIG.ROOM_LENGTH);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => alphabet[v % alphabet.length]).join('');
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    image.src = src;
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
    return;
  }
  document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}

/** Notificación en la pila de toasts de la máquina. kind: p1 | p2 | error. */
function toast(text, kind = '') {
  const list = $('#toast-list');
  if (!list) return;
  const item = document.createElement('li');
  item.className = 'toast';
  if (kind) item.classList.add(`toast--${kind}`);
  item.textContent = text;
  list.append(item);
  const remove = () => item.remove();
  item.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, 3600);
  while (list.children.length > 4) list.firstElementChild.remove();
}

/** localStorage blindado: en modo privado o bloqueado simplemente no guarda. */
const storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* almacenamiento no disponible: el juego sigue igual */
    }
  },
};

class EventBus {
  #handlers = new Map();

  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
    return () => this.off(type, handler);
  }

  off(type, handler) {
    this.#handlers.get(type)?.delete(handler);
  }

  emit(type, detail) {
    const handlers = this.#handlers.get(type);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(detail);
      } catch (error) {
        console.error(`[bus:${type}]`, error);
      }
    }
  }
}


/* ───────────────────────────── 3. AJUSTES ─────────────────────────────── */

const DEFAULT_SETTINGS = Object.freeze({
  music: 80,
  sfx: 90,
  crt: true,
  rgbHq: false,
  vertexSnap: true,
  reduceFlash: false,
  mouse: false,
});

class Settings {
  constructor(bus) {
    this.bus = bus;
    const saved = storage.read(CONFIG.STORAGE.SETTINGS, {});
    this.values = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key !== 'mouse' && typeof saved[key] === typeof DEFAULT_SETTINGS[key]) this.values[key] = saved[key];
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (!(key in DEFAULT_SETTINGS) || this.values[key] === value) return;
    this.values[key] = value;
    const { mouse, ...persistent } = this.values;
    storage.write(CONFIG.STORAGE.SETTINGS, persistent);
    this.bus.emit('settings', { key, value, values: { ...this.values } });
  }
}


/* ───────────────────────────── 4. HÁPTICA ─────────────────────────────── */

const Haptics = {
  get supported() {
    return typeof navigator.vibrate === 'function';
  },

  play(pattern) {
    if (!this.supported || !pattern) return false;
    try {
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  },

  stop() {
    if (!this.supported) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* sin vibración */
    }
  },
};


/* ───────────────────────────── 5. GESTOR DE AUDIO ─────────────────────── */

/**
 * Recetas de efectos sintetizados. Cada una programa osciladores y ruido
 * filtrado a partir del instante t y devuelve su duración en segundos.
 */
const SFX_RECIPES = {
  shot: (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.09, vol: 0.55, type: 'bandpass', f0: 2600, f1: 900, q: 0.9 }),
    a.tone(out, t, { type: 'square', f0: 880, f1: 110, dur: 0.09, vol: 0.22 }),
    a.tone(out, t, { type: 'sine', f0: 150, f1: 45, dur: 0.12, vol: 0.5 }),
  ),
  empty: (a, out, t) => a.tone(out, t, { type: 'square', f0: 1900, f1: 1700, dur: 0.025, vol: 0.18 }),
  reload: (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.04, vol: 0.4, type: 'highpass', f0: 3000 }),
    a.tone(out, t, { type: 'square', f0: 260, f1: 620, dur: 0.16, vol: 0.14, at: 0.05 }),
  ),
  'reload-done': (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.03, vol: 0.45, type: 'highpass', f0: 2500 }),
    a.noise(out, t, { dur: 0.05, vol: 0.5, type: 'bandpass', f0: 1400, f1: 900, at: 0.07 }),
    a.tone(out, t, { type: 'triangle', f0: 1320, dur: 0.06, vol: 0.2, at: 0.08 }),
  ),
  'grenade-launch': (a, out, t) => Math.max(
    a.tone(out, t, { type: 'sine', f0: 190, f1: 55, dur: 0.2, vol: 0.7 }),
    a.noise(out, t, { dur: 0.12, vol: 0.35, type: 'lowpass', f0: 1200, f1: 300 }),
  ),
  explosion: (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.8, vol: 0.9, type: 'lowpass', f0: 2400, f1: 120 }),
    a.tone(out, t, { type: 'sine', f0: 90, f1: 30, dur: 0.7, vol: 0.9 }),
    a.tone(out, t, { type: 'sawtooth', f0: 220, f1: 40, dur: 0.35, vol: 0.12 }),
  ),
  hit: (a, out, t) => Math.max(
    a.tone(out, t, { type: 'sawtooth', f0: 240, f1: 70, dur: 0.28, vol: 0.38 }),
    a.noise(out, t, { dur: 0.18, vol: 0.35, type: 'lowpass', f0: 900, f1: 200 }),
  ),
  heal: (a, out, t) => Math.max(
    ...[523, 659, 784, 1047].map((f, i) => a.tone(out, t, { type: 'square', f0: f, dur: 0.07, vol: 0.15, at: i * 0.07 })),
  ),
  purify: (a, out, t) => Math.max(
    a.tone(out, t, { type: 'square', f0: 660, f1: 1760, dur: 0.12, vol: 0.16 }),
    a.noise(out, t, { dur: 0.15, vol: 0.18, type: 'highpass', f0: 4000, f1: 6000 }),
  ),
  'ui-move': (a, out, t) => a.tone(out, t, { type: 'square', f0: 880, dur: 0.03, vol: 0.1 }),
  'ui-select': (a, out, t) => a.tone(out, t, { type: 'square', f0: 660, f1: 1320, dur: 0.08, vol: 0.14 }),
  coin: (a, out, t) => Math.max(
    a.tone(out, t, { type: 'square', f0: 988, dur: 0.07, vol: 0.15 }),
    a.tone(out, t, { type: 'square', f0: 1319, dur: 0.3, vol: 0.15, at: 0.07 }),
  ),
  connect: (a, out, t) => Math.max(
    ...[440, 660, 880].map((f, i) => a.tone(out, t, { type: 'triangle', f0: f, dur: 0.08, vol: 0.2, at: i * 0.08 })),
  ),
  disconnect: (a, out, t) => Math.max(
    ...[660, 440, 220].map((f, i) => a.tone(out, t, { type: 'triangle', f0: f, dur: 0.1, vol: 0.2, at: i * 0.1 })),
  ),
  'power-on': (a, out, t) => Math.max(
    a.tone(out, t, { type: 'sine', f0: 40, f1: 70, dur: 0.5, vol: 0.6 }),
    a.noise(out, t, { dur: 0.35, vol: 0.25, type: 'bandpass', f0: 600, f1: 3000, q: 2 }),
    a.tone(out, t, { type: 'sine', f0: 15000, dur: 0.25, vol: 0.03, at: 0.3 }),
  ),
  tick: (a, out, t) => a.tone(out, t, { type: 'square', f0: 1200, dur: 0.04, vol: 0.12 }),
  warning: (a, out, t) => Math.max(
    ...[740, 520, 740, 520].map((f, i) => a.tone(out, t, { type: 'square', f0: f, dur: 0.17, vol: 0.13, at: i * 0.18 })),
  ),
};

class AudioManager {
  constructor(settings, bus) {
    this.settings = settings;
    this.ctx = null;
    this.isUnlocked = false;
    this.current = null;
    this.wanted = null;
    this.duckFactor = 1;
    this.noiseBuffer = null;
    // Desde file:// el navegador silencia MediaElementSource por CORS: ahí se usa el volumen del <audio>
    this.canRoute = location.protocol !== 'file:';
    this.tracks = {
      intro: this.makeTrack($('#music-intro')),
      level1: this.makeTrack($('#music-level1')),
    };
    bus.on('settings', ({ key }) => {
      if (key === 'music' || key === 'sfx') this.applyVolumes();
    });
  }

  makeTrack(element) {
    return { el: element, gain: null, routed: false, level: 0, target: 0, fadeRaf: 0, doneTimer: 0 };
  }

  get musicVolume() {
    const v = this.settings.get('music') / 100;
    return v * v;
  }

  get sfxVolume() {
    const v = this.settings.get('sfx') / 100;
    return v * v;
  }

  /** Debe llamarse dentro de un gesto del usuario (clic, tecla, toque). */
  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!this.ctx && AudioCtx) {
      const ctx = new AudioCtx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14;
      this.compressor.knee.value = 12;
      this.compressor.ratio.value = 4;
      this.musicBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus.connect(this.master);
      this.master.connect(this.compressor).connect(ctx.destination);
      for (const track of Object.values(this.tracks)) {
        if (!this.canRoute || !track.el) continue;
        try {
          const source = ctx.createMediaElementSource(track.el);
          track.gain = ctx.createGain();
          track.gain.gain.value = 0;
          source.connect(track.gain).connect(this.musicBus);
          track.routed = true;
        } catch (error) {
          console.warn('[audio] pista sin Web Audio, se usa su volumen', error);
        }
      }
      this.noiseBuffer = this.makeNoise(ctx);
    }
    this.ctx?.resume().catch(() => {});
    this.isUnlocked = true;
    this.applyVolumes();
    if (this.wanted && this.current !== this.wanted) this.playMusic(this.wanted, { fade: 0.6 });
  }

  makeNoise(ctx) {
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  applyVolumes() {
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.musicBus.gain.setTargetAtTime(this.musicVolume * this.duckFactor, t, 0.05);
      this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.05);
    }
    for (const track of Object.values(this.tracks)) {
      if (!track.el) continue;
      track.el.volume = track.routed ? 1 : clamp(track.level * this.musicVolume * this.duckFactor, 0, 1);
    }
  }

  fadeTrack(track, target, seconds, onDone) {
    track.target = target;
    clearTimeout(track.doneTimer);
    cancelAnimationFrame(track.fadeRaf);
    const duration = Math.max(0.01, seconds);
    if (track.routed && this.ctx) {
      const gain = track.gain.gain;
      const t = this.ctx.currentTime;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(gain.value, t);
      gain.linearRampToValueAtTime(target, t + duration);
      track.level = target;
    } else {
      const from = track.level;
      const start = now();
      const step = () => {
        const k = clamp((now() - start) / (duration * 1000), 0, 1);
        track.level = lerp(from, target, k);
        this.applyVolumes();
        if (k < 1) track.fadeRaf = requestAnimationFrame(step);
      };
      step();
    }
    if (onDone) track.doneTimer = setTimeout(onDone, duration * 1000 + 60);
  }

  /** Cambia de pista con crossfade. name: 'intro' | 'level1'. */
  playMusic(name, { fade = CONFIG.MUSIC_FADE_S, restart = false } = {}) {
    const next = this.tracks[name];
    if (!next?.el) return;
    this.wanted = name;
    if (!this.isUnlocked) return;
    if (this.current === name && !next.el.paused && !restart) {
      if (next.target !== 1) this.fadeTrack(next, 1, fade);
      return;
    }
    const previousName = this.current && this.current !== name ? this.current : null;
    const previous = previousName ? this.tracks[previousName] : null;
    if (restart || next.el.paused) {
      try {
        next.el.currentTime = 0;
      } catch {
        /* la pista aún no tiene metadatos */
      }
    }
    next.el.play().catch((error) => console.warn('[audio]', error.message));
    this.fadeTrack(next, 1, previous ? fade : Math.min(fade, 0.6));
    if (previous) {
      this.fadeTrack(previous, 0, fade, () => {
        if (this.current !== previousName) previous.el.pause();
      });
    }
    this.current = name;
  }

  stopMusic(fade = 0.5) {
    this.wanted = null;
    if (!this.current) return;
    const name = this.current;
    const track = this.tracks[name];
    this.current = null;
    this.fadeTrack(track, 0, fade, () => {
      if (this.current !== name) track.el.pause();
    });
  }

  /** Baja la música durante la pausa. */
  duck(on) {
    this.duckFactor = on ? CONFIG.MUSIC_DUCK : 1;
    this.applyVolumes();
  }

  sfx(name, { pan = 0, gain = 1 } = {}) {
    const recipe = SFX_RECIPES[name];
    if (!this.ctx || !recipe || this.ctx.state === 'closed') return;
    const out = this.ctx.createGain();
    out.gain.value = gain;
    let tail = out;
    if (typeof this.ctx.createStereoPanner === 'function') {
      const panner = this.ctx.createStereoPanner();
      panner.pan.value = clamp(pan, -1, 1);
      out.connect(panner);
      panner.connect(this.sfxBus);
      tail = panner;
    } else {
      out.connect(this.sfxBus);
    }
    const duration = recipe(this, out, this.ctx.currentTime + 0.005) || 0.5;
    setTimeout(() => {
      out.disconnect();
      if (tail !== out) tail.disconnect();
    }, (duration + 0.3) * 1000);
  }

  tone(out, t0, { type = 'square', f0 = 440, f1 = f0, dur = 0.1, vol = 0.2, at = 0, attack = 0.004 }) {
    const ctx = this.ctx;
    const start = t0 + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), start + dur);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.02);
    return at + dur;
  }

  noise(out, t0, { dur = 0.1, vol = 0.3, type = 'lowpass', f0 = 1000, f1 = f0, q = 0.8, at = 0 }) {
    const ctx = this.ctx;
    const start = t0 + at;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, f1), start + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(filter).connect(env).connect(out);
    source.start(start, Math.random() * 0.5, dur + 0.05);
    return at + dur;
  }
}


/* ───────────────────────────── 6. RED (PEERJS / WEBRTC) ───────────────── */
/*
   Protocolo (JSON):
   celular → PC  hello{player,vibrate} · aim{x,y} · fire{x,y} · grenade{x,y}
                 reload · calibrated{maxAngle} · pause · ping{ts}
   PC → celular  welcome{player,name,room} · state{phase,paused,active,alive,
                 life,ammo,max,grenades,gmax,reloading} · buzz{kind}
                 pong{ts} · reject{reason}
   x, y van normalizados en [-1, 1] (x a la derecha, y hacia arriba).
*/

const PEER_ERRORS = Object.freeze({
  'browser-incompatible': 'Este navegador no soporta WebRTC.',
  'disconnected': 'Se perdió el enlace con el servidor de PeerJS.',
  'invalid-id': 'Código de sala inválido.',
  'network': 'Sin conexión con el servidor de PeerJS: revisa internet.',
  'peer-unavailable': 'No existe esa sala. Revisa el código que muestra el PC.',
  'server-error': 'El servidor de PeerJS no responde.',
  'socket-error': 'Falló la conexión con el servidor de PeerJS.',
  'socket-closed': 'El servidor de PeerJS cerró la conexión.',
  'ssl-unavailable': 'El servidor de PeerJS necesita HTTPS.',
  'unavailable-id': 'Ese código de sala ya está en uso.',
  'webrtc': 'Falló la conexión WebRTC entre los dispositivos.',
});

function describePeerError(error) {
  return PEER_ERRORS[error?.type] || `Error de red (${error?.type || 'desconocido'}).`;
}

function peerJsAvailable() {
  return typeof window.Peer === 'function';
}

/** Lado PC: abre la sala y recibe hasta dos mandos. */
class ArcadeHost {
  constructor(bus) {
    this.bus = bus;
    this.peer = null;
    this.room = null;
    this.ready = false;
    this.attempts = 0;
    this.connections = new Map();
    this.playerOf = new WeakMap();
  }

  open() {
    this.close();
    if (!peerJsAvailable()) {
      this.bus.emit('net:error', { code: 'no-peerjs', message: 'No se pudo cargar PeerJS: revisa la conexión a internet.' });
      return;
    }
    const room = randomRoomCode();
    const peer = new window.Peer(CONFIG.PEER_PREFIX + room, { debug: 1 });
    this.room = room;
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.ready = true;
      this.attempts = 0;
      this.bus.emit('net:room', { room });
    });
    peer.on('connection', (connection) => this.accept(connection));
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) peer.reconnect();
    });
    peer.on('error', (error) => {
      if (this.peer !== peer) return;
      if (error.type === 'unavailable-id' && this.attempts < CONFIG.PEER_ID_RETRIES) {
        this.attempts += 1;
        this.open();
        return;
      }
      this.bus.emit('net:error', { code: error.type, message: describePeerError(error) });
    });
  }

  accept(connection) {
    connection.on('data', (message) => this.receive(connection, message));
    connection.on('close', () => this.drop(connection));
    connection.on('error', () => this.drop(connection));
  }

  receive(connection, message) {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'hello') {
      const player = Number(message.player);
      if (player !== 1 && player !== 2) {
        this.reject(connection, 'bad-player');
        return;
      }
      const existing = this.connections.get(player);
      if (existing && existing !== connection && existing.open) {
        this.reject(connection, 'taken', player);
        return;
      }
      this.playerOf.set(connection, player);
      this.connections.set(player, connection);
      this.bus.emit('net:join', { player, info: message });
      return;
    }
    const player = this.playerOf.get(connection);
    if (!player || this.connections.get(player) !== connection) return;
    if (message.t === 'ping') {
      this.send(player, { t: 'pong', ts: message.ts });
      return;
    }
    this.bus.emit('net:msg', { player, msg: message });
  }

  reject(connection, reason, player = 0) {
    try {
      connection.send({ t: 'reject', reason, player });
    } catch {
      /* el canal ya se cerró */
    }
    setTimeout(() => connection.close(), 300);
  }

  drop(connection) {
    const player = this.playerOf.get(connection);
    if (!player || this.connections.get(player) !== connection) return;
    this.connections.delete(player);
    this.bus.emit('net:leave', { player });
  }

  send(player, message) {
    const connection = this.connections.get(player);
    if (!connection?.open) return false;
    try {
      connection.send(message);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    const peer = this.peer;
    this.peer = null;
    this.ready = false;
    this.room = null;
    this.connections.clear();
    if (peer && !peer.destroyed) peer.destroy();
  }
}

/** Lado celular: se une a la sala del PC y se reconecta solo si se corta. */
class GunClient {
  constructor(bus) {
    this.bus = bus;
    this.peer = null;
    this.connection = null;
    this.room = '';
    this.player = 1;
    this.wantConnected = false;
    this.everOpened = false;
    this.latency = null;
    this.retryTimer = 0;
    this.pingTimer = 0;
  }

  get connected() {
    return !!this.connection?.open;
  }

  connect(room, player) {
    this.room = room;
    this.player = player;
    this.wantConnected = true;
    if (!peerJsAvailable()) {
      this.bus.emit('gun:error', { code: 'no-peerjs', message: 'No se pudo cargar PeerJS: revisa la conexión a internet.' });
      return;
    }
    if (!this.peer || this.peer.destroyed) {
      const peer = new window.Peer({ debug: 1 });
      this.peer = peer;
      peer.on('open', () => {
        if (this.peer === peer) this.dial();
      });
      peer.on('disconnected', () => {
        if (this.peer === peer && !peer.destroyed) peer.reconnect();
      });
      peer.on('error', (error) => this.onPeerError(peer, error));
      return;
    }
    if (this.peer.open) this.dial();
  }

  dial() {
    if (!this.wantConnected || this.connected) return;
    this.connection?.close();
    const connection = this.peer.connect(CONFIG.PEER_PREFIX + this.room, {
      metadata: { player: this.player },
      serialization: 'json',
      reliable: true,
    });
    this.connection = connection;
    connection.on('open', () => {
      if (this.connection !== connection) return;
      this.everOpened = true;
      connection.send({ t: 'hello', player: this.player, vibrate: Haptics.supported, version: CONFIG.VERSION });
      this.startPing();
      this.bus.emit('gun:open');
    });
    connection.on('data', (message) => this.receive(message));
    connection.on('close', () => this.onClose(connection));
    connection.on('error', () => this.onClose(connection));
  }

  receive(message) {
    if (!message || typeof message !== 'object') return;
    if (message.t === 'pong') {
      this.latency = Math.max(0, Math.round(now() - message.ts));
      this.bus.emit('gun:latency', { latency: this.latency });
      return;
    }
    if (message.t === 'reject') {
      this.wantConnected = false;
      this.bus.emit('gun:reject', message);
      return;
    }
    this.bus.emit('gun:msg', message);
  }

  onClose(connection) {
    if (this.connection !== connection) return;
    this.connection = null;
    this.latency = null;
    clearInterval(this.pingTimer);
    this.bus.emit('gun:closed');
    if (this.wantConnected) this.scheduleRetry();
  }

  onPeerError(peer, error) {
    if (this.peer !== peer) return;
    this.bus.emit('gun:error', { code: error.type, message: describePeerError(error) });
    if (error.type === 'peer-unavailable' && !this.everOpened) {
      this.wantConnected = false;
      return;
    }
    if (this.wantConnected) this.scheduleRetry();
  }

  scheduleRetry() {
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.retryNow(), CONFIG.RECONNECT_DELAY_MS);
  }

  retryNow() {
    clearTimeout(this.retryTimer);
    if (!this.wantConnected || this.connected) return;
    if (!this.peer || this.peer.destroyed) {
      this.peer = null;
      this.connect(this.room, this.player);
    } else if (this.peer.disconnected) {
      this.peer.reconnect();
    } else {
      this.dial();
    }
  }

  startPing() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: now() }), CONFIG.PING_INTERVAL_MS);
    this.send({ t: 'ping', ts: now() });
  }

  send(message) {
    if (!this.connected) return false;
    try {
      this.connection.send(message);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    this.wantConnected = false;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.connection?.close();
    this.connection = null;
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.peer = null;
  }
}


/* ───────────────────────────── 7. MÁQUINA: DATOS Y HUD ────────────────── */

class PlayerSlot {
  constructor(id) {
    this.id = id;
    this.name = CONFIG.PLAYERS[id].name;
    this.color = CONFIG.PLAYERS[id].color;
    this.connected = false;
    this.viaMouse = false;
    this.calibrated = false;
    this.active = false;
    this.aim = { x: id === 1 ? -0.2 : 0.2, y: 0 };
    this.view = ndcToPixel(this.aim);
    this.reloadTimer = 0;
    this.resetForLevel();
  }

  resetForLevel() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = 0;
    this.alive = true;
    this.life = CONFIG.LIFE_MAX;
    this.ammo = CONFIG.AMMO_MAX;
    this.grenades = CONFIG.GRENADES_MAX;
    this.reloading = false;
    this.score = 0;
    this.continues = 0;
    this.lastFireAt = 0;
    this.lastGrenadeAt = 0;
    this.stats = { shots: 0, hits: 0, kills: 0, grenades: 0, medkits: 0 };
  }

  revive() {
    clearTimeout(this.reloadTimer);
    this.reloadTimer = 0;
    this.alive = true;
    this.life = CONFIG.LIFE_MAX;
    this.ammo = CONFIG.AMMO_MAX;
    this.grenades = CONFIG.GRENADES_MAX;
    this.reloading = false;
    this.continues += 1;
  }

  get accuracy() {
    return this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
  }

  get pan() {
    return clamp(this.aim.x * 0.6, -0.8, 0.8);
  }
}

class Hiscores {
  constructor(list) {
    this.listEl = list;
    const defaults = $$('.hiscore', list).map((item) => ({
      name: $('.hs-name', item)?.textContent.trim() || '---',
      score: Number($('.hs-score', item)?.textContent) || 0,
    }));
    const saved = storage.read(CONFIG.STORAGE.HISCORES, null);
    const valid = Array.isArray(saved) && saved.every((e) => typeof e?.name === 'string' && Number.isFinite(e?.score));
    this.entries = (valid ? saved : defaults).slice(0, CONFIG.HISCORE_SLOTS);
    this.sort();
  }

  sort() {
    this.entries.sort((a, b) => b.score - a.score);
  }

  qualifies(score) {
    if (score <= 0) return false;
    if (this.entries.length < CONFIG.HISCORE_SLOTS) return true;
    return score > this.entries[this.entries.length - 1].score;
  }

  add(name, score) {
    this.entries.push({ name, score });
    this.sort();
    this.entries = this.entries.slice(0, CONFIG.HISCORE_SLOTS);
    storage.write(CONFIG.STORAGE.HISCORES, this.entries);
    this.render();
  }

  render() {
    const items = this.entries.map((entry) => {
      const item = document.createElement('li');
      item.className = 'hiscore';
      const name = document.createElement('span');
      name.className = 'hs-name';
      name.textContent = entry.name;
      const score = document.createElement('span');
      score.className = 'hs-score';
      score.textContent = pad6(entry.score);
      item.append(name, score);
      return item;
    });
    this.listEl.replaceChildren(...items);
  }
}

/** Todo lo que el HUD DOM muestra, siempre por clases. */
class Hud {
  constructor() {
    this.root = $('#arcade');
    this.crt = $('#crt');
    this.flashEl = $('#lightgun-flash');
    this.viewGame = $('#view-game');
    this.players = { 1: this.collect(1), 2: this.collect(2) };
    this.banners = {
      stage: $('#banner-stage'),
      warning: $('#banner-warning'),
      heal: $('#banner-heal'),
      clear: $('#banner-clear'),
    };
    this.bannerTimers = {};
    this.bossMeter = $('#boss-health');
    this.rail = $('#rail-progress');
    this.section = $('#stage-section');
    this.shakeTimer = 0;
    this.bossHitTimer = 0;
  }

  collect(id) {
    const root = $(`#hud-p${id}`);
    return {
      root,
      score: $(`#score-p${id}`),
      lifeList: $(`#life-p${id}`),
      life: $$(`#life-p${id} .life-cell`),
      ammoList: $(`#ammo-p${id}`),
      ammo: $$(`#ammo-p${id} .ammo-cell`),
      grenadeList: $(`#grenades-p${id}`),
      grenades: $$(`#grenades-p${id} .grenade-cell`),
      join: $('.hud-join', root),
      damage: $(`#damage-p${id}`),
      hit: $(`#hit-p${id}`),
      hurtTimer: 0,
    };
  }

  renderPlayer(player) {
    const r = this.players[player.id];
    const inPlay = player.active;
    r.root.classList.toggle('is-inactive', !inPlay);
    r.root.classList.toggle('is-offline', inPlay && !player.connected);
    r.root.classList.toggle('is-dead', inPlay && !player.alive);
    r.root.classList.toggle('is-critical', inPlay && player.alive && player.life <= 1);
    r.root.classList.toggle('is-reloading', inPlay && player.alive && player.reloading);
    r.root.classList.toggle('is-empty', inPlay && player.alive && !player.reloading && player.ammo === 0);

    r.score.textContent = pad6(player.score);
    r.life.forEach((cell, i) => cell.classList.toggle('is-empty', i >= player.life));
    r.ammo.forEach((cell, i) => cell.classList.toggle('is-spent', i >= player.ammo));
    r.grenades.forEach((cell, i) => cell.classList.toggle('is-spent', i >= player.grenades));
    r.lifeList.setAttribute('aria-label', `Vida de J${player.id}: ${player.life} de ${CONFIG.LIFE_MAX}`);
    r.ammoList.setAttribute('aria-label', `Munición de J${player.id}: ${player.ammo} de ${CONFIG.AMMO_MAX}`);
    r.grenadeList.setAttribute('aria-label', `Granadas de J${player.id}: ${player.grenades} de ${CONFIG.GRENADES_MAX}`);
    r.join.textContent = player.connected ? `J${player.id} · DISPARA PARA UNIRTE` : `J${player.id} · CONECTA TU CELULAR`;

    // Viñeta del visor: 5 → limpia · 4-3 → lvl-1 · 2 → lvl-2 · 1-0 → crítica
    let level = null;
    if (inPlay && player.life < CONFIG.LIFE_MAX) {
      if (player.life >= 3) level = 'damage-lvl-1';
      else if (player.life === 2) level = 'damage-lvl-2';
      else level = 'damage-critical';
    }
    for (const cls of DAMAGE_CLASSES) r.damage.classList.toggle(cls, cls === level);
  }

  /** Destello rojo de bordes, retrato herido y sacudida de cámara. */
  hit(id) {
    const r = this.players[id];
    restartClass(r.hit, 'is-hit');
    restartClass(r.root, 'is-hurt');
    clearTimeout(r.hurtTimer);
    r.hurtTimer = setTimeout(() => r.root.classList.remove('is-hurt'), 340);
    this.shake();
  }

  shake() {
    restartClass(this.crt, 'is-shaking');
    clearTimeout(this.shakeTimer);
    this.shakeTimer = setTimeout(() => this.crt.classList.remove('is-shaking'), 280);
  }

  /**
   * Flash óptico de exactamente 1 fotograma: la clase se pone ya, se pinta
   * en el siguiente fotograma y se quita antes de pintar el posterior.
   */
  flash() {
    const element = this.flashEl;
    element.classList.add('is-on');
    requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove('is-on')));
  }

  showBanner(name, ms) {
    const banner = this.banners[name];
    if (!banner) return;
    clearTimeout(this.bannerTimers[name]);
    restartClass(banner, 'is-visible');
    this.bannerTimers[name] = setTimeout(() => banner.classList.remove('is-visible'), ms);
  }

  hideBanners() {
    for (const [name, banner] of Object.entries(this.banners)) {
      clearTimeout(this.bannerTimers[name]);
      banner.classList.remove('is-visible');
    }
  }

  setSolo(solo) {
    this.root.classList.toggle('is-solo', solo);
  }

  setBossVisible(visible) {
    this.viewGame.classList.toggle('is-boss', visible);
  }

  setBossHealth(percent) {
    const value = clamp(percent, 0, 100);
    this.bossMeter.value = value;
    this.bossMeter.textContent = `${Math.round(value)} %`;
  }

  bossHit() {
    this.viewGame.classList.add('is-boss-hit');
    clearTimeout(this.bossHitTimer);
    this.bossHitTimer = setTimeout(() => this.viewGame.classList.remove('is-boss-hit'), 100);
  }

  setRail(percent) {
    const value = clamp(percent, 0, 100);
    this.rail.value = value;
    this.rail.textContent = `${Math.round(value)} %`;
  }

  setSection(section) {
    this.section.textContent = String(section);
  }

  reset() {
    this.hideBanners();
    this.setBossVisible(false);
    this.setBossHealth(100);
    this.setRail(0);
    this.setSection(1);
    this.viewGame.classList.remove('is-boss-hit');
    this.crt.classList.remove('is-shaking');
    for (const id of PLAYER_IDS) {
      const r = this.players[id];
      r.hit.classList.remove('is-hit');
      r.root.classList.remove('is-hurt');
    }
  }
}

/** Capa 2D a 320×240: miras, chispas, explosiones y puntos flotantes. */
class HudCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.sprites = {};
    this.effects = [];
    this.loading = null;
  }

  load() {
    if (this.loading) return this.loading;
    const files = {
      crosshair1: 'img/crosshair-p1.png',
      crosshair2: 'img/crosshair-p2.png',
      spark: 'img/fx-spark-blue.png',
      explosion: 'img/fx-explosion-blue.png',
      grenade: 'img/fx-grenade.png',
      slime: 'img/fx-slime-ball.png',
      medkit: 'img/icon-medkit.png',
    };
    this.loading = Promise.all(
      Object.entries(files).map(([key, src]) => loadImage(src)
        .then((image) => { this.sprites[key] = image; })
        .catch((error) => console.warn('[hud]', error.message))),
    );
    return this.loading;
  }

  burst(kind, x, y) {
    const lifetimes = { spark: 0.12, explosion: 0.32, purify: 0.45, splat: 0.45 };
    const effect = { kind, x, y, t: 0, life: lifetimes[kind] || 0.2, parts: null };
    if (kind === 'purify' || kind === 'splat') {
      const palette = kind === 'purify'
        ? ['#e6ffff', '#7fe8ff', '#2fa8ff']
        : ['#d6ff8c', '#8cff5c', '#41d23f'];
      effect.parts = Array.from({ length: 12 }, () => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 70;
        return {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 20,
          color: palette[Math.floor(Math.random() * palette.length)],
          size: Math.random() < 0.3 ? 2 : 1,
        };
      });
    }
    this.effects.push(effect);
    if (this.effects.length > 64) this.effects.shift();
  }

  popup(text, x, y, color = '#e6ffff') {
    this.effects.push({ kind: 'text', text, x, y, t: 0, life: 0.8, color });
  }

  clear() {
    this.effects = [];
    this.ctx.clearRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
  }

  render(dt, { crosshairs = [], world = null } = {}) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CONFIG.INTERNAL_W, CONFIG.INTERNAL_H);
    if (world && typeof world.drawHud === 'function') world.drawHud(ctx, this.sprites, dt);
    this.drawEffects(dt);
    this.drawCrosshairs(crosshairs);
  }

  drawEffects(dt) {
    const ctx = this.ctx;
    const s = this.sprites;
    this.effects = this.effects.filter((effect) => (effect.t += dt) < effect.life);
    for (const e of this.effects) {
      const k = e.t / e.life;
      if (e.kind === 'spark' && s.spark) {
        ctx.drawImage(s.spark, Math.round(e.x - 8), Math.round(e.y - 8));
      } else if (e.kind === 'explosion' && s.explosion) {
        const frame = Math.min(3, Math.floor(k * 4));
        ctx.drawImage(s.explosion, frame * 32, 0, 32, 32, Math.round(e.x - 32), Math.round(e.y - 32), 64, 64);
      } else if (e.parts) {
        for (const p of e.parts) {
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(e.x + p.vx * e.t), Math.round(e.y + p.vy * e.t + 60 * e.t * e.t), p.size, p.size);
        }
      } else if (e.kind === 'text') {
        const y = Math.round(e.y - 14 * k - 6);
        ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        ctx.font = '8px "Silkscreen", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#02050a';
        ctx.fillText(e.text, Math.round(e.x) + 1, y + 1);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, Math.round(e.x), y);
        ctx.globalAlpha = 1;
      }
    }
  }

  drawCrosshairs(list) {
    for (const c of list) {
      const image = this.sprites[`crosshair${c.id}`];
      if (!image) continue;
      if (c.blink && Math.floor(now() / 90) % 2 === 0) continue;
      this.ctx.drawImage(image, Math.round(c.x - image.width / 2), Math.round(c.y - image.height / 2));
    }
  }
}


/* ───────────────────────────── 8. MUNDO DE JUEGO ──────────────────────── */
/*
   Interfaz «World» que implementa el Campo de Tiro y, en la Entrega 3, el
   motor Three.js. La máquina (Arcade) llama:
     attach(game)              → recibe la API de la máquina
     enterAttract()            → fondo animado del menú (bucle de caos)
     enterIntro()              → arranca la cinemática
     introShot(shot, index)    → toma de la cinemática (data-shot del guion)
     enterLevel()              → arranca el riel del Nivel 1
     exitLevel()               → limpia el nivel
     setPaused(paused)
     update(dt, time)          → cada fotograma, en segundos
     shoot(playerId, aim)      → aim {x,y} en [-1,1]; devuelve {hit, kind}
     grenade(playerId, aim)    → lanza la granada; al explotar llama
                                 game.grenadeExploded(playerId, aim, opciones)
     drawHud?(ctx, sprites, dt) → (opcional) dibujo 2D extra sobre #hud-canvas
   La API «game» que recibe: addScore, registerKill, damagePlayer,
   damageRandomPlayer, healPlayer, grenadeExploded, hudBurst, setRailProgress,
   setSection, showBoss, setBossHealth, bossHit, hideBoss, levelClear, toast,
   players, settings, audio y bus.
*/

const WORLD_FACTORIES = [];

/** La Parte 2 se registra aquí: registerWorld((app, game) => new MundoThree(app, game)). */
function registerWorld(factory) {
  if (typeof factory === 'function') WORLD_FACTORIES.push(factory);
}

const RANGE_AREA = Object.freeze({ left: 16, right: 304, top: 58, bottom: 216 });

/** Campo de Tiro 2D: el mundo por defecto hasta que llegue el motor 3D. */
class ShootingRange {
  constructor() {
    this.game = null;
    this.targets = [];
    this.grenades = [];
    this.active = false;
    this.paused = false;
    this.spawnClock = 0;
    this.purified = 0;
    this.goal = 24;
    this.time = 0;
  }

  attach(game) {
    this.game = game;
  }

  enterAttract() {
    this.active = false;
    this.targets = [];
    this.grenades = [];
  }

  enterIntro() {
    this.active = false;
  }

  introShot() {
    /* el Campo de Tiro no tiene tomas de cámara */
  }

  enterLevel() {
    this.active = true;
    this.paused = false;
    this.targets = [];
    this.grenades = [];
    this.purified = 0;
    this.spawnClock = -CONFIG.STAGE_BANNER_MS / 1000;
    this.game.setRailProgress(0);
    this.game.toast('CAMPO DE TIRO · EL MOTOR 3D LLEGA EN LA ENTREGA 3');
  }

  exitLevel() {
    this.active = false;
    this.targets = [];
    this.grenades = [];
  }

  setPaused(paused) {
    this.paused = paused;
  }

  update(dt) {
    if (!this.active || this.paused) return;
    this.time += dt;
    this.spawnClock += dt;
    const interval = Math.max(0.7, 1.5 - this.purified * 0.03);
    if (this.spawnClock >= interval && this.targets.length < 6) {
      this.spawnClock = 0;
      this.spawn();
    }
    for (const target of [...this.targets]) {
      target.x += target.vx * dt;
      target.y += target.vy * dt + Math.sin(this.time * 3 + target.phase) * 6 * dt;
      if (target.x < RANGE_AREA.left + target.r || target.x > RANGE_AREA.right - target.r) {
        target.vx *= -1;
        target.x = clamp(target.x, RANGE_AREA.left + target.r, RANGE_AREA.right - target.r);
      }
      if (target.y < RANGE_AREA.top + target.r || target.y > RANGE_AREA.bottom - target.r) {
        target.vy *= -1;
        target.y = clamp(target.y, RANGE_AREA.top + target.r, RANGE_AREA.bottom - target.r);
      }
      target.flash = Math.max(0, target.flash - dt);
      target.ttl -= dt;
      if (target.ttl <= 0) this.expire(target);
    }
    for (const grenade of [...this.grenades]) {
      grenade.t += dt;
      if (grenade.t >= grenade.dur) this.explode(grenade);
    }
  }

  spawn() {
    const medkit = Math.random() < 0.12;
    this.targets.push({
      type: medkit ? 'medkit' : 'slime',
      x: lerp(RANGE_AREA.left + 20, RANGE_AREA.right - 20, Math.random()),
      y: lerp(RANGE_AREA.top + 20, RANGE_AREA.bottom - 20, Math.random()),
      r: 14,
      vx: (Math.random() * 2 - 1) * (medkit ? 20 : 35),
      vy: (Math.random() * 2 - 1) * 18,
      hp: medkit ? 1 : 2,
      ttl: medkit ? 4.5 : 5.5,
      flash: 0,
      phase: Math.random() * Math.PI * 2,
    });
  }

  remove(target) {
    this.targets = this.targets.filter((t) => t !== target);
  }

  expire(target) {
    this.remove(target);
    if (target.type !== 'slime') return;
    const aim = pixelToNdc(target.x, target.y);
    this.game.hudBurst('splat', aim);
    this.game.damageRandomPlayer(1);
  }

  pick(x, y) {
    for (let i = this.targets.length - 1; i >= 0; i -= 1) {
      const target = this.targets[i];
      if (Math.hypot(target.x - x, target.y - y) <= target.r + 3) return target;
    }
    return null;
  }

  shoot(playerId, aim) {
    if (!this.active || this.paused) return { hit: false, kind: null };
    const { x, y } = ndcToPixel(aim);
    const target = this.pick(x, y);
    if (!target) return { hit: false, kind: null };
    const kind = target.type;
    this.damage(target, 1, playerId);
    return { hit: true, kind };
  }

  damage(target, amount, playerId) {
    if (!this.targets.includes(target)) return;
    const aim = pixelToNdc(target.x, target.y);
    if (target.type === 'medkit') {
      this.remove(target);
      this.game.healPlayer(playerId);
      this.game.addScore(playerId, 50, aim);
      this.game.hudBurst('purify', aim);
      return;
    }
    target.hp -= amount;
    target.flash = 0.1;
    if (target.hp > 0) {
      this.game.addScore(playerId, 10, null);
      return;
    }
    this.remove(target);
    this.purified += 1;
    this.game.registerKill(playerId);
    this.game.addScore(playerId, 100, aim);
    this.game.hudBurst('purify', aim);
    this.game.setRailProgress((this.purified / this.goal) * 100);
    this.game.setSection(1 + Math.min(2, Math.floor(this.purified / (this.goal / 3))));
    if (this.purified >= this.goal) {
      this.active = false;
      this.targets = [];
      this.game.levelClear();
    }
  }

  grenade(playerId, aim) {
    const to = ndcToPixel(aim);
    this.grenades.push({ playerId, from: { x: playerId === 1 ? 110 : 210, y: 250 }, to, t: 0, dur: 0.55 });
  }

  explode(grenade) {
    this.grenades = this.grenades.filter((g) => g !== grenade);
    this.game.grenadeExploded(grenade.playerId, pixelToNdc(grenade.to.x, grenade.to.y));
    for (const target of [...this.targets]) {
      if (Math.hypot(target.x - grenade.to.x, target.y - grenade.to.y) <= 46 + target.r) {
        this.damage(target, 2, grenade.playerId);
      }
    }
  }

  drawHud(ctx, sprites) {
    for (const target of this.targets) {
      const blinking = target.ttl < 1.2 && Math.floor(target.ttl * 10) % 2 === 0;
      if (blinking) continue;
      let image = sprites.slime;
      if (target.type === 'medkit') image = sprites.medkit;
      else if (target.flash > 0) image = sprites.grenade;
      if (image) ctx.drawImage(image, Math.round(target.x - 16), Math.round(target.y - 16), 32, 32);
    }
    for (const grenade of this.grenades) {
      const k = grenade.t / grenade.dur;
      const x = lerp(grenade.from.x, grenade.to.x, k);
      const y = lerp(grenade.from.y, grenade.to.y, k) - Math.sin(k * Math.PI) * 60;
      if (sprites.grenade) ctx.drawImage(sprites.grenade, Math.round(x - 8), Math.round(y - 8));
    }
  }
}


/* ───────────────────────────── 9. MÁQUINA ARCADE (PC) ─────────────────── */

class Arcade {
  constructor(app) {
    this.app = app;
    this.bus = app.bus;
    this.audio = app.audio;
    this.settings = app.settings;
    this.host = new ArcadeHost(this.bus);
    this.players = { 1: new PlayerSlot(1), 2: new PlayerSlot(2) };
    this.hud = new Hud();
    this.hudCanvas = new HudCanvas($('#hud-canvas'));
    this.hiscores = new Hiscores($('#hiscore-list'));
    this.world = null;

    this.phase = 'boot'; // boot | menu | lobby | intro | game | results | sleep
    this.paused = false;
    this.powered = false;
    this.clearing = false;
    this.menuIndex = 0;
    this.introIndex = -1;
    this.introTimer = 0;
    this.continueQueue = [];
    this.continueTimer = 0;
    this.continueLeft = 0;
    this.resultsAt = 0;
    this.pendingRecords = [];
    this.settingsReturn = null;
    this.lastNetError = '';
    this.lastNetErrorAt = 0;
    this.attractClock = 0;
    this.scoresShown = false;
    this.lastFrame = 0;
    this.loopStarted = false;

    this.el = {
      root: $('#arcade'),
      crt: $('#crt'),
      screen: $('#crt-screen'),
      views: $$('.view'),
      btnPower: $('#btn-power'),
      viewMenu: $('#view-menu'),
      modeButtons: $$('.mode-btn'),
      lobby: $('#lobby'),
      roomCode: $('#room-code'),
      roomUrl: $('#room-url'),
      qr: { 1: $('#qr-p1'), 2: $('#qr-p2') },
      slots: {
        1: { root: $('#slot-p1'), status: $('#slot-status-p1') },
        2: { root: $('#slot-p2'), status: $('#slot-status-p2') },
      },
      introLines: $$('#intro-script .intro-line'),
      introCards: { 1: $('#intro-card-p1'), 2: $('#intro-card-p2') },
      viewResults: $('#view-results'),
      initialsForm: $('#initials-form'),
      initials: { 1: $('#initials-p1'), 2: $('#initials-p2') },
      dialogs: {
        pause: $('#dialog-pause'),
        continue: $('#dialog-continue'),
        settings: $('#dialog-settings'),
      },
      continuePlayer: $('#continue-player'),
      continueCount: $('#continue-count'),
      settingsForm: $('#settings-form'),
    };
  }

  /* ── Arranque ── */

  init() {
    this.el.btnPower.addEventListener('click', () => this.powerOn());
    this.bindMenu();
    this.bindKeyboard();
    this.bindMouse();
    this.bindDialogs();
    this.bindSettingsForm();
    this.bindNetwork();
    this.bindResults();
    this.bus.on('settings', ({ values }) => this.applySettings(values));
    this.applySettings(this.settings.values);
    this.hiscores.render();
    this.renderAllPlayers();
    this.updateSlots();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.phase === 'game') this.pause();
    });
    window.addEventListener('pagehide', () => this.host.close());
  }

  powerOn() {
    if (this.powered) return;
    this.powered = true;
    this.audio.unlock();
    this.audio.sfx('power-on');
    const crt = this.el.crt;
    crt.classList.remove('is-standby');
    restartClass(crt, 'is-powering-on');
    setTimeout(() => crt.classList.remove('is-powering-on'), CONFIG.POWER_ON_MS);
    this.ensureWorld();
    this.hudCanvas.load();
    document.fonts?.load('8px "Silkscreen"').catch(() => {});
    this.enterMenu();
    this.audio.playMusic('intro', { fade: 0.8, restart: true });
    this.startLoop();
  }

  ensureWorld() {
    if (this.world) return this.world;
    const factory = WORLD_FACTORIES[WORLD_FACTORIES.length - 1];
    let world = null;
    if (factory) {
      try {
        world = factory(this.app, this);
      } catch (error) {
        console.error('[mundo]', error);
        this.toast('El motor 3D no arrancó: se usa el Campo de Tiro', 'error');
      }
    }
    this.world = world || new ShootingRange();
    this.world.attach?.(this);
    return this.world;
  }

  showView(id) {
    for (const view of this.el.views) view.classList.toggle('is-active', view.id === id);
  }

  setRole(role) {
    document.body.classList.remove('role-pending', 'role-arcade', 'role-gun');
    document.body.classList.add(`role-${role}`);
  }

  /* ── Menú attract y selección de modo ── */

  enterMenu() {
    this.phase = 'menu';
    this.setRole('pending');
    this.showView('view-menu');
    this.el.viewMenu.classList.remove('is-lobby', 'show-scores');
    this.scoresShown = false;
    this.attractClock = 0;
    this.setMenuFocus(0, false);
    this.world?.setPaused(false);
    this.world?.enterAttract();
    this.bus.emit('phase', { phase: this.phase });
  }

  bindMenu() {
    this.el.modeButtons.forEach((button, index) => {
      button.addEventListener('click', () => this.activateMode(button.dataset.mode));
      button.addEventListener('pointerenter', () => this.setMenuFocus(index, false));
    });
  }

  setMenuFocus(index, withSound = true) {
    const count = this.el.modeButtons.length;
    this.menuIndex = ((index % count) + count) % count;
    this.el.modeButtons.forEach((button, i) => button.classList.toggle('is-focused', i === this.menuIndex));
    if (withSound) this.audio.sfx('ui-move');
  }

  activateMode(mode) {
    if (this.phase !== 'menu') return;
    this.audio.sfx('ui-select');
    if (mode === 'arcade') this.openLobby();
    else if (mode === 'gun') this.becomeGun();
  }

  resetAttract() {
    this.attractClock = 0;
    if (this.scoresShown) {
      this.scoresShown = false;
      this.el.viewMenu.classList.remove('show-scores');
    }
  }

  updateAttract(dt) {
    if (this.phase !== 'menu') return;
    this.attractClock += dt * 1000;
    if (!this.scoresShown && this.attractClock > CONFIG.ATTRACT_SCORES_EVERY_MS) {
      this.scoresShown = true;
      this.attractClock = 0;
      this.el.viewMenu.classList.add('show-scores');
    } else if (this.scoresShown && this.attractClock > CONFIG.ATTRACT_SCORES_FOR_MS) {
      this.scoresShown = false;
      this.attractClock = 0;
      this.el.viewMenu.classList.remove('show-scores');
    }
  }

  becomeGun() {
    this.phase = 'sleep';
    this.host.close();
    this.detachMouse();
    this.world?.setPaused(true);
    this.audio.stopMusic(0.4);
    this.hudCanvas.clear();
    startGun({});
  }

  /* ── Sala de espera ── */

  openLobby() {
    this.phase = 'lobby';
    this.setRole('arcade');
    this.el.viewMenu.classList.add('is-lobby');
    this.el.viewMenu.classList.remove('show-scores');
    this.el.roomCode.textContent = '----';
    this.el.roomUrl.textContent = 'creando sala…';
    for (const id of PLAYER_IDS) this.drawQr(this.el.qr[id], '');
    this.host.open();
    if (this.settings.get('mouse')) this.attachMouse();
    this.updateSlots();
    this.bus.emit('phase', { phase: this.phase });
  }

  leaveLobby() {
    this.host.close();
    this.detachMouse();
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      player.connected = false;
      player.calibrated = false;
      player.active = false;
    }
    this.updateSlots();
    this.renderAllPlayers();
    this.audio.sfx('ui-move');
    this.enterMenu();
  }

  shareBase() {
    return `${location.origin}${location.pathname}`;
  }

  onRoom(room) {
    if (this.phase === 'menu' || this.phase === 'sleep' || this.phase === 'boot') return;
    const base = this.shareBase();
    this.el.roomCode.textContent = room;
    this.el.roomUrl.textContent = `${base}?sala=${room}`;
    const ok = PLAYER_IDS.map((id) => this.drawQr(this.el.qr[id], `${base}?sala=${room}&j=${id}`)).every(Boolean);
    if (!ok) this.toast('QR no disponible: escribe la dirección y el código en el celular', 'error');
    if (location.protocol === 'file:') {
      this.toast('Sirve el juego por HTTPS para conectar los celulares', 'error');
    } else if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) {
      this.toast('Abre el juego con la IP de tu PC para que el QR funcione', 'error');
    }
  }

  drawQr(canvas, text) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    if (!text) return true;
    if (typeof window.qrcode !== 'function') return false;
    const qr = window.qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.max(1, Math.floor(size / (count + 4)));
    const offset = Math.floor((size - cell * count) / 2);
    ctx.fillStyle = '#000000';
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) ctx.fillRect(offset + col * cell, offset + row * cell, cell, cell);
      }
    }
    return true;
  }

  canStart() {
    return PLAYER_IDS.some((id) => this.players[id].connected);
  }

  updateSlots() {
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      const slot = this.el.slots[id];
      slot.root.classList.toggle('is-connected', player.connected);
      slot.root.classList.toggle('is-calibrated', player.connected && player.calibrated);
      let status = 'ESPERANDO SEÑAL…';
      if (player.connected && player.viaMouse) status = 'RATÓN · LISTO';
      else if (player.connected && player.calibrated) status = 'LISTO';
      else if (player.connected) status = 'CONECTADO · CALIBRA';
      slot.status.textContent = status;
    }
    this.el.lobby.classList.toggle('can-start', this.canStart());
  }

  /* ── Red ── */

  bindNetwork() {
    this.bus.on('net:room', ({ room }) => this.onRoom(room));
    this.bus.on('net:error', ({ message }) => {
      // Sin internet PeerJS reintenta sin parar: el mismo aviso sale como mucho cada 15 s
      const t = now();
      if (message !== this.lastNetError || t - this.lastNetErrorAt > 15000) {
        this.lastNetError = message;
        this.lastNetErrorAt = t;
        this.toast(message, 'error');
      }
      if (this.phase === 'lobby' && !this.host.ready) this.el.roomUrl.textContent = message;
    });
    this.bus.on('net:join', ({ player, info }) => this.onPlayerJoin(player, info));
    this.bus.on('net:leave', ({ player }) => this.onPlayerLeave(player));
    this.bus.on('net:msg', ({ player, msg }) => this.onPlayerMessage(player, msg));
  }

  onPlayerJoin(id, info) {
    const player = this.players[id];
    if (player.viaMouse) {
      this.detachMouse();
      this.settings.set('mouse', false);
      this.toast('J1 pasa del ratón al celular', 'p1');
    }
    player.connected = true;
    player.viaMouse = false;
    player.calibrated = false;
    player.vibrates = !!info?.vibrate;
    this.audio.sfx('connect');
    this.toast(`J${id} · ${player.name} CONECTADO`, `p${id}`);
    this.host.send(id, { t: 'welcome', player: id, name: player.name, room: this.host.room });
    this.updateSlots();
    this.renderPlayer(id);
    this.syncPlayer(id);
    this.bus.emit('player:join', { id });
  }

  onPlayerLeave(id) {
    const player = this.players[id];
    if (!player.connected || player.viaMouse) return;
    player.connected = false;
    player.calibrated = false;
    this.audio.sfx('disconnect');
    this.toast(`J${id} · SEÑAL PERDIDA`, 'error');
    this.updateSlots();
    this.renderPlayer(id);
    this.bus.emit('player:leave', { id });
    if (this.phase === 'game' && !this.anyActiveConnected()) this.pause();
  }

  onPlayerMessage(id, message) {
    switch (message.t) {
      case 'aim':
        this.setAim(id, message);
        break;
      case 'fire':
        this.setAim(id, message);
        this.fire(id);
        break;
      case 'grenade':
        this.setAim(id, message);
        this.throwGrenade(id);
        break;
      case 'reload':
        this.reload(id);
        break;
      case 'calibrated':
        this.players[id].calibrated = true;
        this.updateSlots();
        this.toast(`J${id} · CENTRO CALIBRADO`, `p${id}`);
        this.audio.sfx('ui-select');
        break;
      case 'pause':
        this.onPadPause();
        break;
      default:
        break;
    }
  }

  setAim(id, { x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.players[id].aim = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  /** Estado autoritativo que se envía al celular tras cada cambio. */
  syncPlayer(id) {
    const player = this.players[id];
    if (!player.connected || player.viaMouse) return;
    this.host.send(id, {
      t: 'state',
      phase: this.phase,
      paused: this.paused || this.isContinueOpen,
      active: player.active,
      alive: player.alive,
      life: player.life,
      ammo: player.ammo,
      max: CONFIG.AMMO_MAX,
      grenades: player.grenades,
      gmax: CONFIG.GRENADES_MAX,
      reloading: player.reloading,
    });
  }

  broadcastState() {
    for (const id of PLAYER_IDS) this.syncPlayer(id);
  }

  buzz(id, kind) {
    this.host.send(id, { t: 'buzz', kind });
  }

  /* ── Ratón como pistola J1 (pruebas sin celular) ── */

  get mouseActive() {
    return this.players[1].viaMouse && ['lobby', 'intro', 'game', 'results'].includes(this.phase);
  }

  bindMouse() {
    const screen = this.el.screen;
    screen.addEventListener('pointermove', (event) => {
      if (!this.mouseActive || event.pointerType !== 'mouse') return;
      const rect = screen.getBoundingClientRect();
      this.players[1].aim = {
        x: clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
        y: clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1),
      };
    });
    screen.addEventListener('pointerdown', (event) => {
      if (!this.mouseActive || event.pointerType !== 'mouse') return;
      if (event.button === 0) this.fire(1);
      else if (event.button === 2) this.throwGrenade(1);
    });
    screen.addEventListener('contextmenu', (event) => {
      if (this.mouseActive) event.preventDefault();
    });
    screen.addEventListener('wheel', (event) => {
      if (!this.mouseActive) return;
      event.preventDefault();
      this.reload(1);
    }, { passive: false });
  }

  attachMouse() {
    const player = this.players[1];
    if (player.viaMouse) return;
    if (player.connected) {
      this.toast('J1 ya usa un celular', 'error');
      this.settings.set('mouse', false);
      return;
    }
    player.connected = true;
    player.viaMouse = true;
    player.calibrated = true;
    this.toast('J1 · RATÓN COMO PISTOLA', 'p1');
    this.updateSlots();
    this.renderPlayer(1);
  }

  detachMouse() {
    const player = this.players[1];
    if (!player.viaMouse) return;
    player.viaMouse = false;
    player.connected = false;
    player.calibrated = false;
    this.updateSlots();
    this.renderPlayer(1);
    if (this.phase === 'game' && !this.anyActiveConnected()) this.pause();
  }

  /* ── Teclado ── */

  bindKeyboard() {
    document.addEventListener('keydown', (event) => this.onKey(event));
  }

  onKey(event) {
    if (this.phase === 'sleep') return;
    if (document.querySelector('#arcade dialog[open]')) return;
    const { key } = event;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
    if (!typing && (key === 'f' || key === 'F')) {
      toggleFullscreen();
      return;
    }
    switch (this.phase) {
      case 'boot':
        if ((key === 'Enter' || key === ' ') && event.target !== this.el.btnPower) {
          event.preventDefault();
          this.powerOn();
        }
        break;
      case 'menu':
        this.onMenuKey(event);
        break;
      case 'lobby':
        this.onLobbyKey(event);
        break;
      case 'intro':
        if (key === 'Enter' || key === ' ' || key === 'Escape') {
          event.preventDefault();
          this.skipIntro();
        }
        break;
      case 'game':
        if (key === 'Escape' || key === 'p' || key === 'P') {
          event.preventDefault();
          this.pause();
        } else if ((key === 'r' || key === 'R') && this.mouseActive) {
          this.reload(1);
        } else if (key === 'm' || key === 'M') {
          this.settings.set('mouse', !this.settings.get('mouse'));
        }
        break;
      case 'results':
        if (key === 'Enter' && !typing) {
          event.preventDefault();
          this.leaveResults();
        }
        break;
      default:
        break;
    }
  }

  onMenuKey(event) {
    const { key } = event;
    this.resetAttract();
    if (key === 'ArrowUp' || key === 'ArrowLeft' || key === 'w' || key === 'W') {
      event.preventDefault();
      this.setMenuFocus(this.menuIndex - 1);
    } else if (key === 'ArrowDown' || key === 'ArrowRight' || key === 's' || key === 'S') {
      event.preventDefault();
      this.setMenuFocus(this.menuIndex + 1);
    } else if (key === 'Enter' || key === ' ') {
      if (event.target?.classList?.contains('mode-btn')) return;
      event.preventDefault();
      this.activateMode(this.el.modeButtons[this.menuIndex].dataset.mode);
    } else if (key === 'a' || key === 'A') {
      this.openSettings('menu');
    }
  }

  onLobbyKey(event) {
    const { key } = event;
    if (key === 'Enter') {
      event.preventDefault();
      if (this.canStart()) this.startIntro();
      else this.toast('Conecta al menos un mando para empezar', 'error');
    } else if (key === 'Escape') {
      event.preventDefault();
      this.leaveLobby();
    } else if (key === 'm' || key === 'M') {
      this.settings.set('mouse', !this.settings.get('mouse'));
    } else if (key === 'a' || key === 'A') {
      this.openSettings('lobby');
    }
  }

  /* ── Intro ── */

  startIntro() {
    if (this.phase !== 'lobby' || !this.canStart()) return;
    this.phase = 'intro';
    this.audio.sfx('coin');
    this.showView('view-intro');
    this.introIndex = -1;
    for (const line of this.el.introLines) line.classList.remove('is-current');
    for (const id of PLAYER_IDS) this.el.introCards[id].classList.remove('is-visible');
    this.world?.enterIntro();
    this.broadcastState();
    this.bus.emit('phase', { phase: this.phase });
    this.nextIntroLine();
  }

  nextIntroLine() {
    clearTimeout(this.introTimer);
    if (this.phase !== 'intro') return;
    this.introIndex += 1;
    const lines = this.el.introLines;
    if (this.introIndex >= lines.length) {
      this.startLevel();
      return;
    }
    lines.forEach((line, i) => line.classList.toggle('is-current', i === this.introIndex));
    const shot = lines[this.introIndex].dataset.shot || '';
    // Las fichas de los soldados acompañan solo la línea del escuadrón; en la siguiente se ven sus máscaras en 3D
    for (const id of PLAYER_IDS) {
      this.el.introCards[id].classList.toggle('is-visible', shot === 'squad' && this.players[id].connected);
    }
    this.world?.introShot(shot, this.introIndex);
    this.bus.emit('intro:line', { index: this.introIndex, shot });
    this.introTimer = setTimeout(() => this.nextIntroLine(), CONFIG.INTRO_LINE_MS);
  }

  skipIntro() {
    if (this.phase !== 'intro') return;
    clearTimeout(this.introTimer);
    this.startLevel();
  }

  /* ── Partida ── */

  startLevel() {
    clearTimeout(this.introTimer);
    for (const line of this.el.introLines) line.classList.remove('is-current');
    for (const id of PLAYER_IDS) this.el.introCards[id].classList.remove('is-visible');
    const ids = PLAYER_IDS.filter((id) => this.players[id].connected);
    if (!ids.length) {
      this.toast('No hay mandos conectados', 'error');
      this.returnToLobby();
      return;
    }
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      player.resetForLevel();
      player.active = ids.includes(id);
    }
    this.phase = 'game';
    this.paused = false;
    this.clearing = false;
    this.continueQueue = [];
    this.hud.reset();
    this.hud.setSolo(ids.length === 1);
    this.showView('view-game');
    this.hud.showBanner('stage', CONFIG.STAGE_BANNER_MS);
    this.audio.playMusic('level1', { restart: true });
    this.world?.enterLevel();
    this.renderAllPlayers();
    this.broadcastState();
    this.bus.emit('phase', { phase: this.phase });
    this.bus.emit('level:start', { players: ids });
  }

  joinMidGame(id) {
    const player = this.players[id];
    player.resetForLevel();
    player.active = true;
    this.hud.setSolo(this.activeCount() <= 1);
    this.audio.sfx('coin');
    this.toast(`¡J${id} · ${player.name} SE UNE!`, `p${id}`);
    this.renderPlayer(id);
    this.syncPlayer(id);
    this.bus.emit('player:enter', { id });
  }

  /** Gatillo principal. Fuera de la partida sirve para empezar, saltar o continuar. */
  fire(id) {
    const player = this.players[id];
    switch (this.phase) {
      case 'lobby':
        if (this.canStart()) this.startIntro();
        return;
      case 'intro':
        this.skipIntro();
        return;
      case 'results':
        this.leaveResults();
        return;
      case 'game':
        break;
      default:
        return;
    }
    if (this.isContinueOpen) {
      if (this.continueQueue[0] === id) this.el.dialogs.continue.close('continue');
      return;
    }
    if (this.paused) return;
    if (!player.active) {
      this.joinMidGame(id);
      return;
    }
    if (!player.alive) return;
    const t = now();
    if (t - player.lastFireAt < CONFIG.FIRE_INTERVAL_MS) return;
    player.lastFireAt = t;
    if (player.reloading || player.ammo <= 0) {
      this.audio.sfx('empty', { pan: player.pan });
      this.renderPlayer(id);
      this.syncPlayer(id);
      return;
    }
    player.ammo -= 1;
    player.stats.shots += 1;
    this.hud.flash();
    this.audio.sfx('shot', { pan: player.pan });
    const result = this.world?.shoot(id, { ...player.aim }) || { hit: false };
    if (result.hit) player.stats.hits += 1;
    const point = ndcToPixel(player.aim);
    this.hudCanvas.burst('spark', point.x, point.y);
    this.bus.emit('shot', { id, aim: { ...player.aim }, hit: !!result.hit, kind: result.kind || null });
    this.renderPlayer(id);
    this.syncPlayer(id);
  }

  /** Gatillo del lanzagranadas acoplado. */
  throwGrenade(id) {
    if (this.phase !== 'game' || this.paused || this.isContinueOpen) return;
    const player = this.players[id];
    if (!player.active || !player.alive) return;
    const t = now();
    if (t - player.lastGrenadeAt < CONFIG.GRENADE_COOLDOWN_MS) return;
    if (player.grenades <= 0) {
      this.audio.sfx('empty', { pan: player.pan });
      this.syncPlayer(id);
      return;
    }
    player.lastGrenadeAt = t;
    player.grenades -= 1;
    player.stats.grenades += 1;
    this.hud.flash();
    this.audio.sfx('grenade-launch', { pan: player.pan });
    this.world?.grenade(id, { ...player.aim });
    this.bus.emit('grenade', { id, aim: { ...player.aim } });
    this.renderPlayer(id);
    this.syncPlayer(id);
  }

  /** Recarga pedida por la sacudida del celular (o la rueda del ratón). */
  reload(id) {
    const player = this.players[id];
    const busy = this.phase !== 'game' || this.paused || !player.active || !player.alive;
    if (busy || player.reloading || player.ammo >= CONFIG.AMMO_MAX) {
      this.syncPlayer(id);
      return;
    }
    player.reloading = true;
    this.audio.sfx('reload', { pan: player.pan });
    this.renderPlayer(id);
    this.syncPlayer(id);
    clearTimeout(player.reloadTimer);
    player.reloadTimer = setTimeout(() => {
      player.reloadTimer = 0;
      player.reloading = false;
      if (!player.active || !player.alive) return;
      player.ammo = CONFIG.AMMO_MAX;
      this.audio.sfx('reload-done', { pan: player.pan });
      this.renderPlayer(id);
      this.syncPlayer(id);
    }, CONFIG.RELOAD_MS);
  }

  /* ── API para el mundo (Campo de Tiro / motor 3D) ── */

  toast(text, kind = '') {
    toast(text, kind);
  }

  hudBurst(kind, aim) {
    const point = ndcToPixel(aim);
    this.hudCanvas.burst(kind, point.x, point.y);
  }

  addScore(id, points, aim = null) {
    const player = this.players[id];
    if (!player?.active) return;
    player.score += points;
    this.renderPlayer(id);
    if (aim) {
      const point = ndcToPixel(aim);
      this.hudCanvas.popup(`+${points}`, point.x, point.y, player.color);
    }
  }

  registerKill(id) {
    const player = this.players[id];
    if (!player?.active) return;
    player.stats.kills += 1;
    this.audio.sfx('purify', { pan: player.pan });
    this.bus.emit('kill', { id });
  }

  damagePlayer(id, amount = 1) {
    if (this.phase !== 'game' || this.paused || this.isContinueOpen || this.clearing) return false;
    const player = this.players[id];
    if (!player?.active || !player.alive) return false;
    player.life = Math.max(0, player.life - amount);
    this.hud.hit(id);
    this.audio.sfx('hit', { pan: id === 1 ? -0.4 : 0.4 });
    this.buzz(id, 'HIT');
    this.renderPlayer(id);
    this.syncPlayer(id);
    this.bus.emit('player:hit', { id, life: player.life });
    if (player.life === 0) this.playerDown(id);
    return true;
  }

  /** Daña a un soldado al azar (los conectados primero). Devuelve su id o 0. */
  damageRandomPlayer(amount = 1) {
    const alive = PLAYER_IDS.filter((id) => this.players[id].active && this.players[id].alive);
    const online = alive.filter((id) => this.players[id].connected);
    const pool = online.length ? online : alive;
    if (!pool.length) return 0;
    const id = pool[Math.floor(Math.random() * pool.length)];
    return this.damagePlayer(id, amount) ? id : 0;
  }

  healPlayer(id, amount = 1) {
    const player = this.players[id];
    if (!player?.active || !player.alive) return false;
    player.life = Math.min(CONFIG.LIFE_MAX, player.life + amount);
    player.stats.medkits += 1;
    this.hud.showBanner('heal', 1400);
    this.audio.sfx('heal', { pan: player.pan });
    this.buzz(id, 'HEAL');
    this.renderPlayer(id);
    this.syncPlayer(id);
    this.bus.emit('player:heal', { id, life: player.life });
    return true;
  }

  /** La granada tocó suelo: suena, retumba el celular y tiembla la pantalla. */
  grenadeExploded(id, aim = null, { hudBurst = true } = {}) {
    const player = this.players[id];
    const pan = aim ? clamp(aim.x * 0.6, -0.8, 0.8) : player?.pan || 0;
    this.audio.sfx('explosion', { pan });
    this.hud.shake();
    this.buzz(id, 'GRENADE');
    if (aim && hudBurst) this.hudBurst('explosion', aim);
  }

  setRailProgress(percent) {
    this.hud.setRail(percent);
  }

  setSection(section) {
    this.hud.setSection(section);
  }

  showBoss() {
    this.hud.setBossHealth(100);
    this.hud.setBossVisible(true);
    this.hud.showBanner('warning', 2600);
    this.audio.sfx('warning');
  }

  setBossHealth(percent) {
    this.hud.setBossHealth(percent);
  }

  bossHit() {
    this.hud.bossHit();
  }

  hideBoss() {
    this.hud.setBossVisible(false);
  }

  levelClear() {
    if (this.phase !== 'game' || this.clearing) return;
    this.clearing = true;
    this.hud.showBanner('clear', 1800);
    this.audio.sfx('coin');
    setTimeout(() => {
      this.clearing = false;
      if (this.phase === 'game') this.finishLevel(true);
    }, 1900);
  }

  /* ── Caída del soldado y CONTINUE ── */

  get isContinueOpen() {
    return this.el.dialogs.continue.open;
  }

  anyAlive() {
    return PLAYER_IDS.some((id) => this.players[id].active && this.players[id].alive);
  }

  anyActiveConnected() {
    return PLAYER_IDS.some((id) => this.players[id].active && this.players[id].connected);
  }

  activeCount() {
    return PLAYER_IDS.filter((id) => this.players[id].active).length;
  }

  playerDown(id) {
    const player = this.players[id];
    player.alive = false;
    player.reloading = false;
    clearTimeout(player.reloadTimer);
    this.renderPlayer(id);
    this.syncPlayer(id);
    this.bus.emit('player:down', { id });
    if (!this.continueQueue.includes(id)) this.continueQueue.push(id);
    if (!this.isContinueOpen) this.openContinue();
  }

  openContinue() {
    const id = this.continueQueue[0];
    if (!id) return;
    const dialog = this.el.dialogs.continue;
    this.world?.setPaused(true);
    this.el.continuePlayer.textContent = `J${id}`;
    this.continueLeft = CONFIG.CONTINUE_SECONDS;
    this.el.continueCount.textContent = String(this.continueLeft);
    dialog.returnValue = '';
    dialog.showModal();
    this.broadcastState();
    clearInterval(this.continueTimer);
    this.continueTimer = setInterval(() => {
      this.continueLeft -= 1;
      if (this.continueLeft < 0) {
        dialog.close('giveup');
        return;
      }
      this.el.continueCount.textContent = String(this.continueLeft);
      this.audio.sfx('tick');
    }, 1000);
  }

  onContinueClosed(value) {
    clearInterval(this.continueTimer);
    const id = this.continueQueue.shift();
    if (!id || this.phase !== 'game') return;
    const player = this.players[id];
    if (value === 'continue') {
      player.revive();
      this.audio.sfx('coin');
      this.toast(`J${id} · ¡DE VUELTA EN ACCIÓN!`, `p${id}`);
      this.renderPlayer(id);
      this.syncPlayer(id);
    }
    if (this.continueQueue.length) {
      this.openContinue();
      return;
    }
    if (!this.anyAlive()) {
      this.finishLevel(false);
      return;
    }
    if (!this.paused) this.world?.setPaused(false);
    this.broadcastState();
  }

  /* ── Pausa y ajustes ── */

  onPadPause() {
    if (this.phase !== 'game' || this.isContinueOpen) return;
    if (this.el.dialogs.pause.open) this.el.dialogs.pause.close('resume');
    else if (!this.el.dialogs.settings.open) this.pause();
  }

  pause() {
    if (this.phase !== 'game' || this.paused || this.isContinueOpen) return;
    const dialog = this.el.dialogs.pause;
    this.paused = true;
    this.world?.setPaused(true);
    this.audio.duck(true);
    dialog.returnValue = '';
    if (!dialog.open && !this.el.dialogs.settings.open) dialog.showModal();
    this.broadcastState();
    this.bus.emit('pause', { paused: true });
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (!this.isContinueOpen) this.world?.setPaused(false);
    this.audio.duck(false);
    this.broadcastState();
    this.bus.emit('pause', { paused: false });
  }

  bindDialogs() {
    const { pause, settings } = this.el.dialogs;
    const continueDialog = this.el.dialogs.continue;
    pause.addEventListener('close', () => this.onPauseClosed(pause.returnValue));
    continueDialog.addEventListener('cancel', (event) => event.preventDefault());
    continueDialog.addEventListener('close', () => this.onContinueClosed(continueDialog.returnValue));
    settings.addEventListener('close', () => this.onSettingsClosed());
  }

  onPauseClosed(value) {
    if (this.phase !== 'game') return;
    if (value === 'settings') {
      this.openSettings('pause');
      return;
    }
    if (value === 'quit') {
      this.paused = false;
      this.audio.duck(false);
      this.returnToLobby();
      return;
    }
    this.resume();
  }

  openSettings(returnTo) {
    const dialog = this.el.dialogs.settings;
    if (dialog.open) return;
    this.settingsReturn = returnTo;
    this.syncSettingsForm();
    dialog.returnValue = '';
    dialog.showModal();
  }

  onSettingsClosed() {
    const returnTo = this.settingsReturn;
    this.settingsReturn = null;
    if (returnTo === 'pause' && this.phase === 'game' && this.paused) {
      const pause = this.el.dialogs.pause;
      pause.returnValue = '';
      pause.showModal();
    }
  }

  bindSettingsForm() {
    const form = this.el.settingsForm;
    form.addEventListener('input', (event) => this.onSettingsInput(event.target));
    form.addEventListener('change', (event) => this.onSettingsInput(event.target));
    this.syncSettingsForm();
  }

  syncSettingsForm() {
    const form = this.el.settingsForm;
    for (const [key, value] of Object.entries(this.settings.values)) {
      const input = form.elements.namedItem(key);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = !!value;
      else input.value = String(value);
    }
  }

  onSettingsInput(input) {
    if (!input?.name || !(input.name in DEFAULT_SETTINGS)) return;
    const value = input.type === 'checkbox' ? input.checked : Number(input.value);
    this.settings.set(input.name, value);
    if (input.name === 'sfx') this.audio.sfx('ui-move');
  }

  applySettings(values) {
    const root = this.el.root;
    root.classList.toggle('opt-no-crt', !values.crt);
    root.classList.toggle('opt-rgb-hq', values.rgbHq);
    root.classList.toggle('opt-reduce-flash', values.reduceFlash);
    root.classList.toggle('opt-mouse', values.mouse);
    if (['lobby', 'intro', 'game', 'results'].includes(this.phase)) {
      if (values.mouse) this.attachMouse();
      else this.detachMouse();
    }
    if (this.el.dialogs.settings.open) this.syncSettingsForm();
  }

  /* ── Resultados y récords ── */

  finishLevel(clear) {
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      clearTimeout(player.reloadTimer);
      player.reloading = false;
    }
    this.world?.exitLevel();
    this.world?.setPaused(false);
    this.paused = false;
    this.audio.duck(false);
    if (this.el.dialogs.pause.open) this.el.dialogs.pause.close('');
    this.showResults(clear);
  }

  bindResults() {
    this.el.initialsForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.phase !== 'results') return;
      this.saveRecords();
      this.returnToLobby();
    });
    for (const id of PLAYER_IDS) {
      const input = this.el.initials[id];
      input.addEventListener('input', () => {
        input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      });
    }
  }

  showResults(clear) {
    this.phase = 'results';
    this.resultsAt = now();
    const view = this.el.viewResults;
    this.showView('view-results');
    view.classList.toggle('is-clear', clear);
    view.classList.toggle('is-gameover', !clear);
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      const fields = {
        score: player.active ? pad6(player.score) : '—',
        kills: player.active ? String(player.stats.kills) : '—',
        accuracy: player.active ? `${player.accuracy} %` : '—',
        grenades: player.active ? String(player.stats.grenades) : '—',
        medkits: player.active ? String(player.stats.medkits) : '—',
      };
      for (const [key, value] of Object.entries(fields)) $(`#res-${key}-p${id}`).textContent = value;
    }
    this.pendingRecords = PLAYER_IDS.filter((id) => this.players[id].active && this.hiscores.qualifies(this.players[id].score));
    view.classList.toggle('is-new-record', this.pendingRecords.length > 0);
    for (const id of PLAYER_IDS) {
      const input = this.el.initials[id];
      const qualifies = this.pendingRecords.includes(id);
      input.disabled = !qualifies;
      input.value = qualifies ? '' : '---';
    }
    if (this.pendingRecords.length) this.el.initials[this.pendingRecords[0]].focus({ preventScroll: true });
    this.audio.playMusic('intro', { restart: true });
    this.broadcastState();
    this.bus.emit('phase', { phase: this.phase, clear });
  }

  saveRecords() {
    for (const id of this.pendingRecords) {
      const player = this.players[id];
      const typed = this.el.initials[id].value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      this.hiscores.add(typed || player.name.slice(0, 3), player.score);
    }
    if (this.pendingRecords.length) this.toast('RÉCORD GUARDADO');
    this.pendingRecords = [];
    this.el.viewResults.classList.remove('is-new-record');
  }

  leaveResults() {
    if (this.phase !== 'results' || now() - this.resultsAt < CONFIG.RESULTS_INPUT_DELAY_MS) return;
    this.saveRecords();
    this.returnToLobby();
  }

  returnToLobby() {
    this.phase = 'lobby';
    this.paused = false;
    this.clearing = false;
    this.continueQueue = [];
    clearInterval(this.continueTimer);
    clearTimeout(this.introTimer);
    for (const dialog of Object.values(this.el.dialogs)) {
      if (dialog.open) dialog.close('');
    }
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      player.resetForLevel();
      player.active = false;
    }
    this.hud.reset();
    this.hud.setSolo(true);
    this.hudCanvas.clear();
    this.world?.exitLevel();
    this.world?.setPaused(false);
    this.world?.enterAttract();
    this.audio.duck(false);
    this.audio.playMusic('intro');
    this.setRole('arcade');
    this.showView('view-menu');
    this.el.viewMenu.classList.add('is-lobby');
    this.renderAllPlayers();
    this.updateSlots();
    this.broadcastState();
    this.bus.emit('phase', { phase: this.phase });
  }

  /* ── Render y bucle principal ── */

  renderPlayer(id) {
    this.hud.renderPlayer(this.players[id]);
  }

  renderAllPlayers() {
    for (const id of PLAYER_IDS) this.renderPlayer(id);
  }

  startLoop() {
    if (this.loopStarted) return;
    this.loopStarted = true;
    this.lastFrame = now();
    const frame = (time) => {
      this.tick(time);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  tick(time) {
    const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000));
    this.lastFrame = time;
    if (this.phase === 'sleep' || this.phase === 'boot') return;
    const running = !this.paused && !this.isContinueOpen;
    if (this.world && running) this.world.update(dt, time / 1000);
    this.updateAttract(dt);
    const k = 1 - Math.exp(-dt * 28);
    const crosshairs = [];
    for (const id of PLAYER_IDS) {
      const player = this.players[id];
      const target = ndcToPixel(player.aim);
      player.view.x = lerp(player.view.x, target.x, k);
      player.view.y = lerp(player.view.y, target.y, k);
      const visible = player.connected && (this.phase === 'lobby' || (this.phase === 'game' && player.active && player.alive));
      if (visible) crosshairs.push({ id, x: player.view.x, y: player.view.y, blink: player.reloading });
    }
    this.hudCanvas.render(dt, { crosshairs, world: this.phase === 'game' ? this.world : null });
  }
}


/* ───────────────────────────── 10. MANDO PISTOLA (CELULAR) ────────────── */

const SENSOR_MESSAGES = Object.freeze({
  insecure: 'Sin HTTPS el celular no entrega el giroscopio. Abre el juego con https://',
  denied: 'Permiso de sensores denegado. Actívalo en los ajustes del navegador.',
  error: 'No se pudo pedir permiso para los sensores.',
  silent: 'El celular no está enviando datos del giroscopio.',
});

class Gun {
  constructor(app) {
    this.app = app;
    this.bus = app.bus;
    this.client = new GunClient(this.bus);
    this.el = {
      root: $('#gun'),
      join: $('#gun-join'),
      pad: $('#gun-pad'),
      form: $('#join-form'),
      room: $('#join-room'),
      status: $('#join-status'),
      link: $('#pad-link-text'),
      player: $('#pad-player'),
      tankList: $('#pad-ammo'),
      tank: $$('#pad-ammo .tank-cell'),
      count: $('#pad-ammo-count'),
      rackList: $('#pad-grenades'),
      rack: $$('#pad-grenades .rack-cell'),
      fire: $('#trigger-fire'),
      grenade: $('#trigger-grenade'),
      calibrate: $('#btn-calibrate'),
      pause: $('#btn-pad-pause'),
      dialog: $('#dialog-calibrate'),
      range: $('#aim-range'),
      rangeValue: $('#aim-range-value'),
    };
    const saved = storage.read(CONFIG.STORAGE.GUN, {});
    this.cal = {
      baseAlpha: 0,
      baseBeta: 0,
      maxAngle: clamp(Number(saved.maxAngle) || CONFIG.AIM_MAX_ANGLE, CONFIG.AIM_MAX_ANGLE_MIN, CONFIG.AIM_MAX_ANGLE_MAX),
      set: false,
    };
    this.raw = { alpha: 0, beta: 0 };
    this.aim = { x: 0, y: 0 };
    this.sent = { x: NaN, y: NaN };
    this.isAimLocked = false;
    this.lockTimer = 0;
    this.lastShakeAt = 0;
    this.lastFireAt = 0;
    this.lastGrenadeAt = 0;
    this.sensorsAttached = false;
    this.sensorsOn = false;
    this.sensorProblem = '';
    this.sensorCheck = 0;
    this.joining = false;
    this.welcomed = false;
    this.calibrationPrompted = false;
    this.wakeLock = null;
    this.holdTimer = 0;
    this.holdFired = false;
    this.labelTimer = 0;
    this.cooldownTimer = 0;
    this.calibrateLabel = this.el.calibrate.textContent;
    this.room = '';
    this.player = 1;
    this.state = {
      phase: 'lobby',
      paused: false,
      active: false,
      alive: true,
      ammo: CONFIG.AMMO_MAX,
      max: CONFIG.AMMO_MAX,
      grenades: CONFIG.GRENADES_MAX,
      gmax: CONFIG.GRENADES_MAX,
      reloading: false,
    };
    this.onOrientation = this.onOrientation.bind(this);
    this.onMotion = this.onMotion.bind(this);
  }

  init({ room = '', player = null } = {}) {
    document.body.classList.remove('role-pending', 'role-arcade');
    document.body.classList.add('role-gun');
    this.showStep('join');
    const saved = storage.read(CONFIG.STORAGE.GUN, {});
    this.el.room.value = String(room || saved.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const chosen = Number(player || saved.player || 1) === 2 ? 2 : 1;
    this.el.form.elements.namedItem('player').value = String(chosen);
    this.setPlayerTheme(chosen);

    this.el.form.addEventListener('submit', (event) => this.onSubmit(event));
    this.el.room.addEventListener('input', () => {
      this.el.room.value = this.el.room.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });
    this.el.form.addEventListener('change', (event) => {
      if (event.target?.name === 'player') this.setPlayerTheme(Number(event.target.value));
    });
    this.bindTrigger(this.el.fire, () => this.fire());
    this.bindTrigger(this.el.grenade, () => this.throwGrenade());
    this.bindCalibrate();
    this.el.pause.addEventListener('click', () => {
      Haptics.play(VIB.UI);
      this.client.send({ t: 'pause' });
    });
    this.el.range.addEventListener('input', () => {
      this.el.rangeValue.textContent = `${this.el.range.value}°`;
    });
    this.el.dialog.addEventListener('close', () => {
      if (this.el.dialog.returnValue === 'set') this.calibrateNow(Number(this.el.range.value));
    });

    this.bus.on('gun:open', () => this.status('Enlazado. Esperando a la máquina…', 'ok'));
    this.bus.on('gun:msg', (message) => this.onMessage(message));
    this.bus.on('gun:closed', () => this.onClosed());
    this.bus.on('gun:error', ({ message }) => this.onError(message));
    this.bus.on('gun:reject', (message) => this.onReject(message));
    this.bus.on('gun:latency', () => this.renderLink());
    document.addEventListener('visibilitychange', () => this.onVisibility());

    if (!window.isSecureContext) this.status(SENSOR_MESSAGES.insecure, 'error');
    else if (!('DeviceOrientationEvent' in window)) this.status('Este dispositivo no tiene giroscopio: la mira quedará fija al centro.', 'error');
    this.render();
    this.renderLink();
    this.startSendLoop();
    return this;
  }

  showStep(step) {
    this.el.join.classList.toggle('is-active', step === 'join');
    this.el.pad.classList.toggle('is-active', step === 'pad');
  }

  setPlayerTheme(player) {
    this.el.root.classList.toggle('player-1', player !== 2);
    this.el.root.classList.toggle('player-2', player === 2);
  }

  status(text, kind = '') {
    this.el.status.textContent = text;
    this.el.status.classList.toggle('is-error', kind === 'error');
    this.el.status.classList.toggle('is-ok', kind === 'ok');
  }

  /* ── Enlace con la sala ── */

  onSubmit(event) {
    event.preventDefault();
    if (this.joining) return;
    const room = this.el.room.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(room)) {
      this.status('El código de sala tiene 4 letras o números.', 'error');
      this.el.room.focus();
      return;
    }
    const player = Number(this.el.form.elements.namedItem('player').value) === 2 ? 2 : 1;
    // Lo que exige un gesto del usuario se pide antes de cualquier await
    const fullscreen = this.enterFullscreen();
    const permission = this.requestSensorPermission();
    this.attachSensors();
    this.joining = true;
    this.room = room;
    this.player = player;
    this.saveGunPrefs();
    this.setPlayerTheme(player);
    this.status('Pidiendo permiso para los sensores…');
    permission.then((result) => {
      this.startSensors(result);
      this.requestWakeLock();
      this.status(`Conectando con la sala ${room}…`);
      this.client.connect(room, player);
    }).finally(() => {
      fullscreen.catch(() => {});
    });
  }

  saveGunPrefs() {
    storage.write(CONFIG.STORAGE.GUN, { room: this.room, player: this.player, maxAngle: this.cal.maxAngle });
  }

  enterFullscreen() {
    const root = document.documentElement;
    if (document.fullscreenElement || typeof root.requestFullscreen !== 'function') return Promise.resolve();
    return root.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('portrait'))
      .catch(() => {});
  }

  async requestWakeLock() {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      this.wakeLock = null;
    }
  }

  onVisibility() {
    if (document.visibilityState !== 'visible' || !this.client.wantConnected) return;
    this.requestWakeLock();
    if (!this.client.connected) this.client.retryNow();
  }

  onMessage(message) {
    switch (message.t) {
      case 'welcome':
        this.onWelcome(message);
        break;
      case 'state':
        this.applyState(message);
        break;
      case 'buzz':
        this.buzz(message.kind);
        break;
      default:
        break;
    }
  }

  onWelcome(message) {
    this.joining = false;
    this.welcomed = true;
    this.player = message.player === 2 ? 2 : 1;
    this.setPlayerTheme(this.player);
    this.el.player.textContent = `J${this.player} · ${message.name || CONFIG.PLAYERS[this.player].name}`;
    this.showStep('pad');
    this.el.pad.classList.add('is-connected');
    this.renderLink();
    Haptics.play(VIB.CONNECTED);
    if (!this.calibrationPrompted) {
      this.calibrationPrompted = true;
      this.openCalibrateDialog();
    } else if (this.cal.set) {
      this.client.send({ t: 'calibrated', maxAngle: this.cal.maxAngle });
    }
  }

  onClosed() {
    this.el.pad.classList.remove('is-connected');
    this.renderLink();
  }

  onError(message) {
    if (!this.welcomed) {
      this.joining = false;
      this.status(message, 'error');
    }
    this.renderLink();
  }

  onReject(message) {
    this.joining = false;
    this.welcomed = false;
    this.client.disconnect();
    this.showStep('join');
    this.el.pad.classList.remove('is-connected');
    const text = message.reason === 'taken'
      ? `El J${message.player || this.player} ya tiene un celular conectado. Elige el otro jugador.`
      : 'La máquina rechazó la conexión.';
    this.status(text, 'error');
  }

  applyState(state) {
    const s = this.state;
    if (typeof state.phase === 'string') s.phase = state.phase;
    for (const key of ['paused', 'active', 'alive', 'reloading']) {
      if (typeof state[key] === 'boolean') s[key] = state[key];
    }
    for (const key of ['ammo', 'max', 'grenades', 'gmax']) {
      if (Number.isFinite(state[key])) s[key] = state[key];
    }
    this.render();
  }

  buzz(kind) {
    const pattern = VIB[kind];
    if (!pattern) return;
    Haptics.play(pattern);
    if (kind === 'GRENADE') restartClass(this.el.pad, 'is-boom');
  }

  /* ── Sensores: giroscopio y acelerómetro ── */

  requestSensorPermission() {
    if (!window.isSecureContext) return Promise.resolve({ ok: false, reason: 'insecure' });
    const requests = [];
    if (typeof window.DeviceOrientationEvent?.requestPermission === 'function') requests.push(window.DeviceOrientationEvent.requestPermission());
    if (typeof window.DeviceMotionEvent?.requestPermission === 'function') requests.push(window.DeviceMotionEvent.requestPermission());
    if (!requests.length) return Promise.resolve({ ok: true });
    return Promise.all(requests)
      .then((answers) => (answers.every((a) => a === 'granted') ? { ok: true } : { ok: false, reason: 'denied' }))
      .catch(() => ({ ok: false, reason: 'error' }));
  }

  attachSensors() {
    if (this.sensorsAttached) return;
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('devicemotion', this.onMotion);
    this.sensorsAttached = true;
  }

  startSensors(result) {
    if (!result.ok) this.sensorProblem = SENSOR_MESSAGES[result.reason] || SENSOR_MESSAGES.error;
    this.attachSensors();
    clearTimeout(this.sensorCheck);
    this.sensorCheck = setTimeout(() => {
      if (!this.sensorsOn) this.sensorProblem = this.sensorProblem || SENSOR_MESSAGES.silent;
      this.renderLink();
    }, CONFIG.SENSOR_TIMEOUT_MS);
  }

  /**
   * Ángulo vertical según cómo esté girada la pantalla. En vertical es beta;
   * en horizontal el borde que apunta al monitor es un lateral, así que el
   * cabeceo pasa a ser gamma.
   */
  pitchFrom(event) {
    const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) + 360) % 360;
    if (angle === 90) return event.gamma == null ? null : -event.gamma;
    if (angle === 270) return event.gamma == null ? null : event.gamma;
    if (angle === 180) return event.beta == null ? null : -event.beta;
    return event.beta;
  }

  onOrientation(event) {
    if (event.alpha == null) return;
    const beta = this.pitchFrom(event);
    if (beta == null) return;
    this.raw.alpha = event.alpha;
    this.raw.beta = beta;
    if (!this.sensorsOn) {
      this.sensorsOn = true;
      this.sensorProblem = '';
      if (!this.cal.set) {
        this.cal.baseAlpha = event.alpha;
        this.cal.baseBeta = beta;
      }
      this.renderLink();
    }
    // Normalización: clamp((actual - base) / maxAngle, -1, 1)
    // alpha crece al girar a la izquierda, por eso el eje X va con signo menos.
    const dAlpha = wrapAngle(this.raw.alpha - this.cal.baseAlpha);
    const dBeta = wrapAngle(this.raw.beta - this.cal.baseBeta);
    const targetX = clamp(-dAlpha / this.cal.maxAngle, -1, 1);
    const targetY = clamp(dBeta / this.cal.maxAngle, -1, 1);
    const keep = CONFIG.AIM_SMOOTHING;
    this.aim.x = this.aim.x * keep + targetX * (1 - keep);
    this.aim.y = this.aim.y * keep + targetY * (1 - keep);
  }

  /** Sacudida con las dos manos: pico > 22 m/s² con antirrebote de 500 ms. */
  onMotion(event) {
    const a = event.accelerationIncludingGravity || event.acceleration;
    if (!a) return;
    const magnitude = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    const t = now();
    if (magnitude > CONFIG.SHAKE_THRESHOLD && t - this.lastShakeAt > CONFIG.SHAKE_DEBOUNCE_MS) {
      this.lastShakeAt = t;
      this.onShake();
    }
  }

  onShake() {
    // Anti-temblor: la sacudida mueve el celular, así que se congela el envío de la mira
    this.lockAim();
    const s = this.state;
    if (!this.client.connected) return;
    if (s.phase !== 'game' || s.paused || !s.active || !s.alive || s.reloading || s.ammo >= s.max) return;
    Haptics.play(VIB.RELOAD);
    s.reloading = true;
    this.render();
    this.client.send({ t: 'reload' });
  }

  lockAim() {
    this.isAimLocked = true;
    this.el.pad.classList.add('is-aim-locked');
    clearTimeout(this.lockTimer);
    this.lockTimer = setTimeout(() => {
      this.isAimLocked = false;
      this.el.pad.classList.remove('is-aim-locked');
    }, CONFIG.AIM_LOCK_MS);
  }

  /** Bucle de envío: como mucho una mira por fotograma y solo si cambió. */
  startSendLoop() {
    const step = () => {
      this.sendAim();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  sendAim() {
    if (!this.client.connected || !this.sensorsOn || this.isAimLocked) return;
    const eps = CONFIG.AIM_SEND_EPSILON;
    if (Number.isFinite(this.sent.x) && Math.abs(this.aim.x - this.sent.x) <= eps && Math.abs(this.aim.y - this.sent.y) <= eps) return;
    this.sent = { x: round3(this.aim.x), y: round3(this.aim.y) };
    this.client.send({ t: 'aim', ...this.sent });
  }

  /** Durante el bloqueo se dispara a la última mira enviada, no a la sacudida. */
  shotAim() {
    if (this.isAimLocked && Number.isFinite(this.sent.x)) return { ...this.sent };
    return { x: round3(this.aim.x), y: round3(this.aim.y) };
  }

  /* ── Calibración ── */

  bindCalibrate() {
    const button = this.el.calibrate;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.holdFired = false;
      clearTimeout(this.holdTimer);
      this.holdTimer = setTimeout(() => {
        this.holdFired = true;
        this.openCalibrateDialog();
      }, CONFIG.CALIBRATE_HOLD_MS);
    });
    button.addEventListener('pointerup', () => {
      if (this.holdFired) return;
      clearTimeout(this.holdTimer);
      this.calibrateNow();
    });
    button.addEventListener('pointercancel', () => clearTimeout(this.holdTimer));
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.calibrateNow();
      }
    });
  }

  openCalibrateDialog() {
    const dialog = this.el.dialog;
    if (dialog.open) return;
    this.el.range.value = String(this.cal.maxAngle);
    this.el.rangeValue.textContent = `${this.cal.maxAngle}°`;
    dialog.returnValue = '';
    dialog.showModal();
  }

  /** Guarda baseAlpha/baseBeta: desde aquí, apuntar así es el centro de la pantalla. */
  calibrateNow(maxAngle = this.cal.maxAngle) {
    this.cal.maxAngle = clamp(Math.round(maxAngle), CONFIG.AIM_MAX_ANGLE_MIN, CONFIG.AIM_MAX_ANGLE_MAX);
    this.saveGunPrefs();
    if (!this.sensorsOn) {
      Haptics.play(VIB.EMPTY);
      this.flashCalibrateLabel('SIN GIROSCOPIO');
      return false;
    }
    this.cal.baseAlpha = this.raw.alpha;
    this.cal.baseBeta = this.raw.beta;
    this.cal.set = true;
    this.aim = { x: 0, y: 0 };
    this.sent = { x: 0, y: 0 };
    Haptics.play(VIB.CALIBRATED);
    this.flashCalibrateLabel('✓ CENTRO FIJADO');
    this.client.send({ t: 'calibrated', maxAngle: this.cal.maxAngle });
    this.client.send({ t: 'aim', x: 0, y: 0 });
    return true;
  }

  flashCalibrateLabel(text) {
    const button = this.el.calibrate;
    clearTimeout(this.labelTimer);
    button.textContent = text;
    this.labelTimer = setTimeout(() => {
      button.textContent = this.calibrateLabel;
    }, 1300);
  }

  /* ── Gatillos a dos manos ── */

  bindTrigger(button, action) {
    const release = () => button.classList.remove('is-pressed');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      try {
        button.setPointerCapture(event.pointerId);
      } catch {
        /* sin captura de puntero */
      }
      button.classList.add('is-pressed');
      action();
    });
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
    button.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault();
        button.classList.add('is-pressed');
        action();
      }
    });
    button.addEventListener('keyup', release);
  }

  canAct() {
    const s = this.state;
    return s.phase === 'game' && s.active && s.alive && !s.paused;
  }

  fire() {
    if (!this.client.connected) {
      Haptics.play(VIB.EMPTY);
      return;
    }
    const t = now();
    if (t - this.lastFireAt < CONFIG.FIRE_INTERVAL_MS) return;
    this.lastFireAt = t;
    const s = this.state;
    if (this.canAct() && s.ammo > 0 && !s.reloading) {
      // Recoil: vibración seca y corta + sacudida visual del panel
      Haptics.play(VIB.SHOT);
      restartClass(this.el.pad, 'is-recoil');
      s.ammo -= 1;
      this.render();
    } else {
      Haptics.play(VIB.EMPTY);
    }
    this.client.send({ t: 'fire', ...this.shotAim() });
  }

  throwGrenade() {
    if (!this.client.connected) {
      Haptics.play(VIB.EMPTY);
      return;
    }
    const t = now();
    if (t - this.lastGrenadeAt < CONFIG.GRENADE_COOLDOWN_MS) return;
    const s = this.state;
    if (this.canAct() && s.grenades > 0) {
      this.lastGrenadeAt = t;
      s.grenades -= 1;
      Haptics.play(VIB.LAUNCH);
      this.startCooldown(this.el.grenade, CONFIG.GRENADE_COOLDOWN_MS);
      this.render();
    } else {
      Haptics.play(VIB.EMPTY);
    }
    this.client.send({ t: 'grenade', ...this.shotAim() });
  }

  startCooldown(button, ms) {
    button.classList.add('is-cooldown');
    clearTimeout(this.cooldownTimer);
    this.cooldownTimer = setTimeout(() => button.classList.remove('is-cooldown'), ms);
  }

  /* ── Pintado del panel ── */

  render() {
    const s = this.state;
    this.el.tank.forEach((cell, i) => cell.classList.toggle('is-spent', i >= s.ammo));
    this.el.count.textContent = String(s.ammo);
    this.el.tankList.setAttribute('aria-label', `Munición: ${s.ammo} de ${s.max}`);
    this.el.rack.forEach((cell, i) => cell.classList.toggle('is-spent', i >= s.grenades));
    this.el.rackList.setAttribute('aria-label', `Granadas: ${s.grenades} de ${s.gmax}`);
    const inPlay = s.phase === 'game' && s.active && s.alive;
    const pad = this.el.pad;
    pad.classList.toggle('is-empty', inPlay && s.ammo === 0 && !s.reloading);
    pad.classList.toggle('is-reloading', inPlay && s.reloading);
    pad.classList.toggle('is-no-grenades', s.grenades === 0);
    pad.classList.toggle('is-paused', s.paused);
  }

  renderLink() {
    let text = 'SIN ENLACE';
    if (this.client.connected) {
      const latency = this.client.latency != null ? ` · ${this.client.latency}MS` : '';
      text = `SALA ${this.room}${latency}`;
      if (this.sensorProblem) text += ' · SIN GIROSCOPIO';
    } else if (this.client.wantConnected) {
      text = 'RECONECTANDO…';
    }
    this.el.link.textContent = text;
  }
}


/* ───────────────────────────── 11. ARRANQUE ───────────────────────────── */

const app = {
  bus: new EventBus(),
  settings: null,
  audio: null,
  arcade: null,
  gun: null,
};

function startGun(options) {
  if (app.gun) return app.gun;
  app.gun = new Gun(app).init(options);
  return app.gun;
}

function bootstrap() {
  app.settings = new Settings(app.bus);
  app.audio = new AudioManager(app.settings, app.bus);
  const params = new URLSearchParams(location.search);
  const room = (params.get('sala') || '').trim().toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(room)) {
    // Llegó desde el QR: este dispositivo es un mando pistola
    startGun({ room, player: params.get('j') });
    return;
  }
  app.arcade = new Arcade(app);
  app.arcade.init();
}

window.FormulaAzul = Object.freeze({
  CONFIG,
  registerWorld,
  get app() {
    return app;
  },
});

// Los módulos se ejecutan con el DOM ya leído; la microtarea deja que la
// Parte 2 (más abajo en este mismo archivo) se registre antes del arranque.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  queueMicrotask(bootstrap);
}


/* ═══════════════════════════════════════════════════════════════════════
   script.js · PARTE 2 (Entrega 3) — MOTOR 3D PS1 / N64
   ───────────────────────────────────────────────────────────────────────
   · Three.js a 320×240 con THREE.NearestFilter, vertex snapping (temblor
     poligonal de PS1) y niebla densa estilo N64. Se carga con import()
     dinámico solo en el PC: los celulares nunca descargan Three.js, y si
     WebGL falla la máquina sigue funcionando con el Campo de Tiro.
   · Attract mode: cámara de seguridad sobre la avenida con zombies que
     golpean un carro, babas, barriles que derraman lodo, fuego y humo.
   · Intro: el planeta contaminado, la ciudad caída, la Fórmula Azul y la
     llegada del escuadrón con trajes NBQ y máscaras de visor cian.
   · Nivel 1 sobre rieles: Avenida → Calle del Mercado → Plaza Génesis, con
     oleadas de zombies y babas que escupen proyectiles verdes
     destructibles, botiquines, cajas de granadas, barriles explosivos y
     el Boss MADRE BABA. Todo enemigo brilla en azul 100 ms al recibir daño
     y se disuelve en partículas azules al morir.
   · Brazos y rifles FA-7 en primera persona (uno por jugador): tanques
     transparentes que muestran la munición y lanzagranadas LG-40 inferior.
   Igual que la Parte 1: ni una línea toca .style.
   ═══════════════════════════════════════════════════════════════════════ */


/* ───────────────────────────── 12. CONSTANTES DEL MOTOR ───────────────── */

let THREE = null;

const ENGINE = Object.freeze({
  FOV: 60,
  NEAR: 0.1,
  FAR: 140,
  FOG_COLOR: 0x2b3b2f,
  FOG_NEAR: 7,
  FOG_FAR: 46,
  SNAP_RES: Object.freeze([160, 120]),
  EYE_HEIGHT: 1.65,
  WALK_SPEED: 3.6,
  READY_DELAY_S: 2.4,
  WAVE_CLEAR_DELAY_S: 0.9,
  CLEAR_AFTER_BOSS_S: 2.2,
  ATTRACT_CUT_S: 8,
  SHOT_S: 3.4,
  FLASH_S: 0.1,
  DISSOLVE_S: 0.45,
  BULLET_RANGE: 70,
  GRENADE_RADIUS: 4.5,
  GRENADE_DAMAGE: 3,
  BARREL_RADIUS: 3.8,
  BARREL_DAMAGE: 3,
  ZOMBIE_HP: 3,
  SLIME_HP: 2,
  BOSS_HP: 150,
  COOP_HP_SCALE: 0.34,
  TEXTURE_TIMEOUT_MS: 6000,
  BLUE: 0x2fa8ff,
  BLUE_HOT: 0x7fe8ff,
  BLUE_WHITE: 0xe6ffff,
  GREEN: 0x41d23f,
  GREEN_HOT: 0x8cff5c,
  SCORE: Object.freeze({
    zombie: 100,
    slime: 150,
    headshot: 50,
    spit: 20,
    barrel: 50,
    pickup: 50,
    bossHit: 10,
    bossCore: 30,
    bossEye: 250,
    bossKill: 5000,
  }),
});

/* Recorrido del riel (x, z) y oleadas de cada parada */
const RAIL_NODES = Object.freeze([
  { p: [0, 5] },
  { p: [0, -12], stop: 'avenida-1' },
  { p: [0, -30], stop: 'avenida-2' },
  { p: [0, -50], stop: 'avenida-3' },
  { p: [0, -60] },
  { p: [3.4, -65] },
  { p: [9, -66], section: 2 },
  { p: [16, -66], stop: 'mercado-1' },
  { p: [33, -66], stop: 'mercado-2' },
  { p: [49, -66], section: 3 },
  { p: [57, -66], stop: 'boss' },
]);

const WAVES = Object.freeze({
  'avenida-1': {
    focus: [0, 1.35, -24],
    spawns: [
      { type: 'zombie', x: -2.6, z: -22, delay: 0 },
      { type: 'zombie', x: 2.3, z: -25, delay: 1.1 },
      { type: 'zombie', x: 0.3, z: -28, delay: 2.2 },
      { type: 'zombie', x: -1.2, z: -30, delay: 3.2, coop: true },
    ],
    items: [{ kind: 'medkit', at: [3.9, 1.45, -19.6] }],
  },
  'avenida-2': {
    focus: [0, 1.4, -42],
    spawns: [
      { type: 'zombie', x: 3.0, z: -38, delay: 0 },
      { type: 'slime', x: -2.4, z: -43, delay: 0.6 },
      { type: 'zombie', x: -3.4, z: -37, delay: 1.6 },
      { type: 'zombie', x: 1.2, z: -44.5, delay: 2.8 },
      { type: 'slime', x: 2.6, z: -46, delay: 2.2, coop: true },
    ],
    items: [],
  },
  'avenida-3': {
    focus: [0, 1.4, -62],
    spawns: [
      { type: 'zombie', x: -3.6, z: -61, delay: 0 },
      { type: 'zombie', x: 3.6, z: -63, delay: 0.6 },
      { type: 'zombie', x: 0, z: -66, delay: 1.3 },
      { type: 'slime', x: -1.5, z: -68, delay: 1.9 },
      { type: 'zombie', x: 2.0, z: -69, delay: 2.6 },
      { type: 'zombie', x: -2.6, z: -70, delay: 3.4, coop: true },
    ],
    items: [{ kind: 'crate', at: [-4.1, 1.2, -55.5] }],
  },
  'mercado-1': {
    focus: [28, 1.4, -66],
    spawns: [
      { type: 'slime', x: 26, z: -68.6, delay: 0 },
      { type: 'zombie', x: 24, z: -64, delay: 0.5 },
      { type: 'slime', x: 29, z: -63.4, delay: 1.2 },
      { type: 'zombie', x: 30, z: -69, delay: 2.0 },
      { type: 'zombie', x: 32, z: -64.5, delay: 2.8, coop: true },
    ],
    items: [{ kind: 'medkit', at: [21.5, 1.45, -61.9] }],
  },
  'mercado-2': {
    focus: [46, 1.4, -66],
    spawns: [
      { type: 'zombie', x: 42, z: -63.5, delay: 0 },
      { type: 'zombie', x: 44, z: -68.5, delay: 0.5 },
      { type: 'slime', x: 49, z: -66.5, delay: 1.0 },
      { type: 'zombie', x: 46, z: -65.5, delay: 1.4 },
      { type: 'zombie', x: 48, z: -62.8, delay: 2.1 },
      { type: 'slime', x: 50, z: -69.8, delay: 2.6, coop: true },
    ],
    items: [
      { kind: 'crate', at: [39.5, 1.2, -70.2] },
      { kind: 'medkit', at: [39, 1.4, -61.8] },
    ],
  },
});

const BOSS_CENTER = Object.freeze([72, -66]);
const BOSS_FOCUS = Object.freeze([72, 3.9, -66]);
const BOSS_SCALE = 1.15;
const EXPLOSIVE_BARRELS = Object.freeze([[-2.0, -27.4], [3.3, -47.8], [27.6, -70.0], [44.6, -62.0]]);

/* Planos de la cámara de seguridad del menú */
const ATTRACT_CAMS = Object.freeze([
  { pos: [3.6, 6.4, -7], look: [-1.2, 0.6, -23], pan: 0.26, period: 14 },
  { pos: [-3.4, 3.4, -38.5], look: [0.6, 0.8, -22], pan: 0.16, period: 11 },
  { pos: [3.6, 1.4, -13.5], look: [-1.5, 1.2, -24], pan: 0.18, period: 9 },
]);

/* Carros (x, z, giro, en llamas) y barriles decorativos que gotean lodo */
const CARS = Object.freeze([
  [3.1, -19.5, 0.15, false],
  [-3.3, -30.5, -0.4, true],
  [2.8, -40.5, 0.3, false],
  [-3.0, -55, 2.9, true],
  [12, -63.2, 1.5, false],
  [26, -69.4, 1.7, true],
  [40.5, -62.6, 1.4, false],
  [62, -54, 0.8, true],
]);

const LEAKING_BARRELS = Object.freeze([
  [-3.6, -21, false], [-3.9, -21.9, true], [3.9, -36, false], [-3.8, -46, true],
  [3.6, -58, false], [20, -62.5, true], [33, -70.3, false], [48, -63, true],
  [66, -58, false], [64, -74, true],
]);


/* ───────────────────────────── 13. UTILIDADES 3D ──────────────────────── */

const easeOut = (t) => 1 - (1 - t) * (1 - t);
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);
const distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function lerpAngle(a, b, t) {
  let d = (b - a + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return a + (d - Math.PI) * t;
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruido de valor 2D con periodo en X (sirve para texturas equirectangulares). */
function makeNoise2D(seed) {
  const rng = mulberry32(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i += 1) table[i] = rng();
  const at = (x, y) => table[((y & 255) * size) + (x & 255)];
  return (x, y, period) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const xa = ((x0 % period) + period) % period;
    const xb = (xa + 1) % period;
    const top = lerp(at(xa, y0), at(xb, y0), sx);
    const bottom = lerp(at(xa, y0 + 1), at(xb, y0 + 1), sx);
    return lerp(top, bottom, sy);
  };
}

/**
 * Pipeline PS1: cada vértice se redondea a una rejilla de pantalla baja
 * (160×120) después de proyectarse, lo que produce el temblor poligonal.
 */
const PS1 = {
  uniforms: null,

  init(enabled) {
    this.uniforms = {
      uSnapRes: { value: new THREE.Vector2(ENGINE.SNAP_RES[0], ENGINE.SNAP_RES[1]) },
      uSnap: { value: enabled ? 1 : 0 },
    };
  },

  set(enabled) {
    if (this.uniforms) this.uniforms.uSnap.value = enabled ? 1 : 0;
  },

  patch(material) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uSnapRes = PS1.uniforms.uSnapRes;
      shader.uniforms.uSnap = PS1.uniforms.uSnap;
      shader.vertexShader = `uniform vec2 uSnapRes;\nuniform float uSnap;\n${shader.vertexShader}`.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        if ( uSnap > 0.5 ) {
          vec2 grid = uSnapRes * 0.5;
          vec2 ndc = gl_Position.xy / gl_Position.w;
          gl_Position.xy = floor( ndc * grid + 0.5 ) / grid * gl_Position.w;
        }`,
      );
    };
    material.customProgramCacheKey = () => 'ps1-vertex-snap';
    return material;
  },
};

const lambert = (params) => PS1.patch(new THREE.MeshLambertMaterial(params));
const basic = (params) => PS1.patch(new THREE.MeshBasicMaterial(params));
const cloneMat = (material) => PS1.patch(material.clone());

function pixelate(texture, repeat = true) {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  return texture;
}

/** UV de caja proporcionales a su tamaño: la textura no se estira. */
function boxUV(geometry, w, h, d, unit) {
  const uv = geometry.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face += 1) {
    for (let v = 0; v < 4; v += 1) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) * dims[face][0] / unit, uv.getY(i) * dims[face][1] / unit);
    }
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Plano horizontal con la textura repetida cada unitU × unitV metros. */
function planeXZ(w, l, unitU, unitV = unitU) {
  const geometry = new THREE.PlaneGeometry(w, l);
  geometry.rotateX(-Math.PI / 2);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * w / unitU, uv.getY(i) * l / unitV);
  uv.needsUpdate = true;
  return geometry;
}

class TextureBank {
  constructor() {
    this.manager = new THREE.LoadingManager();
    this.loader = new THREE.TextureLoader(this.manager);
    this.cache = new Map();
    this.done = new Promise((resolve) => {
      this.manager.onLoad = resolve;
    });
    this.manager.onError = (url) => console.warn('[textura]', url);
  }

  /** Textura compartida (una sola copia en GPU). */
  get(name) {
    if (!this.cache.has(name)) this.cache.set(name, this.load(name));
    return this.cache.get(name);
  }

  /** Textura independiente, para animar su offset sin afectar a las demás. */
  load(name) {
    return pixelate(this.loader.load(`img/${name}.png`));
  }
}


/* ───────────────────────────── 14. EFECTOS ────────────────────────────── */

/** Partículas cuadradas (THREE.Points) recicladas en un anillo. */
class ParticleField {
  constructor(scene, count, { additive = false, size = 0.12 } = {}) {
    this.count = count;
    this.cursor = 0;
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.base = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grav = new Float32Array(count);
    for (let i = 0; i < count; i += 1) this.pos[i * 3 + 1] = -999;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.color = new THREE.Color();
    this.dirty = false;
  }

  emit(origin, { count = 20, speed = 3, colors = [ENGINE.BLUE_HOT], life = 0.6, gravity = 6, up = 0.6, spread = 0.15 } = {}) {
    for (let n = 0; n < count; n += 1) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      const k = i * 3;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.35 + Math.random() * 0.65);
      this.pos[k] = origin.x + (Math.random() - 0.5) * spread;
      this.pos[k + 1] = origin.y + (Math.random() - 0.5) * spread;
      this.pos[k + 2] = origin.z + (Math.random() - 0.5) * spread;
      this.vel[k] = Math.sin(phi) * Math.cos(theta) * s;
      this.vel[k + 1] = Math.cos(phi) * s + up * s;
      this.vel[k + 2] = Math.sin(phi) * Math.sin(theta) * s;
      this.color.setHex(colors[Math.floor(Math.random() * colors.length)]);
      this.base[k] = this.color.r;
      this.base[k + 1] = this.color.g;
      this.base[k + 2] = this.color.b;
      this.col[k] = this.color.r;
      this.col[k + 1] = this.color.g;
      this.col[k + 2] = this.color.b;
      this.life[i] = life * (0.6 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i];
      this.grav[i] = gravity;
    }
    this.dirty = true;
  }

  update(dt) {
    let alive = false;
    for (let i = 0; i < this.count; i += 1) {
      if (this.life[i] <= 0) continue;
      alive = true;
      const k = i * 3;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[k + 1] = -999;
        continue;
      }
      this.vel[k + 1] -= this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
    }
    if (alive || this.dirty) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
      this.dirty = false;
    }
  }

  clear() {
    this.life.fill(0);
    for (let i = 0; i < this.count; i += 1) this.pos[i * 3 + 1] = -999;
    this.dirty = true;
  }
}

/** Trazas azul eléctrico de las balas (líneas de 1 píxel a 320×240). */
class TracerPool {
  constructor(scene, size = 10) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < size; i += 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const material = new THREE.LineBasicMaterial({
        color: ENGINE.BLUE_HOT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.items.push({ line, life: 0 });
    }
  }

  fire(from, to) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const attr = item.line.geometry.attributes.position;
    attr.setXYZ(0, from.x, from.y, from.z);
    attr.setXYZ(1, to.x, to.y, to.z);
    attr.needsUpdate = true;
    item.life = 0.07;
    item.line.material.opacity = 1;
    item.line.visible = true;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      item.line.material.opacity = Math.max(0, item.life / 0.07);
      if (item.life <= 0) item.line.visible = false;
    }
  }

  clear() {
    for (const item of this.items) {
      item.life = 0;
      item.line.visible = false;
    }
  }
}

/**
 * Explosiones: esfera aditiva que crece + luz puntual. Las luces viven
 * siempre en la escena (con intensidad 0) para que Three.js no recompile
 * los shaders cada vez que aparece una.
 */
class BlastPool {
  constructor(scene, size = 3) {
    this.items = [];
    this.cursor = 0;
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < size; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: ENGINE.BLUE_HOT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      const light = new THREE.PointLight(ENGINE.BLUE, 0, 16, 1.4);
      scene.add(mesh, light);
      this.items.push({ mesh, light, t: 1, life: 0.42, radius: 4, peak: 0 });
    }
  }

  spawn(position, { color = ENGINE.BLUE_HOT, radius = 4.5, light = 40 } = {}) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    item.t = 0;
    item.radius = radius;
    item.peak = light;
    item.mesh.material.color.setHex(color);
    item.light.color.setHex(color);
    item.mesh.position.copy(position);
    item.light.position.copy(position).y += 0.6;
    item.mesh.visible = true;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.t >= 1) continue;
      item.t = Math.min(1, item.t + dt / item.life);
      const k = item.t;
      item.mesh.scale.setScalar(lerp(0.3, item.radius, easeOut(k)));
      item.mesh.material.opacity = 1 - k;
      item.light.intensity = item.peak * (1 - k) * (1 - k);
      if (k >= 1) {
        item.mesh.visible = false;
        item.light.intensity = 0;
      }
    }
  }

  clear() {
    for (const item of this.items) {
      item.t = 1;
      item.mesh.visible = false;
      item.light.intensity = 0;
    }
  }
}

/** Humo de los incendios: sprites que suben, crecen y se desvanecen. */
class SmokeSystem {
  constructor(scene, texture, size = 28) {
    this.items = [];
    this.cursor = 0;
    for (let i = 0; i < size; i += 1) {
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0, color: 0x9aa59a });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.items.push({ sprite, life: 0, max: 1, vy: 1, drift: 0 });
    }
  }

  emit(position) {
    const item = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    item.sprite.position.set(position.x + (Math.random() - 0.5) * 0.4, position.y, position.z + (Math.random() - 0.5) * 0.4);
    item.max = 2.6 + Math.random();
    item.life = item.max;
    item.vy = 1 + Math.random() * 0.6;
    item.drift = (Math.random() - 0.5) * 0.4;
    item.sprite.visible = true;
  }

  update(dt) {
    for (const item of this.items) {
      if (item.life <= 0) continue;
      item.life -= dt;
      const k = 1 - item.life / item.max;
      item.sprite.position.y += item.vy * dt;
      item.sprite.position.x += item.drift * dt;
      const scale = 0.8 + k * 2.6;
      item.sprite.scale.set(scale, scale, 1);
      item.sprite.material.opacity = 0.5 * (1 - k) * Math.min(1, k * 6);
      if (item.life <= 0) item.sprite.visible = false;
    }
  }
}


/* ───────────────────────────── 15. ACTORES ────────────────────────────── */

/**
 * Base de todo lo que se puede dañar: guarda sus materiales para el flash
 * azul de 100 ms y para la disolución en partículas azules.
 */
class Actor {
  constructor(world, kind) {
    this.world = world;
    this.kind = kind;
    this.group = new THREE.Group();
    this.alive = true;
    this.dying = false;
    this.removed = false;
    this.dieT = 0;
    this.hp = 1;
    this.maxHp = 1;
    this.flashT = 0;
    this.flashMats = [];
    this.parts = [];
    this.radius = 0.5;
    this.centerY = 1;
    this.lastPart = null;
    this.t = Math.random() * 10;
  }

  material(base) {
    const material = cloneMat(base);
    this.flashMats.push({
      material,
      color: material.color.getHex(),
      emissive: material.emissive ? material.emissive.getHex() : null,
      emissiveIntensity: material.emissiveIntensity ?? 1,
    });
    return material;
  }

  hitPart(mesh, part) {
    mesh.userData.target = this;
    mesh.userData.part = part;
    this.parts.push(mesh);
    return mesh;
  }

  /** Brillo azul eléctrico de impacto (100 ms). */
  flash() {
    this.flashT = ENGINE.FLASH_S;
    for (const f of this.flashMats) {
      if (f.material.emissive) {
        f.material.emissive.setHex(ENGINE.BLUE);
        f.material.emissiveIntensity = 1.6;
      } else {
        f.material.color.setHex(ENGINE.BLUE_HOT);
      }
    }
  }

  updateFlash(dt) {
    if (this.flashT <= 0 || this.dying) return;
    this.flashT -= dt;
    if (this.flashT > 0) return;
    for (const f of this.flashMats) {
      f.material.color.setHex(f.color);
      if (f.material.emissive) {
        f.material.emissive.setHex(f.emissive);
        f.material.emissiveIntensity = f.emissiveIntensity;
      }
    }
  }

  center() {
    return this.group.position.clone().setY(this.group.position.y + this.centerY);
  }

  onShot(playerId, hit) {
    const part = hit.object.userData.part;
    this.damage(part === 'head' ? 2 : 1, playerId, hit.point, part);
  }

  onBlast(playerId, amount) {
    this.damage(amount, playerId, this.center(), 'blast');
  }

  damage(amount, playerId, point, part) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastPart = part;
    this.flash();
    if (point) this.world.sparks(point);
    if (this.hp <= 0) this.kill(playerId);
  }

  kill(playerId, { scored = true } = {}) {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.dieT = 0;
    for (const mesh of this.parts) this.world.removeTarget(mesh);
    for (const f of this.flashMats) {
      f.material.transparent = true;
      if (f.material.emissive) {
        f.material.emissive.setHex(ENGINE.BLUE);
        f.material.emissiveIntensity = 1.6;
      } else {
        f.material.color.setHex(ENGINE.BLUE_HOT);
      }
    }
    this.world.dissolve(this);
    if (scored) this.world.onActorKilled(this, playerId);
  }

  updateDying(dt) {
    this.dieT += dt;
    const k = clamp(this.dieT / ENGINE.DISSOLVE_S, 0, 1);
    for (const f of this.flashMats) f.material.opacity = 1 - k;
    this.group.scale.set(1 + k * 0.25, 1 - k * 0.7, 1 + k * 0.25);
    if (k >= 1) this.dispose();
  }

  dispose() {
    this.removed = true;
    this.alive = false;
    this.group.removeFromParent();
    for (const mesh of this.parts) this.world.removeTarget(mesh);
  }

  faceToward(x, z, dt, rate = 6) {
    const yaw = Math.atan2(x - this.group.position.x, z - this.group.position.z);
    this.group.rotation.y = lerpAngle(this.group.rotation.y, yaw, 1 - Math.exp(-dt * rate));
  }

  moveToward(target, speed, dt) {
    const p = this.group.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.001) {
      const step = Math.min(dist, speed * dt);
      p.x += (dx / dist) * step;
      p.z += (dz / dist) * step;
    }
    return dist;
  }
}

/** Zombie contaminado: camina hacia la cámara y golpea a quien tenga delante. */
class Zombie extends Actor {
  constructor(world, position, { mode = 'hunt', path = null, smash = null, rise = true, lane = 0 } = {}) {
    super(world, 'zombie');
    const m = world.mats;
    const G = world.geometries;
    this.skin = this.material(m.zombieSkin);
    this.cloth = this.material(m.zombieCloth);
    this.glow = this.material(m.slimeGlow);
    this.group.position.copy(position);
    this.body = new THREE.Group();
    this.group.add(this.body);
    const part = (geometry, material, x, y, z, name, parent = this.body) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      if (name) this.hitPart(mesh, name);
      return mesh;
    };
    this.legL = part(G.zLeg, this.cloth, -0.13, 0.92, 0, 'body');
    this.legR = part(G.zLeg, this.cloth, 0.13, 0.92, 0, 'body');
    this.torso = part(G.zTorso, this.cloth, 0, 1.28, 0.02, 'body');
    this.torso.rotation.x = 0.28;
    this.head = part(G.zHead, this.skin, 0, 1.79, 0.1, 'head');
    part(G.zJaw, this.skin, 0, 1.63, 0.17, 'head');
    part(G.zEye, this.glow, -0.075, 1.83, 0.265);
    part(G.zEye, this.glow, 0.075, 1.83, 0.265);
    this.armL = part(G.zArm, this.skin, -0.37, 1.58, 0.05, 'body');
    this.armR = part(G.zArm, this.skin, 0.37, 1.58, 0.05, 'body');
    part(G.zBlob, this.glow, 0.16, 1.4, 0.2);
    part(G.zBlob, this.glow, -0.2, 1.16, 0.19);
    part(G.zBlob, this.glow, 0, -0.42, 0.09, null, this.armL);
    this.mode = mode;
    this.path = path;
    this.pathIndex = 0;
    this.smash = smash;
    this.lane = lane;
    this.speed = 0.95 + Math.random() * 0.45;
    this.attackTimer = 0.8;
    this.striking = 0;
    this.smashTimer = Math.random();
    this.groanTimer = 2 + Math.random() * 5;
    this.rise = rise ? 0 : 1;
    if (rise) this.group.position.y = -1.9;
    this.hp = Math.max(1, Math.round(ENGINE.ZOMBIE_HP * world.hpScale));
    this.maxHp = this.hp;
    this.radius = 0.45;
    this.centerY = 1.2;
  }

  update(dt) {
    this.updateFlash(dt);
    if (this.dying) {
      this.updateDying(dt);
      return;
    }
    this.t += dt;
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / 0.9);
      this.group.position.y = lerp(-1.9, 0, easeOut(this.rise));
      this.armL.rotation.x = lerp(-2.8, -1.35, this.rise);
      this.armR.rotation.x = this.armL.rotation.x;
      if (Math.random() < 0.35) this.world.fxSlime.emit(this.group.position, { count: 2, speed: 1.6, life: 0.5, gravity: 7, colors: [ENGINE.GREEN, ENGINE.GREEN_HOT] });
      const cam = this.world.camera.position;
      this.faceToward(cam.x, cam.z, dt, 8);
      return;
    }
    if (this.mode === 'hunt') this.hunt(dt);
    else if (this.mode === 'wander') this.wander(dt);
    else if (this.mode === 'smash') this.doSmash(dt);
  }

  walkAnim(amount) {
    const s = Math.sin(this.t * 5.2 * this.speed);
    this.legL.rotation.x = s * 0.55 * amount;
    this.legR.rotation.x = -s * 0.55 * amount;
    this.armL.rotation.x = -1.35 + Math.sin(this.t * 2.6) * 0.12;
    this.armR.rotation.x = -1.35 + Math.cos(this.t * 2.6) * 0.12;
    this.body.position.y = Math.abs(s) * 0.05 * amount;
    this.body.rotation.z = Math.sin(this.t * 2.6 * this.speed) * 0.07;
  }

  strikeAnim(dt) {
    this.striking += dt * 3.2;
    const s = Math.max(0, Math.sin(this.striking * Math.PI * 2));
    this.armL.rotation.x = -1.7 + s * 1.15;
    this.armR.rotation.x = -1.7 + Math.max(0, Math.sin(this.striking * Math.PI * 2 + 1.2)) * 1.15;
    this.legL.rotation.x = 0;
    this.legR.rotation.x = 0;
    this.body.rotation.x = s * 0.18;
  }

  hunt(dt) {
    const target = this.world.attackPoint(this.lane);
    this.world.separate(this);
    const cam = this.world.camera.position;
    const dist = distXZ(this.group.position, target);
    if (dist > 0.3) {
      this.moveToward(target, this.speed, dt);
      this.walkAnim(1);
      this.faceToward(target.x, target.z, dt);
      this.attackTimer = Math.min(this.attackTimer, 0.6);
      this.body.rotation.x = 0;
    } else {
      this.faceToward(cam.x, cam.z, dt, 8);
      this.strikeAnim(dt);
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.attackTimer = 1.6;
        this.world.zombieStrike(this);
      }
    }
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = 5 + Math.random() * 6;
      this.world.sfxAt('groan', this.group.position, 0.7);
    }
  }

  wander(dt) {
    const [x, z] = this.path[this.pathIndex];
    const target = { x, z };
    const dist = this.moveToward(target, this.speed * 0.55, dt);
    this.faceToward(x, z, dt, 3);
    this.walkAnim(0.8);
    if (dist < 0.3) this.pathIndex = (this.pathIndex + 1) % this.path.length;
  }

  doSmash(dt) {
    const [x, z] = this.smash.look;
    this.faceToward(x, z, dt, 4);
    this.strikeAnim(dt * 0.8);
    this.smashTimer -= dt;
    if (this.smashTimer <= 0) {
      this.smashTimer = 0.95 + Math.random() * 0.3;
      this.world.smashFx(this.smash);
    }
  }
}

/** Criatura de baba verde: salta, se infla y escupe proyectiles verdes. */
class Slime extends Actor {
  constructor(world, position, { mode = 'hunt', home = null, wall = null, rise = true } = {}) {
    super(world, 'slime');
    const m = world.mats;
    const G = world.geometries;
    this.skin = this.material(m.slimeBody);
    this.eyeWhite = this.material(m.white);
    this.group.position.copy(position);
    this.body = new THREE.Mesh(G.slimeBody, this.skin);
    this.group.add(this.body);
    this.hitPart(this.body, 'body');
    for (const x of [-0.24, 0.24]) {
      const eye = new THREE.Mesh(G.slimeEye, this.eyeWhite);
      eye.position.set(x, 0.32, 0.6);
      const pupil = new THREE.Mesh(G.slimePupil, m.black);
      pupil.position.set(0, 0, 0.12);
      eye.add(pupil);
      this.body.add(eye);
      this.hitPart(eye, 'body');
    }
    const mouth = new THREE.Mesh(G.slimeMouth, m.black);
    mouth.position.set(0, 0.02, 0.7);
    this.body.add(mouth);
    this.mouth = mouth;
    this.mode = mode;
    this.home = home ? home.clone() : position.clone();
    this.wall = wall;
    this.state = rise ? 'emerge' : 'idle';
    this.timer = 0;
    this.rise = rise ? 0 : 1;
    this.hop = 0;
    this.inflate = 1;
    this.spot = null;
    this.spitTimer = 1.4 + Math.random() * 1.4;
    this.hopTimer = 1 + Math.random() * 2;
    this.hp = Math.max(1, Math.round(ENGINE.SLIME_HP * world.hpScale));
    this.maxHp = this.hp;
    this.radius = 0.8;
    this.centerY = 0.75;
    if (rise) this.group.position.y = -1.5;
  }

  update(dt) {
    this.updateFlash(dt);
    if (this.dying) {
      this.updateDying(dt);
      return;
    }
    this.t += dt;
    const charging = this.state === 'charge';
    this.inflate = lerp(this.inflate, charging ? 1.28 : 1, 1 - Math.exp(-dt * 8));
    const squash = 1 + Math.sin(this.t * 6.5) * 0.07 * (charging ? 2.2 : 1);
    const k = this.inflate;
    this.body.scale.set(k / Math.sqrt(squash), k * squash, k / Math.sqrt(squash));
    this.body.position.y = 0.72 * squash * k;
    const cam = this.world.camera.position;
    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + dt / 0.8);
      this.group.position.y = lerp(-1.5, 0, easeOut(this.rise));
      if (this.rise >= 1) this.state = 'move';
      return;
    }
    if (this.mode === 'idle') this.idle(dt);
    else if (this.mode === 'bang') this.bang(dt);
    else this.hunt(dt, cam);
  }

  hunt(dt, cam) {
    if (this.state === 'move') {
      if (!this.spot) this.spot = this.world.slimeSpot();
      this.hop += dt * 2.6;
      this.group.position.y = Math.abs(Math.sin(this.hop * Math.PI)) * 0.45;
      const dist = this.moveToward(this.spot, 2.2, dt);
      this.faceToward(this.spot.x, this.spot.z, dt, 6);
      if (dist < 0.3) {
        this.state = 'idle';
        this.group.position.y = 0;
      }
      return;
    }
    this.faceToward(cam.x, cam.z, dt, 6);
    this.group.position.y = lerp(this.group.position.y, 0, 1 - Math.exp(-dt * 10));
    if (this.state === 'idle') {
      this.spitTimer -= dt;
      if (this.spitTimer <= 0) {
        this.state = 'charge';
        this.timer = 0.55;
      }
    } else if (this.state === 'charge') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.world.spawnSpit(this.mouthPosition(), this.world.randomTarget());
        this.world.sfxAt('spit', this.group.position, 0.9);
        this.spitTimer = 2.6 + Math.random() * 1.2;
        this.state = Math.random() < 0.25 ? 'move' : 'idle';
        if (this.state === 'move') this.spot = null;
      }
    }
  }

  idle(dt) {
    this.hopTimer -= dt;
    if (this.hopTimer <= 0 && !this.spot) {
      this.spot = this.home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      this.hopTimer = 1.5 + Math.random() * 2.5;
    }
    if (this.spot) {
      this.hop += dt * 2.4;
      this.group.position.y = Math.abs(Math.sin(this.hop * Math.PI)) * 0.4;
      this.faceToward(this.spot.x, this.spot.z, dt, 5);
      if (this.moveToward(this.spot, 1.4, dt) < 0.25) {
        this.spot = null;
        this.group.position.y = 0;
      }
    }
  }

  bang(dt) {
    const [x, z] = this.wall;
    this.faceToward(x, z, dt, 5);
    this.hop += dt * 1.6;
    const lunge = Math.max(0, Math.sin(this.hop * Math.PI));
    this.group.position.x = this.home.x + (x - this.home.x) * 0.25 * lunge;
    this.group.position.z = this.home.z + (z - this.home.z) * 0.25 * lunge;
    this.group.position.y = lunge * 0.3;
    if (lunge > 0.98 && this.hopTimer <= 0) {
      this.hopTimer = 0.6;
      this.world.fxSlime.emit(new THREE.Vector3(x, 0.9, z), { count: 10, speed: 2.4, life: 0.5, gravity: 8, colors: [ENGINE.GREEN, ENGINE.GREEN_HOT] });
    }
    this.hopTimer -= dt;
  }

  mouthPosition() {
    return this.mouth.getWorldPosition(new THREE.Vector3());
  }
}

/** Proyectil verde de baba: viaja hacia el soldado y se puede derribar a tiros. */
class Spit {
  constructor(world, from, targetId) {
    this.world = world;
    this.kind = 'spit';
    this.alive = true;
    this.targetId = targetId;
    this.pos = from.clone();
    this.speed = 6.4;
    this.t = 0;
    this.sprite = new THREE.Sprite(world.spriteMats.spit);
    this.sprite.scale.set(0.6, 0.6, 1);
    this.sprite.position.copy(from);
    this.sprite.userData.target = this;
    this.sprite.userData.part = 'spit';
    world.city.add(this.sprite);
    world.addTarget(this.sprite);
  }

  onShot(playerId) {
    this.destroy(playerId, true);
  }

  onBlast(playerId) {
    this.destroy(playerId, true);
  }

  remove() {
    this.alive = false;
    this.world.removeTarget(this.sprite);
    this.sprite.removeFromParent();
  }

  destroy(playerId, scored) {
    if (!this.alive) return;
    this.remove();
    this.world.splat(this.pos);
    if (scored && playerId) this.world.game.addScore(playerId, ENGINE.SCORE.spit, this.world.projectNdc(this.pos));
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    const target = this.world.impactPoint(this.targetId);
    const dir = target.sub(this.pos);
    const dist = dir.length();
    if (dist < 0.5) {
      this.world.spitHit(this);
      return;
    }
    dir.multiplyScalar(Math.min(dist, this.speed * dt) / dist);
    this.pos.add(dir);
    this.sprite.position.copy(this.pos);
    const s = 0.6 + Math.sin(this.t * 20) * 0.06;
    this.sprite.scale.set(s, s, 1);
    if (Math.random() < 0.6) this.world.fxSlime.emit(this.pos, { count: 1, speed: 0.4, life: 0.4, gravity: 2, colors: [ENGINE.GREEN_HOT] });
  }
}

/** Botiquín o caja de granadas flotando: se recoge disparándole. */
class Pickup {
  constructor(world, kind, position, ttl = Infinity) {
    this.world = world;
    this.kind = kind;
    this.alive = true;
    this.ttl = ttl;
    this.t = Math.random() * 6;
    this.baseY = position.y;
    this.sprite = new THREE.Sprite(kind === 'medkit' ? world.spriteMats.medkit : world.spriteMats.crate);
    this.sprite.scale.set(0.8, 0.8, 1);
    this.sprite.position.copy(position);
    this.sprite.userData.target = this;
    this.sprite.userData.part = 'pickup';
    world.city.add(this.sprite);
    world.addTarget(this.sprite);
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    this.ttl -= dt;
    this.sprite.position.y = this.baseY + Math.sin(this.t * 2.2) * 0.12;
    const s = 0.8 + Math.sin(this.t * 5) * 0.06;
    this.sprite.scale.set(s, s, 1);
    if (this.ttl <= 0) this.remove();
  }

  onShot(playerId) {
    if (!this.alive) return;
    this.remove();
    this.world.collect(this, playerId);
  }

  onBlast() {
    /* la granada no recoge objetos: hay que dispararles */
  }

  remove() {
    this.alive = false;
    this.world.removeTarget(this.sprite);
    this.sprite.removeFromParent();
  }
}

/** Barril tóxico explosivo: dos disparos y revienta en un estallido verde y azul. */
class ExplosiveBarrel extends Actor {
  constructor(world, x, z) {
    super(world, 'barrel');
    this.skin = this.material(world.mats.barrelHot);
    this.mesh = new THREE.Mesh(world.geometries.barrel, this.skin);
    this.mesh.position.y = 0.53;
    this.group.add(this.mesh);
    this.group.position.set(x, 0, z);
    this.hitPart(this.mesh, 'barrel');
    world.city.add(this.group);
    this.radius = 0.45;
    this.centerY = 0.6;
    this.reset();
  }

  reset() {
    this.alive = true;
    this.dying = false;
    this.hp = 2;
    this.flashT = 0;
    this.group.visible = true;
    this.world.addTarget(this.mesh);
    for (const f of this.flashMats) {
      f.material.color.setHex(f.color);
      f.material.emissive?.setHex(f.emissive);
    }
  }

  kill(playerId) {
    if (!this.alive) return;
    this.alive = false;
    this.group.visible = false;
    this.world.removeTarget(this.mesh);
    this.world.barrelBlast(this, playerId);
  }

  update(dt) {
    this.updateFlash(dt);
  }
}

/** Granada Purificadora: vuela en parábola desde el LG-40 hasta la mira. */
class GrenadeShell {
  constructor(world, playerId, from, to) {
    this.world = world;
    this.playerId = playerId;
    this.from = from.clone();
    this.to = to.clone();
    const dist = from.distanceTo(to);
    this.dur = 0.42 + dist * 0.022;
    this.arc = 0.8 + dist * 0.14;
    this.t = 0;
    this.alive = true;
    this.mesh = new THREE.Mesh(world.geometries.grenade, world.mats.formulaHot);
    const glow = new THREE.Sprite(world.spriteMats.grenadeGlow);
    glow.scale.set(0.7, 0.7, 1);
    this.mesh.add(glow);
    this.mesh.position.copy(from);
    world.city.add(this.mesh);
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.dur);
    this.mesh.position.lerpVectors(this.from, this.to, k);
    this.mesh.position.y += Math.sin(k * Math.PI) * this.arc;
    this.mesh.rotation.x += dt * 12;
    this.world.fxBlue.emit(this.mesh.position, { count: 2, speed: 0.3, life: 0.35, gravity: 0, colors: [ENGINE.BLUE_HOT, ENGINE.BLUE] });
    if (k >= 1) {
      this.alive = false;
      this.mesh.removeFromParent();
      this.world.explodeGrenade(this);
    }
  }

  dispose() {
    this.alive = false;
    this.mesh.removeFromParent();
  }
}

/**
 * BOSS · MADRE BABA, Coloso Radiactivo. Masa de lodo con cinco ojos y un
 * núcleo verde que se abre al preparar el golpe de tentáculos.
 * Puntos débiles: núcleo (×3, ×6 si está abierto) y ojos (×2).
 */
class MadreBaba extends Actor {
  constructor(world) {
    super(world, 'boss');
    const m = world.mats;
    const G = world.geometries;
    this.flesh = this.material(m.bossFlesh);
    this.goo = this.material(m.slimeBody);
    this.eyeWhite = this.material(m.white);
    this.coreMat = this.material(m.slimeGlow);
    const root = this.group;
    root.position.set(BOSS_CENTER[0], -9, BOSS_CENTER[1]);
    root.rotation.y = -Math.PI / 2;
    root.scale.setScalar(BOSS_SCALE);
    this.rig = new THREE.Group();
    root.add(this.rig);

    this.bodyGeo = new THREE.IcosahedronGeometry(3.3, 2);
    this.basePos = Float32Array.from(this.bodyGeo.attributes.position.array);
    this.bodyGeo.computeBoundingSphere();
    this.bodyGeo.boundingSphere.radius *= 1.25;
    this.body = new THREE.Mesh(this.bodyGeo, this.flesh);
    this.body.position.y = 3.3;
    this.body.scale.set(1.1, 1, 0.95);
    this.rig.add(this.body);
    this.hitPart(this.body, 'body');

    const skirt = new THREE.Mesh(G.bossSkirt, this.goo);
    skirt.position.y = 0.9;
    this.rig.add(skirt);
    this.hitPart(skirt, 'body');
    const pool = new THREE.Mesh(G.bossPool, m.slimePool);
    pool.position.y = 0.09;
    root.add(pool);

    this.eyes = [];
    const layout = [[-1.1, 4.6], [1.15, 4.8], [0, 5.6], [-2.0, 3.6], [2.0, 3.7]];
    for (const [x, y] of layout) {
      const dy = y - 3.3;
      const z = Math.sqrt(Math.max(0.1, 3.3 * 3.3 - x * x - dy * dy)) * 0.95 + 0.12;
      const eye = new THREE.Mesh(G.bossEye, this.eyeWhite);
      eye.position.set(x * 1.08, y, z);
      const pupil = new THREE.Mesh(G.bossPupil, m.pupilRed);
      pupil.position.z = 0.32;
      eye.add(pupil);
      this.rig.add(eye);
      this.hitPart(eye, 'eye');
      this.eyes.push({ mesh: eye, hp: 6, alive: true, phase: Math.random() * 6 });
    }

    this.core = new THREE.Mesh(G.bossCore, this.coreMat);
    this.core.position.set(0, 2.4, 3.25);
    this.rig.add(this.core);
    this.hitPart(this.core, 'core');
    const mouth = new THREE.Mesh(G.bossMouth, m.black);
    mouth.position.set(0, 2.4, 3.05);
    this.rig.add(mouth);
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      const tooth = new THREE.Mesh(G.bossTooth, m.white);
      tooth.position.set(Math.cos(a) * 1.0, 2.4 + Math.sin(a) * 1.0, 3.2);
      tooth.rotation.z = a + Math.PI / 2;
      this.rig.add(tooth);
    }

    this.tentacles = [];
    const bases = [[-3.3, 1.4, 1.0], [3.3, 1.4, 1.0], [-2.5, 0.8, 2.4], [2.5, 0.8, 2.4]];
    for (const [bx, by, bz] of bases) {
      const segments = [];
      for (let s = 0; s < 7; s += 1) {
        const r = lerp(0.5, 0.18, s / 6);
        const seg = new THREE.Mesh(G.unitSphere, this.goo);
        seg.scale.setScalar(r);
        this.rig.add(seg);
        this.hitPart(seg, 'body');
        segments.push(seg);
      }
      this.tentacles.push({ base: new THREE.Vector3(bx, by, bz), segments, side: Math.sign(bx) });
    }

    this.hp = Math.round(ENGINE.BOSS_HP * (1 + 0.6 * (world.playerCount() - 1)));
    this.maxHp = this.hp;
    this.radius = 4.5 * BOSS_SCALE;
    this.centerY = 3.3 * BOSS_SCALE;
    this.state = 'emerge';
    this.timer = 3.6;
    this.phase = 1;
    this.spitsLeft = 0;
    this.spitTimer = 0;
    this.staggerDamage = 0;
    this.coreOpen = 0;
    this.slamAmt = 0;
    this.burstTimer = 0;
    this.nextSpitTarget = 1;
  }

  update(dt) {
    this.updateFlash(dt);
    this.t += dt;
    this.timer -= dt;
    this.animateBody(dt);
    if (this.dying) {
      this.updateDying(dt);
      return;
    }
    const root = this.group;
    switch (this.state) {
      case 'emerge': {
        const k = clamp(1 - this.timer / 3.6, 0, 1);
        root.position.y = lerp(-9, 0, easeOut(k));
        if (Math.random() < 0.6) this.world.fxSlime.emit(new THREE.Vector3(root.position.x + (Math.random() - 0.5) * 8, 0.3, root.position.z + (Math.random() - 0.5) * 8), { count: 4, speed: 4, life: 0.8, gravity: 9, colors: [ENGINE.GREEN, ENGINE.GREEN_HOT] });
        this.world.shake(0.05);
        if (this.timer <= 0) this.next('idle', 1.4);
        break;
      }
      case 'idle':
        if (this.timer <= 0) this.chooseAttack();
        break;
      case 'barrage-charge':
        if (this.timer <= 0) {
          this.state = 'barrage';
          this.spitsLeft = this.phase === 1 ? 3 : 5;
          this.spitTimer = 0;
        }
        break;
      case 'barrage':
        this.spitTimer -= dt;
        if (this.spitTimer <= 0 && this.spitsLeft > 0) {
          this.spitsLeft -= 1;
          this.spitTimer = 0.28;
          this.world.spawnSpit(this.core.getWorldPosition(new THREE.Vector3()), this.pickSpitTarget());
          this.world.sfxAt('spit', this.center(), 1);
        }
        if (this.spitsLeft === 0 && this.spitTimer <= 0) this.next('idle', this.phase === 1 ? 2.2 : 1.4);
        break;
      case 'summon':
        if (this.timer <= 0.6 && !this.summoned) {
          this.summoned = true;
          this.world.spawnEnemy('slime', new THREE.Vector3(BOSS_CENTER[0] - 6.5, 0, BOSS_CENTER[1] + 3.8), { minion: true });
          this.world.spawnEnemy('slime', new THREE.Vector3(BOSS_CENTER[0] - 6.5, 0, BOSS_CENTER[1] - 3.8), { minion: true });
          this.world.sfxAt('emerge', this.center(), 1);
        }
        if (this.timer <= 0) this.next('idle', 1.6);
        break;
      case 'slam-raise':
        this.slamAmt = lerp(this.slamAmt, 1, 1 - Math.exp(-dt * 3));
        this.coreOpen = lerp(this.coreOpen, 1, 1 - Math.exp(-dt * 4));
        if (this.staggerDamage >= 12 * this.world.playerCount()) {
          this.world.sfxAt('roar', this.center(), 0.8);
          this.next('stagger', 2.2);
        } else if (this.timer <= 0) {
          this.world.bossSlam(this);
          this.next('slam-recover', 1.2);
        }
        break;
      case 'slam-recover':
        this.slamAmt = lerp(this.slamAmt, 0, 1 - Math.exp(-dt * 6));
        this.coreOpen = lerp(this.coreOpen, 0, 1 - Math.exp(-dt * 4));
        if (this.timer <= 0) this.next('idle', 1.4);
        break;
      case 'stagger':
        this.slamAmt = lerp(this.slamAmt, -0.4, 1 - Math.exp(-dt * 4));
        this.coreOpen = 1;
        if (this.timer <= 0) this.next('idle', 1.2);
        break;
      default:
        break;
    }
  }

  next(state, duration) {
    this.state = state;
    this.timer = duration;
  }

  chooseAttack() {
    const minions = this.world.enemies.filter((e) => e.minion && e.alive).length;
    const roll = Math.random();
    if (roll < 0.22 && minions < 3) {
      this.summoned = false;
      this.next('summon', 1.6);
    } else if (roll < 0.62) {
      this.next('barrage-charge', this.phase === 1 ? 0.75 : 0.5);
    } else {
      this.staggerDamage = 0;
      this.next('slam-raise', this.phase === 1 ? 1.6 : 1.2);
    }
  }

  pickSpitTarget() {
    const id = this.world.pickPlayer(this.nextSpitTarget);
    this.nextSpitTarget = this.nextSpitTarget === 1 ? 2 : 1;
    return id || 1;
  }

  animateBody(dt) {
    const pos = this.bodyGeo.attributes.position;
    const base = this.basePos;
    const charge = this.state === 'barrage-charge' ? 0.12 : 0;
    const t = this.t * (this.phase === 1 ? 2.4 : 3.4);
    for (let i = 0; i < pos.count; i += 1) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const z = base[i * 3 + 2];
      const f = 1 + Math.sin(t + x * 1.7 + y * 1.3) * 0.035 + Math.sin(t * 1.7 + z * 2.1) * 0.02 + charge;
      pos.setXYZ(i, x * f, y * f, z * f);
    }
    pos.needsUpdate = true;
    this.rig.rotation.z = Math.sin(this.t * 0.9) * 0.04;
    this.rig.position.y = this.state === 'stagger' ? -0.6 : 0;
    const coreScale = 1 + this.coreOpen * 0.5 + Math.sin(this.t * 6) * 0.08;
    this.core.scale.setScalar(coreScale);
    this.core.rotation.y += dt * (1 + this.coreOpen * 4);
    if (this.flashT <= 0 && !this.dying) this.coreMat.color.setHex(this.coreOpen > 0.5 ? 0xd6ff8c : ENGINE.GREEN_HOT);
    for (const eye of this.eyes) {
      if (!eye.alive) continue;
      eye.mesh.rotation.y = Math.sin(this.t * 1.3 + eye.phase) * 0.4;
      eye.mesh.rotation.x = Math.cos(this.t * 1.1 + eye.phase) * 0.3;
    }
    for (const tentacle of this.tentacles) {
      let prev = tentacle.base.clone();
      tentacle.segments.forEach((seg, s) => {
        const k = s / 6;
        const wave = Math.sin(this.t * 2.2 + s * 0.7 + tentacle.side) * 0.45;
        const lift = this.slamAmt * (1.8 * k);
        const out = tentacle.side * (0.24 + wave * 0.12);
        prev = prev.clone().add(new THREE.Vector3(out, 0.3 + lift * 0.4 + wave * 0.12, 0.2 + wave * 0.1));
        seg.position.copy(prev);
      });
    }
  }

  onShot(playerId, hit) {
    const part = hit.object.userData.part;
    let amount = 1;
    if (part === 'core') amount = this.coreOpen > 0.5 ? 6 : 3;
    if (part === 'eye') {
      amount = 2;
      const eye = this.eyes.find((e) => e.mesh === hit.object);
      if (eye?.alive) {
        eye.hp -= 2;
        if (eye.hp <= 0) {
          eye.alive = false;
          eye.mesh.visible = false;
          this.world.removeTarget(eye.mesh);
          this.world.splat(hit.point);
          this.world.game.addScore(playerId, ENGINE.SCORE.bossEye, this.world.projectNdc(hit.point));
        }
      }
    }
    this.applyDamage(amount, playerId, hit.point, part);
  }

  onBlast(playerId, amount) {
    this.applyDamage(amount * 2, playerId, this.core.getWorldPosition(new THREE.Vector3()), 'blast');
  }

  applyDamage(amount, playerId, point, part) {
    if (!this.alive) return;
    const game = this.world.game;
    this.hp = Math.max(0, this.hp - amount);
    this.flash();
    if (point) this.world.sparks(point);
    game.bossHit();
    game.setBossHealth((this.hp / this.maxHp) * 100);
    game.addScore(playerId, part === 'core' ? ENGINE.SCORE.bossCore : ENGINE.SCORE.bossHit, null);
    if (this.state === 'slam-raise') this.staggerDamage += amount;
    if (this.phase === 1 && this.hp < this.maxHp * 0.5) {
      this.phase = 2;
      this.world.sfxAt('roar', this.center(), 1);
      this.world.game.toast('¡MADRE BABA ENFURECE!', 'error');
    }
    if (this.hp <= 0) this.kill(playerId);
  }

  kill(playerId) {
    if (!this.alive) return;
    this.alive = false;
    this.dying = true;
    this.dieT = 0;
    for (const mesh of this.parts) this.world.removeTarget(mesh);
    for (const f of this.flashMats) {
      f.material.transparent = true;
      if (f.material.emissive) {
        f.material.emissive.setHex(ENGINE.BLUE);
        f.material.emissiveIntensity = 1.6;
      } else {
        f.material.color.setHex(ENGINE.BLUE_HOT);
      }
    }
    const game = this.world.game;
    game.addScore(playerId, ENGINE.SCORE.bossKill, this.world.projectNdc(this.center()));
    game.registerKill(playerId);
    game.setBossHealth(0);
    this.world.sfxAt('roar', this.center(), 1.2);
    this.world.killMinions();
  }

  dispose() {
    super.dispose();
    this.bodyGeo.dispose();
  }

  updateDying(dt) {
    this.dieT += dt;
    const k = clamp(this.dieT / 3.4, 0, 1);
    this.burstTimer -= dt;
    if (this.burstTimer <= 0) {
      this.burstTimer = 0.16;
      const p = this.center().add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 6));
      this.world.fxBlue.emit(p, { count: 18, speed: 4, life: 0.8, gravity: -1, colors: [ENGINE.BLUE_WHITE, ENGINE.BLUE_HOT, ENGINE.BLUE] });
      if (Math.random() < 0.4) this.world.blasts.spawn(p, { radius: 2.2, light: 20 });
    }
    for (const f of this.flashMats) f.material.opacity = 1 - k * k;
    this.group.position.y = lerp(0, -6, k * k);
    this.world.shake(0.08);
    if (k >= 1) {
      this.world.blasts.spawn(this.center().setY(2), { radius: 9, light: 80 });
      this.world.fxBlue.emit(this.center().setY(2), { count: 120, speed: 9, life: 1.2, gravity: 2, colors: [ENGINE.BLUE_WHITE, ENGINE.BLUE_HOT, ENGINE.BLUE] });
      this.world.sfxAt('explosion', this.center(), 1.2);
      this.dispose();
      this.world.onBossDefeated();
    }
  }
}


/* ───────────────────────────── 16. ARMA EN PRIMERA PERSONA ───────────── */

/**
 * Rifle FA-7 con lanzagranadas LG-40 acoplado, sostenido por guantes
 * tácticos y mangas del traje NBQ. Apunta hacia la mira de su jugador.
 */
class GunRig {
  constructor(world, id) {
    this.world = world;
    this.id = id;
    const m = world.mats;
    const HALF = Math.PI / 2;
    const accent = basic({ color: CONFIG.PLAYERS[id].color });
    this.root = new THREE.Group();
    this.aimPivot = new THREE.Group();
    this.kick = new THREE.Group();
    this.root.add(this.aimPivot);
    this.aimPivot.add(this.kick);
    world.viewScene.add(this.root);
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r, l, s = 10) => new THREE.CylinderGeometry(r, r, l, s);
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      this.kick.add(mesh);
      return mesh;
    };
    add(box(0.13, 0.15, 0.56), m.metal, 0, 0, -0.06);
    add(box(0.05, 0.035, 0.42), m.metalDark, 0, 0.092, -0.08);
    add(box(0.137, 0.022, 0.3), accent, 0, 0.05, -0.1);
    add(cyl(0.03, 0.36, 8), m.metalDark, 0, 0.02, -0.5, HALF);
    add(box(0.075, 0.075, 0.05), m.formulaHot, 0, 0.02, -0.69);
    this.liquids = [];
    for (const x of [-0.092, 0.092]) {
      add(cyl(0.046, 0.24), m.glass, x, 0.03, -0.12, HALF);
      const liquid = add(cyl(0.037, 0.22).translate(0, 0.11, 0), m.formula, x, 0.03, -0.01, -HALF);
      this.liquids.push(liquid);
      add(cyl(0.05, 0.02), m.metal, x, 0.03, -0.245, HALF);
      add(cyl(0.05, 0.02), m.metal, x, 0.03, 0.005, HALF);
    }
    add(cyl(0.058, 0.34), m.metalDark, 0, -0.115, -0.3, HALF);
    add(cyl(0.064, 0.03), m.formulaHot, 0, -0.115, -0.475, HALF);
    this.shell = add(new THREE.IcosahedronGeometry(0.042, 0), m.formula, 0, -0.115, -0.44);
    add(box(0.07, 0.17, 0.09), m.rubber, 0, -0.15, 0.1, 0.3);
    add(box(0.1, 0.12, 0.24), m.metal, 0, -0.01, 0.3);
    add(box(0.12, 0.11, 0.14), m.glove, 0.005, -0.16, 0.12, 0.3);
    add(box(0.13, 0.1, 0.13), m.glove, 0, -0.19, -0.32);
    add(box(0.1, 0.1, 0.5), m.hazmat, 0.02, -0.25, 0.38, -0.45);
    add(box(0.1, 0.1, 0.5), m.hazmat, -0.07, -0.3, -0.08, -0.85, 0.35);
    add(box(0.104, 0.03, 0.06), m.tactical, 0.02, -0.21, 0.2, -0.45);
    this.flashSprite = new THREE.Sprite(world.spriteMats.muzzle);
    this.flashSprite.scale.set(0.28, 0.28, 1);
    this.flashSprite.position.set(0, 0.02, -0.76);
    this.flashSprite.visible = false;
    this.kick.add(this.flashSprite);
    this.recoil = 0;
    this.launchKick = 0;
    this.flashT = 0;
    this.shown = 0;
    this.reloadAmt = 0;
    this.refill = 1;
    this.tmpV = new THREE.Vector3();
    this.tmpObj = new THREE.Object3D();
    this.flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    this.root.visible = false;
  }

  fire() {
    this.recoil = 1;
    this.flashT = 0.05;
    const s = 0.22 + Math.random() * 0.12;
    this.flashSprite.scale.set(s, s, 1);
    this.world.viewFlash(this);
  }

  launch() {
    this.launchKick = 1;
    this.flashT = 0.07;
    this.world.viewFlash(this);
  }

  update(dt, player, slot) {
    const want = this.world.mode === 'level' && player.active && player.alive ? 1 : 0;
    this.shown = lerp(this.shown, want, 1 - Math.exp(-dt * 7));
    this.root.visible = this.shown > 0.02;
    if (!this.root.visible) return;
    this.root.position.set(slot.x, slot.y - (1 - this.shown) * 0.7, slot.z);
    const target = this.tmpV.set(player.aim.x, player.aim.y, 0.5).unproject(this.world.viewCamera).normalize().multiplyScalar(6);
    this.tmpObj.position.copy(this.root.position);
    this.tmpObj.lookAt(target);
    this.tmpObj.quaternion.multiply(this.flip);
    this.aimPivot.quaternion.slerp(this.tmpObj.quaternion, 1 - Math.exp(-dt * 16));
    this.recoil *= Math.exp(-dt * 13);
    this.launchKick *= Math.exp(-dt * 7);
    this.reloadAmt = lerp(this.reloadAmt, player.reloading ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.kick.position.set(0, -this.reloadAmt * 0.1, this.recoil * 0.08 + this.launchKick * 0.13);
    this.kick.rotation.set(this.recoil * 0.13 + this.launchKick * 0.3 + this.reloadAmt * 0.75, this.reloadAmt * -0.35, this.reloadAmt * 0.4);
    // El nivel de los tanques es la munición: se vacían al disparar y se llenan al recargar
    if (player.reloading) this.refill = Math.min(1, this.refill + dt / (CONFIG.RELOAD_MS / 1000));
    else this.refill = player.ammo / CONFIG.AMMO_MAX;
    for (const liquid of this.liquids) {
      liquid.visible = this.refill > 0.01;
      liquid.scale.y = Math.max(0.02, this.refill);
    }
    this.shell.visible = player.grenades > 0;
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flashSprite.visible = true;
      this.flashSprite.material.rotation = Math.random() * Math.PI;
    } else {
      this.flashSprite.visible = false;
    }
  }
}


/* ───────────────────────────── 17. DIRECTOR DEL RIEL ──────────────────── */

class LevelDirector {
  constructor(world) {
    this.world = world;
    this.curve = new THREE.CatmullRomCurve3(
      RAIL_NODES.map((n) => new THREE.Vector3(n.p[0], ENGINE.EYE_HEIGHT, n.p[1])),
      false,
      'catmullrom',
      0.2,
    );
    this.length = this.curve.getLength();
    this.marks = RAIL_NODES.map((node) => ({ ...node, dist: this.distOf(node) }));
    this.stops = this.marks.filter((mark) => mark.stop);
    this.sections = this.marks.filter((mark) => mark.section);
    this.look = new THREE.Vector3();
    this.desired = new THREE.Vector3();
    this.reset();
  }

  distOf(node) {
    let best = 0;
    let bestD = Infinity;
    const samples = 800;
    for (let i = 0; i <= samples; i += 1) {
      const u = i / samples;
      const p = this.curve.getPointAt(u);
      const d = Math.hypot(p.x - node.p[0], p.z - node.p[1]);
      if (d < bestD) {
        bestD = d;
        best = u;
      }
    }
    return best * this.length;
  }

  reset() {
    this.dist = 0;
    this.state = 'idle';
    this.stopIndex = 0;
    this.wave = null;
    this.queue = [];
    this.timer = 0;
    this.clearTimer = 0;
    this.lastProgress = -1;
    this.section = 1;
    this.bob = 0;
  }

  start() {
    this.reset();
    this.state = 'ready';
    this.place(0, true);
    this.world.game.setSection(1);
    this.world.game.setRailProgress(0);
  }

  update(dt) {
    switch (this.state) {
      case 'ready':
        this.timer += dt;
        if (this.timer >= ENGINE.READY_DELAY_S) this.state = 'moving';
        break;
      case 'moving': {
        const next = this.stops[this.stopIndex];
        const target = next ? next.dist : this.length;
        this.dist = Math.min(target, this.dist + ENGINE.WALK_SPEED * dt);
        this.checkSections();
        if (next && this.dist >= target - 0.001) this.arrive(next);
        break;
      }
      case 'combat':
        this.runWave(dt);
        break;
      case 'cleared':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.state = 'done';
          this.world.game.levelClear();
        }
        break;
      default:
        break;
    }
    this.place(dt, false);
    const progress = Math.round((this.dist / this.length) * 100);
    if (progress !== this.lastProgress) {
      this.lastProgress = progress;
      this.world.game.setRailProgress(progress);
    }
  }

  checkSections() {
    for (const mark of this.sections) {
      if (this.dist >= mark.dist && this.section < mark.section) {
        this.section = mark.section;
        this.world.game.setSection(mark.section);
      }
    }
  }

  arrive(stop) {
    this.stopIndex += 1;
    if (stop.stop === 'boss') {
      this.state = 'boss';
      this.world.spawnBoss();
      return;
    }
    const def = WAVES[stop.stop];
    const coop = this.world.playerCount() > 1;
    this.wave = { focus: def.focus, actors: [] };
    this.queue = def.spawns.filter((s) => !s.coop || coop).map((s) => ({ ...s }));
    for (const item of def.items) this.world.spawnPickup(item.kind, new THREE.Vector3(...item.at));
    this.state = 'combat';
    this.timer = 0;
    this.clearTimer = 0;
  }

  runWave(dt) {
    this.timer += dt;
    for (const spawn of [...this.queue]) {
      if (this.timer < spawn.delay) continue;
      this.queue = this.queue.filter((s) => s !== spawn);
      this.wave.actors.push(this.world.spawnEnemy(spawn.type, new THREE.Vector3(spawn.x, 0, spawn.z)));
    }
    const cleared = !this.queue.length && this.wave.actors.every((actor) => !actor.alive);
    if (!cleared) return;
    this.clearTimer += dt;
    if (this.clearTimer >= ENGINE.WAVE_CLEAR_DELAY_S) {
      this.state = 'moving';
      this.wave = null;
    }
  }

  bossDefeated() {
    this.state = 'cleared';
    this.timer = ENGINE.CLEAR_AFTER_BOSS_S;
    this.dist = this.length;
  }

  place(dt, snap) {
    const u = clamp(this.dist / this.length, 0, 1);
    const cam = this.world.camera;
    const pos = this.curve.getPointAt(u);
    if (this.state === 'combat' && this.wave) {
      this.desired.set(...this.wave.focus);
    } else if (['boss', 'cleared', 'done'].includes(this.state)) {
      this.desired.set(...BOSS_FOCUS);
    } else {
      this.desired.copy(this.curve.getPointAt(clamp((this.dist + 7) / this.length, 0, 1)));
      this.desired.y = ENGINE.EYE_HEIGHT - 0.1;
    }
    if (snap) this.look.copy(this.desired);
    else this.look.lerp(this.desired, 1 - Math.exp(-dt * 2.4));
    const moving = this.state === 'moving';
    if (moving) this.bob += dt * ENGINE.WALK_SPEED * 2.1;
    cam.position.copy(pos);
    if (moving) cam.position.y += Math.sin(this.bob) * 0.045;
    cam.lookAt(this.look);
    if (moving) cam.rotateZ(Math.sin(this.bob * 0.5) * 0.008);
  }
}


/* ───────────────────────────── 18. MUNDO THREE.JS ─────────────────────── */

class ThreeWorld {
  constructor(app, game) {
    this.app = app;
    this.game = game;
    this.ready = false;
    this.fallback = null;
    this.mode = 'attract';
    this.paused = false;
    this.time = 0;
    this.shot = 'world';
    this.shotTime = 0;
    this.shotIndex = 0;
    this.soloSquad = true;
    this.shakeAmt = 0;
    this.hpScale = 1;
    this.enemies = [];
    this.spits = [];
    this.grenades = [];
    this.pickups = [];
    this.barrels = [];
    this.waves = [];
    this.targets = new Set();
    this.statics = [];
    this.boss = null;
    this.load();
  }

  attach(game) {
    this.game = game;
    this.fallback?.attach(game);
  }

  async load() {
    try {
      THREE = await import('three');
      this.build();
      await Promise.race([this.textures.done, new Promise((resolve) => setTimeout(resolve, ENGINE.TEXTURE_TIMEOUT_MS))]);
      this.ready = true;
      this.applyMode();
      this.game.bus.emit('world:ready', { engine: 'three', revision: THREE.REVISION });
    } catch (error) {
      console.error('[motor 3D]', error);
      this.fallback = new ShootingRange();
      this.fallback.attach(this.game);
      this.game.toast('No se pudo iniciar el 3D: se usa el Campo de Tiro', 'error');
      if (this.mode === 'level') this.fallback.enterLevel();
    }
  }

  /* ── Interfaz World ── */

  enterAttract() {
    this.mode = 'attract';
    if (this.fallback) {
      this.fallback.enterAttract();
      return;
    }
    if (this.ready) this.applyMode();
  }

  enterIntro() {
    this.mode = 'intro';
    this.shot = 'world';
    this.shotTime = 0;
    if (this.fallback) {
      this.fallback.enterIntro();
      return;
    }
    if (this.ready) this.applyMode();
  }

  introShot(shot, index) {
    this.shot = shot || 'world';
    this.shotTime = 0;
    this.shotIndex = index;
    if (this.fallback) {
      this.fallback.introShot(shot, index);
      return;
    }
    if (this.ready) this.prepareShot();
  }

  enterLevel() {
    this.mode = 'level';
    if (this.fallback) {
      this.fallback.enterLevel();
      return;
    }
    if (this.ready) this.applyMode();
  }

  exitLevel() {
    if (this.fallback) {
      this.fallback.exitLevel();
      return;
    }
    if (this.mode === 'level') this.mode = 'attract';
    if (this.ready) this.applyMode();
  }

  setPaused(paused) {
    this.paused = paused;
    this.fallback?.setPaused(paused);
  }

  update(dt, time) {
    if (this.fallback) {
      this.fallback.update(dt, time);
      return;
    }
    if (!this.ready || this.paused) return;
    this.time += dt;
    this.animateEnvironment(dt);
    if (this.mode === 'attract') this.updateAttract(dt);
    else if (this.mode === 'intro') this.updateIntro(dt);
    else if (this.mode === 'level') this.updateLevel(dt);
    this.fxBlue.update(dt);
    this.fxSlime.update(dt);
    this.tracers.update(dt);
    this.blasts.update(dt);
    this.smoke.update(dt);
    this.applyShake(dt);
    this.render();
  }

  shoot(playerId, aim) {
    if (this.fallback) return this.fallback.shoot(playerId, aim);
    if (!this.ready || this.mode !== 'level') return { hit: false, kind: null };
    const hit = this.raycast(aim);
    this.guns[playerId]?.fire();
    const to = hit ? hit.point : this.raycaster.ray.at(ENGINE.BULLET_RANGE, new THREE.Vector3());
    this.tracers.fire(this.muzzleWorld(playerId), to);
    if (!hit) return { hit: false, kind: null };
    const target = hit.object.userData.target;
    if (!target) {
      this.fxBlue.emit(hit.point, { count: 6, speed: 2, life: 0.25, gravity: 4, colors: [0xffffff, ENGINE.BLUE_HOT] });
      return { hit: false, kind: 'wall' };
    }
    if (!target.alive) return { hit: false, kind: null };
    target.onShot(playerId, hit);
    return { hit: true, kind: target.kind };
  }

  grenade(playerId, aim) {
    if (this.fallback) {
      this.fallback.grenade(playerId, aim);
      return;
    }
    if (!this.ready || this.mode !== 'level') return;
    this.guns[playerId]?.launch();
    const hit = this.raycast(aim);
    const from = this.launcherWorld(playerId);
    const to = hit ? hit.point.clone() : this.raycaster.ray.at(18, new THREE.Vector3());
    const dist = from.distanceTo(to);
    if (dist > 30) {
      const reach = to.clone().sub(from).setLength(30);
      to.copy(from).add(reach);
    }
    to.y = Math.max(0.05, to.y);
    this.grenades.push(new GrenadeShell(this, playerId, from, to));
  }

  drawHud(ctx, sprites, dt) {
    this.fallback?.drawHud(ctx, sprites, dt);
  }

  /* ── Construcción ── */

  build() {
    const canvas = $('#game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CONFIG.INTERNAL_W, CONFIG.INTERNAL_H, false);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    PS1.init(this.game.settings.get('vertexSnap'));
    this.game.bus.on('settings', ({ key, value }) => {
      if (key === 'vertexSnap') PS1.set(value);
    });
    this.textures = new TextureBank();
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.tmp = new THREE.Vector3();
    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);

    this.city = new THREE.Scene();
    this.city.background = new THREE.Color(ENGINE.FOG_COLOR);
    this.city.fog = new THREE.Fog(ENGINE.FOG_COLOR, ENGINE.FOG_NEAR, ENGINE.FOG_FAR);
    this.camera = new THREE.PerspectiveCamera(ENGINE.FOV, 4 / 3, ENGINE.NEAR, ENGINE.FAR);

    this.buildMaterials();
    this.buildGeometries();
    this.buildCity();
    this.buildFx();
    this.buildAttract();
    this.buildSoldiers();
    this.buildSpace();
    this.buildLab();
    this.buildView();
    this.director = new LevelDirector(this);
  }

  buildMaterials() {
    const t = (name) => this.textures.get(name);
    this.mats = {
      concrete: lambert({ map: t('tex-concrete') }),
      road: lambert({ map: t('tex-road') }),
      asphalt: lambert({ map: t('tex-asphalt') }),
      facade: lambert({ map: t('tex-facade') }),
      brick: lambert({ map: t('tex-brick') }),
      roof: lambert({ color: 0x23262b }),
      barrel: lambert({ map: t('tex-toxic-barrel') }),
      barrelHot: lambert({ map: t('tex-toxic-barrel'), emissive: 0x1a1000 }),
      metal: lambert({ map: t('tex-metal-panel') }),
      metalDark: lambert({ map: t('tex-metal-panel'), color: 0x7d8a99 }),
      rust: lambert({ map: t('tex-metal-panel'), color: 0xb07a52 }),
      tactical: lambert({ map: t('tex-tactical') }),
      glove: lambert({ map: t('tex-tactical'), color: 0x6a7078 }),
      hazmat: lambert({ map: t('tex-hazmat-suit') }),
      rubber: lambert({ color: 0x15181d }),
      zombieSkin: lambert({ map: t('tex-zombie-skin'), emissive: 0x000000 }),
      zombieCloth: lambert({ map: t('tex-tactical'), color: 0xa08a6a, emissive: 0x000000 }),
      slimeBody: lambert({ map: t('tex-slime'), emissive: 0x0d4a14 }),
      bossFlesh: lambert({ map: t('tex-mutant-flesh'), emissive: 0x0a2c0e }),
      slimeGlow: basic({ color: ENGINE.GREEN_HOT }),
      slimePool: basic({ map: t('tex-slime'), color: 0xc8ffc0 }),
      glass: basic({ color: ENGINE.BLUE_HOT, transparent: true, opacity: 0.28, depthWrite: false }),
      formula: basic({ color: ENGINE.BLUE }),
      formulaHot: basic({ color: ENGINE.BLUE_HOT }),
      white: basic({ color: 0xeef4ee }),
      black: basic({ color: 0x050505 }),
      pupilRed: basic({ color: 0xc4161f }),
      lamp: basic({ color: 0xffe4a0 }),
      lampFlicker: basic({ color: 0xffe4a0 }),
      window: basic({ color: 0x0b1016 }),
      visor: basic({ color: 0x3ff6ff }),
    };
    const spriteMap = (name) => pixelate(this.textures.load(name), false);
    this.fireTextures = [spriteMap('fx-fire'), spriteMap('fx-fire')];
    for (const texture of this.fireTextures) texture.repeat.set(0.25, 1);
    this.spriteMats = {
      fireA: new THREE.SpriteMaterial({ map: this.fireTextures[0], transparent: true, depthWrite: false }),
      fireB: new THREE.SpriteMaterial({ map: this.fireTextures[1], transparent: true, depthWrite: false }),
      spit: new THREE.SpriteMaterial({ map: spriteMap('fx-slime-ball'), transparent: true, depthWrite: false }),
      grenadeGlow: new THREE.SpriteMaterial({ map: spriteMap('fx-grenade'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      medkit: new THREE.SpriteMaterial({ map: spriteMap('icon-medkit'), transparent: true, alphaTest: 0.5 }),
      crate: new THREE.SpriteMaterial({ map: spriteMap('icon-grenade'), transparent: true, alphaTest: 0.5 }),
      muzzle: new THREE.SpriteMaterial({ map: spriteMap('fx-muzzle-blue'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      reactor: new THREE.SpriteMaterial({ map: spriteMap('fx-slime-ball'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    };
    this.smokeTexture = spriteMap('fx-smoke');
  }

  buildGeometries() {
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    this.geometries = {
      zLeg: box(0.22, 0.92, 0.24).translate(0, -0.46, 0),
      zTorso: box(0.56, 0.72, 0.32),
      zHead: box(0.32, 0.34, 0.32),
      zEye: box(0.07, 0.05, 0.03),
      zJaw: box(0.24, 0.1, 0.2),
      zArm: box(0.15, 0.74, 0.17).translate(0, -0.37, 0),
      zBlob: new THREE.IcosahedronGeometry(0.075, 0),
      slimeBody: new THREE.IcosahedronGeometry(0.75, 1),
      slimeEye: new THREE.SphereGeometry(0.16, 6, 5),
      slimePupil: new THREE.SphereGeometry(0.08, 5, 4),
      slimeMouth: box(0.36, 0.12, 0.1),
      barrel: new THREE.CylinderGeometry(0.38, 0.38, 1.05, 10),
      grenade: new THREE.IcosahedronGeometry(0.13, 0),
      unitSphere: new THREE.SphereGeometry(1, 7, 5),
      bossSkirt: new THREE.CylinderGeometry(3.2, 5.0, 1.8, 14, 1, true),
      bossPool: new THREE.CircleGeometry(7.2, 24).rotateX(-Math.PI / 2),
      bossEye: new THREE.SphereGeometry(0.45, 8, 6),
      bossPupil: new THREE.SphereGeometry(0.22, 6, 5),
      bossCore: new THREE.OctahedronGeometry(0.8, 0),
      bossMouth: new THREE.TorusGeometry(1.05, 0.25, 6, 14),
      bossTooth: new THREE.ConeGeometry(0.12, 0.35, 4),
      ring: new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2),
    };
  }

  addStatic(mesh) {
    this.city.add(mesh);
    this.statics.push(mesh);
    return mesh;
  }

  buildCity() {
    const m = this.mats;
    const rng = mulberry32(2031);
    this.city.add(new THREE.HemisphereLight(0xa6d3b0, 0x1a140c, 2.4));
    const moon = new THREE.DirectionalLight(0xc8dcff, 1.6);
    moon.position.set(-18, 30, 12);
    this.city.add(moon);

    const place = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      return mesh;
    };
    this.addStatic(place(planeXZ(170, 170, 8), m.concrete, 30, 0, -40));
    this.addStatic(place(planeXZ(10, 80, 10, 8), m.road, 0, 0.04, -32));
    const market = planeXZ(10, 52, 10, 8);
    market.rotateY(Math.PI / 2);
    this.addStatic(place(market, m.road, 30, 0.04, -66));
    this.addStatic(place(new THREE.CircleGeometry(19, 20).rotateX(-Math.PI / 2), m.asphalt, BOSS_CENTER[0], 0.03, BOSS_CENTER[1]));

    // Manzanas: avenida, fondo de la T, calle del mercado y la plaza
    this.row('z', -5, 9, -71, 1, rng);
    this.row('z', 5, 9, -50, -1, rng);
    this.building(10, -55.5, 10, 14, 11, rng, false);
    this.row('x', 10.5, -16, 16, -1, rng);
    this.row('x', -71, -16, 46, 1, rng);
    this.row('x', -61, 15, 46, -1, rng);
    this.row('z', 56, -44, -61, 1, rng, 1.2);
    this.row('z', 56, -71, -88, 1, rng, 1.2);
    this.row('x', -44, 56, 97, -1, rng, 1.3);
    this.row('x', -88, 56, 97, 1, rng, 1.3);
    this.row('z', 97, -44, -88, -1, rng, 1.4);

    this.buildProps(rng);
  }

  /** Fila de edificios cuya fachada queda sobre la línea de la calle. */
  row(axis, line, from, to, facing, rng, tall = 1) {
    const dir = Math.sign(to - from);
    let s = from;
    while ((to - s) * dir > 0.5) {
      const width = Math.min(Math.abs(to - s), 6 + rng() * 6);
      const depth = 7 + rng() * 4;
      const ruined = rng() < 0.3;
      const height = (ruined ? 4 + rng() * 5 : 7 + rng() * 12) * tall;
      const mid = s + dir * width / 2;
      const away = -facing;
      const x = axis === 'z' ? line + away * depth / 2 : mid;
      const z = axis === 'z' ? mid : line + away * depth / 2;
      this.building(x, z, axis === 'z' ? depth : width, height, axis === 'z' ? width : depth, rng, ruined);
      s += dir * width;
      if (rng() < 0.12) s += dir * 1.4;
    }
  }

  building(x, z, w, h, d, rng, ruined) {
    const m = this.mats;
    const wall = rng() < 0.6 ? m.facade : m.brick;
    const geometry = boxUV(new THREE.BoxGeometry(w, h, d), w, h, d, 6);
    const mesh = new THREE.Mesh(geometry, [wall, wall, m.roof, m.roof, wall, wall]);
    mesh.position.set(x, h / 2, z);
    this.addStatic(mesh);
    if (!ruined) return;
    // Silueta rota en el techo y escombros en la base
    for (let i = 0; i < 3; i += 1) {
      const bw = w * (0.2 + rng() * 0.4);
      const bh = 0.8 + rng() * 2.4;
      const bd = d * (0.2 + rng() * 0.5);
      const piece = new THREE.Mesh(boxUV(new THREE.BoxGeometry(bw, bh, bd), bw, bh, bd, 6), wall);
      piece.position.set(x + (rng() - 0.5) * (w - bw), h + bh / 2, z + (rng() - 0.5) * (d - bd));
      this.addStatic(piece);
    }
    for (let i = 0; i < 4; i += 1) {
      const size = 0.3 + rng() * 0.6;
      const rubble = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.7, size), m.concrete);
      rubble.position.set(x + (rng() - 0.5) * (w + 1.6), size * 0.3, z + (rng() - 0.5) * (d + 1.6));
      rubble.rotation.set(rng(), rng() * 3, rng());
      this.addStatic(rubble);
    }
  }

  buildProps(rng) {
    const m = this.mats;
    this.fires = [];
    this.pools = [];
    this.drips = [];
    this.flickers = [];
    this.cars = [];
    let lights = 0;
    for (const [x, z, rot, burning] of CARS) {
      const car = new THREE.Group();
      const body = new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.9, 0.7, 4), 1.9, 0.7, 4, 2), m.rust);
      body.position.y = 0.55;
      const cabin = new THREE.Mesh(boxUV(new THREE.BoxGeometry(1.6, 0.6, 2), 1.6, 0.6, 2, 2), m.rust);
      cabin.position.set(0, 1.15, -0.2);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.36, 1.6), m.window);
      glass.position.set(0, 1.2, -0.2);
      car.add(body, cabin, glass);
      for (const [wx, wz] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.24, 8).rotateZ(Math.PI / 2), m.rubber);
        wheel.position.set(wx, 0.33, wz);
        car.add(wheel);
      }
      car.position.set(x, 0, z);
      car.rotation.y = rot;
      this.city.add(car);
      for (const piece of [body, cabin]) this.statics.push(piece);
      this.cars.push({ group: car, wobble: 0, x, z });
      if (burning) this.addFire(new THREE.Vector3(x, 1.4, z), lights < 3);
      if (burning) lights += 1;
    }
    for (const [x, z, tipped] of LEAKING_BARRELS) {
      const barrel = new THREE.Mesh(this.geometries.barrel, m.barrel);
      if (tipped) {
        barrel.rotation.z = Math.PI / 2;
        barrel.rotation.y = rng() * Math.PI;
        barrel.position.set(x, 0.38, z);
      } else {
        barrel.position.set(x, 0.53, z);
      }
      this.addStatic(barrel);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(tipped ? 1.3 : 0.8, 12).rotateX(-Math.PI / 2), m.slimePool);
      pool.position.set(x + (tipped ? 0.6 : 0.3), 0.07, z + 0.3);
      this.city.add(pool);
      this.pools.push({ mesh: pool, phase: rng() * 6, base: tipped ? 1.1 : 0.85 });
      if (tipped) this.drips.push(new THREE.Vector3(x, 0.45, z));
    }
    for (const [x, z] of EXPLOSIVE_BARRELS) this.barrels.push(new ExplosiveBarrel(this, x, z));
    // Farolas a lo largo de la avenida y del mercado
    const lamps = [[-4.6, 0], [4.6, -14], [-4.6, -28], [4.6, -42], [-4.6, -56], [12, -61.6], [26, -70.4], [40, -61.6]];
    lamps.forEach(([x, z], i) => {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6), m.metalDark);
      pole.position.set(x, 2.1, z);
      const flicker = i % 3 === 1;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.22), flicker ? m.lampFlicker : m.lamp);
      head.position.set(x, 4.2, z);
      this.addStatic(pole);
      this.city.add(head);
    });
    // Barreras de concreto
    for (const [x, z, r] of [[-1.8, -7.5, 0.2], [2.4, -9, -0.3], [-2.6, -48, 0.4], [20, -64, 1.4], [37, -68.5, 1.7]]) {
      const barrier = new THREE.Mesh(boxUV(new THREE.BoxGeometry(2.0, 0.8, 0.5), 2, 0.8, 0.5, 2), m.concrete);
      barrier.position.set(x, 0.4, z);
      barrier.rotation.y = r;
      this.addStatic(barrier);
    }
  }

  addFire(position, withLight) {
    const group = new THREE.Group();
    group.position.copy(position);
    const sprites = [];
    for (let i = 0; i < 3; i += 1) {
      const sprite = new THREE.Sprite(i % 2 ? this.spriteMats.fireB : this.spriteMats.fireA);
      sprite.position.set((i - 1) * 0.45, 0.1 * i, (Math.random() - 0.5) * 0.4);
      sprite.scale.set(1.3, 1.3, 1);
      group.add(sprite);
      sprites.push(sprite);
    }
    this.city.add(group);
    const light = withLight ? new THREE.PointLight(0xff7a2a, 18, 12, 1.4) : null;
    if (light) {
      light.position.copy(position).y += 0.6;
      this.city.add(light);
    }
    this.fires.push({ group, sprites, light, smokeTimer: Math.random(), base: position.clone() });
  }

  buildFx() {
    this.fxBlue = new ParticleField(this.city, 900, { additive: true, size: 0.12 });
    this.fxSlime = new ParticleField(this.city, 600, { additive: false, size: 0.12 });
    this.tracers = new TracerPool(this.city, 10);
    this.blasts = new BlastPool(this.city, 3);
    this.smoke = new SmokeSystem(this.city, this.smokeTexture, 30);
    this.fireClock = 0;
    this.fireFrame = 0;
  }

  /** Bucle del menú: zombies que vagan y golpean un carro, babas, lodo y fuego. */
  buildAttract() {
    this.attractGroup = new THREE.Group();
    this.city.add(this.attractGroup);
    this.attractActors = [];
    const add = (actor) => {
      this.attractGroup.add(actor.group);
      this.attractActors.push(actor);
    };
    const v = (x, z) => new THREE.Vector3(x, 0, z);
    add(new Zombie(this, v(-2.4, -17), { mode: 'wander', rise: false, path: [[-2.4, -17], [-1, -25], [-3, -31], [-3.4, -23]] }));
    add(new Zombie(this, v(1.8, -29), { mode: 'wander', rise: false, path: [[1.8, -29], [3, -24.5], [1, -15.5], [0.4, -24]] }));
    add(new Zombie(this, v(-0.5, -34), { mode: 'wander', rise: false, path: [[-0.5, -34], [2.2, -36], [3.4, -31], [0, -30.5]] }));
    const car = this.cars[0];
    add(new Zombie(this, v(1.65, -19.3), { mode: 'smash', rise: false, smash: { look: [3.1, -19.3], car, point: [2.3, 1.0, -19.3] } }));
    add(new Zombie(this, v(3.3, -17.1), { mode: 'smash', rise: false, smash: { look: [3.2, -19], car, point: [3.2, 1.0, -17.8] } }));
    add(new Slime(this, v(-3.0, -20.4), { mode: 'idle', rise: false }));
    add(new Slime(this, v(2.4, -32.5), { mode: 'idle', rise: false }));
    add(new Slime(this, v(-3.9, -26.5), { mode: 'bang', rise: false, wall: [-5.2, -26.5] }));
    this.attractCam = 0;
    this.attractClock = 0;
  }

  buildSoldiers() {
    this.heroLight = new THREE.PointLight(0xcfeeff, 0, 9, 1.2);
    this.city.add(this.heroLight);
    this.soldierModels = PLAYER_IDS.map((id) => {
      const soldier = this.makeSoldier(CONFIG.PLAYERS[id].color);
      soldier.group.visible = false;
      this.city.add(soldier.group);
      return soldier;
    });
  }

  /** Soldado descontaminador: traje táctico + NBQ, casco, máscara de visor cian y filtros laterales. */
  makeSoldier(accentColor) {
    const m = this.mats;
    const group = new THREE.Group();
    const accent = basic({ color: accentColor });
    const visor = basic({ color: 0x3ff6ff });
    const add = (geometry, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      group.add(mesh);
      return mesh;
    };
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (r, l, s = 8) => new THREE.CylinderGeometry(r, r, l, s);
    const HALF = Math.PI / 2;
    for (const x of [-0.13, 0.13]) {
      add(box(0.2, 0.86, 0.24), m.tactical, x, 0.43, 0);
      add(box(0.22, 0.14, 0.3), m.rubber, x, 0.07, 0.03);
    }
    add(box(0.5, 0.18, 0.28), m.tactical, 0, 0.92, 0);
    add(box(0.54, 0.6, 0.32), m.hazmat, 0, 1.28, 0);
    add(box(0.56, 0.46, 0.36), m.tactical, 0, 1.3, 0);
    add(box(0.36, 0.22, 0.04), m.metal, 0, 1.36, 0.19);
    add(box(0.07, 0.12, 0.14), accent, -0.31, 1.47, 0);
    for (const x of [-0.36, 0.36]) {
      add(box(0.15, 0.42, 0.17), m.hazmat, x, 1.32, 0.02);
      add(box(0.13, 0.34, 0.15), m.tactical, x * 0.85, 1.12, 0.2, -1.2);
    }
    add(box(0.42, 0.3, 0.4), m.hazmat, 0, 1.66, -0.01);
    add(new THREE.SphereGeometry(0.25, 8, 5, 0, Math.PI * 2, 0, HALF), m.metalDark, 0, 1.76, 0);
    add(box(0.06, 0.04, 0.46), accent, 0, 2.0, 0);
    add(box(0.3, 0.28, 0.12), m.rubber, 0, 1.68, 0.17);
    add(box(0.25, 0.09, 0.02), visor, 0, 1.73, 0.235);
    for (const x of [-0.2, 0.2]) {
      add(cyl(0.065, 0.12), m.rubber, x, 1.6, 0.2, 0, 0, HALF);
      add(cyl(0.072, 0.02), m.metal, x * 1.32, 1.6, 0.2, 0, 0, HALF);
    }
    add(cyl(0.07, 0.1), m.metal, 0, 1.58, 0.25, HALF);
    add(box(0.08, 0.1, 0.5), m.metal, 0.05, 1.1, 0.38);
    add(cyl(0.03, 0.16, 6), m.formula, 0.1, 1.13, 0.35, HALF);
    add(cyl(0.035, 0.22, 6), m.metalDark, 0.05, 1.03, 0.45, HALF);
    return { group, visor };
  }

  /** Planeta para las tomas «world» y «spread»: océanos, continentes y lodo verde. */
  buildSpace() {
    this.space = new THREE.Scene();
    this.space.background = new THREE.Color(0x000004);
    this.spaceCam = new THREE.PerspectiveCamera(45, 4 / 3, 0.1, 200);
    this.space.add(new THREE.AmbientLight(0x223344, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(5, 2, 4);
    this.space.add(sun);
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 16), lambert({ map: this.makePlanetTexture(77, false) }));
    this.contamination = new THREE.Mesh(
      new THREE.SphereGeometry(2.03, 24, 16),
      basic({ map: this.makePlanetTexture(91, true), transparent: true, opacity: 0, depthWrite: false }),
    );
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(2.25, 24, 16),
      new THREE.MeshBasicMaterial({ color: ENGINE.BLUE, transparent: true, opacity: 0.16, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
    );
    this.reactor = new THREE.Sprite(this.spriteMats.reactor);
    this.reactor.position.set(0.9, 0.9, 1.55);
    this.reactor.scale.set(0.5, 0.5, 1);
    this.earth.add(this.contamination, this.reactor);
    this.space.add(this.earth, atmosphere);
    const stars = new Float32Array(500 * 3);
    for (let i = 0; i < 500; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      stars[i * 3] = Math.sin(phi) * Math.cos(theta) * 60;
      stars[i * 3 + 1] = Math.cos(phi) * 60;
      stars[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * 60;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    this.space.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffffff, size: 1, sizeAttenuation: false })));
  }

  makePlanetTexture(seed, toxic) {
    const w = 256;
    const h = 128;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(w, h);
    const noise = makeNoise2D(seed);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let n = 0;
        let amp = 1;
        let freq = 4;
        let norm = 0;
        for (let o = 0; o < 4; o += 1) {
          n += amp * noise((x / w) * freq, (y / h) * freq * 0.5, freq);
          norm += amp;
          amp *= 0.5;
          freq *= 2;
        }
        n /= norm;
        const polar = Math.abs(y / h - 0.5) * 2;
        const dither = (((x & 1) ^ (y & 1)) - 0.5) * 0.03;
        const k = (y * w + x) * 4;
        let rgb;
        let alpha = 255;
        if (toxic) {
          const v = n + dither;
          alpha = v > 0.5 ? 230 : 0;
          rgb = v > 0.62 ? [140, 255, 92] : [48, 170, 52];
        } else if (polar > 0.86) {
          rgb = [214, 226, 232];
        } else if (n + dither > 0.52) {
          rgb = n > 0.62 ? [96, 88, 70] : [62, 92, 54];
        } else {
          rgb = n > 0.44 ? [26, 86, 150] : [12, 46, 108];
        }
        image.data[k] = rgb[0];
        image.data[k + 1] = rgb[1];
        image.data[k + 2] = rgb[2];
        image.data[k + 3] = alpha;
      }
    }
    ctx.putImageData(image, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    pixelate(texture, false);
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  /** Toma «formula»: el tanque de Fórmula Azul con burbujas, en el laboratorio. */
  buildLab() {
    const m = this.mats;
    this.lab = new THREE.Scene();
    this.lab.background = new THREE.Color(0x02060f);
    this.labCam = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 50);
    this.lab.add(new THREE.AmbientLight(0x203050, 1.6));
    const key = new THREE.PointLight(ENGINE.BLUE, 30, 12, 1.2);
    key.position.set(1.5, 2, 2);
    const rim = new THREE.PointLight(0x3ff6ff, 16, 10, 1.2);
    rim.position.set(-2, 1, -1);
    this.lab.add(key, rim);
    this.canister = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.8, 12, 1, true), basic({ color: ENGINE.BLUE_HOT, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.55, 12), m.formula);
    const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 12), m.metal);
    capTop.position.y = 0.95;
    const capBottom = capTop.clone();
    capBottom.position.y = -0.95;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.565, 0.565, 0.12, 12), m.visor);
    band.position.y = 0.55;
    this.canister.add(liquid, glass, capTop, capBottom, band);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.2, 16), m.metalDark);
    platform.position.y = -1.15;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.42, 0.05, 16), m.formulaHot);
    ring.position.y = -1.03;
    this.lab.add(this.canister, platform, ring);
    this.bubbles = new ParticleField(this.lab, 160, { additive: true, size: 0.05 });
  }

  buildView() {
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(52, 4 / 3, 0.01, 10);
    this.viewCamera.updateMatrixWorld();
    this.viewScene.add(new THREE.AmbientLight(0x8899aa, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1, 2, 1.5);
    this.viewScene.add(key);
    this.muzzleLight = new THREE.PointLight(ENGINE.BLUE_HOT, 0, 3, 1.2);
    this.viewScene.add(this.muzzleLight);
    this.muzzleT = 0;
    this.guns = { 1: new GunRig(this, 1), 2: new GunRig(this, 2) };
  }

  /* ── Modos ── */

  applyMode() {
    if (this.mode !== 'level') this.clearLevel();
    if (this.mode !== 'intro' && this.heroLight) this.heroLight.intensity = 0;
    if (this.mode === 'attract') {
      this.attractGroup.visible = true;
      this.attractClock = 0;
      for (const soldier of this.soldierModels) soldier.group.visible = false;
    } else if (this.mode === 'intro') {
      this.prepareShot();
    } else if (this.mode === 'level') {
      this.startLevel();
    }
  }

  playerCount() {
    return Math.max(1, PLAYER_IDS.filter((id) => this.game.players[id].active).length);
  }

  startLevel() {
    this.clearLevel();
    this.attractGroup.visible = false;
    for (const soldier of this.soldierModels) soldier.group.visible = false;
    this.hpScale = 1 + ENGINE.COOP_HP_SCALE * (this.playerCount() - 1);
    for (const id of PLAYER_IDS) {
      this.guns[id].shown = 0;
      this.guns[id].root.visible = false;
    }
    this.director.start();
  }

  clearLevel() {
    for (const enemy of this.enemies) enemy.dispose();
    for (const spit of this.spits) spit.remove();
    for (const shell of this.grenades) shell.dispose();
    for (const pickup of this.pickups) if (pickup.alive) pickup.remove();
    for (const wave of this.waves) {
      wave.mesh.removeFromParent();
      wave.mesh.material.dispose();
    }
    this.enemies = [];
    this.spits = [];
    this.grenades = [];
    this.pickups = [];
    this.waves = [];
    this.boss = null;
    for (const barrel of this.barrels) barrel.reset();
    this.fxBlue.clear();
    this.fxSlime.clear();
    this.tracers.clear();
    this.blasts.clear();
    this.director?.reset();
    this.shakeAmt = 0;
  }

  prepareShot() {
    const shot = this.shot;
    this.attractGroup.visible = ['city', 'squad', 'drop'].includes(shot);
    const players = this.game.players;
    const connected = PLAYER_IDS.filter((id) => players[id].connected);
    const show = connected.length ? connected : PLAYER_IDS;
    this.soldierModels.forEach((soldier, i) => {
      const id = i + 1;
      const visible = ['squad', 'drop'].includes(shot) && show.includes(id);
      soldier.group.visible = visible;
      const x = show.length === 1 ? 0 : (id === 1 ? -0.45 : 0.45);
      soldier.group.position.set(x, 0, -1);
      // «squad»: avanzan de espaldas hacia la ciudad · «drop»: primer plano de frente con los visores
      soldier.group.rotation.set(0, shot === 'squad' ? Math.PI : 0, 0);
    });
    this.soloSquad = show.length === 1;
    this.heroLight.intensity = ['squad', 'drop'].includes(shot) ? 16 : 0;
    this.heroLight.position.set(0.6, 2.4, 1.6);
  }

  updateAttract(dt) {
    this.attractClock += dt;
    if (this.attractClock > ENGINE.ATTRACT_CUT_S) {
      this.attractClock = 0;
      this.attractCam = (this.attractCam + 1) % ATTRACT_CAMS.length;
    }
    const cam = ATTRACT_CAMS[this.attractCam];
    const pos = this.tmp.set(...cam.pos);
    const yaw = Math.sin((this.time * Math.PI * 2) / cam.period) * cam.pan;
    const dx = cam.look[0] - cam.pos[0];
    const dz = cam.look[2] - cam.pos[2];
    const lookX = cam.pos[0] + dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lookZ = cam.pos[2] + dx * Math.sin(yaw) + dz * Math.cos(yaw);
    this.camera.position.copy(pos);
    this.camera.lookAt(lookX, cam.look[1], lookZ);
    for (const actor of this.attractActors) actor.update(dt);
  }

  updateIntro(dt) {
    this.shotTime += dt;
    const k = clamp(this.shotTime / ENGINE.SHOT_S, 0, 1);
    const cam = this.camera;
    switch (this.shot) {
      case 'world':
      case 'spread': {
        const spread = this.shot === 'spread';
        const angle = 0.6 + this.time * 0.22;
        const radius = spread ? lerp(5.6, 4.4, easeOut(k)) : lerp(8, 6.8, easeOut(k));
        this.spaceCam.position.set(Math.sin(angle) * radius, 1.1, Math.cos(angle) * radius);
        this.spaceCam.lookAt(0, 0, 0);
        this.earth.rotation.y += dt * 0.25;
        this.contamination.material.opacity = spread ? lerp(0.35, 0.95, k) : lerp(0.05, 0.35, k);
        const pulse = 0.5 + Math.sin(this.time * 8) * 0.15 + (spread ? 0.4 : 0);
        this.reactor.scale.set(pulse, pulse, 1);
        break;
      }
      case 'city':
        cam.position.lerpVectors(this.tmp.set(0, 15, 8), new THREE.Vector3(0, 9, -18), easeInOut(k));
        cam.lookAt(0, 0, -40);
        break;
      case 'formula': {
        const angle = this.time * 0.8;
        this.labCam.position.set(Math.sin(angle) * 3.2, 0.6 + Math.sin(this.time) * 0.2, Math.cos(angle) * 3.2);
        this.labCam.lookAt(0, 0, 0);
        this.canister.rotation.y += dt * 0.6;
        this.bubbles.emit(new THREE.Vector3((Math.random() - 0.5) * 0.7, -0.7, (Math.random() - 0.5) * 0.7), { count: 2, speed: 0.1, life: 1.6, gravity: -0.9, colors: [ENGINE.BLUE_WHITE, ENGINE.BLUE_HOT], up: 0 });
        this.bubbles.update(dt);
        break;
      }
      case 'squad':
        // Plano de dron: baja sobre el escuadrón que entra a la avenida (las fichas ocupan la mitad superior)
        cam.position.lerpVectors(this.tmp.set(0, 7, 7), new THREE.Vector3(0, 3.2, 3.4), easeInOut(k));
        cam.lookAt(0, 0.6, lerp(-4, -7, k));
        for (const soldier of this.soldierModels) {
          if (!soldier.group.visible) continue;
          soldier.group.position.z -= dt * 1.2;
          soldier.group.position.y = Math.abs(Math.sin(this.shotTime * 7)) * 0.05;
        }
        break;
      case 'drop': {
        // Primer plano contrapicado: máscaras antirradiación y visores cian, la cámara se aleja
        const spread = this.soloSquad ? 0 : 0.35;
        cam.position.lerpVectors(this.tmp.set(spread * 0.4, 1.25, 0.7), new THREE.Vector3(0, 1.35, 2.0), easeOut(k));
        cam.lookAt(0, 1.62, -1);
        break;
      }
      default:
        break;
    }
    for (const soldier of this.soldierModels) {
      soldier.visor.color.setHex(Math.sin(this.time * 4) > 0 ? 0x3ff6ff : 0x7ffbff);
    }
    if (this.attractGroup.visible) for (const actor of this.attractActors) actor.update(dt);
  }

  updateLevel(dt) {
    this.director.update(dt);
    for (const enemy of this.enemies) enemy.update(dt);
    this.enemies = this.enemies.filter((enemy) => !enemy.removed);
    for (const spit of this.spits) spit.update(dt);
    this.spits = this.spits.filter((spit) => spit.alive);
    for (const shell of this.grenades) shell.update(dt);
    this.grenades = this.grenades.filter((shell) => shell.alive);
    for (const pickup of this.pickups) pickup.update(dt);
    this.pickups = this.pickups.filter((pickup) => pickup.alive);
    for (const barrel of this.barrels) barrel.update(dt);
    this.updateShockwaves(dt);
    const slots = this.gunSlots();
    for (const id of PLAYER_IDS) this.guns[id].update(dt, this.game.players[id], slots[id]);
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      this.muzzleLight.intensity = this.muzzleT > 0 ? 4 : 0;
    }
  }

  animateEnvironment(dt) {
    this.fireClock += dt;
    if (this.fireClock > 0.1) {
      this.fireClock = 0;
      this.fireFrame = (this.fireFrame + 1) % 4;
      this.fireTextures[0].offset.x = this.fireFrame * 0.25;
      this.fireTextures[1].offset.x = ((this.fireFrame + 2) % 4) * 0.25;
    }
    for (const fire of this.fires) {
      const flicker = 0.85 + Math.random() * 0.3;
      if (fire.light) fire.light.intensity = 18 * flicker;
      fire.sprites.forEach((sprite, i) => {
        const s = 1.2 + Math.sin(this.time * 9 + i * 2) * 0.12;
        sprite.scale.set(s, s * 1.1, 1);
      });
      fire.smokeTimer -= dt;
      if (fire.smokeTimer <= 0) {
        fire.smokeTimer = 0.32;
        this.smoke.emit(fire.base.clone().setY(fire.base.y + 0.9));
      }
    }
    this.mats.lampFlicker.color.setHex(Math.random() < 0.08 ? 0x3a3020 : 0xffe4a0);
    for (const pool of this.pools) {
      const s = pool.base + Math.sin(this.time * 0.6 + pool.phase) * 0.12;
      pool.mesh.scale.set(s, 1, s);
    }
    if (Math.random() < 0.25 && this.drips.length) {
      const drip = this.drips[Math.floor(Math.random() * this.drips.length)];
      this.fxSlime.emit(drip, { count: 1, speed: 0.3, life: 0.5, gravity: 6, colors: [ENGINE.GREEN_HOT], up: 0 });
    }
    for (const car of this.cars) {
      if (car.wobble <= 0) continue;
      car.wobble = Math.max(0, car.wobble - dt * 3);
      car.group.position.x = car.x + Math.sin(this.time * 60) * 0.03 * car.wobble;
    }
  }

  render() {
    const r = this.renderer;
    r.clear();
    if (this.mode === 'intro' && (this.shot === 'world' || this.shot === 'spread')) {
      r.render(this.space, this.spaceCam);
    } else if (this.mode === 'intro' && this.shot === 'formula') {
      r.render(this.lab, this.labCam);
    } else {
      r.render(this.city, this.camera);
    }
    if (this.mode === 'level') {
      r.clearDepth();
      r.render(this.viewScene, this.viewCamera);
    }
  }

  /* ── Combate ── */

  addTarget(object) {
    this.targets.add(object);
  }

  removeTarget(object) {
    this.targets.delete(object);
  }

  raycast(aim) {
    this.city.updateMatrixWorld();
    this.ndc.set(clamp(aim.x, -1, 1), clamp(aim.y, -1, 1));
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.raycaster.far = ENGINE.BULLET_RANGE;
    const hits = this.raycaster.intersectObjects([...this.targets, ...this.statics], false);
    return hits.find((h) => !h.object.userData.target || h.object.userData.target.alive) || null;
  }

  basis() {
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
  }

  gunSide(playerId) {
    if (this.playerCount() <= 1) return 0.34;
    return playerId === 1 ? -0.42 : 0.42;
  }

  gunSlots() {
    if (this.playerCount() <= 1) {
      const solo = new THREE.Vector3(0.34, -0.33, -0.78);
      return { 1: solo, 2: solo };
    }
    return { 1: new THREE.Vector3(-0.42, -0.34, -0.8), 2: new THREE.Vector3(0.42, -0.34, -0.8) };
  }

  muzzleWorld(playerId) {
    this.basis();
    return this.camera.position.clone()
      .addScaledVector(this.forward, 0.75)
      .addScaledVector(this.right, this.gunSide(playerId))
      .addScaledVector(this.up, -0.3);
  }

  launcherWorld(playerId) {
    return this.muzzleWorld(playerId).addScaledVector(this.up, -0.1);
  }

  /** Punto delante de la cámara donde los zombies se plantan a golpear. */
  attackPoint(lane) {
    this.basis();
    const p = this.camera.position.clone().addScaledVector(this.forward, 1.75).addScaledVector(this.right, lane);
    p.y = 0;
    return p;
  }

  slimeSpot() {
    this.basis();
    const p = this.camera.position.clone()
      .addScaledVector(this.forward, 7.5 + Math.random() * 3.5)
      .addScaledVector(this.right, (Math.random() * 2 - 1) * 3.2);
    p.y = 0;
    return p;
  }

  /** A qué altura y lado de la pantalla llega un ataque dirigido a cada jugador. */
  impactPoint(playerId) {
    this.basis();
    const side = this.playerCount() <= 1 ? 0 : (playerId === 1 ? -0.42 : 0.42);
    return this.camera.position.clone()
      .addScaledVector(this.forward, 0.55)
      .addScaledVector(this.right, side)
      .addScaledVector(this.up, -0.3);
  }

  separate(zombie) {
    for (const other of this.enemies) {
      if (other === zombie || !other.alive || other.kind !== 'zombie') continue;
      const dx = zombie.group.position.x - other.group.position.x;
      const dz = zombie.group.position.z - other.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < 0.75) {
        const push = (0.75 - d) * 0.5;
        zombie.group.position.x += (dx / d) * push;
        zombie.group.position.z += (dz / d) * push;
      }
    }
  }

  projectNdc(position) {
    const v = this.tmp.copy(position).project(this.camera);
    if (v.z > 1) return { x: 0, y: 0 };
    return { x: clamp(v.x, -1, 1), y: clamp(v.y, -1, 1) };
  }

  pickPlayer(preferred) {
    const players = this.game.players;
    const ok = (id) => players[id]?.active && players[id].alive;
    if (ok(preferred)) return preferred;
    const other = preferred === 1 ? 2 : 1;
    return ok(other) ? other : 0;
  }

  randomTarget() {
    const alive = PLAYER_IDS.filter((id) => this.game.players[id].active && this.game.players[id].alive);
    return alive.length ? alive[Math.floor(Math.random() * alive.length)] : 1;
  }

  hurt(playerId) {
    if (playerId && this.game.damagePlayer(playerId, 1)) this.shake(0.14);
  }

  zombieStrike(zombie) {
    const ndc = this.projectNdc(zombie.center());
    this.hurt(this.pickPlayer(ndc.x < 0 ? 1 : 2));
  }

  spitHit(spit) {
    spit.remove();
    this.game.hudBurst('splat', this.projectNdc(spit.pos));
    this.sfxAt('splat', spit.pos, 1);
    this.hurt(this.pickPlayer(spit.targetId));
  }

  spawnEnemy(type, position, { minion = false } = {}) {
    this.basis();
    const lane = (Math.random() * 2 - 1) * 0.9;
    const actor = type === 'slime'
      ? new Slime(this, position, { mode: 'hunt', rise: true })
      : new Zombie(this, position, { mode: 'hunt', rise: true, lane });
    actor.minion = minion;
    this.city.add(actor.group);
    for (const mesh of actor.parts) this.addTarget(mesh);
    this.enemies.push(actor);
    this.sfxAt('emerge', position, 0.6);
    return actor;
  }

  spawnSpit(from, targetId) {
    this.spits.push(new Spit(this, from, targetId));
  }

  spawnPickup(kind, position, ttl = Infinity) {
    this.pickups.push(new Pickup(this, kind, position, ttl));
  }

  spawnBoss() {
    this.boss = new MadreBaba(this);
    this.city.add(this.boss.group);
    for (const mesh of this.boss.parts) this.addTarget(mesh);
    this.enemies.push(this.boss);
    this.game.showBoss();
    this.sfxAt('roar', this.boss.center(), 1.2);
  }

  killMinions() {
    for (const enemy of this.enemies) {
      if (enemy !== this.boss && enemy.alive) enemy.kill(0, { scored: false });
    }
    for (const spit of this.spits) spit.destroy(0, false);
  }

  onBossDefeated() {
    this.game.hideBoss();
    this.shake(0.6);
    this.director.bossDefeated();
  }

  onActorKilled(actor, playerId) {
    if (!playerId) return;
    const base = ENGINE.SCORE[actor.kind] || 0;
    const bonus = actor.lastPart === 'head' ? ENGINE.SCORE.headshot : 0;
    this.game.addScore(playerId, base + bonus, this.projectNdc(actor.center()));
    this.game.registerKill(playerId);
    if (actor.kind === 'zombie' && !actor.minion && Math.random() < 0.08) {
      this.spawnPickup('medkit', actor.center().setY(1.3), 9);
    }
  }

  collect(pickup, playerId) {
    const position = pickup.sprite.position.clone();
    this.fxBlue.emit(position, { count: 24, speed: 2.4, life: 0.6, gravity: -1, colors: [0xffffff, ENGINE.BLUE_HOT] });
    this.sfxAt('pickup', position, 1);
    if (pickup.kind === 'medkit') {
      this.game.healPlayer(playerId);
    } else {
      const player = this.game.players[playerId];
      if (player?.active) {
        player.grenades = Math.min(CONFIG.GRENADES_MAX, player.grenades + 1);
        this.game.renderPlayer(playerId);
        this.game.syncPlayer(playerId);
        const point = ndcToPixel(this.projectNdc(position));
        this.game.hudCanvas.popup('+1 GRANADA', point.x, point.y - 10, CONFIG.PLAYERS[playerId].color);
      }
    }
    this.game.addScore(playerId, ENGINE.SCORE.pickup, this.projectNdc(position));
  }

  explodeGrenade(shell) {
    const at = shell.to;
    this.blasts.spawn(at, { color: ENGINE.BLUE_HOT, radius: ENGINE.GRENADE_RADIUS, light: 45 });
    this.fxBlue.emit(at, { count: 70, speed: 6, life: 0.7, gravity: 5, colors: [ENGINE.BLUE_WHITE, ENGINE.BLUE_HOT, ENGINE.BLUE] });
    this.shake(0.25);
    this.blastDamage(at, ENGINE.GRENADE_RADIUS, ENGINE.GRENADE_DAMAGE, shell.playerId);
    this.game.grenadeExploded(shell.playerId, this.projectNdc(at), { hudBurst: false });
  }

  barrelBlast(barrel, playerId) {
    const at = barrel.center();
    this.blasts.spawn(at, { color: ENGINE.GREEN_HOT, radius: ENGINE.BARREL_RADIUS, light: 40 });
    this.fxSlime.emit(at, { count: 60, speed: 7, life: 0.9, gravity: 8, colors: [ENGINE.GREEN, ENGINE.GREEN_HOT, 0xd6ff8c] });
    this.fxBlue.emit(at, { count: 30, speed: 5, life: 0.6, gravity: 3 });
    this.shake(0.3);
    this.sfxAt('explosion', at, 1);
    if (playerId) this.game.addScore(playerId, ENGINE.SCORE.barrel, this.projectNdc(at));
    this.blastDamage(at, ENGINE.BARREL_RADIUS, ENGINE.BARREL_DAMAGE, playerId);
  }

  blastDamage(center, radius, amount, playerId) {
    for (const enemy of [...this.enemies]) {
      if (!enemy.alive) continue;
      if (enemy.center().distanceTo(center) <= radius + enemy.radius) enemy.onBlast(playerId, amount);
    }
    for (const spit of [...this.spits]) {
      if (spit.alive && spit.pos.distanceTo(center) <= radius) spit.onBlast(playerId);
    }
    for (const barrel of this.barrels) {
      if (barrel.alive && barrel.center().distanceTo(center) <= radius) barrel.damage(2, playerId, barrel.center(), 'blast');
    }
  }

  /** Golpe de tentáculos del Boss: onda verde que barre el suelo hacia los soldados. */
  bossSlam(boss) {
    this.shake(0.6);
    this.sfxAt('slam', boss.center(), 1.2);
    const mesh = new THREE.Mesh(this.geometries.ring, new THREE.MeshBasicMaterial({ color: ENGINE.GREEN_HOT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    mesh.position.set(BOSS_CENTER[0], 0.12, BOSS_CENTER[1]);
    this.city.add(mesh);
    const reach = Math.max(4, distXZ(this.camera.position, mesh.position));
    this.waves.push({ mesh, t: 0, dur: 0.7, reach, hit: false });
  }

  updateShockwaves(dt) {
    for (const wave of this.waves) {
      wave.t += dt;
      const k = clamp(wave.t / wave.dur, 0, 1);
      const r = lerp(1, wave.reach + 1, k);
      wave.mesh.scale.set(r, 1, r);
      wave.mesh.material.opacity = 1 - k * 0.6;
      if (k >= 1 && !wave.hit) {
        wave.hit = true;
        for (const id of PLAYER_IDS) {
          if (this.game.players[id].active && this.game.players[id].alive) this.game.damagePlayer(id, 1);
        }
        this.shake(0.4);
        wave.mesh.removeFromParent();
        wave.mesh.material.dispose();
      }
    }
    this.waves = this.waves.filter((wave) => !wave.hit);
  }

  /* ── Efectos ── */

  sparks(point) {
    this.fxBlue.emit(point, { count: 8, speed: 3, life: 0.25, gravity: 6, colors: [0xffffff, ENGINE.BLUE_HOT] });
  }

  splat(point) {
    this.fxSlime.emit(point, { count: 22, speed: 3.5, life: 0.6, gravity: 9, colors: [ENGINE.GREEN_HOT, ENGINE.GREEN, 0xd6ff8c] });
    this.sfxAt('splat', point, 0.8);
  }

  /** Disolución en partículas azules que flotan hacia arriba. */
  dissolve(actor) {
    const c = actor.center();
    const spreadY = actor.kind === 'slime' ? 0.7 : 1.6;
    for (let i = 0; i < 6; i += 1) {
      const p = c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * spreadY, (Math.random() - 0.5) * 0.8));
      this.fxBlue.emit(p, { count: 9, speed: 1.4, life: 0.9, gravity: -1.6, colors: [ENGINE.BLUE_WHITE, ENGINE.BLUE_HOT, ENGINE.BLUE], up: 0.2 });
    }
  }

  smashFx(smash) {
    const point = new THREE.Vector3(...smash.point);
    this.fxBlue.emit(point, { count: 4, speed: 2.5, life: 0.2, gravity: 8, colors: [0xffffff, 0xffd8a0] });
    this.fxSlime.emit(point, { count: 5, speed: 2, life: 0.5, gravity: 9, colors: [0x3a3f46, 0x5f6a76] });
    if (smash.car) smash.car.wobble = 1;
  }

  viewFlash(rig) {
    const p = rig.root.position;
    this.muzzleLight.position.set(p.x, p.y + 0.05, p.z - 0.5);
    this.muzzleLight.intensity = 4;
    this.muzzleT = 0.05;
  }

  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  applyShake(dt) {
    if (this.shakeAmt <= 0) return;
    const a = this.shakeAmt * 0.5;
    this.camera.position.x += (Math.random() - 0.5) * a;
    this.camera.position.y += (Math.random() - 0.5) * a;
    this.camera.position.z += (Math.random() - 0.5) * a;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.6);
  }

  sfxAt(name, position, gain = 1) {
    const pan = clamp(this.projectNdc(position).x * 0.7, -0.8, 0.8);
    this.game.audio.sfx(name, { pan, gain });
  }
}


/* ───────────────────────────── 19. SONIDOS DEL NIVEL ──────────────────── */

Object.assign(SFX_RECIPES, {
  groan: (a, out, t) => Math.max(
    a.tone(out, t, { type: 'sawtooth', f0: 110, f1: 70, dur: 0.55, vol: 0.14 }),
    a.noise(out, t, { dur: 0.5, vol: 0.1, type: 'bandpass', f0: 500, f1: 300, q: 3 }),
  ),
  spit: (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.18, vol: 0.32, type: 'bandpass', f0: 900, f1: 2200, q: 2 }),
    a.tone(out, t, { type: 'sine', f0: 300, f1: 900, dur: 0.12, vol: 0.18 }),
  ),
  splat: (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.25, vol: 0.38, type: 'lowpass', f0: 1200, f1: 200 }),
    a.tone(out, t, { type: 'sine', f0: 180, f1: 60, dur: 0.2, vol: 0.3 }),
  ),
  roar: (a, out, t) => Math.max(
    a.tone(out, t, { type: 'sawtooth', f0: 90, f1: 55, dur: 1.4, vol: 0.35 }),
    a.noise(out, t, { dur: 1.2, vol: 0.28, type: 'lowpass', f0: 800, f1: 200 }),
    a.tone(out, t, { type: 'square', f0: 45, f1: 38, dur: 1.2, vol: 0.1 }),
  ),
  slam: (a, out, t) => Math.max(
    a.tone(out, t, { type: 'sine', f0: 70, f1: 28, dur: 0.6, vol: 0.9 }),
    a.noise(out, t, { dur: 0.7, vol: 0.7, type: 'lowpass', f0: 1500, f1: 100 }),
  ),
  pickup: (a, out, t) => Math.max(
    ...[784, 1175, 1568].map((f, i) => a.tone(out, t, { type: 'square', f0: f, dur: 0.06, vol: 0.13, at: i * 0.06 })),
  ),
  emerge: (a, out, t) => Math.max(
    a.noise(out, t, { dur: 0.8, vol: 0.22, type: 'bandpass', f0: 300, f1: 900, q: 1.5 }),
    a.tone(out, t, { type: 'sawtooth', f0: 60, f1: 90, dur: 0.8, vol: 0.08 }),
  ),
});


/* ───────────────────────────── 20. REGISTRO DEL MUNDO 3D ──────────────── */

registerWorld((app, game) => new ThreeWorld(app, game));
