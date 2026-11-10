import { settleTrailPoint } from './tracking.mjs';

function pointKey(point) {
  if (!point || !Number.isFinite(point.at) || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return '';
  return `${Math.round(point.at / 1000)}:${Number(point.lat).toFixed(4)}:${Number(point.lng).toFixed(4)}`;
}

function sampleOf(point) {
  const stay = point.stayEnd === true;
  const speed = stay
    ? 0
    : (typeof point.speedMps === 'number' && Number.isFinite(point.speedMps) ? point.speedMps : null);
  return {
    lat: point.lat,
    lng: point.lng,
    at: point.at,
    accuracyM: Number.isFinite(point.accuracyM) ? point.accuracyM : 0,
    speedMps: speed,
    staying: stay || (speed != null && speed < 0.7),
  };
}

function settleSamples(seed, samples) {
  let points = seed;
  for (const point of samples) points = settleTrailPoint(points, point, point.at).points;
  return points;
}

/** Copies of the vertices already drawn at or before this sample. The stored line is not passed through. */
function prefixTail(points, at) {
  const anchors = [];
  for (const point of points) {
    if (!point || point.stayEnd || !Number.isFinite(point.at) || point.at > at) continue;
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    anchors.push(point);
  }
  return anchors.slice(-4).map((point) => ({ ...point }));
}

/**
 * Decide one journal sample against the line that already exists at that time.
 * A keep is inserted. A snap may extend the final stay marker. Nothing already stored is removed.
 */
function acceptSample(points, sample) {
  const decided = settleTrailPoint(prefixTail(points, sample.at), sample, sample.at);
  if (decided.decision === 'keep') {
    const index = points.findIndex((item) => item && Number.isFinite(item.at) && item.at > sample.at);
    const next = points.slice();
    next.splice(index < 0 ? next.length : index, 0, sample);
    return next;
  }
  const lastAt = points.reduce((max, point) => (point && Number.isFinite(point.at) ? Math.max(max, point.at) : max), -Infinity);
  if (decided.decision !== 'snap' || !(sample.at > lastAt)) return points;
  const marker = [...decided.points].reverse().find((point) => point && point.stayEnd);
  if (!marker) return points;
  const last = points[points.length - 1];
  if (last?.stayEnd) {
    if (Math.abs(last.at - marker.at) <= 1 && Math.abs(last.lat - marker.lat) < 1e-6) return points;
    const next = points.slice();
    next[next.length - 1] = { ...last, at: marker.at, accuracyM: marker.accuracyM ?? last.accuracyM };
    return next;
  }
  return points.concat(marker);
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
 * Each new point is judged against the vertices already drawn before it.
 * A point the settlement would keep is inserted at its time. A later still
 * sample may extend the last stay marker. Stored vertices are not replayed
 * and are not removed, so a 20s still probe cannot erase the outing line.
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
  if (existing.length === 0) return settleSamples([], fresh);
  let points = existing;
  for (const point of fresh) points = acceptSample(points, point);
  return points;
}
