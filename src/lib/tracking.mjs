// Stop-to-stop day record for Kinnex.
//
// Stops: linger inside STOP_RADIUS_M for STOP_MIN_MS (Samsung Health style).
// A segment is the travel between two consecutive stops. Travel time is
// arrival at the next stop minus departure from the previous stop.
//
// Mode uses the trip, not one GPS spike:
//   도보     average under 7 km/h (보통 4–6)
//   자전거   about 7–12 km/h, or a steady 12–15 km/h median that never holds car speed
//   차량     sustained >= 30 km/h, median moving speed > 15 km/h, or average
//            including dashed gaps > 12 km/h
//   비행기   >= 200 km/h AND >= 20 km AND >= 3 min
// Under 40 m is always 도보 so GPS creep inside a building is not a vehicle.
// A dashed hole still counts its straight chord when that chord is real travel.
// 고속철(약 300 km/h)은 거리·시간 조건을 넘으면 비행기로 잡힐 수 있다.
//
// Steps: Capacitor core has no pedometer. 도보 segments estimate
// steps as distance / STRIDE_M (0.75 m) and the UI must say 추정.
//
// OS: a WebView watch dies overnight if the process sleeps. A cached fix
// older than FIX_STALE_MS is rejected so a stale point is not published as
// now. Stored trails and visits stay for HISTORY_DAYS Seoul calendar days
// (today through that many days ago) and older points are trimmed.
// Background publishing is a LocationManager registration started only after
// the user turns on the in-app keep-alive control. It does not post an
// ongoing notification. The app never changes the OS permission itself.

export const STOP_RADIUS_M = 50;
export const STOP_MIN_MS = 3 * 60 * 1000;
export const STRIDE_M = 0.75;
/** Dense 2.5s walk samples. About two and a half hours of vertices before the oldest of that day drops. */
export const TRAIL_POINT_CAP = 4000;
/** Today plus this many Seoul calendar days back. 30 → 오늘부터 30일 전. */
export const HISTORY_DAYS = 30;
export const VISIT_DAY_CAP = 40;

export const MODE_WALK_MAX_KMH = 7;
/** Average above this, once gaps are included, is a vehicle. Bike sits under it. */
export const MODE_VEHICLE_AVG_KMH = 12;
export const MODE_BIKE_MAX_KMH = 23;
/** Several fixes or a full minute at this pace is a car, not one spike. */
export const MODE_VEHICLE_SUSTAINED_KMH = 30;
export const MODE_VEHICLE_MEDIAN_KMH = 15;
export const MODE_PLANE_MIN_KMH = 200;
export const MODE_PLANE_MIN_DISTANCE_M = 20_000;
export const MODE_PLANE_MIN_DURATION_MS = 3 * 60 * 1000;

export const FIX_STALE_MS = 30_000;
export const FIX_PRECISE_ACCURACY_M = 80;
export const FIX_APPROXIMATE_ACCURACY_M = 400;
export const FIX_MAX_JUMP_MPS = 350;
export const FIX_JUMP_WINDOW_MS = 180_000;
/** The drawn trail drops a point worse than this. The live pin still accepts it up to FIX_PRECISE_ACCURACY_M. */
export const TRAIL_POOR_ACCURACY_M = 40;
/** Reported speed under this, while still, is not a new vertex. */
export const TRAIL_STAY_SPEED_MPS = 0.8;
/** A still phone must clear this before a far multipath spike becomes travel. */
export const TRAIL_STILL_CONFIRM_M = 80;
/**
 * Quiet leaps farther than this are a relocation, not courtyard multipath.
 * Above the 110m still-phone spike the sampler still rejects, and well under a
 * neighborhood move such as Hagye to Junggye.
 */
export const TRAIL_RELOCATION_M = 120;
/**
 * Indoor and courtyard multipath while the phone is still.
 * A near-zero-speed fix inside this of the stay is not a vertex. Wider than
 * the 50m stop cluster: a building canyon often jumps 50–200m.
 * A neighborhood relocation (about 1km) stays outside and is still kept.
 */
const INDOOR_STAY_RADIUS_M = 300;
export const STAY_BOUND_RADIUS_M = 300;
export const STAY_SLOW_KMH = 1;
export const STAY_SLOW_MS = 30 * 60 * 1000;
/** One stationary step longer than a walked vertex (~30m) is a multipath leap on the drawing pass. */
const INDOOR_LEAP_M = 48;
/**
 * A still phone can still be walking. 70m in about 45s is that walk.
 * Farther than this, with no walking speed, is building multipath.
 */
const INDOOR_WALK_STEP_M = 110;
/**
 * Display simplify only drops wobble under this many meters.
 * It does not grow with the accuracy bubble. A tighter epsilon keeps the
 * denser 2.5m walk samples, so a building corner stays a curve.
 */
const TRAIL_SIMPLIFY_M = 0.85;
/** A drawn segment longer than this gets a walked sample back when it still bows off the chord. */
const TRAIL_CHORD_BREAK_M = 14;
/**
 * While moving, keep a vertex about this often.
 * GPS while moving is 2.5s. At 1.0–1.4 m/s that fix is about 2.5–3.5m, so a
 * 2.5m gate keeps the sample and a bend does not collapse into a long chord.
 */
const TRAIL_WALK_VERTEX_M = 2.5;
/** Reported-still step that is a calm walk, not a courtyard hop inside the accuracy bubble. */
const TRAIL_STILL_STEP_M = 22;
const TRAIL_STILL_STEP_MS = 12_000;
const TRAIL_STILL_PACE_MIN_MPS = 0.85;
const TRAIL_STILL_PACE_MAX_MPS = 2.4;
/**
 * Bike and vehicle. Same cut as classifyMode: 7 km/h.
 * A stay flag must not throw these steps away. The line stays solid when the
 * fixes themselves are closer than TRAIL_GAP_MS. Nothing is drawn between fixes.
 */
export const TRAIL_RIDE_MIN_MPS = MODE_WALK_MAX_KMH / 3.6;
/** Matches the moving GPS period. An implied ride slower than this is not a vehicle step. */
export const TRAIL_RIDE_VERTEX_MS = 2_500;
/** Reported ride speed still has to move. Under this, a speed badge on a parked phone is jitter. */
export const TRAIL_RIDE_MIN_STEP_M = 8;
/**
 * No GPS speed, and the accelerometer still says stay.
 * 18m is past the 16m spur and short of the 22m calm-walk step, so courtyard
 * jitter stays put. At 15 km/h that step is about 4–5s, under the 20s dash hole.
 */
export const TRAIL_RIDE_STAY_STEP_M = 18;
/** Family card keeps 「지금」 this long after the last ride vertex. Same 45s as the walk GPS hold. */
export const RIDE_STATUS_FRESH_MS = 45_000;
/**
 * Walk: flip the family card to 「머무름」 after this quiet stretch.
 * Shorter than a ride so a finished walk does not stay 「지금」.
 */
export const WALK_STAY_LABEL_MS = 45_000;
/**
 * Vehicle or bike at or above ~7 km/h. A signal or a brief stop stays 「지금」.
 * Longer than the walk dwell so the card does not flicker during a drive.
 */
export const RIDE_STAY_LABEL_MS = 3 * 60 * 1000;
/** Walk dwell. Ride uses RIDE_STAY_LABEL_MS via stayLabelDwellMs. */
export const STAY_LABEL_DWELL_MS = WALK_STAY_LABEL_MS;
/** Accelerometer must stay quiet this long before the phone is treated as still. Matches the native moving hold. */
export const MOTION_STILL_HOLD_MS = 45_000;
/** A vertex this far off the shortcut, on a thin triangle, is courtyard multipath. */
const TRAIL_SPUR_DEVIATION_M = 16;
const TRAIL_SPUR_MIN_LEG_M = 16;
const TRAIL_SPUR_RATIO = 1.62;
const TRAIL_SPUR_MAX_LEG_M = 260;
const TRAIL_SPUR_WINDOW_MS = 180_000;
/**
 * A dashed segment is a hole in the samples, not "the older part of the line".
 * Continuous walk vertices are a few meters apart and stay solid.
 * A chord this long, with time enough to have sampled the middle, is drawn dashed.
 * Nothing is invented along that chord.
 */
export const TRAIL_GAP_M = 48;
export const TRAIL_GAP_MS = 20_000;
/**
 * Walk: hand the open segment to 기록 after this stay.
 * Shorter than a ride. The linger is the same 50m stay cluster as a stop,
 * and it must already have been observed for STOP_MIN_MS before the wall
 * clock can finish the wait. A speed reading alone does not close it.
 */
export const WALK_JOURNEY_STAY_MS = 5 * 60 * 1000;
/**
 * Vehicle or bike at or above ~7 km/h. A longer stop is required before the
 * live line is archived, so a traffic light does not close the trip.
 */
export const RIDE_JOURNEY_STAY_MS = 12 * 60 * 1000;
/** Walk archive threshold. A ride into the stay uses RIDE_JOURNEY_STAY_MS. */
export const JOURNEY_STAY_MS = WALK_JOURNEY_STAY_MS;
/** The records screen promises a stay of this long ends the open journey. */
export const RECORDS_STAY_MS = 7 * 60 * 1000;
/** Latest stay fix may be this old. A 2 minute still sample is still fresh enough to close the 7 minute wait. */
export const JOURNEY_STAY_FRESH_MS = 150 * 1000;
/** Shorter than this is courtyard noise, not a card in 기록. */
export const JOURNEY_MIN_DISTANCE_M = 80;
export const JOURNEY_MIN_DURATION_MS = 60 * 1000;
export const JOURNEY_POINT_CAP = 240;
export const JOURNEY_DAY_CAP = 6;
/** Leave a stay bubble only after the step is clearly a walk, not ±4m jitter. */
const TRAIL_DEPART_STAY_M = 6;

const MODE_LABELS = {
  walk: '도보',
  bike: '자전거',
  vehicle: '차량',
  plane: '비행기',
};

export function modeLabel(mode) {
  return MODE_LABELS[mode] || MODE_LABELS.walk;
}

export function seoulDayKey(epochMs) {
  const when = new Date(epochMs);
  if (Number.isNaN(when.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(when);
}

export function needsDailyWipe(storedDay, now) {
  return storedDay !== seoulDayKey(now);
}

function haversineMeters(a, b) {
  const radius = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function positiveMeters(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function toMeters(point, origin) {
  const lat0 = (origin.lat * Math.PI) / 180;
  return {
    x: (point.lng - origin.lng) * 111_320 * Math.cos(lat0),
    y: (point.lat - origin.lat) * 111_320,
  };
}

function perpendicularDistanceM(point, start, end) {
  const endM = toMeters(end, start);
  const pointM = toMeters(point, start);
  const length = Math.hypot(endM.x, endM.y);
  if (length < 0.5) return Math.hypot(pointM.x, pointM.y);
  return Math.abs(endM.x * pointM.y - endM.y * pointM.x) / length;
}

function bearingDeg(a, b) {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function signedTurnDeg(a, b, c) {
  const delta = bearingDeg(b, c) - bearingDeg(a, b);
  return ((delta + 540) % 360) - 180;
}

/** Meters off the neighboring chord when the vertex is a thin there-and-back spike, otherwise 0. */
function spikeDeviation(prev, tip, next) {
  if (!prev || !tip || !next) return 0;
  const ab = haversineMeters(prev, tip);
  const bc = haversineMeters(tip, next);
  const ac = haversineMeters(prev, next);
  if (ab < TRAIL_SPUR_MIN_LEG_M || bc < TRAIL_SPUR_MIN_LEG_M || Math.max(ab, bc) > TRAIL_SPUR_MAX_LEG_M) return 0;
  if (Math.abs(signedTurnDeg(prev, tip, next)) < 70) return 0;
  const dt = Number.isFinite(next.at) && Number.isFinite(prev.at) ? next.at - prev.at : 0;
  if (!Number.isFinite(dt) || dt < 0 || dt > TRAIL_SPUR_WINDOW_MS) return 0;
  const deviation = perpendicularDistanceM(tip, prev, next);
  if (deviation < TRAIL_SPUR_DEVIATION_M) return 0;
  if ((ab + bc) / Math.max(ac, 1) < TRAIL_SPUR_RATIO) return 0;
  return deviation;
}

function removeMultipathSpurs(points) {
  if (!Array.isArray(points) || points.length < 3) return points;
  let current = points;
  let removedAny = false;
  const limit = Math.min(current.length, 80);
  for (let guard = 0; guard < limit; guard += 1) {
    const indexes = [];
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] && !current[index].stayEnd) indexes.push(index);
    }
    if (indexes.length < 3) break;
    let worstAt = -1;
    let worstDev = 0;
    for (let index = 1; index < indexes.length - 1; index += 1) {
      const dev = spikeDeviation(current[indexes[index - 1]], current[indexes[index]], current[indexes[index + 1]]);
      if (dev > worstDev) {
        worstDev = dev;
        worstAt = indexes[index];
      }
    }
    if (worstAt < 0) break;
    const nextPoints = current.slice();
    nextPoints.splice(worstAt, 1);
    current = nextPoints;
    removedAny = true;
  }
  if (!removedAny) return points;
  const anchors = current.filter((point) => point && !point.stayEnd);
  return current.filter((point) => {
    if (!point?.stayEnd) return true;
    return anchors.some((anchor) => haversineMeters(anchor, point) <= 20);
  });
}

function displaySimplifyMeters() {
  return TRAIL_SIMPLIFY_M;
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    let maxDist = 0;
    let index = -1;
    for (let cursor = start + 1; cursor < end; cursor += 1) {
      const dist = perpendicularDistanceM(points[cursor], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        index = cursor;
      }
    }
    if (index >= 0 && maxDist > epsilon) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }
  const simplified = points.filter((_, index) => keep[index]);
  return simplified.length >= 2 ? simplified : points;
}

function pointSpeed(point) {
  const speed = point?.speedMps;
  return typeof speed === 'number' && Number.isFinite(speed) ? speed : null;
}

/** GPS speed at a walking pace or faster. The motion-sensor stay flag does not override this. */
function speedShowsMoving(point) {
  const speed = pointSpeed(point);
  return speed != null && speed >= TRAIL_STAY_SPEED_MPS;
}

/** Still phone: stay flag, or a reported speed under a walk, and no GPS pace. */
function stillSample(point) {
  if (speedShowsMoving(point)) return false;
  const speed = pointSpeed(point);
  return point?.staying === true || (speed != null && speed < TRAIL_STAY_SPEED_MPS);
}

function stepPace(last, point) {
  if (!last || !point) return null;
  const moved = haversineMeters(last, point);
  const dt = point.at - last.at;
  if (!Number.isFinite(moved) || !Number.isFinite(dt) || dt <= 0) return null;
  return { moved, dt, speed: moved / (dt / 1000) };
}

function walkPace(speed) {
  return speed >= 0.75 && speed <= 2.8;
}

/**
 * True when this step should be a time-based vertex, not a stay snap.
 * Reported speed at or above 7 km/h, and the ground track agrees (at least
 * 8m, and not a frozen coordinate wearing a speed reading).
 * With no speed reading, trust displacement only above a calm walk. A reported
 * 0 or a walking speed stays on the walk and stay filters.
 */
export function isRideStep(last, point) {
  const pace = stepPace(last, point);
  if (!pace || !(pace.speed >= 0) || pace.speed > FIX_MAX_JUMP_MPS) return false;
  const reported = pointSpeed(point);
  if (reported != null && reported >= TRAIL_RIDE_MIN_MPS) {
    return pace.moved >= TRAIL_RIDE_MIN_STEP_M
      && pace.dt >= 800
      && pace.speed >= TRAIL_RIDE_MIN_MPS * 0.45;
  }
  if (reported != null) return false;
  if (pace.speed < TRAIL_RIDE_MIN_MPS || pace.dt < TRAIL_RIDE_VERTEX_MS) return false;
  if (point?.staying === true) {
    if (pace.speed <= TRAIL_STILL_PACE_MAX_MPS) return false;
    return pace.moved >= TRAIL_RIDE_STAY_STEP_M;
  }
  return pace.moved >= TRAIL_RIDE_MIN_STEP_M;
}

/** The sample extends a ride from the current trail anchor. */
export function fixShowsRide(points, point) {
  return isRideStep(drawnAnchor(Array.isArray(points) ? points : []), point);
}

function drawnPoints(points) {
  const drawn = [];
  if (!Array.isArray(points)) return drawn;
  for (const point of points) {
    if (point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.at)) drawn.push(point);
  }
  return drawn;
}

