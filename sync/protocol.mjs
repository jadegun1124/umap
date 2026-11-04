// Family location room. The latest point per member id when the phone sends one,
// otherwise per consented name, plus a small profile (name and thumbnail).
// A rename keeps the fix because the storage key is the member id, and the old
// name key is dropped when it matches the current or prior name.
// The device profile key authorizes that member id. Readers never receive the key or its hash.
// Phone numbers are not accepted. The read key is never stored.
// Admin push subscriptions stay in the room and are never returned to readers.
// A chat subscription may also store the display name. The write token is enough
// for that name, so the other phone can receive that conversation. SOS still
// uses the read key. Endpoints are never returned.

import { isKeyWrap, isPublicKey, isSeal } from '../src/lib/familySeal.mjs';
import { base64UrlToBytes, pushEndpointAllowed } from './webpush.mjs';

const KEY_PART = /^[A-Za-z0-9_-]{16,64}$/;
const MEMBER_ID = /^local-[a-z0-9]{3,64}$/;
const PHOTO_URL = /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const CODE_PART = /^\d{4,6}$/;
const ALERT_ID = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_BODY = 4096;
const MAX_PROFILE_BODY = 32_768;
const MAX_TRAIL_BODY = 160 * 1024;
const MAX_TRAIL_POINTS = 800;
const MAX_TRAIL_JOURNEYS = 16;
const MAX_TRAIL_JOURNEY_POINTS = 240;
const MAX_PHOTO = 24_000;
const MAX_PLACES = 20;
const MAX_PROFILES = 20;
const MAX_ALERTS = 30;
const ALERT_TTL_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const EARLIEST_AT = Date.UTC(2024, 0, 1);

const MAX_PUSHES = 12;
const MAX_MESSAGES = 40;
const MAX_THREADS = 24;
const CHAT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_ID = /^[A-Za-z0-9_-]{8,80}$/;

export function emptyRoom() {
  return { places: {}, alerts: [], pushes: [], threads: {}, profiles: {}, owners: {}, trails: {}, seals: { kid: '', pubs: {}, wraps: {}, revoked: [] } };
}

/** Same pair on both phones. Keep identical to src/services/familyChat.ts chatThreadKey. */
export function chatThreadKey(left, right) {
  const a = typeof left === 'string' ? left.trim().slice(0, 20) : '';
  const b = typeof right === 'string' ? right.trim().slice(0, 20) : '';
  if (!a || !b || a === b) return '';
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function isKeyPart(value) {
  return typeof value === 'string' && KEY_PART.test(value);
}

export function splitSyncToken(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !isKeyPart(parts[0]) || !isKeyPart(parts[1])) return null;
  return { writeKey: parts[0], readKeyHash: parts[1] };
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function roomToken(code, writeKey, readKeyHash) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${code}\0${writeKey}\0${readKeyHash}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const length = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return diff === 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// Workers Free SQLite Durable Objects allow 100,000 rows written per day.
// The counter resets at 00:00 UTC, which is 09:00 in Korea.
export const STORAGE_QUOTA_MESSAGE = '위치 서버의 오늘 저장 한도를 넘었습니다. 오전 9시 이후에 다시 시도해 주세요.';

export function storageQuotaResponse(error) {
  const cause = error && error.cause && error.cause.message ? error.cause.message : '';
  const text = `${error && error.message ? error.message : ''} ${cause}`;
  if (!/exceeded allowed rows (?:written|read)|durable objects free tier/i.test(text)) return null;
  return json({ error: 'quota', message: STORAGE_QUOTA_MESSAGE }, 503);
}

export function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', '*');
  headers.set('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS');
  headers.set('access-control-allow-headers', 'content-type, x-umap-sync-key, x-umap-read-key, x-umap-profile-key, x-umap-account-key, x-umap-member');
  headers.set('access-control-max-age', '86400');
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, headers });
}

async function readJson(request, max = MAX_BODY) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > max) return { error: json({ error: 'size' }, 413) };
  const text = await request.text();
  if (text.length > max) return { error: json({ error: 'size' }, 413) };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: json({ error: 'json' }, 400) };
  }
}

function cleanStamp(at, now) {
  return typeof at === 'number' && Number.isFinite(at) && at >= EARLIEST_AT && at <= now + FUTURE_SKEW_MS;
}

function cleanAudience(input) {
  if (input.audience == null) return 'admin';
  if (input.audience === 'admin' || input.audience === 'family') return input.audience;
  return null;
}

function cleanBattery(input, sharing) {
  if (!sharing) return { batteryPct: null, charging: null };
  let batteryPct = null;
  if (input.batteryPct != null) {
    const value = Number(input.batteryPct);
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    batteryPct = Math.round(value);
  }
  let charging = null;
  if (input.charging != null) {
    if (typeof input.charging !== 'boolean') return null;
    charging = input.charging;
  }
  return { batteryPct, charging };
}

function cleanPlace(input, code, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: json({ error: 'place' }, 400) };
  if (input.code !== code || !CODE_PART.test(code)) return { error: json({ error: 'code' }, 400) };
  if (typeof input.name !== 'string') return { error: json({ error: 'name' }, 400) };
  const name = input.name.trim().slice(0, 80);
  if (!name) return { error: json({ error: 'name' }, 400) };
  if (typeof input.sharing !== 'boolean') return { error: json({ error: 'sharing' }, 400) };
  if (!cleanStamp(input.at, now)) return { error: json({ error: 'at' }, 400) };
  const audience = cleanAudience(input);
  if (!audience) return { error: json({ error: 'audience' }, 400) };
  const battery = cleanBattery(input, input.sharing);
  if (!battery) return { error: json({ error: 'battery' }, 400) };

  const seal = isSeal(input.seal) ? { v: 1, alg: 'A256GCM', kid: input.seal.kid, iv: input.seal.iv, ct: input.seal.ct } : null;
  let lat = input.lat;
  let lng = input.lng;
  if (seal) {
    lat = null;
    lng = null;
  } else if (!input.sharing || lat == null || lng == null) {
    if (input.sharing && (lat != null || lng != null)) return { error: json({ error: 'coords' }, 400) };
    lat = null;
    lng = null;
  } else if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { error: json({ error: 'coords' }, 400) };
  }

  let accuracyM = Number(input.accuracyM);
  if (seal || !Number.isFinite(accuracyM) || accuracyM < 0) accuracyM = 0;
  accuracyM = Math.min(100_000, Math.round(accuracyM));

  let memberId = '';
  if (input.memberId != null && input.memberId !== '') {
    if (typeof input.memberId !== 'string' || !MEMBER_ID.test(input.memberId)) return { error: json({ error: 'member' }, 400) };
    memberId = input.memberId;
  }
  let priorName = '';
  if (typeof input.priorName === 'string') {
    const trimmed = input.priorName.trim().slice(0, 80);
    if (trimmed && trimmed !== name && !looksLikePhone(trimmed)) priorName = trimmed;
  }

  return {
    place: {
      code,
      name,
      lat,
      lng,
      accuracyM,
      at: input.at,
      sharing: input.sharing,
      audience,
      batteryPct: battery.batteryPct,
      charging: battery.charging,
      ...(memberId ? { memberId } : {}),
      ...(priorName ? { priorName } : {}),
      ...(seal ? { seal } : {}),
    },
  };
}

