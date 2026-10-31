/* ==========================================================================
   Cartuchos de la Pixelteca — Santiago Colmenares
   Catálogo de juegos y pixel art de las etiquetas (generado en canvas).
   Lo usan pixelteca.js (cartuchos 3D y carátula) y el inicio (franja de juegos).
   ========================================================================== */
window.Cartridges = (function () {
  "use strict";

  const pad = (n) => String(n).padStart(2, "0");

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

  return { GAMES, PIXEL_FONT, drawLabel, drawSign };
})();
