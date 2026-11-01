// v1.12.0 trail pipeline, kept for the walk comparison test only.
// Production drawing lives in tracking.mjs.
//
// Stop-to-stop day record for Umap.
//
// Stops: linger inside STOP_RADIUS_M for STOP_MIN_MS (Samsung Health style).
// A segment is the travel between two consecutive stops. Travel time is
// arrival at the next stop minus departure from the previous stop.
//
// Mode uses the segment's average speed (distance / travel time):
//   도보     < 7 km/h
//   자전거   7–23 km/h
//   차량     23–200 km/h, and any faster burst that is too short to be a flight
//   비행기   >= 200 km/h AND >= 20 km AND >= 3 min
// Under 40 m is always 도보 so GPS creep inside a building is not a vehicle.
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
export const MODE_BIKE_MAX_KMH = 23;
export const MODE_PLANE_MIN_KMH = 200;
export const MODE_PLANE_MIN_DISTANCE_M = 20_000;
export const MODE_PLANE_MIN_DURATION_MS = 3 * 60 * 1000;

export const FIX_STALE_MS = 30_000;
export const FIX_PRECISE_ACCURACY_M = 80;
export const FIX_APPROXIMATE_ACCURACY_M = 400;
export const FIX_MAX_JUMP_MPS = 350;
export const FIX_JUMP_WINDOW_MS = 180_000;
/** A later fix worse than this does not move the pin or the line. */
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
 * Close the in-progress trip after the phone has lingered this long.
 * 7 minutes sits in the 5–10 minute band. The linger is the same 50m stay
 * cluster as a stop, and it must already have been observed for STOP_MIN_MS
 * before the wall clock can finish the wait. A speed reading alone does not close it.
 */
export const JOURNEY_STAY_MS = 7 * 60 * 1000;
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
 * keep: the coordinate extends the walked line, or a relocation past courtyard multipath.
 * snap: inside the step gate, or a still-phone spike. Not a live-pin hold by itself.
 * drop: the sample is too poor to use.
 * A walk keeps intermediate corners. A stay does not grow a courtyard triangle.
 */
export function trailDecision(last, point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) || !Number.isFinite(point.at)) return 'drop';
  if (!last) return 'keep';
  const accuracy = positiveMeters(point.accuracyM);
  if (accuracy > TRAIL_POOR_ACCURACY_M) return 'drop';
  const moved = haversineMeters(last, point);
  const dt = point.at - last.at;
  if (!Number.isFinite(moved) || !Number.isFinite(dt) || dt < 0) return 'drop';
  if (moved === 0 && dt === 0) return 'drop';
  const implied = dt > 0 ? moved / (dt / 1000) : Infinity;
  if (implied > FIX_MAX_JUMP_MPS) return 'drop';
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

/**
 * Live pin and the coordinate published to the family.
 * Holds only inside the stay bubble. Bus, subway, and a sparse GPS jump past that
 * bubble move the pin even when the trail sampler still drops the vertex.
 * A dropped sample (poor accuracy, impossible jump) does not move the pin.
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
  if (decision === 'drop') return { ...point, lat: anchor.lat, lng: anchor.lng };
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
  if (spikeDeviation(prev, tip, point) > 0) return true;
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
    const decision = trailDecision(anchor, point);
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

function sampledTrail(points) {
  const collapsed = collapseStayTrail(points);
  const drawn = [];
  for (const point of collapsed) {
    if (!point || point.stayEnd) continue;
    const prev = drawn[drawn.length - 1];
    if (prev && haversineMeters(prev, point) < 1.5) continue;
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
 * True when the straight segment between two kept samples is a hole, not a walked step.
 * Continuous vertices are a few meters apart and are not dashed.
 * A long chord with time enough to have sampled the middle is dashed as-is.
 */
export function trailSegmentDashed(start, end) {
  if (!start || !end) return false;
  const moved = haversineMeters(start, end);
  if (!Number.isFinite(moved) || moved < TRAIL_GAP_M) return false;
  const dt = Number(end.at) - Number(start.at);
  return !Number.isFinite(dt) || dt >= TRAIL_GAP_MS;
}

