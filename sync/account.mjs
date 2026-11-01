// Server-side Kinnex account. Kakao user id, Naver id, and recovery hash
// look up the same member id, room keys, and a 30-day journey/visit backup.
// An old googleSub field is kept on the record and ignored. Provider ids
// are never the family member id.
import { isKeyWrap, isSeal, isVault } from '../src/lib/familySeal.mjs';
import { NAVER_REDIRECT, allowedNaverRedirect } from '../src/lib/naverAuth.mjs';
import { listDisclosures, purgeExpiredDisclosureIndex, purgeExpiredDisclosures } from './disclosure.mjs';
import { diagReadAuthorized, forgetDiagReports, listDiagReports, purgeDiagReports, putDiagReport, readDiagReport } from './diag.mjs';
import { listHandling, recordHandling } from './handling.mjs';
import { mintInvite, redeemInvite } from './invite.mjs';

const MEMBER_ID = /^local-[a-z0-9]{3,64}$/;
const KEY_PART = /^[A-Za-z0-9_-]{16,64}$/;
const CODE_PART = /^\d{4,6}$/;
const PHOTO_URL = /^data:image\/(?:jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACCOUNT_ID = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ACCOUNT_BODY = 220 * 1024;
const MAX_PHOTO = 24_000;
const MAX_JOURNEYS = 40;
const MAX_JOURNEY_POINTS = 240;
const MAX_VISITS = 40;
const HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
const EARLIEST_AT = Date.UTC(2024, 0, 1);

export const ACCOUNT_SETUP_MESSAGE = '계정 확인을 마치지 못했습니다. 이 상태로 시작하지 않습니다.';
export const NAVER_SECRET_MESSAGE = '네이버 로그인 확인에 필요한 서버 비밀 NAVER_CLIENT_SECRET이 없습니다. 이 상태로 로그인하지 않습니다.';
export const ACCOUNT_LINK_CONFLICT_MESSAGE = '이 로그인은 다른 사람에 이미 연결되어 있습니다. 이 폰의 지도를 바꾸지 않았습니다.';
export const ACCOUNT_VERIFY_MESSAGE = '로그인 토큰이 거절되었습니다. 다시 로그인해 주세요.';
export const ACCOUNT_UNLINKED_MESSAGE = '이 로그인은 아직 이 계정에 연결되지 않았습니다.';
export const ACCOUNT_LINK_SESSION_MESSAGE = '이 폰의 계정 정보를 찾지 못했습니다. 복구 코드로 먼저 들어온 뒤 연결해 주세요.';
export const ACCOUNT_RECOVER_MESSAGE = '복구 코드를 확인하지 못했습니다. 코드를 다시 입력해 주세요.';
export const ACCOUNT_MISSING_MESSAGE = '저장된 계정을 찾지 못했습니다.';

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function randomKey(bytes = 16) {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function mintRecoveryCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
  return out;
}

export function normalizeRecoveryCode(value) {
  const raw = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 12) return '';
  if ([...raw].some((ch) => !RECOVERY_ALPHABET.includes(ch))) return '';
  return raw;
}

export function formatRecoveryCode(value) {
  const code = normalizeRecoveryCode(value);
  if (!code) return '';
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
}

export async function recoveryHash(code) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return '';
  return sha256Base64Url(`umap-recovery\0${normalized}`);
}

export function mintAccountKey() {
  return randomKey(24);
}

export async function accountKeyHash(key) {
  if (typeof key !== 'string' || !KEY_PART.test(key)) return '';
  return sha256Base64Url(`umap-account-key\0${key}`);
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

function looksLikePhone(value) {
  const compact = String(value ?? '').replace(/[\s\-().+]/g, '');
  if (!compact) return false;
  const digits = compact.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return false;
  return digits.length / compact.length >= 0.8;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 20);
  if (!name || looksLikePhone(name)) return '';
  return name;
}

function cleanPhoto(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > MAX_PHOTO || !PHOTO_URL.test(value)) return undefined;
  return value;
}

function cleanPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const lat = finiteNumber(point.lat);
  const lng = finiteNumber(point.lng);
  const at = finiteNumber(point.at);
  if (lat == null || lng == null || at == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const next = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), at: Math.round(at) };
  if (typeof point.speedMps === 'number' && point.speedMps >= 0 && point.speedMps < 400) {
    next.speedMps = Number(point.speedMps.toFixed(2));
  }
  if (typeof point.accuracyM === 'number' && point.accuracyM > 0 && point.accuracyM <= 80) {
    next.accuracyM = Math.round(point.accuracyM);
  }
  if (point.staying === true) next.staying = true;
  if (point.stayEnd === true) next.stayEnd = true;
  return next;
}

function cleanPlace(place) {
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

function cleanJourney(journey, now) {
  if (!journey || typeof journey !== 'object') return null;
  const startedAt = finiteNumber(journey.startedAt);
  const endedAt = finiteNumber(journey.endedAt);
  const distanceM = finiteNumber(journey.distanceM);
  if (startedAt == null || endedAt == null || distanceM == null || endedAt < startedAt) return null;
  if (startedAt < now - HISTORY_MS || endedAt > now + 5 * 60 * 1000) return null;
  const id = typeof journey.id === 'string' && journey.id.length <= 80 ? journey.id : '';
  if (!id) return null;
  const points = [];
  for (const point of Array.isArray(journey.points) ? journey.points : []) {
    const cleaned = cleanPoint(point);
    if (cleaned) points.push(cleaned);
    if (points.length >= MAX_JOURNEY_POINTS) break;
  }
  const start = cleanPlace(journey.start);
  const end = cleanPlace(journey.end);
  if (!start || !end || points.length < 2) return null;
  const next = {
    id,
    startedAt: Math.round(startedAt),
    endedAt: Math.round(endedAt),
    distanceM: Math.max(0, Math.round(distanceM)),
    points,
    start,
    end,
  };
  if (journey.cloud === true || journey.cloud === false) next.cloud = journey.cloud;
  return next;
}

function cleanVisit(visit, now) {
  if (!visit || typeof visit !== 'object') return null;
  const arrivedAt = finiteNumber(visit.arrivedAt);
  const lat = finiteNumber(visit.lat);
  const lng = finiteNumber(visit.lng);
  if (arrivedAt == null || lat == null || lng == null) return null;
  if (arrivedAt < now - HISTORY_MS || arrivedAt < EARLIEST_AT) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const id = typeof visit.id === 'string' && visit.id.length <= 120 ? visit.id : '';
  if (!id) return null;
  const label = typeof visit.label === 'string' ? visit.label.trim().slice(0, 120) : '';
  const leftAt = finiteNumber(visit.leftAt);
  return {
    id,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
    arrivedAt: Math.round(arrivedAt),
    leftAt: leftAt == null ? null : Math.round(leftAt),
    label: label && label !== '근처' ? label : null,
    source: visit.source === 'geocode' ? 'geocode' : 'coords',
  };
}

function cleanRoom(input) {
  if (!input || typeof input !== 'object') return null;
  const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '').slice(0, 6) : '';
  if (!CODE_PART.test(code)) return null;
  if (typeof input.writeKey !== 'string' || !KEY_PART.test(input.writeKey)) return null;
  if (typeof input.readKey !== 'string' || !KEY_PART.test(input.readKey)) return null;
  return { code, writeKey: input.writeKey, readKey: input.readKey };
}

