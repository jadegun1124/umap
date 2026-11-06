/** Same-spot family labels. The circle stays on the real lat/lng; only the name shifts in screen pixels. */

export const MEMBER_PIN_PX = 42;

/** Circle center is the marker anchor, so the avatar stays on the lat/lng while zooming. */
export function memberPinIcon() {
  const pin = MEMBER_PIN_PX;
  return { iconSize: [pin, pin], iconAnchor: [pin / 2, pin / 2] };
}

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

/** Web mercator pixels for a lat/lng. The circle uses this point. Label dx/dy are not added here. */
export function projectCallout(lat, lng, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const size = 256 * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * size,
    y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * size,
  };
}

/**
 * Circle center is the projected lat/lng at every zoom.
 * dx/dy move only the name, in screen pixels. A pixel shift on the circle
 * would stay a fixed screen distance and slide across the ground as the zoom changes.
 */
export function calloutAnchors({ lat, lng, dx = 0, dy = 0, zoom }) {
  const origin = projectCallout(lat, lng, zoom);
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  return {
    origin,
    pin: { x: origin.x, y: origin.y },
    labelTail: { x: origin.x + shiftX, y: origin.y + shiftY },
  };
}

/**
 * The 42px circle fills the marker. iconAnchor is its center, so Leaflet moves
 * that point with the map. dx/dy translate the name only.
 */
export function memberCalloutHtml({ dx = 0, dy = 0, dimmed = false, tailColor = '#fff', labelHtml = '', faceHtml = '' }) {
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  const tail = tailColor === '#0084FF' ? '#0084FF' : '#fff';
  const pin = MEMBER_PIN_PX;
  return `<div data-pin-root style="position:relative;width:${pin}px;height:${pin}px;opacity:${dimmed ? '0.55' : '1'}">
    <div data-pin-anchor style="width:${pin}px;height:${pin}px;display:flex;align-items:center;justify-content:center">${faceHtml}</div>
    <div data-callout style="position:absolute;left:50%;bottom:100%;width:max-content;transform:translate(calc(-50% + ${shiftX}px), ${shiftY}px)">
      ${labelHtml}
      <span data-label-tail style="display:block;width:0;height:0;margin:0 auto;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${tail}"></span>
    </div>
  </div>`;
}
