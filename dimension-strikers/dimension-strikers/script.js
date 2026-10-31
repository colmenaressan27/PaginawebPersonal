'use strict';
/* =============================================================================
   DIMENSION STRIKERS — Súper Torneo Dimensional
   script.js · JavaScript Vanilla (ES2020+) · HTML5 Canvas · Web Audio · Web Speech

   ARQUITECTURA (secciones numeradas):
   01. Configuración global, manifiesto de imágenes y utilidades
   02. Datos: roster de 10 personajes, porteros, uniformes, dificultad e historia
   03. Entrada: teclado + mandos (InputManager, PlayerInput)
   04. Audio: SynthEngine (efectos), MusicSynth (respaldo), Announcer (voz), SoundManager
   05. Arte procedural: AssetLoader (img/), SpriteFactory, PortraitFactory, balón
   06. Render 2.5D: proyección trapezoidal, Camera, ParticleSystem, estadio
   07. Entidades: Ball, Player, Goalkeeper
   08. Habilidades: golpes únicos, habilidades activas y trayectorias de Supertiro
   09. Inteligencia artificial: máquina de estados finitos (FSM)
   10. Partido: reglas, centros y cabezazos "?", barra de Supertiro, cut-in manga,
       celebraciones de gol y HUD
   11. Escenas de canvas: intro estilo Ronaldinho Soccer 64 y fondo de título
   12. Interfaz DOM: menús, selección de personajes, diálogos, pausa y resultados
   13. Game: arranque, máquina de estados global y bucle principal
   ============================================================================= */

/* =============================================================================
   01. CONFIGURACIÓN GLOBAL, MANIFIESTO DE IMÁGENES Y UTILIDADES
   ============================================================================= */

const CFG = Object.freeze({
  W: 640,               // resolución interna del canvas (se escala con píxeles nítidos)
  H: 360,
  FW: 1000,             // largo del campo en unidades de mundo (eje X)
  FH: 460,              // ancho del campo (eje Y = profundidad)
  FY0: 102,             // línea de fondo del campo en pantalla
  DEPTH: 0.5,           // compresión vertical (vista oblicua)
  PERSP_FAR: 0.84,      // escala horizontal en el fondo => trapecio
  ZS: 0.9,              // píxeles de pantalla por unidad de altura (eje Z)
  GOAL_HALF: 62,        // media boca de la portería
  GOAL_H: 56,           // altura del travesaño
  GOAL_D: 34,           // profundidad de la red
  BOX_X: 170,           // largo del área grande
  BOX_HALF: 150,
  SMALL_X: 62,          // área chica
  SMALL_HALF: 92,
  GRAVITY: 900,
  HEAD_Z: 40,           // altura a la que se cabecea
  STEP: 1 / 60,         // paso fijo de simulación
  SPR_W: 40,            // tamaño de cada cuadro de sprite
  SPR_H: 44,
  FOOT_X: 20,           // ancla (pies) dentro del cuadro
  FOOT_Y: 42,
  CAM_MIN: 250,
  CAM_MAX: 750,
});

/**
 * Manifiesto de imágenes opcionales en img/.
 * Si una entrada es null o no existe, el juego dibuja pixel art procedural.
 * Ejemplo: portraits: { samurai: 'img/portraits/samurai.png' }
 * (Ver img/LEEME.txt para el formato de las hojas de sprites).
 */
const ASSET_MANIFEST = {
  logo: null,
  portraits: {},
  sprites: {},
};

/* ---------- Utilidades matemáticas ---------- */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const distE = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Número aleatorio con distribución normal (Box-Muller). */
function gauss() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Utilidades de color ---------- */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const c = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Aclara (amt > 0) u oscurece (amt < 0) un color hexadecimal. */
function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = amt < 0 ? (c) => c * (1 + amt) : (c) => c + (255 - c) * amt;
  return rgbToHex(f(r), f(g), f(b));
}

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/* =============================================================================
   02. DATOS: ROSTER, PORTEROS, UNIFORMES, DIFICULTAD E HISTORIA
   ============================================================================= */

const STAT_LABELS = { vel: 'VEL', pot: 'POT', tec: 'TÉC', def: 'DEF', fis: 'FÍS' };

/**
 * Roster de 10 personajes. Cada uno tiene:
 *  - stats base (1-10): velocidad, potencia, técnica, defensa, físico
 *  - look: paleta y estilo para el pixel art procedural
 *  - unique: Golpe Único (botón U) · skill: Habilidad activa (O / U+I)
 *  - super: Supertiro con nombre propio, cooldown, trayectoria y efectos
 */
const ROSTER = [
  {
    id: 'samurai', name: 'Ryuga', full: 'Ryuga Kurogane', arch: 'Samurái', title: 'El Filo Errante',
    stats: { vel: 7, pot: 8, tec: 7, def: 6, fis: 6 },
    look: { art: 'samurai', skin: '#f2c48d', hair: '#1d1b2f', eye: '#e63946', accent: '#d62828', accent2: '#ffd166', metal: '#c9ced6' },
    unique: { name: 'Corte de Viento', desc: 'Embiste con el hombro y lanza una onda cortante.', cd: 2.2, range: 70 },
    skill: { name: 'Dash Frontal', desc: 'Acometida veloz e invulnerable hacia delante.', cd: 7, kind: 'evade' },
    super: { name: 'Tajo Imperial de Fuego', cd: 56, path: 'straight', fx: 'fire', colors: ['#ff3d00', '#ffb703', '#fff1a8'] },
    quote: 'Mi hoja corta el viento... y tu defensa.',
  },
  {
    id: 'ninja', name: 'Kage', full: 'Kage Shiranui', arch: 'Ninja', title: 'Sombra del Viento',
    stats: { vel: 9, pot: 5, tec: 9, def: 5, fis: 4 },
    look: { art: 'ninja', skin: '#e9b98a', hair: '#14142b', eye: '#ff4d6d', accent: '#2b2d42', accent2: '#e63946', metal: '#adb5bd' },
    unique: { name: 'Golpe de Humo', desc: 'Bomba de humo que aturde y roba el balón.', cd: 2.0, range: 34 },
    skill: { name: 'Teletransporte', desc: 'Desaparece y reaparece unos pasos adelante.', cd: 6.5, kind: 'evade' },
    super: { name: 'Shuriken Relámpago', cd: 52, path: 'zigzag', fx: 'lightning', colors: ['#7b2cbf', '#c77dff', '#f1f1ff'] },
    quote: 'No me verás venir. Nadie lo hace.',
  },
  {
    id: 'cyborg', name: 'Kai-07', full: 'Kai-07 «Volta»', arch: 'Cyborg', title: 'Unidad de Asalto',
    stats: { vel: 5, pot: 9, tec: 6, def: 8, fis: 9 },
    look: { art: 'cyborg', skin: '#f0c9a5', hair: '#d9dee5', eye: '#ff0054', accent: '#00b4d8', accent2: '#ff0054', metal: '#9aa5b1' },
    unique: { name: 'Empujón Electromagnético', desc: 'Pulso pesado que arrastra a los rivales.', cd: 2.6, range: 40 },
    skill: { name: 'Escudo de Energía', desc: 'Barrera temporal que anula golpes y barridas.', cd: 9, kind: 'defend' },
    super: { name: 'Cañón de Plasma Omega', cd: 60, path: 'beam', fx: 'plasma', colors: ['#00f5ff', '#00b4d8', '#e0fbff'] },
    quote: 'Probabilidad de victoria: 99,7 %. Redondeando: total.',
  },
  {
    id: 'monje', name: 'Lin', full: 'Lin Tianlong', arch: 'Monje Shaolin', title: 'Puño del Dragón',
    stats: { vel: 7, pot: 6, tec: 8, def: 7, fis: 6 },
    look: { art: 'monk', skin: '#e0ac69', hair: '#e0ac69', eye: '#6f4e37', accent: '#f77f00', accent2: '#ffba08', metal: '#8d5524' },
    unique: { name: 'Palma de Chi', desc: 'Palma de energía que lanza lejos al rival.', cd: 2.3, range: 30 },
    skill: { name: 'Salto Acrobático', desc: 'Mortal enorme que esquiva cualquier entrada.', cd: 7, kind: 'evade' },
    super: { name: 'Dragón Ascendente Dorado', cd: 58, path: 'dragon', fx: 'dragon', colors: ['#ffd60a', '#ff9e00', '#fff8cc'] },
    quote: 'El balón es agua. Fluye conmigo.',
  },
  {
    id: 'hechicero', name: 'Morvath', full: 'Morvath el Umbrío', arch: 'Hechicero Oscuro', title: 'Señor del Abismo',
    stats: { vel: 6, pot: 8, tec: 8, def: 5, fis: 5 },
    look: { art: 'sorcerer', skin: '#cdb7a0', hair: '#e6e1f0', eye: '#c77dff', accent: '#5a189a', accent2: '#240046', metal: '#9d4edd' },
    unique: { name: 'Explosión de Sombra', desc: 'Estallido oscuro a su alrededor que derriba.', cd: 2.5, range: 40 },
    skill: { name: 'Ralentización', desc: 'Aura que frena a los rivales cercanos.', cd: 9, kind: 'defend' },
    super: { name: 'Meteorito del Abismo', cd: 58, path: 'meteor', fx: 'abyss', colors: ['#9d4edd', '#3c096c', '#ff4dff'] },
    quote: 'Tu portería ya está sumida en tinieblas.',
  },
  {
    id: 'valquiria', name: 'Sigrún', full: 'Sigrún del Alba', arch: 'Valquiria', title: 'Lanza de Luz',
    stats: { vel: 8, pot: 7, tec: 7, def: 6, fis: 6 },
    look: { art: 'valkyrie', skin: '#f6d5b8', hair: '#ffe066', eye: '#4cc9f0', accent: '#e9f5ff', accent2: '#ffd166', metal: '#dfe7f0' },
    unique: { name: 'Embestida de Lanza', desc: 'Carga en línea recta con una lanza de luz.', cd: 2.4, range: 80 },
    skill: { name: 'Vuelo Rasante', desc: 'Planea sobre el césped, inmune a barridas.', cd: 8, kind: 'evade' },
    super: { name: 'Juicio de Valhala', cd: 56, path: 'curve', fx: 'holy', colors: ['#fff3b0', '#ffd166', '#ffffff'] },
    quote: 'Los dioses observan. No los decepcionaré.',
  },
  {
    id: 'golem', name: 'Gorath', full: 'Gorath Rompemontes', arch: 'Berserker / Golem', title: 'Muralla Viviente',
    stats: { vel: 4, pot: 10, tec: 4, def: 8, fis: 10 },
    look: { art: 'golem', skin: '#7d8597', hair: '#5c677d', eye: '#ffea00', accent: '#ff6d00', accent2: '#ffb703', metal: '#4a4e69' },
    unique: { name: 'Golpe Sísmico', desc: 'Martillazo al suelo que derriba en área.', cd: 3.0, range: 55 },
    skill: { name: 'Inmunidad', desc: 'Piel de roca: nadie puede derribarlo.', cd: 10, kind: 'defend' },
    super: { name: 'Impacto Tectónico', cd: 62, path: 'ground', fx: 'quake', colors: ['#ff6d00', '#9c6644', '#ffd166'] },
    quote: 'GORATH... ¡APLASTA!',
  },
  {
    id: 'velocista', name: 'Zap', full: 'Zap Ikazuchi', arch: 'Velocista Eléctrico', title: 'Rayo Humano',
    stats: { vel: 10, pot: 6, tec: 7, def: 4, fis: 4 },
    look: { art: 'speedster', skin: '#f1c27d', hair: '#ffee32', eye: '#00f5d4', accent: '#ffee32', accent2: '#00f5d4', metal: '#ffffff' },
    unique: { name: 'Placaje de Rayo', desc: 'Embestida en zigzag electrificada.', cd: 2.0, range: 70 },
    skill: { name: 'Sprint Supersónico', desc: 'Velocidad máxima durante unos segundos.', cd: 7, kind: 'evade' },
    super: { name: 'Cometa Voltio', cd: 50, path: 'comet', fx: 'volt', colors: ['#00f5d4', '#ffee32', '#ffffff'] },
    quote: '¿Ya empezó? ¡Porque yo ya terminé!',
  },
  {
    id: 'caballero', name: 'Aldric', full: 'Sir Aldric de Lumen', arch: 'Caballero Real', title: 'Escudo del Reino',
    stats: { vel: 5, pot: 7, tec: 6, def: 10, fis: 8 },
    look: { art: 'knight', skin: '#f3cfb3', hair: '#c9a227', eye: '#1d4ed8', accent: '#1d4ed8', accent2: '#ef233c', metal: '#e5e7eb' },
    unique: { name: 'Golpe de Escudo', desc: 'Embate contundente que deja aturdido.', cd: 2.4, range: 32 },
    skill: { name: 'Bloqueo Frontal', desc: 'Detiene tiros y golpes que vienen de frente.', cd: 8, kind: 'defend' },
    super: { name: 'Excalibur Radiante', cd: 58, path: 'sword', fx: 'radiant', colors: ['#fffbe6', '#ffd60a', '#8ecae6'] },
    quote: 'Por el honor del reino... ¡y del balón!',
  },
  {
    id: 'alquimista', name: 'Cinabria', full: 'Dra. Cinabria Vermell', arch: 'Alquimista / Artillera', title: 'Química Explosiva',
    stats: { vel: 6, pot: 7, tec: 9, def: 6, fis: 5 },
    look: { art: 'alchemist', skin: '#f6cfae', hair: '#ff4d6d', eye: '#80ed99', accent: '#9d0208', accent2: '#ffb703', metal: '#b08968' },
    unique: { name: 'Granada Alquímica', desc: 'Lanza un frasco que explota y empuja.', cd: 2.6, range: 110 },
    skill: { name: 'Cortina de Humo', desc: 'Nube espesa que frena y confunde.', cd: 9, kind: 'defend' },
    super: { name: 'Nova Carmesí', cd: 55, path: 'nova', fx: 'nova', colors: ['#ff0054', '#ff5400', '#ffd6e0'] },
    quote: 'Una pizca de azufre... ¡y BOOM, golazo!',
  },
];

const ROSTER_BY_ID = Object.fromEntries(ROSTER.map((d) => [d.id, d]));

/** Portero NPC estándar (no seleccionable). */
const GOALKEEPER_DEF = {
  id: 'portero', name: 'Portero', full: 'Portero', arch: 'Portero', title: 'Guardián',
  stats: { vel: 6, pot: 7, tec: 6, def: 7, fis: 8 },
  look: { art: 'keeper', skin: '#e8b98f', hair: '#3a2618', eye: '#2b2d42', accent: '#38b000', accent2: '#ccff33', metal: '#ffffff' },
  unique: null, skill: null, super: null,
};

/** Uniformes de equipo. ui = color en HUD. */
const KITS = {
  azul: { primary: '#2f6bff', secondary: '#eef2ff', trim: '#ffd23f', gk: '#21d07a', ui: '#2f80ff' },
  rojo: { primary: '#e8263f', secondary: '#1c1c28', trim: '#ffffff', gk: '#ffb703', ui: '#ff3b5c' },
  naranja: { primary: '#ff8c1a', secondary: '#2b1a0e', trim: '#fff3b0', gk: '#7b2cbf', ui: '#ff9a3c' },
  verde: { primary: '#16c172', secondary: '#0d2b1d', trim: '#e9ff70', gk: '#ff477e', ui: '#2ee88a' },
  carmesi: { primary: '#9b0f22', secondary: '#0e0e12', trim: '#ff4d6d', gk: '#00b4d8', ui: '#ff4d6d' },
  eclipse: { primary: '#5a189a', secondary: '#10002b', trim: '#e0aaff', gk: '#ffd23f', ui: '#c77dff' },
  dorado: { primary: '#e0a800', secondary: '#14110a', trim: '#ffffff', gk: '#ff006e', ui: '#ffd23f' },
};

/**
 * Parámetros de la IA por dificultad:
 * react = tiempo de reacción (s) · barSigma = error en la barra de Supertiro
 * aggression = probabilidad de golpear/barrer · headerSigma = error de timing en cabezazos
 * speedMul = multiplicador de velocidad · keeper = habilidad del portero
 */
const DIFFICULTY = {
  facil: { label: 'Fácil', react: 0.42, barSigma: 0.15, aggression: 0.22, headerSigma: 0.2, speedMul: 0.9, skillUse: 0.25, superUse: 0.45, passIQ: 0.45, dribble: 0.25, keeper: 0.42, shootRange: 0.85, participation: 0.55 },
  normal: { label: 'Normal', react: 0.28, barSigma: 0.085, aggression: 0.42, headerSigma: 0.12, speedMul: 0.98, skillUse: 0.45, superUse: 0.75, passIQ: 0.6, dribble: 0.45, keeper: 0.58, shootRange: 1, participation: 0.75 },
  dificil: { label: 'Difícil', react: 0.17, barSigma: 0.05, aggression: 0.55, headerSigma: 0.075, speedMul: 1.04, skillUse: 0.65, superUse: 0.9, passIQ: 0.75, dribble: 0.6, keeper: 0.7, shootRange: 1.05, participation: 0.9 },
  leyenda: { label: 'Leyenda', react: 0.1, barSigma: 0.028, aggression: 0.72, headerSigma: 0.045, speedMul: 1.1, skillUse: 0.85, superUse: 1, passIQ: 0.88, dribble: 0.75, keeper: 0.82, shootRange: 1.1, participation: 1 },
};

/** IA de los compañeros de un equipo humano (apoyan, marcan y presionan). */
const TEAMMATE_AI = { label: 'Compañero', react: 0.22, barSigma: 0.08, aggression: 0.42, headerSigma: 0.1, speedMul: 1, skillUse: 0.3, superUse: 0, passIQ: 0.6, dribble: 0.4, keeper: 0.62, shootRange: 1, participation: 0 };

const CELEBRATIONS = [
  'Pose Escuadrón Sentai',
  'Salto Sincronizado',
  'Baile Retro en Fila',
  'Reverencia al Goleador',
  'Deslizamiento de Rodillas',
];

/** Modo Historia: 5 rivales con dificultad creciente y diálogos estilo novela visual. */
const STORY = [
  {
    team: 'Gatos del Callejón', short: 'GAT', kit: 'naranja', diff: 'facil', captain: 'velocista',
    roster: ['velocista', 'ninja', 'alquimista', 'monje'], stage: 'Cancha del Barrio Neón',
    sky: ['#120a2e', '#ff4f9a'],
    lines: [
      ['rival', '¡Eh, novatos! Este callejón es nuestro territorio. Aquí se juega rápido... ¡y sucio!'],
      ['hero', 'El Súper Torneo Dimensional empieza aquí. No pensamos frenarnos.'],
      ['rival', '¡Ja! Entonces intenten seguirme el ritmo. ¡Zzzap!'],
      ['hero', '¡Equipo, a la cancha! ¡Primer paso hacia la copa!'],
    ],
  },
  {
    team: 'Academia Tormenta', short: 'TOR', kit: 'verde', diff: 'normal', captain: 'valquiria',
    roster: ['valquiria', 'caballero', 'samurai', 'velocista'], stage: 'Coliseo de las Nubes',
    sky: ['#0b2545', '#8ecae6'],
    lines: [
      ['rival', 'Así que derrotaron a los Gatos. La Academia Tormenta no es un callejón cualquiera.'],
      ['hero', 'Disciplina contra corazón. ¡Veamos quién gana!'],
      ['rival', 'Valhala me observa. Mi lanza no conoce la derrota.'],
      ['hero', 'Entonces hoy la conocerá. ¡Vamos!'],
    ],
  },
  {
    team: 'Legión Carmesí', short: 'LEG', kit: 'carmesi', diff: 'dificil', captain: 'cyborg',
    roster: ['golem', 'cyborg', 'alquimista', 'hechicero'], stage: 'Fundición Carmesí',
    sky: ['#1a0505', '#ff5400'],
    lines: [
      ['rival', 'Análisis completo. Su equipo tiene un 3 % de probabilidades de victoria.'],
      ['hero', '¿Y el otro 97 %? Lo llenamos con agallas.'],
      ['rival', 'Legión, activen el modo aniquilación. Gorath: aplástalos.'],
      ['hero', '¡Que vengan! ¡Nuestra técnica es más fuerte que su acero!'],
    ],
  },
  {
    team: 'Orden del Eclipse', short: 'ECL', kit: 'eclipse', diff: 'dificil', captain: 'hechicero',
    roster: ['hechicero', 'ninja', 'samurai', 'valquiria'], stage: 'Templo del Eclipse',
    sky: ['#05010f', '#7b2cbf'],
    lines: [
      ['rival', 'Han llegado lejos... demasiado lejos. El eclipse devora toda luz.'],
      ['hero', 'Hay una luz que no se apaga: la de un equipo que no se rinde.'],
      ['rival', 'Palabras bonitas. Mi Meteorito del Abismo las convertirá en polvo.'],
      ['hero', '¡Semifinal! ¡Todo o nada!'],
    ],
  },
  {
    team: 'Los Dimensionales', short: 'DIM', kit: 'dorado', diff: 'leyenda', captain: 'monje',
    roster: ['cyborg', 'golem', 'monje', 'caballero'], stage: 'Arena del Fin de las Dimensiones',
    sky: ['#000000', '#ffd23f'],
    lines: [
      ['rival', 'Bienvenidos a la gran final. Aquí el tiempo y el espacio se doblan ante el balón.'],
      ['hero', 'Hemos venido a doblarlos un poco más.'],
      ['rival', 'Somos campeones de mil mundos. Muéstrenme su Supertiro más fuerte.'],
      ['hero', 'Prepárense... ¡este es el partido de nuestras vidas!'],
    ],
  },
];

const STORY_ENDING = [
  ['rival', 'Increíble... han superado a Los Dimensionales. La copa es suya.'],
  ['hero', '¡Lo logramos! ¡Somos los campeones del Súper Torneo Dimensional!'],
];

/* =============================================================================
   03. ENTRADA: TECLADO + MANDOS
   ============================================================================= */

/** Mapa de teclas por jugador (KeyboardEvent.code). */
const KEYMAP = [
  {
    up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
    pass: ['KeyJ'], shoot: ['KeyK'], cross: ['KeyL'], attack: ['KeyU'], jump: ['KeyI'], skill: ['KeyO'],
  },
  {
    up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'],
    pass: ['Numpad1', 'Digit1'], shoot: ['Numpad2', 'Digit2'], cross: ['Numpad3', 'Digit3'],
    attack: ['Numpad4', 'Digit4'], jump: ['Numpad5', 'Digit5'], skill: ['Numpad6', 'Digit6'],
  },
];

/** Mapa estándar de mando (Gamepad API). */
const PAD_MAP = {
  up: [12], down: [13], left: [14], right: [15],
  pass: [0], shoot: [1], cross: [2], attack: [3], jump: [5], skill: [4, 7], pause: [9],
};

const MENU_KEYS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  confirm: ['Enter', 'NumpadEnter', 'Space', 'KeyJ', 'Numpad1'],
  back: ['Escape', 'Backspace'],
};

const PREVENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'NumpadEnter', 'Backspace', 'Tab']);

class InputManager {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.pads = [this.emptyPad(), this.emptyPad()];
    this.anyPressed = false;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.down.clear());
  }

  emptyPad() {
    return { connected: false, axes: [0, 0], btn: new Array(18).fill(false), prev: new Array(18).fill(false) };
  }

  onKeyDown(e) {
    if (PREVENT_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.down.add(e.code);
    this.pressed.add(e.code);
    this.anyPressed = true;
  }

  onKeyUp(e) {
    this.down.delete(e.code);
    this.released.add(e.code);
  }

  /** Lee los mandos conectados (se llama una vez por frame). */
  poll() {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < 2; i++) {
      const gp = list && list[i];
      const pad = this.pads[i];
      if (!gp) {
        pad.connected = false;
        continue;
      }
      pad.connected = true;
      pad.axes[0] = gp.axes[0] || 0;
      pad.axes[1] = gp.axes[1] || 0;
      for (let b = 0; b < pad.btn.length; b++) {
        const btn = gp.buttons[b];
        const v = !!(btn && (btn.pressed || btn.value > 0.5));
        if (v && !pad.btn[b]) this.anyPressed = true;
        pad.btn[b] = v;
      }
    }
  }

  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  wasReleased(code) { return this.released.has(code); }
  padDown(i, b) { const p = this.pads[i]; return p.connected && p.btn[b]; }
  padPressed(i, b) { const p = this.pads[i]; return p.connected && p.btn[b] && !p.prev[b]; }
  padReleased(i, b) { const p = this.pads[i]; return p.connected && !p.btn[b] && p.prev[b]; }

  /** Consulta genérica de menús (cualquier jugador). */
  menu(action) {
    if (MENU_KEYS[action].some((c) => this.pressed.has(c))) return true;
    const padBtn = { up: 12, down: 13, left: 14, right: 15, confirm: 0, back: 1 }[action];
    return this.padPressed(0, padBtn) || this.padPressed(1, padBtn);
  }

  /** Se llama tras cada paso fijo de simulación para limpiar los eventos de un solo frame. */
  endStep() {
    this.pressed.clear();
    this.released.clear();
    this.anyPressed = false;
    for (const p of this.pads) p.prev = p.btn.slice();
  }
}

/** Vista de la entrada para un jugador concreto (teclado + mando del mismo índice). */
class PlayerInput {
  constructor(input, index) {
    this.in = input;
    this.i = index;
    this.map = KEYMAP[index];
  }

  down(a) {
    return (this.map[a] || []).some((c) => this.in.isDown(c)) || (PAD_MAP[a] || []).some((b) => this.in.padDown(this.i, b));
  }

  pressed(a) {
    return (this.map[a] || []).some((c) => this.in.wasPressed(c)) || (PAD_MAP[a] || []).some((b) => this.in.padPressed(this.i, b));
  }

  released(a) {
    return (this.map[a] || []).some((c) => this.in.wasReleased(c)) || (PAD_MAP[a] || []).some((b) => this.in.padReleased(this.i, b));
  }

  axis() {
    let x = 0;
    let y = 0;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    if (this.down('up')) y -= 1;
    if (this.down('down')) y += 1;
    const pad = this.in.pads[this.i];
    if (pad.connected) {
      if (Math.abs(pad.axes[0]) > 0.25) x += pad.axes[0];
      if (Math.abs(pad.axes[1]) > 0.25) y += pad.axes[1];
    }
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y };
  }

  /** Habilidad activa: tecla dedicada o combinación Golpe + Salto. */
  skillPressed() {
    return this.pressed('skill') ||
      (this.pressed('attack') && this.down('jump')) ||
      (this.pressed('jump') && this.down('attack'));
  }

  comboHeld() {
    return this.down('attack') && this.down('jump');
  }
}

/* =============================================================================
   04. AUDIO: EFECTOS (Web Audio), MÚSICA DE RESPALDO, LOCUTOR Y SOUNDMANAGER
   ============================================================================= */

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/** Motor de síntesis retro con Web Audio API (efectos de sonido). */
class SynthEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuf = null;
    this.chargeNodes = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.6;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.5;
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // Búfer de ruido blanco reutilizable
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  get ok() { return !!this.ctx; }

  setMuted(m) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.03);
  }

  /** Oscilador con envolvente. */
  tone({ type = 'square', f = 440, f2 = null, dur = 0.1, vol = 0.25, attack = 0.004, delay = 0, bus = null, detune = 0 }) {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    osc.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(bus || this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    return osc;
  }

  /** Ruido filtrado con envolvente. */
  noise({ dur = 0.2, vol = 0.3, type = 'lowpass', f = 1200, f2 = null, q = 1, delay = 0, attack = 0.003, bus = null }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(f, t);
    if (f2) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(bus || this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** Biblioteca de efectos retro. */
  play(name, o = {}) {
    if (!this.ctx) return;
    const v = o.vol ?? 1;
    switch (name) {
      case 'kick':
        this.noise({ dur: 0.08, vol: 0.45 * v, f: 1400, f2: 200 });
        this.tone({ type: 'sine', f: 170, f2: 55, dur: 0.12, vol: 0.5 * v });
        break;
      case 'pass':
        this.tone({ type: 'triangle', f: 320, f2: 170, dur: 0.08, vol: 0.28 * v });
        this.noise({ dur: 0.05, vol: 0.12 * v, type: 'bandpass', f: 1800 });
        break;
      case 'shot':
        this.play('kick', { vol: 1.2 });
        this.noise({ dur: 0.22, vol: 0.22 * v, type: 'highpass', f: 2500, f2: 6000 });
        break;
      case 'header':
        this.tone({ type: 'sine', f: 240, f2: 110, dur: 0.12, vol: 0.45 * v });
        this.noise({ dur: 0.06, vol: 0.2 * v, f: 700 });
        break;
      case 'whistle':
        this.tone({ type: 'sine', f: 2150, dur: 0.28, vol: 0.16 * v, attack: 0.01 });
        this.tone({ type: 'sine', f: 2210, dur: 0.28, vol: 0.12 * v, attack: 0.01 });
        break;
      case 'whistleEnd':
        [0, 0.32, 0.64].forEach((d, i) => {
          const dur = i === 2 ? 0.8 : 0.22;
          this.tone({ type: 'sine', f: 2150, dur, vol: 0.16, attack: 0.01, delay: d });
          this.tone({ type: 'sine', f: 2210, dur, vol: 0.12, attack: 0.01, delay: d });
        });
        break;
      case 'hit':
        this.noise({ dur: 0.14, vol: 0.5 * v, f: 2400, f2: 260 });
        this.tone({ type: 'square', f: 190, f2: 60, dur: 0.13, vol: 0.2 * v });
        break;
      case 'heavy':
        this.noise({ dur: 0.38, vol: 0.7 * v, f: 900, f2: 70 });
        this.tone({ type: 'sine', f: 95, f2: 28, dur: 0.42, vol: 0.6 * v });
        break;
      case 'slide':
        this.noise({ dur: 0.32, vol: 0.25 * v, type: 'bandpass', f: 900, f2: 380, q: 1.5 });
        break;
      case 'jump':
        this.tone({ type: 'square', f: 260, f2: 560, dur: 0.12, vol: 0.1 * v });
        break;
      case 'dribble':
        this.tone({ type: 'triangle', f: 520, f2: 980, dur: 0.09, vol: 0.16 * v });
        this.noise({ dur: 0.1, vol: 0.12 * v, type: 'bandpass', f: 3000 });
        break;
      case 'explosion':
        this.noise({ dur: 1.0, vol: 0.75 * v, f: 3200, f2: 60 });
        this.tone({ type: 'sine', f: 75, f2: 24, dur: 0.9, vol: 0.6 * v });
        break;
      case 'zoneHit':
        this.tone({ type: 'square', f: 880, dur: 0.08, vol: 0.18 });
        this.tone({ type: 'square', f: 1320, dur: 0.12, vol: 0.18, delay: 0.06 });
        break;
      case 'zonePerfect':
        [880, 1175, 1760].forEach((f, i) => this.tone({ type: 'triangle', f, dur: 0.14, vol: 0.22, delay: i * 0.05 }));
        break;
      case 'zoneMiss':
        this.tone({ type: 'sawtooth', f: 190, f2: 80, dur: 0.28, vol: 0.18 });
        break;
      case 'whoosh':
        this.noise({ dur: 0.38, vol: 0.35 * v, type: 'bandpass', f: 400, f2: 4500, q: 2 });
        break;
      case 'cutin':
        this.play('whoosh');
        this.tone({ type: 'triangle', f: 2600, f2: 1700, dur: 0.45, vol: 0.14, delay: 0.08 });
        this.noise({ dur: 0.35, vol: 0.12, type: 'highpass', f: 6000, delay: 0.08 });
        break;
      case 'goal':
        [233, 294, 349, 466].forEach((f) => this.tone({ type: 'sawtooth', f, dur: 1.4, vol: 0.07, attack: 0.05 }));
        this.noise({ dur: 2.8, vol: 0.32, type: 'bandpass', f: 1100, q: 0.6, attack: 0.25 });
        break;
      case 'crowd':
        this.noise({ dur: 1.8, vol: 0.18 * v, type: 'bandpass', f: 900, q: 0.7, attack: 0.3 });
        break;
      case 'move':
        this.tone({ type: 'square', f: 440, dur: 0.035, vol: 0.07 });
        break;
      case 'select':
        this.tone({ type: 'square', f: 660, dur: 0.06, vol: 0.12 });
        break;
      case 'confirm':
        this.tone({ type: 'square', f: 660, dur: 0.07, vol: 0.13 });
        this.tone({ type: 'square', f: 990, dur: 0.12, vol: 0.13, delay: 0.07 });
        break;
      case 'back':
        this.tone({ type: 'square', f: 440, f2: 220, dur: 0.12, vol: 0.12 });
        break;
      case 'teleport':
        this.tone({ type: 'sine', f: 1300, f2: 180, dur: 0.22, vol: 0.2 });
        this.noise({ dur: 0.12, vol: 0.15, type: 'highpass', f: 4000 });
        break;
      case 'shield':
        this.tone({ type: 'triangle', f: 300, f2: 900, dur: 0.3, vol: 0.18 });
        this.tone({ type: 'sine', f: 620, dur: 0.45, vol: 0.08, delay: 0.05 });
        break;
      case 'zap':
        this.tone({ type: 'sawtooth', f: 1600, f2: 260, dur: 0.16, vol: 0.14 });
        this.noise({ dur: 0.12, vol: 0.14, type: 'highpass', f: 3000 });
        break;
      case 'magic':
        this.tone({ type: 'sine', f: 380, f2: 1600, dur: 0.42, vol: 0.14 });
        this.tone({ type: 'triangle', f: 820, f2: 200, dur: 0.32, vol: 0.1 });
        break;
      case 'slash':
        this.noise({ dur: 0.14, vol: 0.35, type: 'highpass', f: 2800, f2: 7000 });
        this.tone({ type: 'triangle', f: 1500, f2: 600, dur: 0.12, vol: 0.1 });
        break;
      case 'poof':
        this.noise({ dur: 0.35, vol: 0.3, f: 1800, f2: 300 });
        break;
      case 'bounce':
        this.tone({ type: 'sine', f: 300, f2: 150, dur: 0.06, vol: 0.12 * v });
        break;
      case 'post':
        this.tone({ type: 'triangle', f: 1250, dur: 0.35, vol: 0.28 });
        this.tone({ type: 'triangle', f: 1870, dur: 0.25, vol: 0.18 });
        break;
      case 'save':
        this.noise({ dur: 0.12, vol: 0.45, f: 1400 });
        this.tone({ type: 'sine', f: 210, f2: 100, dur: 0.12, vol: 0.35 });
        break;
      case 'type':
        this.tone({ type: 'square', f: 1100 + Math.random() * 200, dur: 0.02, vol: 0.035 });
        break;
      case 'countdown':
        this.tone({ type: 'square', f: 523, dur: 0.14, vol: 0.18 });
        break;
      case 'go':
        this.tone({ type: 'square', f: 1046, dur: 0.35, vol: 0.22 });
        break;
      case 'thunder':
        this.noise({ dur: 0.7, vol: 0.5, f: 5000, f2: 160 });
        this.tone({ type: 'sawtooth', f: 62, dur: 0.5, vol: 0.18 });
        break;
      case 'superLaunch':
        this.play('explosion', { vol: 0.8 });
        this.tone({ type: 'sawtooth', f: 90, f2: 1800, dur: 0.5, vol: 0.18 });
        break;
      case 'title':
        this.play('explosion', { vol: 0.9 });
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ type: 'square', f, dur: 0.18, vol: 0.12, delay: 0.1 + i * 0.07 }));
        break;
      default:
        break;
    }
  }

  /** Zumbido creciente mientras se carga un Supertiro. */
  startCharge() {
    if (!this.ctx || this.chargeNodes) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 1.3);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 18;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.05;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1, t + 0.15);
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 2400;
    osc.connect(filt);
    filt.connect(g);
    g.connect(this.sfxBus);
    osc.start(t);
    lfo.start(t);
    this.chargeNodes = { osc, lfo, g };
  }

  stopCharge() {
    if (!this.chargeNodes) return;
    const { osc, lfo, g } = this.chargeNodes;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.stop(t + 0.15);
    lfo.stop(t + 0.15);
    this.chargeNodes = null;
  }
}

/**
 * Secuenciador de respaldo: si los MP3 no existen o fallan, se generan en vivo
 * versiones chiptune de las dos pistas (Eurobeat 150 BPM y Funk 120 BPM).
 */
const SONGS = {
  eurobeat: {
    bpm: 150,
    roots: [45, 41, 43, 45, 45, 41, 43, 40], // La, Fa, Sol, La, La, Fa, Sol, Mi
    melody: [
      76, 76, 74, 76, 79, 76, 74, 72,
      72, 74, 72, 69, 72, null, 69, 72,
      74, 74, 72, 74, 79, 81, 79, 74,
      76, null, 74, 72, 71, 72, 74, 76,
      81, 79, 76, 79, 81, 79, 76, 74,
      77, 76, 74, 72, 74, null, 72, 69,
      71, 74, 79, 74, 71, 74, 79, 83,
      80, null, 76, null, 74, null, 71, null,
    ],
    step(m, s, t, spb) {
      const bar = Math.floor(s / 16) % 8;
      const i = s % 16;
      const root = this.roots[bar];
      if (i % 4 === 0) m.kick(t, 0.9);
      if (i === 4 || i === 12) m.snare(t, 0.55);
      if (i % 4 === 2) m.hat(t, true, 0.09);
      else m.hat(t, false, 0.05);
      if (i % 2 === 0) m.bass(t, root + ((i / 2) % 2 ? 12 : 0), spb * 1.7, 0.22);
      if (i % 2 === 0) {
        const note = this.melody[bar * 8 + i / 2];
        if (note) m.lead(t, note, spb * 1.9, 0.07);
      }
      if (i === 0) m.pad(t, [root + 24, root + 27 + (bar === 7 ? 1 : 0), root + 31], spb * 15, 0.025);
    },
  },
  funk: {
    bpm: 120,
    roots: [40, 40, 45, 47],
    riff: [0, null, 12, null, null, 0, null, 3, null, 5, null, 7, 10, null, 7, 5],
    lick: [71, null, 74, 76, null, 79, null, 76, 74, null, 71, null, 69, 71, null, null],
    step(m, s, t, spb) {
      const bar = Math.floor(s / 16) % 4;
      const i = s % 16;
      const root = this.roots[bar];
      if ([0, 3, 8, 10].includes(i)) m.kick(t, i === 10 ? 0.6 : 0.85);
      if (i === 4 || i === 12) { m.snare(t, 0.5); m.clap(t, 0.25); }
      if (i === 7 || i === 15) m.snare(t, 0.12);
      m.hat(t, i === 14, i % 2 ? 0.07 : 0.04);
      const r = this.riff[i];
      if (r !== null) m.bass(t, root + r, spb * 0.85, 0.26, 'square');
      if ([2, 6, 11].includes(i)) {
        const q = bar === 2 ? [0, 4, 7, 10] : [0, 3, 7, 10];
        m.stab(t, q.map((x) => root + 24 + x), spb * 0.7, 0.03);
      }
      if (bar % 2 === 1) {
        const n = this.lick[i];
        if (n) m.lead(t, n + (bar === 3 ? 2 : 0), spb * 1.6, 0.05);
      }
    },
  },
};