function cleanGuardian(input) {
  if (!input || typeof input !== 'object') return null;
  const code = typeof input.code === 'string' ? input.code.replace(/\D/g, '').slice(0, 6) : '';
  if (!CODE_PART.test(code)) return null;
  const id = typeof input.id === 'string' && input.id.length <= 80 ? input.id : `g-${code}`;
  const label = cleanName(input.label) || '가족';
  const share = input.share === 'allowed' || input.share === 'revoked' ? input.share : 'accepted';
  const syncToken = typeof input.syncToken === 'string' && /^[A-Za-z0-9_-]{16,64}\.[A-Za-z0-9_-]{16,64}$/.test(input.syncToken)
    ? input.syncToken
    : undefined;
  const rosterName = typeof input.rosterName === 'string' ? input.rosterName.trim().slice(0, 80) : '';
  const adminName = cleanName(input.adminName);
  const next = { id, label, code, share };
  if (syncToken) next.syncToken = syncToken;
  if (rosterName) next.rosterName = rosterName;
  if (adminName) next.adminName = adminName;
  if (input.leaveAlert && typeof input.leaveAlert === 'object') {
    const lat = finiteNumber(input.leaveAlert.lat);
    const lng = finiteNumber(input.leaveAlert.lng);
    const radiusM = finiteNumber(input.leaveAlert.radiusM);
    if (lat != null && lng != null && radiusM != null) {
      next.leaveAlert = {
        label: typeof input.leaveAlert.label === 'string' ? input.leaveAlert.label.slice(0, 40) : '우리 집',
        lat,
        lng,
        radiusM: Math.min(2000, Math.max(50, Math.round(radiusM))),
      };
    }
  }
  return next;
}

function cleanHome(input) {
  if (!input || typeof input !== 'object') return null;
  const lat = finiteNumber(input.lat);
  const lng = finiteNumber(input.lng);
  if (lat == null || lng == null) return null;
  const radius = finiteNumber(input.radiusM);
  return {
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, 40) : '우리 집',
    address: typeof input.address === 'string' ? input.address.trim().slice(0, 80) : '',
    lat,
    lng,
    radiusM: radius == null ? 200 : Math.min(2000, Math.max(50, Math.round(radius))),
    alertPhone: '',
  };
}

export function cleanAccountSnapshot(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'snapshot' };
  if (typeof input.memberId !== 'string' || !MEMBER_ID.test(input.memberId)) return { error: 'member' };
  if (typeof input.profileKey !== 'string' || !KEY_PART.test(input.profileKey)) return { error: 'profile-key' };
  const name = cleanName(input.profile && input.profile.name);
  if (!name) return { error: 'name' };
  const photo = cleanPhoto(input.profile && input.profile.photo);
  if (photo === undefined && input.profile && input.profile.photo) return { error: 'photo' };
  const room = cleanRoom(input.room);
  if (!room) return { error: 'room' };
  const guardians = [];
  for (const item of Array.isArray(input.guardians) ? input.guardians : []) {
    const cleaned = cleanGuardian(item);
    if (cleaned && !guardians.some((entry) => entry.code === cleaned.code)) guardians.push(cleaned);
    if (guardians.length >= 8) break;
  }
  const vault = isVault(input.vault) ? input.vault : null;
  const sealedHistory = isSeal(input.sealedHistory)
    ? { v: 1, alg: 'A256GCM', kid: input.sealedHistory.kid, iv: input.sealedHistory.iv, ct: input.sealedHistory.ct }
    : null;
  const keepHistory = input.keepHistory === true && !sealedHistory;
  const journeys = [];
  const visits = [];
  if (!sealedHistory && !keepHistory) {
    for (const item of Array.isArray(input.journeys) ? input.journeys : []) {
      const cleaned = cleanJourney(item, now);
      if (cleaned) journeys.push(cleaned);
      if (journeys.length >= MAX_JOURNEYS) break;
    }
    for (const item of Array.isArray(input.visits) ? input.visits : []) {
      const cleaned = cleanVisit(item, now);
      if (cleaned) visits.push(cleaned);
      if (visits.length >= MAX_VISITS) break;
    }
  }
  return {
    snapshot: {
      memberId: input.memberId,
      profileKey: input.profileKey,
      profile: { name, photo: photo ?? null },
      room,
      guardians,
      home: sealedHistory ? null : cleanHome(input.home),
      journeys,
      visits,
      ...(vault ? { vault } : {}),
      ...(sealedHistory ? { sealedHistory } : {}),
      ...(keepHistory ? { keepHistory: true } : {}),
      ...(keepHistory && input.homeCleared === true && !cleanHome(input.home) ? { clearHome: true } : {}),
      ...(input.dropRecovery === true && vault ? { dropRecovery: true } : {}),
      ...(cleanRoster(input.roster).length ? { roster: cleanRoster(input.roster) } : {}),
      ...(cleanHistoryShares(input.historyShares) ? { historyShares: cleanHistoryShares(input.historyShares) } : {}),
    },
  };
}

function cleanRoster(input) {
  if (!Array.isArray(input)) return [];
  const roster = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim().slice(0, 80) : '';
    const name = cleanName(item.name);
    if (!id || id === 'self' || !name) continue;
    const row = { id, name };
    if (typeof item.role === 'string' && item.role.trim()) row.role = item.role.trim().slice(0, 20);
    if (typeof item.publisherId === 'string' && MEMBER_ID.test(item.publisherId)) row.publisherId = item.publisherId;
    if (typeof item.inviteCode === 'string' && CODE_PART.test(item.inviteCode)) row.inviteCode = item.inviteCode;
    roster.push(row);
    if (roster.length >= 12) break;
  }
  return roster;
}