/** The newest drawn segment is a fresh bike-or-faster step. */
export function recentRide(points, now) {
  if (!Number.isFinite(now)) return false;
  const drawn = drawnPoints(points);
  if (drawn.length < 2) return false;
  const end = drawn[drawn.length - 1];
  if (now - end.at > RIDE_STATUS_FRESH_MS || now < end.at) return false;
  return isRideStep(drawn[drawn.length - 2], end);
}

/**
 * A step that is still travel: a ride at or above ~7 km/h, or a walk.
 * Peer fixes often have no speed reading. 25m in 8s is about 3 m/s, so the
 * walk band extends through a brisk step and a slow vehicle publish.
 * Courtyard drift under 0.75 m/s is not travel.
 */
function travelStep(last, point) {
  if (isVehicleStep(last, point)) return true;
  const pace = stepPace(last, point);
  if (!pace || pace.speed > FIX_MAX_JUMP_MPS) return false;
  if (pace.moved < TRAIL_WALK_VERTEX_M || pace.dt < 800) return false;
  if (pace.speed >= 0.75 && pace.speed <= 12) return true;
  return speedShowsMoving(point) && pace.speed >= 0.75;
}

/** Timestamp of the newest walk or ride step. A later non-travel vertex does not move it. */
export function lastTravelAt(points) {
  const drawn = drawnPoints(points);
  for (let index = drawn.length - 1; index >= 1; index -= 1) {
    if (travelStep(drawn[index - 1], drawn[index])) return drawn[index].at;
  }
  const end = drawn[drawn.length - 1];
  if (end && speedShowsMoving(end)) return end.at;
  return null;
}

/** True when the latest travel, or a ride step just before it, was at or above ~7 km/h. */
export function lastTravelWasRide(points) {
  const drawn = drawnPoints(points);
  let lastTravelIndex = -1;
  for (let index = drawn.length - 1; index >= 1; index -= 1) {
    if (travelStep(drawn[index - 1], drawn[index])) {
      lastTravelIndex = index;
      break;
    }
  }
  if (lastTravelIndex < 0) return false;
  const from = Math.max(1, lastTravelIndex - 12);
  for (let index = lastTravelIndex; index >= from; index -= 1) {
    if (isVehicleStep(drawn[index - 1], drawn[index])) return true;
  }
  return false;
}

/** Walk quiets faster than a vehicle. The card and the motion flag share this window. */
export function stayLabelDwellMs(points) {
  return lastTravelWasRide(points) ? RIDE_STAY_LABEL_MS : WALK_STAY_LABEL_MS;
}

/**
 * Family row. 「지금」 while a walk is still inside WALK_STAY_LABEL_MS, or a
 * ride (≥ ~7 km/h) is still inside RIDE_STAY_LABEL_MS, and while the
 * accelerometer has just gone active before the first travel vertex.
 * 「머무름」 only after that dwell. moving === false does not flip the label
 * during that window. Peers leave moving null; the same trail dwell decides their card.
 */
export function liveMotionLabel({ located, moving, points, now, pin }) {
  if (!located || !Number.isFinite(now)) return '';
  const dwell = stayLabelDwellMs(points);
  const movedAt = lastTravelAt(points);
  if (movedAt != null && now >= movedAt && now - movedAt < dwell) return '지금';
  const drawn = drawnPoints(points);
  const end = drawn[drawn.length - 1];
  // A fresh pin can still be travel before that sample is a stored vertex.
  // A walk hop only counts inside the walk dwell. A city-speed pin counts
  // inside the ride dwell, so a quiet sensor does not say 「머무름」 while driving.
  // An older hop does not flip the card back to 「지금」.
  if (pin && end && Number.isFinite(pin.at) && now >= pin.at) {
    const pinAge = now - pin.at;
    if (pinAge < RIDE_STAY_LABEL_MS && isVehicleStep(end, pin)) return '지금';
    if (pinAge < dwell && travelStep(end, pin)) return '지금';
  }
  if (moving === true && movedAt == null) return '지금';
  if (moving === false) return '머무름';
  if (!end) return '지금';
  if (now >= end.at && now - end.at < dwell) return '지금';
  return '머무름';
}

/**
 * Meters the next sample must clear before it is a new vertex.
 * A reported walk, or a 2.5s step whose own pace is a walk: 2.5m.
 * Accuracy must not widen this, or a ±19m fix skips the bend.
 * A stay flag without that pace: about 2× accuracy (26–44m), unless the
 * phone has already stepped 6m at a walking pace. Courtyard jitter stays put.
 */
export function trailMoveGate(last, point) {
  const walkingSpeed = speedShowsMoving(point);
  if (walkingSpeed && point?.staying !== true) return TRAIL_WALK_VERTEX_M;
  if (!stillSample(point) && point?.staying !== true) return TRAIL_WALK_VERTEX_M;
  if (point?.staying === true && walkingSpeed) return TRAIL_WALK_VERTEX_M;
  const pace = stepPace(last, point);
  if (pace && walkPace(pace.speed)) {
    if (point?.staying !== true && pace.moved >= TRAIL_WALK_VERTEX_M && pace.dt >= 1_200 && pace.dt <= 8_000) return TRAIL_WALK_VERTEX_M;
    if (point?.staying === true && pace.moved >= TRAIL_DEPART_STAY_M && pace.dt >= 1_500 && pace.dt <= 12_000) return TRAIL_WALK_VERTEX_M;
  }
  const accuracy = Math.max(positiveMeters(point?.accuracyM), positiveMeters(last?.accuracyM));
  return Math.max(26, Math.min(44, accuracy > 0 ? accuracy * 2.05 : 32));
}

/**
 * One sample that cannot be a step. A neighborhood relocation over a minute
 * still passes. A flash across the map, with no ride speed that matches the
 * ground track, does not.
 */
const TRAIL_SPIKE_WINDOW_MS = 30_000;
const TRAIL_SPIKE_MIN_M = 180;
const TRAIL_SPIKE_MPS = 20;

export function isImpossibleJump(last, point) {
  const pace = stepPace(last, point);
  if (!pace) return false;
  if (pace.speed > FIX_MAX_JUMP_MPS) return true;
  const reported = pointSpeed(point);
  if (reported != null && reported >= TRAIL_RIDE_MIN_MPS && pace.speed <= Math.max(reported * 1.85, reported + 8)) return false;
  // A car on a highway is not a courtyard spike. Teleports stay above ~160 km/h
  // or a short hop. A 20s chord at 30–100 km/h is the gap the distance must keep.
  if (pace.speed <= 45 && pace.dt >= 3_000) return false;
  if (pace.dt > TRAIL_SPIKE_WINDOW_MS || pace.moved < TRAIL_SPIKE_MIN_M) return false;
  if (pace.speed < TRAIL_SPIKE_MPS) return false;
  return true;
}

/**
 * A step the line should keep and draw solid.
 * isRideStep covers a reported speed at or above ~7 km/h, and a missing speed
 * whose ground pace is already a ride.
 * A phone that still says stay, or reports 0, while the ground track is about
 * 30 km/h or faster is the same kind of step. 1.12 snapped that hop inside
 * 120m and dashed anything over 48m and 20s, so a car became a gap.
 * The 2.5s floor keeps a 2s courtyard spike on the walk filters.
 */
export function isVehicleStep(last, point) {
  if (isRideStep(last, point)) return true;
  const reported = pointSpeed(point);
  if (reported != null && reported > 0 && reported < TRAIL_RIDE_MIN_MPS) return false;
  const pace = stepPace(last, point);
  // About 30 km/h. A reported walking speed stays on the walk filters.
  // Under 8s or 60m is the courtyard leap, not a city sample.
  if (!pace || pace.speed < 8 || pace.speed > 45) return false;
  if (pace.dt < 8_000 || pace.moved < 60) return false;
  const accuracy = positiveMeters(point?.accuracyM);
  if (accuracy > TRAIL_POOR_ACCURACY_M && (reported == null || reported < TRAIL_RIDE_MIN_MPS)) return false;
  return !isImpossibleJump(last, point);
}

/**
 * keep: the coordinate extends the walked line, or a relocation past courtyard multipath.
 * snap: inside the step gate, or a still-phone spike. Not a live-pin hold by itself.
 * drop: the sample is too poor to use, or it is an impossible jump.
 * A walk keeps intermediate corners. A stay does not grow a courtyard triangle.
 */
export function trailDecision(last, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.at)) return 'drop';
  if (!last) return 'keep';
  const accuracy = positiveMeters(point.accuracyM);
  const moved = haversineMeters(last, point);
  if (accuracy > FIX_APPROXIMATE_ACCURACY_M) return 'drop';
  // 40–400m is usable when the step is farther than the error. A 55m hop of
  // 70m is still courtyard noise. A neighborhood move is a vertex.
  if (accuracy > TRAIL_POOR_ACCURACY_M && !(Number.isFinite(moved) && moved >= Math.max(TRAIL_STILL_CONFIRM_M, accuracy))) return 'drop';
  const dt = point.at - last.at;
  if (!Number.isFinite(moved) || !Number.isFinite(dt) || dt < 0) return 'drop';
  if (moved === 0 && dt === 0) return 'drop';
  if (isImpossibleJump(last, point)) return 'drop';
  const implied = dt > 0 ? moved / (dt / 1000) : Infinity;
  if (implied > FIX_MAX_JUMP_MPS) return 'drop';
  const reported = pointSpeed(point);
  // A good walking GPS fix is a vertex even when the phone samples every second.
  // The 2.5m gate was dropping those ~1m steps, so the walked line stayed short.
  const groundWalk = implied >= 0.5 && implied <= 3;
  const reportedWalk = reported != null && reported >= 0.7 && reported <= 2.6 && accuracy > 0 && accuracy <= 25 && moved >= 0.2 && (moved <= 8 || groundWalk);
  if (reportedWalk) return 'keep';
  // Bike and vehicle fixes are kept on the GPS clock. A stay flag, or a reported
  // 0, must not snap a city-speed step. Walk jitter still snaps below.
  if (isVehicleStep(last, point)) return 'keep';
  // ~30 km/h or faster is a vehicle sample. A reported speed keeps it even when
  // the stay flag is still set, so a drive does not collapse into a dashed hole.
  // Implied speed alone does not: a stay with a zero reading is courtyard jitter.
  const fastGround = implied >= 8 && implied <= 45 && dt >= 800 && moved >= TRAIL_RIDE_MIN_STEP_M;
  if (reported != null && reported >= 8 && fastGround) return 'keep';
  if (reported == null && point?.staying !== true && fastGround) return 'keep';
  if (moved <= trailMoveGate(last, point)) return 'snap';
  // A stay flag with a walking GPS speed still keeps 4m vertices.
  // A fast hop inside the bubble is multipath that borrowed a speed reading.
  // The live pin is not decided here: liveCoordinate follows anything outside staySnapGate.
  if (point?.staying === true && speedShowsMoving(point) && moved <= staySnapGate(last, point)) {
    const walkLike = implied >= 0.75 && implied <= 2.8 && dt >= 2_000;
    if (!walkLike) return 'snap';
  }
  // Speed is missing on many walking fixes. Keep a calm step past the jitter gate.
  // A fast hop under a neighborhood move snaps. The pin still follows past the stay bubble.
  if (stillSample(point) && point?.staying === true && moved <= TRAIL_RELOCATION_M) {
    const bubble = staySnapGate(last, point);
    const paced = implied >= TRAIL_STILL_PACE_MIN_MPS && implied <= TRAIL_STILL_PACE_MAX_MPS && moved >= TRAIL_STILL_STEP_M && dt >= TRAIL_STILL_STEP_MS;
    if (moved <= bubble) {
      if (!paced) return 'snap';
    } else if (!paced) return 'snap';
  } else if (stillSample(point) && moved <= TRAIL_RELOCATION_M) {
    const reportedStillWalk = point?.staying !== true && walkPace(implied) && moved >= TRAIL_WALK_VERTEX_M && dt >= 1_200 && dt <= 8_000;
    if (!reportedStillWalk) {
      const paced = implied >= 0.7 && implied <= TRAIL_STILL_PACE_MAX_MPS && moved >= TRAIL_STILL_STEP_M && dt >= TRAIL_STILL_STEP_MS;
      if (!paced) return 'snap';
    }
  }
  return 'keep';
}