/**
 * Solid runs are sampled walks, simplified only under TRAIL_SIMPLIFY_M.
 * A dashed part is the raw chord across a sample hole. No road geometry is added.
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
    if (trailSegmentDashed(prev, next)) {
      flushRun();
      parts.push({ points: [prev, next], dashed: true });
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
 * Stay markers, accuracy-bubble wiggles, and thin there-and-back spikes are not drawn.
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
  const decision = trailDecision(anchor, point);
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
  const decision = trailDecision(anchor, point);
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
  if (previous && accuracy > TRAIL_POOR_ACCURACY_M) return { ok: false, reason: 'accuracy' };
  if (previous && Number.isFinite(previous.at)) {
    const dtMs = at - previous.at;
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
  if (speed >= MODE_BIKE_MAX_KMH) return 'vehicle';
  if (speed >= MODE_WALK_MAX_KMH) return 'bike';
  return 'walk';
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

function stayDwell(startAt, endAt, open, now) {
  const observed = endAt - startAt;
  if (!open) return Math.max(0, observed);
  if (observed >= JOURNEY_STAY_MS) return observed;
  if (!Number.isFinite(now) || now < endAt) return Math.max(0, observed);
  if (now - endAt > JOURNEY_STAY_FRESH_MS) return Math.max(0, observed);
  if (observed < STOP_MIN_MS) return Math.max(0, observed);
  return Math.max(0, now - startAt);
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
    while (end + 1 < points.length && haversineMeters(anchor, points[end + 1]) <= STOP_RADIUS_M) end += 1;
    const open = end === points.length - 1;
    if (end > index && stayDwell(anchor.at, points[end].at, open, now) >= JOURNEY_STAY_MS) {
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
        if (!near || stayDwell(points[next].at, points[end].at, open, now) < JOURNEY_STAY_MS) break;
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
    if (prev && haversineMeters(prev, point) < 1.5) continue;
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

function buildClosedJourney(points, departAt, arriveAt) {
  const path = [];
  for (const point of points) {
    if (!point || point.stayEnd) continue;
    if (point.at < departAt || point.at > arriveAt) continue;
    path.push(point);
  }
  if (path.length < 2) return null;
  const distanceM = pathDistance(path);
  const durationMs = arriveAt - departAt;
  if (distanceM < JOURNEY_MIN_DISTANCE_M || durationMs < JOURNEY_MIN_DURATION_MS) return null;
  const start = path[0];
  const end = path[path.length - 1];
  return {
    id: `${start.at}:${arriveAt}:${start.lat.toFixed(4)}:${start.lng.toFixed(4)}`,
    startedAt: start.at,
    endedAt: arriveAt,
    distanceM: Math.round(distanceM),
    points: compactJourneyPoints(path),
    start: { lat: Number(start.lat.toFixed(6)), lng: Number(start.lng.toFixed(6)), label: null },
    end: { lat: Number(end.lat.toFixed(6)), lng: Number(end.lng.toFixed(6)), label: null },
  };
}

/**
 * Split a trail at stays that have lasted JOURNEY_STAY_MS.
 * Journeys are the walks between those stays. Remaining is the open stay
 * and anything after it, which is the live map line.
 * A stay under 7 minutes, or a walk under JOURNEY_MIN_DISTANCE_M, does not
 * become a card. The short walk still leaves the live line once a real stay closes.
 */
export function splitClosedJourneys(points, now) {
  const source = Array.isArray(points) ? points : [];
  const sorted = orderedTrail(source);
  if (sorted.length < 2) return { journeys: [], remaining: source };
  const closing = findClosingStays(sorted, now);
  if (closing.length === 0) return { journeys: [], remaining: source };
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
  if (journeys.length === 0 && cut <= 0) return { journeys: [], remaining: source };
  return { journeys, remaining: cut <= 0 ? sorted : sorted.slice(cut) };
}

/** In-progress line for the family map. Finished stays are not on this overlay. */
export function liveTrailPoints(points, now) {
  return splitClosedJourneys(points, now).remaining;
}

/** Today's walk that has not closed yet. Too-short noise stays off the 기록 list. */
export function previewOpenJourney(points, now) {
  const path = liveTrailPoints(points, now).filter((point) => point && !point.stayEnd && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.at));
  if (path.length < 2) return null;
  const origin = path[0];
  let depart = origin;
  for (const point of path) {
    if (haversineMeters(origin, point) <= STOP_RADIUS_M) depart = point;
    else break;
  }
  const moving = path.filter((point) => point.at >= depart.at);
  if (moving.length < 2) return null;
  const distanceM = pathDistance(moving);
  const endedAt = moving[moving.length - 1].at;
  const durationMs = Math.max(0, endedAt - depart.at);
  if (distanceM < JOURNEY_MIN_DISTANCE_M || durationMs < JOURNEY_MIN_DURATION_MS) return null;
  const end = moving[moving.length - 1];
  return {
    id: `open:${depart.at}`,
    startedAt: depart.at,
    endedAt,
    distanceM: Math.round(distanceM),
    points: compactJourneyPoints(moving),
    start: { lat: Number(depart.lat.toFixed(6)), lng: Number(depart.lng.toFixed(6)), label: null },
    end: { lat: Number(end.lat.toFixed(6)), lng: Number(end.lng.toFixed(6)), label: null },
    open: true,
  };
}

export function formatJourneyWhen(startedAt, endedAt) {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return '';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return `${fmt.format(startedAt)}–${fmt.format(endedAt)}`;
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
  if (extra.length === 0) return base;
  const map = new Map();
  for (const journey of base) if (journey?.id) map.set(journey.id, journey);
  let changed = false;
  for (const journey of extra) {
    if (!journey?.id) continue;
    const prev = map.get(journey.id);
    if (!prev) {
      map.set(journey.id, journey);
      changed = true;
      continue;
    }
    const startLabel = prev.start?.label || journey.start?.label || null;
    const endLabel = prev.end?.label || journey.end?.label || null;
    const richer = (journey.distanceM || 0) > (prev.distanceM || 0) + 20;
    const next = richer
      ? { ...journey, start: { ...journey.start, label: startLabel }, end: { ...journey.end, label: endLabel } }
      : { ...prev, start: { ...prev.start, label: startLabel }, end: { ...prev.end, label: endLabel } };
    if (!journeySame(prev, next)) {
      map.set(journey.id, next);
      changed = true;
    }
  }
  if (!changed) return base;
  return [...map.values()].sort((left, right) => left.startedAt - right.startedAt);
}

export function trimJourneyList(list, now) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const today = seoulDayKey(now);
  const oldest = oldestHistoryDay(now);
  const byDay = new Map();
  let dropped = false;
  for (const journey of list) {
    if (!journey || typeof journey.id !== 'string' || !Number.isFinite(journey.endedAt)) {
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