function cleanHistoryShares(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const shares = {};
  for (const [id, wrap] of Object.entries(input)) {
    if (!MEMBER_ID.test(id) || !isKeyWrap(wrap)) continue;
    shares[id] = { epk: wrap.epk, iv: wrap.iv, ct: wrap.ct };
    if (Object.keys(shares).length >= 8) break;
  }
  return Object.keys(shares).length ? shares : null;
}

export function publicAccount(record, extras = {}) {
  if (!record) return null;
  return {
    memberId: record.memberId,
    profileKey: record.profileKey,
    profile: record.profile,
    room: record.room,
    guardians: record.guardians || [],
    home: record.clearHome ? null : (record.home || null),
    clearHome: record.clearHome === true,
    journeys: record.sealedHistory ? [] : (record.journeys || []),
    visits: record.sealedHistory ? [] : (record.visits || []),
    recoveryCode: record.recoveryCode ? formatRecoveryCode(record.recoveryCode) : '',
    vault: record.vault || null,
    sealedHistory: record.sealedHistory || null,
    ...(Array.isArray(record.roster) && record.roster.length ? { roster: record.roster } : {}),
    ...(record.historyShares ? { historyShares: record.historyShares } : {}),
    googleLinked: typeof record.googleSub === 'string' && record.googleSub.length > 0,
    kakaoLinked: typeof record.kakaoId === 'string' && record.kakaoId.length > 0,
    naverLinked: typeof record.naverId === 'string' && record.naverId.length > 0,
    nameChosen: record.nameChosen !== false,
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
    ...(extras.accountKey ? { accountKey: extras.accountKey } : {}),
    ...(extras.created ? { created: true } : {}),
  };
}

export function sameMember(left, right) {
  return !!left && !!right && left.memberId === right.memberId;
}

function accountKeys(record) {
  return {
    record: `acct:${record.id}`,
    member: `member:${record.memberId}`,
    session: `session:${record.sessionHash}`,
    recovery: `recovery:${record.recoveryHash}`,
    google: record.googleSub ? `google:${record.googleSub}` : '',
    kakao: record.kakaoId ? `kakao:${record.kakaoId}` : '',
    naver: record.naverId ? `naver:${record.naverId}` : '',
  };
}

