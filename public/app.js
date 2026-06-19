const REFRESH_MS = 5000;
const elStage = document.getElementById('stage');
const elStatus = document.getElementById('status');

const DEFAULT_POLY = [
  [38.7680545101772, -9.150207811334049],
  [38.74701197030756, -9.159055646121123],
  [38.74548995600661, -9.145315584687449],
  [38.76499413138829, -9.141094000594784],
];
const DEFAULT_CENTER = { lat: 38.7563, lon: -9.1500 };
const DEFAULT_RADIUS_NM = 3;

function loadConfig() {
  try {
    const raw = localStorage.getItem('radarConfig');
    if (raw) {
      const c = JSON.parse(raw);
      if (Array.isArray(c.poly) && c.poly.length >= 3 && c.center) {
        return {
          poly: c.poly,
          center: c.center,
          radiusNm: c.radiusNm || DEFAULT_RADIUS_NM,
        };
      }
    }
  } catch {}
  return { poly: DEFAULT_POLY, center: DEFAULT_CENTER, radiusNm: DEFAULT_RADIUS_NM };
}

const CFG = loadConfig();
const POLY = CFG.poly;
const CENTER = CFG.center;
const RADIUS_NM = CFG.radiusNm;
const ALT_CEILING_M = 3000;
const FT_PER_M = 3.28084;

const ADSB_POINT = `https://api.airplanes.live/v2/point/${CENTER.lat}/${CENTER.lon}/${RADIUS_NM}`;
const ADSBDB = 'https://api.adsbdb.com/v0/callsign';
const ROUTE_TTL = 60 * 60 * 1000;
const routeCache = new Map();

function inPoly(lat, lon, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const hit = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function place(ap) {
  if (!ap) return 'Unknown';
  const city = ap.municipality;
  const code = ap.iata_code || ap.icao_code;
  if (city && code) return `${city} (${code})`;
  return city || code || 'Unknown';
}

async function getRoute(callsign) {
  const cs = (callsign || '').trim();
  if (!cs) return null;
  const c = routeCache.get(cs);
  if (c && Date.now() - c.ts < ROUTE_TTL) return c.data;
  let route = null;
  try {
    const res = await fetch(`${ADSBDB}/${encodeURIComponent(cs)}`);
    if (res.ok) {
      const fr = (await res.json())?.response?.flightroute;
      if (fr) {
        route = {
          origin: place(fr.origin),
          destination: place(fr.destination),
          airline: fr.airline && fr.airline.name,
        };
      }
    }
  } catch {
    route = null;
  }
  routeCache.set(cs, { data: route, ts: Date.now() });
  return route;
}

function carrierFromCallsign(cs) {
  const m = (cs || '').trim().match(/^[A-Z]{3}/);
  const map = window.AIRLINES || {};
  return m && map[m[0]] ? map[m[0]] : null;
}

function altFeet(a) {
  if (a == null || a === 'ground') return null;
  const n = typeof a === 'number' ? a : parseFloat(a);
  return Number.isFinite(n) ? n : null;
}

async function getVisible() {
  const res = await fetch(ADSB_POINT);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const aircraft = data.ac || [];
  const planes = [];
  for (const a of aircraft) {
    if (a.lat == null || a.lon == null) continue;
    const ftBaro = altFeet(a.alt_baro);
    const ftGeom = altFeet(a.alt_geom);
    const ft = ftGeom != null ? ftGeom : ftBaro;
    if (ft == null) continue;
    const altM = ft / FT_PER_M;
    if (altM > ALT_CEILING_M) continue;
    if (!inPoly(a.lat, a.lon, POLY)) continue;
    planes.push({
      icao24: a.hex,
      callsign: (a.flight || '').trim(),
      lat: a.lat,
      lon: a.lon,
      altitudeM: Math.round(altM),
      heading: a.true_heading != null ? a.true_heading : a.track,
      speedKt: typeof a.gs === 'number' ? a.gs : (a.gs != null ? parseFloat(a.gs) : null),
      vertRateFpm: a.geom_rate != null ? a.geom_rate : (a.baro_rate != null ? a.baro_rate : null),
      model: a.desc || a.t || 'Unknown',
      operator: a.ownOp || null,
    });
  }
  await Promise.all(
    planes.map(async (p) => {
      const route = await getRoute(p.callsign);
      p.carrier =
        (route && route.airline) || carrierFromCallsign(p.callsign) || p.operator || 'Unknown';
      p.origin = (route && route.origin) || 'Unknown';
      p.destination = (route && route.destination) || 'Unknown';
    })
  );
  planes.sort((a, b) => a.altitudeM - b.altitudeM);
  return planes;
}

function fmtAlt(m) {
  return m == null ? '\u2014' : m.toLocaleString('en-US') + ' m';
}

function fmtSpeed(kt) {
  if (kt == null || !Number.isFinite(kt)) return '\u2014';
  const kmh = Math.round(kt * 1.852);
  return kmh.toLocaleString('en-US') + ' km/h';
}

function vertTrend(fpm) {
  if (fpm == null || !Number.isFinite(fpm)) return '';
  if (fpm > 100) return ' \u25B2';
  if (fpm < -100) return ' \u25BC';
  return '';
}

function val(v) {
  return v && v !== 'Unknown' ? v : 'Unknown';
}

function splitPlace(s) {
  const m = (s || '').match(/^(.*) \(([^)]+)\)$/);
  if (m) return { city: m[1], code: m[2] };
  return { city: val(s), code: '' };
}

