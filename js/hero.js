/* ==========================================================================
   Portada del inicio — Santiago Colmenares
   Superficie de partículas en WebGL puro (sin librerías) que al hacer scroll se
   colapsa en una señal de osciloscopio, más las animaciones ligadas al scroll.
   Sin WebGL queda el degradado de la hoja de estilos y el resto sigue igual.
   ========================================================================== */
(function () {
  "use strict";

  const { reduced, clamp, scrub } = window.siteMotion;
  const smooth = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const opening = document.getElementById("opening");
  const statement = document.getElementById("hero-statement");
  const timecode = document.getElementById("hero-timecode");

  /* 1. Secuencia fijada: título → frase que se ilumina palabra por palabra --- */
  let morphGoal = 0;

  if (!reduced) {
    opening.classList.add("is-scrub");

    const words = statement.textContent.trim().split(/\s+/).map((word) => {
      const span = document.createElement("span");
      span.className = "opening__word";
      span.textContent = word;
      return span;
    });
    statement.setAttribute("aria-label", statement.textContent.trim());
    statement.textContent = "";
    words.forEach((span) => {
      span.setAttribute("aria-hidden", "true");
      statement.appendChild(span);
      statement.appendChild(document.createTextNode(" "));
    });

    scrub(opening, "pin", (p) => {
      opening.style.setProperty("--title", smooth(0.02, 0.26, p).toFixed(4));
      opening.style.setProperty("--statement", smooth(0.24, 0.36, p).toFixed(4));
      opening.style.setProperty("--leave", smooth(0.92, 1, p).toFixed(4));
      morphGoal = smooth(0.08, 0.42, p);
      const lit = smooth(0.34, 0.9, p) * words.length;
      words.forEach((span, i) => span.classList.toggle("is-lit", i < lit));
    });
  }

  /* 2. Pistas: el cabezal barre la línea de tiempo --------------------------- */
  const tracks = document.getElementById("tracks");
  if (reduced) tracks.style.setProperty("--playhead", "1");
  const pinned = window.matchMedia("(min-width: 992px) and (min-height: 720px)").matches;
  scrub(document.getElementById("perfil"), pinned ? "pin" : "view", (p) => {
    tracks.style.setProperty("--playhead", smooth(0.06, 0.92, p).toFixed(4));
  });

  /* 3. Franja de juegos: carátulas reales y desplazamiento lateral ----------- */
  const rail = document.getElementById("rail");
  const { GAMES, PIXEL_FONT, drawLabel } = window.Cartridges;
  const covers = Array.from(rail.querySelectorAll("[data-cover]"));
  const paintCovers = () => covers.forEach((cv, i) => {
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(drawLabel(GAMES[cv.dataset.cover], i), 0, 0, cv.width, cv.height);
  });
  if (document.fonts && document.fonts.load) document.fonts.load(PIXEL_FONT).then(paintCovers, paintCovers);
  else paintCovers();

  if (!reduced) rail.classList.add("is-scrub");
  scrub(document.getElementById("juegos"), "view", (p) => {
    rail.style.setProperty("--rail", p.toFixed(4));
  });

  /* 4. Superficie WebGL ------------------------------------------------------ */
  const canvas = document.getElementById("hero-canvas");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "high-performance" });
  if (!gl) {
    canvas.hidden = true;
    return;
  }

  const VERTEX = `
    attribute vec2 aGrid;
    uniform float uTime, uMorph, uIntro, uAspect, uDpr;
    uniform vec2 uMouse;
    varying float vCrest, vAlpha;

    // Ondas cruzadas con deformación de dominio: una señal de audio vista en 3D.
    float field(vec2 p, float t) {
      vec2 q = p + 0.38 * vec2(sin(p.y * 1.3 + t * 0.6), cos(p.x * 1.1 - t * 0.5));
      float h = sin(q.x * 1.5 + t) * 0.46;
      h += sin(q.x * 3.6 - q.y * 1.4 - t * 1.3) * 0.2;
      h += sin(q.y * 2.2 + q.x * 0.8 + t * 0.7) * 0.3;
      h += sin((q.x + q.y) * 6.0 + t * 1.9) * 0.05;
      return h;
    }

    vec2 project(vec3 world, float pitch, out float depth) {
      vec3 v = world - vec3(0.0, mix(2.1, 0.0, uMorph), 5.2);
      float cp = cos(pitch), sp = sin(pitch);
      v = vec3(v.x, cp * v.y - sp * v.z, sp * v.y + cp * v.z);
      depth = -v.z;
      return vec2(v.x * 2.05 / uAspect, v.y * 2.05);
    }

    void main() {
      float u = aGrid.x, v = aGrid.y;
      float x = (u - 0.5) * 17.0;
      float z = mix(3.2 - v * 14.0, 0.0, uMorph);
      float pitch = mix(0.36, 0.0, uMorph);

      // De superficie a cinta: cada fila se convierte en un trazo de la señal.
      vec2 sample = mix(vec2(x, z), vec2(x * 0.62, v * 1.1), uMorph);
      float env = mix(1.0, sin(u * 3.14159) * 1.05, uMorph);
      float h = field(sample, uTime) * env * uIntro * mix(1.0, 1.15, uMorph);

      vec3 world = vec3(x, h - mix(0.2, 1.75, uMorph), z);
      float depth;
      vec2 ndc = project(world, pitch, depth);

      // Onda alrededor del cursor, medida en pantalla.
      vec2 d = (ndc / depth - uMouse) * vec2(uAspect, 1.0);
      float ripple = exp(-dot(d, d) * 7.0);
      world.y += ripple * (0.55 + 0.12 * sin(length(d) * 22.0 - uTime * 5.0)) * uIntro;
      ndc = project(world, pitch, depth);

      vCrest = clamp(h * 0.75 + 0.42 + ripple * 0.75, 0.0, 1.0);
      float far = 1.0 - smoothstep(0.55, 1.0, v);
      float side = smoothstep(0.0, 0.14, u) * (1.0 - smoothstep(0.86, 1.0, u));
      vAlpha = uIntro * mix(far * side, side * 0.3, uMorph);

      gl_Position = vec4(ndc, 0.0, depth);
      gl_PointSize = clamp((1.5 + vCrest * 2.4) * uDpr * 7.0 / depth, 1.0, 9.0 * uDpr);
    }
  `;

  const FRAGMENT = `
    precision mediump float;
    varying float vCrest, vAlpha;
    void main() {
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float disc = 1.0 - smoothstep(0.35, 1.0, r);
      vec3 deep = vec3(0.349, 0.192, 0.588);   // --violet-deep
      vec3 soft = vec3(0.694, 0.592, 0.988);   // --violet-soft
      vec3 color = mix(deep, soft, vCrest);
      color = mix(color, vec3(0.97), smoothstep(0.82, 1.0, vCrest) * 0.75);
      gl_FragColor = vec4(color, disc * vAlpha * (0.34 + vCrest * 0.66));
    }
  `;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    canvas.hidden = true;
    return;
  }
  gl.useProgram(program);

  const small = window.innerWidth < 760;
  const COLS = small ? 170 : 340;
  const ROWS = small ? 80 : 150;
  const grid = new Float32Array(COLS * ROWS * 2);
  for (let j = 0, k = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      grid[k++] = i / (COLS - 1);
      grid[k++] = j / (ROWS - 1);
    }
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
  const aGrid = gl.getAttribLocation(program, "aGrid");
  gl.enableVertexAttribArray(aGrid);
  gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name) => gl.getUniformLocation(program, name);
  const U = {
    time: uniform("uTime"), morph: uniform("uMorph"), intro: uniform("uIntro"),
    aspect: uniform("uAspect"), dpr: uniform("uDpr"), mouse: uniform("uMouse")
  };

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // suma de luz: las crestas brillan solas
  gl.clearColor(0.039, 0.039, 0.039, 1);

  const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75);
  function resize() {
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h || (canvas.width === w && canvas.height === h)) return;
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform1f(U.aspect, w / h);
    gl.uniform1f(U.dpr, dpr);
    if (reduced) draw(4, 0, 1);
  }

  function draw(time, morph, intro) {
    gl.uniform1f(U.time, time);
    gl.uniform1f(U.morph, morph);
    gl.uniform1f(U.intro, intro);
    gl.uniform2f(U.mouse, mouseX, mouseY);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.POINTS, 0, COLS * ROWS);
  }

  let mouseX = 9;
  let mouseY = 9;
  let goalX = 9;
  let goalY = 9;
  if (!reduced) {
    opening.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      goalX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      goalY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      if (mouseX === 9) {
        mouseX = goalX;
        mouseY = goalY;
      }
    }, { passive: true });
  }

  if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
  else window.addEventListener("resize", resize);
  resize();

  /* 5. Bucle: solo corre mientras la portada se ve --------------------------- */
  let visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) requestAnimationFrame(loop);
    }).observe(canvas);
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) requestAnimationFrame(loop);
  });

  const start = performance.now();
  let morph = 0;
  let lastFrames = -1;
  let looping = false;

  function loop(now) {
    if (looping === now) return;
    looping = now;
    if (!visible || document.hidden) return;
    const t = (now - start) / 1000;
    morph += (morphGoal - morph) * 0.08;
    mouseX += (goalX - mouseX) * 0.09;
    mouseY += (goalY - mouseY) * 0.09;
    draw(t * 0.42, morph, smooth(0.1, 1.7, t));

    // Código de tiempo vivo del «monitor», a 24 fotogramas por segundo.
    const frames = 42 * 24 + 18 + Math.floor(t * 24);
    if (frames !== lastFrames) {
      lastFrames = frames;
      const s = Math.floor(frames / 24);
      const pad = (n) => String(n).padStart(2, "0");
      timecode.textContent = "00:" + pad(Math.floor(s / 60)) + ":" + pad(s % 60) + ":" + pad(frames % 24);
    }
    requestAnimationFrame(loop);
  }

  if (reduced) draw(4, 0, 1);
  else requestAnimationFrame(loop);
})();
