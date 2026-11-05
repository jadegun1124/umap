import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  APP_UPDATE_URL,
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  currentAppVersionLabel,
  formatAppVersion,
  labelFromInstalled,
  openAppUpdate,
} from './appRelease.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('설정 shows versionName and versionCode', () => {
  assert.equal(APP_VERSION_NAME, '1.61.0');
  assert.equal(APP_VERSION_CODE, 67);
  assert.equal(formatAppVersion(), '앱 버전 1.61.0 (67)');
  assert.equal(formatAppVersion('1.36.0', ''), '앱 버전 1.36.0');
  assert.equal(labelFromInstalled('1.10.0 10'), '앱 버전 1.10.0 (10)');
  assert.equal(labelFromInstalled(''), '앱 버전 1.61.0 (67)');
  assert.equal(labelFromInstalled('not-a-version'), '앱 버전 1.61.0 (67)');
});

test('an installed APK version replaces the bundled label', () => {
  const previous = globalThis.window;
  globalThis.window = { UmapAndroid: { appVersion: () => '1.10.0 10' } };
  try {
    assert.equal(currentAppVersionLabel(), '앱 버전 1.10.0 (10)');
    globalThis.window = { UmapAndroid: { appVersion: () => '' } };
    assert.equal(currentAppVersionLabel(), '앱 버전 1.61.0 (67)');
    globalThis.window = {};
    assert.equal(currentAppVersionLabel(), '앱 버전 1.61.0 (67)');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('설정 opens the latest release when 앱 업데이트 is tapped', () => {
  assert.equal(APP_UPDATE_URL, 'https://github.com/jadegun1124/umap/releases/latest');
  const opened = [];
  const previous = globalThis.window;
  globalThis.window = { UmapAndroid: { openUrl: (url) => opened.push(url) } };
  try {
    openAppUpdate();
    assert.deepEqual(opened, [APP_UPDATE_URL]);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
  const screen = text('../components/family/FamilyMapScreen.tsx');
  assert.equal((screen.match(/앱 업데이트/g) || []).length, 1);
  assert.match(screen, /openAppUpdate/);
  assert.match(text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java'), /openUrl\(String url\)/);
  assert.match(text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java'), /releases\//);
});

test('package.json, Gradle, and the release workflow stay on 1.61.0 / 67', () => {
  const pkg = JSON.parse(text('../../package.json'));
  const lock = JSON.parse(text('../../package-lock.json'));
  assert.equal(pkg.version, '1.61.0');
  assert.equal(lock.version, '1.61.0');
  assert.equal(lock.packages[''].version, '1.61.0');

  const gradle = text('../../android/app/build.gradle');
  assert.match(gradle, /versionCode 67\b/);
  assert.match(gradle, /versionName "1\.61\.0"/);
  assert.match(text('../../android/app/src/main/res/values/strings.xml'), /<string name="version_name">1\.61\.0<\/string>/);

  const workflow = text('../../.github/workflows/build-apk.yml');
  assert.match(workflow, /tag_name: v1\.61\.0/);
  assert.match(workflow, /versionName: 1\.61\.0/);
  assert.match(workflow, /versionCode: 67/);
  assert.match(workflow, /kinnex-v1\.61\.0\.apk/);
  assert.match(workflow, /assembleRelease/);
  assert.match(workflow, /005737352270b84c7fb6016129bda9a3cd09350c/);
  assert.match(workflow, /keytool/);
  assert.match(workflow, /SHA1/);
  assert.match(gradle, /b42233e0170711205fa75bbca06e98e9/);
  assert.equal(workflow.includes('1.26.0'), false);

  const readme = text('../../README.md');
  assert.match(readme, /versionName`은 `1\.61\.0`/);
  assert.match(readme, /versionCode`는 67입니다/);
  assert.match(readme, /`v1\.26\.0`/);
  assert.match(text('../../PRD.md'), /kinnex-v1\.61\.0\.apk/);

  const home = text('../components/home/CompanyHome.tsx');
  assert.match(home, /APP_VERSION_NAME/);
  assert.equal(home.includes('1.25.0'), false);

  const geocode = text('./placeGeocode.mjs');
  assert.match(geocode, /APP_VERSION_NAME/);
  assert.equal(geocode.includes('1.24.0'), false);

  const main = text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java');
  assert.match(main, /String appVersion\(\)/);
  assert.match(main, /return name \+ " " \+ code/);

  const screen = text('../components/family/FamilyMapScreen.tsx');
  assert.equal((screen.match(/<AppVersionLine \/>/g) || []).length, 2);
  assert.equal((screen.match(/<DisclosureLogPanel \/>/g) || []).length, 2);
  assert.match(screen, /위치정보 이용·제공 기록/);
  assert.match(screen, /진단 기록 보내기/);
  assert.match(screen, /개인위치정보 이용 동의/);
  assert.match(screen, /제3자에게 개인정보나 위치, 기록을 제공한 내역이 없습니다/);
  assert.match(screen, /표시 이름, 카카오·네이버 계정, 가족 구성, 기기, 계정·복구 정보/);
  assert.match(screen, /6개월이 지난 뒤에 지웁니다/);
  assert.match(screen, /계정 연결/);
  assert.match(screen, /카카오 연결/);
  assert.match(screen, /네이버 연결/);
  assert.match(screen, /복구 코드/);
  assert.match(text('../components/family/Onboarding.tsx'), /카카오로 로그인/);
  assert.match(text('../components/family/Onboarding.tsx'), /네이버로 로그인/);
  assert.match(text('../components/family/Onboarding.tsx'), /복구 코드로 불러오기/);
  assert.match(text('../components/family/Onboarding.tsx'), /새로 시작/);
  assert.match(screen, /회원 탈퇴/);
  assert.match(screen, /서버 백업은 남아 있고/);
  assert.equal(text('../components/family/Onboarding.tsx').includes('Google로'), false);
  assert.equal(text('../components/family/FamilyMapScreen.tsx').includes('Google 연결'), false);

  const manifest = text('../../android/app/src/main/AndroidManifest.xml');
  assert.match(manifest, /android:allowBackup="false"/);
  assert.match(manifest, /@xml\/backup_rules/);
  assert.match(manifest, /@xml\/data_extraction_rules/);
  const backupRules = text('../../android/app/src/main/res/xml/backup_rules.xml');
  const extraction = text('../../android/app/src/main/res/xml/data_extraction_rules.xml');
  assert.match(backupRules, /exclude domain="root"/);
  assert.match(backupRules, /exclude domain="sharedpref"/);
  assert.doesNotMatch(backupRules, /<include /);
  assert.match(extraction, /<cloud-backup>/);
  assert.match(extraction, /<device-transfer>/);
  assert.match(extraction, /exclude domain="device_file"/);
  assert.match(extraction, /exclude domain="external"/);
  assert.doesNotMatch(extraction, /device_external/);
  assert.doesNotMatch(extraction, /<include /);
});
