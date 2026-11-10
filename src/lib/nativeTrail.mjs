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

function coveredByJourney(journeys, at) {
  for (const journey of Array.isArray(journeys) ? journeys : []) {
    if (!journey || !Number.isFinite(journey.startedAt) || !Number.isFinite(journey.endedAt)) continue;
    if (at >= journey.startedAt && at <= journey.endedAt) return true;
  }
  return false;
}

/**
 * Fold saved native points into the live trail.
 * Points already inside a saved journey stay there. New points are inserted by
 * time, and the existing vertices, including stay markers, are left as they are.
 * An empty live line is settled from the journal so a restart can still draw it.
 */
export function mergeNativeFixes(track, incoming, journeys) {
  const existing = Array.isArray(track) ? track : [];
  const seen = new Set();
  for (const point of existing) {
    const key = pointKey(point);
    if (key) seen.add(key);
  }
  const fresh = [];
  for (const point of Array.isArray(incoming) ? incoming : []) {
    if (!point || point.stayEnd || !Number.isFinite(point.at)) continue;
    if (coveredByJourney(journeys, point.at)) continue;
    const key = pointKey(point);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(sampleOf(point));
  }
  if (fresh.length === 0) return existing;
  fresh.sort((left, right) => left.at - right.at);
  if (existing.length === 0) {
    let points = [];
    for (const point of fresh) points = settleTrailPoint(points, point, point.at).points;
    return points;
  }
  const merged = existing.slice();
  for (const point of fresh) {
    const index = merged.findIndex((item) => item && Number.isFinite(item.at) && item.at > point.at);
    merged.splice(index < 0 ? merged.length : index, 0, point);
  }
  return merged;
}
