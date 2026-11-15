/** Same decisions as android/.../KeepRevive.java. JS tests lock the branches. */

export const EXACT_WATCHDOG_MS = 2 * 60 * 1000;
export const IDLE_ALARM_MS = 9 * 60 * 1000;
export const EXACT_REVIVE_MS = 5_000;
export const GPS_REREGISTER_COOLDOWN_MS = 60_000;
export const FIX_STALE_MOVING_MS = 15_000;
export const FIX_STALE_STILL_MS = 90_000;

export const ALLOWED_FGS_PATHS = ['app', 'boot', 'update', 'alarm-exact', 'alarm-clock', 'sticky'];

export function fgsStartAllowed({ sdk = 31, path = '', batteryExempt = false } = {}) {
  if (sdk < 31) return true;
  if (batteryExempt) return true;
  return ALLOWED_FGS_PATHS.includes(path);
}

export function watchdogDelayMs(exact) {
  return exact ? EXACT_WATCHDOG_MS : IDLE_ALARM_MS;
}

export function reviveDelayMs(exact) {
  return exact ? EXACT_REVIVE_MS : IDLE_ALARM_MS;
}

export function gpsDropped({
  registered = true,
  now = 0,
  lastFixAt = 0,
  lastReregisterAt = 0,
  moving = false,
  cooldownMs = GPS_REREGISTER_COOLDOWN_MS,
  movingStaleMs = FIX_STALE_MOVING_MS,
  stillStaleMs = FIX_STALE_STILL_MS,
} = {}) {
  if (!registered) return true;
  if (lastReregisterAt <= 0) return false;
  if (now - lastReregisterAt < cooldownMs) return false;
  const stale = moving ? movingStaleMs : stillStaleMs;
  if (lastFixAt > 0) return now - lastFixAt >= stale;
  return now - lastReregisterAt >= stale;
}

export function enqueueExpedited(path) {
  return path == null || path !== 'work';
}

/**
 * What to do when keep should be up.
 * A denied or disallowed foreground start falls through to the next alarm,
 * the 15 minute periodic job, and (except from the worker) expedited work.
 */
export function reviveActions({
  wanted = true,
  userStopped = false,
  processAlive = false,
  gpsNeedsRegister = false,
  fgsAllowed = false,
  fgsFailed = false,
  exact = true,
  path = 'app',
} = {}) {
  if (!wanted || userStopped) {
    return { startService: false, reregisterGps: false, alarm: 'none', alarmMs: 0, expedited: false, periodic: false, capture: false };
  }
  const periodic = true;
  const alarm = exact ? 'exact' : 'idle';
  const watchdogMs = watchdogDelayMs(exact);
  if (!processAlive || fgsFailed) {
    if (fgsAllowed && !fgsFailed) {
      return { startService: true, reregisterGps: true, alarm, alarmMs: watchdogMs, expedited: false, periodic, capture: true };
    }
    return {
      startService: false,
      reregisterGps: false,
      alarm,
      alarmMs: reviveDelayMs(exact),
      expedited: enqueueExpedited(path),
      periodic,
      capture: false,
    };
  }
  if (gpsNeedsRegister) {
    return { startService: false, reregisterGps: true, alarm, alarmMs: watchdogMs, expedited: false, periodic, capture: false };
  }
  return { startService: false, reregisterGps: false, alarm, alarmMs: watchdogMs, expedited: false, periodic, capture: false };
}
