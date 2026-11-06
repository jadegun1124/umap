import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ALERT_CURSOR_OVERLAP_MS, nextAlertCursor } from './alertCursor.mjs';

test('a successful poll slides an old cursor forward and keeps a newer alert', () => {
  const now = Date.UTC(2026, 10, 6, 0, 0);
  const stuck = 1_793_192_707_993;
  assert.equal(nextAlertCursor(stuck, [], now), now - ALERT_CURSOR_OVERLAP_MS);
  const older = now - 120_000;
  assert.equal(nextAlertCursor(stuck, [{ at: older }], now), now - ALERT_CURSOR_OVERLAP_MS);
  const alertAt = now - 5_000;
  assert.equal(nextAlertCursor(stuck, [{ at: alertAt }, { at: stuck }], now), alertAt);
  const fresh = now + 2_000;
  assert.equal(nextAlertCursor(stuck, [{ at: fresh }], now), fresh);
  assert.equal(nextAlertCursor(0, [], now), now - ALERT_CURSOR_OVERLAP_MS);
});

test('the room poll recovers a 403 instead of freezing the cursor', () => {
  const sync = readFileSync(new URL('../services/familySync.ts', import.meta.url), 'utf8');
  assert.match(sync, /nextAlertCursor\(since, alerts, Date\.now\(\)\)/);
  assert.match(sync, /action === 'recover'/);
  assert.match(sync, /syncFamilyKeys\(link\.code, token, self\.memberId, self\.profileKey\)/);
  assert.match(sync, /X-App-Version/);
  const watch = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/AlertWatchService.java', import.meta.url), 'utf8');
  assert.match(watch, /X-App-Version/);
  assert.match(watch, /x-umap-member/);
  assert.match(watch, /x-umap-profile-key/);
  assert.match(watch, /status == 401 \|\| status == 403/);
  assert.match(watch, /ALERT_CURSOR_OVERLAP_MS = 60_000L/);
  const kept = watch.slice(watch.indexOf('if (status < 200 || status >= 300) return status;'), watch.indexOf('JSONObject body'));
  assert.equal(kept.includes('putLong("since"'), false);
});
