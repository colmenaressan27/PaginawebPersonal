'use strict';
/* =========================================================================
   GOBLINZ MASSACRE
   FPS retro de supervivencia por oleadas — estilo Wolfenstein 3D / DOOM (1993)
   Creado por Santiago Colmenares

   Motor: raycaster propio sobre Canvas 2D (paredes texturizadas, suelo y techo
   proyectados, cielo panorámico, sprites con z-buffer, iluminación por sector).
   Todo el arte (texturas, goblins, armas, efectos) se genera por código, así que
   el juego sólo necesita estos archivos + Elmenu.mp3 y Musicanivel.mp3.

   Índice:
     0. Utilidades           6. Mapa y luces
     1. Ajustes              7. Renderizador
     2. Audio (música+SFX)   8. Jugador, armas y combate
     3. Pintor de píxeles    9. Enemigos, proyectiles y oleadas
     4. Texturas y sprites  10. Tienda y economía
     5. Armas en primera     11. Interfaz, menús y scoreboard
        persona y HUD        12. Bucle principal
   ========================================================================= */
(function () {

  // =======================================================================
  // 0. UTILIDADES
  // =======================================================================
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const TAU = Math.PI * 2;
  let _seed = 1;
  const setSeed = (s) => { _seed = s; };
  const srand = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* almacenamiento bloqueado */ } }
  };

  // =======================================================================
  // 1. AJUSTES (persisten en localStorage)
  // =======================================================================
  const DEFAULTS = {
    master: 0.8, music: 0.6, sfx: 0.8, sens: 1.0, fov: 80, res: 320, diff: 1,
    invertY: false, shake: true, crt: true, minimap: true, showFps: false
  };
  const settings = Object.assign({}, DEFAULTS, store.get('gm_settings', {}));
  const saveSettings = () => store.set('gm_settings', settings);

  const DIFFS = [
    { name: 'Goblin bebé', hp: 0.75, dmg: 0.55, count: 0.8, gold: 1.25 },
    { name: 'Masacre normal', hp: 1.0, dmg: 1.0, count: 1.0, gold: 1.0 },
    { name: 'Pesadilla verde', hp: 1.3, dmg: 1.5, count: 1.25, gold: 0.9 }
  ];

  // =======================================================================
  // 2. AUDIO — música (archivos locales) + efectos sintetizados en vivo
  // =======================================================================
  const AudioSys = {
    ctx: null, out: null, noiseBuf: null, unlocked: false, muted: false, duck: 1,
    last: {},
    music: {
      menu: { el: $('musicMenu'), cur: 0, tgt: 0, ok: true, pending: false, file: 'Elmenu.mp3' },
      level: { el: $('musicLevel'), cur: 0, tgt: 0, ok: true, pending: false, file: 'Musicanivel.mp3' }
    },

    init() {
      for (const k in this.music) {
        const m = this.music[k];
        m.el.volume = 0;
        m.el.addEventListener('error', () => { m.ok = false; UI.audioStatus(); });
        m.el.addEventListener('canplaythrough', () => { m.ok = true; UI.audioStatus(); });
      }
    },

    // El navegador sólo deja sonar audio tras una interacción del usuario.
    unlock() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          try {
            this.ctx = new AC();
            const comp = this.ctx.createDynamicsCompressor();
            comp.threshold.value = -14; comp.ratio.value = 6;
            this.out = this.ctx.createGain();
            this.out.connect(comp); comp.connect(this.ctx.destination);
            const len = Math.floor(this.ctx.sampleRate * 1.2);
            this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
            const d = this.noiseBuf.getChannelData(0);
            for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
          } catch (e) { this.ctx = null; }
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      this.unlocked = true;
      this.applyVolumes();
    },

    applyVolumes() { if (this.out) this.out.gain.value = settings.master * settings.sfx; },

    // which: 'menu' | 'level' | null  → fundido cruzado entre pistas
    setMusic(which, restart) {
      this.music.menu.tgt = which === 'menu' ? 1 : 0;
      this.music.level.tgt = which === 'level' ? 1 : 0;
      if (restart && which && this.music[which]) {
        try { this.music[which].el.currentTime = 0; } catch (e) { /* aún no cargado */ }
      }
    },

    toggleMute() { this.muted = !this.muted; return this.muted; },

    update(dt) {
      for (const k in this.music) {
        const m = this.music[k];
        const speed = m.tgt > m.cur ? 0.7 : 1.1;
        m.cur = m.cur < m.tgt ? Math.min(m.tgt, m.cur + dt * speed) : Math.max(m.tgt, m.cur - dt * speed);
        const duck = k === 'level' ? this.duck : 1;
        const v = this.muted ? 0 : clamp(m.cur * settings.master * settings.music * duck, 0, 1);
        if (Math.abs(m.el.volume - v) > 0.002) m.el.volume = v;
        if (m.cur > 0.001 && m.el.paused && this.unlocked && m.ok && !m.pending) {
          m.pending = true;
          const p = m.el.play();
          if (p && p.then) p.then(() => { m.pending = false; }).catch(() => { m.pending = false; m.ok = false; UI.audioStatus(); });
          else m.pending = false;
        } else if (m.cur <= 0.001 && m.tgt === 0 && !m.el.paused) {
          m.el.pause();
        }
      }
    },

    // ---- Primitivas de síntesis ----
    _out(node, pan) {
      if (pan && this.ctx.createStereoPanner) {
        const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
        node.connect(p); p.connect(this.out);
      } else node.connect(this.out);
    },
    tone(type, f0, f1, dur, vol, delay = 0, pan = 0) {
      const c = this.ctx; const t = c.currentTime + delay;
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); this._out(g, pan);
      o.start(t); o.stop(t + dur + 0.05);
    },
    noise(dur, vol, ftype, f0, f1, q = 1, delay = 0, pan = 0) {
      const c = this.ctx; const t = c.currentTime + delay;
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); this._out(g, pan);
      s.start(t, Math.random() * 0.6); s.stop(t + dur + 0.05);
    },

    // ---- Banco de efectos ----
    play(name, vol = 1, pan = 0, pitch = 1) {
      if (!this.ctx || !this.unlocked || vol < 0.01) return;
      const now = performance.now();
      if (this.last[name] && now - this.last[name] < 28) return;
      this.last[name] = now;
      const v = vol, p = pan, k = pitch;
      switch (name) {
        case 'axe': this.noise(0.2, 0.5 * v, 'bandpass', 1400, 350, 2, 0, p); break;
        case 'axehit': this.noise(0.14, 0.7 * v, 'lowpass', 900, 200, 1, 0, p); this.tone('square', 130, 55, 0.12, 0.3 * v, 0, p); break;
        case 'pistol': this.noise(0.17, 0.65 * v, 'lowpass', 3200, 300, 1, 0, p); this.tone('square', 190, 60, 0.09, 0.3 * v, 0, p); break;
        case 'shotgun':
          this.noise(0.42, 1.0 * v, 'lowpass', 2600, 140, 1, 0, p); this.tone('sawtooth', 95, 38, 0.25, 0.45 * v, 0, p);
          this.noise(0.05, 0.35 * v, 'highpass', 2500, 2500, 1, 0.42, p); this.noise(0.05, 0.35 * v, 'highpass', 1800, 1800, 1, 0.55, p);
          break;
        case 'chaingun': this.noise(0.09, 0.5 * v, 'lowpass', 3600, 500, 1, 0, p); this.tone('square', 230, 100, 0.05, 0.22 * v, 0, p); break;
        case 'rocket': this.noise(0.55, 0.55 * v, 'bandpass', 380, 1600, 1.5, 0, p); this.tone('sawtooth', 80, 210, 0.4, 0.25 * v, 0, p); break;
        case 'explode':
          this.noise(1.1, 1.2 * v, 'lowpass', 1400, 50, 0.8, 0, p); this.tone('sine', 85, 28, 0.7, 0.7 * v, 0, p);
          this.noise(0.3, 0.5 * v, 'highpass', 1500, 400, 1, 0, p);
          break;
        case 'empty': this.tone('square', 900, 700, 0.04, 0.18 * v); this.tone('square', 600, 500, 0.03, 0.12 * v, 0.06); break;
        case 'switch': this.noise(0.06, 0.25 * v, 'highpass', 2200, 2200); this.tone('square', 380, 620, 0.06, 0.12 * v, 0.02); break;
        case 'gob_hurt': { const f = rand(520, 720) * k; this.tone('square', f, f * 0.55, 0.16, 0.28 * v, 0, p); break; }
        case 'gob_die': {
          const f = rand(650, 820) * k;
          this.tone('square', f, 80 * k, 0.5, 0.3 * v, 0, p); this.tone('sawtooth', f * 1.5, 120 * k, 0.4, 0.15 * v, 0.02, p);
          this.noise(0.22, 0.45 * v, 'lowpass', 700, 150, 1, 0.05, p);
          break;
        }
        case 'gob_laugh': {
          const f = rand(600, 760) * k;
          for (let i = 0; i < 4; i++) this.tone('square', f * (i % 2 ? 1.25 : 1), f * (i % 2 ? 1.1 : 0.9), 0.07, 0.17 * v, i * 0.085, p);
          break;
        }
        case 'gob_attack': this.tone('sawtooth', 320 * k, 150 * k, 0.14, 0.22 * v, 0, p); break;
        case 'roar': this.tone('sawtooth', 130 * k, 55 * k, 0.65, 0.45 * v, 0, p); this.noise(0.6, 0.35 * v, 'lowpass', 500, 150, 1, 0, p); break;
        case 'player_hurt': this.tone('sawtooth', 170, 90, 0.24, 0.35 * v); this.noise(0.16, 0.3 * v, 'lowpass', 600, 200); break;
        case 'player_die': this.tone('sawtooth', 220, 35, 1.3, 0.5 * v); this.tone('square', 160, 30, 1.1, 0.25 * v, 0.1); break;
        case 'coin': this.tone('square', 1250, 1250, 0.06, 0.13 * v); this.tone('square', 1870, 1870, 0.14, 0.13 * v, 0.06); break;
        case 'pickup': [440, 660, 880].forEach((f, i) => this.tone('triangle', f, f, 0.08, 0.25 * v, i * 0.055)); break;
        case 'heal': this.tone('sine', 480, 980, 0.35, 0.3 * v); this.tone('triangle', 720, 1440, 0.3, 0.15 * v, 0.05); break;
        case 'buy': this.play('coin', v); [523, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.09, 0.14 * v, 0.12 + i * 0.07)); break;
        case 'nobuy': this.tone('square', 160, 110, 0.25, 0.25 * v); break;
        case 'wave':
          [220, 277, 330, 440].forEach((f) => this.tone('sawtooth', f, f * 0.98, 1.1, 0.12 * v));
          this.noise(0.4, 0.6 * v, 'lowpass', 300, 80); this.noise(0.4, 0.6 * v, 'lowpass', 300, 80, 1, 0.45);
          break;
        case 'wave_clear': [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone('triangle', f, f, 0.16, 0.25 * v, i * 0.09)); break;
        case 'arrow': this.noise(0.28, 0.22 * v, 'bandpass', 2800, 1100, 9, 0, p); break;
        case 'fireball': this.noise(0.45, 0.4 * v, 'bandpass', 280, 1000, 2, 0, p); this.tone('sine', 120, 260, 0.35, 0.15 * v, 0, p); break;
        case 'fuse': this.noise(0.35, 0.14 * v, 'highpass', 4500, 6000, 1, 0, p); break;
        case 'dash': this.noise(0.22, 0.35 * v, 'bandpass', 500, 2400, 2); break;
        case 'jump': this.tone('square', 210, 420, 0.08, 0.1 * v); break;
        case 'land': this.noise(0.08, 0.3 * v, 'lowpass', 320, 120); break;
        case 'spawn': this.tone('sine', 180, 820, 0.35, 0.2 * v, 0, p); this.noise(0.3, 0.2 * v, 'bandpass', 600, 2000, 3, 0, p); break;
        case 'boss': this.tone('sawtooth', 65, 38, 1.8, 0.6 * v); this.tone('square', 98, 49, 1.6, 0.3 * v, 0.1); this.noise(1.5, 0.5 * v, 'lowpass', 250, 60); break;
        case 'combo': this.tone('square', 880, 880, 0.05, 0.14 * v); this.tone('square', 1320, 1320, 0.1, 0.14 * v, 0.05); break;
        case 'headshot': this.tone('square', 1700, 1500, 0.06, 0.16 * v); this.noise(0.1, 0.3 * v, 'highpass', 3000, 3000); break;
        case 'splat': this.noise(0.35, 0.7 * v, 'lowpass', 900, 120, 1, 0, p); this.tone('sine', 140, 40, 0.3, 0.4 * v, 0, p); break;
        case 'puff': this.noise(0.05, 0.12 * v, 'highpass', 2500, 1500, 1, 0, p); break;
        case 'menu_move': this.tone('square', 660, 660, 0.035, 0.1 * v); break;
        case 'menu_ok': this.tone('square', 880, 1320, 0.09, 0.15 * v); break;
        case 'stomp': this.noise(0.5, 0.9 * v, 'lowpass', 300, 40, 1, 0, p); this.tone('sine', 60, 25, 0.5, 0.6 * v, 0, p); break;
      }
    },
    // Sonido posicional: volumen por distancia y paneo estéreo según ángulo.
    at(name, x, y, vol = 1, pitch = 1) {
      const dx = x - P.x, dy = y - P.y;
      const d = Math.hypot(dx, dy);
      if (d > 30) return;
      const ang = angDiff(P.a, Math.atan2(dy, dx));
      this.play(name, vol / (1 + d * 0.16), Math.sin(ang) * 0.8, pitch);
    }
  };

  // =======================================================================
  // 3. PINTOR DE PÍXELES (todo el arte del juego sale de aquí)
  // =======================================================================
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const C = (a) => `rgb(${clamp(a[0] | 0, 0, 255)},${clamp(a[1] | 0, 0, 255)},${clamp(a[2] | 0, 0, 255)})`;
  const lit = (a, v) => [a[0] + v, a[1] + v, a[2] + v];
  const hexA = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const shadeHex = (h, v) => C(lit(hexA(h), v));

  function painter(ctx) {
    return {
      ctx,
      rect(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); },
      px(x, y, col) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), 1, 1); },
      ell(cx, cy, rx, ry, col) {
        ctx.fillStyle = col;
        const r = Math.max(ry, 0.5), n = Math.ceil(ry);
        for (let y = -n; y <= n; y++) {
          const t = 1 - (y * y) / (r * r); if (t < 0) continue;
          const w = rx * Math.sqrt(t);
          ctx.fillRect(Math.round(cx - w), Math.round(cy + y), Math.max(1, Math.round(w * 2)), 1);
        }
      },
      line(x0, y0, x1, y1, col, t = 1) {
        ctx.fillStyle = col;
        const dx = x1 - x0, dy = y1 - y0, n = Math.max(Math.abs(dx), Math.abs(dy), 1);
        for (let i = 0; i <= n; i++) {
          ctx.fillRect(Math.round(x0 + dx * i / n - (t - 1) / 2), Math.round(y0 + dy * i / n - (t - 1) / 2), t, t);
        }
      },
      poly(pts, col) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath(); ctx.fill();
      }
    };
  }

  // Convierte un canvas en textura {w,h,d:Uint32Array}. cut = alfa binario, outline = contorno 1px.
  function toTex(cv, opts = {}) {
    const ctx = cv.getContext('2d');
    const w = cv.width, h = cv.height;
    const id = ctx.getImageData(0, 0, w, h);
    let d = new Uint32Array(id.data.buffer);
    if (opts.cut) {
      for (let i = 0; i < d.length; i++) d[i] = (d[i] >>> 24) < 110 ? 0 : (d[i] | 0xff000000) >>> 0;
    }
    if (opts.outline) {
      const o = d.slice();
      const OUT = 0xff0a0608;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (d[i] !== 0) continue;
        if ((x > 0 && d[i - 1]) || (x < w - 1 && d[i + 1]) || (y > 0 && d[i - w]) || (y < h - 1 && d[i + w])) o[i] = OUT;
      }
      d = o;
    }
    const copy = new Uint32Array(d);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(copy.buffer.slice(0)), w, h), 0, 0);
    return { w, h, d: copy, cv };
  }
  function art(w, h, fn, opts) { const cv = makeCanvas(w, h); const ctx = cv.getContext('2d'); fn(painter(ctx), ctx, w, h); return toTex(cv, opts); }

  // =======================================================================
  // 4. TEXTURAS Y SPRITES
  // =======================================================================
  const TW = 64, TWH = 96; // paredes 64x96 (1.5 unidades de alto)

  function bricks(p, base, mortar, variance, rows, bw, seed) {
    setSeed(seed);
    p.rect(0, 0, TW, TWH, C(mortar));
    const bh = TWH / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (bw / 2);
      for (let bx = 0; bx < TW / bw; bx++) {
        const x = off + bx * bw, y = r * bh;
        const col = lit(base, (srand() - 0.5) * variance);
        const one = (xx) => {
          p.rect(xx + 1, y + 1, bw - 2, bh - 2, C(col));
          p.rect(xx + 1, y + 1, bw - 2, 1, C(lit(col, 20)));
          p.rect(xx + 1, y + bh - 2, bw - 2, 1, C(lit(col, -24)));
          p.rect(xx + bw - 2, y + 1, 1, bh - 2, C(lit(col, -14)));
        };
        one(x); if (x + bw > TW) one(x - TW);
        for (let i = 0; i < 14; i++) {
          const sx = (x + 2 + srand() * (bw - 4)) % TW, sy = y + 2 + srand() * (bh - 4);
          p.px(sx, sy, C(lit(col, (srand() - 0.5) * 46)));
        }
      }
    }
  }

  const WALL_TEX = [];
  function buildWallTextures() {
    // 1 · Piedra
    WALL_TEX[1] = art(TW, TWH, (p) => {
      bricks(p, [78, 70, 62], [30, 25, 22], 34, 6, 32, 11);
      setSeed(5); for (let i = 0; i < 4; i++) { const x = srand() * 60, y = srand() * 90; p.line(x, y, x + srand() * 6 - 3, y + 5 + srand() * 6, 'rgb(28,24,20)'); }
    });
    // 2 · Piedra con musgo
    WALL_TEX[2] = art(TW, TWH, (p) => {
      bricks(p, [70, 72, 60], [26, 28, 20], 30, 6, 32, 21);
      setSeed(77);
      for (let i = 0; i < 26; i++) { const x = srand() * 64, y = srand() * 96; p.ell(x, y, 2 + srand() * 4, 1 + srand() * 2, srand() < 0.5 ? 'rgb(63,107,42)' : 'rgb(85,134,47)'); }
      for (let i = 0; i < 12; i++) { const x = srand() * 64; p.rect(x, 0, 2, 4 + srand() * 22, 'rgb(52,96,36)'); }
    });
    // 3 · Madera
    WALL_TEX[3] = art(TW, TWH, (p) => {
      setSeed(31); p.rect(0, 0, TW, TWH, 'rgb(40,24,12)');
      for (let i = 0; i < 4; i++) {
        const col = [92 + (srand() - 0.5) * 24, 58 + (srand() - 0.5) * 16, 30];
        p.rect(i * 16 + 1, 0, 14, TWH, C(col));
        p.rect(i * 16 + 1, 0, 1, TWH, C(lit(col, 18)));
        for (let g = 0; g < 5; g++) { const gx = i * 16 + 3 + srand() * 10; for (let y = 0; y < TWH; y += 2) p.px(gx + Math.sin(y * 0.15 + g) * 1.2, y, C(lit(col, -20))); }
        p.ell(i * 16 + 8, 20 + srand() * 60, 2, 3, C(lit(col, -30)));
      }
      for (const by of [12, 70]) { p.rect(0, by, TW, 8, 'rgb(58,36,18)'); p.rect(0, by, TW, 1, 'rgb(90,60,34)'); for (let x = 4; x < 64; x += 16) p.rect(x, by + 3, 2, 2, 'rgb(150,150,160)'); }
    });
    // 4 · Ladrillo rojo con calavera y sangre
    WALL_TEX[4] = art(TW, TWH, (p) => {
      bricks(p, [108, 30, 24], [36, 12, 10], 30, 8, 16, 41);
      const s = 'rgb(225,214,190)', d = 'rgb(20,8,8)';
      p.ell(32, 40, 11, 10, s); p.rect(25, 46, 14, 8, s);
      p.ell(27, 40, 3, 3, d); p.ell(37, 40, 3, 3, d); p.poly([32, 44, 30, 48, 34, 48], d);
      for (let x = 26; x < 39; x += 3) p.rect(x, 50, 1, 4, d);
      setSeed(9); for (let i = 0; i < 7; i++) { const x = 4 + srand() * 56; p.rect(x, 0, 2, 6 + srand() * 34, 'rgb(130,8,12)'); p.rect(x, 0, 1, 4 + srand() * 20, 'rgb(170,20,24)'); }
    });
    // 5 · Rastrillo de hierro (puerta de aparición goblin)
    WALL_TEX[5] = art(TW, TWH, (p) => {
      bricks(p, [74, 66, 60], [28, 24, 20], 26, 6, 32, 51);
      p.rect(8, 14, 48, 82, 'rgb(6,4,4)');
      p.ell(32, 16, 24, 10, 'rgb(6,4,4)');
      setSeed(52);
      for (let i = 0; i < 4; i++) {
        const x = 12 + srand() * 38, y = 30 + srand() * 50;
        const c = srand() < 0.5 ? 'rgb(255,220,40)' : 'rgb(130,255,60)';
        p.rect(x, y, 2, 1, c); p.rect(x + 5, y, 2, 1, c);
      }
      for (let x = 10; x < 56; x += 8) { p.rect(x, 8, 3, 88, 'rgb(70,70,80)'); p.rect(x, 8, 1, 88, 'rgb(120,120,132)'); p.rect(x + 1, 94, 1, 2, 'rgb(150,150,160)'); }
      for (const y of [34, 64]) { p.rect(8, y, 48, 3, 'rgb(62,62,72)'); p.rect(8, y, 48, 1, 'rgb(110,110,120)'); }
    });
    // 6 · Estandarte "PROHIBIDO GOBLINS"
    WALL_TEX[6] = art(TW, TWH, (p) => {
      bricks(p, [78, 70, 62], [30, 25, 22], 34, 6, 32, 61);
      p.rect(14, 4, 36, 2, 'rgb(90,60,30)');
      p.poly([16, 6, 48, 6, 48, 80, 32, 70, 16, 80], 'rgb(150,16,22)');
      p.rect(16, 6, 2, 72, 'rgb(242,193,78)'); p.rect(46, 6, 2, 72, 'rgb(242,193,78)');
      p.ell(32, 36, 10, 10, 'rgb(242,193,78)'); p.ell(32, 36, 8, 8, 'rgb(150,16,22)');
      p.ell(32, 37, 4, 4, 'rgb(95,174,58)');
      p.poly([28, 36, 22, 31, 28, 39], 'rgb(95,174,58)'); p.poly([36, 36, 42, 31, 36, 39], 'rgb(95,174,58)');
      p.px(30, 36, 'rgb(255,40,40)'); p.px(34, 36, 'rgb(255,40,40)');
      p.line(25, 29, 39, 43, 'rgb(242,193,78)', 2);
    });
  }

  let TEX_COBBLE, TEX_DIRT, TEX_CEIL, TEX_SKY;
  function buildFloorTextures() {
    TEX_COBBLE = art(64, 64, (p) => {
      setSeed(101); p.rect(0, 0, 64, 64, 'rgb(28,24,22)');
      for (let i = 0; i < 26; i++) {
        const x = srand() * 64, y = srand() * 64, rx = 4 + srand() * 4, ry = 3 + srand() * 3;
        const col = [70 + (srand() - 0.5) * 30, 62 + (srand() - 0.5) * 24, 54 + (srand() - 0.5) * 20];
        for (const ox of [-64, 0, 64]) for (const oy of [-64, 0, 64]) {
          p.ell(x + ox, y + oy, rx, ry, C(col));
          p.ell(x + ox - 1, y + oy - 1, rx * 0.5, ry * 0.4, C(lit(col, 16)));
        }
      }
    });
    TEX_DIRT = art(64, 64, (p) => {
      setSeed(202); p.rect(0, 0, 64, 64, 'rgb(58,42,28)');
      for (let i = 0; i < 500; i++) p.px(srand() * 64, srand() * 64, C(lit([58, 42, 28], (srand() - 0.5) * 34)));
      for (let i = 0; i < 9; i++) { const x = srand() * 60, y = srand() * 60; p.ell(x, y, 2, 1.5, 'rgb(96,88,78)'); p.px(x - 1, y - 1, 'rgb(140,130,118)'); }
      for (let i = 0; i < 14; i++) { const x = 2 + srand() * 60, y = 3 + srand() * 58; p.px(x, y, 'rgb(70,110,40)'); p.px(x - 1, y - 1, 'rgb(90,140,50)'); p.px(x + 1, y - 2, 'rgb(90,140,50)'); }
      for (let i = 0; i < 3; i++) p.ell(srand() * 64, srand() * 64, 3, 2, 'rgb(60,90,30)');
    });
    TEX_CEIL = art(64, 64, (p) => {
      setSeed(303); p.rect(0, 0, 64, 64, 'rgb(26,16,10)');
      for (const y of [0, 32]) {
        p.rect(0, y + 2, 64, 26, 'rgb(64,40,22)'); p.rect(0, y + 2, 64, 2, 'rgb(90,60,34)'); p.rect(0, y + 26, 64, 2, 'rgb(36,22,12)');
        for (let i = 0; i < 6; i++) { const gy = y + 6 + srand() * 18; for (let x = 0; x < 64; x += 2) p.px(x, gy + Math.sin(x * 0.2 + i) * 1.3, 'rgb(48,30,16)'); }
      }
      setSeed(3); for (let i = 0; i < 4; i++) { const x = srand() * 60; p.line(x, 0, x + 4, 64, 'rgba(200,200,200,0.25)'); }
    });
    // Cielo panorámico rojo sangre con luna y montañas (se repite 4 veces en 360°)
    TEX_SKY = art(256, 128, (p, ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, '#07020a'); g.addColorStop(0.45, '#2a0710'); g.addColorStop(0.8, '#6a1614'); g.addColorStop(1, '#8a2a16');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
      setSeed(404);
      for (let i = 0; i < 90; i++) p.px(srand() * 256, 4 + srand() * 56, srand() < 0.2 ? 'rgb(255,240,200)' : 'rgb(150,120,140)');
      p.ell(70, 30, 9, 9, 'rgb(242,224,160)'); p.ell(67, 28, 2, 2, 'rgb(214,196,130)'); p.ell(73, 33, 2, 1.5, 'rgb(214,196,130)');
      for (let i = 0; i < 9; i++) { const x = srand() * 256, y = 30 + srand() * 40; p.ell(x, y, 18 + srand() * 20, 2 + srand() * 2, 'rgba(20,4,8,0.75)'); }
      for (let x = 0; x < 256; x++) {
        const a = x / 256 * TAU;
        const h1 = 92 + Math.sin(a * 3) * 8 + Math.sin(a * 7 + 1) * 5 + Math.sin(a * 13) * 2;
        p.rect(x, h1, 1, 128 - h1, 'rgb(36,10,12)');
        const h2 = 106 + Math.sin(a * 5 + 2) * 6 + Math.sin(a * 11) * 3;
        p.rect(x, h2, 1, 128 - h2, 'rgb(16,4,6)');
      }
    });
  }

  // ---------------- Goblins ----------------
  const GOB_STYLE = {
    grunt: { skin: '#5fae3a', skinD: '#3d7a23', cloth: '#6b4a2a', clothD: '#4a311b', eye: '#ffdd33', hat: null, weapon: 'club', bulk: 0 },
    archer: { skin: '#8aa53a', skinD: '#5a7022', cloth: '#2f5a2a', clothD: '#1e3a1b', eye: '#ff5533', hat: 'hood', weapon: 'bow', bulk: 0 },
    kamikaze: { skin: '#9bd040', skinD: '#62902a', cloth: '#8a2a1a', clothD: '#5a1a10', eye: '#ffffff', hat: 'goggles', weapon: 'bomb', bulk: -1 },
    brute: { skin: '#3f7a2f', skinD: '#264d1c', cloth: '#5a5a62', clothD: '#38383e', eye: '#ff2222', hat: 'horns', weapon: 'axe', bulk: 2 },
    shaman: { skin: '#6aa84f', skinD: '#456e33', cloth: '#5a2a7a', clothD: '#3a1a52', eye: '#66ffee', hat: 'skull', weapon: 'staff', bulk: 0, robe: true },
    boss: { skin: '#4f9a2f', skinD: '#2f6a1c', cloth: '#9a1a1a', clothD: '#5a0e0e', eye: '#ffcc00', hat: 'crown', weapon: 'mace', bulk: 3, belly: true },
    merchant: { skin: '#6fb848', skinD: '#47802c', cloth: '#7a4a1a', clothD: '#52300f', eye: '#ffee66', hat: 'fez', weapon: 'bag', bulk: 1, belly: true }
  };

  function drawGoblin(p, S, pose) {
    const cx = 24, bw = 8 + S.bulk * 1.5;
    const skin = S.skin, skinD = S.skinD;
    const atk = pose === 'attack', pain = pose === 'pain';
    let l = 0, r = 0;
    if (pose === 'walk0') l = -2;
    if (pose === 'walk1') r = -2;
    if (S.hat === 'crown') p.rect(cx - 14, 18, 28, 26, '#6a0a0a'); // capa del rey
    // piernas y pies
    p.rect(cx - 7, 37 + l, 4, 9, skinD); p.rect(cx - 9, 45 + l, 7, 2, '#3a2414');
    p.rect(cx + 3, 37 + r, 4, 9, skinD); p.rect(cx + 2, 45 + r, 7, 2, '#3a2414');
    // ropa
    if (S.robe) {
      p.poly([cx - 7, 22, cx + 7, 22, cx + 11, 45, cx - 11, 45], S.cloth);
      p.rect(cx - 1, 24, 2, 20, S.clothD);
      for (let i = 0; i < 5; i++) p.px(cx - 4 + i * 2, 25, '#e8dcc0');
    } else {
      p.ell(cx, 26, bw, 6, skin);
      p.ell(cx + bw * 0.45, 28, bw * 0.4, 3, skinD);
      if (S.belly) { p.ell(cx, 30, bw + 2, 8, skin); p.ell(cx + 4, 33, bw * 0.6, 4, skinD); p.px(cx, 31, skinD); }
      p.rect(cx - bw, 31, bw * 2, 7, S.cloth);
      for (let x = cx - bw; x < cx + bw; x += 3) p.rect(x, 38, 2, 1, S.cloth);
      p.rect(cx - bw, 31, bw * 2, 2, S.clothD); p.rect(cx - 1, 31, 3, 2, '#c9a227');
      if (S.hat === 'horns') { p.ell(cx - bw - 1, 21, 4, 3, '#77777f'); p.ell(cx + bw + 1, 21, 4, 3, '#77777f'); p.px(cx - bw - 2, 20, '#aaaab4'); p.px(cx + bw, 20, '#aaaab4'); }
    }
    // brazos
    const shY = 21;
    const lh = [cx - bw - 3, 33], rh = atk ? [cx + bw + 5, 9] : [cx + bw + 3, 33];
    if (S.weapon === 'bow' && atk) { lh[0] = cx - bw - 6; lh[1] = 22; }
    p.line(cx - bw + 1, shY, lh[0], lh[1], skin, 3);
    p.line(cx + bw - 1, shY, rh[0], rh[1], skin, 3);
    // arma en mano derecha
    const hx = rh[0], hy = rh[1];
    switch (S.weapon) {
      case 'club':
        p.line(hx, hy, hx + 5, hy - 13, '#6b4421', 3); p.ell(hx + 6, hy - 14, 3, 3, '#7a5028');
        p.px(hx + 5, hy - 16, '#b0b0b8'); p.px(hx + 8, hy - 13, '#b0b0b8'); break;
      case 'bow':
        p.line(lh[0] - 1, lh[1] - 11, lh[0] - 4, lh[1], '#7a5028', 2); p.line(lh[0] - 4, lh[1], lh[0] - 1, lh[1] + 11, '#7a5028', 2);
        p.line(lh[0] - 1, lh[1] - 11, atk ? lh[0] + 6 : lh[0] - 1, lh[1], '#d8d8d8'); p.line(atk ? lh[0] + 6 : lh[0] - 1, lh[1], lh[0] - 1, lh[1] + 11, '#d8d8d8');
        if (atk) { p.line(lh[0] - 6, lh[1], lh[0] + 7, lh[1], '#9a7040'); p.px(lh[0] - 7, lh[1], '#d0d0d8'); }
        break;
      case 'bomb':
        p.ell(hx + 1, hy - 4, 4, 4, '#1c1c22'); p.px(hx, hy - 6, '#6a6a7a');
        p.line(hx + 3, hy - 8, hx + 5, hy - 11, '#c9a227'); p.px(hx + 6, hy - 12, pose === 'walk1' ? '#ffffff' : '#ffcc00'); p.px(hx + 5, hy - 13, '#ff5500');
        break;
      case 'axe':
        p.line(hx, hy + 4, hx + 4, hy - 16, '#5a3a1c', 3);
        p.poly([hx + 3, hy - 18, hx + 13, hy - 22, hx + 13, hy - 8, hx + 4, hy - 11], '#8a8a96');
        p.line(hx + 13, hy - 22, hx + 13, hy - 8, '#d0d0dc'); break;
      case 'staff':
        p.line(hx, hy + 12, hx + 2, hy - 20, '#5a3a1c', 2);
        p.ell(hx + 2, hy - 22, 3, 3, atk ? '#ccffdd' : '#66ffaa'); p.px(hx + 1, hy - 23, '#ffffff');
        p.px(hx - 2, hy - 25, '#66ffaa'); p.px(hx + 6, hy - 20, '#66ffaa'); break;
      case 'mace':
        p.line(hx, hy, hx + 4, hy - 14, '#4a3018', 3);
        p.ell(hx + 5, hy - 17, 5, 5, '#6a6a74'); p.ell(hx + 4, hy - 18, 2, 2, '#9a9aa4');
        for (const [sx, sy] of [[0, -7], [6, -3], [-6, -3], [5, 3], [-5, 3]]) p.px(hx + 5 + sx, hy - 17 + sy, '#c8c8d0');
        break;
      case 'bag':
        p.ell(hx + 1, hy + 1, 5, 5, '#8a6a3a'); p.rect(hx - 1, hy - 5, 4, 2, '#5a3a1c'); p.px(hx + 1, hy + 1, '#f2c14e'); p.px(hx + 3, hy - 1, '#f2c14e');
        break;
    }
    p.ell(lh[0], lh[1], 2, 2, skin); p.ell(hx, hy, 2, 2, skin);
    // cabeza
    const hy0 = S.belly ? 12 : 13;
    const earC = skin;
    p.poly([cx - 5, hy0 - 2, cx - 18, hy0 - 7, cx - 6, hy0 + 3], earC);
    p.poly([cx + 5, hy0 - 2, cx + 18, hy0 - 7, cx + 6, hy0 + 3], earC);
    p.poly([cx - 6, hy0 - 1, cx - 14, hy0 - 5, cx - 7, hy0 + 1], skinD);
    p.poly([cx + 6, hy0 - 1, cx + 14, hy0 - 5, cx + 7, hy0 + 1], skinD);
    p.ell(cx, hy0, 7, 6, skin); p.ell(cx, hy0 + 3, 6, 4, skin);
    if (S.hat === 'hood') { p.ell(cx, hy0 - 4, 8, 4, S.cloth); p.rect(cx - 8, hy0 - 4, 2, 9, S.cloth); p.rect(cx + 6, hy0 - 4, 2, 9, S.cloth); }
    const dk = '#2a0a0a';
    if (pain) {
      p.line(cx - 5, hy0 - 1, cx - 2, hy0, dk); p.line(cx + 2, hy0, cx + 5, hy0 - 1, dk);
      p.ell(cx, hy0 + 4, 3, 2, dk); p.px(cx - 1, hy0 + 3, '#ffffff');
    } else {
      if (S.hat === 'goggles') {
        p.rect(cx - 8, hy0 - 3, 16, 2, '#3a2414');
        p.ell(cx - 3, hy0 - 1, 2.5, 2.5, '#c9a227'); p.ell(cx + 3, hy0 - 1, 2.5, 2.5, '#c9a227');
        p.ell(cx - 3, hy0 - 1, 1.5, 1.5, '#88ccff'); p.ell(cx + 3, hy0 - 1, 1.5, 1.5, '#88ccff');
      } else {
        p.line(cx - 6, hy0 - 4, cx - 2, hy0 - 2, dk); p.line(cx + 2, hy0 - 2, cx + 6, hy0 - 4, dk);
        p.rect(cx - 5, hy0 - 1, 3, 2, S.eye); p.rect(cx + 2, hy0 - 1, 3, 2, S.eye);
        p.px(cx - 3, hy0, '#000'); p.px(cx + 2, hy0, '#000');
      }
      p.rect(cx - 1, hy0 + 1, 2, 3, skinD); p.px(cx, hy0 + 4, skinD);
      if (atk) {
        p.ell(cx, hy0 + 5, 4, 2, dk);
        p.px(cx - 3, hy0 + 4, '#fff'); p.px(cx + 3, hy0 + 4, '#fff'); p.px(cx - 1, hy0 + 6, '#fff'); p.px(cx + 1, hy0 + 6, '#fff');
      } else {
        p.rect(cx - 4, hy0 + 5, 9, 1, dk);
        p.rect(cx - 3, hy0 + 3, 1, 2, '#fff'); p.rect(cx + 3, hy0 + 3, 1, 2, '#fff');
      }
    }
    // sombreros
    switch (S.hat) {
      case 'horns':
        p.ell(cx, hy0 - 4, 8, 4, '#6a6a72'); p.rect(cx - 8, hy0 - 3, 16, 2, '#4a4a52');
        p.poly([cx - 7, hy0 - 5, cx - 15, hy0 - 15, cx - 4, hy0 - 7], '#e8dcc0');
        p.poly([cx + 7, hy0 - 5, cx + 15, hy0 - 15, cx + 4, hy0 - 7], '#e8dcc0');
        break;
      case 'skull':
        p.ell(cx, hy0 - 8, 5, 4, '#e8dcc0'); p.px(cx - 2, hy0 - 8, '#000'); p.px(cx + 2, hy0 - 8, '#000');
        p.line(cx + 4, hy0 - 10, cx + 8, hy0 - 17, '#c03030'); p.line(cx - 4, hy0 - 10, cx - 7, hy0 - 16, '#3070c0');
        for (let i = -3; i <= 3; i += 2) p.px(cx + i, hy0 + 9, '#e8dcc0');
        break;
      case 'crown':
        p.rect(cx - 7, hy0 - 9, 14, 4, '#e8b830');
        p.poly([cx - 7, hy0 - 9, cx - 7, hy0 - 14, cx - 4, hy0 - 9], '#e8b830');
        p.poly([cx - 2, hy0 - 9, cx, hy0 - 15, cx + 2, hy0 - 9], '#e8b830');
        p.poly([cx + 4, hy0 - 9, cx + 7, hy0 - 14, cx + 7, hy0 - 9], '#e8b830');
        p.px(cx, hy0 - 8, '#ff2040'); p.px(cx - 5, hy0 - 7, '#20a0ff'); p.px(cx + 5, hy0 - 7, '#20ff60');
        break;
      case 'fez':
        p.poly([cx - 5, hy0 - 4, cx + 5, hy0 - 4, cx + 4, hy0 - 12, cx - 4, hy0 - 12], '#b3121b');
        p.line(cx, hy0 - 12, cx + 5, hy0 - 7, '#f2c14e');
        break;
    }
  }

  // Genera todos los fotogramas de un tipo de goblin.
  const GOB_TEX = {};
  function buildGoblinFrames(type) {
    const S = GOB_STYLE[type];
    const frame = (pose) => {
      const cv = makeCanvas(48, 48); drawGoblin(painter(cv.getContext('2d')), S, pose); return cv;
    };
    const F = {};
    for (const pose of ['walk0', 'walk1', 'attack', 'pain']) F[pose] = toTex(frame(pose), { cut: true, outline: true });
    const painCv = frame('pain');
    F.dead0 = art(48, 48, (p, ctx) => { ctx.save(); ctx.translate(24, 47); ctx.rotate(0.55); ctx.drawImage(painCv, -24, -47); ctx.restore(); }, { cut: true, outline: true });
    F.dead1 = art(48, 48, (p, ctx) => {
      p.ell(24, 45, 18, 2.5, '#2f6a1c'); p.ell(20, 45, 9, 1.5, '#4a9a2a');
      ctx.save(); ctx.translate(6, 33); ctx.rotate(Math.PI / 2); ctx.scale(0.82, 0.82); ctx.drawImage(painCv, -24, -47); ctx.restore();
    }, { cut: true, outline: true });
    F.gib = art(48, 48, (p) => {
      setSeed(type.length * 13);
      p.ell(24, 45, 19, 3, '#2f6a1c');
      for (let i = 0; i < 16; i++) p.ell(8 + srand() * 32, 38 + srand() * 8, 1 + srand() * 3, 1 + srand() * 2, srand() < 0.5 ? S.skin : S.skinD);
      p.ell(30, 40, 4, 3, '#e8dcc0'); p.px(29, 40, '#000'); p.px(31, 40, '#000');
      p.line(14, 44, 22, 41, '#e8dcc0', 2);
    }, { cut: true, outline: true });
    GOB_TEX[type] = F;
  }

  // ---------------- Objetos, proyectiles y decoración ----------------
  const SPR = {};
  function buildSprites() {
    SPR.coin = [5, 3, 1, 3].map((rx) => art(16, 16, (p) => {
      p.ell(8, 9, rx + 0.5, 6, '#a8741a'); p.ell(8, 9, Math.max(0.6, rx - 0.5), 5, '#f2c14e');
      if (rx > 2) { p.rect(7, 6, 2, 6, '#c8901e'); p.px(6, 6, '#fff6c0'); }
    }, { cut: true, outline: true }));
    SPR.potion = art(16, 16, (p) => {
      p.rect(6, 2, 4, 2, '#8a5a2a'); p.rect(7, 4, 2, 3, '#b0d0e0');
      p.ell(8, 11, 5, 4, '#b0d0e0'); p.ell(8, 12, 4, 3, '#e0202a'); p.px(6, 10, '#ffffff'); p.px(9, 12, '#ff8080');
    }, { cut: true, outline: true });
    SPR.ammo = art(16, 16, (p) => {
      p.rect(2, 7, 12, 8, '#6a4a22'); p.rect(2, 7, 12, 1, '#9a7040');
      for (let x = 3; x < 13; x += 3) { p.rect(x, 2, 2, 5, '#d8a830'); p.px(x, 2, '#a07020'); }
      p.rect(5, 10, 6, 2, '#2a1a0a');
    }, { cut: true, outline: true });
    SPR.shells = art(16, 16, (p) => {
      p.rect(1, 9, 14, 6, '#5a3a1a');
      for (let x = 2; x < 14; x += 3) { p.rect(x, 3, 2, 7, '#c02020'); p.rect(x, 8, 2, 2, '#d8a830'); }
    }, { cut: true, outline: true });
    SPR.rockets = art(16, 16, (p) => {
      for (const x of [4, 10]) { p.rect(x - 1, 4, 3, 10, '#6a7a5a'); p.poly([x - 1, 4, x + 2, 4, x + 0.5, 1], '#c02020'); p.rect(x - 2, 12, 5, 2, '#3a3a3a'); }
    }, { cut: true, outline: true });
    SPR.armor = art(16, 16, (p) => {
      p.ell(8, 8, 6, 6, '#4a7ac8'); p.rect(2, 8, 12, 6, '#4a7ac8'); p.rect(5, 8, 6, 2, '#0a0a14'); p.rect(7, 8, 2, 6, '#0a0a14');
      p.px(5, 4, '#a0c8ff'); p.rect(7, 1, 2, 3, '#e0202a');
    }, { cut: true, outline: true });
    SPR.arrow = art(16, 16, (p) => { p.line(3, 12, 12, 4, '#9a7040'); p.px(13, 3, '#e0e0e8'); p.px(12, 3, '#c0c0c8'); p.px(3, 11, '#e8e8e8'); p.px(2, 12, '#e8e8e8'); }, { cut: true });
    SPR.fireball = [0, 1].map((f) => art(16, 16, (p) => {
      p.ell(8, 8, 6 + f, 6 - f, '#ff5a10'); p.ell(8, 8, 4, 4, '#ffb020'); p.ell(8 - f, 8, 2, 2, '#fff6c0');
      p.px(2 + f * 10, 3, '#ff8020'); p.px(13 - f * 10, 13, '#ff8020');
    }, { cut: true }));
    SPR.greenball = [0, 1].map((f) => art(16, 16, (p) => {
      p.ell(8, 8, 6 + f, 6 - f, '#30c040'); p.ell(8, 8, 4, 4, '#90ff80'); p.ell(8, 8, 2, 2, '#ffffff');
    }, { cut: true }));
    SPR.bomb = [0, 1].map((f) => art(16, 16, (p) => {
      p.ell(8, 10, 5, 5, '#1c1c22'); p.px(6, 8, '#6a6a7a'); p.line(10, 5, 12, 2, '#c9a227');
      p.px(13, 1, f ? '#ffffff' : '#ffcc00'); p.px(12, 0, '#ff5500');
    }, { cut: true }));
    SPR.rocket = art(16, 16, (p) => { p.ell(8, 8, 6, 6, '#ff7a10'); p.ell(8, 8, 4, 4, '#ffe060'); p.ell(8, 8, 3, 3, '#7a8a6a'); p.ell(8, 8, 1.5, 1.5, '#c02020'); }, { cut: true });
    SPR.explosion = [0, 1, 2, 3, 4].map((f) => art(32, 32, (p) => {
      setSeed(500 + f);
      const r = 6 + f * 2.6;
      if (f < 4) {
        p.ell(16, 16, r, r, f < 2 ? '#ff6a10' : '#c03a10');
        p.ell(16, 16, r * 0.7, r * 0.7, f < 3 ? '#ffb030' : '#7a2a10');
        if (f < 2) p.ell(16, 16, r * 0.4, r * 0.4, '#fff6c0');
        for (let i = 0; i < 10; i++) { const a = srand() * TAU, d = r * (0.8 + srand() * 0.4); p.ell(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 2, 2, '#ff9020'); }
      } else {
        for (let i = 0; i < 8; i++) { const a = srand() * TAU, d = srand() * 8; p.ell(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 5, 5, 'rgb(60,50,46)'); }
      }
    }, { cut: true }));
    SPR.torch = [0, 1, 2].map((f) => art(16, 48, (p) => {
      p.rect(6, 18, 4, 30, '#4a2e15'); p.rect(6, 18, 1, 30, '#6b4421');
      p.rect(3, 15, 10, 4, '#3a3a42'); p.rect(4, 44, 8, 4, '#2a2a30');
      const fl = [[0, 0], [1, -1], [-1, 1]][f];
      p.ell(8 + fl[0], 9, 4, 7 + fl[1], '#ff5a10'); p.ell(8 + fl[0], 10, 3, 5, '#ffb020'); p.ell(8, 12, 1.5, 2.5, '#fff6c0');
      p.px(5 + f * 2, 2, '#ff8020');
    }, { cut: true, outline: true }));
    SPR.barrel = art(24, 32, (p) => {
      p.ell(12, 5, 9, 3, '#7a5028'); p.rect(3, 5, 18, 24, '#8a5a2a'); p.ell(12, 29, 9, 2, '#6a4420');
      for (const x of [6, 11, 16]) p.rect(x, 6, 1, 23, '#5a3a1a');
      for (const y of [8, 25]) p.rect(3, y, 18, 2, '#4a4a52');
      p.rect(5, 13, 14, 8, '#c01818'); p.rect(6, 14, 12, 6, '#e8dcc0');
      p.ell(12, 17, 3, 2.5, '#c01818'); p.px(11, 16, '#e8dcc0'); p.px(13, 16, '#e8dcc0');
      p.rect(3, 5, 2, 24, '#a87038');
    }, { cut: true, outline: true });
    SPR.bones = art(24, 12, (p) => {
      p.line(2, 10, 14, 7, '#e8dcc0', 2); p.line(8, 11, 20, 9, '#d8ccb0', 2);
      p.ell(18, 6, 4, 3.5, '#e8dcc0'); p.px(17, 6, '#000'); p.px(19, 6, '#000'); p.rect(16, 9, 4, 1, '#000');
    }, { cut: true, outline: true });
  }

  // =======================================================================
  // 5. ARMAS EN SPRITES (respaldo sin WebGL) E ÍCONOS
  // =======================================================================
  const SKIN = '#d9a066', SKIND = '#a8703f', SLEEVE = '#5a1418', SLEEVED = '#3a0c10';
  function hand(p, x, y, rx = 11, ry = 8) {
    p.ell(x, y, rx, ry, SKIN); p.ell(x + rx * 0.35, y + ry * 0.3, rx * 0.55, ry * 0.5, SKIND);
    for (let i = -2; i <= 1; i++) p.rect(x - rx * 0.6, y + i * 3 - 1, rx * 1.2, 1, SKIND);
  }
  function sleeve(p, x0, x1, y, w) { p.poly([x0 - w, 140, x0 + w, 140, x1 + w * 0.7, y, x1 - w * 0.7, y], SLEEVE); p.line(x1 - w * 0.7, y, x0 - w, 140, SLEEVED, 2); }

  // Cada arma: lista de fotogramas (canvas). Se generan 4 variantes de brillo por iluminación.
  const WEAPON_ART = {};
  function brightVariants(cv) {
    return [0.5, 0.72, 0.92, 1.15].map((k) => {
      const c = makeCanvas(cv.width, cv.height); const ctx = c.getContext('2d');
      ctx.drawImage(cv, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height); const d = id.data;
      for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); }
      ctx.putImageData(id, 0, 0); return c;
    });
  }
  function wArt(w, h, fn) { const t = art(w, h, fn, { cut: true, outline: true }); return brightVariants(t.cv); }

  function buildWeaponArt() {
    // Hacha (se dibuja una vez y se rota para cada fotograma)
    const axe = makeCanvas(44, 96);
    (function () {
      const p = painter(axe.getContext('2d'));
      p.rect(19, 8, 6, 86, '#6b4421'); p.rect(19, 8, 2, 86, '#8a5a2a'); p.rect(23, 8, 2, 86, '#4a2e15');
      for (let y = 60; y < 94; y += 4) p.rect(19, y, 6, 1, '#3a2010');
      p.poly([20, 6, 2, 0, 0, 16, 2, 34, 20, 26], '#7a7a86');
      p.poly([2, 0, 0, 16, 2, 34, 5, 34, 3, 16, 5, 0], '#d8d8e4');
      p.poly([24, 8, 36, 12, 24, 20], '#6a6a74');
      p.rect(18, 4, 8, 26, '#5a5a64'); p.rect(18, 4, 8, 2, '#9a9aa6');
      p.rect(8, 14, 4, 6, 'rgb(120,10,14)');
    })();
    const axeFrame = (rot, ax, ay) => wArt(150, 130, (p, ctx) => {
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(rot); ctx.drawImage(axe, -22, -78); ctx.restore();
      sleeve(p, ax + 18, ax + 6, ay + 6, 14); hand(p, ax + 2, ay, 12, 9);
    });
    WEAPON_ART.axe = { frames: [axeFrame(-0.3, 104, 108), axeFrame(-1.05, 118, 92), axeFrame(1.15, 54, 120)], w: 150, h: 130 };

    // Pistola "Escupeplomo"
    const pistol = (fire) => wArt(84, 96, (p) => {
      const o = fire ? -4 : 0;
      sleeve(p, 46, 44, 74, 13);
      p.rect(35, 28 + o, 14, 34, '#3a3a42'); p.rect(35, 28 + o, 3, 34, '#6a6a76'); p.rect(46, 28 + o, 3, 34, '#22222a');
      p.rect(34, 24 + o, 16, 7, '#4a4a54'); p.rect(34, 24 + o, 16, 1, '#8a8a96');
      p.ell(42, 23 + o, 6, 3.5, '#24242a'); p.ell(42, 23 + o, 2.5, 1.6, '#000');
      p.rect(41, 18 + o, 2, 4, '#8a8a96');
      p.rect(37, 40 + o, 10, 2, '#a8741a');
      hand(p, 42, 66, 13, 10); p.ell(52, 56, 4, 5, SKIN);
    });
    WEAPON_ART.pistol = { frames: [pistol(false), pistol(true)], w: 84, h: 96, flash: [42, 18] };

    // Escopeta "La Desgoblinizadora"
    const shotgun = (fire) => wArt(120, 100, (p) => {
      const o = fire ? -5 : 0;
      p.poly([30, 100, 90, 100, 76, 44 + o, 44, 44 + o], '#6b4421');
      for (let i = 0; i < 5; i++) p.line(46 + i * 6, 46 + o, 38 + i * 10, 100, '#4a2e15');
      for (const bx of [46, 61]) {
        p.rect(bx, 12 + o, 13, 36, '#3a3a44'); p.rect(bx, 12 + o, 3, 36, '#6a6a78'); p.rect(bx + 10, 12 + o, 3, 36, '#24242c');
        p.ell(bx + 6.5, 12 + o, 7, 4, '#2a2a32'); p.ell(bx + 6.5, 12 + o, 4, 2.5, '#000');
      }
      p.rect(44, 36 + o, 32, 5, '#a8741a'); p.rect(44, 36 + o, 32, 1, '#f2c14e');
      sleeve(p, 22, 34, 78, 14); sleeve(p, 100, 86, 82, 14);
      hand(p, 36, 76, 13, 10); hand(p, 84, 80, 13, 10);
    });
    WEAPON_ART.shotgun = { frames: [shotgun(false), shotgun(true)], w: 120, h: 100, flash: [60, 10] };

    // Ametralladora "Molinillo de Duendes"
    const chain = (rot) => wArt(128, 104, (p) => {
      p.rect(40, 30, 48, 50, '#44444e'); p.rect(40, 30, 6, 50, '#6a6a78'); p.rect(82, 30, 6, 50, '#2a2a32');
      for (let y = 40; y < 80; y += 8) p.rect(40, y, 48, 1, '#2a2a32');
      p.ell(64, 28, 24, 15, '#2e2e36'); p.ell(64, 27, 22, 13, '#3a3a44');
      for (let i = 0; i < 6; i++) {
        const a = rot + i * TAU / 6;
        const x = 64 + Math.cos(a) * 14, y = 27 + Math.sin(a) * 8;
        p.ell(x, y, 4.5, 3, '#5a5a66'); p.ell(x, y, 2, 1.3, '#000');
      }
      p.ell(64, 27, 5, 3.5, '#22222a');
      for (let y = 46; y < 96; y += 5) { p.rect(92 + (y % 10 ? 1 : 0), y, 8, 3, '#d8a830'); p.rect(92, y, 2, 3, '#a07020'); }
      sleeve(p, 18, 30, 80, 15); sleeve(p, 112, 98, 82, 15);
      hand(p, 32, 78, 14, 11); hand(p, 96, 80, 14, 11);
    });
    WEAPON_ART.chaingun = { frames: [chain(0), chain(Math.PI / 6)], w: 128, h: 104, flash: [64, 20] };

    // Lanzacohetes "Adiós Verdecito"
    const rocket = (fire) => wArt(128, 108, (p) => {
      const o = fire ? -6 : 0;
      p.rect(40, 28 + o, 48, 64, '#4a6a34'); p.rect(40, 28 + o, 6, 64, '#6a8a4a'); p.rect(82, 28 + o, 6, 64, '#2e4420');
      p.rect(40, 50 + o, 48, 4, '#c9a227');
      p.ell(64, 72 + o, 8, 7, '#e8dcc0'); p.px(61, 71 + o, '#000'); p.px(67, 71 + o, '#000'); p.rect(60, 76 + o, 8, 1, '#000');
      p.ell(64, 28 + o, 26, 15, '#2e3a22'); p.ell(64, 28 + o, 21, 12, '#0c0c0c');
      if (!fire) { p.ell(64, 30 + o, 11, 8, '#b02020'); p.ell(60, 27 + o, 3, 2, '#ff7070'); }
      sleeve(p, 18, 30, 86, 15); sleeve(p, 112, 98, 88, 15);
      hand(p, 32, 86, 14, 11); hand(p, 96, 88, 14, 11);
    });
    WEAPON_ART.rocket = { frames: [rocket(false), rocket(true)], w: 128, h: 108, flash: [64, 18] };

    WEAPON_ART.flash = [0, 1].map((f) => art(48, 40, (p) => {
      setSeed(900 + f);
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU + f * 0.3, r = 16 + srand() * 6;
        p.poly([24, 22, 24 + Math.cos(a - 0.25) * 6, 22 + Math.sin(a - 0.25) * 5, 24 + Math.cos(a) * r, 22 + Math.sin(a) * r * 0.8, 24 + Math.cos(a + 0.25) * 6, 22 + Math.sin(a + 0.25) * 5], '#ff9a20');
      }
      p.ell(24, 22, 9, 7, '#ffd040'); p.ell(24, 22, 5, 4, '#fffbe0');
    }, { cut: true }).cv);
  }

  const ICONS = {};
  function buildIcons() {
    const fromTex = (t) => t.cv.toDataURL();
    ICONS.potion = fromTex(SPR.potion); ICONS.armor = fromTex(SPR.armor);
    ICONS.ammo = fromTex(SPR.ammo); ICONS.shells = fromTex(SPR.shells); ICONS.rockets = fromTex(SPR.rockets);
    const icon = (fn) => art(16, 16, fn, { cut: true, outline: true }).cv.toDataURL();
    ICONS.shotgun = icon((p) => { p.rect(1, 6, 10, 2, '#4a4a54'); p.rect(1, 8, 10, 1, '#3a3a42'); p.poly([10, 6, 15, 8, 15, 12, 11, 10], '#6b4421'); p.rect(5, 9, 4, 2, '#6b4421'); });
    ICONS.chaingun = icon((p) => { p.rect(1, 5, 9, 6, '#4a4a54'); for (let y = 5; y < 11; y += 2) p.rect(0, y, 3, 1, '#22222a'); p.rect(9, 6, 6, 5, '#3a3a42'); p.rect(11, 11, 2, 4, '#3a2a1a'); p.rect(4, 11, 2, 3, '#d8a830'); });
    ICONS.rocket = icon((p) => { p.rect(0, 5, 15, 5, '#4a6a34'); p.rect(0, 5, 15, 1, '#6a8a4a'); p.rect(4, 10, 2, 4, '#3a2a1a'); p.ell(15, 7, 1, 2.5, '#b02020'); p.ell(8, 7, 1.5, 1.5, '#e8dcc0'); });
    ICONS.dmg = icon((p) => { p.line(3, 13, 12, 3, '#d8d8e4', 2); p.line(2, 10, 6, 14, '#a8741a', 2); p.px(13, 2, '#fff'); p.rect(10, 2, 3, 1, '#c02020'); });
    ICONS.rate = icon((p) => { p.poly([3, 1, 13, 1, 8, 8], '#e8dcc0'); p.poly([3, 15, 13, 15, 8, 8], '#e8dcc0'); p.poly([5, 3, 11, 3, 8, 7], '#f2c14e'); p.poly([6, 14, 10, 14, 8, 11], '#f2c14e'); p.rect(2, 0, 12, 1, '#6b4421'); p.rect(2, 15, 12, 1, '#6b4421'); });
    ICONS.heart = icon((p) => { p.ell(5, 6, 4, 4, '#d01020'); p.ell(11, 6, 4, 4, '#d01020'); p.poly([1, 7, 15, 7, 8, 15], '#d01020'); p.px(4, 4, '#ff9090'); });
    ICONS.boots = icon((p) => { p.rect(4, 2, 5, 10, '#6b4421'); p.rect(4, 11, 10, 4, '#4a2e15'); p.rect(4, 4, 5, 1, '#a8741a'); p.poly([1, 5, 4, 3, 4, 8], '#e8dcc0'); });
  }

  // =======================================================================
  // 6. MAPA, DECORACIÓN, LUCES Y CAMPO DE FLUJO (pathfinding)
  // =======================================================================
  const MW = 32, MH = 32, WALLH = 1.5, EYE = 0.6;
  const map = new Uint8Array(MW * MH);     // id de textura de pared (0 = suelo)
  const indoor = new Uint8Array(MW * MH);  // 1 = tiene techo, 0 = cielo abierto
  const solid = new Uint8Array(MW * MH);   // paredes + decoración sólida (colisión)
  const spawnCells = [];
  const torches = [];
  let decos = [];
  const START = { x: 15.5, y: 20.5, a: Math.PI };

  function buildMap() {
    const G = [];
    for (let y = 0; y < MH; y++) G.push(new Array(MW).fill('#'));
    const carve = (x0, y0, x1, y1, ch) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) G[y][x] = ch; };
    // anillo de pasillos interiores
    carve(3, 3, 28, 5, '.'); carve(3, 26, 28, 28, '.'); carve(3, 3, 5, 28, '.'); carve(26, 3, 28, 28, '.');
    // salas de las esquinas
    carve(3, 3, 7, 7, '.'); carve(24, 3, 28, 7, '.'); carve(3, 24, 7, 28, '.'); carve(24, 24, 28, 28, '.');
    // patio central a cielo abierto
    carve(9, 9, 22, 22, ',');
    // puertas al patio
    carve(14, 6, 17, 8, '.'); carve(14, 23, 17, 25, '.'); carve(6, 14, 8, 17, '.'); carve(23, 14, 25, 17, '.');
    carve(6, 20, 8, 21, '.'); carve(23, 10, 25, 11, '.');
    // columnas y estatua central
    carve(12, 12, 13, 13, 'M'); carve(18, 12, 19, 13, 'M'); carve(12, 18, 13, 19, 'M'); carve(18, 18, 19, 19, 'M');
    carve(15, 15, 16, 16, 'R');
    // nichos de aparición goblin
    for (const [x, y] of [[1, 1], [29, 1], [1, 29], [29, 29], [15, 1], [15, 29], [1, 15], [29, 15]]) carve(x, y, x + 1, y + 1, 'S');
    // pasillos que unen los nichos de las esquinas con el anillo
    carve(3, 1, 3, 2, '.'); carve(28, 1, 28, 2, '.'); carve(3, 29, 3, 30, '.'); carve(28, 29, 28, 30, '.');

    const isWood = (x, y) => ((y === 2 || y === 29) && ((x >= 8 && x <= 12) || (x >= 19 && x <= 23))) ||
      ((x === 2 || x === 29) && ((y >= 8 && y <= 12) || (y >= 19 && y <= 23)));
    const banners = ['11,8', '20,8', '11,23', '20,23', '8,11', '23,20'];
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = y * MW + x, ch = G[y][x];
      if (ch === '.' || ch === ',' || ch === 'S') {
        map[i] = 0; indoor[i] = ch === ',' ? 0 : 1;
        if (ch === 'S') spawnCells.push([x + 0.5, y + 0.5]);
        continue;
      }
      indoor[i] = 1;
      let t = 1;
      const nearS = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => G[y + dy] && G[y + dy][x + dx] === 'S');
      if (nearS) t = 5;
      else if (ch === 'R') t = 4;
      else if (banners.includes(`${x},${y}`)) t = 6;
      else if (ch === 'M' || (x >= 6 && x <= 25 && y >= 6 && y <= 25)) t = 2;
      else if (isWood(x, y)) t = 3;
      map[i] = t;
    }
  }

  function resetDecos() {
    decos = [];
    solid.set(map);
    for (let i = 0; i < solid.length; i++) solid[i] = map[i] ? 1 : 0;
    const add = (type, x, y, isSolid) => {
      const d = { type, x: x + 0.5, y: y + 0.5, solid: isSolid, hp: 20, alive: true, ph: Math.random() * 10 };
      decos.push(d);
      if (isSolid) solid[y * MW + x] = 1;
      return d;
    };
    torches.length = 0;
    for (const [x, y] of [[4, 4], [27, 4], [4, 27], [27, 27], [10, 10], [21, 10], [10, 21], [21, 21]]) torches.push(add('torch', x, y, true));
    for (const [x, y] of [[11, 15], [20, 16], [15, 11], [16, 20], [12, 4], [20, 27], [4, 20], [27, 11], [25, 26], [6, 27]]) add('barrel', x, y, true);
    setSeed(77);
    for (let i = 0; i < 26; i++) {
      const x = 3 + Math.floor(srand() * 26), y = 3 + Math.floor(srand() * 26);
      if (!solid[y * MW + x]) add('bones', x, y, false);
    }
  }

  // ---- Iluminación por sector (como DOOM): base + antorchas + luces dinámicas ----
  const LBASE = new Float32Array(MW * MH);
  const LACC = new Float32Array(MW * MH);
  const LIGHT = new Int32Array(MW * MH);
  const dynLights = [];
  function initLights() { for (let i = 0; i < MW * MH; i++) LBASE[i] = indoor[i] ? 0.42 : 0.6; }
  function addLight(x, y, r, inten) {
    const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(MW - 1, Math.floor(x + r));
    const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(MH - 1, Math.floor(y + r));
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
      if (d < r) { const k = 1 - d / r; LACC[cy * MW + cx] += inten * k * k; }
    }
  }
  function flashLight(x, y, r, inten, life) { dynLights.push({ x, y, r, i: inten, t: 0, life }); }
  function updateLights(time, dt) {
    LACC.set(LBASE);
    for (const t of torches) {
      const f = 0.82 + 0.1 * Math.sin(time * 11 + t.ph) + 0.08 * Math.sin(time * 23.7 + t.ph * 3);
      addLight(t.x, t.y, 5.2, 0.95 * f);
    }
    for (let i = dynLights.length - 1; i >= 0; i--) {
      const L = dynLights[i]; L.t += dt;
      if (L.t >= L.life) { dynLights.splice(i, 1); continue; }
      addLight(L.x, L.y, L.r, L.i * (1 - L.t / L.life));
    }
    for (let i = 0; i < MW * MH; i++) LIGHT[i] = Math.min(LACC[i] * 256, 430) | 0;
  }

  // ---- Campo de flujo: BFS desde la celda del jugador (los goblins bajan la pendiente) ----
  const FLOW = new Int16Array(MW * MH);
  const FQ = new Int16Array(MW * MH);
  let flowCell = -1, flowT = 0;
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function buildFlow(px, py) {
    FLOW.fill(-1);
    const s = (py | 0) * MW + (px | 0);
    let h = 0, t = 0;
    FLOW[s] = 0; FQ[t++] = s;
    while (h < t) {
      const c = FQ[h++], cx = c % MW, cy = (c / MW) | 0;
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        const n = ny * MW + nx;
        if (solid[n] || FLOW[n] >= 0) continue;
        if (dx && dy && (solid[cy * MW + nx] || solid[ny * MW + cx])) continue; // sin cortar esquinas
        FLOW[n] = FLOW[c] + 1; FQ[t++] = n;
      }
    }
    flowCell = s;
  }

  // ---- Utilidades de colisión y línea de visión ----
  function blocked(x, y, r) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
      if (cx < 0 || cy < 0 || cx >= MW || cy >= MH || solid[cy * MW + cx]) return true;
    }
    return false;
  }
  function moveCollide(e, dx, dy, r) {
    let hitX = false, hitY = false;
    if (dx) { const nx = e.x + dx; if (!blocked(nx, e.y, r)) e.x = nx; else hitX = true; }
    if (dy) { const ny = e.y + dy; if (!blocked(e.x, ny, r)) e.y = ny; else hitY = true; }
    return hitX || hitY;
  }
  const isWall = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || map[(y | 0) * MW + (x | 0)] > 0;
  function lineOfSight(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    const n = Math.ceil(d * 4);
    for (let i = 1; i < n; i++) { if (isWall(x0 + dx * i / n, y0 + dy * i / n)) return false; }
    return true;
  }

  // =======================================================================
  // 7. RENDERIZADOR (raycasting a baja resolución + sprites con z-buffer)
  // =======================================================================
  const R = { cv: $('screen'), ctx: null, W: 320, H: 200, img: null, buf: null, zbuf: null, F: 200, ps: 0.8, hor: 100, skyU: null, dirX: 1, dirY: 0, eye: EYE };
  const FOG = new Int32Array(1024);
  for (let i = 0; i < 1024; i++) FOG[i] = Math.round(256 * Math.exp(-(i / 16) * 0.105));
  const fogAt = (d) => FOG[Math.min(1023, (d * 16) | 0)];

  function resizeRenderer() {
    const v = $('view');
    const cw = v.clientWidth || window.innerWidth, ch = v.clientHeight || window.innerHeight;
    R.W = settings.res | 0;
    R.H = clamp(Math.round(R.W * ch / Math.max(1, cw)), 100, Math.round(R.W * 1.25));
    R.cv.width = R.W; R.cv.height = R.H;
    R.ctx = R.cv.getContext('2d');
    R.ctx.imageSmoothingEnabled = false;
    R.img = R.ctx.createImageData(R.W, R.H);
    R.buf = new Uint32Array(R.img.data.buffer);
    R.zbuf = new Float32Array(R.W);
    R.skyU = new Int32Array(R.W);
    updateProjection();
  }
  function updateProjection() { R.ps = Math.tan(settings.fov * Math.PI / 360); R.F = (R.W / 2) / R.ps; }

  function shade(c, s) {
    let r = ((c & 255) * s) >> 8, g = (((c >>> 8) & 255) * s) >> 8, b = (((c >>> 16) & 255) * s) >> 8;
    if (s > 256) { if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255; }
    return 0xff000000 | (b << 16) | (g << 8) | r;
  }

  function renderWorld(cam) {
    const W = R.W, H = R.H, F = R.F, buf = R.buf, zbuf = R.zbuf, ps = R.ps;
    const px = cam.x, py = cam.y, eye = cam.z;
    const dirX = Math.cos(cam.a), dirY = Math.sin(cam.a);
    const plX = -dirY * ps, plY = dirX * ps;
    const hor = (H >> 1) + cam.pitch;
    R.hor = hor; R.dirX = dirX; R.dirY = dirY; R.eye = eye; R.px = px; R.py = py;

    // --- suelo, techo y cielo (por filas) ---
    const rx0 = dirX - plX, ry0 = dirY - plY, rx1 = dirX + plX, ry1 = dirY + plY;
    const skyD = TEX_SKY.d, SW = 256, SH = 128;
    for (let x = 0; x < W; x++) {
      const ang = cam.a + Math.atan(((2 * x) / W - 1) * ps);
      let u = Math.floor((ang / TAU) * SW * 4) % SW; if (u < 0) u += SW;
      R.skyU[x] = u;
    }
    const cobble = TEX_COBBLE.d, dirt = TEX_DIRT.d, ceil = TEX_CEIL.d;
    for (let y = 0; y < H; y++) {
      const floor = y >= hor;
      const p = floor ? (y - hor + 0.5) : (hor - y - 0.5);
      let o = y * W;
      const skyV = floor ? 0 : clamp(Math.floor(SH - 1 - (hor - y) * SH / (H * 0.85)), 0, SH - 1);
      const skyRow = skyV * SW;
      if (p <= 0.3) { for (let x = 0; x < W; x++) buf[o++] = floor ? 0xff000000 : skyD[skyRow + R.skyU[x]]; continue; }
      const rowDist = (floor ? eye : (WALLH - eye)) * F / p;
      const fog = fogAt(rowDist);
      const sx = rowDist * (rx1 - rx0) / W, sy = rowDist * (ry1 - ry0) / W;
      let fx = px + rowDist * rx0, fy = py + rowDist * ry0;
      for (let x = 0; x < W; x++, o++, fx += sx, fy += sy) {
        if (fx < 0 || fy < 0 || fx >= MW || fy >= MH) { buf[o] = floor ? 0xff000000 : skyD[skyRow + R.skyU[x]]; continue; }
        const cx = fx | 0, cy = fy | 0, ci = cy * MW + cx;
        if (!floor && !indoor[ci]) { buf[o] = skyD[skyRow + R.skyU[x]]; continue; }
        const tx = ((fx - cx) * 64) | 0, ty = ((fy - cy) * 64) | 0;
        const td = floor ? (indoor[ci] ? cobble : dirt) : ceil;
        buf[o] = shade(td[(ty << 6) | tx], (LIGHT[ci] * fog) >> 8);
      }
    }

    // --- paredes (DDA por columna) ---
    for (let x = 0; x < W; x++) {
      const camX = (2 * x) / W - 1;
      const rdx = dirX + plX * camX, rdy = dirY + plY * camX;
      let mx = px | 0, my = py | 0;
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx), ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      let stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (px - mx) * ddx; } else { stepX = 1; sdx = (mx + 1 - px) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (py - my) * ddy; } else { stepY = 1; sdy = (my + 1 - py) * ddy; }
      let hit = 0, side = 0, n = 0;
      while (n++ < 90) {
        if (sdx < sdy) { sdx += ddx; mx += stepX; side = 0; } else { sdy += ddy; my += stepY; side = 1; }
        if (mx < 0 || my < 0 || mx >= MW || my >= MH) break;
        hit = map[my * MW + mx]; if (hit) break;
      }
      if (!hit) { zbuf[x] = 1e9; continue; }
      const perp = Math.max(0.02, side === 0 ? sdx - ddx : sdy - ddy);
      zbuf[x] = perp;
      const top = hor - (WALLH - eye) * F / perp, bot = hor + eye * F / perp;
      let wx = side === 0 ? py + perp * rdy : px + perp * rdx; wx -= Math.floor(wx);
      let tx = (wx * TW) | 0;
      if (side === 0 && rdx > 0) tx = TW - 1 - tx;
      if (side === 1 && rdy < 0) tx = TW - 1 - tx;
      const lx = side === 0 ? mx - stepX : mx, ly = side === 1 ? my - stepY : my;
      const lc = (ly >= 0 && ly < MH && lx >= 0 && lx < MW) ? ly * MW + lx : my * MW + mx;
      let s = (LIGHT[lc] * fogAt(perp)) >> 8;
      if (side === 1) s = (s * 200) >> 8;
      const td = WALL_TEX[hit].d;
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H, Math.ceil(bot));
      const step = TWH / (bot - top);
      let tp = (y0 - top) * step;
      for (let y = y0, o = y0 * W + x; y < y1; y++, o += W) {
        let ty = tp | 0; if (ty > TWH - 1) ty = TWH - 1;
        buf[o] = shade(td[ty * TW + tx], s);
        tp += step;
      }
    }
  }

  // Sprites: {x,y,z,w,h,tex,col,full,flash,ent}
  const sprList = [];
  function renderSprites() {
    const W = R.W, H = R.H, F = R.F, buf = R.buf, zbuf = R.zbuf, hor = R.hor, eye = R.eye;
    const dirX = R.dirX, dirY = R.dirY;
    for (const s of sprList) {
      const rx = s.x - R.px, ry = s.y - R.py;
      s.depth = rx * dirX + ry * dirY;
      s.lat = rx * -dirY + ry * dirX;
    }
    sprList.sort((a, b) => b.depth - a.depth);
    for (const s of sprList) {
      const depth = s.depth;
      if (depth < 0.12 || depth > 40 || (!s.ent && depth < (s.tex ? 0.3 : 0.55))) { if (s.ent) s.ent.rect = null; continue; }
      const sxc = W / 2 + (s.lat / depth) * F;
      const pw = s.w * F / depth, ph = s.h * F / depth;
      const yb = hor + (eye - s.z) * F / depth, yt = yb - ph;
      const x0 = sxc - pw / 2;
      if (s.ent) s.ent.rect = { x0, x1: x0 + pw, y0: yt, y1: yb, depth, tex: s.tex };
      if (x0 + pw < 0 || x0 >= W || yb < 0 || yt >= H) continue;
      let sh;
      if (s.full) sh = 256;
      else {
        const cx = clamp(s.x | 0, 0, MW - 1), cy = clamp(s.y | 0, 0, MH - 1);
        sh = (LIGHT[cy * MW + cx] * fogAt(depth)) >> 8;
      }
      if (s.flash) sh = 620;
      const xa = Math.max(0, Math.ceil(x0)), xb = Math.min(W, Math.ceil(x0 + pw));
      const ya = Math.max(0, Math.ceil(yt)), yz = Math.min(H, Math.ceil(yb));
      if (!s.tex) {
        const c = shade(s.col, sh);
        for (let x = xa; x < xb; x++) {
          if (depth >= zbuf[x]) continue;
          for (let y = ya, o = ya * W + x; y < yz; y++, o += W) buf[o] = c;
        }
        continue;
      }
      const t = s.tex, tw = t.w, th = t.h, td = t.d;
      const kx = tw / pw, ky = th / ph;
      for (let x = xa; x < xb; x++) {
        if (depth >= zbuf[x]) continue;
        let tx = ((x - x0) * kx) | 0; if (tx >= tw) tx = tw - 1;
        if (s.flip) tx = tw - 1 - tx;
        let tyf = (ya - yt) * ky;
        for (let y = ya, o = ya * W + x; y < yz; y++, o += W, tyf += ky) {
          let ty = tyf | 0; if (ty >= th) ty = th - 1;
          const c = td[ty * tw + tx];
          if (c >>> 24) buf[o] = shade(c, sh);
        }
      }
    }
  }

  // =======================================================================
  // 8. JUGADOR, ARMAS Y COMBATE
  // =======================================================================
  const WEAPONS = {
    axe: { slot: 1, name: 'Hacha de la Abuela', ammo: null, rate: 0.42, dmg: 62, melee: true, range: 1.6, arc: 0.8, snd: 'axe', kick: 0 },
    pistol: { slot: 2, name: 'Escupeplomo', ammo: 'bullets', rate: 0.3, dmg: 22, pellets: 1, spread: 0.006, snd: 'pistol', kick: 7, shake: 0.12 },
    shotgun: { slot: 3, name: 'La Desgoblinizadora', ammo: 'shells', rate: 0.82, dmg: 14, pellets: 9, spread: 0.085, snd: 'shotgun', kick: 16, shake: 0.5 },
    chaingun: { slot: 4, name: 'Molinillo de Duendes', ammo: 'bullets', rate: 0.075, dmg: 15, pellets: 1, spread: 0.03, snd: 'chaingun', kick: 4, shake: 0.1 },
    rocket: { slot: 5, name: 'Adiós Verdecito', ammo: 'rockets', rate: 0.95, dmg: 110, radius: 2.6, projectile: true, snd: 'rocket', kick: 18, shake: 0.45 }
  };
  const WEAPON_ORDER = ['axe', 'pistol', 'shotgun', 'chaingun', 'rocket'];
  const AMMO_NAME = { bullets: 'BALAS', shells: 'CARTUCHOS', rockets: 'COHETES' };

  const P = {};
  function resetPlayer() {
    Object.assign(P, {
      x: START.x, y: START.y, a: START.a, look: 0, z: 0, vz: 0, vx: 0, vy: 0, onGround: true,
      hp: 100, maxHp: 100, armor: 0, gold: 0, score: 0, kills: 0,
      owned: { axe: true, pistol: true, shotgun: false, chaingun: false, rocket: false },
      ammo: { bullets: 100, shells: 0, rockets: 0 }, maxAmmo: { bullets: 300, shells: 60, rockets: 30 },
      cur: 'pistol', next: null, switchT: 0, fireT: 0, flashT: 0, atkAnim: 0, kick: 0, bobT: 0, bobAmt: 0,
      dmgMul: 1, rateMul: 1, speedMul: 1, dmgUp: 0, rateUp: 0, hpUp: 0, spdUp: 0,
      dashT: 0, dashCd: 0, dashX: 0, dashY: 0, emptyT: 0,
      alive: true, deathT: 0, combo: 0, comboT: 0,
    });
  }

  // Estado global de la partida
  const GS = {
    state: 'splash', time: 0, wave: 0, waveState: 'idle', waveTimer: 0, toSpawn: [], spawnT: 0, maxAlive: 12,
    enemies: [], projs: [], parts: [], pickups: [], effects: [], booms: [],
    alive: 0, waveTotal: 0, waveDamage: 0, shake: 0, diff: DIFFS[1],
    stats: { shots: 0, hits: 0, gold: 0, time: 0 }
  };

  function switchTo(id) {
    if (!P.owned[id] || (id === P.cur && !P.next) || id === P.next || !P.alive) return;
    P.next = id; P.switchT = 0.3; AudioSys.play('switch');
  }
  function cycleWeapon(dir) {
    const base = P.next || P.cur;
    let i = WEAPON_ORDER.indexOf(base);
    for (let k = 0; k < WEAPON_ORDER.length; k++) {
      i = (i + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length;
      const w = WEAPON_ORDER[i];
      if (P.owned[w] && (!WEAPONS[w].ammo || P.ammo[WEAPONS[w].ammo] > 0 || w === 'axe')) { switchTo(w); return; }
    }
  }
  function autoSwitch() {
    for (const w of ['rocket', 'chaingun', 'shotgun', 'pistol']) {
      if (w === 'rocket') continue; // nunca auto-cambiar al lanzacohetes (peligroso)
      if (P.owned[w] && P.ammo[WEAPONS[w].ammo] > 0) { switchTo(w); return; }
    }
    switchTo('axe');
  }

  function tryFire() {
    const w = WEAPONS[P.cur];
    if (P.switchT > 0 || P.fireT > 0 || !P.alive) return;
    if (w.ammo && P.ammo[w.ammo] <= 0) {
      if (P.emptyT <= 0) { AudioSys.play('empty'); P.emptyT = 0.5; UI.feed(`¡Sin ${AMMO_NAME[w.ammo].toLowerCase()}!`, 'bad'); autoSwitch(); }
      return;
    }
    if (w.ammo) P.ammo[w.ammo]--;
    P.fireT = w.rate / P.rateMul;
    AudioSys.play(w.snd);
    GS.stats.shots++;
    P.kick = w.kick || 0;
    GS.shake += settings.shake ? (w.shake || 0) : 0;
    if (w.melee) { P.atkAnim = 0.3; doMelee(w); return; }
    P.flashT = 0.07;
    Weapons3D.fire(P.cur);
    flashLight(P.x, P.y, 5.5, 0.8, 0.09);
    if (w.projectile) { fireRocket(w); return; }
    let any = false;
    for (let i = 0; i < w.pellets; i++) {
      const r = w.spread * Math.sqrt(Math.random()), th = Math.random() * TAU;
      const ox = Math.tan(r * Math.cos(th)) * R.F, oy = Math.tan(r * Math.sin(th)) * R.F;
      if (hitscan(ox, oy, w.dmg * P.dmgMul)) any = true;
    }
    if (any) GS.stats.hits++;
  }

  // Disparo instantáneo resuelto en espacio de pantalla (usa los rectángulos del último fotograma)
  function hitscan(ox, oy, dmg) {
    const W = R.W, H = R.H;
    const sx = W / 2 + ox, sy = H / 2 + oy;
    const col = clamp(sx | 0, 0, W - 1);
    let best = null, bd = R.zbuf[col], bestHead = false;
    const test = (ent, isEnemy) => {
      const r = ent.rect;
      if (!r || sx < r.x0 || sx >= r.x1 || sy < r.y0 || sy >= r.y1 || r.depth >= bd) return;
      const t = r.tex;
      const tx = ((sx - r.x0) / (r.x1 - r.x0) * t.w) | 0, ty = ((sy - r.y0) / (r.y1 - r.y0) * t.h) | 0;
      let ok = false;
      for (let yy = -1; yy <= 1 && !ok; yy++) for (let xx = -1; xx <= 1 && !ok; xx++) {
        const X = tx + xx, Y = ty + yy;
        if (X >= 0 && Y >= 0 && X < t.w && Y < t.h && (t.d[Y * t.w + X] >>> 24)) ok = true;
      }
      if (!ok) return;
      best = ent; bd = r.depth; bestHead = isEnemy && (sy - r.y0) / (r.y1 - r.y0) < 0.36;
    };
    for (const e of GS.enemies) if (!e.dead) test(e, true);
    for (const d of decos) if (d.type === 'barrel' && d.alive) test(d, false);
    if (best) {
      const hz = R.eye + (R.hor - sy) * bd / R.F;
      if (best.type === 'barrel') { damageBarrel(best, dmg); return false; }
      damageEnemy(best, bestHead ? dmg * 2 : dmg, { kind: 'bullet', head: bestHead, fromX: P.x, fromY: P.y, z: hz });
      return true;
    }
    // impacto contra pared / suelo / techo
    const camX = (2 * sx) / W - 1;
    const plX = -R.dirY * R.ps, plY = R.dirX * R.ps;
    const rdx = R.dirX + plX * camX, rdy = R.dirY + plY * camX;
    let d = R.zbuf[col], hz = null;
    if (sy > R.hor) { const fd = R.eye * R.F / (sy - R.hor); if (fd < d) { d = fd; hz = 0.02; } }
    else if (sy < R.hor) {
      const cd = (WALLH - R.eye) * R.F / (R.hor - sy);
      if (cd < d) {
        const cx = (R.px + rdx * cd) | 0, cy = (R.py + rdy * cd) | 0;
        if (cx >= 0 && cy >= 0 && cx < MW && cy < MH && indoor[cy * MW + cx]) { d = cd; hz = WALLH - 0.02; } else if (d > 1e8) return false;
      }
    }
    if (d > 60) return false;
    const k = d * 0.97;
    const hx = R.px + rdx * k, hy = R.py + rdy * k;
    if (hz === null) hz = R.eye + (R.hor - sy) * d / R.F;
    if (hz > WALLH && !indoor[clamp(hy | 0, 0, MH - 1) * MW + clamp(hx | 0, 0, MW - 1)]) return false;
    for (let i = 0; i < 4; i++) addPart(hx, hy, hz, rand(-1, 1), rand(-1, 1), rand(0, 2), 0.35, i ? 0xff707070 : 0xff40d0ff, 0.035, true, 0.6);
    if (Math.random() < 0.3) AudioSys.at('puff', hx, hy, 0.6);
    return false;
  }

  function doMelee(w) {
    let hit = false;
    for (const e of GS.enemies) {
      if (e.dead) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = Math.hypot(dx, dy);
      if (d > w.range + e.T.r) continue;
      const ang = Math.abs(angDiff(P.a, Math.atan2(dy, dx)));
      if (ang < w.arc || d < e.T.r + 0.35) {
        damageEnemy(e, w.dmg * P.dmgMul, { kind: 'melee', fromX: P.x, fromY: P.y, z: e.T.h * 0.6 });
        hit = true;
      }
    }
    for (const b of decos) {
      if (b.type !== 'barrel' || !b.alive) continue;
      const d = Math.hypot(b.x - P.x, b.y - P.y);
      if (d < w.range + 0.3 && Math.abs(angDiff(P.a, Math.atan2(b.y - P.y, b.x - P.x))) < w.arc) { damageBarrel(b, w.dmg); hit = true; }
    }
    if (hit) { AudioSys.play('axehit'); GS.stats.hits++; GS.shake += settings.shake ? 0.15 : 0; }
  }

  function fireRocket(w) {
    const sp = 13, c = Math.cos(P.a), s = Math.sin(P.a);
    GS.projs.push({
      kind: 'rocket', owner: 'player', x: P.x + c * 0.35, y: P.y + s * 0.35, z: EYE + P.z - 0.12,
      vx: c * sp, vy: s * sp, vz: Math.tan(P.look) * sp, dmg: w.dmg * P.dmgMul, radius: w.radius, life: 4, grav: 0, trail: 0
    });
  }

  function hurtPlayer(dmg, fx, fy) {
    if (!P.alive || GS.state !== 'playing' || dmg <= 0) return;
    if (P.dashT > 0) return; // esquive con invulnerabilidad
    const absorbed = Math.min(P.armor, dmg * 0.5);
    P.armor -= absorbed; dmg -= absorbed;
    P.hp -= dmg;
    GS.waveDamage += dmg;
    UI.hurt(Math.min(1, 0.35 + dmg / 30), angDiff(P.a, Math.atan2(fy - P.y, fx - P.x)));
    AudioSys.play('player_hurt');
    if (settings.shake) GS.shake += 0.25;
    if (P.hp <= 0) { P.hp = 0; playerDie(); }
  }

  function playerDie() {
    P.alive = false; P.deathT = 0;
    AudioSys.play('player_die');
    UI.announce('¡MUERTO!', pick(GO_QUOTES), 2.4, '');
    AudioSys.duck = 0.25;
  }

  // =======================================================================
  // 9. ENEMIGOS, PROYECTILES, PARTÍCULAS Y OLEADAS
  // =======================================================================
  const ETYPES = {
    grunt: { name: 'Goblin garrotero', hp: 40, speed: 3.1, r: 0.26, w: 0.82, h: 0.82, melee: 9, atkRange: 0.95, atkCd: 0.9, windup: 0.3, gold: 10, score: 100, pitch: 1 },
    archer: { name: 'Goblin arquero', hp: 32, speed: 2.7, r: 0.26, w: 0.82, h: 0.82, ranged: 'arrow', dmg: 9, range: 11, keep: 5, atkCd: 2.1, windup: 0.5, gold: 15, score: 150, pitch: 1.15 },
    kamikaze: { name: 'Goblin kamikaze', hp: 22, speed: 4.7, r: 0.24, w: 0.74, h: 0.74, kamikaze: true, dmg: 30, radius: 2.0, gold: 12, score: 130, pitch: 1.4 },
    brute: { name: 'Goblin bruto', hp: 210, speed: 2.15, r: 0.42, w: 1.35, h: 1.35, melee: 24, atkRange: 1.2, atkCd: 1.3, windup: 0.45, gold: 40, score: 400, pitch: 0.6, knockRes: 0.7 },
    shaman: { name: 'Goblin chamán', hp: 85, speed: 2.4, r: 0.28, w: 0.95, h: 0.95, ranged: 'fireball', dmg: 11, range: 12, keep: 6, atkCd: 2.8, windup: 0.6, gold: 35, score: 350, pitch: 1.25 },
    boss: { name: 'Rey Verrugón', hp: 1500, speed: 2.0, r: 0.62, w: 2.1, h: 2.1, melee: 34, atkRange: 1.7, atkCd: 1.4, windup: 0.5, boss: true, gold: 300, score: 5000, pitch: 0.45, knockRes: 0.95 }
  };

  const KILL_LINES = ['¡Goblin hecho puré!', '¡Ese no vuelve a robar gallinas!', '¡Verde y aplastado!', '¡Directo al compost!',
    '¡Uno menos en el árbol genealógico!', '¡Desgoblinizado!', '¡Fuera de mi mazmorra!', '¡Ñam, abono orgánico!', '¡Le diste en la autoestima!'];
  const COMBO_NAMES = { 2: '¡DOBLE!', 3: '¡TRIPLE!', 5: '¡MASACRE!', 8: '¡GOBLINOCIDIO!', 12: '¡IMPARABLE!', 20: '¡DIOS DE LA MASACRE!' };
  const WAVE_QUOTES = ['Huelen a queso viejo y furia.', 'Traen palos. Muchos palos.', '¡Vienen por tu oro!', 'Alguien les dijo que tenías galletas.',
    'No pagaron entrada.', 'Su mamá no los quiere. Tú tampoco.', 'Esta vez trajeron a los primos.', 'Huele a pies verdes…'];
  const GO_QUOTES = ['Los goblins bailan sobre tu tumba.', 'Tu cabeza será su nuevo balón.', 'Gruñido el Traidor ya está vendiendo tus botas.',
    'Derrotado por criaturas de 80 cm.', 'Moriste como viviste: rodeado de goblins.', 'Los goblins escribirán canciones (malas) sobre esto.'];

  function addPart(x, y, z, vx, vy, vz, life, col, size, full, grav = 1) {
    if (GS.parts.length > 420) GS.parts.shift();
    GS.parts.push({ x, y, z, vx, vy, vz, life, max: life, col, size, full, grav });
  }
  function blood(x, y, z, n, big) {
    for (let i = 0; i < n; i++) {
      addPart(x + rand(-0.1, 0.1), y + rand(-0.1, 0.1), z, rand(-1.6, 1.6) * (big ? 2 : 1), rand(-1.6, 1.6) * (big ? 2 : 1), rand(0.5, 3.2) * (big ? 1.4 : 1),
        rand(0.6, 1.4), Math.random() < 0.5 ? 0xff1c8a3a : 0xff28b04a, rand(0.035, big ? 0.09 : 0.06), false, 1);
    }
  }
  function addEffect(x, y, z, frames, dur, size) { GS.effects.push({ x, y, z, frames, dur, t: 0, size }); }

  function hpScale() { return (1 + (GS.wave - 1) * 0.075) * GS.diff.hp; }

  function spawnEnemy(type, at) {
    const T = ETYPES[type];
    let pos = at;
    if (!pos) {
      const far = spawnCells.filter(([x, y]) => Math.hypot(x - P.x, y - P.y) > 7);
      pos = pick(far.length ? far : spawnCells);
    }
    const hp = Math.round(T.hp * hpScale());
    const e = {
      type, T, x: pos[0] + rand(-0.25, 0.25), y: pos[1] + rand(-0.25, 0.25), hp, maxHp: hp,
      state: 'walk', stateT: 0, atkCd: rand(0.5, 1.5), animT: Math.random() * 5, flash: 0, kx: 0, ky: 0,
      los: false, losT: 0, dead: false, deadT: 0, gib: false, flip: Math.random() < 0.5,
      spdMul: (1 + Math.min(GS.wave * 0.015, 0.3)) * rand(0.9, 1.12), strafe: Math.random() < 0.5 ? 1 : -1,
      laughT: rand(3, 10), stuckT: 0, summonT: 6, bombT: 3, rage: false
    };
    if (blocked(e.x, e.y, T.r)) { e.x = pos[0]; e.y = pos[1]; }
    GS.enemies.push(e);
    GS.alive++;
    for (let i = 0; i < 14; i++) addPart(e.x, e.y, rand(0, T.h), rand(-1, 1), rand(-1, 1), rand(0.5, 2), 0.7, 0xff40c060, 0.08, true, -0.3);
    AudioSys.at('spawn', e.x, e.y, 0.6);
    if (T.boss) {
      AudioSys.play('boss');
      UI.announce('¡REY VERRUGÓN!', 'Gordo, verde y muy enfadado', 3, 'green');
      if (settings.shake) GS.shake += 1;
    }
    return e;
  }

  function damageEnemy(e, dmg, info) {
    if (e.dead) return;
    e.hp -= dmg; e.flash = 0.07;
    const z = info.z != null ? clamp(info.z, 0.05, e.T.h) : e.T.h * 0.6;
    blood(e.x, e.y, z, Math.min(14, 3 + (dmg / 8) | 0), false);
    if (info.fromX != null) {
      const dx = e.x - info.fromX, dy = e.y - info.fromY, d = Math.hypot(dx, dy) || 1;
      const kb = Math.min(7, dmg * 0.09) * (1 - (e.T.knockRes || 0));
      e.kx += dx / d * kb; e.ky += dy / d * kb;
    }
    if (info.head) UI.hitMarker(true); else if (info.kind !== 'explosion') UI.hitMarker(false);
    if (e.hp <= 0) { killEnemy(e, info, dmg); return; }
    const painChance = e.T.boss ? 0.04 : clamp(dmg / e.T.hp * 1.6 + 0.12, 0, 0.85);
    if (e.state !== 'attack' && Math.random() < painChance) { e.state = 'pain'; e.stateT = 0.2; }
    AudioSys.at('gob_hurt', e.x, e.y, 0.8, e.T.pitch);
  }

  function killEnemy(e, info, dmg) {
    const T = e.T;
    e.dead = true; e.deadT = 0; e.state = 'dead';
    GS.alive--;
    e.gib = info.kind === 'explosion' || (dmg > e.maxHp * 0.9 && Math.random() < 0.65) || (info.kind === 'melee' && Math.random() < 0.2);
    if (e.gib) { blood(e.x, e.y, T.h * 0.5, 26, true); AudioSys.at('splat', e.x, e.y, 1); }
    else { blood(e.x, e.y, T.h * 0.5, 10, false); AudioSys.at('gob_die', e.x, e.y, 1, T.pitch); }
    // combo y puntuación
    P.combo = P.comboT > 0 ? P.combo + 1 : 1; P.comboT = 2.6;
    const mult = 1 + Math.min(P.combo - 1, 8) * 0.25;
    const pts = Math.round(T.score * (1 + (GS.wave - 1) * 0.1) * mult * (info.head ? 1.5 : 1));
    P.score += pts; P.kills++;
    UI.combo(P.combo, mult);
    if (COMBO_NAMES[P.combo]) { UI.announce(COMBO_NAMES[P.combo], `x${mult.toFixed(2)} puntos`, 1.2, 'gold'); AudioSys.play('combo'); }
    if (info.head) { UI.feed('¡HEADSHOT! +50%', 'gold'); AudioSys.play('headshot', 0.7); }
    if (T.boss) { UI.announce('¡REY DERROTADO!', `+${pts} puntos · ¡qué peste!`, 3, 'gold'); AudioSys.play('wave_clear'); }
    else if (Math.random() < 0.3) UI.feed(pick(KILL_LINES), 'kill');
    // botín
    const gold = Math.round(T.gold * GS.diff.gold * (1 + GS.wave * 0.05));
    const n = Math.min(T.boss ? 20 : 5, Math.max(1, Math.ceil(gold / 10)));
    for (let i = 0; i < n; i++) dropPickup('coin', e.x, e.y, Math.max(1, Math.round(gold / n)));
    const r = Math.random();
    if (T.boss) { dropPickup('potion', e.x, e.y); dropPickup('armor', e.x, e.y); dropPickup('ammo', e.x, e.y); }
    else if (r < 0.07) dropPickup('potion', e.x, e.y);
    else if (r < 0.24) {
      const opts = ['ammo'];
      if (P.owned.shotgun) opts.push('shells', 'shells');
      if (P.owned.rocket) opts.push('rockets');
      dropPickup(pick(opts), e.x, e.y);
    }
    if (T.kamikaze) GS.booms.push({ x: e.x, y: e.y, t: 0.12, radius: T.radius, dmg: T.dmg, owner: 'enemy' });
    // límite de cadáveres
    let corpses = GS.enemies.filter((o) => o.dead);
    if (corpses.length > 70) GS.enemies.splice(GS.enemies.indexOf(corpses[0]), 1);
  }

  function dropPickup(kind, x, y, value) {
    const a = Math.random() * TAU, sp = rand(0.5, 2.2);
    GS.pickups.push({ kind, x, y, z: 0.3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rand(1.5, 3), value: value || 0, t: Math.random() * 6, life: 40 });
  }

  function damageBarrel(b, dmg) {
    if (!b.alive) return;
    b.hp -= dmg;
    if (b.hp <= 0) {
      b.alive = false;
      solid[(b.y | 0) * MW + (b.x | 0)] = 0; flowCell = -1;
      GS.booms.push({ x: b.x, y: b.y, t: 0.05, radius: 2.8, dmg: 120, owner: 'barrel' });
    }
  }

  function explode(x, y, z, radius, dmg, owner) {
    AudioSys.at('explode', x, y, 1.4);
    flashLight(x, y, 6.5, 1.5, 0.4);
    addEffect(x, y, Math.max(0.5, z), SPR.explosion, 0.5, radius * 0.75);
    for (let i = 0; i < 26; i++) addPart(x, y, z + 0.2, rand(-4, 4), rand(-4, 4), rand(0, 5), rand(0.3, 0.8), Math.random() < 0.5 ? 0xff20a0ff : 0xff1060e0, rand(0.04, 0.09), true, 0.8);
    for (let i = 0; i < 10; i++) addPart(x, y, z + 0.3, rand(-1, 1), rand(-1, 1), rand(0.4, 1.5), rand(0.8, 1.6), 0xff303438, rand(0.12, 0.22), false, -0.25);
    const pd = Math.hypot(P.x - x, P.y - y);
    if (settings.shake) GS.shake += 0.9 / (1 + pd * 0.25);
    for (const e of GS.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < radius + e.T.r && lineOfSight(x, y, e.x, e.y)) {
        const k = 1 - d / (radius + e.T.r);
        damageEnemy(e, dmg * (0.35 + 0.65 * k), { kind: 'explosion', fromX: x, fromY: y });
      }
    }
    for (const b of decos) {
      if (b.type === 'barrel' && b.alive && Math.hypot(b.x - x, b.y - y) < radius * 0.9) damageBarrel(b, 999);
    }
    if (pd < radius && lineOfSight(x, y, P.x, P.y)) {
      const k = 1 - pd / radius;
      const mul = owner === 'player' ? 0.35 : owner === 'barrel' ? 0.6 : GS.diff.dmg;
      hurtPlayer(dmg * k * mul, x, y);
    }
  }

  function enemyShoot(e) {
    const T = e.T;
    const z0 = T.h * 0.65;
    const dx = P.x - e.x, dy = P.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (T.ranged === 'arrow') {
      const sp = 11, a = Math.atan2(dy + P.vy * d / sp * 0.5, dx + P.vx * d / sp * 0.5) + rand(-0.04, 0.04);
      GS.projs.push({ kind: 'arrow', owner: 'enemy', x: e.x, y: e.y, z: z0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (EYE * 0.8 - z0) / (d / sp), dmg: T.dmg * GS.diff.dmg, life: 3, grav: 0 });
      AudioSys.at('arrow', e.x, e.y, 0.9);
    } else if (T.ranged === 'fireball') {
      const sp = 7, base = Math.atan2(dy, dx);
      for (const off of [-0.2, 0, 0.2]) {
        GS.projs.push({ kind: 'fireball', owner: 'enemy', x: e.x, y: e.y, z: z0, vx: Math.cos(base + off) * sp, vy: Math.sin(base + off) * sp, vz: (EYE * 0.8 - z0) / (d / sp), dmg: T.dmg * GS.diff.dmg, life: 4, grav: 0 });
      }
      AudioSys.at('fireball', e.x, e.y, 1);
    }
  }

  function bossThink(e, dt, dist) {
    e.summonT -= dt; e.bombT -= dt;
    if (!e.rage && e.hp < e.maxHp * 0.5) { e.rage = true; e.spdMul *= 1.35; UI.announce('¡FURIA REAL!', 'El rey está MUY enfadado', 2, ''); AudioSys.at('roar', e.x, e.y, 1.2, 0.5); }
    if (e.summonT <= 0) {
      e.summonT = e.rage ? 7 : 10;
      AudioSys.at('roar', e.x, e.y, 1.1, 0.5);
      for (let i = 0; i < (e.rage ? 4 : 3); i++) {
        const a = Math.random() * TAU, sx = e.x + Math.cos(a) * 1.2, sy = e.y + Math.sin(a) * 1.2;
        if (!blocked(sx, sy, 0.26)) spawnEnemy(Math.random() < 0.7 ? 'grunt' : 'kamikaze', [sx, sy]);
      }
    }
    if (e.bombT <= 0 && e.los && dist > 2.5) {
      e.bombT = e.rage ? 2.4 : 3.6;
      const n = e.rage ? 5 : 3, tf = 1.1, g = 9, z0 = e.T.h * 0.9;
      for (let i = 0; i < n; i++) {
        const tx = P.x + rand(-1.6, 1.6), ty = P.y + rand(-1.6, 1.6);
        GS.projs.push({ kind: 'bomb', owner: 'enemy', x: e.x, y: e.y, z: z0, vx: (tx - e.x) / tf, vy: (ty - e.y) / tf, vz: (0.5 * g * tf * tf - z0) / tf, grav: g, dmg: 26 * GS.diff.dmg, life: 3, radius: 1.8 });
      }
      AudioSys.at('gob_laugh', e.x, e.y, 1.2, 0.5);
    }
  }

  function updateEnemy(e, dt) {
    e.animT += dt;
    if (e.dead) { e.deadT += dt; return; }
    if (e.flash > 0) e.flash -= dt;
    const T = e.T;
    const dx = P.x - e.x, dy = P.y - e.y, dist = Math.hypot(dx, dy) || 0.001;
    e.losT -= dt;
    if (e.losT <= 0) { e.los = lineOfSight(e.x, e.y, P.x, P.y); e.losT = 0.12 + Math.random() * 0.12; }
    e.atkCd -= dt;
    if (e.kx || e.ky) {
      moveCollide(e, e.kx * dt, e.ky * dt, T.r);
      const k = Math.max(0, 1 - dt * 7); e.kx *= k; e.ky *= k;
      if (Math.abs(e.kx) + Math.abs(e.ky) < 0.05) { e.kx = 0; e.ky = 0; }
    }
    e.laughT -= dt;
    if (e.laughT <= 0) { e.laughT = rand(5, 14); if (dist < 14) AudioSys.at(e.type === 'brute' ? 'roar' : 'gob_laugh', e.x, e.y, 0.5, T.pitch); }
    // seguro anti-atascos: si quedó en una zona inalcanzable, reaparece en un nicho conectado
    if (FLOW[(e.y | 0) * MW + (e.x | 0)] < 0 && !e.los) {
      e.lostT = (e.lostT || 0) + dt;
      if (e.lostT > 3) {
        const ok = spawnCells.filter(([x, y]) => FLOW[(y | 0) * MW + (x | 0)] >= 0);
        if (ok.length) { const s = pick(ok); e.x = s[0]; e.y = s[1]; }
        e.lostT = 0;
      }
    } else e.lostT = 0;
    if (e.state === 'pain') { e.stateT -= dt; if (e.stateT <= 0) e.state = 'walk'; return; }
    if (e.state === 'attack') {
      e.stateT -= dt;
      if (e.stateT <= 0) {
        e.state = 'walk';
        if (T.melee) {
          if (dist < T.atkRange + T.r + 0.4 && P.alive) {
            hurtPlayer(T.melee * GS.diff.dmg, e.x, e.y);
            if (T.boss || e.type === 'brute') { AudioSys.at('stomp', e.x, e.y, 1); if (settings.shake) GS.shake += 0.5; }
          }
          e.atkCd = T.atkCd;
        } else if (T.ranged) { enemyShoot(e); e.atkCd = T.atkCd * rand(0.8, 1.3); }
      }
      return;
    }
    if (T.boss) bossThink(e, dt, dist);
    // --- decidir dirección ---
    let mx = 0, my = 0;
    const nx = dx / dist, ny = dy / dist;
    if (!P.alive) { mx = -ny * e.strafe; my = nx * e.strafe; }
    else if (e.los && dist < 7.5) {
      if (T.ranged) {
        if (dist < T.keep * 0.55) { mx = -nx; my = -ny; }
        else if (dist < T.keep) { mx = -ny * e.strafe; my = nx * e.strafe; }
        else { mx = nx; my = ny; }
        if (Math.random() < dt * 0.5) e.strafe *= -1;
      } else {
        mx = nx; my = ny;
        if (dist > 2.5 && !T.boss) { mx += -ny * e.strafe * 0.35; my += nx * e.strafe * 0.35; }
      }
    } else {
      const cx = e.x | 0, cy = e.y | 0, c = cy * MW + cx;
      let best = FLOW[c] >= 0 ? FLOW[c] : 9999, tx = -1, ty = -1;
      for (const [ddx, ddy] of DIRS8) {
        const qx = cx + ddx, qy = cy + ddy;
        if (qx < 0 || qy < 0 || qx >= MW || qy >= MH) continue;
        const f = FLOW[qy * MW + qx];
        if (f < 0 || f >= best) continue;
        if (ddx && ddy && (solid[cy * MW + qx] || solid[qy * MW + cx])) continue;
        best = f; tx = qx + 0.5; ty = qy + 0.5;
      }
      if (tx >= 0) { const ex = tx - e.x, ey = ty - e.y, el = Math.hypot(ex, ey) || 1; mx = ex / el; my = ey / el; }
      else { mx = nx; my = ny; }
    }
    // separación entre goblins
    for (const o of GS.enemies) {
      if (o === e || o.dead) continue;
      const ox = e.x - o.x, oy = e.y - o.y, od = ox * ox + oy * oy, min = (T.r + o.T.r) * 1.15;
      if (od < min * min && od > 1e-6) { const l = Math.sqrt(od); mx += ox / l * 0.9; my += oy / l * 0.9; }
    }
    const ml = Math.hypot(mx, my);
    if (ml > 0.001) {
      const sp = T.speed * e.spdMul * (T.ranged && e.los && dist < T.keep ? 0.7 : 1);
      const ox = e.x, oy = e.y;
      moveCollide(e, mx / ml * sp * dt, my / ml * sp * dt, T.r);
      if (Math.hypot(e.x - ox, e.y - oy) < sp * dt * 0.2) { e.stuckT += dt; if (e.stuckT > 0.4) { e.strafe *= -1; e.stuckT = 0; e.kx += rand(-1.5, 1.5); e.ky += rand(-1.5, 1.5); } }
      else e.stuckT = 0;
    }
    // no atravesar al jugador
    const pdx = e.x - P.x, pdy = e.y - P.y, pd = Math.hypot(pdx, pdy), pmin = T.r + 0.3;
    if (pd < pmin && pd > 1e-4) moveCollide(e, pdx / pd * (pmin - pd), pdy / pd * (pmin - pd), T.r);
    // --- atacar ---
    if (T.kamikaze && dist < T.r + 0.75) {
      e.hp = 0; killEnemy(e, { kind: 'self' }, 0); AudioSys.at('gob_laugh', e.x, e.y, 1, 1.6);
      return;
    }
    if (T.kamikaze && Math.random() < dt * 2) AudioSys.at('fuse', e.x, e.y, 0.6);
    if (T.melee && dist < T.atkRange + T.r && e.atkCd <= 0) { e.state = 'attack'; e.stateT = T.windup; AudioSys.at(T.boss || e.type === 'brute' ? 'roar' : 'gob_attack', e.x, e.y, 0.8, T.pitch); }
    if (T.ranged && e.los && dist < T.range && dist > 1.6 && e.atkCd <= 0) { e.state = 'attack'; e.stateT = T.windup; }
  }

  function updateProjectiles(dt) {
    for (let i = GS.projs.length - 1; i >= 0; i--) {
      const p = GS.projs[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.grav) p.vz -= p.grav * dt;
      p.life -= dt;
      if (p.kind === 'rocket') {
        p.trail -= dt;
        if (p.trail <= 0) { p.trail = 0.02; addPart(p.x, p.y, p.z, rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0, 0.5), 0.5, 0xff505458, 0.07, false, -0.2); }
      } else if (p.kind === 'fireball' && Math.random() < 0.5) addPart(p.x, p.y, p.z, 0, 0, 0.5, 0.25, 0xff1080ff, 0.05, true, 0);
      const ci = clamp(p.y | 0, 0, MH - 1) * MW + clamp(p.x | 0, 0, MW - 1);
      let impact = isWall(p.x, p.y) || p.z <= 0 || (indoor[ci] && p.z >= WALLH) || p.life <= 0;
      let target = null;
      if (!impact && p.owner === 'player') {
        for (const e of GS.enemies) {
          if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < e.T.r + 0.18 && p.z < e.T.h + 0.1) { impact = true; target = e; break; }
        }
        for (const b of decos) if (!impact && b.type === 'barrel' && b.alive && Math.hypot(b.x - p.x, b.y - p.y) < 0.35 && p.z < 0.8) impact = true;
      }
      if (!impact && p.owner === 'enemy' && P.alive) {
        if (Math.hypot(P.x - p.x, P.y - p.y) < 0.38 && p.z < EYE + P.z + 0.3 && p.z > P.z - 0.1) {
          impact = true;
          if (p.kind !== 'bomb') hurtPlayer(p.dmg, p.x - p.vx, p.y - p.vy);
        }
      }
      if (!impact) continue;
      GS.projs.splice(i, 1);
      const bx = p.x - p.vx * dt, by = p.y - p.vy * dt;
      if (p.kind === 'rocket') {
        if (target) damageEnemy(target, p.dmg * 0.6, { kind: 'explosion', fromX: p.x - p.vx, fromY: p.y - p.vy });
        GS.booms.push({ x: bx, y: by, z: Math.max(0.1, p.z), t: 0, radius: p.radius, dmg: p.dmg, owner: 'player' });
      } else if (p.kind === 'bomb') {
        GS.booms.push({ x: bx, y: by, z: 0.2, t: 0, radius: p.radius, dmg: p.dmg, owner: 'enemy' });
      } else {
        const col = p.kind === 'arrow' ? 0xff4080a0 : 0xff20a0ff;
        for (let k = 0; k < 6; k++) addPart(bx, by, Math.max(0.05, p.z), rand(-1.5, 1.5), rand(-1.5, 1.5), rand(0, 2), 0.4, col, 0.05, p.kind !== 'arrow', 0.7);
      }
    }
    for (let i = GS.booms.length - 1; i >= 0; i--) {
      const b = GS.booms[i]; b.t -= dt;
      if (b.t <= 0) { GS.booms.splice(i, 1); explode(b.x, b.y, b.z || 0.4, b.radius, b.dmg, b.owner); }
    }
  }

  function updateParticles(dt) {
    for (let i = GS.parts.length - 1; i >= 0; i--) {
      const p = GS.parts[i];
      p.life -= dt;
      if (p.life <= 0) { GS.parts.splice(i, 1); continue; }
      p.vz -= 9 * p.grav * dt;
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      if (!isWall(nx, p.y)) p.x = nx; else p.vx *= -0.3;
      if (!isWall(p.x, ny)) p.y = ny; else p.vy *= -0.3;
      p.z += p.vz * dt;
      if (p.z < 0) { p.z = 0; p.vz *= -0.25; p.vx *= 0.6; p.vy *= 0.6; }
    }
    for (let i = GS.effects.length - 1; i >= 0; i--) { const f = GS.effects[i]; f.t += dt; if (f.t >= f.dur) GS.effects.splice(i, 1); }
  }

  function updatePickups(dt) {
    for (let i = GS.pickups.length - 1; i >= 0; i--) {
      const k = GS.pickups[i];
      k.t += dt; k.life -= dt;
      if (k.life <= 0) { GS.pickups.splice(i, 1); continue; }
      if (k.vx || k.vy || k.vz) {
        k.vz -= 9 * dt;
        moveCollide(k, k.vx * dt, k.vy * dt, 0.1);
        k.z += k.vz * dt;
        if (k.z <= 0) { k.z = 0; k.vz = 0; k.vx = 0; k.vy = 0; }
      }
      const dx = P.x - k.x, dy = P.y - k.y, d = Math.hypot(dx, dy);
      if (!P.alive) continue;
      if (k.kind === 'coin' && d < 2.8 && d > 0.01) { const sp = (3.2 - d) * 4 * dt; k.x += dx / d * sp; k.y += dy / d * sp; }
      if (d < 0.75) {
        let took = true;
        switch (k.kind) {
          case 'coin': P.gold += k.value; GS.stats.gold += k.value; AudioSys.play('coin', 0.7); UI.goldPop(k.value); break;
          case 'potion': if (P.hp >= P.maxHp) took = false; else { P.hp = Math.min(P.maxHp, P.hp + 25); AudioSys.play('heal'); UI.feed('Poción roja: +25 salud', 'gold'); } break;
          case 'armor': P.armor = Math.min(150, P.armor + 50); AudioSys.play('pickup'); UI.feed('Armadura de lata: +50', 'gold'); break;
          case 'ammo': if (P.ammo.bullets >= P.maxAmmo.bullets) took = false; else { P.ammo.bullets = Math.min(P.maxAmmo.bullets, P.ammo.bullets + 30); AudioSys.play('pickup'); UI.feed('+30 balas'); } break;
          case 'shells': if (P.ammo.shells >= P.maxAmmo.shells) took = false; else { P.ammo.shells = Math.min(P.maxAmmo.shells, P.ammo.shells + 8); AudioSys.play('pickup'); UI.feed('+8 cartuchos'); } break;
          case 'rockets': if (P.ammo.rockets >= P.maxAmmo.rockets) took = false; else { P.ammo.rockets = Math.min(P.maxAmmo.rockets, P.ammo.rockets + 3); AudioSys.play('pickup'); UI.feed('+3 cohetes'); } break;
        }
        if (took) { GS.pickups.splice(i, 1); UI.pickupFlash(); }
      }
    }
  }

  // ---- Oleadas ----
  function buildWaveList(n) {
    const total = Math.round((6 + n * 3.2) * GS.diff.count);
    const W = [['grunt', 10], ['archer', n >= 2 ? 4 + n * 0.3 : 0], ['kamikaze', n >= 3 ? 3 + n * 0.2 : 0], ['brute', n >= 4 ? 2 + n * 0.25 : 0], ['shaman', n >= 6 ? 2 + n * 0.2 : 0]];
    const sum = W.reduce((s, w) => s + w[1], 0);
    const list = [];
    for (let i = 0; i < total; i++) {
      let r = Math.random() * sum;
      for (const [t, w] of W) { r -= w; if (r <= 0) { list.push(t); break; } }
    }
    if (n % 5 === 0) for (let b = 0; b < n / 5; b++) list.splice(Math.floor(list.length * (0.25 + b * 0.2)), 0, 'boss');
    return list;
  }
  function startWave(n) {
    GS.wave = n; GS.waveState = 'active'; GS.waveDamage = 0;
    GS.toSpawn = buildWaveList(n);
    GS.waveTotal = GS.toSpawn.length;
    GS.spawnT = 1.2;
    GS.maxAlive = Math.min(30, 10 + Math.floor(n * 1.5));
    UI.announce(`OLEADA ${n}`, n % 5 === 0 ? '¡El Rey Verrugón viene en persona!' : pick(WAVE_QUOTES), 2.6, '');
    AudioSys.play('wave');
  }
  function waveCleared() {
    GS.waveState = 'cleared'; GS.waveTimer = 3.2;
    const perfect = GS.waveDamage < 1;
    const bonus = Math.round((40 + GS.wave * 25) * (perfect ? 2 : 1) * GS.diff.gold);
    P.gold += bonus; GS.stats.gold += bonus;
    P.score += GS.wave * 500 * (perfect ? 2 : 1);
    UI.announce('¡OLEADA SUPERADA!', `${perfect ? '¡SIN UN RASGUÑO! ' : ''}+${bonus} de oro`, 3, 'gold');
    AudioSys.play('wave_clear');
  }
  function updateWaves(dt) {
    if (GS.waveState === 'active') {
      GS.spawnT -= dt;
      if (GS.spawnT <= 0 && GS.toSpawn.length && GS.alive < GS.maxAlive) {
        spawnEnemy(GS.toSpawn.shift());
        GS.spawnT = Math.max(0.3, 1.25 - GS.wave * 0.05) * rand(0.6, 1.3);
      }
      if (!GS.toSpawn.length && GS.alive <= 0 && !GS.booms.length) waveCleared();
    } else if (GS.waveState === 'cleared') {
      GS.waveTimer -= dt;
      if (GS.waveTimer <= 0 && P.alive) Shop.open();
    } else if (GS.waveState === 'countdown') {
      const before = Math.ceil(GS.waveTimer);
      GS.waveTimer -= dt;
      const now = Math.ceil(GS.waveTimer);
      if (now !== before && now > 0) { UI.announce(String(now), `Oleada ${GS.wave + 1} en camino`, 0.9, 'gold'); AudioSys.play('menu_move'); }
      if (GS.waveTimer <= 0) startWave(GS.wave + 1);
    }
  }

  // =======================================================================
  // 10. TIENDA Y ECONOMÍA
  // =======================================================================
  const MERCHANT_QUOTES = ['“Vendo armas para matar a mis primos. Negocios son negocios.”', '“¿Oro? ¿Oro? ¡Dame oro!”',
    '“Sin devoluciones. Sobre todo si estás muerto.”', '“Mi tía estaba en esa oleada. Gracias, no la soportaba.”',
    '“Hoy tenemos 2x1 en violencia.”', '“Todo hecho a mano por goblins explotados. Como debe ser.”'];
  const SHOP_ITEMS = [
    { id: 'shotgun', icon: 'shotgun', name: 'La Desgoblinizadora', desc: 'Escopeta doble. 9 perdigones de cariño.', price: () => 250, owned: () => P.owned.shotgun, give: () => { P.owned.shotgun = true; P.ammo.shells = Math.min(P.maxAmmo.shells, P.ammo.shells + 16); switchTo('shotgun'); } },
    { id: 'chaingun', icon: 'chaingun', name: 'Molinillo de Duendes', desc: 'Ametralladora. Convierte goblins en confeti.', price: () => 550, owned: () => P.owned.chaingun, give: () => { P.owned.chaingun = true; P.ammo.bullets = Math.min(P.maxAmmo.bullets, P.ammo.bullets + 100); switchTo('chaingun'); } },
    { id: 'rocket', icon: 'rocket', name: 'Adiós Verdecito', desc: 'Lanzacohetes. Daño en área. No lo uses pegado a la cara.', price: () => 950, owned: () => P.owned.rocket, give: () => { P.owned.rocket = true; P.ammo.rockets = Math.min(P.maxAmmo.rockets, P.ammo.rockets + 8); switchTo('rocket'); } },
    { id: 'bullets', icon: 'ammo', name: 'Caja de balas', desc: '+60 balas (pistola y ametralladora).', price: () => 30, can: () => P.ammo.bullets < P.maxAmmo.bullets, give: () => { P.ammo.bullets = Math.min(P.maxAmmo.bullets, P.ammo.bullets + 60); } },
    { id: 'shells', icon: 'shells', name: 'Cartuchos', desc: '+16 cartuchos de escopeta.', price: () => 45, can: () => P.owned.shotgun && P.ammo.shells < P.maxAmmo.shells, need: 'Necesitas la escopeta', give: () => { P.ammo.shells = Math.min(P.maxAmmo.shells, P.ammo.shells + 16); } },
    { id: 'rockets', icon: 'rockets', name: 'Cohetes', desc: '+6 cohetes. Huelen a pólvora y a desgracia.', price: () => 85, can: () => P.owned.rocket && P.ammo.rockets < P.maxAmmo.rockets, need: 'Necesitas el lanzacohetes', give: () => { P.ammo.rockets = Math.min(P.maxAmmo.rockets, P.ammo.rockets + 6); } },
    { id: 'potion', icon: 'potion', name: 'Poción roja', desc: '+50 de salud. Sabe a fresa y a óxido.', price: () => 35, can: () => P.hp < P.maxHp, give: () => { P.hp = Math.min(P.maxHp, P.hp + 50); } },
    { id: 'armor', icon: 'armor', name: 'Armadura de lata', desc: '+50 armadura (máx. 150). Absorbe la mitad del daño.', price: () => 60, can: () => P.armor < 150, give: () => { P.armor = Math.min(150, P.armor + 50); } },
    { id: 'maxhp', icon: 'heart', name: 'Corazón de troll', desc: '+25 salud máxima y te cura del todo.', price: () => 120 + P.hpUp * 90, max: 6, lvl: () => P.hpUp, give: () => { P.hpUp++; P.maxHp += 25; P.hp = P.maxHp; } },
    { id: 'dmg', icon: 'dmg', name: 'Afilador mágico', desc: '+15% de daño con todas las armas.', price: () => 200 + P.dmgUp * 160, max: 8, lvl: () => P.dmgUp, give: () => { P.dmgUp++; P.dmgMul = 1 + P.dmgUp * 0.15; } },
    { id: 'rate', icon: 'rate', name: 'Café de mandrágora', desc: '+10% de cadencia de disparo.', price: () => 180 + P.rateUp * 150, max: 6, lvl: () => P.rateUp, give: () => { P.rateUp++; P.rateMul = 1 + P.rateUp * 0.1; } },
    { id: 'speed', icon: 'boots', name: 'Botas de liebre', desc: '+8% de velocidad de movimiento.', price: () => 150 + P.spdUp * 130, max: 4, lvl: () => P.spdUp, give: () => { P.spdUp++; P.speedMul = 1 + P.spdUp * 0.08; } }
  ];

  const Shop = {
    open() {
      GS.state = 'shop'; GS.waveState = 'shop';
      // regalo de consolación del mercader: nunca te quedas sin balas
      if (P.ammo.bullets < 40) { P.ammo.bullets = 40; UI.feed('Gruñido te regala balas por lástima', 'gold'); }
      $('shopQuote').textContent = pick(MERCHANT_QUOTES);
      $('btnNextWave').textContent = `¡A LA MASACRE! — OLEADA ${GS.wave + 1}`;
      this.render();
      UI.show('shop');
      exitLock();
      AudioSys.duck = 0.45;
    },
    close() {
      UI.show(null);
      GS.state = 'playing'; GS.waveState = 'countdown'; GS.waveTimer = 3.01;
      AudioSys.duck = 1;
      requestLock();
    },
    render() {
      const box = $('shopItems'); box.innerHTML = '';
      for (const it of SHOP_ITEMS) {
        const div = document.createElement('div'); div.className = 'item';
        const owned = it.owned && it.owned();
        const maxed = it.max && it.lvl() >= it.max;
        const price = it.price();
        let status = `${price} oro`;
        if (owned) { status = 'EN TU ARSENAL'; div.classList.add('owned'); }
        else if (maxed) { status = 'NIVEL MÁXIMO'; div.classList.add('owned'); }
        else if (it.can && !it.can()) { status = it.need && !(it.id === 'shells' ? P.owned.shotgun : P.owned.rocket) ? it.need : 'AL MÁXIMO'; div.classList.add('cant'); }
        else if (P.gold < price) div.classList.add('cant');
        const lvl = it.max ? ` <span style="color:#7ccf3f">${it.lvl()}/${it.max}</span>` : '';
        div.innerHTML = `<img alt="" src="${ICONS[it.icon]}"><div class="nm">${it.name}${lvl}</div><div class="ds">${it.desc}</div><div class="pr">${status}</div>`;
        div.addEventListener('click', () => this.buy(it, div));
        box.appendChild(div);
      }
      $('shopGold').textContent = P.gold;
      $('shopHp').textContent = `${Math.ceil(P.hp)}/${P.maxHp}`;
      $('shopArmor').textContent = Math.ceil(P.armor);
      $('shopB').textContent = P.ammo.bullets; $('shopS').textContent = P.ammo.shells; $('shopR').textContent = P.ammo.rockets;
    },
    buy(it, div) {
      const owned = it.owned && it.owned();
      const maxed = it.max && it.lvl() >= it.max;
      const price = it.price();
      if (owned || maxed || (it.can && !it.can()) || P.gold < price) {
        AudioSys.play('nobuy');
        div.classList.remove('nope'); void div.offsetWidth; div.classList.add('nope');
        return;
      }
      P.gold -= price; it.give(); AudioSys.play('buy');
      this.render();
      const idx = SHOP_ITEMS.indexOf(it);
      const el = $('shopItems').children[idx]; if (el) el.classList.add('bought');
    }
  };

  // =======================================================================
  // 11. INTERFAZ: HUD, MENÚS, OPCIONES Y SCOREBOARD
  // =======================================================================
  const SCREENS = ['splash', 'menu', 'scores', 'options', 'credits', 'pause', 'shop', 'gameover'];
  const TAGLINES = ['Sobrevive a la horda verde.', 'Los goblins no pagan impuestos. Tú tampoco perdonas.', 'Ningún goblin fue maltratado… mentira.',
    'Más rápido que un goblin robando gallinas.', 'Hecho con píxeles, rabia y café.', 'Si es verde y chilla, dispárale.'];

  const UI = {
    cur: 'splash', optReturn: 'menu', cache: {}, annT: 0, hitT: 0, hurtA: 0, dirA: 0, pickA: 0, comboT: 0,
    goldAcc: 0, goldT: 0, beltKey: '', mapTick: 0, fpsN: 0, fpsT: 0,

    show(id) {
      for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
      this.cur = id;
      if (!id && document.activeElement && document.activeElement.blur) document.activeElement.blur();
      document.body.classList.toggle('ingame', ['playing', 'paused', 'shop', 'gameover'].includes(GS.state));
      const first = id && $(id).querySelector('.btn');
      if (first && id !== 'shop' && id !== 'gameover') setTimeout(() => first.focus({ preventScroll: true }), 30);
    },
    audioStatus() {
      const bad = Object.values(AudioSys.music).filter((m) => !m.ok).map((m) => m.file);
      $('audioStatus').textContent = bad.length
        ? `⚠ No se pudo reproducir: ${bad.join(', ')}. Deben estar en la misma carpeta que index.html.`
        : '♪ Música: Elmenu.mp3 en los menús · Musicanivel.mp3 durante la masacre · M = silenciar';
    },
    feed(text, cls) {
      const f = $('feed'); const d = document.createElement('div');
      d.textContent = text; if (cls) d.className = cls;
      f.appendChild(d);
      while (f.children.length > 6) f.firstChild.remove();
      setTimeout(() => { d.style.transition = 'opacity .6s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 650); }, 2600);
    },
    announce(big, sub, dur, cls) {
      const a = $('announce');
      a.querySelector('.big').textContent = big;
      a.querySelector('.sub').textContent = sub || '';
      a.className = cls || '';
      void a.offsetWidth; a.classList.add('show');
      a.style.opacity = 1; this.annT = dur;
    },
    combo(n, mult) {
      if (n < 2) return;
      const c = $('comboBox');
      c.innerHTML = `COMBO x${n}<br><span style="font-size:.6em;color:#f4e6c8">${mult.toFixed(2)}x PUNTOS</span>`;
      c.style.opacity = 1; c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
    },
    goldPop(v) { this.goldAcc += v; this.goldT = 0.9; },
    hitMarker(head) { const c = $('crosshair'); c.classList.remove('hit', 'head'); c.classList.add(head ? 'head' : 'hit'); this.hitT = 0.12; },
    hurt(intensity, ang) { this.hurtA = Math.max(this.hurtA, intensity); Flask.hit(); $('dmgDir').style.transform = `rotate(${ang}rad)`; this.dirA = 1; },
    pickupFlash() { this.pickA = 0.55; },

    hud() {
      const set = (id, v) => { if (this.cache[id] !== v) { this.cache[id] = v; $(id).textContent = v; } };
      const wid = P.next || P.cur, w = WEAPONS[wid];
      set('hudAmmo', w.ammo ? String(P.ammo[w.ammo]) : '∞');
      set('hudAmmoLbl', w.ammo ? AMMO_NAME[w.ammo] : 'CUERPO A CUERPO');
      set('hudHp', String(Math.ceil(P.hp)));
      const low = P.hp <= P.maxHp * 0.25;
      if (this.cache.low !== low) { this.cache.low = low; $('hudHp').classList.toggle('low', low); }
      set('hudArmor', String(Math.ceil(P.armor)));
      set('hudGold', String(P.gold));
      const beltKey = `${wid}|${w.ammo ? P.ammo[w.ammo] : 0}|${w.ammo ? P.maxAmmo[w.ammo] : 0}`;
      if (beltKey !== this.beltKey) { this.beltKey = beltKey; drawBelt(wid); }
      set('hudWeaponName', w.name.toUpperCase());
      set('amB', String(P.ammo.bullets)); set('amS', String(P.ammo.shells)); set('amR', String(P.ammo.rockets));
      const armKey = WEAPON_ORDER.map((k) => (P.owned[k] ? 1 : 0) + (k === wid ? 2 : 0)).join('');
      if (this.cache.arms !== armKey) {
        this.cache.arms = armKey;
        WEAPON_ORDER.forEach((k, i) => { const el = $(`arm${i + 1}`); el.classList.toggle('owned', P.owned[k]); el.classList.toggle('cur', k === wid); });
      }
      set('topWave', GS.wave ? `OLEADA ${GS.wave}` : 'PREPARACIÓN');
      set('topLeft', `GOBLINS: ${GS.alive + GS.toSpawn.length}`);
      set('topScore', `${P.score.toLocaleString('es')} PTS`);
    },

    update(dt) {
      if (this.annT > 0) { this.annT -= dt; if (this.annT <= 0) $('announce').style.opacity = 0; }
      if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) $('crosshair').classList.remove('hit', 'head'); }
      this.hurtA = Math.max(0, this.hurtA - dt * 1.6); $('hurtFlash').style.opacity = this.hurtA.toFixed(2);
      this.dirA = Math.max(0, this.dirA - dt * 1.2); $('dmgDir').style.opacity = this.dirA.toFixed(2);
      this.pickA = Math.max(0, this.pickA - dt * 2.5); $('pickupFlash').style.opacity = this.pickA.toFixed(2);
      if (P.comboT <= 0) $('comboBox').style.opacity = Math.max(0, parseFloat($('comboBox').style.opacity || 0) - dt * 2);
      if (this.goldT > 0) { this.goldT -= dt; if (this.goldT <= 0 && this.goldAcc) { this.feed(`+${this.goldAcc} oro`, 'gold'); this.goldAcc = 0; } }
      const inGame = ['playing', 'paused', 'shop', 'gameover'].includes(GS.state);
      if (inGame) {
        this.hud();
        Flask.draw(dt);
        $('lowHp').style.opacity = P.alive && P.hp <= P.maxHp * 0.25 ? '1' : '0';
        $('lockHint').classList.toggle('hidden', !(GS.state === 'playing' && !locked && !GS.noLock && P.alive));
        if (settings.minimap && ++this.mapTick % 3 === 0) drawMinimap();
      }
      $('minimap').classList.toggle('hidden', !settings.minimap);
      // FPS
      this.fpsN++; this.fpsT += dt;
      if (this.fpsT >= 0.5) { $('fps').textContent = settings.showFps ? `${Math.round(this.fpsN / this.fpsT)} FPS · ${R.W}x${R.H}` : ''; this.fpsN = 0; this.fpsT = 0; }
    }
  };

  // ---- Frasco de sangre (vida) y anillo de runas (armadura) ----
  const RUNE_GLYPHS = ['101|101|111|010|010', '110|101|110|101|110', '010|111|010|010|010', '101|010|101|010|101', '111|100|110|100|100', '001|011|101|011|001'];

  const Flask = {
    W: 84, H: 104, CX: 42, CY: 62, R: 27, ctx: null, glass: null, top: [], bot: [], runes: [],
    t: 0, level: 1, armor: 0, slosh: 0, bubbles: [],

    init() {
      this.ctx = $('flask').getContext('2d');
      const { W, H, CX, CY, R } = this;
      // Silueta: cuello recto y panza redonda
      for (let x = 0; x < W; x++) {
        const dx = Math.abs(x + 0.5 - CX);
        if (dx > R) { this.top[x] = this.bot[x] = 0; continue; }
        const h = Math.sqrt(R * R - dx * dx);
        this.top[x] = dx < 8 ? 15 : Math.round(CY - h);
        this.bot[x] = Math.round(CY + h);
      }
      for (let i = 0; i < 12; i++) {
        const a = (300 + i * (300 / 11)) * Math.PI / 180;
        this.runes.push({
          x: Math.round(CX + Math.cos(a) * 35) - 1, y: Math.round(CY + Math.sin(a) * 35) - 2,
          glyph: RUNE_GLYPHS[i % RUNE_GLYPHS.length].split('|')
        });
      }
      // Capa fija de vidrio, corcho y cuerda
      this.glass = makeCanvas(W, H);
      const c = this.glass.getContext('2d');
      const px = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
      for (let x = 0; x < W; x++) {
        if (this.top[x] === this.bot[x]) continue;
        px(x, this.top[x] - 1, 1, 1, 'rgba(232,220,192,.8)');
        px(x, this.bot[x], 1, 1, 'rgba(232,220,192,.55)');
        if (this.top[x] !== this.top[x - 1]) {
          const from = Math.min(this.top[x], this.top[x - 1] || this.top[x]), to = Math.max(this.top[x], this.top[x - 1] || this.top[x]);
          px(x, from, 1, to - from, 'rgba(232,220,192,.8)');
        }
        if (this.top[x] !== this.top[x + 1] || this.bot[x] !== this.bot[x + 1]) px(x, this.top[x], 1, 1, 'rgba(232,220,192,.5)');
      }
      for (let y = CY - 12; y < CY + 12; y++) {
        const hw = Math.round(Math.sqrt(R * R - (y - CY) * (y - CY)));
        px(CX - hw - 1, y, 1, 1, 'rgba(232,220,192,.8)');
        px(CX + hw, y, 1, 1, 'rgba(232,220,192,.8)');
      }
      for (let a = 2.7; a < 3.75; a += 0.05) px(Math.round(CX + Math.cos(a) * (R - 5)), Math.round(CY + Math.sin(a) * (R - 5)), 2, 2, 'rgba(255,255,255,.42)');
      px(CX + 12, CY + 13, 3, 2, 'rgba(255,255,255,.3)');
      px(CX - 6, 18, 2, 16, 'rgba(255,255,255,.28)');
      px(32, 11, 20, 3, '#e8dcc0');
      px(32, 13, 20, 1, '#a89878');
      px(35, 3, 14, 8, '#8a5a2e');
      px(35, 3, 14, 2, '#b07a44');
      px(35, 9, 14, 2, '#5c3a1c');
      px(33, 18, 18, 2, '#b7a98a');
      px(33, 19, 18, 1, '#7a6a50');
      px(47, 19, 2, 8, '#b7a98a');
    },

    hit() {
      this.slosh = 3.2;
      const f = $('flask');
      f.classList.remove('hit');
      void f.offsetWidth;
      f.classList.add('hit');
    },

    draw(dt) {
      const c = this.ctx, { W, H, top, bot } = this;
      this.t += dt;
      this.level += (clamp(P.hp / P.maxHp, 0, 1) - this.level) * Math.min(1, dt * 6);
      this.armor += (clamp(P.armor / 100, 0, 1) - this.armor) * Math.min(1, dt * 6);
      this.slosh += (P.bobAmt * 1.1 - this.slosh) * Math.min(1, dt * 2.5);
      const amp = 0.5 + this.slosh * 1.3;
      const surface = 90 - this.level * 72;
      const low = this.level <= 0.25;
      const pulse = low ? 0.5 + Math.sin(this.t * 8) * 0.5 : 0;

      c.clearRect(0, 0, W, H);
      const lit = Math.ceil(this.armor * 12);
      this.runes.forEach((r, i) => {
        c.fillStyle = i < lit ? '#6fb0ff' : '#2d2d3c';
        r.glyph.forEach((row, y) => { for (let x = 0; x < 3; x++) if (row[x] === '1') c.fillRect(r.x + x, r.y + y, 1, 1); });
      });

      for (let x = 0; x < W; x++) {
        if (top[x] === bot[x]) continue;
        c.fillStyle = 'rgba(20,8,8,.72)';
        c.fillRect(x, top[x], 1, bot[x] - top[x]);
        const s = surface + Math.sin(x * 0.33 + this.t * 3.1) * amp + Math.sin(x * 0.12 - this.t * 1.9) * amp * 0.7;
        const ys = Math.max(Math.round(s), top[x]);
        if (ys >= bot[x]) continue;
        c.fillStyle = pulse > 0.5 ? '#d8121f' : '#a80f1a';
        c.fillRect(x, ys, 1, bot[x] - ys);
        c.fillStyle = '#ff5a48';
        c.fillRect(x, ys, 1, 2);
        const deep = Math.max(ys + 2, this.CY + 12);
        if (deep < bot[x]) { c.fillStyle = '#760a12'; c.fillRect(x, deep, 1, bot[x] - deep); }
      }

      if (this.level > 0.04 && Math.random() < dt * 3) this.bubbles.push({ x: 26 + Math.random() * 32, y: 84, v: 8 + Math.random() * 10 });
      this.bubbles = this.bubbles.filter((b) => {
        b.y -= b.v * dt;
        b.x += Math.sin(this.t * 6 + b.v) * dt * 4;
        c.fillStyle = '#ff8a70';
        c.fillRect(b.x | 0, b.y | 0, 1 + (b.v > 13 ? 1 : 0), 1 + (b.v > 13 ? 1 : 0));
        return b.y > surface + 1;
      });

      c.drawImage(this.glass, 0, 0);
    }
  };

  // ---- Cinturón de munición: una presilla por cada tanto de balas ----
  const BELT_SLOTS = { bullets: 22, shells: 12, rockets: 6 };

  function drawBelt(wid) {
    const c = $('belt').getContext('2d'), W = 220, w = WEAPONS[wid];
    const px = (x, y, wd, h, col) => { c.fillStyle = col; c.fillRect(Math.round(x), y, wd, h); };
    c.clearRect(0, 0, W, 30);
    px(0, 13, W, 13, '#5f3d22');
    px(0, 13, W, 1, '#8a5f36');
    px(0, 25, W, 1, '#2e1c0e');
    for (let x = 2; x < W; x += 7) { px(x, 15, 3, 1, '#c8b890'); px(x, 23, 3, 1, '#c8b890'); }
    px(W - 15, 10, 12, 19, '#c8963a');
    px(W - 15, 10, 12, 1, '#f0d48a');
    px(W - 12, 14, 6, 11, '#5f3d22');
    px(W - 21, 17, 12, 3, '#d8d8e4');
    if (!w.ammo) return;
    const slots = BELT_SLOTS[w.ammo], full = Math.ceil(P.ammo[w.ammo] / P.maxAmmo[w.ammo] * slots), step = (W - 28) / slots;
    const size = w.ammo === 'bullets' ? 5 : w.ammo === 'shells' ? 9 : 16;
    for (let i = 0; i < slots; i++) {
      const x = 3 + i * step + (step - size) / 2;
      if (i >= full) { px(x, 14, size, 11, '#2e1c0e'); continue; }
      if (w.ammo === 'bullets') {
        px(x, 5, 5, 19, '#c8963a'); px(x, 5, 1, 19, '#f0d48a'); px(x + 1, 1, 3, 4, '#b2653a'); px(x + 2, 0, 1, 1, '#d8905a');
      } else if (w.ammo === 'shells') {
        px(x, 3, 9, 16, '#b32a22'); px(x, 3, 2, 16, '#e0584a'); px(x, 19, 9, 6, '#c8963a'); px(x, 19, 2, 6, '#f0d48a');
      } else {
        px(x + 3, 7, 10, 20, '#4f6638'); px(x + 3, 7, 2, 20, '#7a9458'); px(x + 5, 2, 6, 5, '#a8281e'); px(x + 7, 0, 2, 2, '#c8c8d0');
        px(x, 22, 3, 6, '#3a4a28'); px(x + 13, 22, 3, 6, '#3a4a28');
      }
      px(x - 1, 15, size + 2, 7, '#6a4426');
      px(x - 1, 15, size + 2, 1, '#8a5f36');
    }
  }

  // ---- Minimapa ----
  let mapBase = null;
  function buildMinimapBase() {
    mapBase = makeCanvas(128, 128);
    const p = painter(mapBase.getContext('2d'));
    p.rect(0, 0, 128, 128, '#000');
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = y * MW + x;
      const col = map[i] ? ['', '#6a5e52', '#4a6a3a', '#6b4421', '#8a2018', '#3a3a48', '#8a2018'][map[i]] : (indoor[i] ? '#1e1612' : '#2a2216');
      p.rect(x * 4, y * 4, 4, 4, col);
    }
    for (const [x, y] of spawnCells) p.rect((x | 0) * 4 + 1, (y | 0) * 4 + 1, 2, 2, '#7ccf3f');
  }
  function drawMinimap() {
    const ctx = $('minimap').getContext('2d');
    ctx.drawImage(mapBase, 0, 0);
    for (const d of decos) {
      if (d.type === 'torch') { ctx.fillStyle = '#ffb020'; ctx.fillRect(d.x * 4 - 1, d.y * 4 - 1, 2, 2); }
      else if (d.type === 'barrel' && d.alive) { ctx.fillStyle = '#c01818'; ctx.fillRect(d.x * 4 - 1, d.y * 4 - 1, 2, 2); }
    }
    ctx.fillStyle = '#f2c14e';
    for (const k of GS.pickups) ctx.fillRect(k.x * 4, k.y * 4, 1, 1);
    for (const e of GS.enemies) {
      if (e.dead) continue;
      const s = e.T.boss ? 5 : 3;
      ctx.fillStyle = e.T.boss ? '#ff40ff' : '#ff2a2a';
      ctx.fillRect(e.x * 4 - s / 2, e.y * 4 - s / 2, s, s);
    }
    ctx.strokeStyle = '#fff6a0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(P.x * 4, P.y * 4); ctx.lineTo(P.x * 4 + Math.cos(P.a) * 7, P.y * 4 + Math.sin(P.a) * 7); ctx.stroke();
    ctx.fillStyle = '#fff6a0'; ctx.fillRect(P.x * 4 - 2, P.y * 4 - 2, 4, 4);
  }

  // ---- Scoreboard ----
  const getScores = () => store.get('gm_scores', []);
  function renderScores() {
    const list = getScores();
    const body = $('scoreBody'); body.innerHTML = '';
    $('scoreEmpty').classList.toggle('hidden', list.length > 0);
    list.forEach((s, i) => {
      const tr = document.createElement('tr');
      if (s.id === GS.lastId) tr.className = 'mine';
      for (const v of [i + 1, s.name, Number(s.score).toLocaleString('es'), s.wave, s.kills, s.date]) {
        const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
      }
      body.appendChild(tr);
    });
  }
  function saveScore() {
    if (GS.saved) return;
    const name = ($('goName').value || '').trim().toUpperCase().slice(0, 12) || 'ANÓNIMO';
    const list = getScores();
    const entry = { id: Date.now(), name, score: P.score, wave: GS.wave, kills: P.kills, date: new Date().toLocaleDateString('es') };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, 10);
    store.set('gm_scores', top);
    store.set('gm_lastname', name);
    const rank = top.findIndex((x) => x.id === entry.id);
    GS.saved = true; GS.lastId = entry.id;
    $('btnSaveScore').disabled = true;
    $('saveMsg').textContent = rank >= 0 ? `¡Guardado! Puesto #${rank + 1} en el Salón de los Masacradores.` : 'Guardado… pero no entraste al top 10. Los goblins se burlan de ti.';
    AudioSys.play(rank >= 0 ? 'buy' : 'nobuy');
  }

  // ---- Opciones ----
  const RANGE_OPTS = [
    ['optMaster', 'master', (v) => v / 100, (v) => Math.round(v * 100), (v) => `${Math.round(v * 100)}%`],
    ['optMusic', 'music', (v) => v / 100, (v) => Math.round(v * 100), (v) => `${Math.round(v * 100)}%`],
    ['optSfx', 'sfx', (v) => v / 100, (v) => Math.round(v * 100), (v) => `${Math.round(v * 100)}%`],
    ['optSens', 'sens', (v) => v / 100, (v) => Math.round(v * 100), (v) => `${v.toFixed(2)}x`],
    ['optFov', 'fov', (v) => v, (v) => v, (v) => `${v}°`]
  ];
  const CHECK_OPTS = [['optInvert', 'invertY'], ['optShake', 'shake'], ['optCrt', 'crt'], ['optMap', 'minimap'], ['optFps', 'showFps']];
  function syncOptionsUI() {
    for (const [id, key, , from, fmt] of RANGE_OPTS) { const el = $(id); el.value = from(settings[key]); el.nextElementSibling.textContent = fmt(settings[key]); }
    for (const [id, key] of CHECK_OPTS) $(id).checked = !!settings[key];
    $('optRes').value = String(settings.res); $('optDiff').value = String(settings.diff);
  }
  function applySettings() {
    AudioSys.applyVolumes();
    $('scanlines').classList.toggle('hidden', !settings.crt);
    if ((settings.res | 0) !== R.W) resizeRenderer(); else updateProjection();
    saveSettings();
  }
  function bindOptions() {
    for (const [id, key, to, , fmt] of RANGE_OPTS) {
      $(id).addEventListener('input', (e) => { settings[key] = to(+e.target.value); e.target.nextElementSibling.textContent = fmt(settings[key]); applySettings(); });
    }
    for (const [id, key] of CHECK_OPTS) $(id).addEventListener('change', (e) => { settings[key] = e.target.checked; applySettings(); AudioSys.play('menu_move'); });
    $('optRes').addEventListener('change', (e) => { settings.res = +e.target.value; applySettings(); });
    $('optDiff').addEventListener('change', (e) => { settings.diff = +e.target.value; applySettings(); });
    $('btnOptReset').addEventListener('click', () => { Object.assign(settings, DEFAULTS); syncOptionsUI(); applySettings(); });
  }

  // ---- Puntero (Pointer Lock API) ----
  let locked = false;
  function requestLock() {
    if (GS.noLock) return;
    const el = R.cv;
    if (document.pointerLockElement === el) return;
    try {
      const r = el.requestPointerLock();
      if (r && r.catch) r.catch(() => { /* el usuario verá el aviso para hacer clic */ });
    } catch (e) { /* ignorado */ }
  }
  function exitLock() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }

  // ---- Flujo del juego ----
  function enterMenu() {
    AudioSys.unlock();
    GS.state = 'menu';
    $('tagline').textContent = pick(TAGLINES);
    UI.show('menu');
    AudioSys.setMusic('menu');
    AudioSys.play('menu_ok');
  }
  function newGame() {
    AudioSys.unlock();
    GS.diff = DIFFS[settings.diff] || DIFFS[1];
    resetPlayer(); resetDecos();
    GS.enemies = []; GS.projs = []; GS.parts = []; GS.pickups = []; GS.effects = []; GS.booms = [];
    GS.alive = 0; GS.wave = 0; GS.toSpawn = []; GS.shake = 0; GS.saved = false;
    GS.stats = { shots: 0, hits: 0, gold: 0, time: 0 };
    dynLights.length = 0; flowCell = -1;
    GS.state = 'playing'; GS.waveState = 'countdown'; GS.waveTimer = 3.01;
    UI.cache = {}; UI.beltKey = '';
    $('feed').innerHTML = '';
    UI.show(null);
    AudioSys.setMusic('level', true); AudioSys.duck = 1;
    UI.announce('¡PREPÁRATE!', `Dificultad: ${GS.diff.name}`, 2, '');
    UI.feed('WASD moverse · Clic disparar · Q cambiar arma', '');
    UI.feed('Shift = esquive invulnerable · Espacio = saltar', '');
    requestLock();
  }
  function pauseGame() {
    if (GS.state !== 'playing') return;
    GS.state = 'paused'; mouseDown = false;
    exitLock();
    UI.show('pause'); AudioSys.duck = 0.35;
  }
  function resumeGame() {
    GS.state = 'playing'; UI.show(null); AudioSys.duck = 1; requestLock();
  }
  function quitToMenu() {
    exitLock(); GS.state = 'menu'; AudioSys.duck = 1;
    $('tagline').textContent = pick(TAGLINES);
    UI.show('menu'); AudioSys.setMusic('menu', true);
  }
  function gameOver() {
    GS.state = 'gameover'; mouseDown = false;
    exitLock();
    $('goScore').textContent = P.score.toLocaleString('es');
    $('goWave').textContent = GS.wave; $('goKills').textContent = P.kills;
    $('goAcc').textContent = `${GS.stats.shots ? Math.round(GS.stats.hits / GS.stats.shots * 100) : 0}%`;
    $('goTime').textContent = fmtTime(GS.stats.time); $('goGold').textContent = GS.stats.gold;
    $('goQuote').textContent = pick(GO_QUOTES);
    $('goName').value = store.get('gm_lastname', '');
    $('btnSaveScore').disabled = false; $('saveMsg').textContent = '';
    UI.show('gameover');
    AudioSys.duck = 1; AudioSys.setMusic('menu', true);
    setTimeout(() => $('goName').focus(), 60);
  }

  // ---- Entrada ----
  const keys = {};
  let mouseDown = false, wheelT = 0;
  function jump() { if (P.onGround && P.alive) { P.vz = 3.7; P.onGround = false; AudioSys.play('jump'); } }
  function dash() {
    if (P.dashCd > 0 || !P.alive) return;
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f++; if (keys.KeyS || keys.ArrowDown) f--;
    if (keys.KeyD || keys.ArrowRight) s++; if (keys.KeyA || keys.ArrowLeft) s--;
    if (!f && !s) f = 1;
    const c = Math.cos(P.a), sn = Math.sin(P.a);
    let x = c * f - sn * s, y = sn * f + c * s; const l = Math.hypot(x, y) || 1;
    P.dashX = x / l; P.dashY = y / l; P.dashT = 0.17; P.dashCd = 1.0;
    AudioSys.play('dash');
  }

  function bindInput() {
    document.addEventListener('keydown', (e) => {
      if (GS.state === 'splash') { e.preventDefault(); enterMenu(); return; }
      if (document.activeElement === $('goName')) { if (e.key === 'Enter') saveScore(); return; }
      keys[e.code] = true;
      if (e.code === 'KeyM') { const m = AudioSys.toggleMute(); if (GS.state === 'playing') UI.feed(m ? 'Música silenciada' : 'Música activada'); return; }
      if (GS.state === 'playing') {
        if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(e.code)) e.preventDefault();
        if (e.repeat) return;
        const d = /^Digit([1-5])$/.exec(e.code);
        if (d) switchTo(WEAPON_ORDER[+d[1] - 1]);
        else if (e.code === 'KeyQ') cycleWeapon(1);
        else if (e.code === 'Space') jump();
        else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') dash();
        else if (e.code === 'Tab') { settings.minimap = !settings.minimap; saveSettings(); syncOptionsUI(); }
        else if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
      } else if (e.code === 'Escape') {
        if (UI.cur === 'options') $('btnOptBack').click();
        else if (UI.cur === 'scores' || UI.cur === 'credits') { GS.state = 'menu'; UI.show('menu'); }
      } else if (e.code === 'Enter' && GS.state === 'shop') {
        Shop.close();
      }
    });
    document.addEventListener('keyup', (e) => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

    const view = $('view');
    view.addEventListener('mousedown', (e) => {
      if (GS.state !== 'playing') return;
      if (!locked && !GS.noLock) { requestLock(); return; }
      if (e.button === 0) { mouseDown = true; tryFire(); }
    });
    document.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('mousemove', (e) => {
      if (GS.state !== 'playing' || !P.alive || !(locked || GS.noLock)) return;
      const k = 0.0022 * settings.sens;
      P.a += (e.movementX || 0) * k;
      P.look = clamp(P.look - (e.movementY || 0) * k * (settings.invertY ? -1 : 1), -0.45, 0.45);
    });
    window.addEventListener('wheel', (e) => {
      if (GS.state !== 'playing') return;
      const now = performance.now(); if (now - wheelT < 140) return; wheelT = now;
      cycleWeapon(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      locked = document.pointerLockElement === R.cv;
      if (!locked && GS.state === 'playing') pauseGame();
    });
    if (!('requestPointerLock' in R.cv)) GS.noLock = true;
    window.addEventListener('resize', () => { resizeRenderer(); Weapons3D.resize(); });

    // botones
    $('splash').addEventListener('click', () => { if (GS.state === 'splash') enterMenu(); });
    const btn = (id, fn) => $(id).addEventListener('click', () => { AudioSys.play('menu_ok'); fn(); });
    btn('btnPlay', newGame);
    btn('btnScores', () => { GS.state = 'scores'; renderScores(); UI.show('scores'); });
    btn('btnOptions', () => { GS.state = 'options'; UI.optReturn = 'menu'; syncOptionsUI(); UI.show('options'); });
    btn('btnCredits', () => { GS.state = 'credits'; UI.show('credits'); });
    btn('btnScoresBack', () => { GS.state = 'menu'; UI.show('menu'); });
    btn('btnCreditsBack', () => { GS.state = 'menu'; UI.show('menu'); });
    btn('btnClearScores', () => { if (confirm('¿Borrar todos los récords? Los goblins aplaudirán.')) { store.set('gm_scores', []); renderScores(); } });
    btn('btnOptBack', () => {
      if (UI.optReturn === 'pause') { GS.state = 'paused'; UI.show('pause'); } else { GS.state = 'menu'; UI.show('menu'); }
    });
    btn('btnResume', resumeGame);
    btn('btnPauseOptions', () => { UI.optReturn = 'pause'; syncOptionsUI(); UI.show('options'); });
    btn('btnQuit', quitToMenu);
    btn('btnNextWave', () => Shop.close());
    btn('btnSaveScore', saveScore);
    btn('btnRetry', newGame);
    btn('btnGoScores', () => { if (!GS.saved && P.score > 0) saveScore(); GS.state = 'scores'; renderScores(); UI.show('scores'); });
    btn('btnGoMenu', () => { if (!GS.saved && P.score > 0) saveScore(); quitToMenu(); });
    document.querySelectorAll('.btn').forEach((b) => b.addEventListener('mouseenter', () => AudioSys.play('menu_move', 0.6)));
  }

  // =======================================================================
  // 12. BUCLE PRINCIPAL
  // =======================================================================
  function updatePlayer(dt) {
    P.fireT -= dt; P.flashT -= dt; P.emptyT -= dt; P.dashCd -= dt;
    if (P.atkAnim > 0) P.atkAnim -= dt;
    P.kick = Math.max(0, P.kick - dt * 70);
    if (P.comboT > 0) { P.comboT -= dt; if (P.comboT <= 0) P.combo = 0; }
    if (P.switchT > 0) { P.switchT -= dt; if (P.switchT <= 0.15 && P.next) { P.cur = P.next; P.next = null; } }
    if (!P.alive) { P.vx *= 0.9; P.vy *= 0.9; return; }
    GS.stats.time += dt;
    let f = 0, s = 0;
    if (keys.KeyW || keys.ArrowUp) f++; if (keys.KeyS || keys.ArrowDown) f--;
    if (keys.KeyD || keys.ArrowRight) s++; if (keys.KeyA || keys.ArrowLeft) s--;
    const c = Math.cos(P.a), sn = Math.sin(P.a);
    let wx = c * f - sn * s, wy = sn * f + c * s;
    const wl = Math.hypot(wx, wy); if (wl > 0) { wx /= wl; wy /= wl; }
    const spd = 5.6 * P.speedMul;
    const acc = Math.min(1, (P.onGround ? 13 : 4) * dt);
    P.vx += (wx * spd - P.vx) * acc; P.vy += (wy * spd - P.vy) * acc;
    if (P.dashT > 0) { P.dashT -= dt; P.vx = P.dashX * 15; P.vy = P.dashY * 15; if (Math.random() < 0.6) addPart(P.x, P.y, 0.3, -P.dashX, -P.dashY, 0.4, 0.3, 0xff8a8a8a, 0.06, false, 0); }
    moveCollide(P, P.vx * dt, P.vy * dt, 0.24);
    if (!P.onGround) {
      P.vz -= 11 * dt; P.z += P.vz * dt;
      if (P.z <= 0) { P.z = 0; P.vz = 0; P.onGround = true; AudioSys.play('land'); }
    }
    const sp = Math.hypot(P.vx, P.vy);
    P.bobAmt = lerp(P.bobAmt, P.onGround ? Math.min(1, sp / 5) : 0, Math.min(1, dt * 8));
    P.bobT += dt * sp * 1.7;
    if (mouseDown && (locked || GS.noLock)) tryFire();
  }

  function updateGame(dt) {
    updatePlayer(dt);
    const pc = (P.y | 0) * MW + (P.x | 0);
    flowT -= dt;
    if (pc !== flowCell || flowT <= 0) { buildFlow(P.x, P.y); flowT = 0.5; }
    const n = GS.enemies.length;
    for (let i = 0; i < n && i < GS.enemies.length; i++) updateEnemy(GS.enemies[i], dt);
    updateProjectiles(dt);
    updateParticles(dt);
    updatePickups(dt);
    updateWaves(dt);
    GS.shake = clamp(GS.shake - dt * 2.2, 0, 1.6);
    if (!P.alive) { P.deathT += dt; if (P.deathT > 2.4 && GS.state === 'playing') gameOver(); }
  }

  function enemyTex(e) {
    const F = GOB_TEX[e.type];
    if (e.dead) return e.gib ? F.gib : e.deadT < 0.16 ? F.pain : e.deadT < 0.36 ? F.dead0 : F.dead1;
    if (e.state === 'attack') return F.attack;
    if (e.state === 'pain') return F.pain;
    return ((e.animT * e.T.speed * e.spdMul * 1.4) | 0) % 2 ? F.walk1 : F.walk0;
  }

  const menuGobs = [];
  function collectSprites(attract) {
    sprList.length = 0;
    const t = GS.time;
    for (const d of decos) {
      if (d.type === 'torch') sprList.push({ x: d.x, y: d.y, z: 0, w: 0.33, h: 1.0, tex: SPR.torch[((t * 9 + d.ph) | 0) % 3], full: true });
      else if (d.type === 'barrel') { if (d.alive) sprList.push({ x: d.x, y: d.y, z: 0, w: 0.62, h: 0.82, tex: SPR.barrel, ent: d }); }
      else sprList.push({ x: d.x, y: d.y, z: 0, w: 0.55, h: 0.28, tex: SPR.bones });
    }
    if (attract) {
      for (const g of menuGobs) {
        const F = GOB_TEX[g.type], T = ETYPES[g.type];
        sprList.push({ x: g.x, y: g.y, z: 0, w: T.w, h: T.h, tex: ((t * 3 + g.ph) | 0) % 4 === 3 ? F.attack : ((t * 4 + g.ph) | 0) % 2 ? F.walk1 : F.walk0, flip: g.flip });
      }
      return;
    }
    for (const e of GS.enemies) {
      sprList.push({ x: e.x, y: e.y, z: 0, w: e.T.w, h: e.T.h, tex: enemyTex(e), flash: !e.dead && e.flash > 0, flip: e.flip, ent: e });
    }
    for (const k of GS.pickups) {
      const bob = k.z === 0 ? 0.03 + Math.sin(k.t * 3) * 0.03 : 0;
      const blink = k.life < 5 && ((k.t * 8) | 0) % 2;
      if (blink) continue;
      if (k.kind === 'coin') sprList.push({ x: k.x, y: k.y, z: k.z + bob, w: 0.28, h: 0.28, tex: SPR.coin[((k.t * 8) | 0) % 4], full: true });
      else sprList.push({ x: k.x, y: k.y, z: k.z + bob, w: 0.4, h: 0.4, tex: SPR[k.kind === 'potion' ? 'potion' : k.kind], full: k.kind === 'armor' });
    }
    for (const p of GS.projs) {
      const sz = p.kind === 'arrow' ? 0.4 : p.kind === 'bomb' ? 0.32 : 0.36;
      const tex = p.kind === 'arrow' ? SPR.arrow : p.kind === 'rocket' ? SPR.rocket : p.kind === 'bomb' ? SPR.bomb[((t * 10) | 0) % 2] : SPR.fireball[((t * 12) | 0) % 2];
      sprList.push({ x: p.x, y: p.y, z: p.z - sz / 2, w: sz, h: sz, tex, full: p.kind !== 'arrow' && p.kind !== 'bomb' });
    }
    for (const f of GS.effects) {
      const fr = f.frames[Math.min(f.frames.length - 1, (f.t / f.dur * f.frames.length) | 0)];
      sprList.push({ x: f.x, y: f.y, z: Math.max(0, f.z - f.size), w: f.size * 2, h: f.size * 2, tex: fr, full: true });
    }
    for (const p of GS.parts) sprList.push({ x: p.x, y: p.y, z: p.z, w: p.size, h: p.size, col: p.col, full: p.full });
  }

  function drawWeapon() {
    if (Weapons3D.ok) {
      const lower = P.switchT > 0 ? (P.switchT > 0.15 ? (0.3 - P.switchT) / 0.15 : P.switchT / 0.15) : 0;
      Weapons3D.draw({
        id: P.cur, time: GS.time, flash: P.flashT, atk: P.atkAnim / 0.3, bobT: P.bobT, bobAmt: P.bobAmt, lower,
        firing: P.fireT > 0 && mouseDown, drop: P.alive ? 0 : Math.min(1, P.deathT), yaw: P.a, pitch: P.look,
        light: LIGHT[clamp(P.y | 0, 0, MH - 1) * MW + clamp(P.x | 0, 0, MW - 1)] / 256
      });
      return;
    }
    if (!P.alive && P.deathT > 0.8) return;
    const ctx = R.ctx, ws = R.H / 175;
    const key = P.cur, A = WEAPON_ART[key];
    let fi = 0;
    if (key === 'axe') fi = P.atkAnim > 0.18 ? 1 : P.atkAnim > 0 ? 2 : 0;
    else if (key === 'chaingun') fi = P.fireT > 0 && mouseDown ? ((GS.time * 24) | 0) % 2 : 0;
    else fi = P.flashT > 0 ? 1 : 0;
    const L = LIGHT[clamp(P.y | 0, 0, MH - 1) * MW + clamp(P.x | 0, 0, MW - 1)] / 256 + (P.flashT > 0 ? 0.5 : 0);
    const vi = L < 0.5 ? 0 : L < 0.75 ? 1 : L < 1.0 ? 2 : 3;
    let off = 0;
    if (P.switchT > 0) off = (P.switchT > 0.15 ? (0.3 - P.switchT) / 0.15 : P.switchT / 0.15) * A.h * ws * 0.9;
    const bx = Math.cos(P.bobT) * 7 * P.bobAmt * ws, by = Math.abs(Math.sin(P.bobT)) * 6 * P.bobAmt * ws;
    const w = A.w * ws, h = A.h * ws;
    const x = R.W / 2 - w / 2 + bx + (key === 'axe' ? 24 * ws : 0);
    const y = R.H - h + by + P.kick * ws * 0.6 + off + 6 * ws + (P.alive ? 0 : P.deathT * 140 * ws);
    if (P.flashT > 0 && A.flash) {
      const fl = WEAPON_ART.flash[((GS.time * 40) | 0) % 2], fs = 1.25 * ws;
      ctx.drawImage(fl, Math.round(x + A.flash[0] * ws - 24 * fs), Math.round(y + A.flash[1] * ws - 24 * fs), Math.round(48 * fs), Math.round(40 * fs));
    }
    ctx.drawImage(A.frames[fi][vi], Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function renderGame() {
    const sh = settings.shake ? Math.min(GS.shake, 1.5) : 0;
    const deathDrop = P.alive ? 0 : Math.min(0.45, P.deathT * 0.5);
    const cam = {
      x: P.x, y: P.y,
      a: P.a + (Math.random() - 0.5) * sh * 0.03,
      pitch: Math.tan(P.look) * R.F + (Math.random() - 0.5) * sh * 12 * (R.H / 200) + (P.alive ? 0 : Math.min(30, P.deathT * 40)),
      z: EYE + P.z + Math.abs(Math.sin(P.bobT)) * 0.035 * P.bobAmt - deathDrop
    };
    collectSprites(false);
    renderWorld(cam);
    renderSprites();
    R.ctx.putImageData(R.img, 0, 0);
    drawWeapon();
    if (!P.alive) { R.ctx.fillStyle = `rgba(120,0,0,${Math.min(0.55, P.deathT * 0.3)})`; R.ctx.fillRect(0, 0, R.W, R.H); }
  }

  function renderAttract() {
    const ang = GS.time * 0.12;
    const cam = { x: 16 + Math.cos(ang) * 2.4, y: 16 + Math.sin(ang) * 2.4, a: ang + 0.35, pitch: Math.sin(GS.time * 0.3) * 6, z: EYE };
    collectSprites(true);
    renderWorld(cam);
    renderSprites();
    R.ctx.putImageData(R.img, 0, 0);
  }

  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    GS.time += dt;
    try {
      AudioSys.update(dt);
      if (GS.state === 'playing') updateGame(dt);
      else if (GS.state === 'gameover') { updateParticles(dt); for (const e of GS.enemies) updateEnemy(e, dt); }
      updateLights(GS.time, dt);
      if (['playing', 'paused', 'shop', 'gameover'].includes(GS.state)) renderGame(); else renderAttract();
      UI.update(dt);
    } catch (err) {
      console.error(err);
    }
    requestAnimationFrame(frame);
  }

  function init() {
    AudioSys.init();
    buildMap(); resetDecos(); initLights();
    buildWallTextures(); buildFloorTextures(); buildSprites();
    for (const t of Object.keys(ETYPES)) buildGoblinFrames(t);
    buildWeaponArt(); buildIcons();
    const mc = $('merchant');
    drawGoblin(painter(mc.getContext('2d')), GOB_STYLE.merchant, 'walk0');
    toTex(mc, { cut: true, outline: true });
    for (const [x, y, type] of [[11, 17, 'grunt'], [20.5, 14.5, 'archer'], [14.5, 10.4, 'brute'], [17.2, 21.4, 'shaman'], [10.5, 12, 'kamikaze'], [21.2, 19.5, 'grunt'], [13.5, 21.3, 'grunt'], [21, 12, 'boss']]) {
      menuGobs.push({ x, y, type, ph: Math.random() * 10, flip: Math.random() < 0.5 });
    }
    resetPlayer();
    resizeRenderer();
    if (Weapons3D.init($('viewmodel'), $('view'))) Object.assign(ICONS, Weapons3D.icons());
    else $('viewmodel').classList.add('hidden');
    WEAPON_ORDER.forEach((k, i) => { if (ICONS[k]) $(`arm${i + 1}`).querySelector('img').src = ICONS[k]; });
    Flask.init();
    buildMinimapBase();
    bindInput(); bindOptions(); syncOptionsUI();
    $('scanlines').classList.toggle('hidden', !settings.crt);
    UI.audioStatus();
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
    $('mobileWarn').classList.toggle('hidden', !coarse);
    UI.show('splash');
    requestAnimationFrame(frame);
  }

  // Ganchos para depuración desde la consola (no afectan al juego)
  window.GoblinzMassacre = { GS, P, settings, startWave, spawnEnemy, newGame, Shop, gameOver, version: '1.0', autor: 'Santiago Colmenares' };

  init();
})();