/** Bubble inside which the live pin may reuse the anchor. A farther fix is where the phone is now. */
export function staySnapGate(last, point) {
  const accuracy = Math.max(positiveMeters(point?.accuracyM), positiveMeters(last?.accuracyM));
  return Math.max(STOP_RADIUS_M, accuracy * 2);
}

/** Still phone: the stay flag, or a reported speed under a walk. A missing speed is not still by itself. */
function stationarySample(point) {
  if (speedShowsMoving(point)) return false;
  if (point?.staying === true) return true;
  const speed = pointSpeed(point);
  return speed != null && speed < TRAIL_STAY_SPEED_MPS;
}

/**
 * Walk-sized progress off a stay. A corner stays. A leap, or a step that
 * folds back on the previous vertex, does not.
 * After the phone has already rested on the anchor, the next walk-sized
 * step may leave in any direction.
 */
function explicitStill(point) {
  if (speedShowsMoving(point)) return false;
  if (point?.staying === true) return true;
  const speed = pointSpeed(point);
  return speed != null && speed < TRAIL_STAY_SPEED_MPS;
}

/**
 * Still-phone jump that is longer than a walked step.
 * 25–50m samples with a quiet speed flag are the 1.12 walk. Farther than
 * about 70m, with no walking speed, is a building hop.
 */
const INDOOR_STILL_WALK_M = 70;

function indoorLeap(prev, point) {
  if (!prev || !point || point.stayEnd || !explicitStill(point)) return false;
  if (isRideStep(prev, point)) return false;
  const reported = pointSpeed(point);
  if (reported != null && reported >= TRAIL_RIDE_MIN_MPS) return false;
  const moved = haversineMeters(prev, point);
  if (!Number.isFinite(moved) || moved > INDOOR_STAY_RADIUS_M) return false;
  if (positiveMeters(point.accuracyM) > TRAIL_POOR_ACCURACY_M && moved >= TRAIL_WALK_VERTEX_M) return true;
  return moved >= INDOOR_STILL_WALK_M;
}

function continuesStillWalk(points, point) {
  const anchor = drawnAnchor(points);
  if (!anchor) return false;
  if (indoorLeap(anchor, point)) return false;
  const pace = stepPace(anchor, point);
  if (!pace || pace.moved < TRAIL_DEPART_STAY_M || pace.moved > INDOOR_WALK_STEP_M) return false;
  if (pace.speed < 0.75 || pace.speed > 2.8 || pace.dt < 1_200 || pace.dt > 60_000) return false;
  const prev = previousVertex(points);
  if (!prev) return true;
  if (anchor.at - prev.at >= STOP_MIN_MS) return true;
  const marked = Array.isArray(points) ? points[points.length - 1] : null;
  if (marked?.stayEnd && marked.at >= anchor.at) return true;
  const turn = Math.abs(signedTurnDeg(prev, anchor, point));
  if (!Number.isFinite(turn) || turn > 115) return false;
  if (haversineMeters(prev, point) + 6 < haversineMeters(prev, anchor)) return false;
  return true;
}

/**
 * Stationary indoor drift. Poor accuracy or a near-zero-speed fix inside
 * the stay radius does not extend the line. A real walk or ride still does.
 */
function indoorStayDrift(points, point) {
  if (!point || point.stayEnd || !stationarySample(point)) return false;
  const anchor = drawnAnchor(points);
  const accurateRide = isVehicleStep(anchor, point)
    && positiveMeters(point.accuracyM) > 0
    && positiveMeters(point.accuracyM) <= TRAIL_POOR_ACCURACY_M;
  if (!anchor || accurateRide || isRideStep(anchor, point)) return false;
  const moved = haversineMeters(anchor, point);
  if (!Number.isFinite(moved) || moved > INDOOR_STAY_RADIUS_M) return false;
  // An accurate step past 120m is a real relocation. A poor fix in that range is indoor multipath.
  if (moved > TRAIL_RELOCATION_M && !(positiveMeters(point.accuracyM) > TRAIL_POOR_ACCURACY_M)) return false;
  if (continuesStillWalk(points, point)) return false;
  if (positiveMeters(point.accuracyM) >= 30 && moved >= TRAIL_WALK_VERTEX_M) return true;
  if (moved >= INDOOR_LEAP_M) return true;
  return point.staying === true && moved >= TRAIL_WALK_VERTEX_M;
}

function longStayMarked(points, anchor) {
  const last = Array.isArray(points) ? points[points.length - 1] : null;
  return !!(last?.stayEnd && anchor && last.at - anchor.at >= STOP_MIN_MS);
}

/** The sit this short step is leaving, once that sit itself lasted. */
function staySit(points, anchor) {
  const prev = previousVertex(points);
  if (!prev || !anchor) return null;
  return anchor.at - prev.at >= STOP_MIN_MS ? prev : null;
}

/**
 * A real walk leaving a sit. Indoor jitter has no direction, or a reported
 * speed near zero. A walk has good accuracy and keeps getting farther from
 * the sit at a walking pace. The first step's clock still includes the sit,
 * so that one short step is kept and the next sample shows the pace.
 */
function departsOnFoot(points, point) {
  if (!point || point.stayEnd) return false;
  const accuracy = positiveMeters(point.accuracyM);
  if (!(accuracy > 0) || accuracy > 25) return false;
  const reported = pointSpeed(point);
  if (reported != null && reported < 0.4) return false;
  const list = Array.isArray(points) ? points : [];
  const anchor = drawnAnchor(list);
  if (!anchor || !Number.isFinite(anchor.at)) return false;
  const moved = haversineMeters(anchor, point);
  const dt = point.at - anchor.at;
  if (!(moved >= 8) || dt < 800) return false;
  const speed = moved / (dt / 1000);
  const origin = previousVertex(list);
  const folding = origin && haversineMeters(origin, point) + 4 < haversineMeters(origin, anchor);
  const longSit = dt >= STOP_MIN_MS || longStayMarked(list, anchor);
  if (dt <= 90_000 && speed >= 0.7 && speed <= 2.6) {
    const sit = sitBehind(list);
    const left = sit ? haversineMeters(sit, anchor) : 0;
    // Still inside the sit: a step that folds back is jitter. Once the walk
    // is about 40m out, the way back is the same walk, not a cloud.
    if (left < 40 && (folding || (sit && sit !== anchor && haversineMeters(sit, point) + 4 < left))) return false;
    return true;
  }
  if (point.staying !== true || !longSit || moved > 48) return false;
  return true;
}

/** A lone first step off a sit. The next sample must continue it, or it is jitter. */
function unconfirmedDeparture(prev, tip) {
  if (!prev || !tip || tip.staying !== true) return false;
  const reported = pointSpeed(tip);
  if (reported != null && reported >= 0.4) return false;
  const moved = haversineMeters(prev, tip);
  const dt = tip.at - prev.at;
  return moved >= 8 && moved <= 48 && dt >= STOP_MIN_MS;
}

export function walkLeavesStay(points, point) {
  return departsOnFoot(points, point);
}

function resolvedTrailDecision(points, point) {
  if (departsOnFoot(points, point)) return 'keep';
  const anchor = drawnAnchor(Array.isArray(points) ? points : []);
  const decision = trailDecision(anchor, point);
  if (decision === 'keep' && indoorStayDrift(points, point)) return 'snap';
  return decision;
}

/**
 * Live pin and the coordinate published to the family.
 * Holds only inside the stay bubble. Bus, subway, and a sparse GPS jump past that
 * bubble move the pin even when the trail sampler still drops the vertex.
 * A dropped sample that is only an indoor-quality reading (worse than the trail
 * gate, still within FIX_PRECISE_ACCURACY_M) moves the pin. An impossible jump
 * does not.
 */
export function liveCoordinate(anchor, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    if (anchor && Number.isFinite(anchor.lat) && Number.isFinite(anchor.lng)) {
      return { ...point, lat: anchor.lat, lng: anchor.lng };
    }
    return point;
  }
  if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return point;
  const decision = trailDecision(anchor, point);
  if (decision === 'keep') return point;
  if (decision === 'drop') {
    const accuracy = positiveMeters(point.accuracyM);
    if (accuracy > TRAIL_POOR_ACCURACY_M && accuracy <= FIX_APPROXIMATE_ACCURACY_M && !isImpossibleJump(anchor, point)) {
      const moved = haversineMeters(anchor, point);
      if (accuracy <= FIX_PRECISE_ACCURACY_M || moved >= Math.max(TRAIL_STILL_CONFIRM_M, accuracy)) return point;
    }
    return { ...point, lat: anchor.lat, lng: anchor.lng };
  }
  if (haversineMeters(anchor, point) <= staySnapGate(anchor, point)) {
    return { ...point, lat: anchor.lat, lng: anchor.lng };
  }
  return point;
}

export function shouldKeepTrailPoint(last, point) {
  return trailDecision(last, point) === 'keep';
}

function drawnAnchor(points) {
  if (!Array.isArray(points)) return null;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point && !point.stayEnd) return point;
  }
  return null;
}

function previousVertex(points) {
  if (!Array.isArray(points)) return null;
  let seen = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (!point || point.stayEnd) continue;
    seen += 1;
    if (seen === 2) return point;
  }
  return null;
}

/** The newest vertex was a there-and-back spike once this sample is known. */
function trailingSpur(points, point) {
  const tip = drawnAnchor(points);
  const prev = previousVertex(points);
  if (!tip || !prev || !point || tip === point) return false;
  const sit = sitBehind(points);
  // A walk that already left the sit keeps its far corner. Turning back for
  // the return must not peel that line off as if it were a courtyard spike.
  if (sit && haversineMeters(sit, tip) >= 40) return false;
  if (unconfirmedDeparture(prev, tip)) {
    const step = stepPace(tip, point);
    const onward = step
      && step.moved >= 8
      && step.dt >= 800
      && step.dt <= 90_000
      && step.speed >= 0.7
      && step.speed <= 2.6
      && haversineMeters(prev, point) + 4 >= haversineMeters(prev, tip);
    if (!onward) return true;
  }
  if (spikeDeviation(prev, tip, point) > 0) return true;
  // A stored walk often has no speed. Only an explicit still reading (stay flag or ~0 m/s) is a spike.
  const tipStill = tip.staying === true || (pointSpeed(tip) != null && pointSpeed(tip) < TRAIL_STAY_SPEED_MPS);
  if (tipStill && haversineMeters(prev, point) <= STOP_RADIUS_M && haversineMeters(prev, tip) >= INDOOR_LEAP_M) return true;
  if (isVehicleStep(prev, tip) || isVehicleStep(tip, point)) return false;
  if (speedShowsMoving(point) && point.staying !== true) return false;
  if (!stillSample(point) && point.staying !== true) return false;
  const turn = Math.abs(signedTurnDeg(prev, tip, point));
  if (!Number.isFinite(turn) || turn < 120) return false;
  if (haversineMeters(tip, point) > staySnapGate(tip, point)) return false;
  return haversineMeters(prev, point) + 8 < haversineMeters(prev, tip);
}

function withoutVertex(points, vertex) {
  const next = points.filter((point) => point !== vertex);
  const anchors = next.filter((point) => point && !point.stayEnd);
  return next.filter((point) => {
    if (!point?.stayEnd) return true;
    return anchors.some((anchor) => haversineMeters(anchor, point) <= 20);
  });
}

function rememberStay(kept, anchor, point) {
  if (!anchor || point.at - anchor.at < STOP_MIN_MS) return;
  const last = kept[kept.length - 1];
  if (last && last.stayEnd) kept[kept.length - 1] = { ...last, at: point.at, accuracyM: point.accuracyM ?? last.accuracyM };
  else kept.push({ lat: anchor.lat, lng: anchor.lng, at: point.at, speedMps: 0, accuracyM: point.accuracyM, stayEnd: true });
}

/** Drop stay jitter and multipath spurs. A long stay keeps one extra timestamp at the same coordinate. */
export function collapseStayTrail(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const kept = [];
  let changed = false;
  for (const point of points) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.at)) {
      changed = true;
      continue;
    }
    let anchor = drawnAnchor(kept);
    if (!anchor) {
      if (point.stayEnd) {
        changed = true;
        continue;
      }
      kept.push(point);
      continue;
    }
    if (trailingSpur(kept, point)) {
      const stripped = withoutVertex(kept, anchor);
      kept.length = 0;
      kept.push(...stripped);
      changed = true;
      anchor = drawnAnchor(kept);
      if (!anchor) {
        if (!point.stayEnd) kept.push(point);
        else changed = true;
        continue;
      }
    }
    const decision = resolvedTrailDecision(kept, point);
    if (decision === 'drop' || decision === 'snap') {
      changed = true;
      if (decision === 'snap') rememberStay(kept, anchor, point);
      continue;
    }
    if (point.stayEnd) {
      changed = true;
      continue;
    }
    kept.push(point);
  }
  const despiked = removeMultipathSpurs(kept);
  if (despiked !== kept) return despiked;
  if (!changed && kept.length === points.length) return points;
  return kept;
}

/** Put a walked vertex back when simplify would leave one long chord. */
function restoreWalkVertices(source, simplified) {
  if (!Array.isArray(simplified) || simplified.length < 2 || !Array.isArray(source) || source.length < 3) return simplified;
  const output = [simplified[0]];
  for (let index = 0; index < simplified.length - 1; index += 1) {
    const start = simplified[index];
    const end = simplified[index + 1];
    const startAt = source.indexOf(start);
    const endAt = source.indexOf(end);
    if (startAt >= 0 && endAt > startAt + 1 && haversineMeters(start, end) >= TRAIL_CHORD_BREAK_M) {
      let best = null;
      let bestDev = TRAIL_SIMPLIFY_M;
      for (let cursor = startAt + 1; cursor < endAt; cursor += 1) {
        const candidate = source[cursor];
        if (!candidate) continue;
        const deviation = perpendicularDistanceM(candidate, start, end);
        if (deviation > bestDev) {
          bestDev = deviation;
          best = candidate;
        }
      }
      if (best && output[output.length - 1] !== best) output.push(best);
    }
    output.push(end);
  }
  return output;
}

