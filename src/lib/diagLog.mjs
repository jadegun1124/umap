// Rolling diagnostic ring on this phone. Uploading it is a separate, explicit step.
// Coordinates stay in this buffer until the user sends the report.

const STORAGE_KEY = 'umap_diag_ring_v1';
const MAX_EVENTS = 5000;
const WINDOW_MS = 2 * 60 * 60 * 1000;

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
  try {
    box.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* a full disk drops the newest note instead of breaking location */
  }
}

export function clearDiag() {
  const box = storage();
  if (!box) return;
  try {
    box.removeItem(STORAGE_KEY);
  } catch {
    /* the next logout still drops the in-memory copy by rewriting an empty list */
    writeRaw([]);
  }
}

export function readDiagEvents(now = Date.now()) {
  return readRaw().filter((event) => event && Number.isFinite(event.t) && now - event.t <= WINDOW_MS).slice(-MAX_EVENTS);
}

export function noteDiag(event) {
  if (!event || typeof event !== 'object') return;
  const now = Date.now();
  const row = { t: now };
  for (const [key, value] of Object.entries(event)) {
    if (key === 't' || !/^[a-z][a-z0-9]{0,24}$/.test(key)) continue;
    if (typeof value === 'string') row[key] = value.slice(0, 160);
    else if (typeof value === 'boolean') row[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) row[key] = value;
  }
  if (!row.kind) return;
  writeRaw(readDiagEvents(now).concat([row]).slice(-MAX_EVENTS));
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
