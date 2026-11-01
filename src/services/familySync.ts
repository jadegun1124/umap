import { noteDiag } from '../lib/diagLog.mjs';
import { openJson, sealJson, mintFamilyKey, unwrapFamilyKey, wrapFamilyKey } from '../lib/familySeal.mjs';
import { HISTORY_SHARE_KID, contentKeyBytes, ensureDevice, familyKeyRecord, rememberFamilyKey, rewrapHistoryShares } from '../lib/familyVault.mjs';
import { rememberPlaceName } from '../lib/placeAlias.mjs';
import { optionalRouteMissing } from '../lib/syncRoute.mjs';
import type { FamilyAlert } from './familyAlert';
import { chatName, isFamilyChatMessage, type FamilyChatMessage } from './familyChat';
import type { SharedPlace, SharedProfile } from './familyShare';

// Keep the hash identical to sync/protocol.mjs.
// sha256Base64Url('umap-read-key') === 'BL04F54qEIA94kVM3un2L2ITH4kcV-H8m2JJNnuuHVQ'

const KEY_PART = /^[A-Za-z0-9_-]{16,64}$/;

export type SyncPhase = 'off' | 'connecting' | 'live' | 'down' | 'rejected';

export function isKeyPart(value: unknown): value is string {
  return typeof value === 'string' && KEY_PART.test(value);
}

export function splitSyncToken(token: string | null | undefined): { writeKey: string; readKeyHash: string } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !isKeyPart(parts[0]) || !isKeyPart(parts[1])) return null;
  return { writeKey: parts[0], readKeyHash: parts[1] };
}

export function createKeyPart(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

const hashCache = new Map<string, Promise<string>>();

export function syncTokenFor(writeKey: string, readKey: string): Promise<string> {
  let pending = hashCache.get(readKey);
  if (!pending) {
    pending = sha256Base64Url(readKey);
    hashCache.set(readKey, pending);
  }
  return pending.then((hash) => `${writeKey}.${hash}`);
}

export function familySyncUrl(): string | null {
  const raw = (import.meta.env.VITE_FAMILY_SYNC_URL ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.origin;
  } catch {
    /* 잘못된 주소는 없는 것과 같이 봅니다. */
  }
  return null;
}

export function familySyncConfigured(): boolean {
  return familySyncUrl() != null;
}

type Listener = (phase: SyncPhase) => void;
const listeners = new Set<Listener>();
let phase: SyncPhase = familySyncConfigured() ? 'connecting' : 'off';

function setPhase(next: SyncPhase) {
  if (phase === next) return;
  phase = next;
  for (const listener of listeners) listener(phase);
}

export function currentSyncPhase(): SyncPhase {
  return phase;
}

export function subscribeSyncPhase(listener: Listener): () => void {
  listeners.add(listener);
  listener(phase);
  return () => {
    listeners.delete(listener);
  };
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const base = familySyncUrl();
  if (!base) throw new Error('off');
  return fetch(`${base}${path}`, { ...init, signal: timeoutSignal(8000), cache: 'no-store' });
}

async function noteStatus(response: Response): Promise<string> {
  let error = '';
  if (response.status === 401 || response.status === 403) {
    try {
      const body = await response.clone().json() as { error?: unknown };
      if (body && typeof body.error === 'string') error = body.error;
    } catch {
      error = '';
    }
  }
  if (response.ok || error === 'member') setPhase('live');
  else if (response.status === 401 || response.status === 403) setPhase('rejected');
  else setPhase('down');
  return error;
}

let placeQueue: { code: string; token: string; body: Record<string, unknown>; profileKey: string } | null = null;
let trailQueue: { code: string; token: string; body: Record<string, unknown>; profileKey: string } | null = null;
let profileQueue: { code: string; token: string; body: Record<string, unknown>; profileKey: string } | null = null;
let alertQueue: { alert: FamilyAlert; token: string } | null = null;
let flushing = false;
let retryMs = 3000;
let syncEpoch = 0;

const MAX_PROFILE_PHOTO = 24_000;

function hasPending() {
  return placeQueue != null || alertQueue != null || profileQueue != null || trailQueue != null;
}

export function publishPlaceRemote(place: SharedPlace, syncToken?: string | null, profileKey?: string | null): boolean {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl()) return false;
  const name = place.name.trim().slice(0, 80);
  const body: Record<string, unknown> = {
    code: place.code,
    name,
    lat: place.sharing ? place.lat : null,
    lng: place.sharing ? place.lng : null,
    accuracyM: place.accuracyM,
    at: place.at,
    sharing: place.sharing,
  };
  if (place.sharing && typeof place.batteryPct === 'number' && place.batteryPct >= 0 && place.batteryPct <= 100) {
    body.batteryPct = Math.round(place.batteryPct);
  }
  if (place.sharing && typeof place.charging === 'boolean') body.charging = place.charging;
  if (place.audience === 'family') body.audience = 'family';
  const memberId = typeof place.memberId === 'string' && /^local-[a-z0-9]{3,64}$/.test(place.memberId) ? place.memberId : '';
  const key = typeof profileKey === 'string' ? profileKey : '';
  if (memberId && key) body.memberId = memberId;
  const priorName = typeof place.priorName === 'string' ? place.priorName.trim().slice(0, 80) : '';
  if (priorName && priorName !== name) body.priorName = priorName;
  placeQueue = { code: place.code, token: syncToken, body, profileKey: memberId ? key : '' };
  void flushQueues();
  return true;
}

