/* ==========================================================================
   Antri marketing site — interactions & the scroll-glow dot field
   Dependency-free. Respects prefers-reduced-motion.
   ========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ----------------------------------------------------------------------
     Background dot field — dots light up as a wavefront sweeps down on scroll
     ---------------------------------------------------------------------- */
  function initDotField() {
    var canvas = document.getElementById("bgCanvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var dots = [];
    var SPACING = 40;

    var pointer = { x: -9999, y: -9999, active: false };
    var scrollProgress = 0; // 0..1 across the whole page

    function build() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      dots = [];
      var cols = Math.ceil(w / SPACING) + 1;
      var rows = Math.ceil(h / SPACING) + 1;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          var jitterX = (Math.sin((r * 12.9898 + c * 78.233)) * 43758.5453) % 1;
          var jitterY = (Math.sin((r * 39.346 + c * 11.135)) * 24634.6345) % 1;
          dots.push({
            x: c * SPACING + jitterX * 10,
            y: r * SPACING + jitterY * 10,
            // normalized vertical position used to map against the wavefront
            ny: r / rows,
            phase: Math.random() * Math.PI * 2,
            speed: 0.4 + Math.random() * 0.7
          });
        }
      }
    }

    function updateScroll() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      scrollProgress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    }

    function draw(t) {
      ctx.clearRect(0, 0, w, h);
      var time = t * 0.001;

      // The wavefront travels down the viewport as you scroll the page.
      var waveY = scrollProgress * (h * 1.15) - h * 0.07;
      var band = h * 0.34;
      // Deeper into the page, the whole field wakes up a little.
      var ambient = 0.05 + scrollProgress * 0.06;

      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];

        // Distance to the sweeping wavefront -> glow band
        var dy = Math.abs(d.y - waveY);
        var wave = dy < band ? (1 - dy / band) : 0;
        wave = wave * wave; // sharpen

        // Pointer proximity glow
        var glow = 0;
        if (pointer.active) {
          var px = d.x - pointer.x;
          var py = d.y - pointer.y;
          var pd = Math.sqrt(px * px + py * py);
          var pr = 150;
          if (pd < pr) glow = (1 - pd / pr) * (1 - pd / pr);
        }

        var twinkle = reduceMotion ? 0 : (Math.sin(time * d.speed + d.phase) * 0.5 + 0.5) * 0.10;

        var intensity = Math.min(1, ambient + twinkle + wave * 0.95 + glow * 0.9);

        var radius = 1.05 + intensity * 1.9;
        ctx.beginPath();
        ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);

        if (intensity > 0.45) {
          // blue glow for the lit dots
          var a = Math.min(1, (intensity - 0.3) * 1.3);
          ctx.fillStyle = "rgba(96, 165, 250, " + a.toFixed(3) + ")";
          ctx.shadowBlur = 8 + intensity * 14;
          ctx.shadowColor = "rgba(96, 165, 250, 0.8)";
        } else {
          ctx.fillStyle = "rgba(150, 170, 200, " + (0.06 + intensity * 0.35).toFixed(3) + ")";
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    }

    var rafId = null;
    function loop(t) {
      draw(t);
      rafId = requestAnimationFrame(loop);
    }

    build();
    updateScroll();

    window.addEventListener("resize", function () {
      build();
      updateScroll();
      if (reduceMotion) draw(0);
    }, { passive: true });

    window.addEventListener("scroll", function () {
      updateScroll();
      if (reduceMotion) draw(0);
    }, { passive: true });

    window.addEventListener("pointermove", function (e) {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
    }, { passive: true });
    window.addEventListener("pointerleave", function () { pointer.active = false; });
    window.addEventListener("blur", function () { pointer.active = false; });

    if (reduceMotion) {
      draw(0);
    } else {
      rafId = requestAnimationFrame(loop);
      // pause the loop when the tab is hidden
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) {
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        } else if (!rafId) {
          rafId = requestAnimationFrame(loop);
        }
      });
    }
  }

  /* ----------------------------------------------------------------------
     Scroll progress bar + sticky nav state
     ---------------------------------------------------------------------- */
  function initScrollChrome() {
    var bar = document.querySelector(".scroll-progress");
    var nav = document.querySelector(".nav");

    function onScroll() {
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? (window.scrollY / max) * 100 : 0;
      if (bar) bar.style.width = p + "%";
      if (nav) nav.classList.toggle("is-stuck", window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ----------------------------------------------------------------------
     Reveal-on-scroll
     ---------------------------------------------------------------------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduceMotion) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ----------------------------------------------------------------------
     Card cursor glow
     ---------------------------------------------------------------------- */
  function initCardGlow() {
    if (reduceMotion) return;
    document.querySelectorAll(".card").forEach(function (card) {
      card.addEventListener("pointermove", function (e) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", (e.clientX - rect.left) + "px");
        card.style.setProperty("--my", (e.clientY - rect.top) + "px");
      });
    });
  }

  /* ----------------------------------------------------------------------
     Mobile nav toggle
     ---------------------------------------------------------------------- */
  function initNavMenu() {
    var toggle = document.querySelector(".nav-toggle");
    var links = document.querySelector(".nav-links");
    if (!toggle || !links) return;
    function close() { toggle.classList.remove("is-open"); links.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
    toggle.addEventListener("click", function () {
      var open = toggle.classList.toggle("is-open");
      links.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) close();
    });
  }

  /* ----------------------------------------------------------------------
     Active nav link based on section in view (home page only)
     ---------------------------------------------------------------------- */
  function initScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".nav-link[data-spy]"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    var map = {};
    links.forEach(function (l) {
      var id = l.getAttribute("href");
      if (id && id.charAt(0) === "#") map[id.slice(1)] = l;
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          links.forEach(function (l) { l.classList.remove("is-active"); });
          var active = map[entry.target.id];
          if (active) active.classList.add("is-active");
        }
      });
    }, { threshold: 0.5, rootMargin: "-20% 0px -55% 0px" });
    Object.keys(map).forEach(function (id) {
      var sec = document.getElementById(id);
      if (sec) io.observe(sec);
    });
  }

  /* ----------------------------------------------------------------------
     Full-page treasure trail
     A winding path spans the whole page behind the content. It draws in as
     you scroll, an explorer dot rides along it, and each section's "X" marker
     fills up when you reach that section.
     ---------------------------------------------------------------------- */
  function initTrailMap() {
    var svg = document.getElementById("trailMap");
    var page = document.querySelector(".page");
    if (!svg || !page) return;
    var NS = "http://www.w3.org/2000/svg";
    var lit = null, explorer = null, shift = null, totalLen = 0;
    var markers = [];
    var io = null;

    function el(name, cls) {
      var node = document.createElementNS(NS, name);
      if (cls) node.setAttribute("class", cls);
      return node;
    }

    // Smooth cubic path through a list of {x,y} points (Catmull-Rom style).
    function smoothPath(pts) {
      if (pts.length < 2) return "";
      var d = "M " + pts[0].x.toFixed(1) + " " + pts[0].y.toFixed(1);
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i - 1] || pts[i];
        var p1 = pts[i];
        var p2 = pts[i + 1];
        var p3 = pts[i + 2] || p2;
        var c1x = p1.x + (p2.x - p0.x) / 6;
        var c1y = p1.y + (p2.y - p0.y) / 6;
        var c2x = p2.x - (p3.x - p1.x) / 6;
        var c2y = p2.y - (p3.y - p1.y) / 6;
        d += " C " + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " +
             c2x.toFixed(1) + " " + c2y.toFixed(1) + " " +
             p2.x.toFixed(1) + " " + p2.y.toFixed(1);
      }
      return d;
    }

    function makeMarker(x, y) {
      var g = el("g", "trail-x");
      g.setAttribute("transform", "translate(" + x.toFixed(1) + " " + y.toFixed(1) + ")");
      var R = 21, A = 14;
      var glow = el("circle", "glow"); glow.setAttribute("r", R);
      var ring = el("circle", "ring"); ring.setAttribute("r", R);
      g.appendChild(glow); g.appendChild(ring);
      [[-A, -A, A, A], [-A, A, A, -A]].forEach(function (c) {
        var arm = el("line", "arm");
        arm.setAttribute("x1", c[0]); arm.setAttribute("y1", c[1]);
        arm.setAttribute("x2", c[2]); arm.setAttribute("y2", c[3]);
        g.appendChild(arm);
      });
      return g;
    }

    function build() {
      // Viewport-sized SVG; trail geometry is in document coordinates and is
      // scrolled into view with a transform, so the layer stays cheap.
      var W = document.documentElement.clientWidth;
      var vh = window.innerHeight;
      var H = page.scrollHeight;
      svg.setAttribute("viewBox", "0 0 " + W + " " + vh);
      svg.setAttribute("preserveAspectRatio", "none");
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      markers = [];

      shift = el("g", "trail-shift");
      svg.appendChild(shift);

      var stops = Array.prototype.slice.call(document.querySelectorAll("[data-trail-stop]"));
      var ampLeft = W * (W < 680 ? 0.28 : 0.2);
      var ampRight = W - ampLeft;

      var pts = [{ x: W * 0.5, y: 90 }];
      stops.forEach(function (node, i) {
        var rect = node.getBoundingClientRect();
        var y = rect.top + window.scrollY + 96; // near the section heading
        var x = (i % 2 === 0) ? ampLeft : ampRight;
        pts.push({ x: x, y: y, node: node });
      });
      pts.push({ x: W * 0.5, y: H - 90 });

      var d = smoothPath(pts);

      var ghost = el("path", "trail-ghost"); ghost.setAttribute("d", d);
      lit = el("path", "trail-lit"); lit.setAttribute("d", d);
      shift.appendChild(ghost);
      shift.appendChild(lit);

      totalLen = lit.getTotalLength();
      lit.style.strokeDasharray = totalLen;
      lit.style.strokeDashoffset = totalLen;

      pts.forEach(function (p) {
        if (!p.node) return;
        var g = makeMarker(p.x, p.y);
        shift.appendChild(g);
        markers.push({ g: g, node: p.node });
      });

      explorer = el("circle", "explorer");
      explorer.setAttribute("r", 5.5);
      shift.appendChild(explorer);

      update();
      observe();
    }

    function update() {
      if (!lit || !shift) return;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      var p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      // scroll the document-space trail into the viewport-sized SVG
      shift.setAttribute("transform", "translate(0 " + (-window.scrollY) + ")");
      lit.style.strokeDashoffset = totalLen * (1 - p);
      if (explorer && totalLen) {
        var pt = lit.getPointAtLength(totalLen * p);
        explorer.setAttribute("cx", pt.x);
        explorer.setAttribute("cy", pt.y);
      }
    }

    function observe() {
      if (io) io.disconnect();
      if (!("IntersectionObserver" in window)) {
        markers.forEach(function (m) { m.g.classList.add("filled"); });
        return;
      }
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          for (var i = 0; i < markers.length; i++) {
            if (markers[i].node === entry.target) {
              markers[i].g.classList.add("filled");
              io.unobserve(entry.target);
              break;
            }
          }
        });
      }, { rootMargin: "-40% 0px -45% 0px", threshold: 0 });
      markers.forEach(function (m) { io.observe(m.node); });
    }

    build();
    window.addEventListener("scroll", update, { passive: true });
    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(build, 150);
    }, { passive: true });
    window.addEventListener("load", build);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(build);
    }
  }

  /* ----------------------------------------------------------------------
     Footer year
     ---------------------------------------------------------------------- */
  function initYear() {
    var el = document.getElementById("year");
    if (el) el.textContent = new Date().getFullYear();
  }

  function init() {
    initDotField();
    initScrollChrome();
    initReveal();
    initCardGlow();
    initNavMenu();
    initScrollSpy();
    initTrailMap();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