function cleanProfilePhoto(input) {
  if (!Object.prototype.hasOwnProperty.call(input, 'photo') || input.photo == null) {
    return Object.prototype.hasOwnProperty.call(input, 'photo') ? { photo: null } : { photo: undefined };
  }
  if (typeof input.photo !== 'string' || input.photo.length > MAX_PHOTO || !PHOTO_URL.test(input.photo)) {
    return { error: json({ error: 'photo' }, 400) };
  }
  return { photo: input.photo };
}

function cleanProfileInput(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: json({ error: 'profile' }, 400) };
  if (typeof input.memberId !== 'string' || !MEMBER_ID.test(input.memberId)) return { error: json({ error: 'member' }, 400) };
  if (typeof input.name !== 'string') return { error: json({ error: 'name' }, 400) };
  const name = input.name.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name || looksLikePhone(name)) return { error: json({ error: 'name' }, 400) };
  if (!cleanStamp(input.at, now)) return { error: json({ error: 'at' }, 400) };
  const photo = cleanProfilePhoto(input);
  if (photo.error) return photo;
  return {
    profile: {
      memberId: input.memberId,
      name,
      at: input.at,
      ...(photo.photo === undefined ? {} : { photo: photo.photo }),
    },
  };
}

function cleanMotionTargets(input, from) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 8) return null;
  const names = [];
  for (const item of input) {
    const name = cleanChatName(item);
    if (!name || names.includes(name)) return null;
    if (name === from) continue;
    names.push(name);
  }
  return names.length ? names : null;
}

function cleanAlert(input, code, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: json({ error: 'alert' }, 400) };
  if (typeof input.id !== 'string' || !ALERT_ID.test(input.id)) return { error: json({ error: 'alert' }, 400) };
  if (input.kind !== 'sos' && input.kind !== 'leave' && input.kind !== 'motion') return { error: json({ error: 'alert' }, 400) };
  if (input.code !== code) return { error: json({ error: 'code' }, 400) };
  if (typeof input.from !== 'string' || typeof input.body !== 'string') return { error: json({ error: 'alert' }, 400) };
  const from = input.from.trim().slice(0, 80);
  const body = input.body.trim().slice(0, 200);
  if (!from || !body) return { error: json({ error: 'alert' }, 400) };
  if (!cleanStamp(input.at, now)) return { error: json({ error: 'at' }, 400) };
  if (input.kind !== 'motion' && input.to != null) return { error: json({ error: 'alert' }, 400) };
  const alert = { id: input.id, kind: input.kind, code, from, body, at: input.at };
  if (input.kind === 'motion') {
    const to = cleanMotionTargets(input.to, from);
    if (!to) return { error: json({ error: 'alert' }, 400) };
    alert.to = to;
  }
  return { alert };
}

function legacyStorageKey(place, name) {
  return place.audience === 'family' ? `family\u0000${name}` : name;
}

export function previousPlaceSharing(room, place) {
  if (!place || !room || !room.places) return undefined;
  const current = adoptCurrent(room.places, place);
  if (!current || typeof current.sharing !== 'boolean') return undefined;
  return current.sharing;
}

// Ordinary live fixes wait 8s between room rewrites. A stop, a leave, or any
// sharing flip is not a live fix and must hit storage on this request.
export function shouldHoldPlaceWrite({ previousSharing, sharing, lastPersistedAt, at }) {
  if (sharing !== true) return false;
  if (previousSharing === false) return false;
  if (typeof lastPersistedAt !== 'number' || lastPersistedAt <= 0) return false;
  if (typeof at !== 'number') return false;
  return at >= lastPersistedAt && at - lastPersistedAt < 8000;
}

function placeStorageKey(place) {
  if (place.memberId) {
    return place.audience === 'family' ? `id\u0000family\u0000${place.memberId}` : `id\u0000${place.memberId}`;
  }
  return legacyStorageKey(place, place.name);
}

function aliasNames(place) {
  const names = [];
  if (place.name) names.push(place.name);
  if (place.priorName && place.priorName !== place.name) names.push(place.priorName);
  return names;
}

function sameAudience(left, right) {
  return (left?.audience === 'family') === (right?.audience === 'family');
}

function samePlaceSnapshot(current, place) {
  return current.sharing === place.sharing
    && current.lat === place.lat
    && current.lng === place.lng
    && (current.seal?.ct || '') === (place.seal?.ct || '')
    && current.accuracyM === place.accuracyM
    && current.name === place.name
    && (current.memberId || '') === (place.memberId || '')
    && (current.batteryPct ?? null) === (place.batteryPct ?? null)
    && (current.charging ?? null) === (place.charging ?? null)
    && sameAudience(current, place);
}

function hasFix(place) {
  return !!place && place.sharing === true && (isSeal(place.seal) || (place.lat != null && place.lng != null));
}

function isPlaceholder(place) {
  return !!place && place.sharing === true && !isSeal(place.seal) && place.lat == null && place.lng == null;
}

function adoptCurrent(places, place) {
  const key = placeStorageKey(place);
  let current = places[key];
  if (!place.memberId) return current;
  for (const alias of aliasNames(place)) {
    const found = places[legacyStorageKey(place, alias)];
    if (!found || (found.memberId && found.memberId !== place.memberId)) continue;
    if (!current || found.at > current.at) current = found;
  }
  for (const found of Object.values(places)) {
    if (!found || found.memberId !== place.memberId || !sameAudience(found, place)) continue;
    if (!current || found.at > current.at) current = found;
  }
  return current;
}

function withoutStaleAliases(places, place, kept) {
  if (!place.memberId || !kept) return places;
  const next = { ...places };
  let changed = false;
  const drop = (slot, found) => {
    if (!found || !sameAudience(found, place)) return;
    if (found.memberId && found.memberId !== place.memberId) return;
    if (found.at > kept.at) return;
    if (!Object.prototype.hasOwnProperty.call(next, slot)) return;
    delete next[slot];
    changed = true;
  };
  for (const alias of aliasNames(place)) drop(legacyStorageKey(place, alias), next[legacyStorageKey(place, alias)]);
  const canonical = placeStorageKey(place);
  for (const [slot, found] of Object.entries(next)) {
    if (slot === canonical || !found || found.memberId !== place.memberId) continue;
    drop(slot, found);
  }
  return changed ? next : places;
}