/** Pull only a sub-meter wobble on an almost straight step. A bend of a few meters stays put. */
function smoothShallowBends(points) {
  if (!Array.isArray(points) || points.length < 3) return points;
  const next = points.map((point) => ({ ...point }));
  for (let index = 1; index < points.length - 1; index += 1) {
    const turn = Math.abs(signedTurnDeg(points[index - 1], points[index], points[index + 1]));
    const deviation = perpendicularDistanceM(points[index], points[index - 1], points[index + 1]);
    if (!Number.isFinite(turn) || turn >= 15 || deviation >= 2) continue;
    next[index] = {
      ...points[index],
      lat: points[index].lat * 0.9 + (points[index - 1].lat + points[index + 1].lat) * 0.05,
      lng: points[index].lng * 0.9 + (points[index - 1].lng + points[index + 1].lng) * 0.05,
    };
  }
  return next;
}

function clusterSpread(points) {
  let lat = 0;
  let lng = 0;
  for (const point of points) {
    lat += point.lat;
    lng += point.lng;
  }
  const center = { lat: lat / points.length, lng: lng / points.length };
  let max = 0;
  for (const point of points) max = Math.max(max, haversineMeters(center, point));
  return max;
}

function stayCentroid(cluster) {
  let lat = 0;
  let lng = 0;
  for (const point of cluster) {
    lat += point.lat;
    lng += point.lng;
  }
  const last = cluster[cluster.length - 1];
  return {
    ...last,
    lat: lat / cluster.length,
    lng: lng / cluster.length,
    at: last.at,
    speedMps: 0,
    staying: true,
  };
}

/**
 * Place-name coordinate. A stay uses the latest fix accurate enough for the
 * trail, not the average of the cluster and not a later indoor hop.
 * While moving, the current pin is the coordinate.
 */
export function labelCoordinate(points, fallback, moving) {
  const lat = Number(fallback?.lat);
  const lng = Number(fallback?.lng);
  const pin = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  if (moving === true) return pin;
  const source = Array.isArray(points) ? points : [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const point = source[index];
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    if (point.stayEnd === true) return { lat: point.lat, lng: point.lng };
    if (point.staying !== true && index === source.length - 1) break;
    const accuracy = positiveMeters(point.accuracyM);
    if (accuracy > 0 && accuracy <= TRAIL_POOR_ACCURACY_M) return { lat: point.lat, lng: point.lng };
  }
  return pin;
}

/** GPS jitter snaps to the stay-cluster centroid so a pin does not jump to the next POI. */
export function stayLabelPoint(points, fallback, moving) {
  const lat = Number(fallback?.lat);
  const lng = Number(fallback?.lng);
  const backup = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  if (moving === true) return backup;
  const source = Array.isArray(points) ? points : [];
  const cluster = [];
  for (let index = source.length - 1; index >= 0; index -= 1) {
    const point = source[index];
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    if (point.stayEnd === true) break;
    if (point.staying !== true && cluster.length === 0) break;
    if (cluster.length && haversineMeters(cluster[0], point) > STAY_BOUND_RADIUS_M) break;
    cluster.push(point);
  }
  if (cluster.length < 3) return backup;
  const center = stayCentroid(cluster);
  return { lat: center.lat, lng: center.lng };
}

function travelShape(points) {
  const path = pathDistance(points);
  const net = haversineMeters(points[0], points[points.length - 1]);
  return { path, net, ratio: path > 0 ? net / path : 1 };
}

/** Net progress, not a cloud that folds back on itself. */
function isDirectionalTravel(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const { path, net, ratio } = travelShape(points);
  if (path < 28) return false;
  return net >= 30 && ratio >= 0.62;
}

/** A cloud that stays inside the building radius and does not make net progress. */
function isIndoorScribble(points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  for (let index = 1; index < points.length; index += 1) {
    if (isRideStep(points[index - 1], points[index])) return false;
    if (speedShowsMoving(points[index]) && points[index].staying !== true) return false;
  }
  if (clusterSpread(points) > INDOOR_STAY_RADIUS_M) return false;
  const { path, net, ratio } = travelShape(points);
  if (path < 40) return false;
  if (net >= 35 && ratio >= 0.5) return false;
  return true;
}

function extendsIndoorScribble(cluster, point) {
  const prev = cluster[cluster.length - 1];
  if (!prev) return false;
  if (isRideStep(prev, point)) return false;
  if (speedShowsMoving(point) && point.staying !== true) return false;
  const trial = cluster.concat([point]);
  if (clusterSpread(trial) > INDOOR_STAY_RADIUS_M) return false;
  if (isDirectionalTravel(trial)) return false;
  return true;
}

/**
 * Draw a stay cloud as one centroid. Stored journey points often have no
 * speed, so the sampler's stay flag cannot see them. A walk or ride whose
 * net progress is real is left point for point.
 */
export function collapseIndoorStayDisplay(points) {
  if (!Array.isArray(points) || points.length < 3) return Array.isArray(points) ? points : [];
  const source = [];
  for (const point of points) {
    if (!point || point.stayEnd || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    source.push(point);
  }
  if (source.length < 3) return points;
  const output = [];
  let cluster = [];
  const flush = () => {
    if (cluster.length === 0) return;
    if (isIndoorScribble(cluster)) output.push(stayCentroid(cluster));
    else output.push(...cluster);
    cluster = [];
  };
  for (const point of source) {
    if (cluster.length === 0) {
      cluster.push(point);
      continue;
    }
    if (extendsIndoorScribble(cluster, point)) cluster.push(point);
    else {
      flush();
      cluster.push(point);
    }
  }
  flush();
  if (output.length === source.length && output.every((point, index) => point === source[index])) return points;
  return output;
}

function dropReturnSpikes(points) {
  if (!Array.isArray(points) || points.length < 3) return points;
  const kept = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = kept[kept.length - 1];
    const point = points[index];
    const next = points[index + 1];
    const out = haversineMeters(prev, point);
    const back = haversineMeters(point, next);
    const span = haversineMeters(prev, next);
    const quiet = point?.staying === true || (pointSpeed(point) != null && pointSpeed(point) < TRAIL_STAY_SPEED_MPS);
    const poor = positiveMeters(point?.accuracyM) > TRAIL_POOR_ACCURACY_M;
    if ((quiet || poor) && out >= INDOOR_LEAP_M && back >= INDOOR_LEAP_M && span <= STOP_RADIUS_M && !isRideStep(prev, point)) continue;
    kept.push(point);
  }
  kept.push(points[points.length - 1]);
  return kept.length === points.length ? points : kept;
}

function sampledTrail(points) {
  const collapsed = dropReturnSpikes(collapseIndoorStayDisplay(collapseStayTrail(points)));
  const drawn = [];
  for (const point of collapsed) {
    if (!point || point.stayEnd) continue;
    const prev = drawn[drawn.length - 1];
    if (prev && haversineMeters(prev, point) < 0.25) continue;
    drawn.push(point);
  }
  return drawn;
}

function simplifyDrawn(drawn) {
  if (!Array.isArray(drawn) || drawn.length < 3) return drawn;
  const simplified = douglasPeucker(drawn, displaySimplifyMeters());
  return smoothShallowBends(restoreWalkVertices(drawn, simplified));
}

/**
 * One Chaikin pass. New vertices stay on the sampled segments, so the line
 * rounds without drawing a road the GPS did not walk.
 */
function roundWalk(points) {
  if (!Array.isArray(points) || points.length < 3) return points;
  const output = [points[0]];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (haversineMeters(start, end) >= TRAIL_GAP_M) {
      output.push(end);
      continue;
    }
    if (index > 0) {
      output.push({
        ...start,
        lat: start.lat * 0.75 + end.lat * 0.25,
        lng: start.lng * 0.75 + end.lng * 0.25,
      });
    }
    if (index < points.length - 2) {
      output.push({
        ...end,
        lat: start.lat * 0.25 + end.lat * 0.75,
        lng: start.lng * 0.25 + end.lng * 0.75,
        at: end.at,
      });
    } else {
      output.push(end);
    }
  }
  return output;
}

/**
 * Longest calm-walk chord that is still one kept step, not a whole trip.
 * Network fixes are stored only after they clear the accuracy gate, so the
 * vertex spacing is often one or two minutes.
 */
const TRAIL_WALK_CHORD_M = 280;

/**
 * True when the straight segment between two kept samples is a hole, not a walked step.
 * Continuous vertices are a few meters apart and are not dashed.
 * A long chord with time enough to have sampled the middle is dashed as-is.
 * Drawing may still keep a calm walk when that spacing is the trail itself.
 */
export function trailSegmentDashed(start, end) {
  if (!start || !end) return false;
  const moved = haversineMeters(start, end);
  if (!Number.isFinite(moved) || moved < TRAIL_GAP_M) return false;
  const dt = Number(end.at) - Number(start.at);
  return !Number.isFinite(dt) || dt >= TRAIL_GAP_MS;
}

/**
 * A dashed gap the main line should still paint.
 * Sparse and coarse walks have no denser sample: the chord is the step.
 * The same pace after a few-meter GPS fix is a hole in a dense trail, and stays dashed.
 */
export function trailDrawDashed(start, end, prior) {
  if (!trailSegmentDashed(start, end)) return false;
  const moved = haversineMeters(start, end);
  const dt = Number(end.at) - Number(start.at);
  if (!Number.isFinite(moved) || !Number.isFinite(dt) || dt <= 0) return true;
  const pace = moved / (dt / 1000);
  // A stay flag left over from the sit does not turn a walked pace into a hole.
  if (moved > TRAIL_WALK_CHORD_M || pace < 0.7 || pace > 2.8) return true;
  if (prior && !prior.stayEnd && Number.isFinite(prior.lat) && Number.isFinite(prior.lng)) {
    const prevMoved = haversineMeters(prior, start);
    const prevDt = Number(start.at) - Number(prior.at);
    if (Number.isFinite(prevMoved) && prevMoved < TRAIL_GAP_M && Number.isFinite(prevDt) && prevDt > 0 && prevDt < TRAIL_GAP_MS && moved > prevMoved * 3) {
      return true;
    }
  }
  return false;
}

/** The live pin is not always the last painted vertex. A walked pace stays solid. */
export function appendLiveTip(parts, trailEnd) {
  const painted = (Array.isArray(parts) ? parts : []).filter((part) => part && Array.isArray(part.points) && part.points.length >= 2);
  const previous = painted[painted.length - 1];
  const paintedEnd = previous ? previous.points[previous.points.length - 1] : null;
  if (!trailEnd || !paintedEnd || !Number.isFinite(trailEnd.lat) || !Number.isFinite(trailEnd.lng)) return painted;
  const sameTip = Math.abs(paintedEnd.lat - trailEnd.lat) < 1e-5 && Math.abs(paintedEnd.lng - trailEnd.lng) < 1e-5;
  if (sameTip || isImpossibleJump(paintedEnd, trailEnd)) return painted;
  if (!previous.dashed) {
    previous.points = previous.points.concat([trailEnd]);
    return painted;
  }
  painted.push({ points: [paintedEnd, trailEnd], dashed: false });
  return painted;
}

/**
 * Solid runs are sampled walks, simplified only under TRAIL_SIMPLIFY_M.
 * A walk hole (48m and 20s) is the raw dashed chord, the same split as 1.12.
 * A vehicle step stays inside the solid run, so a car is not a dashed gap and
 * Douglas–Peucker does not replace a sampled corner with a longer chord.
 * An impossible jump is not drawn. No road geometry is added.
 */
export function trailDrawParts(points) {
  const sampled = sampledTrail(points);
  if (sampled.length < 2) return [{ points: sampled, dashed: false }];
  const parts = [];
  let run = [sampled[0]];
  const flushRun = () => {
    if (run.length >= 2) parts.push({ points: roundWalk(simplifyDrawn(run)), dashed: false });
    run = [];
  };
  for (let index = 1; index < sampled.length; index += 1) {
    const prev = sampled[index - 1];
    const next = sampled[index];
    if (isImpossibleJump(prev, next)) {
      flushRun();
      run = [next];
    } else if (run.length === 0) {
      run = [next];
    } else {
      run.push(next);
    }
  }
  flushRun();
  if (parts.length === 0) return [{ points: sampled, dashed: false }];
  return parts;
}

/**
 * Polyline vertices for every member.
 * Stay markers, indoor drift inside the stay radius, and thin there-and-back spikes are not drawn.
 * Walking corners stay. Douglas–Peucker runs only here so stored history can still rebuild a bend.
 */
export function visibleTrail(points) {
  return simplifyDrawn(sampledTrail(points));
}

/** Relative age of the last fix, so a row can say whether the pin is live. */
export function formatFixAge(at, now = Date.now()) {
  if (!Number.isFinite(at) || !Number.isFinite(now)) return '';
  const delta = Math.max(0, now - at);
  if (delta < 45_000) return '방금 업데이트';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '1분 전 업데이트';
  if (minutes < 60) return `${minutes}분 전 업데이트`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전 업데이트`;
  return `${Math.floor(hours / 24)}일 전 업데이트`;
}

export function displayCoordinate(points, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return point;
  const anchor = drawnAnchor(visibleTrail(points));
  if (!anchor) return point;
  return liveCoordinate(anchor, point);
}

export function settleTrailPoint(points, point, now) {
  const existing = Array.isArray(points) ? points : [];
  const collapsed = collapseStayTrail(existing);
  const anchor = drawnAnchor(collapsed);
  const decision = resolvedTrailDecision(collapsed, point);
  const pin = liveCoordinate(anchor, point);
  if (decision !== 'keep') {
    const next = decision === 'snap' ? appendHistoryPoint(collapsed, point, now) : collapsed;
    return {
      points: next,
      lat: pin && Number.isFinite(pin.lat) ? pin.lat : (anchor ? anchor.lat : null),
      lng: pin && Number.isFinite(pin.lng) ? pin.lng : (anchor ? anchor.lng : null),
      decision,
    };
  }
  return {
    points: appendHistoryPoint(collapsed, point, now),
    lat: point.lat,
    lng: point.lng,
    decision: 'keep',
  };
}

export function tracksForSeoulDay(tracks, now) {
  const day = seoulDayKey(now);
  const next = {};
  if (!tracks || typeof tracks !== 'object') return next;
  for (const [id, points] of Object.entries(tracks)) {
    if (!Array.isArray(points)) continue;
    const kept = points.filter((point) => point && Number.isFinite(point.at) && seoulDayKey(point.at) === day).slice(-TRAIL_POINT_CAP);
    if (kept.length > 0) next[id] = kept;
  }
  return next;
}

export function visitsForSeoulDay(visits, now) {
  const day = seoulDayKey(now);
  const next = {};
  if (!visits || typeof visits !== 'object') return next;
  for (const [id, list] of Object.entries(visits)) {
    if (!Array.isArray(list)) continue;
    const kept = list.filter((visit) => visit && Number.isFinite(visit.arrivedAt) && seoulDayKey(visit.arrivedAt) === day).slice(-VISIT_DAY_CAP);
    if (kept.length > 0) next[id] = kept;
  }
  return next;
}

function calendarDayKey(year, monthIndex, day) {
  const dt = new Date(Date.UTC(year, monthIndex, day));
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const date = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${month}-${date}`;
}

