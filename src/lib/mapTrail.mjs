import { memberIsStale, memberPresence } from './memberPresence.mjs';
import { displayLivePoints, isImpossibleJump, seoulDayKey } from './tracking.mjs';

/**
 * Records and the main map share one open line.
 * The main map adds the live pin on the end. 「머무름」 does not hide it.
 * A walked hole stays in the points so the map can draw it dashed, the same
 * way 1.12 did. A vehicle chord stays in that line and is painted solid.
 * Closing records does not erase a move that is still open.
 */
export function familyMapShowsTrail({ viewingRecords, detailOpen, showTrail, member, liveDrawable }) {
  if (!member) return false;
  if (viewingRecords) {
    if (detailOpen) return true;
    if (!showTrail) return false;
    return member.id === 'self' || member.share === 'allowed' || member.role === 'admin-share';
  }
  return liveDrawable === true;
}

/** Saved journeys for the selected day, plus the segment that is still live. */
export function recordsDayTrails({ journeys, livePoints, liveDrawable }) {
  const lines = [];
  for (const journey of Array.isArray(journeys) ? journeys : []) {
    const points = journey?.points;
    if (Array.isArray(points) && points.length >= 2) lines.push(points);
  }
  if (liveDrawable === true && Array.isArray(livePoints) && livePoints.length >= 2) lines.push(livePoints);
  return lines;
}

/**
 * The records list covers the map, so that screen does not build a polyline
 * for every saved journey. Opening one journey draws that line. The live map
 * is the caller's live lines.
 */
export function screenMapTrails({ viewingRecords, detailOpen, detailPoints, liveLines }) {
  if (detailOpen) {
    const line = Array.isArray(detailPoints) ? detailPoints : [];
    return line.length >= 2 ? [line] : [];
  }
  if (viewingRecords) return [];
  return Array.isArray(liveLines) ? liveLines : [];
}

function meters(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return Infinity;
  const radius = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = p2 - p1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function drawnLine(points) {
  const line = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || point.stayEnd || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    line.push(point);
  }
  return line;
}

/** The live pin is the last vertex. A backwards pin or a teleport is not. */
function appendLivePin(line, pin) {
  if (!pin || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng) || line.length === 0) return line;
  const anchor = line[line.length - 1];
  const leg = {
    lat: pin.lat,
    lng: pin.lng,
    at: Number.isFinite(pin.at) ? pin.at : anchor.at,
    speedMps: pin.speedMps,
    accuracyM: pin.accuracyM,
    staying: pin.staying,
  };
  if (meters(anchor, pin) < 1.5) {
    if (anchor.lat === pin.lat && anchor.lng === pin.lng) return line;
    return line.slice(0, -1).concat([{ ...anchor, lat: pin.lat, lng: pin.lng }]);
  }
  if (Number.isFinite(anchor.at) && Number.isFinite(leg.at) && leg.at + 1_000 < anchor.at) return line;
  if (isImpossibleJump(anchor, leg)) return line;
  return line.concat([leg]);
}

function located(member) {
  return !!member && Number.isFinite(member.lat) && Number.isFinite(member.lng);
}

/**
 * Polylines the map draws for one member.
 * withPin appends the current pin. Records pass false so the journey line
 * matches the main line aside from that last segment.
 * Share, staleness, and guardians still gate the line. The motion label does not.
 */
export function memberLiveLines(member, tracks, now, liveDay = seoulDayKey(now), withPin = true) {
  const storedToday = (tracks?.[member?.id] ?? []).filter((point) => point && seoulDayKey(point.at) === liveDay);
  if (!member || member.role === 'guardian' || !located(member)) {
    return { lines: [], reason: 'no-pin', stored: storedToday.length, live: 0 };
  }
  if (memberIsStale(memberPresence(member, now))) {
    return { lines: [], reason: 'stale', stored: storedToday.length, live: 0 };
  }
  if (member.id !== 'self' && member.share !== 'allowed' && member.role !== 'admin-share') {
    return { lines: [], reason: 'share', stored: storedToday.length, live: 0 };
  }
  const points = displayLivePoints(storedToday, now);
  const pin = {
    lat: member.lat,
    lng: member.lng,
    at: member.updatedAt || now,
    accuracyM: member.accuracyM,
    speedMps: member.speedMps,
    staying: member.staying,
  };
  const lines = mainOverviewTrails({ points, pin, withPin });
  if (lines.length === 0) {
    return { lines: [], reason: 'short', stored: storedToday.length, live: points.length };
  }
  return { lines, reason: 'draw', stored: storedToday.length, live: points.length };
}

export function mainOverviewTrails({ points, pin, withPin = true }) {
  const line = drawnLine(points);
  const next = withPin === false ? line : appendLivePin(line, pin);
  if (next.length < 2) return [];
  return [next];
}