function finishAliases(room, place, kept) {
  const places = withoutStaleAliases(room.places || {}, place, kept);
  if (places === (room.places || {})) return { room, ignored: true };
  return { room: { ...room, places }, ignored: false };
}

export function applyPlace(room, place) {
  const source = room.places || {};
  const key = placeStorageKey(place);
  const current = adoptCurrent(source, place);
  const incomingFix = hasFix(place);
  const currentFix = hasFix(current);
  const stored = source[key];
  // A heartbeat with no coordinates must not erase a live fix or move its cursor forward.
  if (place.sharing && !incomingFix && currentFix) return finishAliases(room, place, stored && hasFix(stored) ? stored : null);
  // A sharing heartbeat with no fix can be newer than the first real fix. The fix still wins.
  // A newer stop (sharing false) is not a placeholder, so an older fix cannot undo it.
  if (current && place.at < current.at && !(incomingFix && isPlaceholder(current))) {
    return finishAliases(room, place, stored && stored.at >= current.at ? stored : null);
  }
  let next = place;
  if (place.sharing && next.batteryPct == null && current && typeof current.batteryPct === 'number') {
    next = {
      ...next,
      batteryPct: current.batteryPct,
      charging: next.charging == null ? (current.charging ?? null) : next.charging,
    };
  }
  if (current && next.at === current.at && samePlaceSnapshot(current, next)) {
    return finishAliases(room, place, stored || null);
  }
  let places = withoutStaleAliases({ ...source, [key]: next }, place, next);
  const names = Object.keys(places);
  if (names.length > MAX_PLACES) {
    names.sort((left, right) => places[left].at - places[right].at);
    while (names.length > MAX_PLACES) {
      const oldest = names.shift();
      if (oldest) delete places[oldest];
    }
  }
  let nextRoom = { ...room, places };
  if (!place.sharing && place.memberId && nextRoom.trails && nextRoom.trails[place.memberId]) {
    const trails = { ...nextRoom.trails };
    delete trails[place.memberId];
    nextRoom = { ...nextRoom, trails };
  }
  return { room: nextRoom, ignored: false };
}

function roomProfiles(room) {
  return room.profiles && typeof room.profiles === 'object' ? room.profiles : {};
}

export function applyProfile(room, profile) {
  const profiles = { ...roomProfiles(room) };
  const current = profiles[profile.memberId];
  const photo = profile.photo === undefined ? (current ? current.photo ?? null : null) : profile.photo;
  const next = { memberId: profile.memberId, name: profile.name, photo, at: profile.at };
  if (current && profile.at < current.at) return { room, ignored: true };
  if (
    current
    && current.name === next.name
    && (current.photo ?? null) === (next.photo ?? null)
    && current.at === next.at
  ) {
    return { room, ignored: true };
  }
  profiles[profile.memberId] = next;
  const ids = Object.keys(profiles);
  if (ids.length > MAX_PROFILES) {
    ids.sort((left, right) => profiles[left].at - profiles[right].at);
    while (ids.length > MAX_PROFILES) {
      const oldest = ids.shift();
      if (oldest) delete profiles[oldest];
    }
  }
  return { room: { ...room, profiles }, ignored: false };
}

function viewProfiles(room) {
  return Object.values(roomProfiles(room)).map((profile) => ({
    memberId: profile.memberId,
    name: profile.name,
    photo: profile.photo ?? null,
    at: profile.at,
  }));
}

function roomOwners(room) {
  return room.owners && typeof room.owners === 'object' ? room.owners : {};
}

export async function authorizeReader(room, memberId, profileKey) {
  const owners = roomOwners(room);
  if (!Object.keys(owners).length) return { error: null };
  if (typeof memberId !== 'string' || !MEMBER_ID.test(memberId)) return { error: json({ error: 'member' }, 403) };
  if (typeof profileKey !== 'string' || !isKeyPart(profileKey)) return { error: json({ error: 'profile-key' }, 403) };
  const seals = room.seals && typeof room.seals === 'object' ? room.seals : {};
  if (Array.isArray(seals.revoked) && seals.revoked.includes(memberId)) return { error: json({ error: 'revoked' }, 403) };
  const current = owners[memberId];
  if (!current) return { error: json({ error: 'member' }, 403) };
  const hash = await sha256Base64Url(profileKey);
  if (!safeEqual(current, hash)) return { error: json({ error: 'profile-key' }, 403) };
  return { error: null };
}

export async function authorizeMember(room, memberId, profileKey) {
  if (typeof profileKey !== 'string' || !isKeyPart(profileKey)) return { error: json({ error: 'profile-key' }, 403) };
  const seals = room.seals && typeof room.seals === 'object' ? room.seals : {};
  if (Array.isArray(seals.revoked) && seals.revoked.includes(memberId)) return { error: json({ error: 'revoked' }, 403) };
  const hash = await sha256Base64Url(profileKey);
  const owners = roomOwners(room);
  const current = owners[memberId];
  if (current && !safeEqual(current, hash)) return { error: json({ error: 'profile-key' }, 403) };
  if (current) return { room, error: null };
  return { room: { ...room, owners: { ...owners, [memberId]: hash } }, error: null };
}

export async function commitPlace(room, place, profileKey) {
  let nextRoom = room;
  if (place.memberId) {
    const auth = await authorizeMember(nextRoom, place.memberId, profileKey || '');
    if (auth.error) return { error: auth.error, room, ignored: true };
    nextRoom = auth.room;
  }
  const applied = applyPlace(nextRoom, place);
  return { error: null, room: applied.room, ignored: applied.ignored && nextRoom === room };
}

export async function commitProfile(room, profile, profileKey) {
  const auth = await authorizeMember(room, profile.memberId, profileKey || '');
  if (auth.error) return { error: auth.error, room, ignored: true };
  const applied = applyProfile(auth.room, profile);
  return { error: null, room: applied.room, ignored: applied.ignored && auth.room === room };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanTrailPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const lat = finiteNumber(point.lat);
  const lng = finiteNumber(point.lng);
  const at = finiteNumber(point.at);
  if (lat == null || lng == null || at == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const next = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), at: Math.round(at) };
  if (typeof point.speedMps === 'number' && point.speedMps >= 0 && point.speedMps < 400) next.speedMps = Number(point.speedMps.toFixed(2));
  if (typeof point.accuracyM === 'number' && point.accuracyM > 0 && point.accuracyM <= 80) next.accuracyM = Math.round(point.accuracyM);
  if (point.staying === true) next.staying = true;
  if (point.stayEnd === true) next.stayEnd = true;
  return next;
}

function cleanTrailPlace(place) {
  if (!place || typeof place !== 'object') return null;
  const lat = finiteNumber(place.lat);
  const lng = finiteNumber(place.lng);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const label = typeof place.label === 'string' ? place.label.trim().slice(0, 56) : '';
  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    label: label && label !== '근처' ? label : null,
  };
}

