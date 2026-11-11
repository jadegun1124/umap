// Interval decisions mirrored from LocationKeepService.
// The numbers come from that file. 1.51 is the frozen main policy this release replaces.

const RIDE_MIN_MPS = 7 / 3.6;
const RIDE_STEP_M = 8;
const RIDE_STAY_STEP_M = 18;

export function policyFromJava(source) {
  const num = (name) => {
    const product = source.match(new RegExp(`${name} = ([0-9_]+) \\* ([0-9_]+)L`));
    if (product) return Number(product[1].replaceAll('_', '')) * Number(product[2].replaceAll('_', ''));
    const match = source.match(new RegExp(`${name} = ([0-9_]+)L`));
    if (!match) throw new Error(`missing ${name}`);
    return Number(match[1].replaceAll('_', ''));
  };
  const flt = (name) => {
    const match = source.match(new RegExp(`${name} = ([0-9.]+)f`));
    if (!match) throw new Error(`missing ${name}`);
    return Number(match[1]);
  };
  return {
    movingMs: num('GPS_MOVING_MS'),
    rideMs: num('GPS_RIDE_MS'),
    stillProbeMs: num('GPS_STILL_PROBE_MS'),
    stillMs: num('GPS_STILL_MS'),
    stillLongMs: num('GPS_STILL_LONG_MS'),
    stillMaxMs: num('GPS_STILL_MAX_MS'),
    stillLongAfterMs: num('STILL_LONG_AFTER_MS'),
    ambiguousMs: num('GPS_AMBIGUOUS_MS'),
    rideBridgeMs: num('RIDE_BRIDGE_MS'),
    rideBridgeForMs: num('RIDE_BRIDGE_FOR_MS'),
    movingHoldMs: num('MOVING_HOLD_MS'),
    walkDisplaceMs: num('WALK_DISPLACE_MS'),
    walkPaceMaxMs: num('WALK_PACE_MAX_MS'),
    sampleGapMs: num('SAMPLE_GAP_MS'),
    acceptAgeMs: num('FIX_ACCEPT_AGE_MS'),
    walkDisplaceM: flt('WALK_DISPLACE_M'),
    walkImpliedMin: flt('WALK_IMPLIED_MIN_MPS'),
    anchorDepartM: flt('ANCHOR_DEPART_M'),
    reportedImpliedMin: 0.45,
    reportedMinSpeed: flt('WALK_IMPLIED_MIN_MPS'),
    reportedMinMoved: 5,
    useStayConfirmed: true,
    useAmbiguous: true,
    recordStillChecks: false,
  };
}

/** LocationKeepService on 1.51.0 main, before the stay probe. */
export const POLICY_151 = {
  movingMs: 2_500,
  rideMs: 1_000,
  stillProbeMs: 120_000,
  stillMs: 120_000,
  stillLongMs: 300_000,
  stillMaxMs: 300_000,
  stillLongAfterMs: 7 * 60_000,
  ambiguousMs: 120_000,
  rideBridgeMs: 12_000,
  rideBridgeForMs: 3 * 60_000,
  movingHoldMs: 45_000,
  walkDisplaceMs: 4_000,
  walkPaceMaxMs: 20_000,
  sampleGapMs: 1_200,
  acceptAgeMs: 30_000,
  walkDisplaceM: 12,
  walkImpliedMin: 0.75,
  reportedImpliedMin: 0,
  reportedMinSpeed: 0.8,
  reportedMinMoved: 8,
  useStayConfirmed: false,
  useAmbiguous: false,
  recordStillChecks: true,
};

function gpsInterval(state, policy, moving, now) {
  if (moving) {
    if (state.lastRideAt > 0 && now - state.lastRideAt <= policy.movingHoldMs) return policy.rideMs;
    return policy.movingMs;
  }
  if (state.lastRideAt > 0 && now - state.lastRideAt < policy.rideBridgeForMs) return policy.rideBridgeMs;
  if (policy.useAmbiguous && state.ambiguous && !state.stayConfirmed) return policy.ambiguousMs;
  const stillFor = state.stillSince > 0 ? Math.max(0, now - state.stillSince) : 0;
  if (!policy.useStayConfirmed) {
    if (stillFor >= policy.stillLongAfterMs) return policy.stillLongMs;
    return policy.stillMs;
  }
  let interval = policy.stillProbeMs;
  if (state.stayConfirmed && stillFor >= policy.stillLongAfterMs) interval = policy.stillLongMs;
  else if (state.stayConfirmed) interval = policy.stillMs;
  if (interval > policy.stillMaxMs) interval = policy.stillMaxMs;
  return interval;
}