export function createMemoryAccountStore() {
  const map = new Map();
  return {
    async get(key) {
      return map.get(key);
    },
    async put(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

async function readRecord(store, id) {
  if (typeof id !== 'string' || !ACCOUNT_ID.test(id)) return null;
  const record = await store.get(`acct:${id}`);
  return record && typeof record === 'object' ? record : null;
}

async function writeRecord(store, record, previous = null) {
  const keys = accountKeys(record);
  await store.put(keys.record, record);
  await store.put(keys.member, record.id);
  await store.put(keys.session, record.id);
  await store.put(keys.recovery, record.id);
  if (keys.google) await store.put(keys.google, record.id);
  if (keys.kakao) await store.put(keys.kakao, record.id);
  if (keys.naver) await store.put(keys.naver, record.id);
  if (previous?.googleSub && previous.googleSub !== record.googleSub) {
    await store.delete(`google:${previous.googleSub}`);
  }
  if (previous?.kakaoId && previous.kakaoId !== record.kakaoId) {
    await store.delete(`kakao:${previous.kakaoId}`);
  }
  if (previous?.naverId && previous.naverId !== record.naverId) {
    await store.delete(`naver:${previous.naverId}`);
  }
  if (previous?.sessionHash && previous.sessionHash !== record.sessionHash) {
    await store.delete(`session:${previous.sessionHash}`);
  }
  if (previous?.recoveryHash && previous.recoveryHash !== record.recoveryHash) {
    await store.delete(`recovery:${previous.recoveryHash}`);
  }
  if (previous?.memberId && previous.memberId !== record.memberId) {
    await store.delete(`member:${previous.memberId}`);
  }
}

async function findBySession(store, accountKey) {
  const hash = await accountKeyHash(accountKey);
  if (!hash) return null;
  return readRecord(store, await store.get(`session:${hash}`));
}

async function findByRecovery(store, code) {
  const hash = await recoveryHash(code);
  if (!hash) return null;
  return readRecord(store, await store.get(`recovery:${hash}`));
}

async function findByKakao(store, id) {
  if (typeof id !== 'string' || !/^[0-9]{3,20}$/.test(id)) return null;
  return readRecord(store, await store.get(`kakao:${id}`));
}

async function findByNaver(store, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(id)) return null;
  return readRecord(store, await store.get(`naver:${id}`));
}

async function findByMember(store, memberId) {
  if (typeof memberId !== 'string' || !MEMBER_ID.test(memberId)) return null;
  return readRecord(store, await store.get(`member:${memberId}`));
}

function mintLocalMemberId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'local-';
  for (const byte of bytes) id += alphabet[byte % 36];
  return id;
}

function mintRoomCode() {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  return String(10000 + ((bytes[0] << 8) | bytes[1]) % 90000);
}

function snapshotFromDisplayName(name) {
  return {
    memberId: mintLocalMemberId(),
    profileKey: randomKey(16),
    profile: { name: cleanName(name) || '가족', photo: null },
    room: { code: mintRoomCode(), writeKey: randomKey(16), readKey: randomKey(16) },
    guardians: [],
    home: null,
    journeys: [],
    visits: [],
  };
}

function sameProfileKey(record, snapshot) {
  return !!record && !!snapshot && record.profileKey === snapshot.profileKey;
}

async function mintRecord(snapshot, now, providers = {}) {
  const recoveryCode = mintRecoveryCode();
  const accountKey = mintAccountKey();
  const record = {
    id: randomKey(18),
    memberId: snapshot.memberId,
    profileKey: snapshot.profileKey,
    profile: snapshot.profile,
    room: snapshot.room,
    guardians: snapshot.guardians,
    home: snapshot.sealedHistory ? null : snapshot.home,
    journeys: snapshot.sealedHistory ? [] : snapshot.journeys,
    visits: snapshot.sealedHistory ? [] : snapshot.visits,
    ...(snapshot.vault ? { vault: snapshot.vault } : {}),
    ...(snapshot.sealedHistory ? { sealedHistory: snapshot.sealedHistory } : {}),
    ...(Array.isArray(snapshot.roster) && snapshot.roster.length ? { roster: snapshot.roster } : {}),
    ...(snapshot.historyShares ? { historyShares: snapshot.historyShares } : {}),
    googleSub: providers.googleSub || '',
    kakaoId: providers.kakaoId || '',
    naverId: providers.naverId || '',
    recoveryCode,
    recoveryHash: await recoveryHash(recoveryCode),
    sessionHash: await accountKeyHash(accountKey),
    nameChosen: providers.nameChosen === false ? false : true,
    createdAt: now,
    updatedAt: now,
  };
  return { record, accountKey };
}

function mergeSnapshot(record, snapshot, now) {
  if (snapshot.memberId !== record.memberId) return record;
  const next = {
    ...record,
    profileKey: snapshot.profileKey || record.profileKey,
    profile: snapshot.profile,
    room: snapshot.room,
    guardians: snapshot.guardians,
    nameChosen: true,
    updatedAt: now,
  };
  if (snapshot.vault) next.vault = snapshot.vault;
  if (Array.isArray(snapshot.roster)) next.roster = snapshot.roster;
  if (snapshot.historyShares) next.historyShares = snapshot.historyShares;
  if (snapshot.sealedHistory) {
    next.sealedHistory = snapshot.sealedHistory;
    next.journeys = [];
    next.visits = [];
    next.home = null;
    next.clearHome = false;
  } else if (!snapshot.keepHistory) {
    next.home = snapshot.home;
    next.journeys = snapshot.journeys;
    next.visits = snapshot.visits;
    next.clearHome = false;
  } else if (snapshot.clearHome === true) {
    next.home = null;
    next.clearHome = true;
  } else if (snapshot.home) {
    next.home = snapshot.home;
    next.clearHome = false;
  }
  if (snapshot.dropRecovery && next.vault) next.recoveryCode = '';
  return next;
}

async function attachSession(store, record, snapshot, now) {
  const accountKey = mintAccountKey();
  const next = {
    ...mergeSnapshot(record, snapshot, now),
    sessionHash: await accountKeyHash(accountKey),
  };
  await writeRecord(store, next, record);
  return { record: next, accountKey };
}

export async function registerAccount(store, snapshot, now = Date.now()) {
  const existing = await findByMember(store, snapshot.memberId);
  if (existing) {
    if (!sameProfileKey(existing, snapshot)) return { error: 'member' };
    const attached = await attachSession(store, existing, snapshot, now);
    return { ...attached, created: false };
  }
  const minted = await mintRecord(snapshot, now);
  await writeRecord(store, minted.record);
  return { record: minted.record, accountKey: minted.accountKey, created: true };
}

export async function backupAccount(store, accountKey, snapshot, now = Date.now()) {
  const current = await findBySession(store, accountKey);
  if (current) {
    if (snapshot.memberId !== current.memberId) return { error: 'member' };
    const next = mergeSnapshot(current, snapshot, now);
    await writeRecord(store, next, current);
    return { record: next, accountKey };
  }
  const existing = await findByMember(store, snapshot.memberId);
  if (!existing || !sameProfileKey(existing, snapshot)) return { error: 'account' };
  return attachSession(store, existing, snapshot, now);
}

export async function readAccount(store, accountKey) {
  const record = await findBySession(store, accountKey);
  if (!record) return { error: 'account' };
  return { record, accountKey };
}

export async function recoverAccount(store, code) {
  const normalized = normalizeRecoveryCode(code);
  if (!normalized) return { error: 'recovery' };
  const record = await findByRecovery(store, normalized);
  if (!record) return { error: 'recovery' };
  const accountKey = mintAccountKey();
  const next = { ...record, sessionHash: await accountKeyHash(accountKey), updatedAt: Date.now() };
  await writeRecord(store, next, record);
  return { record: next, accountKey };
}

function bearerToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token || token.length > 2048 || /\s/.test(token)) return '';
  return token;
}

function kakaoUserId(value) {
  const id = value == null ? '' : String(value);
  return /^[0-9]{3,20}$/.test(id) ? id : '';
}

function naverUserId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z0-9_-]{4,64}$/.test(id) ? id : '';
}

function naverClientId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || /your-|placeholder|example/i.test(id)) return '';
  if (id.length < 8 || id.length > 64) return '';
  return id;
}

function naverClientSecret(value) {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret || /your-|placeholder|example/i.test(secret)) return '';
  if (secret.length < 8 || secret.length > 128) return '';
  return secret;
}

function maskKakaoMsg(value) {
  return String(value || '')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/\b[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,}\b/gi, '[ip]')
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]');
}

function logKakaoFailure(failure) {
  const kakaoMsg = maskKakaoMsg(failure?.kakaoMsg).slice(0, 80);
  console.error(JSON.stringify({
    message: 'kakao verify failed',
    status: Number(failure?.status) || 0,
    kakaoCode: failure?.kakaoCode ?? '',
    kakaoMsg,
  }));
}

async function kakaoHttpFailure(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  const kakaoCode = body && (body.code ?? body.error_code ?? body.error);
  const kakaoMsg = typeof body?.msg === 'string'
    ? body.msg
    : (typeof body?.error_description === 'string' ? body.error_description : '');
  return {
    ok: false,
    status: response.status,
    kakaoCode: kakaoCode ?? '',
    kakaoMsg,
  };
}

async function defaultFetchKakaoUser(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  try {
    const info = await fetch('https://kapi.kakao.com/v1/user/access_token_info', { headers });
    if (!info.ok) return kakaoHttpFailure(info);
    const me = await fetch('https://kapi.kakao.com/v2/user/me', { headers });
    if (!me.ok) return kakaoHttpFailure(me);
    return { ok: true, profile: await me.json() };
  } catch {
    return { ok: false, status: 0, network: true, kakaoCode: '', kakaoMsg: '' };
  }
}

function kakaoReason(failure) {
  const msg = String(failure?.kakaoMsg || '').toLowerCase();
  if (msg.includes('ip mismatched') || msg.includes('ip mismatch')) return 'kakao_ip';
  const code = failure?.kakaoCode == null || failure.kakaoCode === '' ? 'rejected' : String(failure.kakaoCode);
  return `kakao_${code}`;
}