function cleanTrailJourney(journey) {
  if (!journey || typeof journey !== 'object') return null;
  const startedAt = finiteNumber(journey.startedAt);
  const endedAt = finiteNumber(journey.endedAt);
  const distanceM = finiteNumber(journey.distanceM);
  if (startedAt == null || endedAt == null || distanceM == null || endedAt < startedAt) return null;
  const id = typeof journey.id === 'string' && journey.id.length <= 80 ? journey.id : '';
  if (!id) return null;
  const points = [];
  for (const point of Array.isArray(journey.points) ? journey.points : []) {
    const cleaned = cleanTrailPoint(point);
    if (cleaned) points.push(cleaned);
    if (points.length >= MAX_TRAIL_JOURNEY_POINTS) break;
  }
  const start = cleanTrailPlace(journey.start);
  const end = cleanTrailPlace(journey.end);
  if (!start || !end || points.length < 2) return null;
  return {
    id,
    startedAt: Math.round(startedAt),
    endedAt: Math.round(endedAt),
    distanceM: Math.max(0, Math.round(distanceM)),
    points,
    start,
    end,
  };
}

export function cleanTrailInput(body, now) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: json({ error: 'trail' }, 400) };
  if (typeof body.memberId !== 'string' || !MEMBER_ID.test(body.memberId)) return { error: json({ error: 'trail' }, 400) };
  const at = finiteNumber(body.at);
  if (at == null || at < EARLIEST_AT || at > now + FUTURE_SKEW_MS) return { error: json({ error: 'trail' }, 400) };
  const seal = isSeal(body.seal) ? { v: 1, alg: 'A256GCM', kid: body.seal.kid, iv: body.seal.iv, ct: body.seal.ct } : null;
  if (seal) {
    return {
      trail: {
        memberId: body.memberId,
        at: Math.round(at),
        moving: body.moving === true,
        points: [],
        journeys: [],
        seal,
      },
    };
  }
  const points = [];
  for (const point of Array.isArray(body.points) ? body.points : []) {
    const cleaned = cleanTrailPoint(point);
    if (cleaned) points.push(cleaned);
    if (points.length >= MAX_TRAIL_POINTS) break;
  }
  const journeys = [];
  for (const journey of Array.isArray(body.journeys) ? body.journeys : []) {
    const cleaned = cleanTrailJourney(journey);
    if (cleaned) journeys.push(cleaned);
    if (journeys.length >= MAX_TRAIL_JOURNEYS) break;
  }
  return {
    trail: {
      memberId: body.memberId,
      at: Math.round(at),
      moving: body.moving === true,
      points,
      journeys,
    },
  };
}

export function applyTrail(room, trail) {
  const trails = { ...(room.trails && typeof room.trails === 'object' ? room.trails : {}) };
  const current = trails[trail.memberId];
  if (current && trail.at < current.at) return { room, ignored: true };
  if (current && trail.at === current.at && JSON.stringify(current) === JSON.stringify(trail)) return { room, ignored: true };
  trails[trail.memberId] = trail;
  return { room: { ...room, trails }, ignored: false };
}

export async function commitTrail(room, trail, profileKey) {
  const auth = await authorizeMember(room, trail.memberId, profileKey || '');
  if (auth.error) return { error: auth.error, room, ignored: true };
  const applied = applyTrail(auth.room, trail);
  return { error: null, room: applied.room, ignored: applied.ignored && auth.room === room };
}

function viewTrails(room) {
  const trails = room.trails && typeof room.trails === 'object' ? room.trails : {};
  return Object.values(trails);
}

export function applyAlert(room, alert, now) {
  if (room.alerts.some((item) => item.id === alert.id)) return { room, ignored: true };
  const alerts = [...room.alerts, alert].filter((item) => now - item.at < ALERT_TTL_MS).slice(-MAX_ALERTS);
  return { room: { ...room, alerts }, ignored: false };
}

function looksLikePhone(value) {
  const compact = String(value ?? '').replace(/[\s\-().+]/g, '');
  if (!compact) return false;
  const digits = compact.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false;
  return digits.length / compact.length >= 0.8;
}

function cleanChatName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().slice(0, 20);
  if (!name || looksLikePhone(name)) return '';
  return name;
}

function cleanChat(input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: json({ error: 'chat' }, 400) };
  if (typeof input.id !== 'string' || !CHAT_ID.test(input.id)) return { error: json({ error: 'chat' }, 400) };
  const from = cleanChatName(input.from);
  const to = cleanChatName(input.to);
  if (!from || !to || from === to) return { error: json({ error: 'chat' }, 400) };
  if (typeof input.text !== 'string') return { error: json({ error: 'chat' }, 400) };
  const text = input.text.trim().slice(0, 200);
  if (!text || looksLikePhone(text)) return { error: json({ error: 'chat' }, 400) };
  if (!cleanStamp(input.at, now)) return { error: json({ error: 'at' }, 400) };
  return { message: { id: input.id, from, to, text, at: input.at } };
}

function roomThreads(room) {
  const threads = room && room.threads;
  if (!threads || typeof threads !== 'object' || Array.isArray(threads)) return {};
  return threads;
}

function publicMessage(message) {
  return { id: message.id, from: message.from, to: message.to, text: message.text, at: message.at };
}

export function applyDirectMessage(room, message, now) {
  const key = chatThreadKey(message.from, message.to);
  if (!key) return { room, ignored: true };
  const threads = { ...roomThreads(room) };
  for (const list of Object.values(threads)) {
    if (Array.isArray(list) && list.some((item) => item.id === message.id)) return { room, ignored: true };
  }
  const current = Array.isArray(threads[key]) ? threads[key] : [];
  threads[key] = [...current, message].filter((item) => now - item.at < CHAT_TTL_MS).slice(-MAX_MESSAGES);
  const lastAt = (list) => (Array.isArray(list) && list.length ? list[list.length - 1].at || 0 : 0);
  const keys = Object.keys(threads).sort((left, right) => lastAt(threads[left]) - lastAt(threads[right]));
  while (keys.length > MAX_THREADS) delete threads[keys.shift()];
  const next = { ...room, threads };
  delete next.messages;
  return { room: next, ignored: false };
}

export function viewDirectMessages(room, me, peer) {
  const key = chatThreadKey(me, peer);
  if (!key) return null;
  const list = roomThreads(room)[key];
  return { messages: (Array.isArray(list) ? list : []).map(publicMessage) };
}

