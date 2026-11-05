// Retry clock for family sync. A 503 or a dropped connection waits
// 5s, 15s, 45s, 2m, then 10m. A later success starts the clock over.
// The moving 30s and still 60s upload gaps stay as they are when the
// response is OK; callers pass that gap as the normal delay.

export const SYNC_BACKOFF_STEPS_MS = [5_000, 15_000, 45_000, 120_000];
export const SYNC_BACKOFF_CAP_MS = 10 * 60 * 1000;

export function syncBackoffDelayMs(attempt, random = 0.5) {
  const n = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  const base = n <= SYNC_BACKOFF_STEPS_MS.length ? SYNC_BACKOFF_STEPS_MS[n - 1] : SYNC_BACKOFF_CAP_MS;
  const unit = typeof random === 'number' && Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
  const jittered = Math.round(base * (0.8 + 0.4 * unit));
  return Math.min(SYNC_BACKOFF_CAP_MS, Math.max(0, jittered));
}

/** 5xx backs off. A missing status is a network failure. Other codes do not. */
export function syncFailureKind(status) {
  if (typeof status !== 'number' || !Number.isFinite(status)) return 'network';
  if (status >= 500 && status <= 599) return 'server';
  return '';
}

/** A server or network failure outranks one successful response in the same round. */
export function foldSyncOutcome(current, next) {
  const rank = { '': 0, ok: 1, server: 2, network: 3 };
  const left = rank[current] || 0;
  const right = rank[next] || 0;
  return right > left ? next : (current || '');
}

export function applySyncOutcome(state, outcome, now, random = 0.5) {
  const current = state && typeof state.attempt === 'number' ? state : { attempt: 0, until: 0 };
  const until = current.until || 0;
  // A wait that is still running is one round. Another poller must not
  // stack a step or clear it with its own 200.
  if (until > now) return { attempt: current.attempt || 0, until };
  if (outcome === 'ok') return { attempt: 0, until: 0 };
  if (outcome !== 'server' && outcome !== 'network') return { attempt: current.attempt || 0, until };
  const attempt = (current.attempt || 0) + 1;
  const delay = syncBackoffDelayMs(attempt, random);
  return { attempt, until: now + delay };
}

/** Wait the normal cadence, or longer while a failure clock is still running. */
export function retryDelayMs(normalMs, backoff, now) {
  const normal = typeof normalMs === 'number' && Number.isFinite(normalMs) && normalMs > 0 ? normalMs : 0;
  const until = backoff && typeof backoff.until === 'number' ? backoff.until : 0;
  const wait = until > now ? until - now : 0;
  return Math.max(normal, wait);
}
