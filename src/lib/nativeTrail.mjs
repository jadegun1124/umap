import { settleTrailPoint } from './tracking.mjs';

function pointKey(point) {
  if (!point || !Number.isFinite(point.at) || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return '';
  return `${Math.round(point.at / 1000)}:${Number(point.lat).toFixed(4)}:${Number(point.lng).toFixed(4)}`;
}

/** Fold saved native points into the live trail. Same second and place is one point. */
export function mergeNativeFixes(track, incoming) {
  const existing = Array.isArray(track) ? track : [];
  const seen = new Set();
  for (const point of existing) {
    const key = pointKey(point);
    if (key) seen.add(key);
  }
  const fresh = (Array.isArray(incoming) ? incoming : [])
    .filter((point) => {
      const key = pointKey(point);
      return key && !seen.has(key);
    })
    .sort((left, right) => left.at - right.at);
  if (fresh.length === 0) return existing;
  let points = existing;
  for (const point of fresh) {
    const speed = typeof point.speedMps === 'number' && Number.isFinite(point.speedMps) ? point.speedMps : null;
    const next = settleTrailPoint(points, {
      lat: point.lat,
      lng: point.lng,
      at: point.at,
      accuracyM: Number.isFinite(point.accuracyM) ? point.accuracyM : 0,
      speedMps: speed,
      staying: speed != null && speed < 0.7,
    }, point.at);
    points = next.points;
    seen.add(pointKey(point));
  }
  return points;
}
