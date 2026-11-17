// node tests/wear.test.js : checks the what-to-wear rules in event/wear.js
const assert = require('assert');
require('../event/wear.js');
const W = globalThis.Wear;
// Same 70 °F on the thermometer, very different days (Jason's example).
const aug = W.advise([{ t: 70, td: 70, at: 76, cloud: 5, gust: 5, elev: 60, uv: 8, pop: 0 }]);
const dec = W.advise([{ t: 70, td: 10, at: 66, cloud: 95, gust: 5, elev: 22, uv: 1, pop: 0 }]);
assert(aug.fAvg > dec.fAvg + 15, 'sunny muggy August 70 should feel much warmer');
assert.strictEqual(aug.comfort.label, 'Oppressive');
assert.strictEqual(dec.comfort.label, 'Very dry');
assert(aug.items.includes('Sunscreen') && !dec.items.includes('Sunscreen'));
// rain at a stadium asks for a poncho, not an umbrella
const wet = W.advise([{ t: 50, td: 48, at: 46, cloud: 100, gust: 10, elev: 10, uv: 0, pop: 0.8, rain: 0.3 }], { kind: 'stadium' });
assert(wet.notes.some(n => /poncho/.test(n)));
// sun elevation: Philadelphia, 21 Nov 2026 solar noon ~ 16:46 UTC, about 30 degrees
const el = W.sunElevation(new Date(Date.UTC(2026, 10, 21, 16, 46)), 39.9, -75.17);
assert(Math.abs(el - 30) < 1, 'noon elevation ' + el);
console.log('wear rules: ok');
