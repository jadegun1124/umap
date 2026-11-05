// One family poll has to leave both phones with the same people.
// A profile is enough to show the row. A later place fills location and
// battery. A batch that only has a name, or a sharing:false heartbeat, must
// not wipe a fix that already arrived.

import { ensureRoster } from './peerFamily.mjs';

const MEMBER_ID = /^local-[a-z0-9]{3,64}$/;

function memberIdOf(place) {
  return place && typeof place.memberId === 'string' && MEMBER_ID.test(place.memberId) ? place.memberId : '';
}

function located(place) {
  return !!place
    && typeof place.lat === 'number'
    && typeof place.lng === 'number'
    && Number.isFinite(place.lat)
    && Number.isFinite(place.lng);
}

export function missingWrapMemberIds(keys) {
  const pubs = keys && keys.pubs && typeof keys.pubs === 'object' ? keys.pubs : {};
  const wraps = keys && keys.wraps && typeof keys.wraps === 'object' ? keys.wraps : {};
  const revoked = new Set(Array.isArray(keys && keys.revoked) ? keys.revoked : []);
  const ids = [];
  for (const id of Object.keys(pubs)) {
    if (!MEMBER_ID.test(id) || revoked.has(id) || wraps[id]) continue;
    ids.push(id);
  }
  return ids;
}

/** Opened coordinates win. Until the family key arrives, battery on the envelope still counts. */
export function placeForFamilyRoster(place, opened) {
  if (!place || place.sharing !== true || place.audience !== 'family') return null;
  const memberId = memberIdOf(place);
  if (!memberId) return null;
  const batteryPct = typeof place.batteryPct === 'number' && place.batteryPct >= 0 && place.batteryPct <= 100
    ? Math.round(place.batteryPct)
    : null;
  const charging = place.charging === true ? true : place.charging === false ? false : null;
  if (located(opened)) {
    return {
      ...place,
      memberId,
      lat: opened.lat,
      lng: opened.lng,
      accuracyM: typeof opened.accuracyM === 'number' && opened.accuracyM > 0 ? opened.accuracyM : 0,
      batteryPct,
      charging,
    };
  }
  if (batteryPct == null) return null;
  return { ...place, memberId, lat: null, lng: null, batteryPct, charging };
}

export function rosterUnchanged(before, after) {
  const left = Array.isArray(before) ? before : [];
  const right = Array.isArray(after) ? after : [];
  if (left.length !== right.length) return false;
  return right.every((member) => {
    const prev = left.find((item) => item && member && item.id === member.id);
    if (!prev) return false;
    return prev.name === member.name
      && prev.lat === member.lat
      && prev.lng === member.lng
      && prev.battery === member.battery
      && prev.charging === member.charging
      && (prev.publisherId || '') === (member.publisherId || '')
      && !!prev.lead === !!member.lead
      && (prev.photo || '') === (member.photo || '');
  });
}

function batteryOf(place) {
  return typeof place.batteryPct === 'number' && place.batteryPct >= 0 && place.batteryPct <= 100
    ? Math.round(place.batteryPct)
    : null;
}

function chargingOf(place) {
  if (place.charging === true) return true;
  if (place.charging === false) return false;
  return null;
}