export function viewMyThreads(room, me) {
  const name = cleanChatName(me);
  if (!name) return null;
  const threads = [];
  for (const [key, list] of Object.entries(roomThreads(room))) {
    const parts = key.split('\0');
    if (parts.length !== 2 || (parts[0] !== name && parts[1] !== name) || !Array.isArray(list)) continue;
    threads.push({
      peer: parts[0] === name ? parts[1] : parts[0],
      messages: list.map(publicMessage),
    });
  }
  return { threads };
}

function roomPushes(room) {
  return Array.isArray(room.pushes) ? room.pushes : [];
}

export function applySubscription(room, subscription) {
  const pushes = roomPushes(room).filter((item) => item.endpoint !== subscription.endpoint);
  pushes.push(subscription);
  while (pushes.length > MAX_PUSHES) pushes.shift();
  return { ...room, pushes };
}

export function pushesForChat(room, message) {
  if (!message || !message.to) return [];
  return roomPushes(room).filter((item) => item && item.name === message.to && item.name !== message.from);
}

export function pushesForAlert(room, alert) {
  const from = alert && typeof alert.from === 'string' ? alert.from : '';
  const pushes = roomPushes(room).filter((item) => item && item.endpoint && (!item.name || item.name !== from));
  if (!alert || alert.kind !== 'motion') return pushes;
  const names = new Set(Array.isArray(alert.to) ? alert.to : []);
  return pushes.filter((item) => item.name && names.has(item.name));
}

export function chatPushPayload(message, code) {
  const text = typeof message.text === 'string' ? message.text : '';
  const preview = text.length > 80 ? `${text.slice(0, 79)}…` : text;
  return {
    id: message.id,
    kind: 'chat',
    code: typeof code === 'string' ? code : '',
    from: message.from,
    to: message.to,
    title: message.from,
    body: preview,
    text,
    at: message.at,
  };
}

export function removeSubscriptions(room, endpoints) {
  const gone = new Set(endpoints);
  return { ...room, pushes: roomPushes(room).filter((item) => !gone.has(item.endpoint)) };
}

function viewKeys(room) {
  const seals = room.seals && typeof room.seals === 'object' ? room.seals : {};
  return {
    kid: typeof seals.kid === 'string' ? seals.kid : '',
    pubs: seals.pubs && typeof seals.pubs === 'object' ? seals.pubs : {},
    wraps: seals.wraps && typeof seals.wraps === 'object' ? seals.wraps : {},
    revoked: Array.isArray(seals.revoked) ? seals.revoked.filter((id) => typeof id === 'string') : [],
    history: seals.history && typeof seals.history === 'object' ? seals.history : {},
  };
}

export function viewRoom(room, since) {
  const cursor = Number.isFinite(since) ? since : 0;
  return {
    places: Object.values(room.places || {}),
    departed: departedMemberIds(room, 'family'),
    alerts: (room.alerts || []).filter((alert) => alert.at > cursor),
    profiles: viewProfiles(room),
    trails: viewTrails(room),
    keys: viewKeys(room),
  };
}

function cleanSubscription(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: json({ error: 'push' }, 400) };
  if (typeof input.endpoint !== 'string' || input.endpoint.length > 500 || !pushEndpointAllowed(input.endpoint)) {
    return { error: json({ error: 'push' }, 400) };
  }
  if (typeof input.p256dh !== 'string' || typeof input.auth !== 'string') return { error: json({ error: 'push' }, 400) };
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(input.p256dh) || !/^[A-Za-z0-9_-]{16,200}$/.test(input.auth)) {
    return { error: json({ error: 'push' }, 400) };
  }
  let publicKey;
  let auth;
  try {
    publicKey = base64UrlToBytes(input.p256dh);
    auth = base64UrlToBytes(input.auth);
  } catch {
    return { error: json({ error: 'push' }, 400) };
  }
  if (publicKey.length !== 65 || publicKey[0] !== 4 || auth.length < 16 || auth.length > 32) {
    return { error: json({ error: 'push' }, 400) };
  }
  const name = cleanChatName(typeof input.name === 'string' ? input.name : '');
  const subscription = { endpoint: input.endpoint, p256dh: input.p256dh, auth: input.auth };
  if (name) subscription.name = name;
  return { subscription };
}

export function departedMemberIds(room, audience = 'family') {
  const live = new Set();
  for (const place of Object.values(room.places || {})) {
    if (!place || place.sharing !== true) continue;
    if (audience && place.audience !== audience) continue;
    if (typeof place.memberId === 'string' && place.memberId) live.add(place.memberId);
  }
  const ids = [];
  const seen = new Set();
  for (const place of Object.values(room.places || {})) {
    if (!place || place.sharing !== false) continue;
    if (audience && place.audience !== audience) continue;
    if (typeof place.memberId !== 'string' || !place.memberId || seen.has(place.memberId)) continue;
    if (live.has(place.memberId)) continue;
    seen.add(place.memberId);
    ids.push(place.memberId);
  }
  return ids;
}

export function viewFamilyPlaces(room) {
  const places = [];
  const byMember = new Map();
  for (const place of Object.values(room.places || {})) {
    if (!place || place.audience !== 'family' || !place.sharing) continue;
    if (!isSeal(place.seal) && (place.lat == null || place.lng == null)) continue;
    if (typeof place.memberId === 'string' && place.memberId) {
      const prev = byMember.get(place.memberId);
      if (!prev || (place.at || 0) >= (prev.at || 0)) byMember.set(place.memberId, place);
      continue;
    }
    places.push(place);
  }
  return {
    places: [...byMember.values(), ...places],
    departed: departedMemberIds(room, 'family'),
    profiles: viewProfiles(room),
    trails: viewTrails(room),
    keys: viewKeys(room),
  };
}

function roomSeals(room) {
  const seals = room.seals && typeof room.seals === 'object' ? room.seals : {};
  return {
    kid: typeof seals.kid === 'string' ? seals.kid : '',
    pubs: seals.pubs && typeof seals.pubs === 'object' ? { ...seals.pubs } : {},
    wraps: seals.wraps && typeof seals.wraps === 'object' ? { ...seals.wraps } : {},
    revoked: Array.isArray(seals.revoked) ? seals.revoked.filter((id) => typeof id === 'string') : [],
    history: seals.history && typeof seals.history === 'object' ? seals.history : {},
  };
}

