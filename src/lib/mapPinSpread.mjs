/** Family pins stay on the real lat/lng. Callouts share that marker and stack above it. */

export const MEMBER_PIN_PX = 42;

/**
 * Widest name/battery/place chip (max-width 180), the optional age line
 * ("N분 전" / "N시간 전"), and the 7px tail.
 * The stack step is at least this tall so chips on one point do not overlap.
 */
export const CALLOUT_WIDTH_PX = 180;
export const CALLOUT_BLOCK_PX = 72;
export const CALLOUT_STACK_PX = 80;

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

/** South first, so the southern chip hugs its circle and northern chips climb above it. */
function compareCluster(left, right) {
  if (left.lat !== right.lat) return left.lat - right.lat;
  if (left.lng !== right.lng) return left.lng - right.lng;
  return String(left.id).localeCompare(String(right.id));
}

/**
 * Screen-pixel shift of the callout only. dx/dy are not added to the circle.
 * index 0 sits on the pin. Later chips move straight up by a fixed step.
 */
export function bubbleSlot(index, count) {
  if (count <= 1 || index <= 0) return { dx: 0, dy: 0 };
  return { dx: 0, dy: -index * CALLOUT_STACK_PX };
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
      .sort(compareCluster);
    group.forEach((item, index) => {
      const slot = bubbleSlot(index, group.length);
      placed.set(item.id, { lat: item.lat, lng: item.lng, dx: slot.dx, dy: slot.dy });
      used.add(item.id);
    });
  }
  return placed;
}

/** Lower chips paint above higher ones so a leader does not strike through the name. */
export function markerZIndex(dy = 0, selected = false) {
  return (selected ? 2000 : 1000) + (Number(dy) || 0);
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
 * dx/dy move only the callout, in screen pixels. labelTail is that shift.
 * tailTip is the bottom center of the chip; pinRim is the top of the circle.
 */
export function calloutAnchors({ lat, lng, dx = 0, dy = 0, zoom }) {
  const origin = projectCallout(lat, lng, zoom);
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  const pin = { x: origin.x, y: origin.y };
  const pinRim = { x: origin.x, y: origin.y - MEMBER_PIN_PX / 2 };
  return {
    origin,
    pin,
    labelTail: { x: origin.x + shiftX, y: origin.y + shiftY },
    pinRim,
    tailTip: { x: pinRim.x + shiftX, y: pinRim.y + shiftY },
  };
}

/** Leader from the circle's top edge to the callout tail, in pin-center pixels (+y down). */
export function calloutLeader(dx = 0, dy = 0) {
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  const rimY = -MEMBER_PIN_PX / 2;
  return {
    needed: shiftX !== 0 || shiftY !== 0,
    from: { x: 0, y: rimY },
    to: { x: shiftX, y: rimY + shiftY },
  };
}

/** Screen rect of the chip. bottom is the tail tip, which sits on the pin when dx and dy are 0. */
export function calloutScreenBox({ lat, lng, dx = 0, dy = 0, zoom }) {
  const anchors = calloutAnchors({ lat, lng, dx, dy, zoom });
  return {
    left: anchors.tailTip.x - CALLOUT_WIDTH_PX / 2,
    right: anchors.tailTip.x + CALLOUT_WIDTH_PX / 2,
    top: anchors.tailTip.y - CALLOUT_BLOCK_PX,
    bottom: anchors.tailTip.y,
    pin: anchors.pin,
    tail: anchors.tailTip,
  };
}

export function calloutBoxesOverlap(a, b) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function cssNumber(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A real-sized bar. A 0×0 SVG is not painted by Android WebView. */
function leaderMarkup(dx, dy) {
  const leader = calloutLeader(dx, dy);
  if (!leader.needed) return '';
  const runX = leader.to.x - leader.from.x;
  const runY = leader.to.y - leader.from.y;
  const length = cssNumber(Math.hypot(runX, runY));
  const angle = cssNumber(Math.atan2(runY, runX) * 180 / Math.PI);
  const x = cssNumber(leader.from.x);
  const y = cssNumber(leader.from.y);
  return `<span data-pin-leader aria-hidden="true" style="position:absolute;left:calc(50% + ${x}px);top:calc(50% + ${y}px);width:${length}px;height:2px;margin-top:-1px;background:#64748b;box-shadow:0 0 0 1px #fff;transform-origin:0 50%;transform:rotate(${angle}deg);pointer-events:none;z-index:0"></span>`;
}

/**
 * The 42px circle fills the marker. iconAnchor is its center, so Leaflet moves
 * the circle, the chip, and the leader together. A zero offset puts the chip
 * on the circle. Any other offset keeps a leader from the chip back to the rim.
 */
export function memberCalloutHtml({ dx = 0, dy = 0, dimmed = false, tailColor = '#fff', labelHtml = '', faceHtml = '' }) {
  const shiftX = Number(dx) || 0;
  const shiftY = Number(dy) || 0;
  const tail = tailColor === '#0084FF' ? '#0084FF' : '#fff';
  const pin = MEMBER_PIN_PX;
  return `<div data-pin-root style="position:relative;width:${pin}px;height:${pin}px;overflow:visible;opacity:${dimmed ? '0.55' : '1'}">
    ${leaderMarkup(shiftX, shiftY)}
    <div data-pin-anchor style="position:relative;z-index:1;width:${pin}px;height:${pin}px;display:flex;align-items:center;justify-content:center">${faceHtml}</div>
    <div data-callout style="position:absolute;z-index:2;left:50%;bottom:100%;width:max-content;transform:translate(calc(-50% + ${shiftX}px), ${shiftY}px)">
      ${labelHtml}
      <span data-label-tail style="display:block;width:0;height:0;margin:0 auto;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${tail}"></span>
    </div>
  </div>`;
}