function noteMovement(state, policy, fix) {
  const speed = typeof fix.speedMps === 'number' ? fix.speedMps : -1;
  if (!state.anchor) {
    state.anchor = { ...fix };
    state.stillSince = fix.at;
    state.stayConfirmed = false;
    state.ambiguous = false;
    if (speed >= 8) {
      state.lastRideAt = fix.at;
      state.stillSince = 0;
      state.movingStream = true;
      return true;
    }
    state.movingStream = false;
    return false;
  }
  const dt = Math.max(0, fix.at - state.anchor.at);
  const moved = meters(state.anchor, fix);
  const implied = dt > 0 ? moved / (dt / 1000) : 0;
  const pacedWalk = dt >= policy.walkDisplaceMs && dt <= policy.walkPaceMaxMs && moved >= policy.walkDisplaceM && implied >= policy.walkImpliedMin && implied <= 12;
  const pacedTrip = dt > policy.walkPaceMaxMs && moved >= policy.walkDisplaceM && implied >= policy.walkImpliedMin && implied <= 45;
  // A catch-up fix inside 120s used to miss both: too fast for a walk, too soon for a trip.
  // Reported speed 0 also blocked the ride guess. 50m keeps a short GPS spike from arming 2s.
  const pacedGap = dt >= policy.walkDisplaceMs && dt <= policy.walkPaceMaxMs && moved >= 50 && implied > 12 && implied <= 45;
  const reported = speed >= policy.reportedMinSpeed && moved >= policy.reportedMinMoved && implied >= policy.reportedImpliedMin && dt >= policy.walkDisplaceMs && dt <= policy.walkPaceMaxMs;
  const rideReported = speed >= RIDE_MIN_MPS && moved >= RIDE_STEP_M && dt >= 1_000 && dt <= 30_000 && implied >= RIDE_MIN_MPS * 0.45;
  const rideImplied = speed < 0 && dt >= 2_500 && dt <= 180_000 && moved >= RIDE_STAY_STEP_M && implied > 2.4 && implied <= 45;
  const departM = policy.anchorDepartM || 0;
  const leftAnchor = departM > 0 && !state.movingStream && moved >= departM && dt >= 1_000 && dt <= 180_000 && implied <= 45;
  if (pacedWalk || pacedTrip || pacedGap || reported || rideReported || rideImplied || leftAnchor) {
    if (speed >= RIDE_MIN_MPS || implied >= RIDE_MIN_MPS) state.lastRideAt = fix.at;
    state.anchor = { ...fix };
    state.stillSince = 0;
    state.stayConfirmed = false;
    state.ambiguous = false;
    state.movingStream = true;
    return true;
  }
  const quiet = moved < 4;
  const partial = moved >= 4 && moved < policy.walkDisplaceM;
  if (!state.movingStream) {
    if (state.stillSince === 0) state.stillSince = state.anchor.at;
    if (policy.useStayConfirmed && quiet && dt >= policy.stillProbeMs) state.stayConfirmed = true;
    state.ambiguous = policy.useAmbiguous ? partial && !state.stayConfirmed : false;
    if (dt >= policy.movingHoldMs && moved < policy.walkDisplaceM) state.anchor = { ...fix };
    return false;
  }
  const littleDrift = moved < policy.walkDisplaceM && dt >= policy.movingHoldMs;
  // 30m only starts the stream. A later still fix may sit 30–50m from that
  // anchor; the stay bubble (at least 50m) is what ends 2s sampling.
  const settled = moved <= stayGate(state.anchor.accuracyM, fix.accuracyM) && dt >= policy.movingHoldMs && (speed < 0 || speed < 0.7);
  if (littleDrift || settled) {
    if (state.stillSince === 0) state.stillSince = state.anchor.at;
    state.movingStream = false;
    state.stayConfirmed = false;
    state.ambiguous = false;
    state.anchor = { ...fix };
    return false;
  }
  state.ambiguous = false;
  return true;
}

