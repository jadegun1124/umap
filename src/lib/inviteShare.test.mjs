import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  KAKAO_TALK_PACKAGE,
  deliverInviteShare,
  inviteShareMessage,
  inviteShareTarget,
  nextInviteShare,
} from './inviteShare.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('kakao installed uses Kakao Share or the KakaoTalk package, and a missing app uses the chooser', () => {
  assert.equal(inviteShareTarget({ kakaoInstalled: true, kakaoShareReady: true }), 'kakao-share');
  assert.equal(inviteShareTarget({ kakaoInstalled: true, kakaoShareReady: false }), 'kakao-intent');
  assert.equal(inviteShareTarget({ kakaoInstalled: false, kakaoShareReady: true }), 'chooser');
  assert.equal(inviteShareTarget({ kakaoInstalled: false, kakaoShareReady: false }), 'chooser');
  assert.equal(inviteShareTarget({ kakaoInstalled: null, kakaoShareReady: true }), 'kakao-share');
  assert.equal(inviteShareTarget({}), 'chooser');
  assert.equal(nextInviteShare('kakao-share'), 'kakao-intent');
  assert.equal(nextInviteShare('kakao-intent'), 'chooser');
  assert.equal(nextInviteShare('chooser'), '');
  assert.equal(KAKAO_TALK_PACKAGE, 'com.kakao.talk');
});

test('a failed Kakao path falls back, and link copy stays on the invite sheet', async () => {
  const calls = [];
  const missing = await deliverInviteShare('https://example.test/invite#k=1', {
    kakaoInstalled: true,
    kakaoShareReady: true,
    send: async (target) => {
      calls.push(target);
      return target === 'chooser';
    },
  });
  assert.deepEqual(calls, ['kakao-share', 'kakao-intent', 'chooser']);
  assert.equal(missing.path, 'chooser');

  const direct = await deliverInviteShare('https://example.test/invite#k=1', {
    kakaoInstalled: false,
    kakaoShareReady: true,
    send: async (target) => target === 'chooser',
  });
  assert.equal(direct.path, 'chooser');

  const talk = await deliverInviteShare('https://example.test/invite#k=1', {
    kakaoInstalled: true,
    kakaoShareReady: false,
    send: async (target) => target === 'kakao-intent',
  });
  assert.equal(talk.path, 'kakao-intent');
  assert.match(inviteShareMessage('https://example.test/invite'), /example\.test\/invite/);

  const screen = text('../components/family/FamilyMapScreen.tsx');
  assert.match(screen, /카카오톡으로 보내기/);
  assert.match(screen, /링크 복사/);
  assert.equal(screen.includes('링크로 보내기'), false);
  const manifest = text('../../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /<package android:name="com\.kakao\.talk" \/>/);
  const plugin = text('../../android/app/src/main/java/kr/co/umap/tracker/UmapAuthPlugin.java');
  assert.match(plugin, /Intent\.ACTION_SEND/);
  assert.match(plugin, /setPackage\(KAKAO_TALK_PACKAGE\)|setPackage\("com\.kakao\.talk"\)/);
  assert.match(plugin, /Intent\.createChooser/);
  assert.match(plugin, /ShareClient/);
});
