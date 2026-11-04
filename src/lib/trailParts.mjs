/** Union a stored trail with sealed batch points. Same `at` is kept once. */
export function mergeTrailPoints(base, extra) {
  const points = [];
  const seen = new Set();
  const rows = [...(Array.isArray(base) ? base : []), ...(Array.isArray(extra) ? extra : [])];
  for (const point of rows) {
    if (!point || typeof point.at !== 'number') continue;
    if (seen.has(point.at)) continue;
    seen.add(point.at);
    points.push(point);
  }
  points.sort((left, right) => left.at - right.at);
  return points;
}
