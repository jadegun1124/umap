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
} = {}) {
  if (!native || !onMap || userStopped) return null;
  if (keepAlive !== true) return null;
  if (locationMode !== 'always' || reason === 'permission') {
    return {
      action: 'always',
      text: reason === 'permission'
        ? '위치 권한이 항상 허용이 아닙니다. 눌러서 설정으로 이동합니다.'
        : '위치를 항상 허용으로 바꾸면 앱을 닫아도 위치가 갑니다. 눌러서 설정으로 이동합니다.',
    };
  }
  if (!serviceRunning && batteryUnrestricted === false) {
    return {
      action: 'battery',
      text: '배터리를 최적화하면 멈춰 있는 동안 위치가 끊깁니다. 눌러서 제한 없음을 켜 주세요.',
    };
  }
  if (!serviceRunning) {
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