export function kakaoFailureResponse(failure) {
  const problem = failure && typeof failure === 'object' ? failure : { ok: false, status: 0, network: true };
  logKakaoFailure(problem);
  if (problem.network === true || problem.status === 0 || Number(problem.status) >= 500) {
    return json({ error: 'upstream' }, 502);
  }
  return json({
    error: 'token',
    reason: kakaoReason(problem),
    message: ACCOUNT_VERIFY_MESSAGE,
  }, 401);
}

function naverText(value, max = 80, hidden = []) {
  let text = maskKakaoMsg(typeof value === 'string' ? value : '');
  for (const secret of hidden) {
    if (typeof secret === 'string' && secret.length >= 4) text = text.split(secret).join('[redacted]');
  }
  return text.slice(0, max);
}

function logNaverFailure(step, detail) {
  console.error(JSON.stringify({ message: `naver ${step} failed`, ...detail }));
}

async function defaultFetchNaverUser(accessToken) {
  const response = await fetch('https://openapi.naver.com/v1/nid/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.resultcode !== '00') {
    logNaverFailure('me', {
      status: response.status,
      resultcode: naverText(body && body.resultcode, 8, [accessToken]),
      naverMsg: naverText(body && body.message, 80, [accessToken]),
    });
  }
  if (!response.ok) return null;
  return body;
}

async function defaultExchangeNaverCode({ code, state, clientId, clientSecret, redirectUri }) {
  // 명세 3.2와 예시 6.1.2에는 redirect_uri가 없고, 같은 문서의 언어별 샘플은 넣는다.
  // 빼면 지금 거절 원인이 달라지므로 인가 때와 같은 값을 폼에 한 번만 넣고, 실패 로그에는 포함 여부만 남긴다.
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('code', code);
  body.set('state', state);
  if (redirectUri) body.set('redirect_uri', redirectUri);
  const response = await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body,
  });
  // Naver answers token errors with HTTP 200 and {error, error_description}.
  const issued = await response.json().catch(() => null);
  const access = issued && typeof issued.access_token === 'string' ? issued.access_token.trim() : '';
  if (!response.ok || !issued || !access) {
    const hidden = [code, state, clientSecret, access];
    logNaverFailure('token', {
      status: response.status,
      naverError: naverText(issued && issued.error, 40, hidden),
      naverDesc: naverText(issued && issued.error_description, 80, hidden),
      keys: issued && typeof issued === 'object' ? Object.keys(issued).slice(0, 8) : [],
      redirectSent: Boolean(redirectUri),
    });
    return { error: (issued && issued.error) || `http_${response.status}` };
  }
  return issued;
}

export async function verifyKakaoAccessToken(accessToken, options = {}) {
  const token = bearerToken(accessToken);
  if (!token) return { ok: false, status: 401, kakaoCode: '', kakaoMsg: '' };
  const fetchUser = typeof options.fetchKakaoUser === 'function' ? options.fetchKakaoUser : defaultFetchKakaoUser;
  let fetched;
  try {
    fetched = await fetchUser(token);
  } catch {
    return { ok: false, status: 0, network: true, kakaoCode: '', kakaoMsg: '' };
  }
  if (!fetched) return { ok: false, status: 401, kakaoCode: '', kakaoMsg: '' };
  if (fetched.ok === false || fetched.network === true) {
    return {
      ok: false,
      status: fetched.network === true ? 0 : (Number(fetched.status) || 401),
      network: fetched.network === true || fetched.status === 0,
      kakaoCode: fetched.kakaoCode ?? '',
      kakaoMsg: typeof fetched.kakaoMsg === 'string' ? fetched.kakaoMsg : '',
    };
  }
  const profile = fetched.ok === true && fetched.profile ? fetched.profile : fetched;
  const id = kakaoUserId(profile && profile.id);
  if (!id) {
    return {
      ok: false,
      status: Number(fetched.status) || 401,
      kakaoCode: fetched.kakaoCode ?? '',
      kakaoMsg: typeof fetched.kakaoMsg === 'string' ? fetched.kakaoMsg : '',
    };
  }
  const name = cleanName(
    profile?.kakao_account?.profile?.nickname
    || profile?.properties?.nickname
    || '',
  );
  return { ok: true, id, name };
}

export function naverCallbackResponse(url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const oversized = (value, max) => typeof value === 'string' && value.length > max;
  if (oversized(code, 256) || oversized(state, 128) || oversized(error, 80)) {
    return json({ error: 'callback' }, 400);
  }
  const target = new URL(NAVER_REDIRECT);
  if (error && error.trim()) {
    target.searchParams.set('error', error.trim());
    if (state && state.trim()) target.searchParams.set('state', state.trim());
    return new Response(null, { status: 302, headers: { location: target.toString() } });
  }
  if (!code || !code.trim() || !state || !state.trim()) return json({ error: 'callback' }, 400);
  target.searchParams.set('code', code.trim());
  target.searchParams.set('state', state.trim());
  return new Response(null, { status: 302, headers: { location: target.toString() } });
}

export async function verifyNaverAccessToken(accessToken, options = {}) {
  const token = bearerToken(accessToken);
  if (!token) return { ok: false };
  const fetchUser = typeof options.fetchNaverUser === 'function' ? options.fetchNaverUser : defaultFetchNaverUser;
  const profile = await fetchUser(token).catch(() => null);
  const response = profile && profile.response;
  const id = naverUserId(response && response.id);
  if (!id || profile.resultcode !== '00') return { ok: false };
  const name = cleanName(response.nickname || response.name || '');
  return { ok: true, id, name };
}

export async function exchangeNaverAuthCode({ code, state, redirectUri, clientId, clientSecret, exchangeNaverCode }) {
  const authCode = typeof code === 'string' ? code.trim() : '';
  const csrf = typeof state === 'string' ? state.trim() : '';
  const redirect = allowedNaverRedirect(redirectUri);
  const id = naverClientId(clientId);
  const secret = naverClientSecret(clientSecret);
  if (!secret) return { error: 'naver-secret' };
  if (!id) return { error: 'setup' };
  if (!authCode || authCode.length > 256 || !csrf || csrf.length > 128 || !redirect) return { error: 'token' };
  const exchange = typeof exchangeNaverCode === 'function' ? exchangeNaverCode : defaultExchangeNaverCode;
  const issued = await exchange({
    code: authCode,
    state: csrf,
    redirectUri: redirect,
    clientId: id,
    clientSecret: secret,
  }).catch(() => null);
  const access = bearerToken(issued && issued.access_token);
  if (!access) {
    const why = issued && typeof issued.error === 'string' ? issued.error : 'no_access_token';
    return { error: 'token', reason: `naver_token_${naverText(why, 40, [authCode, csrf, secret])}` };
  }
  return { accessToken: access };
}

