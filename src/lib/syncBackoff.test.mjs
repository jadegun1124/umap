import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SYNC_BACKOFF_CAP_MS,
  SYNC_BACKOFF_STEPS_MS,
  applySyncOutcome,
  foldSyncOutcome,
  retryDelayMs,
  syncBackoffDelayMs,
  syncFailureKind,
} from './syncBackoff.mjs';

test('repeated 503s wait 5s, 15s, 45s, 2m, then 10m, and a success starts over', () => {
  assert.deepEqual(SYNC_BACKOFF_STEPS_MS, [5_000, 15_000, 45_000, 120_000]);
  assert.equal(SYNC_BACKOFF_CAP_MS, 10 * 60 * 1000);
  let state = { attempt: 0, until: 0 };
  let now = 1_700_000_000_000;
  const gaps = [];
  for (let index = 0; index < 5; index += 1) {
    state = applySyncOutcome(state, 'server', now, 0.5);
    gaps.push(state.until - now);
    now = state.until;
  }
  assert.deepEqual(gaps, [5_000, 15_000, 45_000, 120_000, 600_000]);
  assert.equal(state.attempt, 5);
  state = applySyncOutcome(state, 'ok', now, 0.5);
  assert.deepEqual(state, { attempt: 0, until: 0 });
  const again = applySyncOutcome(state, 'server', now, 0.5);
  assert.equal(again.attempt, 1);
  assert.equal(again.until - now, 5_000);
});

test('jitter stays inside 20 percent and a network miss uses the same clock', () => {
  assert.equal(syncBackoffDelayMs(1, 0), 4_000);
  assert.equal(syncBackoffDelayMs(1, 1), 6_000);
  assert.equal(syncBackoffDelayMs(5, 1), SYNC_BACKOFF_CAP_MS);
  assert.equal(syncFailureKind(503), 'server');
  assert.equal(syncFailureKind(500), 'server');
  assert.equal(syncFailureKind(599), 'server');
  assert.equal(syncFailureKind(404), '');
  assert.equal(syncFailureKind(401), '');
  assert.equal(syncFailureKind(null), 'network');
  const missed = applySyncOutcome({ attempt: 0, until: 0 }, 'network', 10_000, 0.5);
  assert.equal(missed.until - 10_000, 5_000);
  const kept = applySyncOutcome(missed, '', 20_000, 0.5);
  assert.equal(kept.attempt, 1);
  assert.equal(kept.until, missed.until);
});

test('one success does not erase a 503 from the same round, and an OK cadence is unchanged', () => {
  assert.equal(foldSyncOutcome('ok', 'server'), 'server');
  assert.equal(foldSyncOutcome('server', 'ok'), 'server');
  assert.equal(foldSyncOutcome('', 'ok'), 'ok');
  assert.equal(foldSyncOutcome('ok', 'network'), 'network');
  const now = 50_000;
  assert.equal(retryDelayMs(30_000, { attempt: 0, until: 0 }, now), 30_000);
  assert.equal(retryDelayMs(60_000, { attempt: 0, until: 0 }, now), 60_000);
  assert.equal(retryDelayMs(10_000, { attempt: 0, until: 0 }, now), 10_000);
  const backingOff = applySyncOutcome({ attempt: 2, until: 0 }, 'server', now, 0.5);
  assert.equal(backingOff.until - now, 45_000);
  assert.equal(retryDelayMs(30_000, backingOff, now), 45_000);
  assert.equal(retryDelayMs(60_000, { attempt: 1, until: now + 5_000 }, now), 60_000);
});

test('upload, room poll, and chat poll use the backoff and do not retry every few seconds', () => {
  const sync = readFileSync(new URL('../services/familySync.ts', import.meta.url), 'utf8');
  assert.match(sync, /applySyncOutcome/);
  assert.match(sync, /syncRetryDelay\('write'/);
  assert.match(sync, /syncRetryDelay\('read'/);
  assert.equal(sync.includes('Math.min(retryMs * 2, 20000)'), false);
  assert.equal(sync.includes('delay = error === \'quota\' ? QUOTA_RETRY_MS : 8000'), false);

  const service = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');
  assert.match(service, /UPLOAD_BACKOFF/);
  assert.match(service, /UPLOAD_MOVING_MS = 30_000L/);
  assert.match(service, /UPLOAD_STILL_MS = 60_000L/);
  assert.equal(service.includes('1_500L'), false);

  const alerts = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/AlertWatchService.java', import.meta.url), 'utf8');
  assert.match(alerts, /POLL_BACKOFF/);
  assert.match(alerts, /POLL_MS/);

  const clock = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/SyncBackoff.java', import.meta.url), 'utf8');
  assert.match(clock, /5_000L, 15_000L, 45_000L, 120_000L/);
  assert.match(clock, /10L \* 60L \* 1000L/);
});
