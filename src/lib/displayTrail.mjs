/** Card thumbnails keep fewer vertices than the detail map. Both are display-only. */
export const PREVIEW_TRAIL_CAP = 80;
export const DISPLAY_TRAIL_CAP = 160;

/**
 * Vertices for painting one unbroken line.
 * The stored array and its point objects are not changed.
 * Sampling is by index, so a long gap stays one straight segment.
 * The first and last located points are always kept.
 */
export function displaySolidTrail(points, maxVertices = DISPLAY_TRAIL_CAP) {
  const cap = Math.max(2, Math.floor(Number(maxVertices)) || DISPLAY_TRAIL_CAP);
  const source = [];
  const input = Array.isArray(points) ? points : [];
  for (const point of input) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    source.push(point);
  }
  if (source.length <= cap) return source.slice();
  const out = [];
  const last = source.length - 1;
  let previous = -1;
  for (let step = 0; step < cap; step += 1) {
    const index = step === cap - 1 ? last : Math.round((step * last) / (cap - 1));
    if (index === previous) continue;
    previous = index;
    out.push(source[index]);
  }
  if (out[out.length - 1] !== source[last]) out.push(source[last]);
  return out;
}

/** Cheap identity for a polyline. Same coordinates skip a Leaflet rebuild. */
export function trailGeometryKey(trails) {
  let hash = 2166136261;
  let count = 0;
  const lines = Array.isArray(trails) ? trails : [];
  for (const trail of lines) {
    const length = Array.isArray(trail) ? trail.length : 0;
    hash = Math.imul(hash ^ length, 16777619);
    if (!length) continue;
    for (let index = 0; index < trail.length; index += 1) {
      const point = trail[index];
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
      count += 1;
      hash = Math.imul(hash ^ Math.round(point.lat * 1e5), 16777619);
      hash = Math.imul(hash ^ Math.round(point.lng * 1e5), 16777619);
    }
  }
  return `${count}:${hash >>> 0}`;
}
