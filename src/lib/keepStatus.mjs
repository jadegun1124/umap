/**
 * In-app readout for 항상 허용 and 배터리 제한 없음.
 * while-using is foreground permission without background permission.
 * A missing one gets a fix action. The app does not flip the system switch.
 */
export function keepStatus({
  locationMode = 'unknown',
  batteryUnrestricted = null,
  serviceRunning = false,
} = {}) {
  const location = locationMode === 'always' || locationMode === 'while-using' || locationMode === 'denied'
    ? locationMode
    : 'unknown';
  const battery = batteryUnrestricted === true ? 'unrestricted' : batteryUnrestricted === false ? 'restricted' : 'unknown';
  const locationLabel = {
    always: '항상 허용',
    'while-using': '앱 사용 중에만',
    denied: '꺼짐',
    unknown: '확인 안 됨',
  }[location];
  const batteryLabel = battery === 'unrestricted' ? '제한 없음' : battery === 'restricted' ? '최적화 중' : '확인 안 됨';
  const fixes = [];
  if (location !== 'always') fixes.push({ action: 'always', label: '항상 허용 켜기' });
  if (battery === 'restricted') fixes.push({ action: 'battery', label: '배터리 제한 없음 켜기' });
  return {
    location,
    locationLabel,
    battery,
    batteryLabel,
    serviceLabel: serviceRunning ? '동작 중' : '꺼짐',
    fixes,
  };
}