export function shiftDayKey(dayKey, deltaDays) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  if (!year || !month || !day) return '';
  return calendarDayKey(year, month - 1, day + deltaDays);
}

export function oldestHistoryDay(now) {
  return shiftDayKey(seoulDayKey(now), -HISTORY_DAYS);
}

export function isWithinHistory(epochMs, now) {
  const day = seoulDayKey(epochMs);
  const today = seoulDayKey(now);
  const oldest = oldestHistoryDay(now);
  return Boolean(day && today && oldest && day >= oldest && day <= today);
}

export function historyDayKeys(now) {
  const today = seoulDayKey(now);
  const keys = [];
  for (let offset = 0; offset <= HISTORY_DAYS; offset += 1) keys.push(shiftDayKey(today, -offset));
  return keys;
}

export function historyDayLabel(dayKey, now) {
  const today = seoulDayKey(now);
  if (dayKey === today) return '오늘';
  if (dayKey === shiftDayKey(today, -1)) return '어제';
  const [year, month, day] = String(dayKey).split('-');
  if (today.slice(0, 4) === year) return `${Number(month)}월 ${Number(day)}일`;
  return `${year}.${Number(month)}.${Number(day)}`;
}

export function seoulDayEndMs(dayKey) {
  const [year, month, day] = String(dayKey).split('-').map(Number);
  if (!year || !month || !day) return Date.now();
  return Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000 + 86_400_000 - 1;
}

function sameList(left, right) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return false;
  return true;
}

export function trimMemberPoints(points, now) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const today = seoulDayKey(now);
  const oldest = oldestHistoryDay(now);
  const byDay = new Map();
  let dropped = false;
  for (const point of points) {
    if (!point || !Number.isFinite(point.at)) {
      dropped = true;
      continue;
    }
    const day = seoulDayKey(point.at);
    if (!day || day < oldest || day > today) {
      dropped = true;
      continue;
    }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(point);
    else byDay.set(day, [point]);
  }
  const kept = [];
  for (const day of [...byDay.keys()].sort()) {
    const bucket = byDay.get(day);
    const slice = bucket.length > TRAIL_POINT_CAP ? bucket.slice(-TRAIL_POINT_CAP) : bucket;
    if (slice.length !== bucket.length) dropped = true;
    kept.push(...slice);
  }
  if (!dropped && sameList(points, kept)) return points;
  return kept;
}

export function appendHistoryPoint(points, point, now) {
  const anchorNow = Number.isFinite(now) ? now : point?.at;
  let base = collapseStayTrail(Array.isArray(points) ? points : []);
  if (point && trailingSpur(base, point)) {
    const tip = drawnAnchor(base);
    if (tip) base = withoutVertex(base, tip);
  }
  const anchor = drawnAnchor(base);
  const decision = resolvedTrailDecision(base, point);
  if (decision === 'drop' || !point || !Number.isFinite(point.at)) {
    const trimmed = trimMemberPoints(base, anchorNow);
    return trimmed === points ? points : trimmed;
  }
  if (decision === 'snap' && anchor) {
    if (point.at - anchor.at < STOP_MIN_MS) {
      const trimmed = trimMemberPoints(base, anchorNow);
      return trimmed === points ? points : trimmed;
    }
    const next = base.slice();
    const last = next[next.length - 1];
    if (last && last.stayEnd) next[next.length - 1] = { ...last, at: point.at, accuracyM: point.accuracyM ?? last.accuracyM };
    else next.push({ lat: anchor.lat, lng: anchor.lng, at: point.at, speedMps: 0, accuracyM: point.accuracyM, stayEnd: true });
    return trimMemberPoints(next, anchorNow);
  }
  const next = base.slice();
  next.push(point);
  return trimMemberPoints(next, anchorNow);
}

export function tracksWithinHistory(tracks, now) {
  if (!tracks || typeof tracks !== 'object') return {};
  let changed = false;
  const next = {};
  const ids = Object.keys(tracks);
  for (const id of ids) {
    const points = tracks[id];
    if (!Array.isArray(points)) {
      changed = true;
      continue;
    }
    const trimmed = trimMemberPoints(points, now);
    if (trimmed.length === 0) {
      if (points.length > 0) changed = true;
      continue;
    }
    next[id] = trimmed;
    if (trimmed !== points) changed = true;
  }
  if (!changed && Object.keys(next).length === ids.length) return tracks;
  return next;
}

function trimVisitList(list, now) {
  if (!Array.isArray(list)) return [];
  const today = seoulDayKey(now);
  const oldest = oldestHistoryDay(now);
  const byDay = new Map();
  let dropped = false;
  for (const visit of list) {
    if (!visit || !Number.isFinite(visit.arrivedAt)) {
      dropped = true;
      continue;
    }
    const day = seoulDayKey(visit.arrivedAt);
    if (!day || day < oldest || day > today) {
      dropped = true;
      continue;
    }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(visit);
    else byDay.set(day, [visit]);
  }
  const kept = [];
  for (const day of [...byDay.keys()].sort()) {
    const bucket = byDay.get(day);
    const slice = bucket.length > VISIT_DAY_CAP ? bucket.slice(-VISIT_DAY_CAP) : bucket;
    if (slice.length !== bucket.length) dropped = true;
    kept.push(...slice);
  }
  if (!dropped && sameList(list, kept)) return list;
  return kept;
}

export function visitsWithinHistory(visits, now) {
  if (!visits || typeof visits !== 'object') return {};
  let changed = false;
  const next = {};
  const ids = Object.keys(visits);
  for (const id of ids) {
    const list = visits[id];
    if (!Array.isArray(list)) {
      changed = true;
      continue;
    }
    const trimmed = trimVisitList(list, now);
    if (trimmed.length === 0) {
      if (list.length > 0) changed = true;
      continue;
    }
    next[id] = trimmed;
    if (trimmed !== list) changed = true;
  }
  if (!changed && Object.keys(next).length === ids.length) return visits;
  return next;
}

export function acceptFix(previous, reading, options = {}) {
  const precise = options.precise !== false;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const lat = Number(reading?.lat);
  const lng = Number(reading?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { ok: false, reason: 'coords' };
  }
  const at = Number(reading?.at);
  if (!Number.isFinite(at) || now - at > FIX_STALE_MS || at > now + 10_000) {
    return { ok: false, reason: 'stale' };
  }
  let accuracy = Number(reading?.accuracy);
  const maxAccuracy = precise ? FIX_PRECISE_ACCURACY_M : FIX_APPROXIMATE_ACCURACY_M;
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    if (precise) return { ok: false, reason: 'accuracy' };
    accuracy = maxAccuracy;
  }
  if (accuracy > maxAccuracy) return { ok: false, reason: 'accuracy' };
  if (previous && Number.isFinite(previous.at)) {
    const dtMs = at - previous.at;
    // A cached network fix can be older than the precise pin. Negative dt used
    // to skip the jump check and replace that pin.
    if (dtMs < 0) return { ok: false, reason: 'stale' };
    if (dtMs > 0 && dtMs <= FIX_JUMP_WINDOW_MS) {
      const speed = haversineMeters(previous, { lat, lng }) / (dtMs / 1000);
      if (speed > FIX_MAX_JUMP_MPS) return { ok: false, reason: 'jump' };
    }
  }
  let speedMps = null;
  if (typeof reading.speedMps === 'number' && Number.isFinite(reading.speedMps) && reading.speedMps >= 0 && reading.speedMps < 400) {
    speedMps = reading.speedMps;
  }
  return { ok: true, fix: { lat, lng, accuracy, at, speedMps } };
}

export function classifyMode(speedKmh, distanceM, durationMs) {
  const speed = Number.isFinite(speedKmh) ? speedKmh : 0;
  const distance = Number.isFinite(distanceM) ? distanceM : 0;
  const duration = Number.isFinite(durationMs) ? durationMs : 0;
  if (distance < 40) return 'walk';
  if (speed >= MODE_PLANE_MIN_KMH && distance >= MODE_PLANE_MIN_DISTANCE_M && duration >= MODE_PLANE_MIN_DURATION_MS) return 'plane';
  if (speed > MODE_VEHICLE_AVG_KMH) return 'vehicle';
  if (speed >= MODE_WALK_MAX_KMH) return 'bike';
  return 'walk';
}

function medianNumber(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Card mode from the stored samples.
 * One fast fix does not flip the trip. A dashed chord still feeds the average
 * when `distanceM` already includes it. Vehicle rules win over the bike band.
 */
export function classifyJourneyMode(points, distanceM, durationMs) {
  const distance = Number.isFinite(distanceM) ? distanceM : 0;
  const duration = Number.isFinite(durationMs) ? durationMs : 0;
  const avg = duration > 0 ? (distance / 1000) / (duration / 3_600_000) : 0;
  if (distance < 40) return 'walk';
  if (avg >= MODE_PLANE_MIN_KMH && distance >= MODE_PLANE_MIN_DISTANCE_M && duration >= MODE_PLANE_MIN_DURATION_MS) return 'plane';
  const speeds = [];
  let runMs = 0;
  let runCount = 0;
  let bestRunMs = 0;
  let bestRunCount = 0;
  let fastMs = 0;
  const list = Array.isArray(points) ? points : [];
  const closeRun = () => {
    if (runCount <= 0) return;
    if (runMs > bestRunMs) bestRunMs = runMs;
    if (runCount > bestRunCount) bestRunCount = runCount;
    runMs = 0;
    runCount = 0;
  };
  for (let index = 1; index < list.length; index += 1) {
    const prev = list[index - 1];
    const point = list[index];
    if (!prev || !point || prev.stayEnd || point.stayEnd) continue;
    if (isImpossibleJump(prev, point)) continue;
    const pace = stepPace(prev, point);
    if (!pace || pace.speed > 45) continue;
    const kmh = pace.speed * 3.6;
    if (kmh < 4) {
      closeRun();
      continue;
    }
    speeds.push(kmh);
    if (kmh > MODE_VEHICLE_AVG_KMH) fastMs += pace.dt;
    if (kmh >= MODE_VEHICLE_SUSTAINED_KMH) {
      runMs += pace.dt;
      runCount += 1;
      if (runMs > bestRunMs) bestRunMs = runMs;
      if (runCount > bestRunCount) bestRunCount = runCount;
    } else {
      closeRun();
    }
  }
  const median = medianNumber(speeds);
  const sustained = bestRunCount >= 3 || bestRunMs >= 60_000;
  const medianVehicle = speeds.length >= 3 && median > MODE_VEHICLE_MEDIAN_KMH;
  const avgVehicle = avg > MODE_VEHICLE_AVG_KMH && fastMs >= 60_000;
  if (sustained || medianVehicle || avgVehicle) return 'vehicle';
  if (median >= 12 && median <= MODE_BIKE_MAX_KMH && speeds.length >= 3) return 'bike';
  // One fast fix can lift the average into the bike band. The median of the
  // other steps still says this was a walk.
  if (speeds.length >= 3 && median < MODE_WALK_MAX_KMH) return 'walk';
  return classifyMode(avg, distance, duration);
}

export function estimateSteps(distanceM) {
  if (!Number.isFinite(distanceM) || distanceM < 1) return 0;
  return Math.round(distanceM / STRIDE_M);
}

export function formatDurationMs(durationMs) {
  const totalMin = Math.max(0, Math.round((Number(durationMs) || 0) / 60_000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (hours <= 0) return `${minutes}분`;
  if (minutes === 0) return `${hours}시간`;
  return `${hours}시간 ${minutes}분`;
}

export function formatDistanceM(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '0m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)}km`;
  return `${Math.round(km)}km`;
}

function pathDistance(path) {
  let distance = 0;
  for (let index = 1; index < path.length; index += 1) distance += haversineMeters(path[index - 1], path[index]);
  return distance;
}

function summarizeSegment(path, departAt, arriveAt, open) {
  const distanceM = pathDistance(path);
  const durationMs = Math.max(0, arriveAt - departAt);
  if (open && distanceM < 30) return null;
  const speedKmh = durationMs > 0 ? (distanceM / 1000) / (durationMs / 3_600_000) : 0;
  const mode = classifyMode(speedKmh, distanceM, durationMs);
  const steps = mode === 'walk' ? estimateSteps(distanceM) : null;
  return {
    departAt,
    arriveAt,
    durationMs,
    distanceM,
    speedKmh,
    mode,
    steps,
    stepsEstimated: mode === 'walk',
    open: !!open,
  };
}

function clusterPoints(points) {
  const clusters = [];
  for (const point of points) {
    const last = clusters[clusters.length - 1];
    if (!last || haversineMeters(last, point) > STOP_RADIUS_M) {
      clusters.push({
        lat: point.lat,
        lng: point.lng,
        startAt: point.at,
        endAt: point.at,
        count: 1,
      });
      continue;
    }
    const count = last.count + 1;
    last.lat = (last.lat * last.count + point.lat) / count;
    last.lng = (last.lng * last.count + point.lng) / count;
    last.endAt = point.at;
    last.count = count;
  }
  return clusters;
}

export function buildDayRecord(points, now) {
  const sorted = (Array.isArray(points) ? points : [])
    .filter((point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.at))
    .slice()
    .sort((left, right) => left.at - right.at);
  const when = Number.isFinite(now) ? now : Date.now();
  const clusters = clusterPoints(sorted);
  const stops = [];
  clusters.forEach((cluster, index) => {
    const closed = index < clusters.length - 1;
    const end = closed ? cluster.endAt : Math.max(cluster.endAt, when);
    if (end - cluster.startAt < STOP_MIN_MS) return;
    stops.push({
      lat: Number(cluster.lat.toFixed(6)),
      lng: Number(cluster.lng.toFixed(6)),
      arrivedAt: cluster.startAt,
      leftAt: closed ? cluster.endAt : null,
    });
  });
  const indoor = recordsIndoorStay(sorted, when);
  if (indoor) {
    const kept = stops.filter((stop) => stop.leftAt != null && stop.leftAt < indoor.startAt);
    kept.push({
      lat: indoor.lat,
      lng: indoor.lng,
      arrivedAt: indoor.startAt,
      leftAt: indoor.ongoing ? null : indoor.endAt,
    });
    stops.length = 0;
    stops.push(...kept);
  }
  const segments = [];
  for (let index = 0; index < stops.length - 1; index += 1) {
    const departAt = stops[index].leftAt ?? stops[index].arrivedAt;
    const arriveAt = stops[index + 1].arrivedAt;
    if (arriveAt <= departAt) continue;
    const path = sorted.filter((point) => point.at >= departAt && point.at <= arriveAt);
    const segment = summarizeSegment(path, departAt, arriveAt, false);
    if (segment) segments.push(segment);
  }
  const lastStop = stops[stops.length - 1];
  if (lastStop?.leftAt != null && when - lastStop.leftAt >= 30_000) {
    const path = sorted.filter((point) => point.at >= lastStop.leftAt);
    const segment = summarizeSegment(path, lastStop.leftAt, when, true);
    if (segment) segments.push(segment);
  }
  return { stops, segments };
}

/**
 * Closed visits stay on the record after the live track is trimmed to the
 * open sit. A new stop that covers the same time replaces the old one.
 * An open visit is only whatever the current track still shows.
 */
export function mergeVisitStops(previous, stops, now) {
  const when = Number.isFinite(now) ? now : Date.now();
  const next = (Array.isArray(stops) ? stops : []).filter((stop) => stop && Number.isFinite(stop.arrivedAt) && isWithinHistory(stop.arrivedAt, when));
  const kept = [];
  for (const visit of Array.isArray(previous) ? previous : []) {
    if (!visit || visit.leftAt == null || !Number.isFinite(visit.arrivedAt)) continue;
    if (!isWithinHistory(visit.arrivedAt, when)) continue;
    const visitEnd = visit.leftAt;
    const overlaps = next.some((stop) => {
      const end = stop.leftAt ?? when;
      return visit.arrivedAt < end && visitEnd > stop.arrivedAt;
    });
    if (!overlaps) kept.push(visit);
  }
  return kept.concat(next);
}

function orderedTrail(points) {
  const list = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.at)) continue;
    list.push(point);
  }
  for (let index = 1; index < list.length; index += 1) {
    if (list[index].at < list[index - 1].at) return list.slice().sort((left, right) => left.at - right.at);
  }
  return list;
}

