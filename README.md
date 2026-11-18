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
| `event/` | The event forecast briefing (wxmap.pro/event/). Pick a place and hours, or open a saved event (`?e=<slug>`, from `event/events/<slug>.json`, which can carry a written briefing and key times). `event.js` pulls every model and ensemble for the point from Open-Meteo in the browser (GFS, ECMWF IFS and AIFS, NBM and HRRR in the US, GEM, ICON; GEFS, ENS and AIFS ENS) and draws the glance card, an automatic neutral summary (the same wording rules for every event; a saved event's hand-written note is shown folded under it as "Forecaster discussion"), hazard checks and active NWS alerts, the day-part timeline, charts, model table, ensemble chances, sun times and ERA5 normals. Chances of rain are ensemble members wet or dry over the whole window, with GEFS, ENS and AIFS ENS weighted equally. `wear.js` turns how it feels in the shade (apparent temperature, damp chill, dew point, wind, rain, UV) into what to wear, with direct sun as a note. `synoptic.js` draws the rain and snow map: a blend (`event/data/<slug>/synoptic.json`: probability-matched mean of 6 h precipitation over the NOAA, ECMWF and ECMWF AI families weighted equally, faded by the chance of 0.01 in) with tabs for each deterministic model (`synoptic-<model>.json`). `tools/event_build.py` writes them (range pulls from the AWS mirrors through the shared `nwp` package, about 100 MB per map time; on the VPS, vps-config `bin/event-job.sh` after each GFS cycle into `/srv/event/data`, not in this repository). |
| `map/` | The map. `map.js` copies the published marine wind page in and runs its scripts unchanged; `cyclones.js` adds the cyclone phase space layer; `cube.js` runs the cyclone page's 3-D phase space cube (`space3d.js` from jkrek17.github.io/cyclone, unchanged) on the low's card; `map.css` puts the house style on the globe kit. |

## House style

- Light by default, with a dark theme, both from the same tokens.
- The light theme is a "survey chart": a faint charted-water blue page (`--bg`) with white cards, and one buff land band (`--land`) for a secondary section per page, taken from NOAA nautical charts.
- The mark is two offset closed isobars around a blue centre, packed tighter on one side like a deepening low (`assets/favicon.svg`, and inline on each page's brand).
- IBM Plex Sans Condensed for headings, IBM Plex Sans for text, IBM Plex Mono for numbers and labels.
- Colour is kept for the wind scale: under 34 kt, gale 34–47, storm 48–63, hurricane force 64+.
  One hazard scale for every page, in `tokens.css`: `--wind-*` are the map's fills (the same as the marine wind page), `--line-*` the warning lines, and `--calm`/`--gale`/`--storm`/`--hurricane`/`--extreme` the same hues as ink for the page. Anything that is not a wind class (lab rarity rings) uses a neutral scale, never these hues; bomb watch levels are tints of the hurricane-force colour.
  Forecast colours on the map are the same in both themes; only the panels change.
- Units as forecasters write them: kt, mb, °N.

## How the map is put together

Nothing from the two forecast pages is copied here. The map reads, from this site:

- `../marine-wind/` (index.html, app.js, scorecard.js, style.css and data): the published
  marine wind page, built by jkrek17/awips-tools `marine_wind/`. The
  `<meta name="marine-wind-base">` tag tells its scripts where their data is, and they
  announce `mw:ready`, `mw:step` and `mw:overlay` so the cyclone layer can follow the map.
- `../globe-kit/`: the shared MapLibre globe, from awips-tools `globe_kit/`.

Both are published to jkrek17/web by awips-tools. A change to the marine wind page
shows up here on its next publish. From the cyclone page's own site,
https://jkrek17.github.io/cyclone/ (jkrek17/cyclone; the `<meta name="cyclone-base">` tag):

- `glyphs.js` and `space3d.js`: the cyclone page's low markers (marker B: color the lower
  core, shape the symmetry, fill the depth) and its cube, which read a few of that page's
  globals; `cube.js` declares them.
- `data/latest/` (index.json, legend.json): the live cyclone phase space run, built by
  jkrek17/cyclone `cyclone_phase_space/realtime/`.

A change to the cyclone page's markers or cube shows up here as soon as it publishes.

## Serving

The VPS (jkrek17/vps-config) serves wxmap.pro from two checkouts: this repository for
`/`, `/assets/`, `/map/` and `/lab/`, the lab job's output folder for `/lab/data/`, and jkrek17/web
for everything else. The other pages in
jkrek17/web stay reachable at their paths but are not linked from here.

Preview locally: put this repository's files beside `globe-kit/` and `marine-wind/`
from a jkrek17/web checkout and run `python3 -m http.server 8000`. For the lab, run
`tools/lab_run.py lows --out lab/data` and `... bomb --out lab/data` from a marine-research checkout first. For an event's map, `pip install` the `nwp` package pinned in marine-research's requirements.txt and run `python3 tools/event_build.py --out event/data`.
