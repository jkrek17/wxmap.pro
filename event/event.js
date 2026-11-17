// event.js: the event forecast briefing. Reads an event (a saved one from events/<slug>.json,
// or place and times from the URL), pulls every model and ensemble for that point from
// Open-Meteo, and draws the briefing: the glance card, a timeline of day parts with charts,
// what to wear, model by model, the GFS big-picture map and sun times.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var DATA = (document.querySelector('meta[name="event-data"]') || {}).content || 'data/';
  var OM = 'https://api.open-meteo.com/v1/forecast', OME = 'https://ensemble-api.open-meteo.com/v1/ensemble';
  var OMA = 'https://archive-api.open-meteo.com/v1/archive', GEO = 'https://geocoding-api.open-meteo.com/v1/search';

  var MODELS = [
    { id: 'gfs_seamless', name: 'GFS', org: 'NOAA', col: '#0a6c96' },
    { id: 'ecmwf_ifs025', name: 'ECMWF', org: 'ECMWF IFS', col: '#d4561c' },
    { id: 'ecmwf_aifs025_single', name: 'AIFS', org: 'ECMWF AI', col: '#b3155c' },
    { id: 'ncep_nbm_conus', name: 'NBM', org: 'NOAA blend', col: '#17885c', us: true },
    { id: 'ncep_hrrr_conus', name: 'HRRR', org: 'NOAA 3 km', col: '#7a5af5', us: true, short: 2 },
    { id: 'gem_seamless', name: 'GEM', org: 'Canada', col: '#a87a00' },
    { id: 'icon_seamless', name: 'ICON', org: 'Germany', col: '#6b7c8f' }
  ];
  var ENS = [
    { id: 'gfs025', key: 'ncep_gefs025', name: 'GEFS', col: '#0a6c96' },
    { id: 'ecmwf_ifs025', key: 'ecmwf_ifs025_ensemble', name: 'ECMWF ENS', col: '#d4561c' },
    { id: 'ecmwf_aifs025', key: 'ecmwf_aifs025_ensemble', name: 'AIFS ENS', col: '#b3155c' }
  ];
  var HV = 'temperature_2m,dew_point_2m,apparent_temperature,relative_humidity_2m,precipitation,precipitation_probability,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,weather_code,uv_index,cape';
  var EV = 'temperature_2m,dew_point_2m,precipitation,snowfall,wind_gusts_10m';
  var KIND_WORD = { stadium: 'Stadium', wedding: 'Wedding', outdoor: 'Outdoors', travel: 'Travel' };

  // ---------- small helpers ----------
  function q(url, p) { return url + '?' + Object.keys(p).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&'); }
  function getJSON(url, tries) {
    tries = tries || 3;
    return fetch(url).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.reason || ('HTTP ' + r.status)); });
      return r.json();
    }).catch(function (e) {
      if (tries > 1 && (!/HTTP 4/.test(e.message) || /429|many/i.test(e.message))) return new Promise(function (ok) { setTimeout(ok, /429|many/i.test(e.message) ? 2500 : 700); }).then(function () { return getJSON(url, tries - 1); });
      throw e;
    });
  }
  function D(s) { return new Date(s.length === 16 ? s + ':00Z' : s); }       // local wall time as a UTC date
  function fmt(s, o) { return D(s).toLocaleString('en-US', Object.assign({ timeZone: 'UTC' }, o)); }
  function hourWord(s) { var h = +s.slice(11, 13); return h === 0 ? 'Midnight' : h === 12 ? 'Noon' : (h % 12) + (h < 12 ? ' AM' : ' PM'); }
  function shortHour(s) { var h = +s.slice(11, 13); return h === 0 ? '12a' : h === 12 ? '12p' : (h % 12) + (h < 12 ? 'a' : 'p'); }
  function dayWord(s) { return fmt(s, { weekday: 'long' }); }
  function dayShort(s) { return fmt(s, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function addH(s, h) { return new Date(D(s).getTime() + h * 3600000).toISOString().slice(0, 16); }
  function nowLocal(tz) {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    var g = function (t) { return p.find(function (x) { return x.type === t; }).value; };
    return g('year') + '-' + g('month') + '-' + g('day') + 'T' + g('hour') + ':' + g('minute');
  }
  function median(a) { a = a.filter(function (x) { return x != null && !isNaN(x); }).sort(function (x, y) { return x - y; }); if (!a.length) return null; var m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function pct(a, p) { a = a.filter(function (x) { return x != null && !isNaN(x); }).sort(function (x, y) { return x - y; }); if (!a.length) return null; var i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.min(lo + 1, a.length - 1)] - a[lo]) * (i - lo); }
  function sum(a) { return a.reduce(function (s, x) { return s + (x || 0); }, 0); }
  function mean(a) { a = a.filter(function (x) { return x != null; }); return a.length ? sum(a) / a.length : null; }
  function r0(x) { return x == null ? '–' : Math.round(x); }
  function inch(x) { return x == null ? '–' : x < 0.005 ? '0' : x < 0.1 ? x.toFixed(2).replace(/^0/, '') : x.toFixed(2).replace(/^0/, ''); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function md(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>'); }
  function compass(deg) { return deg == null ? '' : ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16]; }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 2400); }
  function status(msg) { var s = $('#status'); s.hidden = !msg; s.innerHTML = msg || ''; }
  function inUS(lat, lon) { return lat > 24 && lat < 50 && lon > -125.5 && lon < -66; }

  // ---------- routing ----------
  function route() {
    var p = new URLSearchParams(location.search);
    if (p.get('e')) {
      return getJSON('events/' + encodeURIComponent(p.get('e')) + '.json').then(function (ev) { ev.saved = true; return ev; });
    }
    if (p.get('lat') && p.get('lon') && p.get('start') && p.get('end')) {
      return Promise.resolve({
        title: p.get('name') || 'Your event', place: p.get('place') || '', lat: +p.get('lat'), lon: +p.get('lon'),
        tz: p.get('tz') || 'auto', start: p.get('start'), end: p.get('end'), kind: p.get('kind') || 'outdoor'
      });
    }
    return Promise.resolve(null);
  }

  // ---------- planner ----------
  function planner() {
    $('#planner').hidden = false;
    document.title = 'Event Forecast · wxmap.pro';
    var now = new Date(), pad = function (n) { return String(n).padStart(2, '0'); };
    var sat = new Date(now); sat.setDate(now.getDate() + ((6 - now.getDay() + 7) % 7 || 7));
    var d = sat.getFullYear() + '-' + pad(sat.getMonth() + 1) + '-' + pad(sat.getDate());
    $('#estart').value = d + 'T15:00'; $('#eend').value = d + 'T22:00';
    var chosen = null, list = $('#placelist'), input = $('#place'), timer;
    input.addEventListener('input', function () {
      chosen = null; clearTimeout(timer);
      var v = input.value.trim();
      if (v.length < 2) { list.hidden = true; return; }
      timer = setTimeout(function () {
        getJSON(q(GEO, { name: v, count: 6, language: 'en', format: 'json' })).then(function (j) {
          var r = j.results || [];
          list.innerHTML = r.map(function (x, i) {
            return '<li role="option" data-i="' + i + '"><b>' + esc(x.name) + '</b> <span>' + esc([x.admin1, x.country_code].filter(Boolean).join(', ')) + '</span></li>';
          }).join('') || '<li class="none">No match</li>';
          list.hidden = false;
          list.querySelectorAll('li[data-i]').forEach(function (li) {
            li.addEventListener('mousedown', function (e) {
              e.preventDefault(); var x = r[+li.dataset.i]; chosen = x;
              input.value = x.name + (x.admin1 ? ', ' + x.admin1 : ''); list.hidden = true;
            });
          });
        }).catch(function () { list.hidden = true; });
      }, 220);
    });
    input.addEventListener('blur', function () { setTimeout(function () { list.hidden = true; }, 150); });
    $('#planform').addEventListener('submit', function (e) {
      e.preventDefault();
      var go = function (x) {
        var s = $('#estart').value, en = $('#eend').value;
        if (en <= s) { toast('The end must be after the start'); return; }
        var p = { lat: x.latitude.toFixed(4), lon: x.longitude.toFixed(4), tz: x.timezone || 'auto', place: input.value, name: $('#ename').value || 'Your event', start: s, end: en, kind: document.querySelector('input[name=kind]:checked').value };
        location.search = new URLSearchParams(p).toString();
      };
      if (chosen) return go(chosen);
      getJSON(q(GEO, { name: input.value.split(',')[0], count: 1, language: 'en', format: 'json' })).then(function (j) {
        if (j.results && j.results.length) go(j.results[0]); else toast('Could not find that place');
      });
    });
    getJSON('events/index.json').then(function (idx) {
      if (!idx.events || !idx.events.length) return;
      $('#saved').hidden = false;
      $('#savedlist').innerHTML = idx.events.map(function (e) {
        return '<a class="card saved-item" href="?e=' + encodeURIComponent(e.slug) + '"><span class="eyebrow">' + esc(e.when || '') + '</span><b>' + esc(e.title) + '</b><span>' + esc(e.place || '') + '</span></a>';
      }).join('');
    }).catch(function () {});
  }

  // ---------- data ----------
  function fetchAll(ev) {
    var today = nowLocal(ev.tz === 'auto' ? Intl.DateTimeFormat().resolvedOptions().timeZone : ev.tz);
    var startDate = ev.start.slice(0, 10), endDate = ev.end.slice(0, 10);
    var maxDate = addH(today.slice(0, 10) + 'T00:00', 24 * 15).slice(0, 10);
    var base = { latitude: ev.lat, longitude: ev.lon, timezone: ev.tz, temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch' };
    var out = { today: today, beyond: startDate > maxDate };
    if (out.beyond) return Promise.resolve(out);
    var leadDays = (D(ev.start) - D(today)) / 86400000;
    var models = MODELS.filter(function (m) { return (!m.us || inUS(ev.lat, ev.lon)) && (!m.short || leadDays < m.short); });
    var range = { start_date: startDate < today.slice(0, 10) ? today.slice(0, 10) : startDate, end_date: endDate > maxDate ? maxDate : endDate };
    var det = getJSON(q(OM, Object.assign({}, base, range, { hourly: HV, models: models.map(function (m) { return m.id; }).join(','), daily: 'sunrise,sunset' })));
    var ens = getJSON(q(OME, Object.assign({}, base, range, { hourly: EV, models: ENS.map(function (m) { return m.id; }).join(',') }))).catch(function () { return null; });
    return Promise.all([det, ens]).then(function (r) { out.det = r[0]; out.ens = r[1]; out.models = models; return out; });
  }

  // Pull the det response apart into {model: {var: []}} and the ens one into {sys: {var: [[member]...]}}
  function unpack(f, ev) {
    var h = f.det.hourly, t = h.time, M = {};
    f.models.forEach(function (m) {
      var o = {}, any = false;
      HV.split(',').forEach(function (v) { o[v] = h[v + '_' + m.id] || t.map(function () { return null; }); if (v === 'temperature_2m' && o[v].some(function (x) { return x != null; })) any = true; });
      if (any) M[m.id] = o;
    });
    var E = {};
    if (f.ens) {
      var eh = f.ens.hourly;
      ENS.forEach(function (s) {
        var o = {};
        EV.split(',').forEach(function (v) {
          var re = new RegExp('^' + v + '(_member\\d+)?_' + s.key + '$');
          var cols = Object.keys(eh).filter(function (k) { return re.test(k); }).map(function (k) { return eh[k]; })
            .filter(function (c) { return c.some(function (x) { return x != null; }); });
          if (cols.length) o[v] = cols;
        });
        if (o.temperature_2m) E[s.id] = o;
      });
    }
    var etime = f.ens ? f.ens.hourly.time : [];
    var win = [];
    t.forEach(function (s, i) { if (s >= ev.start && s <= ev.end) win.push(i); });
    return { t: t, M: M, E: E, etime: etime, win: win, off: f.det.utc_offset_seconds || 0 };
  }

  // One hourly consensus series across the models, with the ensemble chances.
  function consensus(U, ev) {
    var ids = Object.keys(U.M), out = [];
    var eIdx = {}; U.etime.forEach(function (s, i) { eIdx[s] = i; });
    U.t.forEach(function (s, i) {
      var g = function (v) { return median(ids.map(function (m) { return U.M[m][v][i]; })); };
      var all = function (v) { return ids.map(function (m) { return U.M[m][v][i]; }).filter(function (x) { return x != null; }); };
      var o = { s: s, i: i, t: g('temperature_2m'), td: g('dew_point_2m'), at: g('apparent_temperature'), rhum: g('relative_humidity_2m'),
        rain: g('precipitation'), snow: g('snowfall'), cloud: g('cloud_cover'), wind: g('wind_speed_10m'), gust: g('wind_gusts_10m'),
        uv: (function () { var u = all('uv_index'); return u.length ? Math.max.apply(null, u) : null; })(),
        cape: g('cape'), tmin: Math.min.apply(null, all('temperature_2m')), tmax: Math.max.apply(null, all('temperature_2m')) };
      // wind direction: vector mean
      var dirs = all('wind_direction_10m'); if (dirs.length) { var x = sum(dirs.map(function (d) { return Math.sin(d * Math.PI / 180); })), y = sum(dirs.map(function (d) { return Math.cos(d * Math.PI / 180); })); o.dir = (Math.atan2(x, y) * 180 / Math.PI + 360) % 360; }
      // weather: most severe code that at least two models (or the only one) show
      var codes = all('weather_code').sort(function (a, b) { return b - a; });
      o.code = codes.length > 1 ? codes[1] : codes[0];
      if (o.code == null) o.code = 3;
      // chance of measurable precipitation (0.01 in within this hour +/- 1), ensembles first
      var j = eIdx[s], sys = Object.keys(U.E), ch = [];
      if (j != null) sys.forEach(function (k) {
        var P = U.E[k].precipitation; if (!P) return;
        var hit = P.filter(function (col) { return (col[j - 1] || 0) + (col[j] || 0) + (col[j + 1] || 0) >= 0.01; }).length;
        ch.push(hit / P.length);
        var T = U.E[k].temperature_2m; if (T) { o.elo = (o.elo || []).concat(pct(T.map(function (c) { return c[j]; }), 0.1)); o.ehi = (o.ehi || []).concat(pct(T.map(function (c) { return c[j]; }), 0.9)); }
      });
      o.pop = ch.length ? mean(ch) : (g('precipitation_probability') != null ? g('precipitation_probability') / 100 : null);
      if (o.elo) { o.elo = Math.min.apply(null, o.elo); o.ehi = Math.max.apply(null, o.ehi); }
      var utc = new Date(D(s).getTime() - U.off * 1000);
      o.elev = Wear.sunElevation(utc, ev.lat, ev.lon);
      o.night = o.elev < -0.83;
      out.push(o);
    });
    return out;
  }

  var PARTS = [[0, 6, 'Overnight'], [6, 12, 'Morning'], [12, 18, 'Afternoon'], [18, 24, 'Evening']];
  function dayParts(H, ev) {
    var win = H.filter(function (h) { return h.s >= ev.start && h.s <= ev.end; });
    var parts = [];
    win.forEach(function (h) {
      var hr = +h.s.slice(11, 13), p = PARTS.find(function (x) { return hr >= x[0] && hr < x[1]; });
      var key = h.s.slice(0, 10) + p[2];
      var last = parts[parts.length - 1];
      if (!last || last.key !== key) parts.push(last = { key: key, label: p[2], day: h.s.slice(0, 10), hours: [] });
      last.hours.push(h);
    });
    parts = parts.filter(function (p) { return p.hours.length >= 2 || parts.length === 1; });
    parts.forEach(function (p, k) {
      var hs = p.hours, ts = hs.map(function (h) { return h.t; });
      p.from = hs[0].s; p.to = addH(hs[hs.length - 1].s, 1);
      p.hi = Math.max.apply(null, ts); p.lo = Math.min.apply(null, ts);
      p.pop = Math.max.apply(null, hs.map(function (h) { return h.pop || 0; }));
      p.rain = sum(hs.map(function (h) { return h.rain; })); p.snow = sum(hs.map(function (h) { return h.snow; }));
      p.gust = Math.max.apply(null, hs.map(function (h) { return h.gust || 0; }));
      p.wind = mean(hs.map(function (h) { return h.wind; }));
      p.dir = hs[hs.length >> 1].dir;
      p.td = mean(hs.map(function (h) { return h.td; }));
      p.cloud = mean(hs.map(function (h) { return h.cloud; }));
      p.night = hs.filter(function (h) { return h.night; }).length > hs.length / 2;
      var codes = hs.map(function (h) { return h.code; }).sort(function (a, b) { return b - a; });
      p.code = codes[Math.min(codes.length - 1, Math.floor(codes.length / 4))];
      if (p.pop < 0.25 && p.code >= 51) p.code = p.cloud > 70 ? 3 : 2;   // don't draw rain the ensembles barely show
      if (p.code < 3 && p.cloud > 85) p.code = 3;
      p.highlight = (ev.highlight || []).some(function (x) { return x.start < p.to && x.end > p.from; });
    });
    parts.forEach(function (p, k) {
      p.wear = Wear.advise(p.hours.map(function (h) { return { t: h.t, td: h.td, at: h.at, cloud: h.cloud, gust: h.gust, elev: h.elev, uv: h.uv, pop: h.pop, rain: h.rain, snow: h.snow }; }), { kind: ev.kind });
    });
    parts.forEach(function (p, k) {
      var n = parts[k + 1];
      if (n) p.wear = Wear.advise(p.hours.map(function (h) { return { t: h.t, td: h.td, at: h.at, cloud: h.cloud, gust: h.gust, elev: h.elev, uv: h.uv, pop: h.pop, rain: h.rain, snow: h.snow }; }), { kind: ev.kind, next: n.wear });
    });
    return parts;
  }

  // ---------- render ----------
  function render(ev, f) {
    $('#briefing').hidden = false; $('#newbtn').hidden = false;
    document.title = ev.title + ' · Event Forecast';
    $('#h-title').textContent = ev.title;
    $('#h-place').textContent = ev.place || (ev.lat.toFixed(2) + ', ' + ev.lon.toFixed(2));
    var sameDay = ev.start.slice(0, 10) === ev.end.slice(0, 10);
    $('#h-when').textContent = sameDay
      ? dayShort(ev.start) + ' · ' + hourWord(ev.start) + '–' + hourWord(ev.end)
      : fmt(ev.start, { weekday: 'short' }) + ' ' + hourWord(ev.start) + ' → ' + fmt(ev.end, { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + hourWord(ev.end);

    if (ev.briefing) renderBrief(ev.briefing);
    renderSun(ev, f);
    setTimeout(function () { renderTypical(ev); }, 400);

    if (f.beyond) {
      $('#glance').innerHTML = '<div class="glance-far"><b>Too far out for the models.</b> Forecast models reach about 16 days. Below is what is typical for these dates; check back within two weeks of the event.</div>';
      ['#s-timeline', '#s-wear', '#s-details'].forEach(function (s) { $(s).hidden = true; });
      syncTabs();
      chips(ev, f, null);
      return;
    }
    var U = unpack(f, ev);
    if (!U.win.length) { $('#glance').innerHTML = '<div class="glance-far">This event has ended.</div>'; return; }
    var H = consensus(U, ev);
    var parts = dayParts(H, ev);
    renderGlance(ev, H, parts, U);
    U.conf = confidence(U);
    chips(ev, f, U);
    renderParts(ev, parts);
    renderCharts(ev, H, U);
    renderWear(ev, parts);
    renderModels(ev, U, H);
    renderMap(ev, U);
    syncTabs();
  }

  function chips(ev, f, U) {
    var lead = (D(ev.start) - D(f.today)) / 86400000, c = [];
    if (lead > 0) c.push('<span class="chip">' + (lead < 1 ? 'Today' : 'In ' + Math.round(lead) + ' day' + (Math.round(lead) === 1 ? '' : 's')) + '</span>');
    else if (D(ev.end) > D(f.today)) c.push('<span class="chip live">Happening now</span>');
    if (U && U.conf) c.push('<span class="chip conf ' + U.conf.level.toLowerCase() + '" title="' + esc(U.conf.plain) + '">' + U.conf.level + ' confidence</span>');
    else if (!U) c.push('<span class="chip">Typical weather only</span>');
    if (ev.kind && KIND_WORD[ev.kind]) c.push('<span class="chip">' + KIND_WORD[ev.kind] + '</span>');
    $('#h-chips').innerHTML = c.join('');
  }

  // tabs only for the sections that are showing
  function syncTabs() {
    document.querySelectorAll('#tabs a').forEach(function (a) { var t = document.querySelector(a.getAttribute('href')); a.hidden = !t || t.hidden; });
  }

  function renderBrief(b) {
    $('#s-brief').hidden = false;
    $('#b-issued').textContent = b.issued ? 'Written ' + fmt(b.issued, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + (b.tzabbr ? ' ' + b.tzabbr : '') : '';
    var h = '';
    if (b.headline) h += '<p class="headline">' + md(b.headline) + '</p>';
    (b.paragraphs || []).forEach(function (p) { h += '<p>' + md(p) + '</p>'; });
    (b.sections || []).forEach(function (s) { h += '<h3>' + esc(s.title) + '</h3>' + s.text.split('\n\n').map(function (p) { return '<p>' + md(p) + '</p>'; }).join(''); });
    if (b.confidence) h += '<p class="conf"><b>How sure are we?</b> ' + md(b.confidence) + '</p>';
    if (b.fans) h += '<details class="fans"><summary>For weather fans: what the models show</summary>' + b.fans.split('\n\n').map(function (p) { return '<p>' + md(p) + '</p>'; }).join('') + '</details>';
    $('#b-body').innerHTML = h;
  }

  function renderGlance(ev, H, parts, U) {
    var key = ev.highlight && ev.highlight[0];
    var hs = H.filter(function (h) { return key ? h.s >= key.start && h.s < key.end : h.s >= ev.start && h.s <= ev.end; });
    if (!hs.length) hs = H.filter(function (h) { return h.s >= ev.start && h.s <= ev.end; });
    var codes = hs.map(function (h) { return h.code; }).sort(function (a, b) { return b - a; });
    var code = codes[Math.floor(codes.length / 4)];
    var pop = Math.max.apply(null, hs.map(function (h) { return h.pop || 0; }));
    if (pop < 0.25 && code >= 51) code = 3;
    var w = Wear.advise(hs.map(function (h) { return { t: h.t, td: h.td, at: h.at, cloud: h.cloud, gust: h.gust, elev: h.elev, uv: h.uv, pop: h.pop, rain: h.rain, snow: h.snow }; }), { kind: ev.kind });
    var ts = hs.map(function (h) { return h.t; });
    var night = hs.filter(function (h) { return h.night; }).length > hs.length / 2;
    var lo = Math.min.apply(null, ts), hi = Math.max.apply(null, ts);
    $('#glance').innerHTML =
      '<div class="glance-main">' +
        '<div class="glance-icon">' + WxIcons.icon(code, night) + '</div>' +
        '<div><p class="eyebrow">' + (key ? esc(key.label) : 'During the event') + '</p>' +
        '<p class="big num">' + r0(lo) + (Math.round(hi) !== Math.round(lo) ? '–' + r0(hi) : '') + '°</p>' +
        '<p class="cond">' + (code >= 51 && pop < 0.6 ? 'Chance of rain' : WxIcons.words(code, night)) + ' · feels ' + r0(w.fLo) + (Math.round(w.fHi) !== Math.round(w.fLo) ? '–' + r0(w.fHi) : '') + '°</p></div>' +
      '</div>' +
      '<dl class="glance-stats">' +
        stat('Rain chance', Math.round(pop * 100) + '%', pop >= 0.5 ? 'warn' : '') +
        stat('Wind', r0(mean(hs.map(function (h) { return h.wind; }))) + ' mph', '', 'gusts ' + r0(Math.max.apply(null, hs.map(function (h) { return h.gust || 0; })))) +
        stat('Dew point', r0(mean(hs.map(function (h) { return h.td; }))) + '°', '', w.comfort.label) +
        stat('Wear', w.title, '', w.items.slice(0, 2).join(', ')) +
      '</dl>';
    function stat(k, v, cls, sub) { return '<div class="' + (cls || '') + '"><dt>' + k + '</dt><dd class="num">' + v + '</dd>' + (sub ? '<dd class="sub">' + esc(sub) + '</dd>' : '') + '</div>'; }
  }

  function renderParts(ev, parts) {
    var el = $('#parts'), prevDay = null;
    el.innerHTML = parts.map(function (p, k) {
      var head = p.day !== prevDay ? '<span class="pday">' + fmt(p.day + 'T12:00', { weekday: 'short' }) + '</span>' : '';
      prevDay = p.day;
      return '<button type="button" class="part' + (p.highlight ? ' hl' : '') + (p.night ? ' night' : '') + '" data-k="' + k + '">' + head +
        '<span class="plabel">' + p.label + '</span>' + WxIcons.icon(p.code, p.night) +
        '<span class="ptemp num">' + r0(p.night ? p.lo : p.hi) + '°<small>' + r0(p.night ? p.hi : p.lo) + '°</small></span>' +
        '<span class="ppop num' + (p.pop >= 0.5 ? ' wet' : '') + '"><svg viewBox="0 0 10 12"><path d="M5 0C5 0 0 6 0 8a5 5 0 0 0 10 0C10 6 5 0 5 0z"/></svg>' + Math.round(p.pop * 100) + '%</span>' +
        '<span class="pwind num">' + compass(p.dir) + ' ' + r0(p.wind) + (p.gust >= p.wind + 8 ? '<small>G' + r0(p.gust) + '</small>' : '') + '</span>' +
        '</button>';
    }).join('');
    el.querySelectorAll('.part').forEach(function (b) { b.addEventListener('click', function () { openPart(parts[+b.dataset.k]); }); });
  }

  function openPart(p) {
    $('#sheet-title').textContent = fmt(p.day + 'T12:00', { weekday: 'long' }) + ' ' + p.label.toLowerCase();
    var rows = p.hours.map(function (h) {
      return '<tr><td>' + shortHour(h.s) + '</td><td class="ic">' + WxIcons.icon(h.code, h.night) + '</td><td class="num">' + r0(h.t) + '°</td><td class="num">' + r0(h.at) + '°</td><td class="num">' + r0(h.td) + '°</td><td class="num">' + Math.round((h.pop || 0) * 100) + '%</td><td class="num">' + inch(h.rain) + '</td><td class="num">' + compass(h.dir) + ' ' + r0(h.wind) + '/' + r0(h.gust) + '</td><td class="num">' + r0(h.cloud) + '%</td></tr>';
    }).join('');
    var w = p.wear;
    $('#sheet-body').innerHTML = '<div class="tablewrap"><table class="htable"><thead><tr><th></th><th></th><th>Temp</th><th>Feels</th><th>Dew</th><th>Rain</th><th>in</th><th>Wind/G</th><th>Cloud</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="wearcard"><p class="wtitle"><b>' + esc(w.title) + '.</b> ' + esc(w.wear) + '.</p><div class="items">' + w.items.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div><ul>' + w.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    $('#sheet').hidden = false; document.body.classList.add('sheet-open');
  }

  function renderWear(ev, parts) {
    // group consecutive parts with the same advice title
    var groups = [];
    parts.forEach(function (p) {
      var g = groups[groups.length - 1];
      if (g && g.title === p.wear.title && g.items.join() === p.wear.items.join()) { g.parts.push(p); g.notes = g.notes.concat(p.wear.notes); }
      else groups.push({ title: p.wear.title, wear: p.wear.wear, items: p.wear.items, notes: p.wear.notes.slice(), comfort: p.wear.comfort, parts: [p] });
    });
    $('#wear').innerHTML = groups.map(function (g) {
      var a = g.parts[0], b = g.parts[g.parts.length - 1];
      var when = fmt(a.day + 'T12:00', { weekday: 'short' }) + ' ' + a.label.toLowerCase() + (g.parts.length > 1 ? ' – ' + (b.day !== a.day ? fmt(b.day + 'T12:00', { weekday: 'short' }) + ' ' : '') + b.label.toLowerCase() : '');
      var seen = {}, notes = g.notes.filter(function (n) { if (seen[n]) return false; seen[n] = 1; return true; });
      var fl = Math.min.apply(null, g.parts.map(function (p) { return p.wear.fLo; })), fh = Math.max.apply(null, g.parts.map(function (p) { return p.wear.fHi; }));
      return '<div class="wearcard' + (g.parts.some(function (p) { return p.highlight; }) ? ' hl' : '') + '">' +
        '<div class="whead"><span class="eyebrow">' + esc(when) + '</span><span class="feel num">feels ' + r0(fl) + (Math.round(fh) !== Math.round(fl) ? '–' + r0(fh) : '') + '°</span></div>' +
        '<p class="wtitle"><b>' + esc(g.title) + '.</b> ' + esc(g.wear) + '.</p>' +
        '<div class="items">' + g.items.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
        (notes.length ? '<ul>' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
    }).join('');
  }

  // ---------- charts (SVG, shared crosshair) ----------
  var charts = [];
  function renderCharts(ev, H, U) {
    var full = $('#showmodels').checked;
    var hs = H.filter(function (h) { return h.s >= addH(ev.start, -3) && h.s <= addH(ev.end, 3); });
    var ids = Object.keys(U.M), mods = MODELS.filter(function (m) { return U.M[m.id]; });
    var idx = hs.map(function (h) { return h.i; });
    var lines = function (v) { return full ? mods.map(function (m) { return { type: 'line', label: m.name, col: m.col, w: 1.2, op: 0.75, v: idx.map(function (i) { return U.M[m.id][v][i]; }) }; }) : []; };
    var cum = function (get) { var c = 0; return idx.map(function (i, k) { c += get(i, k) || 0; return c; }); };
    var cumM = function (m) { return cum(function (i) { return U.M[m.id].precipitation[i]; }); };
    var expected = cum(function (i, k) { return hs[k].rain; });
    charts = [];
    charts.push(chart('#c-temp', ev, hs, [
      { type: 'band', label: 'Likely range', lo: hs.map(function (h) { return h.elo; }), hi: hs.map(function (h) { return h.ehi; }) }
    ].concat(lines('temperature_2m')).concat([
      { type: 'line', label: 'Feels like', col: 'var(--text-3)', w: 1.6, dash: '4 3', v: hs.map(function (h) { return h.at; }) },
      { type: 'line', label: 'Temperature', col: 'var(--text)', w: 2.6, v: hs.map(function (h) { return h.t; }) }
    ]).concat(full ? [{ type: 'line', label: 'Dew point', col: '#17885c', w: 1.8, dash: '1 3', v: hs.map(function (h) { return h.td; }) }] : []), { unit: '°', pad: 3 }));
    charts.push(chart('#c-pcp', ev, hs, [
      { type: 'bar', label: 'Chance of rain', v: hs.map(function (h) { return (h.pop || 0) * 100; }), axis: 'pct' }
    ].concat(full ? mods.map(function (m) { return { type: 'line', label: m.name, col: m.col, w: 1.6, v: cumM(m), axis: 'r' }; })
      : [{ type: 'line', label: 'Expected rain', col: 'var(--rain)', w: 2.4, v: expected, axis: 'r' }]), { unit: '%', r: { unit: '"', min: 0.25 }, fixed: [0, 100] }));
    var gl = function (f) { return hs.map(function (h) { return f.apply(null, ids.map(function (m) { return U.M[m].wind_gusts_10m[h.i]; }).filter(function (x) { return x != null; })); }); };
    charts.push(chart('#c-wind', ev, hs, (full ? [{ type: 'band', label: 'Gust range', lo: gl(Math.min), hi: gl(Math.max) }] : []).concat([
      { type: 'line', label: 'Gusts', col: 'var(--storm)', w: 1.8, dash: '4 3', v: hs.map(function (h) { return h.gust; }) },
      { type: 'line', label: 'Wind', col: 'var(--text)', w: 2.4, v: hs.map(function (h) { return h.wind; }) }
    ]), { unit: ' mph', min0: true }));
    $('#l-temp').innerHTML = legend([{ label: 'Temperature', col: 'var(--text)' }, { label: 'Feels like', col: 'var(--text-3)', dash: 1 }, { label: 'Likely range', band: 1 }]
      .concat(full ? [{ label: 'Dew point', col: '#17885c', dash: 1 }].concat(mods.map(function (m) { return { label: m.name, col: m.col, thin: 1 }; })) : []));
    $('#l-pcp').innerHTML = legend([{ label: 'Chance of rain (left)', bar: 1 }].concat(full
      ? mods.map(function (m) { return { label: m.name + ' total ' + inch(cumM(m).slice(-1)[0]) + '"', col: m.col, thin: 1 }; })
      : [{ label: 'Expected rain, inches (right)', col: 'var(--rain)' }]));
    $('#l-wind').innerHTML = legend([{ label: 'Wind', col: 'var(--text)' }, { label: 'Gusts', col: 'var(--storm)', dash: 1 }].concat(full ? [{ label: 'Gust range across models', band: 1 }] : []));
    if (!renderCharts.wired) {
      renderCharts.wired = true;
      $('#showmodels').addEventListener('change', function () { renderCharts(ev, H, U); });
      window.addEventListener('resize', debounce(function () { renderCharts(ev, H, U); }, 200));
    }
  }
  function legend(items) {
    return items.map(function (i) {
      var sw = i.band ? '<i class="sw band"></i>' : i.bar ? '<i class="sw bar"></i>' : '<i class="sw' + (i.dash ? ' dash' : '') + (i.thin ? ' thin' : '') + '" style="--c:' + i.col + '"></i>';
      return '<span>' + sw + esc(i.label) + '</span>';
    }).join('');
  }
  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function chart(sel, ev, hs, series, o) {
    var fig = $(sel), box = fig.querySelector('.plot');
    var W = box.clientWidth || 600, Hh = W < 560 ? 170 : 200, m = { l: 34, r: o.r ? 34 : 10, t: 10, b: 24 };
    var n = hs.length, iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    var x = function (i) { return m.l + (n > 1 ? i * iw / (n - 1) : 0); };
    var vals = [];
    series.forEach(function (s) { if (s.axis === 'r' || s.axis === 'pct') return; (s.v || []).concat(s.lo || [], s.hi || []).forEach(function (v) { if (v != null && isFinite(v)) vals.push(v); }); });
    var lo = o.fixed ? o.fixed[0] : Math.floor(Math.min.apply(null, vals) - (o.pad || 1)), hi = o.fixed ? o.fixed[1] : Math.ceil(Math.max.apply(null, vals) + (o.pad || 1));
    if (o.min0) lo = 0;
    if (hi - lo < 5) hi = lo + 5;
    var y = function (v) { return m.t + ih - (v - lo) / (hi - lo) * ih; };
    var rmax = 0; series.forEach(function (s) { if (s.axis === 'r') s.v.forEach(function (v) { rmax = Math.max(rmax, v || 0); }); });
    if (o.r) rmax = Math.max(o.r.min, Math.ceil(rmax * 4) / 4);
    var yr = function (v) { return m.t + ih - v / rmax * ih; };
    var g = '';
    // night and highlight shading
    hs.forEach(function (h, i) {
      var x0 = x(Math.max(0, i - 0.5)), x1 = x(Math.min(n - 1, i + 0.5));
      if (h.night) g += '<rect class="night" x="' + x0 + '" y="' + m.t + '" width="' + (x1 - x0 + 1) + '" height="' + ih + '"/>';
      if (h.s < ev.start || h.s > ev.end) g += '<rect class="outside" x="' + x0 + '" y="' + m.t + '" width="' + (x1 - x0 + 1) + '" height="' + ih + '"/>';
    });
    (ev.highlight || []).forEach(function (k) {
      var a = hs.findIndex(function (h) { return h.s >= k.start; }), b = hs.findIndex(function (h) { return h.s >= k.end; });
      if (a < 0) return; if (b < 0) b = n - 1;
      g += '<rect class="hlband" x="' + x(a) + '" y="' + m.t + '" width="' + (x(b) - x(a)) + '" height="' + ih + '"/><text class="hltext" x="' + (x(a) + 4) + '" y="' + (m.t + 11) + '">' + esc(k.label) + '</text>';
    });
    // grid
    var step = niceStep(hi - lo, ih < 150 ? 4 : 5);
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="ax" x="' + (m.l - 5) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">' + Math.round(v) + (o.unit === '%' ? '' : '') + '</text>';
    if (o.r) for (var rv = 0; rv <= rmax + 1e-9; rv += niceStep(rmax, 4)) g += '<text class="ax" x="' + (W - m.r + 5) + '" y="' + (yr(rv) + 3.5) + '">' + (rv ? rv.toFixed(rmax < 1 ? 2 : 1).replace(/^0/, '') : '0') + '"</text>';
    // day ticks
    hs.forEach(function (h, i) {
      var hr = +h.s.slice(11, 13);
      if (hr === 0) g += '<line class="day" x1="' + x(i) + '" x2="' + x(i) + '" y1="' + m.t + '" y2="' + (m.t + ih) + '"/>';
      if (hr % (W < 560 ? 12 : 6) === 0) g += '<text class="ax" x="' + x(i) + '" y="' + (Hh - 7) + '" text-anchor="middle">' + (hr === 0 ? fmt(h.s, { weekday: 'short' }) : shortHour(h.s)) + '</text>';
    });
    var bw = Math.max(1, iw / n - 1);
    series.forEach(function (s) {
      if (s.type === 'band') {
        var top = [], bot = [];
        s.hi.forEach(function (v, i) { if (v != null && isFinite(v) && s.lo[i] != null && isFinite(s.lo[i])) { top.push(x(i) + ',' + y(v)); bot.unshift(x(i) + ',' + y(s.lo[i])); } });
        if (top.length) g += '<polygon class="band" points="' + top.concat(bot).join(' ') + '"/>';
      } else if (s.type === 'bar') {
        s.v.forEach(function (v, i) { if (v > 0.5) g += '<rect class="bar' + (v >= 50 ? ' hi' : '') + '" x="' + (x(i) - bw / 2) + '" y="' + y(v) + '" width="' + bw + '" height="' + (m.t + ih - y(v)) + '"/>'; });
      } else {
        var yy = s.axis === 'r' ? yr : y, d = '', pen = false;
        s.v.forEach(function (v, i) { if (v == null || !isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + yy(v).toFixed(1); pen = true; });
        g += '<path d="' + d + '" fill="none" stroke="' + s.col + '" stroke-width="' + s.w + '"' + (s.dash ? ' stroke-dasharray="' + s.dash + '"' : '') + (s.op ? ' opacity="' + s.op + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>';
      }
    });
    g += '<line class="xhair" id="' + sel.slice(1) + '-x" x1="0" x2="0" y1="' + m.t + '" y2="' + (m.t + ih) + '" visibility="hidden"/>';
    box.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" width="' + W + '" height="' + Hh + '">' + g + '</svg><div class="tip" hidden></div>';
    var svgEl = box.querySelector('svg'), tip = box.querySelector('.tip');
    var c = { show: function (i) {
      var line = svgEl.querySelector('.xhair');
      if (i == null) { line.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
      line.setAttribute('x1', x(i)); line.setAttribute('x2', x(i)); line.setAttribute('visibility', 'visible');
      var rows = series.filter(function (s) { return s.type !== 'band'; }).map(function (s) {
        var v = s.v[i]; if (v == null || !isFinite(v)) return '';
        var txt = s.axis === 'r' ? inch(v) + '"' : s.axis === 'pct' ? Math.round(v) + '%' : Math.round(v) + (o.unit === ' mph' ? '' : '°');
        return '<div><i style="background:' + (s.col || 'var(--accent)') + '"></i>' + esc(s.label) + '<b>' + txt + '</b></div>';
      }).join('');
      tip.innerHTML = '<p>' + fmt(hs[i].s, { weekday: 'short' }) + ' ' + hourWord(hs[i].s) + '</p>' + rows;
      tip.hidden = false;
      var left = x(i) + 12; if (left + 170 > W) left = x(i) - 182; tip.style.left = Math.max(0, left) + 'px';
    } };
    var move = function (e) {
      var r = svgEl.getBoundingClientRect(), px = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var i = Math.round((px * W / r.width - m.l) / iw * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      charts.forEach(function (ch) { ch.show(i); });
    };
    svgEl.addEventListener('pointermove', move);
    svgEl.addEventListener('pointerdown', move);
    svgEl.addEventListener('pointerleave', function () { charts.forEach(function (ch) { ch.show(null); }); });
    return c;
  }
  function niceStep(range, ticks) { var s = range / ticks, p = Math.pow(10, Math.floor(Math.log10(s))), f = s / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

  // ---------- models ----------
  function renderModels(ev, U, H) {
    var days = [];
    U.win.forEach(function (i) { var d = U.t[i].slice(0, 10); if (days.indexOf(d) < 0) days.push(d); });
    var mods = MODELS.filter(function (m) { return U.M[m.id]; });
    var head = '<thead><tr><th>Model</th>' + days.map(function (d) { return '<th>' + fmt(d + 'T12:00', { weekday: 'short' }) + '<small>hi / lo · rain</small></th>'; }).join('') + '<th>Total</th></tr></thead>';
    var row = function (name, sub, col, get) {
      var tot = 0;
      var cells = days.map(function (d) {
        var ii = U.win.filter(function (i) { return U.t[i].slice(0, 10) === d; });
        var ts = ii.map(function (i) { return get('temperature_2m', i); }).filter(function (x) { return x != null; });
        var p = sum(ii.map(function (i) { return get('precipitation', i); })); tot += p;
        if (!ts.length) return '<td class="na">–</td>';
        return '<td class="num">' + r0(Math.max.apply(null, ts)) + '° / ' + r0(Math.min.apply(null, ts)) + '°<span class="p' + (p >= 0.1 ? ' wet' : '') + '">' + inch(p) + '"</span></td>';
      }).join('');
      return '<tr><th><i style="background:' + col + '"></i>' + name + '<small>' + sub + '</small></th>' + cells + '<td class="num tot' + (tot >= 0.25 ? ' wet' : '') + '">' + inch(tot) + '"</td></tr>';
    };
    var body = mods.map(function (m) { return row(m.name, m.org, m.col, function (v, i) { return U.M[m.id][v][i]; }); }).join('');
    body += row('Consensus', 'median', 'var(--text)', function (v, i) { return v === 'temperature_2m' ? H[i].t : H[i].rain; });
    $('#mtable').innerHTML = head + '<tbody>' + body + '</tbody>';
    $('#m-meta').textContent = 'Event hours only · temperatures °F, rain and melted snow in inches';

    // ensembles: chance of 0.1" and 0.5" over the event, and temperature spread
    var eIdx = {}; U.etime.forEach(function (s, i) { eIdx[s] = i; });
    var ej = U.win.map(function (i) { return eIdx[U.t[i]]; }).filter(function (j) { return j != null; });
    var rows = ENS.filter(function (s) { return U.E[s.id]; }).map(function (s) {
      var P = U.E[s.id].precipitation || [], T = U.E[s.id].temperature_2m;
      var tot = P.map(function (c) { return sum(ej.map(function (j) { return c[j]; })); });
      var p1 = tot.filter(function (x) { return x >= 0.1; }).length / (tot.length || 1), p5 = tot.filter(function (x) { return x >= 0.5; }).length / (tot.length || 1);
      var spread = mean(ej.map(function (j) { return pct(T.map(function (c) { return c[j]; }), 0.9) - pct(T.map(function (c) { return c[j]; }), 0.1); }));
      return { s: s, n: T.length, p1: p1, p5: p5, spread: spread, med: pct(tot, 0.5), p90: pct(tot, 0.9) };
    });
    $('#ensemble').innerHTML = '<h3>Ensembles: chance over the whole event</h3><div class="ens-grid">' + rows.map(function (r) {
      return '<div class="ens"><p><i style="background:' + r.s.col + '"></i><b>' + r.s.name + '</b> <small>' + r.n + ' members</small></p>' +
        meter('0.1" or more', r.p1) + meter('0.5" or more', r.p5) +
        '<p class="small">Wettest 10%: ' + inch(r.p90) + '" · temperature spread ±' + r0(r.spread / 2) + '°</p></div>';
    }).join('') + '</div>';
    function meter(label, p) { return '<div class="meter"><span>' + label + '</span><span class="bar"><i style="width:' + Math.round(p * 100) + '%"></i></span><b class="num">' + Math.round(p * 100) + '%</b></div>'; }

    var c = U.conf || confidence(U);
    $('#confidence').innerHTML = '<span class="conf-pill ' + c.level.toLowerCase() + '">' + c.level + ' confidence</span><span>' + c.why + '.</span>';
  }

  // How much the models and ensembles disagree over the event: {level, why (for weather fans), plain}
  function confidence(U) {
    var mods = MODELS.filter(function (m) { return U.M[m.id]; });
    var eIdx = {}; U.etime.forEach(function (s, i) { eIdx[s] = i; });
    var ej = U.win.map(function (i) { return eIdx[U.t[i]]; }).filter(function (j) { return j != null; });
    var dets = mods.map(function (m) { return sum(U.win.map(function (i) { return U.M[m.id].precipitation[i]; })); });
    var wet = dets.filter(function (x) { return x >= 0.1; }).length, dry = dets.filter(function (x) { return x < 0.02; }).length;
    var sp = mean(Object.keys(U.E).map(function (k) { var T = U.E[k].temperature_2m; return mean(ej.map(function (j) { return pct(T.map(function (c) { return c[j]; }), 0.9) - pct(T.map(function (c) { return c[j]; }), 0.1); })); })) || 0;
    var split = wet && dry, level = split || sp > 12 ? 'Low' : sp > 7 ? 'Medium' : 'High';
    var why = split ? wet + ' of ' + dets.length + ' models are wet and ' + dry + ' are dry' : sp > 7 ? 'The ensembles spread temperatures by about ' + Math.round(sp) + '°' : 'Models and ensembles agree well';
    var plain = split ? 'Whether it rains is still uncertain' : sp > 7 ? 'Temperatures could still shift by several degrees' : 'The forecast is settled';
    return { level: level, why: why, plain: plain };
  }

  // ---------- big picture ----------
  var syn;
  function renderMap(ev, U) {
    var note = $('#mapnote');
    if (!ev.saved) { note.hidden = false; note.textContent = 'The big-picture maps are built for saved briefings. Ask for this event to be saved to get them.'; $('.mapctl').hidden = true; return; }
    getJSON(DATA + ev.slug + '/synoptic.json', 1).then(function (doc) {
      syn = new Synoptic($('#map'), { lat: ev.lat, lon: ev.lon });
      var sl = $('#mslider'); sl.max = doc.times.length - 1;
      var key = (ev.highlight && ev.highlight[0]) ? ev.highlight[0].start : ev.start;
      var keyUtc = new Date(D(key).getTime() - U.off * 1000).getTime();
      var best = 0; doc.times.forEach(function (t, i) { if (Math.abs(Date.parse(t.valid.replace('Z', ':00Z')) - keyUtc) < Math.abs(Date.parse(doc.times[best].valid.replace('Z', ':00Z')) - keyUtc)) best = i; });
      var label = function (i) {
        var t = new Date(Date.parse(doc.times[i].valid.replace('Z', ':00Z')) + U.off * 1000).toISOString().slice(0, 16);
        $('#mtime').textContent = fmt(t, { weekday: 'short' }) + ' ' + hourWord(t);
      };
      $('#map-meta').textContent = 'GFS run ' + doc.cycle.slice(5, 10).replace('-', '/') + ' ' + doc.cycle.slice(11) + ' · precipitation is the 6 h ending at the time shown';
      $('#maplegend').innerHTML = Synoptic.legend('sfc');
      return syn.load(doc).then(function () {
        sl.value = best; syn.set(best); label(best);
        sl.addEventListener('input', function () { syn.set(+sl.value); label(+sl.value); });
        var timer = null;
        $('#mplay').addEventListener('click', function () {
          if (timer) { clearInterval(timer); timer = null; $('#mplay').classList.remove('on'); return; }
          $('#mplay').classList.add('on');
          timer = setInterval(function () { var i = (+sl.value + 1) % doc.times.length; sl.value = i; syn.set(i); label(i); }, 900);
        });
        document.querySelectorAll('.seg [data-layer]').forEach(function (b) {
          b.addEventListener('click', function () {
            document.querySelectorAll('.seg [data-layer]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            syn.setLayer(b.dataset.layer); $('#maplegend').innerHTML = Synoptic.legend(b.dataset.layer);
          });
        });
        window.addEventListener('resize', debounce(function () { syn.resize(); }, 200));
        $('#s-details').addEventListener('toggle', function () { if ($('#s-details').open) syn.resize(); });
        document.addEventListener('wxmap-theme', function () { syn.draw(); });
      });
    }).catch(function () {
      note.hidden = false; note.textContent = 'The map for this event is not built yet; it refreshes after each GFS run.'; $('.mapctl').hidden = true;
    });
  }

  // ---------- sun ----------
  function renderSun(ev, f) {
    var off = f.det ? f.det.utc_offset_seconds : null;
    if (off == null) {   // no forecast (too far out): take the offset from the time zone
      try { var p = new Intl.DateTimeFormat('en-US', { timeZone: ev.tz, timeZoneName: 'longOffset' }).formatToParts(D(ev.start)).find(function (x) { return x.type === 'timeZoneName'; }).value; var mm = p.match(/([+-])(\d\d):?(\d\d)?/); off = mm ? (mm[1] === '-' ? -1 : 1) * (+mm[2] * 3600 + (+mm[3] || 0) * 60) : 0; } catch (e) { off = 0; }
    }
    var days = [], d = ev.start.slice(0, 10);
    while (d <= ev.end.slice(0, 10) && days.length < 14) { days.push(d); d = addH(d + 'T00:00', 24).slice(0, 10); }
    var loc = function (ms) { return ms == null ? '–' : new Date(ms + off * 1000).toISOString().slice(0, 16); };
    var tm = function (ms) { if (ms == null) return '–'; var s = loc(ms); return fmt(s, { hour: 'numeric', minute: '2-digit' }).replace(' ', ' '); };
    $('#sun').innerHTML = days.map(function (day) {
      var start = Date.parse(day + 'T00:00:00Z') - off * 1000;
      var s = Wear.sunDay(start, ev.lat, ev.lon, [-6, -0.833, -4, 6]);
      var len = s.set[-0.833] && s.rise[-0.833] ? (s.set[-0.833] - s.rise[-0.833]) / 3600000 : null;
      // arc: sun path from rise to set
      var arc = sunArc(s, start);
      return '<div class="sunday"><p class="eyebrow">' + fmt(day + 'T12:00', { weekday: 'long', month: 'short', day: 'numeric' }) + '</p>' + arc +
        '<dl>' +
        '<div><dt>Sunrise</dt><dd class="num">' + tm(s.rise[-0.833]) + '</dd></div>' +
        '<div><dt>Sunset</dt><dd class="num">' + tm(s.set[-0.833]) + '</dd></div>' +
        '<div><dt>Golden hour</dt><dd class="num">' + tm(s.rise[-4]) + '–' + tm(s.rise[6]) + '<br>' + tm(s.set[6]) + '–' + tm(s.set[-4]) + '</dd></div>' +
        '<div><dt>First / last light</dt><dd class="num">' + tm(s.rise[-6]) + ' / ' + tm(s.set[-6]) + '</dd></div>' +
        '<div><dt>Highest sun</dt><dd class="num">' + Math.round(s.noon.el) + '° at ' + tm(s.noon.t) + '</dd></div>' +
        '<div><dt>Daylight</dt><dd class="num">' + (len ? Math.floor(len) + 'h ' + Math.round((len % 1) * 60) + 'm' : '–') + '</dd></div>' +
        '</dl></div>';
    }).join('');
  }
  function sunArc(s, start) {
    var W = 240, H = 70;
    return '<svg class="arc" viewBox="0 0 ' + W + ' ' + (H + 8) + '" aria-hidden="true">' + arcPath(s, start, W, H) + '</svg>';
  }
  var arcCache = {};
  function arcPath(s, start, W, H) {
    var ev = arcCache.ev, pts = '', hz = H - 4;
    var y = function (el) { return (hz - Math.max(-8, el) / 75 * (hz - 6)).toFixed(1); };   // 75 deg reaches the top
    for (var m = 0; m <= 1440; m += 15) {
      var el = Wear.sunElevation(new Date(start + m * 60000), ev.lat, ev.lon);
      pts += (m ? 'L' : 'M') + (m / 1440 * W).toFixed(1) + ',' + y(el);
    }
    return '<line class="hz" x1="0" x2="' + W + '" y1="' + hz + '" y2="' + hz + '"/><path class="sunpath" d="' + pts + '"/>' +
      '<circle class="sundot" cx="' + ((s.noon.t - start) / 86400000 * W).toFixed(1) + '" cy="' + y(s.noon.el) + '" r="5"/>';
  }

  // ---------- typical ----------
  function renderTypical(ev) {
    var mid = new Date((D(ev.start).getTime() + D(ev.end).getTime()) / 2), y0 = new Date().getFullYear() - 1, years = [];
    for (var y = y0; y > y0 - 12; y--) years.push(y);
    var mmdd = function (dd) { return dd.toISOString().slice(5, 10); };
    var a = new Date(mid.getTime() - 7 * 86400000), b = new Date(mid.getTime() + 7 * 86400000);
    // one small request per year, two at a time, so the archive's rate limit is never hit
    var one = function (yr) {
      var s = yr + '-' + mmdd(a), e = (a.getUTCFullYear() < b.getUTCFullYear() ? yr + 1 : yr) + '-' + mmdd(b);
      return getJSON(q(OMA, { latitude: ev.lat, longitude: ev.lon, start_date: s, end_date: e, daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum', temperature_unit: 'fahrenheit', precipitation_unit: 'inch', timezone: ev.tz }), 2).catch(function () { return null; });
    };
    var rs = [], k = 0;
    var lane = function () { if (k >= years.length) return Promise.resolve(); var yr = years[k++]; return one(yr).then(function (r) { rs.push(r); return lane(); }); };
    Promise.all([lane(), lane()]).then(function () {
      var hi = [], lo = [], pr = [];
      rs.forEach(function (r) { if (!r || !r.daily) return; hi = hi.concat(r.daily.temperature_2m_max); lo = lo.concat(r.daily.temperature_2m_min); pr = pr.concat(r.daily.precipitation_sum); });
      hi = hi.filter(function (x) { return x != null; }); lo = lo.filter(function (x) { return x != null; }); pr = pr.filter(function (x) { return x != null; });
      if (!hi.length) return;
      $('#s-typical').hidden = false; syncTabs();
      $('#t-meta').textContent = 'ERA5, ' + years[years.length - 1] + '–' + years[0] + ', two weeks around the event';
      $('#typical').innerHTML = '<dl class="typ">' +
        '<div><dt>Average high</dt><dd class="num">' + r0(mean(hi)) + '°</dd><dd class="sub">range ' + r0(pct(hi, 0.05)) + '–' + r0(pct(hi, 0.95)) + '°</dd></div>' +
        '<div><dt>Average low</dt><dd class="num">' + r0(mean(lo)) + '°</dd><dd class="sub">range ' + r0(pct(lo, 0.05)) + '–' + r0(pct(lo, 0.95)) + '°</dd></div>' +
        '<div><dt>Days with rain or snow</dt><dd class="num">' + Math.round(100 * pr.filter(function (x) { return x >= 0.01; }).length / pr.length) + '%</dd><dd class="sub">0.25" or more: ' + Math.round(100 * pr.filter(function (x) { return x >= 0.25; }).length / pr.length) + '%</dd></div>' +
        '</dl>';
    });
  }

  // ---------- wiring ----------
  function wire() {
    $('#sheet-close').addEventListener('click', closeSheet);
    $('#sheet').addEventListener('click', function (e) { if (e.target.id === 'sheet') closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
    $('#print').addEventListener('click', function () { window.print(); });
    $('#share').addEventListener('click', function () {
      var data = { title: document.title, url: location.href };
      if (navigator.share) navigator.share(data).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { toast('Link copied'); });
    });
    // highlight the tab for the section in view
    var links = Array.prototype.slice.call(document.querySelectorAll('#tabs a'));
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) links.forEach(function (a) { a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id); }); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      links.forEach(function (a) { var s = document.querySelector(a.getAttribute('href')); if (s) io.observe(s); });
    }
  }
  function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('sheet-open'); }

  wire();
  route().then(function (ev) {
    if (!ev) return planner();
    arcCache.ev = ev;
    $('#briefing').hidden = false;
    return fetchAll(ev).then(function (f) { render(ev, f); });
  }).catch(function (e) {
    status('Could not load the forecast: ' + esc(e.message) + '. <a href="">Try again</a>');
    console.error(e);
  });
})();