export function mergeFamilyRoster(members, options = {}) {
  const code = typeof options.code === 'string' ? options.code : '';
  const selfId = typeof options.selfId === 'string' ? options.selfId : '';
  const ownerId = typeof options.ownerId === 'string' ? options.ownerId : '';
  const hidden = Array.isArray(options.hidden) ? options.hidden : [];
  const hiddenSet = new Set(hidden);
  const prefix = `family:${code}:`;
  const profiles = (Array.isArray(options.profiles) ? options.profiles : [])
    .filter((profile) => profile && profile.memberId && profile.memberId !== selfId);
  const profileIds = new Set(profiles.map((profile) => profile.memberId));
  const departed = new Set(
    (Array.isArray(options.departed) ? options.departed : [])
      .filter((id) => typeof id === 'string' && MEMBER_ID.test(id) && !profileIds.has(id)),
  );
  const live = new Map();
  const batteryOnly = new Map();
  for (const place of Array.isArray(options.places) ? options.places : []) {
    if (!place || place.sharing !== true) continue;
    if (place.audience && place.audience !== 'family') continue;
    const memberId = memberIdOf(place);
    if (!memberId || memberId === selfId) continue;
    if (hiddenSet.has(memberId) || hiddenSet.has(`${prefix}${memberId}`)) continue;
    if (!located(place)) {
      if (batteryOf(place) != null) {
        const prev = batteryOnly.get(memberId);
        if (!prev || (place.at || 0) >= (prev.at || 0)) batteryOnly.set(memberId, place);
      }
      continue;
    }
    const prev = live.get(memberId);
    if (!prev || (place.at || 0) >= (prev.at || 0)) live.set(memberId, place);
  }

  let next = (Array.isArray(members) ? members : []).filter((member) => {
    if (!member || typeof member.id !== 'string' || !member.id.startsWith(prefix)) return true;
    const publisher = typeof member.publisherId === 'string' ? member.publisherId : '';
    if (publisher && live.has(publisher)) return true;
    if (publisher && profileIds.has(publisher)) return true;
    if (!publisher && live.has(member.id.slice(prefix.length))) return true;
    if (publisher && departed.has(publisher)) return false;
    if (hiddenSet.has(member.id) || (publisher && hiddenSet.has(publisher))) return false;
    return true;
  }).map((member) => ({ ...member }));

  for (const [memberId, place] of live) {
    const id = `${prefix}${memberId}`;
    const battery = batteryOf(place);
    const charging = chargingOf(place);
    const index = next.findIndex((member) => member && (member.publisherId === memberId || member.id === id));
    const patch = {
      lat: place.lat,
      lng: place.lng,
      accuracyM: Math.max(1, Math.round(place.accuracyM || 1)),
      updatedAt: typeof place.at === 'number' ? place.at : 0,
      publisherId: memberId,
      share: 'allowed',
      role: 'admin-share',
    };
    if (index >= 0) {
      const prev = next[index];
      next[index] = {
        ...prev,
        ...patch,
        role: prev.role || 'admin-share',
        battery: battery ?? prev.battery ?? null,
        charging: charging ?? prev.charging ?? null,
      };
    } else {
      const name = typeof place.name === 'string' ? place.name.trim().slice(0, 20) : '';
      next.push({
        id,
        name: name || '가족',
        moving: null,
        battery,
        charging,
        ...patch,
      });
    }
  }

  const known = new Set();
  for (const member of Array.isArray(members) ? members : []) {
    if (member && typeof member.publisherId === 'string' && member.publisherId) known.add(member.publisherId);
  }
  const ensured = ensureRoster(next, profiles, code, ownerId, hidden);
  next = ensured.members.map((member) => ({ ...member }));
  for (const [memberId, place] of batteryOnly) {
    if (live.has(memberId)) continue;
    const id = `${prefix}${memberId}`;
    const index = next.findIndex((member) => member && (member.publisherId === memberId || member.id === id));
    if (index < 0) continue;
    const prev = next[index];
    const battery = batteryOf(place);
    const charging = chargingOf(place);
    if (prev.battery === battery && (charging == null || prev.charging === charging)) continue;
    next[index] = {
      ...prev,
      battery,
      charging: charging ?? prev.charging ?? null,
    };
  }
  const joined = [];
  for (const profile of profiles) {
    if (!profile || typeof profile.memberId !== 'string' || known.has(profile.memberId)) continue;
    if (hiddenSet.has(profile.memberId) || hiddenSet.has(`${prefix}${profile.memberId}`)) continue;
    const name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 20) : '';
    if (!name) continue;
    joined.push(name);
  }
  return { members: next, joined };
}
