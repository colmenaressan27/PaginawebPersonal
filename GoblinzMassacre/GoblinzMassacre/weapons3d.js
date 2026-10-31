/* =========================================================================
   GOBLINZ MASSACRE — Armas 3D en primera persona
   Modelos low-poly construidos por código con Three.js (r128, copia local).
   Se dibujan en una capa transparente sobre el raycaster; si no hay WebGL,
   script.js sigue usando los sprites de siempre.
     1. Texturas y materiales      4. Armas (hacha, revólver, escopeta,
     2. Piezas básicas                molinillo y lanzacohetes)
     3. Brazos y manos             5. Escena, animación y dibujo
   ========================================================================= */
window.Weapons3D = (function () {
  'use strict';

  const T = window.THREE;
  const PI = Math.PI;
  const api = { ok: false, init, resize, draw, fire, icons };
  if (!T) return api;

  let M = null; // materiales compartidos

  /* ---------------- 1. Texturas y materiales ---------------- */
  // Texturas en grises: se multiplican por el color de cada material.
  function grayTex(size, paint) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    paint(cv.getContext('2d'), size);
    const tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.magFilter = T.NearestFilter;
    return tex;
  }
  const repeated = (tex, n) => {
    const t = tex.clone();
    t.repeat.set(n, n);
    t.needsUpdate = true;
    return t;
  };

  function buildMaterials() {
    const speck = grayTex(64, (c, s) => {
      c.fillStyle = '#e4e4e4'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 1100; i++) {
        const v = 175 + (Math.random() * 80 | 0);
        c.fillStyle = `rgb(${v},${v},${v})`;
        c.fillRect(Math.random() * s | 0, Math.random() * s | 0, 1, 1);
      }
      c.lineWidth = 1;
      for (let i = 0; i < 16; i++) {
        c.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.5)' : 'rgba(70,70,70,.4)';
        const x = Math.random() * s, y = Math.random() * s;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + (Math.random() - 0.5) * 22, y + (Math.random() - 0.5) * 22); c.stroke();
      }
    });
    const grain = grayTex(64, (c, s) => {
      c.fillStyle = '#ececec'; c.fillRect(0, 0, s, s);
      for (let x = 0; x < s; x++) {
        const v = 150 + (Math.random() * 100 | 0);
        c.fillStyle = `rgba(${v * 0.8 | 0},${v * 0.72 | 0},${v * 0.62 | 0},.55)`;
        let wob = 0;
        for (let y = 0; y < s; y += 3) {
          wob += (Math.random() - 0.5) * 0.7;
          c.fillRect(x + wob | 0, y, 1, 3);
        }
      }
      c.fillStyle = 'rgba(60,40,25,.55)';
      c.beginPath(); c.ellipse(22, 40, 3, 6, 0, 0, PI * 2); c.fill();
    });
    const leather = grayTex(32, (c, s) => {
      c.fillStyle = '#d6d6d6'; c.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        c.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.2)';
        c.fillRect(Math.random() * s | 0, Math.random() * s | 0, 2, 1);
      }
      c.fillStyle = '#f4efe0';
      for (let x = 2; x < s; x += 6) { c.fillRect(x, 3, 3, 1); c.fillRect(x, s - 4, 3, 1); }
    });
    const weave = grayTex(16, (c, s) => {
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
        c.fillStyle = (x + y) % 4 < 2 ? '#ffffff' : '#b4b4b4';
        c.fillRect(x, y, 1, 1);
      }
    });
    const tally = grayTex(64, (c, s) => { // rayas talladas en la culata: una por goblin
      c.fillStyle = '#ececec'; c.fillRect(0, 0, s, s);
      c.fillStyle = '#3a2412';
      for (let i = 0; i < 4; i++) for (let k = 0; k < 5; k++) c.fillRect(6 + i * 14 + k * 2, 18, 1, 28);
      for (let i = 0; i < 4; i++) { c.save(); c.translate(6 + i * 14, 40); c.rotate(-0.9); c.fillRect(0, 0, 18, 1); c.restore(); }
    });

    const phong = (color, o) => new T.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 16, specular: 0x1c1c1c }, o));
    const metal = (color, o) => phong(color, Object.assign({ map: speck, shininess: 12, specular: 0x3c4046 }, o));
    const fine = (tex, n) => repeated(tex, n);

    return {
      iron: metal(0x858a93),
      ironP: metal(0x858a93, { map: fine(speck, 8) }),
      dark: metal(0x3a3d45, { map: fine(speck, 8) }),
      darkB: metal(0x3a3d45),
      blued: metal(0x34435c, { shininess: 16, specular: 0x505a6c }),
      steel: phong(0xc2c8d2, { shininess: 18, specular: 0x6a6e76, side: T.DoubleSide }),
      iron2: phong(0x6d717a, { shininess: 10, specular: 0x34383e, side: T.DoubleSide }),
      brass: metal(0xc8963a, { shininess: 14, specular: 0x6a5830 }),
      brassP: metal(0xc8963a, { map: fine(speck, 8), shininess: 14, specular: 0x6a5830 }),
      copper: metal(0xb2653a, { shininess: 14, specular: 0x6a4a38 }),
      wood: phong(0x96602f, { map: grain }),
      woodP: phong(0x96602f, { map: fine(grain, 7) }),
      woodD: phong(0x613a1c, { map: grain }),
      woodTally: phong(0x96602f, { map: fine(tally, 6) }),
      leather: phong(0x6a4426, { map: leather }),
      leatherD: phong(0x3e2716, { map: leather }),
      glove: phong(0x4a3020, { map: leather, shininess: 22 }),
      gloveD: phong(0x38240f, { map: leather }),
      skin: phong(0xa8785a),
      sleeve: phong(0x3e4d38, { map: weave }),
      wrap: phong(0xb7a98a, { map: weave }),
      wool: phong(0xb3202c, { map: weave }),
      woolC: phong(0xe8dcc0, { map: weave }),
      shell: phong(0xb32a22, { shininess: 40, specular: 0x553333 }),
      olive: metal(0x4f6638),
      oliveP: metal(0x4f6638, { map: fine(speck, 8) }),
      warhead: metal(0x8a2018, { shininess: 14, specular: 0x6a3c36 }),
      white: phong(0xf0e8d8),
      black: phong(0x0d0d10),
      eye: phong(0xffd23a, { emissive: 0x7a5200 })
    };
  }

  /* ---------------- 2. Piezas básicas ---------------- */
  function put(parent, geo, mat, pos, rot) {
    const m = new T.Mesh(geo, mat);
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    parent.add(m);
    return m;
  }
  const box = (p, size, mat, pos, rot) => put(p, new T.BoxGeometry(size[0], size[1], size[2]), mat, pos, rot);
  const cyl = (p, r1, r2, h, seg, mat, pos, rot) => put(p, new T.CylinderGeometry(r1, r2, h, seg), mat, pos, rot);
  // Cilindro acostado a lo largo del eje Z: el cañón de casi todas las armas.
  const tube = (p, r1, r2, len, seg, mat, pos, roll) => put(p, new T.CylinderGeometry(r1, r2, len, seg), mat, pos, [PI / 2, 0, roll || 0]);

  // Pieza de perfil: polígono en (z, y) extruido a lo ancho (eje X), con chaflán.
  function profile(p, points, width, mat, pos, bevel) {
    const shape = new T.Shape();
    points.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y)));
    shape.closePath();
    const b = bevel === undefined ? 0.002 : bevel;
    const geo = new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1 });
    geo.translate(0, 0, -width / 2);
    geo.rotateY(-PI / 2);
    return put(p, geo, mat, pos);
  }

  // Cilindro entre dos puntos: mangos curvos, antebrazos y cadenas.
  function limb(p, a, b, r1, r2, mat, seg) {
    const A = new T.Vector3(a[0], a[1], a[2]), B = new T.Vector3(b[0], b[1], b[2]);
    const dir = B.clone().sub(A);
    const m = cyl(p, r2, r1, dir.length(), seg || 7, mat);
    m.position.copy(A).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
    return m;
  }

  // Hoja afilada: del lomo grueso al filo en cero, con dos caras por lado.
  function bladeStrip(p, from, to, zFrom, zTo, mat) {
    const v = [];
    const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < from.length - 1; i++) {
      [1, -1].forEach((s) => {
        quad([from[i][0], from[i][1], zFrom * s], [from[i + 1][0], from[i + 1][1], zFrom * s],
          [to[i + 1][0], to[i + 1][1], zTo * s], [to[i][0], to[i][1], zTo * s]);
      });
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    geo.computeVertexNormals();
    return put(p, geo, mat);
  }

  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /* ---------------- 3. Brazos y manos ---------------- */
  // Antebrazo con manga, brazalete de cuero, correas y tachuelas.
  function forearm(p, wrist, elbow) {
    limb(p, wrist, elbow, 0.031, 0.05, M.sleeve, 8);
    limb(p, mix3(wrist, elbow, 0.02), mix3(wrist, elbow, 0.42), 0.036, 0.042, M.leather, 8);
    [0.1, 0.32].forEach((t) => limb(p, mix3(wrist, elbow, t - 0.025), mix3(wrist, elbow, t + 0.025), 0.04, 0.043, M.leatherD, 8));
    for (let i = 0; i < 4; i++) {
      const c = mix3(wrist, elbow, 0.21);
      const a = i * PI / 2 + 0.6;
      box(p, [0.008, 0.008, 0.008], M.brass, [c[0] + Math.cos(a) * 0.04, c[1] + Math.sin(a) * 0.04, c[2]]);
    }
  }

  // Mano cerrada sobre una empuñadura vertical: guante sin dedos.
  function fist(p, pos, rot, s) {
    const g = new T.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.set(rot[0], rot[1], rot[2]);
    p.add(g);
    box(g, [0.05, 0.096, 0.022], M.glove, [s * 0.008, 0, 0.032]);
    box(g, [0.014, 0.094, 0.05], M.glove, [s * 0.032, 0, 0.01]);
    for (let i = 0; i < 4; i++) {
      const y = 0.035 - i * 0.0235;
      box(g, [0.018, 0.021, 0.046], M.glove, [s * 0.033, y, -0.012]);
      box(g, [0.046, 0.021, 0.018], M.gloveD, [s * 0.012, y, -0.036]);
      box(g, [0.02, 0.02, 0.024], M.skin, [s * -0.018, y, -0.026]);
      box(g, [0.007, 0.009, 0.009], M.brass, [s * 0.044, y, 0.014]);
    }
    const thumb = new T.Group();
    thumb.position.set(s * -0.02, 0.03, 0.034);
    thumb.rotation.set(0.15, s * 0.22, 0);
    g.add(thumb);
    box(thumb, [0.02, 0.022, 0.03], M.glove, [0, 0, -0.008]);
    box(thumb, [0.018, 0.019, 0.03], M.skin, [0, 0.002, -0.034]);
    return g;
  }

  // Mano abierta por debajo de un guardamanos horizontal (a lo largo de Z).
  function cradle(p, pos, rot) {
    const g = new T.Group();
    g.position.set(pos[0], pos[1], pos[2]);
    g.rotation.set(rot[0], rot[1], rot[2]);
    p.add(g);
    box(g, [0.056, 0.02, 0.09], M.glove, [0, -0.03, 0]);
    box(g, [0.022, 0.028, 0.05], M.glove, [-0.036, -0.012, 0.01]);
    box(g, [0.018, 0.02, 0.04], M.skin, [-0.04, 0.012, -0.012], [0.1, 0, 0.2]);
    for (let i = 0; i < 4; i++) {
      const z = -0.033 + i * 0.022;
      box(g, [0.016, 0.042, 0.02], M.gloveD, [0.036, -0.008, z]);
      box(g, [0.016, 0.026, 0.019], M.skin, [0.034, 0.024, z], [0, 0, 0.22]);
    }
    return g;
  }

  /* ---------------- 4. Armas ---------------- */
  function emptyWeapon() {
    const root = new T.Group();
    const arms = new T.Group();
    root.add(arms);
    const muzzle = new T.Object3D();
    root.add(muzzle);
    return { root, arms, muzzle, tick() {}, shot() {} };
  }

  // Hacha de la Abuela: mango de madera, bufanda tejida y hoja afilada.
  function buildAxe() {
    const w = emptyWeapon();
    const r = w.root;
    cyl(r, 0.0165, 0.02, 0.74, 8, M.wood, [0, 0.21, 0]);
    cyl(r, 0.029, 0.021, 0.022, 8, M.iron, [0, -0.17, 0]);
    cyl(r, 0.016, 0.029, 0.016, 8, M.iron, [0, -0.189, 0]);
    box(r, [0.008, 0.008, 0.066], M.brass, [0, -0.17, 0]);
    for (let i = 0; i < 8; i++) cyl(r, 0.0235, 0.0235, 0.023, 8, i % 2 ? M.leather : M.leatherD, [0, -0.13 + i * 0.024, 0], [0.2, 0, 0.12]);
    // La bufanda: anillos de lana y dos flecos
    for (let i = 0; i < 7; i++) cyl(r, 0.0245, 0.0245, 0.0165, 8, i % 2 ? M.woolC : M.wool, [0, 0.31 + i * 0.0175, 0]);
    limb(r, [0.018, 0.34, 0.012], [0.05, 0.235, 0.03], 0.011, 0.008, M.wool, 5);
    limb(r, [0.05, 0.235, 0.03], [0.058, 0.17, 0.05], 0.008, 0.012, M.woolC, 5);
    limb(r, [-0.016, 0.33, 0.016], [-0.02, 0.24, 0.044], 0.01, 0.008, M.wool, 5);

    const head = new T.Group();
    head.position.set(0, 0.51, 0);
    r.add(head);
    box(head, [0.056, 0.12, 0.056], M.iron, [0, 0, 0]);
    box(head, [0.06, 0.016, 0.06], M.brass, [0, 0.058, 0]);
    box(head, [0.06, 0.016, 0.06], M.brass, [0, -0.058, 0]);
    box(head, [0.03, 0.024, 0.03], M.woodD, [0, 0.074, 0]);
    box(head, [0.006, 0.03, 0.034], M.iron, [0, 0.082, 0]);

    const spine = [[-0.022, 0.058], [-0.03, 0.03], [-0.034, 0], [-0.03, -0.03], [-0.022, -0.06]];
    const shoulder = [[-0.095, 0.098], [-0.118, 0.054], [-0.126, 0], [-0.116, -0.062], [-0.078, -0.12]];
    const bevel = [[-0.126, 0.128], [-0.156, 0.07], [-0.166, 0], [-0.152, -0.08], [-0.102, -0.158]];
    const edge = [[-0.142, 0.146], [-0.176, 0.08], [-0.188, 0], [-0.172, -0.09], [-0.114, -0.18]];
    bladeStrip(head, spine, shoulder, 0.024, 0.016, M.iron2);
    bladeStrip(head, shoulder, bevel, 0.016, 0.0075, M.iron2);
    bladeStrip(head, bevel, edge, 0.0075, 0, M.steel);
    // Filo superior e inferior del perfil
    bladeStrip(head, [spine[0], shoulder[0], bevel[0]], [spine[0], shoulder[0], edge[0]], 0.024, 0, M.iron2);
    [[-0.05, 0.03], [-0.052, -0.03], [-0.085, 0]].forEach(([x, y]) => {
      put(head, new T.CylinderGeometry(0.0065, 0.0065, 0.054, 6), M.brass, [x, y, 0], [PI / 2, 0, 0]);
    });
    // Runa grabada y salpicadura de sangre seca
    box(head, [0.03, 0.005, 0.0015], M.copper, [-0.1, 0.012, 0.0145]);
    box(head, [0.005, 0.036, 0.0015], M.copper, [-0.1, 0, 0.0145]);
    box(head, [0.028, 0.012, 0.002], M.wool, [-0.15, -0.05, 0.007], [0, 0, 0.4]);
    box(head, [0.016, 0.02, 0.002], M.wool, [-0.14, 0.03, 0.0095], [0, 0, 0.9]);

    // Contrapeso trasero
    box(head, [0.046, 0.066, 0.05], M.iron, [0.05, 0, 0]);
    box(head, [0.016, 0.078, 0.06], M.brass, [0.078, 0, 0]);

    fist(w.arms, [0, -0.04, 0], [0.04, 0.2, -0.1], 1);
    // Pivote en la muñeca: durante el tajo el antebrazo no gira con el hacha.
    w.armPivot = new T.Group();
    w.armPivot.position.set(0.016, -0.075, 0.075);
    w.arms.add(w.armPivot);
    forearm(w.armPivot, [0, 0, 0], [0.3, -0.5, 0.98]);
    w.base = { pos: [0.31, -0.3, -1.24], rot: [-0.26, -0.34, 0.2] };
    w.icon = [0, 0, -PI / 5];
    return w;
  }

  // Escupeplomo: revólver pesado con tambor que gira a cada disparo.
  function buildPistol() {
    const w = emptyWeapon();
    const r = w.root;
    tube(r, 0.0175, 0.0185, 0.222, 8, M.blued, [0, 0.014, -0.208], PI / 8);
    box(r, [0.011, 0.009, 0.222], M.blued, [0, 0.033, -0.208]);
    for (let i = 0; i < 6; i++) box(r, [0.0125, 0.004, 0.018], M.black, [0, 0.0345, -0.296 + i * 0.036]);
    tube(r, 0.0196, 0.0196, 0.012, 8, M.brass, [0, 0.014, -0.318], PI / 8);
    tube(r, 0.0095, 0.0095, 0.008, 8, M.black, [0, 0.014, -0.325]);
    profile(r, [[-0.312, 0.03], [-0.29, 0.03], [-0.296, 0.044], [-0.308, 0.044]], 0.006, M.brass, [0, 0.008, 0], 0.0005);
    tube(r, 0.0078, 0.0078, 0.13, 8, M.blued, [0, -0.013, -0.17]);
    tube(r, 0.0105, 0.0105, 0.012, 8, M.brass, [0, -0.013, -0.24]);
    box(r, [0.013, 0.02, 0.03], M.blued, [0, -0.008, -0.118]);

    profile(r, [[-0.105, 0.042], [0.034, 0.042], [0.06, 0.022], [0.077, -0.012], [0.085, -0.04], [0.03, -0.034],
      [0.018, -0.026], [-0.022, -0.026], [-0.034, -0.016], [-0.105, -0.016]], 0.026, M.dark);
    profile(r, [[-0.1, 0.036], [0.02, 0.036], [0.04, 0.02], [0.05, 0], [0.03, -0.018], [-0.02, -0.018], [-0.03, -0.01], [-0.1, -0.01]],
      0.03, M.brassP, [0, 0, 0], 0);
    for (const [z, y] of [[-0.09, 0.03], [0.022, 0.03], [0.024, -0.012]]) put(r, new T.CylinderGeometry(0.004, 0.004, 0.034, 6), M.iron, [0, y, z], [0, 0, PI / 2]);

    const drum = new T.Group();
    drum.position.set(0, 0.014, -0.052);
    r.add(drum);
    tube(drum, 0.036, 0.036, 0.07, 12, M.iron, [0, 0, 0]);
    tube(drum, 0.038, 0.038, 0.012, 12, M.darkB, [0, 0, 0.03]);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2;
      box(drum, [0.009, 0.011, 0.05], M.black, [Math.cos(a) * 0.034, Math.sin(a) * 0.034, -0.006], [0, 0, a]);
      const b = a + PI / 6;
      tube(drum, 0.0075, 0.0075, 0.004, 6, M.brass, [Math.cos(b) * 0.022, Math.sin(b) * 0.022, 0.0365]);
    }
    w.drum = drum;

    const hammer = new T.Group();
    hammer.position.set(0, 0.03, 0.05);
    r.add(hammer);
    box(hammer, [0.009, 0.026, 0.01], M.iron, [0, 0.01, -0.002]);
    box(hammer, [0.012, 0.005, 0.016], M.iron, [0, 0.024, 0.006], [0.2, 0, 0]);
    w.hammer = hammer;

    box(r, [0.008, 0.024, 0.006], M.brass, [0, -0.034, 0.004], [0.3, 0, 0]);
    put(r, new T.TorusGeometry(0.027, 0.0034, 5, 9, PI), M.brass, [0, -0.028, -0.002], [PI, PI / 2, 0]);

    profile(r, [[0.022, -0.022], [0.085, -0.014], [0.118, -0.1], [0.132, -0.13], [0.082, -0.152], [0.052, -0.112]], 0.034, M.woodP);
    profile(r, [[0.128, -0.12], [0.137, -0.133], [0.082, -0.158], [0.074, -0.142]], 0.038, M.brassP);
    put(r, new T.CylinderGeometry(0.008, 0.008, 0.042, 6), M.brass, [0, -0.08, 0.075], [0, 0, PI / 2]);
    w.muzzleAt = [0, 0.014, -0.335];
    w.muzzle.position.set(0, 0.014, -0.335);

    fist(w.arms, [0, -0.082, 0.082], [0.42, 0, 0], 1);
    forearm(w.arms, [0.01, -0.13, 0.128], [0.16, -0.36, 0.56]);
    w.base = { pos: [0.23, -0.1, -0.74], rot: [0.03, 0.26, 0] };
    w.icon = [0, PI / 2, 0];
    w.hammerAngle = 0;
    w.drumAngle = 0;
    w.drumGoal = 0;
    w.shot = () => { w.drumGoal += PI / 3; w.hammerAngle = -0.85; };
    w.tick = (dt) => {
      w.drumAngle += (w.drumGoal - w.drumAngle) * Math.min(1, dt * 18);
      drum.rotation.z = w.drumAngle;
      w.hammerAngle *= Math.exp(-dt * 9);
      hammer.rotation.x = 0.22 + w.hammerAngle;
    };
    return w;
  }

  // La Desgoblinizadora: escopeta de corredera con cartuchos en el costado.
  function buildShotgun() {
    const w = emptyWeapon();
    const r = w.root;
    tube(r, 0.0185, 0.0195, 0.53, 10, M.blued, [0, 0.03, -0.285]);
    tube(r, 0.0205, 0.0205, 0.024, 10, M.iron, [0, 0.03, -0.54]);
    tube(r, 0.0125, 0.0125, 0.012, 8, M.black, [0, 0.03, -0.55]);
    tube(r, 0.0145, 0.0145, 0.42, 8, M.darkB, [0, -0.012, -0.235]);
    tube(r, 0.017, 0.017, 0.02, 8, M.brass, [0, -0.012, -0.452]);
    box(r, [0.014, 0.05, 0.02], M.iron, [0, 0.01, -0.43]);
    box(r, [0.006, 0.006, 0.47], M.dark, [0, 0.051, -0.28]);
    box(r, [0.008, 0.012, 0.008], M.brass, [0, 0.06, -0.535]);
    for (let i = 0; i < 3; i++) put(r, new T.TorusGeometry(0.0193, 0.0034, 4, 10), M.wrap, [0, 0.03, -0.12 - i * 0.008]);

    profile(r, [[-0.03, 0.058], [0.13, 0.054], [0.17, 0.03], [0.17, -0.012], [0.14, -0.034], [-0.03, -0.034]], 0.04, M.dark);
    profile(r, [[0.0, 0.044], [0.11, 0.042], [0.13, 0.02], [0.12, -0.016], [0.0, -0.016]], 0.0425, M.brassP, [0, 0, 0], 0);
    box(r, [0.0435, 0.018, 0.06], M.black, [0, 0.022, 0.052]);
    box(r, [0.008, 0.012, 0.012], M.brass, [0, 0.066, 0.1]);

    // Canana lateral: cuatro cartuchos listos
    box(r, [0.006, 0.05, 0.1], M.leather, [-0.024, 0.0, 0.062]);
    for (let i = 0; i < 4; i++) {
      const z = 0.024 + i * 0.024;
      tube(r, 0.009, 0.009, 0.052, 8, M.shell, [-0.033, 0.0, z]).rotation.set(0, 0, 0);
      cyl(r, 0.0098, 0.0098, 0.012, 8, M.brass, [-0.033, -0.024, z]);
    }

    const pump = new T.Group();
    pump.position.set(0, -0.012, -0.29);
    r.add(pump);
    tube(pump, 0.027, 0.027, 0.13, 8, M.woodD, [0, 0, 0], PI / 8);
    for (let i = 0; i < 6; i++) tube(pump, 0.0286, 0.0286, 0.009, 8, M.black, [0, 0, -0.05 + i * 0.02], PI / 8);
    w.pump = pump;

    box(r, [0.008, 0.026, 0.006], M.brass, [0, -0.046, 0.075], [0.3, 0, 0]);
    put(r, new T.TorusGeometry(0.03, 0.0034, 5, 9, PI), M.brass, [0, -0.034, 0.068], [PI, PI / 2, 0]);
    profile(r, [[0.14, -0.022], [0.17, 0.03], [0.24, -0.002], [0.46, -0.028], [0.47, -0.136], [0.4, -0.13], [0.23, -0.078], [0.19, -0.11], [0.135, -0.09]],
      0.04, M.woodTally);
    profile(r, [[0.462, -0.026], [0.482, -0.024], [0.49, -0.142], [0.472, -0.14]], 0.044, M.leatherD);
    w.muzzle.position.set(0, 0.03, -0.565);

    fist(w.arms, [0, -0.052, 0.16], [0.58, 0, 0], 1);
    forearm(w.arms, [0.012, -0.11, 0.21], [0.2, -0.38, 0.62]);
    w.leftHand = cradle(w.arms, [0, 0.0, -0.29], [0, 0, -0.1]);
    w.leftArm = new T.Group();
    w.arms.add(w.leftArm);
    forearm(w.leftArm, [-0.026, -0.044, -0.27], [-0.34, -0.3, 0.26]);

    w.base = { pos: [0.24, -0.125, -0.92], rot: [0.03, 0.22, 0] };
    w.icon = [0, PI / 2, 0];
    w.pumpT = -1;
    w.shot = () => { w.pumpT = 0; w.ejected = false; };
    w.tick = (dt, ctx) => {
      let back = 0;
      if (w.pumpT >= 0) {
        w.pumpT += dt;
        const t = (w.pumpT - 0.16) / 0.42;
        if (t >= 1) w.pumpT = -1;
        else if (t > 0) {
          back = Math.sin(t * PI);
          if (t > 0.45 && !w.ejected) {
            w.ejected = true;
            ctx.eject(w.root, [0.03, 0.03, 0.06], 'shell', [0.9, 0.9, 0.2]);
          }
        }
      }
      pump.position.z = -0.29 + back * 0.1;
      w.leftHand.position.z = -0.29 + back * 0.1;
      w.leftArm.position.z = back * 0.1;
    };
    return w;
  }

  // Molinillo de Duendes: ametralladora rotativa con tambor y manivela.
  function buildChaingun() {
    const w = emptyWeapon();
    const r = w.root;
    const spin = new T.Group();
    spin.position.set(0, 0, 0);
    r.add(spin);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2, x = Math.cos(a) * 0.033, y = Math.sin(a) * 0.033;
      tube(spin, 0.0098, 0.0098, 0.5, 7, M.blued, [x, y, -0.33]);
      tube(spin, 0.0065, 0.0065, 0.006, 7, M.black, [x, y, -0.583]);
      tube(spin, 0.0118, 0.0118, 0.018, 7, M.brass, [x, y, -0.572]);
    }
    [-0.55, -0.34, -0.14].forEach((z) => tube(spin, 0.05, 0.05, 0.014, 6, M.iron, [0, 0, z], PI / 6));
    tube(spin, 0.021, 0.021, 0.46, 6, M.darkB, [0, 0, -0.31]);
    w.spin = spin;

    tube(r, 0.066, 0.058, 0.13, 10, M.dark, [0, 0, -0.05]);
    tube(r, 0.074, 0.074, 0.018, 12, M.brass, [0, 0, -0.095]);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * PI * 2;
      box(r, [0.012, 0.012, 0.016], M.brass, [Math.cos(a) * 0.08, Math.sin(a) * 0.08, -0.095], [0, 0, a]);
    }
    profile(r, [[0, 0.05], [0.17, 0.05], [0.2, 0.03], [0.205, -0.02], [0.18, -0.05], [0, -0.05]], 0.088, M.dark);
    tube(r, 0.052, 0.04, 0.03, 10, M.darkB, [0, 0, 0.215]);
    box(r, [0.094, 0.012, 0.15], M.brassP, [0, 0.05, 0.085]);
    for (let i = 0; i < 6; i++) box(r, [0.0015, 0.05, 0.012], M.black, [-0.0445, 0.002, 0.03 + i * 0.024]);
    for (const y of [-0.04, 0.038]) for (const z of [0.012, 0.165]) {
      put(r, new T.CylinderGeometry(0.0055, 0.0055, 0.092, 6), M.brass, [0, y, z], [0, 0, PI / 2]);
    }

    // Asa superior
    limb(r, [0, 0.055, 0.03], [0, 0.1, 0.05], 0.007, 0.007, M.iron, 6);
    limb(r, [0, 0.1, 0.05], [0, 0.1, 0.15], 0.0095, 0.0095, M.wrap, 6);
    limb(r, [0, 0.1, 0.15], [0, 0.055, 0.17], 0.007, 0.007, M.iron, 6);

    // Tambor de munición y cinta de balas en el costado visible
    const drumAt = [-0.098, -0.07, 0.085];
    put(r, new T.CylinderGeometry(0.08, 0.08, 0.05, 12), M.olive, drumAt, [0, 0, PI / 2]);
    [-0.024, 0.024].forEach((dx) => {
      put(r, new T.CylinderGeometry(0.085, 0.085, 0.009, 12), M.iron, [drumAt[0] + dx, drumAt[1], drumAt[2]], [0, 0, PI / 2]);
    });
    put(r, new T.CylinderGeometry(0.024, 0.024, 0.058, 8), M.brass, drumAt, [0, 0, PI / 2]);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * PI * 2;
      box(r, [0.058, 0.006, 0.006], M.iron, [drumAt[0], drumAt[1] + Math.sin(a) * 0.05, drumAt[2] + Math.cos(a) * 0.05]);
    }
    box(r, [0.05, 0.036, 0.05], M.dark, [-0.062, -0.012, 0.085]);
    for (let i = 0; i < 8; i++) {
      const a = 3.25 - i * 0.26, x = -0.052 + Math.cos(a) * 0.05, y = -0.004 + Math.sin(a) * 0.062;
      tube(r, 0.0042, 0.0047, 0.028, 6, M.brass, [x, y, 0.09]);
      tube(r, 0.0012, 0.0042, 0.013, 6, M.copper, [x, y, 0.07]);
      box(r, [0.007, 0.007, 0.01], M.darkB, [x, y, 0.098], [0, 0, a]);
    }

    // Manivela del molinillo: gira con los cañones
    const crank = new T.Group();
    crank.position.set(-0.05, 0.02, 0.01);
    r.add(crank);
    put(crank, new T.CylinderGeometry(0.009, 0.009, 0.04, 6), M.iron, [-0.012, 0, 0], [0, 0, PI / 2]);
    box(crank, [0.008, 0.07, 0.012], M.iron, [-0.03, 0.028, 0]);
    put(crank, new T.CylinderGeometry(0.01, 0.01, 0.034, 6), M.woodD, [-0.044, 0.06, 0], [0, 0, PI / 2]);
    w.crank = crank;

    // Empuñaduras
    profile(r, [[0.15, -0.06], [0.205, -0.06], [0.24, -0.17], [0.19, -0.18]], 0.038, M.woodP);
    profile(r, [[-0.2, -0.055], [-0.155, -0.055], [-0.14, -0.15], [-0.19, -0.155]], 0.036, M.woodP);
    box(r, [0.06, 0.02, 0.09], M.dark, [0, -0.044, -0.17]);
    tube(r, 0.066, 0.066, 0.016, 6, M.iron, [0, 0, -0.17], PI / 6);

    w.muzzle.position.set(0, 0, -0.6);
    fist(w.arms, [0, -0.118, 0.19], [0.32, 0, 0], 1);
    forearm(w.arms, [0.012, -0.165, 0.24], [0.2, -0.42, 0.6]);
    fist(w.arms, [0, -0.105, -0.172], [-0.14, 0, 0], -1);
    forearm(w.arms, [-0.016, -0.154, -0.138], [-0.34, -0.44, 0.24]);
    w.base = { pos: [0.27, -0.13, -1.02], rot: [0.03, 0.26, 0] };
    w.icon = [0, PI / 2, 0];
    w.speed = 0;
    w.angle = 0;
    w.cool = 0;
    w.tick = (dt, ctx) => {
      w.speed += ((ctx.firing ? 34 : 0) - w.speed) * Math.min(1, dt * (ctx.firing ? 7 : 1.5));
      w.angle += w.speed * dt;
      spin.rotation.z = w.angle;
      crank.rotation.x = w.angle * 0.4;
    };
    w.shot = () => {
      w.cool += 1;
      if (w.cool % 2 === 0) api.ejectNow(w.root, [0.06, 0.03, 0.03], 'bullet', [0.7, 0.8, 0.15]);
    };
    return w;
  }

  // Adiós Verdecito: lanzacohetes de tubo con dientes pintados en la ojiva.
  function buildRocket() {
    const w = emptyWeapon();
    const r = w.root;
    tube(r, 0.058, 0.058, 0.82, 10, M.olive, [0, 0, 0]);
    tube(r, 0.074, 0.06, 0.09, 10, M.oliveP, [0, 0, -0.45]);
    tube(r, 0.064, 0.06, 0.03, 10, M.brass, [0, 0, -0.5]);
    tube(r, 0.06, 0.098, 0.15, 10, M.darkB, [0, 0, 0.48]);
    tube(r, 0.1, 0.1, 0.014, 10, M.brass, [0, 0, 0.56]);
    [-0.34, -0.1, 0.16, 0.35].forEach((z) => {
      tube(r, 0.0615, 0.0615, 0.024, 10, M.iron, [0, 0, z]);
      put(r, new T.CylinderGeometry(0.006, 0.006, 0.13, 6), M.brass, [0, 0, z], [0, 0, PI / 2]);
    });
    // Tablas de madera atadas al tubo
    for (const a of [2.4, 3.1, 3.8]) {
      const x = Math.cos(a) * 0.059, y = Math.sin(a) * 0.059;
      box(r, [0.022, 0.01, 0.3], M.woodP, [x, y, 0.02], [0, 0, a + PI / 2]);
    }
    for (let i = 0; i < 4; i++) put(r, new T.TorusGeometry(0.0595, 0.0055, 4, 10), M.wrap, [0, 0, -0.04 + i * 0.011]);
    // Marca pintada de la cazadora de goblins
    box(r, [0.004, 0.05, 0.05], M.white, [-0.0585, 0.012, -0.22], [0, 0, 0.1]);
    box(r, [0.0045, 0.009, 0.06], M.wool, [-0.0595, 0.012, -0.22], [0.75, 0, 0.1]);
    box(r, [0.0045, 0.009, 0.06], M.wool, [-0.0595, 0.012, -0.22], [-0.75, 0, 0.1]);

    // Mira plegable y empuñaduras
    box(r, [0.02, 0.006, 0.05], M.dark, [0, 0.062, -0.08]);
    box(r, [0.016, 0.06, 0.006], M.iron, [0, 0.09, -0.08]);
    box(r, [0.006, 0.02, 0.006], M.brass, [0, 0.13, -0.08]);
    profile(r, [[0.02, -0.05], [0.075, -0.05], [0.112, -0.17], [0.06, -0.182]], 0.036, M.woodP);
    box(r, [0.008, 0.024, 0.006], M.brass, [0, -0.074, 0.0]);
    profile(r, [[-0.24, -0.05], [-0.195, -0.05], [-0.18, -0.15], [-0.23, -0.155]], 0.034, M.woodP);
    box(r, [0.05, 0.02, 0.14], M.dark, [0, -0.06, -0.21]);
    box(r, [0.05, 0.02, 0.14], M.dark, [0, -0.06, 0.05]);

    // Ojiva asomando por la boca, con ojos y dientes de tiburón
    const tip = new T.Group();
    tip.position.set(0, 0, -0.54);
    r.add(tip);
    tube(tip, 0.05, 0.05, 0.1, 10, M.warhead, [0, 0, 0.02]);
    tube(tip, 0.01, 0.05, 0.13, 10, M.warhead, [0, 0, -0.095]);
    tube(tip, 0.012, 0.012, 0.012, 8, M.brass, [0, 0, -0.164]);
    for (let i = 0; i < 7; i++) {
      const a = PI * 0.6 + i * 0.3;
      put(tip, new T.ConeGeometry(0.0085, 0.022, 4), M.white,
        [Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.022], [PI / 2 + Math.sin(a) * 0.3, 0, a - PI / 2]);
    }
    box(tip, [0.003, 0.016, 0.016], M.eye, [-0.041, 0.02, -0.07], [0, 0, 0.5]);
    box(tip, [0.0035, 0.007, 0.007], M.black, [-0.042, 0.02, -0.072], [0, 0, 0.5]);
    w.tip = tip;

    w.muzzle.position.set(0, 0, -0.74);
    fist(w.arms, [0, -0.115, 0.066], [0.3, 0, 0], 1);
    forearm(w.arms, [0.012, -0.16, 0.115], [0.16, -0.42, 0.6]);
    fist(w.arms, [0, -0.11, -0.21], [-0.14, 0, 0], -1);
    forearm(w.arms, [-0.016, -0.156, -0.176], [-0.42, -0.44, 0.2]);
    w.base = { pos: [0.3, -0.14, -1.05], rot: [0.03, 0.2, 0] };
    w.icon = [0, PI / 2, 0];
    w.reload = 1;
    w.shot = () => { w.reload = 0; };
    w.tick = (dt) => {
      if (w.reload < 1) w.reload = Math.min(1, w.reload + dt / 0.85);
      const t = Math.max(0, (w.reload - 0.45) / 0.55);
      tip.visible = t > 0;
      tip.position.z = -0.54 - 0.2 * (1 - t) * (1 - t);
    };
    return w;
  }

  /* ---------------- 5. Escena, animación y dibujo ---------------- */
  let renderer = null, scene = null, camera = null, hemi = null, key = null, flashLight = null;
  let flashGroup = null, models = {}, current = null, viewEl = null, canvasEl = null;
  const shells = [];
  const tmp = new T.Vector3();

  const RECOIL = {
    axe: [0, 0], pistol: [0.05, 0.3], shotgun: [0.1, 0.22], chaingun: [0.026, 0.04], rocket: [0.13, 0.12]
  };
  const anim = {
    rec: 0, recV: 0, tilt: 0, swayX: 0, swayY: 0, lastYaw: null, lastPitch: 0, last: 0, spawnT: 1, lastId: null
  };

  function starTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.translate(32, 32);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 30);
    g.addColorStop(0, 'rgba(255,255,240,1)');
    g.addColorStop(0.3, 'rgba(255,214,120,.95)');
    g.addColorStop(0.7, 'rgba(255,110,30,.45)');
    g.addColorStop(1, 'rgba(255,60,0,0)');
    c.fillStyle = g;
    c.beginPath();
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = i / N * PI * 2, r = i % 2 ? 11 : (i % 4 ? 22 : 31);
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
    return new T.CanvasTexture(cv);
  }

  function init(canvas, view) {
    try {
      renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' });
    } catch (e) {
      return false;
    }
    canvasEl = canvas;
    viewEl = view;
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    M = buildMaterials();

    scene = new T.Scene();
    camera = new T.PerspectiveCamera(34, 16 / 9, 0.05, 6);

    hemi = new T.HemisphereLight(0xfff0d8, 0x4a3226, 1);
    key = new T.DirectionalLight(0xfff2e0, 1);
    key.position.set(-0.5, 0.9, 0.7);
    const rim = new T.DirectionalLight(0xff8a3c, 0.32);
    rim.position.set(0.9, 0.1, -0.5);
    flashLight = new T.PointLight(0xffc880, 0, 2.4, 2);
    scene.add(hemi, key, rim, flashLight);

    models = {
      axe: buildAxe(), pistol: buildPistol(), shotgun: buildShotgun(), chaingun: buildChaingun(), rocket: buildRocket()
    };
    Object.keys(models).forEach((id) => {
      models[id].root.visible = false;
      scene.add(models[id].root);
    });

    const star = starTexture();
    flashGroup = new T.Group();
    flashGroup.visible = false;
    scene.add(flashGroup);
    const flashMat = new T.SpriteMaterial({ map: star, blending: T.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true });
    [[0.3, 0], [0.2, 0.05]].forEach(([s, z]) => {
      const sp = new T.Sprite(flashMat);
      sp.scale.set(s, s, 1);
      sp.position.z = -z;
      flashGroup.add(sp);
    });
    flashGroup.mat = flashMat;

    const brassCase = new T.CylinderGeometry(0.0055, 0.0065, 0.024, 6);
    const redCase = new T.CylinderGeometry(0.0095, 0.0095, 0.042, 7);
    for (let i = 0; i < 14; i++) {
      const bullet = i % 2 === 0;
      const m = new T.Mesh(bullet ? brassCase : redCase, bullet ? M.brass : M.shell);
      m.visible = false;
      m.userData = { bullet, life: 0, v: new T.Vector3(), spin: new T.Vector3() };
      scene.add(m);
      shells.push(m);
    }

    api.ok = true;
    resize();
    return true;
  }

  // Resolución entera respecto a la pantalla: píxeles limpios sin perder detalle.
  function resize() {
    if (!api.ok) return;
    const w = viewEl.clientWidth || window.innerWidth, h = viewEl.clientHeight || window.innerHeight;
    const scale = Math.max(1, Math.round(w / 960));
    renderer.setSize(Math.ceil(w / scale), Math.ceil(h / scale), false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  function eject(root, offset, kind, dir) {
    const wantBullet = kind === 'bullet';
    const m = shells.find((s) => !s.visible && s.userData.bullet === wantBullet);
    if (!m) return;
    tmp.set(offset[0], offset[1], offset[2]);
    root.localToWorld(tmp);
    m.position.copy(tmp);
    m.visible = true;
    m.userData.life = 0.75;
    m.userData.v.set(dir[0] * (0.8 + Math.random() * 0.4), dir[1] * (0.9 + Math.random() * 0.4), dir[2]);
    m.userData.spin.set(Math.random() * 14, Math.random() * 14, Math.random() * 14);
  }
  api.ejectNow = eject;

  function fire(id) {
    if (!api.ok) return;
    const w = models[id];
    if (!w) return;
    const r = RECOIL[id] || RECOIL.pistol;
    anim.recV += r[0] * 26;
    anim.tilt = Math.min(1.4, anim.tilt + r[1]);
    w.shot();
  }

  // Tajo del hacha: amago hacia arriba, corte diagonal y regreso.
  function axePose(t, out) {
    const K = [
      [0, 0, 0, 0, 0, 0, 0],
      [0.2, 0.05, 0.05, 0.08, 0.22, 0.2, -0.22],
      [0.46, -0.34, -0.02, -0.16, -0.5, -0.1, 0.62],
      [0.68, -0.4, -0.08, -0.12, -0.56, -0.14, 0.74],
      [1, 0, 0, 0, 0, 0, 0]
    ];
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const a = K[i], b = K[i + 1];
    const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])));
    const s = u * u * (3 - 2 * u);
    for (let k = 0; k < 6; k++) out[k] = a[k + 1] + (b[k + 1] - a[k + 1]) * s;
  }
  const axeOut = [0, 0, 0, 0, 0, 0];

  function draw(s) {
    if (!api.ok) return;
    const w = models[s.id];
    if (!w) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (anim.last || now)) / 1000);
    anim.last = now;

    if (w !== current) {
      if (current) current.root.visible = false;
      w.root.visible = true;
      current = w;
    }

    // Retroceso: resorte amortiguado
    anim.recV += (-260 * anim.rec - 26 * anim.recV) * dt;
    anim.rec += anim.recV * dt;
    anim.tilt *= Math.exp(-dt * 8.5);

    // Inercia del arma al girar la mirada
    if (anim.lastYaw === null) { anim.lastYaw = s.yaw; anim.lastPitch = s.pitch; }
    const dYaw = s.yaw - anim.lastYaw, dPitch = s.pitch - anim.lastPitch;
    anim.lastYaw = s.yaw;
    anim.lastPitch = s.pitch;
    const follow = Math.min(1, dt * 11);
    anim.swayX += (Math.max(-0.05, Math.min(0.05, -dYaw * 0.5)) - anim.swayX) * follow;
    anim.swayY += (Math.max(-0.04, Math.min(0.04, dPitch * 0.5)) - anim.swayY) * follow;

    const aspectFit = Math.max(0.72, Math.min(1.12, camera.aspect / 1.7));
    const breathe = Math.sin(s.time * 1.5) * 0.0028;
    const bobX = Math.cos(s.bobT) * 0.014 * s.bobAmt;
    const bobY = Math.abs(Math.sin(s.bobT)) * 0.015 * s.bobAmt;
    const base = w.base;
    axeOut.fill(0);
    if (s.id === 'axe' && s.atk > 0) axePose(1 - s.atk, axeOut);
    if (w.armPivot) w.armPivot.rotation.set(-axeOut[3] * 0.9, -axeOut[4] * 0.9, -axeOut[5] * 0.9);

    w.root.position.set(
      base.pos[0] * aspectFit + bobX + anim.swayX + axeOut[0],
      base.pos[1] + breathe - bobY + anim.swayY - s.lower * 0.42 - s.drop * 0.7 + axeOut[1],
      base.pos[2] + anim.rec + axeOut[2]
    );
    w.root.rotation.set(
      base.rot[0] + anim.tilt * 0.55 + anim.swayY * 2 - s.lower * 0.95 + axeOut[3],
      base.rot[1] + anim.swayX * 2.2 + axeOut[4],
      base.rot[2] + bobX * 0.9 + axeOut[5]
    );
    w.root.updateMatrixWorld(true);

    w.tick(dt, { firing: s.firing, eject });

    for (const m of shells) {
      if (!m.visible) continue;
      const d = m.userData;
      d.life -= dt;
      if (d.life <= 0) { m.visible = false; continue; }
      d.v.y -= 3.6 * dt;
      m.position.addScaledVector(d.v, dt);
      m.rotation.x += d.spin.x * dt;
      m.rotation.y += d.spin.y * dt;
      m.rotation.z += d.spin.z * dt;
    }

    // La luz de la zona del mapa ilumina también el arma.
    const L = Math.max(0.25, Math.min(1.25, s.light));
    hemi.intensity = 0.2 + L * 0.42;
    key.intensity = 0.14 + L * 0.5;

    const flashing = s.flash > 0 && s.id !== 'axe';
    flashGroup.visible = flashing;
    flashLight.intensity = flashing ? 2.2 + Math.random() : 0;
    if (flashing) {
      w.muzzle.getWorldPosition(tmp);
      flashGroup.position.copy(tmp);
      flashLight.position.copy(tmp);
      flashLight.position.z += 0.1;
      flashGroup.mat.rotation = Math.random() * PI * 2;
      const size = 0.75 + Math.random() * 0.5 + (s.id === 'rocket' || s.id === 'shotgun' ? 0.5 : 0);
      flashGroup.scale.set(size, size, 1);
    }

    renderer.render(scene, camera);
  }

  // Retratos de las armas para el HUD y la tienda: mismos modelos, sin brazos.
  function icons() {
    if (!api.ok) return {};
    const out = {};
    const size = renderer.getSize(new T.Vector2());
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
    renderer.setSize(192, 96, false);
    hemi.intensity = 0.62;
    key.intensity = 0.62;
    Object.keys(models).forEach((id) => {
      const w = models[id];
      w.root.remove(w.arms);
      w.root.visible = true;
      w.root.position.set(0, 0, 0);
      w.root.rotation.set(w.icon[0], w.icon[1], w.icon[2]);
      w.root.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(w.root);
      const c = bounds.getCenter(new T.Vector3()), e = bounds.getSize(new T.Vector3());
      const halfH = Math.max(e.y, e.x / 2) * 0.56;
      cam.left = -halfH * 2; cam.right = halfH * 2; cam.top = halfH; cam.bottom = -halfH;
      cam.position.set(c.x, c.y, c.z + 2);
      cam.lookAt(c);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      out[id] = renderer.domElement.toDataURL('image/png');
      w.root.add(w.arms);
      w.root.visible = false;
    });
    renderer.setSize(size.x, size.y, false);
    current = null;
    return out;
  }

  return api;
})();
