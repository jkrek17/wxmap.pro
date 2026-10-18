/* wxmap.pro map: the cyclone phase space layer on the marine wind globe.

   Reads the live cyclone phase space run (index.json and legend.json, made by
   awips-tools cyclone_phase_space/realtime and published at ../cyclone/data/latest/).
   Every tracked low with a point at the marine wind page's valid time gets a ring
   coloured by its Hart class. Selecting one draws its whole track, coloured by class,
   and opens a card with the track in Hart's 3-D phase space, the cyclone page's own
   cube (cube.js). The marine wind page says when its map is ready and which valid
   time it shows through the mw:ready, mw:step and mw:overlay events. */
(function () {
  'use strict';
  var DATA = document.querySelector('meta[name="cyclone-data"]').content;
  var MW = document.querySelector('meta[name="marine-wind-base"]').content + 'data/global/';
  var NAMES = ['Symmetric deep warm core', 'Symmetric shallow warm core', 'Asymmetric deep warm core',
    'Asymmetric shallow warm core', 'Asymmetric cold core', 'Symmetric cold core', 'Shallow cold core'];
  var HEX = ['#d92626', '#cc33bf', '#fad91a', '#33ad40', '#2680e6', '#5938b8', '#b8b8b2'];
  var NONE = '#8a8a86';
  var LIST_MAX = 6;

  var K = window.GlobeKit;
  var $ = function (id) { return document.getElementById(id); };
  var S = { index: null, storms: [], valid: null, map: null, on: true, sel: null, proj: null };

  function hex(c) { return c == null || HEX[c] == null ? NONE : HEX[c]; }
  function className(c) { return c == null || NAMES[c] == null ? 'No class' : NAMES[c]; }
  function label(name) {
    var m = /^AUTO_\d{6}_(\d+)$/.exec(name);
    return m ? 'AUTO ' + m[1] : String(name).replace(/_/g, ' ');
  }
  function place(lat, lon) {
    var w = K.wrapLon(lon);
    function d(v, p, n) { return Math.abs(Math.round(v)) + (Math.round(v) >= 0 ? p : n); }
    return d(lat, 'N', 'S') + ' ' + d(w, 'E', 'W');
  }
  function num(v, dp) { return v == null || !isFinite(v) ? '–' : (+v).toFixed(dp).replace('-', '−'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ------------------------------------------------------------ data
  function load() {
    var opt = { cache: 'no-cache' };
    return Promise.all([
      fetch(DATA + 'index.json', opt).then(function (r) { if (!r.ok) throw new Error('index ' + r.status); return r.json(); }),
      fetch(DATA + 'legend.json', opt).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var idx = res[0], leg = res[1];
      if (leg && leg.classes) leg.classes.forEach(function (c) { HEX[c.code] = c.hex; });
      S.index = idx;
      S.storms = (idx.storms || []).map(function (s) {
        // cls and b are Hart's, from the storm's own motion (clst, hbt) where the
        // export has them, as on the cyclone page; else the field's steering-flow values.
        var n = (s.points || []).length;
        var seq = Array.isArray(s.cls_seq) && s.cls_seq.length === n ? s.cls_seq : null;
        var seqt = Array.isArray(s.clst_seq) && s.clst_seq.length === n ? s.clst_seq : null;
        var pts = (s.points || []).map(function (p, j) {
          var fcls = seq ? seq[j] : p.cls, tcls = seqt ? seqt[j] : p.clst;
          return { t: Date.parse(p.valid), fhr: p.fhr, lat: +p.lat, lon: +p.lon, mslp: p.mslp,
            cls: tcls != null ? tcls : fcls, fcls: fcls, clst: tcls != null ? tcls : null,
            b: p.hbt != null ? p.hbt : p.hb, fb: p.hb, hbt: p.hbt != null ? p.hbt : null, vtl: p.hvtl, vtu: p.hvtu };
        }).filter(function (p) { return isFinite(p.t) && isFinite(p.lat) && isFinite(p.lon); });
        return { key: String(s.id != null ? s.id : s.name), name: label(s.name != null ? s.name : s.id), pts: pts, min: +s.min_mslp || Infinity };
      }).filter(function (s) { return s.pts.length; });
      window.wxmapCube.setup({ cycle: Date.parse(cycleIso(idx.cycle)), hours: idx.hours || [],
        classes: function (c) { return { code: c, name: className(c), hex: hex(c) }; }, toValid: toValid, stop: stop });
      if (S.valid != null) window.wxmapCube.at(S.valid);
    });
  }
  // The cube's dot clicks: show that hour on the map, through the marine wind time slider.
  var steps = null;
  function toValid(t) {
    steps = steps || fetch(MW + 'manifest.json').then(function (r) { return r.json(); }).then(function (m) {
      return m.steps.map(function (st) { return Date.parse(st.valid); });
    });
    steps.then(function (v) {
      var i = v.indexOf(t), lead = $('lead');
      if (i < 0 || !lead) return;
      lead.value = i; lead.dispatchEvent(new Event('input'));
    }).catch(function () { steps = null; });
  }
  function stop() { var b = $('play'); if (b && b.getAttribute('aria-label') === 'Pause') b.click(); }
  function at(s, t) {
    for (var i = 0; i < s.pts.length; i++) if (Math.abs(s.pts[i].t - t) < 60e3) return s.pts[i];
    return null;
  }
  function live() {   // the lows with a point at the shown valid time, deepest first
    if (S.valid == null) return [];
    var out = [];
    S.storms.forEach(function (s) { var p = at(s, S.valid); if (p) out.push({ s: s, p: p }); });
    return out.sort(function (a, b) { return (a.p.mslp || 9999) - (b.p.mslp || 9999); });
  }

  // ------------------------------------------------------------ map
  function fc(f) { return { type: 'FeatureCollection', features: f }; }
  function addLayers(map) {
    map.addSource('cps-track', { type: 'geojson', data: fc([]) });
    map.addSource('cps-now', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'cps-track-halo', type: 'line', source: 'cps-track', layout: { 'line-cap': 'round' }, paint: { 'line-color': 'rgba(5,10,20,0.75)', 'line-width': 5 } });
    map.addLayer({ id: 'cps-track', type: 'line', source: 'cps-track', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'hex'], 'line-width': 2.6 } });
    map.addLayer({ id: 'cps-dots', type: 'circle', source: 'cps-track', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 2.6, 'circle-color': ['get', 'hex'], 'circle-stroke-color': 'rgba(5,10,20,0.75)', 'circle-stroke-width': 1 } });
    map.addLayer({ id: 'cps-now-halo', type: 'circle', source: 'cps-now', paint: {
      'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': 'rgba(5,10,20,0.7)', 'circle-stroke-width': ['case', ['get', 'sel'], 6.5, 5] } });
    map.addLayer({ id: 'cps-now', type: 'circle', source: 'cps-now', paint: {
      'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'hex'], 'circle-stroke-width': ['case', ['get', 'sel'], 4, 2.6] } });
    // a transparent hit area so a ring is easy to tap
    map.addLayer({ id: 'cps-hit', type: 'circle', source: 'cps-now', paint: { 'circle-radius': ['+', ['get', 'r'], 6], 'circle-color': 'rgba(0,0,0,0)' } });
    map.on('click', 'cps-hit', function (e) { if (S.on && e.features.length) select(e.features[0].properties.key, false); });
    map.on('mouseenter', 'cps-hit', function () { if (S.on) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'cps-hit', function () { map.getCanvas().style.cursor = ''; });
  }
  function radius(mslp) { return Math.max(7, Math.min(15, 7 + (1012 - (mslp || 1012)) / 5)); }
  function seg(a, b, props) {   // short way round across the date line
    var lb = b.lon; while (lb - a.lon > 180) lb -= 360; while (a.lon - lb > 180) lb += 360;
    return { type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [lb, b.lat]] } };
  }
  function draw() {
    var map = S.map;
    if (!map || !map.getSource('cps-now')) return;
    var vis = S.on ? 'visible' : 'none';
    ['cps-track-halo', 'cps-track', 'cps-dots', 'cps-now-halo', 'cps-now', 'cps-hit'].forEach(function (id) { map.setLayoutProperty(id, 'visibility', vis); });
    var now = live().map(function (x) {
      return { type: 'Feature', properties: { key: x.s.key, hex: hex(x.p.cls), r: radius(x.p.mslp), sel: S.sel === x.s.key },
        geometry: { type: 'Point', coordinates: [x.p.lon, x.p.lat] } };
    });
    map.getSource('cps-now').setData(fc(now));
    var s = selected(), tr = [];
    if (s) {
      for (var i = 0; i + 1 < s.pts.length; i++) tr.push(seg(s.pts[i], s.pts[i + 1], { hex: hex(s.pts[i].cls) }));
      s.pts.forEach(function (p) { tr.push({ type: 'Feature', properties: { hex: hex(p.cls) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }); });
    }
    map.getSource('cps-track').setData(fc(tr));
    list();
    card();
  }
  // the selected low's name beside its ring, on the marine wind page's text canvas
  document.addEventListener('mw:overlay', function (e) {
    var first = !S.proj; S.proj = e.detail.proj;
    if (first) list();
    var s = selected(); if (!S.on || !s) return;
    var p = at(s, S.valid) || null, d = e.detail, ctx = d.ctx;
    if (!p) return;
    d.proj(p.lon, p.lat).forEach(function (q) {
      var r = radius(p.mslp) + 6, text = s.name + (p.mslp ? ' · ' + Math.round(p.mslp) : '');
      ctx.font = '600 12px ' + d.font;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,10,20,0.85)'; ctx.fillStyle = '#ffffff';
      ctx.strokeText(text, q.x + r, q.y - r / 2); ctx.fillText(text, q.x + r, q.y - r / 2);
    });
  });

  // ------------------------------------------------------------ panel list
  function onScreen(p) {   // on the near side of the globe and inside the window
    if (!S.proj) return true;
    var w = window.innerWidth, h = window.innerHeight;
    return S.proj(p.lon, p.lat).some(function (q) { return q.x >= 0 && q.y >= 0 && q.x <= w && q.y <= h; });
  }
  function list() {
    var ol = $('cps-list'); if (!ol) return;
    var rows = live().filter(function (x) { return onScreen(x.p); }).slice(0, LIST_MAX);
    if (!S.index) { ol.innerHTML = '<li class="cps-empty">Loading the tracked lows…</li>'; return; }
    if (!rows.length) { ol.innerHTML = '<li class="cps-empty">No tracked lows in view at this hour.</li>'; return; }
    ol.innerHTML = rows.map(function (x) {
      return '<li><button type="button" data-key="' + esc(x.s.key) + '"' + (S.sel === x.s.key ? ' aria-current="true"' : '') + '>' +
        '<i style="--c:' + hex(x.p.cls) + '"></i><span class="cps-name">' + esc(x.s.name) + '</span>' +
        '<span class="cps-where">' + place(x.p.lat, x.p.lon) + '</span><b>' + (x.p.mslp ? Math.round(x.p.mslp) + ' mb' : '') + '</b></button></li>';
    }).join('');
  }

  // ------------------------------------------------------------ card
  function selected() {
    if (!S.sel) return null;
    for (var i = 0; i < S.storms.length; i++) if (S.storms[i].key === S.sel) return S.storms[i];
    return null;
  }
  function select(key, fly) {
    S.sel = key;
    var s = selected();
    if (s && fly && S.map) {
      var p = at(s, S.valid) || s.pts[0];
      S.map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(S.map.getZoom(), 3), duration: 900 });
    }
    draw();
    if (S.map) S.map.triggerRepaint();
  }
  function card() {
    var c = $('cps-card'), s = selected();
    if (!s || !S.on) { c.hidden = true; window.wxmapCube.close(); return; }
    var p = at(s, S.valid), first = s.pts[0], last = s.pts[s.pts.length - 1];
    var hrs = function (q) { return 'F' + ('00' + q.fhr).slice(-3); };
    c.querySelector('.cps-title').textContent = s.name;
    c.querySelector('.cps-sub').textContent = place(first.lat, first.lon) + ' at ' + hrs(first) + ' to ' + place(last.lat, last.lon) + ' at ' + hrs(last) +
      ' · ' + (S.index.model || 'GFS') + ' ' + K.fmtTime(cycleIso(S.index.cycle)) + ' run';
    c.querySelector('.cps-now').innerHTML = p
      ? 'Now <b>' + num(p.mslp, 0) + ' mb</b> at ' + place(p.lat, p.lon)
      : 'Not tracked at this hour; the cube shows its whole track.';
    c.hidden = false;
    window.wxmapCube.open($('cps-cube'), { key: s.key, label: s.name, pts: s.pts });
  }
  function cycleIso(c) {   // "2026101612" -> ISO
    c = String(c || '');
    return /^\d{10}$/.test(c) ? c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8) + 'T' + c.slice(8, 10) + ':00:00Z' : c;
  }


  // ------------------------------------------------------------ wiring
  function buildCard() {
    var c = document.createElement('aside');
    c.className = 'cps-card'; c.id = 'cps-card'; c.hidden = true; c.setAttribute('aria-label', 'Cyclone phase space');
    c.innerHTML = '<div class="cps-head"><div><h2 class="cps-title"></h2><p class="cps-sub"></p></div>' +
      '<button type="button" class="icon-btn icon-btn-sm" id="cps-close" aria-label="Close phase space">' +
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
      '<p class="cps-now"></p><div class="cps-cube" id="cps-cube"></div>';
    document.getElementById('app').appendChild(c);
    $('cps-close').addEventListener('click', function () { S.sel = null; draw(); if (S.map) S.map.triggerRepaint(); });
  }
  function setOn(on) {
    S.on = on; $('ov-cps').checked = on; draw();
    if (S.map) S.map.triggerRepaint();
  }

  buildCard();
  list();
  $('ov-cps').addEventListener('change', function (e) { setOn(e.target.checked); });
  $('cps-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-key]'); if (b) select(b.getAttribute('data-key'), true);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'y' || e.key === 'Y') setOn(!S.on);
    if (e.key === 'Escape' && S.sel) { S.sel = null; draw(); }
  });
  document.addEventListener('mw:step', function (e) {
    S.valid = Date.parse(e.detail.valid);
    if (S.index) window.wxmapCube.at(S.valid);
    draw();
  });
  // map.js runs this before the marine wind app.js, so no event is missed
  document.addEventListener('mw:ready', function (e) {
    S.map = e.detail.map; addLayers(S.map); draw();
    S.map.on('moveend', list);
  }, { once: true });
  load().then(draw).catch(function (e) {
    var ol = $('cps-list'); if (ol) ol.innerHTML = '<li class="cps-empty">The tracked lows could not load (' + esc(e.message) + ').</li>';
  });
})();
