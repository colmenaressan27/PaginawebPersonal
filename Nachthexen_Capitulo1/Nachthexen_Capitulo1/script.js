/* ==========================================================================
   NACHTHEXEN · LAS BRUJAS DE LA NOCHE — Capítulo 1 (Beta)
   script.js · Motor del juego (Three.js r128 + Web Audio API)
   --------------------------------------------------------------------------
   Índice
   01. Arranque y carga de Three.js
   02. Utilidades matemáticas y ruido
   03. Variables CSS en tiempo de ejecución (sin atributos style)
   04. Configuración persistente y referencias al DOM
   05. Motor de audio (síntesis + pista Steel_Horizon_Siege.mp3)
   06. Imágenes y texturas procedurales (fallback de la carpeta img/)
   07. Materiales retro y fusión de geometrías
   08. Modelos low poly
   09. Escenario: cielo, terreno y decorado
   10. Partículas, luces y efectos
   11. Proyectiles
   12. Entidades: enemigos, reflectores, suministros
   13. Jefe final: Zeppelin blindado «Walküre»
   14. Jugadora: Polikarpov Po-2
   15. Entrada: teclado y ratón
   16. Transmisiones de radio (Comms)
   17. Interfaz: HUD, menús y mapa táctico
   18. Guion del Capítulo 1
   19. Cinemática inicial y escena de menú
   20. Post-procesado CRT
   21. Bucle principal y estados
   ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
     01. ARRANQUE Y CARGA DE THREE.JS
     ====================================================================== */
  const THREE_FALLBACK_URL = 'https://unpkg.com/three@0.128.0/build/three.min.js';

  function loadThree() {
    return new Promise(function (resolve, reject) {
      if (window.THREE) { resolve(window.THREE); return; }
      const s = document.createElement('script');
      s.src = THREE_FALLBACK_URL;
      s.onload = function () {
        if (window.THREE) resolve(window.THREE);
        else reject(new Error('Three.js no se inicializó correctamente.'));
      };
      s.onerror = function () {
        reject(new Error('No se pudo descargar Three.js. Revisa tu conexión a Internet y recarga la página.'));
      };
      document.head.appendChild(s);
    });
  }

  function fatal(message) {
    const out = document.getElementById('boot-error');
    const screen = document.getElementById('screen');
    if (out) out.textContent = message;
    if (screen) screen.classList.add('has-error');
  }

  function start() {
    loadThree()
      .then(function () {
        try {
          main();
        } catch (err) {
          console.error(err);
          fatal('Error al iniciar el motor del juego: ' + err.message);
        }
      })
      .catch(function (err) { fatal(err.message); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* ======================================================================
     MOTOR (todo vive dentro de main para usar THREE ya cargado)
     ====================================================================== */
  function main() {

    /* ====================================================================
       02. UTILIDADES MATEMÁTICAS Y RUIDO
       ==================================================================== */
    const TAU = Math.PI * 2;
    const V3 = THREE.Vector3;
    const ORIGIN = new V3(0, 0, 0);
    const UP = new V3(0, 1, 0);
    const X_AXIS = new V3(1, 0, 0);
    const Z_AXIS = new V3(0, 0, 1);
    const tmpV = new V3();
    const tmpV2 = new V3();
    const tmpV3 = new V3();
    const tmpV4 = new V3();
    const tmpQ = new THREE.Quaternion();
    const tmpQ2 = new THREE.Quaternion();
    const tmpM = new THREE.Matrix4();
    const tmpC = new THREE.Color();

    const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
    const rand = (a, b) => a + Math.random() * (b - a);
    const randSign = () => (Math.random() < 0.5 ? -1 : 1);
    const smoothstep = (a, b, x) => {
      const t = clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    function randomDir(out) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * TAU;
      const r = Math.sqrt(1 - u * u);
      return out.set(r * Math.cos(a), u, r * Math.sin(a));
    }

    /* Generador pseudoaleatorio con semilla (xorshift32) */
    function seeded(seed) {
      let s = (seed | 0) || 1;
      return function () {
        s ^= s << 13;
        s ^= s >>> 17;
        s ^= s << 5;
        return (s >>> 0) / 4294967296;
      };
    }

    /* Ruido de valor 2D para el terreno */
    function hash2(x, z) {
      const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
      return h - Math.floor(h);
    }

    function valueNoise(x, z) {
      const xi = Math.floor(x);
      const zi = Math.floor(z);
      const xf = x - xi;
      const zf = z - zi;
      const u = xf * xf * (3 - 2 * xf);
      const v = zf * zf * (3 - 2 * zf);
      const a = hash2(xi, zi);
      const b = hash2(xi + 1, zi);
      const c = hash2(xi, zi + 1);
      const d = hash2(xi + 1, zi + 1);
      return lerp(lerp(a, b, u), lerp(c, d, u), v);
    }

    function fbm(x, z) {
      return valueNoise(x, z) * 0.6 + valueNoise(x * 2.07, z * 2.07) * 0.28 + valueNoise(x * 4.3, z * 4.3) * 0.12;
    }

    /* Altura del terreno: corredor bajo en el centro, colinas a los lados */
    function terrainHeight(x, z) {
      const valley = smoothstep(16, 75, Math.abs(x));
      const n = fbm(x * 0.017, z * 0.017);
      const hills = n * (4 + valley * 24);
      const ripples = valueNoise(x * 0.09, z * 0.09) * 1.1;
      return -2.4 + hills * (0.35 + valley * 0.65) + ripples - (1 - valley) * 1.0;
    }

    /* Distancia de un segmento a un punto (colisiones sin "efecto túnel") */
    function segSphere(a, b, c, r) {
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? (acx * abx + acy * aby + acz * abz) / len2 : 0;
      t = clamp(t, 0, 1);
      const dx = a.x + abx * t - c.x;
      const dy = a.y + aby * t - c.y;
      const dz = a.z + abz * t - c.z;
      return dx * dx + dy * dy + dz * dz <= r * r;
    }

    /* ¿Está el punto p dentro del cono de luz de un reflector? */
    function coneContains(apex, dir, p, length, halfTan, extra) {
      tmpV4.copy(p).sub(apex);
      const along = tmpV4.dot(dir);
      if (along <= 0 || along > length) return false;
      const perp2 = tmpV4.lengthSq() - along * along;
      const rad = along * halfTan + extra;
      return perp2 <= rad * rad;
    }

    /* Orienta un objeto (morro en -Z) hacia una dirección con alabeo */
    function orientQuat(out, dir, bank, pitch) {
      tmpM.lookAt(ORIGIN, dir, UP);
      out.setFromRotationMatrix(tmpM);
      if (pitch) { tmpQ2.setFromAxisAngle(X_AXIS, pitch); out.multiply(tmpQ2); }
      if (bank) { tmpQ2.setFromAxisAngle(Z_AXIS, bank); out.multiply(tmpQ2); }
      return out;
    }

    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function pad(n, len) {
      let s = String(Math.max(0, Math.floor(n)));
      while (s.length < len) s = '0' + s;
      return s;
    }

    /* ====================================================================
       03. VARIABLES CSS EN TIEMPO DE EJECUCIÓN
       Se usa una hoja de estilo construida (adoptedStyleSheets) con una
       única regla :root. Así el DOM nunca recibe atributos style="...".
       ==================================================================== */
    const CSSVars = (function () {
      let target = null;
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(':root {}');
        document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
        target = sheet.cssRules[0].style;
      } catch (e) {
        // Navegadores antiguos: variables en la raíz del documento
        target = document.documentElement.style;
      }
      const cache = Object.create(null);
      return {
        set(name, value) {
          if (cache[name] === value) return;
          cache[name] = value;
          target.setProperty(name, value);
        }
      };
    })();

    /* ====================================================================
       04. CONFIGURACIÓN PERSISTENTE Y REFERENCIAS AL DOM
       ==================================================================== */
    const Settings = {
      key: 'nachthexen.beta.settings',
      data: {
        master: 0.8,
        music: 0.8,
        sfx: 0.9,
        control: 'keyboard',
        invertY: false,
        crt: 'medium',
        res: 270,
        difficulty: 'normal',
        best: 0
      },
      load() {
        try {
          const raw = window.localStorage.getItem(this.key);
          if (raw) Object.assign(this.data, JSON.parse(raw));
        } catch (e) { /* almacenamiento no disponible */ }
      },
      save() {
        try {
          window.localStorage.setItem(this.key, JSON.stringify(this.data));
        } catch (e) { /* almacenamiento no disponible */ }
      }
    };
    Settings.load();

    const $ = (id) => document.getElementById(id);
    const el = {
      screen: $('screen'),
      view: $('view'),
      retNear: $('reticle-near'),
      retFar: $('reticle-far'),
      score: $('hud-score'),
      hits: $('hud-hits'),
      objective: $('hud-objective'),
      bombs: $('hud-bombs'),
      glideState: $('hud-glide-state'),
      banner: $('banner'),
      comms: $('comms'),
      commsFace: $('comms-face'),
      commsName: $('comms-name'),
      commsText: $('comms-text'),
      intro: $('ov-intro'),
      introDate: $('intro-date'),
      introText: $('intro-text'),
      map: $('map-canvas'),
      best: $('best-score'),
      bootBtn: $('btn-boot'),
      skipBtn: $('btn-skip'),
      retryBoss: $('btn-retry-boss'),
      goText: $('go-text'),
      res: {
        score: $('res-score'),
        kills: $('res-kills'),
        acc: $('res-acc'),
        shots: $('res-shots'),
        bombs: $('res-bombs'),
        dmg: $('res-dmg'),
        time: $('res-time'),
        medal: $('res-medal')
      },
      opt: {
        master: $('opt-master'),
        music: $('opt-music'),
        sfx: $('opt-sfx'),
        outMaster: $('out-master'),
        outMusic: $('out-music'),
        outSfx: $('out-sfx'),
        kb: $('ctl-keyboard'),
        mouse: $('ctl-mouse'),
        invert: $('opt-invert'),
        crt: $('opt-crt'),
        res: $('opt-res'),
        diff: $('opt-diff'),
        form: $('options-form')
      }
    };

    /* Clases de estado en la pantalla (con caché para no tocar el DOM en vano) */
    const classCache = Object.create(null);
    function screenClass(name, on) {
      on = !!on;
      if (classCache[name] === on) return;
      classCache[name] = on;
      el.screen.classList.toggle(name, on);
    }

    const textCache = new Map();
    function setText(node, value) {
      if (textCache.get(node) === value) return;
      textCache.set(node, value);
      node.textContent = value;
    }

    /* ====================================================================
       05. MOTOR DE AUDIO
       - Música del nivel: Steel_Horizon_Siege.mp3 en bucle (raíz o audio/).
       - Menú, cinemática y efectos: síntesis en tiempo real (Web Audio API).
       - Modo Planeo: la música baja al 25 % y pasa por un filtro paso bajo.
       ==================================================================== */
    const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

    /* --- Partituras sintetizadas (composiciones originales) --- */
    const MENU_CHORDS = [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52], [50, 53, 57], [43, 46, 50], [45, 49, 52], [50, 53, 57]];
    const MENU_LEAD = new Map([
      [0, [69, 6]], [6, [74, 2]], [8, [72, 4]], [12, [69, 4]],
      [16, [70, 6]], [22, [69, 2]], [24, [65, 4]], [28, [62, 4]],
      [32, [64, 4]], [36, [67, 4]], [40, [72, 6]], [46, [70, 2]],
      [48, [69, 8]], [56, [61, 4]], [60, [64, 4]],
      [64, [62, 4]], [68, [65, 4]], [72, [69, 4]], [76, [74, 4]],
      [80, [74, 6]], [86, [72, 2]], [88, [70, 4]], [92, [67, 4]],
      [96, [69, 4]], [100, [73, 4]], [104, [76, 6]], [110, [73, 2]],
      [112, [74, 12]]
    ]);
    const INTRO_CHORDS = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]];
    const BATTLE_CHORDS = [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 49, 52]];
    const BATTLE_LEAD = new Map([
      [0, [74, 3]], [3, [72, 3]], [6, [74, 2]], [8, [77, 4]], [12, [76, 4]],
      [16, [74, 6]], [22, [70, 2]], [24, [69, 8]],
      [32, [72, 3]], [35, [74, 3]], [38, [76, 2]], [40, [79, 4]], [44, [77, 4]],
      [48, [76, 8]], [56, [73, 8]]
    ]);

    const THEMES = {
      /* Marcha nocturna en re menor para el menú */
      menu: {
        bpm: 84,
        steps: 128,
        play(i, t, A, d, out) {
          const bar = Math.floor(i / 16) % 8;
          const s = i % 16;
          const chord = MENU_CHORDS[bar];
          if (s === 0) A.pad(chord, t, d * 16, out, 0.016);
          if (s % 4 === 0) A.bass((s === 4 || s === 12 ? chord[2] : chord[0]) - 12, t, d * 3, out, 0.13);
          const n = MENU_LEAD.get(i);
          if (n) A.lead(n[0], t, n[1] * d, out, 0.045);
          if (s === 0 || s === 8) A.kick(t, 0.2, out);
          if (s === 4 || s === 12) A.snare(t, 0.035, out);
          if (bar % 2 === 1 && s >= 13) A.snare(t, 0.03 + (s - 13) * 0.02, out);
        }
      },
      /* Tensión para la cinemática: drones y timbales */
      intro: {
        bpm: 60,
        steps: 64,
        play(i, t, A, d, out) {
          const bar = Math.floor(i / 16) % 4;
          const s = i % 16;
          const chord = INTRO_CHORDS[bar];
          if (s === 0) {
            A.pad(chord, t, d * 16, out, 0.02);
            A.bass(chord[0] - 24, t, d * 15, out, 0.16);
            A.timpani(t, 0.42, out);
          }
          if (s === 10) A.timpani(t, 0.16, out);
          if (bar === 3 && s >= 12) A.timpani(t, 0.1 + (s - 12) * 0.05, out);
          if (s === 8 && bar % 2 === 0) A.bell(mtof(chord[2] + 24), t, 0.03, out);
        }
      },
      /* Respaldo si falta Steel_Horizon_Siege.mp3 */
      battle: {
        bpm: 150,
        steps: 64,
        play(i, t, A, d, out) {
          const bar = Math.floor(i / 16) % 4;
          const s = i % 16;
          const chord = BATTLE_CHORDS[bar];
          if (s % 2 === 0) A.bass(chord[0] - (s % 4 === 2 ? 12 : 24), t, d * 1.6, out, 0.15);
          if (s % 4 === 0) A.kick(t, 0.32, out);
          if (s === 4 || s === 12) A.snare(t, 0.12, out);
          if (s % 2 === 1) A.hat(t, 0.03, out);
          if (s === 0) A.stab([chord[0], chord[0] + 7, chord[0] + 12], t, d * 3, out);
          if (s === 10) A.stab([chord[0], chord[0] + 7, chord[0] + 12], t, d * 2, out);
          const n = BATTLE_LEAD.get(i);
          if (n) A.lead(n[0], t, n[1] * d, out, 0.04);
        }
      }
    };

    class AudioEngine {
      constructor() {
        this.ctx = null;
        this.ok = false;
        this.levelEl = null;
        this.levelRouted = false;
        this.levelFailed = false;
        this.levelWanted = false;
        this.pendingGesture = false;
        this.duck = 1;
        this.duckTarget = 1;
        this.levelFade = 1;
        this.levelFadeTarget = 1;
        this.themeName = null;
        this.theme = null;
        this.themeOut = null;
        this.seqTimer = null;
        this.engineCache = { level: -1, pitch: -1 };
        this.lastTick = 0;
        this.lastHitTink = 0;
      }

      init() {
        if (this.ctx) {
          if (this.ctx.state === 'suspended') this.ctx.resume();
          return;
        }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = this.ctx = new AC();

        this.master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 10;
        comp.ratio.value = 4;
        comp.attack.value = 0.004;
        comp.release.value = 0.25;
        this.master.connect(comp);
        comp.connect(ctx.destination);

        this.musicBus = ctx.createGain();
        this.musicBus.connect(this.master);
        this.sfxBus = ctx.createGain();
        this.sfxBus.connect(this.master);

        // Cadena del nivel: filtro paso bajo + atenuación (Modo Planeo)
        this.levelFilter = ctx.createBiquadFilter();
        this.levelFilter.type = 'lowpass';
        this.levelFilter.frequency.value = 20000;
        this.levelFilter.Q.value = 0.9;
        this.levelDuck = ctx.createGain();
        this.levelFilter.connect(this.levelDuck);
        this.levelDuck.connect(this.musicBus);

        // Filtro de radio para voces y chasquidos
        this.radioBus = ctx.createBiquadFilter();
        this.radioBus.type = 'bandpass';
        this.radioBus.frequency.value = 1500;
        this.radioBus.Q.value = 1.1;
        const radioGain = ctx.createGain();
        radioGain.gain.value = 1.6;
        this.radioBus.connect(radioGain);
        radioGain.connect(this.sfxBus);

        this.noise = this.makeNoise(3);
        this.buildEngine();
        this.buildWind();
        this.buildDrone();
        this.ok = true;
        this.applyVolumes();
        this.prepareLevelMusic();
      }

      makeNoise(seconds) {
        const len = Math.floor(this.ctx.sampleRate * seconds);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        return buf;
      }

      applyVolumes() {
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        this.master.gain.setTargetAtTime(Settings.data.master, t, 0.05);
        this.musicBus.gain.setTargetAtTime(Settings.data.music, t, 0.05);
        this.sfxBus.gain.setTargetAtTime(Settings.data.sfx, t, 0.05);
      }

      /* Reintento tras un gesto si el navegador bloqueó la reproducción */
      unlock() {
        if (!this.ok) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        if (this.pendingGesture && this.levelWanted) {
          this.pendingGesture = false;
          this.tryPlayLevel();
        }
      }

      /* ---------- Pista del nivel (Steel_Horizon_Siege.mp3) ---------- */
      prepareLevelMusic() {
        if (this.levelEl) return;
        const el = new Audio();
        el.loop = true;
        el.preload = 'auto';
        const sources = ['./Steel_Horizon_Siege.mp3', 'audio/Steel_Horizon_Siege.mp3'];
        let index = 0;
        el.addEventListener('error', () => {
          index++;
          if (index < sources.length) {
            el.src = sources[index];
            el.load();
            if (this.levelWanted) this.tryPlayLevel();
          } else if (!this.levelFailed) {
            this.levelFailed = true;
            console.warn('[Audio] No se encontró Steel_Horizon_Siege.mp3 (ni en ./ ni en audio/). Se usa la banda sonora sintetizada de respaldo.');
            if (this.levelWanted) this.startTheme('battle');
          }
        });
        el.src = sources[0];
        this.levelEl = el;
        // Con http(s) se enruta por Web Audio para aplicar el filtro paso bajo.
        // En file:// el navegador silenciaría la fuente, así que se usa el volumen.
        if (/^https?:$/.test(window.location.protocol)) {
          try {
            const src = this.ctx.createMediaElementSource(el);
            src.connect(this.levelFilter);
            this.levelRouted = true;
          } catch (e) {
            this.levelRouted = false;
          }
        }
      }

      playLevelMusic(restart) {
        if (!this.ok) return;
        this.levelWanted = true;
        this.levelFade = this.levelFadeTarget = 1;
        this.setGlide(false, true);
        this.stopTheme(0.6);
        if (this.levelFailed) {
          this.startTheme('battle');
          return;
        }
        if (restart) {
          try { this.levelEl.currentTime = 0; } catch (e) { /* aún sin metadatos */ }
        }
        this.tryPlayLevel();
      }

      tryPlayLevel() {
        if (!this.levelEl || this.levelFailed) return;
        const p = this.levelEl.play();
        if (p && typeof p.catch === 'function') {
          p.catch((err) => {
            if (err && err.name === 'NotAllowedError') this.pendingGesture = true;
            // NotSupportedError / AbortError: el evento 'error' prueba la ruta alternativa
          });
        }
      }

      pauseLevel() {
        if (this.levelEl) this.levelEl.pause();
        if (this.themeName === 'battle') this.stopTheme(0.1);
        this.setEngine(0, 1, 0.05);
        this.setWind(0, 0.05);
        this.setDrone(0);
      }

      resumeLevel() {
        if (!this.levelWanted) return;
        if (this.levelFailed) this.startTheme('battle');
        else this.tryPlayLevel();
      }

      stopLevel() {
        this.levelWanted = false;
        if (this.levelEl) {
          this.levelEl.pause();
          try { this.levelEl.currentTime = 0; } catch (e) { /* sin metadatos */ }
        }
        if (this.themeName === 'battle') this.stopTheme(0.4);
      }

      fadeLevel(target) {
        this.levelFadeTarget = target;
        if (this.ok) this.levelDuck.gain.setTargetAtTime(this.duckTarget * target, this.ctx.currentTime, 0.8);
      }

      /* Atenuación del Modo Planeo Silencioso */
      setGlide(on, instant) {
        this.duckTarget = on ? 0.25 : 1;
        if (!this.ok) return;
        const t = this.ctx.currentTime;
        const tc = instant ? 0.01 : 0.35;
        this.levelDuck.gain.setTargetAtTime(this.duckTarget * this.levelFadeTarget, t, tc);
        this.levelFilter.frequency.setTargetAtTime(on ? 650 : 20000, t, tc);
      }

      update(dt) {
        if (!this.ok || !this.levelEl) return;
        this.duck = damp(this.duck, this.duckTarget, 4, dt);
        this.levelFade = damp(this.levelFade, this.levelFadeTarget, 1.5, dt);
        // Sin enrutado (file://) la atenuación se aplica al volumen del elemento
        const v = this.levelRouted ? 1 : clamp(Settings.data.master * Settings.data.music * this.duck * this.levelFade, 0, 1);
        if (Math.abs(this.levelEl.volume - v) > 0.004) this.levelEl.volume = v;
      }

      /* ---------- Motor del Po-2 (M-11 de cinco cilindros) ---------- */
      buildEngine() {
        const ctx = this.ctx;
        const out = this.engineGain = ctx.createGain();
        out.gain.value = 0;
        out.connect(this.sfxBus);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 480;
        lp.Q.value = 2.5;
        lp.connect(out);
        const am = ctx.createGain();
        am.gain.value = 0.55;
        am.connect(lp);
        const o1 = ctx.createOscillator();
        o1.type = 'sawtooth';
        o1.frequency.value = 62;
        const o2 = ctx.createOscillator();
        o2.type = 'square';
        o2.frequency.value = 31;
        const g2 = ctx.createGain();
        g2.gain.value = 0.4;
        o1.connect(am);
        o2.connect(g2);
        g2.connect(am);
        const n = ctx.createBufferSource();
        n.buffer = this.noise;
        n.loop = true;
        const nf = ctx.createBiquadFilter();
        nf.type = 'bandpass';
        nf.frequency.value = 160;
        nf.Q.value = 0.9;
        const ng = ctx.createGain();
        ng.gain.value = 0.9;
        n.connect(nf);
        nf.connect(ng);
        ng.connect(am);
        // "Putt-putt": modulación de amplitud por el encendido de los cilindros
        const lfo = ctx.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 12.5;
        const depth = ctx.createGain();
        depth.gain.value = 0.42;
        lfo.connect(depth);
        depth.connect(am.gain);
        [o1, o2, n, lfo].forEach((s) => s.start());
        this.eng = { o1, o2, lfo };
      }

      setEngine(level, pitch, tc) {
        if (!this.ok) return;
        const c = this.engineCache;
        if (Math.abs(c.level - level) < 0.01 && Math.abs(c.pitch - pitch) < 0.01) return;
        c.level = level;
        c.pitch = pitch;
        const t = this.ctx.currentTime;
        const k = tc || 0.12;
        const p = Math.max(0.2, pitch);
        this.engineGain.gain.setTargetAtTime(level * 0.26, t, k);
        this.eng.o1.frequency.setTargetAtTime(62 * p, t, k);
        this.eng.o2.frequency.setTargetAtTime(31 * p, t, k);
        this.eng.lfo.frequency.setTargetAtTime(12.5 * p, t, k);
      }

      /* ---------- Viento: el "barrido de escoba" ---------- */
      buildWind() {
        const ctx = this.ctx;
        const out = this.windGain = ctx.createGain();
        out.gain.value = 0;
        out.connect(this.sfxBus);
        const n = ctx.createBufferSource();
        n.buffer = this.noise;
        n.loop = true;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 800;
        bp.Q.value = 1.5;
        const swish = ctx.createGain();
        swish.gain.value = 0.55;
        n.connect(bp);
        bp.connect(swish);
        swish.connect(out);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.72;
        const lfoF = ctx.createGain();
        lfoF.gain.value = 520;
        lfo.connect(lfoF);
        lfoF.connect(bp.frequency);
        const lfoA = ctx.createGain();
        lfoA.gain.value = 0.45;
        lfo.connect(lfoA);
        lfoA.connect(swish.gain);
        // Silbido de los tirantes y cables
        const wh = ctx.createOscillator();
        wh.type = 'sine';
        wh.frequency.value = 1180;
        const vib = ctx.createOscillator();
        vib.frequency.value = 4.3;
        const vibG = ctx.createGain();
        vibG.gain.value = 24;
        vib.connect(vibG);
        vibG.connect(wh.frequency);
        const whG = ctx.createGain();
        whG.gain.value = 0.03;
        wh.connect(whG);
        whG.connect(out);
        // Capa grave del aire
        const n2 = ctx.createBufferSource();
        n2.buffer = this.noise;
        n2.loop = true;
        n2.playbackRate.value = 0.7;
        const lp2 = ctx.createBiquadFilter();
        lp2.type = 'lowpass';
        lp2.frequency.value = 320;
        const g2 = ctx.createGain();
        g2.gain.value = 0.4;
        n2.connect(lp2);
        lp2.connect(g2);
        g2.connect(out);
        [n, lfo, wh, vib, n2].forEach((s) => s.start());
        this.windLevel = -1;
      }

      setWind(level, tc) {
        if (!this.ok || Math.abs(this.windLevel - level) < 0.01) return;
        this.windLevel = level;
        this.windGain.gain.setTargetAtTime(level * 0.55, this.ctx.currentTime, tc || 0.5);
      }

      /* ---------- Zumbido grave del dirigible ---------- */
      buildDrone() {
        const ctx = this.ctx;
        const out = this.droneGain = ctx.createGain();
        out.gain.value = 0;
        out.connect(this.sfxBus);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 220;
        lp.connect(out);
        [41, 42.7, 61.5].forEach((f) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          const g = ctx.createGain();
          g.gain.value = 0.18;
          o.connect(g);
          g.connect(lp);
          o.start();
        });
        this.droneLevel = -1;
      }

      setDrone(level) {
        if (!this.ok || Math.abs(this.droneLevel - level) < 0.01) return;
        this.droneLevel = level;
        this.droneGain.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.6);
      }

      /* ---------- Bloques de síntesis ---------- */
      out(dest, pan) {
        const target = dest || this.sfxBus;
        if (pan && this.ctx.createStereoPanner) {
          const p = this.ctx.createStereoPanner();
          p.pan.value = clamp(pan, -1, 1);
          p.connect(target);
          return p;
        }
        return target;
      }

      noiseBurst(o) {
        if (!this.ok) return;
        const ctx = this.ctx;
        const t = ctx.currentTime + (o.delay || 0);
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.playbackRate.value = o.rate || 1;
        const f = ctx.createBiquadFilter();
        f.type = o.type || 'lowpass';
        f.frequency.setValueAtTime(o.freq || 1000, t);
        if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
        f.Q.value = o.q || 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack || 0.004));
        g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
        src.connect(f);
        f.connect(g);
        g.connect(this.out(o.dest, o.pan));
        src.start(t, Math.random() * 2);
        src.stop(t + o.dur + 0.05);
      }

      tone(o) {
        if (!this.ok) return;
        const ctx = this.ctx;
        const t = (o.at !== undefined ? o.at : ctx.currentTime) + (o.delay || 0);
        const osc = ctx.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(o.f0, t);
        if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), t + (o.attack || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
        osc.connect(g);
        g.connect(this.out(o.dest, o.pan));
        osc.start(t);
        osc.stop(t + o.dur + 0.05);
      }

      /* Instrumentos del secuenciador */
      lead(midi, t, dur, dest, gain) {
        const ctx = this.ctx;
        const f = mtof(midi);
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vg = ctx.createGain();
        vg.gain.value = f * 0.007;
        vib.connect(vg);
        vg.connect(o.frequency);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
        g.gain.setTargetAtTime(gain * 0.6, t + 0.05, 0.2);
        g.gain.setTargetAtTime(0.0001, t + dur, 0.05);
        o.connect(lp);
        lp.connect(g);
        g.connect(dest);
        o.start(t);
        vib.start(t);
        o.stop(t + dur + 0.4);
        vib.stop(t + dur + 0.4);
      }

      bass(midi, t, dur, dest, gain) {
        const ctx = this.ctx;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(midi);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
        g.gain.setTargetAtTime(gain * 0.7, t + 0.03, 0.15);
        g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
        o.connect(g);
        g.connect(dest);
        o.start(t);
        o.stop(t + dur + 0.5);
      }

      pad(chord, t, dur, dest, gain) {
        const ctx = this.ctx;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1000;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.5);
        g.gain.setTargetAtTime(0.0001, t + dur - 0.2, 0.25);
        lp.connect(g);
        g.connect(dest);
        chord.forEach((m) => {
          [-7, 7].forEach((det) => {
            const o = ctx.createOscillator();
            o.type = 'sawtooth';
            o.frequency.value = mtof(m);
            o.detune.value = det;
            o.connect(lp);
            o.start(t);
            o.stop(t + dur + 1.2);
          });
        });
      }

      stab(chord, t, dur, dest) {
        const ctx = this.ctx;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(2400, t);
        lp.frequency.exponentialRampToValueAtTime(500, t + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.03, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        lp.connect(g);
        g.connect(dest);
        chord.forEach((m) => {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(m);
          o.connect(lp);
          o.start(t);
          o.stop(t + dur + 0.1);
        });
      }

      kick(t, gain, dest) {
        this.tone({ at: t, type: 'sine', f0: 140, f1: 42, dur: 0.22, gain, dest });
      }

      snare(t, gain, dest) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1900;
        f.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        src.connect(f);
        f.connect(g);
        g.connect(dest);
        src.start(t, Math.random() * 2);
        src.stop(t + 0.16);
        this.tone({ at: t, type: 'triangle', f0: 200, f1: 150, dur: 0.06, gain: gain * 0.6, dest });
      }

      hat(t, gain, dest) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'highpass';
        f.frequency.value = 7500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        src.connect(f);
        f.connect(g);
        g.connect(dest);
        src.start(t, Math.random() * 2);
        src.stop(t + 0.05);
      }

      timpani(t, gain, dest) {
        this.tone({ at: t, type: 'sine', f0: 74, f1: 58, dur: 1.5, gain, dest, attack: 0.008 });
        const ctx = this.ctx;
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 380;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain * 0.6, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
        src.connect(f);
        f.connect(g);
        g.connect(dest);
        src.start(t, Math.random() * 2);
        src.stop(t + 0.4);
      }

      bell(freq, t, gain, dest) {
        this.tone({ at: t, type: 'sine', f0: freq, dur: 2.4, gain, dest, attack: 0.004 });
        this.tone({ at: t, type: 'sine', f0: freq * 2.76, dur: 1.1, gain: gain * 0.35, dest, attack: 0.004 });
      }

      /* ---------- Secuenciador ---------- */
      startTheme(name) {
        if (!this.ok) return;
        if (this.themeName === name && this.seqTimer) return;
        this.stopTheme(0.35);
        const theme = THEMES[name];
        if (!theme) return;
        const ctx = this.ctx;
        const out = ctx.createGain();
        out.gain.setValueAtTime(0.0001, ctx.currentTime);
        out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 0.8);
        out.connect(name === 'battle' ? this.levelFilter : this.musicBus);
        this.themeOut = out;
        this.themeName = name;
        this.theme = theme;
        this.step = 0;
        this.nextTime = ctx.currentTime + 0.1;
        this.seqTimer = window.setInterval(() => this.schedule(), 25);
      }

      schedule() {
        const th = this.theme;
        if (!th || !this.themeOut) return;
        const ctx = this.ctx;
        const d = 60 / th.bpm / 4;
        if (this.nextTime < ctx.currentTime - 0.25) this.nextTime = ctx.currentTime + 0.05;
        while (this.nextTime < ctx.currentTime + 0.15) {
          th.play(this.step % th.steps, this.nextTime, this, d, this.themeOut);
          this.nextTime += d;
          this.step++;
        }
      }

      stopTheme(fade) {
        if (this.seqTimer) {
          window.clearInterval(this.seqTimer);
          this.seqTimer = null;
        }
        if (this.themeOut && this.ok) {
          const g = this.themeOut;
          const t = this.ctx.currentTime;
          const f = fade === undefined ? 0.4 : fade;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, f));
          window.setTimeout(() => {
            try { g.disconnect(); } catch (e) { /* ya desconectado */ }
          }, (f + 0.5) * 1000);
        }
        this.themeOut = null;
        this.themeName = null;
        this.theme = null;
      }

      /* ---------- Efectos de sonido ---------- */
      gun() {
        this.noiseBurst({ type: 'bandpass', freq: 2100, freqEnd: 700, q: 0.9, dur: 0.07, gain: 0.32 });
        this.tone({ type: 'square', f0: 190, f1: 55, dur: 0.06, gain: 0.12 });
      }

      enemyGun(dist, pan) {
        const v = 0.16 / (1 + dist / 40);
        if (v < 0.01) return;
        this.noiseBurst({ type: 'bandpass', freq: 1300, freqEnd: 500, q: 1, dur: 0.08, gain: v, pan });
      }

      explosion(size, dist, pan) {
        const v = clamp(size, 0.4, 3) / (1 + (dist || 0) / 70);
        if (v < 0.02) return;
        this.noiseBurst({ type: 'lowpass', freq: 2400, freqEnd: 110, dur: 0.5 + size * 0.45, gain: 0.7 * v, pan });
        this.tone({ type: 'sine', f0: 120, f1: 28, dur: 0.5 + size * 0.2, gain: 0.65 * v, pan });
        this.noiseBurst({ type: 'highpass', freq: 3000, dur: 0.08, gain: 0.2 * v, pan });
      }

      flak(dist, pan) {
        const v = 1 / (1 + dist / 50);
        if (v < 0.03) return;
        this.noiseBurst({ type: 'bandpass', freq: 2800, q: 0.8, dur: 0.06, gain: 0.35 * v, pan });
        this.noiseBurst({ type: 'lowpass', freq: 900, freqEnd: 90, dur: 0.7, gain: 0.45 * v, pan, delay: 0.01 });
      }

      hurt() {
        this.noiseBurst({ type: 'bandpass', freq: 600, freqEnd: 250, q: 1.4, dur: 0.28, gain: 0.5 });
        this.noiseBurst({ type: 'highpass', freq: 2500, dur: 0.05, gain: 0.35 });
        this.tone({ type: 'sawtooth', f0: 210, f1: 70, dur: 0.25, gain: 0.14 });
      }

      hitTink(pan) {
        const now = this.ok ? this.ctx.currentTime : 0;
        if (now - this.lastHitTink < 0.05) return;
        this.lastHitTink = now;
        this.tone({ type: 'square', f0: 1400, f1: 900, dur: 0.04, gain: 0.05, pan });
      }

      armor(pan) {
        const now = this.ok ? this.ctx.currentTime : 0;
        if (now - this.lastHitTink < 0.06) return;
        this.lastHitTink = now;
        this.tone({ type: 'triangle', f0: 2600, f1: 1800, dur: 0.05, gain: 0.05, pan });
      }

      deflect() {
        this.tone({ type: 'triangle', f0: 1700, f1: 2900, dur: 0.09, gain: 0.12 });
        this.tone({ type: 'sine', f0: 3400, dur: 0.18, gain: 0.04, delay: 0.03 });
      }

      roll() {
        this.noiseBurst({ type: 'bandpass', freq: 500, freqEnd: 1800, q: 1.2, dur: 0.45, gain: 0.22 });
      }

      pickup() {
        [660, 880, 1320].forEach((f, i) => this.tone({ type: 'square', f0: f, dur: 0.1, gain: 0.06, delay: i * 0.07 }));
      }

      rocket() {
        this.noiseBurst({ type: 'bandpass', freq: 700, freqEnd: 3200, q: 1.2, dur: 0.6, gain: 0.3 });
        this.tone({ type: 'sawtooth', f0: 260, f1: 900, dur: 0.4, gain: 0.06 });
      }

      bombWhistle(dur) {
        this.tone({ type: 'sine', f0: 1500, f1: 380, dur, gain: 0.08, attack: 0.1 });
      }

      empty() {
        this.tone({ type: 'square', f0: 140, dur: 0.08, gain: 0.08 });
      }

      alarm() {
        for (let i = 0; i < 8; i++) {
          this.tone({ type: 'square', f0: i % 2 ? 660 : 880, dur: 0.22, gain: 0.08, delay: i * 0.26 });
        }
        this.tone({ type: 'sawtooth', f0: 300, f1: 900, dur: 2, gain: 0.05 });
      }

      detected() {
        this.tone({ type: 'square', f0: 1046, dur: 0.09, gain: 0.07 });
        this.tone({ type: 'square', f0: 1046, dur: 0.09, gain: 0.07, delay: 0.14 });
      }

      engineCut() {
        this.noiseBurst({ type: 'lowpass', freq: 400, freqEnd: 80, dur: 0.6, gain: 0.25 });
        this.tone({ type: 'sawtooth', f0: 70, f1: 22, dur: 0.9, gain: 0.09 });
      }

      engineStart() {
        for (let i = 0; i < 4; i++) this.noiseBurst({ type: 'lowpass', freq: 500, dur: 0.09, gain: 0.3, delay: i * 0.11 });
      }

      ui() {
        this.tone({ type: 'square', f0: 990, dur: 0.045, gain: 0.04 });
      }

      confirm() {
        this.tone({ type: 'square', f0: 660, dur: 0.07, gain: 0.06 });
        this.tone({ type: 'square', f0: 990, dur: 0.12, gain: 0.06, delay: 0.07 });
      }

      typeTick() {
        if (!this.ok) return;
        const now = this.ctx.currentTime;
        if (now - this.lastTick < 0.02) return;
        this.lastTick = now;
        this.noiseBurst({ type: 'highpass', freq: 2600 + Math.random() * 900, dur: 0.02, gain: 0.09 });
        this.tone({ type: 'square', f0: 130 + Math.random() * 30, dur: 0.018, gain: 0.03 });
      }

      typeBell() {
        this.tone({ type: 'sine', f0: 2100, dur: 0.7, gain: 0.05 });
      }

      radio(open) {
        this.noiseBurst({ type: 'bandpass', freq: open ? 1700 : 1200, q: 2, dur: 0.16, gain: 0.2 });
        this.tone({ type: 'square', f0: open ? 1800 : 1200, dur: 0.05, gain: 0.03, dest: this.radioBus });
      }

      voice(pitch) {
        this.tone({ type: 'square', f0: pitch * rand(0.85, 1.3), f1: pitch * rand(0.8, 1.1), dur: rand(0.04, 0.07), gain: 0.05, dest: this.radioBus });
      }

      mineBeep(dist) {
        const v = 0.05 / (1 + dist / 25);
        if (v > 0.006) this.tone({ type: 'square', f0: 1900, dur: 0.04, gain: v });
      }
    }

    const sound = new AudioEngine();

    /* ====================================================================
       06. IMÁGENES Y TEXTURAS PROCEDURALES
       Si existen los archivos de img/ se usan; mientras tanto (o si faltan)
       todo se dibuja en Canvas para que el juego funcione desde el inicio.
       ==================================================================== */
    const IMG_PATHS = {
      crosshair: 'img/crosshair.png',
      raskova: 'img/marina_raskova.png',
      bersh: 'img/yevdokiya.png',
      german: 'img/radio_aleman.png'
    };
    const userImages = {};
    let imagesVersion = 0;
    Object.keys(IMG_PATHS).forEach((key) => {
      const im = new Image();
      im.onload = () => {
        userImages[key] = im;
        imagesVersion++;
      };
      im.onerror = () => { /* sin imagen: se mantiene el dibujo procedural */ };
      im.src = IMG_PATHS[key];
    });

    function makeCanvas(w, h) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }

    function pixelTex(canvas, rx, ry) {
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx || 1, ry || 1);
      return t;
    }

    function grayPixel(g, x, y, v) {
      const c = clamp(Math.round(v), 0, 255);
      g.fillStyle = 'rgb(' + c + ',' + c + ',' + c + ')';
      g.fillRect(x, y, 1, 1);
    }

    function drawStar(g, cx, cy, outer, inner, color) {
      g.fillStyle = color;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = -Math.PI / 2 + i * Math.PI / 5;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
      g.fill();
    }

    const TEX = (function () {
      const r = seeded(1941);
      const T = {};
      let c, g;

      // Lona del Po-2: costillas y costuras
      c = makeCanvas(32, 32); g = c.getContext('2d');
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          grayPixel(g, x, y, 205 + r() * 40 - (x % 8 === 0 ? 55 : 0) - (y % 16 === 0 ? 25 : 0));
        }
      }
      T.fabric = pixelTex(c);

      // Planchas metálicas remachadas
      c = makeCanvas(32, 32); g = c.getContext('2d');
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          let v = 160 + r() * 35;
          if (x % 16 === 0 || y % 8 === 0) v = 95;
          if ((x % 16 === 2 || x % 16 === 14) && y % 4 === 2) v = 225;
          grayPixel(g, x, y, v);
        }
      }
      T.metal = pixelTex(c);

      // Madera de tablones
      c = makeCanvas(16, 16); g = c.getContext('2d');
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          let v = 175 + r() * 40 + Math.sin(y * 1.7 + x) * 10;
          if (x % 4 === 0) v = 105;
          grayPixel(g, x, y, v);
        }
      }
      T.wood = pixelTex(c);

      // Tierra y hierba quemada
      c = makeCanvas(32, 32); g = c.getContext('2d');
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const blot = valueNoise(x * 0.25, y * 0.25);
          grayPixel(g, x, y, 140 + blot * 80 + r() * 45 - (r() < 0.06 ? 60 : 0));
        }
      }
      T.ground = pixelTex(c, 18, 7);

      // Caja de suministros
      c = makeCanvas(16, 16); g = c.getContext('2d');
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          let v = 190 + r() * 30;
          if (y % 5 === 0) v = 120;
          if (x < 2 || x > 13 || y < 2 || y > 13) v = 110;
          if (Math.abs(x - y) < 1.2) v = 120;
          grayPixel(g, x, y, v);
        }
      }
      T.crate = pixelTex(c);

      // Estrella roja soviética
      c = makeCanvas(16, 16); g = c.getContext('2d');
      drawStar(g, 8, 8.6, 7.8, 3.2, '#f2f2f2');
      drawStar(g, 8, 8.6, 6.2, 2.5, '#c8102e');
      T.star = pixelTex(c);

      // Cruz de la Luftwaffe (Balkenkreuz)
      c = makeCanvas(16, 16); g = c.getContext('2d');
      g.fillStyle = '#eeeeee';
      g.fillRect(5, 1, 6, 14);
      g.fillRect(1, 5, 14, 6);
      g.fillStyle = '#111111';
      g.fillRect(6, 2, 4, 12);
      g.fillRect(2, 6, 12, 4);
      T.cross = pixelTex(c);

      // Cruz blanca de reparación
      c = makeCanvas(16, 16); g = c.getContext('2d');
      g.fillStyle = '#f4f1e4';
      g.fillRect(6, 2, 4, 12);
      g.fillRect(2, 6, 12, 4);
      T.repair = pixelTex(c);

      return T;
    })();

    /* --- Retratos pixelados para las transmisiones --- */
    const PORTRAIT = {
      bersh: { bg: '#0b2214', skin: '#e2b48e', shade: '#b98563', hair: '#a4733f', tunic: '#5f6436', tab: '#c8261b', lips: '#9a3b34', eyes: '#1d140f' },
      raskova: { bg: '#0b2214', skin: '#e8bf9a', shade: '#bf8f6b', hair: '#22140d', tunic: '#55603a', tab: '#c8261b', lips: '#a3423a', eyes: '#1a110c' },
      german: { bg: '#240c0b', skin: '#a99a8c', shade: '#7b6e63', hair: '#3a3a36', tunic: '#4f5551', tab: '#9aa0a0', lips: '#6b4a44', eyes: '#141414' }
    };

    function drawPortrait(canvas, who, mouthOpen, blink) {
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, canvas.width, canvas.height);
      const img = userImages[who];
      if (img) {
        // Imagen del usuario (recorte cuadrado centrado)
        const s = Math.min(img.width, img.height);
        g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, canvas.width, canvas.height);
        return;
      }
      const S = PORTRAIT[who] || PORTRAIT.bersh;
      const k = canvas.width / 32;
      const px = (x, y, w, h, col) => {
        g.fillStyle = col;
        g.fillRect(x * k, y * k, w * k, h * k);
      };
      px(0, 0, 32, 32, S.bg);
      for (let y = 1; y < 32; y += 3) px(0, y, 32, 1, 'rgba(255,255,255,0.04)');
      // Hombros y cuello
      px(4, 25, 24, 7, S.tunic);
      px(2, 28, 28, 4, S.tunic);
      px(13, 21, 6, 5, S.shade);
      px(10, 25, 3, 2, S.tab);
      px(19, 25, 3, 2, S.tab);
      px(15, 26, 2, 6, 'rgba(0,0,0,0.25)');
      // Cara
      px(10, 9, 12, 12, S.skin);
      px(11, 21, 10, 1, S.skin);
      px(12, 22, 8, 1, S.shade);
      px(9, 11, 1, 7, S.skin);
      px(22, 11, 1, 7, S.skin);
      px(20, 10, 2, 11, S.shade);
      // Ojos
      if (blink) {
        px(12, 15, 3, 1, S.shade);
        px(17, 15, 3, 1, S.shade);
      } else {
        px(12, 15, 2, 1, S.eyes);
        px(18, 15, 2, 1, S.eyes);
        px(14, 15, 1, 1, '#f3e9dc');
        px(17, 15, 1, 1, '#f3e9dc');
      }
      px(12, 13, 3, 1, S.hair);
      px(17, 13, 3, 1, S.hair);
      // Nariz y boca
      px(15, 16, 2, 2, S.shade);
      if (mouthOpen) {
        px(14, 19, 4, 2, '#3a0f0c');
        px(14, 19, 4, 1, S.lips);
      } else {
        px(14, 19, 4, 1, S.lips);
      }
      if (who === 'bersh') {
        // Casco de cuero con gafas de vuelo
        px(9, 4, 14, 6, '#4a2f1c');
        px(10, 3, 12, 1, '#4a2f1c');
        px(11, 4, 7, 1, '#6b4529');
        px(8, 8, 2, 12, '#4a2f1c');
        px(22, 8, 2, 12, '#4a2f1c');
        px(9, 20, 2, 2, '#3b2414');
        px(21, 20, 2, 2, '#3b2414');
        px(10, 7, 5, 3, '#707070');
        px(17, 7, 5, 3, '#707070');
        px(11, 8, 3, 1, '#9fdcff');
        px(18, 8, 3, 1, '#9fdcff');
        px(15, 8, 2, 1, '#3a3a3a');
        px(11, 10, 4, 1, S.hair);
        px(18, 10, 3, 1, S.hair);
      } else if (who === 'raskova') {
        // Pelo oscuro con raya al medio y uniforme de oficial
        px(9, 4, 14, 6, S.hair);
        px(8, 7, 2, 12, S.hair);
        px(22, 7, 2, 12, S.hair);
        px(10, 9, 5, 2, S.hair);
        px(17, 9, 5, 2, S.hair);
        px(15, 4, 2, 4, S.skin);
        px(10, 3, 12, 1, S.hair);
        px(23, 16, 2, 5, S.hair);
        px(19, 28, 2, 2, '#e8c34a');
        px(8, 28, 4, 1, '#c8261b');
      } else {
        // Intercepción alemana: gorra y cascos de radio
        px(9, 5, 14, 5, '#4b5052');
        px(10, 4, 10, 1, '#4b5052');
        px(11, 6, 4, 1, '#6b7072');
        px(8, 6, 1, 9, '#1e1e1e');
        px(7, 13, 3, 5, '#2a2a2a');
        px(22, 13, 3, 5, '#2a2a2a');
        px(8, 18, 1, 3, '#1e1e1e');
        px(9, 20, 4, 1, '#1e1e1e');
        px(10, 10, 12, 5, 'rgba(0,0,0,0.3)');
      }
    }

    /* --- Retícula estilo Star Fox --- */
    function drawReticle(canvas, locked, near) {
      const g = canvas.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, 32, 32);
      const img = userImages.crosshair;
      if (img) {
        g.drawImage(img, 0, 0, 32, 32);
        if (locked) {
          g.globalCompositeOperation = 'source-atop';
          g.fillStyle = 'rgba(255, 40, 30, 0.65)';
          g.fillRect(0, 0, 32, 32);
          g.globalCompositeOperation = 'source-over';
        }
        return;
      }
      const col = locked ? '#ff3a2a' : (near ? '#7dff9a' : '#c6ff6a');
      const dark = '#071405';
      const segs = near
        ? [[3, 3, 7, 2], [3, 3, 2, 7], [22, 3, 7, 2], [27, 3, 2, 7], [3, 27, 7, 2], [3, 22, 2, 7], [22, 27, 7, 2], [27, 22, 2, 7]]
        : [[5, 5, 6, 2], [5, 5, 2, 6], [21, 5, 6, 2], [25, 5, 2, 6], [5, 25, 6, 2], [5, 21, 2, 6], [21, 25, 6, 2], [25, 21, 2, 6], [15, 9, 2, 4], [15, 19, 2, 4], [9, 15, 4, 2], [19, 15, 4, 2]];
      g.fillStyle = dark;
      segs.forEach((s) => g.fillRect(s[0] - 1, s[1] - 1, s[2] + 2, s[3] + 2));
      g.fillStyle = col;
      segs.forEach((s) => g.fillRect(s[0], s[1], s[2], s[3]));
      if (!near) {
        g.fillStyle = dark;
        g.fillRect(14, 14, 4, 4);
        g.fillStyle = col;
        g.fillRect(15, 15, 2, 2);
      }
    }

    /* ====================================================================
       07. MATERIALES RETRO Y FUSIÓN DE GEOMETRÍAS
       Sombreado plano + "vertex snapping" (temblor de vértices estilo PS1).
       ==================================================================== */
    const SNAP = { value: new THREE.Vector2(240, 135) };

    function snapShader(shader) {
      shader.uniforms.uSnap = SNAP;
      shader.vertexShader = 'uniform vec2 uSnap;\n' + shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n\tgl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;'
      );
    }

    function retroMat(params) {
      const m = new THREE.MeshPhongMaterial(Object.assign({ flatShading: true, shininess: 6, specular: 0x0b0b0b }, params || {}));
      m.onBeforeCompile = snapShader;
      return m;
    }

    function glowMat(color, opacity) {
      return new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: opacity === undefined ? 1 : opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
    }

    const MAT = {
      po2Body: retroMat({ color: 0x6f8248, map: TEX.fabric, emissive: 0x0e1209 }),
      po2Wing: retroMat({ color: 0x7c8f50, map: TEX.fabric, emissive: 0x0e1209 }),
      ally: retroMat({ color: 0x5f8466, map: TEX.fabric, emissive: 0x0b120c }),
      dark: retroMat({ color: 0x17150f }),
      metal: retroMat({ color: 0x6c7074, shininess: 30, specular: 0x333333 }),
      wood: retroMat({ color: 0x7a5530, map: TEX.wood }),
      leather: retroMat({ color: 0x4b2e1b }),
      tire: retroMat({ color: 0x101010 }),
      glass: new THREE.MeshBasicMaterial({ color: 0x9fc3d6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
      star: retroMat({ map: TEX.star, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      cross: retroMat({ map: TEX.cross, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      exhaust: glowMat(0xff8a2a, 0.9),
      propDisc: new THREE.MeshBasicMaterial({ color: 0xc8c0a8, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
      enemy: retroMat({ color: 0x56606b, map: TEX.metal, emissive: 0x0b0d10 }),
      enemyLight: retroMat({ color: 0x75828e, map: TEX.metal, emissive: 0x0b0d10 }),
      yellow: retroMat({ color: 0xd8b02a, emissive: 0x1a1200 }),
      canopy: retroMat({ color: 0x6e8a9a, shininess: 80, specular: 0x88aacc }),
      navRed: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
      navGreen: new THREE.MeshBasicMaterial({ color: 0x2aff6a }),
      navWhite: new THREE.MeshBasicMaterial({ color: 0xfff6dd }),
      sandbag: retroMat({ color: 0x6d6346 }),
      concrete: retroMat({ color: 0x58564e }),
      rust: retroMat({ color: 0x74503a, map: TEX.metal }),
      tankStripe: retroMat({ color: 0xc9b23a }),
      lens: new THREE.MeshBasicMaterial({ color: 0xeef4ff }),
      zepHull: retroMat({ color: 0x77808b, map: TEX.metal, emissive: 0x0c0d10 }),
      zepPlate: retroMat({ color: 0x525963, map: TEX.metal, shininess: 35, specular: 0x2a2a2a, emissive: 0x08090b }),
      zepEngine: retroMat({ color: 0x67707a, map: TEX.metal, emissive: 0x0c0d10 }),
      zepRed: retroMat({ color: 0x7d1a14 }),
      burnt: retroMat({ color: 0x1c1714 }),
      window: new THREE.MeshBasicMaterial({ color: 0xffcf6a }),
      bayGlow: new THREE.MeshBasicMaterial({ color: 0xff3a1a }),
      tree: retroMat({ color: 0x1a2a19 }),
      treeBurnt: retroMat({ color: 0x18120e }),
      ruin: retroMat({ color: 0x4a4540 }),
      cloud: retroMat({ color: 0x2f3a52, emissive: 0x070a12, shininess: 0, specular: 0x000000 }),
      crate: retroMat({ map: TEX.crate, color: 0xb59a64 }),
      repair: retroMat({ map: TEX.repair, alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      chute: retroMat({ color: 0xd8d0b0, side: THREE.DoubleSide }),
      mine: retroMat({ color: 0x2c2f31, shininess: 40, specular: 0x444444 }),
      terrain: retroMat({ vertexColors: true, map: TEX.ground, shininess: 0, specular: 0x000000 }),
      fire: glowMat(0xff7a1e, 0.9),
      fireCore: glowMat(0xffd27a, 0.9)
    };

    /* Fusiona todas las mallas estáticas de un grupo (por material) para
       reducir las llamadas de dibujo. Los hijos con nombre (hélices, luces)
       se conservan para poder animarlos. */
    function mergeGeometries(geos) {
      let count = 0;
      geos.forEach((g) => { count += g.attributes.position.count; });
      const pos = new Float32Array(count * 3);
      const nor = new Float32Array(count * 3);
      const uv = new Float32Array(count * 2);
      let o3 = 0;
      let o2 = 0;
      geos.forEach((g) => {
        const n = g.attributes.position.count;
        pos.set(g.attributes.position.array, o3);
        if (g.attributes.normal) nor.set(g.attributes.normal.array, o3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
        o3 += n * 3;
        o2 += n * 2;
        g.dispose();
      });
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.computeBoundingSphere();
      return out;
    }

    function bakeGroup(root) {
      root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      const buckets = new Map();
      const removeList = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        let p = o;
        while (p && p !== root) {
          if (p.name) return;
          p = p.parent;
        }
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
        if (!buckets.has(o.material)) buckets.set(o.material, []);
        buckets.get(o.material).push(g);
        removeList.push(o);
      });
      removeList.forEach((o) => o.parent.remove(o));
      buckets.forEach((geos, mat) => root.add(new THREE.Mesh(mergeGeometries(geos), mat)));
      return root;
    }

    /* ====================================================================
       08. MODELOS LOW POLY (todos con el morro hacia -Z)
       ==================================================================== */
    const GEO = {
      box: (w, h, d) => new THREE.BoxGeometry(w, h, d),
      cyl: (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s || 8),
      cone: (r, h, s) => new THREE.ConeGeometry(r, h, s || 6),
      plane: (w, h) => new THREE.PlaneGeometry(w, h)
    };

    function part(geo, mat, x, y, z, rx, ry, rz, parent) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx || 0, ry || 0, rz || 0);
      parent.add(m);
      return m;
    }

    /* Viga entre dos puntos (tirantes, soportes) */
    function beam(a, b, t, mat, parent) {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(GEO.box(t, t, len), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(Z_AXIS, tmpV.copy(b).sub(a).normalize());
      parent.add(m);
      return m;
    }

    /* --- Polikarpov Po-2 --- */
    function buildPo2(bodyMat) {
      const root = new THREE.Group();
      const body = bodyMat || MAT.po2Body;
      const wing = bodyMat || MAT.po2Wing;
      const HALF = Math.PI / 2;
      // Fuselaje ahusado de madera y lona
      part(GEO.cyl(0.16, 0.36, 2.7, 6), body, 0, 0, 0.35, HALF, 0, 0, root);
      // Capó del motor radial M-11 y cilindros
      part(GEO.cyl(0.36, 0.4, 0.42, 8), MAT.metal, 0, 0, -1.18, HALF, 0, 0, root);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + 0.3;
        part(GEO.box(0.14, 0.22, 0.2), MAT.metal, Math.cos(a) * 0.43, Math.sin(a) * 0.43, -1.2, 0, 0, a - HALF, root);
      }
      // Alas superpuestas
      part(GEO.box(4.6, 0.07, 0.78), wing, 0, 0.82, -0.42, 0, 0, 0, root);
      part(GEO.box(4.1, 0.07, 0.72), wing, 0, -0.26, -0.3, 0, 0, 0, root);
      [-1, 1].forEach((sx) => {
        // Montantes interplanos
        part(GEO.box(0.05, 1.08, 0.05), MAT.wood, sx * 1.55, 0.28, -0.62, 0, 0, 0, root);
        part(GEO.box(0.05, 1.08, 0.05), MAT.wood, sx * 1.55, 0.28, -0.12, 0, 0, 0, root);
        // Montantes de cabaña
        part(GEO.box(0.04, 0.66, 0.04), MAT.dark, sx * 0.24, 0.5, -0.56, 0, 0, sx * 0.25, root);
        // Cables de arriostramiento
        beam(new V3(sx * 0.3, 0.8, -0.38), new V3(sx * 1.55, -0.24, -0.38), 0.018, MAT.dark, root);
        beam(new V3(sx * 0.3, -0.24, -0.38), new V3(sx * 1.55, 0.8, -0.38), 0.018, MAT.dark, root);
        // Tren de aterrizaje
        beam(new V3(sx * 0.12, -0.3, -0.75), new V3(sx * 0.45, -0.8, -0.62), 0.05, MAT.dark, root);
        beam(new V3(sx * 0.12, -0.3, -0.35), new V3(sx * 0.45, -0.8, -0.62), 0.05, MAT.dark, root);
        part(GEO.cyl(0.22, 0.22, 0.09, 8), MAT.tire, sx * 0.47, -0.84, -0.62, 0, 0, HALF, root);
        // Bombas bajo el ala inferior
        part(GEO.cyl(0.075, 0.075, 0.55, 6), MAT.metal, sx * 0.9, -0.4, -0.3, HALF, 0, 0, root);
        part(GEO.cyl(0.075, 0.075, 0.55, 6), MAT.metal, sx * 1.22, -0.4, -0.3, HALF, 0, 0, root);
        // Estrellas rojas en el ala superior
        part(GEO.plane(0.62, 0.62), MAT.star, sx * 1.72, 0.862, -0.42, -HALF, 0, 0, root);
      });
      // Cabinas abiertas con piloto y navegante
      part(GEO.box(0.34, 0.06, 0.36), MAT.dark, 0, 0.27, 0.05, 0, 0, 0, root);
      part(GEO.box(0.3, 0.06, 0.34), MAT.dark, 0, 0.23, 0.62, 0, 0, 0, root);
      part(new THREE.DodecahedronGeometry(0.13, 0), MAT.leather, 0, 0.39, 0.08, 0, 0, 0, root);
      part(new THREE.DodecahedronGeometry(0.12, 0), MAT.leather, 0, 0.34, 0.66, 0, 0, 0, root);
      part(GEO.plane(0.3, 0.16), MAT.glass, 0, 0.37, -0.13, -0.35, 0, 0, root);
      part(GEO.plane(0.26, 0.14), MAT.glass, 0, 0.33, 0.45, -0.35, 0, 0, root);
      // Cola
      part(GEO.box(0.05, 0.62, 0.55), body, 0, 0.36, 1.56, 0, 0, 0, root);
      part(GEO.box(1.55, 0.05, 0.48), wing, 0, 0.08, 1.56, 0, 0, 0, root);
      part(GEO.box(0.04, 0.28, 0.06), MAT.dark, 0, -0.2, 1.66, 0, 0, 0, root);
      part(GEO.plane(0.4, 0.4), MAT.star, 0.032, 0.4, 1.56, 0, HALF, 0, root);
      part(GEO.plane(0.4, 0.4), MAT.star, -0.032, 0.4, 1.56, 0, -HALF, 0, root);

      // Hélice (animada)
      const prop = new THREE.Group();
      prop.name = 'prop';
      prop.position.set(0, 0, -1.46);
      root.add(prop);
      part(GEO.cone(0.13, 0.3, 6), MAT.metal, 0, 0, -0.12, -HALF, 0, 0, prop);
      part(GEO.box(0.16, 2.2, 0.05), MAT.wood, 0, 0, 0, 0, 0, 0, prop);
      const disc = part(new THREE.CircleGeometry(1.1, 12), MAT.propDisc, 0, 0, 0.02, 0, 0, 0, prop);
      disc.name = 'disc';

      // Brillo de los escapes (se apaga en planeo)
      const exhaust = new THREE.Group();
      exhaust.name = 'exhaust';
      root.add(exhaust);
      part(GEO.box(0.08, 0.08, 0.32), MAT.exhaust, 0.38, -0.14, -0.9, 0, 0, 0, exhaust);
      part(GEO.box(0.08, 0.08, 0.32), MAT.exhaust, -0.38, -0.14, -0.9, 0, 0, 0, exhaust);

      return bakeGroup(root);
    }

    /* --- Caza nocturno de la Luftwaffe (bimotor) --- */
    function buildFighter() {
      const root = new THREE.Group();
      const HALF = Math.PI / 2;
      part(GEO.cyl(0.2, 0.34, 3.4, 6), MAT.enemy, 0, 0, 0.2, HALF, 0, 0, root);
      part(GEO.box(0.34, 0.24, 1.5), MAT.canopy, 0, 0.27, -0.35, 0, 0, 0, root);
      part(GEO.box(5.4, 0.08, 1.0), MAT.enemy, 0, -0.06, -0.15, 0, 0, 0, root);
      part(GEO.box(0.55, 0.1, 1.02), MAT.yellow, 2.5, -0.06, -0.15, 0, 0, 0, root);
      part(GEO.box(0.55, 0.1, 1.02), MAT.yellow, -2.5, -0.06, -0.15, 0, 0, 0, root);
      part(GEO.cyl(0.25, 0.25, 0.26, 6), MAT.yellow, 0, 0, 1.2, HALF, 0, 0, root);
      part(GEO.box(2.0, 0.06, 0.5), MAT.enemy, 0, 0.05, 1.78, 0, 0, 0, root);
      [-1, 1].forEach((sx) => {
        part(GEO.cyl(0.22, 0.26, 1.5, 6), MAT.enemyLight, sx * 1.15, -0.06, -0.55, HALF, 0, 0, root);
        part(GEO.cone(0.16, 0.32, 6), MAT.metal, sx * 1.15, -0.06, -1.42, -HALF, 0, 0, root);
        part(GEO.box(0.06, 0.62, 0.5), MAT.enemy, sx * 0.98, 0.28, 1.82, 0, 0, 0, root);
        part(GEO.plane(0.7, 0.7), MAT.cross, sx * 1.6, 0.0, -0.15, -HALF, 0, 0, root);
        // Antenas de radar Lichtenstein en el morro
        part(GEO.box(0.025, 0.025, 0.6), MAT.dark, sx * 0.17, 0.17, -1.75, 0, 0, 0, root);
        part(GEO.box(0.025, 0.025, 0.6), MAT.dark, sx * 0.17, -0.17, -1.75, 0, 0, 0, root);
        // Hélices (discos animados)
        const prop = new THREE.Group();
        prop.name = 'prop';
        prop.position.set(sx * 1.15, -0.06, -1.6);
        root.add(prop);
        part(GEO.box(0.12, 1.3, 0.04), MAT.dark, 0, 0, 0, 0, 0, 0, prop);
        part(new THREE.CircleGeometry(0.7, 10), MAT.propDisc, 0, 0, 0.01, 0, 0, 0, prop);
      });
      part(GEO.plane(0.4, 0.4), MAT.cross, 0.26, 0, 0.75, 0, HALF, 0, root);
      part(GEO.plane(0.4, 0.4), MAT.cross, -0.26, 0, 0.75, 0, -HALF, 0, root);
      // Escapes y luces de navegación (visibles en la noche)
      const lights = new THREE.Group();
      lights.name = 'lights';
      root.add(lights);
      part(GEO.box(0.1, 0.08, 0.4), MAT.exhaust, 1.15, 0.16, -0.25, 0, 0, 0, lights);
      part(GEO.box(0.1, 0.08, 0.4), MAT.exhaust, -1.15, 0.16, -0.25, 0, 0, 0, lights);
      part(GEO.box(0.12, 0.12, 0.12), MAT.navRed, -2.75, -0.05, -0.15, 0, 0, 0, lights);
      part(GEO.box(0.12, 0.12, 0.12), MAT.navGreen, 2.75, -0.05, -0.15, 0, 0, 0, lights);
      return bakeGroup(root);
    }

    function sandbagRing(root, radius, count, y) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU;
        part(GEO.box(1.3, 0.55, 0.7), MAT.sandbag, Math.cos(a) * radius, y + 0.27, Math.sin(a) * radius, 0, -a + Math.PI / 2, 0, root);
        if (i % 2 === 0) part(GEO.box(1.1, 0.5, 0.65), MAT.sandbag, Math.cos(a + 0.2) * radius, y + 0.75, Math.sin(a + 0.2) * radius, 0, -a + Math.PI / 2, 0, root);
      }
    }

    /* --- Reflector antiaéreo --- */
    function buildSearchlight() {
      const root = new THREE.Group();
      part(GEO.cyl(1.5, 1.7, 0.6, 8), MAT.concrete, 0, 0.3, 0, 0, 0, 0, root);
      part(GEO.box(0.25, 1.6, 0.4), MAT.metal, 0.85, 1.2, 0, 0, 0, 0, root);
      part(GEO.box(0.25, 1.6, 0.4), MAT.metal, -0.85, 1.2, 0, 0, 0, 0, root);
      sandbagRing(root, 2.6, 10, 0);
      const lamp = new THREE.Group();
      lamp.name = 'lamp';
      lamp.position.set(0, 1.9, 0);
      root.add(lamp);
      part(GEO.cyl(0.72, 0.6, 1.2, 10), MAT.metal, 0, 0, 0, 0, 0, 0, lamp);
      part(new THREE.CircleGeometry(0.64, 10), MAT.lens, 0, 0.61, 0, -Math.PI / 2, 0, 0, lamp);
      return bakeGroup(root);
    }

    /* --- Cañón antiaéreo Flak --- */
    function buildFlak() {
      const root = new THREE.Group();
      part(GEO.box(5, 0.3, 0.5), MAT.metal, 0, 0.15, 0, 0, 0, 0, root);
      part(GEO.box(0.5, 0.3, 5), MAT.metal, 0, 0.15, 0, 0, 0, 0, root);
      part(GEO.cyl(0.6, 0.8, 1.0, 8), MAT.metal, 0, 0.8, 0, 0, 0, 0, root);
      sandbagRing(root, 3.4, 12, 0);
      const gun = new THREE.Group();
      gun.name = 'gun';
      gun.position.set(0, 1.5, 0);
      root.add(gun);
      part(GEO.box(1.6, 1.1, 0.12), MAT.enemy, 0, 0.4, -0.5, 0, 0, 0, gun);
      part(GEO.box(0.8, 0.7, 1.6), MAT.enemyLight, 0, 0, 0, 0, 0, 0, gun);
      part(GEO.cyl(0.13, 0.17, 3.4, 6), MAT.dark, 0, 0, -2.2, Math.PI / 2, 0, 0, gun);
      return bakeGroup(root);
    }

    /* --- Torre de vigilancia de madera con ametralladora --- */
    function buildTower() {
      const root = new THREE.Group();
      const h = 8;
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((c) => {
        beam(new V3(c[0] * 1.8, 0, c[1] * 1.8), new V3(c[0] * 1.2, h, c[1] * 1.2), 0.28, MAT.wood, root);
      });
      beam(new V3(-1.7, 1, -1.7), new V3(1.3, h - 1, -1.3), 0.14, MAT.wood, root);
      beam(new V3(1.7, 1, 1.7), new V3(-1.3, h - 1, 1.3), 0.14, MAT.wood, root);
      beam(new V3(-1.7, 1, 1.7), new V3(-1.3, h - 1, -1.3), 0.14, MAT.wood, root);
      beam(new V3(1.7, 1, -1.7), new V3(1.3, h - 1, 1.3), 0.14, MAT.wood, root);
      part(GEO.box(3.2, 0.3, 3.2), MAT.wood, 0, h, 0, 0, 0, 0, root);
      part(GEO.box(3.2, 0.9, 0.15), MAT.wood, 0, h + 0.6, 1.55, 0, 0, 0, root);
      part(GEO.box(3.2, 0.9, 0.15), MAT.wood, 0, h + 0.6, -1.55, 0, 0, 0, root);
      part(GEO.box(0.15, 0.9, 3.2), MAT.wood, 1.55, h + 0.6, 0, 0, 0, 0, root);
      part(GEO.box(0.15, 0.9, 3.2), MAT.wood, -1.55, h + 0.6, 0, 0, 0, 0, root);
      part(GEO.cone(2.6, 1.6, 4), MAT.burnt, 0, h + 2.6, 0, 0, Math.PI / 4, 0, root);
      beam(new V3(1.4, h, 1.4), new V3(1.4, h + 1.9, 1.4), 0.12, MAT.wood, root);
      beam(new V3(-1.4, h, -1.4), new V3(-1.4, h + 1.9, -1.4), 0.12, MAT.wood, root);
      part(GEO.box(0.12, 0.12, 1.2), MAT.dark, 0, h + 1.1, 1.9, 0, 0, 0, root);
      const glow = new THREE.Group();
      glow.name = 'glow';
      root.add(glow);
      part(GEO.box(0.3, 0.3, 0.3), MAT.window, 0, h + 0.9, 0, 0, 0, 0, glow);
      return bakeGroup(root);
    }

    /* --- Tanque del depósito de combustible --- */
    function buildFuelTank() {
      const root = new THREE.Group();
      part(GEO.cyl(2.4, 2.4, 3.4, 10), MAT.rust, 0, 1.7, 0, 0, 0, 0, root);
      part(new THREE.SphereGeometry(2.4, 10, 3, 0, TAU, 0, Math.PI / 2), MAT.rust, 0, 3.4, 0, 0, 0, 0, root);
      part(GEO.cyl(2.45, 2.45, 0.35, 10), MAT.tankStripe, 0, 2.2, 0, 0, 0, 0, root);
      part(GEO.box(0.4, 3.6, 0.2), MAT.dark, 0, 1.9, 2.45, 0, 0, 0, root);
      part(GEO.box(5.6, 0.5, 5.6), MAT.concrete, 0, 0.1, 0, 0, 0, 0, root);
      return bakeGroup(root);
    }

    /* --- Ruinas de casa (decorado) --- */
    function buildRuin(seed) {
      const r = seeded(seed);
      const root = new THREE.Group();
      const w = 5 + r() * 3;
      const d = 4 + r() * 3;
      part(GEO.box(w, 2 + r() * 2.5, 0.4), MAT.ruin, 0, 1.6, -d / 2, 0, 0, 0, root);
      part(GEO.box(0.4, 1.2 + r() * 2.5, d), MAT.ruin, -w / 2, 1.2, 0, 0, 0, 0, root);
      part(GEO.box(w * 0.6, 1 + r() * 1.5, 0.4), MAT.ruin, w * 0.2, 0.8, d / 2, 0, 0, 0, root);
      for (let i = 0; i < 4; i++) beam(new V3(-w / 2 + r() * w, 3.5, -d / 2), new V3(-w / 2 + r() * w, 1 + r(), d / 2), 0.18, MAT.burnt, root);
      for (let i = 0; i < 6; i++) part(GEO.box(0.6 + r(), 0.4 + r() * 0.5, 0.6 + r()), MAT.concrete, -w / 2 + r() * w, 0.2, -d / 2 + r() * d, r(), r(), 0, root);
      return bakeGroup(root);
    }

    /* --- Nube oscura low poly --- */
    function buildCloud(seed) {
      const r = seeded(seed);
      const root = new THREE.Group();
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const m = part(geo, MAT.cloud, (r() - 0.5) * 22, (r() - 0.5) * 4, (r() - 0.5) * 12, r() * 3, r() * 3, 0, root);
        const s = 4 + r() * 6;
        m.scale.set(s * 1.4, s * 0.7, s);
      }
      return bakeGroup(root);
    }

    /* --- Caja de suministros con paracaídas --- */
    function buildCrate(kind) {
      const root = new THREE.Group();
      const crateMat = kind === 'repair' ? retroMat({ map: TEX.crate, color: 0x8fae6a }) : retroMat({ map: TEX.crate, color: 0xb0553a });
      part(GEO.box(1.3, 1.3, 1.3), crateMat, 0, 0, 0, 0, 0, 0, root);
      if (kind === 'repair') {
        part(GEO.plane(0.9, 0.9), MAT.repair, 0, 0, 0.66, 0, 0, 0, root);
        part(GEO.plane(0.9, 0.9), MAT.repair, 0, 0.66, 0, -Math.PI / 2, 0, 0, root);
      } else {
        part(GEO.plane(0.9, 0.9), MAT.star, 0, 0, 0.66, 0, 0, 0, root);
        part(GEO.plane(0.9, 0.9), MAT.star, 0, 0.66, 0, -Math.PI / 2, 0, 0, root);
      }
      part(new THREE.SphereGeometry(1.9, 8, 3, 0, TAU, 0, Math.PI / 2), MAT.chute, 0, 3.2, 0, 0, 0, 0, root);
      [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach((c) => {
        beam(new V3(c[0] * 0.6, 0.6, c[1] * 0.6), new V3(c[0] * 1.6, 3.2, c[1] * 1.6), 0.03, MAT.dark, root);
      });
      const ring = new THREE.Group();
      ring.name = 'ring';
      root.add(ring);
      part(new THREE.TorusGeometry(1.6, 0.09, 4, 14), glowMat(kind === 'repair' ? 0x6bff7a : 0xff6a3a, 0.75), 0, 0, 0, Math.PI / 2, 0, 0, ring);
      return bakeGroup(root);
    }

    /* --- Mina aérea flotante --- */
    function buildMine() {
      const root = new THREE.Group();
      part(new THREE.IcosahedronGeometry(1, 0), MAT.mine, 0, 0, 0, 0, 0, 0, root);
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      dirs.forEach((d) => {
        const c = part(GEO.cone(0.18, 0.7, 4), MAT.metal, d[0] * 1.1, d[1] * 1.1, d[2] * 1.1, 0, 0, 0, root);
        c.quaternion.setFromUnitVectors(UP, new V3(d[0], d[1], d[2]));
      });
      const blink = new THREE.Group();
      blink.name = 'blink';
      root.add(blink);
      part(GEO.box(0.35, 0.35, 0.35), MAT.navRed, 0, 0.95, 0, 0, 0, 0, blink);
      return bakeGroup(root);
    }

    /* --- Bomba de racimo del dirigible --- */
    function buildCluster() {
      const root = new THREE.Group();
      part(GEO.cyl(0.45, 0.45, 1.8, 6), MAT.enemyLight, 0, 0, 0, Math.PI / 2, 0, 0, root);
      part(GEO.cone(0.45, 0.6, 6), MAT.yellow, 0, 0, 1.2, Math.PI / 2, 0, 0, root);
      part(GEO.box(1.2, 0.06, 0.4), MAT.dark, 0, 0, -0.9, 0, 0, 0, root);
      part(GEO.box(0.06, 1.2, 0.4), MAT.dark, 0, 0, -0.9, 0, 0, 0, root);
      return bakeGroup(root);
    }

    /* --- Proyectiles de la jugadora --- */
    function buildRocket() {
      const root = new THREE.Group();
      part(GEO.cyl(0.11, 0.11, 1.1, 6), MAT.metal, 0, 0, 0, Math.PI / 2, 0, 0, root);
      part(GEO.cone(0.11, 0.3, 6), MAT.zepRed, 0, 0, -0.7, -Math.PI / 2, 0, 0, root);
      part(GEO.box(0.5, 0.04, 0.25), MAT.dark, 0, 0, 0.45, 0, 0, 0, root);
      part(GEO.box(0.04, 0.5, 0.25), MAT.dark, 0, 0, 0.45, 0, 0, 0, root);
      const flame = new THREE.Group();
      flame.name = 'flame';
      root.add(flame);
      part(GEO.box(0.18, 0.18, 0.6), MAT.fireCore, 0, 0, 0.85, 0, 0, 0, flame);
      return bakeGroup(root);
    }

    function buildHeavyBomb() {
      const root = new THREE.Group();
      part(GEO.cyl(0.26, 0.26, 1.4, 8), MAT.metal, 0, 0, 0, Math.PI / 2, 0, 0, root);
      part(GEO.cone(0.26, 0.45, 8), MAT.metal, 0, 0, -0.92, -Math.PI / 2, 0, 0, root);
      part(GEO.cyl(0.26, 0.08, 0.5, 8), MAT.metal, 0, 0, 0.95, Math.PI / 2, 0, 0, root);
      part(GEO.box(0.8, 0.04, 0.35), MAT.dark, 0, 0, 1.2, 0, 0, 0, root);
      part(GEO.box(0.04, 0.8, 0.35), MAT.dark, 0, 0, 1.2, 0, 0, 0, root);
      part(GEO.cyl(0.27, 0.27, 0.12, 8), MAT.zepRed, 0, 0, -0.35, Math.PI / 2, 0, 0, root);
      return bakeGroup(root);
    }

    /* --- Jefe final: Zeppelin blindado «Walküre» (eje mayor en X) --- */
    function buildZeppelin() {
      const root = new THREE.Group();
      const hull = new THREE.Group();
      root.add(hull);
      const L = 28;
      const R = 7;
      const shell = part(new THREE.SphereGeometry(1, 18, 10), MAT.zepHull, 0, 0, 0, 0, 0, 0, hull);
      shell.scale.set(L, R, R);
      const radiusAt = (x) => R * Math.sqrt(Math.max(0, 1 - (x / L) * (x / L)));
      // Anillos de blindaje
      [-21, -14, -7, 0, 7, 14, 21].forEach((x) => {
        const r = radiusAt(x) + 0.16;
        part(new THREE.CylinderGeometry(r, r, 0.8, 18, 1, true), MAT.zepPlate, x, 0, 0, 0, 0, Math.PI / 2, hull);
      });
      // Placas dorsales y quilla
      part(GEO.box(40, 0.45, 1.6), MAT.zepPlate, 0, R - 0.05, 0, 0, 0, 0, hull);
      part(GEO.box(44, 0.5, 1.2), MAT.zepPlate, 0, -R + 0.1, 0, 0, 0, 0, hull);
      // Franja roja de identificación
      part(GEO.box(3, 0.5, 2.2), MAT.zepRed, -18, R - 1.1, 0, 0, 0, 0.35, hull);
      // Timones de cola
      part(GEO.box(7, 5, 0.35), MAT.zepPlate, 24.5, 5.8, 0, 0, 0, 0, hull);
      part(GEO.box(7, 4, 0.35), MAT.zepPlate, 24.5, -5.4, 0, 0, 0, 0, hull);
      part(GEO.box(7, 0.35, 5), MAT.zepPlate, 24.5, 0, 5.8, 0, 0, 0, hull);
      part(GEO.box(7, 0.35, 5), MAT.zepPlate, 24.5, 0, -5.8, 0, 0, 0, hull);
      part(GEO.plane(3, 3), MAT.cross, 24.5, 6, 0.2, 0, 0, 0, hull);
      part(GEO.plane(3, 3), MAT.cross, 24.5, 6, -0.2, 0, Math.PI, 0, hull);
      part(new THREE.SphereGeometry(1.4, 8, 6), MAT.zepPlate, -L + 0.6, 0, 0, 0, 0, 0, hull);
      // Torretas dorsales
      const turrets = [];
      [-9, 9].forEach((x) => {
        part(new THREE.SphereGeometry(1.1, 8, 4, 0, TAU, 0, Math.PI / 2), MAT.zepPlate, x, radiusAt(x) - 0.1, 1.5, 0, 0, 0, hull);
        part(GEO.cyl(0.12, 0.12, 2.2, 5), MAT.dark, x - 0.3, radiusAt(x) + 0.5, 2.6, Math.PI / 2.4, 0, 0, hull);
        part(GEO.cyl(0.12, 0.12, 2.2, 5), MAT.dark, x + 0.3, radiusAt(x) + 0.5, 2.6, Math.PI / 2.4, 0, 0, hull);
        turrets.push(new V3(x, radiusAt(x) + 0.6, 3.2));
      });
      // Cañones laterales (lado de la jugadora)
      [-18, 3].forEach((x) => {
        part(GEO.box(2.2, 1.2, 1.2), MAT.zepPlate, x, -1.5, radiusAt(x) - 0.2, 0, 0, 0, hull);
        part(GEO.cyl(0.14, 0.14, 1.8, 5), MAT.dark, x, -1.5, radiusAt(x) + 1.1, Math.PI / 2, 0, 0, hull);
        turrets.push(new V3(x, -1.5, radiusAt(x) + 1.8));
      });
      // Góndola de artillería
      const gondola = new THREE.Group();
      gondola.position.set(-6, -8.4, 0);
      root.add(gondola);
      part(GEO.box(10, 2.6, 3.4), MAT.zepPlate, 0, 0, 0, 0, 0, 0, gondola);
      part(GEO.cone(1.7, 2.4, 4), MAT.zepPlate, -6.1, 0, 0, 0, 0, Math.PI / 2, gondola);
      for (let i = 0; i < 6; i++) part(GEO.box(0.8, 0.5, 0.1), MAT.window, -3.6 + i * 1.45, 0.45, 1.72, 0, 0, 0, gondola);
      [-2.5, 0, 2.5].forEach((x) => part(GEO.cyl(0.16, 0.16, 2.2, 5), MAT.dark, x, -0.7, 2.6, Math.PI / 2, 0, 0, gondola));
      beam(new V3(-4, 1.2, 0), new V3(-4, 2.4, 0), 0.4, MAT.dark, gondola);
      beam(new V3(4, 1.2, 0), new V3(4, 2.4, 0), 0.4, MAT.dark, gondola);
      bakeGroup(gondola);
      // Compartimento central de bombas
      const bay = new THREE.Group();
      bay.position.set(7, -6.7, 0);
      root.add(bay);
      part(GEO.box(7.4, 0.8, 4.2), MAT.zepPlate, 0, 0, 0, 0, 0, 0, bay);
      const glow = new THREE.Group();
      glow.name = 'bayglow';
      glow.visible = false;
      bay.add(glow);
      part(GEO.box(6.4, 0.25, 3.4), MAT.bayGlow, 0, -0.35, 0, 0, 0, 0, glow);
      const doorL = new THREE.Group();
      doorL.name = 'doorL';
      doorL.position.set(-3.3, -0.45, 0);
      bay.add(doorL);
      part(GEO.box(3.3, 0.22, 3.9), MAT.zepRed, 1.65, 0, 0, 0, 0, 0, doorL);
      const doorR = new THREE.Group();
      doorR.name = 'doorR';
      doorR.position.set(3.3, -0.45, 0);
      bay.add(doorR);
      part(GEO.box(3.3, 0.22, 3.9), MAT.zepRed, -1.65, 0, 0, 0, 0, 0, doorR);
      bakeGroup(bay);
      // Motores blindados en voladizo
      const enginePos = [new V3(-12, -2.6, 8.8), new V3(12, -2.6, 8.8), new V3(-19.5, -7, -5.5), new V3(19.5, -7, -5.5)];
      const engines = enginePos.map((p) => {
        const g = new THREE.Group();
        g.position.copy(p);
        root.add(g);
        part(GEO.cyl(1.0, 1.15, 3.6, 8), MAT.zepEngine, 0, 0, 0, 0, 0, Math.PI / 2, g);
        part(GEO.cone(1.0, 1.3, 8), MAT.zepPlate, -2.4, 0, 0, 0, 0, Math.PI / 2, g);
        part(GEO.box(1.6, 0.4, 2.3), MAT.zepPlate, 0, 1.0, 0, 0, 0, 0, g);
        const exhaust = new THREE.Group();
        exhaust.name = 'fx';
        g.add(exhaust);
        part(GEO.box(0.6, 0.2, 0.2), MAT.exhaust, 0.6, 0.6, p.z > 0 ? 1.05 : -1.05, 0, 0, 0, exhaust);
        const prop = new THREE.Group();
        prop.name = 'prop';
        prop.position.set(2.0, 0, 0);
        g.add(prop);
        part(GEO.box(0.3, 3.6, 0.35), MAT.dark, 0, 0, 0, 0, 0, 0, prop);
        part(GEO.box(0.3, 0.35, 3.6), MAT.dark, 0, 0, 0, 0, 0, 0, prop);
        // Soporte hasta el casco
        const toHull = new V3(p.x, p.y * 0.4, Math.sign(p.z) * (radiusAt(p.x) * 0.75));
        beam(new V3(0, 0, 0), toHull.clone().sub(p), 0.55, MAT.zepPlate, g);
        bakeGroup(g);
        return g;
      });
      // Luces de navegación
      const nav = new THREE.Group();
      nav.name = 'nav';
      root.add(nav);
      part(GEO.box(0.5, 0.5, 0.5), MAT.navRed, -L - 0.6, 0, 0, 0, 0, 0, nav);
      part(GEO.box(0.5, 0.5, 0.5), MAT.navWhite, 28, 0, 0, 0, 0, 0, nav);
      part(GEO.box(0.4, 0.4, 0.4), MAT.navRed, 0, R + 0.4, 0, 0, 0, 0, nav);
      bakeGroup(hull);
      return { root, hull, gondola, bay, engines, turrets, L, R, radiusAt };
    }

    /* Plantillas compartidas (las entidades usan .clone()) */
    const TEMPLATES = {
      po2: buildPo2(),
      ally: buildPo2(MAT.ally),
      fighter: buildFighter(),
      searchlight: buildSearchlight(),
      flak: buildFlak(),
      tower: buildTower(),
      fuel: buildFuelTank(),
      crateRepair: buildCrate('repair'),
      crateBomb: buildCrate('bomb'),
      mine: buildMine(),
      cluster: buildCluster(),
      rocket: buildRocket(),
      heavy: buildHeavyBomb(),
      ruins: [buildRuin(11), buildRuin(23), buildRuin(37)],
      clouds: [buildCloud(5), buildCloud(9), buildCloud(17), buildCloud(29)]
    };

    /* ====================================================================
       09. ESCENARIO: RENDERIZADOR, CIELO, TERRENO Y DECORADO
       ==================================================================== */
    const renderer = new THREE.WebGLRenderer({ canvas: el.view, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x05070d, 1);

    const FOG_COLOR = 0x121a2e;
    const FOG_BASE = 0.0115;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(FOG_COLOR);
    scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_BASE);

    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.5, 1400);
    camera.position.set(0, 8, 12);

    // Iluminación nocturna: luna fría + rebote cálido de los incendios
    scene.add(new THREE.AmbientLight(0x46557a, 1.0));
    scene.add(new THREE.HemisphereLight(0x8494c4, 0x2a2014, 0.85));
    const moonLight = new THREE.DirectionalLight(0xc4d0ff, 1.2);
    moonLight.position.set(-0.45, 0.9, 0.6);
    scene.add(moonLight);

    const World = {
      chunks: [],
      clouds: [],
      fogTarget: FOG_BASE,
      init() {
        this.buildSky();
        this.buildTerrain();
        this.buildClouds();
        this.buildTrenches();
      },

      /* --- Trincheras en zigzag con sacos terreros --- */
      buildTrenches() {
        this.trenchSeg = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.4, 2.0), MAT.burnt, 160);
        this.trenchBag = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.6, 0.75), MAT.sandbag, 320);
        [this.trenchSeg, this.trenchBag].forEach((m) => {
          m.count = 0;
          m.frustumCulled = false;
          scene.add(m);
        });
        this.tsI = 0;
        this.tbI = 0;
      },

      spawnTrench(zWorld) {
        const r = seeded(Math.floor(Math.abs(zWorld) * 13) + 7);
        const d = this.dummy || (this.dummy = new THREE.Object3D());
        let x = -120;
        let z = zWorld;
        let seg = 0;
        while (x < 120) {
          const ang = (seg % 2 ? 1 : -1) * (0.35 + r() * 0.3);
          const len = 7 + r() * 5;
          const dx = Math.cos(ang) * len;
          const dz = Math.sin(ang) * len;
          const cx = x + dx / 2;
          const cz = z + dz / 2;
          const y = terrainHeight(cx, cz);
          d.position.set(cx, y - 0.05, cz);
          d.rotation.set(0, -ang, 0);
          d.scale.set(len, 1, 1);
          d.updateMatrix();
          this.trenchSeg.setMatrixAt(this.tsI % 160, d.matrix);
          this.tsI++;
          const px = -dz / len;
          const pz = dx / len;
          [-1, 1].forEach((side) => {
            d.position.set(cx + px * 1.35 * side, y + 0.2, cz + pz * 1.35 * side);
            d.updateMatrix();
            this.trenchBag.setMatrixAt(this.tbI % 320, d.matrix);
            this.tbI++;
          });
          x += dx;
          z += dz;
          seg++;
        }
        this.trenchSeg.count = Math.min(this.tsI, 160);
        this.trenchBag.count = Math.min(this.tbI, 320);
        this.trenchSeg.instanceMatrix.needsUpdate = true;
        this.trenchBag.instanceMatrix.needsUpdate = true;
      },

      buildSky() {
        const sky = this.sky = new THREE.Group();
        scene.add(sky);
        // Cúpula con degradado
        const geo = new THREE.SphereGeometry(950, 18, 12);
        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const zenith = new THREE.Color(0x010208);
        const horizon = new THREE.Color(0x1e2846);
        const glow = new THREE.Color(0x2a1a22);
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i) / 950;
          const t = clamp(y, 0, 1);
          tmpC.copy(horizon).lerp(zenith, Math.pow(t, 0.55));
          if (y < 0.12) tmpC.lerp(glow, (0.12 - Math.max(y, -0.2)) * 3);
          colors[i * 3] = tmpC.r;
          colors[i * 3 + 1] = tmpC.g;
          colors[i * 3 + 2] = tmpC.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
        dome.renderOrder = -10;
        sky.add(dome);
        // Estrellas
        const starGeo = new THREE.BufferGeometry();
        const sp = new Float32Array(900 * 3);
        for (let i = 0; i < 900; i++) {
          randomDir(tmpV);
          tmpV.y = Math.abs(tmpV.y) * 0.95 + 0.05;
          tmpV.normalize().multiplyScalar(880);
          sp[i * 3] = tmpV.x;
          sp[i * 3 + 1] = tmpV.y;
          sp[i * 3 + 2] = tmpV.z;
        }
        starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
        const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe8ff, size: 2, sizeAttenuation: false, fog: false, depthWrite: false }));
        stars.renderOrder = -9;
        sky.add(stars);
        // Luna y halo
        this.moonDir = new V3(-0.42, 0.36, -0.83).normalize();
        const moon = this.moon = new THREE.Mesh(new THREE.CircleGeometry(34, 14), new THREE.MeshBasicMaterial({ color: 0xf3edd3, fog: false, depthWrite: false }));
        moon.position.copy(this.moonDir).multiplyScalar(860);
        moon.renderOrder = -8;
        sky.add(moon);
        const haloMat = glowMat(0x46558a, 0.35);
        haloMat.fog = false;
        const halo = this.halo = new THREE.Mesh(new THREE.CircleGeometry(95, 18), haloMat);
        halo.position.copy(this.moonDir).multiplyScalar(870);
        halo.renderOrder = -9;
        sky.add(halo);
        moon.lookAt(0, 0, 0);
        halo.lookAt(0, 0, 0);
        // Resplandor del frente en llamas sobre el horizonte
        const ring = new THREE.CylinderGeometry(900, 900, 140, 40, 1, true);
        const rp = ring.attributes.position;
        const rc = new Float32Array(rp.count * 3);
        for (let i = 0; i < rp.count; i++) {
          const top = rp.getY(i) > 0;
          const ang = Math.atan2(rp.getZ(i), rp.getX(i));
          const k = top ? 0 : 0.35 + 0.65 * Math.pow(valueNoise(ang * 3 + 10, 4), 2);
          rc[i * 3] = 0.42 * k;
          rc[i * 3 + 1] = 0.16 * k;
          rc[i * 3 + 2] = 0.05 * k;
        }
        ring.setAttribute('color', new THREE.BufferAttribute(rc, 3));
        const ringMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        const front = new THREE.Mesh(ring, ringMat);
        front.position.y = 30;
        front.renderOrder = -7;
        sky.add(front);
      },

      /* --- Terreno infinito por bloques reciclables --- */
      buildTerrain() {
        this.CHUNK_D = 160;
        this.CHUNK_W = 440;
        this.treeGeo = new THREE.ConeGeometry(1.5, 6, 5).translate(0, 3, 0);
        this.trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 6, 4).translate(0, 3, 0);
        this.fireGeo = new THREE.OctahedronGeometry(1, 0);
        for (let i = 0; i < 5; i++) {
          const geo = new THREE.PlaneGeometry(this.CHUNK_W, this.CHUNK_D, 32, 12);
          geo.rotateX(-Math.PI / 2);
          geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
          const mesh = new THREE.Mesh(geo, MAT.terrain);
          mesh.frustumCulled = false;
          scene.add(mesh);
          const trees = new THREE.InstancedMesh(this.treeGeo, MAT.tree, 80);
          const burnt = new THREE.InstancedMesh(this.trunkGeo, MAT.treeBurnt, 30);
          const fires = new THREE.InstancedMesh(this.fireGeo, MAT.fire, 24);
          fires.setColorAt(0, new THREE.Color(1, 1, 1));
          [trees, burnt, fires].forEach((m) => {
            m.frustumCulled = false;
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            scene.add(m);
          });
          const chunk = { mesh, geo, trees, burnt, fires, ruins: [], fireList: [], zc: 0 };
          this.chunks.push(chunk);
          this.rebuildChunk(chunk, -i * this.CHUNK_D);
        }
      },

      rebuildChunk(chunk, zc) {
        chunk.zc = zc;
        const geo = chunk.geo;
        const pos = geo.attributes.position;
        const col = geo.attributes.color;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const wz = zc + pos.getZ(i);
          const h = terrainHeight(x, wz);
          pos.setY(i, h);
          const n = valueNoise(x * 0.05 + 3, wz * 0.05);
          const scorch = 1 - smoothstep(10, 40, Math.abs(x)) * 0.6;
          let r = lerp(0.13, 0.08, n);
          let g = lerp(0.12, 0.13, n);
          let b = lerp(0.08, 0.075, n);
          const hi = smoothstep(4, 16, h);
          r = lerp(r, 0.15, hi);
          g = lerp(g, 0.17, hi);
          b = lerp(b, 0.14, hi);
          const k = (n > 0.78 ? 0.5 : (1 - scorch * 0.3)) * 1.75;
          col.setXYZ(i, r * k, g * k, (b + 0.015) * k);
        }
        pos.needsUpdate = true;
        col.needsUpdate = true;
        geo.computeVertexNormals();
        chunk.mesh.position.set(0, 0, zc);

        // Decorado con semilla por bloque (siempre igual en la misma zona)
        const r = seeded(Math.abs(Math.round(zc / this.CHUNK_D)) * 7919 + 13);
        const dummy = this.dummy || (this.dummy = new THREE.Object3D());
        let ti = 0;
        for (let i = 0; i < 80; i++) {
          const side = r() < 0.5 ? -1 : 1;
          const x = side * (20 + Math.pow(r(), 0.8) * 190);
          const z = zc + (r() - 0.5) * this.CHUNK_D;
          if (r() < 0.12 && Math.abs(x) < 60) continue;
          const s = 0.75 + r() * 0.9;
          dummy.position.set(x, terrainHeight(x, z) - 0.4, z);
          dummy.rotation.set(0, r() * TAU, (r() - 0.5) * 0.1);
          dummy.scale.set(s, s * (0.8 + r() * 0.5), s);
          dummy.updateMatrix();
          chunk.trees.setMatrixAt(ti++, dummy.matrix);
        }
        chunk.trees.count = ti;
        chunk.trees.instanceMatrix.needsUpdate = true;
        let bi = 0;
        for (let i = 0; i < 30; i++) {
          const x = (r() - 0.5) * 120;
          if (Math.abs(x) < 6) continue;
          const z = zc + (r() - 0.5) * this.CHUNK_D;
          const s = 0.6 + r() * 0.6;
          dummy.position.set(x, terrainHeight(x, z) - 0.3, z);
          dummy.rotation.set((r() - 0.5) * 0.5, 0, (r() - 0.5) * 0.5);
          dummy.scale.set(s, s, s);
          dummy.updateMatrix();
          chunk.burnt.setMatrixAt(bi++, dummy.matrix);
        }
        chunk.burnt.count = bi;
        chunk.burnt.instanceMatrix.needsUpdate = true;
        // Ruinas en llamas
        chunk.ruins.forEach((m) => scene.remove(m));
        chunk.ruins.length = 0;
        chunk.fireList.length = 0;
        const nRuins = 1 + Math.floor(r() * 3);
        for (let i = 0; i < nRuins; i++) {
          const x = randSignSeed(r) * (24 + r() * 70);
          const z = zc + (r() - 0.5) * this.CHUNK_D;
          const m = TEMPLATES.ruins[Math.floor(r() * TEMPLATES.ruins.length)].clone();
          m.position.set(x, terrainHeight(x, z) - 0.2, z);
          m.rotation.y = r() * TAU;
          scene.add(m);
          chunk.ruins.push(m);
          const nf = 2 + Math.floor(r() * 3);
          for (let f = 0; f < nf; f++) {
            chunk.fireList.push({ x: x + (r() - 0.5) * 5, y: m.position.y + 0.5 + r() * 1.5, z: z + (r() - 0.5) * 4, s: 0.6 + r() * 0.9, ph: r() * 10 });
          }
        }
        // Hogueras sueltas en el corredor (cráteres humeantes)
        const nCraters = Math.floor(r() * 4);
        for (let i = 0; i < nCraters; i++) {
          const x = (r() - 0.5) * 90;
          const z = zc + (r() - 0.5) * this.CHUNK_D;
          chunk.fireList.push({ x, y: terrainHeight(x, z) + 0.2, z, s: 0.4 + r() * 0.5, ph: r() * 10 });
        }
        chunk.fires.count = Math.min(24, chunk.fireList.length);
        for (let i = 0; i < chunk.fires.count; i++) {
          chunk.fires.setColorAt(i, tmpC.setHSL(0.05 + r() * 0.05, 1, 0.5));
        }
        if (chunk.fires.instanceColor) chunk.fires.instanceColor.needsUpdate = true;
      },

      /* --- Nubes oscuras --- */
      buildClouds() {
        for (let i = 0; i < 18; i++) {
          const c = TEMPLATES.clouds[i % TEMPLATES.clouds.length].clone();
          c.visible = false;
          scene.add(c);
          this.clouds.push({ obj: c, active: false });
        }
      },

      spawnCloud(x, y, zWorld, scale) {
        const slot = this.clouds.find((c) => !c.active);
        if (!slot) return;
        slot.active = true;
        slot.obj.visible = true;
        slot.obj.position.set(x, y, zWorld);
        slot.obj.rotation.y = Math.random() * TAU;
        const s = (scale || rand(0.8, 1.6)) * 0.6;
        slot.obj.scale.set(s, s * rand(0.7, 1.1), s);
      },

      clearClouds() {
        this.clouds.forEach((c) => { c.active = false; c.obj.visible = false; });
      },

      update(dt, time) {
        const camZ = camera.position.z;
        this.sky.position.copy(camera.position);
        // Reciclar bloques que quedan detrás de la cámara
        let minZ = Infinity;
        this.chunks.forEach((c) => { if (c.zc < minZ) minZ = c.zc; });
        this.chunks.forEach((c) => {
          if (c.zc - this.CHUNK_D / 2 > camZ + 30) {
            minZ -= this.CHUNK_D;
            this.rebuildChunk(c, minZ);
          }
        });
        // Llamas parpadeantes
        const dummy = this.dummy;
        this.chunks.forEach((c) => {
          const n = c.fires.count;
          for (let i = 0; i < n; i++) {
            const f = c.fireList[i];
            const flick = 0.75 + Math.sin(time * 13 + f.ph) * 0.15 + Math.sin(time * 29 + f.ph * 3) * 0.1;
            dummy.position.set(f.x, f.y + flick * f.s * 0.6, f.z);
            dummy.rotation.set(time * 2 + f.ph, time * 3 + f.ph, 0);
            dummy.scale.set(f.s * 0.8, f.s * 1.8 * flick, f.s * 0.8);
            dummy.updateMatrix();
            c.fires.setMatrixAt(i, dummy.matrix);
          }
          c.fires.instanceMatrix.needsUpdate = true;
        });
        // Nubes: liberar las que ya pasaron
        this.clouds.forEach((c) => {
          if (c.active && c.obj.position.z > camZ + 60) {
            c.active = false;
            c.obj.visible = false;
          }
        });
        // Niebla dinámica (se espesa antes del jefe)
        scene.fog.density = damp(scene.fog.density, this.fogTarget, 0.8, dt);
      }
    };

    function randSignSeed(r) {
      return r() < 0.5 ? -1 : 1;
    }

    /* ====================================================================
       10. PARTÍCULAS, LUCES Y EFECTOS
       ==================================================================== */
    class Particles {
      constructor(geo, mat, max) {
        this.mesh = new THREE.InstancedMesh(geo, mat, max);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        this.max = max;
        this.n = 0;
        this.p = new Float32Array(max * 3);
        this.v = new Float32Array(max * 3);
        this.r = new Float32Array(max * 3);
        this.w = new Float32Array(max * 3);
        this.c0 = new Float32Array(max * 3);
        this.c1 = new Float32Array(max * 3);
        this.life = new Float32Array(max);
        this.maxLife = new Float32Array(max);
        this.s0 = new Float32Array(max);
        this.s1 = new Float32Array(max);
        this.grav = new Float32Array(max);
        this.drag = new Float32Array(max);
        this.stretch = new Float32Array(max);
        this.dummy = new THREE.Object3D();
        scene.add(this.mesh);
      }

      spawn(x, y, z, vx, vy, vz, life, s0, s1, col0, col1, grav, drag, stretch) {
        let i = this.n;
        if (i >= this.max) i = Math.floor(Math.random() * this.max);
        else this.n++;
        const i3 = i * 3;
        this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
        this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
        this.r[i3] = Math.random() * TAU; this.r[i3 + 1] = Math.random() * TAU; this.r[i3 + 2] = Math.random() * TAU;
        this.w[i3] = rand(-6, 6); this.w[i3 + 1] = rand(-6, 6); this.w[i3 + 2] = rand(-6, 6);
        this.c0[i3] = col0.r; this.c0[i3 + 1] = col0.g; this.c0[i3 + 2] = col0.b;
        this.c1[i3] = col1.r; this.c1[i3 + 1] = col1.g; this.c1[i3 + 2] = col1.b;
        this.life[i] = life;
        this.maxLife[i] = life;
        this.s0[i] = s0;
        this.s1[i] = s1;
        this.grav[i] = grav || 0;
        this.drag[i] = drag || 0;
        this.stretch[i] = stretch || 0;
      }

      copy(from, to) {
        const f3 = from * 3, t3 = to * 3;
        for (let k = 0; k < 3; k++) {
          this.p[t3 + k] = this.p[f3 + k];
          this.v[t3 + k] = this.v[f3 + k];
          this.r[t3 + k] = this.r[f3 + k];
          this.w[t3 + k] = this.w[f3 + k];
          this.c0[t3 + k] = this.c0[f3 + k];
          this.c1[t3 + k] = this.c1[f3 + k];
        }
        this.life[to] = this.life[from];
        this.maxLife[to] = this.maxLife[from];
        this.s0[to] = this.s0[from];
        this.s1[to] = this.s1[from];
        this.grav[to] = this.grav[from];
        this.drag[to] = this.drag[from];
        this.stretch[to] = this.stretch[from];
      }

      clear() {
        this.n = 0;
        this.mesh.count = 0;
      }

      update(dt) {
        const d = this.dummy;
        const nearZ = camera.position.z - 2.5;
        let i = 0;
        while (i < this.n) {
          this.life[i] -= dt;
          if (this.life[i] <= 0) {
            this.n--;
            if (i !== this.n) this.copy(this.n, i);
            continue;
          }
          const i3 = i * 3;
          const dr = Math.exp(-this.drag[i] * dt);
          this.v[i3] *= dr;
          this.v[i3 + 1] = this.v[i3 + 1] * dr - this.grav[i] * dt;
          this.v[i3 + 2] *= dr;
          this.p[i3] += this.v[i3] * dt;
          this.p[i3 + 1] += this.v[i3 + 1] * dt;
          this.p[i3 + 2] += this.v[i3 + 2] * dt;
          const t = 1 - this.life[i] / this.maxLife[i];
          // Las partículas que rozan la cámara se ocultan para no tapar la vista
          const s = this.p[i3 + 2] > nearZ ? 0.0001 : lerp(this.s0[i], this.s1[i], t);
          d.position.set(this.p[i3], this.p[i3 + 1], this.p[i3 + 2]);
          if (this.stretch[i] > 0) {
            tmpV.set(this.v[i3], this.v[i3 + 1], this.v[i3 + 2]);
            const sp = tmpV.length();
            if (sp > 0.001) d.quaternion.setFromUnitVectors(Z_AXIS, tmpV.multiplyScalar(1 / sp));
            d.scale.set(s, s, s < 0.001 ? s : s + sp * this.stretch[i]);
          } else {
            this.r[i3] += this.w[i3] * dt;
            this.r[i3 + 1] += this.w[i3 + 1] * dt;
            this.r[i3 + 2] += this.w[i3 + 2] * dt;
            d.rotation.set(this.r[i3], this.r[i3 + 1], this.r[i3 + 2]);
            d.scale.set(s, s, s);
          }
          d.updateMatrix();
          this.mesh.setMatrixAt(i, d.matrix);
          tmpC.setRGB(
            lerp(this.c0[i3], this.c1[i3], t),
            lerp(this.c0[i3 + 1], this.c1[i3 + 1], t),
            lerp(this.c0[i3 + 2], this.c1[i3 + 2], t)
          );
          this.mesh.setColorAt(i, tmpC);
          i++;
        }
        this.mesh.count = this.n;
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      }
    }

    const COL = {
      white: new THREE.Color(1, 1, 1),
      fire: new THREE.Color(1, 0.82, 0.42),
      fireEnd: new THREE.Color(0.55, 0.08, 0.0),
      ember: new THREE.Color(1, 0.55, 0.15),
      dark: new THREE.Color(0, 0, 0),
      smoke: new THREE.Color(0.2, 0.18, 0.17),
      smokeEnd: new THREE.Color(0.05, 0.05, 0.06),
      flak: new THREE.Color(0.07, 0.07, 0.08),
      spark: new THREE.Color(1, 0.9, 0.55),
      sparkEnd: new THREE.Color(0.6, 0.2, 0.0),
      blue: new THREE.Color(0.55, 0.75, 1),
      wind: new THREE.Color(0.18, 0.24, 0.34),
      wood: new THREE.Color(0.45, 0.31, 0.17),
      canvas: new THREE.Color(0.36, 0.42, 0.24),
      metal: new THREE.Color(0.35, 0.36, 0.38),
      tracer: new THREE.Color(1, 0.7, 0.25),
      green: new THREE.Color(0.5, 1, 0.55),
      red: new THREE.Color(1, 0.3, 0.2)
    };

    const FX = {
      shake: 0,
      flash: 0,
      init() {
        this.add = new Particles(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 1600);
        this.smoke = new Particles(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.82, depthWrite: false }), 900);
        this.debris = new Particles(new THREE.BoxGeometry(1, 1, 1), retroMat({}), 500);
        this.lights = [];
        for (let i = 0; i < 4; i++) {
          const l = new THREE.PointLight(0xffaa55, 0, 70, 1.6);
          scene.add(l);
          this.lights.push({ light: l, t: 0, dur: 1, peak: 0 });
        }
      },

      clear() {
        this.add.clear();
        this.smoke.clear();
        this.debris.clear();
        this.lights.forEach((L) => { L.t = 0; L.light.intensity = 0; });
      },

      light(pos, color, intensity, dur) {
        let best = this.lights[0];
        this.lights.forEach((L) => { if (L.t < best.t) best = L; });
        best.light.position.copy(pos);
        best.light.color.setHex(color);
        best.t = dur;
        best.dur = dur;
        best.peak = intensity;
      },

      addShake(amount, pos) {
        let a = amount;
        if (pos) a *= clamp(1 - pos.distanceTo(camera.position) / 90, 0, 1);
        this.shake = Math.max(this.shake, a);
      },

      sparks(pos, count, color) {
        const c = color || COL.spark;
        for (let i = 0; i < count; i++) {
          randomDir(tmpV).multiplyScalar(rand(6, 18));
          this.add.spawn(pos.x, pos.y, pos.z, tmpV.x, tmpV.y, tmpV.z, rand(0.12, 0.3), rand(0.12, 0.22), 0.02, c, COL.sparkEnd, 6, 3, 0.02);
        }
      },

      muzzle(pos, dir) {
        this.add.spawn(pos.x, pos.y, pos.z, dir.x * 20, dir.y * 20, dir.z * 20, 0.06, 0.45, 0.1, COL.fire, COL.fireEnd, 0, 0);
      },

      smokePuff(pos, size, life) {
        this.smoke.spawn(pos.x + rand(-0.3, 0.3), pos.y, pos.z + rand(-0.3, 0.3), rand(-0.5, 0.5), rand(0.5, 1.5), rand(-0.5, 0.5), life || rand(1, 1.8), size * 0.5, size * 1.8, COL.smoke, COL.smokeEnd, -0.6, 0.8);
      },

      firePuff(pos, size) {
        this.add.spawn(pos.x + rand(-0.3, 0.3), pos.y, pos.z + rand(-0.3, 0.3), rand(-1, 1), rand(1, 3), rand(-1, 1), rand(0.25, 0.5), size, size * 0.2, COL.fire, COL.fireEnd, -2, 1.5);
      },

      explosion(pos, size, opts) {
        const s = size || 1;
        const o = opts || {};
        const n = Math.round(14 * s);
        for (let i = 0; i < n; i++) {
          randomDir(tmpV).multiplyScalar(rand(3, 13) * Math.sqrt(s));
          this.add.spawn(pos.x + tmpV.x * 0.05, pos.y + tmpV.y * 0.05, pos.z + tmpV.z * 0.05, tmpV.x, tmpV.y, tmpV.z, rand(0.35, 0.75), rand(0.9, 1.7) * s, 0.15, COL.fire, COL.fireEnd, -2, 2.6);
        }
        for (let i = 0; i < Math.round(8 * s); i++) {
          randomDir(tmpV).multiplyScalar(rand(1, 4) * s);
          this.smoke.spawn(pos.x, pos.y, pos.z, tmpV.x, tmpV.y + 2, tmpV.z, rand(1.2, 2.4), 0.9 * s, 2.8 * s, COL.smoke, COL.smokeEnd, -1.2, 1.3);
        }
        const debrisCol = o.debris || COL.metal;
        for (let i = 0; i < Math.round(6 * s); i++) {
          randomDir(tmpV).multiplyScalar(rand(6, 15));
          this.debris.spawn(pos.x, pos.y, pos.z, tmpV.x, tmpV.y + 6, tmpV.z, rand(0.8, 1.6), rand(0.2, 0.55) * Math.sqrt(s), 0.1, debrisCol, COL.dark, 18, 0.3);
        }
        this.sparks(pos, Math.round(8 * s));
        this.light(pos, 0xffa050, 7 * s, 0.4 + s * 0.15);
        const dist = pos.distanceTo(camera.position);
        sound.explosion(s, dist, (pos.x - camera.position.x) / 40);
        this.addShake(0.35 * s, pos);
      },

      flak(pos) {
        for (let i = 0; i < 7; i++) {
          randomDir(tmpV).multiplyScalar(rand(1, 3.5));
          this.smoke.spawn(pos.x, pos.y, pos.z, tmpV.x, tmpV.y, tmpV.z, rand(1.2, 2.0), 0.9, 2.6, COL.flak, COL.dark, -0.3, 1.8);
        }
        for (let i = 0; i < 6; i++) {
          randomDir(tmpV).multiplyScalar(rand(4, 10));
          this.add.spawn(pos.x, pos.y, pos.z, tmpV.x, tmpV.y, tmpV.z, rand(0.12, 0.25), rand(1, 1.8), 0.1, COL.fire, COL.fireEnd, 0, 4);
        }
        this.light(pos, 0xffb060, 4, 0.25);
        sound.flak(pos.distanceTo(camera.position), (pos.x - camera.position.x) / 40);
      },

      windStreak(pos) {
        this.add.spawn(pos.x, pos.y, pos.z, rand(-0.4, 0.4), rand(-0.2, 0.2), rand(10, 16), rand(0.12, 0.22), rand(0.04, 0.07), 0.02, COL.wind, COL.dark, 0, 0, 0.06);
      },

      update(dt) {
        this.add.update(dt);
        this.smoke.update(dt);
        this.debris.update(dt);
        this.lights.forEach((L) => {
          if (L.t > 0) {
            L.t = Math.max(0, L.t - dt);
            const k = L.t / L.dur;
            L.light.intensity = L.peak * k * k;
          } else if (L.light.intensity !== 0) {
            L.light.intensity = 0;
          }
        });
        this.shake = Math.max(0, this.shake - dt * 1.8);
        this.flash = Math.max(0, this.flash - dt * 2.5);
      }
    };

    /* ====================================================================
       11. PROYECTILES
       ==================================================================== */
    class BulletPool {
      constructor(geo, mat, max) {
        this.mesh = new THREE.InstancedMesh(geo, mat, max);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.count = 0;
        this.mesh.frustumCulled = false;
        scene.add(this.mesh);
        this.items = [];
        for (let i = 0; i < max; i++) this.items.push({ pos: new V3(), prev: new V3(), vel: new V3(), life: 0, dmg: 1, active: false });
        this.active = [];
        this.dummy = new THREE.Object3D();
      }

      spawn(pos, vel, life, dmg) {
        const b = this.items.find((it) => !it.active);
        if (!b) return null;
        b.active = true;
        b.pos.copy(pos);
        b.prev.copy(pos);
        b.vel.copy(vel);
        b.life = life;
        b.dmg = dmg || 1;
        this.active.push(b);
        return b;
      }

      kill(b) {
        b.active = false;
      }

      clear() {
        this.active.forEach((b) => { b.active = false; });
        this.active.length = 0;
        this.mesh.count = 0;
      }

      /* Mueve, elimina y redibuja; onStep(b) devuelve true para destruir */
      update(dt, onStep) {
        const list = this.active;
        let w = 0;
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (!b.active) continue;
          b.prev.copy(b.pos);
          b.pos.addScaledVector(b.vel, dt);
          b.life -= dt;
          if (b.life <= 0 || onStep(b)) {
            b.active = false;
            continue;
          }
          list[w++] = b;
        }
        list.length = w;
        const d = this.dummy;
        for (let i = 0; i < w; i++) {
          const b = list[i];
          d.position.copy(b.pos);
          tmpV.copy(b.vel).normalize();
          d.quaternion.setFromUnitVectors(Z_AXIS, tmpV);
          d.updateMatrix();
          this.mesh.setMatrixAt(i, d.matrix);
        }
        this.mesh.count = w;
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }

    /* ====================================================================
       ESTADO GLOBAL DE LA PARTIDA
       ==================================================================== */
    const DIFFICULTY = {
      easy: { damage: 0.6, enemyFire: 0.75 },
      normal: { damage: 0.85, enemyFire: 1 },
      hard: { damage: 1.45, enemyFire: 1.3 }
    };

    const Game = {
      state: 'boot',
      time: 0,
      railZ: 0,
      railSpeed: 30,
      timeScale: 1,
      score: 0,
      kills: 0,
      stats: { shots: 0, hits: 0, bombs: 0, damage: 0, time: 0 },
      detection: 0,
      detected: false,
      litThisFrame: false,
      flakQueue: [],
      timers: [],
      checkpoint: false,
      get diff() { return DIFFICULTY[Settings.data.difficulty] || DIFFICULTY.normal; },

      resetRun() {
        this.score = 0;
        this.kills = 0;
        this.stats = { shots: 0, hits: 0, bombs: 0, damage: 0, time: 0 };
        this.detection = 0;
        this.detected = false;
        this.flakQueue.length = 0;
        this.timers.length = 0;
        this.timeScale = 1;
      },

      addScore(n) {
        this.score += n;
      },

      addKill(entity) {
        this.kills++;
        this.score += entity.score || 100;
        UI.popHits();
      },

      scheduleFlak(pos, delay, damage) {
        this.flakQueue.push({ pos: pos.clone(), t: delay, dmg: damage || 13 });
      },

      later(delay, fn) {
        this.timers.push({ t: delay, fn });
      },

      updateTimers(dt) {
        for (let i = this.flakQueue.length - 1; i >= 0; i--) {
          const f = this.flakQueue[i];
          f.t -= dt;
          if (f.t <= 0) {
            this.flakQueue.splice(i, 1);
            FX.flak(f.pos);
            const d = f.pos.distanceTo(Player.wpos);
            if (d < 4.6) Player.hurt(lerp(f.dmg, 4, d / 4.6), 'flak');
          }
        }
        for (let i = this.timers.length - 1; i >= 0; i--) {
          const t = this.timers[i];
          t.t -= dt;
          if (t.t <= 0) {
            this.timers.splice(i, 1);
            t.fn();
          }
        }
      }
    };

    /* ====================================================================
       12. ENTIDADES
       ==================================================================== */
    const entities = [];

    function addEntity(e) {
      entities.push(e);
      return e;
    }

    function clearEntities() {
      entities.forEach((e) => e.remove());
      entities.length = 0;
    }

    function isBehindCamera(z, margin) {
      return z > camera.position.z + (margin || 8);
    }

    class Entity {
      constructor() {
        this.kind = 'entity';
        this.alive = true;
        this.gone = false;
        this.hp = 1;
        this.radius = 1.5;
        this.score = 100;
        this.targetable = true;
        this.friendly = false;
        this.obj = null;
        this.center = new V3();
        this.centerOffset = 0;
        this.vel = new V3();
        this.prevPos = new V3();
        this.age = 0;
      }

      updateCenter() {
        this.center.copy(this.obj.position);
        this.center.y += this.centerOffset;
      }

      hit(dmg, point) {
        if (!this.alive || !this.targetable) return false;
        this.hp -= dmg;
        FX.sparks(point || this.center, 3);
        if (this.hp <= 0) this.destroy(true);
        else sound.hitTink((this.center.x - camera.position.x) / 40);
        return true;
      }

      destroy(byPlayer) {
        if (!this.alive) return;
        this.alive = false;
        this.gone = true;
        this.explode();
        if (byPlayer) Game.addKill(this);
      }

      explode() {
        FX.explosion(this.center, 1);
      }

      remove() {
        this.alive = false;
        this.gone = true;
        if (this.obj && this.obj.parent) this.obj.parent.remove(this.obj);
        this.cleanup();
      }

      cleanup() {}

      update() {}
    }

    /* Disparo enemigo con anticipación a la trayectoria de la jugadora */
    function enemyShoot(from, opts) {
      if (!Player.alive) return;
      const o = opts || {};
      const speed = o.speed || 58;
      const target = Player.wpos;
      let t = from.distanceTo(target) / speed;
      for (let k = 0; k < 2; k++) {
        tmpV.copy(target);
        tmpV.z -= Game.railSpeed * t;
        tmpV.x += Player.vel.x * t * 0.5;
        tmpV.y += Player.vel.y * t * 0.5;
        t = from.distanceTo(tmpV) / speed;
      }
      let err = Player.gliding ? 6.5 : (Game.detected ? 0.7 : 1.5);
      err /= (o.accuracy || 1) * Game.diff.enemyFire;
      tmpV.x += rand(-err, err);
      tmpV.y += rand(-err, err) * 0.8;
      tmpV2.copy(tmpV).sub(from).normalize();
      const n = o.count || 1;
      for (let i = 0; i < n; i++) {
        tmpV3.copy(tmpV2);
        if (o.spread) {
          tmpV3.x += rand(-o.spread, o.spread);
          tmpV3.y += rand(-o.spread, o.spread);
          tmpV3.normalize();
        }
        tmpV3.multiplyScalar(speed);
        EnemyBullets.spawn(from, tmpV3, o.life || 3.4, o.dmg || 7);
      }
      sound.enemyGun(from.distanceTo(camera.position), (from.x - camera.position.x) / 40);
    }

    /* Bala en una dirección fija (cortinas de balas del jefe) */
    function enemyShootDir(from, dir, speed, dmg) {
      tmpV3.copy(dir).normalize().multiplyScalar(speed || 40);
      EnemyBullets.spawn(from, tmpV3, 4, dmg || 7);
    }

    /* --- Caza nocturno --- */
    class Fighter extends Entity {
      constructor(o) {
        super();
        this.kind = 'fighter';
        this.o = o;
        this.hp = o.hp || 3;
        this.radius = 2.5;
        this.score = o.score || 100;
        this.mode = o.mode;
        this.phase = 0;
        this.t = 0;
        this.burst = 0;
        this.burstT = 0;
        this.fireT = rand(0.8, 1.8) + (o.fireDelay || 0);
        this.rel = new V3(o.x, o.y, o.z);
        this.rv = new V3();
        this.bank = 0;
        this.obj = TEMPLATES.fighter.clone();
        this.props = [];
        this.obj.traverse((c) => { if (c.name === 'prop') this.props.push(c); });
        scene.add(this.obj);
        this.syncWorld();
        this.updateCenter();
        orientQuat(this.obj.quaternion, tmpV.set(0, 0, this.mode === 'headon' ? 1 : -1), 0);
      }

      syncWorld() {
        this.obj.position.set(this.rel.x, this.rel.y, Game.railZ + this.rel.z);
      }

      seek(tx, ty, tz, gain, maxSpeed) {
        this.rv.set((tx - this.rel.x) * gain, (ty - this.rel.y) * gain, (tz - this.rel.z) * gain);
        if (this.rv.length() > maxSpeed) this.rv.setLength(maxSpeed);
      }

      update(dt) {
        this.t += dt;
        const o = this.o;
        const r = this.rel;
        const v = this.rv;
        switch (this.mode) {
          case 'headon': {
            v.z = (o.speed || 16) + Game.railSpeed;
            const wx = o.x + Math.sin(this.t * (o.freq || 1.6) + (o.phase || 0)) * (o.amp || 3);
            const wy = o.y + Math.cos(this.t * 1.3 + (o.phase || 0)) * 1.2;
            v.x = (wx - r.x) * 3;
            v.y = (wy - r.y) * 3;
            if (r.z > -24) {
              v.y += 16;
              v.x += (r.x >= 0 ? 1 : -1) * 16;
            }
            if (r.z > 30) this.gone = true;
            break;
          }
          case 'cross': {
            v.x = o.dir * (o.speed || 24);
            v.y = Math.cos(this.t * 2 + (o.phase || 0)) * 3;
            v.z = (o.approach || 0);
            if (Math.abs(r.x) > 80) this.gone = true;
            break;
          }
          case 'behind': {
            if (this.phase === 0) {
              this.seek(Player.pos.x + (o.ox || 0), Player.pos.y + 1.5, 6, 1.6, 40);
              if (this.t > 3.4) { this.phase = 1; this.t = 0; }
            } else if (this.phase === 1) {
              this.seek(r.x * 0.9, Player.pos.y + 5, -60, 1.2, 42);
              if (r.z < -50) { this.phase = 2; this.t = 0; this.mode = 'hold'; this.o = Object.assign({}, o, { cx: r.x, cy: 10, cz: -50, duration: 7 }); }
            }
            break;
          }
          case 'hold': {
            if (this.t < (o.duration || 8)) {
              this.seek(
                (o.cx || 0) + Math.sin(this.t * 0.9 + (o.phase || 0)) * (o.ampX || 9),
                (o.cy || 10) + Math.sin(this.t * 1.3 + (o.phase || 0)) * 3.5,
                (o.cz || -50) + Math.sin(this.t * 0.6) * 6,
                2.2, 40
              );
            } else {
              v.y = damp(v.y, 9, 2, dt);
              v.z = damp(v.z, -45, 1.5, dt);
              if (r.z < -260) this.gone = true;
            }
            break;
          }
          case 'chaseAlly': {
            const a = o.ally;
            if (a && !a.gone && a.state === 'evade') {
              this.seek(a.rel.x + 0.6, a.rel.y + 0.4, a.rel.z + 8, 3, 45);
              this.allyShot = (this.allyShot || 0) - dt;
              if (this.allyShot <= 0) {
                this.allyShot = rand(0.25, 0.5);
                tmpV.copy(a.obj.position).sub(this.obj.position).normalize();
                FX.add.spawn(this.obj.position.x, this.obj.position.y, this.obj.position.z, tmpV.x * 70, tmpV.y * 70, tmpV.z * 70 - Game.railSpeed, 0.12, 0.2, 0.2, COL.tracer, COL.ember, 0, 0, 0.03);
                sound.enemyGun(this.obj.position.distanceTo(camera.position), 0);
              }
            } else {
              this.mode = 'hold';
              this.t = 0;
              this.o = { cx: r.x, cy: 10, cz: -48, duration: 6 };
            }
            break;
          }
          default:
            break;
        }
        r.addScaledVector(v, dt);
        this.syncWorld();
        this.updateCenter();
        // Orientación según la velocidad en el mundo
        tmpV.set(v.x, v.y, v.z - Game.railSpeed);
        if (tmpV.lengthSq() < 0.01) tmpV.set(0, 0, -1);
        tmpV.normalize();
        tmpV2.crossVectors(tmpV, UP).normalize();
        const lateral = v.x * tmpV2.x + v.z * tmpV2.z;
        this.bank = damp(this.bank, clamp(-lateral * 0.045, -1.1, 1.1), 4, dt);
        orientQuat(tmpQ, tmpV, this.bank);
        this.obj.quaternion.slerp(tmpQ, 1 - Math.exp(-7 * dt));
        this.props.forEach((p) => { p.rotation.z += 45 * dt; });
        // Fuego: ráfagas de 3 disparos
        this.fireT -= dt;
        if (this.fireT <= 0 && this.canFire()) {
          this.fireT = (o.fireRate || 2.2) * (Player.gliding ? 1.8 : 1) * rand(0.8, 1.25) / Game.diff.enemyFire;
          this.burst = 3;
          this.burstT = 0;
        }
        if (this.burst > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burst--;
            this.burstT = 0.1;
            if (this.canFire()) enemyShoot(this.center, { speed: 60 });
          }
        }
        if (r.z > 40 || r.z < -320 || Math.abs(r.x) > 95) this.gone = true;
      }

      canFire() {
        if (!Player.alive || this.mode === 'chaseAlly' || Level.phase === 'start') return false;
        if (this.mode === 'behind' && this.phase === 0) return this.t > 1.2;
        return this.rel.z < -16 && this.rel.z > -150;
      }

      explode() {
        FX.explosion(this.center, 1.2, { debris: COL.metal });
      }
    }

    /* --- Po-2 aliado (evento de rescate) --- */
    class Ally extends Entity {
      constructor() {
        super();
        this.kind = 'ally';
        this.friendly = true;
        this.targetable = false;
        this.state = 'arrive';
        this.t = 0;
        this.bank = 0;
        this.rel = new V3(14, 12, -170);
        this.rv = new V3();
        this.obj = TEMPLATES.ally.clone();
        this.prop = this.obj.getObjectByName('prop');
        scene.add(this.obj);
      }

      update(dt) {
        this.t += dt;
        const r = this.rel;
        let tx = r.x, ty = r.y, tz = r.z;
        if (this.state === 'arrive') {
          tx = 6; ty = 10; tz = -42;
          if (r.distanceTo(tmpV.set(tx, ty, tz)) < 4) this.state = 'evade';
        } else if (this.state === 'evade') {
          tx = 6 + Math.sin(this.t * 1.7) * 5;
          ty = 10 + Math.sin(this.t * 2.3) * 2.5;
          tz = -42 + Math.sin(this.t * 0.8) * 4;
        } else if (this.state === 'saved') {
          tx = r.x + 2; ty = r.y + 6; tz = r.z - 40;
          if (r.z < -220) this.gone = true;
        } else if (this.state === 'downed') {
          tx = r.x + 4; ty = r.y - 3; tz = r.z - 18;
          if (Math.random() < 0.5) FX.smokePuff(this.obj.position, 1.2, 1.4);
          if (r.z < -220 || r.y < 1) this.gone = true;
        }
        this.rv.set((tx - r.x) * 2, (ty - r.y) * 2, (tz - r.z) * 2);
        if (this.rv.length() > 34) this.rv.setLength(34);
        r.addScaledVector(this.rv, dt);
        this.obj.position.set(r.x, r.y, Game.railZ + r.z);
        this.updateCenter();
        tmpV.set(this.rv.x, this.rv.y, this.rv.z - Game.railSpeed).normalize();
        let bankT = clamp(-this.rv.x * 0.06, -0.9, 0.9);
        if (this.state === 'saved') bankT = Math.sin(this.t * 9) * 0.5;
        this.bank = damp(this.bank, bankT, 5, dt);
        orientQuat(this.obj.quaternion, tmpV, this.bank);
        this.prop.rotation.z += 38 * dt;
      }
    }

    /* --- Reflector antiaéreo con haz de luz --- */
    const BEAM_LEN = 150;
    const BEAM_RADIUS = 12;
    const BEAM_GEO = new THREE.ConeGeometry(BEAM_RADIUS, BEAM_LEN, 14, 1, true).translate(0, -BEAM_LEN / 2, 0).rotateX(Math.PI);
    const BEAM_CORE_GEO = new THREE.ConeGeometry(BEAM_RADIUS * 0.45, BEAM_LEN, 10, 1, true).translate(0, -BEAM_LEN / 2, 0).rotateX(Math.PI);

    /* Acorta un haz si la cámara quedaría dentro del cono (evita el "lavado" blanco) */
    function clipBeam(mesh, apex, dir, base) {
      const b = base || 1;
      tmpV4.copy(camera.position).sub(apex);
      const along = tmpV4.dot(dir);
      let k = b;
      if (along > 0 && along < BEAM_LEN * b) {
        const perp = Math.sqrt(Math.max(0, tmpV4.lengthSq() - along * along));
        if (perp < along * (BEAM_RADIUS / BEAM_LEN) + 4) k = Math.max(0.05, (along - 7) / BEAM_LEN);
      }
      mesh.scale.set(k, k, k);
    }

    class Searchlight extends Entity {
      constructor(x, z, o) {
        super();
        this.kind = 'searchlight';
        this.o = o || {};
        this.hp = 3;
        this.radius = 2.4;
        this.score = 200;
        this.ground = true;
        this.decor = !!this.o.decor;
        this.obj = TEMPLATES.searchlight.clone();
        this.obj.position.set(x, terrainHeight(x, z) - 0.2, z);
        this.lamp = this.obj.getObjectByName('lamp');
        this.centerOffset = 1.9;
        this.t = rand(0, 20);
        this.speed = rand(0.32, 0.55);
        this.baseYaw = this.o.yaw !== undefined ? this.o.yaw : (x < 0 ? 0.5 : -0.5);
        this.dir = new V3(0, 1, 0);
        this.locked = false;
        const mat = glowMat(0xc4d6ff, 0.0);
        mat.side = THREE.DoubleSide;
        mat.fog = false;
        this.beam = new THREE.Mesh(BEAM_GEO, mat);
        const core = new THREE.Mesh(BEAM_CORE_GEO, glowMat(0xe6eeff, 0.0));
        core.material.side = THREE.DoubleSide;
        core.material.fog = false;
        this.beam.add(core);
        this.core = core;
        this.beam.renderOrder = 5;
        scene.add(this.obj);
        scene.add(this.beam);
        this.updateCenter();
      }

      update(dt) {
        this.t += dt;
        this.updateCenter();
        const lamp = this.center;
        const canTrack = !this.decor && Player.alive && Level.phase !== 'start';
        if (this.o.track) {
          // Reflector decorativo que persigue a un objeto (cinemática)
          tmpV.copy(this.o.track.position).sub(lamp).normalize();
          this.dir.lerp(tmpV, 1 - Math.exp(-3 * dt)).normalize();
        } else if (this.locked && canTrack && !Player.gliding) {
          tmpV.copy(Player.wpos).sub(lamp).normalize();
          this.dir.lerp(tmpV, 1 - Math.exp(-5 * dt)).normalize();
        } else {
          this.locked = false;
          const lost = Player.gliding && !this.decor;
          const sp = lost ? this.speed * 2.6 : this.speed;
          // Barrido del cielo (cosmético)
          const yaw = this.baseYaw + Math.sin(this.t * sp) * 0.62;
          const elev = 0.9 + Math.sin(this.t * sp * 0.73 + 1.3) * 0.3;
          tmpV.set(Math.sin(yaw) * Math.cos(elev), Math.sin(elev), Math.cos(yaw) * Math.cos(elev));
          // Cerca de la jugadora el haz la "busca": el error se reduce con el
          // tiempo, así que quedarse quieta acaba en detección. Moverse rápido
          // o planear en silencio la hace desaparecer.
          if (!this.decor && canTrack) {
            const dist = lamp.distanceTo(Player.wpos);
            const inRange = dist < 175 && this.obj.position.z < Player.wpos.z + 10;
            if (lost || !inRange) this.searchA = 18;
            else this.searchA = Math.max(2.2, (this.searchA || 18) - dt * 4.5);
            const A = this.searchA;
            const ph = this.t * 1.7 + this.baseYaw * 5;
            tmpV2.set(
              Player.wpos.x + Math.sin(ph) * A,
              Player.wpos.y + Math.cos(ph * 0.8) * A * 0.55,
              Player.wpos.z - 4
            ).sub(lamp).normalize();
            const k = smoothstep(240, 140, dist) * (lost ? 0.25 : 1);
            tmpV.lerp(tmpV2, k).normalize();
          }
          this.dir.lerp(tmpV, 1 - Math.exp(-2.6 * dt)).normalize();
        }
        this.beam.position.copy(lamp);
        this.beam.quaternion.setFromUnitVectors(UP, this.dir);
        this.lamp.quaternion.copy(this.beam.quaternion);
        clipBeam(this.beam, lamp, this.dir, 1);
        // Aparición suave a través de la niebla
        const ahead = camera.position.z - this.obj.position.z;
        const near = smoothstep(4, 22, camera.position.distanceTo(lamp));
        const fade = smoothstep(280, 170, ahead) * (this.locked ? 1.5 : 1) * near;
        this.beam.material.opacity = 0.055 * fade;
        this.core.material.opacity = 0.06 * fade;
        // Detección de la jugadora
        if (canTrack && coneContains(lamp, this.dir, Player.wpos, BEAM_LEN, BEAM_RADIUS / BEAM_LEN, 1.2)) {
          if (!Player.gliding) {
            Game.litThisFrame = true;
            if (Game.detection >= 1) this.locked = true;
          }
        }
        if (this.locked && Player.gliding) this.locked = false;
        if (isBehindCamera(this.obj.position.z, 20)) this.gone = true;
      }

      explode() {
        FX.explosion(this.center, 1.3, { debris: COL.metal });
      }

      cleanup() {
        scene.remove(this.beam);
        this.beam.material.dispose();
        this.core.material.dispose();
      }
    }

    /* --- Cañón Flak --- */
    class FlakGun extends Entity {
      constructor(x, z) {
        super();
        this.kind = 'flak';
        this.hp = 4;
        this.radius = 2.8;
        this.score = 150;
        this.ground = true;
        this.obj = TEMPLATES.flak.clone();
        this.obj.position.set(x, terrainHeight(x, z) - 0.2, z);
        this.obj.rotation.y = x < 0 ? -0.4 : 0.4;
        this.gun = this.obj.getObjectByName('gun');
        this.centerOffset = 1.5;
        this.fireT = rand(1, 2.5);
        scene.add(this.obj);
        this.updateCenter();
      }

      update(dt) {
        this.updateCenter();
        const ahead = camera.position.z - this.obj.position.z;
        this.fireT -= dt;
        if (this.fireT <= 0 && Player.alive && ahead > 25 && ahead < 200 && Level.phase !== 'start') {
          this.fireT = (Game.detected ? rand(0.75, 1.1) : rand(2.6, 4.2)) / Game.diff.enemyFire;
          this.fire();
        }
        // Apunta el cañón hacia la jugadora
        tmpV.copy(Player.wpos).sub(this.center);
        this.gun.rotation.order = 'YXZ';
        this.gun.rotation.y = Math.atan2(-tmpV.x, -tmpV.z) - this.obj.rotation.y;
        this.gun.rotation.x = clamp(Math.atan2(tmpV.y, Math.hypot(tmpV.x, tmpV.z)), 0.2, 1.4);
        if (isBehindCamera(this.obj.position.z, 20)) this.gone = true;
      }

      fire() {
        const delay = rand(0.8, 1.05);
        const err = Player.gliding ? 15 : (Game.detected ? 2.2 : 9);
        const p = new V3(
          Player.wpos.x + Player.vel.x * delay * 0.6 + rand(-err, err),
          Math.max(3, Player.wpos.y + Player.vel.y * delay * 0.4 + rand(-err, err) * 0.6),
          Player.wpos.z - Game.railSpeed * delay + rand(-err, err) * 0.5
        );
        Game.scheduleFlak(p, delay);
        const m = tmpV2.copy(this.center);
        m.y += 1.2;
        tmpV.copy(p).sub(m).divideScalar(delay);
        FX.add.spawn(m.x, m.y, m.z, tmpV.x, tmpV.y, tmpV.z, delay, 0.22, 0.22, COL.tracer, COL.ember, 0, 0, 0.025);
        FX.add.spawn(m.x, m.y, m.z, 0, 2, 0, 0.1, 1.2, 0.2, COL.fire, COL.fireEnd, 0, 0);
        FX.light(m, 0xffaa60, 2.5, 0.15);
      }

      explode() {
        FX.explosion(this.center, 1.3, { debris: COL.metal });
      }
    }

    /* --- Torre de vigilancia con ametralladora --- */
    class Tower extends Entity {
      constructor(x, z) {
        super();
        this.kind = 'tower';
        this.hp = 4;
        this.radius = 2.8;
        this.score = 150;
        this.ground = true;
        this.obj = TEMPLATES.tower.clone();
        this.obj.position.set(x, terrainHeight(x, z) - 0.3, z);
        this.obj.rotation.y = rand(0, TAU);
        this.centerOffset = 8.4;
        this.fireT = rand(1, 2);
        this.burst = 0;
        this.burstT = 0;
        scene.add(this.obj);
        this.updateCenter();
      }

      update(dt) {
        this.updateCenter();
        const ahead = camera.position.z - this.obj.position.z;
        this.fireT -= dt;
        if (this.fireT <= 0 && Player.alive && ahead > 30 && ahead < 120 && Level.phase !== 'start') {
          this.fireT = rand(2, 2.8) / Game.diff.enemyFire;
          this.burst = 3;
        }
        if (this.burst > 0) {
          this.burstT -= dt;
          if (this.burstT <= 0) {
            this.burst--;
            this.burstT = 0.12;
            enemyShoot(tmpV4.copy(this.center).setY(this.center.y + 1), { speed: 52, accuracy: 0.8 });
          }
        }
        // Choque con la torre
        const p = Player.wpos;
        const b = this.obj.position;
        if (Player.alive && Math.abs(p.x - b.x) < 2.6 && Math.abs(p.z - b.z) < 2.6 && p.y < b.y + 10.6) {
          Player.hurt(16, 'crash');
          this.destroy(true);
        }
        if (isBehindCamera(this.obj.position.z, 20)) this.gone = true;
      }

      explode() {
        FX.explosion(this.center, 1.4, { debris: COL.wood });
      }
    }

    /* --- Tanque de combustible (objetivo del depósito) --- */
    class FuelTank extends Entity {
      constructor(x, z) {
        super();
        this.kind = 'fuel';
        this.hp = 6;
        this.radius = 3.2;
        this.score = 300;
        this.ground = true;
        this.obj = TEMPLATES.fuel.clone();
        this.obj.position.set(x, terrainHeight(x, z) - 0.2, z);
        this.centerOffset = 2.4;
        scene.add(this.obj);
        this.updateCenter();
      }

      update() {
        this.updateCenter();
        // Choque contra el tanque
        const p = Player.wpos;
        const b = this.obj.position;
        if (Player.alive && Math.abs(p.x - b.x) < 2.8 && Math.abs(p.z - b.z) < 2.8 && p.y < b.y + 5.2) {
          Player.hurt(12, 'crash');
          this.destroy(true);
        }
        if (isBehindCamera(this.obj.position.z, 20)) this.gone = true;
      }

      explode() {
        FX.explosion(this.center, 2.4, { debris: COL.metal });
        for (let i = 0; i < 10; i++) {
          FX.add.spawn(this.center.x + rand(-1.5, 1.5), this.center.y, this.center.z + rand(-1.5, 1.5), rand(-1, 1), rand(10, 22), rand(-1, 1), rand(0.6, 1.1), rand(1.5, 2.6), 0.3, COL.fire, COL.fireEnd, 4, 1);
        }
        FX.flash = Math.max(FX.flash, 0.25);
        // Reacción en cadena
        const c = this.center.clone();
        Game.later(0.25, () => {
          entities.forEach((e) => {
            if (e !== this && e.alive && e.kind === 'fuel' && e.center.distanceTo(c) < 14) e.hit(6, e.center);
          });
        });
        Level.onFuelDestroyed();
      }
    }

    /* --- Caja de suministros --- */
    class Crate extends Entity {
      constructor(kind, x, y, z) {
        super();
        this.kind = 'crate';
        this.type = kind;
        this.targetable = false;
        this.friendly = true;
        this.obj = (kind === 'repair' ? TEMPLATES.crateRepair : TEMPLATES.crateBomb).clone();
        this.obj.position.set(x, y, z);
        this.ring = this.obj.getObjectByName('ring');
        this.t = rand(0, 5);
        this.baseX = x;
        scene.add(this.obj);
        this.updateCenter();
      }

      update(dt) {
        this.t += dt;
        this.obj.position.y -= 0.8 * dt;
        this.obj.position.x = this.baseX + Math.sin(this.t * 0.9) * 1.2;
        this.obj.rotation.z = Math.sin(this.t * 0.9) * 0.12;
        this.ring.rotation.y += dt * 3;
        const s = 1 + Math.sin(this.t * 6) * 0.12;
        this.ring.scale.set(s, s, s);
        this.updateCenter();
        if (Player.alive && this.center.distanceTo(Player.wpos) < 3.8) this.collect();
        if (isBehindCamera(this.obj.position.z, 10) || this.obj.position.y < -2) this.gone = true;
      }

      collect() {
        this.gone = true;
        this.alive = false;
        sound.pickup();
        FX.sparks(this.center, 14, this.type === 'repair' ? COL.green : COL.red);
        Game.addScore(100);
        if (this.type === 'repair') {
          Player.heal(30);
          UI.banner('+30 LONA Y MADERA', 'good');
        } else {
          Player.bombs = Math.min(9, Player.bombs + 2);
          UI.banner('+2 COHETES RS-82', 'good');
        }
      }
    }

    /* --- Mina aérea --- */
    class Mine extends Entity {
      constructor(pos, vel) {
        super();
        this.kind = 'mine';
        this.hp = 2;
        this.radius = 1.7;
        this.score = 50;
        this.obj = TEMPLATES.mine.clone();
        this.obj.position.copy(pos);
        this.blink = this.obj.getObjectByName('blink');
        this.v = vel.clone();
        this.t = rand(0, 1);
        scene.add(this.obj);
        this.updateCenter();
      }

      update(dt) {
        this.t += dt;
        const p = this.obj.position;
        this.v.multiplyScalar(Math.exp(-1.2 * dt));
        this.v.x += clamp(Player.wpos.x - p.x, -1, 1) * 2.4 * dt;
        this.v.y += clamp(Player.wpos.y - p.y, -1, 1) * 2.0 * dt;
        p.addScaledVector(this.v, dt);
        this.obj.rotation.x += dt * 0.8;
        this.obj.rotation.y += dt * 1.1;
        const on = Math.floor(this.t * 3) % 2 === 0;
        if (this.blink.visible !== on) {
          this.blink.visible = on;
          if (on) sound.mineBeep(p.distanceTo(Player.wpos));
        }
        this.updateCenter();
        if (Player.alive && this.center.distanceTo(Player.wpos) < 2.9) {
          this.destroy(false);
          Player.hurt(15, 'mine');
        }
        if (isBehindCamera(p.z, 6)) this.gone = true;
      }

      explode() {
        FX.explosion(this.center, 1.2, { debris: COL.metal });
      }
    }

    /* --- Bomba de racimo del jefe --- */
    class ClusterBomb extends Entity {
      constructor(pos, target) {
        super();
        this.kind = 'cluster';
        this.hp = 1;
        this.radius = 1.6;
        this.score = 40;
        this.obj = TEMPLATES.cluster.clone();
        this.obj.position.copy(pos);
        this.v = target.clone().sub(pos).normalize().multiplyScalar(26);
        this.t = 0;
        this.fuse = rand(1.3, 1.6);
        scene.add(this.obj);
        this.updateCenter();
      }

      update(dt) {
        this.t += dt;
        this.v.y -= 3 * dt;
        this.obj.position.addScaledVector(this.v, dt);
        orientQuat(this.obj.quaternion, tmpV.copy(this.v).normalize(), this.t * 4);
        this.updateCenter();
        if (this.t > this.fuse || this.center.distanceTo(Player.wpos) < 8) this.burst();
        if (isBehindCamera(this.obj.position.z, 6)) this.gone = true;
      }

      burst() {
        if (!this.alive) return;
        this.alive = false;
        this.gone = true;
        FX.explosion(this.center, 1);
        if (this.center.distanceTo(Player.wpos) < 5) Player.hurt(10, 'flak');
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          enemyShootDir(this.center, tmpV.set(Math.cos(a), Math.sin(a), 1.1), 30, 6);
        }
      }
    }

    /* ====================================================================
       13. JEFE FINAL: ZEPPELIN BLINDADO «WALKÜRE»
       Puntos débiles: 4 motores → góndola de artillería → compartimento
       de bombas. Lanza minas, cortinas de balas y bombas de racimo.
       ==================================================================== */
    const Boss = {
      built: false,
      active: false,
      state: 'off',
      phase: 1,
      rel: new V3(),
      t: 0,

      build() {
        const z = this.m = buildZeppelin();
        this.root = z.root;
        this.doorL = z.bay.getObjectByName('doorL');
        this.doorR = z.bay.getObjectByName('doorR');
        this.bayGlow = z.bay.getObjectByName('bayglow');
        this.nav = z.root.getObjectByName('nav');
        const beamMat = glowMat(0xffe8c4, 0.06);
        beamMat.side = THREE.DoubleSide;
        beamMat.fog = false;
        this.beam = new THREE.Mesh(BEAM_GEO, beamMat);
        this.beam.scale.set(0.5, 0.5, 0.5);
        this.beamDir = new V3(0, -0.4, 1).normalize();
        const collect = (node) => {
          const list = [];
          node.traverse((o) => { if (o.isMesh) list.push({ mesh: o, mat: o.material }); });
          return list;
        };
        this.parts = z.engines.map((g, i) => ({
          name: 'MOTOR ' + (i + 1),
          kind: 'engine',
          node: g,
          prop: g.getObjectByName('prop'),
          fx: g.getObjectByName('fx'),
          max: 22,
          meshes: collect(g),
          spheres: [{ local: new V3(0, 0, 0), r: 2.7, world: new V3() }, { local: new V3(1.8, 0, 0), r: 2.2, world: new V3() }]
        }));
        this.parts.push({
          name: 'GÓNDOLA DE ARTILLERÍA',
          kind: 'gondola',
          node: z.gondola,
          max: 55,
          meshes: collect(z.gondola),
          spheres: [-3.5, 0, 3.5].map((x) => ({ local: new V3(x, 0, 0.4), r: 2.5, world: new V3() }))
        });
        this.parts.push({
          name: 'COMPARTIMENTO DE BOMBAS',
          kind: 'bay',
          node: z.bay,
          max: 70,
          meshes: collect(z.bay),
          spheres: [-2.2, 2.2].map((x) => ({ local: new V3(x, -0.6, 0), r: 2.8, world: new V3() }))
        });
        this.maxHp = this.parts.reduce((s, p) => s + p.max, 0);
        this.built = true;
      },

      start() {
        if (!this.built) this.build();
        this.restoreHull();
        scene.add(this.root);
        scene.add(this.beam);
        this.parts.forEach((p) => {
          p.hp = p.max;
          p.alive = true;
          p.meshes.forEach((m) => { m.mesh.material = m.mat; });
          if (p.prop) p.prop.visible = true;
          if (p.fx) p.fx.visible = true;
        });
        this.rel.set(0, 48, -150);
        this.t = 0;
        this.phase = 1;
        this.state = 'reveal';
        this.timers = { turret: 2.5, mine: 3.5, curtain: 2.5, spiral: 3, cluster: 3 };
        this.spiralT = 0;
        this.spiralAcc = 0;
        this.spiralAngle = 0;
        this.doorOpen = 0;
        this.sinking = 0;
        this.deathT = 0;
        this.blastT = 0;
        this.finalDone = false;
        this.bayGlow.visible = false;
        this.root.visible = true;
        this.root.rotation.set(0, 0, 0);
        this.active = true;
        this.updateTransform();
      },

      remove() {
        if (!this.built) return;
        scene.remove(this.root);
        scene.remove(this.beam);
        this.active = false;
        this.state = 'off';
        sound.setDrone(0);
      },

      hpFraction() {
        if (!this.built) return 1;
        return this.parts.reduce((s, p) => s + Math.max(0, p.hp), 0) / this.maxHp;
      },

      vulnerable(p) {
        if (!p.alive || this.state !== 'fight') return false;
        return (p.kind === 'engine' && this.phase === 1) || (p.kind === 'gondola' && this.phase === 2) || (p.kind === 'bay' && this.phase === 3);
      },

      updateTransform() {
        this.root.position.set(this.rel.x, this.rel.y, Game.railZ + this.rel.z);
        this.root.updateMatrixWorld(true);
        this.parts.forEach((p) => p.spheres.forEach((s) => {
          s.world.copy(s.local);
          p.node.localToWorld(s.world);
        }));
      },

      world(local) {
        return this.root.localToWorld(local);
      },

      hullContains(point, margin) {
        tmpV4.copy(point);
        this.root.worldToLocal(tmpV4);
        const L = this.m.L + (margin || 0);
        const R = this.m.R + (margin || 0);
        return (tmpV4.x * tmpV4.x) / (L * L) + (tmpV4.y * tmpV4.y) / (R * R) + (tmpV4.z * tmpV4.z) / (R * R) < 1;
      },

      update(dt) {
        if (!this.active) return;
        this.t += dt;
        const T = this.t;
        if (this.state === 'reveal') {
          this.rel.x = damp(this.rel.x, 0, 1, dt);
          this.rel.y = damp(this.rel.y, 12.5, 0.9, dt);
          this.rel.z = damp(this.rel.z, -62, 0.8, dt);
          if (T > 5.2) {
            this.state = 'fight';
            this.t = 0;
          }
        } else if (this.state === 'fight') {
          const zBase = this.phase === 3 ? -50 : -60;
          this.rel.x = damp(this.rel.x, Math.sin(T * 0.33) * 8, 1.2, dt);
          this.rel.y = damp(this.rel.y, 12.5 + Math.sin(T * 0.5) * 2 - (this.phase - 1) * 0.8, 1.2, dt);
          this.rel.z = damp(this.rel.z, zBase + Math.sin(T * 0.27) * 6, 1, dt);
          this.attacks(dt);
          this.collidePlayer();
        } else if (this.state === 'dying') {
          this.updateDeath(dt);
        } else if (this.state === 'wreck') {
          this.sinking += dt * 0.5;
          this.rel.y -= dt * (2 + this.sinking * 3);
          this.rel.z -= dt * 6;
          if (Math.random() < 0.6) FX.firePuff(this.world(tmpV.set(rand(-24, 24), rand(-3, 5), rand(-5, 5))), rand(1.5, 3));
          if (Math.random() < 0.5) FX.smokePuff(this.world(tmpV.set(rand(-24, 24), rand(0, 6), rand(-5, 5))), rand(3, 5), 2.5);
          if (this.rel.y < -30) this.remove();
        }
        if (!this.active) return;
        const list = (this.phase - 1) * 0.045;
        this.root.rotation.y = Math.sin(T * 0.4) * 0.1;
        this.root.rotation.z = Math.sin(T * 0.55) * 0.03 + list + this.sinking * 0.3;
        this.root.rotation.x = Math.sin(T * 0.37) * 0.02;
        this.updateTransform();
        // Hélices, humo de motores destruidos y luces
        this.parts.forEach((p) => {
          if (p.kind !== 'engine') return;
          if (p.alive) p.prop.rotation.x += 16 * dt;
          else if (Math.random() < 0.55) {
            FX.smokePuff(p.spheres[0].world, 1.8, 2);
            if (Math.random() < 0.5) FX.firePuff(p.spheres[0].world, 1.2);
          }
        });
        this.nav.visible = Math.floor(T * 2.2) % 2 === 0;
        this.doorOpen = damp(this.doorOpen, this.phase === 3 && this.state === 'fight' ? 1 : 0, 2, dt);
        this.doorL.rotation.z = -this.doorOpen * 1.3;
        this.doorR.rotation.z = this.doorOpen * 1.3;
        this.bayGlow.visible = this.doorOpen > 0.15;
        // Reflector de la góndola
        const g = this.parts[4];
        const front = g.node.localToWorld(tmpV.set(-5.8, -0.6, 1.2));
        this.beam.position.copy(front);
        tmpV2.set(Math.sin(T * 0.7) * 0.5, -0.35 + Math.sin(T * 0.9) * 0.2, 1).normalize();
        if (Player.alive && !Player.gliding && this.state === 'fight') {
          tmpV3.copy(Player.wpos).sub(front).normalize();
          tmpV2.lerp(tmpV3, 0.55).normalize();
        }
        this.beamDir.lerp(tmpV2, 1 - Math.exp(-2 * dt)).normalize();
        this.beam.quaternion.setFromUnitVectors(UP, this.beamDir);
        clipBeam(this.beam, front, this.beamDir, 0.5);
        this.beam.visible = g.alive && this.state !== 'wreck';
        sound.setDrone(this.state === 'fight' || this.state === 'reveal' ? 1 : 0.4);
      },

      attacks(dt) {
        const tm = this.timers;
        const rate = Game.diff.enemyFire;
        // Torretas dorsales y cañones laterales
        tm.turret -= dt * rate;
        if (tm.turret <= 0) {
          tm.turret = this.phase === 1 ? 2.2 : 1.8;
          const above = Player.wpos.y > this.root.position.y + 4;
          this.m.turrets.forEach((loc, i) => {
            if (i < 2 && !above && Math.random() < 0.65) return;
            const from = this.world(tmpV.copy(loc)).clone();
            enemyShoot(from, { speed: 46 });
            Game.later(0.16, () => { if (this.state === 'fight') enemyShoot(from, { speed: 46 }); });
          });
        }
        // Minas aéreas flotantes
        tm.mine -= dt * rate;
        if (tm.mine <= 0) {
          tm.mine = this.phase === 1 ? 4.4 : 5.4;
          const n = this.phase === 3 ? 3 : 2;
          for (let i = 0; i < n; i++) {
            const from = this.world(tmpV.set(rand(-18, 18), -5.5, 4)).clone();
            addEntity(new Mine(from, new V3(rand(-4, 4), rand(-3, 1), rand(6, 12))));
          }
        }
        // Cortinas de balas desde la góndola
        if (this.phase >= 2) {
          tm.curtain -= dt * rate;
          if (tm.curtain <= 0) {
            tm.curtain = this.phase === 2 ? 2.4 : 3.2;
            this.curtainFlip = !this.curtainFlip;
            this.curtain(this.curtainFlip);
          }
        }
        // Espiral y racimos desde el compartimento de bombas
        if (this.phase === 3) {
          tm.spiral -= dt * rate;
          if (tm.spiral <= 0) {
            tm.spiral = 5;
            this.spiralT = 2.2;
          }
          if (this.spiralT > 0) {
            this.spiralT -= dt;
            this.spiralAcc += dt;
            const from = this.parts[5].spheres[0].world;
            while (this.spiralAcc > 0.075) {
              this.spiralAcc -= 0.075;
              this.spiralAngle += 0.55;
              const a = this.spiralAngle;
              enemyShootDir(from, tmpV.set(Math.cos(a) * 0.75, Math.sin(a) * 0.5 - 0.05, 1), 34, 6);
              enemyShootDir(from, tmpV.set(-Math.cos(a) * 0.75, -Math.sin(a) * 0.5 - 0.05, 1), 34, 6);
            }
          }
          tm.cluster -= dt * rate;
          if (tm.cluster <= 0) {
            tm.cluster = 3.3;
            const from = this.parts[5].spheres[1].world.clone();
            const target = Player.wpos.clone();
            target.z -= Game.railSpeed * 1.2;
            addEntity(new ClusterBomb(from, target));
          }
        }
      },

      curtain(vertical) {
        if (!Player.alive) return;
        const from = this.parts[4].node.localToWorld(tmpV.set(-1, -0.8, 2.4)).clone();
        const target = Player.wpos.clone();
        target.z -= Game.railSpeed * 1.1;
        const dir = target.sub(from).normalize();
        const axis = vertical ? tmpV2.crossVectors(dir, UP).normalize() : UP;
        for (let i = -4; i <= 4; i++) {
          tmpQ.setFromAxisAngle(axis, i * 0.085);
          tmpV3.copy(dir).applyQuaternion(tmpQ);
          enemyShootDir(from, tmpV3, 40, 6);
        }
        FX.light(from, 0xffaa60, 3, 0.2);
        sound.enemyGun(from.distanceTo(camera.position) * 0.5, 0);
      },

      collidePlayer() {
        if (!Player.alive || Player.invuln > 0) return;
        if (this.hullContains(Player.wpos, 1)) {
          Player.hurt(18, 'crash');
          Player.vel.y += Player.wpos.y > this.root.position.y ? 14 : -14;
        }
      },

      /* Impactos de bala: 'hit' si daña, 'armor' si rebota, null si no toca */
      bulletTest(a, b) {
        if (!this.active || (this.state !== 'fight' && this.state !== 'reveal')) return null;
        for (let i = 0; i < this.parts.length; i++) {
          const p = this.parts[i];
          if (!p.alive) continue;
          for (let k = 0; k < p.spheres.length; k++) {
            const s = p.spheres[k];
            if (segSphere(a, b, s.world, s.r)) {
              if (this.vulnerable(p)) {
                this.damagePart(p, 1, b);
                return 'hit';
              }
              FX.sparks(b, 2, COL.blue);
              sound.armor();
              UI.armorHint(p);
              return 'armor';
            }
          }
        }
        if (this.hullContains(b, 0)) {
          FX.sparks(b, 2, COL.blue);
          sound.armor();
          return 'armor';
        }
        return null;
      },

      damagePart(p, dmg, point) {
        if (!p.alive) return;
        p.hp -= dmg;
        if (point) FX.sparks(point, 3);
        sound.hitTink();
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          this.destroyPart(p);
        }
      },

      destroyPart(p) {
        const c = p.spheres[Math.floor(p.spheres.length / 2)].world;
        FX.explosion(c, 2.2);
        FX.flash = Math.max(FX.flash, 0.3);
        Game.addScore(1000);
        Game.kills++;
        UI.popHits();
        UI.banner(p.name + ' DESTRUIDO', 'good');
        p.meshes.forEach((m) => { if (m.mat !== MAT.bayGlow) m.mesh.material = MAT.burnt; });
        if (p.prop) p.prop.visible = false;
        if (p.fx) p.fx.visible = false;
        if (this.phase === 1 && this.parts.every((q) => q.kind !== 'engine' || !q.alive)) {
          this.phase = 2;
          Comms.say('raskova', '¡Ha perdido los motores! Ahora la góndola de artillería, ¡bajo el casco!', { urgent: true });
        } else if (p.kind === 'gondola') {
          this.phase = 3;
          UI.banner('¡COMPARTIMENTO DE BOMBAS ABIERTO!', 'bad');
          Comms.say('bersh', '¡Abre las compuertas! ¡Dispara al compartimento de bombas, al centro!', { urgent: true });
        } else if (p.kind === 'bay') {
          this.die();
        }
      },

      /* Daño en área (cohetes y bombas pesadas) */
      areaDamage(center, radius, dmg, direct) {
        if (!this.active || this.state !== 'fight') return;
        let any = false;
        this.parts.forEach((p) => {
          if (!this.vulnerable(p)) return;
          let best = Infinity;
          p.spheres.forEach((s) => { best = Math.min(best, s.world.distanceTo(center) - s.r); });
          if (best < radius) {
            this.damagePart(p, dmg, null);
            any = true;
          }
        });
        if (!any && direct) {
          let target = null;
          let bestD = Infinity;
          this.parts.forEach((p) => {
            if (!this.vulnerable(p)) return;
            const d = p.spheres[0].world.distanceTo(center);
            if (d < bestD) { bestD = d; target = p; }
          });
          if (target) {
            this.damagePart(target, direct, null);
            UI.banner('¡IMPACTO ESTRUCTURAL!', 'good');
          }
        }
      },

      die() {
        this.state = 'dying';
        this.deathT = 0;
        this.blastT = 0;
        Game.addScore(5000);
        Level.onBossDefeated();
      },

      updateDeath(dt) {
        this.deathT += dt;
        this.blastT -= dt;
        this.sinking += dt * 0.25;
        this.rel.y -= dt * 1.5;
        if (this.blastT <= 0) {
          this.blastT = 0.11;
          tmpV.set(rand(-1, 1), rand(-1, 1), rand(-0.2, 1)).normalize();
          tmpV.set(tmpV.x * this.m.L * 0.92, tmpV.y * this.m.R, tmpV.z * this.m.R);
          FX.explosion(this.world(tmpV).clone(), rand(1.5, 2.6));
        }
        if (this.deathT > 1.7 && !this.finalDone) {
          this.finalDone = true;
          for (let i = 0; i < 7; i++) {
            FX.explosion(this.world(tmpV.set(-24 + i * 8, rand(-3, 3), rand(-2, 4))).clone(), 3.5);
          }
          FX.flash = 1;
          FX.addShake(1.5);
          this.parts.forEach((p) => p.meshes.forEach((m) => { m.mesh.material = MAT.burnt; }));
          this.m.hull.traverse((o) => { if (o.isMesh) o.material = MAT.burnt; });
          this.state = 'wreck';
          Level.onBossFinal();
        }
      },

      restoreHull() {
        if (!this.built) return;
        if (!this.hullMats) {
          this.hullMats = [];
          this.m.hull.traverse((o) => { if (o.isMesh) this.hullMats.push({ mesh: o, mat: o.material }); });
        }
        this.hullMats.forEach((h) => { h.mesh.material = h.mat; });
      }
    };

    /* ====================================================================
       14. JUGADORA: POLIKARPOV Po-2
       ==================================================================== */
    const PlayerBullets = new BulletPool(new THREE.BoxGeometry(0.14, 0.14, 2.6), new THREE.MeshBasicMaterial({ color: 0xffcf6a, fog: false }), 140);
    const EnemyBullets = new BulletPool(new THREE.OctahedronGeometry(0.34, 0), new THREE.MeshBasicMaterial({ color: 0xff5a2e, fog: false }), 420);
    EnemyBullets.dummy.scale.set(1, 1, 2.4);

    const BULLET_SPEED = 175;
    const tmpE = new THREE.Euler();

    const Player = {
      pos: new THREE.Vector2(0, 9),
      vel: new THREE.Vector2(),
      input: new THREE.Vector2(),
      wpos: new V3(0, 9, 0),
      aim: new V3(0, 0, -1),
      aimTarget: new V3(0, 0, -1),
      lockDir: new V3(0, 0, -1),
      locked: false,
      aimPitch: 0,
      aimYaw: 0,
      bank: 0,
      hp: 100,
      maxHp: 100,
      bombs: 3,
      heavyArmed: false,
      glide: 1,
      gliding: false,
      glideDelay: 0,
      rolling: false,
      rollT: 0,
      rollDir: 1,
      rollCd: 0,
      rollAngle: 0,
      looping: false,
      loopT: 0,
      loopAngle: 0,
      loopCd: 0,
      loopOffset: new V3(),
      fireCd: 0,
      gunSide: 1,
      recoil: 0,
      invuln: 0,
      alive: true,
      control: false,
      autoCenter: false,
      dying: false,
      deathT: 0,
      propSpeed: 40,
      bossBounds: false,

      init() {
        this.obj = TEMPLATES.po2.clone();
        this.prop = this.obj.getObjectByName('prop');
        this.disc = this.obj.getObjectByName('disc');
        this.exhaust = this.obj.getObjectByName('exhaust');
        scene.add(this.obj);
        this.muzzleLight = new THREE.PointLight(0xffc070, 0, 22, 2);
        scene.add(this.muzzleLight);
        // Luz de relleno "lunar" para que el Po-2 se lea siempre en la noche
        this.fill = new THREE.PointLight(0xa8b8ff, 0.9, 16, 1.5);
        scene.add(this.fill);
        const ringMat = glowMat(0xff4a2a, 0.9);
        ringMat.side = THREE.DoubleSide;
        ringMat.fog = false;
        this.marker = new THREE.Mesh(new THREE.RingGeometry(3.2, 4.6, 18).rotateX(-Math.PI / 2), ringMat);
        const pillarMat = glowMat(0xff6a3a, 0.22);
        pillarMat.side = THREE.DoubleSide;
        pillarMat.fog = false;
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 14, 6, 1, true).translate(0, 7, 0), pillarMat);
        this.marker.add(pillar);
        this.marker.visible = false;
        scene.add(this.marker);
      },

      reset() {
        this.pos.set(0, 9);
        this.vel.set(0, 0);
        this.aim.set(0, 0, -1);
        this.aimTarget.set(0, 0, -1);
        this.aimPitch = this.aimYaw = this.bank = 0;
        this.hp = this.maxHp;
        this.bombs = 3;
        this.heavyArmed = false;
        this.glide = 1;
        this.gliding = false;
        this.glideDelay = 0;
        this.rolling = false;
        this.rollAngle = 0;
        this.rollCd = 0;
        this.looping = false;
        this.loopAngle = 0;
        this.loopCd = 0;
        this.loopOffset.set(0, 0, 0);
        this.fireCd = 0;
        this.recoil = 0;
        this.invuln = 0;
        this.alive = true;
        this.control = false;
        this.autoCenter = false;
        this.dying = false;
        this.deathT = 0;
        this.bossBounds = false;
        this.obj.visible = true;
        this.marker.visible = false;
        this.updateWorld();
      },

      bounds() {
        return { x: 15, yMin: 2.6, yMax: this.bossBounds ? 23 : 17 };
      },

      updateWorld() {
        this.wpos.set(this.pos.x + this.loopOffset.x, this.pos.y + this.loopOffset.y, Game.railZ + this.loopOffset.z);
      },

      update(dt) {
        if (this.dying) {
          this.updateDying(dt);
          return;
        }
        if (!this.alive) {
          // Derribada: el biplano ya no se dibuja
          this.obj.visible = false;
          this.marker.visible = false;
          return;
        }
        const B = this.bounds();
        let ix = 0;
        let iy = 0;
        const mouseMode = Settings.data.control === 'mouse';
        if (this.control && this.alive) {
          if (mouseMode) {
            const tx = Input.mouse.x * B.x * 1.1;
            const ty = lerp(B.yMin, B.yMax, Input.mouse.y * 0.5 + 0.5);
            ix = clamp((tx - this.pos.x) / 3.5, -1, 1);
            iy = clamp((ty - this.pos.y) / 3.0, -1, 1);
          } else {
            ix = (Input.held('right') ? 1 : 0) - (Input.held('left') ? 1 : 0);
            iy = (Input.held('up') ? 1 : 0) - (Input.held('down') ? 1 : 0);
            if (Settings.data.invertY) iy = -iy;
          }
        } else if (this.autoCenter) {
          ix = clamp(-this.pos.x / 5, -1, 1) * 0.6;
          iy = clamp((9 - this.pos.y) / 5, -1, 1) * 0.6;
        }
        this.input.set(ix, iy);

        // Velocidad con inercia (más torpe en planeo)
        const maxX = this.gliding ? 17 : 21;
        const maxY = this.gliding ? 12 : 15;
        let ty = iy * maxY;
        if (this.gliding && iy < 0.1) ty = Math.min(ty, -2.4);
        this.vel.x = damp(this.vel.x, ix * maxX, 6.5, dt);
        this.vel.y = damp(this.vel.y, ty, 6.5, dt);

        // Tonel volado
        if (this.rolling) {
          this.rollT += dt;
          const k = this.rollT / 0.55;
          this.rollAngle = this.rollDir * easeInOut(clamp(k, 0, 1)) * TAU;
          if (k < 0.8) this.pos.x += this.rollDir * 12 * dt;
          if (k >= 1) {
            this.rolling = false;
            this.rollAngle = 0;
            this.rollCd = 0.25;
          }
        } else {
          this.rollCd = Math.max(0, this.rollCd - dt);
        }

        this.pos.x += this.vel.x * dt;
        this.pos.y += this.vel.y * dt;
        if (this.pos.x < -B.x) { this.pos.x = -B.x; if (this.vel.x < 0) this.vel.x = 0; }
        if (this.pos.x > B.x) { this.pos.x = B.x; if (this.vel.x > 0) this.vel.x = 0; }
        if (this.pos.y < B.yMin) { this.pos.y = B.yMin; if (this.vel.y < 0) this.vel.y = 0; }
        if (this.pos.y > B.yMax) { this.pos.y = B.yMax; if (this.vel.y > 0) this.vel.y = 0; }

        // Looping evasivo (círculo vertical relativo al riel)
        if (this.looping) {
          this.loopT += dt / 1.75;
          const th = easeInOut(clamp(this.loopT, 0, 1)) * TAU;
          this.loopAngle = th;
          this.loopOffset.set(0, 5.5 * (1 - Math.cos(th)), -5.5 * Math.sin(th));
          if (this.loopT >= 1) {
            this.looping = false;
            this.loopAngle = 0;
            this.loopOffset.set(0, 0, 0);
            this.loopCd = 0.8;
          }
        } else {
          this.loopCd = Math.max(0, this.loopCd - dt);
        }
        this.updateWorld();

        // Dirección de apuntado (doble retícula)
        if (mouseMode && this.control) {
          const m = Post.toSource(Input.mouse.x, Input.mouse.y);
          tmpV.set(m.x, m.y, 0.5).unproject(camera).sub(camera.position).normalize();
          const planeZ = this.wpos.z - 46;
          const t = (planeZ - camera.position.z) / Math.min(-0.05, tmpV.z);
          tmpV2.copy(camera.position).addScaledVector(tmpV, t);
          this.aimTarget.copy(tmpV2).sub(this.wpos).normalize();
          if (this.aimTarget.z > -0.55) {
            this.aimTarget.z = -0.55;
            this.aimTarget.normalize();
          }
        } else {
          const ap = clamp(iy * 0.34 + (this.vel.y / 15) * 0.06, -0.45, 0.45);
          const ay = clamp(-ix * 0.3 - (this.vel.x / 21) * 0.05, -0.45, 0.45);
          this.aimPitch = damp(this.aimPitch, ap, 7, dt);
          this.aimYaw = damp(this.aimYaw, ay, 7, dt);
          tmpE.set(this.aimPitch, this.aimYaw, 0, 'YXZ');
          this.aimTarget.set(0, 0, -1).applyEuler(tmpE);
        }
        this.aim.lerp(this.aimTarget, 1 - Math.exp(-14 * dt)).normalize();
        this.locked = this.control && this.findLock();

        // Orientación visual: morro hacia la retícula + alabeo
        this.bank = damp(this.bank, clamp((-this.vel.x / 21) * 0.95, -1.1, 1.1), 6, dt);
        if (this.looping) {
          orientQuat(this.obj.quaternion, tmpV.set(0, 0, -1), this.bank * 0.3, this.loopAngle);
        } else {
          tmpV.copy(this.aim).lerp(tmpV2.set(0, 0, -1), 0.25).normalize();
          orientQuat(this.obj.quaternion, tmpV, this.bank + this.rollAngle, 0);
        }
        this.recoil = damp(this.recoil, 0, 18, dt);
        this.obj.position.copy(this.wpos).addScaledVector(this.aim, -this.recoil);
        this.obj.position.y += Math.sin(Game.time * 2.1) * 0.05;
        this.fill.position.set(this.wpos.x - 2, this.wpos.y + 4, this.wpos.z + 5);
        // Parpadeo tras recibir daño
        this.invuln = Math.max(0, this.invuln - dt);
        this.obj.visible = this.invuln <= 0 || Math.floor(this.invuln * 20) % 2 === 0;

        // Modo Planeo Silencioso
        if (this.gliding) {
          this.glide -= dt / 6.5;
          if (this.glide <= 0) {
            this.glide = 0;
            this.endGlide(true);
          }
          if (Math.random() < 0.8) {
            const side = Math.random() < 0.5 ? -1 : 1;
            FX.windStreak(this.obj.localToWorld(tmpV.set(side * rand(1.2, 2.3), rand(-0.2, 0.9), rand(-0.6, 0.2))));
          }
        } else {
          this.glideDelay -= dt;
          if (this.glideDelay <= 0) this.glide = Math.min(1, this.glide + dt / 9);
        }

        // Hélice, escapes y sonido del motor
        this.propSpeed = damp(this.propSpeed, this.gliding ? 0 : 42, this.gliding ? 1.4 : 3, dt);
        this.prop.rotation.z += this.propSpeed * dt;
        this.disc.visible = this.propSpeed > 20;
        this.exhaust.visible = !this.gliding;
        if (this.control || this.autoCenter) {
          sound.setEngine(this.gliding ? 0 : 1, 1 + (this.vel.y / 15) * 0.1 + (this.rolling ? 0.12 : 0), this.gliding ? 0.5 : 0.12);
          sound.setWind(this.gliding ? 1 : 0.16);
        }

        // Armas
        this.fireCd -= dt;
        const wantsFire = mouseMode ? Input.mouse.left : Input.held('fire');
        if (this.control && wantsFire && this.fireCd <= 0 && !this.looping) this.fire();
        this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 25, dt);
        this.updateMarker();

        // Humo si el biplano está dañado
        if (this.hp < 40 && Math.random() < (40 - this.hp) / 60) {
          FX.smokePuff(this.obj.localToWorld(tmpV.set(0, 0.1, -0.9)), 0.6, 1.1);
        }
      },

      findLock() {
        let found = false;
        let bestAng = 0.065;
        const from = this.wpos;
        const test = (c, vx, vy, vz) => {
          tmpV.copy(c).sub(from);
          const dist = tmpV.length();
          if (dist < 6 || dist > 180) return;
          const t = dist / BULLET_SPEED;
          tmpV.x += vx * t;
          tmpV.y += vy * t;
          tmpV.z += (vz + Game.railSpeed) * t;
          tmpV.normalize();
          const ang = Math.acos(clamp(tmpV.dot(this.aim), -1, 1));
          if (ang < bestAng) {
            bestAng = ang;
            found = true;
            this.lockDir.copy(tmpV);
          }
        };
        for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (!e.alive || !e.targetable || e.friendly) continue;
          test(e.center, e.vel.x, e.vel.y, e.vel.z);
        }
        if (Boss.active && Boss.state === 'fight') {
          Boss.parts.forEach((p) => {
            if (!Boss.vulnerable(p)) return;
            p.spheres.forEach((s) => test(s.world, 0, 0, -Game.railSpeed));
          });
        }
        return found;
      },

      nose(out) {
        return out.copy(this.wpos).addScaledVector(this.aim, 1.8);
      },

      fire() {
        this.fireCd = 1 / 12;
        this.gunSide = -this.gunSide;
        const n = this.nose(tmpV3);
        tmpV2.crossVectors(this.aim, UP).normalize();
        n.addScaledVector(tmpV2, this.gunSide * 0.32);
        const dir = this.locked ? this.lockDir : this.aim;
        tmpV.copy(dir).multiplyScalar(BULLET_SPEED);
        tmpV.z -= Game.railSpeed;
        PlayerBullets.spawn(n, tmpV, 1.0, 1);
        FX.muzzle(n, dir);
        this.muzzleLight.position.copy(n);
        this.muzzleLight.intensity = 2.2;
        this.recoil = 0.14;
        Game.stats.shots++;
        sound.gun();
      },

      secondary() {
        if (!this.control || !this.alive || this.looping) return;
        if (this.gliding && this.heavyArmed) {
          this.heavyArmed = false;
          Game.stats.bombs++;
          Ordnance.dropHeavy();
          UI.banner('¡BOMBA PESADA FUERA!', 'good');
          return;
        }
        if (this.bombs <= 0) {
          sound.empty();
          UI.banner('SIN COHETES RS-82', 'bad');
          return;
        }
        this.bombs--;
        Game.stats.bombs++;
        Ordnance.fireRocket();
      },

      startRoll(dir) {
        if (!this.control || !this.alive || this.rolling || this.looping || this.rollCd > 0) return;
        this.rolling = true;
        this.rollT = 0;
        this.rollDir = dir || (this.vel.x >= 0 ? 1 : -1);
        sound.roll();
      },

      startLoop() {
        if (!this.control || !this.alive || this.rolling || this.looping || this.loopCd > 0) return;
        this.looping = true;
        this.loopT = 0;
        sound.roll();
        UI.banner('¡LOOPING!', 'cold');
      },

      toggleGlide() {
        if (!this.control || !this.alive) return;
        if (this.gliding) {
          this.endGlide(false);
          return;
        }
        if (this.glide < 1) {
          sound.empty();
          UI.banner('PLANEO RECARGÁNDOSE…', 'cold');
          return;
        }
        this.gliding = true;
        this.heavyArmed = true;
        sound.engineCut();
        sound.setGlide(true);
        UI.banner('MOTOR APAGADO · SILENCIO', 'cold');
        Game.detection = Math.min(Game.detection, 0.5);
        Comms.say('raskova', 'Eso es… ahora eres solo viento. Suelta la bomba pesada con ' + UI.keyName('bomb') + '.', { once: 'firstglide' });
      },

      endGlide(auto) {
        if (!this.gliding) return;
        this.gliding = false;
        this.heavyArmed = false;
        this.glideDelay = 1.2;
        sound.engineStart();
        sound.setGlide(false);
        if (auto) UI.banner('¡MOTOR EN MARCHA!', 'bad');
      },

      heal(n) {
        this.hp = Math.min(this.maxHp, this.hp + n);
      },

      hurt(amount, source) {
        if (!this.alive || this.invuln > 0 || this.looping || Level.phase === 'victory') return;
        const dmg = Math.max(1, Math.round(amount * Game.diff.damage));
        this.hp = Math.max(0, this.hp - dmg);
        Game.stats.damage += dmg;
        this.invuln = source === 'flak' ? 0.4 : 0.6;
        Post.hit = 1;
        FX.addShake(0.6);
        sound.hurt();
        FX.sparks(this.wpos, 6);
        for (let i = 0; i < 5; i++) {
          randomDir(tmpV).multiplyScalar(rand(4, 9));
          FX.debris.spawn(this.wpos.x, this.wpos.y, this.wpos.z, tmpV.x, tmpV.y + 3, tmpV.z + 12, rand(0.6, 1.2), rand(0.12, 0.3), 0.05, i % 2 ? COL.wood : COL.canvas, COL.dark, 14, 0.4);
        }
        if (this.hp <= 35 && this.hp > 0) {
          Comms.say('bersh', '¡Tu lona está hecha jirones! Busca las cajas de suministros.', { once: 'lowhp' });
        }
        if (this.hp <= 0) this.die();
      },

      die() {
        this.alive = false;
        this.control = false;
        this.dying = true;
        this.deathT = 0;
        this.gliding = false;
        this.heavyArmed = false;
        this.marker.visible = false;
        sound.setGlide(false);
        sound.setEngine(0.6, 0.55, 0.3);
        Level.onPlayerDown();
      },

      updateDying(dt) {
        this.deathT += dt;
        this.rollAngle += dt * 7;
        this.pos.y -= (3 + this.deathT * 7) * dt;
        this.pos.x += this.vel.x * dt * 0.5;
        this.updateWorld();
        orientQuat(this.obj.quaternion, tmpV.set(0, -0.35, -1).normalize(), this.rollAngle, 0);
        this.obj.position.copy(this.wpos);
        this.obj.visible = true;
        this.prop.rotation.z += 8 * dt;
        FX.smokePuff(this.wpos, 1, 1.6);
        if (Math.random() < 0.7) FX.firePuff(this.wpos, 0.8);
        if (this.pos.y < terrainHeight(this.pos.x, this.wpos.z) + 0.8 || this.deathT > 2.8) {
          this.dying = false;
          this.obj.visible = false;
          FX.explosion(this.wpos, 2, { debris: COL.wood });
          sound.setEngine(0, 1, 0.05);
          sound.setWind(0, 0.3);
          Level.onPlayerCrash();
        }
      },

      /* Marcador de impacto de la bomba pesada sobre el terreno */
      updateMarker() {
        if (!(this.gliding && this.heavyArmed && !Boss.active && this.control)) {
          this.marker.visible = false;
          return;
        }
        const p = tmpV.copy(this.wpos);
        p.y -= 0.9;
        const v = tmpV2.set(this.vel.x * 0.3, -1, -Game.railSpeed - 40);
        for (let i = 0; i < 90; i++) {
          v.y -= 15 * 0.04;
          p.addScaledVector(v, 0.04);
          if (p.y <= terrainHeight(p.x, p.z) + 0.2) break;
        }
        this.marker.position.set(p.x, terrainHeight(p.x, p.z) + 0.25, p.z);
        const s = 1 + Math.sin(Game.time * 10) * 0.12;
        this.marker.scale.set(s, 1, s);
        this.marker.visible = true;
      }
    };

    /* --- Cohetes RS-82 y bomba pesada FAB-100 --- */
    const Ordnance = {
      list: [],

      fireRocket() {
        const obj = TEMPLATES.rocket.clone();
        const pos = Player.nose(new V3());
        pos.y -= 0.4;
        const dir = Player.locked ? Player.lockDir : Player.aim;
        const vel = dir.clone().multiplyScalar(95);
        vel.z -= Game.railSpeed;
        obj.position.copy(pos);
        scene.add(obj);
        this.list.push({ type: 'rocket', obj, pos, prev: pos.clone(), vel, life: 1.3, flame: obj.getObjectByName('flame') });
        sound.rocket();
        FX.muzzle(pos, dir);
      },

      dropHeavy() {
        const obj = TEMPLATES.heavy.clone();
        const pos = Player.wpos.clone();
        pos.y -= 0.9;
        const vel = new V3(Player.vel.x * 0.3, -1, -Game.railSpeed - 40);
        obj.position.copy(pos);
        scene.add(obj);
        this.list.push({ type: 'heavy', obj, pos, prev: pos.clone(), vel, life: 5 });
        sound.bombWhistle(1.4);
      },

      clear() {
        this.list.forEach((o) => scene.remove(o.obj));
        this.list.length = 0;
      },

      update(dt) {
        for (let i = this.list.length - 1; i >= 0; i--) {
          const o = this.list[i];
          o.prev.copy(o.pos);
          if (o.type === 'heavy') o.vel.y -= 15 * dt;
          o.pos.addScaledVector(o.vel, dt);
          o.life -= dt;
          o.obj.position.copy(o.pos);
          orientQuat(o.obj.quaternion, tmpV.copy(o.vel).normalize(), o.type === 'rocket' ? o.life * 10 : 0);
          if (o.type === 'rocket') {
            FX.smokePuff(o.pos, 0.35, 0.6);
            if (o.flame) o.flame.visible = Math.random() < 0.8;
          }
          let boom = o.life <= 0;
          let hullHit = false;
          if (!boom) {
            for (let k = 0; k < entities.length; k++) {
              const e = entities[k];
              if (!e.alive || !e.targetable || e.friendly) continue;
              if (segSphere(o.prev, o.pos, e.center, e.radius + 0.8)) { boom = true; break; }
            }
          }
          if (!boom && Boss.active && Boss.state === 'fight') {
            if (Boss.hullContains(o.pos, 0.6)) { boom = true; hullHit = true; }
            else {
              Boss.parts.forEach((p) => {
                if (!p.alive) return;
                p.spheres.forEach((s) => { if (segSphere(o.prev, o.pos, s.world, s.r + 0.5)) boom = true; });
              });
            }
          }
          if (!boom && o.pos.y < terrainHeight(o.pos.x, o.pos.z) + 0.3) boom = true;
          if (boom) {
            this.detonate(o, hullHit);
            scene.remove(o.obj);
            this.list.splice(i, 1);
          }
        }
      },

      detonate(o, hullHit) {
        const heavy = o.type === 'heavy';
        const radius = heavy ? 18 : 13;
        const dmg = heavy ? 20 : 8;
        FX.explosion(o.pos, heavy ? 3.4 : 2.1);
        if (heavy) {
          FX.flash = Math.max(FX.flash, 0.4);
          for (let k = 0; k < 28; k++) {
            const a = (k / 28) * TAU;
            FX.add.spawn(o.pos.x, o.pos.y + 0.5, o.pos.z, Math.cos(a) * 26, 1, Math.sin(a) * 26, 0.45, 1.4, 0.2, COL.fire, COL.fireEnd, 0, 2.5);
          }
          FX.addShake(1.1);
        }
        entities.forEach((e) => {
          if (!e.alive || !e.targetable || e.friendly) return;
          if (e.center.distanceTo(o.pos) < radius + e.radius) e.hit(dmg, e.center);
        });
        Boss.areaDamage(o.pos, heavy ? 16 : 11, heavy ? 22 : 8, hullHit ? (heavy ? 22 : 6) : 0);
        // Como las Smart Bombs: limpia las balas enemigas cercanas
        EnemyBullets.active.forEach((b) => {
          if (b.active && b.pos.distanceTo(o.pos) < radius + 2) b.active = false;
        });
      }
    };

    function updatePlayerBullets(dt) {
      PlayerBullets.update(dt, (b) => {
        for (let i = 0; i < entities.length; i++) {
          const e = entities[i];
          if (!e.alive || !e.targetable || e.friendly) continue;
          if (Math.abs(e.center.z - b.pos.z) > e.radius + 8) continue;
          if (segSphere(b.prev, b.pos, e.center, e.radius)) {
            e.hit(b.dmg, b.pos);
            Game.stats.hits++;
            return true;
          }
        }
        if (Boss.active) {
          const r = Boss.bulletTest(b.prev, b.pos);
          if (r === 'hit') {
            Game.stats.hits++;
            return true;
          }
          if (r === 'armor') return true;
        }
        if (b.pos.y < terrainHeight(b.pos.x, b.pos.z)) {
          FX.sparks(b.pos, 2, COL.ember);
          return true;
        }
        return false;
      });
    }

    function updateEnemyBullets(dt) {
      EnemyBullets.update(dt, (b) => {
        if (Player.alive && !Player.looping) {
          const r = Player.rolling ? 2.2 : 1.3;
          if (segSphere(b.prev, b.pos, Player.wpos, r)) {
            if (Player.rolling) {
              FX.sparks(b.pos, 6, COL.blue);
              sound.deflect();
              UI.banner('¡DESVIADO!', 'cold');
              Game.addScore(10);
              return true;
            }
            if (Player.invuln <= 0) {
              Player.hurt(b.dmg, 'bullet');
              return true;
            }
          }
        }
        // Una vez rebasada la jugadora, la bala desaparece (no tapa la cámara)
        if (b.vel.z > 0 && b.pos.z > Player.wpos.z + 3) return true;
        return isBehindCamera(b.pos.z, 0);
      });
    }

    /* ====================================================================
       15. ENTRADA: TECLADO Y RATÓN
       ==================================================================== */
    const BINDINGS = {
      keyboard: {
        up: ['KeyW', 'ArrowUp'],
        down: ['KeyS', 'ArrowDown'],
        left: ['KeyA', 'ArrowLeft'],
        right: ['KeyD', 'ArrowRight'],
        fire: ['Space', 'KeyJ'],
        bomb: ['KeyK', 'ControlLeft', 'ControlRight'],
        rollL: ['KeyQ'],
        rollR: ['KeyE'],
        glide: ['ShiftLeft', 'ShiftRight'],
        loop: ['KeyR']
      },
      mouse: {
        roll: ['Space'],
        glide: ['KeyE'],
        loop: ['KeyR']
      }
    };
    const PAUSE_KEYS = ['Escape', 'KeyP'];
    const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyJ', 'KeyK', 'KeyQ', 'KeyE', 'KeyR', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'Tab']);

    const Input = {
      keys: new Set(),
      mouse: { x: 0, y: 0, left: false },
      lastTap: { left: 0, right: 0 },
      wheelCd: 0,

      init() {
        window.addEventListener('keydown', (e) => this.onKey(e, true));
        window.addEventListener('keyup', (e) => this.onKey(e, false));
        window.addEventListener('blur', () => {
          this.keys.clear();
          this.mouse.left = false;
        });
        const scr = el.screen;
        scr.addEventListener('mousemove', (e) => this.onMove(e));
        scr.addEventListener('mousedown', (e) => this.onMouse(e, true));
        window.addEventListener('mouseup', (e) => this.onMouse(e, false));
        scr.addEventListener('contextmenu', (e) => {
          if (Game.state === 'play') e.preventDefault();
        });
        scr.addEventListener('wheel', (e) => {
          if (Game.state !== 'play') return;
          e.preventDefault();
          if (Settings.data.control !== 'mouse') return;
          const now = performance.now();
          if (now - this.wheelCd < 350) return;
          this.wheelCd = now;
          Player.startRoll(e.deltaY < 0 ? -1 : 1);
        }, { passive: false });
      },

      bound(action, code) {
        const map = BINDINGS[Settings.data.control] || BINDINGS.keyboard;
        const list = map[action];
        return !!list && list.indexOf(code) !== -1;
      },

      held(action) {
        const list = BINDINGS.keyboard[action];
        if (!list) return false;
        for (let i = 0; i < list.length; i++) if (this.keys.has(list[i])) return true;
        return false;
      },

      onKey(e, down) {
        const code = e.code;
        sound.unlock();
        if (Game.state === 'play' || Game.state === 'pause') {
          if (GAME_KEYS.has(code) || e.ctrlKey) e.preventDefault();
        }
        if (!down) {
          this.keys.delete(code);
          return;
        }
        if (e.repeat) return;
        this.keys.add(code);

        if (Game.state === 'play') {
          if (PAUSE_KEYS.indexOf(code) !== -1) {
            Main.pause();
            return;
          }
          const kb = Settings.data.control !== 'mouse';
          if (kb) {
            if (this.bound('bomb', code)) Player.secondary();
            if (this.bound('rollL', code)) Player.startRoll(-1);
            if (this.bound('rollR', code)) Player.startRoll(1);
            if (this.bound('glide', code)) Player.toggleGlide();
            if (this.bound('loop', code)) Player.startLoop();
            const now = performance.now();
            if (BINDINGS.keyboard.left.indexOf(code) !== -1) {
              if (now - this.lastTap.left < 260) Player.startRoll(-1);
              this.lastTap.left = now;
            }
            if (BINDINGS.keyboard.right.indexOf(code) !== -1) {
              if (now - this.lastTap.right < 260) Player.startRoll(1);
              this.lastTap.right = now;
            }
          } else {
            if (this.bound('roll', code)) Player.startRoll(0);
            if (this.bound('glide', code)) Player.toggleGlide();
            if (this.bound('loop', code)) Player.startLoop();
          }
          return;
        }
        if (Game.state === 'pause' && PAUSE_KEYS.indexOf(code) !== -1) {
          Main.resume();
          return;
        }
        UI.onMenuKey(e);
      },

      onMove(e) {
        const r = el.screen.getBoundingClientRect();
        this.mouse.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
        this.mouse.y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -1, 1);
      },

      onMouse(e, down) {
        sound.unlock();
        if (Game.state !== 'play') {
          if (!down) this.mouse.left = false;
          return;
        }
        if (e.button === 1) e.preventDefault();
        if (Settings.data.control !== 'mouse') return;
        if (e.button === 0) this.mouse.left = down;
        if (down && e.button === 2) Player.secondary();
        if (down && e.button === 1) Player.toggleGlide();
      }
    };

    /* ====================================================================
       16. TRANSMISIONES DE RADIO (COMMS) — estilo Star Fox
       ==================================================================== */
    const SPEAKERS = {
      bersh: { name: 'YEVDOKÍA BERSHÁNSKAYA', pitch: 340, enemy: false },
      raskova: { name: 'MARINA RASKOVA', pitch: 285, enemy: false },
      german: { name: 'INTERCEPCIÓN · FUNK', pitch: 150, enemy: true }
    };

    const Comms = {
      queue: [],
      cur: null,
      said: new Set(),
      gap: 0,

      say(who, text, o) {
        const opt = o || {};
        if (opt.once) {
          if (this.said.has(opt.once)) return;
          this.said.add(opt.once);
        }
        const msg = { who, text, urgent: !!opt.urgent };
        if (opt.urgent) {
          this.queue.unshift(msg);
          if (this.cur && this.cur.shown >= this.cur.text.length) this.cur.hold = Math.min(this.cur.hold, 0.2);
        } else {
          this.queue.push(msg);
        }
        while (this.queue.length > 3) {
          let k = this.queue.findIndex((m) => !m.urgent);
          if (k === -1) k = this.queue.length - 1;
          this.queue.splice(k, 1);
        }
      },

      reset() {
        this.queue.length = 0;
        this.said.clear();
        this.cur = null;
        this.gap = 0.6;
        el.comms.classList.remove('is-open', 'is-talking', 'is-static', 'is-enemy');
      },

      open(msg) {
        const sp = SPEAKERS[msg.who] || SPEAKERS.bersh;
        this.cur = { who: msg.who, sp, text: msg.text, t: 0, shown: 0, acc: 0, mouthT: 0, mouth: false, hold: 1.3 + msg.text.length * 0.014 };
        setText(el.commsName, sp.name);
        setText(el.commsText, '');
        el.comms.classList.toggle('is-enemy', sp.enemy);
        el.comms.classList.add('is-open', 'is-static');
        drawPortrait(el.commsFace, msg.who, false, false);
        sound.radio(true);
      },

      close() {
        el.comms.classList.remove('is-open', 'is-talking', 'is-static');
        sound.radio(false);
        this.cur = null;
        this.gap = 0.5;
      },

      update(dt) {
        if (!this.cur) {
          this.gap -= dt;
          if (this.gap <= 0 && this.queue.length) this.open(this.queue.shift());
          return;
        }
        const c = this.cur;
        c.t += dt;
        if (c.t < 0.35) return;
        el.comms.classList.remove('is-static');
        if (c.shown < c.text.length) {
          el.comms.classList.add('is-talking');
          c.acc += dt * 44;
          while (c.acc >= 1 && c.shown < c.text.length) {
            c.acc -= 1;
            c.shown++;
            if (c.shown % 3 === 0 && c.text[c.shown - 1] !== ' ') sound.voice(c.sp.pitch);
          }
          setText(el.commsText, c.text.slice(0, c.shown));
          c.mouthT -= dt;
          if (c.mouthT <= 0) {
            c.mouthT = 0.09;
            c.mouth = !c.mouth;
            drawPortrait(el.commsFace, c.who, c.mouth, false);
          }
        } else {
          if (c.mouth || el.comms.classList.contains('is-talking')) {
            c.mouth = false;
            el.comms.classList.remove('is-talking');
            drawPortrait(el.commsFace, c.who, false, false);
          }
          c.hold -= dt;
          if (c.hold < 0.8 && c.hold > 0.7) drawPortrait(el.commsFace, c.who, false, true);
          if (c.hold < 0.6 && c.hold > 0.5) drawPortrait(el.commsFace, c.who, false, false);
          if (c.hold <= 0) this.close();
        }
      }
    };

    /* ====================================================================
       17. INTERFAZ: HUD, MENÚS Y MAPA TÁCTICO
       ==================================================================== */
    const OVERLAY_OF = {
      boot: 'ov-boot',
      menu: 'ov-menu',
      options: 'ov-options',
      controls: 'ov-controls',
      chapters: 'ov-chapters',
      pause: 'ov-pause',
      results: 'ov-results',
      gameover: 'ov-gameover'
    };

    const UI = {
      lastBanner: '',
      lastBannerT: 0,
      lastLock: null,
      imgVer: -1,
      backTo: 'menu',

      init() {
        document.querySelectorAll('[data-action]').forEach((btn) => {
          btn.addEventListener('click', () => this.action(btn.getAttribute('data-action')));
          btn.addEventListener('mouseenter', () => { if (!btn.disabled) btn.focus({ preventScroll: true }); });
          btn.addEventListener('focus', () => this.blip());
        });
        el.bootBtn.addEventListener('click', () => Main.boot());
        el.skipBtn.addEventListener('click', () => Intro.finish());
        this.bindOptions();
        this.syncOptions();
        this.applySettings();
        drawReticle(el.retNear, false, true);
        drawReticle(el.retFar, false, false);
        drawPortrait(el.commsFace, 'bersh', false, false);
      },

      blip() {
        const now = performance.now();
        if (now - (this.lastBlip || 0) < 70) return;
        this.lastBlip = now;
        sound.ui();
      },

      setState(s) {
        Game.state = s;
        el.screen.setAttribute('data-state', s);
        const ov = OVERLAY_OF[s];
        const first = ov ? document.querySelector('#' + ov + ' button:not([disabled]):not([hidden])') : null;
        if (first) first.focus({ preventScroll: true });
        else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      },

      action(a) {
        sound.confirm();
        switch (a) {
          case 'story':
            if (Game.state === 'results' || Game.state === 'gameover') Main.toMenu();
            this.openChapters();
            break;
          case 'controls':
            this.setState('controls');
            break;
          case 'options':
            this.setState('options');
            break;
          case 'intro':
            Intro.start();
            break;
          case 'back':
            this.setState('menu');
            break;
          case 'chapter': {
            const launch = document.querySelector('#ov-chapters .btn-launch');
            if (launch) launch.focus({ preventScroll: true });
            break;
          }
          case 'launch':
          case 'restart':
            Level.begin(false);
            break;
          case 'retry-boss':
            Level.begin(true);
            break;
          case 'resume':
            Main.resume();
            break;
          case 'quit':
            Main.toMenu();
            break;
          default:
            break;
        }
      },

      openChapters() {
        setText(el.best, Settings.data.best > 0 ? pad(Settings.data.best, 6) : '—');
        this.setState('chapters');
      },

      /* Navegación con flechas en los menús */
      onMenuKey(e) {
        if (Game.state === 'intro') {
          if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            Intro.finish();
          }
          return;
        }
        const ov = OVERLAY_OF[Game.state];
        if (!ov) return;
        if (e.code === 'Escape' && ['options', 'controls', 'chapters'].indexOf(Game.state) !== -1) {
          e.preventDefault();
          sound.confirm();
          this.setState('menu');
          return;
        }
        if (Game.state === 'boot' && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          Main.boot();
          return;
        }
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'SELECT') return;
        if (e.code !== 'ArrowDown' && e.code !== 'ArrowUp' && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
        const list = Array.from(document.querySelectorAll('#' + ov + ' button:not([disabled]):not([hidden])'));
        if (!list.length) return;
        e.preventDefault();
        let i = list.indexOf(document.activeElement);
        const dir = e.code === 'ArrowDown' || e.code === 'ArrowRight' ? 1 : -1;
        i = i === -1 ? 0 : (i + dir + list.length) % list.length;
        list[i].focus({ preventScroll: true });
      },

      /* --- Opciones --- */
      bindOptions() {
        const o = el.opt;
        const vol = (input, out, key) => {
          input.addEventListener('input', () => {
            Settings.data[key] = Number(input.value) / 100;
            out.value = input.value;
            sound.applyVolumes();
            Settings.save();
          });
        };
        vol(o.master, o.outMaster, 'master');
        vol(o.music, o.outMusic, 'music');
        vol(o.sfx, o.outSfx, 'sfx');
        const setControl = (mode) => {
          Settings.data.control = mode;
          Settings.save();
          this.applySettings();
        };
        o.kb.addEventListener('change', () => { if (o.kb.checked) setControl('keyboard'); });
        o.mouse.addEventListener('change', () => { if (o.mouse.checked) setControl('mouse'); });
        o.invert.addEventListener('change', () => {
          Settings.data.invertY = o.invert.checked;
          Settings.save();
        });
        o.crt.addEventListener('change', () => {
          Settings.data.crt = o.crt.value;
          Settings.save();
          this.applySettings();
        });
        o.res.addEventListener('change', () => {
          Settings.data.res = Number(o.res.value);
          Settings.save();
          Main.resize();
        });
        o.diff.addEventListener('change', () => {
          Settings.data.difficulty = o.diff.value;
          Settings.save();
        });
        o.form.addEventListener('submit', (e) => e.preventDefault());
      },

      syncOptions() {
        const o = el.opt;
        const d = Settings.data;
        o.master.value = Math.round(d.master * 100);
        o.music.value = Math.round(d.music * 100);
        o.sfx.value = Math.round(d.sfx * 100);
        o.outMaster.value = o.master.value;
        o.outMusic.value = o.music.value;
        o.outSfx.value = o.sfx.value;
        o.kb.checked = d.control !== 'mouse';
        o.mouse.checked = d.control === 'mouse';
        o.invert.checked = !!d.invertY;
        o.crt.value = d.crt;
        o.res.value = String(d.res);
        o.diff.value = d.difficulty;
      },

      applySettings() {
        const d = Settings.data;
        el.screen.setAttribute('data-control', d.control === 'mouse' ? 'mouse' : 'keyboard');
        ['off', 'low', 'medium', 'high'].forEach((k) => el.screen.classList.toggle('crt-' + k, d.crt === k));
        Post.configure(d.crt);
      },

      keyName(action) {
        const mouse = Settings.data.control === 'mouse';
        const names = mouse
          ? { glide: 'E (o el botón central)', bomb: 'el clic derecho', roll: 'la rueda del ratón', fire: 'el clic izquierdo', loop: 'R' }
          : { glide: 'SHIFT', bomb: 'K', roll: 'Q / E', fire: 'ESPACIO', loop: 'R' };
        return names[action] || '';
      },

      /* --- Avisos y HUD --- */
      banner(text, kind) {
        const now = performance.now();
        if (text === this.lastBanner && now - this.lastBannerT < 700) return;
        this.lastBanner = text;
        this.lastBannerT = now;
        const b = el.banner;
        b.textContent = text;
        b.className = 'banner' + (kind ? ' banner-' + kind : '');
        void b.offsetWidth;
        b.classList.add('is-show');
      },

      popHits() {
        el.hits.classList.remove('is-pop');
        void el.hits.offsetWidth;
        el.hits.classList.add('is-pop');
      },

      objective(text) {
        setText(el.objective, text);
      },

      armorHint(p) {
        if (Boss.phase === 1 && p.kind !== 'engine') {
          Comms.say('raskova', '¡Su blindaje es demasiado grueso! Destruye primero los cuatro motores.', { once: 'armor1' });
        } else if (Boss.phase === 2 && p.kind === 'bay') {
          Comms.say('bersh', 'Las compuertas siguen cerradas. ¡Primero la góndola de artillería!', { once: 'armor2' });
        }
      },

      updateHUD() {
        setText(el.score, pad(Game.score, 6));
        setText(el.hits, pad(Game.kills, 3));
        setText(el.bombs, '× ' + Player.bombs);
        CSSVars.set('--player-hp', (Player.hp / Player.maxHp).toFixed(3));
        CSSVars.set('--glide', Player.glide.toFixed(3));
        screenClass('hull-low', Player.hp <= 30 && Player.alive);
        screenClass('is-gliding', Player.gliding);
        screenClass('glide-ready', !Player.gliding && Player.glide >= 1);
        screenClass('heavy-armed', Player.gliding && Player.heavyArmed);
        screenClass('is-detected', Game.detected && !Player.gliding && Player.alive);
        let glideText;
        if (Player.gliding) glideText = 'PLANEANDO · ' + Math.ceil(Player.glide * 6.5) + ' s';
        else if (Player.glide >= 1) glideText = 'LISTO · ' + (Settings.data.control === 'mouse' ? 'E' : 'SHIFT');
        else glideText = 'RECARGANDO ' + Math.floor(Player.glide * 100) + ' %';
        setText(el.glideState, glideText);
        if (Boss.active) CSSVars.set('--boss-hp', Boss.hpFraction().toFixed(3));
        // Retículas proyectadas en pantalla
        const showRet = Player.control && Player.alive && !Player.looping && Game.state === 'play';
        screenClass('hide-reticle', !showRet);
        if (showRet) {
          this.placeReticle(tmpV.copy(Player.wpos).addScaledVector(Player.aim, 13), '--ret-near-x', '--ret-near-y');
          this.placeReticle(tmpV.copy(Player.wpos).addScaledVector(Player.aim, 40), '--ret-far-x', '--ret-far-y');
        }
        if (Player.locked !== this.lastLock || imagesVersion !== this.imgVer) {
          this.lastLock = Player.locked;
          this.imgVer = imagesVersion;
          drawReticle(el.retNear, Player.locked, true);
          drawReticle(el.retFar, Player.locked, false);
        }
      },

      placeReticle(world, vx, vy) {
        tmpV.copy(world).project(camera);
        const s = Post.toScreen(tmpV.x, tmpV.y);
        CSSVars.set(vx, ((s.x * 0.5 + 0.5) * 100).toFixed(2) + '%');
        CSSVars.set(vy, ((-s.y * 0.5 + 0.5) * 100).toFixed(2) + '%');
      },

      /* --- Resultados --- */
      showResults() {
        const st = Game.stats;
        const acc = st.shots > 0 ? Math.min(100, Math.round((st.hits / st.shots) * 100)) : 0;
        setText(el.res.score, pad(Game.score, 6));
        setText(el.res.kills, String(Game.kills));
        setText(el.res.acc, acc + ' %');
        setText(el.res.shots, st.shots + ' / ' + st.hits);
        setText(el.res.bombs, String(st.bombs));
        setText(el.res.dmg, String(st.damage));
        setText(el.res.time, formatTime(st.time));
        let medal = 'MEDALLA AL VALOR';
        if (Game.score >= 22000 && acc >= 35) medal = '★ HEROÍNA DE LA UNIÓN SOVIÉTICA ★';
        else if (Game.score >= 16000) medal = 'ORDEN DE LA BANDERA ROJA';
        else if (Game.score >= 10000) medal = 'ORDEN DE LA ESTRELLA ROJA';
        setText(el.res.medal, medal);
        if (Game.score > Settings.data.best) {
          Settings.data.best = Game.score;
          Settings.save();
        }
        this.setState('results');
      },

      showGameOver() {
        el.retryBoss.hidden = !Game.checkpoint;
        setText(el.goText, Game.checkpoint
          ? 'El «Walküre» sigue en el aire… Las brujas no se rinden: ¡inténtalo de nuevo!'
          : 'La lona ardió en el cielo nocturno… pero la leyenda continúa.');
        this.setState('gameover');
      },

      /* --- Mapa táctico (dibujado en Canvas) --- */
      drawMap(time) {
        const c = el.map;
        const g = c.getContext('2d');
        const W = c.width;
        const H = c.height;
        if (!this.paper) {
          const p = this.paper = makeCanvas(W, H);
          const pg = p.getContext('2d');
          const r = seeded(588);
          pg.fillStyle = '#cdb98c';
          pg.fillRect(0, 0, W, H);
          for (let i = 0; i < 2600; i++) {
            const v = 150 + Math.floor(r() * 70);
            pg.fillStyle = 'rgba(' + v + ',' + (v - 20) + ',' + (v - 60) + ',0.35)';
            pg.fillRect(Math.floor(r() * W), Math.floor(r() * H), 1 + Math.floor(r() * 2), 1);
          }
          pg.fillStyle = 'rgba(90, 60, 25, 0.12)';
          for (let i = 0; i < 9; i++) pg.fillRect(0, Math.floor(r() * H), W, 1);
          // Retícula de coordenadas
          pg.strokeStyle = 'rgba(70, 50, 25, 0.35)';
          pg.lineWidth = 1;
          for (let x = 0; x <= W; x += 40) { pg.beginPath(); pg.moveTo(x + 0.5, 0); pg.lineTo(x + 0.5, H); pg.stroke(); }
          for (let y = 0; y <= H; y += 40) { pg.beginPath(); pg.moveTo(0, y + 0.5); pg.lineTo(W, y + 0.5); pg.stroke(); }
          pg.fillStyle = 'rgba(70, 50, 25, 0.6)';
          pg.font = '7px "Press Start 2P", monospace';
          for (let i = 0; i < W / 40; i++) pg.fillText(String.fromCharCode(65 + i), i * 40 + 3, 10);
          for (let j = 1; j < H / 40; j++) pg.fillText(String(j), 3, j * 40 + 10);
          // Zona soviética (este) sombreada
          pg.fillStyle = 'rgba(180, 30, 20, 0.07)';
          pg.fillRect(W * 0.6, 0, W * 0.4, H);
        }
        g.imageSmoothingEnabled = false;
        g.drawImage(this.paper, 0, 0);
        // Río Mius
        g.strokeStyle = '#4a6a8a';
        g.lineWidth = 4;
        g.beginPath();
        for (let y = 0; y <= H; y += 10) {
          const x = W * 0.55 + Math.sin(y * 0.03) * 18 + Math.sin(y * 0.09) * 6;
          if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        // Línea del frente animada
        g.lineWidth = 3;
        g.setLineDash([8, 6]);
        g.lineDashOffset = -time * 12;
        g.strokeStyle = '#a01810';
        g.beginPath();
        for (let y = 0; y <= H; y += 12) {
          const x = W * 0.5 + Math.sin(y * 0.03 + 0.6) * 22 + (y % 24 === 0 ? 6 : -6);
          if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.setLineDash([]);
        // Aeródromo del regimiento
        const ax = W * 0.83;
        const ay = H * 0.68;
        g.fillStyle = '#2a1d10';
        g.fillRect(ax - 16, ay - 3, 32, 6);
        drawStar(g, ax, ay - 14, 9, 3.6, '#c8102e');
        // Objetivos y rutas
        const targets = [
          { x: W * 0.28, y: H * 0.5, n: '1', on: true, label: 'DEPÓSITO' },
          { x: W * 0.18, y: H * 0.2, n: '2', on: false, label: '?' },
          { x: W * 0.1, y: H * 0.82, n: '3', on: false, label: '?' }
        ];
        targets.forEach((t) => {
          g.strokeStyle = t.on ? '#c8102e' : 'rgba(60, 45, 25, 0.5)';
          g.lineWidth = t.on ? 3 : 2;
          g.setLineDash(t.on ? [10, 6] : [4, 6]);
          g.lineDashOffset = t.on ? -time * 30 : 0;
          g.beginPath();
          g.moveTo(ax, ay - 8);
          g.quadraticCurveTo((ax + t.x) / 2, Math.min(ay, t.y) - 60, t.x, t.y);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = t.on ? '#c8102e' : '#5c5346';
          g.beginPath();
          g.arc(t.x, t.y, t.on ? 11 + Math.sin(time * 5) * 1.5 : 9, 0, TAU);
          g.fill();
          g.fillStyle = '#f2e6c8';
          g.font = '8px "Press Start 2P", monospace';
          g.fillText(t.n, t.x - 3, t.y + 4);
          g.fillStyle = t.on ? '#7a0f08' : '#5c5346';
          g.font = '7px "Press Start 2P", monospace';
          g.fillText(t.label, t.x - 20, t.y + 24);
        });
        g.fillStyle = '#2a1d10';
        g.font = '7px "Press Start 2P", monospace';
        g.fillText('AERÓDROMO 588', ax - 44, ay + 18);
        g.fillText('RÍO MIUS', W * 0.56, H * 0.12);
        g.fillStyle = '#a01810';
        g.fillText('LÍNEA DEL FRENTE', W * 0.36, H * 0.95);
        // Rosa de los vientos
        g.strokeStyle = '#2a1d10';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(W - 30, 48);
        g.lineTo(W - 30, 18);
        g.lineTo(W - 36, 28);
        g.moveTo(W - 30, 18);
        g.lineTo(W - 24, 28);
        g.stroke();
        g.fillStyle = '#2a1d10';
        g.fillText('N', W - 33, 60);
        // Sello de "secreto"
        g.save();
        g.translate(W * 0.73, H * 0.18);
        g.rotate(-0.25);
        g.strokeStyle = 'rgba(170, 20, 15, 0.7)';
        g.lineWidth = 2;
        g.strokeRect(-46, -12, 92, 22);
        g.fillStyle = 'rgba(170, 20, 15, 0.75)';
        g.font = '8px "Press Start 2P", monospace';
        g.fillText('СЕКРЕТНО', -36, 4);
        g.restore();
      }
    };

    /* ====================================================================
       18. GUION DEL CAPÍTULO 1: «EL SUSURRO DE LA ESCOBA»
       ==================================================================== */
    const Spawn = {
      ahead(d) {
        return Game.railZ - d;
      },
      fighterV(n, cx, cy, z, speed) {
        for (let i = 0; i < n; i++) {
          const off = i - (n - 1) / 2;
          addEntity(new Fighter({ mode: 'headon', x: cx + off * 4.6, y: cy + Math.abs(off) * 0.9, z: z - Math.abs(off) * 7, speed: speed || 14, amp: 2.2, phase: i * 0.9, fireDelay: 0.6 }));
        }
      },
      cross(n, dir, y, z) {
        for (let i = 0; i < n; i++) {
          addEntity(new Fighter({ mode: 'cross', dir, x: -dir * (62 + i * 10), y: y + (i % 2) * 2.5, z: z - i * 5, speed: 25, phase: i, fireRate: 2.6 }));
        }
      },
      behind(n) {
        for (let i = 0; i < n; i++) {
          addEntity(new Fighter({ mode: 'behind', x: (i % 2 ? 7 : -7), y: 9, z: 34 + i * 6, ox: i % 2 ? 3 : -3, hp: 4, score: 150, fireRate: 1.6 }));
        }
      },
      hold(n, z) {
        for (let i = 0; i < n; i++) {
          const cx = (i - (n - 1) / 2) * 10;
          addEntity(new Fighter({ mode: 'hold', x: cx, y: 28, z: -230 - i * 10, cx, cy: 9 + (i % 2) * 4, cz: z || -52, duration: 9, phase: i * 1.7, ampX: 7, hp: 4, score: 150, fireRate: 2 }));
        }
      },
      ground(Type, x, d) {
        return addEntity(new Type(x, this.ahead(d)));
      }
    };

    const Level = {
      phase: 'idle',
      t: 0,
      events: [],
      idx: 0,
      rescue: null,
      depotTotal: 0,
      depotDestroyed: 0,
      depotDone: false,

      buildScript() {
        const E = [];
        const at = (t, fn) => E.push({ t, fn });
        const S = Spawn;
        at(0.4, () => {
          UI.objective('CRUZAR LA LÍNEA DEL FRENTE');
          Comms.say('bersh', 'Aquí Bershánskaya. Brujas del 588.º, mantened rumbo y altura. El depósito de combustible está tras la línea del frente.');
        });
        at(1, () => World.spawnTrench(S.ahead(190)));
        at(2.5, () => {
          S.ground(Tower, -24, 230);
          S.ground(Tower, 27, 260);
        });
        at(6, () => Comms.say('raskova', 'Recuerda: si un reflector te atrapa, apaga el motor con ' + UI.keyName('glide') + ' y planea. Solo un susurro… como una escoba.'));
        at(8, () => S.fighterV(5, 0, 9, -215));
        at(11, () => addEntity(new Crate('bomb', 5, 16, S.ahead(160))));
        at(13, () => {
          S.ground(Searchlight, -30, 240);
          S.ground(Searchlight, 33, 255);
          S.ground(FlakGun, -18, 245);
          S.ground(FlakGun, 21, 262);
        });
        at(15, () => Comms.say('bersh', '¡Reflectores al frente! Si te iluminan, el Flak caerá sobre ti.'));
        at(20, () => S.cross(4, 1, 10, -70));
        at(23.5, () => S.cross(4, -1, 13, -82));
        at(24, () => {
          S.ground(Tower, -20, 235);
          S.ground(Tower, 23, 245);
          S.ground(FlakGun, -9, 255);
        });
        at(28, () => this.startRescue());
        at(36, () => {
          World.spawnTrench(S.ahead(230));
          World.spawnTrench(S.ahead(262));
        });
        at(41, () => {
          Comms.say('raskova', 'Trincheras alemanas bajo nosotras. Cuidado con las ametralladoras de las torres.');
          S.ground(Tower, -14, 230);
          S.ground(Tower, 16, 238);
          S.ground(Tower, -26, 252);
          S.ground(FlakGun, 28, 246);
        });
        at(45, () => {
          S.behind(2);
          Comms.say('bersh', '¡Cuidado! ¡Tienes uno a las seis! ¡Haz un tonel con ' + UI.keyName('roll') + '!', { urgent: true });
        });
        at(51, () => addEntity(new Crate('repair', -6, 15, S.ahead(160))));
        at(53, () => {
          S.ground(Searchlight, -34, 235);
          S.ground(Searchlight, -14, 250);
          S.ground(Searchlight, 15, 242);
          S.ground(Searchlight, 35, 258);
          S.ground(FlakGun, -24, 248);
          S.ground(FlakGun, 2, 262);
          S.ground(FlakGun, 26, 240);
          Comms.say('raskova', 'Zona de reflectores. Es el momento: ¡apaga el motor y planea en silencio!');
        });
        at(64, () => {
          S.fighterV(3, -9, 8, -220);
          S.fighterV(3, 9, 12, -240);
        });
        at(68, () => Comms.say('german', '«Achtung! Die Nachthexen…» ¡Las brujas! ¡Las brujas están aquí!'));
        at(71, () => Comms.say('raskova', 'Nos oyen… pero no nos ven. Sigue así.'));
        at(72, () => S.hold(3, -52));
        at(80, () => {
          addEntity(new Crate('bomb', 8, 15, S.ahead(150)));
          addEntity(new Crate('repair', -10, 13, S.ahead(175)));
        });
        at(83, () => {
          this.spawnDepot();
          World.spawnTrench(S.ahead(210));
        });
        at(85, () => {
          UI.objective('DESTRUIR EL DEPÓSITO DE COMBUSTIBLE');
          Comms.say('bersh', '¡El depósito! Apaga el motor, planea en silencio y suelta la bomba pesada sobre los tanques.', { urgent: true });
        });
        at(95, () => {
          S.cross(3, 1, 9, -60);
          S.cross(3, -1, 14, -76);
        });
        at(102, () => {
          Comms.say('raskova', 'Algo enorme se mueve entre las nubes… ¡Atentas todas!');
          World.fogTarget = 0.016;
        });
        at(104, () => {
          UI.objective('¿QUÉ HAY ENTRE LAS NUBES?');
          for (let i = 0; i < 6; i++) World.spawnCloud(rand(-60, 60), rand(16, 34), Game.railZ - rand(70, 200), rand(1, 1.7));
        });
        at(107.5, () => this.startBossIntro());
        return E.sort((a, b) => a.t - b.t);
      },

      begin(fromBoss) {
        this.cleanup();
        Game.resetRun();
        Game.checkpoint = !!fromBoss;
        Player.reset();
        Comms.reset();
        World.fogTarget = FOG_BASE;
        World.clearClouds();
        this.rescue = null;
        this.depotTotal = this.depotDestroyed = 0;
        this.depotDone = false;
        this.flakT = 2;
        this.ambientT = 1;
        this.bossT = 0;
        this.endT = 0;
        this.events = this.buildScript();
        this.t = fromBoss ? 103.5 : 0;
        this.idx = 0;
        while (this.idx < this.events.length && this.events[this.idx].t < this.t) this.idx++;
        this.phase = 'start';
        this.startT = 0;
        Game.railSpeed = 30;
        sound.stopTheme(0.5);
        sound.playLevelMusic(true);
        sound.setEngine(1, 1, 0.3);
        sound.setWind(0.16);
        UI.objective(fromBoss ? '¿QUÉ HAY ENTRE LAS NUBES?' : 'CRUZAR LA LÍNEA DEL FRENTE');
        UI.setState('play');
        screenClass('show-titlecard', true);
        Game.later(3.4, () => screenClass('show-titlecard', false));
        CameraRig.set('levelStart');
        CameraRig.snap = true;
      },

      cleanup() {
        clearEntities();
        PlayerBullets.clear();
        EnemyBullets.clear();
        Ordnance.clear();
        FX.clear();
        Boss.remove();
        Game.flakQueue.length = 0;
        Game.timers.length = 0;
        Game.timeScale = 1;
        Game.detection = 0;
        Game.detected = false;
        ['show-titlecard', 'show-warning', 'boss-on', 'is-detected', 'is-gliding', 'heavy-armed', 'hull-low', 'glide-ready'].forEach((c) => screenClass(c, false));
        sound.setGlide(false, true);
        sound.setDrone(0);
        this.phase = 'idle';
      },

      targetSpeed() {
        if (this.phase === 'victory') return 24;
        if (this.phase === 'bossIntro') return 26;
        if (this.phase === 'dead') return 22;
        return Player.gliding ? 25 : 30;
      },

      update(dt) {
        const sdt = dt * Game.timeScale;
        Game.railSpeed = damp(Game.railSpeed, this.targetSpeed(), 2, sdt);
        Game.railZ -= Game.railSpeed * sdt;
        if (this.phase !== 'victory' && this.phase !== 'dead' && this.phase !== 'idle') Game.stats.time += dt;

        switch (this.phase) {
          case 'start':
            this.startT += dt;
            Player.autoCenter = true;
            if (this.startT > 2.7) {
              this.phase = 'run';
              Player.autoCenter = false;
              Player.control = true;
            }
            break;
          case 'run':
            this.t += sdt;
            while (this.idx < this.events.length && this.events[this.idx].t <= this.t) {
              const ev = this.events[this.idx++];
              ev.fn();
            }
            this.updateRescue(sdt);
            this.ambientFlak(sdt);
            break;
          case 'bossIntro':
            this.bossT += dt;
            if (this.bossT > 5.4) {
              this.phase = 'boss';
              Player.autoCenter = false;
              Player.control = true;
              screenClass('boss-on', true);
              Comms.say('bersh', 'Apunta a sus cuatro motores. Si planeas por encima, la bomba pesada le hará daño de verdad.');
            }
            break;
          case 'bossDeath':
            if (Boss.state === 'wreck') {
              Game.timeScale = damp(Game.timeScale, 1, 3, dt);
              this.endT += dt;
              if (this.endT > 3) this.victory();
            }
            break;
          case 'victory':
            this.endT += dt;
            if (this.endT > 2.4 && Game.state === 'play') UI.showResults();
            break;
          default:
            break;
        }

        Player.update(sdt);
        Game.litThisFrame = false;
        updateEntities(sdt);
        Boss.update(sdt);
        Ordnance.update(sdt);
        updatePlayerBullets(sdt);
        updateEnemyBullets(sdt);
        Game.updateTimers(sdt);
        this.updateDetection(sdt);
        Comms.update(dt);
        CameraRig.update(dt);
      },

      updateDetection(dt) {
        const was = Game.detected;
        if (Game.litThisFrame && !Player.gliding) Game.detection += dt * 1.5;
        else Game.detection -= dt * (Player.gliding ? 1.4 : 0.32);
        Game.detection = clamp(Game.detection, 0, 1);
        if (Game.detection >= 1) Game.detected = true;
        else if (Game.detection < 0.35 || Player.gliding) Game.detected = false;
        if (Game.detected && !was) {
          sound.detected();
          UI.banner('¡DETECTADA!', 'bad');
          Comms.say('bersh', '¡Te han iluminado! ¡Apaga el motor con ' + UI.keyName('glide') + ' y desaparece!', { once: 'detected', urgent: true });
        }
        if (!Game.detected && was && Player.gliding) {
          Comms.say('german', '«Wo ist sie?» ¿Dónde está? ¡La hemos perdido!', { once: 'lost' });
        }
        // Baterías fuera de pantalla castigan a quien es detectada
        if (Game.detected && Player.alive && (this.phase === 'run' || this.phase === 'boss')) {
          this.flakT -= dt;
          if (this.flakT <= 0) {
            this.flakT = rand(0.9, 1.4) / Game.diff.enemyFire;
            const delay = rand(0.75, 0.95);
            Game.scheduleFlak(new V3(
              Player.wpos.x + Player.vel.x * delay * 0.6 + rand(-3, 3),
              Math.max(3, Player.wpos.y + rand(-2.5, 2.5)),
              Player.wpos.z - Game.railSpeed * delay + rand(-2, 2)
            ), delay);
          }
        }
      },

      ambientFlak(dt) {
        this.ambientT -= dt;
        if (this.ambientT <= 0) {
          this.ambientT = rand(0.6, 1.5);
          FX.flak(new V3(rand(-70, 70), rand(20, 46), Game.railZ - rand(70, 190)));
        }
      },

      startRescue() {
        const ally = addEntity(new Ally());
        const chaser = addEntity(new Fighter({ mode: 'chaseAlly', x: 18, y: 14, z: -185, hp: 5, score: 300, ally }));
        this.rescue = { ally, chaser, t: 0, done: false };
        Comms.say('bersh', '¡Tengo un Messerschmitt pegado a la cola! ¡Quítamelo de encima!', { urgent: true });
      },

      updateRescue(dt) {
        const r = this.rescue;
        if (!r || r.done) return;
        r.t += dt;
        if (r.chaser.hp <= 0) {
          r.done = true;
          r.ally.state = 'saved';
          Game.addScore(500);
          UI.banner('¡RESCATE! +500', 'good');
          Comms.say('bersh', '¡Gracias, te debo una! Te dejo una caja de suministros.', { urgent: true });
          addEntity(new Crate('repair', clamp(r.ally.rel.x, -12, 12), clamp(r.ally.rel.y, 6, 14), Game.railZ + r.ally.rel.z + 8));
        } else if (r.t > 15 || r.chaser.gone) {
          r.done = true;
          if (!r.ally.gone) r.ally.state = 'downed';
          Comms.say('bersh', '¡Me han dado! Regreso a la base… ¡sigue sin mí!', { urgent: true });
        }
      },

      spawnDepot() {
        const z0 = Game.railZ - 245;
        const spots = [[-9, 0], [0, -9], [9, 0], [-5, -20], [6, -22], [0, 9]];
        this.depotTotal = spots.length;
        this.depotDestroyed = 0;
        this.depotDone = false;
        spots.forEach((s) => addEntity(new FuelTank(s[0], z0 + s[1])));
        addEntity(new Searchlight(-26, z0 + 10));
        addEntity(new Searchlight(28, z0 - 6));
        addEntity(new FlakGun(-17, z0 - 12));
        addEntity(new FlakGun(19, z0 + 5));
      },

      onFuelDestroyed() {
        this.depotDestroyed++;
        if (this.depotTotal > 0 && this.depotDestroyed >= this.depotTotal && !this.depotDone) {
          this.depotDone = true;
          Game.addScore(2000);
          UI.banner('¡DEPÓSITO EN LLAMAS! +2000', 'good');
          Comms.say('bersh', '¡Depósito en llamas! Magnífico, bruja.', { urgent: true });
          UI.objective('OBJETIVO CUMPLIDO · REGRESAR');
        }
      },

      startBossIntro() {
        this.phase = 'bossIntro';
        this.bossT = 0;
        Game.checkpoint = true;
        Player.control = false;
        Player.autoCenter = true;
        Player.endGlide(false);
        Player.bossBounds = true;
        screenClass('show-warning', true);
        Game.later(3.4, () => screenClass('show-warning', false));
        sound.alarm();
        Boss.start();
        for (let i = 0; i < 5; i++) World.spawnCloud(rand(-50, 50), rand(30, 60), Game.railZ - rand(110, 170), rand(1.4, 2));
        UI.objective('DERRIBAR EL ZEPPELIN «WALKÜRE»');
        Comms.say('raskova', '¡¿Qué es eso entre las nubes?! ¡Un dirigible blindado!', { urgent: true });
        CameraRig.set('bossReveal');
      },

      onBossDefeated() {
        this.phase = 'bossDeath';
        this.endT = 0;
        Game.timeScale = 0.35;
        Player.control = false;
        Player.autoCenter = true;
        Player.endGlide(false);
        EnemyBullets.clear();
        entities.forEach((e) => { if (e.kind === 'mine' || e.kind === 'cluster') e.destroy(false); });
        screenClass('boss-on', false);
        UI.banner('¡EL «WALKÜRE» SE ESTÁ PARTIENDO!', 'good');
        Comms.say('bersh', '¡Se está partiendo en dos! ¡Aléjate de ahí!', { urgent: true });
        CameraRig.set('bossDeath');
      },

      onBossFinal() {
        sound.fadeLevel(0.5);
      },

      victory() {
        this.phase = 'victory';
        this.endT = 0;
        Game.timeScale = 1;
        UI.objective('MISIÓN CUMPLIDA');
        Comms.say('raskova', 'Lo has hecho, bruja. Regresa a casa… la noche todavía es nuestra.', { urgent: true });
        CameraRig.set('victory');
      },

      onPlayerDown() {
        UI.banner('¡ALCANZADA!', 'bad');
        Comms.say('raskova', '¡No! ¡Ha caído! ¡Salta… no, no llevamos paracaídas!', { urgent: true });
        CameraRig.set('death');
      },

      onPlayerCrash() {
        this.phase = 'dead';
        sound.fadeLevel(0.35);
        Game.later(1.8, () => {
          if (Game.state === 'play') UI.showGameOver();
        });
      }
    };

    function updateEntities(dt) {
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.gone) continue;
        e.prevPos.copy(e.obj.position);
        e.age += dt;
        e.update(dt);
        if (dt > 0) e.vel.copy(e.obj.position).sub(e.prevPos).divideScalar(dt);
      }
      let w = 0;
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.gone) e.remove();
        else entities[w++] = e;
      }
      entities.length = w;
    }

    /* --- Cámara de juego y cámaras cinematográficas --- */
    const CameraRig = {
      mode: 'game',
      t: 0,
      pos: new V3(0, 10, 12),
      look: new V3(0, 9, -20),
      fov: 62,
      roll: 0,
      snap: false,
      gp: new V3(),
      gl: new V3(),

      set(mode) {
        this.mode = mode;
        this.t = 0;
      },

      gameTargets() {
        const p = Player.pos;
        const z = Game.railZ;
        this.gp.set(p.x * 0.6, 4.2 + p.y * 0.72, z + 12.5);
        this.gl.set(p.x * 0.82, p.y * 0.86 + 1.0, z - 26);
      },

      update(dt) {
        this.t += dt;
        this.gameTargets();
        const gp = this.gp;
        const gl = this.gl;
        let fovT = 62;
        let rollT = Player.bank * 0.22 + Math.sin(Player.rollAngle) * 0.06;
        switch (this.mode) {
          case 'levelStart': {
            const u = clamp(this.t / 2.8, 0, 1);
            const e = easeInOut(u);
            const ang = e * Math.PI;
            const w = Player.wpos;
            tmpV.set(w.x + Math.sin(ang) * 7, w.y + 1.2 + e * 2.2, w.z - Math.cos(ang) * 10);
            this.pos.copy(tmpV).lerp(gp, smoothstep(0.72, 1, u));
            this.look.copy(w).lerp(gl, smoothstep(0.6, 1, u));
            rollT = 0;
            if (u >= 1) this.mode = 'game';
            break;
          }
          case 'bossReveal': {
            const k = smoothstep(0, 1.3, this.t) * (1 - smoothstep(4.3, 5.4, this.t));
            tmpV.copy(gp).add(tmpV2.set(-6 * k, -2.5 * k, 4 * k));
            this.pos.x = damp(this.pos.x, tmpV.x, 4, dt);
            this.pos.y = damp(this.pos.y, tmpV.y, 4, dt);
            this.pos.z = tmpV.z;
            tmpV3.copy(gl).lerp(Boss.root.position, k);
            this.look.lerp(tmpV3, 1 - Math.exp(-5 * dt));
            fovT = lerp(62, 48, k);
            rollT = -0.05 * k;
            if (this.t > 5.4) this.mode = 'game';
            break;
          }
          case 'bossDeath': {
            const c = Boss.root.position;
            const ang = 0.5 + this.t * 0.32;
            tmpV.set(c.x + Math.sin(ang) * 62, Math.max(c.y + 6, 14), c.z + Math.cos(ang) * 62);
            tmpV.y = Math.max(tmpV.y, terrainHeight(tmpV.x, tmpV.z) + 6);
            this.pos.lerp(tmpV, 1 - Math.exp(-2.5 * dt));
            this.look.lerp(c, 1 - Math.exp(-4 * dt));
            fovT = 55;
            rollT = 0;
            break;
          }
          case 'victory': {
            const w = Player.wpos;
            const ang = this.t * 0.45;
            tmpV.set(w.x + Math.sin(ang) * 10, w.y + 2.5, w.z + Math.cos(ang) * 10);
            this.pos.lerp(tmpV, 1 - Math.exp(-2 * dt));
            this.look.lerp(w, 1 - Math.exp(-4 * dt));
            rollT = 0;
            break;
          }
          case 'death': {
            const w = Player.wpos;
            this.pos.x = damp(this.pos.x, w.x * 0.5, 2, dt);
            this.pos.y = damp(this.pos.y, Math.max(w.y + 4, 5), 2, dt);
            this.pos.z = damp(this.pos.z, w.z + 16, 3, dt);
            this.look.lerp(w, 1 - Math.exp(-6 * dt));
            rollT = 0;
            break;
          }
          default: {
            if (this.snap) {
              this.pos.copy(gp);
              this.look.copy(gl);
            }
            this.pos.x = damp(this.pos.x, gp.x, 5, dt);
            this.pos.y = damp(this.pos.y, gp.y, 5, dt);
            this.pos.z = gp.z;
            this.look.x = damp(this.look.x, gl.x, 6, dt);
            this.look.y = damp(this.look.y, gl.y, 6, dt);
            this.look.z = gl.z;
            if (Player.looping) {
              const k = Math.sin(clamp(Player.loopT, 0, 1) * Math.PI);
              this.pos.x += k * 6;
              this.pos.y += k * 3.5;
              this.pos.z += k * 1.5;
              this.look.lerp(Player.wpos, k);
              rollT *= 1 - k;
            }
            break;
          }
        }
        this.snap = false;
        this.fov = damp(this.fov, fovT, 3, dt);
        this.roll = damp(this.roll, rollT, 5, dt);
        this.apply();
      },

      apply() {
        camera.position.copy(this.pos);
        if (FX.shake > 0) {
          const s = FX.shake * FX.shake;
          camera.position.x += rand(-1, 1) * s;
          camera.position.y += rand(-1, 1) * s;
        }
        camera.lookAt(this.look);
        camera.rotateZ(this.roll);
        if (Math.abs(camera.fov - this.fov) > 0.05) {
          camera.fov = this.fov;
          camera.updateProjectionMatrix();
        }
      }
    };

    /* ====================================================================
       19. CINEMÁTICA INICIAL Y ESCENA DEL MENÚ
       ==================================================================== */
    const Intro = {
      slides: [
        {
          date: 'OCTUBRE DE 1941 · UNIÓN SOVIÉTICA',
          text: 'Por orden de la legendaria aviadora Marina Raskova nace un regimiento formado por mujeres: el 588.º Regimiento de Bombardeo Nocturno.\nEn combate lo liderará la comandante Yevdokía Bershánskaya.',
          shot: 'wide'
        },
        {
          date: 'LA AERONAVE',
          text: 'Polikarpov Po-2: un biplano de entrenamiento de madera contrachapada y lona.\nLento, con la cabina abierta al frío glacial… y sin paracaídas: cada kilo ahorrado era una bomba más.',
          shot: 'orbit'
        },
        {
          date: 'LA TÁCTICA',
          text: 'Vuelan en la oscuridad total. Sobre el objetivo apagan el motor y planean en silencio.\nEl viento silba entre la madera y la lona como una escoba barriendo el cielo…',
          shot: 'glide'
        },
        {
          date: 'EL TERROR ALEMÁN',
          text: 'Los soldados enemigos, aterrados, les dan un nombre:\n«NACHTHEXEN»… LAS BRUJAS DE LA NOCHE.',
          shot: 'ground'
        },
        {
          date: 'LEGADO',
          text: 'Más de 23.600 misiones de combate.\nMás de 3.000 toneladas de bombas lanzadas.\n23 aviadoras condecoradas como Heroínas de la Unión Soviética.',
          shot: 'formation'
        },
        { title: true, shot: 'moon' }
      ],
      i: -1,
      t: 0,
      total: 0,
      shown: 0,
      hero: new V3(),
      formation: null,
      propSpeed: 40,
      propOn: true,
      groundCam: new V3(),

      start() {
        Level.cleanup();
        clearEntities();
        World.clearClouds();
        FX.clear();
        Player.reset();
        Player.obj.visible = true;
        if (!this.formation) {
          this.formation = [];
          const offsets = [[-6, -0.8, 6], [6, -0.8, 6], [-12, -1.6, 12], [12, -1.6, 12], [-18, -2.4, 18], [18, -2.4, 18], [0, 1.4, 14]];
          offsets.forEach((o) => {
            const m = TEMPLATES.po2.clone();
            m.visible = false;
            scene.add(m);
            this.formation.push({ obj: m, off: new V3(o[0], o[1], o[2]), prop: m.getObjectByName('prop'), ph: Math.random() * 6 });
          });
        }
        this.formation.forEach((f) => { f.obj.visible = false; });
        this.i = -1;
        this.total = 0;
        this.propSpeed = 40;
        this.propOn = true;
        sound.stopLevel();
        sound.startTheme('intro');
        sound.setEngine(0.8, 0.95, 0.4);
        sound.setWind(0.2);
        el.intro.classList.remove('is-title');
        UI.setState('intro');
        this.next();
      },

      next() {
        this.i++;
        if (this.i >= this.slides.length) {
          this.finish();
          return;
        }
        const s = this.slides[this.i];
        this.t = 0;
        this.shown = 0;
        setText(el.introDate, s.date || '');
        setText(el.introText, '');
        el.intro.classList.toggle('is-title', !!s.title);
        this.setupShot(s.shot);
      },

      duration(s) {
        return s.title ? 6 : 0.6 + s.text.length / 38 + 2.6;
      },

      setupShot(shot) {
        const H = this.hero;
        clearEntities();
        if (shot === 'glide') {
          this.propOn = false;
          sound.engineCut();
          sound.setEngine(0, 0.4, 0.6);
          sound.setWind(1, 1.2);
          [[-18, 80, 0.5], [4, 105, -0.2], [20, 130, -0.5]].forEach((p) => {
            addEntity(new Searchlight(p[0], Game.railZ - p[1], { decor: true, yaw: p[2] }));
          });
        } else if (shot === 'ground') {
          const gz = Game.railZ - 72;
          this.groundCam.set(H.x + 9, terrainHeight(H.x + 9, gz) + 2.6, gz);
          addEntity(new Searchlight(H.x + 14, gz - 4, { decor: true, track: Player.obj }));
          addEntity(new Searchlight(H.x - 16, gz - 20, { decor: true, yaw: 0.4 }));
          this.flakT = 0.8;
        } else if (shot === 'formation') {
          this.propOn = true;
          sound.engineStart();
          sound.setEngine(1, 1, 0.5);
          sound.setWind(0.2);
          this.formation.forEach((f) => { f.obj.visible = true; });
        }
      },

      finish() {
        if (Game.state !== 'intro') return;
        clearEntities();
        if (this.formation) this.formation.forEach((f) => { f.obj.visible = false; });
        el.intro.classList.remove('is-title');
        MenuScene.enter();
        UI.setState('menu');
      },

      update(dt) {
        const s = this.slides[this.i];
        if (!s) return;
        this.t += dt;
        this.total += dt;
        const T = this.total;
        // Vuelo del biplano protagonista
        Game.railZ -= 22 * dt;
        const H = this.hero.set(Math.sin(T * 0.3) * 2, 14 + Math.sin(T * 0.8) * 0.6, Game.railZ);
        const hero = Player.obj;
        hero.position.copy(H);
        Player.fill.position.set(H.x - 2, H.y + 4, H.z + 5);
        tmpV.set(Math.cos(T * 0.3) * 0.6, Math.cos(T * 0.8) * 0.48, -22).normalize();
        orientQuat(hero.quaternion, tmpV, -Math.cos(T * 0.3) * 0.12);
        this.propSpeed = damp(this.propSpeed, this.propOn ? 42 : 0, this.propOn ? 3 : 1.2, dt);
        Player.prop.rotation.z += this.propSpeed * dt;
        Player.disc.visible = this.propSpeed > 20;
        Player.exhaust.visible = this.propOn;
        if (!this.propOn && Math.random() < 0.7) {
          const side = Math.random() < 0.5 ? -1 : 1;
          FX.windStreak(hero.localToWorld(tmpV.set(side * rand(1.2, 2.3), rand(-0.2, 0.9), rand(-0.6, 0.2))));
        }
        this.formation.forEach((f) => {
          if (!f.obj.visible) return;
          f.obj.position.set(H.x + f.off.x, H.y + f.off.y + Math.sin(T * 1.3 + f.ph) * 0.3, H.z + f.off.z);
          f.obj.quaternion.copy(hero.quaternion);
          f.prop.rotation.z += 40 * dt;
        });

        // Texto de máquina de escribir
        if (!s.title) {
          const target = Math.min(s.text.length, Math.max(0, Math.floor((this.t - 0.6) * 38)));
          while (this.shown < target) {
            const ch = s.text[this.shown];
            this.shown++;
            if (ch === '\n') sound.typeBell();
            else if (ch !== ' ') sound.typeTick();
          }
          setText(el.introText, s.text.slice(0, this.shown));
        }

        // Plano de cámara
        const u = clamp(this.t / this.duration(s), 0, 1);
        const cp = tmpV2;
        const lk = tmpV3;
        switch (s.shot) {
          case 'wide':
            cp.set(H.x + 16 - u * 6, H.y - 5 + u * 2, H.z + 24 - u * 6);
            lk.set(H.x, H.y + 0.5, H.z - 4);
            break;
          case 'orbit': {
            const a = lerp(0.35 * Math.PI, 1.25 * Math.PI, easeInOut(u));
            cp.set(H.x + Math.sin(a) * 6.5, H.y + 1.2 + Math.sin(u * Math.PI), H.z + Math.cos(a) * 6.5);
            lk.copy(H);
            break;
          }
          case 'glide':
            cp.set(H.x + 4 - u * 2, H.y - 4.5, H.z + 13 - u * 3);
            lk.set(H.x, H.y - 1.5, H.z - 14);
            break;
          case 'ground':
            cp.copy(this.groundCam);
            lk.copy(H);
            this.flakT -= dt;
            if (this.flakT <= 0) {
              this.flakT = rand(0.5, 1.1);
              FX.flak(new V3(H.x + rand(-14, 14), H.y + rand(-3, 8), H.z - rand(5, 30)));
            }
            break;
          case 'formation':
            cp.set(H.x, H.y + 6 + u * 8, H.z + 28 + u * 30);
            lk.set(H.x, H.y, H.z - 15);
            break;
          default: {
            cp.set(H.x, H.y + 4, H.z + 30);
            tmpV.copy(cp).addScaledVector(World.moonDir, 100);
            lk.copy(H).lerp(tmpV, easeInOut(clamp(u * 1.6, 0, 1)));
            break;
          }
        }
        camera.position.copy(cp);
        camera.lookAt(lk);
        if (camera.fov !== 58) {
          camera.fov = 58;
          camera.updateProjectionMatrix();
        }
        updateEntities(dt);
        if (this.t >= this.duration(s)) this.next();
      }
    };

    const MenuScene = {
      t: 0,
      spawnT: 0,
      flakT: 2,

      enter() {
        this.t = 0;
        this.spawnT = 0;
        clearEntities();
        FX.clear();
        World.clearClouds();
        Boss.remove();
        Player.reset();
        Game.timeScale = 1;
        World.fogTarget = FOG_BASE;
        sound.stopLevel();
        sound.startTheme('menu');
        sound.setEngine(0.28, 0.9, 0.5);
        sound.setWind(0.1);
        sound.setGlide(false, true);
        sound.setDrone(0);
        for (let i = 0; i < 4; i++) World.spawnCloud(rand(-90, 90), rand(28, 50), Game.railZ - rand(60, 260), rand(1, 1.8));
        World.spawnTrench(Game.railZ - 120);
        this.trenchT = 6;
      },

      update(dt) {
        this.t += dt;
        const t = this.t;
        Game.railZ -= 16 * dt;
        const x = Math.sin(t * 0.35) * 3;
        const y = 13 + Math.sin(t * 0.7) * 0.8;
        const hero = Player.obj;
        hero.visible = true;
        hero.position.set(x, y, Game.railZ);
        Player.fill.position.set(x - 2, y + 4, Game.railZ + 5);
        tmpV.set(Math.cos(t * 0.35) * 0.06, Math.cos(t * 0.7) * 0.035, -1).normalize();
        orientQuat(hero.quaternion, tmpV, -Math.cos(t * 0.35) * 0.35);
        Player.prop.rotation.z += 40 * dt;
        Player.disc.visible = true;
        Player.exhaust.visible = true;
        const a = t * 0.11 + 0.8;
        camera.position.set(x + Math.sin(a) * 10.5, y + 2.4 + Math.sin(t * 0.23) * 1.6, Game.railZ + Math.cos(a) * 10.5);
        camera.lookAt(x, y + 0.3, Game.railZ - 1);
        camera.rotateY(0.5);
        camera.rotateX(0.06);
        if (camera.fov !== 60) {
          camera.fov = 60;
          camera.updateProjectionMatrix();
        }
        // Ambiente: reflectores lejanos, Flak y nubes
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          this.spawnT = rand(6, 9);
          const side = randSign();
          addEntity(new Searchlight(side * rand(26, 48), Game.railZ - rand(120, 200), { decor: true, yaw: -side * 0.4 }));
          World.spawnCloud(rand(-100, 100), rand(26, 50), Game.railZ - rand(220, 300), rand(1, 1.8));
        }
        this.trenchT -= dt;
        if (this.trenchT <= 0) {
          this.trenchT = rand(10, 16);
          World.spawnTrench(Game.railZ - 230);
        }
        this.flakT -= dt;
        if (this.flakT <= 0) {
          this.flakT = rand(1.8, 3.6);
          FX.flak(new V3(rand(-80, 80), rand(24, 48), Game.railZ - rand(90, 220)));
        }
        updateEntities(dt);
      }
    };

    /* ====================================================================
       20. POST-PROCESADO CRT: curvatura, aberración cromática, grano y
           cuantización de color con tramado ordenado (estilo PS1)
       ==================================================================== */
    const POST_VS = [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = vec4(position.xy, 0.0, 1.0);',
      '}'
    ].join('\n');

    const POST_FS = [
      'uniform sampler2D tDiffuse;',
      'uniform vec2 uRes;',
      'uniform float uTime;',
      'uniform float uCurve;',
      'uniform float uAberr;',
      'uniform float uDither;',
      'uniform float uGlide;',
      'uniform float uHit;',
      'uniform float uFlash;',
      'varying vec2 vUv;',
      'float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }',
      'float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }',
      'void main() {',
      '  vec2 cc = vUv * 2.0 - 1.0;',
      '  float r2 = dot(cc, cc);',
      '  vec2 duv = cc * (1.0 + uCurve * r2);',
      '  vec2 suv = duv * 0.5 + 0.5;',
      '  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }',
      '  vec2 off = duv * uAberr * 0.8 / uRes;',
      '  vec3 col;',
      '  col.r = texture2D(tDiffuse, suv + off).r;',
      '  col.g = texture2D(tDiffuse, suv).g;',
      '  col.b = texture2D(tDiffuse, suv - off).b;',
      '  float lum = dot(col, vec3(0.299, 0.587, 0.114));',
      '  col = mix(col, vec3(lum) * vec3(0.72, 0.9, 1.2), uGlide * 0.45);',
      '  col = mix(col, vec3(lum * 1.4 + 0.18, 0.03, 0.02), uHit * 0.45);',
      '  col += vec3(uFlash * 0.95, uFlash * 0.85, uFlash * 0.7);',
      '  float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime * 61.0, uTime * 17.0), vec2(12.9898, 78.233))) * 43758.5453);',
      '  col += (n - 0.5) * 0.04;',
      '  float d = (bayer4(gl_FragCoord.xy) - 0.5) * uDither;',
      '  col = floor(col * 31.0 + 0.5 + d) / 31.0;',
      '  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
      '}'
    ].join('\n');

    const Post = {
      hit: 0,
      curve: 0.055,
      aberr: 1,
      dither: 1,
      glide: 0,

      init() {
        this.rt = new THREE.WebGLRenderTarget(4, 4, {
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: true,
          stencilBuffer: false
        });
        this.rt.texture.generateMipmaps = false;
        this.mat = new THREE.ShaderMaterial({
          uniforms: {
            tDiffuse: { value: this.rt.texture },
            uRes: { value: new THREE.Vector2(4, 4) },
            uTime: { value: 0 },
            uCurve: { value: this.curve },
            uAberr: { value: this.aberr },
            uDither: { value: this.dither },
            uGlide: { value: 0 },
            uHit: { value: 0 },
            uFlash: { value: 0 }
          },
          vertexShader: POST_VS,
          fragmentShader: POST_FS,
          depthTest: false,
          depthWrite: false
        });
        this.scene = new THREE.Scene();
        this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
        quad.frustumCulled = false;
        this.scene.add(quad);
      },

      configure(level) {
        const map = { off: [0, 0, 0.6], low: [0.03, 0.6, 1], medium: [0.055, 1, 1], high: [0.09, 1.7, 1] };
        const v = map[level] || map.medium;
        this.curve = v[0];
        this.aberr = v[1];
        this.dither = v[2];
        if (this.mat) {
          this.mat.uniforms.uCurve.value = this.curve;
          this.mat.uniforms.uAberr.value = this.aberr;
          this.mat.uniforms.uDither.value = this.dither;
        }
      },

      setSize(w, h) {
        this.rt.setSize(w, h);
        this.mat.uniforms.uRes.value.set(w, h);
      },

      /* Pantalla → imagen original (para apuntar con el ratón) */
      toSource(x, y) {
        const k = 1 + this.curve * (x * x + y * y);
        return { x: x * k, y: y * k };
      },

      /* Imagen original → pantalla (para colocar las retículas) */
      toScreen(sx, sy) {
        let cx = sx;
        let cy = sy;
        for (let i = 0; i < 4; i++) {
          const k = 1 + this.curve * (cx * cx + cy * cy);
          cx = sx / k;
          cy = sy / k;
        }
        return { x: cx, y: cy };
      },

      update(dt) {
        const u = this.mat.uniforms;
        u.uTime.value += dt;
        this.hit = Math.max(0, this.hit - dt * 3.5);
        u.uHit.value = this.hit;
        u.uFlash.value = Math.min(1, FX.flash);
        this.glide = damp(this.glide, Player.gliding && Game.state === 'play' ? 1 : 0, 3, dt);
        u.uGlide.value = this.glide;
      },

      render() {
        renderer.setRenderTarget(this.rt);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.cam);
      }
    };

    /* ====================================================================
       21. BUCLE PRINCIPAL Y ESTADOS
       ==================================================================== */
    const Main = {
      booted: false,

      boot() {
        if (this.booted) return;
        this.booted = true;
        sound.init();
        sound.applyVolumes();
        Intro.start();
      },

      toMenu() {
        Level.cleanup();
        sound.stopLevel();
        MenuScene.enter();
        UI.setState('menu');
      },

      pause() {
        if (Game.state !== 'play' || Level.phase === 'victory' || Level.phase === 'dead') return;
        Input.mouse.left = false;
        UI.setState('pause');
        sound.pauseLevel();
      },

      resume() {
        if (Game.state !== 'pause') return;
        UI.setState('play');
        sound.resumeLevel();
      },

      resize() {
        const w = Math.max(1, window.innerWidth);
        const h = Math.max(1, window.innerHeight);
        const H = Settings.data.res || 270;
        const W = Math.max(160, Math.round((H * w) / h));
        renderer.setSize(W, H, false);
        Post.setSize(W, H);
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        SNAP.value.set(W / 2, H / 2);
      }
    };

    function warmup() {
      // Compila los shaders por adelantado para evitar tirones la primera vez
      const g = new THREE.Group();
      const list = [TEMPLATES.fighter, TEMPLATES.searchlight, TEMPLATES.flak, TEMPLATES.tower, TEMPLATES.fuel,
        TEMPLATES.crateRepair, TEMPLATES.crateBomb, TEMPLATES.mine, TEMPLATES.cluster, TEMPLATES.rocket,
        TEMPLATES.heavy, TEMPLATES.ally];
      list.forEach((t, i) => {
        const c = t.clone();
        c.position.set(i * 3 - 18, 10, Game.railZ - 30);
        g.add(c);
      });
      Boss.build();
      g.add(Boss.root);
      const beam = new THREE.Mesh(BEAM_GEO, glowMat(0xffffff, 0.1));
      g.add(beam);
      scene.add(g);
      try {
        renderer.compile(scene, camera);
        renderer.compile(Post.scene, Post.cam);
      } catch (e) { /* la compilación diferida no es crítica */ }
      scene.remove(g);
      g.remove(Boss.root);
    }

    // Inicialización
    World.init();
    FX.init();
    Player.init();
    Post.init();
    UI.init();
    Input.init();
    Main.resize();
    MenuScene.enter();
    warmup();

    window.addEventListener('resize', () => Main.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) Main.pause();
    });
    // Evita cerrar la pestaña por accidente (p. ej. Ctrl + W mientras se usa Ctrl para bombardear)
    window.addEventListener('beforeunload', (e) => {
      if (Game.state === 'play' || Game.state === 'pause') {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // Gancho de depuración opcional: añade ?debug a la URL
    if (/[?&]debug\b/.test(window.location.search)) {
      window.NH = { Game, Level, Player, Boss, Main, Intro, UI, Settings, sound, entities, Comms, MenuScene, addEntity, Searchlight, FlakGun, Fighter };
    }

    let last = performance.now();
    function frame(now) {
      window.requestAnimationFrame(frame);
      let dt = (now - last) / 1000;
      last = now;
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, 0.05);
      Game.time += dt;
      sound.update(dt);
      const st = Game.state;
      if (st === 'boot' || st === 'menu' || st === 'options' || st === 'controls' || st === 'chapters') {
        MenuScene.update(dt);
        if (st === 'chapters') UI.drawMap(Game.time);
      } else if (st === 'intro') {
        Intro.update(dt);
      } else if (st === 'play' || st === 'results' || st === 'gameover') {
        Level.update(dt);
      }
      if (st !== 'pause') {
        FX.update(st === 'play' ? dt * Game.timeScale : dt);
        World.update(dt, Game.time);
      }
      if (st === 'play' || st === 'pause') UI.updateHUD();
      Post.update(st === 'pause' ? 0 : dt);
      Post.render();
    }
    window.requestAnimationFrame(frame);
  }
})();