function cleanWraps(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const wraps = {};
  for (const [memberId, wrap] of Object.entries(input)) {
    if (!MEMBER_ID.test(memberId) || !isKeyWrap(wrap)) continue;
    wraps[memberId] = { epk: wrap.epk, iv: wrap.iv, ct: wrap.ct };
  }
  return wraps;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function roomPersistStamp(room) {
  return stableJson({
    owners: roomOwners(room),
    seals: roomSeals(room),
  });
}

export const KEY_PUT_WINDOW_MS = 45_000;
// One sync publishes the public key, then wraps, then history. A hard
// single-write window drops those follow-ups. Four changed writes is enough
// for that pass; a tight loop cannot store more until the window moves.
export const KEY_PUT_BURST = 4;

export function keyPutLimited(lastAt, now, windowMs = KEY_PUT_WINDOW_MS) {
  return typeof lastAt === 'number' && Number.isFinite(lastAt) && now - lastAt < windowMs;
}

function keyPutSlot(memory, memberId, now) {
  if (!memory || !memberId) return null;
  const stored = memory.get(memberId);
  const slot = typeof stored === 'number'
    ? { at: stored, writes: 1 }
    : (stored && typeof stored.at === 'number' ? { at: stored.at, writes: stored.writes || 0 } : null);
  if (!slot || !keyPutLimited(slot.at, now)) return null;
  return slot;
}

export async function applyKeyPut(room, input, profileKey, memory, now = Date.now()) {
  const memberId = input && typeof input.memberId === 'string' ? input.memberId : '';
  const next = await commitKeys(room, input, profileKey);
  if (next.error) return { error: next.error, room: next.room || room, directory: null, wrote: false, limited: false };
  const slot = keyPutSlot(memory, memberId, now);
  if (next.unchanged) {
    if (memory && memberId && !slot) memory.set(memberId, { at: now, writes: 0 });
    return { error: null, room, directory: next.directory, wrote: false, limited: false };
  }
  if (slot && slot.writes >= KEY_PUT_BURST) {
    return { error: null, room, directory: viewKeys(room), wrote: false, limited: true };
  }
  if (memory && memberId) {
    memory.set(memberId, {
      at: slot ? slot.at : now,
      writes: (slot ? slot.writes : 0) + 1,
    });
  }
  return { error: null, room: next.room, directory: next.directory, wrote: true, limited: false };
}

export async function commitKeys(room, input, profileKey) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: json({ error: 'keys' }, 400) };
  if (typeof input.memberId !== 'string' || !MEMBER_ID.test(input.memberId)) return { error: json({ error: 'member' }, 400) };
  if (!isPublicKey(input.publicKey)) return { error: json({ error: 'keys' }, 400) };
  const before = roomPersistStamp(room);
  const auth = await authorizeMember(room, input.memberId, profileKey || '');
  if (auth.error) return { error: auth.error, room };
  const seals = roomSeals(auth.room);
  seals.pubs[input.memberId] = input.publicKey;
  const incoming = cleanWraps(input.wraps);
  const kid = typeof input.kid === 'string' && KEY_PART.test(input.kid) ? input.kid : '';
  if (kid && Object.keys(incoming).length) {
    if (input.rotate === true || !seals.kid || seals.kid === kid) {
      seals.kid = kid;
      seals.wraps = input.rotate === true ? incoming : { ...seals.wraps, ...incoming };
    }
  }
  if (input.history && typeof input.history === 'object' && !Array.isArray(input.history)) {
    const history = seals.history && typeof seals.history === 'object' ? { ...seals.history } : {};
    for (const [ownerId, shares] of Object.entries(input.history)) {
      if (!MEMBER_ID.test(ownerId)) continue;
      history[ownerId] = { ...(history[ownerId] || {}), ...cleanWraps(shares) };
    }
    seals.history = history;
  }
  if (typeof input.revoke === 'string' && MEMBER_ID.test(input.revoke) && input.revoke !== input.memberId) {
    if (!seals.revoked.includes(input.revoke)) seals.revoked.push(input.revoke);
    delete seals.pubs[input.revoke];
    delete seals.wraps[input.revoke];
  }
  for (const id of seals.revoked) {
    delete seals.pubs[id];
    delete seals.wraps[id];
  }
  const next = { ...auth.room, seals };
  const unchanged = roomPersistStamp(next) === before;
  return { error: null, room: unchanged ? room : next, directory: viewKeys(unchanged ? room : next), unchanged };
}