function meters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function eastOf(lat, lng, metersEast) {
  return { lat, lng: lng + metersEast / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

function stayGate(anchorAccuracy, nextAccuracy) {
  return Math.max(50, Math.max(anchorAccuracy || 0, nextAccuracy || 0) * 2);
}

/**
 * The accept/drop half of handleFix. Movement uses noteMovement.
 * A null config is not represented: the service returns before this.
 */
export function acceptFix(state, policy, fix, now) {
  const fixAt = fix.at;
  const ageLimit = policy.acceptAgeMs || 30_000;
  if (now - fixAt > ageLimit || fixAt > now + 10_000) return { drop: 'stale', recorded: false, moving: false };
  const accuracy = fix.accuracyM;
  if (!(accuracy > 0)) return { drop: 'accuracy', recorded: false, moving: false };
  const precise = fix.precise !== false;
  const freshPrecise = state.stable && now - state.stable.at < 20_000;
  if (precise && accuracy > 80 && (freshPrecise || accuracy > 400)) return { drop: 'accuracy', recorded: false, moving: false };
  if (!precise && accuracy > 400) return { drop: 'accuracy', recorded: false, moving: false };
  if (state.stable) {
    const dt = fixAt - state.stable.at;
    if (dt < 0) return { drop: 'time', recorded: false, moving: false };
    if (dt > 0 && dt <= 180_000) {
      const speed = meters(state.stable, fix) / (dt / 1000);
      if (speed > 350) return { drop: 'speed', recorded: false, moving: false };
    }
  }
  state.stable = { ...fix, at: fixAt };
  if (state.lastSample && state.lastSampleAt > 0) {
    const sinceWall = now - state.lastSampleAt;
    const sampleTime = state.lastSample.at > 0 ? state.lastSample.at : state.lastSampleAt;
    const sinceFix = fixAt - sampleTime;
    const since = sinceFix >= 0 ? sinceFix : sinceWall;
    const jumped = meters(state.lastSample, fix);
    const relocation = jumped > stayGate(state.lastSample.accuracyM, accuracy);
    const implied = since > 0 ? jumped / (since / 1000) : 0;
    const rideSample = implied >= RIDE_MIN_MPS && jumped >= RIDE_STEP_M && since >= 800;
    if (since >= 0 && since < policy.sampleGapMs && !relocation && !rideSample) {
      return { drop: 'interval', recorded: false, moving: false };
    }
  }
  const moving = noteMovement(state, policy, { ...fix, at: fixAt });
  state.requestedMs = gpsInterval(state, policy, moving, fixAt);
  state.lastSample = { ...fix, at: fixAt };
  state.lastSampleAt = now;
  const recorded = !state.anchorRecorded || moving;
  state.anchorRecorded = true;
  return { drop: null, recorded, moving };
}

export function freshMotion(policy) {
  return freshState(policy);
}

/** One screen-off delivery. Fix times differ; the wall clock is the arrival. */
export function acceptBurst(state, policy, fixes, now) {
  const ordered = (Array.isArray(fixes) ? fixes : []).filter(Boolean).sort((left, right) => left.at - right.at);
  const recorded = [];
  for (const fix of ordered) {
    const result = acceptFix(state, policy, fix, now);
    if (result.recorded) recorded.push(fix);
  }
  return { recorded, moving: state.movingStream, interval: state.requestedMs };
}

export function replayFixes(policy, fixes) {
  const state = freshState(policy);
  let moving = false;
  const recorded = [];
  for (const fix of fixes) {
    moving = noteMovement(state, policy, fix);
    state.requestedMs = gpsInterval(state, policy, moving, fix.at);
    const record = policy.recordStillChecks || !state.anchorRecorded || moving;
    state.anchorRecorded = true;
    if (record) recorded.push(fix);
  }
  return { interval: state.requestedMs, moving, recorded: recorded.length, stayConfirmed: state.stayConfirmed };
}

function freshState(policy) {
  return {
    requestedMs: policy.stillProbeMs,
    stillSince: 0,
    lastRideAt: 0,
    movingStream: false,
    stayConfirmed: false,
    ambiguous: false,
    anchorRecorded: false,
    anchor: null,
    trail: [],
  };
}

/**
 * Still, with a few meters of indoor jitter, until the long-stay interval is
 * armed. Then walk east at 1.2 m/s. Fixes arrive only at the requested interval.
 */
export function simulateLongStayWalk(policy, { walkMs = 3 * 60_000 } = {}) {
  const home = { lat: 37.55, lng: 127.05 };
  const state = freshState(policy);
  let at = 0;
  let walkStart = null;
  let guard = 0;
  while (guard < 8_000) {
    guard += 1;
    const walking = walkStart != null && at > walkStart;
    const east = walking ? ((at - walkStart) / 1000) * 1.2 : 3 * Math.sin(at / 40_000);
    const fix = {
      ...eastOf(home.lat, home.lng, east),
      at,
      speedMps: walking ? 1.2 : 0,
      accuracyM: 12,
    };
    const moving = noteMovement(state, policy, fix);
    state.requestedMs = gpsInterval(state, policy, moving, at);
    const record = policy.recordStillChecks || !state.anchorRecorded || moving;
    state.anchorRecorded = true;
    if (record) state.trail.push(fix);
    if (walkStart == null && at >= policy.stillLongAfterMs && state.requestedMs === policy.stillLongMs && !moving) {
      walkStart = at;
    }
    if (walkStart != null && at >= walkStart + walkMs) break;
    const gap = state.requestedMs;
    if (!(gap >= policy.sampleGapMs)) break;
    at += gap;
  }
  const stayTrail = state.trail.filter((point) => walkStart == null || point.at <= walkStart);
  const movingTrail = state.trail.filter((point) => walkStart != null && point.at > walkStart);
  const gaps = [];
  for (let index = 1; index < movingTrail.length; index += 1) gaps.push(movingTrail[index].at - movingTrail[index - 1].at);
  const opening = movingTrail[0] ? meters(home, movingTrail[0]) : 0;
  return {
    walkStart,
    msToMoving: movingTrail[0] && walkStart != null ? movingTrail[0].at - walkStart : Infinity,
    openingChordM: opening,
    stayPoints: stayTrail.length,
    movingGaps: gaps,
    trail: state.trail,
    home,
  };
}
