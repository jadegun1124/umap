import assert from 'node:assert/strict';
import test from 'node:test';
import { FAMILY_KEY_SYNC_MS, shouldRefreshFamilyKeys } from './keySyncPace.mjs';

test('a phone that already has the family key does not upload keys every poll', () => {
  const now = 1_000_000;
  assert.equal(shouldRefreshFamilyKeys(now - 1_000, now, true), false);
  assert.equal(shouldRefreshFamilyKeys(now - FAMILY_KEY_SYNC_MS, now, true), true);
  assert.equal(shouldRefreshFamilyKeys(now, now, false), true);
  assert.equal(shouldRefreshFamilyKeys(undefined, now, true), true);
});
