/* ==========================================================================
   Pixelteca — Santiago Colmenares
   Estantería 3D low-poly (Three.js r128), inserción del cartucho en la consola
   y transición de carga estilo CRT. Si Three.js o WebGL no están disponibles,
   la lista de cartuchos y la pantalla de carga siguen funcionando.
   ========================================================================== */
(function () {
  "use strict";

  /* 1. Catálogo ------------------------------------------------------------ */
  // Los colores de cada etiqueta salen de la hoja de estilos de cada juego.
  const GAMES = {
    galaxhell: {
      title: "GALAXHELL",
      lines: ["GALAXHELL"],
      tag: "SHMUP/RPG",
      rom: 16,
      art: "galaxhell",
      desc: "Shoot 'em up de tipo bullet hell cruzado con combates RPG por turnos. Esquiva cortinas de balas y ábrete paso hasta el jefe final.",
      genre: "Bullet hell · RPG por turnos",
      players: "1",
      control: "Teclado (flechas o WASD, Z, X, Shift)",
      keyboard: true,
      palette: { bg: "#05030f", title: "#ffe040", shadow: "#a01020", a: "#ffe040", b: "#ff2a3a", c: "#29e3ff", d: "#b04aff", e: "#ff60c0" }
    },
    goblinz: {
      title: "GOBLINZ MASSACRE",
      lines: ["GOBLINZ", "MASSACRE"],
      tag: "FPS/HORDAS",
      rom: 24,
      art: "goblinz",
      desc: "FPS retro de supervivencia por oleadas: hordas de goblins, varias armas y una arena que no da tregua.",
      genre: "FPS retro · supervivencia por oleadas",
      players: "1",
      control: "Teclado y ratón",
      keyboard: true,
      palette: { bg: "#1a0f0d", title: "#f2c14e", shadow: "#6e0b10", a: "#f2c14e", b: "#c0141e", c: "#7ccf3f", d: "#6e0b10", e: "#241815" }
    },
    nachthexen: {
      title: "NACHTHEXEN",
      lines: ["NACHTHEXEN"],
      tag: "RAIL 3D",
      rom: 32,
      art: "nachthexen",
      desc: "Las Brujas de la Noche: rail shooter 3D con estética N64/PS1 sobre el 588.º Regimiento de Bombardeo Nocturno soviético. Capítulo 1, versión beta.",
      genre: "Rail shooter 3D · estética N64/PS1",
      players: "1",
      control: "Teclado o ratón",
      keyboard: true,
      palette: { bg: "#05070d", title: "#ffd76a", shadow: "#6e0b08", a: "#ffb84d", b: "#d7261e", c: "#8fd0ff", d: "#d8c79d", e: "#14203a" }
    },
    strikers: {
      title: "DIMENSION STRIKERS",
      lines: ["DIMENSION", "STRIKERS"],
      tag: "FUTBOL 2.5D",
      rom: 24,
      art: "strikers",
      desc: "Fútbol arcade 2.5D en pixel art con supertiros al estilo anime. Compite en el Súper Torneo Dimensional contra la máquina o contra un amigo.",
      genre: "Fútbol arcade 2.5D · pixel art",
      players: "1–2 (local)",
      control: "Teclado o mando",
      keyboard: true,
      palette: { bg: "#160b26", title: "#29f0ff", shadow: "#8a1477", a: "#ffd23f", b: "#ff2bd6", c: "#29f0ff", d: "#2f80ff", e: "#ff3b5c" }
    },
    formula: {
      title: "FÓRMULA AZUL",
      lines: ["FÓRMULA AZUL"],
      tag: "CO-OP 2P",
      rom: 32,
      art: "formula",
      desc: "Escuadrón de Limpieza: rail shooter 3D arcade cooperativo. El PC hace de máquina arcade y cada celular se convierte en una pistola óptica.",
      genre: "Rail shooter 3D cooperativo",
      players: "1–2 cooperativo",
      control: "Celular como pistola óptica (o ratón para pruebas)",
      keyboard: false,
      note: "Para enlazar los celulares el juego debe abrirse por HTTPS y en la misma red Wi-Fi. Sin celular puedes probarlo con el ratón (tecla M en el lobby).",
      palette: { bg: "#02050a", title: "#e6ffff", shadow: "#1462d4", a: "#7fe8ff", b: "#1462d4", c: "#3ff6ff", d: "#ffd23f", e: "#2fa8ff" }
    }
  };

  /* 2. Referencias y estado ------------------------------------------------ */
  const stage = document.getElementById("stage");
  const canvas = document.getElementById("stage-canvas");
  const bootText = document.getElementById("stage-boot");
  const counter = document.getElementById("stage-counter");
  const soundBtn = document.getElementById("stage-sound");
  const info = document.getElementById("cart-info");
  const cover = document.getElementById("info-cover");
  const crt = document.getElementById("crt");
  const crtNoise = document.getElementById("crt-noise");
  const crtGame = document.getElementById("crt-game");
  const crtLog = document.getElementById("crt-log");
  const field = (id) => document.getElementById("info-" + id);

  const spines = Array.from(document.querySelectorAll("#shelf .spine"));
  const games = spines.map((spine) => Object.assign({ url: spine.getAttribute("href"), spine: spine }, GAMES[spine.dataset.game]));

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  let selected = -1;
  let busy = false;
  let scene3d = null;

  const pad = (n) => String(n).padStart(2, "0");
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* 3. Sonido sintetizado (Web Audio, sin archivos) ------------------------ */
  const sound = {
    ctx: null,
    master: null,
    on: readSoundPref(),

    unlock() {
      if (!this.on) return;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") this.ctx.resume();
    },

    ready() {
      return this.on && this.ctx && this.ctx.state === "running";
    },

    tone(freq, dur, opts) {
      if (!this.ready()) return;
      const o = Object.assign({ type: "square", vol: 0.05, to: 0, delay: 0 }, opts);
      const t = this.ctx.currentTime + o.delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = o.type;
      osc.frequency.setValueAtTime(freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      gain.gain.setValueAtTime(o.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },

    noise(dur, opts) {
      if (!this.ready()) return;
      const o = Object.assign({ vol: 0.1, freq: 2000, type: "lowpass" }, opts);
      const ctx = this.ctx;
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = buffer;
      filter.type = o.type;
      filter.frequency.value = o.freq;
      gain.gain.setValueAtTime(o.vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start();
    },

    select() { this.tone(660, 0.07, { to: 990, vol: 0.03 }); },
    lift() { this.tone(220, 0.4, { type: "triangle", to: 700, vol: 0.07 }); },
    clunk() {
      this.noise(0.14, { vol: 0.4, freq: 700 });
      this.tone(130, 0.18, { to: 50, vol: 0.14 });
    },
    power() {
      this.tone(55, 0.5, { type: "sawtooth", vol: 0.05 });
      this.noise(0.45, { vol: 0.04, freq: 6000, type: "highpass" });
    },
    hiss(dur) { this.noise(dur, { vol: 0.09, freq: 3200, type: "bandpass" }); },
    tick(i) { this.tone(880 + i * 110, 0.05, { vol: 0.03 }); },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, { vol: 0.045, delay: i * 0.09 }));
    }
  };

  function readSoundPref() {
    try {
      return localStorage.getItem("pixelteca-sound") !== "off";
    } catch (e) {
      return true;
    }
  }

  function setSound(on) {
    sound.on = on;
    soundBtn.setAttribute("aria-pressed", String(on));
    soundBtn.textContent = on ? "Sonido: sí" : "Sonido: no";
    try {
      localStorage.setItem("pixelteca-sound", on ? "on" : "off");
    } catch (e) {
      /* almacenamiento bloqueado: la preferencia dura solo esta visita */
    }
  }

  /* 4. Selección y ficha del cartucho -------------------------------------- */
  function select(index, quiet) {
    index = (index + games.length) % games.length;
    if (index === selected) return;
    selected = index;
    const game = games[index];

    field("slot").textContent = "Cartucho " + pad(index + 1) + " / " + pad(games.length);
    field("title").textContent = game.title;
    field("desc").textContent = game.desc;
    field("genre").textContent = game.genre;
    field("players").textContent = game.players;
    field("control").textContent = game.control;
    field("play").href = game.url;

    const note = game.note || (coarsePointer && game.keyboard ? "Este juego necesita teclado: ábrelo en un computador para jugarlo." : "");
    field("note").textContent = note;
    field("note").hidden = !note;

    counter.textContent = pad(index + 1) + " / " + pad(games.length);
    spines.forEach((spine, i) => spine.parentElement.classList.toggle("is-active", i === index));

    drawCover();
    info.classList.remove("is-swapping");
    void info.offsetWidth; // reinicia la animación de glitch
    info.classList.add("is-swapping");

    if (!quiet) sound.select();
  }

  // Las etiquetas se dibujan una sola vez, cuando ya cargó la fuente pixel.
  const labels = [];
  let fontsLoaded = false;

  function labelFor(index) {
    if (!labels[index]) labels[index] = drawLabel(games[index], index);
    return labels[index];
  }

  function drawCover() {
    if (!fontsLoaded) return;
    const ctx = cover.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(labelFor(selected), 0, 0, cover.width, cover.height);
  }

  async function play(index) {
    if (busy) return;
    busy = true;
    sound.unlock();
    select(index, true);
    if (scene3d && !reducedMotion) {
      try {
        await scene3d.insert(index);
      } catch (e) {
        /* si la animación falla, la carga sigue igual */
      }
    }
    runCRT(games[index], index);
  }

  /* 5. Pantalla CRT de carga ----------------------------------------------- */
  let crtTimers = [];
  let crtActive = false;
  let noiseFrame = 0;
  let pendingUrl = "";

  function later(ms, fn) {
    crtTimers.push(setTimeout(fn, ms));
  }

  function addLog(text) {
    const li = document.createElement("li");
    li.textContent = text;
    crtLog.appendChild(li);
  }

  function runCRT(game, index) {
    crtActive = true;
    pendingUrl = game.url;
    crtGame.textContent = game.title;
    crtLog.textContent = "";
    crt.className = "crt";
    crt.hidden = false;
    void crt.offsetWidth;
    crt.classList.add("is-on");
    crt.focus({ preventScroll: true });

    let hash = 7;
    for (const ch of game.title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
    const lines = [
      "> LEYENDO CARTUCHO " + pad(index + 1) + "...",
      "> CHECKSUM 0x" + hash.toString(16).toUpperCase().padStart(4, "0") + " ... OK",
      "> MAPEANDO ROM " + game.rom + " MBIT",
      "> TODO LISTO. ¡A JUGAR!"
    ];

    if (reducedMotion) {
      crt.classList.add("is-boot", "is-ready");
      lines.forEach(addLog);
      later(900, launch);
      return;
    }

    startNoise();
    sound.hiss(1.25);
    later(1250, () => crt.classList.add("is-boot"));
    later(1600, stopNoise);
    lines.forEach((text, k) => later(1450 + k * 420, () => {
      addLog(text);
      sound.tick(k);
    }));
    later(3500, () => {
      crt.classList.add("is-ready");
      sound.fanfare();
    });
    later(4150, () => crt.classList.add("is-off"));
    later(4600, launch);
  }

  function launch() {
    crtTimers.forEach(clearTimeout);
    crtTimers = [];
    if (pendingUrl) window.location.href = pendingUrl;
  }

  function startNoise() {
    const ctx = crtNoise.getContext("2d");
    const w = crtNoise.width;
    const h = crtNoise.height;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    let roll = 0;
    const frame = () => {
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v * 0.8;
        d[i + 1] = v * 0.7;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      roll = (roll + 3) % h;
      ctx.fillStyle = "rgba(177, 151, 252, 0.2)";
      ctx.fillRect(0, roll, w, 12);
      noiseFrame = requestAnimationFrame(frame);
    };
    frame();
  }

  function stopNoise() {
    cancelAnimationFrame(noiseFrame);
  }

  // Al volver con el botón «atrás» el navegador puede restaurar la página tal cual.
  function resetAll() {
    crtTimers.forEach(clearTimeout);
    crtTimers = [];
    stopNoise();
    crtActive = false;
    pendingUrl = "";
    crt.hidden = true;
    crt.className = "crt";
    busy = false;
    if (scene3d) scene3d.reset();
  }

  /* 6. Arte de las etiquetas (pixel art generado en canvas) ---------------- */
  const SPRITES = {
    ship: [
      ".....c.....",
      "....cwc....",
      "....cwc....",
      "...pcwcp...",
      "...pwwwp...",
      "..ppwrwpp..",
      ".ppwwrwwpp.",
      "ppwwwwwwwpp",
      "p.pwwwwwp.p",
      "...yy.yy...",
      "...o...o..."
    ],
    goblin: [
      "g..........g",
      "gg.dddddd.gg",
      ".gdggggggdg.",
      ".gggggggggg.",
      ".ggyyggyygg.",
      ".ggykggkygg.",
      "..gggddggg..",
      "..gkwkwkwkg.",
      "...gkrrrkg..",
      "....gggg...."
    ],
    plane: [
      "....kkkkkkkkkk..",
      ".......k..k.....",
      "k......k..k...k.",
      "kk..kkkkkkkkkkkk",
      "kkkkkkkkrkkkkkkk",
      "k...kkkkkkkkkkk.",
      "......kkkkkkkk..",
      ".........k..k...",
      "........kk..kk.."
    ],
    ball: [
      "...kkkk...",
      "..kwwwwk..",
      ".kwwkkwwk.",
      "kwwkkkkwwk",
      "kwwwkkwwwk",
      "kkwwwwwwkk",
      "kwkwwwwkwk",
      ".kkwwwwkk.",
      "..kwwwwk..",
      "...kkkk..."
    ],
    crosshair: [
      "......c......",
      "......c......",
      "....ccccc....",
      "...c.....c...",
      "..c.......c..",
      "..c.......c..",
      "cccc..h..cccc",
      "..c.......c..",
      "..c.......c..",
      "...c.....c...",
      "....ccccc....",
      "......c......",
      "......c......"
    ],
    diamond: [
      "....a....",
      "...a.a...",
      "..a...a..",
      ".a.....a.",
      "a...h...a",
      ".a.....a.",
      "..a...a..",
      "...a.a...",
      "....a...."
    ]
  };

  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const PIXEL_FONT = '8px "Press Start 2P", monospace';

  function seeded(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Degradado con tramado ordenado 4×4, como en las paletas limitadas de 16 bits.
  function dither(ctx, x, y, w, h, top, bottom) {
    for (let j = 0; j < h; j++) {
      const r = j / Math.max(h - 1, 1);
      for (let i = 0; i < w; i++) {
        ctx.fillStyle = BAYER[(j % 4) * 4 + (i % 4)] / 16 < r ? bottom : top;
        ctx.fillRect(x + i, y + j, 1, 1);
      }
    }
  }

  function sprite(ctx, rows, colors, x, y, scale) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const color = colors[row[i]];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x + i * scale, y + j * scale, scale, scale);
      }
    });
  }

  function pixelText(ctx, str, x, y, color, shadow) {
    ctx.font = PIXEL_FONT;
    ctx.textBaseline = "top";
    if (shadow) {
      ctx.fillStyle = shadow;
      [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]].forEach(([dx, dy]) => ctx.fillText(str, x + dx, y + dy));
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  const ART = {
    galaxhell(ctx, y, h, vis, P, rand) {
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, y, 128, h);
      for (let i = 0; i < 46; i++) {
        ctx.fillStyle = rand() < 0.3 ? P.c : "#ffffff";
        ctx.fillRect((rand() * 128) | 0, y + ((rand() * h) | 0), 1, 1);
      }
      const cx = 64;
      const cy = y + vis / 2;
      for (let k = 0; k < 20; k++) {
        const ang = (k / 20) * Math.PI * 2;
        const r = k % 2 ? 24 : 19;
        ctx.fillStyle = k % 2 ? P.e : P.b;
        ctx.fillRect(Math.round(cx + Math.cos(ang) * r) - 1, Math.round(cy + Math.sin(ang) * r * 0.62) - 1, 2, 2);
      }
      sprite(ctx, SPRITES.ship, { c: P.c, w: "#ffffff", p: P.d, r: P.b, y: P.a, o: "#ff8c1a" }, cx - 11, cy - 11, 2);
    },

    goblinz(ctx, y, h, vis, P, rand) {
      dither(ctx, 0, y, 128, h, P.e, P.d);
      ctx.fillStyle = P.b;
      for (let i = 0; i < 9; i++) {
        const x = (rand() * 126) | 0;
        const len = 3 + ((rand() * 10) | 0);
        ctx.fillRect(x, y, 1, len);
        ctx.fillRect(x, y + len, 2, 2);
      }
      sprite(ctx, SPRITES.goblin, { g: P.c, d: "#3f7a1e", y: P.a, k: "#0b0606", w: "#f4e6c8", r: P.b }, 46, y + vis / 2 - 15, 3);
    },

    nachthexen(ctx, y, h, vis, P, rand) {
      dither(ctx, 0, y, 128, h, P.bg, P.e);
      ctx.fillStyle = "#f1e6c8";
      for (let i = 0; i < 22; i++) ctx.fillRect((rand() * 128) | 0, y + ((rand() * h * 0.7) | 0), 1, 1);
      // Reflectores antiaéreos
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = P.c;
      [[18, 30, 44], [112, 86, 100]].forEach(([base, l, r]) => {
        ctx.beginPath();
        ctx.moveTo(base, y + h);
        ctx.lineTo(l, y);
        ctx.lineTo(r, y);
        ctx.closePath();
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      // Luna
      const mx = 96;
      const my = y + 15;
      ctx.fillStyle = P.d;
      for (let j = -11; j <= 11; j++) {
        const half = Math.round(Math.sqrt(121 - j * j));
        ctx.fillRect(mx - half, my + j, half * 2, 1);
      }
      ctx.fillStyle = "#b9ad8e";
      ctx.fillRect(mx - 4, my - 3, 3, 3);
      ctx.fillRect(mx + 3, my + 4, 2, 2);
      sprite(ctx, SPRITES.plane, { k: "#05070d", r: P.b }, 54, y + 9, 2);
    },

    strikers(ctx, y, h, vis, P) {
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, y, 128, h);
      const cx = 64;
      const cy = y + vis / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, y, 128, h);
      ctx.clip();
      ctx.lineWidth = 2;
      for (let k = 0; k < 28; k++) {
        const ang = (k / 28) * Math.PI * 2;
        ctx.strokeStyle = k % 2 ? P.b : P.c;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * 20, cy + Math.sin(ang) * 20);
        ctx.lineTo(cx + Math.cos(ang) * 90, cy + Math.sin(ang) * 90);
        ctx.stroke();
      }
      ctx.restore();
      // Estallido dorado detrás del balón
      ctx.fillStyle = P.a;
      ctx.beginPath();
      for (let k = 0; k < 16; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const r = k % 2 ? 11 : 20;
        ctx.lineTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.85);
      }
      ctx.closePath();
      ctx.fill();
      sprite(ctx, SPRITES.ball, { k: P.bg, w: "#fff7e6" }, cx - 15, cy - 15, 3);
    },

    formula(ctx, y, h, vis, P) {
      ctx.fillStyle = P.bg;
      ctx.fillRect(0, y, 128, h);
      const horizon = y + 10;
      ctx.fillStyle = P.b;
      for (let k = 1; k < 9; k++) ctx.fillRect(0, Math.round(horizon + k * k * 0.75), 128, 1);
      ctx.strokeStyle = P.b;
      ctx.lineWidth = 1;
      for (let k = -8; k <= 8; k++) {
        ctx.beginPath();
        ctx.moveTo(64 + k * 2, horizon);
        ctx.lineTo(64 + k * 22, y + h);
        ctx.stroke();
      }
      ctx.fillStyle = P.e;
      ctx.fillRect(0, horizon, 128, 1);
      sprite(ctx, SPRITES.crosshair, { c: P.c, h: "#e6ffff" }, 22, y + vis / 2 - 13, 2);
      sprite(ctx, SPRITES.diamond, { a: P.d, h: "#fff7e6" }, 86, y + vis / 2 - 9, 2);
    }
  };

  function drawLabel(game, index) {
    const cv = document.createElement("canvas");
    cv.width = 256;
    cv.height = 160;
    const ctx = cv.getContext("2d");
    ctx.scale(2, 2); // se dibuja en 128×80 «píxeles de consola»
    ctx.imageSmoothingEnabled = false;
    const P = game.palette;

    const artTop = 12;
    const footTop = 70;
    const titleH = game.lines.length * 10 + 4;
    const fullH = footTop - artTop;
    ART[game.art](ctx, artTop, fullH, fullH - titleH, P, seeded(index + 11));

    // Banda del título
    const ty = footTop - titleH;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(0, ty, 128, titleH);
    ctx.font = PIXEL_FONT;
    game.lines.forEach((line, k) => {
      const x = Math.round((128 - ctx.measureText(line).width) / 2);
      pixelText(ctx, line, x, ty + 3 + k * 10, P.title, P.shadow);
    });

    // Cabecera de la marca y franja de color
    ctx.fillStyle = "#6f42c1";
    ctx.fillRect(0, 0, 128, 11);
    pixelText(ctx, "PIXELTECA", 3, 2, "#f8f9fa", "#3b2370");
    [P.a, P.b, P.c].forEach((color, k) => {
      ctx.fillStyle = color;
      ctx.fillRect(105 + k * 7, 3, 5, 5);
    });
    for (let x = 0; x < 128; x += 4) {
      ctx.fillStyle = (x / 4) % 2 ? P.a : P.b;
      ctx.fillRect(x, 11, 4, 1);
    }

    // Pie: género y número de cartucho
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, footTop, 128, 10);
    pixelText(ctx, game.tag, 3, footTop + 1, "#adb5bd");
    pixelText(ctx, pad(index + 1), 109, footTop + 1, P.a);
    return cv;
  }

  function drawSign(text, width, height, size, color, glow) {
    const cv = document.createElement("canvas");
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext("2d");
    ctx.font = size + 'px "Press Start 2P", monospace';
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = size * 0.6;
    }
    ctx.fillStyle = color;
    ctx.fillText(text, width / 2, height / 2 + 2);
    return cv;
  }

  /* 7. Escena 3D ----------------------------------------------------------- */
  function initScene() {
    const THREE = window.THREE;
    if (!THREE) return null;

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, powerPreference: "low-power" });
    } catch (e) {
      return null;
    }
    // Sin antialias y con resolución contenida: bordes «crujientes» de consola.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));

    const INK = 0x0c0a12;
    const VIOLET = 0x6f42c1;
    const VIOLET_SOFT = 0xb197fc;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(INK);
    scene.fog = new THREE.Fog(INK, 11, 27);

    const camera = new THREE.PerspectiveCamera(36, 16 / 10, 0.1, 60);
    const camPos = new THREE.Vector3(0, 3.5, 8.3);
    const camLook = new THREE.Vector3(0, 0.95, -0.7);
    const camGoal = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    let camOverride = null;

    const flat = (color, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: color, flatShading: true, roughness: 0.72, metalness: 0.05 }, extra));
    const texture = (cv) => {
      const tex = new THREE.CanvasTexture(cv);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      return tex;
    };

    // Luces
    scene.add(new THREE.HemisphereLight(0xc9b8ff, 0x140f1f, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(4, 7, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8a5cf0, 1.1);
    rim.position.set(-5, 4, -6);
    scene.add(rim);
    const spot = new THREE.PointLight(VIOLET_SOFT, 2.4, 5, 2);
    scene.add(spot);

    // Suelo con rejilla violeta y letrero de neón
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshBasicMaterial({ color: 0x0f0b18 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.01;
    scene.add(floor);
    const grid = new THREE.GridHelper(70, 70, VIOLET, 0x2a2238);
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    scene.add(grid);

    const signMat = new THREE.MeshBasicMaterial({
      map: texture(drawSign("PIXELTECA", 512, 96, 44, "#b197fc", "#6f42c1")),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 1.8), signMat);
    sign.position.set(0, 3.05, -7.5);
    scene.add(sign);

    // Polvo de píxeles flotando
    const DUST = 170;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 22;
      dustPos[i * 3 + 1] = Math.random() * 7;
      dustPos[i * 3 + 2] = -9 + Math.random() * 14;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: VIOLET_SOFT, size: 0.06, transparent: true, opacity: 0.6, depthWrite: false }));
    scene.add(dust);

    // Halo radial para el resplandor de los cartuchos
    const haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 64;
    const hctx = haloCanvas.getContext("2d");
    const grad = hctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    hctx.fillStyle = grad;
    hctx.fillRect(0, 0, 64, 64);
    const haloTex = new THREE.CanvasTexture(haloCanvas);

    /* 7.1 Cartuchos low-poly ---------------------------------------------- */
    const CART = { w: 1.6, h: 1.25, d: 0.26, y: 1.05 };
    const shape = new THREE.Shape();
    // Silueta frontal: esquinas superiores achaflanadas y muescas de agarre.
    [
      [-0.8, 0], [0.8, 0], [0.8, 0.62], [0.74, 0.66], [0.74, 0.86], [0.8, 0.9], [0.8, 1.1], [0.68, 1.25],
      [-0.68, 1.25], [-0.8, 1.1], [-0.8, 0.9], [-0.74, 0.86], [-0.74, 0.66], [-0.8, 0.62]
    ].forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: CART.d, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    bodyGeo.translate(0, -CART.h / 2, -CART.d / 2);
    const FRONT = CART.d / 2 + 0.03;

    const recessGeo = new THREE.PlaneGeometry(1.3, 0.84);
    const labelGeo = new THREE.PlaneGeometry(1.22, 0.7625);
    const ridgeGeo = new THREE.BoxGeometry(0.9, 0.022, 0.03);
    const pcbGeo = new THREE.BoxGeometry(1.15, 0.08, 0.08);
    const pinsGeo = new THREE.BoxGeometry(1.05, 0.045, 0.09);
    const pedestalGeo = new THREE.CylinderGeometry(0.62, 0.75, 0.24, 6);
    const ringGeo = new THREE.RingGeometry(0.68, 0.8, 6);
    const beamGeo = new THREE.CylinderGeometry(0.6, 0.7, 1.9, 6, 1, true);

    const recessMat = flat(0x26262c);
    const ridgeMat = flat(0x2e2e35);
    const pcbMat = flat(0x14532d);
    const pinsMat = flat(0xd4a64a, { metalness: 0.7, roughness: 0.35 });
    const pedestalMat = flat(0x1d1b24);

    const R = 7;
    const ARC_Z = 4.4;
    const STEP = 0.29;
    const hitTargets = [];

    const carts = games.map((game, i) => {
      const angle = (i - (games.length - 1) / 2) * STEP;
      const anchor = new THREE.Group();
      anchor.position.set(Math.sin(angle) * R, 0, ARC_Z - Math.cos(angle) * R);
      anchor.rotation.y = -angle;
      scene.add(anchor);

      const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
      pedestal.position.y = 0.12;
      anchor.add(pedestal);

      const ringMat = new THREE.MeshBasicMaterial({ color: VIOLET_SOFT, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.245;
      anchor.add(ring);

      const beamMat = new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.y = 1.2;
      anchor.add(beam);

      const cart = new THREE.Group();
      anchor.add(cart);

      const bodyMat = flat(0x4a4a54, { emissive: VIOLET, emissiveIntensity: 0 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.userData.index = i;
      cart.add(body);
      hitTargets.push(body);

      const recess = new THREE.Mesh(recessGeo, recessMat);
      recess.position.set(0, -0.12, FRONT + 0.001);
      cart.add(recess);

      const label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({ map: texture(labelFor(i)) }));
      label.position.set(0, -0.12, FRONT + 0.003);
      label.userData.index = i;
      cart.add(label);
      hitTargets.push(label);

      for (let k = 0; k < 4; k++) {
        const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
        ridge.position.set(0, 0.36 + k * 0.045, FRONT);
        cart.add(ridge);
      }

      const pcb = new THREE.Mesh(pcbGeo, pcbMat);
      pcb.position.y = -CART.h / 2 - 0.04;
      cart.add(pcb);
      const pins = new THREE.Mesh(pinsGeo, pinsMat);
      pins.position.y = -CART.h / 2 - 0.05;
      cart.add(pins);

      // Resplandor: contorno en la cara trasera + halo aditivo
      const outlineMat = new THREE.MeshBasicMaterial({ color: VIOLET_SOFT, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false });
      const outline = new THREE.Mesh(bodyGeo, outlineMat);
      outline.scale.set(1.07, 1.08, 1.4);
      cart.add(outline);

      const haloMat = new THREE.SpriteMaterial({ map: haloTex, color: 0x8a5cf0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.set(3.4, 2.8, 1);
      halo.position.z = -0.35;
      cart.add(halo);

      return { index: i, angle, anchor, cart, glow: 0, bodyMat, outlineMat, haloMat, ringMat, beamMat };
    });

    /* 7.2 Consola ---------------------------------------------------------- */
    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(0, 0, 2.3);
    scene.add(consoleGroup);

    const shellMat = flat(0x3b3b44);
    const deckMat = flat(0x2f2f37);
    const darkMat = flat(0x15151a);
    const violetMat = flat(VIOLET, { emissive: VIOLET, emissiveIntensity: 0.15 });

    // Perfil lateral extruido a lo ancho: frente achaflanado como las consolas de 16 bits.
    const extrudeSide = (points, width, bevel) => {
      const prof = new THREE.Shape();
      points.forEach(([z, y], i) => (i ? prof.lineTo(z, y) : prof.moveTo(z, y)));
      prof.closePath();
      const geo = new THREE.ExtrudeGeometry(prof, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
      geo.rotateY(-Math.PI / 2);
      geo.translate(width / 2, 0, 0);
      return geo;
    };

    const base = new THREE.Mesh(extrudeSide([[-1.15, 0], [1.15, 0], [1.15, 0.26], [0.93, 0.44], [-1.02, 0.5], [-1.15, 0.4]], 3.3, 0.035), shellMat);
    const deck = new THREE.Mesh(extrudeSide([[-0.62, 0], [0.62, 0], [0.62, 0.12], [0.5, 0.2], [-0.62, 0.2]], 2.3, 0.02), deckMat);
    deck.position.set(0, 0.46, -0.2);
    consoleGroup.add(base, deck);

    const SLOT_Z = -0.32;
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.02, 0.3), new THREE.MeshBasicMaterial({ color: 0x050508 }));
    slot.position.set(0, 0.672, SLOT_Z);
    const slotGlowMat = new THREE.MeshBasicMaterial({ color: VIOLET_SOFT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    const slotGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.24), slotGlowMat);
    slotGlow.rotation.x = -Math.PI / 2;
    slotGlow.position.set(0, 0.684, SLOT_Z);
    consoleGroup.add(slot, slotGlow);
    [-0.19, 0.19].forEach((dz) => {
      const lip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.035, 0.06), darkMat);
      lip.position.set(0, 0.68, SLOT_Z + dz);
      consoleGroup.add(lip);
    });

    const sliders = [-0.78, 0.78].map((x) => {
      const track = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.02, 0.3), darkMat);
      track.position.set(x, 0.668, 0.2);
      const knob = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.14), violetMat);
      knob.position.set(x, 0.7, 0.13);
      consoleGroup.add(track, knob);
      return knob;
    });
    const power = sliders[0];
    const POWER_Z = power.position.z;

    const ledMat = new THREE.MeshBasicMaterial({ color: 0x2a2238 });
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.08), ledMat);
    led.position.set(-1.3, 0.47, 0.72);
    const ledLight = new THREE.PointLight(VIOLET_SOFT, 0, 2.2, 2);
    ledLight.position.set(-1.3, 0.75, 0.9);
    consoleGroup.add(led, ledLight);

    [-0.75, 0.75].forEach((x) => {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.15, 0.05), darkMat);
      port.position.set(x, 0.13, 1.18);
      consoleGroup.add(port);
    });

    // Placa con la marca sobre el chaflán frontal
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.24),
      new THREE.MeshBasicMaterial({ map: texture(drawSign("PIXELTECA · 16-BIT", 640, 64, 30, "#b197fc")), transparent: true })
    );
    plate.rotation.x = -0.886;
    plate.position.set(0, 0.375, 1.085);
    consoleGroup.add(plate);

    consoleGroup.traverse((obj) => {
      if (obj.isMesh) {
        obj.userData.console = true;
        hitTargets.push(obj);
      }
    });

    const SLOT = { z: consoleGroup.position.z + SLOT_Z, y: 0.672 };

    /* 7.3 Animaciones (tweens con promesas) -------------------------------- */
    const tweens = new Set();
    const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const easeIn = (t) => t * t * t;
    const linear = (t) => t;

    function tween(duration, update, ease) {
      return new Promise((resolve) => {
        tweens.add({ start: performance.now(), duration, update, ease: ease || easeInOut, resolve });
      });
    }

    function stepTweens(now) {
      tweens.forEach((tw) => {
        const t = clamp((now - tw.start) / tw.duration, 0, 1);
        tw.update(tw.ease(t));
        if (t === 1) {
          tweens.delete(tw);
          tw.resolve();
        }
      });
    }

    let inserting = null;

    async function insert(index) {
      const c = carts[index];
      inserting = c;
      scene.attach(c.cart); // conserva la posición en el mundo al sacarlo del pedestal
      const p0 = c.cart.position.clone();
      const q0 = c.cart.quaternion.clone();
      const upright = new THREE.Quaternion();
      const above = new THREE.Vector3(0, 2.8, SLOT.z);
      const insertedY = SLOT.y + CART.h / 2 - 0.5;

      sound.lift();
      camOverride = { pos: new THREE.Vector3(0, 3.6, 8.4), look: new THREE.Vector3(0, 1.3, SLOT.z) };
      await tween(720, (t) => {
        c.cart.position.lerpVectors(p0, above, t);
        c.cart.position.y += Math.sin(t * Math.PI) * 0.9;
        c.cart.quaternion.copy(q0).slerp(upright, t);
        c.cart.rotateY(t * Math.PI * 2); // giro completo en el aire
      });
      await wait(140);
      await tween(360, (t) => {
        c.cart.position.y = above.y + (insertedY - above.y) * t;
      }, easeIn);

      sound.clunk();
      slotGlowMat.opacity = 0.9;
      tween(280, (t) => {
        consoleGroup.position.y = -Math.sin(t * Math.PI * 3) * 0.05 * (1 - t);
      }, linear);
      await tween(230, (t) => {
        power.position.z = POWER_Z + 0.13 * t;
      });
      ledMat.color.setHex(VIOLET_SOFT);
      ledLight.intensity = 1.6;
      sound.power();
      camOverride = { pos: new THREE.Vector3(0, 2.2, 5.7), look: new THREE.Vector3(0, 0.95, SLOT.z) };
      await wait(700);
    }

    function reset() {
      tweens.clear();
      if (inserting) {
        inserting.anchor.add(inserting.cart);
        inserting.cart.quaternion.identity();
        inserting = null;
      }
      camOverride = null;
      consoleGroup.position.y = 0;
      power.position.z = POWER_Z;
      ledMat.color.setHex(0x2a2238);
      ledLight.intensity = 0;
      slotGlowMat.opacity = 0;
    }

    /* 7.4 Entrada: ratón, toque y gestos ----------------------------------- */
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let pointerType = "mouse";
    let downX = 0;
    let downY = 0;
    let swiped = false;

    function pick(e) {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(hitTargets, false)[0];
      return hit ? hit.object.userData : null;
    }

    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse" || busy) return;
      const hit = pick(e);
      canvas.classList.toggle("is-pointer", !!hit);
      if (hit && hit.index !== undefined) select(hit.index);
    });

    canvas.addEventListener("pointerdown", (e) => {
      pointerType = e.pointerType;
      downX = e.clientX;
      downY = e.clientY;
    });

    canvas.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse" || busy) return;
      const dx = e.clientX - downX;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - downY)) {
        swiped = true;
        sound.unlock();
        select(selected + (dx < 0 ? 1 : -1));
      }
    });

    canvas.addEventListener("click", (e) => {
      if (swiped) {
        swiped = false;
        return;
      }
      if (busy) return;
      sound.unlock();
      const hit = pick(e);
      if (!hit) return;
      if (hit.console) {
        play(selected);
      } else if (pointerType !== "mouse" && hit.index !== selected) {
        select(hit.index); // en pantallas táctiles el primer toque solo elige
      } else {
        play(hit.index);
      }
    });

    /* 7.5 Bucle de render -------------------------------------------------- */
    let visible = true;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
      }).observe(stage);
    }

    function resize() {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener("resize", resize);
    resize();

    const spotGoal = new THREE.Vector3();
    let last = performance.now();

    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible && !inserting) {
        last = now;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const time = now / 1000;
      stepTweens(now);

      carts.forEach((c, i) => {
        const target = i === selected && (!inserting || inserting === c) ? 1 : 0;
        c.glow += (target - c.glow) * Math.min(1, dt * 9);
        const g = c.glow;
        if (c !== inserting) {
          c.cart.position.set(0, CART.y + Math.sin(time * 1.7 + i) * 0.05 + g * 0.32, g * 0.6);
          c.cart.rotation.set(-0.1 - g * 0.08, Math.sin(time * 0.7 + i * 1.3) * 0.08 * (1 - g) + Math.sin(time * 1.8) * 0.16 * g, 0);
        }
        const pulse = 0.78 + Math.sin(time * 5) * 0.22;
        c.outlineMat.opacity = g * 0.85 * pulse;
        c.haloMat.opacity = g * 0.75;
        c.ringMat.opacity = 0.18 + g * 0.8 * pulse;
        c.beamMat.opacity = g * 0.13 * (inserting ? 0 : 1);
        c.bodyMat.emissiveIntensity = g * 0.28;
      });

      // Luz que acompaña al cartucho elegido
      const focus = carts[Math.max(selected, 0)];
      focus.cart.getWorldPosition(spotGoal);
      spotGoal.y += 0.9;
      spotGoal.z += 1.1;
      spot.position.lerp(spotGoal, Math.min(1, dt * 6));

      // Cámara: en pantallas estrechas sigue al cartucho elegido.
      const k = clamp((1.45 - camera.aspect) / 0.55, 0, 1);
      const sx = focus.anchor.position.x * k * 0.9;
      if (camOverride) {
        camGoal.pos.copy(camOverride.pos);
        camGoal.look.copy(camOverride.look);
      } else {
        camGoal.pos.set(sx, 3.5 + k * 1.2, 8.3 + k * 2.8);
        camGoal.look.set(sx, 0.95, -0.7);
      }
      const ease = 1 - Math.exp(-dt * (camOverride ? 3 : 4));
      camPos.lerp(camGoal.pos, ease);
      camLook.lerp(camGoal.look, ease);
      camera.position.copy(camPos);
      camera.lookAt(camLook);

      // Ambiente
      signMat.opacity = Math.random() < 0.015 ? 0.35 : 0.9;
      slotGlowMat.opacity *= 0.985;
      const arr = dustGeo.attributes.position.array;
      for (let i = 0; i < DUST; i++) {
        arr[i * 3 + 1] += dt * (0.12 + (i % 5) * 0.03);
        if (arr[i * 3 + 1] > 7) arr[i * 3 + 1] = 0;
      }
      dustGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    return { insert, reset };
  }

  /* 8. Eventos de la página ------------------------------------------------ */
  const plainClick = (e) => e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;

  spines.forEach((spine, i) => {
    spine.addEventListener("mouseenter", () => {
      if (!busy) select(i);
    });
    spine.addEventListener("focus", () => {
      if (!busy) select(i);
    });
    spine.addEventListener("click", (e) => {
      if (!plainClick(e)) return; // ctrl+clic o clic central: nueva pestaña, sin animación
      e.preventDefault();
      play(i);
    });
  });

  field("play").addEventListener("click", (e) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    play(selected);
  });

  soundBtn.addEventListener("click", () => {
    setSound(!sound.on);
    sound.unlock();
    sound.select();
  });

  document.addEventListener("keydown", (e) => {
    if (crtActive) {
      if (!["Shift", "Control", "Alt", "Meta"].includes(e.key)) launch();
      return;
    }
    if (busy || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return;
    const onSpine = spines.includes(active);

    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      sound.unlock();
      select(selected + (e.key === "ArrowRight" ? 1 : -1));
      if (onSpine) spines[selected].focus();
      e.preventDefault();
    } else if (e.key === "Enter" && (active === document.body || active === null)) {
      play(selected);
    }
  });

  crt.addEventListener("click", () => {
    if (crtActive) launch();
  });

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) resetAll();
  });

  /* 9. Arranque ------------------------------------------------------------ */
  setSound(sound.on);
  select(0, true);
  info.classList.remove("is-swapping");

  const fontReady = document.fonts && document.fonts.load
    ? Promise.race([document.fonts.load(PIXEL_FONT), wait(2500)]).catch(() => {})
    : Promise.resolve();

  fontReady.then(() => {
    fontsLoaded = true;
    drawCover();
    scene3d = initScene();
    if (scene3d) {
      stage.classList.add("is-ready");
    } else {
      stage.classList.add("is-fallback");
      bootText.textContent = "ESCENA 3D NO DISPONIBLE · ELIGE UN CARTUCHO DE LA LISTA";
    }
  });
})();