function stayDwell(startAt, endAt, open, now, limit) {
  const observed = endAt - startAt;
  if (!open) return Math.max(0, observed);
  if (observed >= limit) return observed;
  if (!Number.isFinite(now) || now < endAt) return Math.max(0, observed);
  if (now - endAt > JOURNEY_STAY_FRESH_MS) return Math.max(0, observed);
  if (observed < STOP_MIN_MS) return Math.max(0, observed);
  return Math.max(0, now - startAt);
}

/** A ride into this stay archives later than a walk. */
function journeyStayLimit(points, stayStart) {
  const from = Math.max(1, stayStart - 40);
  for (let index = stayStart; index >= from; index -= 1) {
    const prev = points[index - 1];
    const next = points[index];
    if (!prev || !next || prev.stayEnd || next.stayEnd) continue;
    if (isRideStep(prev, next)) return RIDE_JOURNEY_STAY_MS;
  }
  return WALK_JOURNEY_STAY_MS;
}

/**
 * A stay is a run that remains inside STOP_RADIUS_M of its own anchor.
 * The anchor slides forward so the last block of the walk is not swallowed
 * into the stay. Speed alone never opens or closes the run.
 */
function findClosingStays(points, now) {
  const stays = [];
  let index = 0;
  while (index < points.length) {
    const anchor = points[index];
    let end = index;
    while (end + 1 < points.length && haversineMeters(anchor, points[end + 1]) <= STOP_RADIUS_M) {
      const step = points[end + 1];
      const prev = points[end];
      const reported = pointSpeed(step);
      const accuracy = positiveMeters(step?.accuracyM);
      if (reported != null && reported >= 0.7 && reported <= 2.6 && accuracy > 0 && accuracy <= 25 && prev && haversineMeters(prev, step) >= 0.2) break;
      end += 1;
    }
    const open = end === points.length - 1;
    const limit = journeyStayLimit(points, index);
    if (end > index && stayDwell(anchor.at, points[end].at, open, now, limit) >= limit) {
      let start = index;
      while (start < end) {
        const next = start + 1;
        let near = true;
        for (let cursor = next + 1; cursor <= end; cursor += 1) {
          if (haversineMeters(points[next], points[cursor]) > STOP_RADIUS_M) {
            near = false;
            break;
          }
        }
        if (!near || stayDwell(points[next].at, points[end].at, open, now, limit) < limit) break;
        start = next;
      }
      stays.push({ startAt: points[start].at, endAt: points[end].at });
      index = end + 1;
    } else {
      index += 1;
    }
  }
  return stays;
}

function compactJourneyPoints(points) {
  const sampled = [];
  for (const point of points) {
    if (!point || point.stayEnd) continue;
    const prev = sampled[sampled.length - 1];
    if (prev && haversineMeters(prev, point) < 0.25) continue;
    sampled.push(point);
  }
  let current = sampled.length >= 2 ? sampled : points.filter((point) => point && !point.stayEnd);
  let epsilon = 2;
  while (current.length > JOURNEY_POINT_CAP && epsilon <= 64) {
    current = douglasPeucker(current, epsilon);
    epsilon *= 2;
  }
  if (current.length > JOURNEY_POINT_CAP) {
    const step = Math.ceil(current.length / JOURNEY_POINT_CAP);
    const capped = [];
    for (let index = 0; index < current.length; index += step) capped.push(current[index]);
    const last = current[current.length - 1];
    if (capped[capped.length - 1] !== last) capped.push(last);
    current = capped;
  }
  return current.map((point) => ({
    lat: Number(point.lat.toFixed(6)),
    lng: Number(point.lng.toFixed(6)),
    at: point.at,
  }));
}

function stableJourneyId(startedAt, lat, lng) {
  const minute = Math.floor(Number(startedAt) / 60_000);
  return `${minute}:${Number(lat).toFixed(3)}:${Number(lng).toFixed(3)}`;
}

/** A dashed hole while actually riding stays with the trip. A stay-to-stay hole does not. */
function isSlowGap(prev, point, prior) {
  if (!prev || !point || prev.stayEnd || point.stayEnd) return false;
  if (isImpossibleJump(prev, point)) return true;
  if (!trailDrawDashed(prev, point, prior)) return false;
  if (isRideStep(prev, point)) return false;
  const pace = stepPace(prev, point);
  if (pace && pace.speed >= TRAIL_RIDE_MIN_MPS) return false;
  return true;
}

/**
 * Straight chord of a dashed hole when it is real travel.
 * A teleport and a stay-to-stay wobble add nothing. A car gap does.
 */
function gapTravelMeters(prev, point) {
  if (isImpossibleJump(prev, point)) return 0;
  const pace = stepPace(prev, point);
  if (!pace || pace.moved < 1 || pace.speed > 45) return 0;
  const stayed = (sample) => sample?.staying === true || pointSpeed(sample) === 0;
  if (stayed(prev) && stayed(point) && pace.speed < 1.2) return 0;
  if (pace.speed < 0.7 && !isRideStep(prev, point)) return 0;
  return pace.moved;
}

/** Meters of the trip. Dashed gaps count their chord. An impossible jump does not. */
export function journeyPathDistance(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    if (!prev || !point || prev.stayEnd || point.stayEnd) continue;
    if (isImpossibleJump(prev, point)) continue;
    if (isSlowGap(prev, point) || trailSegmentDashed(prev, point)) {
      distance += gapTravelMeters(prev, point);
      continue;
    }
    if (isRideStep(prev, point)) {
      distance += haversineMeters(prev, point);
      continue;
    }
    const pace = stepPace(prev, point);
    if (!pace || pace.speed > 45 || pace.dt < 800) continue;
    if (pace.speed >= 0.7 && pace.speed <= 3 && pace.moved >= 0.2) distance += pace.moved;
    else if (pace.speed > 3 && pace.moved >= TRAIL_WALK_VERTEX_M) distance += pace.moved;
  }
  return distance;
}

function travelDistance(points) {
  return journeyPathDistance(points);
}

function hasRealTravel(points) {
  return travelDistance(points) >= TRAIL_WALK_VERTEX_M;
}

/**
 * Hours inside one neighborhood. Path length can pass 80m from GPS jitter
 * while the phone never left the block.
 */
function isStationaryCloud(points, durationMs) {
  if (!Array.isArray(points) || points.length < 2 || durationMs < 20 * 60 * 1000) return false;
  const path = points.filter((point) => point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (path.length < 2) return true;
  for (let index = 1; index < path.length; index += 1) {
    if (isRideStep(path[index - 1], path[index])) return false;
  }
  if (clusterSpread(path) > INDOOR_STAY_RADIUS_M) return false;
  const moved = travelDistance(path);
  const pace = durationMs > 0 ? moved / (durationMs / 1000) : 0;
  return pace < 0.08;
}

function locatedPath(points) {
  return (Array.isArray(points) ? points : []).filter((point) => (
    point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.lng)
  ));
}

/** A stay that must not become a journey card, including already-saved ones. */
export function isStayNotJourney(points, durationMs, distanceM) {
  const path = locatedPath(points);
  if (path.length < 2 || !Number.isFinite(durationMs) || durationMs <= 0) return false;
  const indoor = recordsIndoorStay(path, path[path.length - 1].at);
  if (indoor && indoor.startAt <= path[0].at + 15_000) return true;
  for (let index = 1; index < path.length; index += 1) {
    if (isRideStep(path[index - 1], path[index])) return false;
  }
  const moved = Number.isFinite(distanceM) && distanceM > 0 ? distanceM : travelDistance(path);
  if (loopDistanceBeatsSpread(moved, path)) return false;
  const hours = durationMs / 3_600_000;
  const kmh = hours > 0 ? (moved / 1000) / hours : 0;
  const spread = clusterSpread(path);
  if (durationMs > STAY_SLOW_MS && spread < STAY_BOUND_RADIUS_M) return true;
  if (durationMs > STAY_SLOW_MS && kmh < STAY_SLOW_KMH) return true;
  return isStationaryCloud(path, durationMs);
}

function journeyPathRecordable(path, durationMs) {
  if (!Array.isArray(path) || path.length < 2) return false;
  if (durationMs < JOURNEY_MIN_DURATION_MS) return false;
  if (travelDistance(path) < JOURNEY_MIN_DISTANCE_M) return false;
  if (isStayNotJourney(path, durationMs, travelDistance(path))) return false;
  return true;
}

/**
 * A step that leaves a stay. Still-phone jitter, even a long chord inside the
 * block, is not movement. A walk pace or a ride is.
 */
/**
 * One good-accuracy step of a walk. A stay flag and a missing speed do not
 * make it jitter. A reported speed near zero, or a leap, still does.
 */
function accurateWalkStep(prev, point) {
  if (!prev || !point || prev.stayEnd || point.stayEnd) return false;
  const accuracy = positiveMeters(point.accuracyM);
  if (!(accuracy > 0) || accuracy > 25) return false;
  const reported = pointSpeed(point);
  if (reported != null && reported < 0.4) return false;
  const pace = stepPace(prev, point);
  if (!pace || pace.moved < TRAIL_WALK_VERTEX_M || pace.dt < 800 || pace.dt > 90_000) return false;
  return pace.speed >= 0.7 && pace.speed <= 2.6;
}

/** The vertex this walk left. Steps that are not a walk stay put. */
function sitBehind(points) {
  const drawn = drawnPoints(points);
  for (let index = drawn.length - 1; index >= 1; index -= 1) {
    if (!accurateWalkStep(drawn[index - 1], drawn[index])) return drawn[index];
  }
  return drawn[0] || null;
}

/**
 * Good fixes walking one way for about 40m. A cloud that folds back, or a
 * single leap, is not this. Radius does not decide it.
 */
export function hasDirectedWalk(points) {
  const located = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.at)) located.push(point);
  }
  let run = [];
  let anchor = located[0] || null;
  const directed = () => {
    if (run.length < 3) return false;
    const path = pathDistance(run);
    const net = haversineMeters(run[0], run[run.length - 1]);
    return path >= 40 && net >= 30 && path > 0 && net / path >= 0.5;
  };
  for (let index = 1; index < located.length; index += 1) {
    const point = located[index];
    if (!anchor) {
      anchor = point;
      continue;
    }
    const dt = point.at - anchor.at;
    // A second sample in the same second is not a new step and not a break.
    if (dt >= 0 && dt < 800) continue;
    const accuracy = positiveMeters(point.accuracyM);
    const reported = pointSpeed(point);
    const pace = stepPace(anchor, point);
    const ground = pace && pace.moved >= 0.2 && pace.dt <= 90_000 && pace.speed >= 0.5 && pace.speed <= 3;
    const reportedWalk = reported != null && reported >= 0.7 && reported <= 2.6 && pace && pace.moved >= 0.2 && pace.dt <= 90_000;
    const walking = accuracy > 0 && accuracy <= 25 && (ground || reportedWalk);
    if (!walking) {
      if (directed()) return true;
      run = [];
      anchor = point;
      continue;
    }
    if (run.length === 0) run.push(anchor);
    run.push(point);
    anchor = point;
    if (directed()) return true;
  }
  return directed();
}

function isMovingStep(prev, point) {
  if (!prev || !point || prev.stayEnd || point.stayEnd) return false;
  if (isImpossibleJump(prev, point)) return false;
  if (isRideStep(prev, point)) return true;
  if (accurateWalkStep(prev, point)) return true;
  const pace = stepPace(prev, point);
  if (!pace || pace.dt < 800 || pace.moved < TRAIL_WALK_VERTEX_M || pace.speed < 0.7 || pace.speed > 12) return false;
  if (point.staying === true && !speedShowsMoving(point)) return false;
  if (pointSpeed(point) != null && pointSpeed(point) < TRAIL_STAY_SPEED_MPS) return false;
  if (pace.dt > TRAIL_GAP_MS && !speedShowsMoving(point)) return false;
  return true;
}

