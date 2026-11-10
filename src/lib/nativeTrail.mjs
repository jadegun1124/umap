import { settleTrailPoint } from './tracking.mjs';

function pointKey(point) {
  if (!point || !Number.isFinite(point.at) || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return '';
  return `${Math.round(point.at / 1000)}:${Number(point.lat).toFixed(4)}:${Number(point.lng).toFixed(4)}`;
}

function sampleOf(point) {
  const speed = typeof point.speedMps === 'number' && Number.isFinite(point.speedMps) ? point.speedMps : null;
  return {
    lat: point.lat,
    lng: point.lng,
    at: point.at,
    accuracyM: Number.isFinite(point.accuracyM) ? point.accuracyM : 0,
    speedMps: speed,
    staying: speed != null && speed < 0.7,
  };
}

/**
 * Fold saved native points into the live trail.
 * The whole line is settled again in time order, so an older background point
 * does not get appended after a newer live point.
 */
export function mergeNativeFixes(track, incoming) {
  const existing = Array.isArray(track) ? track : [];
  const rows = [];
  const seen = new Set();
  const take = (point) => {
    if (!point || point.stayEnd) return;
    const key = pointKey(point);
    if (!key || seen.has(key)) return;
    seen.add(key);
    rows.push(point);
  };
  for (const point of existing) take(point);
  const before = rows.length;
  for (const point of Array.isArray(incoming) ? incoming : []) take(point);
  if (rows.length === before) return existing;
  rows.sort((left, right) => left.at - right.at);
  let points = [];
  for (const point of rows) {
    points = settleTrailPoint(points, sampleOf(point), point.at).points;
  }
  return points;
}
