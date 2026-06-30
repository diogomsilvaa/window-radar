# Window Radar

A single-page web app that shows the aircraft currently flying past your
window. Pure HTML/CSS/JS — no framework, no build, no server.

## What it does

Polls live ADS-B data every few seconds, filters it to a quadrilateral matching
your window's field of view (plus an altitude ceiling), and displays the lowest
aircraft in view with its airline, callsign, route, model, altitude, and speed.

## Run locally

Open `public/index.html` directly in a browser. No server, no install.

## Configuration

The viewing area can be set visually on the **Settings** page (link in the top
bar, or open `public/settings.html`): click the map to drop the corners of the
window's field of view, drag to adjust, and save. The center and search radius
are derived automatically and stored in `localStorage` under `radarConfig`.

Other tunables live at the top of `public/app.js`. The defaults point at a
window in Lisbon — change them to match your own location:

- `DEFAULT_POLY` — fallback corners of the viewing quadrilateral
- `DEFAULT_CENTER`, `DEFAULT_RADIUS_NM` — fallback area queried from airplanes.live
- `ALT_CEILING_M` — altitude cap in meters
- `REFRESH_MS` — poll interval (default 5000 ms)

## Data sources

- [`api.airplanes.live`](https://airplanes.live/) — live ADS-B telemetry
  (position, altitude, heading, aircraft type, operator). CORS-enabled, no key.
- [`api.adsbdb.com`](https://www.adsbdb.com/) — callsign lookup for origin,
  destination, and airline name. CORS-enabled, no key.
- `airlines.json` / `public/airlines.js` — local fallback mapping of ICAO
  airline prefixes to names.

## Structure

```
airlines.json         # source list of airline ICAO prefixes
public/
  index.html          # entry point
  app.js              # fetch + filter + render
  settings.html       # map-based area picker
  settings.js         # Leaflet picker, writes radarConfig to localStorage
  airlines.js         # airlines.json bundled as window.AIRLINES
  styles.css
```
