// node tests/wear.test.js : checks the what-to-wear rules in event/wear.js
const assert = require('assert');
require('../event/wear.js');
const W = globalThis.Wear;
// Same 70 °F on the thermometer, very different days (Jason's example).
const aug = W.advise([{ t: 70, td: 70, at: 76, cloud: 5, gust: 5, elev: 60, uv: 8, pop: 0 }]);
const dec = W.advise([{ t: 70, td: 10, at: 66, cloud: 95, gust: 5, elev: 22, uv: 1, pop: 0 }]);
assert(aug.fSun > dec.fSun + 15, 'sunny muggy August 70 should feel much warmer in the sun');
assert.notStrictEqual(aug.title, dec.title, 'and call for different clothes');
// the clothing level comes from the shade: strong sun is a note, not a lighter level
const shade = W.advise([{ t: 50, td: 30, at: 48, cloud: 0, gust: 5, elev: 30, uv: 3, pop: 0 }]);
assert.strictEqual(shade.title, 'Chilly');
assert(shade.notes.some(n => /direct sun/.test(n)));
assert.strictEqual(aug.comfort.label, 'Oppressive');
assert.strictEqual(dec.comfort.label, 'Very dry');
assert(aug.items.includes('Sunscreen') && !dec.items.includes('Sunscreen'));
// rain at a stadium asks for a poncho, not an umbrella
const wet = W.advise([{ t: 50, td: 48, at: 46, cloud: 100, gust: 10, elev: 10, uv: 0, pop: 0.8, rain: 0.3 }], { kind: 'stadium' });
assert(wet.notes.some(n => /poncho/.test(n)));
assert(wet.notes.some(n => /check the venue policy/.test(n)));
// the window chance passed in wins over hourly values
assert(W.advise([{ t: 60, td: 40, at: 60, cloud: 50, gust: 5, elev: 20, pop: 0.1 }], { pop: 0.7 }).notes.some(n => /Rain likely/.test(n)));
// azimuth: Philadelphia morning sun is in the southeast
const az = W.sunAzimuth(new Date(Date.UTC(2026, 10, 21, 14, 0)), 39.9, -75.17);
assert(az > 120 && az < 160, 'morning azimuth ' + az);
// sun elevation: Philadelphia, 21 Nov 2026 solar noon ~ 16:46 UTC, about 30 degrees
const el = W.sunElevation(new Date(Date.UTC(2026, 10, 21, 16, 46)), 39.9, -75.17);
assert(Math.abs(el - 30) < 1, 'noon elevation ' + el);
console.log('wear rules: ok');
