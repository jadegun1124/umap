// People within SAME_PLACE_METERS share one status chip.
// Single-linkage: A–B and B–C merge A, B, and C even when A–C is farther.
// The chip sits on the group centroid. Circles stay on each lat/lng.

export const SAME_PLACE_METERS = 50;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}

export function distanceMeters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(Number(b?.lat) - Number(a?.lat));
  const dLng = toRad(Number(b?.lng) - Number(a?.lng));
  const lat1 = toRad(Number(a?.lat));
  const lat2 = toRad(Number(b?.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function locatedMembers(members) {
  return (Array.isArray(members) ? members : []).filter((member) => (
    member
    && member.lat != null
    && member.lng != null
    && Number.isFinite(Number(member.lat))
    && Number.isFinite(Number(member.lng))
  ));
}

/** Me first. Everyone else keeps the roster order they arrived in. */
export function orderStatusMembers(members) {
  const self = [];
  const rest = [];
  for (const member of Array.isArray(members) ? members : []) {
    if (!member) continue;
    if (member.role === 'self' || member.id === 'self') self.push(member);
    else rest.push(member);
  }
  return [...self, ...rest];
}

/**
 * Connected components of the 50m graph.
 * Groups come back in roster order of their first member.
 */
export function groupMembersByPlace(members, meters = SAME_PLACE_METERS) {
  const limit = Number(meters);
  const located = locatedMembers(members);
  const parent = located.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let walk = index;
    while (parent[walk] !== walk) {
      const next = parent[walk];
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const unite = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  if (Number.isFinite(limit) && limit >= 0) {
    for (let i = 0; i < located.length; i += 1) {
      for (let j = i + 1; j < located.length; j += 1) {
        if (distanceMeters(located[i], located[j]) <= limit) unite(i, j);
      }
    }
  }
  const buckets = new Map();
  located.forEach((member, index) => {
    const root = find(index);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(member);
    else buckets.set(root, [member]);
  });
  const groups = [];
  for (const bucket of buckets.values()) {
    const ordered = orderStatusMembers(bucket);
    const lat = bucket.reduce((sum, member) => sum + Number(member.lat), 0) / bucket.length;
    const lng = bucket.reduce((sum, member) => sum + Number(member.lng), 0) / bucket.length;
    let anchor = ordered[0];
    let best = Infinity;
    for (const member of ordered) {
      const distance = distanceMeters({ lat, lng }, member);
      if (distance < best - 1e-6) {
        best = distance;
        anchor = member;
      }
    }
    const key = bucket.map((member) => String(member.id ?? '')).sort((a, b) => a.localeCompare(b)).join('|');
    groups.push({
      key,
      members: bucket,
      ordered,
      anchor: { lat, lng },
      anchorId: String(anchor?.id ?? ''),
    });
  }
  return groups;
}

/** First non-empty place in status order (me, then roster). One label for the chip. */
export function firstPlaceLabel(members, placeOf) {
  if (typeof placeOf !== 'function') return '';
  for (const member of orderStatusMembers(members)) {
    const label = String(placeOf(member) || '').trim();
    if (label) return label;
  }
  return '';
}

/**
 * One chip for a whole group. `rows` are already in status order.
 * Text fields are escaped. `batteryHtml` is markup from the caller.
 */
export function groupStatusLabelHtml({ place = '', rows = [] } = {}) {
  const placeText = String(place || '').trim();
  const placeHtml = placeText
    ? `<span data-place style="display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center;font-size:10px;font-weight:600;opacity:.85">${escapeHtml(placeText)}</span>`
    : '';
  const body = (Array.isArray(rows) ? rows : []).map((row) => {
    const selected = row?.selected === true;
    const dimmed = row?.dimmed === true;
    const age = String(row?.age || '').trim();
    const ageHtml = age
      ? `<span data-age style="display:block;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:700;opacity:.9">${escapeHtml(age)}</span>`
      : '';
    return `<span data-member-row data-member-id="${escapeHtml(row?.id)}" style="display:flex;flex-direction:column;align-items:stretch;width:100%;box-sizing:border-box;border-radius:8px;padding:2px 4px;opacity:${dimmed ? '0.55' : '1'};background:${selected ? '#0084FF' : 'transparent'};color:${selected ? '#fff' : '#0f172a'}"><span style="display:flex;align-items:center;gap:8px;width:100%"><span data-name style="white-space:nowrap">${escapeHtml(row?.name)}</span><span style="display:inline-flex;align-items:center;margin-left:auto;min-width:0">${row?.batteryHtml || ''}</span></span>${ageHtml}</span>`;
  }).join('');
  return `<span data-label data-status-group style="display:inline-flex;flex-direction:column;align-items:stretch;gap:2px;margin-bottom:4px;padding:4px 8px;border-radius:12px;font-size:11px;font-weight:700;min-width:108px;max-width:220px;box-shadow:0 1px 2px rgba(15,23,42,.16);background:#fff;color:#0f172a">${placeHtml}${body}</span>`;
}

/** Screen pixels between a pin center and the merged chip tail. */
export const STATUS_LIFT_PX = 72;

/**
 * Callout dy inside a pin whose anchor is the circle center.
 * The tail stays STATUS_LIFT_PX above that center, so the chip matches
 * the old lift while sharing the pin's transform.
 */
export function groupPinShiftY(pinPx = 42) {
  const pin = Number(pinPx);
  const half = Number.isFinite(pin) ? pin / 2 : 21;
  return -(STATUS_LIFT_PX - half);
}

function cssOffset(value) {
  const rounded = Math.round(Number(value) * 1000) / 1000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Chip above a lat/lng. iconAnchor should be the bottom center so the leader
 * ends on that point. The default offset is straight up by STATUS_LIFT_PX.
 * Any other offset keeps the same marker, so a pan moves the chip with the map.
 */
export function statusCalloutHtml(labelHtml = '', tailColor = '#fff', offset = null) {
  const tail = tailColor === '#0084FF' ? '#0084FF' : '#fff';
  const shiftX = offset && Number.isFinite(Number(offset.dx)) ? Number(offset.dx) : 0;
  const shiftY = offset && Number.isFinite(Number(offset.dy)) ? Number(offset.dy) : -STATUS_LIFT_PX;
  const straightUp = shiftX === 0 && shiftY === -STATUS_LIFT_PX;
  const lift = STATUS_LIFT_PX;
  const leader = straightUp
    ? `<span data-pin-leader aria-hidden="true" style="position:absolute;left:50%;bottom:0;width:${lift}px;height:2px;background:#64748b;box-shadow:0 0 0 1px #fff;transform-origin:0 50%;transform:rotate(-90deg);pointer-events:none;z-index:0"></span>`
    : (() => {
      const length = cssOffset(Math.hypot(shiftX, shiftY));
      const angle = cssOffset(Math.atan2(shiftY, shiftX) * 180 / Math.PI);
      if (length === '0') return '';
      return `<span data-pin-leader aria-hidden="true" style="position:absolute;left:50%;bottom:0;width:${length}px;height:2px;background:#64748b;box-shadow:0 0 0 1px #fff;transform-origin:0 50%;transform:rotate(${angle}deg);pointer-events:none;z-index:0"></span>`;
    })();
  const slide = straightUp
    ? `translate(-50%, -${lift}px)`
    : `translate(calc(-50% + ${cssOffset(shiftX)}px), ${cssOffset(shiftY)}px)`;
  return `<div data-status-root style="position:relative;width:42px;height:42px;overflow:visible;pointer-events:none">
    ${leader}
    <div data-callout style="position:absolute;z-index:2;left:50%;bottom:0;width:max-content;transform:${slide};pointer-events:auto">
      ${labelHtml}
      <span data-label-tail style="display:block;width:0;height:0;margin:0 auto;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${tail}"></span>
    </div>
  </div>`;
}
