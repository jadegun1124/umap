/** Same-spot family pins. Bubbles are wide, so a cluster shifts them in screen pixels. */

const CLUSTER_M = 40;

function metersBetween(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bubbleSlot(index, count) {
  if (count <= 1) return { dx: 0, dy: 0 };
  if (count === 2) return { dx: index === 0 ? -120 : 120, dy: 0 };
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { dx: (column - 1) * 150, dy: row * 72 + (column === 1 ? -56 : 0) };
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
    group.forEach((item, index) => {
      const slot = bubbleSlot(index, group.length);
      placed.set(item.id, { lat: item.lat, lng: item.lng, dx: slot.dx, dy: slot.dy });
      used.add(item.id);
    });
  }
  return placed;
}
