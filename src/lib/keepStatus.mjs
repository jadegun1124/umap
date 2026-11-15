/**
 * In-app readout for 항상 허용, 배터리 제한 없음, 정확한 알람, 백그라운드 제한.
 * A missing one gets a fix action. The app does not flip the system switch.
 * Samsung's sleeping-app list has no public read, so the button is offered
 * when the phone is Samsung and battery optimization is not already off.
 */

export const KEEP_IDLE_WARNING = '앱을 오래 열지 않으면 휴대폰 절전 기능 때문에 위치가 잠시 올라오지 않을 수 있어요.';

function word(value, yes, no) {
  if (value === true) return yes;
  if (value === false) return no;
  return '확인 안 됨';
}

export function keepStatus({
  locationMode = 'unknown',
  batteryUnrestricted = null,
  serviceRunning = false,
  exactAlarm = null,
  backgroundRestricted = null,
  samsung = false,
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
  if (exactAlarm === false) fixes.push({ action: 'exact', label: '정확한 알람 허용' });
  if (backgroundRestricted === true) fixes.push({ action: 'background', label: '백그라운드 제한 풀기' });
  if (samsung === true && battery !== 'unrestricted') fixes.push({ action: 'samsung', label: '잠자지 않는 앱으로' });
  return {
    location,
    locationLabel,
    battery,
    batteryLabel,
    exactAlarmLabel: word(exactAlarm, '가능', '꺼짐'),
    backgroundLabel: word(backgroundRestricted, '제한됨', '없음'),
    serviceLabel: serviceRunning ? '동작 중' : '꺼짐',
    idleWarning: battery === 'restricted' ? KEEP_IDLE_WARNING : '',
    fixes,
  };
}
