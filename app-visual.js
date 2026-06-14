/* ==========================================================================
   Antri — ambient visuals for the signed-in workspace.
   A subtle dot field behind the app (paused until the workspace is shown) plus
   a cursor-follow glow on cards. Respects reduced motion. Dependency-free.
   ========================================================================== */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- cursor glow on cards (delegated so dynamic job cards work too) ---- */
  if (!reduce) {
    document.addEventListener("pointermove", function (e) {
      var card = e.target.closest && e.target.closest(".metric, .job-card, .integration-card, .chart-panel");
      if (!card) return;
      var rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", (e.clientX - rect.left) + "px");
      card.style.setProperty("--my", (e.clientY - rect.top) + "px");
    }, { passive: true });
  }

  /* ---- ambient dot field behind the workspace ---- */
  var canvas = document.getElementById("appCanvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var shell = document.getElementById("appShell");
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var w = 0, h = 0, dots = [];
  var SPACING = 42;
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
          speed: 0.25 + Math.random() * 0.5
        });
      }
    }
  }

  function visible() {
    return shell && shell.offsetParent !== null;
  }

  function draw(t) {
    var time = t * 0.001;
    ctx.clearRect(0, 0, w, h);

    // a soft glow drifting in the upper-right, echoing the bg gradient
    var fx = w * 0.78 + Math.cos(time * 0.18) * w * 0.14;
    var fy = h * 0.16 + Math.sin(time * 0.15) * h * 0.12;
    var reach = Math.max(w, h) * 0.4;

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
        var R = 140;
        if (pd < R) { glow = 1 - pd / R; glow *= glow; }
      }

      var twinkle = reduce ? 0 : (Math.sin(time * d.speed + d.phase) * 0.5 + 0.5) * 0.08;
      var intensity = Math.min(1, 0.04 + twinkle + focal * 0.5 + glow * 0.7);

      var radius = 0.9 + intensity * 1.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
      if (intensity > 0.4) {
        var a = Math.min(0.9, (intensity - 0.3) * 1.2);
        ctx.fillStyle = "rgba(96, 165, 250, " + a.toFixed(3) + ")";
        ctx.shadowBlur = 6 + intensity * 10;
        ctx.shadowColor = "rgba(96, 165, 250, 0.7)";
      } else {
        ctx.fillStyle = "rgba(150, 170, 200, " + (0.04 + intensity * 0.28).toFixed(3) + ")";
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
    if (reduce && visible()) draw(0);
  }, { passive: true });
  window.addEventListener("pointermove", function (e) {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
  }, { passive: true });
  window.addEventListener("pointerleave", function () { pointer.active = false; });

  if (reduce) {
    // draw once when the workspace first becomes visible
    var drawnOnce = false;
    var poll = setInterval(function () {
      if (visible()) { draw(0); drawnOnce = true; clearInterval(poll); }
    }, 400);
    if (drawnOnce) clearInterval(poll);
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
