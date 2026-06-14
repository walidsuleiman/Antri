/* ==========================================================================
   Antri — ambient dot field for the login / auth gate.
   A gentle twinkling field with a slowly orbiting glow and cursor reactivity,
   matching the marketing site. Lives inside #authGate, so it stops painting
   automatically once the app shell replaces the gate. Respects reduced motion.
   ========================================================================== */
(function () {
  "use strict";

  var canvas = document.getElementById("authCanvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var gate = document.getElementById("authGate");
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0, dots = [];
  var SPACING = 38;
  var pointer = { x: -9999, y: -9999, active: false };

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
        var jx = (Math.sin(r * 12.9898 + c * 78.233) * 43758.5453) % 1;
        var jy = (Math.sin(r * 39.346 + c * 11.135) * 24634.6345) % 1;
        dots.push({
          x: c * SPACING + jx * 9,
          y: r * SPACING + jy * 9,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.6
        });
      }
    }
  }

  function visible() {
    return gate && gate.offsetParent !== null;
  }

  function draw(t) {
    var time = t * 0.001;
    ctx.clearRect(0, 0, w, h);

    // a soft glow that slowly orbits, lighting whatever it drifts over
    var fx = w * 0.5 + Math.cos(time * 0.24) * w * 0.22;
    var fy = h * 0.46 + Math.sin(time * 0.19) * h * 0.2;
    var reach = Math.max(w, h) * 0.42;

    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];

      var dxf = d.x - fx, dyf = d.y - fy;
      var df = Math.sqrt(dxf * dxf + dyf * dyf);
      var focal = df < reach ? (1 - df / reach) : 0;
      focal *= focal;

      var glow = 0;
      if (pointer.active) {
        var px = d.x - pointer.x, py = d.y - pointer.y;
        var pd = Math.sqrt(px * px + py * py);
        var R = 150;
        if (pd < R) { glow = 1 - pd / R; glow *= glow; }
      }

      var twinkle = reduce ? 0 : (Math.sin(time * d.speed + d.phase) * 0.5 + 0.5) * 0.12;
      var intensity = Math.min(1, 0.05 + twinkle + focal * 0.62 + glow * 0.9);

      var radius = 1 + intensity * 1.8;
      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);

      if (intensity > 0.42) {
        var a = Math.min(1, (intensity - 0.3) * 1.3);
        ctx.fillStyle = "rgba(96, 165, 250, " + a.toFixed(3) + ")";
        ctx.shadowBlur = 8 + intensity * 12;
        ctx.shadowColor = "rgba(96, 165, 250, 0.8)";
      } else {
        ctx.fillStyle = "rgba(150, 170, 200, " + (0.05 + intensity * 0.32).toFixed(3) + ")";
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  var raf = null;
  function loop(t) {
    if (visible()) draw(t);
    raf = requestAnimationFrame(loop);
  }

  build();
  window.addEventListener("resize", function () {
    build();
    if (reduce) draw(0);
  }, { passive: true });
  window.addEventListener("pointermove", function (e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerleave", function () { pointer.active = false; });

  if (reduce) {
    draw(0);
  } else {
    raf = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      } else if (!raf) {
        raf = requestAnimationFrame(loop);
      }
    });
  }
})();