async function attachLinkedProvider(store, {
  existing,
  currentKey,
  snapshot,
  displayName,
  field,
  providerId,
  now,
  mode,
}) {
  const linking = mode === 'link';
  const current = currentKey ? await findBySession(store, currentKey) : null;
  if (linking) {
    if (current) {
      if (existing && current.id !== existing.id) return { error: 'member' };
      const next = { ...current, [field]: providerId, updatedAt: now };
      await writeRecord(store, next, current);
      return { record: next, accountKey: currentKey, linked: true };
    }
    if (!snapshot) return { error: 'link-session' };
    const found = await findByMember(store, snapshot.memberId);
    if (found && sameProfileKey(found, snapshot)) {
      if (existing && existing.id !== found.id) return { error: 'member' };
      const accountKey = mintAccountKey();
      const next = {
        ...mergeSnapshot(found, snapshot, now),
        [field]: providerId,
        sessionHash: await accountKeyHash(accountKey),
      };
      await writeRecord(store, next, found);
      return { record: next, accountKey, linked: true };
    }
    if (existing || found) return { error: 'member' };
    const minted = await mintRecord(snapshot, now, { [field]: providerId, nameChosen: true });
    await writeRecord(store, minted.record);
    return { record: minted.record, accountKey: minted.accountKey, created: true, linked: true };
  }
  if (existing) {
    const nextKey = mintAccountKey();
    const next = { ...existing, sessionHash: await accountKeyHash(nextKey), updatedAt: now };
    const named = cleanName(existing.profile && existing.profile.name);
    if (named && named !== '가족') next.nameChosen = true;
    await writeRecord(store, next, existing);
    return { record: next, accountKey: nextKey, restored: true };
  }
  if (current) {
    const next = { ...current, [field]: providerId, updatedAt: now };
    await writeRecord(store, next, current);
    return { record: next, accountKey: currentKey, linked: true };
  }
  const seed = snapshot || snapshotFromDisplayName(displayName);
  const minted = await mintRecord(seed, now, { [field]: providerId, nameChosen: Boolean(snapshot) });
  await writeRecord(store, minted.record);
  return { record: minted.record, accountKey: minted.accountKey, created: true };
}

export async function linkKakaoAccount(store, { accessToken, snapshot, accountKey, mode }, options = {}) {
  const verified = await verifyKakaoAccessToken(accessToken, options);
  if (!verified.ok) return { error: 'token', failure: verified };
  return attachLinkedProvider(store, {
    existing: await findByKakao(store, verified.id),
    currentKey: accountKey,
    snapshot,
    displayName: verified.name,
    field: 'kakaoId',
    providerId: verified.id,
    now: options.now || Date.now(),
    mode,
  });
}

export async function linkNaverAccount(store, { accessToken, code, state, redirectUri, snapshot, accountKey, mode }, options = {}) {
  let token = bearerToken(accessToken);
  if (!token && (code || state)) {
    const exchanged = await exchangeNaverAuthCode({
      code,
      state,
      redirectUri,
      clientId: options.naverClientId,
      clientSecret: options.naverClientSecret,
      exchangeNaverCode: options.exchangeNaverCode,
    });
    if (exchanged.error) return exchanged;
    token = exchanged.accessToken;
  }
  if (!token) return { error: 'token' };
  const verified = await verifyNaverAccessToken(token, options);
  if (!verified.ok) return { error: 'token', reason: 'naver_me' };
  return attachLinkedProvider(store, {
    existing: await findByNaver(store, verified.id),
    currentKey: accountKey,
    snapshot,
    displayName: verified.name,
    field: 'naverId',
    providerId: verified.id,
    now: options.now || Date.now(),
    mode,
  });
}

async function eraseRecord(store, record) {
  // disclosure:${memberId} is not an account key. Withdrawal leaves it until
  // purgeExpiredDisclosures drops entries older than six months.
  const keys = accountKeys(record);
  const indexes = [keys.member, keys.session, keys.recovery, keys.google, keys.kakao, keys.naver].filter(Boolean);
  for (const key of indexes) {
    const current = await store.get(key);
    if (current === record.id) await store.delete(key);
  }
  await store.delete(keys.record);
}

function createdRoomTarget(record) {
  const room = record?.room;
  if (!room || typeof room !== 'object') return null;
  const code = typeof room.code === 'string' ? room.code : '';
  if (!/^\d{4,6}$/.test(code)) return null;
  if (typeof room.writeKey !== 'string' || typeof room.readKey !== 'string') return null;
  return {
    code,
    writeKey: room.writeKey,
    readKey: room.readKey,
    memberId: record.memberId,
    deleteIfAlone: true,
  };
}

function guardianTargets(record) {
  const own = record?.room;
  const targets = [];
  for (const guardian of Array.isArray(record?.guardians) ? record.guardians : []) {
    if (!guardian || typeof guardian !== 'object') continue;
    const code = typeof guardian.code === 'string' ? guardian.code : '';
    const syncToken = typeof guardian.syncToken === 'string' ? guardian.syncToken : '';
    if (!/^\d{4,6}$/.test(code) || !syncToken) continue;
    if (own && own.code === code && syncToken.startsWith(`${own.writeKey}.`)) continue;
    targets.push({
      code,
      syncToken,
      memberId: record.memberId,
      deleteIfAlone: false,
    });
  }
  return targets;
}

async function leaveFamilyRooms(record, forgetMember) {
  if (typeof forgetMember !== 'function') return;
  const targets = [];
  const created = createdRoomTarget(record);
  if (created) targets.push(created);
  targets.push(...guardianTargets(record));
  await Promise.all(targets.map((target) => Promise.resolve(forgetMember(target)).catch(() => undefined)));
}

function unlinkSignal() {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(4000);
  return undefined;
}

