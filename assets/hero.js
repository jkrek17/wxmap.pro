// Hero figure: wind particles drawn around an idealised mid-latitude low, coloured
// on the site's wind scale. It is an illustration, not forecast data.
(function () {
  var canvas = document.getElementById('hero-flow');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = 1, parts = [], colors = {}, cx = 0, cy = 0, R = 1;

  function token(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function readColors() {
    colors = { calm: token('--calm'), gale: token('--gale'), storm: token('--storm'), hurricane: token('--hurricane'), bg: token('--surface'), iso: token('--border-strong'), ink: token('--text-3') };
  }

  // Rankine-like vortex with a westerly steering flow, a cold-sector boost to the
  // south-west, and inflow toward the centre. Speeds in kt.
  function wind(x, y) {
    var dx = (x - cx) / R, dy = (y - cy) / R;
    var r = Math.sqrt(dx * dx + dy * dy) + 1e-6;
    var vmax = 70, rm = 0.32;
    var vt = r < rm ? vmax * r / rm : vmax * Math.pow(rm / r, 0.62);
    var boost = 1 + 0.18 * Math.max(0, (-dx - dy) / r);   // stronger on the SW flank
    vt *= boost;
    // counter-clockwise (northern hemisphere), screen y points down
    var u = vt * dy / r;
    var v = -vt * dx / r;
    u += -0.22 * vt * dx / r + 14;                          // inflow and westerlies
    v += -0.22 * vt * dy / r;
    return [u, v, Math.sqrt(u * u + v * v)];
  }
  function colorFor(s) {
    if (s >= 64) return colors.hurricane;
    if (s >= 48) return colors.storm;
    if (s >= 34) return colors.gale;
    return colors.calm;
  }
  function spawn(p) {
    p.x = Math.random() * W; p.y = Math.random() * H; p.age = Math.random() * 80 | 0; return p;
  }
  function resize() {
    var box = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = box.width; H = box.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W * 0.56; cy = H * 0.5; R = Math.min(W, H) * 0.55;
    var n = Math.round(Math.min(1400, W * H / 260));
    parts = []; for (var i = 0; i < n; i++) parts.push(spawn({}));
    readColors(); paintBase();
  }
  function paintBase() {
    ctx.globalAlpha = 1; ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
  }
  function isobars() {
    ctx.save(); ctx.strokeStyle = colors.iso; ctx.lineWidth = 1; ctx.globalAlpha = 0.9;
    ctx.fillStyle = colors.ink; ctx.font = '500 11px "IBM Plex Mono", monospace';
    var labels = [972, 980, 988, 996, 1004];
    for (var k = 0; k < labels.length; k++) {
      var rr = R * (0.16 + k * 0.2);
      ctx.beginPath(); ctx.ellipse(cx - k * R * 0.03, cy + k * R * 0.015, rr * 1.18, rr * 0.92, -0.25, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(String(labels[k]), cx - k * R * 0.03 + rr * 1.1 + 4, cy + k * R * 0.015 - rr * 0.3);
    }
    ctx.font = '600 22px "IBM Plex Sans Condensed", sans-serif'; ctx.fillStyle = colors.hurricane; ctx.globalAlpha = 1;
    ctx.fillText('L', cx - 6, cy + 8);
    ctx.restore();
  }
  function step(n) {
    ctx.globalAlpha = 0.09; ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.9; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], w = wind(p.x, p.y), k = 0.035;
      var nx = p.x + w[0] * k, ny = p.y + w[1] * k;
      ctx.strokeStyle = colorFor(w[2]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
      p.x = nx; p.y = ny; p.age++;
      if (p.age > 90 || nx < -5 || ny < -5 || nx > W + 5 || ny > H + 5) spawn(p).age = 0;
    }
  }
  function frame() { step(); isobars(); if (!still && running) requestAnimationFrame(frame); }
  var running = true;
  resize();
  if (still) { for (var i = 0; i < 60; i++) step(); isobars(); }
  else requestAnimationFrame(frame);
  window.addEventListener('resize', function () { resize(); if (still) { for (var i = 0; i < 60; i++) step(); isobars(); } });
  document.addEventListener('wxmap-theme', function () { readColors(); paintBase(); if (still) { for (var i = 0; i < 60; i++) step(); isobars(); } });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readColors(); paintBase(); });
  document.addEventListener('visibilitychange', function () {
    running = !document.hidden; if (running && !still) requestAnimationFrame(frame);
  });
})();