export async function parseOperation(request) {
  const url = new URL(request.url);
  if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/health/')) {
    return { kind: 'health' };
  }

  if (request.method === 'GET' && url.pathname.replace(/\/+$/, '') === '/v1/naver/callback') {
    const { naverCallbackResponse } = await import('./account.mjs');
    return naverCallbackResponse(url);
  }

  const { parseAccountOperation } = await import('./account.mjs');
  const accountOp = await parseAccountOperation(request);
  if (accountOp) return accountOp;

  if (request.method === 'GET' && (url.pathname === '/v1/push/vapid' || url.pathname === '/v1/push/vapid/')) {
    return { kind: 'vapid-public' };
  }

  const match = url.pathname.match(/^\/v1\/rooms\/(\d{4,6})(\/place|\/profile|\/alert|\/family|\/push|\/chat|\/trail|\/keys)?\/?$/);
  if (!match) return json({ error: 'not-found' }, 404);
  const code = match[1];
  const action = match[2] || '';
  const token = splitSyncToken(request.headers.get('x-umap-sync-key') || '');
  if (!token) return json({ error: 'sync-key' }, 401);
  const id = await roomToken(code, token.writeKey, token.readKeyHash);

  if (request.method === 'GET' && action === '/family') {
    return {
      kind: 'family',
      token: id,
      viewerId: request.headers.get('x-umap-member') || '',
      profileKey: request.headers.get('x-umap-profile-key') || '',
    };
  }

  if (request.method === 'GET' && action === '/chat') {
    const me = cleanChatName(url.searchParams.get('me') || '');
    const peer = (url.searchParams.get('with') || '').trim();
    if (!me) return json({ error: 'chat' }, 400);
    if (peer && !cleanChatName(peer)) return json({ error: 'chat' }, 400);
    if (peer && cleanChatName(peer) === me) return json({ error: 'chat' }, 400);
    return { kind: 'chat-get', token: id, me, peer: peer ? cleanChatName(peer) : '' };
  }

  if (request.method === 'GET' && action === '') {
    const readKey = request.headers.get('x-umap-read-key') || '';
    if (!isKeyPart(readKey)) return json({ error: 'read-key' }, 403);
    const actual = await sha256Base64Url(readKey);
    if (!safeEqual(actual, token.readKeyHash)) return json({ error: 'read-key' }, 403);
    const since = Number(url.searchParams.get('since') || 0);
    return {
      kind: 'get',
      token: id,
      since: Number.isFinite(since) ? since : 0,
      viewerId: request.headers.get('x-umap-member') || '',
      profileKey: request.headers.get('x-umap-profile-key') || '',
    };
  }

  if (request.method === 'DELETE' && action === '') {
    const readKey = request.headers.get('x-umap-read-key') || '';
    if (!isKeyPart(readKey)) return json({ error: 'read-key' }, 403);
    const actual = await sha256Base64Url(readKey);
    if (!safeEqual(actual, token.readKeyHash)) return json({ error: 'read-key' }, 403);
    return { kind: 'delete', token: id };
  }

  if (request.method === 'PUT' && action === '/place') {
    const body = await readJson(request);
    if (body.error) return body.error;
    const cleaned = cleanPlace(body.value, code, Date.now());
    if (cleaned.error) return cleaned.error;
    return {
      kind: 'place',
      token: id,
      place: cleaned.place,
      profileKey: request.headers.get('x-umap-profile-key') || '',
    };
  }

  if (request.method === 'PUT' && action === '/keys') {
    const body = await readJson(request, 32_768);
    if (body.error) return body.error;
    return {
      kind: 'keys',
      token: id,
      keys: body.value,
      profileKey: request.headers.get('x-umap-profile-key') || '',
    };
  }

  if (request.method === 'PUT' && action === '/trail') {
    const body = await readJson(request, MAX_TRAIL_BODY);
    if (body.error) return body.error;
    const cleaned = cleanTrailInput(body.value, Date.now());
    if (cleaned.error) return cleaned.error;
    return {
      kind: 'trail',
      token: id,
      trail: cleaned.trail,
      profileKey: request.headers.get('x-umap-profile-key') || '',
    };
  }

  if (request.method === 'PUT' && action === '/profile') {
    const body = await readJson(request, MAX_PROFILE_BODY);
    if (body.error) return body.error;
    const cleaned = cleanProfileInput(body.value, Date.now());
    if (cleaned.error) return cleaned.error;
    return {
      kind: 'profile',
      token: id,
      profile: cleaned.profile,
      profileKey: request.headers.get('x-umap-profile-key') || '',
    };
  }

  if ((request.method === 'PUT' || request.method === 'DELETE') && action === '/push') {
    const readKey = request.headers.get('x-umap-read-key') || '';
    let hasRead = false;
    if (isKeyPart(readKey)) {
      const actual = await sha256Base64Url(readKey);
      hasRead = safeEqual(actual, token.readKeyHash);
    }
    const body = await readJson(request);
    if (body.error) return body.error;
    if (request.method === 'DELETE') {
      if (!hasRead) return json({ error: 'read-key' }, 403);
      const endpoint = body.value && typeof body.value.endpoint === 'string' ? body.value.endpoint : '';
      if (!pushEndpointAllowed(endpoint)) return json({ error: 'push' }, 400);
      return { kind: 'push-remove', token: id, endpoints: [endpoint] };
    }
    const cleaned = cleanSubscription(body.value);
    if (cleaned.error) return cleaned.error;
    if (!hasRead && !cleaned.subscription.name) return json({ error: 'read-key' }, 403);
    return { kind: 'push-subscribe', token: id, subscription: cleaned.subscription };
  }

  if (request.method === 'POST' && action === '/chat') {
    const body = await readJson(request);
    if (body.error) return body.error;
    const cleaned = cleanChat(body.value, Date.now());
    if (cleaned.error) return cleaned.error;
    return { kind: 'chat', token: id, code, message: cleaned.message };
  }

  if (request.method === 'POST' && action === '/alert') {
    const body = await readJson(request);
    if (body.error) return body.error;
    const cleaned = cleanAlert(body.value, code, Date.now());
    if (cleaned.error) return cleaned.error;
    return { kind: 'alert', token: id, alert: cleaned.alert };
  }

  return json({ error: 'method' }, 405);
}

export function alertPushPayload(alert) {
  if (alert && alert.kind === 'motion') {
    const text = typeof alert.body === 'string' ? alert.body : '';
    return {
      id: alert.id,
      kind: 'motion',
      code: alert.code,
      from: alert.from,
      to: Array.isArray(alert.to) ? alert.to : [],
      title: text,
      body: text,
      at: alert.at,
    };
  }
  return {
    id: alert.id,
    kind: alert.kind,
    title: alert.kind === 'sos' ? 'SOS' : '집 반경을 나갔습니다',
    body: alert.body,
  };
}

export function roomHasOtherMembers(room, memberId) {
  const id = typeof memberId === 'string' ? memberId : '';
  const places = room?.places && typeof room.places === 'object' ? Object.values(room.places) : [];
  for (const place of places) {
    if (!place || typeof place !== 'object') continue;
    if (typeof place.memberId === 'string' && place.memberId && place.memberId !== id) return true;
  }
  for (const bucket of ['profiles', 'owners', 'trails']) {
    const map = room?.[bucket];
    if (!map || typeof map !== 'object') continue;
    for (const key of Object.keys(map)) {
      if (key && key !== id) return true;
    }
  }
  return false;
}

export function stripMember(room, memberId) {
  const id = typeof memberId === 'string' ? memberId : '';
  const source = room && typeof room === 'object' ? room : emptyRoom();
  const places = {};
  for (const [key, place] of Object.entries(source.places || {})) {
    if (place && place.memberId === id) continue;
    places[key] = place;
  }
  const drop = (map) => {
    const next = { ...(map && typeof map === 'object' ? map : {}) };
    if (id) delete next[id];
    return next;
  };
  return {
    ...source,
    places,
    profiles: drop(source.profiles),
    owners: drop(source.owners),
    trails: drop(source.trails),
    seals: {
      kid: source.seals?.kid || '',
      pubs: drop(source.seals?.pubs),
      wraps: drop(source.seals?.wraps),
      revoked: Array.isArray(source.seals?.revoked) ? source.seals.revoked : [],
    },
  };
}

export function planForgetMember(room, memberId, deleteIfAlone) {
  const current = room && typeof room === 'object' ? room : emptyRoom();
  if (deleteIfAlone && !roomHasOtherMembers(current, memberId)) {
    return { deleted: true, room: emptyRoom() };
  }
  return { deleted: false, room: stripMember(current, memberId) };
}

export async function memberRoomToken(target) {
  if (!target || typeof target !== 'object') return '';
  const code = typeof target.code === 'string' ? target.code.replace(/\D/g, '').slice(0, 6) : '';
  if (!CODE_PART.test(code)) return '';
  const parts = splitSyncToken(target.syncToken);
  const writeKey = parts?.writeKey || target.writeKey;
  if (!isKeyPart(writeKey)) return '';
  const readKeyHash = parts?.readKeyHash || (isKeyPart(target.readKey) ? await sha256Base64Url(target.readKey) : '');
  if (!readKeyHash) return '';
  return roomToken(code, writeKey, readKeyHash);
}

export async function forgetMemberInStore(store, target) {
  const token = await memberRoomToken(target);
  const memberId = typeof target?.memberId === 'string' ? target.memberId : '';
  if (!token || !memberId || !store) return { ok: false };
  const room = (await store.read(token)) || emptyRoom();
  const plan = planForgetMember(room, memberId, target.deleteIfAlone === true);
  if (plan.deleted) {
    if (typeof store.delete === 'function') await store.delete(token);
    else await store.write(token, emptyRoom());
    return { ok: true, deleted: true };
  }
  await store.write(token, plan.room);
  return { ok: true, deleted: false };
}

