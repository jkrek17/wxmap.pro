/* wxmap.pro lab: experimental storm products on the published marine wind page.
   As map/map.js does for the map, this copies the marine wind page's body in
   (jkrek17/awips-tools marine_wind/page, published at ../marine-wind/), changes the
   top bar to this site's, adds the lab's panel sections, then runs its scripts
   unchanged, with lab.js (the lab layers) before app.js so it hears the first
   mw:ready and mw:step. */
(function () {
  'use strict';
  var BASE = document.querySelector('meta[name="marine-wind-base"]').content;
  var KIT = '../globe-kit/';
  var SCRIPTS = [KIT + 'lib/maplibre-gl.js', KIT + 'globe-kit.js', 'lab.js', BASE + 'app.js', BASE + 'scorecard.js'];

  function fail(msg) {
    var b = document.getElementById('boot');
    if (b) b.textContent = msg;
  }
  // All at once: async = false downloads them together and still runs them in order.
  function load(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error(src)); };
      document.body.appendChild(s);
    });
  }
  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  var THEME = '<div class="theme" role="group" aria-label="Colour theme">' +
    '<button type="button" data-theme-set="system" aria-label="Use system theme" title="System"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="8" rx="1.5"/><path d="M6 14h4"/></svg></button>' +
    '<button type="button" data-theme-set="light" aria-label="Use light theme" title="Light"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg></button>' +
    '<button type="button" data-theme-set="dark" aria-label="Use dark theme" title="Dark"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/></svg></button>' +
    '</div>';

  // This site's top bar: its name and home link, and a theme switch.
  function adapt(doc) {
    var brand = doc.querySelector('.topbar .brand');
    if (brand) {
      var a = el('<a class="brand" href="../" aria-label="wxmap.pro home">' +
        '<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".35"/><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".6"/><circle cx="16" cy="16" r="4" fill="var(--accent)"/></svg>' +
        '<div class="brand-text"><h1 id="title">wxmap<span class="tld">.pro</span></h1><p>Lab · experimental</p></div></a>');
      brand.replaceWith(a);
    }
    var home = doc.getElementById('homeLink');
    if (home) home.remove();
    var actions = doc.querySelector('.topbar-actions');
    if (actions) actions.insertBefore(el(THEME), doc.getElementById('btnLayers'));
    // The lab's sections go above the in-view summary.
    var summary = doc.getElementById('summary');
    if (summary) {
      summary.parentNode.insertBefore(el(
        '<section class="panel-section" id="lab-lows-sec">' +
          '<h3>Storm rarity and twins <span class="hint">experimental</span></h3>' +
          '<label class="switch-row"><span><i class="swatch swatch-rare"></i>Lows coloured by how rare</span><input type="checkbox" class="switch" id="ov-rare" checked><kbd>R</kbd></label>' +
          '<ol class="cps-list" id="lab-list" aria-label="Lows at this hour, rarest first"></ol>' +
        '</section>'), summary);
      summary.parentNode.insertBefore(el(
        '<section class="panel-section" id="lab-bomb-sec">' +
          '<h3>Bomb watch <span class="hint">day 5-7, experimental</span></h3>' +
          '<div class="seg" role="radiogroup" aria-label="Bomb watch day" id="bomb-days">' +
            '<button type="button" role="radio" data-day="0" aria-checked="true">Off</button>' +
            '<button type="button" role="radio" data-day="5" aria-checked="false">Day 5</button>' +
            '<button type="button" role="radio" data-day="6" aria-checked="false">Day 6</button>' +
            '<button type="button" role="radio" data-day="7" aria-checked="false">Day 7</button>' +
          '</div>' +
          '<p class="lab-note" id="bomb-note">Loading the bomb watch…</p>' +
        '</section>'), summary);
    }
    var help = doc.querySelector('#helpDialog .shortcuts');
    if (help) help.insertAdjacentHTML('beforeend', '<dt><kbd>R</kbd></dt><dd>Lows coloured by how rare</dd><dt><kbd>B</kbd></dt><dd>Bomb watch: next day, then off</dd>');
  }

  fetch(BASE + 'index.html').then(function (r) {
    if (!r.ok) throw new Error('marine wind page ' + r.status);
    return r.text();
  }).then(function (html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    adapt(doc);
    var boot = document.getElementById('boot');
    Array.prototype.slice.call(doc.body.children).forEach(function (n) {
      if (n.tagName !== 'SCRIPT') document.body.insertBefore(document.importNode(n, true), boot);
    });
    boot.remove();
    window.wxmapTheme.bind();
    return Promise.all(SCRIPTS.map(load));
  }).catch(function (e) {
    fail('The lab could not load (' + e.message + '). Try again in a minute.');
  });
})();