function endpoint(s) {
  const p = splitPlace(s);
  return (
    '<div class="ep"><div class="city">' + p.city + '</div>' +
    (p.code ? '<div class="code">' + p.code + '</div>' : '') +
    '</div>'
  );
}

function planeView(p, extra) {
  return (
    '<section class="plane">' +
    '<div class="carrier">' + val(p.carrier) + '</div>' +
    '<div class="callsign">' + (p.callsign || '\u2014') + '</div>' +
    '<div class="route">' +
      endpoint(p.origin) +
      '<div class="arrow">\u2192</div>' +
      endpoint(p.destination) +
    '</div>' +
    '<div class="stats">' +
      '<div class="stat"><div class="label">MODEL</div><div class="val">' + val(p.model) + '</div></div>' +
      '<div class="stat"><div class="label">ALTITUDE</div><div class="val alt">' + fmtAlt(p.altitudeM) + vertTrend(p.vertRateFpm) + '</div></div>' +
      '<div class="stat"><div class="label">SPEED</div><div class="val">' + fmtSpeed(p.speedKt) + '</div></div>' +
    '</div>' +
    (extra ? '<div class="more">' + extra + '</div>' : '') +
    '</section>'
  );
}

function emptyView() {
  return (
    '<section class="empty"><div class="scope"><span class="sweep"></span></div>' +
    '<p>NO AIRCRAFT IN VIEW</p></section>'
  );
}

let emptyShown = false;

function render(planes) {
  if (!planes.length) {
    if (!emptyShown) {
      elStage.innerHTML = emptyView();
      emptyShown = true;
    }
    return;
  }
  emptyShown = false;
  let extra = '';
  if (planes.length > 1) {
    extra =
      'ALSO IN VIEW: ' +
      planes
        .slice(1)
        .map((p) => (p.callsign || '?') + ' \u00b7 ' + fmtAlt(p.altitudeM))
        .join('   \u2022   ');
  }
  elStage.innerHTML = planeView(planes[0], extra);
}

async function tick() {
  try {
    const planes = await getVisible();
    render(planes);
    elStatus.textContent = 'updated ' + new Date().toLocaleTimeString();
    elStatus.classList.remove('err');
  } catch (e) {
    elStatus.textContent = 'api error';
    elStatus.classList.add('err');
  }
}

tick();
setInterval(tick, REFRESH_MS);
