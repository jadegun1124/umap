export const KEEP_HEARTBEAT_FRESH_MS = 90_000;

/** A dismissed blocker stays down long enough that the next status poll does not pop it again. */
export const KEEP_BANNER_DISMISS_MS = 10 * 60 * 1000;

const FAMILY_STOPS = '가족 지도의 내 위치가 갱신되지 않습니다.';

/**
 * A fresh heartbeat from the foreground service means it is alive, even when
 * the registered flag is stale. A stale heartbeat means it is dead, even when
 * that flag is still true.
 */
export const FIX_STALE_STILL_MS = 90_000;

export function serviceAlive({
  serviceRunning = false,
  heartbeatAt = 0,
  lastFixAt = 0,
  now = Date.now(),
  freshMs = KEEP_HEARTBEAT_FRESH_MS,
  fixFreshMs = FIX_STALE_STILL_MS,
} = {}) {
  const fix = Number(lastFixAt);
  if (Number.isFinite(fix) && fix > 0 && !(now - fix < fixFreshMs && now - fix >= -5_000)) return false;
  const beat = Number(heartbeatAt);
  if (Number.isFinite(beat) && beat > 0) return now - beat < freshMs && now - beat >= -5_000;
  return serviceRunning === true;
}

/**
 * Map banner for background location keep.
 * The open app already publishes from the foreground watch when keep is off,
 * so a missing native registration is not "family is not receiving location".
 * The banner appears only after the user has asked for keep, and the button
 * starts it again or opens the setting that is blocking it.
 */
export function keepBanner({
  native = false,
  onMap = false,
  serviceRunning = false,
  userStopped = false,
  keepAlive = false,
  locationMode = '',
  batteryUnrestricted = true,
  reason = '',
  heartbeatAt = 0,
  lastFixAt = 0,
  now = Date.now(),
} = {}) {
  if (!native || !onMap || userStopped) return null;
  if (keepAlive !== true) return null;
  const alive = serviceAlive({ serviceRunning, heartbeatAt, lastFixAt, now });
  if (locationMode !== 'always' || reason === 'permission') {
    const batteryNote = batteryUnrestricted === false ? ' 배터리 제한 없음도 꺼져 있습니다.' : '';
    const text = locationMode === 'while-using'
      ? `위치는 앱 사용 중에만 허용입니다. ${FAMILY_STOPS} 눌러서 항상 허용으로 바꿉니다.${batteryNote}`
      : reason === 'permission'
        ? `위치 권한이 항상 허용이 아닙니다. ${FAMILY_STOPS} 눌러서 설정으로 이동합니다.${batteryNote}`
        : `위치를 항상 허용으로 바꾸면 앱을 닫아도 위치가 갑니다. ${FAMILY_STOPS} 눌러서 설정으로 이동합니다.${batteryNote}`;
    return guide('always', 'permission', '위치 권한을 확인해 주세요', text, '', '권한 확인', 'always');
  }
  if (!alive && batteryUnrestricted === false) {
    return guide(
      'battery',
      'battery',
      '배터리 제한을 풀어 주세요',
      `배터리를 최적화하면 멈춰 있는 동안 위치가 끊깁니다. ${FAMILY_STOPS} 눌러서 제한 없음을 켜 주세요.`,
      '다시 켜기',
      '배터리 설정',
      'battery',
    );
  }
  if (!alive) {
    return guide(
      'start',
      'dead',
      '위치 유지가 꺼져 있습니다',
      `위치 유지가 꺼져 있습니다. ${FAMILY_STOPS} 눌러서 다시 켭니다. 바로 안 되면 설정에서 항상 허용과 배터리 제한 없음을 확인해 주세요.`,
      '다시 켜기',
      '설정으로 이동',
      'app',
    );
  }
  if (batteryUnrestricted === false) {
    return guide(
      'battery',
      'battery',
      '배터리 제한을 풀어 주세요',
      `배터리를 최적화하면 멈춰 있는 동안 위치가 끊깁니다. ${FAMILY_STOPS} 눌러서 제한 없음을 켜 주세요.`,
      '',
      '배터리 설정',
      'battery',
    );
  }
  return null;
}

function guide(action, kind, title, text, primary, settingsLabel, settingsAction) {
  return { action, kind, title, text, primary, settingsLabel, settingsAction };
}

/** Same blocker stays hidden until the cooldown ends. A new blocker, or a later death, comes back. */
export function keepBannerVisible(banner, dismissed, now = Date.now()) {
  if (!banner) return null;
  if (!dismissed || typeof dismissed.at !== 'number' || !Number.isFinite(dismissed.at)) return banner;
  if (dismissed.kind && dismissed.kind !== banner.kind) return banner;
  if (now - dismissed.at < KEEP_BANNER_DISMISS_MS) return null;
  return banner;
}

export function keepRestartStatus(phase) {
  if (phase === 'starting') return '다시 켜는 중입니다.';
  if (phase === 'on') return '위치 유지를 다시 켰습니다.';
  if (phase === 'blocked') return '아직 켜지지 않았습니다. 설정에서 항상 허용과 배터리 제한 없음을 확인해 주세요.';
  return '';
}
