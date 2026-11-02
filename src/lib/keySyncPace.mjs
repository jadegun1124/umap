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
