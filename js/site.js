/* ==========================================================================
   Movimiento del sitio — Santiago Colmenares
   Se carga en el <head> de todas las páginas para marcar <html class="js">
   antes de pintar: sin JavaScript el contenido se ve completo y sin animar.
   Expone window.siteMotion para que cada página enlace animaciones al scroll.
   ========================================================================== */
window.siteMotion = (function () {
  "use strict";

  const root = document.documentElement;
  root.classList.add("js");

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  /* 1. Motor de scroll suavizado ------------------------------------------- */
  // Un solo requestAnimationFrame para todo; se detiene cuando el scroll descansa.
  const scrubs = [];
  let target = window.scrollY;
  let current = target;
  let vh = window.innerHeight;
  let queued = false;

  function measure() {
    vh = window.innerHeight;
    scrubs.forEach((s) => {
      const rect = s.el.getBoundingClientRect();
      s.top = rect.top + window.scrollY;
      s.height = rect.height;
    });
    target = window.scrollY;
    schedule();
  }

  // pin: 0 al fijarse la sección, 1 al soltarse. view: de entrar a salir de pantalla.
  function progress(s) {
    const pinned = s.height - vh;
    if (s.mode === "pin" && pinned > 40) return clamp((current - s.top) / pinned, 0, 1);
    return clamp((current + vh * 0.85 - s.top) / (s.height + vh * 0.35), 0, 1);
  }

  function frame() {
    queued = false;
    const gap = target - current;
    current = Math.abs(gap) < 0.4 ? target : current + gap * 0.13;
    scrubs.forEach((s) => {
      const p = progress(s);
      if (p !== s.last) {
        s.last = p;
        s.update(p);
      }
    });
    if (header) {
      header.classList.toggle("is-scrolled", target > 24);
      const max = document.documentElement.scrollHeight - vh;
      header.style.setProperty("--scroll", max > 0 ? (current / max).toFixed(4) : "0");
    }
    if (current !== target) schedule();
  }

  function schedule() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
  }

  function scrub(el, mode, update) {
    if (!el || reduced) return;
    scrubs.push({ el, mode, update, top: 0, height: 0, last: -1 });
    measure();
  }

  /* 2. Aparición al entrar en pantalla ------------------------------------- */
  const REVEAL = [
    ".block__intro", ".work", ".post", ".sidebar", ".blog-head", ".form-panel", ".contact-aside",
    ".closer", ".stage", ".cart-info", ".shelf li", ".teaser__head", ".site-footer address", ".site-footer p"
  ].join(",");

  function setupReveals() {
    const items = Array.from(document.querySelectorAll(REVEAL));
    if (reduced || !("IntersectionObserver" in window)) return;

    const seen = new Map();
    items.forEach((el) => {
      // Los hermanos entran en cascada, no todos a la vez.
      const order = seen.get(el.parentElement) || 0;
      seen.set(el.parentElement, order + 1);
      el.setAttribute("data-reveal", "");
      el.style.setProperty("--reveal-delay", Math.min(order, 4) * 80 + "ms");
    });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    items.forEach((el) => io.observe(el));
  }

  /* 3. Títulos que suben palabra por palabra ------------------------------- */
  function setupSplit() {
    document.querySelectorAll("[data-split]").forEach((el) => {
      const text = el.textContent.trim();
      el.setAttribute("aria-label", text);
      el.textContent = "";
      text.split(/\s+/).forEach((word, i) => {
        const mask = document.createElement("span");
        const inner = document.createElement("span");
        mask.className = "split";
        mask.setAttribute("aria-hidden", "true");
        inner.className = "split__word";
        inner.textContent = word;
        inner.style.setProperty("--reveal-delay", 120 + i * 110 + "ms");
        mask.appendChild(inner);
        el.appendChild(mask);
        el.appendChild(document.createTextNode(" "));
      });
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("is-in")));
    });
  }

  /* 4. Brillo que sigue al cursor sobre las tarjetas ------------------------ */
  function setupSpotlight() {
    if (reduced || !window.matchMedia("(hover: hover)").matches) return;
    const selector = ".work, .post, .form-panel, .contact-aside, .sidebar, .cart-info, .closer, .rail__card";
    document.addEventListener("pointermove", (e) => {
      const card = e.target.closest && e.target.closest(selector);
      if (!card) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", e.clientX - rect.left + "px");
      card.style.setProperty("--my", e.clientY - rect.top + "px");
    }, { passive: true });
  }

  /* 5. Arranque ------------------------------------------------------------ */
  let header = null;

  document.addEventListener("DOMContentLoaded", () => {
    header = document.querySelector(".site-header");
    setupSplit();
    setupReveals();
    setupSpotlight();
    window.addEventListener("scroll", () => {
      target = window.scrollY;
      schedule();
    }, { passive: true });
    window.addEventListener("resize", measure);
    window.addEventListener("load", measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    measure();
  });

  return { reduced, clamp, scrub };
})();
