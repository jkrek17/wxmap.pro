# wxmap.pro

The public site at https://wxmap.pro: the landing page, the house style, and the
map, which is the marine wind forecast with live cyclone phase space on one globe.

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `assets/tokens.css` | House style tokens: colours for light and dark, type, the wind scale. Every page loads it. Token names match `globe_kit/globe-kit.css` in jkrek17/awips-tools. |
| `assets/house.css` | Base and shared components for content pages (site bar, buttons, wind scale chips, footer) |
| `assets/theme.css`, `assets/theme.js` | Theme switch: follows the system unless the visitor picks light or dark |
| `assets/home.css`, `assets/hero.js` | Landing page layout and the hero illustration (an idealised low, not data) |
| `lab/` | The lab (experimental, not linked from the home page): the same marine wind globe with `lab.js`, which draws each GFS low coloured by how rare it is, its Storm Twins card, and the day 5-7 bomb watch. `boot.js` loads the page as `map.js` does; `lab.css` adds to `map/map.css`. Data: `lab/data/lows.json` and `bomb.json`, written on the VPS by jkrek17/marine-research `tools/lab_run.py` (not in this repository). |
| `map/` | The map. `map.js` copies the published marine wind page in and runs its scripts unchanged; `cyclones.js` adds the cyclone phase space layer; `cube.js` runs the cyclone page's 3-D phase space cube (`../cyclone/space3d.js`, unchanged) on the low's card; `map.css` puts the house style on the globe kit. |

## House style

- Light by default, with a dark theme, both from the same tokens.
- IBM Plex Sans Condensed for headings, IBM Plex Sans for text, IBM Plex Mono for numbers and labels.
- Colour is kept for the wind scale: under 34 kt, gale 34–47, storm 48–63, hurricane force 64+.
  Forecast colours on the map are the same in both themes; only the panels change.
- Units as forecasters write them: kt, mb, °N.

## How the map is put together

Nothing from the two forecast pages is copied here. The map reads, from the same site:

- `../marine-wind/` (index.html, app.js, scorecard.js, style.css and data): the published
  marine wind page, built by jkrek17/awips-tools `marine_wind/`. The
  `<meta name="marine-wind-base">` tag tells its scripts where their data is, and they
  announce `mw:ready`, `mw:step` and `mw:overlay` so the cyclone layer can follow the map.
- `../cyclone/space3d.js`: the cyclone page's cube, which reads a few of that page's globals; `cube.js` declares them.
- `../cyclone/data/latest/` (index.json, legend.json): the live cyclone phase space run,
  built by awips-tools `cyclone_phase_space/realtime/`.
- `../globe-kit/`: the shared MapLibre globe, from awips-tools `globe_kit/`.

All three are published to jkrek17/web by awips-tools. A change to the marine wind page
shows up here on its next publish.

## Serving

The VPS (jkrek17/vps-config) serves wxmap.pro from two checkouts: this repository for
`/`, `/assets/`, `/map/` and `/lab/`, the lab job's output folder for `/lab/data/`, and jkrek17/web
for everything else. The other pages in
jkrek17/web stay reachable at their paths but are not linked from here.

Preview locally: put this repository's files beside `globe-kit/`, `marine-wind/` and
`cyclone/` from a jkrek17/web checkout and run `python3 -m http.server 8000`. For the lab, run
`tools/lab_run.py lows --out lab/data` and `... bomb --out lab/data` from a marine-research checkout first.
