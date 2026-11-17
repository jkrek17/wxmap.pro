// synoptic.js: the "big picture" map. Draws the GFS fields written by tools/event_build.py
// (sea-level pressure, 6 h precipitation by type, 1000-500 mb thickness and 500 mb height)
// on a canvas around the event, with coastlines, borders and US states, and a time slider.
// Needs d3 (geo, contour) and topojson-client.
(function (root) {
  'use strict';
  var ATLAS = {
    world: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json',
    states: 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json'
  };
  // mm per 6 h thresholds and colours per precipitation type (rain, snow, mix)
  var PCP_LEVELS = [0.25, 2.5, 6, 12, 25];
  var PCP_COL = {
    0: ['#a7dba0', '#5fbf5a', '#2e9a3a', '#e0c13a', '#e0702a'],
    1: ['#b9d4f2', '#7fb0ea', '#4a86d8', '#2b5fb4', '#6b3fb4'],
    2: ['#f2b9d8', '#e58ac0', '#d055a0', '#b02d84', '#801a66']
  };

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function Synoptic(canvas, opts) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.o = opts; this.i = 0; this.layer = 'sfc';
    this.geo = null; this.doc = null;
  }

  // doc: one synoptic*.json (frames of msl, z500, thk, pcp, ptype and, for the blend, chance)
  Synoptic.prototype.setDoc = function (doc) {
    var d = doc;
    this.doc = d;
    this.flat = {};
    var self = this;
    ['msl', 'z500', 'thk', 'pcp', 'ptype', 'chance'].forEach(function (k) {
      self.flat[k] = d.frames.map(function (fr) { return fr[k] ? [].concat.apply([], fr[k]) : null; });
    });
    if (this.i >= d.frames.length) this.i = d.frames.length - 1;
    if (this.geo) this.resize();
  };

  Synoptic.prototype.load = function (doc) {
    var self = this;
    var latC = this.o.lat, lonC = this.o.lon;
    this.proj = d3.geoConicConformal().parallels([latC - 8, latC + 8]).rotate([-lonC, 0]).center([0, latC]);
    this.setDoc(doc);
    return Promise.all([fetch(ATLAS.world).then(function (r) { return r.json(); }), fetch(ATLAS.states).then(function (r) { return r.json(); }).catch(function () { return null; })])
      .then(function (a) {
        self.geo = {
          land: topojson.feature(a[0], a[0].objects.land),
          borders: topojson.mesh(a[0], a[0].objects.countries, function (x, y) { return x !== y; }),
          states: a[1] ? topojson.mesh(a[1], a[1].objects.states, function (x, y) { return x !== y; }) : null
        };
        self.resize();
      });
  };

  Synoptic.prototype.resize = function () {
    if (!this.doc) return;
    var w = this.c.clientWidth, h = Math.round(w * (w < 600 ? 1.05 : 0.68));
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    this.c.style.height = h + 'px';
    this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    // fit to the inner part of the box so the edges of the data don't show
    var inner = { type: 'MultiPoint', coordinates: [
      [this.o.lon - 14, this.o.lat - 9], [this.o.lon + 14, this.o.lat + 9], [this.o.lon - 14, this.o.lat + 9], [this.o.lon + 14, this.o.lat - 9]] };
    if (w < 600) inner.coordinates = [[this.o.lon - 9, this.o.lat - 9], [this.o.lon + 9, this.o.lat + 9], [this.o.lon - 9, this.o.lat + 9], [this.o.lon + 9, this.o.lat - 9]];
    this.proj.fitExtent([[0, 0], [w, h]], inner);
    // grid position of every screen pixel, for the precipitation raster
    var d = this.doc, n = w * h, gx = new Float32Array(n), gy = new Float32Array(n);
    for (var py = 0; py < h; py++) for (var px = 0; px < w; px++) {
      var ll = this.proj.invert([px + 0.5, py + 0.5]), k = py * w + px;
      if (!ll) { gx[k] = -1; continue; }
      var dl = ((ll[0] - d.lon0) % 360 + 360) % 360;
      gx[k] = dl / d.step; gy[k] = (d.lat0 - ll[1]) / d.step;
    }
    this.gx = gx; this.gy = gy;
    this.off = document.createElement('canvas'); this.off.width = w; this.off.height = h;
    this.draw();
  };

  // grid coords (x = column, y = row; d3.contours puts cell centres at +0.5) -> screen
  Synoptic.prototype.pt = function (x, y) {
    var d = this.doc;
    return this.proj([d.lon0 + (x - 0.5) * d.step, d.lat0 - (y - 0.5) * d.step]);
  };

  Synoptic.prototype.fillMulti = function (mp) {
    var ctx = this.ctx, self = this;
    ctx.beginPath();
    mp.coordinates.forEach(function (poly) {
      poly.forEach(function (ring) {
        ring.forEach(function (p, k) { var s = self.pt(p[0], p[1]); if (k) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
        ctx.closePath();
      });
    });
    ctx.fill('evenodd');
  };

  // stroke contour rings but skip the pieces that run along the edge of the grid
  Synoptic.prototype.strokeMulti = function (mp) {
    var ctx = this.ctx, self = this, nx = this.doc.nx, ny = this.doc.ny;
    var edge = function (p) { return p[0] <= 0.6 || p[1] <= 0.6 || p[0] >= nx - 0.6 || p[1] >= ny - 0.6; };
    ctx.beginPath();
    mp.coordinates.forEach(function (poly) {
      poly.forEach(function (ring) {
        var pen = false;
        for (var k = 0; k < ring.length; k++) {
          var p = ring[k], s = self.pt(p[0], p[1]);
          if (k > 0 && edge(p) && edge(ring[k - 1])) { pen = false; continue; }
          if (pen) ctx.lineTo(s[0], s[1]); else { ctx.moveTo(s[0], s[1]); pen = true; }
        }
      });
    });
    ctx.stroke();
  };

  // 6 h precipitation as a smooth raster: colour by amount and type; on the blend, fainter where
  // fewer of the forecasts have it (alpha from the chance of 0.01 in or more)
  var RGB = {};
  Object.keys(PCP_COL).forEach(function (t) { RGB[t] = PCP_COL[t].map(function (c) { return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)]; }); });
  Synoptic.prototype.rasterPcp = function (i) {
    var d = this.doc, nx = d.nx, ny = d.ny, w = this.w, h = this.h;
    var pcp = this.flat.pcp[i], pt = this.flat.ptype[i], ch = this.flat.chance[i];
    var octx = this.off.getContext('2d'), img = octx.createImageData(w, h), px = img.data;
    var gx = this.gx, gy = this.gy;
    for (var k = 0; k < w * h; k++) {
      var x = gx[k], y = gy[k];
      if (x < 0 || y < 0 || x > nx - 1 || y > ny - 1) continue;
      var x0 = x | 0, y0 = y | 0, x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), fx = x - x0, fy = y - y0;
      var a = y0 * nx + x0, b = y0 * nx + x1, c = y1 * nx + x0, e = y1 * nx + x1;
      var v = ((pcp[a] * (1 - fx) + pcp[b] * fx) * (1 - fy) + (pcp[c] * (1 - fx) + pcp[e] * fx) * fy) / 10;
      if (v < PCP_LEVELS[0]) continue;
      var lv = 0; while (lv < PCP_LEVELS.length - 1 && v >= PCP_LEVELS[lv + 1]) lv++;
      var t = pt[Math.round(y) * nx + Math.round(x)] || 0, col = RGB[t][lv];
      var al = 0.8;
      if (ch) { var cv = (ch[a] * (1 - fx) + ch[b] * fx) * (1 - fy) + (ch[c] * (1 - fx) + ch[e] * fx) * fy; al = 0.18 + 0.72 * Math.min(1, cv / 90); }
      var o = k * 4; px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = Math.round(al * 255);
    }
    octx.putImageData(img, 0, 0);
    this.ctx.drawImage(this.off, 0, 0, w, h);
  };

  Synoptic.prototype.draw = function () {
    if (!this.doc || !this.geo) return;
    var ctx = this.ctx, d = this.doc, i = this.i, self = this;
    var path = d3.geoPath(this.proj, ctx);
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' ||
      (!document.documentElement.getAttribute('data-theme') && matchMedia('(prefers-color-scheme: dark)').matches);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.fillStyle = dark ? '#0b1a2a' : '#e7eef4'; ctx.fillRect(0, 0, this.w, this.h);   // sea
    ctx.fillStyle = dark ? '#16273a' : '#fbfaf6'; ctx.beginPath(); path(this.geo.land); ctx.fill();

    var C = d3.contours().size([d.nx, d.ny]).smooth(true);
    if (this.layer === 'sfc' && this.flat.pcp[i]) this.rasterPcp(i);
    // coast, borders, states
    ctx.lineWidth = 0.8; ctx.strokeStyle = dark ? '#5d7590' : '#8a9aab';
    ctx.beginPath(); path(this.geo.land); ctx.stroke();
    ctx.beginPath(); path(this.geo.borders); ctx.stroke();
    if (this.geo.states) { ctx.lineWidth = 0.5; ctx.strokeStyle = dark ? '#3e536a' : '#b8c3cf'; ctx.beginPath(); path(this.geo.states); ctx.stroke(); }

    var ink = dark ? '#e4ecf3' : '#0e2236';
    if (this.layer === 'sfc') {
      // thickness 540 dam: the classic rain-snow line
      var thk = this.flat.thk[i];
      ctx.setLineDash([6, 4]); ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#3b6fd8'; this.strokeMulti(d3.contours().size([d.nx, d.ny]).smooth(true).thresholds([540])(thk)[0]);
      ctx.setLineDash([]);
      // isobars every 4 mb
      var msl = this.flat.msl[i].map(function (x) { return x / 10; });
      var lo = Math.floor(d3.min(msl) / 4) * 4, hi = Math.ceil(d3.max(msl) / 4) * 4;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.1; ctx.globalAlpha = 0.85;
      C.thresholds(d3.range(lo, hi + 1, 4))(msl).forEach(function (iso) { self.strokeMulti(iso); });
      ctx.globalAlpha = 1;
      this.labelExtrema(msl, ink);
    } else {
      var z = this.flat.z500[i];
      var zl = Math.floor(d3.min(z) / 6) * 6, zh = Math.ceil(d3.max(z) / 6) * 6;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.3;
      C.thresholds(d3.range(zl, zh + 1, 6))(z).forEach(function (iso) { self.strokeMulti(iso); });
      this.labelLines(z, d3.range(zl, zh + 1, 12), ink);
    }
    // the event
    var e = this.proj([this.o.lon, this.o.lat]);
    ctx.fillStyle = css('--accent') || '#0a6c96'; ctx.strokeStyle = dark ? '#08121d' : '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); star(ctx, e[0], e[1], 9, 4); ctx.stroke(); ctx.fill();
  };

  function star(ctx, x, y, R, r) {
    for (var k = 0; k < 10; k++) {
      var a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r : R;
      if (k) ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); else ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
  }

  // H and L at pressure extremes (local over ~5 degrees), with the central value
  Synoptic.prototype.labelExtrema = function (msl, ink) {
    var d = this.doc, ctx = this.ctx, R = 10, out = [];
    for (var y = R; y < d.ny - R; y += 1) for (var x = R; x < d.nx - R; x += 1) {
      var v = msl[y * d.nx + x], isMin = true, isMax = true;
      for (var dy = -R; dy <= R && (isMin || isMax); dy += 2) for (var dx = -R; dx <= R; dx += 2) {
        var w = msl[(y + dy) * d.nx + x + dx];
        if (w < v) isMin = false; if (w > v) isMax = false;
      }
      if (isMin && v < 1012) out.push([x, y, 'L', v]);
      if (isMax && v > 1016) out.push([x, y, 'H', v]);
    }
    var self = this, placed = [];
    out.forEach(function (o) {
      var s = self.pt(o[0] + 0.5, o[1] + 0.5);
      if (s[0] < 10 || s[1] < 10 || s[0] > self.w - 10 || s[1] > self.h - 10) return;
      if (placed.some(function (p) { return Math.hypot(p[0] - s[0], p[1] - s[1]) < 40; })) return;
      placed.push(s);
      ctx.font = '600 22px "IBM Plex Sans Condensed", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.fillStyle = o[2] === 'L' ? '#c0362c' : '#1f5fbf';
      ctx.strokeText(o[2], s[0], s[1]); ctx.fillText(o[2], s[0], s[1]);
      ctx.font = '500 11px "IBM Plex Mono", monospace'; ctx.fillStyle = ink;
      ctx.fillText(Math.round(o[3]), s[0], s[1] + 16);
    });
  };

  Synoptic.prototype.labelLines = function (z, levels, ink) {
    var d = this.doc, ctx = this.ctx, self = this;
    ctx.font = '500 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    levels.forEach(function (lv) {
      // label where the line crosses the western third, middle row search
      var col = Math.round(d.nx * 0.3);
      for (var y = 1; y < d.ny; y++) {
        var a = z[(y - 1) * d.nx + col], b = z[y * d.nx + col];
        if ((a - lv) * (b - lv) <= 0 && a !== b) {
          var s = self.pt(col + 0.5, y);
          if (s[1] < 12 || s[1] > self.h - 12) continue;
          ctx.fillStyle = getComputedStyle(document.body).backgroundColor; ctx.fillRect(s[0] - 13, s[1] - 7, 26, 14);
          ctx.fillStyle = ink; ctx.fillText(lv, s[0], s[1]);
          break;
        }
      }
    });
  };

  Synoptic.prototype.set = function (i) { this.i = i; this.draw(); };
  Synoptic.prototype.setLayer = function (l) { this.layer = l; this.draw(); };

  Synoptic.legend = function (layer, blend) {
    if (layer === 'upper') return '<span><i class="ln"></i>500 mb height (dam, every 6)</span><span>Lows and troughs steer the weather</span>';
    function ramp(t) { return PCP_COL[t].map(function (c) { return '<i style="background:' + c + '"></i>'; }).join(''); }
    return '<span class="ramp">' + ramp(0) + ' Rain</span><span class="ramp">' + ramp(1) + ' Snow</span><span class="ramp">' + ramp(2) + ' Mix</span>' +
      '<span>Light → heavy, 6 hours</span>' + (blend ? '<span class="fade"><i></i>Fainter = fewer forecasts agree</span>' : '') +
      '<span><i class="ln"></i>Pressure (L = storm)</span><span><i class="ln dash blue"></i>Snow line</span>';
  };

  root.Synoptic = Synoptic;
})(window);
