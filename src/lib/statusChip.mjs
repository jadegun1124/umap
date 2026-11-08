/** One status chip for people within 50m. Pins stay on their own coordinates. */

import { memberPresence } from './memberPresence.mjs';

export const SAME_PLACE_METERS = 50;

function metersBetween(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isSelfMember(member) {
  return member?.id === 'self' || member?.role === 'self';
}

function located(members) {
  return (Array.isArray(members) ? members : []).filter((member) => (
    member && Number.isFinite(member.lat) && Number.isFinite(member.lng)
  ));
}

/** Connected components. 50m inclusive, so 49m groups and 51m does not. */
export function groupMembersByPlace(members, meters = SAME_PLACE_METERS) {
  const people = located(members);
  const limit = Number(meters);
  const parent = people.map((_, index) => index);
  const find = (index) => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor];
    return cursor;
  };
  for (let left = 0; left < people.length; left += 1) {
    for (let right = left + 1; right < people.length; right += 1) {
      if (metersBetween(people[left], people[right]) <= limit) parent[find(right)] = find(left);
    }
  }
  const buckets = new Map();
  people.forEach((member, index) => {
    const root = find(index);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(member);
    else buckets.set(root, [member]);
  });
  return [...buckets.values()];
}

/** '나' first. Everyone else keeps the order they were given. */
export function orderStatusMembers(members) {
  const list = Array.isArray(members) ? members : [];
  const self = list.filter((member) => isSelfMember(member));
  const rest = list.filter((member) => !isSelfMember(member));
  return self.concat(rest);
}

export function cleanStatusPlace(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text === '근처') return '';
  return text;
}

/**
 * One place line for the group.
 * A shared name wins. Otherwise the self row's name, then the first other name.
 */
export function representativePlace(members, placeOf) {
  const ordered = orderStatusMembers(members);
  const labels = ordered.map((member) => cleanStatusPlace(typeof placeOf === 'function' ? placeOf(member) : ''));
  const filled = labels.filter(Boolean);
  if (filled.length === 0) return '';
  if (filled.every((label) => label === filled[0])) return filled[0];
  return labels[0] || filled[0];
}

export function batteryText(member) {
  if (member?.battery == null || !Number.isFinite(Number(member.battery))) return '—';
  return `${Math.max(0, Math.min(100, Math.round(Number(member.battery))))}%`;
}

function photoStamp(photo) {
  if (typeof photo !== 'string' || !photo.startsWith('data:image/') || photo.length >= 120_000) return '';
  return `${photo.length}:${photo.slice(-24)}`;
}

/** Identity of the fields that change a chip. Same value skips grouping and DOM. */
export function statusPaintKey(members, selectedId = '', now = Date.now()) {
  const people = located(members);
  let key = `sel:${selectedId || ''}`;
  for (const member of people) {
    const lat = member.lat.toFixed(5);
    const lng = member.lng.toFixed(5);
    const battery = member.battery == null || !Number.isFinite(Number(member.battery)) ? '' : String(Math.round(Number(member.battery)));
    const place = cleanStatusPlace(typeof member.place === 'string' ? member.place : '');
    const presence = memberPresence(member, now);
    const charging = member.charging === true ? '1' : '0';
    key += `|${member.id}:${lat},${lng}:${battery}:${place}:${member.name || ''}:${member.role || ''}:${charging}:${photoStamp(member.photo)}:${presence.kind}:${presence.ago}:${presence.faded ? 1 : 0}`;
  }
  return key;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char);
}

export function memberDisplayName(member) {
  return isSelfMember(member) ? '나' : String(member?.name || '');
}

/** Plain chip. No shadow, filter, or animation. The label does not take touches. */
export function groupStatusHtml(members, place) {
  const rows = orderStatusMembers(members).map((member) => {
    const name = escapeHtml(memberDisplayName(member));
    return `<span data-member-id="${escapeHtml(member.id)}" style="display:flex;justify-content:space-between;gap:8px;white-space:nowrap"><span data-name>${name}</span><span data-battery>${escapeHtml(batteryText(member))}</span></span>`;
  }).join('');
  const placeHtml = place
    ? `<span data-place style="display:block;max-width:164px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700">${escapeHtml(place)}</span>`
    : '';
  return `<span data-label data-status-group style="display:inline-flex;flex-direction:column;align-items:stretch;gap:1px;margin-bottom:4px;padding:4px 8px;border-radius:12px;border:1px solid #e2e8f0;background:#fff;color:#0f172a;font-size:11px;font-weight:700;pointer-events:none">${placeHtml}${rows}</span>`;
}
