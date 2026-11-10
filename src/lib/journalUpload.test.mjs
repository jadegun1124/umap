import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { markUploaded, pendingFromJournal } from './journalUpload.mjs';

const java = readFileSync(new URL('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java', import.meta.url), 'utf8');

test('a restart uploads only the journal rows the last post did not already send', () => {
  const journal = Array.from({ length: 120 }, (_, index) => ({
    lat: 37.55,
    lng: 127.05 + index / 100000,
    at: 1_000 + index * 1_000,
  }));
  const saved = markUploaded(journal, journal.slice(0, 80));
  const pending = pendingFromJournal(saved.journal, saved.uploadedThrough);
  assert.equal(pending.length, 40);
  assert.equal(pending[0].at, journal[80].at);
  assert.equal(pendingFromJournal(saved.journal, 0).length, 40);
  assert.equal(pendingFromJournal(journal, 0).length, 120);
  const again = pendingFromJournal(saved.journal, saved.uploadedThrough);
  assert.equal(again.length, 40);
  const gap = markUploaded(
    [{ lat: 1, lng: 2, at: 1_000 }, { lat: 1, lng: 4, at: 3_000 }],
    [{ lat: 9, lng: 9, at: 2_000 }, { lat: 1, lng: 4, at: 3_000 }],
  );
  assert.equal(gap.journal[1].up, true);
  assert.equal(pendingFromJournal(gap.journal, gap.uploadedThrough).some((point) => point.at === 3_000), false);
  assert.equal(java.includes('if (at <= 0L || at > uploadedThrough) pendingPoints.put'), false);
  assert.match(java, /point\.optBoolean\("up"\)/);
  assert.match(java, /point\.put\("up", true\)/);
  assert.match(java, /putLong\("uploadedThrough", uploadedThrough\)\.commit\(\)/);
});
