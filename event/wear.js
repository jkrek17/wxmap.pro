// wear.js: how it will feel and what to wear, from the forecast for one stretch of hours.
// Pure functions (no page access), so the rules can be read and tested on their own.
//
// The idea: the thermometer alone misleads. 70 °F with sun and a 70 °F dew point in August
// feels hot and sticky; 70 °F under cloud with a 10 °F dew point in December feels crisp
// and dry. So the clothing level comes from a "how it feels" temperature that adds the sun
// (its height in the sky and the cloud cover) and damp chill to the apparent temperature
// (which already counts wind and humidity), and the dew point adds its own advice.
(function (root) {
  'use strict';
  var RAD = Math.PI / 180;

  // Sun elevation in degrees at a UTC time (NOAA low-precision algorithm, ~0.1 degree).
  function sunElevation(date, lat, lon) {
    var jd = date.getTime() / 86400000 + 2440587.5, n = jd - 2451545.0;
    var L = (280.46 + 0.9856474 * n) % 360, g = ((357.528 + 0.9856003 * n) % 360) * RAD;
    var lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
    var eps = (23.439 - 0.0000004 * n) * RAD;
    var dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    var ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    var gmst = (18.697374558 + 24.06570982441908 * n) % 24;
    var ha = ((gmst * 15 + lon) * RAD) - ra;
    var el = Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha));
    return el / RAD;
  }

  // Times (ms, UTC) on the local day starting at dayStartMs when the sun crosses each
  // elevation in `levels`, scanning by minute. Returns {rise: {lvl: t}, set: {lvl: t}, noon: {t, el}}.
  function sunDay(dayStartMs, lat, lon, levels) {
    var out = { rise: {}, set: {}, noon: { t: null, el: -90 } };
    var prev = sunElevation(new Date(dayStartMs), lat, lon);
    for (var m = 1; m <= 1440; m++) {
      var t = dayStartMs + m * 60000, el = sunElevation(new Date(t), lat, lon);
      if (el > out.noon.el) out.noon = { t: t, el: el };
      levels.forEach(function (lv) {
        if (prev < lv && el >= lv && out.rise[lv] == null) out.rise[lv] = t;
        if (prev >= lv && el < lv && out.set[lv] == null) out.set[lv] = t;
      });
      prev = el;
    }
    return out;
  }

  // Extra warmth from sunshine on a person, °F. Close to +14 °F with a high clear sun, a few
  // degrees with a low winter sun, nothing under thick overcast or at night.
  function sunBonus(elev, cloudPct) {
    if (elev <= 0) return 0;
    var s = Math.pow(Math.sin(Math.min(elev, 90) * RAD), 0.8);
    return 14 * s * (1 - 0.85 * Math.min(1, (cloudPct || 0) / 100));
  }

  function rh(t, td) { // °F in, %
    var c = (t - 32) / 1.8, dc = (td - 32) / 1.8;
    return 100 * Math.exp(17.625 * dc / (243.04 + dc)) / Math.exp(17.625 * c / (243.04 + c));
  }

  function dewComfort(td, t) {
    if (td >= 70) return { label: 'Oppressive', tone: 'hot', note: 'Oppressive humidity (dew point ' + Math.round(td) + '°). Wear loose, moisture-wicking fabric and drink plenty of water.' };
    if (td >= 65) return { label: 'Muggy', tone: 'warm', note: 'Muggy air (dew point ' + Math.round(td) + '°). Breathable cotton or linen beats synthetics; you will feel warmer than the thermometer says.' };
    if (td >= 60) return { label: 'Sticky', tone: 'warm', note: 'Noticeably humid (dew point ' + Math.round(td) + '°).' };
    if (td >= 45) return { label: 'Comfortable', tone: 'ok', note: null };
    if (td >= 25) return { label: t >= 60 ? 'Dry, pleasant' : 'Crisp', tone: 'ok', note: null };
    return { label: 'Very dry', tone: 'cold', note: 'Very dry air (dew point ' + Math.round(td) + '°): lip balm and hand lotion help, and expect static.' };
  }

  // Clothing level from how-it-feels temperature (°F).
  var LEVELS = [
    { min: 85, title: 'Hot', wear: 'Light, loose, breathable clothes; shorts are fine', items: ['Shorts', 'Breathable top', 'Water'] },
    { min: 75, title: 'Warm', wear: 'Short sleeves', items: ['Short sleeves', 'Light pants or shorts'] },
    { min: 65, title: 'Mild', wear: 'Short sleeves, with a light layer for shade or later', items: ['T-shirt', 'Light layer'] },
    { min: 55, title: 'Cool', wear: 'Long sleeves or a light sweater', items: ['Long sleeves', 'Light sweater', 'Long pants'] },
    { min: 45, title: 'Chilly', wear: 'A light jacket or fleece and long pants', items: ['Jacket or fleece', 'Long pants', 'Closed shoes'] },
    { min: 35, title: 'Cold', wear: 'A warm jacket; a hat is a good idea', items: ['Warm jacket', 'Hat', 'Layers'] },
    { min: 25, title: 'Very cold', wear: 'Winter coat, hat and gloves', items: ['Winter coat', 'Hat', 'Gloves', 'Warm socks'] },
    { min: 10, title: 'Bitter', wear: 'Heavy winter coat over layers, hat, gloves and scarf', items: ['Heavy coat', 'Base layer', 'Hat', 'Gloves', 'Scarf'] },
    { min: -99, title: 'Dangerous cold', wear: 'Full winter gear; cover every bit of skin', items: ['Heavy coat', 'Base layers', 'Insulated boots', 'Face cover', 'Mittens'] }
  ];

  function level(f) { for (var i = 0; i < LEVELS.length; i++) if (f >= LEVELS[i].min) return LEVELS[i]; return LEVELS[LEVELS.length - 1]; }

  // hours: [{t (°F), td, at (apparent), cloud (%), gust (mph), elev (deg), uv, pop (0-1), rain (in), snow (in)}]
  // opts: {kind: 'stadium'|'wedding'|'outdoor'|..., next: summary of the following block or null}
  function advise(hours, opts) {
    opts = opts || {};
    if (!hours.length) return null;
    var feel = hours.map(function (h) {
      var f = (h.at != null ? h.at : h.t) + sunBonus(h.elev, h.cloud);
      var r = rh(h.t, h.td);
      if (h.t < 50 && r > 85 && (h.cloud > 70 || h.pop > 0.4)) f -= 3;   // raw, damp chill
      return f;
    });
    var avg = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
    var max = function (a) { return Math.max.apply(null, a); }, min = function (a) { return Math.min.apply(null, a); };
    var fLo = min(feel), fHi = max(feel), fAvg = avg(feel);
    var td = avg(hours.map(function (h) { return h.td; })), t = avg(hours.map(function (h) { return h.t; }));
    var pop = max(hours.map(function (h) { return h.pop || 0; }));
    var rain = hours.reduce(function (s, h) { return s + (h.rain || 0); }, 0);
    var snow = hours.reduce(function (s, h) { return s + (h.snow || 0); }, 0);
    var gust = max(hours.map(function (h) { return h.gust || 0; }));
    var uv = max(hours.map(function (h) { return h.uv || 0; }));
    var sunUp = hours.filter(function (h) { return h.elev > 0; });
    var clearSun = sunUp.filter(function (h) { return h.cloud < 50; });
    var lowSun = clearSun.filter(function (h) { return h.elev < 20; });

    var lv = level(fAvg - 0.25 * (fHi - fLo)); // dress a little toward the cold end
    var items = lv.items.slice(), notes = [];
    var dew = dewComfort(td, t);
    if (dew.note) notes.push(dew.note);

    if (snow >= 0.1) { items.push('Waterproof boots'); notes.push('Snow is possible (' + snow.toFixed(1) + ' in in the wetter models): waterproof boots and gloves.'); }
    if (pop >= 0.6 || rain >= 0.15) {
      items.push('Rain jacket');
      notes.push(opts.kind === 'stadium' ? 'Rain is likely: bring a hooded rain jacket or poncho, since most stadiums do not allow umbrellas in the stands.' : 'Rain is likely: waterproof jacket and shoes, or an umbrella if wind allows.');
    } else if (pop >= 0.3) {
      items.push('Rain layer');
      notes.push('Some chance of rain (' + Math.round(pop * 100) + '%): pack a packable rain layer' + (opts.kind === 'stadium' ? ' or poncho.' : ' or umbrella.'));
    }
    if (gust >= 30) { items.push('Windproof shell'); notes.push('Gusts to about ' + Math.round(gust) + ' mph: a windproof outer layer; umbrellas and hats will struggle.'); }
    else if (gust >= 20 && fAvg < 55) notes.push('A breeze (gusts near ' + Math.round(gust) + ' mph) makes it feel colder; a wind-resistant layer helps.');

    if (uv >= 6) { items.push('Sunscreen', 'Brimmed hat'); notes.push('Strong sun (UV ' + Math.round(uv) + '): sunscreen and a brimmed hat.'); }
    else if (uv >= 3 && sunUp.length >= 2) { items.push('Sunscreen'); notes.push('Moderate sun (UV ' + Math.round(uv) + '): sunscreen for long stretches outside.'); }
    if (lowSun.length) { items.push('Sunglasses'); notes.push('Low sun angle (under 20° high) means glare: sunglasses help, especially facing south or west.'); }
    if (clearSun.length && fAvg < 55) notes.push('Sunshine makes it feel about ' + Math.round(avg(clearSun.map(function (h) { return sunBonus(h.elev, h.cloud); }))) + '° warmer in direct sun than in the shade.');

    if (opts.kind === 'stadium' && fAvg < 45) { items.push('Seat cushion or blanket'); notes.push('Stadium seats pull heat away for hours: a cushion or blanket and warm socks make a big difference.'); }
    if (opts.next && opts.next.fAvg < fAvg - 8) notes.push('It turns colder afterward (feels like ' + Math.round(opts.next.fLo) + '° later): bring the next layer up.');

    var seen = {};
    items = items.filter(function (x) { if (seen[x]) return false; seen[x] = 1; return true; });
    return { title: lv.title, wear: lv.wear, items: items, notes: notes, comfort: dew, fLo: fLo, fHi: fHi, fAvg: fAvg, pop: pop, rain: rain, snow: snow, gust: gust, uv: uv };
  }

  root.Wear = { sunElevation: sunElevation, sunDay: sunDay, sunBonus: sunBonus, advise: advise, dewComfort: dewComfort, rh: rh };
})(typeof window !== 'undefined' ? window : globalThis);