async function logLocationUse(accounts, viewerId, view, now) {
  if (!accounts || typeof viewerId !== 'string' || !viewerId || !view) return;
  const { recordHandling } = await import('./handling.mjs');
  const seen = new Set();
  for (const place of Array.isArray(view.places) ? view.places : []) {
    if (!place || typeof place.memberId !== 'string' || place.memberId === viewerId || seen.has(`p:${place.memberId}`)) continue;
    seen.add(`p:${place.memberId}`);
    await recordHandling(accounts, {
      kind: 'use',
      memberId: place.memberId,
      actor: viewerId,
      categories: ['location'],
      at: now,
    }, now).catch(() => undefined);
  }
  for (const trail of Array.isArray(view.trails) ? view.trails : []) {
    if (!trail || typeof trail.memberId !== 'string' || trail.memberId === viewerId || seen.has(`t:${trail.memberId}`)) continue;
    seen.add(`t:${trail.memberId}`);
    await recordHandling(accounts, {
      kind: 'use',
      memberId: trail.memberId,
      actor: viewerId,
      categories: ['history'],
      at: now,
    }, now).catch(() => undefined);
  }
}

export async function handleSyncRequest(store, request, extras = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  const op = await parseOperation(request);
  if (op instanceof Response) return op;
  if (op.kind === 'health') return json({ ok: true, service: 'umap-family-sync' });
  if (op.kind === 'vapid-public') return json({ error: 'vapid' }, 501);
  if (typeof op.kind === 'string' && op.kind.startsWith('account-')) {
    const { createMemoryAccountStore, handleAccountOperation } = await import('./account.mjs');
    const accounts = extras.accounts || extras.accountStore || createMemoryAccountStore();
    const forgetMember = typeof extras.forgetMember === 'function'
      ? extras.forgetMember
      : (target) => forgetMemberInStore(store, target);
    return handleAccountOperation(accounts, op, {
      fetchKakaoUser: extras.fetchKakaoUser,
      fetchNaverUser: extras.fetchNaverUser,
      exchangeNaverCode: extras.exchangeNaverCode,
      naverClientId: extras.naverClientId || '',
      naverClientSecret: extras.naverClientSecret || '',
      naverAccessToken: extras.naverAccessToken || '',
      kakaoAdminKey: extras.kakaoAdminKey || '',
      diagReadToken: extras.diagReadToken || '',
      unlinkKakao: extras.unlinkKakao,
      revokeNaver: extras.revokeNaver,
      forgetMember,
      now: extras.now,
    });
  }

  const room = (await store.read(op.token)) || emptyRoom();
  if (op.kind === 'get') {
    const auth = await authorizeReader(room, op.viewerId, op.profileKey);
    if (auth.error) return auth.error;
    const view = viewRoom(room, op.since);
    await logLocationUse(extras.accounts, op.viewerId, view, extras.now || Date.now());
    return json(view);
  }
  if (op.kind === 'family') {
    const auth = await authorizeReader(room, op.viewerId, op.profileKey);
    if (auth.error) return auth.error;
    const view = viewFamilyPlaces(room);
    await logLocationUse(extras.accounts, op.viewerId, view, extras.now || Date.now());
    return json(view);
  }
  if (op.kind === 'chat-get') {
    const view = op.peer ? viewDirectMessages(room, op.me, op.peer) : viewMyThreads(room, op.me);
    if (!view) return json({ error: 'chat' }, 400);
    return json(view);
  }
  if (op.kind === 'chat') {
    const next = applyDirectMessage(room, op.message, Date.now());
    if (!next.ignored) await store.write(op.token, next.room);
    return json(viewDirectMessages(next.room, op.message.from, op.message.to) || { messages: [] });
  }
  if (op.kind === 'place') {
    const next = await commitPlace(room, op.place, op.profileKey || '');
    if (next.error) return next.error;
    if (!next.ignored) {
      await store.write(op.token, next.room);
      if (extras.accounts && op.place && op.place.memberId) {
        const { recordHandling } = await import('./handling.mjs');
        await recordHandling(extras.accounts, {
          kind: 'collect',
          memberId: op.place.memberId,
          actor: op.place.memberId,
          categories: ['location'],
          at: op.place.at,
        }, extras.now || Date.now()).catch(() => undefined);
      }
    }
    return json({ ok: true });
  }
  if (op.kind === 'profile') {
    const next = await commitProfile(room, op.profile, op.profileKey || '');
    if (next.error) return next.error;
    if (!next.ignored) await store.write(op.token, next.room);
    return json({ ok: true });
  }
  if (op.kind === 'trail') {
    const next = await commitTrail(room, op.trail, op.profileKey || '');
    if (next.error) return next.error;
    if (!next.ignored) {
      await store.write(op.token, next.room);
      if (extras.accounts && op.trail && op.trail.memberId) {
        const { recordHandling } = await import('./handling.mjs');
        await recordHandling(extras.accounts, {
          kind: 'collect',
          memberId: op.trail.memberId,
          actor: op.trail.memberId,
          categories: ['history'],
          at: op.trail.at || Date.now(),
        }, extras.now || Date.now()).catch(() => undefined);
      }
    }
    return json({ ok: true });
  }
  if (op.kind === 'keys') {
    if (!store.keyPutAt) store.keyPutAt = new Map();
    const next = await applyKeyPut(room, op.keys, op.profileKey || '', store.keyPutAt, extras.now || Date.now());
    if (next.error) return next.error;
    if (next.wrote) await store.write(op.token, next.room);
    return json({ ok: true, keys: next.directory });
  }
  if (op.kind === 'alert') {
    const next = applyAlert(room, op.alert, Date.now());
    if (!next.ignored) await store.write(op.token, next.room);
    return json({ ok: true });
  }
  if (op.kind === 'push-subscribe') {
    await store.write(op.token, applySubscription(room, op.subscription));
    return json({ ok: true });
  }
  if (op.kind === 'push-remove') {
    await store.write(op.token, removeSubscriptions(room, op.endpoints || []));
    return json({ ok: true });
  }
  if (op.kind === 'delete') {
    if (typeof store.delete === 'function') await store.delete(op.token);
    else await store.write(op.token, emptyRoom());
    return json({ ok: true });
  }
  return json({ error: 'method' }, 405);
}

export function createMemoryStore() {
  const rooms = new Map();
  return {
    async read(token) {
      return rooms.get(token) || emptyRoom();
    },
    async write(token, room) {
      rooms.set(token, room);
    },
    async delete(token) {
      rooms.delete(token);
    },
  };
}

export async function syncTokenFor(writeKey, readKey) {
  return `${writeKey}.${await sha256Base64Url(readKey)}`;
}