/** Centroid of the opening stay. Points already outside the stay radius stay out of it. */
function openingStayCenter(samples) {
  let lat = 0;
  let lng = 0;
  let count = 0;
  for (const point of samples) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    if (count > 0 && haversineMeters({ lat: lat / count, lng: lng / count }, point) > STOP_RADIUS_M) continue;
    lat += point.lat;
    lng += point.lng;
    count += 1;
  }
  if (count === 0) return null;
  return { lat: lat / count, lng: lng / count };
}

/**
 * First sample that leaves the stay cluster and keeps going.
 * A stay-flagged fix with no speed is still a departure once it is outside
 * STOP_RADIUS_M and the next fixes do not fall back in.
 */
function geometricDeparture(points) {
  const center = openingStayCenter(points);
  if (!center) return 0;
  for (let index = 1; index < points.length; index += 1) {
    const distance = haversineMeters(center, points[index]);
    if (!(distance > STOP_RADIUS_M)) continue;
    const end = Math.min(points.length - 1, index + 3);
    if (end === index) continue;
    let previous = distance;
    let held = true;
    for (let cursor = index + 1; cursor <= end; cursor += 1) {
      const next = haversineMeters(center, points[cursor]);
      if (next <= STOP_RADIUS_M || next + 6 < previous) {
        held = false;
        break;
      }
      previous = next;
    }
    if (held) return index;
  }
  return 0;
}

/**
 * The trip is the movement between stays.
 * Start at the departure sample — the last point still in the preceding stay,
 * or the first fix that walks out of the stay radius — and end at the first
 * sample of the next stay. Hours of 머무름 on either side are not part of the card.
 */
function clipStayEnds(points) {
  if (!Array.isArray(points) || points.length < 2) return points;
  let from = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (isMovingStep(points[index - 1], points[index])) break;
    from = index;
  }
  const leadMs = points[from].at - points[0].at;
  if (leadMs < STOP_MIN_MS || from >= points.length - 1) {
    const departed = geometricDeparture(points);
    const departedMs = departed > 0 ? points[departed].at - points[0].at : 0;
    from = departed > 0 && departed < points.length - 1 && departedMs >= STOP_MIN_MS ? departed : 0;
  }

  let tail = points.length - 1;
  for (let index = points.length - 2; index >= from; index -= 1) {
    if (isMovingStep(points[index], points[index + 1])) break;
    tail = index;
  }
  const tailMs = points[points.length - 1].at - points[tail].at;
  if (tailMs < STOP_MIN_MS || tail <= from) tail = points.length - 1;
  if (from === 0 && tail === points.length - 1) return points;
  return points.slice(from, tail + 1);
}

function withoutSpikes(points) {
  const kept = [];
  let changed = false;
  for (const point of points) {
    if (!point || point.stayEnd) {
      if (point) kept.push(point);
      else changed = true;
      continue;
    }
    let prev = null;
    for (let index = kept.length - 1; index >= 0; index -= 1) {
      if (kept[index] && !kept[index].stayEnd) {
        prev = kept[index];
        break;
      }
    }
    if (prev && isImpossibleJump(prev, point)) {
      changed = true;
      continue;
    }
    kept.push(point);
  }
  if (!changed && kept.length === points.length) return points;
  return kept;
}

/** The open line is the current move. A slow hole behind the pin is not part of it. */
function openLine(points) {
  const cleaned = withoutSpikes(points);
  let end = cleaned.length;
  while (end >= 2) {
    const last = cleaned[end - 1];
    if (!last || last.stayEnd) break;
    let prev = null;
    let prevIndex = -1;
    for (let index = end - 2; index >= 0; index -= 1) {
      if (cleaned[index] && !cleaned[index].stayEnd) {
        prev = cleaned[index];
        prevIndex = index;
        break;
      }
    }
    let prior = null;
    for (let index = prevIndex - 1; index >= 0; index -= 1) {
      if (cleaned[index] && !cleaned[index].stayEnd) {
        prior = cleaned[index];
        break;
      }
    }
    if (!prev || !isSlowGap(prev, last, prior)) break;
    end -= 1;
  }
  const trimmed = end === cleaned.length ? cleaned : cleaned.slice(0, end);
  if (hasRealTravel(trimmed)) return trimmed === points ? points : trimmed;
  const anchor = drawnAnchor(trimmed);
  if (!anchor) return trimmed.length === points.length ? points : trimmed;
  if (trimmed.length === 1 && trimmed[0] === anchor) return trimmed === points ? points : trimmed;
  return [anchor];
}

function buildClosedJourney(points, departAt, arriveAt) {
  const path = [];
  for (const point of points) {
    if (!point || point.stayEnd) continue;
    if (point.at < departAt || point.at > arriveAt) continue;
    const prev = path[path.length - 1];
    if (prev && isImpossibleJump(prev, point)) continue;
    path.push(point);
  }
  const trip = clipStayEnds(path);
  if (trip.length < 2) return null;
  const startedAt = trip[0].at;
  const endedAt = trip[trip.length - 1].at;
  const durationMs = endedAt - startedAt;
  const distanceM = travelDistance(trip);
  if (!journeyPathRecordable(trip, durationMs)) return null;
  const start = trip[0];
  const end = trip[trip.length - 1];
  return {
    id: stableJourneyId(startedAt, start.lat, start.lng),
    startedAt,
    endedAt,
    distanceM: Math.round(distanceM),
    cloud: false,
    points: compactJourneyPoints(trip),
    start: { lat: Number(start.lat.toFixed(6)), lng: Number(start.lng.toFixed(6)), label: null },
    end: { lat: Number(end.lat.toFixed(6)), lng: Number(end.lng.toFixed(6)), label: null },
  };
}

/**
 * A last fix this old is a finished stay even when no new sample arrived
 * to grow the 50m cluster. Walk and ride keep their own archive waits.
 */
/**
 * Hours inside one building. A 50m cluster never forms when indoor GPS hops
 * between nearby walls, and one hop fast enough to look like a ride must not
 * keep the whole stay as a journey.
 */
export function recordsIndoorStay(points, now) {
  const samples = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.at)) continue;
    samples.push(point);
  }
  if (samples.length < 2) return null;
  let start = samples.length - 1;
  while (start > 0) {
    const prev = samples[start - 1];
    const next = samples[start];
    if (!prev.stayEnd && !next.stayEnd && isVehicleStep(prev, next)) break;
    const trial = samples.slice(start - 1);
    const located = trial.filter((point) => !point.stayEnd);
    const body = located.length >= 2 ? located : trial;
    if (hasDirectedWalk(body)) break;
    if (clusterSpread(body) > INDOOR_STAY_RADIUS_M) break;
    const shape = travelShape(body);
    const span = body[body.length - 1].at - body[0].at;
    const slow = span >= RECORDS_STAY_MS && shape.net < 80 && shape.path / (span / 1000) < 0.5;
    if (!slow && shape.path >= 80 && shape.net >= 80 && shape.ratio >= 0.62) break;
    start -= 1;
  }
  const cloud = samples.slice(start);
  if (cloud.length < 2) return null;
  while (cloud.length > 2) {
    const first = cloud[0];
    if (first.stayEnd || !isMovingStep(first, cloud[1])) break;
    cloud.shift();
  }
  const begin = cloud[0].at;
  const endAt = cloud[cloud.length - 1].at;
  if (endAt - begin < RECORDS_STAY_MS) return null;
  let lat = 0;
  let lng = 0;
  let count = 0;
  for (const point of cloud) {
    if (point.stayEnd) continue;
    lat += point.lat;
    lng += point.lng;
    count += 1;
  }
  if (count === 0) {
    lat = cloud[0].lat;
    lng = cloud[0].lng;
    count = 1;
  }
  const ongoing = Number.isFinite(now) && now - endAt <= 2 * 60 * 1000;
  return {
    startAt: begin,
    endAt: ongoing ? now : endAt,
    lat: Number((lat / count).toFixed(6)),
    lng: Number((lng / count).toFixed(6)),
    ongoing,
  };
}

function mergeIndoorStay(points, now, stays) {
  const indoor = recordsIndoorStay(points, now);
  if (!indoor) return stays;
  const kept = [];
  for (const stay of stays) {
    if (stay.endAt <= indoor.startAt) kept.push(stay);
  }
  kept.push({ startAt: indoor.startAt, endAt: indoor.endAt });
  return kept;
}

function closingStays(points, now) {
  let stays = findClosingStays(points, now);
  const last = points[points.length - 1];
  if (!last || last.stayEnd || !Number.isFinite(now) || now < last.at) return mergeIndoorStay(points, now, stays);
  const limit = journeyStayLimit(points, points.length - 1);
  if (now - last.at < limit) return mergeIndoorStay(points, now, stays);
  if (!stays.some((stay) => last.at >= stay.startAt && last.at <= stay.endAt)) {
    stays = stays.concat([{ startAt: last.at, endAt: last.at }]);
  }
  return mergeIndoorStay(points, now, stays);
}

/**
 * Split a trail at a stay long enough for that segment.
 * A walk closes after WALK_JOURNEY_STAY_MS. A ride at or above ~7 km/h closes
 * after RIDE_JOURNEY_STAY_MS. Silence that long closes the same way.
 * Journeys are real trips between those stays. The card starts when the stay
 * ends and stops when the next stay begins. A hole between two stay points,
 * a near-stationary cloud, or a trip under JOURNEY_MIN_DISTANCE_M is not a card.
 * Remaining is the open move, or one anchor once that move is over.
 */
export function splitClosedJourneys(points, now) {
  const source = Array.isArray(points) ? points : [];
  const sorted = orderedTrail(source);
  if (sorted.length < 2) return { journeys: [], remaining: source };
  const closing = closingStays(sorted, now);
  if (closing.length === 0) {
    const line = openLine(sorted);
    return { journeys: [], remaining: line === sorted ? source : line };
  }
  const journeys = [];
  let departAt = sorted[0].at;
  for (const cluster of closing) {
    if (cluster.startAt > departAt) {
      const journey = buildClosedJourney(sorted, departAt, cluster.startAt);
      if (journey) journeys.push(journey);
    }
    departAt = cluster.endAt;
  }
  const remainFrom = closing[closing.length - 1].startAt;
  let cut = 0;
  while (cut < sorted.length && sorted[cut].at < remainFrom) cut += 1;
  const tail = cut <= 0 ? sorted : sorted.slice(cut);
  const line = openLine(tail);
  if (journeys.length === 0 && line === source) return { journeys: [], remaining: source };
  return { journeys: collapseDuplicateJourneys(journeys), remaining: line };
}

/**
 * Samples to keep in storage.
 * `remaining` is a display line: it can drop a slow hole and collapse to one anchor.
 * That must not replace the raw track until a journey is actually cut.
 * While the move is still open, every dense sample stays so the next walk can accumulate.
 */
export function storedTrackAfterArchive(points, now) {
  const source = Array.isArray(points) ? points : [];
  const split = splitClosedJourneys(source, now);
  return {
    journeys: split.journeys,
    points: split.journeys.length === 0 ? source : split.remaining,
  };
}

/** In-progress line for the journey card. A slow hole behind the pin is not part of it. */
export function liveTrailPoints(points, now) {
  return splitClosedJourneys(points, now).remaining;
}

/**
 * Points the map paints for the open move.
 * Finished stays are cut off, as in 1.12. A slow hole stays, so the painter
 * can dash a walked gap or keep a vehicle chord. The journey card still uses
 * liveTrailPoints, which may trim that hole.
 */
export function displayLivePoints(points, now) {
  const source = Array.isArray(points) ? points : [];
  const sorted = orderedTrail(source);
  if (sorted.length < 2) return source;
  const closing = closingStays(sorted, now);
  if (closing.length === 0) {
    if (indoorCloud(sorted, now)) return [];
    return sorted.length === source.length ? source : sorted;
  }
  const remainFrom = closing[closing.length - 1].startAt;
  let cut = 0;
  while (cut < sorted.length && sorted[cut].at < remainFrom) cut += 1;
  const tail = cut <= 0 ? (sorted.length === source.length ? source : sorted) : sorted.slice(cut);
  const stayed = tail.filter((point) => point && !point.stayEnd);
  const anchor = stayed[0];
  const insideStop = !anchor || stayed.every((point) => haversineMeters(anchor, point) <= STOP_RADIUS_M);
  // A directed walk can still be inside the 50m stop bubble. That line is the trip.
  const stillThere = insideStop && !hasDirectedWalk(stayed);
  if (stillThere || !hasRealTravel(stayed) || indoorCloud(sorted, now)) return [];
  return tail;
}

/**
 * A cloud that stays inside one building for the walk-stay wait.
 * Spikes between nearby 동 do not have to sit inside the 50m stop radius.
 * A straight walk keeps a high net, so it is not this cloud.
 */
function indoorCloud(points, now) {
  const drawn = (Array.isArray(points) ? points : []).filter((point) => point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.at));
  if (drawn.length < 2) return false;
  let start = drawn.length - 1;
  while (start > 0) {
    const prev = drawn[start - 1];
    const next = drawn[start];
    if (isVehicleStep(prev, next) || isRideStep(prev, next)) break;
    const trial = drawn.slice(start - 1);
    if (hasDirectedWalk(trial)) break;
    if (clusterSpread(trial) > INDOOR_STAY_RADIUS_M) break;
    const shape = travelShape(trial);
    if (shape.path >= 80 && shape.net >= 80 && shape.ratio >= 0.62) break;
    start -= 1;
  }
  const cloud = drawn.slice(start);
  if (cloud.length < 2) return false;
  const begin = cloud[0].at;
  const endAt = cloud[cloud.length - 1].at;
  const end = Number.isFinite(now) && now >= endAt ? now : endAt;
  return end - begin >= WALK_JOURNEY_STAY_MS;
}

/** The open segment still has a line. A stay cluster and courtyard jitter do not. */
export function liveTrailDrawable(points, now = Date.now()) {
  return visibleTrail(liveTrailPoints(points, now)).length >= 2;
}

