// icons.js: weather icons as inline SVG, by WMO weather code (as Open-Meteo gives it),
// day or night. Colours come from CSS (.wx-sun, .wx-cloud, .wx-rain, ...), so they suit both themes.
(function (root) {
  'use strict';
  var SUN = '<g class="wx-sun"><circle cx="16" cy="16" r="6"/><path d="M16 3v4M16 25v4M3 16h4M25 16h4M6.8 6.8l2.8 2.8M22.4 22.4l2.8 2.8M6.8 25.2l2.8-2.8M22.4 9.6l2.8-2.8"/></g>';
  var SUN_SMALL = '<g class="wx-sun"><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2.5M3 12h2.5M5.6 5.6l1.8 1.8M18.4 5.6l-1.8 1.8M5.6 18.4l1.8-1.8"/></g>';
  var MOON = '<g class="wx-moon"><path d="M21 19.5A9 9 0 0 1 12.5 7a9 9 0 1 0 8.5 12.5z"/></g>';
  var MOON_SMALL = '<g class="wx-moon"><path d="M16 13.5A6 6 0 0 1 10.5 5a6 6 0 1 0 5.5 8.5z"/></g>';
  var CLOUD = '<path class="wx-cloud" d="M9 25h15a5 5 0 0 0 .6-10A7.5 7.5 0 0 0 10 14.2 5.5 5.5 0 0 0 9 25z"/>';
  var CLOUD_DARK = '<path class="wx-cloud wx-dark" d="M9 22h15a5 5 0 0 0 .6-10A7.5 7.5 0 0 0 10 11.2 5.5 5.5 0 0 0 9 22z"/>';
  var RAIN = '<path class="wx-rain" d="M11 25l-1.5 4M16 25l-1.5 4M21 25l-1.5 4"/>';
  var DRIZ = '<path class="wx-rain" d="M12 25.5v1.5M17 25.5v1.5M22 25.5v1.5M14.5 28.5v1.5M19.5 28.5v1.5"/>';
  var SNOW = '<g class="wx-snow"><circle cx="11" cy="27" r="1.3"/><circle cx="16" cy="29" r="1.3"/><circle cx="21" cy="27" r="1.3"/></g>';
  var BOLT = '<path class="wx-bolt" d="M17 21l-3 5h3l-2 5 5-7h-3l2-3z"/>';
  var FOG = '<path class="wx-fog" d="M6 15h20M4 20h24M7 25h18"/>';

  function svg(inner) { return '<svg class="wx" viewBox="0 0 32 32" aria-hidden="true">' + inner + '</svg>'; }

  // code: WMO weather code; night: boolean
  function icon(code, night) {
    var body, cel = night ? MOON_SMALL : SUN_SMALL;
    if (code == null) return svg(CLOUD);
    if (code === 0) body = night ? MOON : SUN;
    else if (code <= 2) body = cel + CLOUD.replace('M9 25', 'M9 26');
    else if (code === 3) body = CLOUD;
    else if (code === 45 || code === 48) body = FOG;
    else if (code >= 51 && code <= 57) body = CLOUD_DARK + DRIZ;
    else if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) body = CLOUD_DARK + RAIN;
    else if ((code >= 71 && code <= 77) || code === 85 || code === 86) body = CLOUD_DARK + SNOW;
    else if (code >= 95) body = CLOUD_DARK + BOLT;
    else body = CLOUD;
    return svg(body);
  }

  var WORDS = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers',
    85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms, hail', 99: 'Thunderstorms, hail' };
  function words(code, night) {
    if (night && code === 0) return 'Clear';
    if (night && code === 1) return 'Mostly clear';
    return WORDS[code] || '—';
  }

  root.WxIcons = { icon: icon, words: words };
})(window);