export function publishTrailRemote(
  code: string,
  syncToken: string | null | undefined,
  body: Record<string, unknown>,
  profileKey: string | null | undefined,
): boolean {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl() || !/^\d{4,6}$/.test(code)) return false;
  if (!profileKey || typeof body.memberId !== 'string') return false;
  trailQueue = { code, token: syncToken, body, profileKey };
  void flushQueues();
  return true;
}

export function publishProfileRemote(
  profile: { memberId: string; name: string; photo?: string | null; at: number },
  code: string,
  syncToken?: string | null,
  profileKey?: string | null,
): boolean {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl() || !/^\d{4,6}$/.test(code)) return false;
  if (!/^local-[a-z0-9]{3,64}$/.test(profile.memberId) || !profileKey) return false;
  const name = profile.name.trim().slice(0, 20);
  if (!name) return false;
  const body: Record<string, unknown> = { memberId: profile.memberId, name, at: profile.at };
  if (!profile.photo) body.photo = null;
  else if (profile.photo.startsWith('data:image/') && profile.photo.length <= MAX_PROFILE_PHOTO) body.photo = profile.photo;
  profileQueue = { code, token: syncToken, body, profileKey };
  void flushQueues();
  return true;
}

export async function publishChatRemote(
  code: string,
  syncToken: string | null | undefined,
  message: FamilyChatMessage,
): Promise<'ok' | 'local'> {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl() || !/^\d{4,6}$/.test(code)) return 'local';
  try {
    const response = await request(`/v1/rooms/${code}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-umap-sync-key': syncToken },
      body: JSON.stringify({ id: message.id, from: message.from, to: message.to, text: message.text, at: message.at }),
    });
    await noteStatus(response);
    if (response.ok) return 'ok';
    return 'local';
  } catch {
    if (familySyncUrl()) setPhase('down');
    return 'local';
  }
}

export async function fetchDirectChat(
  code: string,
  syncToken: string | null | undefined,
  me: string,
  peer: string,
): Promise<FamilyChatMessage[] | null> {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl() || !/^\d{4,6}$/.test(code) || !me.trim() || !peer.trim()) return null;
  const query = new URLSearchParams({ me: me.trim().slice(0, 20), with: peer.trim().slice(0, 20) });
  try {
    const response = await request(`/v1/rooms/${code}/chat?${query}`, {
      method: 'GET',
      headers: { 'x-umap-sync-key': syncToken },
    });
    if (response.status === 404) return null;
    await noteStatus(response);
    if (!response.ok) return null;
    return readChatMessages(await response.json());
  } catch {
    return null;
  }
}

export async function fetchMyDirectThreads(
  code: string,
  syncToken: string | null | undefined,
  me: string,
): Promise<{ peer: string; messages: FamilyChatMessage[] }[] | null> {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl() || !/^\d{4,6}$/.test(code) || !me.trim()) return null;
  const query = new URLSearchParams({ me: me.trim().slice(0, 20) });
  try {
    const response = await request(`/v1/rooms/${code}/chat?${query}`, {
      method: 'GET',
      headers: { 'x-umap-sync-key': syncToken },
    });
    if (response.status === 404) return null;
    await noteStatus(response);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !Array.isArray((body as { threads?: unknown }).threads)) return [];
    const threads: { peer: string; messages: FamilyChatMessage[] }[] = [];
    for (const item of (body as { threads: unknown[] }).threads) {
      if (!item || typeof item !== 'object') continue;
      const peer = typeof (item as { peer?: unknown }).peer === 'string' ? (item as { peer: string }).peer : '';
      const messages = readChatMessages(item);
      if (peer && messages.length) threads.push({ peer, messages });
    }
    return threads;
  } catch {
    return null;
  }
}

function readChatMessages(body: unknown): FamilyChatMessage[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { messages?: unknown }).messages)) return [];
  return (body as { messages: unknown[] }).messages.filter(isFamilyChatMessage);
}

export function publishAlertRemote(alert: FamilyAlert, syncToken?: string | null) {
  if (!syncToken || !splitSyncToken(syncToken) || !familySyncUrl()) return;
  alertQueue = { alert, token: syncToken };
  void flushQueues();
}

export async function abandonFamilySync(): Promise<void> {
  syncEpoch += 1;
  placeQueue = null;
  profileQueue = null;
  alertQueue = null;
  trailQueue = null;
  const started = Date.now();
  while (flushing && Date.now() - started < 8000) {
    await new Promise((resolve) => window.setTimeout(resolve, 20));
  }
}

export async function revokeFamilyPlace(link: {
  code: string;
  token: string;
  name: string;
  memberId?: string;
  profileKey?: string;
}): Promise<void> {
  if (!familySyncUrl() || !splitSyncToken(link.token) || !/^\d{4,6}$/.test(link.code)) return;
  const name = link.name.trim().slice(0, 80);
  if (!name) return;
  const body: Record<string, unknown> = {
    code: link.code,
    name,
    lat: null,
    lng: null,
    accuracyM: 0,
    at: Date.now(),
    sharing: false,
    audience: 'family',
  };
  if (link.memberId && /^local-[a-z0-9]{3,64}$/.test(link.memberId)) body.memberId = link.memberId;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-umap-sync-key': link.token };
  if (link.profileKey) headers['x-umap-profile-key'] = link.profileKey;
  try {
    const response = await request(`/v1/rooms/${link.code}/place`, { method: 'PUT', headers, body: JSON.stringify(body) });
    await noteStatus(response);
  } catch {
    if (familySyncUrl()) setPhase('down');
  }
}

export async function deleteFamilyRoomRemote(code: string, writeKey: string, readKey: string): Promise<'ok' | 'off' | 'failed'> {
  if (!familySyncUrl() || !isKeyPart(writeKey) || !isKeyPart(readKey) || !/^\d{4,6}$/.test(code)) return 'off';
  try {
    const token = await syncTokenFor(writeKey, readKey);
    const response = await request(`/v1/rooms/${code}`, {
      method: 'DELETE',
      headers: { 'x-umap-sync-key': token, 'x-umap-read-key': readKey },
    });
    await noteStatus(response);
    return response.ok ? 'ok' : 'failed';
  } catch {
    if (familySyncUrl()) setPhase('down');
    return 'failed';
  }
}

async function sendQueued(path: string, token: string, body: unknown, drop: () => void, profileKey = '') {
  const epoch = syncEpoch;
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-umap-sync-key': token };
  if (profileKey) headers['x-umap-profile-key'] = profileKey;
  const response = await request(path, {
    method: path.endsWith('/alert') ? 'POST' : 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  const sealed = !!body && typeof body === 'object' && 'seal' in (body as object) && !!(body as { seal?: unknown }).seal;
  noteDiag({ kind: 'http', dir: 'upload', path, status: response.status, ok: response.ok, sealed });
  if (epoch !== syncEpoch) {
    drop();
    return true;
  }
  const optionalMissing = optionalRouteMissing(path, response.status);
  if (!optionalMissing) await noteStatus(response);
  if (response.ok || optionalMissing || response.status === 400 || response.status === 401 || response.status === 403 || response.status === 413) drop();
  return response.ok || optionalMissing;
}

type KeyDirectory = {
  kid?: string;
  pubs?: Record<string, string>;
  wraps?: Record<string, { epk: string; iv: string; ct: string }>;
  revoked?: string[];
  history?: Record<string, Record<string, { epk: string; iv: string; ct: string }>>;
};

async function putRoomKeys(code: string, token: string, profileKey: string, body: Record<string, unknown>): Promise<KeyDirectory | null> {
  try {
    const response = await request(`/v1/rooms/${code}/keys`, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-umap-sync-key': token,
        'x-umap-profile-key': profileKey,
      },
      body: JSON.stringify(body),
    });
    if (response.status === 404) return null;
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as { keys?: KeyDirectory } | null;
    return payload?.keys || null;
  } catch {
    return null;
  }
}

export async function syncFamilyKeys(code: string, token: string, memberId: string, profileKey: string): Promise<boolean> {
  if (typeof localStorage === 'undefined' || !memberId || !profileKey || !splitSyncToken(token) || !/^\d{4,6}$/.test(code)) return false;
  const device = await ensureDevice(localStorage);
  let directory = await putRoomKeys(code, token, profileKey, { memberId, publicKey: device.publicKey });
  if (!directory) return familyKeyRecord(localStorage, code) != null;
  const revoked = new Set(directory.revoked || []);
  const kid = directory.kid || '';
  const wraps = directory.wraps || {};
  if (kid && wraps[memberId]) {
    const opened = await unwrapFamilyKey(device.privateKey, wraps[memberId], kid);
    if (opened) rememberFamilyKey(localStorage, code, kid, opened);
  }
  const livePubs = Object.entries(directory.pubs || {}).filter(([id]) => !revoked.has(id));
  if (!familyKeyRecord(localStorage, code) && kid && livePubs.length === 1 && livePubs[0][0] === memberId && !wraps[memberId]) {
    const minted = await mintFamilyKey();
    const wrap = await wrapFamilyKey(livePubs[0][1], minted.key, minted.kid);
    const saved = wrap ? await putRoomKeys(code, token, profileKey, {
      memberId,
      publicKey: device.publicKey,
      kid: minted.kid,
      wraps: { [memberId]: wrap },
      rotate: true,
    }) : null;
    if (saved?.kid === minted.kid) rememberFamilyKey(localStorage, code, minted.kid, minted.key);
  }
  if (!kid) {
    const minted = await mintFamilyKey();
    const nextWraps: Record<string, { epk: string; iv: string; ct: string }> = {};
    for (const [id, pub] of Object.entries(directory.pubs || {})) {
      if (revoked.has(id)) continue;
      const wrap = await wrapFamilyKey(pub, minted.key, minted.kid);
      if (wrap) nextWraps[id] = wrap;
    }
    const saved = await putRoomKeys(code, token, profileKey, {
      memberId,
      publicKey: device.publicKey,
      kid: minted.kid,
      wraps: nextWraps,
    });
    if (saved?.kid === minted.kid) rememberFamilyKey(localStorage, code, minted.kid, minted.key);
  }
  const record = familyKeyRecord(localStorage, code);
  if (record && directory.kid === record.kid) {
    const missing: Record<string, { epk: string; iv: string; ct: string }> = {};
    for (const [id, pub] of Object.entries(directory.pubs || {})) {
      if (revoked.has(id) || wraps[id]) continue;
      const wrap = await wrapFamilyKey(pub, record.key, record.kid);
      if (wrap) missing[id] = wrap;
    }
    if (Object.keys(missing).length) {
      await putRoomKeys(code, token, profileKey, {
        memberId,
        publicKey: device.publicKey,
        kid: record.kid,
        wraps: missing,
      });
    }
  }
  const content = contentKeyBytes(device);
  const existingOwner = directory.history && directory.history[memberId];
  if (!existingOwner && content) {
    const ownerShares: Record<string, { epk: string; iv: string; ct: string }> = {};
    for (const [id, pub] of livePubs) {
      const wrap = await wrapFamilyKey(pub, content, HISTORY_SHARE_KID);
      if (wrap) ownerShares[id] = wrap;
    }
    if (Object.keys(ownerShares).length) {
      await putRoomKeys(code, token, profileKey, {
        memberId,
        publicKey: device.publicKey,
        history: { [memberId]: ownerShares },
      });
    }
  } else if (directory.history) {
    const refreshed = await rewrapHistoryShares({
      history: directory.history,
      pubs: directory.pubs || {},
      holderId: memberId,
      holderPrivate: device.privateKey,
    });
    const mine = refreshed[memberId] && refreshed[memberId][memberId];
    if (mine) {
      localStorage.setItem('umap_history_share_v1', JSON.stringify({ memberId, wrap: mine }));
      window.dispatchEvent(new Event('umap-family-keys'));
    }
    await putRoomKeys(code, token, profileKey, {
      memberId,
      publicKey: device.publicKey,
      history: refreshed,
    });
  }
  return familyKeyRecord(localStorage, code) != null;
}

async function sealQueuedPlace(place: { code: string; token: string; body: Record<string, unknown>; profileKey: string }) {
  const body = { ...place.body };
  if (body.sharing !== true || typeof body.lat !== 'number' || typeof body.lng !== 'number') return body;
  const memberId = typeof body.memberId === 'string' ? body.memberId : '';
  if (!memberId || !place.profileKey) return null;
  await syncFamilyKeys(place.code, place.token, memberId, place.profileKey);
  const record = typeof localStorage === 'undefined' ? null : familyKeyRecord(localStorage, place.code);
  if (!record) return null;
  const seal = await sealJson(record.key, record.kid, { lat: body.lat, lng: body.lng, accuracyM: body.accuracyM });
  if (!seal) return null;
  return { ...body, lat: null, lng: null, accuracyM: 0, seal };
}

async function sealQueuedTrail(trail: { code: string; token: string; body: Record<string, unknown>; profileKey: string }) {
  const memberId = typeof trail.body.memberId === 'string' ? trail.body.memberId : '';
  if (!memberId) return null;
  await syncFamilyKeys(trail.code, trail.token, memberId, trail.profileKey);
  const record = typeof localStorage === 'undefined' ? null : familyKeyRecord(localStorage, trail.code);
  if (!record) return null;
  const seal = await sealJson(record.key, record.kid, {
    points: trail.body.points || [],
    journeys: trail.body.journeys || [],
  });
  if (!seal) return null;
  return {
    memberId,
    at: trail.body.at,
    moving: trail.body.moving === true,
    points: [],
    journeys: [],
    seal,
  };
}

async function revealPlace(place: SharedPlace): Promise<SharedPlace | null> {
  const seal = (place as SharedPlace & { seal?: unknown }).seal;
  if (!seal) {
    if (typeof place.lat !== 'number' || typeof place.lng !== 'number') return null;
    return { ...place, legacyClient: false };
  }
  const record = typeof localStorage === 'undefined' ? null : familyKeyRecord(localStorage, place.code);
  if (!record) return null;
  const opened = await openJson(record.key, seal) as { lat?: unknown; lng?: unknown; accuracyM?: unknown } | null;
  if (!opened || typeof opened.lat !== 'number' || typeof opened.lng !== 'number') return null;
  return {
    ...place,
    lat: opened.lat,
    lng: opened.lng,
    accuracyM: typeof opened.accuracyM === 'number' ? opened.accuracyM : 0,
    legacyClient: false,
  };
}

async function revealTrails(code: string, body: unknown): Promise<SharedTrail[]> {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { trails?: unknown }).trails)) return [];
  const trails: SharedTrail[] = [];
  for (const item of (body as { trails: unknown[] }).trails) {
    if (!item || typeof item !== 'object') continue;
    const trail = item as { memberId?: unknown; at?: unknown; moving?: unknown; points?: unknown; journeys?: unknown; seal?: unknown };
    if (typeof trail.memberId !== 'string' || !/^local-[a-z0-9]{3,64}$/.test(trail.memberId)) continue;
    if (typeof trail.at !== 'number' || !Number.isFinite(trail.at)) continue;
    let points = trail.points;
    let journeys = trail.journeys;
    if (trail.seal) {
      const record = typeof localStorage === 'undefined' ? null : familyKeyRecord(localStorage, code);
      const opened = record ? await openJson(record.key, trail.seal) as { points?: unknown; journeys?: unknown } | null : null;
      if (!opened) continue;
      points = opened.points;
      journeys = opened.journeys;
    }
    const readable = {
      memberId: trail.memberId,
      at: trail.at,
      moving: trail.moving === true,
      points,
      journeys,
    };
    const parsed = readTrails({ trails: [readable] });
    if (parsed[0]) trails.push(parsed[0]);
  }
  return trails;
}

export async function rotateRemovedMember(input: {
  code: string;
  token: string;
  memberId: string;
  profileKey: string;
  removedId: string;
}): Promise<void> {
  if (typeof localStorage === 'undefined') return;
  const device = await ensureDevice(localStorage);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const directory = await putRoomKeys(input.code, input.token, input.profileKey, {
      memberId: input.memberId,
      publicKey: device.publicKey,
    });
    if (!directory) continue;
    const minted = await mintFamilyKey();
    const wraps: Record<string, { epk: string; iv: string; ct: string }> = {};
    const pubs = { ...(directory.pubs || {}), [input.memberId]: device.publicKey };
    delete pubs[input.removedId];
    for (const [id, pub] of Object.entries(pubs)) {
      if ((directory.revoked || []).includes(id)) continue;
      const wrap = await wrapFamilyKey(pub, minted.key, minted.kid);
      if (wrap) wraps[id] = wrap;
    }
    if (!wraps[input.memberId]) continue;
    const saved = await putRoomKeys(input.code, input.token, input.profileKey, {
      memberId: input.memberId,
      publicKey: device.publicKey,
      kid: minted.kid,
      wraps,
      rotate: true,
      revoke: input.removedId,
    });
    if (saved?.kid === minted.kid && (saved.revoked || []).includes(input.removedId)) {
      rememberFamilyKey(localStorage, input.code, minted.kid, minted.key);
      return;
    }
  }
}

async function flushQueues() {
  if (flushing) return;
  flushing = true;
  const epoch = syncEpoch;
  let failed = false;
  try {
    if (epoch !== syncEpoch) return;
    const place = placeQueue;
    if (place) {
      const sealed = await sealQueuedPlace(place);
      if (!sealed) {
        failed = true;
      } else {
        const ok = await sendQueued(`/v1/rooms/${place.code}/place`, place.token, sealed, () => {
          if (placeQueue === place) placeQueue = null;
        }, place.profileKey);
        if (ok) {
          const sentName = typeof place.body.name === 'string' ? place.body.name : '';
          const sentAudience = place.body.audience === 'family' ? 'family' : 'admin';
          if (sentName) rememberPlaceName(place.code, sentAudience, sentName);
        }
        if (!ok) failed = true;
      }
    }
    const profile = profileQueue;
    if (profile) {
      const ok = await sendQueued(`/v1/rooms/${profile.code}/profile`, profile.token, profile.body, () => {
        if (profileQueue === profile) profileQueue = null;
      }, profile.profileKey);
      if (!ok) failed = true;
    }
    const trail = trailQueue;
    if (trail) {
      const sealed = await sealQueuedTrail(trail);
      if (!sealed) {
        failed = true;
      } else {
        const ok = await sendQueued(`/v1/rooms/${trail.code}/trail`, trail.token, sealed, () => {
          if (trailQueue === trail) trailQueue = null;
        }, trail.profileKey);
        if (!ok) failed = true;
      }
    }
    const alert = alertQueue;
    if (alert) {
      const ok = await sendQueued(`/v1/rooms/${alert.alert.code}/alert`, alert.token, alert.alert, () => {
        if (alertQueue === alert) alertQueue = null;
      });
      if (!ok) failed = true;
    }
    retryMs = failed ? Math.min(retryMs * 2, 20000) : 3000;
  } catch {
    failed = true;
    retryMs = Math.min(retryMs * 2, 20000);
    if (familySyncUrl()) setPhase('down');
    else setPhase('off');
  } finally {
    flushing = false;
    if (hasPending()) window.setTimeout(() => void flushQueues(), retryMs);
  }
}

export async function probeFamilySync() {
  if (!familySyncUrl()) {
    setPhase('off');
    return;
  }
  try {
    const response = await request('/health', { method: 'GET' });
    const body: unknown = await response.json().catch(() => null);
    const healthy = response.ok && !!body && typeof body === 'object' && (body as { ok?: boolean; service?: string }).ok === true && (body as { service?: string }).service === 'umap-family-sync';
    if (!healthy) {
      setPhase('down');
      return;
    }
    await flushQueues();
    if (phase !== 'rejected' && !hasPending()) setPhase('live');
  } catch {
    setPhase('down');
  }
}

export function startSyncMonitor(): () => void {
  if (!familySyncUrl()) {
    setPhase('off');
    return () => {};
  }
  void probeFamilySync();
  const timer = window.setInterval(() => void probeFamilySync(), 20000);
  return () => window.clearInterval(timer);
}

export interface RemoteLink {
  code: string;
  writeKey: string;
  readKey: string;
}

function isSharedPlace(value: unknown): value is SharedPlace {
  if (!value || typeof value !== 'object') return false;
  const place = value as SharedPlace;
  if (place.audience != null && place.audience !== 'admin' && place.audience !== 'family') return false;
  return typeof place.code === 'string' && place.code.length >= 4 && typeof place.name === 'string' && typeof place.at === 'number' && typeof place.sharing === 'boolean';
}

function isRemoteAlert(value: unknown): value is FamilyAlert {
  if (!value || typeof value !== 'object') return false;
  const alert = value as FamilyAlert;
  if (typeof alert.id !== 'string' || typeof alert.code !== 'string' || typeof alert.at !== 'number') return false;
  if (alert.kind === 'sos' || alert.kind === 'leave') return true;
  if (alert.kind !== 'motion' || !Array.isArray(alert.to) || alert.to.length === 0 || alert.to.length > 8) return false;
  return alert.to.every((name) => typeof name === 'string' && name.trim().length > 0 && name.length <= 20);
}

function isSharedProfile(value: unknown): value is SharedProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as SharedProfile;
  if (typeof profile.memberId !== 'string' || !/^local-[a-z0-9]{3,64}$/.test(profile.memberId)) return false;
  if (typeof profile.name !== 'string' || !profile.name.trim()) return false;
  if (typeof profile.at !== 'number' || !Number.isFinite(profile.at)) return false;
  if (profile.photo != null && (typeof profile.photo !== 'string' || !profile.photo.startsWith('data:image/') || profile.photo.length > 120_000)) return false;
  return true;
}

export interface SharedTrail {
  memberId: string;
  at: number;
  moving: boolean;
  points: { lat: number; lng: number; at: number; speedMps?: number; accuracyM?: number; staying?: boolean; stayEnd?: boolean }[];
  journeys: {
    id: string;
    startedAt: number;
    endedAt: number;
    distanceM: number;
    points: { lat: number; lng: number; at: number; speedMps?: number; accuracyM?: number; staying?: boolean; stayEnd?: boolean }[];
    start: { lat: number; lng: number; label: string | null };
    end: { lat: number; lng: number; label: string | null };
  }[];
}

function isTrailPoint(value: unknown): value is SharedTrail['points'][number] {
  if (!value || typeof value !== 'object') return false;
  const point = value as { lat?: unknown; lng?: unknown; at?: unknown };
  return typeof point.lat === 'number' && typeof point.lng === 'number' && typeof point.at === 'number';
}

function readTrails(body: unknown): SharedTrail[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { trails?: unknown }).trails)) return [];
  const trails: SharedTrail[] = [];
  for (const item of (body as { trails: unknown[] }).trails) {
    if (!item || typeof item !== 'object') continue;
    const trail = item as { memberId?: unknown; at?: unknown; moving?: unknown; points?: unknown; journeys?: unknown };
    if (typeof trail.memberId !== 'string' || !/^local-[a-z0-9]{3,64}$/.test(trail.memberId)) continue;
    if (typeof trail.at !== 'number' || !Number.isFinite(trail.at)) continue;
    const points = Array.isArray(trail.points) ? trail.points.filter(isTrailPoint).slice(0, 800) : [];
    const journeys = Array.isArray(trail.journeys)
      ? trail.journeys.flatMap((journey) => {
          if (!journey || typeof journey !== 'object') return [];
          const card = journey as SharedTrail['journeys'][number];
          if (typeof card.id !== 'string' || typeof card.startedAt !== 'number' || typeof card.endedAt !== 'number') return [];
          if (!card.start || !card.end || !Array.isArray(card.points)) return [];
          return [{
            id: card.id,
            startedAt: card.startedAt,
            endedAt: card.endedAt,
            distanceM: typeof card.distanceM === 'number' ? card.distanceM : 0,
            points: card.points.filter(isTrailPoint).slice(0, 240),
            start: card.start,
            end: card.end,
          }];
        }).slice(0, 16)
      : [];
    trails.push({ memberId: trail.memberId, at: trail.at, moving: trail.moving === true, points, journeys });
  }
  return trails;
}

function readProfiles(body: unknown): SharedProfile[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { profiles?: unknown }).profiles)) return [];
  return (body as { profiles: unknown[] }).profiles.filter(isSharedProfile).map((profile) => ({
    memberId: profile.memberId,
    name: profile.name.trim().slice(0, 20),
    photo: typeof profile.photo === 'string' ? profile.photo : null,
    at: profile.at,
  }));
}

export function startAdminRemoteSync(
  link: RemoteLink | null,
  handlers: {
    onPlace: (place: SharedPlace) => void;
    onAlert: (alert: FamilyAlert) => void;
    onProfiles?: (profiles: SharedProfile[]) => void;
    onTrails?: (trails: SharedTrail[]) => void;
  },
  self: { memberId: string; profileKey: string } | null = null,
): () => void {
  if (!link || !familySyncUrl() || !isKeyPart(link.writeKey) || !isKeyPart(link.readKey) || !/^\d{4,6}$/.test(link.code)) return () => {};
  let stopped = false;
  let since = 0;
  let timer = 0;

  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void tick(), delay);
  };

  const tick = async () => {
    if (stopped) return;
    let delay = 2500;
    try {
      const token = await syncTokenFor(link.writeKey, link.readKey);
      // `since` filters alerts only. Places are always the latest consented points,
      // so a cursor from yesterday cannot skip a managed member's new fix.
      const response = await request(`/v1/rooms/${link.code}?since=${since}`, {
        method: 'GET',
        headers: {
          'x-umap-sync-key': token,
          'x-umap-read-key': link.readKey,
          ...(self?.memberId ? { 'x-umap-member': self.memberId } : {}),
          ...(self?.profileKey ? { 'x-umap-profile-key': self.profileKey } : {}),
        },
      });
      const error = await noteStatus(response);
      if (error === 'member' && self?.memberId && self.profileKey) {
        await syncFamilyKeys(link.code, token, self.memberId, self.profileKey);
      }
      if (response.ok) {
        const body: unknown = await response.json();
        if (self?.memberId && self.profileKey) await syncFamilyKeys(link.code, token, self.memberId, self.profileKey);
        const places = body && typeof body === 'object' && Array.isArray((body as { places?: unknown[] }).places) ? (body as { places: unknown[] }).places : [];
        const alerts = body && typeof body === 'object' && Array.isArray((body as { alerts?: unknown[] }).alerts) ? (body as { alerts: unknown[] }).alerts : [];
        for (const place of places) {
          if (!isSharedPlace(place)) continue;
          const opened = await revealPlace(place);
          if (opened) handlers.onPlace(opened);
        }
        handlers.onProfiles?.(readProfiles(body));
        handlers.onTrails?.(await revealTrails(link.code, body));
        for (const alert of alerts) {
          if (!isRemoteAlert(alert)) continue;
          handlers.onAlert(alert);
          if (alert.at > since) since = alert.at;
        }
      } else {
        delay = 8000;
      }
    } catch {
      if (!stopped) setPhase('down');
      delay = 8000;
    }
    if (stopped) return;
    if (document.visibilityState === 'hidden') delay = Math.max(delay, 12000);
    schedule(delay);
  };

  void tick();
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    window.clearTimeout(timer);
    void tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

const familyEndpointReady = new Map<string, boolean>();

/** True only when this worker serves GET /family. A 404 is the previous worker, which stores places by name and would let an admin self-share overwrite a child. */
export async function familyEndpointAvailable(code: string, token: string): Promise<boolean> {
  const cached = familyEndpointReady.get(code);
  if (cached != null) return cached;
  if (!familySyncUrl() || !splitSyncToken(token) || !/^\d{4,6}$/.test(code)) return false;
  try {
    const response = await request(`/v1/rooms/${code}/family`, {
      method: 'GET',
      headers: { 'x-umap-sync-key': token },
    });
    if (response.status === 404) {
      familyEndpointReady.set(code, false);
      return false;
    }
    if (response.ok || response.status === 401 || response.status === 403) {
      familyEndpointReady.set(code, true);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function readDeparted(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { departed?: unknown }).departed)) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of (body as { departed: unknown[] }).departed) {
    if (typeof value !== 'string' || !/^local-[a-z0-9]{3,64}$/.test(value) || seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

export function startManagedFamilySync(
  links: { code: string; token: string }[],
  onRoom: (code: string, places: SharedPlace[], profiles: SharedProfile[], trails: SharedTrail[], departed: string[]) => void,
  self: { memberId: string; profileKey: string } | null = null,
): () => void {
  const usable = links.filter((link) => splitSyncToken(link.token) && /^\d{4,6}$/.test(link.code));
  if (!familySyncUrl() || usable.length === 0) return () => {};
  let stopped = false;
  let timer = 0;

  const tick = async () => {
    if (stopped) return;
    let delay = 4000;
    try {
      for (const link of usable) {
        if (stopped) return;
        const response = await request(`/v1/rooms/${link.code}/family`, {
          method: 'GET',
          headers: {
            'x-umap-sync-key': link.token,
            ...(self?.memberId ? { 'x-umap-member': self.memberId } : {}),
            ...(self?.profileKey ? { 'x-umap-profile-key': self.profileKey } : {}),
          },
        });
        if (response.status === 404) continue;
        const error = await noteStatus(response);
        if (error === 'member' && self?.memberId && self.profileKey) {
          await syncFamilyKeys(link.code, link.token, self.memberId, self.profileKey);
        }
        if (!response.ok) {
          noteDiag({ kind: 'http', dir: 'download', path: `/v1/rooms/${link.code}/family`, status: response.status, ok: false, places: 0 });
          delay = 12000;
          continue;
        }
        const body: unknown = await response.json();
        const placeCount = body && typeof body === 'object' && Array.isArray((body as { places?: unknown }).places)
          ? (body as { places: unknown[] }).places.length
          : 0;
        noteDiag({ kind: 'http', dir: 'download', path: `/v1/rooms/${link.code}/family`, status: response.status, ok: true, places: placeCount });
        if (self?.memberId && self.profileKey) await syncFamilyKeys(link.code, link.token, self.memberId, self.profileKey);
        const raw = body && typeof body === 'object' && Array.isArray((body as { places?: unknown[] }).places) ? (body as { places: unknown[] }).places : [];
        const places: SharedPlace[] = [];
        for (const place of raw) {
          if (!isSharedPlace(place) || place.audience !== 'family' || !place.sharing) continue;
          if (typeof place.memberId !== 'string' || !/^local-[a-z0-9]{3,64}$/.test(place.memberId)) continue;
          const opened = await revealPlace(place);
          if (opened && opened.lat != null && opened.lng != null) places.push(opened);
        }
        onRoom(link.code, places, readProfiles(body), await revealTrails(link.code, body), readDeparted(body));
      }
    } catch {
      if (!stopped && familySyncUrl()) setPhase('down');
      delay = 12000;
    }
    if (stopped) return;
    if (document.visibilityState === 'hidden') delay = Math.max(delay, 20000);
    timer = window.setTimeout(() => void tick(), delay);
  };

  void tick();
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || stopped) return;
    window.clearTimeout(timer);
    void tick();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export interface RoomPushLink {
  code: string;
  token: string;
  name: string;
  readKey?: string;
}

/** Subscribe this browser for Worker-sent Web Push. Returns false when the WebView has no Push API. */
export async function registerRoomPush(link: RoomPushLink): Promise<boolean> {
  const name = chatName(link.name);
  if (!familySyncUrl() || !name || name === '나') return false;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (!link.token.includes('.')) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await request('/v1/push/vapid', { method: 'GET' });
    if (!keyResponse.ok) return false;
    const keyBody: unknown = await keyResponse.json();
    const publicKey = keyBody && typeof keyBody === 'object' ? (keyBody as { publicKey?: unknown }).publicKey : null;
    if (typeof publicKey !== 'string' || publicKey.length < 16) return false;
    const existing = await registration.pushManager.getSubscription();
    const applicationServerKey = base64UrlToBytes(publicKey);
    const subscription = existing ?? await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
    const json = subscription.toJSON();
    const endpoint = json.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;
    if (!endpoint || !p256dh || !auth) return false;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-umap-sync-key': link.token,
    };
    if (link.readKey) headers['x-umap-read-key'] = link.readKey;
    const response = await request(`/v1/rooms/${link.code}/push`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ endpoint, p256dh, auth, name }),
    });
    await noteStatus(response);
    return response.ok;
  } catch {
    return false;
  }
}
