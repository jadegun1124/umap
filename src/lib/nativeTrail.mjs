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

function metersBetween(left, right) {
  const lat = (left.lat + right.lat) / 2;
  const north = (right.lat - left.lat) * 111_320;
  const east = (right.lng - left.lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(north, east);
}

/** A journal row the live line already settled: close in time and place to a vertex. */
function alreadyOnTrail(track, point) {
  for (const item of track) {
    if (!item || !Number.isFinite(item.at) || !Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
    if (Math.abs(item.at - point.at) > 12_000) continue;
    if (metersBetween(item, point) <= 40) return true;
  }
  return false;
}

function sameTrail(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || Boolean(a.stayEnd) !== Boolean(b.stayEnd)) return false;
    if (Math.abs(a.at - b.at) > 1) return false;
    if (Math.abs(a.lat - b.lat) > 1e-6 || Math.abs(a.lng - b.lng) > 1e-6) return false;
  }
  return true;
}

function settleSamples(seed, samples) {
  let points = seed;
  for (const point of samples) points = settleTrailPoint(points, point, point.at).points;
  return points;
}

/**
 * Settle one new sample against the tail only.
 * The stored line is not collapsed, so an earlier stay marker stays put.
 */
function applyFresh(existing, sample) {
  const anchors = existing.filter((point) => point && !point.stayEnd);
  const tail = anchors.slice(-4);
  const decided = settleTrailPoint(tail, sample, sample.at);
  if (decided.decision === 'drop') return existing;
  if (decided.decision === 'snap') {
    const marker = [...decided.points].reverse().find((point) => point && point.stayEnd);
    if (!marker) return existing;
    const last = existing[existing.length - 1];
    if (last?.stayEnd) {
      if (Math.abs(last.at - marker.at) <= 1 && Math.abs(last.lat - marker.lat) < 1e-6) return existing;
      const next = existing.slice();
      next[next.length - 1] = { ...last, at: marker.at, accuracyM: marker.accuracyM ?? last.accuracyM };
      return next;
    }
    return existing.concat(marker);
  }
  const removed = new Set(tail.filter((point) => !decided.points.includes(point)));
  const added = decided.points.filter((point) => point && !point.stayEnd && !tail.includes(point));
  if (removed.size === 0 && added.length === 0) return existing;
  const next = removed.size === 0 ? existing.slice() : existing.filter((point) => !removed.has(point));
  next.push(...added);
  return next;
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
 * Points already inside a saved journey, or already settled next to a vertex,
 * stay out. New points run through the same trail settlement as a live fix,
 * so a stay hop or a GPS spike does not become a record vertex.
 * The line before the first new point, including its stay marker, is kept.
 * An empty live line is settled from the journal so a restart can still draw it.
 */
export function mergeNativeFixes(track, incoming, journeys) {
  const existing = Array.isArray(track) ? track : [];
  const seen = new Set();
  for (const point of existing) {
    const key = pointKey(point);
    if (key) seen.add(key);
  }
  const lastAt = existing.reduce((max, point) => (point && Number.isFinite(point.at) ? Math.max(max, point.at) : max), -Infinity);
  const fresh = [];
  for (const point of Array.isArray(incoming) ? incoming : []) {
    if (!point || point.stayEnd || !Number.isFinite(point.at)) continue;
    if (coveredByJourney(journeys, point.at)) continue;
    if (point.at <= lastAt && alreadyOnTrail(existing, point)) continue;
    const key = pointKey(point);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(sampleOf(point));
  }
  if (fresh.length === 0) return existing;
  fresh.sort((left, right) => left.at - right.at);
  if (existing.length === 0) return settleSamples([], fresh);
  if (fresh.every((point) => point.at > lastAt)) {
    let points = existing;
    for (const point of fresh) points = applyFresh(points, point);
    return points;
  }
  const startAt = fresh[0].at;
  const prefix = [];
  const replay = [];
  for (const point of existing) {
    if (!point || !Number.isFinite(point.at) || point.at < startAt) prefix.push(point);
    else replay.push(sampleOf(point));
  }
  const anchor = [...prefix].reverse().find((point) => point && !point.stayEnd && Number.isFinite(point.lat));
  const samples = replay.concat(fresh).sort((left, right) => left.at - right.at);
  let settled = settleSamples(anchor ? [{ ...anchor }] : [], samples);
  if (
    anchor
    && settled[0]
    && !settled[0].stayEnd
    && Math.abs(settled[0].at - anchor.at) <= 1
    && Math.abs(settled[0].lat - anchor.lat) < 1e-6
    && Math.abs(settled[0].lng - anchor.lng) < 1e-6
  ) settled = settled.slice(1);
  const merged = prefix.concat(settled);
  return sameTrail(merged, existing) ? existing : merged;
}
