/** Same-spot family pins. Bubbles sit above the point, so a cluster spreads east-west. */

const CLUSTER_M = 25;
const STEP_M = 22;

function metersBetween(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function spreadPinPositions(members) {
  const placed = new Map();
  const located = (Array.isArray(members) ? members : []).filter((member) => (
    member && Number.isFinite(member.lat) && Number.isFinite(member.lng)
  ));
  const used = new Set();
  for (const member of located) {
    if (used.has(member.id)) continue;
    const group = located
      .filter((other) => !used.has(other.id) && metersBetween(member, other) <= CLUSTER_M)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    if (group.length < 2) {
      placed.set(member.id, { lat: member.lat, lng: member.lng });
      used.add(member.id);
      continue;
    }
    const lat = group.reduce((sum, item) => sum + item.lat, 0) / group.length;
    const lng = group.reduce((sum, item) => sum + item.lng, 0) / group.length;
    const span = (group.length - 1) * STEP_M;
    const metersPerLng = 111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    group.forEach((item, index) => {
      const east = -span / 2 + index * STEP_M;
      placed.set(item.id, { lat, lng: lng + east / metersPerLng });
      used.add(item.id);
    });
  }
  return placed;
}
