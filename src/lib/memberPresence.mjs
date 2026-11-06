// Last-known location stays on the card after a phone stops reporting.
// After a week the card is 연결 끊김. An explicit server leave drops the row.

export const MEMBER_AGE_MS = 45_000;
export const MEMBER_DIM_MS = 3 * 60 * 1000;
export const MEMBER_STALE_MS = 10 * 60 * 1000;
export const MEMBER_DISCONNECTED_MS = 7 * 24 * 60 * 60 * 1000;

function isSelfRow(member) {
  return !member || member.id === 'self' || member.role === 'self';
}

export function relativePlaceAge(at, now) {
  const stamp = Number(at);
  const wall = Number(now);
  if (!Number.isFinite(stamp) || !Number.isFinite(wall)) return '';
  const delta = Math.max(0, wall - stamp);
  if (delta < 45_000) return '방금';
  const minutes = Math.round(delta / 60_000);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function memberPresence(member, now) {
  const stamp = Number(member?.updatedAt);
  if (!Number.isFinite(stamp) || stamp <= 0) return { kind: 'unknown', ago: '', faded: false };
  const age = Number(now) - stamp;
  if (!Number.isFinite(age)) return { kind: 'unknown', ago: '', faded: false };
  const ago = age >= MEMBER_AGE_MS ? relativePlaceAge(stamp, now) : '';
  if (age >= MEMBER_DISCONNECTED_MS) return { kind: 'disconnected', ago, faded: true };
  if (age >= MEMBER_STALE_MS) return { kind: 'stale', ago, faded: true };
  if (age >= MEMBER_DIM_MS) return { kind: 'live', ago, faded: true };
  return { kind: 'live', ago, faded: false };
}

export function memberPresenceLabel(presence) {
  if (!presence) return '';
  if (presence.kind === 'disconnected') return '연결 끊김';
  if (presence.kind === 'stale' && presence.ago) return `마지막 위치 · ${presence.ago}`;
  return '';
}

export function pinAgeLabel(presence) {
  if (!presence) return '';
  if (presence.kind === 'disconnected' || presence.kind === 'stale') return memberPresenceLabel(presence);
  return presence.ago || '';
}

export function memberIsStale(presence) {
  return presence?.kind === 'stale' || presence?.kind === 'disconnected' || presence?.faded === true;
}

export function cleanDepartedIds(values) {
  if (!Array.isArray(values)) return [];
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !/^local-[a-z0-9]{3,64}$/.test(value) || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

/** sharing:false is a stop-reporting heartbeat, not an explicit leave. */
export function sharedPlaceStopsReporting(place) {
  return !!place && place.sharing === false;
}

/**
 * Take the departed member off the roster. Keep tracks, journeys, visits.
 * Do not write hiddenMemberIds so a later live place can return.
 */
export function hideLeftPublishers(state, memberIds) {
  const gone = new Set(cleanDepartedIds(memberIds));
  if (!state || gone.size === 0) return state;
  const members = Array.isArray(state.members) ? state.members : [];
  const removed = members.filter((member) => (
    member
    && !isSelfRow(member)
    && typeof member.publisherId === 'string'
    && gone.has(member.publisherId)
  ));
  if (removed.length === 0) return state;
  const dropIds = new Set(removed.map((member) => member.id));
  return {
    ...state,
    members: members.filter((member) => !dropIds.has(member.id)),
  };
}
