/* wxmap.pro lab: the lab layers on the marine wind globe. Experimental.

   Reads what the lab job (jkrek17/marine-research tools/lab_run.py) writes after each run:
   - lows.json: the GFS run's lows (F012-F072, every 12 h, 1000 mb or deeper, over open water), each with
     how rare it is (share of ERA5 cyclones near it in its month that never got that deep; ERA5 is a proxy)
     and its Storm Twins (the 30 past ERA5 storms with the closest 500 nm pattern, and how many reached
     hurricane force in the next 24 h). A ring per low at the marine wind page's valid time, coloured by
     rarity; selecting one opens its card.
   - bomb.json: the day 5-7 bomb watch, the share of GEFS, ENS and AIFS ENS members that bomb a low within
     500 km of each 2 degree ocean cell, calibrated. Days 6-7 show only low / medium / high (above ~35%
     they verified more often than stated). Days 5-7 lie past the wind page's slider, so they have their own
     day buttons.
   The marine wind page says when its map is ready and which valid time it shows through the mw:ready,
   mw:step and mw:overlay events. */
(function () {
  'use strict';
  var DATA = document.querySelector('meta[name="lab-data"]').content;
  var CLASSES = ['below gale', 'gale', 'storm', 'hurricane force'];
  var CLS_HEX = ['#8a8a86', '#e8b923', '#e8702a', '#c0362c'];
  var RARE = [[99, '#c0362c', 'Rarer than 99%'], [95, '#e8702a', 'Rarer than 95%'], [80, '#e8b923', 'Rarer than 80%'], [-1, '#8a8a86', 'Common']];
  var LEVEL_HEX = { 1: '#f3c94a', 2: '#ef8a2f', 3: '#d1342b' };
  var LEVEL_NAME = { 1: 'Low', 2: 'Medium', 3: 'High' };
  var LIST_MAX = 6;

  var K = window.GlobeKit;
  var $ = function (id) { return document.getElementById(id); };
  var S = { lows: null, bomb: null, valid: null, map: null, on: true, sel: null, proj: null, day: 0, cell: null, err: {} };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function place(lat, lon) {
    var w = K.wrapLon(lon);
    function d(v, p, n) { return Math.abs(Math.round(v)) + (Math.round(v) >= 0 ? p : n); }
    return d(lat, 'N', 'S') + ' ' + d(w, 'E', 'W');
  }
  function rare(pct) {
    for (var i = 0; i < RARE.length; i++) if (pct != null && pct >= RARE[i][0]) return RARE[i];
    return RARE[RARE.length - 1];
  }
  function cycleIso(c) {   // "2026101900" -> ISO
    c = String(c || '');
    return /^\d{10}$/.test(c) ? c.slice(0, 4) + '-' + c.slice(4, 6) + '-' + c.slice(6, 8) + 'T' + c.slice(8, 10) + ':00:00Z' : c;
  }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function stamp(c) {      // "2017121012" -> "10 Dec 2017 12Z"
    c = String(c);
    return +c.slice(6, 8) + ' ' + MON[+c.slice(4, 6) - 1] + ' ' + c.slice(0, 4) + ' ' + c.slice(8, 10) + 'Z';
  }
  function months(m, w) {  // month window of the rarity reference, e.g. Nov or Oct-Dec
    if (!w) return MON[m - 1];
    return MON[(m - 1 - w + 12) % 12] + '-' + MON[(m - 1 + w) % 12];
  }
  function key(l) { return l.fhr + ':' + l.lat + ':' + l.lon; }

  // ------------------------------------------------------------ data
  function get(name) {
    return fetch(DATA + name, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ' ' + r.status);
      return r.json();
    });
  }
  function load() {
    get('lows.json').then(function (d) {
      d.lows.forEach(function (l) { l.t = Date.parse(l.valid); l.key = key(l); });
      S.lows = d; draw();
    }).catch(function (e) { S.err.lows = e.message; list(); });
    get('bomb.json').then(function (d) { S.bomb = d; drawBomb(); }).catch(function (e) { S.err.bomb = e.message; note(); });
  }
  function live() {   // lows at the shown valid time, rarest first
    if (!S.lows || S.valid == null) return [];
    return S.lows.lows.filter(function (l) { return Math.abs(l.t - S.valid) < 60e3; })
      .sort(function (a, b) { return (b.rarity.pct || 0) - (a.rarity.pct || 0) || a.hpa - b.hpa; });
  }
  function selected() {
    if (!S.sel || !S.lows) return null;
    for (var i = 0; i < S.lows.lows.length; i++) if (S.lows.lows[i].key === S.sel) return S.lows.lows[i];
    return null;
  }

  // ------------------------------------------------------------ map
  function fc(f) { return { type: 'FeatureCollection', features: f }; }
  function addLayers(map) {
    map.addSource('lab-bomb', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'lab-bomb', type: 'fill', source: 'lab-bomb', paint: { 'fill-color': ['get', 'hex'], 'fill-opacity': ['get', 'a'] } });
    map.addLayer({ id: 'lab-bomb-edge', type: 'line', source: 'lab-bomb', paint: { 'line-color': ['get', 'hex'], 'line-width': 0.6, 'line-opacity': 0.8 } });
    map.addSource('lab-lows', { type: 'geojson', data: fc([]) });
    map.addLayer({ id: 'lab-lows-halo', type: 'circle', source: 'lab-lows', paint: {
      'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': 'rgba(5,10,20,0.7)', 'circle-stroke-width': ['case', ['get', 'sel'], 6.5, 5] } });
    map.addLayer({ id: 'lab-lows', type: 'circle', source: 'lab-lows', paint: {
      'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'hex'], 'circle-stroke-width': ['case', ['get', 'sel'], 4, 2.6] } });
    map.addLayer({ id: 'lab-hit', type: 'circle', source: 'lab-lows', paint: { 'circle-radius': ['+', ['get', 'r'], 6], 'circle-color': 'rgba(0,0,0,0)' } });
    map.on('click', 'lab-hit', function (e) { if (S.on && e.features.length) select(e.features[0].properties.key, false); });
    map.on('mouseenter', 'lab-hit', function () { if (S.on) map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'lab-hit', function () { map.getCanvas().style.cursor = ''; });
    map.on('click', 'lab-bomb', function (e) {
      if (!e.features.length || e.defaultPrevented) return;
      S.cell = e.features[0].properties; note();
    });
  }
  function radius(hpa) { return Math.max(7, Math.min(15, 7 + (1012 - (hpa || 1012)) / 5)); }
  function draw() {
    var map = S.map;
    if (map && map.getSource('lab-lows')) {
      var vis = S.on ? 'visible' : 'none';
      ['lab-lows-halo', 'lab-lows', 'lab-hit'].forEach(function (id) { map.setLayoutProperty(id, 'visibility', vis); });
      map.getSource('lab-lows').setData(fc(live().map(function (l) {
        return { type: 'Feature', properties: { key: l.key, hex: rare(l.rarity.pct)[1], r: radius(l.hpa), sel: S.sel === l.key },
          geometry: { type: 'Point', coordinates: [K.wrapLon(l.lon), l.lat] } };
      })));
    }
    list();
    card();
  }
  function drawBomb() {
    var map = S.map, L = lead();
    if (map && map.getSource('lab-bomb')) {
      var h = 0.5 * ((S.bomb && S.bomb.cell_deg) || 2), f = [];
      if (L) L.cells.forEach(function (c) {
        var lat = c[1], lon = K.wrapLon(c[2]), lv = c[4];
        f.push({ type: 'Feature', properties: { hex: LEVEL_HEX[lv], a: 0.22 + 0.14 * lv, level: lv, pct: L.numbers ? c[3] : null, lat: lat, lon: lon },
          geometry: { type: 'Polygon', coordinates: [[[lon - h, lat - h], [lon + h, lat - h], [lon + h, lat + h], [lon - h, lat + h], [lon - h, lat - h]]] } });
      });
      map.getSource('lab-bomb').setData(fc(f));
    }
    document.querySelectorAll('#bomb-days button').forEach(function (b) {
      b.setAttribute('aria-checked', String(+b.getAttribute('data-day') === S.day));
    });
    note();
  }
  function lead() {
    if (!S.bomb || !S.day) return null;
    for (var i = 0; i < S.bomb.leads.length; i++) if (S.bomb.leads[i].day === S.day) return S.bomb.leads[i];
    return null;
  }
  // the selected low's pressure beside its ring, on the marine wind page's text canvas
  document.addEventListener('mw:overlay', function (e) {
    var first = !S.proj; S.proj = e.detail.proj;
    if (first) list();
    var l = selected(); if (!S.on || !l || Math.abs(l.t - S.valid) > 60e3) return;
    var d = e.detail, ctx = d.ctx;
    d.proj(l.lon, l.lat).forEach(function (q) {
      var r = radius(l.hpa) + 6, text = Math.round(l.hpa) + ' mb' + (l.rarity.pct != null ? ' · ' + Math.round(l.rarity.pct) + '%' : '');
      ctx.font = '600 12px ' + d.font;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(5,10,20,0.85)'; ctx.fillStyle = '#ffffff';
      ctx.strokeText(text, q.x + r, q.y - r / 2); ctx.fillText(text, q.x + r, q.y - r / 2);
    });
  });

  // ------------------------------------------------------------ panel
  function onScreen(l) {
    if (!S.proj) return true;
    var w = window.innerWidth, h = window.innerHeight;
    return S.proj(l.lon, l.lat).some(function (q) { return q.x >= 0 && q.y >= 0 && q.x <= w && q.y <= h; });
  }
  function list() {
    var ol = $('lab-list'); if (!ol) return;
    if (S.err.lows) { ol.innerHTML = '<li class="cps-empty">The lows could not load (' + esc(S.err.lows) + ').</li>'; return; }
    if (!S.lows) { ol.innerHTML = '<li class="cps-empty">Loading the lows…</li>'; return; }
    var rows = live().filter(onScreen).slice(0, LIST_MAX);
    if (!rows.length) {
      ol.innerHTML = '<li class="cps-empty">No lows of 1000 mb or deeper in view at this hour. The GFS ' +
        esc(K.fmtTime(cycleIso(S.lows.cycle))) + ' run has them every 12 h from F012 to F072.</li>';
      return;
    }
    ol.innerHTML = rows.map(function (l) {
      var p = l.rarity.pct;
      return '<li><button type="button" data-key="' + esc(l.key) + '"' + (S.sel === l.key ? ' aria-current="true"' : '') + '>' +
        '<i style="--c:' + rare(p)[1] + '"></i><span class="cps-name">' + (p == null ? 'No reference' : 'Deeper than ' + Math.round(p) + '%') + '</span>' +
        '<span class="cps-where">' + place(l.lat, l.lon) + '</span><b>' + Math.round(l.hpa) + ' mb</b></button></li>';
    }).join('');
  }
  function note() {
    var n = $('bomb-note'); if (!n) return;
    if (S.err.bomb) { n.textContent = 'The bomb watch could not load (' + S.err.bomb + ').'; return; }
    if (!S.bomb) { n.textContent = 'Loading the bomb watch…'; return; }
    var L = lead(), run = K.fmtTime(cycleIso(S.bomb.cycle));
    if (!L) {
      n.innerHTML = 'Chance a low <b>bombs</b> (deepens 24 mb in 24 h, adjusted for latitude) within 270 nm, from the ' +
        esc(run) + ' ensembles. Pick a day.';
      return;
    }
    var legend = '<span class="lab-legend">' + [1, 2, 3].map(function (v) {
      return '<span><i style="background:' + LEVEL_HEX[v] + '"></i>' + LEVEL_NAME[v] + ' ' + S.bomb.levels[v - 1].from_pct + '%+</span>';
    }).join('') + '</span>';
    var html = '<b>Day ' + L.day + '</b>, valid ' + esc(K.fmtTime(L.valid)) + ' · ' + L.members + ' members of ' +
      esc(S.bomb.ensembles.map(function (e) { return { gefs: 'GEFS', ens: 'ENS', 'aifs-ens': 'AIFS ENS' }[e] || e; }).join(', ')) +
      ' (' + esc(run) + ' run). ' + (L.cells.length ? '' : 'No cell reaches 10%. ') + legend;
    html += L.numbers ? '<br>Tap a cell for its chance. Day 5 passed its test on held-out weeks.'
      : '<br>Shown as levels: above about 35% day ' + L.day + ' has verified more often than the number says.';
    if (S.cell) html += '<br>Cell at ' + place(+S.cell.lat, +S.cell.lon) + ': <b>' + LEVEL_NAME[S.cell.level] +
      (S.cell.pct != null && S.cell.pct !== 'null' ? ', ' + S.cell.pct + '%' : '') + '</b>';
    n.innerHTML = html;
  }

  // ------------------------------------------------------------ card
  function select(k, fly) {
    S.sel = k;
    var l = selected();
    if (l && fly && S.map) S.map.flyTo({ center: [K.wrapLon(l.lon), l.lat], zoom: Math.max(S.map.getZoom(), 3), duration: 900 });
    draw();
    if (S.map) S.map.triggerRepaint();
  }
  function card() {
    var c = $('lab-card'), l = selected();
    if (!l || !S.on) { c.hidden = true; return; }
    var r = l.rarity, t = l.twins, rr = rare(r.pct);
    c.querySelector('.cps-title').textContent = Math.round(l.hpa) + ' mb low · ' + place(l.lat, l.lon);
    c.querySelector('.cps-sub').textContent = 'GFS ' + K.fmtTime(cycleIso(S.lows.cycle)) + ' run, F' + ('00' + l.fhr).slice(-3) +
      ', valid ' + K.fmtTime(l.valid);
    var h = '<div class="lab-block"><h4>How rare</h4>';
    if (r.pct == null) h += '<p>Too few past lows near here to rank it.</p>';
    else h += '<p class="lab-big" style="--c:' + rr[1] + '">Deeper than ' + Math.round(r.pct) + '%</p>' +
      '<p>of ' + r.n + ' ERA5 lows within 540 nm in ' + months(new Date(l.valid).getUTCMonth() + 1, r.months) +
      ', 1979-2025 (their lowest pressure). Deepest of them: ' + Math.round(r.deepest) + ' mb.</p>';
    h += '</div><div class="lab-block"><h4>Storm Twins</h4>';
    if (!t) h += '<p>Twins are found October to April only, the months the library and its test cover.</p>';
    else {
      h += '<p class="lab-big" style="--c:' + (t.hf ? CLS_HEX[3] : CLS_HEX[0]) + '">' + t.hf + ' of ' + t.n + ' twins</p>' +
        '<p>reached hurricane force in the next 24 h. Past ERA5 storms (2014-2022) with the closest 500 nm pattern of ' +
        '500 mb height, pressure and jet.</p><div class="lab-bar" aria-label="Twins by strongest wind">' +
        t.counts.map(function (n, i) { return n ? '<span style="flex:' + n + ';background:' + CLS_HEX[i] + '" title="' + n + ' ' + CLASSES[i] + '"></span>' : ''; }).join('') +
        '</div><p class="lab-key">' + t.counts.map(function (n, i) { return '<span><i style="background:' + CLS_HEX[i] + '"></i>' + n + ' ' + CLASSES[i] + '</span>'; }).join('') + '</p>' +
        '<h5>Closest five</h5><ol class="lab-twins">' + t.closest.map(function (x) {
          return '<li><span>' + esc(stamp(x.time)) + '</span><span class="cps-where">' + place(x.lat, x.lon) + '</span><b>' + Math.round(x.hpa) +
            ' mb</b><em style="--c:' + CLS_HEX[x.cls] + '">' + CLASSES[x.cls] + '</em></li>';
        }).join('') + '</ol>';
    }
    h += '</div><p class="lab-fine">Experimental. ERA5 is a reanalysis used as a stand-in for observed storms. Twins tested on ' +
      'five winters of GFS: skilful against climatology, but where more than 30% of twins reached hurricane force it happened ' +
      'about half the time or more, so read high counts as likely.</p>';
    c.querySelector('.lab-body').innerHTML = h;
    c.hidden = false;
  }

  // ------------------------------------------------------------ wiring
  function buildCard() {
    var c = document.createElement('aside');
    c.className = 'cps-card lab-card'; c.id = 'lab-card'; c.hidden = true; c.setAttribute('aria-label', 'Low details');
    c.innerHTML = '<div class="cps-head"><div><h2 class="cps-title"></h2><p class="cps-sub"></p></div>' +
      '<button type="button" class="icon-btn icon-btn-sm" id="lab-close" aria-label="Close">' +
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>' +
      '<div class="lab-body"></div>';
    document.getElementById('app').appendChild(c);
    $('lab-close').addEventListener('click', function () { S.sel = null; draw(); if (S.map) S.map.triggerRepaint(); });
  }
  function setOn(on) { S.on = on; $('ov-rare').checked = on; draw(); if (S.map) S.map.triggerRepaint(); }
  function setDay(d) { S.day = d; S.cell = null; drawBomb(); }

  buildCard();
  list();
  note();
  $('ov-rare').addEventListener('change', function (e) { setOn(e.target.checked); });
  $('lab-list').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-key]'); if (b) select(b.getAttribute('data-key'), true);
  });
  $('bomb-days').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-day]'); if (b) setDay(+b.getAttribute('data-day'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'r' || e.key === 'R') setOn(!S.on);
    if (e.key === 'b' || e.key === 'B') setDay(S.day === 0 ? 5 : (S.day === 7 ? 0 : S.day + 1));
    if (e.key === 'Escape' && S.sel) { S.sel = null; draw(); }
  });
  document.addEventListener('mw:step', function (e) { S.valid = Date.parse(e.detail.valid); draw(); });
  // The lab starts with the wind page's storm overlays off, so its own layers stand out; they stay
  // in the Wind layers tab to turn back on. Through the page's own switches, so its state follows.
  var QUIET = ['ov-lone', 'ov-tested', 'ov-hazard', 'ov-warn', 'ov-track'];
  function quiet() {
    QUIET.forEach(function (id) {
      var x = $(id);
      if (x && x.checked) { x.checked = false; x.dispatchEvent(new Event('change')); }
    });
  }
  document.addEventListener('mw:ready', function (e) {
    setTimeout(quiet, 0);   // after app.js has wired its switches
    S.map = e.detail.map; addLayers(S.map); draw(); drawBomb();
    S.map.on('moveend', list);
  }, { once: true });
  load();
})();
