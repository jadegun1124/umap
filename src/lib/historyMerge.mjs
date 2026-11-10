// Journey and visit lists are merged by id.
// A later poll, an empty backup, or a shorter snapshot must not drop a card
// that is already stored. Retention and an explicit delete are the only removals.
// The publish cap keeps the newest trips so a vehicle ride is not the row that falls off.

import { mergeJourneyLists } from './tracking.mjs';
import { mergeTrailPoints } from './trailParts.mjs';

export const PUBLISH_JOURNEY_CAP = 40;
const TRACK_POINT_CAP = 4000;

export function mergeRecordsById(existing, incoming) {
  const map = new Map();
  const take = (item) => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) return;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      return;
    }
    const prevDistance = Number(prev.distanceM) || 0;
    const nextDistance = Number(item.distanceM) || 0;
    const richer = nextDistance >= prevDistance ? item : prev;
    const other = richer === item ? prev : item;
    const start = richer.start || other.start
      ? { ...(richer.start || other.start), label: (richer.start && richer.start.label) || (other.start && other.start.label) || null }
      : undefined;
    const end = richer.end || other.end
      ? { ...(richer.end || other.end), label: (richer.end && richer.end.label) || (other.end && other.end.label) || null }
      : undefined;
    map.set(item.id, {
      ...richer,
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(richer.label || other.label ? { label: richer.label || other.label } : {}),
    });
  };
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) take(item);
  return [...map.values()].sort((left, right) => (left.startedAt || left.arrivedAt || 0) - (right.startedAt || right.arrivedAt || 0));
}

export function mergeJourneys(existing, incoming) {
  return mergeJourneyLists(existing, incoming);
}

/** Newest trips, capped. An oldest-first slice used to drop the ride that just finished. */
export function journeysToPublish(list, cap = PUBLISH_JOURNEY_CAP) {
  const items = (Array.isArray(list) ? list : []).filter((item) => item && typeof item.id === 'string');
  const sorted = items.slice().sort((left, right) => (left.endedAt || 0) - (right.endedAt || 0) || (left.startedAt || 0) - (right.startedAt || 0));
  return sorted.length > cap ? sorted.slice(-cap) : sorted;
}

function samePoints(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index]?.at !== right[index]?.at || left[index]?.lat !== right[index]?.lat || left[index]?.lng !== right[index]?.lng) return false;
  }
  return true;
}

/**
 * One family member's trail from a room poll.
 * An older `at` is ignored. A newer payload unions journeys and points.
 * Empty journeys or a failed decrypt (caller skips the trail) do not clear the list.
 */
export function applyMemberTrail(local, incoming) {
  const current = {
    at: Number(local && local.at) || 0,
    points: Array.isArray(local && local.points) ? local.points : [],
    journeys: Array.isArray(local && local.journeys) ? local.journeys : [],
    moving: !!(local && local.moving),
  };
  if (!incoming || typeof incoming.at !== 'number' || !Number.isFinite(incoming.at)) {
    return { ...current, changed: false };
  }
  if (current.at > incoming.at) return { ...current, changed: false };
  const journeys = mergeJourneys(current.journeys, incoming.journeys);
  const incomingPoints = Array.isArray(incoming.points) ? incoming.points : [];
  const united = incomingPoints.length ? mergeTrailPoints(current.points, incomingPoints) : current.points;
  const points = united.length > TRACK_POINT_CAP ? united.slice(-TRACK_POINT_CAP) : united;
  const keptPoints = samePoints(current.points, points) ? current.points : points;
  const moving = incoming.moving === true;
  const changed = journeys !== current.journeys || keptPoints !== current.points || moving !== current.moving || incoming.at !== current.at;
  return { at: incoming.at, points: keptPoints, journeys, moving, changed };
}

/**
 * Decide what history a backup may upload.
 * A failed read, or a seal that was fetched but would not open, keeps the server copy.
 * Only a seal this phone opened is unioned by id and may replace the stored blob.
 */
export function planAccountBackup({ localJourneys, localVisits, remoteOk, remoteLocked, remoteJourneys, remoteVisits, seenSeal }) {
  if (!remoteOk || remoteLocked) return { keepHistory: true, journeys: [], visits: [], seenSeal: '' };
  return {
    keepHistory: false,
    journeys: mergeJourneys(remoteJourneys, localJourneys),
    visits: mergeRecordsById(remoteVisits, localVisits),
    seenSeal: typeof seenSeal === 'string' ? seenSeal : '',
  };
}

/** 403, an empty body, and a decrypt miss are not "no records". */
export function shouldApplyTrailResponse(status, trails) {
  if (status !== 200) return false;
  return Array.isArray(trails);
}
