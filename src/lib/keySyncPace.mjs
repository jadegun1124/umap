// Family-key uploads were the Durable Object write hotspot: every map poll
// repeated PUT /keys. A stored key only needs another pass once a minute.
export const FAMILY_KEY_SYNC_MS = 60_000;

// After the free-tier row budget is spent, wait until the next attempt instead
// of retrying every few seconds.
export const QUOTA_RETRY_MS = 5 * 60 * 1000;

export function shouldRefreshFamilyKeys(lastAt, now, hasKey) {
  if (!hasKey) return true;
  if (typeof lastAt !== 'number' || !Number.isFinite(lastAt)) return true;
  return now - lastAt >= FAMILY_KEY_SYNC_MS;
}

// A successful read must not clear a quota banner. A successful write does.
// After the backoff, the next response is allowed to move the phase again.
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
