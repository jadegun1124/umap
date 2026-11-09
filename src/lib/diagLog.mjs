// Rolling diagnostic ring on this phone. localStorage keeps it across
// restart and swipe-away. Uploading it is a separate, explicit step.

export const DIAG_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DIAG_MAX_EVENTS = 12_000;
export const DIAG_MAX_BYTES = 1_200_000;
export const DIAG_UPLOAD_RAW_MAX = 180_000;
export const DIAG_UPLOAD_GZIP_MAX = 700_000;

const STORAGE_KEY = 'umap_diag_ring_v1';
const SENT_KEY = 'umap_diag_sent_v1';
const SENT_LIMIT = 8;
const WRITE_NOW_BYTES = 64_000;
const RENDER_GAP_MS = 30_000;

let ring = null;
let ringBytes = 0;
let dirty = false;
let flushTimer = 0;
let hooks = false;
let lastRenderAt = 0;

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readRaw() {
  const box = storage();
  if (!box) return [];
  try {
    const parsed = JSON.parse(box.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRaw(events) {
  const box = storage();
  if (!box) return;
  let payload = JSON.stringify(events);
  try {
    box.setItem(STORAGE_KEY, payload);
  } catch {
    const shorter = events.slice(Math.ceil(events.length / 2));
    try {
      box.setItem(STORAGE_KEY, JSON.stringify(shorter));
    } catch {
      /* a full disk drops the newest note instead of breaking location */
    }
  }
}

export function clearDiag() {
  ring = [];
  ringBytes = 2;
  dirty = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  const box = storage();
  if (!box) return;
  try {
    box.removeItem(STORAGE_KEY);
    box.removeItem(SENT_KEY);
  } catch {
    writeRaw([]);
  }
}

export function reloadDiagRing() {
  ring = null;
  ringBytes = 0;
  dirty = false;
}

function ensureRing() {
  if (ring) return;
  ring = readRaw();
  ringBytes = JSON.stringify(ring).length;
}

function armHooks() {
  if (hooks || typeof window === 'undefined' || typeof document === 'undefined') return;
  hooks = true;
  window.addEventListener('pagehide', () => flushDiagRing());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDiagRing();
  });
}

export function flushDiagRing() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = 0;
  }
  if (!dirty || !ring) return;
  writeRaw(ring);
  dirty = false;
}

function persistRing() {
  if (!dirty) return;
  if (ringBytes > WRITE_NOW_BYTES && typeof window !== 'undefined') {
    armHooks();
    if (!flushTimer) flushTimer = setTimeout(() => flushDiagRing(), 4000);
    return;
  }
  flushDiagRing();
}

function roundDiagNumber(key, value) {
  if (key === 'lat' || key === 'lng') return Math.round(value * 1e5) / 1e5;
  if (key === 'accuracy' || key === 'speed') return Math.round(value * 10) / 10;
  if (key === 't' || key === 'at') return Math.round(value);
  return Math.round(value * 1000) / 1000;
}

export function trimDiagEvents(events, now = Date.now(), limits = {}) {
  const windowMs = limits.windowMs ?? DIAG_WINDOW_MS;
  const maxEvents = limits.maxEvents ?? DIAG_MAX_EVENTS;
  const maxBytes = limits.maxBytes ?? DIAG_MAX_BYTES;
  const rows = (Array.isArray(events) ? events : []).filter((event) => (
    event && Number.isFinite(event.t) && now - event.t <= windowMs && now - event.t >= -60_000
  ));
  const sized = rows.map((event) => ({ event, size: JSON.stringify(event).length + 1 }));
  let bytes = 2 + sized.reduce((sum, item) => sum + item.size, 0);
  const drop = (index) => {
    bytes -= sized[index].size;
    sized.splice(index, 1);
  };
  while (sized.length > maxEvents || bytes > maxBytes) {
    const renderAt = sized.findIndex((item) => item.event.kind === 'render');
    if (renderAt >= 0) {
      drop(renderAt);
      continue;
    }
    if (sized.length <= 1) break;
    drop(0);
  }
  return sized.map((item) => item.event);
}

