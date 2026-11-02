import assert from 'node:assert/strict';
import test from 'node:test';
import { OLD_APP_PLACE_LABEL, syncBannerText } from './syncBanner.mjs';

test('the native app never says sharing stays in the browser', () => {
  for (const phase of ['off', 'down', 'rejected', 'limited', 'live']) {
    const text = syncBannerText(phase, false, true) || '';
    assert.equal(text.includes('브라우저'), false);
    const missing = syncBannerText(phase, true, true) || '';
    assert.equal(missing.includes('브라우저'), false);
  }
  assert.match(syncBannerText('rejected', false, false), /이 브라우저 안에서만 공유됩니다/);
  assert.equal(syncBannerText('rejected', false, true).includes('복구 코드'), true);
  assert.equal(OLD_APP_PLACE_LABEL, '상대가 앱을 업데이트해야 위치가 보여요');
  assert.match(syncBannerText('limited', false, true), /오늘 저장 한도/);
  assert.match(syncBannerText('limited', false, true), /오전 9시/);
});
