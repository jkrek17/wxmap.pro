/* wxmap.pro map: the cyclone page's 3-D phase space cube on the map's card.

   The cube is the cyclone page's own code (awips-tools
   cyclone_phase_space/article/live/space3d.js, published at ../cyclone/space3d.js
   and loaded just before this file), run unchanged. It reads a few globals of the
   cyclone page (its state S and ST, the axis limits FIG1, the class names, the
   term symbols and some number helpers); this file declares them for the map, so
   they must stay top-level declarations. cyclones.js drives it through
   window.wxmapCube: open() for the selected low, at() when the map's valid time
   changes, close() when the card shuts. */
'use strict';

const FIG1 = { vtl: [-300, 300], vtu: [-300, 300], b: [-20, 80], onset: 10 };
const SHORT = ['sym deep warm', 'sym shallow warm', 'asym deep warm', 'asym shallow warm', 'asym cold', 'sym cold', 'shallow cold'];
const MINUS = '−';
const TERM = {
  hb: { name: 'Thermal asymmetry', sym: 'B', band: '900 to 600 hPa' },
  hvtl: { name: 'Lower thermal wind', sym: `${MINUS}V<sub>T</sub><sup>L</sup>`, band: '900 to 600 hPa' },
  hvtu: { name: 'Upper thermal wind', sym: `${MINUS}V<sub>T</sub><sup>U</sup>`, band: '600 to 300 hPa' },
};
// S.i is the frame on screen in S.index.hours (forecast hours of the cyclone run);
// -1 when the map shows an hour the run has no frame for.
const S = { i: -1, index: { hours: [] } };
const ST = { built: true };
const CUBE = { classes: null, view: null, key: null, t0: 0, toValid: null, stop: null };

const blank = (v) => v == null || v === '' || Number.isNaN(+v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const pad = (n, w = 2) => (n < 0 ? MINUS : '') + String(Math.abs(n)).padStart(n < 0 ? w - 1 : w, '0');
const cls = (code) => (CUBE.classes && CUBE.classes(code)) || { code, name: 'No class', hex: '#8a8a86' };
// B and the class from the storm's own motion (hbt, clst) where the track has
// them, else the field's (hb, cls): the cyclone page's storms.js and card.js.
const trackB = (e) => !!e && !blank(e.hbt);
const bOf = (e) => (trackB(e) ? e.hbt : e?.hb);
const clsOf = (e) => (e && e.clst != null && !blank(e.clst) ? +e.clst : e?.cls);
const clsDot = (e) => `<i style="--c:${cls(clsOf(e)).hex}"></i>`;
function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function fmt(v, d = 0, u = '', signed = false) {
  if (blank(v)) return 'blank';
  const x = +(+v).toFixed(d);
  const s = Math.abs(x).toFixed(d);
  const sign = x < 0 ? MINUS : signed && x > 0 ? '+' : '';
  return `${sign}${s}${u ? ` ${u}` : ''}`;
}
// A click on a dot of the track moves the map to that hour.
function show(k) { if (CUBE.toValid) CUBE.toValid(CUBE.t0 + S.index.hours[k] * 3600e3); }
function play(on) { if (!on && CUBE.stop) CUBE.stop(); }

window.wxmapCube = {
  // cycle: the cyclone run's start (ms); hours: its forecast hours;
  // classes(code) -> {code, name, hex}; toValid(ms) shows that hour on the map; stop() pauses play.
  setup(o) {
    CUBE.t0 = o.cycle; S.index.hours = o.hours.slice();
    CUBE.classes = o.classes; CUBE.toValid = o.toValid; CUBE.stop = o.stop;
  },
  at(t) {
    const h = Math.round((t - CUBE.t0) / 3600e3);
    S.i = S.index.hours.indexOf(h);
    S.index.hours[-1] = h;   // the readout's hour when the run has no frame for it
    if (CUBE.view) CUBE.view.frame();
  },
  // storm: {key, label, pts: [{t, fcls, fb, clst, hbt, vtl, vtu}]}: fcls and fb the
  // field's class and B, clst and hbt those from the storm's motion (null if none).
  open(host, storm) {
    if (CUBE.view && CUBE.key === storm.key && CUBE.view.el.isConnected) { CUBE.view.frame(); return; }
    this.close();
    const at = S.index.hours.map(() => null);
    storm.pts.forEach((p) => {
      const k = S.index.hours.indexOf(Math.round((p.t - CUBE.t0) / 3600e3));
      if (k >= 0) at[k] = { cls: p.fcls, hb: p.fb, clst: p.clst, hbt: p.hbt, hvtl: p.vtl, hvtu: p.vtu };
    });
    // The cube is drawn light on dark, so its view always sits on a dark ground
    // (.s3d-canvas in map.css) and reads its ink from these values, not the theme's.
    const root = document.documentElement.style, ink = { '--text': '#e9e8e3', '--muted': '#a8a6a0', '--faint': '#94928c', '--s3d-bg': '#0f1829' };
    const was = Object.keys(ink).map((k) => [k, root.getPropertyValue(k)]);
    Object.keys(ink).forEach((k) => root.setProperty(k, ink[k]));
    try { CUBE.view = Space3D.create(host, { key: storm.key, label: storm.label, at }); }
    finally { was.forEach(([k, v]) => (v ? root.setProperty(k, v) : root.removeProperty(k))); }
    CUBE.key = storm.key;
  },
  close() {
    if (CUBE.view) CUBE.view.destroy();
    CUBE.view = null; CUBE.key = null;
  },
};
