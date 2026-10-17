# wxmap.pro

The public site at https://wxmap.pro: the landing page, the house style, and the
combined map (marine wind with live cyclone phase space).

| Path | What it is |
|---|---|
| `index.html` | Landing page |
| `assets/house.css` | House style: colour tokens for light and dark, type, wind scale, site bar, buttons, theme switch, footer. Token names match `globe_kit/globe-kit.css` in jkrek17/awips-tools. |
| `assets/theme.js` | Theme switch: follows the system unless the visitor picks light or dark |
| `assets/home.css`, `assets/hero.js` | Landing page layout and the hero illustration (an idealised low, not data) |

## House style

- Light by default with a dark theme; both from the same tokens in `house.css`.
- IBM Plex Sans Condensed for headings, IBM Plex Sans for text, IBM Plex Mono for numbers and labels.
- Colour is kept for the wind scale: under 34 kt, gale 34–47, storm 48–63, hurricane force 64+.
- Units as forecasters write them: kt, mb, °N.

## Serving

The VPS (jkrek17/vps-config) mirrors this repository at wxmap.pro. Map data and the
shared globe kit come from the published site (jkrek17/web), which awips-tools builds.

Preview locally: `python3 -m http.server 8000`.
