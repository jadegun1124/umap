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

/** Web mercator pixels. The same-spot shift is added after this, in screen pixels. */
export function projectCallout(lat, lng, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const size = 256 * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * size,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * size,
  };
}

/**
 * Pin tip and label tail are one projected point.
 * dx/dy stay in pixels at every zoom. A meter offset would grow as the zoom changes.
 */
export function calloutAnchors({ lat, lng, dx = 0, dy = 0, zoom }) {
  const origin = projectCallout(lat, lng, zoom);
  const pin = { x: origin.x + (Number(dx) || 0), y: origin.y + (Number(dy) || 0) };
  return { origin, pin, labelTail: { x: pin.x, y: pin.y } };
}

/**
 * One box for the label, its tail, and the pin.
 * inline-flex plus max-content gives the bubble a real width inside the
 * zero-size marker, so the tail stays on the pin instead of the left edge.
 * The pixel shift is separate from the centering translate.
 */
export function memberCalloutHtml({ dx = 0, dy = 0, dimmed = false, tailColor = '#fff', labelHtml = '', faceHtml = '' }) {
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  const tail = tailColor === '#0084FF' ? '#0084FF' : '#fff';
  return `<div data-callout style="position:absolute;left:0;top:0;transform:translate(${shiftX}px, ${shiftY}px);opacity:${dimmed ? '0.55' : '1'}">
    <div data-bubble style="display:inline-flex;flex-direction:column;align-items:center;width:max-content;transform:translate(-50%,-100%)">
      ${labelHtml}
      <span data-label-tail style="display:block;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${tail}"></span>
      <span data-pin-anchor style="display:flex;align-items:center;justify-content:center">${faceHtml}</span>
    </div>
  </div>`;
}