export function readDiagEvents(now = Date.now()) {
  ensureRing();
  return trimDiagEvents(ring, now);
}

export function noteDiag(event) {
  if (!event || typeof event !== 'object') return;
  const now = Date.now();
  const row = { t: now };
  for (const [key, value] of Object.entries(event)) {
    if (key === 't' || !/^[a-z][a-z0-9]{0,24}$/.test(key)) continue;
    if (typeof value === 'string') row[key] = value.slice(0, 160);
    else if (typeof value === 'boolean') row[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) row[key] = roundDiagNumber(key, value);
  }
  if (!row.kind) return;
  if (row.kind === 'render') {
    if (now - lastRenderAt < RENDER_GAP_MS) return;
    lastRenderAt = now;
  }
  ensureRing();
  const rowBytes = JSON.stringify(row).length + 1;
  const expired = ring.length > 0 && now - ring[0].t > DIAG_WINDOW_MS;
  const over = ring.length + 1 > DIAG_MAX_EVENTS || ringBytes + rowBytes > DIAG_MAX_BYTES;
  if (expired || over) {
    ring = trimDiagEvents(ring.concat([row]), now);
    ringBytes = JSON.stringify(ring).length;
  } else {
    ring.push(row);
    ringBytes += rowBytes;
  }
  dirty = true;
  persistRing();
}

export function readDiagCodes() {
  const box = storage();
  if (!box) return [];
  try {
    const parsed = JSON.parse(box.getItem(SENT_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row) => row && typeof row.id === 'string' && row.id.length >= 16 && Number.isFinite(row.at)).slice(0, SENT_LIMIT);
  } catch {
    return [];
  }
}

export function rememberDiagCode(id, at = Date.now()) {
  if (typeof id !== 'string' || id.length < 16) return readDiagCodes();
  const box = storage();
  const next = [{ id, at }, ...readDiagCodes().filter((row) => row.id !== id)].slice(0, SENT_LIMIT);
  if (box) {
    try {
      box.setItem(SENT_KEY, JSON.stringify(next));
    } catch {
      /* the number still shows on this screen */
    }
  }
  return next;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function gzipJson(json) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  return JSON.stringify({ encoding: 'gzip', payload: bytesToBase64(packed) });
}

/** JSON under the plain cap, otherwise gzip. Older webviews trim instead. */
export async function packDiagUpload(events, limits = {}) {
  const rawMax = limits.rawMax ?? DIAG_UPLOAD_RAW_MAX;
  const gzipMax = limits.gzipMax ?? DIAG_UPLOAD_GZIP_MAX;
  let batch = Array.isArray(events) ? events.slice() : [];
  while (batch.length > 1 && JSON.stringify(batch).length > rawMax * 8) {
    batch = batch.slice(Math.ceil(batch.length / 5));
  }
  let json = JSON.stringify({ events: batch });
  if (json.length <= rawMax) return json;
  let packed = await gzipJson(json);
  let guard = 0;
  while (packed && packed.length > gzipMax && batch.length > 1 && guard < 6) {
    batch = batch.slice(Math.ceil(batch.length / 5));
    json = JSON.stringify({ events: batch });
    if (json.length <= rawMax) return json;
    packed = await gzipJson(json);
    guard += 1;
  }
  if (packed && packed.length <= gzipMax) return packed;
  while (JSON.stringify(batch).length > rawMax && batch.length > 1) batch = batch.slice(Math.ceil(batch.length / 5));
  return JSON.stringify({ events: batch });
}

export function fixChannelSource(channel, provider, precise) {
  const name = String(provider || '').toLowerCase();
  if (name.includes('fused')) return 'fused';
  if (name.includes('network') || name.includes('passive')) return 'network';
  if (name.includes('gps')) return 'gps';
  if (channel === 'js' && precise === false) return 'network';
  if (channel === 'js' && precise === true) return 'gps';
  return 'unknown';
}

export function appInForeground() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState !== 'hidden';
}
