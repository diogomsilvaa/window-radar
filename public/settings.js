const STORAGE_KEY = 'radarConfig';

const DEFAULT_POLY = [
  [38.7680545101772, -9.150207811334049],
  [38.74701197030756, -9.159055646121123],
  [38.74548995600661, -9.145315584687449],
  [38.76499413138829, -9.141094000594784],
];
const DEFAULT_CENTER = { lat: 38.7563, lon: -9.15 };

const elSummary = document.getElementById('summary');
const elSaved = document.getElementById('saved');

let points = [];
const markers = [];
let polygon = null;
let centerMarker = null;
let radiusCircle = null;

// Load the saved polygon from localStorage, or fall back to the defaults.
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (Array.isArray(c.poly) && c.poly.length >= 3) return c.poly;
    }
  } catch {}
  return DEFAULT_POLY;
}

const start = loadSaved();
const map = L.map('map').setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lon], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

// Geometry helpers: arithmetic centroid and great-circle distance in meters.
function centroid(pts) {
  const lat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return { lat, lon };
}

// Great-circle distance in metres between two lat/lon points (haversine formula).
function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Center + search radius (NM) covering every corner, with a small buffer.
function deriveConfig() {
  const center = centroid(points);
  let maxM = 0;
  for (const p of points) {
    maxM = Math.max(maxM, haversineM(center.lat, center.lon, p[0], p[1]));
  }
  // Convert metres to nautical miles (1 NM = 1852 m), add a 0.1 NM buffer so
  // corners aren't exactly on the edge, and never go below a 1 NM minimum.
  const radiusNm = Math.max(1, maxM / 1852 + 0.1);
  return { center, radiusNm };
}

// Convex hull (monotone chain) so the polygon renders without self-crossings.
function orderedPoints() {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  // 2D cross product of OA x OB; <= 0 means a non-left turn, so the middle point is dropped.
  const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  // Drop each chain's last point (it's the other chain's first point) to avoid duplicates.
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Rebuild polygon, center marker, radius circle, and summary from `points`.
function redraw() {
  if (polygon) map.removeLayer(polygon);
  if (centerMarker) map.removeLayer(centerMarker);
  if (radiusCircle) map.removeLayer(radiusCircle);
  polygon = centerMarker = radiusCircle = null;

  if (points.length >= 2) {
    polygon = L.polygon(orderedPoints(), { color: '#28ff8f', weight: 2 }).addTo(map);
  }
  if (points.length >= 3) {
    const { center, radiusNm } = deriveConfig();
    radiusCircle = L.circle([center.lat, center.lon], {
      radius: radiusNm * 1852, // nautical miles -> metres (1 NM = 1852 m) for the Leaflet circle.
      color: '#1f8f55',
      weight: 1,
      dashArray: '4 6',
      fill: false,
    }).addTo(map);
    centerMarker = L.circleMarker([center.lat, center.lon], {
      radius: 4,
      color: '#28ff8f',
      fillColor: '#28ff8f',
      fillOpacity: 1,
    }).addTo(map);
    elSummary.textContent =
      `${points.length} corners · center ${center.lat.toFixed(5)}, ` +
      `${center.lon.toFixed(5)} · radius ${radiusNm.toFixed(1)} NM`;
  } else {
    elSummary.textContent = `${points.length} corner(s) — need at least 3.`;
  }
}

function addPoint(latlng, { prune = false, silent = false } = {}) {
  points.push([latlng.lat, latlng.lng]);
  const m = L.marker(latlng, { draggable: true }).addTo(map);
  m.on('drag', (e) => {
    const i = markers.indexOf(e.target);
    if (i < 0) return;
    const ll = e.target.getLatLng();
    points[i] = [ll.lat, ll.lng];
    redraw();
  });
  markers.push(m);
  if (prune) pruneInterior();
  if (!silent) redraw();
}

// Drop any point that ended up inside the hull after the latest addition.
function pruneInterior() {
  if (points.length < 4) return;
  const hull = new Set(orderedPoints());
  for (let i = points.length - 1; i >= 0; i--) {
    if (!hull.has(points[i])) {
      map.removeLayer(markers[i]);
      markers.splice(i, 1);
      points.splice(i, 1);
    }
  }
}

map.on('click', (e) => {
  elSaved.textContent = '';
  addPoint(e.latlng, { prune: true });
});

// Clear all markers/points and seed the map with the given corners.
function reset(pts) {
  markers.forEach((m) => map.removeLayer(m));
  markers.length = 0;
  points = [];
  pts.forEach((p) => addPoint({ lat: p[0], lng: p[1] }, { silent: true }));
  redraw();
}

document.getElementById('undo').onclick = () => {
  if (!markers.length) return;
  map.removeLayer(markers.pop());
  points.pop();
  redraw();
};

document.getElementById('clear').onclick = () => reset([]);

document.getElementById('save').onclick = () => {
  if (points.length < 3) {
    elSaved.textContent = 'Need at least 3 corners to save.';
    return;
  }
  const { center, radiusNm } = deriveConfig();
  const cfg = { poly: orderedPoints(), center, radiusNm };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  elSaved.textContent = 'Saved. Open the radar to use the new area.';
};

reset(start);
map.fitBounds(L.polygon(start).getBounds(), { padding: [40, 40] });