/** Today's move that has not closed yet. A hole or a stay cloud stays off the 기록 list. */
export function previewOpenJourney(points, now) {
  const indoor = recordsIndoorStay(points, now);
  const path = liveTrailPoints(points, now).filter((point) => point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.at));
  if (indoor && path.length && path[0].at >= indoor.startAt - 15_000) return null;
  const moving = clipStayEnds(path);
  if (moving.length < 2) return null;
  const depart = moving[0];
  const end = moving[moving.length - 1];
  const durationMs = Math.max(0, end.at - depart.at);
  const distanceM = travelDistance(moving);
  if (!journeyPathRecordable(moving, durationMs)) return null;
  return {
    id: `open:${depart.at}`,
    startedAt: depart.at,
    endedAt: end.at,
    distanceM: Math.round(distanceM),
    cloud: false,
    points: compactJourneyPoints(moving),
    start: { lat: Number(depart.lat.toFixed(6)), lng: Number(depart.lng.toFixed(6)), label: null },
    end: { lat: Number(end.lat.toFixed(6)), lng: Number(end.lng.toFixed(6)), label: null },
    open: true,
  };
}

function sampleAlong(runPoints, target) {
  const last = runPoints[runPoints.length - 1];
  if (!last) return null;
  if (runPoints.length === 1 || target <= runPoints[0].at) {
    const point = runPoints[0];
    const speed = pointSpeed(point);
    return { lat: point.lat, lng: point.lng, at: point.at, speedMps: speed == null ? 0 : speed };
  }
  if (target >= last.at) {
    const speed = pointSpeed(last);
    return { lat: last.lat, lng: last.lng, at: last.at, speedMps: speed == null ? 0 : speed };
  }
  let prev = runPoints[0];
  for (let index = 1; index < runPoints.length; index += 1) {
    const next = runPoints[index];
    if (target > next.at && index < runPoints.length - 1) {
      prev = next;
      continue;
    }
    const span = next.at - prev.at;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (target - prev.at) / span)) : 1;
    const pace = stepPace(prev, next);
    const reported = pointSpeed(next);
    const speed = pace ? pace.speed : reported;
    return {
      lat: prev.lat + (next.lat - prev.lat) * fraction,
      lng: prev.lng + (next.lng - prev.lng) * fraction,
      at: span > 0 ? prev.at + span * fraction : next.at,
      speedMps: speed == null || !Number.isFinite(speed) ? 0 : speed,
    };
  }
  return { lat: last.lat, lng: last.lng, at: last.at, speedMps: 0 };
}

/**
 * Position along the solid runs at `ratio` of their duration.
 * Time picks the segment. Within that segment the marker moves by distance
 * along the samples, so a curve is followed instead of a chord across it.
 * A dashed hole is not a frame: the marker stays on the near side.
 */
export function playbackAnchor(points, ratio) {
  const list = [];
  for (const point of Array.isArray(points) ? points : []) {
    if (!point || point.stayEnd || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.at)) continue;
    const prev = list[list.length - 1];
    if (prev && isImpossibleJump(prev, point)) continue;
    list.push(point);
  }
  if (list.length === 0) return null;
  const clamped = Math.min(1, Math.max(0, Number(ratio) || 0));
  const runs = [];
  let run = [list[0]];
  for (let index = 1; index < list.length; index += 1) {
    const prev = run[run.length - 1];
    const point = list[index];
    if (isImpossibleJump(prev, point)) {
      if (run.length >= 2) runs.push(run);
      run = [point];
    } else {
      run.push(point);
    }
  }
  if (run.length >= 2) runs.push(run);
  const still = (point) => ({ lat: point.lat, lng: point.lng, at: point.at, speedMps: 0 });
  if (runs.length === 0) return still(list[list.length - 1]);
  let total = 0;
  const durations = runs.map((item) => {
    const duration = Math.max(0, item[item.length - 1].at - item[0].at);
    total += duration;
    return duration;
  });
  if (total <= 0) return still(runs[0][0]);
  let cursor = total * clamped;
  for (let index = 0; index < runs.length; index += 1) {
    const duration = durations[index];
    const lastRun = index === runs.length - 1;
    if (!lastRun && cursor > duration) {
      cursor -= duration;
      continue;
    }
    const runPoints = runs[index];
    const target = runPoints[0].at + Math.min(cursor, duration);
    return sampleAlong(runPoints, target);
  }
  const end = runs[runs.length - 1][runs[runs.length - 1].length - 1];
  return still(end);
}

function seoulClock(at) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

function seoulMonthDay(at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  if (!month || !day) return '';
  return `${month.padStart(2, '0')}/${day.padStart(2, '0')}`;
}

export function formatJourneyWhen(startedAt, endedAt, now = Date.now()) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return '';
  const startDay = seoulDayKey(startedAt);
  const endDay = seoulDayKey(endedAt);
  const today = Number.isFinite(now) ? seoulDayKey(now) : '';
  if (startDay === endDay && startDay === today) return `${seoulClock(startedAt)}–${seoulClock(endedAt)}`;
  return `${seoulMonthDay(startedAt)} ${seoulClock(startedAt)} → ${seoulMonthDay(endedAt)} ${seoulClock(endedAt)}`;
}

export function formatJourneyDistance(meters) {
  if (!Number.isFinite(meters) || meters < 0) return '0m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function labelJourneyPlace(place, spots) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return place;
  if (place.label) return place;
  let best = null;
  let bestDistance = Infinity;
  for (const spot of Array.isArray(spots) ? spots : []) {
    if (!spot || typeof spot.label !== 'string' || !spot.label.trim()) continue;
    if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) continue;
    const distance = haversineMeters(place, spot);
    const radius = Number.isFinite(spot.radiusM) && spot.radiusM > 0 ? spot.radiusM : 80;
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      best = spot.label.trim().slice(0, 120);
    }
  }
  return best ? { ...place, label: best } : place;
}

function journeyPointsOverlap(left, right) {
  const a = Array.isArray(left?.points) ? left.points : [];
  const b = Array.isArray(right?.points) ? right.points : [];
  if (a.length < 2 || b.length < 2) return false;
  const shorter = a.length <= b.length ? a : b;
  const longer = shorter === a ? b : a;
  const step = Math.max(1, Math.floor(shorter.length / 6));
  let seen = 0;
  let hits = 0;
  for (let index = 0; index < shorter.length; index += step) {
    const point = shorter[index];
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    seen += 1;
    if (longer.some((other) => other && haversineMeters(point, other) <= 120)) hits += 1;
  }
  return seen > 0 && hits >= Math.min(3, seen) && hits * 2 >= seen;
}

function distancesMatch(left, right) {
  const a = Math.max(0, Number(left?.distanceM) || 0);
  const b = Math.max(0, Number(right?.distanceM) || 0);
  const shorter = Math.min(a, b);
  const longer = Math.max(a, b);
  if (longer < 80) return true;
  return shorter + 120 >= longer * 0.5;
}

function sameTrip(left, right) {
  if (!left?.start || !right?.start || !Number.isFinite(left.startedAt) || !Number.isFinite(right.startedAt)) return false;
  if (!Number.isFinite(left.endedAt) || !Number.isFinite(right.endedAt)) return false;
  const startsClose = Math.abs(left.startedAt - right.startedAt) <= 3 * 60_000;
  const endsClose = Math.abs(left.endedAt - right.endedAt) <= 3 * 60_000;
  const startsNear = haversineMeters(left.start, right.start) <= 250;
  const endsNear = !!left.end && !!right.end && haversineMeters(left.end, right.end) <= 250;
  const overlap = Math.min(left.endedAt, right.endedAt) - Math.max(left.startedAt, right.startedAt);
  if (startsClose && startsNear) {
    const shorter = Math.min(
      Math.max(1, left.endedAt - left.startedAt),
      Math.max(1, right.endedAt - right.startedAt),
    );
    if (overlap >= shorter * 0.5) return true;
    if (endsClose && endsNear) return true;
  }
  // A 1.27 card started at the stay. The clipped card starts at departure and ends together.
  // A short courtyard at the destination shares that end, but not the trip length.
  if (!distancesMatch(left, right)) return false;
  if (endsClose && overlap >= 60_000 && endsNear) return true;
  if (overlap >= 60_000 && journeyPointsOverlap(left, right)) return true;
  return false;
}

function preferJourney(left, right) {
  const startGap = Math.abs(left.startedAt - right.startedAt);
  const later = left.startedAt >= right.startedAt ? left : right;
  const earlier = later === left ? right : left;
  const richer = (right.distanceM || 0) > (left.distanceM || 0) ? right : left;
  const laterKeepsDistance = (later.distanceM || 0) + 120 >= (earlier.distanceM || 0) * 0.5;
  const preferred = startGap > 3 * 60_000 && laterKeepsDistance ? later : richer;
  const other = preferred === left ? right : left;
  const lat = preferred.start?.lat ?? other.start?.lat ?? 0;
  const lng = preferred.start?.lng ?? other.start?.lng ?? 0;
  return {
    ...preferred,
    id: stableJourneyId(preferred.startedAt, lat, lng),
    start: { ...preferred.start, label: preferred.start?.label || other.start?.label || null },
    end: { ...preferred.end, label: preferred.end?.label || other.end?.label || null },
  };
}

export function collapseDuplicateJourneys(list) {
  const items = Array.isArray(list) ? list.filter((journey) => journey && typeof journey.id === 'string') : [];
  const kept = [];
  for (const journey of items) {
    const index = kept.findIndex((item) => item.id === journey.id || sameTrip(item, journey));
    if (index < 0) kept.push(journey);
    else kept[index] = preferJourney(kept[index], journey);
  }
  kept.sort((left, right) => left.startedAt - right.startedAt);
  return kept;
}

function journeySame(left, right) {
  return !!left && !!right
    && left.id === right.id
    && left.distanceM === right.distanceM
    && left.startedAt === right.startedAt
    && left.endedAt === right.endedAt
    && left.start?.label === right.start?.label
    && left.end?.label === right.end?.label
    && left.points?.length === right.points?.length;
}

export function mergeJourneyLists(existing, incoming) {
  const base = Array.isArray(existing) ? existing : [];
  const extra = Array.isArray(incoming) ? incoming : [];
  const map = new Map();
  for (const journey of base) if (journey?.id) map.set(journey.id, journey);
  for (const journey of extra) {
    if (!journey?.id) continue;
    const prev = map.get(journey.id);
    if (!prev) {
      map.set(journey.id, journey);
      continue;
    }
    const startLabel = prev.start?.label || journey.start?.label || null;
    const endLabel = prev.end?.label || journey.end?.label || null;
    const richer = (journey.distanceM || 0) >= (prev.distanceM || 0) ? journey : prev;
    map.set(journey.id, {
      ...richer,
      start: { ...richer.start, label: startLabel },
      end: { ...richer.end, label: endLabel },
    });
  }
  const collapsed = collapseDuplicateJourneys([...map.values()]);
  if (base.length === collapsed.length && base.every((item, index) => journeySame(item, collapsed[index]))) return base;
  return collapsed;
}

/**
 * A loop can sit inside the indoor radius and still be a walked trip.
 * Dense distance was stored at archive time. Compacted chords are not that distance.
 */
function loopDistanceBeatsSpread(distanceM, samples) {
  if (!(distanceM >= 300)) return false;
  const located = [];
  for (const point of samples) {
    if (!point || point.stayEnd || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue;
    located.push(point);
  }
  if (located.length < 2) return false;
  const spread = clusterSpread(located);
  return Number.isFinite(spread) && distanceM >= spread * 3;
}

/**
 * Card gate for a journey that was already built.
 * `cloud` is the dense-path verdict from archive time. Compacted chords have
 * no speed and can look like holes, so they are not measured again.
 * A stored loop whose distance clears about 3× its radius is a walk.
 * A stationary cloud without that verdict still drops.
 */
function storedJourneyRecordable(journey) {
  const samples = Array.isArray(journey?.points) ? journey.points : [];
  const durationMs = Number(journey?.endedAt) - Number(journey?.startedAt);
  if (!(durationMs >= JOURNEY_MIN_DURATION_MS)) return false;
  if (journey?.cloud === true) return false;
  if (Number.isFinite(journey?.distanceM) && journey.distanceM < JOURNEY_MIN_DISTANCE_M) return false;
  if (loopDistanceBeatsSpread(journey?.distanceM, samples)) return true;
  if (isStayNotJourney(samples, durationMs, journey?.distanceM)) return false;
  if (Number.isFinite(journey?.distanceM)) return true;
  return journeyPathRecordable(samples, durationMs);
}

export function trimJourneyList(list, now) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const collapsed = collapseDuplicateJourneys(list);
  const today = seoulDayKey(now);
  const oldest = oldestHistoryDay(now);
  const byDay = new Map();
  let dropped = collapsed.length !== list.length
    || collapsed.some((journey, index) => journey.id !== list[index]?.id || journey.distanceM !== list[index]?.distanceM);
  for (const journey of collapsed) {
    if (!journey || typeof journey.id !== 'string' || !Number.isFinite(journey.endedAt)) {
      dropped = true;
      continue;
    }
    if (!storedJourneyRecordable(journey)) {
      dropped = true;
      continue;
    }
    const day = seoulDayKey(journey.endedAt);
    if (!day || day < oldest || day > today) {
      dropped = true;
      continue;
    }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(journey);
    else byDay.set(day, [journey]);
  }
  const kept = [];
  for (const day of [...byDay.keys()].sort()) {
    const bucket = byDay.get(day).slice().sort((left, right) => left.startedAt - right.startedAt);
    const slice = bucket.length > JOURNEY_DAY_CAP ? bucket.slice(-JOURNEY_DAY_CAP) : bucket;
    if (slice.length !== bucket.length) dropped = true;
    kept.push(...slice);
  }
  if (!dropped && sameList(list, kept)) return list;
  return kept;
}

export function journeysWithinHistory(journeys, now) {
  if (!journeys || typeof journeys !== 'object') return {};
  let changed = false;
  const next = {};
  const ids = Object.keys(journeys);
  for (const id of ids) {
    const list = journeys[id];
    if (!Array.isArray(list)) {
      changed = true;
      continue;
    }
    const trimmed = trimJourneyList(list, now);
    if (trimmed.length === 0) {
      if (list.length > 0) changed = true;
      continue;
    }
    next[id] = trimmed;
    if (trimmed !== list) changed = true;
  }
  if (!changed && Object.keys(next).length === ids.length) return journeys;
  return next;
}
