// Device diagnostic reports. The id is the only key that reads one report.
// Reports live on the owner's account record and expire after seven days.
// The handling ledger notes the upload without coordinates.

import { recordHandling } from './handling.mjs';

export const DIAG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DIAG_INDEX = 'diag-index';
const MAX_EVENTS = 5000;
const MAX_EVENT_KEYS = 24;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function mintDiagId() {
  const buffer = new Uint8Array(18);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

function finite(value, digits = 6) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function short(value, max = 80) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

export function cleanDiagEvents(value) {
  if (!Array.isArray(value)) return [];
  const events = [];
  for (const item of value.slice(-MAX_EVENTS)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const next = {};
    let count = 0;
    for (const [key, raw] of Object.entries(item)) {
      if (count >= MAX_EVENT_KEYS || !/^[a-z][a-z0-9]{0,24}$/.test(key)) continue;
      if (key === 'lat' || key === 'lng') {
        const coord = finite(raw, 6);
        if (coord == null) continue;
        next[key] = coord;
      } else if (typeof raw === 'boolean') {
        next[key] = raw;
      } else if (typeof raw === 'number') {
        const number = finite(raw, key === 't' || key === 'at' ? 0 : 3);
        if (number == null) continue;
        next[key] = number;
      } else if (typeof raw === 'string') {
        const long = key === 'reason' || key === 'error' || key === 'label' || key === 'candidates' || key === 'place' || key === 'version';
        const text = short(raw, long ? 160 : 40);
        if (!text) continue;
        next[key] = text;
      } else {
        continue;
      }
      count += 1;
    }
    if (!next.kind) continue;
    if (!Number.isFinite(next.t)) next.t = Date.now();
    events.push(next);
  }
  return events;
}

let diagQueue = Promise.resolve();

function enqueueDiag(work) {
  const run = diagQueue.then(work, work);
  diagQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function readIndex(store) {
  const raw = await store.get(DIAG_INDEX);
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item.id === 'string' && typeof item.accountId === 'string' && Number.isFinite(item.exp));
}

async function writeIndex(store, rows) {
  await store.put(DIAG_INDEX, rows);
}

async function purgeDiagReportsNow(store, now) {
  const rows = await readIndex(store);
  const kept = [];
  for (const row of rows) {
    if (row.exp > now) {
      kept.push(row);
      continue;
    }
    await store.delete(`diag:${row.id}`);
  }
  if (kept.length !== rows.length) await writeIndex(store, kept);
  return { kept: kept.length };
}

export function purgeDiagReports(store, now = Date.now()) {
  return enqueueDiag(() => purgeDiagReportsNow(store, now));
}

export function forgetDiagReports(store, accountId) {
  return enqueueDiag(async () => {
    const rows = await readIndex(store);
    const kept = [];
    for (const row of rows) {
      if (row.accountId !== accountId) {
        kept.push(row);
        continue;
      }
      await store.delete(`diag:${row.id}`);
    }
    if (kept.length !== rows.length) await writeIndex(store, kept);
  });
}

function versionOf(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const version = events[index] && events[index].version;
    if (typeof version === 'string' && version.trim()) return version.trim().slice(0, 40);
  }
  return '';
}

export function formatDiagKst(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

export async function diagReadAuthorized(authorization, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return 'disabled';
  const header = typeof authorization === 'string' ? authorization : '';
  if (!header.startsWith('Bearer ')) return 'unauthorized';
  const token = header.slice('Bearer '.length).trim();
  if (!token) return 'unauthorized';
  const enc = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(token)),
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0 ? 'ok' : 'unauthorized';
}

async function putDiagReportNow(store, { accountId, memberId, name, events }, now) {
  const cleaned = cleanDiagEvents(events);
  if (cleaned.length === 0) return { error: 'empty' };
  await purgeDiagReportsNow(store, now);
  let id = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = mintDiagId();
    if (await store.get(`diag:${candidate}`)) continue;
    id = candidate;
    break;
  }
  if (id.length < 16) return { error: 'id' };
  const exp = now + DIAG_TTL_MS;
  const version = versionOf(cleaned);
  const bytes = JSON.stringify(cleaned).length;
  const label = typeof name === 'string' ? name.trim().slice(0, 40) : '';
  await store.put(`diag:${id}`, { accountId, exp, events: cleaned, memberId, name: label, version, bytes, receivedAt: now });
  const rows = await readIndex(store);
  rows.push({
    id,
    accountId,
    exp,
    receivedAt: now,
    memberId: typeof memberId === 'string' ? memberId : '',
    name: label,
    version,
    bytes,
  });
  await writeIndex(store, rows);
  await recordHandling(store, {
    kind: 'collect',
    memberId,
    actor: memberId,
    categories: ['location'],
    at: now,
  }, now);
  return { id, exp, count: cleaned.length };
}

export function putDiagReport(store, input, now = Date.now()) {
  return enqueueDiag(() => putDiagReportNow(store, input, now));
}

export function listDiagReports(store, limit = 20, now = Date.now()) {
  const count = Math.min(50, Math.max(1, Number(limit) || 20));
  return enqueueDiag(async () => {
    await purgeDiagReportsNow(store, now);
    const rows = await readIndex(store);
    rows.sort((left, right) => (right.receivedAt || 0) - (left.receivedAt || 0) || (right.exp || 0) - (left.exp || 0));
    return rows.slice(0, count).map((row) => ({
      id: row.id,
      receivedAt: row.receivedAt || 0,
      receivedKst: formatDiagKst(row.receivedAt || 0),
      name: row.name || '',
      memberId: row.memberId || '',
      version: row.version || '',
      bytes: row.bytes || 0,
    }));
  });
}

export function readDiagReport(store, id, now = Date.now()) {
  return enqueueDiag(async () => {
    if (typeof id !== 'string' || id.length < 16) return null;
    await purgeDiagReportsNow(store, now);
    const row = await store.get(`diag:${id}`);
    if (!row || !Array.isArray(row.events) || row.exp <= now) return null;
    return { id, exp: row.exp, events: row.events };
  });
}
