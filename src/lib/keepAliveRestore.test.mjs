import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('an update and a reboot start location keep again without a tap', () => {
  const manifest = text('../../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android.permission.RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /KeepAliveRestoreReceiver/);
  assert.match(manifest, /android.intent.action.BOOT_COMPLETED/);
  assert.match(manifest, /android.intent.action.MY_PACKAGE_REPLACED/);
  const receiver = text('../../android/app/src/main/java/kr/co/umap/tracker/KeepAliveRestoreReceiver.java');
  assert.match(receiver, /restartIfWanted/);
  const service = text('../../android/app/src/main/java/kr/co/umap/tracker/LocationKeepService.java');
  assert.match(service, /keepWanted/);
  assert.match(service, /void restartIfWanted/);
  const main = text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java');
  assert.match(main, /LocationKeepService.restartIfWanted/);
});

test('a missing family token does not stop keep the user already turned on', () => {
  const tracking = text('../components/family/useFamilyTracking.ts');
  const from = tracking.indexOf('if (targets.length === 0)');
  const to = tracking.indexOf('const memberId', from);
  assert.ok(from >= 0 && to > from);
  const block = tracking.slice(from, to);
  assert.equal(block.includes('umapLocation.stop'), false);
  assert.equal(block.includes('ackStopped'), false);
  assert.match(tracking, /umap-keep-status/);
});