class MusicSynth {
  constructor(engine) {
    this.e = engine;
    this.song = null;
    this.timer = null;
    this.out = null;
  }

  get playing() { return !!this.timer; }

  play(id) {
    const ctx = this.e.ctx;
    if (!ctx) return;
    this.stop(0.2);
    this.song = SONGS[id];
    this.id = id;
    this.stepN = 0;
    this.next = ctx.currentTime + 0.08;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.8);
    this.out.connect(this.e.musicBus);
    this.timer = setInterval(() => this.tick(), 25);
  }

  stop(fade = 0.5) {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    const ctx = this.e.ctx;
    const out = this.out;
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
    out.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + fade);
    setTimeout(() => out.disconnect(), (fade + 0.3) * 1000);
  }

  tick() {
    const ctx = this.e.ctx;
    const spb = 60 / this.song.bpm / 4;
    while (this.next < ctx.currentTime + 0.12) {
      this.song.step(this, this.stepN, this.next, spb);
      this.stepN++;
      this.next += spb;
    }
  }

  env(g, t, vol, dur, attack = 0.005) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  osc(type, f, t, dur, vol, filterF = null, detune = 0) {
    const ctx = this.e.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const g = ctx.createGain();
    this.env(g, t, vol, dur);
    if (filterF) {
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(filterF, t);
      fl.frequency.exponentialRampToValueAtTime(Math.max(200, filterF * 0.35), t + dur);
      o.connect(fl);
      fl.connect(g);
    } else {
      o.connect(g);
    }
    g.connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noiseHit(t, dur, vol, type, f) {
    const ctx = this.e.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.e.noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, vol, dur, 0.002);
    src.connect(fl);
    fl.connect(g);
    g.connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  kick(t, v) {
    const ctx = this.e.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    this.env(g, t, v * 0.9, 0.24);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.26);
  }

  snare(t, v) {
    this.noiseHit(t, 0.15, v * 0.5, 'highpass', 1300);
    this.osc('triangle', 190, t, 0.08, v * 0.35);
  }

  clap(t, v) { this.noiseHit(t, 0.1, v, 'bandpass', 1500); }
  hat(t, open, v) { this.noiseHit(t, open ? 0.16 : 0.04, v, 'highpass', 7200); }
  bass(t, m, dur, v, type = 'sawtooth') { this.osc(type, midiHz(m), t, dur, v, 900); }

  lead(t, m, dur, v) {
    this.osc('sawtooth', midiHz(m), t, dur, v, 3600, -9);
    this.osc('sawtooth', midiHz(m), t, dur, v, 3600, 9);
    this.osc('square', midiHz(m + 12), t, dur * 0.6, v * 0.35, 2400);
  }

  stab(t, ms, dur, v) { ms.forEach((m) => this.osc('square', midiHz(m), t, dur, v, 2200)); }
  pad(t, ms, dur, v) { ms.forEach((m) => this.osc('sawtooth', midiHz(m), t, dur, v, 1400, 6)); }
}

/** Locutor con Web Speech API (tono de doblaje anime). */
class Announcer {
  constructor() {
    this.ok = typeof window.speechSynthesis !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined';
    this.voice = null;
    if (this.ok) {
      this.pickVoice();
      if (typeof speechSynthesis.addEventListener === 'function') {
        speechSynthesis.addEventListener('voiceschanged', () => this.pickVoice());
      }
    }
  }

  pickVoice() {
    const voices = speechSynthesis.getVoices() || [];
    const norm = (l) => (l || '').replace('_', '-').toLowerCase();
    const prefs = ['es-mx', 'es-us', 'es-419', 'es-co', 'es-ar', 'es-es'];
    for (const p of prefs) {
      const v = voices.find((x) => norm(x.lang).startsWith(p));
      if (v) {
        this.voice = v;
        return;
      }
    }
    this.voice = voices.find((x) => norm(x.lang).startsWith('es')) || null;
  }

  say(text, preset = 'hype') {
    if (!this.ok) return;
    const presets = {
      epic: { pitch: 0.55, rate: 0.86 },
      goal: { pitch: 1.2, rate: 0.8 },
      super: { pitch: 1.6, rate: 1.15 },
      hype: { pitch: 1.3, rate: 1.08 },
      calm: { pitch: 1, rate: 1 },
    };
    const P = presets[preset] || presets.hype;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice ? this.voice.lang : 'es-MX';
      if (this.voice) u.voice = this.voice;
      u.pitch = P.pitch;
      u.rate = P.rate;
      u.volume = 1;
      speechSynthesis.speak(u);
    } catch (err) {
      /* La voz es opcional: si falla, el juego continúa en silencio. */
    }
  }

  cancel() {
    if (this.ok) speechSynthesis.cancel();
  }
}

/**
 * SoundManager: gestiona las 2 pistas musicales externas (<audio> con loop),
 * los fundidos entre pantallas, el respaldo sintetizado y los efectos.
 *  - Pista 1 'match'  -> audio/bgm_match_eurobeat.mp3 (intro, menú, partido, Supertiros)
 *  - Pista 2 'select' -> audio/bgm_select_funk.mp3   (configuración, selección, diálogos)
 */
class SoundManager {
  constructor() {
    this.synth = new SynthEngine();
    this.music = new MusicSynth(this.synth);
    this.voice = new Announcer();
    this.tracks = {
      match: { el: document.getElementById('bgm-match'), fallback: 'eurobeat', failed: false, vol: 0, target: 0 },
      select: { el: document.getElementById('bgm-select'), fallback: 'funk', failed: false, vol: 0, target: 0 },
    };
    this.levels = { menu: 0.6, match: 0.85, super: 1, pause: 0.25, results: 0.6 };
    this.level = 0.6;
    this.levelSmooth = 0.6;
    this.current = null;
    this.muted = false;
    this.pending = null;
    for (const key of Object.keys(this.tracks)) {
      const tr = this.tracks[key];
      if (!tr.el) {
        tr.failed = true;
        continue;
      }
      tr.el.loop = true;
      tr.el.volume = 0;
      tr.el.addEventListener('error', () => this.fail(key));
    }
  }

  /** Debe llamarse dentro de un gesto del usuario (clic / tecla). */
  unlock() {
    this.synth.init();
    if (this.pending) {
      const k = this.pending;
      this.pending = null;
      this.current = null;
      this.playMusic(k);
    }
  }

  fail(key) {
    const tr = this.tracks[key];
    if (tr.failed) return;
    tr.failed = true;
    console.warn(`[Audio] No se pudo cargar "${tr.el ? tr.el.getAttribute('src') : key}". Se usa el sintetizador de respaldo.`);
    if (this.current === key) this.music.play(tr.fallback);
  }

  playMusic(key) {
    if (this.current === key) return;
    const prev = this.current;
    this.current = key;
    if (prev) {
      const p = this.tracks[prev];
      p.target = 0;
      if (p.failed) this.music.stop(0.6);
    }
    const tr = this.tracks[key];
    if (tr.failed) {
      this.music.play(tr.fallback);
      return;
    }
    tr.target = 1;
    if (key === 'select') {
      try { tr.el.currentTime = 0; } catch (err) { /* aún sin metadatos */ }
    }
    const pr = tr.el.play();
    if (pr && typeof pr.catch === 'function') {
      pr.catch((err) => {
        if (err && err.name === 'NotAllowedError') {
          this.pending = key;
        } else if (err && err.name === 'NotSupportedError') {
          this.fail(key);
        }
      });
    }
  }

  setLevel(name) {
    this.level = this.levels[name] ?? 0.6;
  }

  update(dt) {
    this.levelSmooth = approach(this.levelSmooth, this.level, dt * 1.5);
    for (const key of Object.keys(this.tracks)) {
      const tr = this.tracks[key];
      if (!tr.el || tr.failed) continue;
      tr.vol = approach(tr.vol, tr.target, dt * (tr.target > tr.vol ? 1.2 : 1.6));
      tr.el.volume = clamp(this.muted ? 0 : tr.vol * this.levelSmooth, 0, 1);
      if (tr.vol <= 0.001 && tr.target === 0 && !tr.el.paused) tr.el.pause();
    }
    if (this.synth.ok) this.synth.musicBus.gain.value = this.muted ? 0 : 0.55 * this.levelSmooth;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.synth.setMuted(this.muted);
    if (this.muted) this.voice.cancel();
    return this.muted;
  }

  sfx(name, o) {
    if (!this.muted) this.synth.play(name, o);
  }

  startCharge() { if (!this.muted) this.synth.startCharge(); }
  stopCharge() { this.synth.stopCharge(); }

  say(text, preset) {
    if (!this.muted) this.voice.say(text, preset);
  }
}

/* =============================================================================
   05. ARTE PROCEDURAL: CARGADOR DE IMÁGENES, SPRITES, RETRATOS Y BALÓN
   ============================================================================= */

/** Poses disponibles en las hojas de sprites (orden usado también por img/sprites). */
const SPRITE_POSES = [
  'idle0', 'idle1', 'run0', 'run1', 'run2', 'run3', 'kick', 'slide', 'jump', 'header',
  'down', 'dizzy', 'attack', 'charge', 'cheer', 'sentai0', 'sentai1', 'sentai2', 'sentai3',
  'dance0', 'dance1', 'bow', 'kneel', 'kneeslide', 'sad', 'dive', 'catch', 'hold',
];

/** Carga las imágenes declaradas en ASSET_MANIFEST (si no hay, se usa arte procedural). */
class AssetLoader {
  constructor() {
    this.images = { logo: null, portraits: {}, sprites: {} };
  }

  loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        console.warn(`[img] No se encontró ${src}; se usa el placeholder procedural.`);
        resolve(null);
      };
      img.src = src;
    });
  }

  async load() {
    const jobs = [];
    if (ASSET_MANIFEST.logo) jobs.push(this.loadImage(ASSET_MANIFEST.logo).then((i) => { this.images.logo = i; }));
    for (const [id, src] of Object.entries(ASSET_MANIFEST.portraits)) {
      if (src) jobs.push(this.loadImage(src).then((i) => { if (i) this.images.portraits[id] = i; }));
    }
    for (const [id, src] of Object.entries(ASSET_MANIFEST.sprites)) {
      if (src) jobs.push(this.loadImage(src).then((i) => { if (i) this.images.sprites[id] = i; }));
    }
    await Promise.all(jobs);
  }
}

/**
 * Convierte un dibujo vectorial pequeño en pixel art nítido:
 * umbraliza el alfa (sin antialias) y añade un contorno oscuro de 1 px.
 */
function crispify(canvas, outline = '#120a1c') {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
  if (outline) {
    const o = hexToRgb(outline);
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3]) continue;
        const n = (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 7]) ||
          (y > 0 && src[i - w * 4 + 3]) || (y < h - 1 && src[i + w * 4 + 3]);
        if (n) {
          d[i] = o.r;
          d[i + 1] = o.g;
          d[i + 2] = o.b;
          d[i + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

/* ---------- Esqueleto de poses (vista lateral mirando a la derecha) ---------- */
function baseJoints() {
  return {
    hip: [20, 30], neck: [21, 21], head: [21, 15],
    bk: [19, 36], bf: [18, 42], fk: [22, 36], ff: [23, 42],
    be: [19, 26], bh: [18, 30], fe: [23, 26], fh: [24, 30],
  };
}

function poseJoints(pose) {
  const J = baseJoints();
  const set = (o) => Object.assign(J, o);
  switch (pose) {
    case 'idle1':
      set({ hip: [20, 30.5], neck: [21, 22], head: [21, 16], be: [19, 27], bh: [18, 31], fe: [23, 27], fh: [24, 31] });
      break;
    case 'run0': case 'run1': case 'run2': case 'run3': {
      const k = Number(pose[3]);
      const ph = (k * Math.PI) / 2;
      const bob = k % 2 ? -1 : 0;
      const hip = [20, 30 + bob];
      const leg = (a) => {
        const lift = Math.sin(a) > 0 ? 4 * Math.sin(a) : 0;
        return { k: [hip[0] + 3 * Math.cos(a) + 1.5, 36 + bob * 0.5 - lift * 0.6], f: [hip[0] + 6 * Math.cos(a), 42 - lift] };
      };
      const arm = (a) => ({ e: [23 - 3 * Math.cos(a), 26 + bob], h: [23 - 6 * Math.cos(a), 29 + bob - Math.abs(Math.sin(a))] });
      const F = leg(ph);
      const B = leg(ph + Math.PI);
      const FA = arm(ph);
      const BA = arm(ph + Math.PI);
      set({ hip, neck: [23, 21 + bob], head: [23.5, 15 + bob], fk: F.k, ff: F.f, bk: B.k, bf: B.f, fe: FA.e, fh: FA.h, be: BA.e, bh: BA.h });
      break;
    }
    case 'kick':
      set({ hip: [19, 30], neck: [18, 21], head: [17.5, 15], bk: [18, 36], bf: [17, 42], fk: [25, 31], ff: [31, 29], be: [14, 23], bh: [11, 20], fe: [22, 25], fh: [26, 23] });
      break;
    case 'slide':
      set({ hip: [18, 37], neck: [13, 30], head: [10, 25], fk: [24, 39.5], ff: [31, 41], bk: [21, 41.5], bf: [14, 42], be: [10, 35], bh: [7, 39], fe: [16, 27], fh: [19, 23] });
      break;
    case 'jump':
      set({ hip: [20, 27], neck: [21, 18], head: [21, 12], bk: [17, 31], bf: [15, 36], fk: [24, 30], ff: [22, 35], be: [17, 16], bh: [15, 12], fe: [25, 16], fh: [28, 12] });
      break;
    case 'header':
      set({ hip: [16, 28], neck: [24, 22], head: [28.5, 18], bk: [12, 32], bf: [7, 34], fk: [14, 33], ff: [10, 37], be: [19, 27], bh: [15, 29], fe: [21, 27], fh: [18, 30] });
      break;
    case 'attack':
      set({ hip: [20, 32], neck: [23, 23], head: [24.5, 17], bk: [15, 37], bf: [11, 42], fk: [25, 36], ff: [28, 42], be: [17, 26], bh: [14, 28], fe: [27, 23], fh: [32, 22] });
      break;
    case 'charge':
      set({ hip: [20, 33], neck: [19, 24], head: [19, 18], bk: [15, 37], bf: [13, 42], fk: [25, 37], ff: [27, 42], be: [15, 28], bh: [13, 31], fe: [17, 29], fh: [15, 32] });
      break;
    case 'cheer':
      set({ head: [21, 14.5], be: [18, 25], bh: [17, 22], fe: [23, 16], fh: [24, 9] });
      break;
    case 'sentai0':
      set({ hip: [20, 31], bk: [16, 37], bf: [13, 42], fk: [24, 37], ff: [27, 42], fe: [25, 16], fh: [29, 11], be: [23, 17], bh: [26, 13] });
      break;
    case 'sentai1':
      set({ hip: [20, 31], bk: [16, 37], bf: [13, 42], fk: [25, 36], ff: [29, 42], fe: [26, 21], fh: [32, 20], be: [17, 26], bh: [19, 30] });
      break;
    case 'sentai2':
      set({ head: [21, 14.5], fe: [24, 24], fh: [17, 19], be: [18, 24], bh: [25, 19] });
      break;
    case 'sentai3':
      set({ hip: [20, 35], neck: [21, 26], head: [22, 20], bk: [15, 40], bf: [12, 42], fk: [26, 37], ff: [27, 42], fe: [24, 19], fh: [25, 12], be: [16, 32], bh: [13, 39] });
      break;
    case 'dance0':
      set({ hip: [19, 30], neck: [21, 21], head: [21.5, 15], fk: [23, 36], ff: [27, 42], fe: [25, 16], fh: [28, 10], be: [17, 27], bh: [16, 31] });
      break;
    case 'dance1':
      set({ hip: [21, 30], neck: [19, 21], head: [18.5, 15], bk: [18, 36], bf: [13, 42], fe: [23, 27], fh: [25, 31], be: [16, 16], bh: [13, 10] });
      break;
    case 'bow':
      set({ neck: [27, 25], head: [31, 24], be: [26, 29], bh: [26, 33], fe: [28, 29], fh: [28, 33] });
      break;
    case 'kneel':
      set({ hip: [20, 35], neck: [21, 26], head: [22.5, 20], fk: [25, 35], ff: [26, 42], bk: [18, 42], bf: [12, 42], fe: [24, 30], fh: [25, 34], be: [19, 30], bh: [18, 35] });
      break;
    case 'kneeslide':
      set({ hip: [19, 35], neck: [16, 26], head: [15, 20], fk: [23, 42], ff: [16, 42], bk: [21, 42], bf: [13, 42], fe: [21, 19], fh: [27, 14], be: [13, 20], bh: [9, 15] });
      break;
    case 'sad':
      set({ head: [23, 17], neck: [22, 22], be: [20, 27], bh: [20, 32], fe: [22, 27], fh: [22, 32] });
      break;
    case 'catch':
      set({ fe: [25, 19], fh: [28, 15], be: [24, 20], bh: [27, 17] });
      break;
    case 'hold':
      set({ fe: [25, 24], fh: [27, 25], be: [24, 25], bh: [26, 26] });
      break;
    case 'dizzy':
      set({ head: [20, 15.5], neck: [20.5, 21], be: [16, 25], bh: [13, 27], fe: [25, 25], fh: [28, 27] });
      break;
    default:
      break;
  }
  return J;
}

/* ---------- Dibujo del personaje de campo ---------- */
function drawCharacterSprite(ctx, look, kit, pose) {
  if (pose === 'down') {
    ctx.save();
    ctx.translate(34, 41);
    ctx.rotate(-Math.PI / 2);
    ctx.translate(-20, -42);
    drawFigure(ctx, look, kit, poseJoints('idle0'), 'down');
    ctx.restore();
    return;
  }
  if (pose === 'dive') {
    ctx.save();
    ctx.translate(30, 37);
    ctx.rotate(-1.25);
    ctx.translate(-20, -42);
    drawFigure(ctx, look, kit, poseJoints('catch'), 'dive');
    ctx.restore();
    return;
  }
  drawFigure(ctx, look, kit, poseJoints(pose), pose);
}

function drawFigure(ctx, L, kit, J, pose) {
  const big = L.art === 'golem';
  const keeper = L.art === 'keeper';
  ctx.save();
  if (big) {
    ctx.translate(20, 42);
    ctx.scale(1.2, 1.2);
    ctx.translate(-20, -42);
  }
  const shirt = keeper ? kit.gk : kit.primary;
  const shirtD = shade(shirt, -0.32);
  const shorts = keeper ? shade(kit.gk, -0.5) : kit.secondary;
  const shortsD = shade(shorts, -0.3);
  const sock = keeper ? shade(kit.gk, -0.15) : kit.primary;
  const armSkin = L.art === 'knight' ? L.metal : L.skin;
  const limb = big ? 4 : 3;
  const sh = [J.neck[0], J.neck[1] + 1.5];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const seg = (a, b, color, w) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  };
  const dot = (p, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p[0], p[1], r, 0, TAU);
    ctx.fill();
  };
  const boot = (f) => {
    ctx.fillStyle = '#1a1423';
    ctx.fillRect(f[0] - 1.5, f[1] - 2, 4, 2);
  };

  drawBackAccessories(ctx, L, J, seg, dot);

  // Brazo trasero
  seg(sh, J.be, shirtD, limb);
  seg(J.be, J.bh, shade(armSkin, -0.22), limb - 0.5);
  dot(J.bh, keeper ? 2.2 : big ? 2.4 : 1.6, keeper ? shade(kit.trim, -0.25) : shade(armSkin, -0.22));
  // Pierna trasera
  seg(J.hip, J.bk, shortsD, limb + 0.5);
  seg(J.bk, J.bf, shade(sock, -0.3), limb - 0.5);
  boot(J.bf);
  // Torso
  seg(J.hip, J.neck, shirt, big ? 10 : 8);
  dot([J.hip[0], J.hip[1] + 0.5], big ? 4.5 : 3.6, shorts);
  dot([J.neck[0] + 0.5, J.neck[1]], 1.6, kit.trim);
  drawTorsoDetail(ctx, L, J, seg, dot, sh);
  // Pierna delantera
  seg(J.hip, J.fk, shorts, limb + 0.5);
  seg(J.fk, J.ff, sock, limb - 0.5);
  boot(J.ff);
  // Cabeza
  drawSpriteHead(ctx, L, J.head, seg, dot, kit);
  // Brazo delantero
  seg(sh, J.fe, shirt, limb);
  seg(J.fe, J.fh, armSkin, limb - 0.5);
  dot(J.fh, keeper ? 2.4 : big ? 2.6 : 1.7, keeper ? kit.trim : armSkin);
  drawFrontAccessories(ctx, L, J, seg, dot, pose, kit);
  ctx.restore();
}

function drawBackAccessories(ctx, L, J, seg, dot) {
  const [nx, ny] = J.neck;
  const [hx, hy] = J.hip;
  switch (L.art) {
    case 'samurai':
      seg([nx - 5, ny - 3], [hx + 3, hy + 1], L.metal, 1.6);
      seg([nx - 5, ny - 3], [nx - 3, ny - 1], '#7a1010', 2);
      break;
    case 'ninja':
      seg([nx - 1, ny], [nx - 6, ny + 1], L.accent2, 2.2);
      seg([nx - 6, ny + 1], [nx - 11, ny - 1], L.accent2, 1.8);
      break;
    case 'sorcerer':
    case 'knight': {
      ctx.fillStyle = L.art === 'knight' ? L.accent : L.accent2;
      ctx.beginPath();
      ctx.moveTo(nx - 1, ny);
      ctx.lineTo(nx - 8, hy + 7);
      ctx.lineTo(hx - 1, hy + 9);
      ctx.lineTo(hx + 1, hy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'alchemist':
      ctx.fillStyle = '#6f4518';
      ctx.beginPath();
      ctx.moveTo(hx - 3, hy - 3);
      ctx.lineTo(hx - 7, hy + 8);
      ctx.lineTo(hx + 2, hy + 8);
      ctx.lineTo(hx + 3, hy - 1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'valkyrie': {
      const [hdx, hdy] = J.head;
      seg([hdx - 3, hdy + 2], [hdx - 7, hdy + 10], L.hair, 2.6);
      dot([hdx - 7, hdy + 11], 1.6, shade(L.hair, -0.2));
      break;
    }
    case 'cyborg':
      seg([nx - 3, ny + 2], [hx - 3, hy - 2], L.metal, 3);
      dot([nx - 4, ny + 2], 1, L.accent);
      break;
    default:
      break;
  }
}

function drawTorsoDetail(ctx, L, J, seg, dot, sh) {
  const [nx, ny] = J.neck;
  const [hx, hy] = J.hip;
  switch (L.art) {
    case 'monk':
      seg([nx - 2, ny + 1], [hx + 3, hy - 1], L.accent, 2.6);
      dot([nx + 0.5, ny + 0.5], 1.9, '#7f4f24');
      break;
    case 'samurai':
      dot([sh[0] - 1, sh[1] + 1], 2.7, L.accent);
      seg([hx - 3, hy - 1.5], [hx + 3, hy - 1.5], L.accent2, 1.2);
      break;
    case 'ninja':
      seg([hx - 3, hy - 1.5], [hx + 3, hy - 1.5], '#14142b', 1.8);
      break;
    case 'cyborg':
      seg([nx + 2, ny + 2], [hx + 2, hy - 2], L.accent, 1.1);
      break;
    case 'valkyrie':
      dot(sh, 2.5, L.accent2);
      break;
    case 'speedster':
      seg([nx + 1, ny + 2], [nx - 1, ny + 5], L.accent2, 1.2);
      seg([nx - 1, ny + 5], [nx + 2, ny + 6], L.accent2, 1.2);
      seg([nx + 2, ny + 6], [hx, hy - 1], L.accent2, 1.2);
      break;
    case 'knight':
      seg([hx, hy - 1], [nx, ny + 1], L.metal, 5);
      dot([nx + 0.5, ny + 3], 1.1, L.accent2);
      break;
    case 'alchemist':
      seg([hx - 3, hy - 1.5], [hx + 3, hy - 1.5], '#3b2416', 1.4);
      dot([hx + 3.5, hy], 1.8, '#80ed99');
      break;
    case 'golem':
      seg([nx - 1, ny + 2], [nx + 2, ny + 5], L.accent, 1);
      seg([hx - 2, hy - 3], [hx + 1, hy - 5], L.accent, 1);
      break;
    case 'sorcerer':
      seg([hx, hy], [nx, ny + 1], L.accent, 6);
      dot([nx + 0.5, ny + 1], 1.2, '#ffd23f');
      break;
    default:
      break;
  }
}

function drawSpriteHead(ctx, L, h, seg, dot, kit) {
  const [hx, hy] = h;
  const r = 6;
  const face = L.skin;
  const eye = () => {
    ctx.fillStyle = '#120a1c';
    ctx.fillRect(hx + 2.6, hy - 0.6, 1.5, 2.4);
    ctx.fillStyle = L.eye;
    ctx.fillRect(hx + 2.6, hy + 0.6, 1.5, 1);
  };
  const hairBase = () => {
    dot(h, r + 0.5, L.hair);
    dot([hx + 1.3, hy + 1.3], r - 1.2, face);
  };
  switch (L.art) {
    case 'golem': {
      ctx.fillStyle = L.skin;
      ctx.beginPath();
      const pts = [[-6, -4], [-3, -7], [4, -7], [7, -3], [6, 4], [2, 6], [-4, 6], [-7, 2]];
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(hx + x, hy + y) : ctx.moveTo(hx + x, hy + y)));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shade(L.skin, -0.3);
      ctx.fillRect(hx - 5, hy + 2, 6, 3);
      seg([hx - 1, hy - 3], [hx + 7, hy - 3], shade(L.skin, -0.45), 1.6);
      ctx.fillStyle = L.eye;
      ctx.fillRect(hx + 2, hy - 1.5, 4, 1.8);
      seg([hx - 3, hy - 6], [hx - 1, hy - 2], L.accent, 1);
      break;
    }
    case 'ninja':
      dot(h, r, L.accent);
      ctx.fillStyle = face;
      ctx.fillRect(hx - 0.5, hy - 2, 7, 3.2);
      ctx.fillStyle = L.metal;
      ctx.fillRect(hx - 1, hy - 5.2, 7, 1.8);
      eye();
      break;
    case 'sorcerer':
      dot(h, 7, L.accent);
      ctx.fillStyle = L.accent;
      ctx.beginPath();
      ctx.moveTo(hx - 5, hy - 4);
      ctx.lineTo(hx - 11, hy + 1);
      ctx.lineTo(hx - 5, hy + 3);
      ctx.closePath();
      ctx.fill();
      dot([hx + 2.2, hy + 1], 4.2, shade(face, -0.45));
      ctx.fillStyle = L.eye;
      ctx.fillRect(hx + 2.6, hy - 0.2, 2.2, 1.4);
      break;
    case 'knight':
      dot(h, 6.3, L.metal);
      ctx.fillStyle = face;
      ctx.fillRect(hx + 0.8, hy - 1, 5.6, 4);
      ctx.fillStyle = shade(L.metal, -0.5);
      ctx.fillRect(hx, hy - 2.6, 6.6, 1.4);
      eye();
      seg([hx - 1, hy - 6], [hx - 6, hy - 8.5], L.accent2, 2.6);
      seg([hx - 6, hy - 8.5], [hx - 10, hy - 4], L.accent2, 2.2);
      break;
    case 'samurai':
      hairBase();
      dot([hx - 3, hy - 7], 2.2, L.hair);
      seg([hx - 5.5, hy - 3], [hx + 5.5, hy - 3.4], L.accent, 1.6);
      seg([hx - 6, hy - 3], [hx - 10, hy + 1], L.accent, 1.3);
      eye();
      break;
    case 'cyborg':
      hairBase();
      seg([hx + 1, hy + 0.2], [hx + 6.6, hy + 0.2], L.eye, 1.8);
      dot([hx - 1.6, hy + 1.2], 1.5, L.metal);
      break;
    case 'monk':
      dot(h, r, face);
      dot([hx - 2, hy - 3], 1.3, shade(face, 0.35));
      ctx.fillStyle = shade(face, -0.4);
      ctx.fillRect(hx - 1, hy - 5, 1, 1);
      ctx.fillRect(hx + 1.5, hy - 5.5, 1, 1);
      eye();
      break;
    case 'valkyrie':
      hairBase();
      ctx.fillStyle = L.metal;
      ctx.beginPath();
      ctx.arc(hx, hy - 1, r + 0.7, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(hx - 3, hy - 4);
      ctx.lineTo(hx - 10, hy - 10);
      ctx.lineTo(hx - 8, hy - 5);
      ctx.lineTo(hx - 11, hy - 4);
      ctx.lineTo(hx - 5, hy - 1);
      ctx.closePath();
      ctx.fill();
      eye();
      break;
    case 'speedster': {
      dot(h, r + 0.5, L.hair);
      ctx.fillStyle = L.hair;
      ctx.beginPath();
      const sp = [[5, -4], [1, -10], [-1, -6], [-5, -11], [-5, -5], [-11, -6], [-7, -2], [-11, 1], [-5, 2]];
      sp.forEach(([x, y], i) => (i ? ctx.lineTo(hx + x, hy + y) : ctx.moveTo(hx + x, hy + y)));
      ctx.closePath();
      ctx.fill();
      dot([hx + 1.3, hy + 1.4], r - 1.3, face);
      eye();
      break;
    }
    case 'alchemist':
      hairBase();
      dot([hx - 7, hy + 1], 2.5, L.hair);
      seg([hx - 7, hy + 1], [hx - 9, hy + 6], L.hair, 2);
      dot([hx + 1.5, hy - 4.3], 1.7, L.accent2);
      dot([hx + 4.6, hy - 4.3], 1.5, '#48cae4');
      eye();
      break;
    case 'keeper':
      hairBase();
      ctx.fillStyle = shade(kit.gk, -0.4);
      ctx.beginPath();
      ctx.arc(hx, hy - 1.5, r + 0.4, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(hx + 2, hy - 2.5, 6, 1.6);
      eye();
      break;
    default:
      hairBase();
      eye();
      break;
  }
}

function drawFrontAccessories(ctx, L, J, seg, dot, pose, kit) {
  const [fx, fy] = J.fh;
  switch (L.art) {
    case 'knight':
      ctx.fillStyle = L.accent;
      ctx.fillRect(fx - 2.5, fy - 4, 5.5, 7.5);
      ctx.fillStyle = L.accent2;
      ctx.fillRect(fx - 0.2, fy - 3.4, 1.2, 6.3);
      ctx.fillRect(fx - 2, fy - 1.3, 4.6, 1.2);
      break;
    case 'cyborg':
      dot(J.fh, 2.1, L.metal);
      dot(J.fh, 0.9, L.accent);
      seg(J.fe, J.fh, L.metal, 2.4);
      break;
    case 'valkyrie':
      if (pose === 'attack') seg([fx - 9, fy + 2], [fx + 9, fy - 2], '#fff3b0', 1.6);
      break;
    case 'samurai':
      if (pose === 'attack') seg([fx, fy], [fx + 10, fy - 4], L.metal, 1.5);
      break;
    case 'alchemist':
      if (pose === 'attack') dot([fx + 1.5, fy - 1], 1.8, '#80ed99');
      break;
    case 'sorcerer':
      if (pose === 'attack' || pose === 'charge') dot([fx + 1, fy - 1], 1.8, L.eye);
      break;
    default:
      break;
  }
}

/** Fábrica y caché de cuadros de sprite (por personaje, uniforme, pose y orientación). */
class SpriteFactory {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
  }

  get(def, kit, pose, flip) {
    const key = `${def.id}|${kit.primary}|${kit.gk}|${pose}|${flip ? 1 : 0}`;
    let c = this.cache.get(key);
    if (c) return c;
    c = makeCanvas(CFG.SPR_W, CFG.SPR_H);
    const ctx = c.getContext('2d');
    const sheet = this.assets.images.sprites[def.id];
    if (sheet) {
      const idx = Math.max(0, SPRITE_POSES.indexOf(pose));
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet, idx * CFG.SPR_W, 0, CFG.SPR_W, CFG.SPR_H, 0, 0, CFG.SPR_W, CFG.SPR_H);
    } else {
      drawCharacterSprite(ctx, def.look, kit, pose);
      crispify(c);
    }
    if (flip) {
      const f = makeCanvas(CFG.SPR_W, CFG.SPR_H);
      const fctx = f.getContext('2d');
      fctx.translate(CFG.SPR_W, 0);
      fctx.scale(-1, 1);
      fctx.drawImage(c, 0, 0);
      c = f;
    }
    this.cache.set(key, c);
    return c;
  }
}

/* ---------- Retratos anime procedurales (64x64) ---------- */
function facePath(ctx) {
  ctx.beginPath();
  ctx.moveTo(19, 22);
  ctx.lineTo(19, 35);
  ctx.quadraticCurveTo(21, 45, 32, 50);
  ctx.quadraticCurveTo(43, 45, 45, 35);
  ctx.lineTo(45, 22);
  ctx.quadraticCurveTo(45, 12, 32, 12);
  ctx.quadraticCurveTo(19, 12, 19, 22);
  ctx.closePath();
}

function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

function ellipse(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function animeEye(ctx, cx, cy, side, L, opts = {}) {
  const glow = opts.glow;
  if (glow) {
    const g = ctx.createRadialGradient(cx, cy, 0.5, cx, cy, 6);
    g.addColorStop(0, rgba(L.eye, 0.9));
    g.addColorStop(1, rgba(L.eye, 0));
    ctx.fillStyle = g;
    ctx.fillRect(cx - 7, cy - 7, 14, 14);
    ellipse(ctx, cx, cy + 0.4, 3.6, 1.4, shade(L.eye, 0.5));
  } else {
    ellipse(ctx, cx, cy + 0.5, 4.2, 3, '#ffffff');
    ellipse(ctx, cx + side * 0.3, cy + 0.6, 2.6, 3.2, L.eye);
    ellipse(ctx, cx + side * 0.3, cy - 0.7, 2.6, 1.6, shade(L.eye, -0.45));
    ellipse(ctx, cx + side * 0.3, cy + 0.8, 1.1, 1.7, '#120a1c');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 1.6 + side * 0.3, cy - 1.3, 1.4, 1.4);
    ctx.fillRect(cx + 1 + side * 0.3, cy + 1.8, 0.8, 0.8);
  }
  const outer = cx + side * 4.4;
  const inner = cx - side * 4.4;
  ctx.strokeStyle = '#120a1c';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(inner, cy - 1.8);
  ctx.quadraticCurveTo(cx, cy - 3.7, outer, cy - 2.6);
  ctx.lineTo(outer + side * 1.2, cy - 1.4);
  ctx.stroke();
  if (!opts.noBrow) {
    ctx.strokeStyle = opts.brow || shade(L.hair, -0.45);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(inner, cy - 5.2);
    ctx.lineTo(outer, cy - 7.2);
    ctx.stroke();
  }
}

function drawPortrait(ctx, def) {
  const L = def.look;
  const S = 64;
  const st = L.art;
  const base = L.accent === '#e9f5ff' ? '#4cc9f0' : L.accent;
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, shade(base, -0.05));
  bg.addColorStop(1, shade(base, -0.78));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 9; i++) {
    ctx.beginPath();
    ctx.moveTo(i * 9 - 10, 0);
    ctx.lineTo(i * 9 + 20, S);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 4; y < S; y += 5) for (let x = (y % 10) / 2; x < 22 - y / 4; x += 5) ctx.fillRect(x, y, 1.5, 1.5);

  const skin = L.skin;
  const skinD = shade(skin, -0.22);
  const hair = L.hair;
  const hairD = shade(hair, -0.35);
  const hairL = shade(hair, 0.35);

  // 1) Capa trasera: pelo largo, capuchas, capas
  if (st === 'valkyrie') poly(ctx, [[14, 18], [50, 18], [54, 58], [10, 58]], hair);
  if (st === 'sorcerer') poly(ctx, [[10, 64], [11, 22], [32, 3], [53, 22], [54, 64]], L.accent);
  if (st === 'ninja') poly(ctx, [[13, 46], [13, 18], [32, 7], [51, 18], [51, 46]], L.accent);
  if (st === 'samurai') poly(ctx, [[16, 20], [48, 20], [50, 42], [14, 42]], hairD);
  if (st === 'alchemist') {
    ellipse(ctx, 12, 30, 5, 9, hair);
    ellipse(ctx, 10, 40, 3.5, 6, hairD);
  }

  // 2) Hombros / vestuario
  const outfit = {
    samurai: L.accent, ninja: L.accent, cyborg: '#2b2d42', monk: L.accent, sorcerer: L.accent2,
    valkyrie: L.metal, golem: shade(L.skin, -0.2), speedster: '#1b1b3a', knight: L.metal, alchemist: '#6f4518',
  }[st] || L.accent;
  poly(ctx, [[4, 64], [12, 52], [26, 48], [38, 48], [52, 52], [60, 64]], outfit);
  if (st === 'samurai') {
    poly(ctx, [[4, 64], [8, 52], [20, 50], [16, 64]], L.accent);
    poly(ctx, [[60, 64], [56, 52], [44, 50], [48, 64]], L.accent);
    ctx.fillStyle = L.accent2;
    ctx.fillRect(8, 52, 12, 1.5);
    ctx.fillRect(44, 52, 12, 1.5);
  }
  if (st === 'monk') {
    poly(ctx, [[20, 50], [44, 50], [30, 64], [24, 64]], L.accent2);
    for (let i = 0; i < 7; i++) ellipse(ctx, 22 + i * 3.4, 51 + Math.sin(i / 6 * Math.PI) * 3, 1.5, 1.5, '#7f4f24');
  }
  if (st === 'cyborg') {
    ctx.fillStyle = L.accent;
    ctx.fillRect(14, 56, 36, 1.5);
    ctx.fillRect(31, 50, 2, 14);
  }
  if (st === 'knight') {
    poly(ctx, [[4, 64], [10, 54], [22, 50], [22, 64]], L.accent);
    poly(ctx, [[60, 64], [54, 54], [42, 50], [42, 64]], L.accent);
    ctx.fillStyle = '#ffd23f';
    ctx.fillRect(28, 52, 8, 2);
  }
  if (st === 'speedster') {
    poly(ctx, [[24, 50], [30, 56], [27, 57], [33, 64], [26, 58], [29, 57]], L.accent);
    ctx.fillStyle = L.accent2;
    ctx.fillRect(12, 58, 40, 1.5);
  }
  if (st === 'alchemist') {
    poly(ctx, [[22, 48], [42, 48], [36, 58], [28, 58]], L.accent);
    ellipse(ctx, 50, 58, 2.5, 3.5, '#80ed99');
  }
  if (st === 'valkyrie') {
    ellipse(ctx, 12, 56, 7, 5, L.accent2);
    ellipse(ctx, 52, 56, 7, 5, L.accent2);
  }
  if (st === 'sorcerer') {
    poly(ctx, [[18, 46], [26, 52], [32, 48], [38, 52], [46, 46], [46, 54], [18, 54]], L.accent);
    ellipse(ctx, 32, 53, 2, 2, '#ffd23f');
  }

  // 3) Cuello
  ctx.fillStyle = skinD;
  ctx.fillRect(27, 42, 10, 9);

  // 4) Rostro
  if (st === 'golem') {
    poly(ctx, [[15, 17], [48, 14], [51, 40], [43, 53], [22, 53], [13, 40]], L.skin);
    poly(ctx, [[34, 14], [48, 14], [51, 40], [43, 53], [36, 53], [40, 36]], shade(L.skin, -0.25));
    ctx.fillStyle = shade(L.skin, -0.5);
    ctx.fillRect(15, 25, 35, 4);
    const g1 = ctx.createRadialGradient(32, 31, 1, 32, 31, 14);
    g1.addColorStop(0, 'rgba(255,234,0,0.35)');
    g1.addColorStop(1, 'rgba(255,234,0,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(14, 20, 38, 22);
    ctx.fillStyle = L.eye;
    ctx.fillRect(20, 29, 8, 2.6);
    ctx.fillRect(36, 29, 8, 2.6);
    ctx.strokeStyle = L.accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(18, 18); ctx.lineTo(23, 23); ctx.lineTo(21, 26);
    ctx.moveTo(44, 36); ctx.lineTo(40, 41); ctx.lineTo(43, 46);
    ctx.moveTo(26, 44); ctx.lineTo(38, 44);
    ctx.stroke();
    return;
  }
  ellipse(ctx, 18.5, 33, 2.4, 3.5, skinD);
  ellipse(ctx, 45.5, 33, 2.4, 3.5, skinD);
  ctx.fillStyle = skin;
  facePath(ctx);
  ctx.fill();
  ctx.save();
  facePath(ctx);
  ctx.clip();
  poly(ctx, [[41, 10], [48, 10], [48, 52], [33, 52], [41, 38]], rgba(skinD, 0.75));
  ctx.restore();

  // 5) Rasgos
  const eyeOpts = st === 'sorcerer' ? { glow: true, noBrow: true } : {};
  if (st === 'cyborg') {
    animeEye(ctx, 25, 32, -1, L, { brow: '#3a3f47' });
  } else {
    animeEye(ctx, 25, 32, -1, L, eyeOpts);
    animeEye(ctx, 39, 32, 1, L, eyeOpts);
  }
  ctx.fillStyle = skinD;
  ctx.fillRect(32.4, 38, 1.2, 1.8);
  if (st !== 'ninja') {
    ctx.strokeStyle = shade(skin, -0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(29.5, 43.6);
    ctx.quadraticCurveTo(32, 44.6, 34.6, 43);
    ctx.stroke();
  }

  // 6) Pelo frontal y equipo de cabeza
  switch (st) {
    case 'samurai':
      poly(ctx, [[17, 27], [18, 15], [26, 9], [34, 8], [42, 10], [47, 16], [47, 28], [43, 20], [40, 26], [36, 18], [32, 25], [28, 17], [24, 25], [21, 19]], hair);
      poly(ctx, [[26, 10], [34, 9], [30, 14]], hairL);
      ellipse(ctx, 32, 6, 4, 3, hair);
      ctx.fillStyle = L.accent;
      ctx.fillRect(18, 19, 29, 2.6);
      poly(ctx, [[46, 19], [57, 25], [55, 27], [46, 22]], L.accent);
      poly(ctx, [[46, 21], [54, 31], [52, 32], [45, 23]], L.accent);
      break;
    case 'ninja':
      poly(ctx, [[18, 37], [46, 37], [45, 44], [32, 51], [19, 44]], L.accent);
      ctx.fillStyle = shade(L.accent, -0.3);
      ctx.fillRect(18, 37, 28, 1.2);
      poly(ctx, [[14, 24], [50, 24], [50, 14], [32, 8], [14, 14]], L.accent);
      ctx.fillStyle = L.metal;
      ctx.fillRect(23, 17, 18, 6);
      ctx.fillStyle = shade(L.metal, -0.4);
      ctx.fillRect(28, 19, 8, 1);
      ctx.fillRect(31.5, 17.5, 1, 4.5);
      poly(ctx, [[50, 18], [60, 24], [58, 27], [50, 22]], L.accent2);
      break;
    case 'cyborg':
      poly(ctx, [[18, 22], [19, 13], [32, 9], [45, 13], [46, 22], [42, 17], [37, 19], [32, 15], [27, 19], [22, 16]], hair);
      poly(ctx, [[34, 19], [47, 19], [47, 40], [39, 45], [35, 37]], L.metal);
      ctx.fillStyle = shade(L.metal, -0.4);
      ctx.fillRect(36, 22, 1, 1);
      ctx.fillRect(44, 24, 1, 1);
      ctx.fillRect(43, 38, 1, 1);
      {
        const g = ctx.createRadialGradient(40, 32, 0.5, 40, 32, 7);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.3, L.eye);
        g.addColorStop(1, rgba(L.eye, 0));
        ctx.fillStyle = g;
        ctx.fillRect(32, 24, 16, 16);
      }
      ctx.fillStyle = L.accent;
      ctx.fillRect(35, 43, 10, 1);
      break;
    case 'monk':
      ellipse(ctx, 27, 16, 6, 2.5, rgba('#ffffff', 0.35));
      ctx.fillStyle = shade(skin, -0.35);
      [[27, 13], [32, 12], [37, 13], [29, 16], [35, 16], [32, 18]].forEach(([x, y]) => ctx.fillRect(x, y, 1.4, 1.4));
      break;
    case 'sorcerer':
      ctx.save();
      facePath(ctx);
      ctx.clip();
      ctx.fillStyle = 'rgba(20,0,40,0.55)';
      ctx.fillRect(16, 10, 34, 18);
      ctx.restore();
      poly(ctx, [[16, 24], [32, 6], [48, 24], [44, 16], [32, 12], [20, 16]], shade(L.accent, -0.3));
      ctx.strokeStyle = hair;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(22, 18); ctx.lineTo(20, 36);
      ctx.moveTo(42, 18); ctx.lineTo(44, 36);
      ctx.stroke();
      break;
    case 'valkyrie':
      poly(ctx, [[18, 30], [18, 17], [30, 11], [46, 15], [47, 27], [40, 19], [30, 21], [24, 18]], hair);
      poly(ctx, [[17, 18], [32, 8], [47, 18], [46, 13], [32, 5], [18, 13]], L.metal);
      ctx.fillStyle = L.accent2;
      ctx.fillRect(18, 16, 29, 1.6);
      poly(ctx, [[17, 15], [6, 4], [9, 11], [3, 9], [9, 17], [4, 18], [14, 21]], '#ffffff');
      poly(ctx, [[47, 15], [58, 4], [55, 11], [61, 9], [55, 17], [60, 18], [50, 21]], '#ffffff');
      break;
    case 'speedster':
      poly(ctx, [[18, 26], [12, 18], [19, 16], [14, 6], [24, 11], [26, 1], [32, 10], [40, 0], [41, 11], [52, 6], [47, 16], [54, 19], [46, 26], [42, 18], [36, 23], [31, 17], [26, 23], [22, 18]], hair);
      poly(ctx, [[26, 2], [30, 10], [27, 10]], hairL);
      poly(ctx, [[40, 1], [40, 10], [37, 9]], hairL);
      ctx.fillStyle = L.accent2;
      poly(ctx, [[43, 37], [46, 36], [44, 39], [47, 39], [42, 43], [44, 40], [41, 40]], L.accent2);
      break;
    case 'knight':
      poly(ctx, [[16, 40], [15, 18], [32, 6], [49, 18], [48, 40], [45, 40], [45, 22], [32, 16], [19, 22], [19, 40]], L.metal);
      ctx.fillStyle = shade(L.metal, -0.35);
      ctx.fillRect(19, 18, 26, 3);
      poly(ctx, [[22, 22], [30, 18], [38, 20], [42, 22], [32, 21]], hair);
      ctx.strokeStyle = L.accent2;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(32, 6);
      ctx.quadraticCurveTo(42, -2, 54, 8);
      ctx.quadraticCurveTo(58, 14, 56, 22);
      ctx.stroke();
      break;
    case 'alchemist':
      poly(ctx, [[17, 30], [17, 16], [26, 9], [38, 9], [47, 15], [47, 28], [43, 19], [39, 24], [35, 18], [30, 24], [26, 17], [22, 23]], hair);
      ctx.fillStyle = L.accent2;
      ctx.fillRect(17, 17, 30, 2);
      ellipse(ctx, 26, 17, 4.5, 4.2, L.accent2);
      ellipse(ctx, 38, 17, 4.5, 4.2, L.accent2);
      ellipse(ctx, 26, 17, 3, 2.8, '#48cae4');
      ellipse(ctx, 38, 17, 3, 2.8, '#48cae4');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(24.5, 15.5, 1.5, 1.5);
      ctx.fillRect(36.5, 15.5, 1.5, 1.5);
      ctx.fillStyle = shade(skin, -0.3);
      [[22, 38], [24, 39.5], [40, 38], [42, 39.5]].forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
      break;
    case 'keeper':
      poly(ctx, [[18, 24], [19, 14], [32, 10], [45, 14], [46, 24], [40, 18], [32, 20], [24, 18]], hair);
      break;
    default:
      break;
  }
}