async function unlinkKakao(kakaoId, options) {
  if (!kakaoId) return;
  if (typeof options.unlinkKakao === 'function') {
    await options.unlinkKakao(kakaoId);
    return;
  }
  const adminKey = typeof options.kakaoAdminKey === 'string' ? options.kakaoAdminKey.trim() : '';
  if (!adminKey || /your-|placeholder|example/i.test(adminKey)) return;
  await fetch('https://kapi.kakao.com/v1/user/unlink', {
    method: 'POST',
    headers: {
      Authorization: `KakaoAK ${adminKey}`,
      'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: new URLSearchParams({ target_id_type: 'user_id', target_id: kakaoId }),
    signal: unlinkSignal(),
  });
}

async function revokeNaver(record, options) {
  if (!record?.naverId) return;
  if (typeof options.revokeNaver === 'function') {
    await options.revokeNaver(record.naverId);
    return;
  }
  const token = bearerToken(options.naverAccessToken);
  const secret = naverClientSecret(options.naverClientSecret);
  const id = naverClientId(options.naverClientId);
  if (!token || !secret || !id) return;
  await fetch('https://nid.naver.com/oauth2.0/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams({
      grant_type: 'delete',
      client_id: id,
      client_secret: secret,
      access_token: token,
      service_provider: 'NAVER',
    }),
    signal: unlinkSignal(),
  });
}

async function bestEffortProviderUnlink(record, options) {
  await Promise.all([
    unlinkKakao(record.kakaoId, options).catch(() => undefined),
    revokeNaver(record, options).catch(() => undefined),
  ]);
}

export async function deleteAccount(store, accountKey, options = {}) {
  const record = await findBySession(store, accountKey);
  if (!record) return { error: 'account' };
  await leaveFamilyRooms(record, options.forgetMember);
  await bestEffortProviderUnlink(record, options);
  await purgeExpiredDisclosures(store, record.id, options.now || Date.now());
  await forgetDiagReports(store, record.id);
  await eraseRecord(store, record);
  return { ok: true };
}

export function accountError(code) {
  if (code === 'naver-secret') return json({ error: 'setup', message: NAVER_SECRET_MESSAGE }, 503);
  if (code === 'setup') return json({ error: 'setup', message: ACCOUNT_SETUP_MESSAGE }, 503);
  if (code === 'token') return json({ error: 'token', message: ACCOUNT_VERIFY_MESSAGE }, 401);
  if (code === 'unlinked') return json({ error: 'unlinked', message: ACCOUNT_UNLINKED_MESSAGE }, 404);
  if (code === 'link-session') return json({ error: 'link-session', message: ACCOUNT_LINK_SESSION_MESSAGE }, 404);
  if (code === 'recovery') return json({ error: 'recovery', message: ACCOUNT_RECOVER_MESSAGE }, 403);
  if (code === 'member') return json({ error: 'member', message: ACCOUNT_LINK_CONFLICT_MESSAGE }, 409);
  if (code === 'snapshot' || code === 'name' || code === 'room' || code === 'profile-key' || code === 'photo') {
    return json({ error: code }, 400);
  }
  return json({ error: 'account', message: ACCOUNT_MISSING_MESSAGE }, 404);
}

export async function parseAccountOperation(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (!path.startsWith('/v1/account') && !path.startsWith('/v1/invites') && !path.startsWith('/v1/diag')) return null;

  const accountKey = request.headers.get('x-umap-account-key') || '';

  if (path === '/v1/diag/recent') {
    if (request.method !== 'GET') return json({ error: 'method' }, 405);
    const limit = Number(url.searchParams.get('limit') || 20);
    return { kind: 'account-diag-recent', limit, authorization: request.headers.get('authorization') || '' };
  }
  const diagGet = path.match(/^\/v1\/diag\/([A-Za-z0-9_-]{16,64})$/);
  if (diagGet) {
    if (request.method !== 'GET') return json({ error: 'method' }, 405);
    return { kind: 'account-diag-get', id: diagGet[1] };
  }
  if (path === '/v1/diag') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
  }

  if (path === '/v1/account/disclosures' || path === '/v1/account/handling') {
    if (request.method === 'GET') {
      return { kind: path.endsWith('/handling') ? 'account-handling' : 'account-disclosures', accountKey };
    }
    return json({ error: 'method' }, 405);
  }

  const inviteRedeem = path.match(/^\/v1\/invites\/([A-Za-z0-9_-]{16,64})\/redeem$/);
  if (inviteRedeem) {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    return { kind: 'account-invite-redeem', ticket: inviteRedeem[1] };
  }
  if (path === '/v1/invites') {
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
  }

  if (request.method === 'GET' && path === '/v1/account') {
    return { kind: 'account-get', accountKey };
  }

  const declared = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declared) && declared > MAX_ACCOUNT_BODY) return json({ error: 'size' }, 413);
  let value = {};
  if (request.method !== 'GET') {
    const text = await request.text();
    if (text.length > MAX_ACCOUNT_BODY) return json({ error: 'size' }, 413);
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        return json({ error: 'json' }, 400);
      }
    }
  }

  if (request.method === 'POST' && path === '/v1/diag') {
    return { kind: 'account-diag-put', accountKey, events: value.events };
  }

  if (request.method === 'POST' && path === '/v1/invites') {
    return {
      kind: 'account-invite-mint',
      code: typeof value.code === 'string' ? value.code : '',
      syncToken: typeof value.syncToken === 'string' ? value.syncToken : '',
      memberId: typeof value.memberId === 'string' ? value.memberId : '',
    };
  }

  if (request.method === 'POST' && path === '/v1/account') {
    const cleaned = cleanAccountSnapshot(value);
    if (cleaned.error) return json({ error: cleaned.error }, 400);
    return { kind: 'account-register', snapshot: cleaned.snapshot };
  }

  if (request.method === 'PUT' && path === '/v1/account') {
    const cleaned = cleanAccountSnapshot(value);
    if (cleaned.error) return json({ error: cleaned.error }, 400);
    return { kind: 'account-put', accountKey, snapshot: cleaned.snapshot };
  }

  if (path === '/v1/account/google') {
    return json({ error: 'method' }, 404);
  }

  if (request.method === 'POST' && path === '/v1/account/kakao') {
    const cleaned = value.snapshot ? cleanAccountSnapshot(value.snapshot) : { snapshot: null };
    if (value.snapshot && cleaned.error) return json({ error: cleaned.error }, 400);
    return {
      kind: 'account-kakao',
      accessToken: typeof value.accessToken === 'string' ? value.accessToken : '',
      snapshot: cleaned.snapshot,
      accountKey: typeof value.accountKey === 'string' ? value.accountKey : accountKey,
      mode: value.mode === 'link' ? 'link' : 'login',
    };
  }

  if (request.method === 'POST' && path === '/v1/account/naver') {
    const cleaned = value.snapshot ? cleanAccountSnapshot(value.snapshot) : { snapshot: null };
    if (value.snapshot && cleaned.error) return json({ error: cleaned.error }, 400);
    return {
      kind: 'account-naver',
      accessToken: typeof value.accessToken === 'string' ? value.accessToken : '',
      code: typeof value.code === 'string' ? value.code : '',
      state: typeof value.state === 'string' ? value.state : '',
      redirectUri: typeof value.redirectUri === 'string' ? value.redirectUri : '',
      snapshot: cleaned.snapshot,
      accountKey: typeof value.accountKey === 'string' ? value.accountKey : accountKey,
      mode: value.mode === 'link' ? 'link' : 'login',
    };
  }

  if (request.method === 'POST' && path === '/v1/account/recover') {
    return { kind: 'account-recover', code: typeof value.code === 'string' ? value.code : '' };
  }

  if (request.method === 'DELETE' && path === '/v1/account') {
    return { kind: 'account-delete', accountKey };
  }

  return json({ error: 'method' }, 405);
}

