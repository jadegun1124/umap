// Release identity shown in 설정.
// versionName follows package.json. versionCode follows android/app/build.gradle.
// On an APK, MainActivity.appVersion() reports the installed package so the
// line matches the build on that phone.

export const APP_VERSION_NAME = '1.62.0';
export const APP_VERSION_CODE = 68;

/** Stable page for the newest sideload APK. The file name changes every release. */
export const APP_UPDATE_URL = 'https://github.com/jadegun1124/umap/releases/latest';

export function openAppUpdate() {
  const bridge = typeof window !== 'undefined' ? window.UmapAndroid : undefined;
  if (bridge && typeof bridge.openUrl === 'function') {
    bridge.openUrl(APP_UPDATE_URL);
    return;
  }
  if (typeof window !== 'undefined' && typeof window.open === 'function') window.open(APP_UPDATE_URL, '_blank', 'noopener');
}

export function formatAppVersion(name = APP_VERSION_NAME, code = APP_VERSION_CODE) {
  const version = String(name ?? '').trim();
  const build = String(code ?? '').trim();
  if (!version) return '';
  if (!/^\d+$/.test(build)) return `앱 버전 ${version}`;
  return `앱 버전 ${version} (${build})`;
}

export function parseInstalledAppVersion(raw) {
  const text = String(raw ?? '').trim();
  const match = /^([0-9]+(?:\.[0-9]+)*)\s+(\d+)$/.exec(text);
  if (!match) return null;
  return { name: match[1], code: match[2] };
}

export function labelFromInstalled(raw) {
  const parsed = parseInstalledAppVersion(raw);
  if (!parsed) return formatAppVersion();
  return formatAppVersion(parsed.name, parsed.code);
}

export function currentAppVersionLabel() {
  if (typeof window === 'undefined') return formatAppVersion();
  const bridge = window.UmapAndroid;
  if (!bridge || typeof bridge.appVersion !== 'function') return formatAppVersion();
  try {
    return labelFromInstalled(bridge.appVersion());
  } catch {
    return formatAppVersion();
  }
}