class PortraitFactory {
  constructor(assets) {
    this.assets = assets;
    this.cache = new Map();
  }

  get(def) {
    let c = this.cache.get(def.id);
    if (c) return c;
    c = makeCanvas(64, 64);
    const ctx = c.getContext('2d');
    const img = this.assets.images.portraits[def.id];
    if (img) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 64, 64);
    } else {
      drawPortrait(ctx, def);
    }
    this.cache.set(def.id, c);
    return c;
  }

  /** Copia el retrato en otro canvas (selección, diálogos, ranuras). */
  paint(canvas, def) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!def) {
      ctx.fillStyle = '#120a1f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    ctx.drawImage(this.get(def), 0, 0, canvas.width, canvas.height);
  }
}

/** Cuadros de rotación del balón (pixel art 11x11). */
function makeBallFrames() {
  const frames = [];
  for (let f = 0; f < 4; f++) {
    const c = makeCanvas(11, 11);
    const ctx = c.getContext('2d');
    ellipse(ctx, 5.5, 5.5, 4.5, 4.5, '#fbfbff');
    ctx.fillStyle = '#c9d1e8';
    ctx.beginPath();
    ctx.arc(5.5, 5.5, 4.5, 0.1, Math.PI * 0.9);
    ctx.fill();
    ellipse(ctx, 5.5, 5.5, 3.6, 3.6, '#fbfbff');
    for (let k = 0; k < 3; k++) {
      const a = (f * Math.PI) / 6 + (k * TAU) / 3;
      ellipse(ctx, 5.5 + Math.cos(a) * 2.6, 5.5 + Math.sin(a) * 2.2, 1.3, 1.3, '#1b1030');
    }
    if (f % 2 === 0) ellipse(ctx, 5.5, 5.5, 1.1, 1.1, '#1b1030');
    crispify(c);
    frames.push(c);
  }
  return frames;
}

/* =============================================================================
   06. RENDER 2.5D: PROYECCIÓN, CÁMARA, PARTÍCULAS Y ESTADIO
   ============================================================================= */

/** Estado de la vista (lo actualiza la cámara). */
const VIEW = { camX: CFG.FW / 2, ox: 0, oy: 0 };

/** Escala horizontal según la profundidad: el fondo es más estrecho (trapecio). */
const persp = (wy) => CFG.PERSP_FAR + (1 - CFG.PERSP_FAR) * (wy / CFG.FH);
const projX = (wx, wy) => CFG.W / 2 + (wx - VIEW.camX) * persp(wy) + VIEW.ox;
const projY = (wy, wz = 0) => CFG.FY0 + wy * CFG.DEPTH - wz * CFG.ZS + VIEW.oy;

class Camera {
  constructor() {
    this.x = CFG.FW / 2;
    this.target = this.x;
    this.shakeT = 0;
    this.shakeMag = 0;
    this.speed = 4.5;
  }

  follow(x, snap = false) {
    this.target = clamp(x, CFG.CAM_MIN, CFG.CAM_MAX);
    if (snap) this.x = this.target;
  }

  shake(mag, dur) {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeT = Math.max(this.shakeT, dur);
  }

  update(dt) {
    this.x += (this.target - this.x) * Math.min(1, dt * this.speed);
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeMag * Math.min(1, this.shakeT * 4);
      VIEW.ox = Math.round(rand(-k, k));
      VIEW.oy = Math.round(rand(-k, k));
      if (this.shakeT <= 0) this.shakeMag = 0;
    } else {
      VIEW.ox = 0;
      VIEW.oy = 0;
    }
    VIEW.camX = this.x;
  }
}

/** Sistema de partículas en espacio de mundo (con eje Z) o de pantalla. */
class ParticleSystem {
  constructor(max = 1200) {
    this.list = [];
    this.max = max;
  }

  add(o) {
    const p = Object.assign({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, life: 0.6, size: 2, size2: null,
      color: '#ffffff', shape: 'sq', add: false, space: 'world', rot: 0, vr: 0, text: '',
      font: '8px "Press Start 2P", monospace', stroke: '#000000', alpha: 1, bounce: 0, lw: 2,
    }, o);
    p.max = p.life;
    if (this.list.length >= this.max) this.list.shift();
    this.list.push(p);
    return p;
  }

  burst(x, y, z, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const spread = o.spread ?? Math.PI;
      const a = o.angle !== undefined ? o.angle + rand(-spread, spread) : rand(0, TAU);
      const spMax = o.speed ?? 100;
      const sp = rand(spMax * 0.35, spMax);
      this.add({
        ...o,
        x, y, z,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        vz: rand(o.vz0 ?? 0, o.vz1 ?? spMax * 0.5),
        life: rand((o.life ?? 0.6) * 0.6, o.life ?? 0.6),
        color: Array.isArray(o.colors) ? pick(o.colors) : (o.color ?? '#ffffff'),
        size: rand((o.size ?? 2) * 0.6, o.size ?? 2),
      });
    }
  }

  text(x, y, z, text, color = '#ffd23f', size = 8, life = 1) {
    this.add({ x, y, z, vz: 40, life, shape: 'text', text, color, font: `${size}px "Press Start 2P", monospace`, fade: true });
  }

  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) {
        L.splice(i, 1);
        continue;
      }
      if (p.drag) {
        const dr = Math.exp(-p.drag * dt);
        p.vx *= dr;
        p.vy *= dr;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.space === 'world') {
        p.vz -= p.g * dt;
        p.z += p.vz * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz = p.bounce ? -p.vz * p.bounce : 0;
        }
      } else {
        p.vy += p.g * dt;
      }
      p.rot += p.vr * dt;
    }
  }

  draw(ctx, space, back = false) {
    for (const p of this.list) {
      if (p.space !== space || !!p.back !== back) continue;
      const t = p.life / p.max;
      let X;
      let Y;
      if (space === 'world') {
        X = projX(p.x, p.y);
        Y = projY(p.y, p.z);
      } else {
        X = p.x;
        Y = p.y;
      }
      const size = p.size2 !== null ? lerp(p.size2, p.size, t) : p.size;
      ctx.globalAlpha = clamp(t * 1.8, 0, 1) * p.alpha;
      ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over';
      switch (p.shape) {
        case 'sq':
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(X - size / 2), Math.round(Y - size / 2), Math.max(1, Math.round(size)), Math.max(1, Math.round(size)));
          break;
        case 'circle':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(X, Y, Math.max(0.5, size), 0, TAU);
          ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.lw;
          ctx.beginPath();
          ctx.arc(X, Y, Math.max(0.5, size), 0, TAU);
          ctx.stroke();
          break;
        case 'gring':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.lw;
          ctx.beginPath();
          ctx.ellipse(X, Y, Math.max(0.5, size), Math.max(0.5, size * CFG.DEPTH), 0, 0, TAU);
          ctx.stroke();
          break;
        case 'spark': {
          const k = space === 'world' ? 0.035 : 0.03;
          const ex = X - p.vx * k;
          const ey = Y - (space === 'world' ? (p.vy * CFG.DEPTH - p.vz * CFG.ZS) : p.vy) * k;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, size * 0.6);
          ctx.beginPath();
          ctx.moveTo(X, Y);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          break;
        }
        case 'star':
          ctx.fillStyle = p.color;
          ctx.fillRect(Math.round(X - size), Math.round(Y), Math.round(size * 2 + 1), 1);
          ctx.fillRect(Math.round(X), Math.round(Y - size), 1, Math.round(size * 2 + 1));
          break;
        case 'confetti': {
          ctx.fillStyle = p.color;
          const w = Math.max(1, Math.abs(Math.sin(p.rot)) * size);
          ctx.fillRect(Math.round(X - w / 2), Math.round(Y - 1), Math.round(w), 2);
          break;
        }
        case 'text':
          ctx.font = p.font;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = p.stroke;
          ctx.strokeText(p.text, X, Y);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, X, Y);
          break;
        case 'line':
          ctx.strokeStyle = p.color;
          ctx.lineWidth = size;
          ctx.beginPath();
          ctx.moveTo(X, Y);
          ctx.lineTo(X + Math.cos(p.rot) * p.len, Y + Math.sin(p.rot) * p.len);
          ctx.stroke();
          break;
        case 'sprite':
          ctx.drawImage(p.img, Math.round(X - CFG.FOOT_X), Math.round(Y - CFG.FOOT_Y));
          break;
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  clear() {
    this.list.length = 0;
  }
}

/** Estadio: panorámica de gradas con desenfoque (profundidad de campo HD-2D), campo y porterías. */
class Stadium {
  constructor(theme = {}) {
    this.sky = theme.sky || ['#0b0f2e', '#3a1d66'];
    this.teamColors = theme.teamColors || ['#2f80ff', '#ff3b5c'];
    this.panW = 1240;
    this.panH = 106;
    this.frames = [this.buildPanorama(0), this.buildPanorama(1)];
    this.excite = 0;
    this.bulge = [{ amp: 0, y: 0, z: 0 }, { amp: 0, y: 0, z: 0 }];
    this.t = 0;
  }

  buildPanorama(frame) {
    const raw = makeCanvas(this.panW, this.panH);
    const c = raw.getContext('2d');
    const W = this.panW;
    const H = this.panH;
    const sky = c.createLinearGradient(0, 0, 0, 40);
    sky.addColorStop(0, this.sky[0]);
    sky.addColorStop(1, shade(this.sky[1], -0.35));
    c.fillStyle = sky;
    c.fillRect(0, 0, W, 40);
    // Estrellas fijas (semilla determinista)
    let seed = 7;
    const srnd = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    c.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 70; i++) c.fillRect(Math.floor(srnd() * W), Math.floor(srnd() * 22), 1, 1);
    // Estructura del techo y torres de luz
    c.fillStyle = '#0a0714';
    c.fillRect(0, 14, W, 10);
    for (let x = 0; x < W; x += 24) c.fillRect(x, 10, 2, 14);
    for (let i = 0; i < 6; i++) {
      const tx = 90 + i * 210;
      c.fillStyle = '#16102a';
      c.fillRect(tx - 2, 0, 4, 24);
      const g = c.createRadialGradient(tx, 4, 1, tx, 4, 26);
      g.addColorStop(0, 'rgba(255,255,230,1)');
      g.addColorStop(0.25, 'rgba(255,250,200,0.5)');
      g.addColorStop(1, 'rgba(255,250,200,0)');
      c.fillStyle = g;
      c.fillRect(tx - 26, -22, 52, 52);
      c.fillStyle = '#fffbe6';
      c.fillRect(tx - 6, 1, 12, 4);
    }
    // Gradas
    const st = c.createLinearGradient(0, 24, 0, H);
    st.addColorStop(0, '#1d1533');
    st.addColorStop(1, '#2e2250');
    c.fillStyle = st;
    c.fillRect(0, 24, W, H - 24);
    const crowd = ['#ffd23f', '#ffffff', '#ff8fa3', '#8cbcff', '#c77dff', '#29f0ff', '#ffb703', this.teamColors[0], this.teamColors[1], '#f1c27d', '#8d5524'];
    for (let y = 28; y < H - 14; y += 5) {
      for (let x = (y % 2) * 2; x < W; x += 4) {
        const col = crowd[Math.floor(srnd() * crowd.length)];
        const jump = frame === 1 && srnd() < 0.45 ? -1 : 0;
        c.fillStyle = shade(col, -0.15 - (H - y) / H * 0.3);
        c.fillRect(x, y + 2 + jump, 3, 2);
        c.fillStyle = srnd() < 0.5 ? '#f1c27d' : '#8d5524';
        c.fillRect(x + 1, y + jump, 2, 2);
        if (frame === 1 && srnd() < 0.08) {
          c.fillStyle = col;
          c.fillRect(x + 1, y - 2 + jump, 1, 2);
        }
      }
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(0, y + 4, W, 1);
    }
    // Pancartas
    const banners = ['DIMENSION STRIKERS', '¡VAMOS!', 'SÚPER TORNEO', 'GOL GOL GOL', 'ANIME FC'];
    c.font = '6px "Press Start 2P", monospace';
    c.textBaseline = 'top';
    for (let i = 0; i < 9; i++) {
      const bx = 40 + i * 136;
      const by = 46 + (i % 3) * 13;
      const txt = banners[i % banners.length];
      const w = txt.length * 6 + 6;
      c.fillStyle = i % 2 ? this.teamColors[0] : this.teamColors[1];
      c.fillRect(bx, by, w, 9);
      c.fillStyle = '#ffffff';
      c.fillText(txt, bx + 3, by + 2);
    }
    // Muro inferior con línea de neón
    c.fillStyle = '#120c22';
    c.fillRect(0, H - 12, W, 12);
    const neon = c.createLinearGradient(0, 0, W, 0);
    neon.addColorStop(0, this.teamColors[0]);
    neon.addColorStop(0.5, '#ff2bd6');
    neon.addColorStop(1, this.teamColors[1]);
    c.fillStyle = neon;
    c.fillRect(0, H - 12, W, 1);
    // Desenfoque suave para profundidad de campo (HD-2D)
    const out = makeCanvas(W, H);
    const o = out.getContext('2d');
    o.filter = 'blur(0.7px)';
    o.drawImage(raw, 0, 0);
    o.filter = 'none';
    return out;
  }

  update(dt) {
    this.t += dt;
    this.excite = Math.max(0, this.excite - dt * 0.25);
    for (const b of this.bulge) b.amp *= Math.exp(-dt * 5);
  }

  hitNet(side, y, z, amp) {
    const b = this.bulge[side];
    b.amp = Math.max(b.amp, amp);
    b.y = y;
    b.z = z;
  }

  drawBackground(ctx) {
    const frame = this.excite > 0.05 && Math.floor(this.t * 8) % 2 ? 1 : 0;
    const px = Math.round(CFG.W / 2 - (200 + VIEW.camX) * CFG.PERSP_FAR + VIEW.ox * 0.5);
    ctx.drawImage(this.frames[frame], px, Math.round(VIEW.oy * 0.5) - 2);
    // Suelo exterior (pista alrededor del campo)
    ctx.fillStyle = '#123828';
    ctx.fillRect(0, projY(-4), CFG.W, CFG.H);
  }

  quad(ctx, a, b, c, d, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(projX(a[0], a[1]), projY(a[1], a[2] || 0));
    ctx.lineTo(projX(b[0], b[1]), projY(b[1], b[2] || 0));
    ctx.lineTo(projX(c[0], c[1]), projY(c[1], c[2] || 0));
    ctx.lineTo(projX(d[0], d[1]), projY(d[1], d[2] || 0));
    ctx.closePath();
    ctx.fill();
  }

  path(ctx, pts, close = false) {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => {
      const X = projX(x, y);
      const Y = projY(y, z || 0);
      if (i) ctx.lineTo(X, Y);
      else ctx.moveTo(X, Y);
    });
    if (close) ctx.closePath();
    ctx.stroke();
  }

  drawField(ctx) {
    const { FW, FH } = CFG;
    // Pista exterior con franjas oscuras
    for (let i = -6; i < 26; i++) {
      const x0 = i * 50;
      this.quad(ctx, [x0, -10], [x0 + 50, -10], [x0 + 50, FH + 14], [x0, FH + 14], i % 2 ? '#174a33' : '#164430');
    }
    // Césped con franjas en perspectiva
    for (let i = 0; i < FW / 50; i++) {
      const x0 = i * 50;
      this.quad(ctx, [x0, 0], [x0 + 50, 0], [x0 + 50, FH], [x0, FH], i % 2 ? '#2f9e44' : '#37b24d');
    }
    // Sombreado por profundidad
    const g = ctx.createLinearGradient(0, projY(0), 0, projY(FH));
    g.addColorStop(0, 'rgba(10,20,40,0.38)');
    g.addColorStop(0.5, 'rgba(10,20,40,0.08)');
    g.addColorStop(1, 'rgba(255,255,220,0.06)');
    this.quad(ctx, [-60, 0], [FW + 60, 0], [FW + 60, FH], [-60, FH], 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fill();
    // Líneas
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    this.path(ctx, [[0, 0], [FW, 0], [FW, FH], [0, FH]], true);
    this.path(ctx, [[FW / 2, 0], [FW / 2, FH]]);
    const circle = [];
    for (let a = 0; a <= TAU + 0.01; a += TAU / 40) circle.push([FW / 2 + Math.cos(a) * 70, FH / 2 + Math.sin(a) * 70]);
    this.path(ctx, circle);
    const cy = FH / 2;
    for (const side of [0, 1]) {
      const gx = side ? FW : 0;
      const s = side ? -1 : 1;
      this.path(ctx, [[gx, cy - CFG.BOX_HALF], [gx + s * CFG.BOX_X, cy - CFG.BOX_HALF], [gx + s * CFG.BOX_X, cy + CFG.BOX_HALF], [gx, cy + CFG.BOX_HALF]]);
      this.path(ctx, [[gx, cy - CFG.SMALL_HALF], [gx + s * CFG.SMALL_X, cy - CFG.SMALL_HALF], [gx + s * CFG.SMALL_X, cy + CFG.SMALL_HALF], [gx, cy + CFG.SMALL_HALF]]);
      const arc = [];
      for (let a = -0.9; a <= 0.9; a += 0.1) arc.push([gx + s * (115 + Math.cos(a) * 70), cy + Math.sin(a) * 70]);
      this.path(ctx, arc.filter((p) => (p[0] - gx) * s >= CFG.BOX_X));
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(Math.round(projX(gx + s * 115, cy)) - 1, Math.round(projY(cy)) - 1, 3, 2);
      // Esquinas
      for (const yy of [0, FH]) {
        const pts = [];
        for (let a = 0; a <= Math.PI / 2 + 0.01; a += 0.2) {
          pts.push([gx + s * Math.cos(a) * 14, yy === 0 ? Math.sin(a) * 14 : FH - Math.sin(a) * 14]);
        }
        this.path(ctx, pts);
      }
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(Math.round(projX(FW / 2, cy)) - 1, Math.round(projY(cy)) - 1, 3, 2);
    // Muro de cristal del fondo con borde de neón
    this.quad(ctx, [-90, -2, 0], [FW + 90, -2, 0], [FW + 90, -2, 14], [-90, -2, 14], 'rgba(140,200,255,0.16)');
    ctx.strokeStyle = 'rgba(41,240,255,0.8)';
    ctx.lineWidth = 1;
    this.path(ctx, [[-90, -2, 14], [FW + 90, -2, 14]]);
    // Muros laterales (detrás de las porterías)
    for (const side of [0, 1]) {
      const gx = side ? FW + 2 : -2;
      const gy0 = cy - CFG.GOAL_HALF;
      const gy1 = cy + CFG.GOAL_HALF;
      this.quad(ctx, [gx, 0, 0], [gx, gy0, 0], [gx, gy0, 14], [gx, 0, 14], 'rgba(140,200,255,0.14)');
      this.quad(ctx, [gx, gy1, 0], [gx, FH, 0], [gx, FH, 14], [gx, gy1, 14], 'rgba(140,200,255,0.14)');
      ctx.strokeStyle = 'rgba(255,43,214,0.7)';
      this.path(ctx, [[gx, 0, 14], [gx, gy0, 14]]);
      this.path(ctx, [[gx, gy1, 14], [gx, FH, 14]]);
    }
  }

  /** Puntos de la red de la portería con abombamiento cuando entra el balón. */
  netPoint(side, x, y, z) {
    const b = this.bulge[side];
    if (b.amp > 0.5) {
      const d2 = (y - b.y) * (y - b.y) + (z - b.z) * (z - b.z);
      const disp = b.amp * Math.exp(-d2 / 500);
      x += side ? disp : -disp;
    }
    return [x, y, z];
  }

  drawGoalBack(ctx, side) {
    const { GOAL_HALF, GOAL_H, GOAL_D, FH, FW } = CFG;
    const s = side ? 1 : -1;
    const gx = side ? FW : 0;
    const bx = gx + s * GOAL_D;
    const y0 = FH / 2 - GOAL_HALF;
    const y1 = FH / 2 + GOAL_HALF;
    const bh = GOAL_H * 0.78;
    // Sombra de la portería
    this.quad(ctx, [gx, y0], [bx, y0], [bx, y1], [gx, y1], 'rgba(0,0,0,0.25)');
    // Paneles de red (fondo, lateral lejano y techo)
    this.quad(ctx, [bx, y0, 0], [bx, y1, 0], [bx, y1, bh], [bx, y0, bh], 'rgba(255,255,255,0.08)');
    this.quad(ctx, [gx, y0, 0], [bx, y0, 0], [bx, y0, bh], [gx, y0, GOAL_H], 'rgba(255,255,255,0.06)');
    this.quad(ctx, [gx, y0, GOAL_H], [bx, y0, bh], [bx, y1, bh], [gx, y1, GOAL_H], 'rgba(255,255,255,0.07)');
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.lineWidth = 1;
    // Malla del fondo (vertical y horizontal)
    for (let i = 0; i <= 10; i++) {
      const y = lerp(y0, y1, i / 10);
      const pts = [];
      for (let k = 0; k <= 6; k++) pts.push(this.netPoint(side, bx, y, (bh * k) / 6));
      this.path(ctx, pts);
    }
    for (let k = 0; k <= 6; k++) {
      const z = (bh * k) / 6;
      const pts = [];
      for (let i = 0; i <= 10; i++) pts.push(this.netPoint(side, bx, lerp(y0, y1, i / 10), z));
      this.path(ctx, pts);
    }
    // Malla lateral lejana y techo
    for (let i = 0; i <= 4; i++) {
      const x = lerp(gx, bx, i / 4);
      const zt = lerp(GOAL_H, bh, i / 4);
      this.path(ctx, [[x, y0, 0], [x, y0, zt]]);
      this.path(ctx, [[x, y0, zt], [x, y1, zt]]);
    }
    // Postes traseros
    ctx.strokeStyle = '#c9ced6';
    ctx.lineWidth = 2;
    this.path(ctx, [[bx, y0, 0], [bx, y0, bh], [bx, y1, bh], [bx, y1, 0]]);
    this.path(ctx, [[gx, y0, GOAL_H], [bx, y0, bh]]);
    this.path(ctx, [[gx, y1, GOAL_H], [bx, y1, bh]]);
    // Poste lejano
    this.post(ctx, gx, y0);
  }

  post(ctx, x, y) {
    const X = Math.round(projX(x, y));
    const Y0 = Math.round(projY(y, 0));
    const Y1 = Math.round(projY(y, CFG.GOAL_H));
    ctx.fillStyle = '#120a1c';
    ctx.fillRect(X - 2, Y1 - 1, 5, Y0 - Y1 + 2);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(X - 1, Y1, 3, Y0 - Y1);
    ctx.fillStyle = '#ced4da';
    ctx.fillRect(X + 1, Y1, 1, Y0 - Y1);
  }

  drawGoalFront(ctx, side) {
    const { GOAL_HALF, GOAL_H, GOAL_D, FH, FW } = CFG;
    const s = side ? 1 : -1;
    const gx = side ? FW : 0;
    const bx = gx + s * GOAL_D;
    const y0 = FH / 2 - GOAL_HALF;
    const y1 = FH / 2 + GOAL_HALF;
    const bh = GOAL_H * 0.78;
    // Red lateral cercana
    this.quad(ctx, [gx, y1, 0], [bx, y1, 0], [bx, y1, bh], [gx, y1, GOAL_H], 'rgba(255,255,255,0.07)');
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const x = lerp(gx, bx, i / 4);
      this.path(ctx, [[x, y1, 0], [x, y1, lerp(GOAL_H, bh, i / 4)]]);
    }
    for (let k = 1; k <= 4; k++) this.path(ctx, [[gx, y1, (GOAL_H * k) / 5], [bx, y1, (bh * k) / 5]]);
    // Travesaño
    const xa = projX(gx, y0);
    const xb = projX(gx, y1);
    const ya = projY(y0, GOAL_H);
    const yb = projY(y1, GOAL_H);
    ctx.strokeStyle = '#120a1c';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(xa, ya);
    ctx.lineTo(xb, yb);
    ctx.stroke();
    ctx.strokeStyle = '#f8f9fa';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Poste cercano
    this.post(ctx, gx, y1);
  }

  drawForeground(ctx) {
    const { FW, FH } = CFG;
    this.quad(ctx, [-90, FH + 4, 0], [FW + 90, FH + 4, 0], [FW + 90, FH + 4, 11], [-90, FH + 4, 11], 'rgba(140,200,255,0.18)');
    ctx.strokeStyle = 'rgba(41,240,255,0.9)';
    ctx.lineWidth = 1;
    this.path(ctx, [[-90, FH + 4, 11], [FW + 90, FH + 4, 11]]);
    // Vallas publicitarias (primer plano)
    const top = Math.round(projY(FH + 4)) + 3;
    ctx.fillStyle = '#0d0818';
    ctx.fillRect(0, top, CFG.W, CFG.H - top);
    ctx.fillStyle = 'rgba(255,43,214,0.8)';
    ctx.fillRect(0, top, CFG.W, 1);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textBaseline = 'top';
    const msg = '  DIMENSION STRIKERS  ✦  SÚPER TORNEO DIMENSIONAL  ✦  ¡GOLAZO!  ✦ ';
    const w = msg.length * 8;
    const off = -((VIEW.camX * 1.15 + this.t * 20) % w);
    for (let x = off - w; x < CFG.W; x += w) {
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(msg, Math.round(x), top + 5);
    }
  }
}

/* =============================================================================
   07. ENTIDADES: BALÓN, JUGADOR Y PORTERO
   ============================================================================= */

function makeIntent() {
  return {
    mx: 0, my: 0, pass: false, passHold: false, shootPress: false, shootDown: false,
    cross: false, attack: false, jump: false, skill: false, aimY: null, passTarget: null,
  };
}

function resetIntent(I) {
  I.mx = 0;
  I.my = 0;
  I.pass = false;
  I.passHold = false;
  I.shootPress = false;
  I.shootDown = false;
  I.cross = false;
  I.attack = false;
  I.jump = false;
  I.skill = false;
  I.aimY = null;
  I.passTarget = null;
}

class Ball {
  constructor(match) {
    this.m = match;
    this.frames = makeBallFrames();
    this.reset(CFG.FW / 2, CFG.FH / 2);
  }

