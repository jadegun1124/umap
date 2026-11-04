// Family-key uploads were the Durable Object write hotspot: every map poll
// repeated PUT /keys. A stored key only needs another pass once a minute.
export const FAMILY_KEY_SYNC_MS = 60_000;

// After the free-tier row budget is spent, wait until the next attempt instead
// of retrying every few seconds.
export const QUOTA_RETRY_MS = 5 * 60 * 1000;

export function shouldRefreshFamilyKeys(lastAt, now) {
  // A phone that never receives a family key used to skip this clock and
  // upload on every poll. Success, failure, and the no-key case share it.
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt)) return true;
  return now - lastAt >= FAMILY_KEY_SYNC_MS;
}

// While the quota backoff is still running, map polls must not hit the server.
// Once it has elapsed, the next response is allowed to leave `limited`.
export function quotaPollPaused(phase, now, limitedUntil) {
  return phase === 'limited' && typeof limitedUntil === 'number' && now < limitedUntil;
}

// A successful read must not clear a quota banner. A successful write does.
// After the backoff, the next response is allowed to move the phase again.
export const ROOM_POLL_MS = 10_000;
export const CHAT_LIST_POLL_MS = 60_000;
export const CHAT_OPEN_POLL_MS = 5_000;
export const HEALTH_POLL_MS = 120_000;
/** Hidden room and chat polls stay at least this slow. */
export const BACKGROUND_POLL_MIN_MS = 12_000;
export const KEY_PUT_WINDOW_MS = 45_000;

const blockedRooms = new Set();

export function blockRoom(code) {
  if (code) blockedRooms.add(String(code));
}

export function resumeRoom(code) {
  if (code) blockedRooms.delete(String(code));
  else blockedRooms.clear();
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('umap-room-resume', { detail: code ? String(code) : '' }));
  }
}

export function roomBlocked(code) {
  return blockedRooms.has(String(code));
}

export function resetBlockedRooms() {
  blockedRooms.clear();
}

export function keyPutLimited(lastAt, now, windowMs = KEY_PUT_WINDOW_MS) {
  return typeof lastAt === 'number' && Number.isFinite(lastAt) && now - lastAt < windowMs;
}

export function syncPhaseAfterResponse(phase, input) {
  const error = typeof input.error === 'string' ? input.error : '';
  const method = input.method || 'GET';
  const now = input.now;
  const limitedUntil = typeof input.limitedUntil === 'number' ? input.limitedUntil : 0;
  if (input.ok === true || error === 'member') {
    const writing = method === 'PUT' || method === 'POST' || method === 'DELETE';
    if (phase === 'limited' && !writing && now < limitedUntil) {
      return { phase: 'limited', limitedUntil };
    }
    return { phase: 'live', limitedUntil: 0 };
  }
  if (error === 'quota') return { phase: 'limited', limitedUntil: now + QUOTA_RETRY_MS };
  if (input.status === 401 || input.status === 403) return { phase: 'rejected', limitedUntil: 0 };
  return { phase: 'down', limitedUntil: 0 };
}
