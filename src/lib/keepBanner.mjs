export const KEEP_HEARTBEAT_FRESH_MS = 90_000;

/**
 * A fresh heartbeat from the foreground service means it is alive, even when
 * the registered flag is stale. A stale heartbeat means it is dead, even when
 * that flag is still true.
 */
export function serviceAlive({
  serviceRunning = false,
  heartbeatAt = 0,
  now = Date.now(),
  freshMs = KEEP_HEARTBEAT_FRESH_MS,
} = {}) {
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
  now = Date.now(),
} = {}) {
  if (!native || !onMap || userStopped) return null;
  if (keepAlive !== true) return null;
  const alive = serviceAlive({ serviceRunning, heartbeatAt, now });
  if (locationMode !== 'always' || reason === 'permission') {
    const batteryNote = batteryUnrestricted === false ? ' 배터리 제한 없음도 꺼져 있습니다.' : '';
    const text = locationMode === 'while-using'
      ? `위치는 앱 사용 중에만 허용입니다. 눌러서 항상 허용으로 바꿉니다.${batteryNote}`
      : reason === 'permission'
        ? `위치 권한이 항상 허용이 아닙니다. 눌러서 설정으로 이동합니다.${batteryNote}`
        : `위치를 항상 허용으로 바꾸면 앱을 닫아도 위치가 갑니다. 눌러서 설정으로 이동합니다.${batteryNote}`;
    return { action: 'always', text };
  }
  if (!alive && batteryUnrestricted === false) {
    return {
      action: 'battery',
      text: '배터리를 최적화하면 멈춰 있는 동안 위치가 끊깁니다. 눌러서 제한 없음을 켜 주세요.',
    };
  }
  if (!alive) {
    return {
      action: 'start',
      text: '위치 유지가 꺼져 있습니다. 눌러서 다시 켭니다.',
    };
  }
  if (batteryUnrestricted === false) {
    return {
      action: 'battery',
      text: '배터리를 최적화하면 멈춰 있는 동안 위치가 끊깁니다. 눌러서 제한 없음을 켜 주세요.',
    };
  }
  return null;
}