  reset(x, y) {
    Object.assign(this, {
      x, y, z: 0, vx: 0, vy: 0, vz: 0, owner: null, lastTouch: null, receiver: null,
      superShot: null, inGoal: false, goalSide: 0, kind: null, checkedBy: null,
      charged: false, roll: 0, trail: [], dribbleT: 0,
    });
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get free() { return !this.owner && !this.superShot; }

  /** Impulsa el balón (pase, tiro, centro, despeje...). */
  kick(by, vx, vy, vz, kind = 'pass') {
    if (this.owner) this.owner = null;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.lastTouch = by;
    this.kind = kind;
    this.checkedBy = null;
    this.charged = false;
    this.receiver = null;
    if (by) {
      by.t.pickup = kind === 'pass' ? 0.3 : 0.38;
      by.t.kick = 0.22;
    }
    if (this.z < 1 && vz > 0) this.z = 1;
  }

  update(dt) {
    if (this.owner) {
      const o = this.owner;
      if (o.keeper) {
        this.x = o.x + o.dirX * 5;
        this.y = o.y + 1;
        this.z = o.z + 14;
      } else {
        this.dribbleT += dt * (Math.hypot(o.vx, o.vy) > 30 ? 9 : 0);
        const reach = 8 + Math.abs(Math.sin(this.dribbleT)) * 3;
        this.x = o.x + Math.cos(o.face) * reach;
        this.y = o.y + Math.sin(o.face) * reach * 0.9;
        this.z = o.z;
      }
      this.vx = o.vx;
      this.vy = o.vy;
      this.vz = 0;
      this.roll += Math.hypot(o.vx, o.vy) * dt * 0.12;
      this.trail.length = 0;
      return;
    }
    if (this.superShot) return;
    if (this.z > 0 || this.vz > 0) this.vz -= CFG.GRAVITY * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.z += this.vz * dt;
    if (this.z <= 0) {
      this.z = 0;
      if (this.vz < -90) {
        this.vz = -this.vz * 0.48;
        this.m.sfx('bounce', { vol: clamp(-this.vz / 300, 0.2, 1) });
      } else {
        this.vz = 0;
      }
    }
    const k = this.z <= 0.5 ? 1.25 : 0.12;
    const f = Math.exp(-k * dt);
    this.vx *= f;
    this.vy *= f;
    if (this.speed < 4 && this.z <= 0) {
      this.vx = 0;
      this.vy = 0;
    }
    if (this.receiver && this.speed < 30 && this.z <= 0) this.receiver = null;
    this.m.ballWalls(this);
    this.roll += this.speed * dt * 0.12;
    if (this.speed > 520) {
      this.trail.push({ x: this.x, y: this.y, z: this.z });
      if (this.trail.length > 8) this.trail.shift();
    } else if (this.trail.length) {
      this.trail.shift();
    }
  }

  drawShadow(ctx) {
    const s = 1 - Math.min(this.z / 220, 0.5);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(projX(this.x, this.y), projY(this.y) + 1, 4.5 * s, 2 * s, 0, 0, TAU);
    ctx.fill();
  }

  draw(ctx) {
    // Estela de velocidad
    if (this.trail.length > 1) {
      ctx.globalCompositeOperation = 'lighter';
      this.trail.forEach((p, i) => {
        ctx.fillStyle = rgba(this.charged ? '#ffb703' : '#9ad1ff', (i / this.trail.length) * 0.45);
        const X = projX(p.x, p.y);
        const Y = projY(p.y, p.z) - 4;
        ctx.beginPath();
        ctx.arc(X, Y, 1.5 + (i / this.trail.length) * 2.5, 0, TAU);
        ctx.fill();
      });
      ctx.globalCompositeOperation = 'source-over';
    }
    const X = Math.round(projX(this.x, this.y));
    const Y = Math.round(projY(this.y, this.z));
    const frame = this.frames[Math.floor(this.roll) % 4];
    if (this.superShot) {
      const col = this.superShot.def.colors;
      const g = ctx.createRadialGradient(X, Y - 5, 1, X, Y - 5, 18);
      g.addColorStop(0, rgba(col[2], 0.95));
      g.addColorStop(0.4, rgba(col[0], 0.6));
      g.addColorStop(1, rgba(col[0], 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(X - 18, Y - 23, 36, 36);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(frame, X - 5, Y - 10);
  }
}

class Player {
  constructor(match, team, def, slot, keeper = false) {
    this.m = match;
    this.team = team;
    this.def = def;
    this.slot = slot;
    this.keeper = keeper;
    this.id = def.id;
    this.name = def.name;
    this.st = def.stats;
    this.baseSpeed = keeper ? 178 : 112 + def.stats.vel * 9.5;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.face = team.dir > 0 ? 0 : Math.PI;
    this.dirX = team.dir;
    this.state = 'normal';
    this.stateT = 0;
    this.t = {
      invuln: 0, attack: 0.5, skill: 2, super: def.super ? def.super.cd * 0.6 : 999,
      slide: 0, pickup: 0, dribble: 0, jump: 0, kick: 0, header: 0,
    };
    this.buff = { shield: 0, immune: 0, block: 0, slow: 0, sprint: 0, fly: 0, smoke: 0 };
    this.intent = makeIntent();
    this.human = null;
    this.brain = null;
    this.charging = false;
    this.chargeT = 0;
    this.pressing = false;
    this.pressT = 0;
    this.action = null;
    this.pose = 'idle0';
    this.poseOverride = null;
    this.animT = rand(0, 2);
    this.runT = 0;
    this.mark = null;
    this.stats = { goals: 0, steals: 0, supers: 0, saves: 0 };
  }

  get hasBall() { return this.m.ball.owner === this; }
  get superReady() { return !!this.def.super && this.t.super <= 0; }

  speedFactor() {
    let k = 1;
    if (this.hasBall) k *= 0.9;
    if (this.buff.sprint > 0) k *= 1.7;
    if (this.buff.fly > 0) k *= 1.45;
    if (this.buff.slow > 0) k *= 0.5;
    if (this.buff.smoke > 0) k *= 0.62;
    if (this.buff.block > 0) k *= 0.6;
    if (this.pressing && !this.hasBall) k *= 1.1;
    if (this.charging) k *= 0.35;
    return k * this.team.speedMul;
  }

  tick(dt) {
    for (const k in this.t) if (this.t[k] > 0) this.t[k] = Math.max(0, this.t[k] - dt);
    for (const k in this.buff) if (this.buff[k] > 0) this.buff[k] = Math.max(0, this.buff[k] - dt);
  }

  zPhysics(dt) {
    if (this.buff.fly > 0) {
      this.z = approach(this.z, 14, 70 * dt);
      this.vz = 0;
      return;
    }
    if (this.z > 0 || this.vz > 0) {
      this.vz -= CFG.GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        this.z = 0;
        this.vz = 0;
      }
    }
  }

  update(dt) {
    this.tick(dt);
    this.zPhysics(dt);
    switch (this.state) {
      case 'down':
      case 'dizzy':
      case 'recover': {
        this.stateT -= dt;
        const f = Math.exp(-(this.state === 'down' ? 3 : 6) * dt);
        this.vx *= f;
        this.vy *= f;
        if (this.stateT <= 0) {
          if (this.state !== 'recover') this.t.invuln = Math.max(this.t.invuln, 0.4);
          this.state = 'normal';
        }
        break;
      }
      case 'slide':
        this.updateSlide(dt);
        break;
      case 'action': {
        const a = this.action;
        a.t += dt;
        if (a.fn) a.fn(a, dt);
        else {
          const f = Math.exp(-7 * dt);
          this.vx *= f;
          this.vy *= f;
        }
        if (a.t >= a.dur) {
          this.state = 'normal';
          this.action = null;
        }
        break;
      }
      case 'celebrate':
      case 'frozen':
        break;
      default:
        this.updateNormal(dt);
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.state !== 'celebrate') {
      this.x = clamp(this.x, 6, CFG.FW - 6);
      this.y = clamp(this.y, 5, CFG.FH - 5);
    }
    this.updateAnim(dt);
  }

  updateNormal(dt) {
    const I = this.intent;
    const mag = Math.hypot(I.mx, I.my);
    const spd = this.baseSpeed * this.speedFactor();
    let tvx = 0;
    let tvy = 0;
    if (mag > 0.15) {
      const k = Math.min(1, mag);
      tvx = (I.mx / mag) * spd * k;
      tvy = (I.my / mag) * spd * k;
      this.face = Math.atan2(I.my, I.mx);
      if (Math.abs(I.mx) > 0.2) this.dirX = Math.sign(I.mx);
    }
    const a = 1300 * dt;
    this.vx = approach(this.vx, tvx, a);
    this.vy = approach(this.vy, tvy, a);
    this.handleActions(dt);
  }

  handleActions(dt) {
    const I = this.intent;
    const m = this.m;
    this.pressing = false;
    if (this.hasBall) {
      if (I.skill && this.def.skill && this.t.skill <= 0) {
        this.useSkill();
        return;
      }
      if (I.pass) {
        m.doPass(this, I.passTarget);
        return;
      }
      if (I.cross) {
        m.doCross(this);
        return;
      }
      if (I.jump && this.t.dribble <= 0) {
        this.doDribble();
        return;
      }
      if (I.shootPress && !this.charging) {
        this.charging = true;
        this.chargeT = 0;
      }
      if (this.charging) {
        if (I.shootDown) {
          this.chargeT += dt;
          if (this.superReady && this.chargeT >= 0.38) {
            this.charging = false;
            m.startSuperBar(this);
            return;
          }
        }
        if (!I.shootDown || this.chargeT >= 1.1) {
          const power = clamp(0.55 + (this.chargeT / 0.9) * 0.45, 0.55, 1);
          this.charging = false;
          m.doShot(this, power, I.aimY);
        }
      }
      return;
    }
    this.charging = false;
    if (I.skill && this.def.skill && this.t.skill <= 0) {
      this.useSkill();
      return;
    }
    if ((I.shootPress || I.pass) && m.header && m.header.press(this)) return;
    if (I.attack && this.def.unique && this.t.attack <= 0) {
      this.useUnique();
      return;
    }
    if (I.cross && this.t.slide <= 0) {
      this.startSlide();
      return;
    }
    if (I.shootPress && m.tryVolley(this, I.aimY)) return;
    if (I.jump && this.z <= 0 && this.t.jump <= 0) {
      this.vz = 300;
      this.z = 0.1;
      this.t.jump = 0.55;
      m.sfx('jump');
    }
    this.pressing = I.passHold;
  }

  startAction(dur, pose, fn = null) {
    this.state = 'action';
    this.action = { t: 0, dur, pose, fn, data: {} };
    this.charging = false;
  }

  doDribble() {
    const I = this.intent;
    let dx = I.mx;
    let dy = I.my;
    if (Math.hypot(dx, dy) < 0.2) {
      const a = this.face + (chance(0.5) ? 1 : -1) * Math.PI / 2;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    const n = Math.hypot(dx, dy);
    this.vx = (dx / n) * 330;
    this.vy = (dy / n) * 330;
    this.t.invuln = 0.36;
    this.t.dribble = 0.85;
    this.startAction(0.22, 'run', (a, dt) => {
      this.vx *= Math.exp(-3 * dt);
      this.vy *= Math.exp(-3 * dt);
      if (Math.floor(a.t * 40) % 2 === 0) this.m.afterimage(this, 0.25);
    });
    this.m.sfx('dribble');
  }

  startSlide() {
    const I = this.intent;
    const a = Math.hypot(I.mx, I.my) > 0.2 ? Math.atan2(I.my, I.mx) : this.face;
    this.face = a;
    if (Math.abs(Math.cos(a)) > 0.2) this.dirX = Math.sign(Math.cos(a));
    this.vx = Math.cos(a) * 345;
    this.vy = Math.sin(a) * 345;
    this.state = 'slide';
    this.stateT = 0.42;
    this.t.slide = 1.05;
    this.slideHits = new Set();
    this.m.sfx('slide');
  }

  updateSlide(dt) {
    this.stateT -= dt;
    this.vx *= Math.exp(-1.6 * dt);
    this.vy *= Math.exp(-1.6 * dt);
    const hx = this.x + Math.cos(this.face) * 9;
    const hy = this.y + Math.sin(this.face) * 9;
    if (Math.floor(this.stateT * 30) % 2) {
      this.m.particles.add({ x: this.x, y: this.y, z: 1, vz: 30, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.4, size: 3, color: '#a3d977', shape: 'sq', g: 80 });
    }
    for (const p of this.m.allPlayers) {
      if (p.team === this.team || this.slideHits.has(p)) continue;
      if (dist(hx, hy, p.x, p.y) < 15 && p.z < 10) {
        this.slideHits.add(p);
        this.m.applyHit(p, this, { stun: 0.75, knock: 160, kind: 'slide', ground: true }, null);
      }
    }
    if (this.stateT <= 0) {
      this.state = 'recover';
      this.stateT = 0.28;
    }
  }

  useUnique() {
    this.t.attack = this.def.unique.cd;
    UNIQUE_ATTACKS[this.id](this, this.m);
  }

  useSkill() {
    this.t.skill = this.def.skill.cd;
    this.m.particles.text(this.x, this.y, 46, this.def.skill.name.toUpperCase(), this.team.kit.ui, 6, 1.1);
    ACTIVE_SKILLS[this.id](this, this.m);
  }

  /** Derribo o aturdimiento por un golpe. */
  knock(stun, kvx, kvy, kind = 'down') {
    this.state = kind;
    this.stateT = stun;
    this.vx = kvx;
    this.vy = kvy;
    if (kind === 'down') {
      this.vz = 150;
      this.z = Math.max(this.z, 0.1);
    }
    this.action = null;
    this.charging = false;
    this.pressing = false;
    if (Math.abs(kvx) > 1) this.dirX = -Math.sign(kvx);
    if (this.m.superBar && this.m.superBar.p === this) this.m.cancelSuperBar();
  }

  updateAnim(dt) {
    this.animT += dt;
    if (this.poseOverride) {
      this.pose = this.poseOverride;
      return;
    }
    const runPose = () => {
      const sp = Math.hypot(this.vx, this.vy);
      this.runT += dt * Math.max(sp, 120) * 0.05;
      return `run${Math.floor(this.runT) % 4}`;
    };
    let pose;
    switch (this.state) {
      case 'down': pose = 'down'; break;
      case 'dizzy': pose = 'dizzy'; break;
      case 'slide': pose = 'slide'; break;
      case 'recover': pose = this.keeper ? 'idle0' : 'kneel'; break;
      case 'dive': pose = 'dive'; break;
      case 'action':
        pose = this.action.pose === 'run' ? runPose() : this.action.pose;
        break;
      default:
        if (this.keeper && this.hasBall) pose = 'hold';
        else if (this.t.header > 0) pose = 'header';
        else if (this.z > 3 && this.buff.fly <= 0) pose = 'jump';
        else if (this.t.kick > 0) pose = 'kick';
        else if (this.charging) pose = 'charge';
        else if (Math.hypot(this.vx, this.vy) > 25) pose = runPose();
        else pose = `idle${Math.floor(this.animT * 2.2) % 2}`;
    }
    this.pose = pose;
  }

  drawShadow(ctx) {
    const s = 1 - Math.min(this.z / 180, 0.45);
    const X = projX(this.x, this.y);
    const Y = projY(this.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(X, Y, 9 * s, 3.5 * s, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba(this.team.kit.ui, this.keeper ? 0.35 : 0.65);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(X, Y, 10 * s, 4 * s, 0, 0, TAU);
    ctx.stroke();
  }

  draw(ctx, sprites) {
    const X = Math.round(projX(this.x, this.y));
    const Y = Math.round(projY(this.y, this.z));
    const glow = (color, r, a) => {
      const g = ctx.createRadialGradient(X, Y - 16, 2, X, Y - 16, r);
      g.addColorStop(0, rgba(color, a));
      g.addColorStop(1, rgba(color, 0));
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = g;
      ctx.fillRect(X - r, Y - 16 - r, r * 2, r * 2);
      ctx.globalCompositeOperation = 'source-over';
    };
    if (this.buff.immune > 0) glow('#ffd23f', 24, 0.55);
    if (this.charging) glow(this.def.super ? this.def.super.colors[0] : '#ffffff', 18 + Math.sin(this.animT * 30) * 3, 0.5);
    if (this.superReady && !this.keeper) {
      const a = 0.18 + Math.sin(this.animT * 6) * 0.08;
      glow(this.def.super.colors[1], 16, a);
    }
    const spr = sprites.get(this.def, this.team.kit, this.pose, this.dirX < 0);
    if (this.t.invuln > 0 && this.state === 'normal' && Math.floor(this.animT * 24) % 2) ctx.globalAlpha = 0.5;
    ctx.drawImage(spr, X - CFG.FOOT_X, Y - CFG.FOOT_Y);
    ctx.globalAlpha = 1;
    if (this.buff.shield > 0) {
      ctx.strokeStyle = rgba('#29f0ff', 0.55 + Math.sin(this.animT * 20) * 0.25);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(X, Y - 16, 15, 20, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(41,240,255,0.12)';
      ctx.fill();
    }
    if (this.buff.block > 0) {
      const sx = X + Math.cos(this.face) * 10;
      ctx.fillStyle = rgba('#8ecae6', 0.5 + Math.sin(this.animT * 18) * 0.2);
      ctx.fillRect(Math.round(sx) - 2, Y - 30, 4, 24);
    }
    if (this.buff.slow > 0 || this.buff.smoke > 0) {
      ctx.fillStyle = 'rgba(199,125,255,0.8)';
      for (let i = 0; i < 3; i++) {
        const a = this.animT * 4 + (i * TAU) / 3;
        ctx.fillRect(Math.round(X + Math.cos(a) * 9), Math.round(Y - 4 + Math.sin(a) * 3), 2, 2);
      }
    }
    if (this.state === 'dizzy') {
      ctx.fillStyle = '#ffd23f';
      for (let i = 0; i < 3; i++) {
        const a = this.animT * 7 + (i * TAU) / 3;
        const sx = Math.round(X + Math.cos(a) * 8);
        const sy = Math.round(Y - 36 + Math.sin(a) * 2);
        ctx.fillRect(sx - 1, sy, 3, 1);
        ctx.fillRect(sx, sy - 1, 1, 3);
      }
    }
    if (this.buff.fly > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      for (let i = 0; i < 3; i++) {
        const off = (this.animT * 90 + i * 9) % 26;
        ctx.fillRect(Math.round(X - this.dirX * (6 + off)), Math.round(Y - 4 - i * 6), 6, 1);
      }
    }
  }
}

/** Portero NPC con IA defensiva y de despeje propia. */
class Goalkeeper extends Player {
  constructor(match, team) {
    super(match, team, GOALKEEPER_DEF, 4, true);
    this.skill = team.keeperSkill;
    this.reactT = 0;
    this.holdT = 0;
  }

  update(dt) {
    this.tick(dt);
    this.zPhysics(dt);
    switch (this.state) {
      case 'down':
      case 'dizzy':
      case 'recover': {
        this.stateT -= dt;
        const f = Math.exp(-4 * dt);
        this.vx *= f;
        this.vy *= f;
        if (this.stateT <= 0) this.state = 'normal';
        break;
      }
      case 'dive':
        this.stateT -= dt;
        this.vx *= Math.exp(-2 * dt);
        this.vy *= Math.exp(-1.2 * dt);
        if (this.stateT <= 0) {
          this.state = 'recover';
          this.stateT = 0.32;
          this.vx = 0;
          this.vy = 0;
        }
        break;
      case 'celebrate':
      case 'frozen':
        break;
      default:
        this.think(dt);
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    // El portero puede acabar dentro de su red si un Supertiro lo arrastra
    const d = this.team.dir;
    const inside = this.state === 'down';
    const minX = d > 0 ? (inside ? -CFG.GOAL_D + 6 : 4) : CFG.FW - 230;
    const maxX = d > 0 ? 230 : (inside ? CFG.FW + CFG.GOAL_D - 6 : CFG.FW - 4);
    this.x = clamp(this.x, minX, maxX);
    this.y = clamp(this.y, 6, CFG.FH - 6);
    this.updateAnim(dt);
  }

  think(dt) {
    const m = this.m;
    const b = m.ball;
    const T = this.team;
    const d = T.dir;
    const lx = T.ownGoalX;
    const cy = CFG.FH / 2;
    let tx = lx + d * 16;
    let ty = cy + clamp((b.y - cy) * 0.55, -CFG.GOAL_HALF + 10, CFG.GOAL_HALF - 10);
    const bxIn = (b.x - lx) * d;
    if (this.hasBall) {
      this.holdT -= dt;
      tx = lx + d * 26;
      ty = cy;
      if (this.holdT <= 0) m.keeperDistribute(this);
    } else {
      const carrier = b.owner;
      if (carrier && carrier.team !== T && bxIn < 190 && Math.abs(b.y - cy) < 150) {
        const k = clamp(1 - bxIn / 190, 0, 1);
        tx = lx + d * (16 + 36 * k);
        ty = lerp(ty, clamp(b.y, cy - 70, cy + 70), 0.5 * k);
        if (distE(this, carrier) < 20 && carrier.t.invuln <= 0 && carrier.buff.immune <= 0 && carrier.buff.shield <= 0 && this.t.attack <= 0) {
          this.t.attack = 0.9;
          if (chance(0.22 + this.skill * 0.3)) m.keeperClaim(this, carrier);
        }
      }
      if (b.free && bxIn > -4 && bxIn < CFG.SMALL_X + 24 && Math.abs(b.y - cy) < CFG.SMALL_HALF && b.z < 40 && b.speed < 480) {
        tx = b.x;
        ty = b.y;
      }
      const vin = -b.vx * d;
      if (b.free && vin > 180 && bxIn > 0 && bxIn < 560) {
        const tt = (bxIn - 14) / vin;
        const py = b.y + b.vy * tt;
        if (tt > 0 && Math.abs(py - cy) < CFG.GOAL_HALF + 16) {
          this.reactT += dt;
          if (this.reactT > lerp(0.24, 0.05, this.skill)) {
            ty = clamp(py, cy - CFG.GOAL_HALF - 4, cy + CFG.GOAL_HALF + 4);
            tx = lx + d * 14;
            const gap = py - this.y;
            if (Math.abs(gap) > 16 && tt < 0.45 && this.z <= 0) {
              this.dive(gap);
              return;
            }
          }
        }
      } else {
        this.reactT = 0;
      }
    }
    const dx = tx - this.x;
    const dy = ty - this.y;
    const dd = Math.hypot(dx, dy);
    const spd = Math.min(this.baseSpeed * (0.85 + this.skill * 0.3), dd * 7);
    const tvx = dd > 0.5 ? (dx / dd) * spd : 0;
    const tvy = dd > 0.5 ? (dy / dd) * spd : 0;
    this.vx = approach(this.vx, tvx, 1500 * dt);
    this.vy = approach(this.vy, tvy, 1500 * dt);
    this.face = Math.atan2(b.y - this.y, b.x - this.x);
    this.dirX = b.x >= this.x ? 1 : -1;
  }

  dive(gap) {
    this.state = 'dive';
    this.stateT = 0.42;
    const reach = Math.min(Math.abs(gap) + 6, 28 + this.skill * 52);
    this.vy = (Math.sign(gap) * reach) / 0.26;
    this.vx = this.team.dir * 25;
    this.vz = 110;
    this.z = 0.1;
    this.dirX = this.team.dir;
    this.m.sfx('jump');
  }
}

/* =============================================================================
   08. HABILIDADES: GOLPES ÚNICOS, HABILIDADES ACTIVAS Y SUPERTIROS
   ============================================================================= */

/** Dirección deseada (input) o, si no hay, hacia donde mira el jugador. */
function moveAngle(p) {
  const I = p.intent;
  return Math.hypot(I.mx, I.my) > 0.2 ? Math.atan2(I.my, I.mx) : p.face;
}

/**
 * Golpe Único (botón U): cada personaje tiene animación y hitbox propias
 * para robar el balón de forma agresiva (estilo Mario Strikers).
 */
const UNIQUE_ATTACKS = {
  samurai(p, m) {
    const a = p.face;
    p.startAction(0.34, 'attack', (act) => {
      if (act.t < 0.16) {
        p.vx = Math.cos(a) * 390;
        p.vy = Math.sin(a) * 390;
      } else {
        p.vx *= 0.8;
        p.vy *= 0.8;
      }
    });
    m.addHitbox({ owner: p, follow: true, off: 14, r: 14, life: 0.2, effect: { stun: 0.85, knock: 300 }, kind: 'slash', color: '#ff6b6b' });
    m.addHitbox({ owner: p, fromOwner: true, off: 16, speed: 430, r: 13, life: 0.3, delay: 0.1, effect: { stun: 0.7, knock: 220 }, kind: 'crescent', color: '#ff8fa3' });
    m.sfx('slash');
  },
  ninja(p, m) {
    p.startAction(0.28, 'attack');
    const fx = p.x + Math.cos(p.face) * 16;
    const fy = p.y + Math.sin(p.face) * 16;
    m.particles.burst(fx, fy, 8, 18, { speed: 70, life: 0.8, size: 7, colors: ['#e9ecef', '#adb5bd', '#ced4da'], shape: 'circle', drag: 3, vz0: 5, vz1: 30, alpha: 0.85 });
    m.addHitbox({ owner: p, follow: true, off: 16, r: 22, life: 0.25, effect: { stun: 1.1, knock: 40, dizzy: true }, kind: 'smoke', color: '#ced4da' });
    m.sfx('poof');
  },
  cyborg(p, m) {
    const a = p.face;
    p.startAction(0.4, 'attack', (act) => {
      if (act.t > 0.1 && act.t < 0.2) {
        p.vx = Math.cos(a) * 220;
        p.vy = Math.sin(a) * 220;
      } else {
        p.vx *= 0.85;
        p.vy *= 0.85;
      }
    });
    m.addHitbox({ owner: p, follow: true, off: 18, r: 24, life: 0.22, delay: 0.1, effect: { stun: 0.85, knock: 430 }, kind: 'emp', color: '#29f0ff' });
    m.sfx('zap');
  },
  monje(p, m) {
    p.startAction(0.32, 'attack');
    m.addHitbox({ owner: p, follow: true, off: 15, r: 15, life: 0.16, delay: 0.06, effect: { stun: 0.7, knock: 580 }, kind: 'palm', color: '#ffd60a' });
    m.sfx('whoosh');
  },
  hechicero(p, m) {
    p.startAction(0.36, 'charge');
    m.addHitbox({ owner: p, follow: true, off: 0, r: 38, life: 0.22, delay: 0.08, effect: { stun: 0.6, knock: 290 }, kind: 'shadow', color: '#9d4edd' });
    m.sfx('magic');
  },
  valquiria(p, m) {
    const a = p.face;
    p.t.invuln = Math.max(p.t.invuln, 0.12);
    p.startAction(0.38, 'attack', (act) => {
      if (act.t < 0.3) {
        p.vx = Math.cos(a) * 470;
        p.vy = Math.sin(a) * 470;
        if (Math.floor(act.t * 40) % 2 === 0) m.afterimage(p, 0.3);
      } else {
        p.vx *= 0.8;
        p.vy *= 0.8;
      }
    });
    m.addHitbox({ owner: p, follow: true, off: 14, r: 13, life: 0.32, effect: { stun: 0.7, knock: 260 }, kind: 'spear', color: '#fff3b0' });
    m.sfx('whoosh');
  },
  golem(p, m) {
    p.startAction(0.6, 'jump', (act) => {
      p.vx *= 0.8;
      p.vy *= 0.8;
      if (act.t >= 0.26 && !act.data.slam) {
        act.data.slam = true;
        act.pose = 'charge';
        m.camera.shake(5, 0.35);
        m.sfx('heavy');
        m.particles.add({ x: p.x, y: p.y, z: 1, shape: 'gring', size: 4, size2: 64, life: 0.45, color: '#ffb703', lw: 3 });
        m.particles.add({ x: p.x, y: p.y, z: 1, shape: 'gring', size: 2, size2: 40, life: 0.35, color: '#ff6d00', lw: 2 });
        m.particles.burst(p.x, p.y, 2, 22, { speed: 140, vz0: 120, vz1: 260, g: 700, colors: ['#9c6644', '#6c757d', '#ffb703'], life: 0.9, size: 4, bounce: 0.3 });
      }
    });
    m.addHitbox({ owner: p, follow: true, off: 8, r: 54, life: 0.18, delay: 0.26, ground: true, effect: { stun: 1.0, knock: 240 }, kind: 'quake', color: '#ffb703' });
  },
  velocista(p, m) {
    const base = p.face;
    p.startAction(0.42, 'run', (act) => {
      const seg = Math.floor(act.t / 0.14);
      const a = base + (seg % 2 ? -0.6 : 0.6);
      p.vx = Math.cos(a) * 520;
      p.vy = Math.sin(a) * 520;
      p.face = a;
      m.particles.add({ x: p.x, y: p.y, z: 12, life: 0.3, size: 3, color: pick(['#ffee32', '#00f5d4']), shape: 'sq', add: true });
    });
    m.addHitbox({ owner: p, follow: true, off: 8, r: 12, life: 0.42, effect: { stun: 0.6, knock: 210 }, kind: 'bolt', color: '#ffee32' });
    m.sfx('zap');
  },
  caballero(p, m) {
    const a = p.face;
    p.startAction(0.3, 'attack', (act) => {
      if (act.t < 0.1) {
        p.vx = Math.cos(a) * 260;
        p.vy = Math.sin(a) * 260;
      } else {
        p.vx *= 0.8;
        p.vy *= 0.8;
      }
    });
    m.addHitbox({ owner: p, follow: true, off: 14, r: 15, life: 0.16, delay: 0.05, effect: { stun: 1.15, knock: 320, dizzy: true }, kind: 'bash', color: '#8ecae6' });
    m.sfx('hit');
  },
  alquimista(p, m) {
    const a = p.face;
    p.startAction(0.26, 'attack');
    m.addHitbox({
      owner: p, x: p.x + Math.cos(a) * 10, y: p.y + Math.sin(a) * 10, z: 20,
      vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, vz: 210, gravity: true, r: 6, life: 1.2,
      effect: null, kind: 'flask', color: '#80ed99',
      onExpire: (hb) => {
        m.addHitbox({ owner: p, x: hb.x, y: hb.y, r: 38, life: 0.15, effect: { stun: 0.6, knock: 340 }, kind: 'boom', color: '#ff5400' });
        m.explosionFx(hb.x, hb.y, 0, ['#ff5400', '#ffb703', '#80ed99'], 0.7);
        m.sfx('explosion', { vol: 0.5 });
        m.camera.shake(3, 0.2);
      },
    });
    m.sfx('pass');
  },
};

/** Habilidades activas (tecla O o U+I). */
const ACTIVE_SKILLS = {
  samurai(p, m) {
    const a = moveAngle(p);
    p.face = a;
    p.t.invuln = 0.32;
    p.startAction(0.26, 'run', () => {
      p.vx = Math.cos(a) * 560;
      p.vy = Math.sin(a) * 560;
      m.afterimage(p, 0.3);
    });
    m.sfx('whoosh');
  },
  ninja(p, m) {
    const a = moveAngle(p);
    const smoke = (x, y) => m.particles.burst(x, y, 10, 14, { speed: 50, life: 0.6, size: 7, colors: ['#e9ecef', '#adb5bd', '#5a189a'], shape: 'circle', drag: 3, alpha: 0.8 });
    smoke(p.x, p.y);
    p.x = clamp(p.x + Math.cos(a) * 78, 10, CFG.FW - 10);
    p.y = clamp(p.y + Math.sin(a) * 78, 8, CFG.FH - 8);
    smoke(p.x, p.y);
    p.t.invuln = 0.3;
    m.sfx('teleport');
  },
  cyborg(p, m) {
    p.buff.shield = 3;
    m.sfx('shield');
  },
  monje(p, m) {
    const a = moveAngle(p);
    p.vz = 440;
    p.z = 0.1;
    p.t.invuln = 0.95;
    const vx = Math.cos(a) * 250;
    const vy = Math.sin(a) * 250;
    p.startAction(1.1, 'jump', (act) => {
      p.vx = vx;
      p.vy = vy;
      if (act.t > 0.12 && p.z <= 0) act.t = act.dur;
    });
    m.particles.burst(p.x, p.y, 0, 12, { speed: 60, colors: ['#ffd60a', '#ff9e00'], life: 0.5, add: true });
    m.sfx('jump');
  },
  hechicero(p, m) {
    for (const o of m.opponentsOf(p.team)) if (distE(p, o) < 100) o.buff.slow = 3;
    m.particles.add({ x: p.x, y: p.y, z: 1, shape: 'gring', size: 6, size2: 100, life: 0.6, color: '#c77dff', lw: 3 });
    m.particles.burst(p.x, p.y, 10, 24, { speed: 110, colors: ['#9d4edd', '#c77dff', '#240046'], life: 0.8, size: 3, add: true });
    m.sfx('magic');
  },
  valquiria(p, m) {
    p.buff.fly = 1.8;
    m.sfx('whoosh');
  },
  golem(p, m) {
    p.buff.immune = 3.5;
    m.particles.add({ x: p.x, y: p.y, z: 1, shape: 'gring', size: 6, size2: 40, life: 0.5, color: '#ffd23f', lw: 3 });
    m.sfx('shield');
  },
  velocista(p, m) {
    p.buff.sprint = 2.6;
    m.sfx('zap');
  },
  caballero(p, m) {
    p.buff.block = 2.6;
    m.sfx('shield');
  },
  alquimista(p, m) {
    m.addCloud(p.x, p.y, p.team, 4.2, 74);
    m.sfx('poof');
  },
};

/**
 * Supertiro en vuelo: trayectoria con nombre propio, efectos de partículas,
 * derriba a quien se cruce y resuelve la parada del portero al llegar.
 */
class SuperShot {
  constructor(m, p, quality, aimY) {
    this.m = m;
    this.p = p;
    this.def = p.def.super;
    this.quality = quality;
    const T = p.team;
    this.dir = T.dir;
    this.goalX = T.oppGoalX;
    const b = m.ball;
    this.sx = b.x;
    this.sy = b.y;
    this.sz = Math.max(b.z, 6);
    const K = m.teams[1 - T.idx].keeper;
    const cy = CFG.FH / 2;
    let ay = aimY;
    if (ay === null || ay === undefined) ay = K.y < cy ? cy + CFG.GOAL_HALF * 0.62 : cy - CFG.GOAL_HALF * 0.62;
    this.tx = this.goalX + this.dir * 4;
    this.ty = clamp(ay, cy - CFG.GOAL_HALF + 12, cy + CFG.GOAL_HALF - 12);
    this.tz = 16;
    this.path = this.def.path;
    const d = Math.hypot(this.tx - this.sx, this.ty - this.sy) || 1;
    const speeds = { comet: 1350, ground: 780, meteor: 950, dragon: 900, beam: 1150, zigzag: 900, curve: 900, sword: 1000, nova: 1000, straight: 1050 };
    this.dur = clamp(d / (speeds[this.path] || 1000), 0.5, 1.6) + (this.path === 'meteor' || this.path === 'dragon' ? 0.45 : 0);
    this.t = 0;
    this.done = false;
    this.hit = new Set();
    this.side = chance(0.5) ? 1 : -1;
    this.nx = -(this.ty - this.sy) / d;
    this.ny = (this.tx - this.sx) / d;
    b.owner = null;
    b.superShot = this;
    b.lastTouch = p;
    b.kind = 'super';
    b.checkedBy = null;
    b.receiver = null;
    b.vz = 0;
  }

  pos(u) {
    const { sx, sy, sz, tx, ty, tz } = this;
    let x = lerp(sx, tx, u);
    let y = lerp(sy, ty, u);
    let z = lerp(sz, tz, u);
    switch (this.path) {
      case 'straight':
        z += 16 * Math.sin(Math.PI * u);
        break;
      case 'zigzag': {
        const off = 34 * (1 - u) * Math.sin(u * Math.PI * 7);
        x += this.nx * off;
        y += this.ny * off;
        z += 10 * Math.sin(Math.PI * u);
        break;
      }
      case 'beam':
        z += 6;
        break;
      case 'dragon': {
        const r = 0.35;
        const ax = sx + (tx - sx) * 0.08;
        const ay = sy + (ty - sy) * 0.08;
        if (u < r) {
          const k = u / r;
          x = lerp(sx, ax, k);
          y = lerp(sy, ay, k) + Math.sin(k * Math.PI * 3) * 10;
          z = sz + 140 * easeOutCubic(k);
        } else {
          const k = (u - r) / (1 - r);
          x = lerp(ax, tx, k);
          y = lerp(ay, ty, k) + Math.sin(k * Math.PI * 4) * 16 * (1 - k);
          z = lerp(sz + 140, tz, easeInCubic(k));
        }
        break;
      }
      case 'meteor': {
        const r = 0.32;
        if (u < r) {
          const k = u / r;
          x = sx;
          y = sy;
          z = sz + 260 * easeOutCubic(k);
        } else {
          const k = (u - r) / (1 - r);
          x = lerp(sx, tx, k);
          y = lerp(sy, ty, k);
          z = lerp(sz + 260, tz, k);
        }
        break;
      }
      case 'curve': {
        const off = 75 * Math.sin(Math.PI * u) * this.side;
        x += this.nx * off;
        y += this.ny * off;
        z += 34 * Math.sin(Math.PI * u);
        break;
      }
      case 'ground':
        z = 0;
        break;
      case 'comet':
        x += rand(-2, 2);
        y += rand(-2, 2);
        z += 6;
        break;
      case 'sword':
        z += 10 * Math.sin(Math.PI * u);
        break;
      case 'nova':
        z += 20 * Math.sin(Math.PI * u);
        break;
      default:
        break;
    }
    return { x, y, z };
  }

  update(dt) {
    if (this.done) return;
    const m = this.m;
    const b = m.ball;
    this.t += dt;
    const u = clamp(this.t / this.dur, 0, 1);
    const P = this.pos(u);
    const inv = 1 / Math.max(dt, 1e-4);
    b.vx = (P.x - b.x) * inv;
    b.vy = (P.y - b.y) * inv;
    b.x = P.x;
    b.y = P.y;
    b.z = P.z;
    b.roll += 1.5;
    this.emit(P, u, dt);
    for (const o of m.allPlayers) {
      if (o.team === this.p.team || o.keeper || this.hit.has(o)) continue;
      const r = this.path === 'ground' ? 26 : 16;
      if (dist(o.x, o.y, P.x, P.y) < r && Math.abs(o.z + 16 - P.z) < 36) {
        this.hit.add(o);
        const toShooter = Math.atan2(this.sy - o.y, this.sx - o.x);
        if (o.buff.block > 0 && Math.abs(angleDiff(o.face, toShooter)) < Math.PI / 2 && chance(0.45)) {
          m.superBlocked(this, o);
          return;
        }
        m.applyHit(o, this.p, { stun: 1.0, knock: 420, kind: 'super' }, { x: P.x - this.dir * 10, y: P.y });
      }
    }
    if (u >= 1) this.finish();
  }

  emit(P, u, dt) {
    const ps = this.m.particles;
    const c = this.def.colors;
    const n = Math.max(1, Math.round(dt * 240));
    for (let i = 0; i < n; i++) {
      switch (this.def.fx) {
        case 'fire':
          ps.add({ x: P.x + rand(-4, 4), y: P.y + rand(-4, 4), z: P.z + rand(0, 8), vz: rand(20, 90), life: rand(0.25, 0.55), size: rand(3, 7), size2: 0, color: pick(c), shape: 'circle', add: true });
          break;
        case 'lightning':
          ps.add({ x: P.x, y: P.y, z: P.z + 5, vx: rand(-160, 160), vy: rand(-160, 160), vz: rand(-60, 60), life: 0.25, size: 2, color: pick(c), shape: 'spark', add: true });
          break;
        case 'plasma':
          ps.add({ x: P.x + rand(-3, 3), y: P.y + rand(-3, 3), z: P.z + 4, life: 0.4, size: rand(4, 8), size2: 0, color: pick(c), shape: 'circle', add: true });
          break;
        case 'dragon': {
          const a = this.t * 22 + i;
          ps.add({ x: P.x + Math.cos(a) * 9, y: P.y + Math.sin(a) * 9, z: P.z + 5 + Math.sin(a) * 6, life: 0.6, size: rand(3, 6), size2: 1, color: pick(c), shape: 'circle', add: true });
          break;
        }
        case 'abyss':
          ps.add({ x: P.x + rand(-6, 6), y: P.y + rand(-6, 6), z: P.z + rand(0, 10), vz: rand(10, 50), life: rand(0.4, 0.8), size: rand(5, 9), size2: 12, color: pick(['#240046', '#3c096c', '#10002b']), shape: 'circle', alpha: 0.8 });
          ps.add({ x: P.x, y: P.y, z: P.z + 5, vx: rand(-90, 90), vy: rand(-90, 90), vz: rand(0, 80), life: 0.35, size: 2, color: c[2], shape: 'spark', add: true });
          break;
        case 'holy':
          ps.add({ x: P.x + rand(-8, 8), y: P.y + rand(-8, 8), z: P.z + rand(0, 16), vz: rand(30, 90), life: 0.6, size: rand(2, 4), color: pick(c), shape: 'star', add: true });
          break;
        case 'quake':
          ps.add({ x: P.x + rand(-10, 10), y: P.y + rand(-10, 10), z: 1, vx: rand(-60, 60), vy: rand(-60, 60), vz: rand(120, 260), g: 800, bounce: 0.3, life: 0.9, size: rand(2, 5), color: pick(['#9c6644', '#6c757d', '#7f5539']), shape: 'sq' });
          ps.add({ x: P.x + rand(-4, 4), y: P.y + rand(-4, 4), z: 0, life: 2.4, size: 3, color: '#3b2a1a', shape: 'sq', alpha: 0.85 });
          break;
        case 'volt':
          ps.add({ x: P.x, y: P.y, z: P.z + 5, vx: -this.dir * rand(100, 300), vy: rand(-80, 80), vz: rand(-40, 40), life: 0.3, size: 2.5, color: pick(c), shape: 'spark', add: true });
          break;
        case 'radiant':
          ps.add({ x: P.x + rand(-6, 6), y: P.y + rand(-6, 6), z: P.z + rand(0, 20), vz: rand(-20, 60), life: 0.5, size: rand(2, 4), color: pick(c), shape: 'star', add: true });
          break;
        case 'nova':
          if (Math.random() < 0.25) ps.add({ x: P.x, y: P.y, z: P.z + 4, life: 0.4, shape: 'ring', size: 4, size2: 20, color: pick(c), lw: 2, add: true });
          ps.add({ x: P.x, y: P.y, z: P.z + 5, vx: rand(-120, 120), vy: rand(-120, 120), vz: rand(-50, 80), life: 0.4, size: 2, color: pick(c), shape: 'spark', add: true });
          break;
        default:
          break;
      }
    }
  }

  /** Efectos grandes dibujados aparte: rayo de plasma, espada de luz, ilusiones, pilares. */
  drawExtras(ctx) {
    if (this.done) return;
    const u = clamp(this.t / this.dur, 0, 1);
    const b = this.m.ball;
    const X = projX(b.x, b.y);
    const Y = projY(b.y, b.z) - 5;
    const c = this.def.colors;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    switch (this.path) {
      case 'beam': {
        const X0 = projX(this.sx, this.sy);
        const Y0 = projY(this.sy, this.sz) - 5;
        for (const [w, a] of [[16, 0.15], [9, 0.35], [4, 0.9]]) {
          ctx.strokeStyle = rgba(w > 10 ? c[1] : c[2], a);
          ctx.lineWidth = w + Math.sin(this.t * 60) * 1.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(X0, Y0);
          ctx.lineTo(X, Y);
          ctx.stroke();
        }
        break;
      }
      case 'sword': {
        const h = 26 + 70 * (1 - u);
        const top = Y - 12 - h;
        const g = ctx.createLinearGradient(0, top, 0, Y);
        g.addColorStop(0, rgba(c[0], 0.2));
        g.addColorStop(1, rgba(c[0], 0.95));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(X - 5, top);
        ctx.lineTo(X + 5, top);
        ctx.lineTo(X + 3, Y - 10);
        ctx.lineTo(X, Y - 2);
        ctx.lineTo(X - 3, Y - 10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba(c[1], 0.95);
        ctx.fillRect(X - 11, top - 3, 22, 4);
        ctx.fillRect(X - 2, top - 13, 4, 10);
        break;
      }
      case 'zigzag':
        for (const k of [-1, 1]) {
          const P = this.pos(clamp(u - 0.04, 0, 1));
          const gx = projX(P.x + this.nx * 22 * k, P.y + this.ny * 22 * k);
          const gy = projY(P.y + this.ny * 22 * k, P.z) - 5;
          ctx.fillStyle = rgba(c[1], 0.45);
          ctx.beginPath();
          ctx.arc(gx, gy, 5, 0, TAU);
          ctx.fill();
        }
        break;
      case 'curve':
        for (const k of [0.2, 0.45]) {
          const P = this.pos(clamp(u - k, 0, 1));
          const px = projX(P.x, P.y);
          const py = projY(P.y, 0);
          const g = ctx.createLinearGradient(0, py - 120, 0, py);
          g.addColorStop(0, rgba(c[0], 0));
          g.addColorStop(1, rgba(c[0], 0.5));
          ctx.fillStyle = g;
          ctx.fillRect(px - 6, py - 120, 12, 120);
        }
        break;
      case 'meteor':
      case 'dragon':
      case 'nova': {
        const r = this.path === 'meteor' ? 16 : 11;
        const g = ctx.createRadialGradient(X, Y, 1, X, Y, r);
        g.addColorStop(0, rgba(c[2], 0.95));
        g.addColorStop(0.5, rgba(c[0], 0.7));
        g.addColorStop(1, rgba(c[1], 0));
        ctx.fillStyle = g;
        ctx.fillRect(X - r, Y - r, r * 2, r * 2);
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }

  finish() {
    this.done = true;
    const m = this.m;
    const b = m.ball;
    const T = this.p.team;
    const K = m.teams[1 - T.idx].keeper;
    const far = Math.abs(this.goalX - this.sx);
    let save = this.quality === 'perfect' ? 0.08 : 0.2 + K.skill * 0.3;
    if (far > 560) save += 0.25;
    if (K.state === 'down' || K.state === 'dizzy') save = 0;
    b.superShot = null;
    m.explosionFx(b.x, b.y, b.z, this.def.colors, 1.3);
    m.camera.shake(7, 0.45);
    m.flash(0.6, '#ffffff');
    m.sfx('explosion');
    if (chance(save)) {
      b.x = this.goalX - this.dir * 12;
      b.vx = -this.dir * 420;
      b.vy = rand(-220, 220);
      b.vz = 260;
      b.z = Math.max(b.z, 10);
      b.lastTouch = K;
      b.kind = 'clear';
      K.knock(0.9, this.dir * 140, 0, 'down');
      K.stats.saves++;
      m.popup(K.x, K.y, 56, '¡ATAJADÓN!', '#ffffff', 10);
      m.sfx('save');
      m.endSuperFx();
      m.onAerial(b);
    } else {
      if (Math.abs(K.y - b.y) < 70 && Math.abs(K.x - this.goalX) < 70) K.knock(1.4, this.dir * 520, rand(-60, 60), 'down');
      b.vx = this.dir * 620;
      b.vy = 0;
      b.vz = 0;
      b.kind = 'super';
    }
  }
}

/* =============================================================================
   09. INTELIGENCIA ARTIFICIAL (FSM)
   Estados: position · support · carry · receive · chase · press · mark · header
   La IA genera el mismo "intent" que un humano, así que puede ejecutar todas las
   acciones: pasar, regatear, barrer, golpe único, centrar, cabecear, Supertiro...
   ============================================================================= */

class AIBrain {
  constructor(p, P) {
    this.p = p;
    this.P = P;
    this.state = 'position';
    this.think = rand(0, P.react);
    this.plan = null;
    this.spot = null;
    this.aggroT = rand(0.3, 1);
    this.superRollT = 0;
  }

  get m() { return this.p.m; }

  update(dt) {
    const p = this.p;
    resetIntent(p.intent);
    if (this.aggroT > 0) this.aggroT -= dt;
    if (this.superRollT > 0) this.superRollT -= dt;
    if (this.m.state !== 'play' || p.state !== 'normal') return;
    const slowMind = p.buff.smoke > 0 ? 2.2 : 1;
    this.think -= dt;
    if (this.think <= 0) {
      this.think = this.P.react * rand(0.7, 1.3) * slowMind;
      this.decide();
    }
    this.execute(dt);
  }

  setState(s) {
    if (s !== this.state) {
      this.state = s;
      this.plan = null;
    }
  }

  decide() {
    const p = this.p;
    const m = this.m;
    const b = m.ball;
    const T = p.team;
    const H = m.header;
    if (H && !H.resolved && H.near(p)) {
      this.setState('header');
      return;
    }
    if (b.owner === p) {
      this.setState('carry');
      if (!this.plan) this.planCarry();
      return;
    }
    if (b.superShot) {
      this.setState('position');
      this.spot = this.formationSpot();
      return;
    }
    if (b.owner && b.owner.team === T) {
      this.setState('support');
      this.spot = this.supportSpot();
      return;
    }
    if (b.receiver === p) {
      this.setState('receive');
      return;
    }
    if (b.owner && b.owner.team !== T) {
      if (T.pressers.includes(p)) {
        this.setState('press');
        this.planDefense();
      } else {
        this.setState('mark');
      }
      return;
    }
    if (T.chaser === p) {
      this.setState('chase');
      return;
    }
    this.setState('position');
    this.spot = this.formationSpot();
  }

  execute(dt) {
    const p = this.p;
    const m = this.m;
    const b = m.ball;
    switch (this.state) {
      case 'carry':
        this.execCarry(dt);
        break;
      case 'support':
        this.moveTo(this.spot.x, this.spot.y, 0.95);
        break;
      case 'receive':
        if (b.z > 30 && m.landing) this.moveTo(m.landing.x, m.landing.y, 1);
        else this.moveTo(b.x + b.vx * 0.25, b.y + b.vy * 0.25, 1);
        break;
      case 'chase': {
        const t = clamp(distE(p, b) / (p.baseSpeed + 1), 0, 0.8);
        let tx = b.x + b.vx * t * 0.7;
        let ty = b.y + b.vy * t * 0.7;
        if (b.z > 30 && m.landing) {
          tx = m.landing.x;
          ty = m.landing.y;
        }
        this.moveTo(tx, ty, 1);
        break;
      }
      case 'press':
        this.execPress();
        break;
      case 'mark':
        this.execMark();
        break;
      case 'header': {
        const H = m.header;
        if (H) this.moveTo(H.lx, H.ly, 1);
        break;
      }
      default: {
        const s = this.spot || this.formationSpot();
        this.moveTo(s.x, s.y, 0.8);
      }
    }
  }

  moveTo(x, y, urgency = 1) {
    const p = this.p;
    const I = p.intent;
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 5) {
      const b = this.m.ball;
      p.dirX = b.x >= p.x ? 1 : -1;
      return;
    }
    const k = Math.min(1, d / 26) * urgency;
    I.mx = (dx / d) * k;
    I.my = (dy / d) * k;
  }

  /* ---------- Ataque con balón ---------- */
  planCarry() {
    const p = this.p;
    const m = this.m;
    const T = p.team;
    const P = this.P;
    const cy = CFG.FH / 2;
    const gx = T.oppGoalX;
    const dGoal = dist(p.x, p.y, gx, cy);
    const xTo = (gx - p.x) * T.dir;
    const near = m.nearestOpponent(p);
    const front = near.p ? (near.p.x - p.x) * T.dir > -6 : false;
    const pressure = near.d;
    const angleOk = Math.abs(p.y - cy) < xTo * 1.5 + 50;
    const range = (205 + p.st.pot * 14) * P.shootRange;
    const wide = xTo < 330 && Math.abs(p.y - cy) > 95;
    if (wide && m.teammateInBox(p) && chance(0.35 + P.passIQ * 0.35)) {
      this.plan = { type: 'cross' };
      return;
    }
    // El Supertiro se decide como mucho una vez cada 1,6 s (evita abusar de él)
    if (p.superReady && dGoal < 440 && dGoal > 90 && pressure > 48 && angleOk && this.superRollT <= 0) {
      this.superRollT = 1.6;
      if (chance(P.superUse * 0.45)) {
        this.plan = { type: 'super', t: 0 };
        return;
      }
    }
    if (dGoal < range && angleOk && (pressure > 28 || chance(0.55))) {
      this.plan = { type: 'shoot', t: 0, hold: rand(0.1, 0.55), aimY: this.aimY() };
      return;
    }
    if (pressure < 52 && front) {
      const r = Math.random();
      if (p.def.skill && p.t.skill <= 0 && r < P.skillUse * 0.45) {
        this.plan = { type: 'skill' };
        return;
      }
      if (p.t.dribble <= 0 && r < P.dribble) {
        this.plan = { type: 'dribble' };
        return;
      }
      const mate = this.bestPass();
      if (mate && chance(0.3 + P.passIQ * 0.6)) {
        this.plan = { type: 'pass', target: mate.p };
        return;
      }
    }
    const inCrossZone = xTo < 330 && Math.abs(p.y - cy) > 105;
    if (inCrossZone && m.teammateInBox(p) && chance(0.3 + P.passIQ * 0.4)) {
      this.plan = { type: 'cross' };
      return;
    }
    if (xTo > 640 && pressure < 70 && chance(0.2)) {
      this.plan = { type: 'cross' };
      return;
    }
    const mate = this.bestPass();
    if (mate && mate.score > this.spotScore(p) + 0.35 && chance(P.passIQ * 0.5)) {
      this.plan = { type: 'pass', target: mate.p };
      return;
    }
    this.plan = { type: 'dribbleTo', t: 0, dur: rand(0.3, 0.7) };
  }

  execCarry(dt) {
    const p = this.p;
    const I = p.intent;
    const pl = this.plan;
    const steer = this.carrySteer();
    if (!pl) {
      I.mx = steer.x;
      I.my = steer.y;
      return;
    }
    pl.t = (pl.t || 0) + dt;
    switch (pl.type) {
      case 'shoot':
        I.mx = steer.x * 0.3;
        I.my = steer.y * 0.3;
        if (pl.t <= dt * 1.01) I.shootPress = true;
        I.shootDown = pl.t < pl.hold;
        I.aimY = pl.aimY;
        if (pl.t >= pl.hold + 0.05) this.plan = null;
        break;
      case 'super':
        if (pl.t <= dt * 1.01) I.shootPress = true;
        I.shootDown = true;
        I.aimY = this.aimY();
        if (pl.t > 0.8) this.plan = null;
        break;
      case 'pass':
        I.pass = true;
        I.passTarget = pl.target;
        this.plan = null;
        break;
      case 'cross':
        I.cross = true;
        this.plan = null;
        break;
      case 'dribble': {
        const a = Math.atan2(steer.y, steer.x) + (chance(0.5) ? 1 : -1) * 0.9;
        I.mx = Math.cos(a);
        I.my = Math.sin(a);
        I.jump = true;
        this.plan = null;
        break;
      }
      case 'skill':
        I.skill = true;
        I.mx = steer.x;
        I.my = steer.y;
        this.plan = null;
        break;
      default:
        I.mx = steer.x;
        I.my = steer.y;
        if (pl.t > pl.dur) this.plan = null;
    }
  }

  /** Dirección hacia la portería esquivando rivales y bandas. */
  carrySteer() {
    const p = this.p;
    const T = p.team;
    const cy = CFG.FH / 2;
    const gx = T.oppGoalX - T.dir * 40;
    const gy = cy + (p.y - cy) * 0.3;
    let vx = gx - p.x;
    let vy = gy - p.y;
    let n = Math.hypot(vx, vy) || 1;
    vx /= n;
    vy /= n;
    for (const o of this.m.opponentsOf(T)) {
      const dx = p.x - o.x;
      const dy = p.y - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 90 && d > 0.1) {
        const ahead = (o.x - p.x) * T.dir > -10;
        const w = (1 - d / 90) * (ahead ? 1.6 : 0.6);
        vx += (dx / d) * w;
        vy += (dy / d) * w;
      }
    }
    if (p.y < 50) vy += 0.8;
    if (p.y > CFG.FH - 50) vy -= 0.8;
    n = Math.hypot(vx, vy) || 1;
    return { x: vx / n, y: vy / n };
  }

  aimY() {
    const K = this.m.teams[1 - this.p.team.idx].keeper;
    const cy = CFG.FH / 2;
    const side = K.y < cy ? 1 : -1;
    const acc = this.P.passIQ;
    return cy + side * CFG.GOAL_HALF * (0.45 + 0.35 * acc) + gauss() * (1 - acc) * 25;
  }

  spotScore(q) {
    const T = q.team;
    const adv = clamp(((q.x - T.ownGoalX) * T.dir) / CFG.FW, 0, 1);
    const open = clamp(this.m.nearestOpponent(q).d / 110, 0, 1);
    return adv * 0.7 + open * 0.6;
  }

  bestPass() {
    const p = this.p;
    const m = this.m;
    let best = null;
    for (const q of p.team.players) {
      if (q === p || q.state !== 'normal') continue;
      const d = distE(p, q);
      if (d < 40 || d > 460) continue;
      const score = this.spotScore(q) - (m.laneBlocked(p, q) ? 0.8 : 0) - d / 2000;
      if (!best || score > best.score) best = { p: q, score };
    }
    return best && best.score > 0.1 ? best : null;
  }

  /* ---------- Defensa ---------- */
  planDefense() {
    const p = this.p;
    const P = this.P;
    const c = this.m.ball.owner;
    if (!c || this.plan) return;
    const d = distE(p, c);
    if (this.aggroT > 0) return;
    this.aggroT = 0.35;
    if (d > 140) {
      if (p.def.skill && p.t.skill <= 0 && p.def.skill.kind === 'evade' && chance(P.skillUse * 0.25)) this.plan = { type: 'skill' };
      return;
    }
    const calm = lerp(1.9, 0.7, P.aggression) * rand(0.8, 1.2);
    if (p.t.attack <= 0 && d < p.def.unique.range + 20 && chance(P.aggression * 0.6)) {
      this.plan = { type: 'unique' };
      this.aggroT = calm;
      return;
    }
    if (p.t.slide <= 0 && d < 70 && chance(P.aggression * 0.5)) {
      this.plan = { type: 'slide' };
      this.aggroT = calm;
      return;
    }
    if (p.def.skill && p.t.skill <= 0 && p.def.skill.kind === 'defend' && d < 90 && chance(P.skillUse * 0.35)) {
      this.plan = { type: 'skill' };
    }
  }

  execPress() {
    const p = this.p;
    const I = p.intent;
    const c = this.m.ball.owner;
    if (!c) return;
    this.moveTo(c.x + c.vx * 0.22, c.y + c.vy * 0.22, 1);
    const d = distE(p, c);
    I.passHold = d < 60;
    const pl = this.plan;
    if (!pl) return;
    if (pl.type === 'slide' && d < 52) {
      I.mx = c.x - p.x;
      I.my = c.y - p.y;
      I.cross = true;
      this.plan = null;
    } else if (pl.type === 'unique' && d < p.def.unique.range) {
      I.mx = c.x - p.x;
      I.my = c.y - p.y;
      I.attack = true;
      this.plan = null;
    } else if (pl.type === 'skill') {
      I.skill = true;
      this.plan = null;
    }
  }

  execMark() {
    const p = this.p;
    const m = this.m;
    const T = p.team;
    const b = m.ball;
    const o = T.marks.get(p);
    if (b.free && b.speed > 150 && b.lastTouch && b.lastTouch.team !== T && distE(p, b) < 90) {
      this.moveTo(b.x + b.vx * 0.15, b.y + b.vy * 0.15, 1);
      return;
    }
    if (!o) {
      const s = this.formationSpot();
      this.moveTo(s.x, s.y, 0.8);
      return;
    }
    const gx = T.ownGoalX;
    const gy = CFG.FH / 2;
    let tx = o.x + (gx - o.x) * 0.18;
    let ty = o.y + (gy - o.y) * 0.18;
    tx = lerp(tx, b.x, 0.12);
    ty = lerp(ty, b.y, 0.12);
    this.moveTo(tx, ty, 0.95);
  }

  /* ---------- Posicionamiento ---------- */
  formationSpot() {
    const p = this.p;
    const T = p.team;
    const b = this.m.ball;
    const d = T.dir;
    const roleX = [0.24, 0.24, 0.5, 0.5][p.slot];
    const roleY = [0.3, 0.7, 0.36, 0.64][p.slot];
    const attacking = b.owner && b.owner.team === T;
    const shift = (b.x - CFG.FW / 2) * 0.5;
    const x = T.ownGoalX + d * roleX * CFG.FW + shift + (attacking ? d * 120 : -d * 40);
    const y = roleY * CFG.FH + (b.y - CFG.FH / 2) * 0.25;
    return { x: clamp(x, 60, CFG.FW - 60), y: clamp(y, 40, CFG.FH - 40) };
  }

  supportSpot() {
    const p = this.p;
    const m = this.m;
    const T = p.team;
    const b = m.ball;
    const d = T.dir;
    const fwd = p.slot >= 2;
    const c = b.owner;
    if (fwd && c && (T.oppGoalX - c.x) * d < 360 && Math.abs(c.y - CFG.FH / 2) > 90) {
      // El balón está en banda cerca del área: los delanteros atacan el área para el centro
      return { x: T.oppGoalX - d * rand(70, 135), y: CFG.FH / 2 + (p.slot === 2 ? -1 : 1) * rand(15, 60) };
    }
    let x = fwd ? T.oppGoalX - d * rand(150, 270) : CFG.FW / 2 - d * rand(40, 140);
    x = lerp(x, b.x + d * (fwd ? 160 : -60), 0.35);
    const y = [0.28, 0.72, 0.36, 0.64][p.slot] * CFG.FH;
    let best = { x, y, s: -1 };
    for (let i = 0; i < 6; i++) {
      const cx = x + rand(-60, 60);
      const cy = clamp(y + rand(-70, 70), 40, CFG.FH - 40);
      const s = m.nearestOpponentAt(cx, cy, T);
      if (s > best.s) best = { x: cx, y: cy, s };
    }
    return { x: clamp(best.x, 40, CFG.FW - 40), y: best.y };
  }
}

/* =============================================================================
   10. PARTIDO: REGLAS, CABEZAZOS "?", BARRA DE SUPERTIRO, CUT-IN, CELEBRACIONES, HUD
   ============================================================================= */

/**
 * Evento de centro aéreo: cuando el balón cae en un área, los jugadores cercanos
 * muestran "?" y se abre una ventana de timing. El mejor timing gana el cabezazo
 * (atacante = remate a portería, defensor = despeje, portero = atrapa).
 */
class HeaderEvent {
  constructor(m, pred, attTeam) {
    this.m = m;
    this.lx = pred.x;
    this.ly = pred.y;
    this.T = pred.t;
    this.t = 0;
    this.att = attTeam;
    this.resolved = false;
    this.locked = false;
    this.cands = new Set();
    this.presses = new Map();
    this.aiPlan = new Map();
    this.radius = 78;
    this.defKeeper = m.teams[1 - attTeam.idx].keeper;
  }

  get winStart() { return this.T - 0.42; }
  get winEnd() { return this.T + 0.14; }

  near(p) { return !p.keeper && dist(p.x, p.y, this.lx, this.ly) < this.radius + 60; }
  isCandidate(p) { return this.cands.has(p); }

  humanCandidate(T) {
    if (!T.human) return null;
    let best = null;
    let bd = 1e9;
    for (const p of this.cands) {
      if (p.team !== T || p.keeper) continue;
      const d = dist(p.x, p.y, this.lx, this.ly);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  update(dt) {
    const m = this.m;
    const b = m.ball;
    if (this.resolved) return;
    if (!b.free || b.inGoal) {
      this.cancel();
      return;
    }
    this.t += dt;
    if (!this.locked) {
      for (const p of m.fieldPlayers) {
        const ok = (p.state === 'normal' || p.state === 'action') && dist(p.x, p.y, this.lx, this.ly) < this.radius;
        if (ok) {
          this.cands.add(p);
          p.mark = '?';
        } else if (this.cands.has(p)) {
          this.cands.delete(p);
          p.mark = null;
        }
      }
      // El portero solo disputa los balones que caen en su área chica
      const K = this.defKeeper;
      const inSmall = Math.abs(this.lx - K.team.ownGoalX) < CFG.SMALL_X + 8 && Math.abs(this.ly - CFG.FH / 2) < CFG.SMALL_HALF;
      if (inSmall && K.state === 'normal' && !K.hasBall && dist(K.x, K.y, this.lx, this.ly) < 80) {
        this.cands.add(K);
        K.mark = '?';
      }
      if (this.t >= this.winStart - 0.05) {
        this.locked = true;
        for (const p of this.cands) {
          if (p.keeper) {
            this.aiPlan.set(p, this.T + gauss() * lerp(0.16, 0.04, p.skill));
            continue;
          }
          if (p.team.human) continue;
          const P = p.brain.P;
          if (chance(0.35 + P.participation * 0.65)) this.aiPlan.set(p, this.T + gauss() * P.headerSigma);
        }
      }
    }
    for (const [p, at] of this.aiPlan) if (this.t >= at && !this.presses.has(p)) this.press(p, true);
    // "Tiempo de anime": el balón queda suspendido un instante durante la ventana
    if (this.t >= this.T) {
      b.vz = Math.max(b.vz, -60);
      b.vx *= 0.9;
      b.vy *= 0.9;
    }
    if (this.t >= this.winEnd) this.resolve();
  }

  press(p, fromAI = false) {
    if (this.resolved) return false;
    if (!fromAI && p.team.human) {
      const c = this.humanCandidate(p.team);
      if (!c) return false;
      p = c;
    }
    if (!this.cands.has(p) || this.presses.has(p)) return false;
    this.presses.set(p, this.t);
    p.mark = this.t < this.winStart ? 'X' : '!';
    if (!p.keeper) {
      p.vz = 270;
      p.z = Math.max(p.z, 0.1);
    }
    this.m.sfx('jump');
    return true;
  }

  resolve() {
    this.resolved = true;
    const m = this.m;
    const b = m.ball;
    let best = null;
    let be = 1e9;
    for (const [p, t] of this.presses) {
      if (t < this.winStart) continue;
      if (p.state !== 'normal' && p.state !== 'action') continue;
      if (dist(p.x, p.y, b.x, b.y) > this.radius + 20) continue;
      // El atacante tiene una pequeña ventaja de timing (lo emocionante es rematar)
      const e = Math.abs(t - this.T) - (p.team === this.att ? 0.02 : 0);
      if (e < be - 0.005 || (Math.abs(e - be) <= 0.005 && p.team === this.att)) {
        be = e;
        best = p;
      }
    }
    for (const p of this.cands) p.mark = null;
    if (m.header === this) m.header = null;
    if (best) m.performHeader(best, Math.max(0, be), best.team === this.att);
  }

  cancel() {
    this.resolved = true;
    for (const p of this.cands) p.mark = null;
    if (this.m.header === this) this.m.header = null;
  }
}

/**
 * Barra de precisión estilo Mario Strikers: una aguja recorre el medidor y
 * hay que pulsar Tiro dentro de las 2 zonas (con núcleo crítico dorado).
 */
class SuperBar {
  constructor(m, p) {
    this.m = m;
    this.p = p;
    this.t = 0;
    this.dur = 1.2;
    this.needle = 0;
    this.finished = false;
    this.endT = 0;
    this.flash = 0;
    const w = 0.085 + p.st.tec * 0.006;
    this.zones = [
      { c: rand(0.3, 0.46), w, hit: null },
      { c: rand(0.66, 0.84), w, hit: null },
    ];
    this.ai = !p.team.human;
    this.aiTimes = [];
    if (this.ai) {
      const P = p.brain.P;
      this.zones.forEach((z) => this.aiTimes.push((z.c + gauss() * P.barSigma) * this.dur));
      this.aimY = p.brain.aimY();
    } else {
      this.aimY = null;
    }
  }

  update(dt) {
    if (this.finished) {
      this.endT += dt;
      if (this.endT > 0.22) this.m.resolveSuperBar(this);
      return;
    }
    this.t += dt;
    this.needle = this.t / this.dur;
    this.flash = Math.max(0, this.flash - dt);
    if (!this.ai) {
      const H = this.p.team.human;
      const ax = H.axis();
      if (Math.abs(ax.y) > 0.3) this.aimY = CFG.FH / 2 + Math.sign(ax.y) * CFG.GOAL_HALF * 0.72;
      if (H.pressed('shoot')) this.press();
    } else {
      const idx = this.zones.findIndex((z) => z.hit === null);
      if (idx >= 0 && this.t >= this.aiTimes[idx]) this.press();
    }
    for (const z of this.zones) {
      if (z.hit === null && this.needle > z.c + z.w / 2) {
        z.hit = 'miss';
        this.m.sfx('zoneMiss');
      }
    }
    if (this.needle >= 1 || this.zones.every((z) => z.hit !== null)) this.finished = true;
  }

  press() {
    const z = this.zones.find((q) => q.hit === null);
    if (!z) return;
    const d = Math.abs(this.needle - z.c);
    if (d <= z.w / 2) {
      z.hit = d <= z.w * 0.18 ? 'crit' : 'hit';
      this.m.sfx(z.hit === 'crit' ? 'zonePerfect' : 'zoneHit');
      this.flash = 0.15;
    } else {
      z.hit = 'miss';
      this.m.sfx('zoneMiss');
    }
  }

  draw(ctx) {
    const p = this.p;
    const W = 200;
    const H = 12;
    const cx = clamp(Math.round(projX(p.x, p.y)), W / 2 + 12, CFG.W - W / 2 - 12);
    const y = clamp(Math.round(projY(p.y, 0)) - 70, 46, CFG.H - 60);
    const x0 = cx - W / 2;
    const col = p.def.super.colors;
    ctx.save();
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    const label = '¡SUPERTIRO!';
    ctx.strokeText(label, cx, y - 6);
    ctx.fillStyle = Math.floor(this.t * 12) % 2 ? col[1] : '#ffffff';
    ctx.fillText(label, cx, y - 6);
    ctx.fillStyle = '#000';
    ctx.fillRect(x0 - 3, y - 3, W + 6, H + 6);
    const g = ctx.createLinearGradient(x0, 0, x0 + W, 0);
    g.addColorStop(0, '#24123d');
    g.addColorStop(1, '#3a1d66');
    ctx.fillStyle = g;
    ctx.fillRect(x0, y, W, H);
    for (const z of this.zones) {
      const zx = Math.round(x0 + (z.c - z.w / 2) * W);
      const zw = Math.round(z.w * W);
      const color = z.hit === 'miss' ? '#ff4d4d' : z.hit ? '#7dffb2' : '#3dff8f';
      ctx.fillStyle = color;
      ctx.fillRect(zx, y, zw, H);
      ctx.fillStyle = z.hit === 'crit' ? '#ffffff' : '#ffd23f';
      const cw = Math.max(2, Math.round(zw * 0.36));
      ctx.fillRect(Math.round(x0 + z.c * W - cw / 2), y, cw, H);
      if (z.hit) {
        ctx.fillStyle = '#000';
        ctx.textBaseline = 'top';
        ctx.fillText(z.hit === 'miss' ? 'X' : z.hit === 'crit' ? '★' : 'OK', zx + zw / 2, y + H + 5);
        ctx.fillStyle = z.hit === 'miss' ? '#ff4d4d' : '#ffd23f';
        ctx.fillText(z.hit === 'miss' ? 'X' : z.hit === 'crit' ? '★' : 'OK', zx + zw / 2 - 1, y + H + 4);
      }
    }
    const nx = Math.round(x0 + clamp(this.needle, 0, 1) * W);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(col[0], 0.6);
    ctx.fillRect(nx - 3, y - 6, 7, H + 12);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(nx - 1, y - 6, 3, H + 12);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 4})`;
      ctx.fillRect(x0, y, W, H);
    }
    ctx.restore();
  }
}

/** Celebraciones de gol: 5 coreografías que ejecutan los 4 jugadores de campo. */
class Celebration {
  constructor(m, team, scorer, type) {
    this.m = m;
    this.T = team;
    this.type = type;
    this.t = 0;
    this.ps = team.players.slice();
    if (scorer && this.ps.includes(scorer)) {
      this.ps.splice(this.ps.indexOf(scorer), 1);
      this.ps.unshift(scorer);
    }
    const ref = scorer || this.ps[0];
    this.cx = clamp(ref.x, 220, CFG.FW - 220);
    this.cy = clamp(ref.y, 130, CFG.FH - 150);
    if (type === 4) this.cy = clamp(ref.y, 110, 200);
    for (const p of this.ps) {
      p.state = 'celebrate';
      p.poseOverride = null;
      p.action = null;
      p.charging = false;
      p.mark = null;
      p.t.invuln = 6;
    }
    this.fired = new Set();
  }

  once(key, fn) {
    if (!this.fired.has(key)) {
      this.fired.add(key);
      fn();
    }
  }

  run(p, tx, ty, speed = 240) {
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d > 3) {
      const s = Math.min(speed, d * 6);
      p.vx = (dx / d) * s;
      p.vy = (dy / d) * s;
      if (Math.abs(dx) > 2) p.dirX = Math.sign(dx);
      return false;
    }
    p.vx = 0;
    p.vy = 0;
    return true;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const ps = this.ps;
    const m = this.m;
    const fx = m.particles;
    switch (this.type) {
      case 0: { // Pose Escuadrón Sentai
        ps.forEach((p, i) => {
          const tx = this.cx + (i - 1.5) * 30;
          const ty = this.cy;
          if (t < 1.3) this.run(p, tx, ty);
          else {
            p.vx = 0;
            p.vy = 0;
            p.x = lerp(p.x, tx, 0.2);
            p.y = lerp(p.y, ty, 0.2);
            p.dirX = i < 2 ? -1 : 1;
            p.poseOverride = t > 1.3 + i * 0.22 ? `sentai${i}` : 'idle0';
          }
        });
        ps.forEach((p, i) => {
          if (t > 1.3 + i * 0.22) this.once(`pose${i}`, () => { m.sfx('select'); fx.add({ x: p.x, y: p.y, z: 20, shape: 'ring', size: 3, size2: 22, life: 0.3, color: '#ffffff', lw: 2 }); });
        });
        if (t > 2.35) {
          this.once('boom', () => {
            const colors = ['#ff3b3b', '#2f80ff', '#ffd23f', '#21d07a'];
            ps.forEach((p, i) => fx.burst(p.x, p.y - 18, 4, 22, { speed: 70, vz0: 80, vz1: 240, colors: [colors[i], '#ffffff'], shape: 'circle', size: 8, life: 1.3, drag: 2.4, g: -30, back: true }));
            m.sfx('explosion', { vol: 0.6 });
            m.camera.shake(4, 0.3);
          });
        }
        break;
      }
      case 1: { // Salto sincronizado con puño al aire
        ps.forEach((p, i) => {
          const a = (i / ps.length) * TAU + 0.6;
          const tx = this.cx + Math.cos(a) * 24;
          const ty = this.cy + Math.sin(a) * 16;
          if (t < 1.2) this.run(p, tx, ty);
          else {
            p.vx = 0;
            p.vy = 0;
            p.dirX = p.x < this.cx ? 1 : -1;
            p.poseOverride = p.z > 1 ? 'cheer' : (t < 1.5 || (t > 2.3 && t < 2.5) ? 'charge' : 'cheer');
          }
        });
        [1.5, 2.5].forEach((k, j) => {
          if (t > k) {
            this.once(`j${j}`, () => {
              ps.forEach((p) => {
                p.vz = 390;
                p.z = 0.1;
              });
              m.sfx('jump');
              fx.burst(this.cx, this.cy, 50, 30, { speed: 140, colors: ['#ffd23f', '#ffffff', this.T.kit.ui], shape: 'star', size: 3, life: 0.9, add: true, vz0: 40, vz1: 160 });
            });
          }
        });
        break;
      }
      case 2: { // Baile retro en fila
        ps.forEach((p, i) => {
          const tx = this.cx - 45 + i * 30;
          const ty = this.cy + i * 5;
          if (t < 1.2) this.run(p, tx, ty);
          else {
            p.vx = 0;
            p.vy = 0;
            p.dirX = Math.floor((t - 1.2) / 1.1) % 2 ? -1 : 1;
            const beat = Math.floor((t - 1.2) / 0.27 + i * 0.5);
            p.poseOverride = beat % 2 ? 'dance1' : 'dance0';
            p.x = tx + Math.sin((t - 1.2) * 11.6 + i) * 3;
            p.y = ty;
          }
        });
        if (t > 1.2 && Math.floor(t * 4) !== Math.floor((t - dt) * 4)) {
          const p = pick(ps);
          fx.add({ x: p.x, y: p.y, z: 40, vz: 40, vx: rand(-20, 20), life: 1, shape: 'text', text: '♪', color: pick(['#ffd23f', '#ff2bd6', '#29f0ff']), font: '10px "Press Start 2P", monospace' });
        }
        break;
      }
      case 3: { // Reverencia / saludo al goleador
        const s = ps[0];
        this.run(s, this.cx, this.cy + 14);
        if (t > 1.0) {
          s.vx = 0;
          s.vy = 0;
          s.poseOverride = 'cheer';
          s.dirX = 1;
        }
        const spots = [[this.cx - 40, this.cy - 4], [this.cx + 40, this.cy - 4], [this.cx, this.cy - 34]];
        ps.slice(1).forEach((p, i) => {
          const [tx, ty] = spots[i];
          if (this.run(p, tx, ty) && t > 1.1) {
            p.dirX = p.x < s.x ? 1 : -1;
            p.poseOverride = i === 2 ? 'kneel' : 'bow';
          }
        });
        if (t > 1.1 && Math.random() < 0.5) {
          fx.add({ x: s.x + rand(-14, 14), y: s.y + rand(-4, 4), z: rand(10, 40), vz: 30, life: 0.7, shape: 'star', size: 2, color: '#ffd23f', add: true });
        }
        break;
      }
      case 4: // Deslizamiento de rodillas hacia la cámara
      default:
        ps.forEach((p, i) => {
          const tx = this.cx + (i - 1.5) * 34;
          if (t < 1.1) {
            this.run(p, tx, this.cy - 30, 300);
          } else if (t < 1.5) {
            p.poseOverride = null;
            p.vx = (tx - p.x) * 2;
            p.vy = 240;
            p.dirX = 1;
          } else {
            p.poseOverride = 'kneeslide';
            p.vy = Math.max(0, p.vy - 330 * dt);
            p.vx = 0;
            if (p.vy > 40 && Math.random() < 0.5) fx.add({ x: p.x + rand(-4, 4), y: p.y, z: 1, vz: 40, vx: rand(-30, 30), life: 0.5, size: 3, color: '#a3d977', shape: 'sq', g: 100 });
          }
          if (p.y > CFG.FH - 70) {
            p.y = CFG.FH - 70;
            p.vy = 0;
          }
        });
        break;
    }
  }

  end() {
    for (const p of this.ps) {
      p.state = 'normal';
      p.poseOverride = null;
      p.vz = 0;
      p.z = 0;
    }
  }
}

class Match {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = cfg;
    this.sound = game.sound;
    this.particles = new ParticleSystem(1400);
    this.fx = new ParticleSystem(600);
    this.camera = new Camera();
    this.ball = new Ball(this);
    this.teams = cfg.teams.map((tc, idx) => this.makeTeam(tc, idx));
    this.fieldPlayers = [...this.teams[0].players, ...this.teams[1].players];
    this.keepers = this.teams.map((T) => T.keeper);
    this.allPlayers = [...this.fieldPlayers, ...this.keepers];
    this.oppCache = this.teams.map((T) => {
      const O = this.teams[1 - T.idx];
      return O.players.concat([O.keeper]);
    });
    this.stadium = new Stadium({ sky: cfg.sky, teamColors: this.teams.map((T) => T.kit.ui) });
    this.hitboxes = [];
    this.clouds = [];
    this.header = null;
    this.superBar = null;
    this.cutin = null;
    this.celebration = null;
    this.state = 'kickoff';
    this.clock = cfg.minutes * 60;
    this.goldenGoal = false;
    this.timeScale = 1;
    this.slowTarget = 1;
    this.hitstop = 0;
    this.dark = 0;
    this.darkTarget = 0;
    this.flashA = 0;
    this.flashColor = '#ffffff';
    this.banner = null;
    this.goalInfo = null;
    this.lastCeleb = -1;
    this.roleT = 0;
    this.realT = 0;
    this.ended = false;
    this.landing = null;
    this.darkCanvas = makeCanvas(CFG.W, CFG.H);
    this.vignette = this.makeVignette();
    this.kickoff(chance(0.5) ? 0 : 1);
  }

  makeTeam(tc, idx) {
    const human = tc.human !== null && tc.human !== undefined ? new PlayerInput(this.game.input, tc.human) : null;
    const T = {
      idx, name: tc.name, short: tc.short, label: tc.label || '', kit: KITS[tc.kit],
      dir: idx === 0 ? 1 : -1, ownGoalX: idx === 0 ? 0 : CFG.FW, oppGoalX: idx === 0 ? CFG.FW : 0,
      human, ai: tc.ai || null, speedMul: human ? 1 : (tc.ai ? tc.ai.speedMul : 1),
      keeperSkill: tc.keeperSkill, players: [], keeper: null, controlled: null, score: 0,
      pressers: [], chaser: null, marks: new Map(), scorers: [], switchCD: 0,
    };
    T.players = tc.roster.map((id, i) => {
      const p = new Player(this, T, ROSTER_BY_ID[id], i);
      p.brain = new AIBrain(p, human ? TEAMMATE_AI : tc.ai);
      return p;
    });
    T.keeper = new Goalkeeper(this, T);
    return T;
  }

  makeVignette() {
    const c = makeCanvas(CFG.W, CFG.H);
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(CFG.W / 2, CFG.H / 2, CFG.H * 0.35, CFG.W / 2, CFG.H / 2, CFG.W * 0.62);
    rg.addColorStop(0, 'rgba(0,0,0,0)');
    rg.addColorStop(1, 'rgba(5,0,15,0.5)');
    g.fillStyle = rg;
    g.fillRect(0, 0, CFG.W, CFG.H);
    return c;
  }

  /* ---------- Utilidades ---------- */
  sfx(name, o) { this.sound.sfx(name, o); }
  opponentsOf(T) { return this.oppCache[T.idx]; }

  nearestOpponent(p) {
    let best = null;
    let bd = 1e9;
    for (const o of this.oppCache[p.team.idx]) {
      const d = distE(p, o);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return { p: best, d: bd };
  }

  nearestOpponentAt(x, y, T) {
    let bd = 1e9;
    for (const o of this.oppCache[T.idx]) bd = Math.min(bd, dist(x, y, o.x, o.y));
    return bd;
  }

  nearestTo(list, target) {
    let best = null;
    let bd = 1e9;
    for (const q of list) {
      const d = distE(q, target);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  laneBlocked(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1;
    for (const o of this.oppCache[a.team.idx]) {
      const t = ((o.x - a.x) * dx + (o.y - a.y) * dy) / L2;
      if (t < 0.1 || t > 0.9) continue;
      if (dist(o.x, o.y, a.x + dx * t, a.y + dy * t) < 16) return true;
    }
    return false;
  }

  teammateInBox(p) {
    const T = p.team;
    const cy = CFG.FH / 2;
    return T.players.some((q) => q !== p && (T.oppGoalX - q.x) * T.dir < CFG.BOX_X + 30 && Math.abs(q.y - cy) < CFG.BOX_HALF);
  }

  popup(x, y, z, text, color = '#ffd23f', size = 8) {
    this.particles.text(x, y, z, text, color, size, 1.1);
  }

  flash(a, color = '#ffffff') {
    this.flashA = Math.max(this.flashA, a);
    this.flashColor = color;
  }

  showBanner(text, sub = '', dur = 1.6, color = '#ffd23f') {
    this.banner = { text, sub, t: 0, dur, color };
  }

  afterimage(p, alpha = 0.35) {
    const img = this.game.sprites.get(p.def, p.team.kit, p.pose, p.dirX < 0);
    this.particles.add({ x: p.x, y: p.y, z: p.z, shape: 'sprite', img, life: 0.22, alpha, add: true });
  }

  explosionFx(x, y, z, colors, scale = 1) {
    this.particles.burst(x, y, z, Math.round(30 * scale), { speed: 200 * scale, colors, life: 0.7, size: 4, shape: 'circle', add: true, drag: 2.5, vz0: -40, vz1: 160 });
    this.particles.burst(x, y, z, Math.round(16 * scale), { speed: 260 * scale, colors: ['#ffffff'], life: 0.4, size: 2, shape: 'spark', add: true });
    this.particles.add({ x, y, z: z + 4, shape: 'ring', size: 4, size2: 46 * scale, life: 0.45, color: colors[0], lw: 3, add: true });
  }

  addHitbox(o) {
    const h = Object.assign({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 12, life: 0.2, delay: 0, follow: false, off: 0, effect: null, kind: 'generic', color: '#ffffff', ground: false, gravity: false, onExpire: null, angle: 0 }, o);
    h.max = h.life;
    h.hit = new Set();
    if (h.follow || h.fromOwner) {
      h.x = h.owner.x + Math.cos(h.owner.face) * h.off;
      h.y = h.owner.y + Math.sin(h.owner.face) * h.off;
    }
    this.hitboxes.push(h);
    return h;
  }

  addCloud(x, y, team, dur, r) {
    this.clouds.push({ x, y, team, t: 0, dur, r });
    this.particles.burst(x, y, 10, 30, { speed: 120, life: 0.8, size: 8, colors: ['#e9ecef', '#ced4da', '#adb5bd'], shape: 'circle', drag: 3, alpha: 0.7 });
  }

  /* ---------- Saque inicial ---------- */
  kickoff(teamIdx) {
    this.state = 'kickoff';
    this.kickT = 0;
    this.kickTeam = teamIdx;
    if (this.celebration) {
      this.celebration.end();
      this.celebration = null;
    }
    this.hitboxes.length = 0;
    this.clouds.length = 0;
    if (this.header) this.header.cancel();
    this.header = null;
    this.superBar = null;
    this.cutin = null;
    this.sound.stopCharge();
    this.particles.clear();
    this.darkTarget = 0;
    this.slowTarget = 1;
    this.timeScale = 1;
    this.goalInfo = null;
    const b = this.ball;
    b.reset(CFG.FW / 2, CFG.FH / 2);
    const cy = CFG.FH / 2;
    for (const T of this.teams) {
      const d = T.dir;
      const own = T.ownGoalX;
      const spots = [[own + d * 190, 150], [own + d * 190, 310], [own + d * 380, 175], [own + d * 380, 285]];
      T.players.forEach((p, i) => {
        this.resetPlayer(p, spots[i][0], spots[i][1]);
      });
      this.resetPlayer(T.keeper, own + d * 16, cy);
      T.keeper.holdT = 0;
    }
    const K = this.teams[teamIdx];
    const kicker = K.players[2];
    kicker.x = CFG.FW / 2 - K.dir * 12;
    kicker.y = cy;
    const mate = K.players[3];
    mate.x = CFG.FW / 2 - K.dir * 50;
    mate.y = cy + 55;
    b.owner = kicker;
    b.lastTouch = kicker;
    for (const T of this.teams) T.controlled = T.human ? (T === K ? kicker : T.players[2]) : null;
    this.camera.follow(CFG.FW / 2, true);
  }

  resetPlayer(p, x, y) {
    Object.assign(p, { x, y, z: 0, vx: 0, vy: 0, vz: 0, state: 'normal', stateT: 0, action: null, poseOverride: null, charging: false, pressing: false, mark: null });
    p.face = p.team.dir > 0 ? 0 : Math.PI;
    p.dirX = p.team.dir;
    p.t.invuln = 0;
    p.t.pickup = 0;
    p.t.header = 0;
    for (const k in p.buff) p.buff[k] = 0;
    resetIntent(p.intent);
    if (p.brain) {
      p.brain.plan = null;
      p.brain.state = 'position';
    }
  }

  /* ---------- Bucle del partido ---------- */
  update(dt) {
    if (this.ended) return;
    this.realT += dt;
    this.fx.update(dt);
    this.flashA = Math.max(0, this.flashA - dt * 2.2);
    this.dark = approach(this.dark, this.darkTarget, dt * 3);
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
    if (this.cutin) {
      this.updateCutin(dt);
      this.camera.update(dt);
      this.stadium.update(dt);
      return;
    }
    if (this.superBar) {
      this.superBar.update(dt);
      if (this.superBar) this.spawnEnergy();
    }
    this.timeScale = approach(this.timeScale, this.slowTarget, dt * 5);
    let wdt = dt * this.timeScale;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      wdt = 0;
    }
    switch (this.state) {
      case 'kickoff':
        this.updateKickoff(dt);
        break;
      case 'play':
        if (wdt > 0) this.updatePlay(wdt);
        break;
      case 'goal':
        this.updateGoal(wdt, dt);
        break;
      case 'fulltime':
        this.updateFulltime(dt);
        break;
      default:
        break;
    }
    this.particles.update(wdt);
    this.stadium.update(dt);
    this.camera.update(dt);
  }

  updateKickoff(dt) {
    this.kickT += dt;
    for (const p of this.allPlayers) {
      resetIntent(p.intent);
      if (p.keeper) {
        p.vx = 0;
        p.vy = 0;
        p.updateAnim(dt);
      } else {
        p.update(dt);
      }
    }
    this.ball.update(dt);
    if (this.kickT > 0.05 && !this.kickSaid) {
      this.kickSaid = true;
      this.showBanner('¡LISTOS!', `${this.teams[this.kickTeam].name} saca`, 1.0, '#ffffff');
      this.sfx('countdown');
    }
    if (this.kickT > 1.25) {
      this.kickSaid = false;
      this.state = 'play';
      this.showBanner(this.goldenGoal ? '¡GOL DE ORO!' : '¡A JUGAR!', '', 0.8, '#ffd23f');
      this.sfx('whistle');
      this.sfx('go');
    }
  }

  updatePlay(dt) {
    this.roleT -= dt;
    if (this.roleT <= 0) {
      this.roleT = 0.15;
      this.updateRoles();
    }
    for (const T of this.teams) if (T.human) this.updateHuman(T, dt);
    for (const p of this.fieldPlayers) {
      if (!(p.team.human && p === p.team.controlled)) p.brain.update(dt);
    }
    for (const p of this.allPlayers) p.update(dt);
    this.updateHitboxes(dt);
    this.updateClouds(dt);
    this.ball.update(dt);
    if (this.ball.superShot) this.ball.superShot.update(dt);
    this.checkPossession();
    this.checkKeeperSaves();
    this.updatePressure(dt);
    if (this.header) this.header.update(dt);
    this.separatePlayers();
    const b = this.ball;
    this.landing = b.free && b.z > 25 ? this.predictZ(b, 0) : null;
    if (!this.superBar && !this.cutin && !b.superShot && this.darkTarget > 0) this.endSuperFx();
    if (!this.goldenGoal && this.state === 'play') {
      this.clock = Math.max(0, this.clock - dt);
      // El silbatazo final espera a que termine un Supertiro o un cabezazo en curso
      if (this.clock <= 0 && !b.superShot && !this.header && !this.superBar) this.onTimeUp();
    }
    const focus = this.superBar ? this.superBar.p.x : b.x + b.vx * 0.15;
    this.camera.follow(focus);
  }

  /** Roles de equipo para la IA: quién presiona, quién persigue y a quién se marca. */
  updateRoles() {
    const b = this.ball;
    for (const T of this.teams) {
      const field = T.players.filter((q) => q.state !== 'down' && q.state !== 'dizzy');
      const ai = field.filter((q) => !(T.human && q === T.controlled));
      T.pressers = [];
      T.chaser = null;
      T.marks.clear();
      if (b.owner && b.owner.team !== T) {
        const sorted = ai.slice().sort((a, c) => distE(a, b) - distE(c, b));
        if (T.human) {
          if (sorted[0] && distE(sorted[0], b) < 120) T.pressers = [sorted[0]];
        } else {
          T.pressers = sorted.slice(0, T.ai.aggression > 0.6 ? 2 : 1);
        }
        const opps = this.teams[1 - T.idx].players.filter((o) => o !== b.owner);
        opps.sort((a, c) => Math.abs(a.x - T.ownGoalX) - Math.abs(c.x - T.ownGoalX));
        const free = ai.filter((q) => !T.pressers.includes(q));
        for (const o of opps) {
          let bestQ = null;
          let bd = 1e9;
          for (const q of free) {
            if (T.marks.has(q)) continue;
            const dd = distE(q, o);
            if (dd < bd) {
              bd = dd;
              bestQ = q;
            }
          }
          if (bestQ) T.marks.set(bestQ, o);
        }
      } else if (!b.owner) {
        let best = null;
        let bt = 1e9;
        for (const q of field) {
          const t = distE(q, b) / q.baseSpeed;
          if (t < bt) {
            bt = t;
            best = q;
          }
        }
        T.chaser = T.human && best === T.controlled ? null : best;
      }
    }
  }

  /** Control humano: cambio de jugador, presión e intent desde teclado/mando. */
  updateHuman(T, dt) {
    const H = T.human;
    const b = this.ball;
    let c = T.controlled;
    T.switchCD = Math.max(0, T.switchCD - dt);
    const active = (q) => q.state === 'normal' || q.state === 'action';
    if (b.owner && b.owner.team === T && !b.owner.keeper) c = b.owner;
    else if (b.receiver && b.receiver.team === T && b.free) c = b.receiver;
    else if (this.header && this.header.humanCandidate(T)) c = this.header.humanCandidate(T);
    if (!c || c.keeper) c = this.nearestTo(T.players, b);
    let consumedJ = false;
    if (!b.owner || b.owner.team !== T) {
      if (H.pressed('pass') && !(this.header && this.header.isCandidate(c))) {
        const n = this.nearestTo(T.players.filter(active), b);
        if (n && n !== c && distE(n, b) < distE(c, b) - 8) {
          c = n;
          consumedJ = true;
          this.sfx('move');
        }
      }
      if (T.switchCD <= 0 && !consumedJ && !(b.receiver && b.receiver.team === T)) {
        const n = this.nearestTo(T.players.filter(active), b);
        if (n && n !== c && distE(c, b) > 190 && distE(n, b) < distE(c, b) - 90) {
          c = n;
          T.switchCD = 0.8;
        }
      }
      if (!active(c)) {
        const n = this.nearestTo(T.players.filter(active), b);
        if (n) c = n;
      }
    }
    if (c !== T.controlled) {
      T.controlled = c;
      T.switchCD = Math.max(T.switchCD, 0.35);
      if (c.brain) c.brain.plan = null;
    }
    const I = c.intent;
    resetIntent(I);
    const ax = H.axis();
    I.mx = ax.x;
    I.my = ax.y;
    const combo = H.skillPressed();
    I.skill = combo;
    I.pass = H.pressed('pass') && !consumedJ;
    I.passHold = H.down('pass');
    I.shootPress = H.pressed('shoot');
    I.shootDown = H.down('shoot');
    I.cross = H.pressed('cross');
    I.attack = H.pressed('attack') && !combo && !H.down('jump');
    I.jump = H.pressed('jump') && !combo && !H.down('attack');
    I.aimY = Math.abs(ax.y) > 0.3 ? CFG.FH / 2 + Math.sign(ax.y) * CFG.GOAL_HALF * 0.72 : null;
  }

  /* ---------- Balón: paredes, goles, posesión ---------- */
  ballWalls(b) {
    const { FW, FH, GOAL_HALF, GOAL_H, GOAL_D } = CFG;
    const gy0 = FH / 2 - GOAL_HALF;
    const gy1 = FH / 2 + GOAL_HALF;
    if (b.inGoal) {
      const side = b.goalSide;
      const back = side === 0 ? -GOAL_D + 3 : FW + GOAL_D - 3;
      if ((side === 0 && b.x < back) || (side === 1 && b.x > back)) {
        b.x = back;
        this.stadium.hitNet(side, b.y, b.z, clamp(Math.abs(b.vx) / 50, 3, 14));
        b.vx = -b.vx * 0.15;
      }
      if (side === 0 && b.x > -2) { b.x = -2; b.vx = -Math.abs(b.vx) * 0.2; }
      if (side === 1 && b.x < FW + 2) { b.x = FW + 2; b.vx = Math.abs(b.vx) * 0.2; }
      if (b.y < gy0 + 3) { b.y = gy0 + 3; b.vy = Math.abs(b.vy) * 0.3; }
      if (b.y > gy1 - 3) { b.y = gy1 - 3; b.vy = -Math.abs(b.vy) * 0.3; }
      if (b.z > GOAL_H - 5) { b.z = GOAL_H - 5; b.vz = -Math.abs(b.vz) * 0.3; }
      return;
    }
    if (b.y < 3) {
      b.y = 3;
      b.vy = Math.abs(b.vy) * 0.72;
    }
    if (b.y > FH - 3) {
      b.y = FH - 3;
      b.vy = -Math.abs(b.vy) * 0.72;
    }
    for (const side of [0, 1]) {
      const crossing = side ? b.x > FW - 2 : b.x < 2;
      if (!crossing) continue;
      const inMouth = b.y > gy0 + 2 && b.y < gy1 - 2 && b.z < GOAL_H - 2;
      if (inMouth) {
        b.inGoal = true;
        b.goalSide = side;
        this.onGoal(side === 0 ? 1 : 0);
        return;
      }
      const nearPost = (Math.abs(b.y - gy0) < 6 || Math.abs(b.y - gy1) < 6) && b.z < GOAL_H;
      const onBar = b.y > gy0 && b.y < gy1 && b.z >= GOAL_H - 2 && b.z < GOAL_H + 6;
      if ((nearPost || onBar) && b.speed > 150) {
        this.sfx('post');
        this.popup(b.x, b.y, b.z + 20, '¡AL PALO!', '#ffffff', 7);
        this.camera.shake(2, 0.15);
        b.vy += rand(-120, 120);
        if (onBar) b.vz = -Math.abs(b.vz) * 0.5 + 60;
      }
      b.x = side ? FW - 2 : 2;
      b.vx = -b.vx * 0.62;
      b.checkedBy = null;
    }
  }

  checkPossession() {
    const b = this.ball;
    if (!b.free || b.inGoal) return;
    if (this.header && !this.header.resolved && b.z > 22) return;
    let best = null;
    let bd = 1e9;
    for (const p of this.allPlayers) {
      if (p.t.pickup > 0) continue;
      if (!(p.state === 'normal' || p.state === 'slide' || p.state === 'action')) continue;
      const r = p.keeper ? 15 : 12;
      const d = dist(p.x, p.y, b.x, b.y);
      const reachZ = p.z + (p.keeper ? 40 : 24);
      if (d < r && b.z <= reachZ && b.z >= p.z - 6 && d < bd) {
        best = p;
        bd = d;
      }
    }
    if (!best) return;
    const own = b.lastTouch && b.lastTouch.team === best.team;
    if (best.keeper) {
      if (b.speed > 300 && (b.kind === 'shot' || b.kind === 'super') && !own) return;
      this.keeperCatch(best, false);
      return;
    }
    if (b.speed > 560 && b.receiver !== best) {
      b.vx *= -0.35;
      b.vy = b.vy * 0.4 + rand(-120, 120);
      b.vz = rand(60, 160);
      b.lastTouch = best;
      b.kind = 'loose';
      b.receiver = null;
      best.t.pickup = 0.25;
      b.checkedBy = null;
      this.sfx('hit', { vol: 0.5 });
      this.particles.burst(b.x, b.y, b.z + 4, 8, { speed: 80, colors: ['#ffffff'], life: 0.3, size: 2, shape: 'spark', add: true });
      return;
    }
    this.givePossession(best);
  }

  givePossession(p) {
    const b = this.ball;
    b.owner = p;
    b.receiver = null;
    b.kind = null;
    b.lastTouch = p;
    b.checkedBy = null;
    b.trail.length = 0;
    if (p.team.human && !p.keeper) p.team.controlled = p;
    if (this.header) this.header.cancel();
    if (p.brain) p.brain.plan = null;
    this.sfx('pass', { vol: 0.4 });
  }

  looseBall(p, ang, pop) {
    const b = this.ball;
    b.owner = null;
    b.x = p.x + Math.cos(ang) * 6;
    b.y = p.y + Math.sin(ang) * 6;
    b.vx = Math.cos(ang) * pop + rand(-40, 40);
    b.vy = Math.sin(ang) * pop + rand(-40, 40);
    b.vz = 140;
    b.z = Math.max(b.z, 1);
    b.lastTouch = p;
    b.kind = 'loose';
    b.receiver = null;
    p.t.pickup = 0.6;
  }

  /** Paradas: el portero intenta atajar o desviar los tiros que llegan a su alcance. */
  checkKeeperSaves() {
    const b = this.ball;
    if (!b.free || b.inGoal) return;
    for (const K of this.keepers) {
      if (b.checkedBy === K) continue;
      if (K.state === 'down' || K.state === 'dizzy' || K.state === 'recover') continue;
      const diving = K.state === 'dive';
      const rx = diving ? 15 : 12;
      const ry = diving ? 28 : 14;
      if (Math.abs(b.x - K.x) > rx || Math.abs(b.y - K.y) > ry || b.z > (diving ? 42 : 50)) continue;
      b.checkedBy = K;
      const fast = b.speed;
      const own = b.lastTouch && b.lastTouch.team === K.team;
      if (fast < 300 || own) {
        this.keeperCatch(K, !own && fast > 200);
        continue;
      }
      let p = K.skill * 1.15 - (fast - 500) / 1100 + (diving ? -0.02 : 0.12);
      if (b.charged) p -= 0.22;
      p = clamp(p, 0.06, 0.94);
      if (chance(p)) {
        if (fast < 560 + K.skill * 160 && chance(0.6)) this.keeperCatch(K, true);
        else this.keeperParry(K);
      } else {
        b.vx *= 0.82;
        b.vy *= 0.82;
        this.popup(K.x, K.y, 50, '¡SE LE ESCAPA!', '#ff8fa3', 6);
      }
    }
  }

  keeperCatch(K, isSave = true) {
    const b = this.ball;
    b.owner = K;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
    b.receiver = null;
    b.kind = null;
    b.lastTouch = K;
    K.holdT = rand(0.6, 1.1);
    K.state = 'normal';
    if (this.header) this.header.cancel();
    if (isSave) {
      K.stats.saves++;
      this.popup(K.x, K.y, 52, '¡ATAJADA!', '#ffffff', 8);
      this.sfx('save');
    }
  }

  keeperParry(K) {
    const b = this.ball;
    const d = K.team.dir;
    b.vx = Math.abs(b.vx) * 0.3 * d + d * 140;
    b.vy = rand(-1, 1) * 260;
    b.vz = 220;
    b.lastTouch = K;
    b.kind = 'clear';
    b.checkedBy = K;
    K.stats.saves++;
    this.popup(K.x, K.y, 52, '¡DESVÍO!', '#ffffff', 8);
    this.sfx('save');
    this.camera.shake(3, 0.2);
    this.onAerial(b);
  }

  keeperClaim(K, carrier) {
    const ang = Math.atan2(carrier.y - K.y, carrier.x - K.x);
    carrier.knock(0.35, Math.cos(ang) * 120, Math.sin(ang) * 120, 'dizzy');
    this.keeperCatch(K, false);
    this.popup(K.x, K.y, 52, '¡ROBADA!', '#ffffff', 7);
  }

  keeperDistribute(K) {
    const T = K.team;
    const b = this.ball;
    let best = null;
    let bs = -1e9;
    for (const q of T.players) {
      if (q.state !== 'normal') continue;
      const open = this.nearestOpponent(q).d;
      const adv = (q.x - T.ownGoalX) * T.dir;
      const s = open * 1.2 + adv * 0.15 - Math.abs(q.y - CFG.FH / 2) * 0.05;
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    K.holdT = 0;
    if (!best || chance(0.35)) {
      const tgt = best || T.players[2];
      const tx = clamp(tgt.x + T.dir * 60, 80, CFG.FW - 80);
      const ty = tgt.y;
      const Tf = 1.1;
      const k = 0.12;
      const f = (1 - Math.exp(-k * Tf)) / k;
      b.kick(K, (tx - b.x) / f, (ty - b.y) / f, 0.5 * CFG.GRAVITY * Tf, 'clear');
      this.sfx('kick');
      this.onAerial(b);
    } else {
      this.doPass(K, best);
    }
    K.t.pickup = 0.6;
  }

  /* ---------- Acciones con balón ---------- */
  doPass(p, target = null) {
    const b = this.ball;
    const T = p.team;
    if (!target) target = this.choosePassTarget(p);
    if (!target) return;
    const tx = target.x + target.vx * 0.28;
    const ty = target.y + target.vy * 0.28;
    const d = dist(b.x, b.y, tx, ty);
    const speed = clamp(330 + p.st.tec * 10 + d * 0.55, 340, 640);
    const a = Math.atan2(ty - b.y, tx - b.x) + gauss() * (10 - p.st.tec) * 0.006;
    b.kick(p, Math.cos(a) * speed, Math.sin(a) * speed, d > 260 ? 90 : 0, 'pass');
    b.receiver = target;
    p.face = a;
    if (Math.abs(Math.cos(a)) > 0.2) p.dirX = Math.sign(Math.cos(a));
    if (T.human) T.controlled = target;
    this.sfx('pass');
  }

  choosePassTarget(p) {
    const I = p.intent;
    const aim = Math.hypot(I.mx, I.my) > 0.2 ? Math.atan2(I.my, I.mx) : p.face;
    let best = null;
    let bs = -1e9;
    for (const q of p.team.players) {
      if (q === p) continue;
      const d = distE(p, q);
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const diff = Math.abs(angleDiff(aim, ang));
      const s = Math.cos(diff) * 2 - d / 400 - (this.laneBlocked(p, q) ? 0.6 : 0) - (q.state !== 'normal' ? 1 : 0);
      if (s > bs) {
        bs = s;
        best = q;
      }
    }
    return best;
  }

  doShot(p, power, aimY, opts = {}) {
    const b = this.ball;
    const T = p.team;
    const cy = CFG.FH / 2;
    const K = this.teams[1 - T.idx].keeper;
    let ty = aimY;
    if (ty === null || ty === undefined) {
      ty = (K.y < cy ? cy + CFG.GOAL_HALF * 0.55 : cy - CFG.GOAL_HALF * 0.55) + rand(-14, 14);
    }
    const tx = T.oppGoalX;
    const d = dist(b.x, b.y, tx, ty);
    const err = (0.02 + (10 - p.st.tec) * 0.012 + d / 6000 + (opts.fail ? 0.35 : 0)) * (opts.charged ? 0.5 : 1);
    const a = Math.atan2(ty - b.y, tx - b.x) + gauss() * err;
    let speed = 470 + p.st.pot * 26 * power + power * 110;
    if (opts.charged) speed += 220;
    if (opts.fail) speed *= 0.6;
    if (opts.volley) speed *= 0.95;
    const vz = (opts.charged ? 40 : 30 + power * 60) + rand(0, 40) + d * 0.04;
    b.kick(p, Math.cos(a) * speed, Math.sin(a) * speed, vz, 'shot');
    b.charged = !!opts.charged;
    p.face = a;
    p.dirX = Math.cos(a) >= 0 ? 1 : -1;
    this.sfx('shot');
    this.camera.shake(opts.charged ? 4 : 2, 0.15);
    this.particles.burst(b.x, b.y, b.z + 4, opts.charged ? 18 : 8, { speed: 120, colors: opts.charged ? ['#ffb703', '#ffffff'] : ['#ffffff'], life: 0.3, size: 2, shape: 'spark', add: true, angle: a + Math.PI, spread: 0.8 });
  }

  tryVolley(p, aimY) {
    const b = this.ball;
    if (!b.free || b.inGoal || p.t.pickup > 0) return false;
    if (dist(p.x, p.y, b.x, b.y) > 22 || b.z > 34) return false;
    this.doShot(p, 0.85, aimY, { volley: true });
    this.popup(p.x, p.y, 44, '¡VOLEA!', '#ffd23f', 6);
    return true;
  }

  doCross(p) {
    const b = this.ball;
    const T = p.team;
    const cy = CFG.FH / 2;
    const d = T.dir;
    const xTo = (T.oppGoalX - p.x) * d;
    let tx;
    let ty;
    let Tf;
    let zEnd;
    let receiver = null;
    // Centro aéreo: cerca del área rival o pegado a la banda en campo contrario
    if (xTo < 360 || (xTo < CFG.FW * 0.6 && Math.abs(p.y - cy) > 160)) {
      const mates = T.players.filter((q) => q !== p);
      const inBox = mates.filter((q) => (T.oppGoalX - q.x) * d < CFG.BOX_X + 40 && Math.abs(q.y - cy) < CFG.BOX_HALF);
      const tgt = inBox.length ? pick(inBox) : null;
      tx = T.oppGoalX - d * rand(70, 120);
      ty = tgt ? clamp(tgt.y + rand(-20, 20), cy - 80, cy + 80) : cy + rand(-60, 60);
      if (tgt) tx = lerp(tx, tgt.x + d * 20, 0.5);
      Tf = clamp(dist(b.x, b.y, tx, ty) / 400, 0.8, 1.5);
      zEnd = CFG.HEAD_Z;
      this.popup(p.x, p.y, 44, '¡CENTRO!', T.kit.ui, 7);
    } else {
      const fwd = T.players.filter((q) => q !== p).sort((a, c) => (c.x - a.x) * d)[0];
      tx = clamp(fwd.x + fwd.vx * 0.5 + d * 30, 30, CFG.FW - 30);
      ty = clamp(fwd.y + fwd.vy * 0.5, 30, CFG.FH - 30);
      Tf = clamp(dist(b.x, b.y, tx, ty) / 360, 0.6, 1.4);
      zEnd = 0;
      receiver = fwd;
      if (T.human) T.controlled = fwd;
    }
    const k = 0.12;
    const f = (1 - Math.exp(-k * Tf)) / k;
    const vz = (zEnd + 0.5 * CFG.GRAVITY * Tf * Tf) / Tf;
    b.kick(p, (tx - b.x) / f, (ty - b.y) / f, vz, 'cross');
    b.receiver = receiver;
    p.face = Math.atan2(ty - b.y, tx - b.x);
    p.dirX = Math.cos(p.face) >= 0 ? 1 : -1;
    this.sfx('kick');
    this.onAerial(b);
  }

  /* ---------- Sistema aéreo y cabezazos ---------- */
  predictZ(b, zTarget) {
    let x = b.x;
    let y = b.y;
    let z = b.z;
    let vx = b.vx;
    let vy = b.vy;
    let vz = b.vz;
    let t = 0;
    const dt = 1 / 120;
    const f = Math.exp(-0.12 * dt);
    while (t < 3) {
      vz -= CFG.GRAVITY * dt;
      x += vx * dt;
      y += vy * dt;
      z += vz * dt;
      vx *= f;
      vy *= f;
      t += dt;
      if (vz < 0 && z <= zTarget) return { x, y, t };
    }
    return null;
  }

  onAerial(b) {
    if (b.vz < 180 || this.state !== 'play') return;
    const pred = this.predictZ(b, CFG.HEAD_Z);
    if (!pred || pred.t < 0.45) return;
    const cy = CFG.FH / 2;
    for (const T of this.teams) {
      if (Math.abs(pred.x - T.ownGoalX) < CFG.BOX_X + 25 && Math.abs(pred.y - cy) < CFG.BOX_HALF + 25) {
        if (this.header) this.header.cancel();
        this.header = new HeaderEvent(this, pred, this.teams[1 - T.idx]);
        return;
      }
    }
  }

  performHeader(p, err, attacking) {
    const b = this.ball;
    const T = p.team;
    const cy = CFG.FH / 2;
    if (p.keeper) {
      this.keeperCatch(p, true);
      this.popup(p.x, p.y, 56, '¡ATRAPADA!', '#ffffff', 7);
      return;
    }
    p.x = lerp(p.x, b.x, 0.7);
    p.y = lerp(p.y, b.y, 0.7);
    p.z = Math.max(p.z, CFG.HEAD_Z - 26);
    p.vz = 120;
    p.t.header = 0.4;
    b.z = Math.max(b.z, CFG.HEAD_Z - 6);
    const perfect = err < 0.06;
    if (attacking) {
      const K = this.teams[1 - T.idx].keeper;
      const ty = (K.y < cy ? cy + CFG.GOAL_HALF * 0.6 : cy - CFG.GOAL_HALF * 0.6) + rand(-10, 10);
      const a = Math.atan2(ty - b.y, T.oppGoalX - b.x) + gauss() * (perfect ? 0.03 : 0.09);
      const sp = 540 + p.st.tec * 14 + (perfect ? 140 : 0);
      b.kick(p, Math.cos(a) * sp, Math.sin(a) * sp, -90, 'shot');
      b.charged = perfect;
      p.face = a;
      p.dirX = Math.cos(a) >= 0 ? 1 : -1;
      this.popup(p.x, p.y, 72, perfect ? '¡CABEZAZO PERFECTO!' : '¡CABEZAZO!', '#ffd23f', 8);
    } else {
      const a = Math.atan2((p.y < cy ? -1 : 1) * 0.8, T.dir);
      b.kick(p, Math.cos(a) * 440, Math.sin(a) * 440, 280, 'clear');
      this.popup(p.x, p.y, 72, perfect ? '¡DESPEJE PERFECTO!' : '¡DESPEJE!', '#8cbcff', 8);
    }
    p.t.pickup = 0.4;
    this.sfx('header');
    this.camera.shake(perfect ? 4 : 2, 0.2);
    this.particles.burst(b.x, b.y, b.z, 14, { speed: 140, colors: ['#ffffff', '#ffd23f'], life: 0.4, size: 2, shape: 'spark', add: true });
    if (perfect) this.flash(0.25);
  }

  /* ---------- Supertiro: barra, cut-in y lanzamiento ---------- */
  startSuperBar(p) {
    if (this.superBar || this.cutin || !p.hasBall) return;
    this.superBar = new SuperBar(this, p);
    p.state = 'frozen';
    p.poseOverride = 'charge';
    p.vx = 0;
    p.vy = 0;
    p.charging = false;
    this.darkTarget = 0.7;
    this.slowTarget = 0.06;
    this.sound.startCharge();
    this.sound.setLevel('super');
    if (this.header) this.header.cancel();
  }

  cancelSuperBar() {
    const bar = this.superBar;
    if (!bar) return;
    this.superBar = null;
    bar.p.poseOverride = null;
    bar.p.t.super = bar.p.def.super.cd * 0.5;
    this.endSuperFx();
    this.slowTarget = 1;
    this.sound.stopCharge();
    this.popup(bar.p.x, bar.p.y, 60, '¡INTERRUMPIDO!', '#ff4d4d', 7);
  }

  resolveSuperBar(bar) {
    const p = bar.p;
    this.superBar = null;
    this.sound.stopCharge();
    p.poseOverride = null;
    if (p.state === 'frozen') p.state = 'normal';
    this.slowTarget = 1;
    if (!p.hasBall) {
      this.endSuperFx();
      return;
    }
    const hits = bar.zones.filter((z) => z.hit === 'hit' || z.hit === 'crit').length;
    const crit = bar.zones.every((z) => z.hit === 'crit');
    if (hits === 2) {
      p.t.super = p.def.super.cd;
      p.stats.supers++;
      this.startCutin(p, crit ? 'perfect' : 'great', bar.aimY);
      return;
    }
    this.endSuperFx();
    p.t.super = p.def.super.cd * (hits ? 0.5 : 0.6);
    if (hits === 1) {
      this.popup(p.x, p.y, 60, '¡TIRO CARGADO!', '#ffb703', 8);
      this.doShot(p, 1, bar.aimY, { charged: true });
    } else {
      this.popup(p.x, p.y, 60, '¡FALLO!', '#ff4d4d', 8);
      this.doShot(p, 0.6, bar.aimY, { fail: true });
    }
  }

  endSuperFx() {
    this.darkTarget = 0;
    if (this.state === 'play') this.sound.setLevel('match');
  }

  startCutin(p, quality, aimY) {
    this.cutin = { p, quality, aimY, t: 0, dur: 2.6, spoke: false };
    this.darkTarget = 0.85;
    this.sfx('cutin');
    this.sound.setLevel('super');
  }

  updateCutin(dt) {
    const c = this.cutin;
    c.t += dt;
    const col = c.p.def.super.colors;
    if (!c.spoke && c.t > 1.0) {
      c.spoke = true;
      this.sound.say(`¡${c.p.def.super.name}!`, 'super');
      this.sfx('thunder');
      this.camera.shake(5, 0.4);
    }
    if (c.t > 1.25 && c.t < 2.45) {
      for (let i = 0; i < 4; i++) {
        const a = rand(0, TAU);
        this.fx.add({ space: 'screen', x: CFG.W / 2 + Math.cos(a) * 30, y: CFG.H / 2 + Math.sin(a) * 18, vx: Math.cos(a) * rand(150, 420), vy: Math.sin(a) * rand(100, 260), life: rand(0.4, 0.9), size: rand(2, 5), color: pick(col), shape: pick(['sq', 'spark', 'star']), add: true });
      }
    }
    if (c.t < 1.2 && Math.random() < 0.6) {
      this.fx.add({ space: 'screen', x: rand(0, CFG.W), y: rand(60, 300), vx: -900, vy: 0, life: 0.25, size: 1, color: '#ffffff', shape: 'line', len: rand(30, 90), rot: 0, alpha: 0.7 });
    }
    if (c.t >= c.dur) {
      this.cutin = null;
      this.launchSuper(c);
    }
  }

  launchSuper(c) {
    if (!c.p.hasBall) {
      this.endSuperFx();
      return;
    }
    this.darkTarget = 0.35;
    const ss = new SuperShot(this, c.p, c.quality, c.aimY);
    c.p.t.kick = 0.35;
    c.p.face = Math.atan2(ss.ty - ss.sy, ss.tx - ss.sx);
    c.p.dirX = Math.cos(c.p.face) >= 0 ? 1 : -1;
    this.sfx('superLaunch');
    this.flash(0.8, c.p.def.super.colors[2]);
    this.camera.shake(6, 0.4);
    this.explosionFx(c.p.x, c.p.y, 10, c.p.def.super.colors, 0.8);
  }

  superBlocked(ss, knight) {
    const b = this.ball;
    ss.done = true;
    b.superShot = null;
    b.vx = -ss.dir * 300;
    b.vy = rand(-150, 150);
    b.vz = 200;
    b.lastTouch = knight;
    b.kind = 'clear';
    knight.knock(0.8, ss.dir * 200, 0, 'down');
    this.popup(knight.x, knight.y, 56, '¡BLOQUEO HEROICO!', '#8ecae6', 8);
    this.explosionFx(b.x, b.y, b.z, ss.def.colors, 1);
    this.sfx('post');
    this.camera.shake(6, 0.4);
    this.endSuperFx();
  }

  spawnEnergy() {
    const p = this.superBar.p;
    const X = projX(p.x, p.y);
    const Y = projY(p.y, p.z) - 16;
    const col = p.def.super.colors;
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU);
      const r = rand(50, 90);
      this.fx.add({ space: 'screen', x: X + Math.cos(a) * r, y: Y + Math.sin(a) * r * 0.7, vx: -Math.cos(a) * r / 0.35, vy: -Math.sin(a) * r * 0.7 / 0.35, life: 0.35, size: rand(2, 3), color: pick(col), shape: 'sq', add: true });
    }
  }

  /* ---------- Golpes, nubes y presión ---------- */
  updateHitboxes(dt) {
    for (let i = this.hitboxes.length - 1; i >= 0; i--) {
      const h = this.hitboxes[i];
      if (h.delay > 0) {
        h.delay -= dt;
        if (h.delay <= 0 && h.fromOwner) {
          const o = h.owner;
          h.angle = o.face;
          h.x = o.x + Math.cos(o.face) * h.off;
          h.y = o.y + Math.sin(o.face) * h.off;
          h.vx = Math.cos(o.face) * h.speed;
          h.vy = Math.sin(o.face) * h.speed;
        }
        continue;
      }
      h.life -= dt;
      if (h.follow) {
        const o = h.owner;
        h.x = o.x + Math.cos(o.face) * h.off;
        h.y = o.y + Math.sin(o.face) * h.off;
        h.z = o.z;
      } else {
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        if (h.gravity) {
          h.vz -= CFG.GRAVITY * dt;
          h.z += h.vz * dt;
          if (h.z <= 0) h.life = 0;
        }
      }
      if (h.effect) {
        for (const p of this.allPlayers) {
          if (p.team === h.owner.team || h.hit.has(p)) continue;
          if (dist(h.x, h.y, p.x, p.y) < h.r + 7 && (h.ground ? p.z < 10 : p.z < 40)) {
            h.hit.add(p);
            this.applyHit(p, h.owner, h.effect, h);
          }
        }
      }
      if (h.life <= 0) {
        this.hitboxes.splice(i, 1);
        if (h.onExpire) h.onExpire(h);
      }
    }
  }

  updateClouds(dt) {
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      for (const o of this.oppCache[c.team.idx]) {
        if (dist(o.x, o.y, c.x, c.y) < c.r) o.buff.smoke = Math.max(o.buff.smoke, 0.25);
      }
      if (c.t >= c.dur) this.clouds.splice(i, 1);
    }
  }

  /** Aplica un golpe (barrida, golpe único, supertiro) a un jugador. */
  applyHit(target, attacker, eff, src) {
    if (target.state === 'celebrate' || target.state === 'frozen' && !attacker) return false;
    if (target.keeper && target.hasBall) return false;
    if (target.t.invuln > 0) return false;
    if (eff.ground && target.z > 10) return false;
    const ox = src ? src.x : attacker ? attacker.x : target.x - 1;
    const oy = src ? src.y : attacker ? attacker.y : target.y;
    let ang = Math.atan2(target.y - oy, target.x - ox);
    if (src && src.follow && attacker) ang = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    if (!Number.isFinite(ang)) ang = attacker ? attacker.face : 0;
    if (target.buff.shield > 0) {
      this.popup(target.x, target.y, 44, 'ESCUDO', '#29f0ff', 6);
      this.sfx('shield');
      if (attacker && eff.kind !== 'super') attacker.knock(0.45, -Math.cos(ang) * 160, -Math.sin(ang) * 160, 'dizzy');
      return false;
    }
    if (target.buff.block > 0 && attacker) {
      const toA = Math.atan2(attacker.y - target.y, attacker.x - target.x);
      if (Math.abs(angleDiff(target.face, toA)) < Math.PI / 2) {
        this.popup(target.x, target.y, 44, 'BLOQUEO', '#8ecae6', 6);
        this.sfx('post');
        if (eff.kind !== 'super') attacker.knock(0.7, -Math.cos(ang) * 120, -Math.sin(ang) * 120, 'dizzy');
        return false;
      }
    }
    if (target.buff.immune > 0) {
      this.popup(target.x, target.y, 44, 'INMUNE', '#ffd23f', 6);
      this.particles.burst(target.x, target.y, 16, 8, { speed: 90, colors: ['#ffd23f', '#ffffff'], life: 0.3, size: 2, shape: 'spark', add: true });
      target.vx += Math.cos(ang) * 60;
      target.vy += Math.sin(ang) * 60;
      return false;
    }
    const resist = 0.75 + target.st.fis * 0.045;
    const kind = eff.dizzy ? 'dizzy' : 'down';
    const hadBall = target.hasBall;
    target.knock(eff.stun / Math.sqrt(resist), (Math.cos(ang) * eff.knock) / resist, (Math.sin(ang) * eff.knock) / resist, kind);
    if (eff.slow) target.buff.slow = Math.max(target.buff.slow, eff.slow);
    if (hadBall) {
      this.looseBall(target, ang, 150);
      if (attacker) {
        attacker.stats.steals++;
        this.popup(target.x, target.y, 50, '¡ROBO!', '#ffd23f', 7);
      }
    }
    this.hitboxes = this.hitboxes.filter((h) => !(h.follow && h.owner === target));
    const heavy = eff.knock >= 380;
    this.sfx(heavy ? 'heavy' : 'hit');
    this.hitstop = heavy ? 0.07 : 0.04;
    this.camera.shake(heavy ? 4 : 2, 0.18);
    this.particles.burst(target.x, target.y, 16, 12, { speed: 120, colors: ['#ffffff', '#ffd23f', attacker ? attacker.team.kit.ui : '#ffffff'], life: 0.35, size: 3, shape: 'spark', add: true });
    this.particles.add({ x: target.x, y: target.y, z: 16, shape: 'ring', size: 3, size2: 18, life: 0.25, color: '#ffffff', lw: 2 });
    return true;
  }

  /** Presión (mantener Pase sin balón): robo limpio si se insiste junto al rival. */
  updatePressure(dt) {
    const c = this.ball.owner;
    for (const p of this.fieldPlayers) {
      if (!p.pressing || !c || c.team === p.team || c.keeper) {
        p.pressT = Math.max(0, p.pressT - dt);
        continue;
      }
      const d = distE(p, c);
      if (d > 17 || c.t.invuln > 0 || c.buff.immune > 0 || c.buff.shield > 0 || c.state !== 'normal') {
        p.pressT = Math.max(0, p.pressT - dt);
        continue;
      }
      p.pressT += dt;
      if (p.pressT > 0.45) {
        p.pressT = 0;
        const pr = clamp(0.32 + (p.st.def - c.st.tec) * 0.05, 0.12, 0.7);
        if (chance(pr)) {
          c.t.pickup = 0.5;
          c.vx *= 0.3;
          c.vy *= 0.3;
          this.givePossession(p);
          p.stats.steals++;
          this.popup(p.x, p.y, 48, '¡ROBO LIMPIO!', '#ffd23f', 6);
          this.sfx('dribble');
        } else {
          this.popup(c.x, c.y, 48, '¡ESQUIVA!', '#ffffff', 6);
        }
      }
    }
  }

  separatePlayers() {
    const L = this.allPlayers;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.state === 'celebrate') continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.state === 'celebrate' || Math.abs(a.z - b.z) > 20) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01 && d < 13) {
          const push = (13 - d) / 2;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
        }
      }
    }
  }

  /* ---------- Gol, celebración y final ---------- */
  onGoal(scoringIdx) {
    if (this.state !== 'play') return;
    const T = this.teams[scoringIdx];
    T.score++;
    const b = this.ball;
    const scorer = b.lastTouch;
    const own = !scorer || scorer.team !== T;
    if (!own) {
      scorer.stats.goals++;
      T.scorers.push(scorer.name);
    } else {
      T.scorers.push('Autogol');
    }
    this.state = 'goal';
    this.goalT = 0;
    this.goalInfo = { T, scorer: own ? null : scorer, own, celebration: null };
    if (this.superBar) this.cancelSuperBar();
    if (this.header) this.header.cancel();
    this.hitboxes.length = 0;
    this.sound.stopCharge();
    this.stadium.hitNet(b.goalSide, b.y, b.z, 14);
    this.stadium.excite = 1;
    this.camera.shake(7, 0.6);
    this.flash(0.7, '#ffffff');
    this.slowTarget = 0.3;
    this.darkTarget = 0;
    this.sound.setLevel('super');
    this.sfx('goal');
    this.sfx('whistle');
    this.sound.say('¡GOOOOOOL!', 'goal');
    for (let i = 0; i < 90; i++) {
      this.fx.add({ space: 'screen', x: rand(0, CFG.W), y: rand(-60, -4), vx: rand(-25, 25), vy: rand(40, 110), g: 20, life: rand(2.5, 4), size: rand(3, 5), color: pick([T.kit.ui, '#ffd23f', '#ffffff', '#ff2bd6', '#29f0ff']), shape: 'confetti', vr: rand(4, 12) });
    }
    this.explosionFx(b.x, b.y, b.z, ['#ffffff', T.kit.ui, '#ffd23f'], 1.2);
  }

  updateGoal(wdt, dt) {
    this.goalT += dt;
    const info = this.goalInfo;
    if (this.goalT > 0.9 && !this.celebration) {
      this.slowTarget = 1;
      this.sound.setLevel('match');
      let type = randInt(0, 4);
      if (type === this.lastCeleb) type = (type + 1) % 5;
      this.lastCeleb = type;
      info.celebration = type;
      this.celebration = new Celebration(this, info.T, info.scorer, type);
      const L = this.teams[1 - info.T.idx];
      for (const p of L.players) {
        p.state = 'celebrate';
        p.poseOverride = 'sad';
        p.action = null;
        p.mark = null;
      }
    }
    if (this.celebration) {
      this.celebration.update(dt);
      const L = this.teams[1 - info.T.idx];
      for (const p of L.players) {
        const tx = L.ownGoalX + L.dir * (220 + (p.slot % 2) * 60);
        const ty = 110 + p.slot * 70;
        const dx = tx - p.x;
        const dy = ty - p.y;
        const d = Math.hypot(dx, dy);
        p.vx = d > 4 ? (dx / d) * 45 : 0;
        p.vy = d > 4 ? (dy / d) * 45 : 0;
        p.poseOverride = 'sad';
      }
      this.camera.follow(this.celebration.cx);
    } else {
      this.camera.follow(this.ball.x);
    }
    for (const p of this.allPlayers) {
      if (p.state !== 'celebrate') resetIntent(p.intent);
      p.update(this.celebration ? dt : wdt);
    }
    this.ball.update(wdt);
    if (this.goalT > 4.8) {
      if (this.goldenGoal) this.finish();
      else this.kickoff(1 - info.T.idx);
    }
  }

  onTimeUp() {
    const [A, B] = this.teams;
    if (A.score !== B.score) {
      this.state = 'fulltime';
      this.ftT = 0;
      if (this.superBar) this.cancelSuperBar();
      if (this.header) this.header.cancel();
      this.sound.stopCharge();
      this.sfx('whistleEnd');
      this.showBanner('¡FINAL DEL PARTIDO!', '', 3, '#ffffff');
      this.sound.say('¡Final del partido!', 'hype');
    } else {
      this.goldenGoal = true;
      this.showBanner('¡GOL DE ORO!', 'El próximo gol gana', 2.2, '#ffd23f');
      this.sound.say('¡Gol de oro!', 'hype');
      this.sfx('whistle');
    }
  }

  updateFulltime(dt) {
    this.ftT += dt;
    const win = this.teams[0].score > this.teams[1].score ? 0 : 1;
    for (const T of this.teams) {
      for (const p of T.players) {
        p.state = 'celebrate';
        p.vx *= 0.9;
        p.vy *= 0.9;
        p.mark = null;
        p.poseOverride = T.idx === win ? (Math.floor(this.ftT * 3 + p.slot) % 2 ? 'cheer' : 'idle0') : 'sad';
        p.update(dt);
      }
      T.keeper.vx = 0;
      T.keeper.vy = 0;
      T.keeper.updateAnim(dt);
    }
    this.ball.update(dt);
    if (this.ftT > 3.4) this.finish();
  }

  finish() {
    if (this.ended) return;
    this.ended = true;
    this.sound.stopCharge();
    const [A, B] = this.teams;
    const score = (p) => p.stats.goals * 5 + p.stats.steals + p.stats.supers * 2 + p.stats.saves * 2;
    const mvp = this.allPlayers.slice().sort((a, c) => score(c) - score(a))[0];
    const group = (list) => {
      const m = new Map();
      list.forEach((n) => m.set(n, (m.get(n) || 0) + 1));
      return [...m].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n));
    };
    this.game.onMatchEnd({
      score: [A.score, B.score],
      winner: A.score > B.score ? 0 : 1,
      names: [A.name, B.name],
      scorers: [group(A.scorers), group(B.scorers)],
      mvp: { name: mvp.def.full, team: mvp.team.name, goals: mvp.stats.goals, steals: mvp.stats.steals, saves: mvp.stats.saves },
    });
  }

  /* ---------- Render ---------- */
  render(ctx) {
    const sprites = this.game.sprites;
    this.stadium.drawBackground(ctx);
    this.stadium.drawField(ctx);
    this.stadium.drawGoalBack(ctx, 0);
    this.stadium.drawGoalBack(ctx, 1);
    this.drawGroundMarkers(ctx);
    for (const p of this.allPlayers) p.drawShadow(ctx);
    this.ball.drawShadow(ctx);
    for (const h of this.hitboxes) if (h.kind === 'flask') this.drawFlaskShadow(ctx, h);
    const list = [];
    for (const p of this.allPlayers) list.push({ y: p.y, p });
    list.push({ y: this.ball.y + 0.5, ball: true });
    list.push({ y: CFG.FH / 2 + CFG.GOAL_HALF + 0.1, goal: 0 });
    list.push({ y: CFG.FH / 2 + CFG.GOAL_HALF + 0.1, goal: 1 });
    for (const h of this.hitboxes) list.push({ y: h.y + 1, h });
    list.sort((a, c) => a.y - c.y);
    this.particles.draw(ctx, 'world', true);
    for (const it of list) {
      if (it.goal !== undefined) this.stadium.drawGoalFront(ctx, it.goal);
      else if (it.ball) this.ball.draw(ctx);
      else if (it.h) this.drawHitbox(ctx, it.h);
      else it.p.draw(ctx, sprites);
    }
    if (this.ball.superShot) this.ball.superShot.drawExtras(ctx);
    this.particles.draw(ctx, 'world');
    this.drawClouds(ctx);
    this.stadium.drawForeground(ctx);
    this.drawIndicators(ctx);
    this.drawDarkness(ctx);
    if (this.superBar) {
      this.superBar.p.draw(ctx, sprites);
      this.ball.draw(ctx);
      this.superBar.draw(ctx);
    }
    this.fx.draw(ctx, 'screen');
    if (this.cutin) this.drawCutin(ctx);
    ctx.drawImage(this.vignette, 0, 0);
    this.drawGoalText(ctx);
    this.drawBanner(ctx);
    if (!this.cutin) this.drawHUD(ctx);
    if (this.flashA > 0) {
      ctx.globalAlpha = Math.min(1, this.flashA);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, CFG.W, CFG.H);
      ctx.globalAlpha = 1;
    }
  }

  drawGroundMarkers(ctx) {
    const H = this.header;
    if (!H || H.resolved) return;
    const k = clamp(1 - H.t / H.T, 0, 1);
    const inWin = H.t >= H.winStart && H.t <= H.winEnd;
    const X = projX(H.lx, H.ly);
    const Y = projY(H.ly);
    ctx.strokeStyle = inWin ? '#3dff8f' : '#ffd23f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(X, Y, 8 + 34 * k, (8 + 34 * k) * CFG.DEPTH, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(X, Y, 8, 4, 0, 0, TAU);
    ctx.stroke();
  }

  drawFlaskShadow(ctx, h) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(projX(h.x, h.y), projY(h.y), 3, 1.5, 0, 0, TAU);
    ctx.fill();
  }

  drawHitbox(ctx, h) {
    if (h.delay > 0) return;
    const X = projX(h.x, h.y);
    const Y = projY(h.y, h.z || 0);
    const k = 1 - h.life / h.max;
    const scr = (a) => Math.atan2(Math.sin(a) * CFG.DEPTH, Math.cos(a));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    switch (h.kind) {
      case 'slash': {
        const a = scr(h.owner.face);
        ctx.strokeStyle = rgba(h.color, 1 - k);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(X, Y - 14, 13, a - 1.3 + k, a + 1.1 + k);
        ctx.stroke();
        break;
      }
      case 'crescent': {
        const a = scr(h.angle);
        ctx.strokeStyle = rgba(h.color, 0.95);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(X, Y - 12, 10, a - 1.2, a + 1.2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(X, Y - 12, 8, a - 1, a + 1);
        ctx.stroke();
        break;
      }
      case 'emp':
        ctx.strokeStyle = rgba(h.color, 1 - k);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X, Y - 12, 6 + k * 22, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = rand(0, TAU);
          ctx.moveTo(X, Y - 12);
          ctx.lineTo(X + Math.cos(a) * 10 + rand(-3, 3), Y - 12 + Math.sin(a) * 10);
          ctx.lineTo(X + Math.cos(a) * 20, Y - 12 + Math.sin(a) * 20);
        }
        ctx.stroke();
        break;
      case 'palm':
        ctx.fillStyle = rgba(h.color, 0.6 * (1 - k));
        ctx.beginPath();
        ctx.arc(X, Y - 14, 6 + k * 14, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', 1 - k);
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      case 'shadow':
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(36,0,70,${0.55 * (1 - k)})`;
        ctx.beginPath();
        ctx.ellipse(X, projY(h.y), h.r * (0.4 + k), h.r * (0.4 + k) * CFG.DEPTH, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(h.color, 1 - k);
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      case 'spear': {
        const a = h.owner.face;
        const x2 = projX(h.x + Math.cos(a) * 22, h.y + Math.sin(a) * 22);
        const y2 = projY(h.y + Math.sin(a) * 22, h.z) - 14;
        ctx.strokeStyle = rgba(h.color, 0.9);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(X - Math.cos(scr(a)) * 10, Y - 14);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      }
      case 'bolt':
        ctx.strokeStyle = rgba(h.color, 0.9);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(X - 10, Y - 20);
        for (let i = 0; i < 5; i++) ctx.lineTo(X - 10 + i * 5, Y - 20 + (i % 2 ? 8 : -2) + rand(-2, 2));
        ctx.stroke();
        break;
      case 'bash': {
        const a = scr(h.owner.face);
        ctx.strokeStyle = rgba(h.color, 1 - k);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(X, Y - 14, 8 + k * 10, a - 0.9, a + 0.9);
        ctx.stroke();
        break;
      }
      case 'flask':
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#120a1c';
        ctx.fillRect(Math.round(X) - 3, Math.round(Y) - 6, 6, 8);
        ctx.fillStyle = h.color;
        ctx.fillRect(Math.round(X) - 2, Math.round(Y) - 4, 4, 5);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(X) - 1, Math.round(Y) - 6, 2, 2);
        break;
      default:
        break;
    }
    ctx.restore();
  }

  drawClouds(ctx) {
    for (const c of this.clouds) {
      const fade = clamp(Math.min(c.t / 0.3, (c.dur - c.t) / 0.6), 0, 1);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + c.t * 0.3;
        const r = c.r * (i % 2 ? 0.55 : 0.3);
        const X = projX(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
        const Y = projY(c.y + Math.sin(a) * r, 14 + Math.sin(c.t * 2 + i) * 3);
        ctx.fillStyle = `rgba(214,214,226,${0.5 * fade})`;
        ctx.beginPath();
        ctx.arc(X, Y, c.r * 0.38, 0, TAU);
        ctx.fill();
      }
    }
  }

  drawIndicators(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const T of this.teams) {
      if (!T.human || !T.controlled || this.state === 'goal') continue;
      const p = T.controlled;
      const X = Math.round(projX(p.x, p.y));
      const Y = Math.round(projY(p.y, p.z)) - 46 + Math.round(Math.sin(this.realT * 8));
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.moveTo(X - 6, Y - 1);
      ctx.lineTo(X + 6, Y - 1);
      ctx.lineTo(X, Y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = T.kit.ui;
      ctx.beginPath();
      ctx.moveTo(X - 4, Y);
      ctx.lineTo(X + 4, Y);
      ctx.lineTo(X, Y + 5);
      ctx.closePath();
      ctx.fill();
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      const tag = `${T.human.i + 1}P`;
      ctx.strokeText(tag, X, Y - 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tag, X, Y - 6);
    }
    for (const p of this.allPlayers) {
      if (!p.mark) continue;
      const X = Math.round(projX(p.x, p.y));
      const Y = Math.round(projY(p.y, p.z)) - 58 + Math.round(Math.sin(this.realT * 14 + p.slot) * 2);
      const color = p.mark === '!' ? '#ffd23f' : p.mark === 'X' ? '#ff4d4d' : p.team.kit.ui;
      ctx.fillStyle = '#000';
      ctx.fillRect(X - 7, Y - 8, 14, 15);
      ctx.fillStyle = color;
      ctx.fillRect(X - 6, Y - 7, 12, 13);
      ctx.fillStyle = '#000';
      ctx.fillRect(X - 1, Y + 7, 3, 3);
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText(p.mark, X + 1, Y + 0.5);
    }
    ctx.restore();
  }

  drawDarkness(ctx) {
    if (this.dark < 0.01) return;
    const g = this.darkCanvas.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, CFG.W, CFG.H);
    g.fillStyle = `rgba(4,0,12,${this.dark})`;
    g.fillRect(0, 0, CFG.W, CFG.H);
    let focus = null;
    if (this.superBar) focus = this.superBar.p;
    else if (this.cutin) focus = this.cutin.p;
    else if (this.ball.superShot) focus = this.ball;
    if (focus) {
      const X = projX(focus.x, focus.y);
      const Y = projY(focus.y, focus.z) - 14;
      g.globalCompositeOperation = 'destination-out';
      const rg = g.createRadialGradient(X, Y, 6, X, Y, 72);
      rg.addColorStop(0, 'rgba(0,0,0,1)');
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rg;
      g.fillRect(X - 72, Y - 72, 144, 144);
    }
    ctx.drawImage(this.darkCanvas, 0, 0);
  }

  drawCutin(ctx) {
    const c = this.cutin;
    const t = c.t;
    const p = c.p;
    const def = p.def;
    const col = def.super.colors;
    const ui = p.team.kit.ui;
    const W = CFG.W;
    const H = CFG.H;
    ctx.save();
    ctx.fillStyle = 'rgba(5,2,12,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU + t * 0.5;
      ctx.strokeStyle = i % 2 ? rgba(col[0], 0.22) : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = i % 3 === 0 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 50, Math.sin(a) * 50);
      ctx.lineTo(Math.cos(a) * 420, Math.sin(a) * 420);
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (t < 1.25) {
      // FASE 1: panel diagonal de manga con la mirada del personaje
      const k = easeOutCubic(clamp(t / 0.25, 0, 1));
      const out = easeInCubic(clamp((t - 1.0) / 0.25, 0, 1));
      const slide = (1 - k) * -720 + out * 720;
      ctx.translate(slide, 0);
      const band = new Path2D();
      band.moveTo(-40, 238);
      band.lineTo(W + 40, 150);
      band.lineTo(W + 40, 62);
      band.lineTo(-40, 150);
      band.closePath();
      ctx.save();
      ctx.clip(band);
      const g = ctx.createLinearGradient(0, 60, 0, 240);
      g.addColorStop(0, shade(ui, -0.2));
      g.addColorStop(1, shade(ui, -0.75));
      ctx.fillStyle = g;
      ctx.fillRect(-40, 40, W + 80, 220);
      ctx.imageSmoothingEnabled = false;
      const por = this.game.portraits.get(def);
      ctx.save();
      ctx.translate(W / 2, 150);
      ctx.rotate(-0.135);
      ctx.drawImage(por, 0, 22, 64, 20, -W / 2 - 30, -95, W + 60, 190);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 40; y < 260; y += 4) for (let x = (y / 4) % 2 ? 0 : 2; x < W + 40; x += 4) ctx.fillRect(x, y, 1, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const y = 60 + ((i * 37 + t * 900) % 200);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y - 88);
        ctx.stroke();
      }
      ctx.restore();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#000';
      ctx.stroke(band);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke(band);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(def.full.toUpperCase(), 18, 268);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(def.full.toUpperCase(), 18, 268);
      ctx.fillStyle = col[1];
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText(`${def.arch.toUpperCase()} · ${c.quality === 'perfect' ? '¡PERFECTO!' : '¡GRAN TIMING!'}`, 18, 284);
    } else {
      // FASE 2: nombre de la técnica en tipografía gigante
      const k = clamp((t - 1.25) / 0.28, 0, 1);
      const s = lerp(2.6, 1, easeOutBack(k));
      const shakeX = t < 1.7 ? rand(-2, 2) : 0;
      const shakeY = t < 1.7 ? rand(-2, 2) : 0;
      ctx.translate(W / 2 + shakeX, H / 2 + shakeY);
      ctx.rotate(-0.08);
      ctx.scale(s, s);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const words = def.super.name.toUpperCase().split(' ');
      const half = Math.ceil(words.length / 2);
      const lines = words.length > 2 ? [words.slice(0, half).join(' '), words.slice(half).join(' ')] : [words.join(' ')];
      ctx.font = '46px Bangers, Impact, sans-serif';
      lines.forEach((line, i) => {
        const y = (i - (lines.length - 1) / 2) * 46;
        const g = ctx.createLinearGradient(0, y - 22, 0, y + 22);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.45, col[2]);
        g.addColorStop(1, col[0]);
        ctx.lineJoin = 'round';
        ctx.lineWidth = 12;
        ctx.strokeStyle = '#000';
        ctx.strokeText(line, 0, y);
        ctx.lineWidth = 4;
        ctx.strokeStyle = col[1];
        ctx.strokeText(line, 0, y);
        ctx.fillStyle = g;
        ctx.fillText(line, 0, y);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`★ SUPERTIRO DE ${def.name.toUpperCase()} ★`, W / 2, H - 46);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 24);
    ctx.fillRect(0, H - 24, W, 24);
    ctx.restore();
  }

  drawGoalText(ctx) {
    if (this.state !== 'goal' || !this.goalInfo) return;
    const t = this.goalT;
    const T = this.goalInfo.T;
    const out = clamp((t - 2.2) / 0.4, 0, 1);
    const sc = (t < 0.45 ? easeOutBack(clamp(t / 0.45, 0, 1)) : 1) * lerp(1, 0.55, out);
    const y = lerp(118, 74, out);
    const fade = clamp(1 - (t - 3.2) / 0.5, 0, 1);
    if (fade <= 0) return;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(CFG.W / 2 + (t < 1 ? rand(-2, 2) : 0), y);
    ctx.rotate(-0.06);
    ctx.scale(Math.max(0.01, sc), Math.max(0.01, sc));
    ctx.font = '78px Bangers, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#000';
    ctx.strokeText('¡GOOOL!', 0, 0);
    const g = ctx.createLinearGradient(0, -36, 0, 36);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.5, '#ffd23f');
    g.addColorStop(1, T.kit.ui);
    ctx.fillStyle = g;
    ctx.fillText('¡GOOOL!', 0, 0);
    ctx.restore();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    const who = this.goalInfo.scorer ? `${this.goalInfo.scorer.name.toUpperCase()} ANOTA PARA ${T.name.toUpperCase()}` : `AUTOGOL · PUNTO PARA ${T.name.toUpperCase()}`;
    if (t > 0.3 && t < 2.4) {
      ctx.strokeText(who, CFG.W / 2, y + 50);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(who, CFG.W / 2, y + 50);
    }
    if (this.goalInfo.celebration !== null && t > 1.0) {
      const label = `★ ${CELEBRATIONS[this.goalInfo.celebration].toUpperCase()} ★`;
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.strokeText(label, CFG.W / 2, CFG.H - 60);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(label, CFG.W / 2, CFG.H - 60);
    }
    ctx.restore();
  }

  drawBanner(ctx) {
    const b = this.banner;
    if (!b) return;
    const kin = easeOutCubic(clamp(b.t / 0.18, 0, 1));
    const kout = clamp((b.dur - b.t) / 0.18, 0, 1);
    const x = (1 - kin) * -CFG.W + (1 - kout) * CFG.W;
    ctx.save();
    ctx.translate(x, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.beginPath();
    ctx.moveTo(0, 160);
    ctx.lineTo(CFG.W, 146);
    ctx.lineTo(CFG.W, 196);
    ctx.lineTo(0, 210);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = b.color;
    ctx.fillRect(0, 158, CFG.W, 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '36px Bangers, Impact, sans-serif';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#000';
    ctx.strokeText(b.text, CFG.W / 2, 176);
    ctx.fillStyle = b.color;
    ctx.fillText(b.text, CFG.W / 2, 176);
    if (b.sub) {
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(b.sub.toUpperCase(), CFG.W / 2, 198);
    }
    ctx.restore();
  }

  drawHUD(ctx) {
    const [A, B] = this.teams;
    const cx = CFG.W / 2;
    ctx.save();
    ctx.fillStyle = 'rgba(8,4,18,0.88)';
    ctx.beginPath();
    ctx.moveTo(cx - 122, 4);
    ctx.lineTo(cx + 122, 4);
    ctx.lineTo(cx + 110, 30);
    ctx.lineTo(cx - 110, 30);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = A.kit.ui;
    ctx.fillRect(cx - 118, 4, 70, 3);
    ctx.fillStyle = B.kit.ui;
    ctx.fillRect(cx + 48, 4, 70, 3);
    ctx.textBaseline = 'middle';
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = A.kit.ui;
    ctx.fillText(A.short, cx - 44, 18);
    ctx.textAlign = 'left';
    ctx.fillStyle = B.kit.ui;
    ctx.fillText(B.short, cx + 44, 18);
    ctx.textAlign = 'center';
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(A.score), cx - 22, 18);
    ctx.fillText(String(B.score), cx + 22, 18);
    ctx.font = '8px "Press Start 2P", monospace';
    ctx.fillText('-', cx, 18);
    ctx.fillStyle = 'rgba(8,4,18,0.88)';
    ctx.fillRect(cx - 40, 30, 80, 13);
    ctx.font = '7px "Press Start 2P", monospace';
    if (this.goldenGoal) {
      ctx.fillStyle = Math.floor(this.realT * 3) % 2 ? '#ffd23f' : '#ffffff';
      ctx.fillText('GOL DE ORO', cx, 37);
    } else {
      const s = Math.ceil(this.clock);
      ctx.fillStyle = s <= 10 ? '#ff4d4d' : '#ffffff';
      ctx.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, cx, 37);
    }
    ctx.textAlign = 'left';
    ctx.font = '6px "Press Start 2P", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('ESC: PAUSA', 8, 10);
    ctx.fillText(A.label, 8, 20);
    ctx.textAlign = 'right';
    ctx.fillText(B.label, CFG.W - 40, 20);
    // Retratos con medidor de Supertiro y habilidad
    this.teams.forEach((T, ti) => {
      T.players.forEach((p, i) => {
        const x = ti === 0 ? 8 + i * 27 : CFG.W - 30 - i * 27;
        const y = CFG.H - 32;
        ctx.fillStyle = '#000';
        ctx.fillRect(x - 1, y - 1, 24, 31);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this.game.portraits.get(p.def), 14, 12, 36, 36, x, y, 22, 22);
        if (p.state === 'down' || p.state === 'dizzy') {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x, y, 22, 22);
        }
        const ready = p.superReady;
        const frac = ready ? 1 : 1 - p.t.super / p.def.super.cd;
        ctx.fillStyle = '#24123d';
        ctx.fillRect(x, y + 23, 22, 3);
        ctx.fillStyle = ready ? (Math.floor(this.realT * 6) % 2 ? '#ffd23f' : '#ffffff') : p.def.super.colors[0];
        ctx.fillRect(x, y + 23, Math.round(22 * clamp(frac, 0, 1)), 3);
        const sk = p.def.skill ? 1 - p.t.skill / p.def.skill.cd : 1;
        ctx.fillStyle = sk >= 1 ? '#29f0ff' : '#1d4e66';
        ctx.fillRect(x, y + 27, Math.round(22 * clamp(sk, 0, 1)), 1);
        if (T.human && T.controlled === p) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(x - 0.5, y - 0.5, 23, 23);
        }
        if (ready) {
          ctx.font = '6px "Press Start 2P", monospace';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#000';
          ctx.fillRect(x + 14, y - 4, 9, 8);
          ctx.fillStyle = '#ffd23f';
          ctx.fillText('S', x + 18.5, y + 0.5);
        }
      });
    });
    ctx.restore();
  }
}

