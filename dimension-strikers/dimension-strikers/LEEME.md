# Dimension Strikers — Súper Torneo Dimensional

Fútbol arcade 2.5D en pixel art (HTML5 Canvas + JavaScript Vanilla), inspirado en las mecánicas de *Mario Strikers* y en el estilo de *Inazuma Eleven* / *Captain Tsubasa*.

## Estructura

```
dimension-strikers/
├── index.html          HTML5 semántico: canvas, pantallas de menú y pistas <audio>
├── style.css           Diseño arcade/anime (tokens CSS, paneles manga, cero estilos inline)
├── script.js           Juego completo en clases ES6+, dividido en 13 secciones numeradas
├── img/
│   ├── favicon.svg
│   └── LEEME.txt       Cómo añadir retratos, hojas de sprites y logo propios
└── audio/
    ├── bgm_match_eurobeat.mp3   Pista 1: intro, menú, partido y Supertiros
    └── bgm_select_funk.mp3      Pista 2: configuración, selección y diálogos
```

## Cómo ejecutarlo

- Abrir `index.html` directamente en Chrome, Edge o Firefox, **o**
- Servir la carpeta (recomendado): `python -m http.server 8000` y abrir `http://localhost:8000`.

El primer clic (o tecla) desbloquea el audio del navegador y lanza la intro.
Si los MP3 no están en `audio/`, el `SoundManager` genera versiones sintetizadas con Web Audio.
Las fuentes se cargan desde Google Fonts; sin internet se usan fuentes de respaldo.

## Controles

| Acción | Jugador 1 | Jugador 2 |
|---|---|---|
| Moverse / apuntar | W A S D | Flechas |
| Pase · sin balón: cambio / presión (mantener) | J | Num 1 |
| Tiro · mantener = carga / Supertiro · Cabezazo | K | Num 2 |
| Centro aéreo · sin balón: barrida | L | Num 3 |
| Golpe Único del personaje | U | Num 4 |
| Con balón: regate · sin balón: salto | I | Num 5 |
| Habilidad activa | O (o U + I) | Num 6 (o 4 + 5) |
| Pausa · Silencio | Esc / P · M | |

Sin teclado numérico, el Jugador 2 puede usar la fila superior 1–6. Mandos: A pase, B tiro, X centro, Y golpe, RB salto, LB/RT habilidad, Start pausa.

## Secciones de `script.js`

01 Configuración y utilidades · 02 Datos (roster, uniformes, dificultad, historia) · 03 Entrada · 04 Audio · 05 Arte procedural · 06 Render 2.5D · 07 Entidades · 08 Habilidades y Supertiros · 09 IA (FSM) · 10 Partido (cabezazos `?`, barra, cut-in, celebraciones, HUD) · 11 Intro y título · 12 Interfaz DOM · 13 Bucle principal.