export async function handleAccountOperation(store, op, options = {}) {
  const now = options.now || Date.now();
  await purgeExpiredDisclosureIndex(store, now);
  await purgeDiagReports(store, now).catch(() => undefined);
  if (op.kind === 'account-disclosure-purge') return json({ ok: true });
  if (op.kind === 'account-get') {
    const result = await readAccount(store, op.accountKey);
    if (result.error) return accountError(result.error);
    return json({ ok: true, account: publicAccount(result.record, { accountKey: result.accountKey }) });
  }
  if (op.kind === 'account-register') {
    const result = await registerAccount(store, op.snapshot, options.now);
    if (result.error) return accountError(result.error);
    return json({ ok: true, account: publicAccount(result.record, { accountKey: result.accountKey, created: result.created === true }) });
  }
  if (op.kind === 'account-put') {
    const result = await backupAccount(store, op.accountKey, op.snapshot, options.now);
    if (result.error) return accountError(result.error);
    return json({ ok: true, account: publicAccount(result.record, { accountKey: result.accountKey }) });
  }
  if (op.kind === 'account-kakao') {
    const result = await linkKakaoAccount(store, op, options);
    if (result.failure) return kakaoFailureResponse(result.failure);
    if (result.error) return accountError(result.error);
    return json({
      ok: true,
      restored: result.restored === true,
      account: publicAccount(result.record, { accountKey: result.accountKey, created: result.created === true }),
    });
  }
  if (op.kind === 'account-naver') {
    const result = await linkNaverAccount(store, op, options);
    if (result.error === 'token' && result.reason) {
      return json({ error: 'token', reason: result.reason, message: ACCOUNT_VERIFY_MESSAGE }, 401);
    }
    if (result.error) return accountError(result.error);
    return json({
      ok: true,
      restored: result.restored === true,
      account: publicAccount(result.record, { accountKey: result.accountKey, created: result.created === true }),
    });
  }
  if (op.kind === 'account-recover') {
    const result = await recoverAccount(store, op.code);
    if (result.error) return accountError(result.error);
    return json({
      ok: true,
      restored: true,
      account: publicAccount(result.record, { accountKey: result.accountKey }),
    });
  }
  if (op.kind === 'account-delete') {
    const result = await deleteAccount(store, op.accountKey, options);
    if (result.error) return accountError(result.error);
    return json({ ok: true });
  }
  if (op.kind === 'account-handling') {
    const record = await findBySession(store, op.accountKey);
    if (!record) return accountError('account');
    const listed = await listHandling(store, record.id, options.now || Date.now());
    if (listed.error) return accountError(listed.error);
    return json({ ok: true, retentionMonths: 6, intact: listed.intact === true, events: listed.events });
  }
  if (op.kind === 'account-handling-record') {
    const recorded = await recordHandling(store, op.event || {}, options.now || Date.now());
    if (recorded.error) return json({ error: recorded.error }, 400);
    return json({ ok: true, skipped: recorded.skipped === true });
  }
  if (op.kind === 'account-invite-mint') {
    const minted = await mintInvite(store, op, options.now || Date.now());
    if (minted.error) return json({ error: minted.error }, 400);
    return json({ ok: true, ticket: minted.ticket, exp: minted.exp });
  }
  if (op.kind === 'account-invite-redeem') {
    const redeemed = await redeemInvite(store, op.ticket, options.now || Date.now());
    if (redeemed.error === 'expired') return json({ error: 'expired', message: '초대 링크가 만료되었습니다. 새 초대를 받아 주세요.' }, 410);
    if (redeemed.error) return json({ error: 'invite', message: '초대 링크를 확인하지 못했습니다. 한 번 쓴 링크는 다시 열 수 없습니다.' }, 404);
    return json({ ok: true, code: redeemed.code, syncToken: redeemed.syncToken });
  }
  if (op.kind === 'account-diag-put') {
    const record = await findBySession(store, op.accountKey);
    if (!record) return accountError('account');
    const saved = await putDiagReport(store, {
      accountId: record.id,
      memberId: record.memberId,
      name: record.profile && record.profile.name,
      events: op.events,
    }, now);
    if (saved.error) return json({ error: saved.error }, 400);
    return json({ ok: true, id: saved.id, exp: saved.exp, count: saved.count });
  }
  if (op.kind === 'account-diag-recent') {
    const gate = await diagReadAuthorized(op.authorization, options.diagReadToken || '');
    if (gate === 'disabled') return json({ error: 'disabled' }, 404);
    if (gate !== 'ok') return json({ error: 'unauthorized' }, 401);
    const reports = await listDiagReports(store, op.limit, now);
    return json({ ok: true, reports });
  }
  if (op.kind === 'account-diag-get') {
    const report = await readDiagReport(store, op.id, now);
    if (!report) return json({ error: 'missing' }, 404);
    return json({ ok: true, id: report.id, exp: report.exp, events: report.events });
  }
  if (op.kind === 'account-disclosures') {
    const record = await findBySession(store, op.accountKey);
    if (!record) return accountError('account');
    const listed = await listDisclosures(store, record.id, options.now || Date.now());
    if (listed.error) return accountError(listed.error);
    return json({
      ok: true,
      retentionMonths: 6,
      intact: listed.intact === true,
      disclosures: listed.disclosures,
    });
  }
  return json({ error: 'method' }, 405);
}