/* =============================================================================
   11. ESCENAS DE CANVAS: INTRO ESTILO RONALDINHO SOCCER 64 Y FONDO DE TÍTULO
   ============================================================================= */

function wrapText(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawRays(ctx, cx, cy, t, colA, colB, n = 18, r = 520) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.25);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU;
    const a1 = a0 + (TAU / n) * 0.5;
    ctx.fillStyle = i % 2 ? colA : colB;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
    ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Logo del juego con letras que "golpean" la pantalla una a una. */
function drawLogo(ctx, game, cx, cy, scale, t) {
  const img = game.assets.images.logo;
  if (img) {
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const lines = [{ text: 'DIMENSION', size: 44, y: -28 }, { text: 'STRIKERS', size: 66, y: 22 }];
  let idx = 0;
  for (const L of lines) {
    ctx.font = `${L.size}px Bangers, Impact, sans-serif`;
    const letters = L.text.split('');
    const widths = letters.map((ch) => ctx.measureText(ch).width + 2);
    const total = widths.reduce((a, b) => a + b, 0);
    let x = -total / 2;
    letters.forEach((ch, i) => {
      const lt = t - idx * 0.07;
      idx++;
      if (lt >= 0) {
        const k = clamp(lt / 0.14, 0, 1);
        const s = lerp(3, 1, easeOutCubic(k));
        const wob = Math.sin(t * 3 + i * 0.6) * 1.5;
        ctx.save();
        ctx.translate(x + widths[i] / 2, L.y + wob);
        ctx.rotate(-0.06);
        ctx.scale(s, s);
        ctx.globalAlpha = k;
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#000';
        ctx.strokeText(ch, 4, 4);
        ctx.fillStyle = '#ff2bd6';
        ctx.fillText(ch, 4, 4);
        ctx.lineWidth = 8;
        ctx.strokeText(ch, 0, 0);
        const g = ctx.createLinearGradient(0, -L.size / 2, 0, L.size / 2);
        g.addColorStop(0, '#fffbe6');
        g.addColorStop(0.45, '#ffd23f');
        g.addColorStop(1, '#ff9f1c');
        ctx.fillStyle = g;
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
      x += widths[i];
    });
  }
  const st = t - idx * 0.07 - 0.2;
  if (st > 0) {
    const k = easeOutCubic(clamp(st / 0.4, 0, 1));
    ctx.globalAlpha = k;
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    const sub = 'SÚPER TORNEO DIMENSIONAL';
    ctx.strokeText(sub, (1 - k) * -80, 68);
    ctx.fillStyle = '#29f0ff';
    ctx.fillText(sub, (1 - k) * -80, 68);
  }
  ctx.restore();
}

class Starfield {
  constructor(n = 220) {
    this.stars = Array.from({ length: n }, () => this.spawn(rand(0.05, 1)));
  }

  spawn(z = 1) {
    return { x: rand(-1, 1), y: rand(-1, 1), z, pz: z };
  }

  update(dt, speed) {
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.pz = s.z;
      s.z -= dt * speed;
      if (s.z <= 0.02) this.stars[i] = this.spawn(1);
    }
  }

  draw(ctx, warp) {
    const cx = CFG.W / 2;
    const cy = CFG.H / 2;
    for (const s of this.stars) {
      const x = cx + (s.x / s.z) * 220;
      const y = cy + (s.y / s.z) * 220;
      const px = cx + (s.x / s.pz) * 220;
      const py = cy + (s.y / s.pz) * 220;
      const a = clamp(1 - s.z, 0.15, 1);
      ctx.strokeStyle = `rgba(220,230,255,${a})`;
      ctx.lineWidth = s.z < 0.3 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(warp ? x : px + 0.5, warp ? y : py + 0.5);
      ctx.stroke();
    }
  }
}

/** Cinemática de introducción: historia del Súper Torneo Dimensional + título épico. */
class IntroScene {
  constructor(game) {
    this.g = game;
    this.t = 0;
    this.TITLE_T = 15.6;
    this.END_T = this.TITLE_T + 3.6;
    this.done = false;
    this.events = new Set();
    this.stars = new Starfield(240);
    this.texts = [
      { t0: 0.4, t1: 3.3, text: 'AÑO 20XX... LAS DIMENSIONES COLISIONAN.' },
      { t0: 3.6, t1: 6.5, text: 'DIEZ GUERREROS DE MUNDOS DISTINTOS HAN SIDO CONVOCADOS.' },
      { t0: 11.7, t1: 13.9, text: 'UN BALÓN. UNA COPA. EL DESTINO DE TODAS LAS DIMENSIONES.' },
    ];
    this.parts = new ParticleSystem(500);
  }

  once(key, fn) {
    if (!this.events.has(key)) {
      this.events.add(key);
      fn();
    }
  }

  skip() {
    if (this.t < this.TITLE_T) {
      this.t = this.TITLE_T;
      this.g.sound.voice.cancel();
    } else if (this.t > this.TITLE_T + 0.6) {
      this.finish();
    }
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.g.onIntroDone();
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const S = this.g.sound;
    const warpSpeed = t < 3.4 ? 0.35 : t > 14 && t < this.TITLE_T ? 1.6 : 0.12;
    this.stars.update(dt, warpSpeed);
    this.parts.update(dt);
    if (t > 2.6) this.once('crash', () => S.sfx('thunder'));
    for (let i = 0; i < ROSTER.length; i++) {
      if (t > 6.6 + i * 0.5) this.once(`cut${i}`, () => S.sfx('whoosh'));
    }
    if (t > 14.0) this.once('ball', () => S.sfx('superLaunch'));
    if (t > 14 && t < this.TITLE_T) {
      const k = (t - 14) / (this.TITLE_T - 14);
      const r = lerp(3, 120, easeInCubic(k));
      for (let i = 0; i < 4; i++) {
        const a = rand(0, TAU);
        this.parts.add({ space: 'screen', x: CFG.W / 2 + Math.cos(a) * r * 0.8, y: CFG.H / 2 + Math.sin(a) * r * 0.8, vx: Math.cos(a) * rand(60, 260), vy: Math.sin(a) * rand(60, 260), life: 0.5, size: rand(2, 6), color: pick(['#ff3d00', '#ffb703', '#fff1a8']), shape: 'sq', add: true });
      }
    }
    if (t >= this.TITLE_T) {
      this.once('title', () => {
        S.sfx('title');
        this.shake = 0.5;
        this.flash = 1;
      });
    }
    if (t >= this.TITLE_T + 0.9) this.once('voice', () => S.say('¡Dimension Strikers! ¡El Súper Torneo Dimensional!', 'epic'));
    if (t >= this.TITLE_T && Math.random() < 0.4) {
      this.parts.add({ space: 'screen', x: rand(0, CFG.W), y: rand(40, 220), vy: rand(-20, -60), life: 1.2, size: rand(1, 3), color: pick(['#ffd23f', '#ffffff', '#ff2bd6']), shape: 'star', add: true });
    }
    this.shake = Math.max(0, (this.shake || 0) - dt);
    this.flash = Math.max(0, (this.flash || 0) - dt * 1.6);
    if (t > this.END_T) this.finish();
  }

  drawText(ctx, item) {
    const t = this.t;
    if (t < item.t0 || t > item.t1) return;
    const n = Math.floor((t - item.t0) * 34);
    const shown = item.text.slice(0, n);
    ctx.font = '10px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrapText(ctx, shown, 540);
    const alpha = clamp((item.t1 - t) / 0.3, 0, 1);
    ctx.globalAlpha = alpha;
    lines.forEach((line, i) => {
      const y = 300 + i * 18;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#000';
      ctx.strokeText(line, CFG.W / 2, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(line, CFG.W / 2, y);
    });
    ctx.globalAlpha = 1;
  }

  draw(ctx) {
    const t = this.t;
    const W = CFG.W;
    const H = CFG.H;
    ctx.save();
    if (this.shake > 0) ctx.translate(rand(-6, 6) * this.shake * 2, rand(-6, 6) * this.shake * 2);
    const bg = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 420);
    bg.addColorStop(0, '#1d0f35');
    bg.addColorStop(1, '#030108');
    ctx.fillStyle = bg;
    ctx.fillRect(-10, -10, W + 20, H + 20);
    if (t < this.TITLE_T) this.stars.draw(ctx, t < 3.4 || t > 14);
    if (t < 3.4) {
      // Dos mundos que colisionan
      const k = clamp(t / 2.6, 0, 1);
      const off = lerp(220, 40, easeInOut(k));
      const planet = (x, c1, c2) => {
        const g = ctx.createRadialGradient(x - 20, H / 2 - 30, 10, x, H / 2, 90);
        g.addColorStop(0, c1);
        g.addColorStop(1, c2);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, H / 2 - 10, 80, 0, TAU);
        ctx.fill();
      };
      planet(W / 2 - off - 40, '#4cc9f0', '#10002b');
      planet(W / 2 + off + 40, '#ff4d6d', '#10002b');
      if (t > 2.6) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        let y = 20;
        ctx.moveTo(W / 2, y);
        while (y < H - 60) {
          y += rand(12, 26);
          ctx.lineTo(W / 2 + rand(-18, 18), y);
        }
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${clamp(1 - (t - 2.6) * 2, 0, 1) * 0.8})`;
        ctx.fillRect(0, 0, W, H);
      }
    } else if (t < 6.6) {
      // Portal dimensional y siluetas de los guerreros
      const k = clamp((t - 3.4) / 0.8, 0, 1);
      for (let i = 0; i < 7; i++) {
        ctx.strokeStyle = ['#ff2bd6', '#29f0ff', '#ffd23f', '#8a1bff', '#3dff8f', '#ff3b5c', '#ffffff'][i];
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(W / 2, H / 2 - 30, (30 + i * 16) * k, (14 + i * 7) * k, t * (i % 2 ? 1 : -1) * 0.8, 0, TAU);
        ctx.stroke();
      }
      ROSTER.forEach((def, i) => {
        const a = Math.PI + (i / (ROSTER.length - 1)) * Math.PI;
        const r = 250 * k;
        const x = W / 2 + Math.cos(a) * r;
        const y = H / 2 + 96 + Math.sin(a) * 150 * k;
        const flip = x > W / 2;
        const spr = this.g.sprites.get(def, KITS.azul, 'idle0', flip);
        ctx.save();
        ctx.filter = 'brightness(0)';
        ctx.drawImage(spr, Math.round(x - 30), Math.round(y - 63), 60, 66);
        ctx.restore();
        ctx.fillStyle = def.look.eye;
        ctx.fillRect(Math.round(x + (flip ? -6 : 3)), Math.round(y - 44), 3, 2);
      });
    } else if (t < 11.6) {
      // Cortes rápidos estilo manga: los 10 personajes
      const i = Math.min(ROSTER.length - 1, Math.floor((t - 6.6) / 0.5));
      const lt = (t - 6.6) - i * 0.5;
      const def = ROSTER[i];
      const dir = i % 2 ? -1 : 1;
      const k = easeOutCubic(clamp(lt / 0.12, 0, 1));
      ctx.save();
      ctx.translate((1 - k) * dir * -W, 0);
      const col = def.super.colors;
      drawRays(ctx, W / 2, H / 2, t * 2, rgba(col[0], 0.35), rgba(col[1], 0.15), 24, 600);
      const band = new Path2D();
      band.moveTo(0, 70 + dir * 20);
      band.lineTo(W, 50 - dir * 20);
      band.lineTo(W, 290 - dir * 20);
      band.lineTo(0, 310 + dir * 20);
      band.closePath();
      ctx.save();
      ctx.clip(band);
      ctx.fillStyle = shade(def.look.accent === '#e9f5ff' ? '#4cc9f0' : def.look.accent, -0.55);
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.g.portraits.get(def), W / 2 - 192 + dir * 70, -10, 384, 384);
      ctx.restore();
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#000';
      ctx.stroke(band);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke(band);
      ctx.restore();
      ctx.save();
      ctx.font = '40px Bangers, Impact, sans-serif';
      ctx.textAlign = dir > 0 ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const tx = dir > 0 ? 24 : W - 24;
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#000';
      ctx.strokeText(def.name.toUpperCase(), tx, 290);
      ctx.fillStyle = '#ffd23f';
      ctx.fillText(def.name.toUpperCase(), tx, 290);
      ctx.font = '8px "Press Start 2P", monospace';
      ctx.lineWidth = 3;
      ctx.strokeText(def.arch.toUpperCase(), tx, 318);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(def.arch.toUpperCase(), tx, 318);
      ctx.restore();
    } else if (t < 14) {
      // Estadio nocturno con reflectores
      ctx.fillStyle = '#05030c';
      ctx.fillRect(0, 160, W, H);
      ctx.fillStyle = '#0c0820';
      ctx.beginPath();
      ctx.moveTo(0, 230);
      ctx.quadraticCurveTo(W / 2, 120, W, 230);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const a = Math.sin(t * 1.4 + i) * 0.5;
        const x = 80 + i * 160;
        ctx.save();
        ctx.translate(x, 200);
        ctx.rotate(a);
        const g = ctx.createLinearGradient(0, 0, 0, -260);
        g.addColorStop(0, 'rgba(255,250,210,0.35)');
        g.addColorStop(1, 'rgba(255,250,210,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-6, 0);
        ctx.lineTo(6, 0);
        ctx.lineTo(50, -260);
        ctx.lineTo(-50, -260);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = '#2f9e44';
      ctx.beginPath();
      ctx.moveTo(120, 250);
      ctx.lineTo(520, 250);
      ctx.lineTo(600, 330);
      ctx.lineTo(40, 330);
      ctx.fill();
    } else if (t < this.TITLE_T) {
      // El balón de fuego se lanza contra la cámara
      const k = clamp((t - 14) / (this.TITLE_T - 14), 0, 1);
      const r = lerp(3, 150, easeInCubic(k));
      const g = ctx.createRadialGradient(W / 2, H / 2, r * 0.2, W / 2, H / 2, r * 1.6);
      g.addColorStop(0, 'rgba(255,241,168,0.9)');
      g.addColorStop(0.5, 'rgba(255,61,0,0.5)');
      g.addColorStop(1, 'rgba(255,61,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = false;
      const frames = this.g.ballFrames;
      const f = frames[Math.floor(t * 20) % 4];
      ctx.drawImage(f, W / 2 - r, H / 2 - r, r * 2, r * 2);
    } else {
      // TÍTULO
      const tt = t - this.TITLE_T;
      drawRays(ctx, W / 2, H / 2 - 20, t, 'rgba(255,210,63,0.16)', 'rgba(255,43,214,0.10)');
      drawLogo(ctx, this.g, W / 2, H / 2 - 30, 1.3, tt);
      if (tt > 1.8 && Math.floor(t * 2.5) % 2) {
        ctx.font = '10px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText('PRESIONA ENTER', W / 2, 300);
      }
    }
    this.texts.forEach((it) => this.drawText(ctx, it));
    this.parts.draw(ctx, 'screen');
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(-10, -10, W + 20, H + 20);
    }
    ctx.restore();
    if (t < this.TITLE_T) {
      ctx.font = '6px "Press Start 2P", monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('CUALQUIER TECLA: SALTAR', W - 10, H - 10);
    }
  }
}

/** Fondo animado del menú: rayos, estrellas, logo y desfile de personajes. */
class TitleScene {
  constructor(game) {
    this.g = game;
    this.t = 0;
    this.stars = new Starfield(160);
    this.runners = ROSTER.map((def, i) => ({ def, x: CFG.W + i * 70, y: 318 + (i % 2) * 14, speed: 70 + (i % 3) * 12, kit: i % 2 ? KITS.rojo : KITS.azul, phase: rand(0, 4) }));
  }

  update(dt) {
    this.t += dt;
    this.stars.update(dt, 0.08);
    for (const r of this.runners) {
      r.x -= r.speed * dt;
      r.phase += dt * r.speed * 0.06;
      if (r.x < -40) r.x = CFG.W + rand(20, 260);
    }
  }

  draw(ctx, showLogo = true) {
    const W = CFG.W;
    const H = CFG.H;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0b0620');
    bg.addColorStop(0.7, '#2a0f4a');
    bg.addColorStop(1, '#4a1a5c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    this.stars.draw(ctx, false);
    drawRays(ctx, 420, 96, this.t, 'rgba(255,210,63,0.10)', 'rgba(255,43,214,0.07)');
    ctx.fillStyle = '#16092b';
    ctx.fillRect(0, 300, W, 60);
    ctx.fillStyle = '#ff2bd6';
    ctx.fillRect(0, 300, W, 1);
    ctx.strokeStyle = 'rgba(255,43,214,0.35)';
    ctx.lineWidth = 1;
    for (let i = -10; i < 20; i++) {
      const x = ((i * 48 - this.t * 40) % (W + 480)) + 0;
      ctx.beginPath();
      ctx.moveTo(W / 2 + (x - W / 2) * 0.3, 300);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (const r of this.runners.slice().sort((a, b) => a.y - b.y)) {
      const pose = `run${Math.floor(r.phase) % 4}`;
      const spr = this.g.sprites.get(r.def, r.kit, pose, true);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 9, 3, 0, 0, TAU);
      ctx.fill();
      ctx.drawImage(spr, Math.round(r.x - CFG.FOOT_X), Math.round(r.y - CFG.FOOT_Y));
    }
    if (showLogo) drawLogo(ctx, this.g, 420, 104, 0.95, 5 + this.t);
  }
}

/* =============================================================================
   12. INTERFAZ DOM: MENÚS, SELECCIÓN, DIÁLOGOS Y RESULTADOS
   ============================================================================= */

class MenuUI {
  constructor(game) {
    this.g = game;
    this.screens = {};
    ['boot', 'menu', 'controls', 'config', 'select', 'dialogue', 'pause', 'results'].forEach((k) => {
      this.screens[k] = document.getElementById(`screen-${k}`);
    });
    this.active = null;
    this.items = [];
    this.focus = 0;
    const stage = document.getElementById('stage');
    stage.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el) this.g.onAction(el.dataset.action, el.dataset.value, el);
    });
    stage.addEventListener('mouseover', (e) => {
      const el = e.target.closest('.menu-item');
      if (el && this.items.includes(el) && this.items.indexOf(el) !== this.focus) {
        this.focus = this.items.indexOf(el);
        this.applyFocus();
      }
    });
    this.muteBtn = document.getElementById('btn-mute');
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.g.toggleMute();
    });
  }

  show(key) {
    for (const k of Object.keys(this.screens)) this.screens[k].classList.toggle('is-active', k === key);
    this.active = key;
    this.refreshItems();
  }

  refreshItems() {
    const el = this.screens[this.active];
    this.items = el ? [...el.querySelectorAll('.menu-item')].filter((i) => !i.hidden) : [];
    this.focus = 0;
    this.applyFocus();
  }

  applyFocus() {
    this.items.forEach((it, i) => it.classList.toggle('is-focused', i === this.focus));
  }

  nav(input) {
    if (!this.items.length) {
      if (input.menu('back')) this.g.onAction('back');
      return;
    }
    let moved = 0;
    if (input.menu('up') || input.menu('left')) moved = -1;
    if (input.menu('down') || input.menu('right')) moved = 1;
    if (moved) {
      this.focus = (this.focus + moved + this.items.length) % this.items.length;
      this.applyFocus();
      this.g.sound.sfx('move');
    }
    if (input.menu('confirm')) {
      const it = this.items[this.focus];
      if (it) it.click();
    } else if (input.menu('back')) {
      this.g.onAction('back');
    }
  }

  setMuted(m) {
    this.muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
  }
}

/** Pantalla de selección estilo juego de pelea (4 personajes de campo por equipo). */
class SelectUI {
  constructor(game) {
    this.g = game;
    this.grid = document.getElementById('select-grid');
    this.statusEl = document.getElementById('select-status');
    this.modeEl = document.getElementById('select-mode');
    this.cards = [];
    this.previewT = 0;
    ROSTER.forEach((def, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'char-card';
      btn.dataset.action = 'pick';
      btn.dataset.value = String(i);
      btn.setAttribute('aria-label', `${def.full}, ${def.arch}`);
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      cv.className = 'char-card__portrait';
      cv.setAttribute('aria-hidden', 'true');
      this.g.portraits.paint(cv, def);
      const name = document.createElement('span');
      name.className = 'char-card__name';
      name.textContent = def.name;
      const t1 = document.createElement('span');
      t1.className = 'char-card__tag char-card__tag--p1';
      t1.textContent = '1P';
      t1.hidden = true;
      const t2 = document.createElement('span');
      t2.className = 'char-card__tag char-card__tag--p2';
      t2.textContent = '2P';
      t2.hidden = true;
      const picks = document.createElement('span');
      picks.className = 'char-card__picks';
      const pk1 = document.createElement('span');
      pk1.className = 'char-card__pick--p1';
      const pk2 = document.createElement('span');
      pk2.className = 'char-card__pick--p2';
      picks.append(pk1, pk2);
      btn.append(cv, name, t1, t2, picks);
      li.append(btn);
      this.grid.append(li);
      btn.addEventListener('mouseenter', () => this.hover(i));
      this.cards.push({ btn, t1, t2, pk1, pk2 });
    });
    this.sides = [0, 1].map((i) => {
      const detail = document.getElementById(`detail-${i}`);
      const slotsEl = document.getElementById(`team-slots-${i}`);
      const slots = [];
      for (let k = 0; k < 4; k++) {
        const li = document.createElement('li');
        li.className = 'team-slot';
        const cv = document.createElement('canvas');
        cv.width = 32;
        cv.height = 32;
        cv.className = 'team-slot__canvas';
        cv.setAttribute('aria-hidden', 'true');
        const num = document.createElement('span');
        num.className = 'team-slot__num';
        num.textContent = String(k + 1);
        li.append(cv, num);
        slotsEl.append(li);
        slots.push({ li, cv, id: null });
      }
      return {
        panel: document.querySelector(`.team-panel--p${i + 1}`),
        nameEl: document.getElementById(`team-name-${i}`),
        slots,
        dName: detail.querySelector('.char-detail__name'),
        dArch: detail.querySelector('.char-detail__arch'),
        dPortrait: detail.querySelector('.char-detail__portrait'),
        dSprite: detail.querySelector('.char-detail__sprite'),
        dStats: detail.querySelector('.stats'),
        dMoves: detail.querySelector('.moves'),
        shownId: null,
      };
    });
  }

  open(cfg) {
    this.cfg = cfg;
    const pvp = cfg.mode === 'pvp';
    const story = cfg.mode === 'story';
    const inp = this.g.input;
    this.state = [
      { human: new PlayerInput(inp, 0), cursor: 0, picks: [], ready: false, cpu: false, kit: KITS.azul },
      { human: pvp ? new PlayerInput(inp, 1) : null, cursor: 4, picks: [], ready: false, cpu: !pvp && !story, cpuT: 0, kit: KITS.rojo },
    ];
    if (story) {
      const st = STORY[cfg.storyStage];
      this.state[1].picks = st.roster.slice();
      this.state[1].ready = true;
      this.state[1].cursor = ROSTER.findIndex((d) => d.id === st.captain);
      this.state[1].kit = KITS[st.kit];
    }
    const diff = DIFFICULTY[cfg.difficulty];
    this.sides[0].nameEl.textContent = 'Jugador 1';
    this.sides[1].nameEl.textContent = pvp ? 'Jugador 2' : story ? `Rival: ${STORY[cfg.storyStage].team}` : `CPU · ${diff.label}`;
    this.modeEl.textContent = story ? `Modo Historia · Partido ${cfg.storyStage + 1}/5` : pvp ? 'VS 2 Jugadores' : `VS CPU · ${diff.label}`;
    this.cards.forEach((c) => { c.t2.textContent = pvp ? '2P' : story ? 'RIV' : 'CPU'; });
    this.sides.forEach((s) => { s.shownId = null; s.slots.forEach((sl) => { sl.id = undefined; }); });
    this.render();
  }

  get allReady() { return this.state.every((s) => s.ready); }

  hover(i) {
    if (!this.state) return;
    const s = this.cfg.mode === 'pvp' && this.state[0].ready && !this.state[1].ready ? this.state[1] : this.state[0];
    if (s.ready) return;
    s.cursor = i;
    this.render();
  }

  pickFromMouse(i) {
    if (this.allReady) {
      this.g.onSelectDone(this.state[0].picks, this.state[1].picks);
      return;
    }
    const pvp = this.cfg.mode === 'pvp';
    const s = !this.state[0].ready ? this.state[0] : pvp && !this.state[1].ready ? this.state[1] : null;
    if (!s) return;
    s.cursor = i;
    this.add(s);
  }

  add(s) {
    const id = ROSTER[s.cursor].id;
    if (s.ready || s.picks.includes(id) || s.picks.length >= 4) {
      this.g.sound.sfx('back');
      return;
    }
    s.picks.push(id);
    this.g.sound.sfx('confirm');
    if (s.picks.length === 4) {
      s.ready = true;
      this.g.sound.sfx('zonePerfect');
    }
    this.render();
  }

  remove(s) {
    if (this.cfg.mode === 'story' && s === this.state[1]) return;
    if (!s.picks.length) return;
    s.picks.pop();
    s.ready = false;
    this.g.sound.sfx('back');
    this.render();
  }

  move(s, dx, dy) {
    let col = s.cursor % 5;
    let row = Math.floor(s.cursor / 5);
    col = (col + dx + 5) % 5;
    row = (row + dy + 2) % 2;
    s.cursor = row * 5 + col;
    this.g.sound.sfx('move');
    this.render();
  }

  update(dt, input) {
    this.previewT += dt;
    for (const s of this.state) {
      if (!s.human) continue;
      const H = s.human;
      if (!s.ready) {
        if (H.pressed('left')) this.move(s, -1, 0);
        if (H.pressed('right')) this.move(s, 1, 0);
        if (H.pressed('up')) this.move(s, 0, -1);
        if (H.pressed('down')) this.move(s, 0, 1);
        if (H.pressed('pass')) this.add(s);
      } else if (this.allReady && H.pressed('pass')) {
        this.g.onSelectDone(this.state[0].picks, this.state[1].picks);
        return;
      }
      if (H.pressed('cross')) this.remove(s);
    }
    if (input.wasPressed('Enter') || input.wasPressed('NumpadEnter')) {
      if (this.allReady) {
        this.g.onSelectDone(this.state[0].picks, this.state[1].picks);
        return;
      }
      const s = !this.state[0].ready ? this.state[0] : this.state[1].human && !this.state[1].ready ? this.state[1] : null;
      if (s) this.add(s);
    }
    if (input.wasPressed('Escape') || input.wasPressed('Backspace') || input.padPressed(0, 1)) {
      this.g.onAction('back');
      return;
    }
    const cpu = this.state[1];
    if (cpu.cpu && !cpu.ready && this.state[0].ready) {
      cpu.cpuT += dt;
      if (cpu.cpuT > 0.28) {
        cpu.cpuT = 0;
        const options = ROSTER.map((d, i) => i).filter((i) => !cpu.picks.includes(ROSTER[i].id));
        cpu.cursor = pick(options);
        cpu.picks.push(ROSTER[cpu.cursor].id);
        this.g.sound.sfx('select');
        if (cpu.picks.length === 4) cpu.ready = true;
        this.render();
      }
    }
    this.drawPreviews();
  }

  render() {
    const [A, B] = this.state;
    this.cards.forEach((c, i) => {
      c.btn.classList.toggle('is-cursor-0', A.cursor === i && !A.ready);
      c.btn.classList.toggle('is-cursor-1', B.cursor === i && !B.ready && (B.human || B.cpu));
      c.t1.hidden = !(A.cursor === i && !A.ready);
      c.t2.hidden = !(B.cursor === i && !B.ready && (B.human || B.cpu));
      const id = ROSTER[i].id;
      c.pk1.textContent = A.picks.includes(id) ? `1P${A.picks.indexOf(id) + 1}` : '';
      c.pk2.textContent = B.picks.includes(id) ? `${this.cfg.mode === 'pvp' ? '2P' : 'R'}${B.picks.indexOf(id) + 1}` : '';
    });
    this.state.forEach((s, i) => {
      const side = this.sides[i];
      side.panel.classList.toggle('is-ready', s.ready);
      side.slots.forEach((sl, k) => {
        const id = s.picks[k] || null;
        if (sl.id === id) return;
        sl.id = id;
        sl.li.classList.toggle('is-filled', !!id);
        this.g.portraits.paint(sl.cv, id ? ROSTER_BY_ID[id] : null);
      });
      const def = ROSTER[s.cursor];
      if (side.shownId !== def.id) {
        side.shownId = def.id;
        side.dName.textContent = def.full;
        side.dArch.textContent = `${def.arch} · ${def.title}`;
        this.g.portraits.paint(side.dPortrait, def);
        side.dStats.replaceChildren();
        for (const [k, label] of Object.entries(STAT_LABELS)) {
          const dt = document.createElement('dt');
          dt.textContent = label;
          const dd = document.createElement('dd');
          const bar = document.createElement('span');
          bar.className = `pips pips--${def.stats[k]}`;
          dd.append(bar);
          side.dStats.append(dt, dd);
        }
        side.dMoves.replaceChildren();
        const rows = [
          ['Golpe Único (U)', def.unique.name, ''],
          ['Habilidad (O)', def.skill.name, ''],
          ['Supertiro', def.super.name, 'moves__super'],
        ];
        for (const [label, name, cls] of rows) {
          const li = document.createElement('li');
          if (cls) li.className = cls;
          const strong = document.createElement('strong');
          strong.textContent = label;
          li.append(strong, document.createTextNode(name));
          side.dMoves.append(li);
        }
      }
    });
    const st = this.statusEl;
    if (this.allReady) {
      st.textContent = '¡LISTOS! Pulsa J / Enter para saltar a la cancha';
      st.classList.add('is-ready');
    } else {
      st.classList.remove('is-ready');
      const need = 4 - A.picks.length;
      if (!A.ready) st.textContent = `Jugador 1: elige ${need} personaje${need === 1 ? '' : 's'} más. El portero es automático.`;
      else if (B.human) st.textContent = `Jugador 2: elige ${4 - B.picks.length} personaje${4 - B.picks.length === 1 ? '' : 's'} más.`;
      else st.textContent = 'La CPU está eligiendo...';
    }
  }

  drawPreviews() {
    const poses = ['idle0', 'idle1', 'run0', 'run1', 'run2', 'run3', 'run0', 'run1', 'run2', 'run3', 'kick', 'attack', 'charge', 'cheer'];
    this.state.forEach((s, i) => {
      const cv = this.sides[i].dSprite;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, cv.width, cv.height);
      const pose = poses[Math.floor(this.previewT * 6) % poses.length];
      ctx.drawImage(this.g.sprites.get(ROSTER[s.cursor], s.kit, pose, i === 1), 0, 0);
    });
  }
}

/** Diálogos estilo novela visual antes de cada partido del Modo Historia. */
class DialogueUI {
  constructor(game) {
    this.g = game;
    this.titleEl = document.getElementById('dialogue-title');
    this.rivalEl = document.getElementById('dialogue-rival');
    this.left = document.getElementById('dialogue-left');
    this.right = document.getElementById('dialogue-right');
    this.speakerEl = document.getElementById('dialogue-speaker');
    this.textEl = document.getElementById('dialogue-text');
    document.querySelector('.dialogue__box').addEventListener('click', () => this.advance());
    this.onDone = null;
  }

  open({ title, subtitle, hero, rival, lines, onDone }) {
    this.titleEl.textContent = title;
    this.rivalEl.textContent = subtitle;
    this.hero = hero;
    this.rival = rival;
    this.lines = lines;
    this.onDone = onDone;
    this.g.portraits.paint(this.left, hero);
    this.g.portraits.paint(this.right, rival);
    this.idx = 0;
    this.showLine();
  }

  showLine() {
    const [who, text] = this.lines[this.idx];
    const isRival = who === 'rival';
    this.speakerEl.textContent = isRival ? this.rival.full : this.hero.full;
    this.speakerEl.classList.toggle('is-rival', isRival);
    this.left.classList.toggle('is-speaking', !isRival);
    this.right.classList.toggle('is-speaking', isRival);
    this.full = text;
    this.shown = 0;
    this.textEl.textContent = '';
  }

  update(dt, input) {
    if (this.shown < this.full.length) {
      const prev = Math.floor(this.shown);
      this.shown = Math.min(this.full.length, this.shown + dt * 48);
      const n = Math.floor(this.shown);
      if (n > prev) {
        this.textEl.textContent = this.full.slice(0, n);
        if (n % 2 === 0) this.g.sound.sfx('type');
      }
    }
    if (input.menu('confirm')) this.advance();
    else if (input.menu('back')) this.finish();
  }

  advance() {
    if (!this.onDone) return;
    if (this.shown < this.full.length) {
      this.shown = this.full.length;
      this.textEl.textContent = this.full;
      return;
    }
    this.idx++;
    if (this.idx >= this.lines.length) this.finish();
    else {
      this.g.sound.sfx('select');
      this.showLine();
    }
  }

  finish() {
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
  }
}

class ResultsUI {
  constructor() {
    this.titleEl = document.getElementById('results-title');
    this.scoreEl = document.getElementById('results-score');
    this.names = [0, 1].map((i) => document.getElementById(`results-name-${i}`));
    this.scorers = [0, 1].map((i) => document.getElementById(`results-scorers-${i}`));
    this.mvpEl = document.getElementById('results-mvp');
    this.buttons = [...document.querySelectorAll('#screen-results [data-action]')];
  }

  show(r, opts) {
    this.titleEl.textContent = opts.title;
    this.titleEl.classList.toggle('is-defeat', !!opts.defeat);
    this.titleEl.classList.remove('results__title');
    void this.titleEl.offsetWidth; // reinicia la animación CSS
    this.titleEl.classList.add('results__title');
    this.scoreEl.textContent = `${r.score[0]} — ${r.score[1]}`;
    [0, 1].forEach((i) => {
      this.names[i].textContent = r.names[i];
      this.scorers[i].replaceChildren();
      const list = r.scorers[i].length ? r.scorers[i] : ['Sin goles'];
      list.forEach((n) => {
        const li = document.createElement('li');
        li.textContent = n === 'Sin goles' ? n : `⚽ ${n}`;
        this.scorers[i].append(li);
      });
    });
    const m = r.mvp;
    const detail = m.goals ? `${m.goals} gol${m.goals > 1 ? 'es' : ''}` : m.saves ? `${m.saves} atajadas` : `${m.steals} robos`;
    this.mvpEl.textContent = `MVP: ${m.name} (${m.team}) · ${detail}`;
    for (const b of this.buttons) b.hidden = !(b.dataset.action === 'quit' || opts.buttons.includes(b.dataset.action));
  }
}

/* =============================================================================
   13. GAME: ARRANQUE, MÁQUINA DE ESTADOS GLOBAL Y BUCLE PRINCIPAL
   ============================================================================= */

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.input = new InputManager();
    this.sound = new SoundManager();
    this.assets = new AssetLoader();
    this.sprites = new SpriteFactory(this.assets);
    this.portraits = new PortraitFactory(this.assets);
    this.state = 'loading';
    this.cfg = { mode: 'cpu', difficulty: 'normal', minutes: 3, storyStage: 0 };
    this.story = { stage: 0, roster: null };
    this.match = null;
    this.intro = null;
    this.bgStadium = null;
    this.controlsReturn = 'menu';
    this.last = 0;
    this.acc = 0;
    this.time = 0;
  }

  async init() {
    try {
      await Promise.race([
        Promise.all(['16px "Press Start 2P", monospace', '40px Bangers', '16px "Chakra Petch"'].map((f) => document.fonts.load(f))),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch (err) {
      /* Sin fuentes web: se usan las de respaldo. */
    }
    await this.assets.load();
    this.ballFrames = makeBallFrames();
    this.ui = new MenuUI(this);
    this.select = new SelectUI(this);
    this.dialogue = new DialogueUI(this);
    this.results = new ResultsUI();
    this.title = new TitleScene(this);
    this.state = 'boot';
    this.ui.show('boot');
    document.getElementById('stage').addEventListener('pointerdown', (e) => {
      if (this.state === 'intro') this.intro.skip();
      else if (this.state === 'boot' && !e.target.closest('#btn-mute')) this.onAction('boot');
    });
    window.__game = this;
    requestAnimationFrame((t) => this.loop(t));
  }

  loop(ts) {
    const dt = Math.min(0.1, (ts - (this.last || ts)) / 1000);
    this.last = ts;
    this.acc += dt;
    this.input.poll();
    let steps = 0;
    while (this.acc >= CFG.STEP && steps < 6) {
      this.update(CFG.STEP);
      this.input.endStep();
      this.acc -= CFG.STEP;
      steps++;
    }
    if (steps >= 6) this.acc = 0;
    this.render();
    requestAnimationFrame((t) => this.loop(t));
  }

  pausePressed() {
    const i = this.input;
    return i.wasPressed('Escape') || i.wasPressed('KeyP') || i.padPressed(0, 9) || i.padPressed(1, 9);
  }

  update(dt) {
    this.time += dt;
    this.sound.update(dt);
    if (this.input.wasPressed('KeyM')) this.toggleMute();
    switch (this.state) {
      case 'boot':
        if (this.input.anyPressed && !this.input.wasPressed('KeyM')) this.onAction('boot');
        break;
      case 'intro':
        this.intro.update(dt);
        if (this.input.anyPressed && !this.input.wasPressed('KeyM')) this.intro.skip();
        break;
      case 'menu':
      case 'controls':
      case 'config':
        this.title.update(dt);
        this.ui.nav(this.input);
        break;
      case 'select':
        this.title.update(dt);
        this.select.update(dt, this.input);
        break;
      case 'dialogue':
        this.dialogue.update(dt, this.input);
        break;
      case 'match':
        if (this.pausePressed()) this.pause();
        else this.match.update(dt);
        break;
      case 'pause':
        if (this.input.wasPressed('KeyP') || this.input.padPressed(0, 9) || this.input.padPressed(1, 9)) this.resume();
        else this.ui.nav(this.input);
        break;
      case 'results':
        if (this.match) this.match.update(dt);
        this.ui.nav(this.input);
        break;
      default:
        break;
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    switch (this.state) {
      case 'loading':
        ctx.fillStyle = '#0b0614';
        ctx.fillRect(0, 0, CFG.W, CFG.H);
        break;
      case 'intro':
        this.intro.draw(ctx);
        break;
      case 'match':
      case 'pause':
      case 'results':
        if (this.match) this.match.render(ctx);
        break;
      case 'dialogue':
        this.drawStadiumBg(ctx);
        break;
      case 'controls':
        if (this.controlsReturn === 'pause' && this.match) this.match.render(ctx);
        else this.title.draw(ctx, false);
        break;
      default:
        this.title.draw(ctx, this.state === 'menu');
    }
  }

  drawStadiumBg(ctx) {
    if (!this.bgStadium) this.bgStadium = new Stadium({});
    VIEW.camX = CFG.FW / 2 + Math.sin(this.time * 0.15) * 220;
    VIEW.ox = 0;
    VIEW.oy = 0;
    const s = this.bgStadium;
    s.update(1 / 60);
    s.drawBackground(ctx);
    s.drawField(ctx);
    s.drawGoalBack(ctx, 0);
    s.drawGoalBack(ctx, 1);
    s.drawGoalFront(ctx, 0);
    s.drawGoalFront(ctx, 1);
    s.drawForeground(ctx);
  }

  toggleMute() {
    const m = this.sound.toggleMute();
    if (this.ui) this.ui.setMuted(m);
  }

  /* ---------- Navegación entre pantallas ---------- */
  onAction(action, value) {
    const S = this.sound;
    switch (action) {
      case 'boot':
        if (this.state !== 'boot') return;
        S.unlock();
        S.playMusic('match');
        S.setLevel('menu');
        this.intro = new IntroScene(this);
        this.state = 'intro';
        this.ui.show(null);
        break;
      case 'home':
        window.location.href = '../../index.html';
        break;
      case 'mode-story':
      case 'mode-cpu':
      case 'mode-pvp':
        S.sfx('confirm');
        this.cfg.mode = action.slice(5);
        this.openConfig();
        break;
      case 'mode-demo':
        S.sfx('confirm');
        this.startDemo();
        break;
      case 'controls':
        S.sfx('confirm');
        this.controlsReturn = 'menu';
        this.state = 'controls';
        this.ui.show('controls');
        break;
      case 'pause-controls':
        S.sfx('confirm');
        this.controlsReturn = 'pause';
        this.state = 'controls';
        this.ui.show('controls');
        break;
      case 'back':
        S.sfx('back');
        if (this.state === 'controls') {
          if (this.controlsReturn === 'pause') {
            this.state = 'pause';
            this.ui.show('pause');
          } else this.toMenu();
        } else if (this.state === 'config') this.toMenu();
        else if (this.state === 'select') this.openConfig();
        else if (this.state === 'pause') this.resume();
        else if (this.state === 'results') this.toMenu();
        break;
      case 'difficulty':
      case 'duration': {
        S.sfx('select');
        if (action === 'difficulty') this.cfg.difficulty = value;
        else this.cfg.minutes = Number(value);
        document.querySelectorAll(`[data-action="${action}"]`).forEach((b) => b.setAttribute('aria-pressed', b.dataset.value === value ? 'true' : 'false'));
        break;
      }
      case 'to-select':
        S.sfx('confirm');
        this.openSelect();
        break;
      case 'pick':
        if (this.state === 'select') this.select.pickFromMouse(Number(value));
        break;
      case 'dialogue-skip':
        this.dialogue.finish();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
      case 'rematch':
      case 'retry':
        S.sfx('confirm');
        this.startMatch(this.lastMatchCfg);
        break;
      case 'reselect':
        S.sfx('confirm');
        this.openSelect();
        break;
      case 'next':
        S.sfx('confirm');
        this.story.stage++;
        this.startStoryStage();
        break;
      case 'quit':
        S.sfx('back');
        this.toMenu();
        break;
      default:
        break;
    }
  }

  onIntroDone() {
    this.toMenu();
  }

  toMenu() {
    this.match = null;
    this.state = 'menu';
    this.ui.show('menu');
    this.sound.stopCharge();
    this.sound.voice.cancel();
    this.sound.playMusic('match');
    this.sound.setLevel('menu');
  }

  openConfig() {
    const mode = this.cfg.mode;
    this.state = 'config';
    this.sound.playMusic('select');
    this.sound.setLevel('menu');
    const title = { story: 'Modo Historia', cpu: 'VS CPU', pvp: 'VS 2 Jugadores' }[mode];
    const desc = {
      story: 'Supera a 5 equipos rivales de dificultad creciente en el Súper Torneo Dimensional. Cada partido empieza con un diálogo; si pierdes, puedes reintentar.',
      cpu: 'Elige la dificultad de la CPU: ajusta su tiempo de reacción, su precisión en la barra de Supertiro y su agresividad al golpear y despejar centros.',
      pvp: 'Jugador 1 (WASD + J K L U I) contra Jugador 2 (Flechas + Num 1-5). También funcionan dos mandos conectados.',
    }[mode];
    document.getElementById('config-title').textContent = title;
    document.getElementById('config-desc').textContent = desc;
    document.getElementById('config-difficulty').hidden = mode !== 'cpu';
    this.ui.show('config');
    const items = this.ui.items;
    const target = items.findIndex((b) => b.dataset.action === 'to-select');
    if (target >= 0) {
      this.ui.focus = target;
      this.ui.applyFocus();
    }
  }

  openSelect() {
    this.state = 'select';
    this.match = null;
    this.sound.playMusic('select');
    this.sound.setLevel('menu');
    this.cfg.storyStage = this.cfg.mode === 'story' ? 0 : this.cfg.storyStage;
    this.select.open(this.cfg);
    this.ui.show('select');
  }

  onSelectDone(picks0, picks1) {
    this.sound.sfx('go');
    if (this.cfg.mode === 'story') {
      this.story.roster = picks0.slice();
      this.story.stage = 0;
      this.startStoryStage();
      return;
    }
    const pvp = this.cfg.mode === 'pvp';
    const diff = DIFFICULTY[this.cfg.difficulty];
    this.startMatch({
      mode: this.cfg.mode,
      minutes: this.cfg.minutes,
      teams: [
        { name: 'Equipo Azul', short: 'AZU', kit: 'azul', roster: picks0.slice(), human: 0, keeperSkill: 0.62, label: '1P' },
        pvp
          ? { name: 'Equipo Rojo', short: 'ROJ', kit: 'rojo', roster: picks1.slice(), human: 1, keeperSkill: 0.62, label: '2P' }
          : { name: `CPU ${diff.label}`, short: 'CPU', kit: 'rojo', roster: picks1.slice(), human: null, ai: diff, keeperSkill: diff.keeper, label: `CPU · ${diff.label.toUpperCase()}` },
      ],
    });
  }

  startStoryStage() {
    const st = STORY[this.story.stage];
    const diff = DIFFICULTY[st.diff];
    this.state = 'dialogue';
    this.bgStadium = new Stadium({ sky: st.sky, teamColors: [KITS.azul.ui, KITS[st.kit].ui] });
    this.sound.playMusic('select');
    this.sound.setLevel('menu');
    this.ui.show('dialogue');
    this.ui.focus = -1;
    this.ui.applyFocus();
    this.dialogue.open({
      title: `Partido ${this.story.stage + 1} / 5`,
      subtitle: `VS ${st.team} · ${st.stage} · ${diff.label}`,
      hero: ROSTER_BY_ID[this.story.roster[0]],
      rival: ROSTER_BY_ID[st.captain],
      lines: st.lines,
      onDone: () => {
        this.startMatch({
          mode: 'story',
          minutes: this.cfg.minutes,
          sky: st.sky,
          teams: [
            { name: 'Equipo Azul', short: 'AZU', kit: 'azul', roster: this.story.roster.slice(), human: 0, keeperSkill: 0.62, label: '1P' },
            { name: st.team, short: st.short, kit: st.kit, roster: st.roster.slice(), human: null, ai: diff, keeperSkill: diff.keeper, label: diff.label.toUpperCase() },
          ],
        });
      },
    });
  }

  startDemo() {
    const r = shuffle(ROSTER.map((d) => d.id));
    const diff = DIFFICULTY.leyenda;
    this.cfg.mode = 'demo';
    this.startMatch({
      mode: 'demo',
      minutes: 2,
      teams: [
        { name: 'Dimensión Alfa', short: 'ALF', kit: 'azul', roster: r.slice(0, 4), human: null, ai: diff, keeperSkill: diff.keeper, label: 'CPU' },
        { name: 'Dimensión Omega', short: 'OMG', kit: 'rojo', roster: r.slice(4, 8), human: null, ai: diff, keeperSkill: diff.keeper, label: 'CPU' },
      ],
    });
  }

  startMatch(mcfg) {
    this.lastMatchCfg = mcfg;
    this.match = new Match(this, mcfg);
    this.state = 'match';
    this.ui.show(null);
    this.sound.playMusic('match');
    this.sound.setLevel('match');
  }

  pause() {
    if (this.state !== 'match') return;
    this.state = 'pause';
    this.ui.show('pause');
    this.sound.setLevel('pause');
    this.sound.stopCharge();
    this.sound.voice.cancel();
    this.sound.sfx('back');
  }

  resume() {
    if (this.state !== 'pause' && this.state !== 'controls') return;
    this.state = 'match';
    this.ui.show(null);
    const m = this.match;
    this.sound.setLevel(m && (m.superBar || m.cutin) ? 'super' : 'match');
    if (m && m.superBar) this.sound.startCharge();
  }

  onMatchEnd(r) {
    const mode = this.cfg.mode === 'demo' ? 'demo' : this.lastMatchCfg.mode;
    const win = r.winner === 0;
    let opts;
    if (mode === 'story') {
      if (win && this.story.stage >= STORY.length - 1) {
        this.state = 'dialogue';
        this.ui.show('dialogue');
        const st = STORY[this.story.stage];
        this.dialogue.open({
          title: '¡Final del torneo!',
          subtitle: 'Arena del Fin de las Dimensiones',
          hero: ROSTER_BY_ID[this.story.roster[0]],
          rival: ROSTER_BY_ID[st.captain],
          lines: STORY_ENDING,
          onDone: () => {
            this.showResults(r, { title: '¡Campeones dimensionales!', buttons: [] });
            this.sound.say('¡Campeones del Súper Torneo Dimensional!', 'epic');
          },
        });
        return;
      }
      opts = win ? { title: '¡Victoria!', buttons: ['next'] } : { title: '¡Derrota!', defeat: true, buttons: ['retry'] };
    } else if (mode === 'cpu') {
      opts = win ? { title: '¡Victoria!', buttons: ['rematch', 'reselect'] } : { title: '¡Derrota!', defeat: true, buttons: ['rematch', 'reselect'] };
    } else {
      opts = { title: `¡Gana ${r.names[r.winner]}!`, buttons: mode === 'demo' ? ['rematch'] : ['rematch', 'reselect'] };
    }
    this.showResults(r, opts);
  }

  showResults(r, opts) {
    this.state = 'results';
    this.results.show(r, opts);
    this.ui.show('results');
    this.sound.playMusic('match');
    this.sound.setLevel('results');
  }
}

/* ---------- Arranque ---------- */
const game = new Game();
game.init();
