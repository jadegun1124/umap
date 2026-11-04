import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  acceptFix,
  HISTORY_DAYS,
  buildDayRecord,
  classifyMode,
  classifyJourneyMode,
  journeyPathDistance,
  estimateSteps,
  formatDurationMs,
  formatJourneyDistance,
  formatJourneyWhen,
  isStayNotJourney,
  STAY_BOUND_RADIUS_M,
  historyDayKeys,
  isWithinHistory,
  needsDailyWipe,
  oldestHistoryDay,
  seoulDayEndMs,
  seoulDayKey,
  shouldKeepTrailPoint,
  displayCoordinate,
  liveCoordinate,
  settleTrailPoint,
  tracksWithinHistory,
  trailDecision,
  formatFixAge,
  isRideStep,
  isVehicleStep,
  fixShowsRide,
  recentRide,
  liveMotionLabel,
  lastTravelAt,
  lastTravelWasRide,
  stayLabelDwellMs,
  liveTrailDrawable,
  TRAIL_RIDE_MIN_MPS,
  RIDE_STATUS_FRESH_MS,
  WALK_STAY_LABEL_MS,
  RIDE_STAY_LABEL_MS,
  STAY_LABEL_DWELL_MS,
  WALK_JOURNEY_STAY_MS,
  RIDE_JOURNEY_STAY_MS,
  collapseIndoorStayDisplay,
  visibleTrail,
  appendLiveTip,
  trailDrawParts,
  trailSegmentDashed,
  JOURNEY_STAY_MS,
  splitClosedJourneys,
  displayLivePoints,
  storedTrackAfterArchive,
  trimJourneyList,
  liveTrailPoints,
  playbackAnchor,
  previewOpenJourney,
  journeysWithinHistory,
  mergeJourneyLists,
  labelJourneyPlace,
} from './tracking.mjs';

test('seoul day rolls at midnight KST, not UTC', () => {
  const beforeMidnight = Date.UTC(2026, 9, 27, 14, 59);
  const midnight = Date.UTC(2026, 9, 27, 15, 0);
  assert.equal(seoulDayKey(beforeMidnight), '2026-10-27');
  assert.equal(seoulDayKey(midnight), '2026-10-28');
  assert.equal(needsDailyWipe('2026-10-27', beforeMidnight), false);
  assert.equal(needsDailyWipe('2026-10-27', midnight), true);
  assert.equal(needsDailyWipe(undefined, midnight), true);
});

test('history keeps today and 30 days ago, and drops the day before that', () => {
  const now = Date.UTC(2026, 9, 27, 16, 0);
  assert.equal(seoulDayKey(now), '2026-10-28');
  const oldest = oldestHistoryDay(now);
  assert.equal(oldest, '2026-09-28');
  assert.equal(historyDayKeys(now)[0], '2026-10-28');
  assert.equal(historyDayKeys(now).at(-1), oldest);
  assert.equal(historyDayKeys(now).length, HISTORY_DAYS + 1);
  const yesterday = Date.UTC(2026, 9, 26, 16, 0);
  const tooOld = Date.UTC(2026, 8, 27, 14, 0);
  assert.equal(isWithinHistory(yesterday, now), true);
  assert.equal(isWithinHistory(tooOld, now), false);
  const kept = tracksWithinHistory({
    self: [
      { lat: 37.0, lng: 127.0, at: tooOld },
      { lat: 37.1, lng: 127.1, at: yesterday },
      { lat: 37.2, lng: 127.2, at: now },
    ],
  }, now);
  assert.equal(kept.self.length, 2);
  assert.equal(kept.self[0].lat, 37.1);
  assert.equal(kept.self[1].lat, 37.2);
  assert.equal(seoulDayKey(seoulDayEndMs('2026-10-27')), '2026-10-27');
});

function offset(point, northM, eastM, at) {
  return {
    ...point,
    lat: point.lat + northM / 111_320,
    lng: point.lng + eastM / (111_320 * Math.cos((point.lat * Math.PI) / 180)),
    at,
  };
}

test('trail sampler keeps a real move and does not draw a stay wiggle', () => {
  const origin = { lat: 37.5, lng: 127, at: 1_000_000, accuracyM: 12 };
  assert.equal(shouldKeepTrailPoint(origin, { lat: 37.50002, lng: 127, at: origin.at + 5_000, accuracyM: 12 }), false);
  assert.equal(shouldKeepTrailPoint(origin, { lat: 37.50002, lng: 127, at: origin.at + 3 * 60 * 1000, accuracyM: 12 }), false);
  assert.equal(shouldKeepTrailPoint(origin, { ...offset(origin, 220, 0, origin.at + 12_000), speedMps: 1.4, staying: false }), true);
});

test('a still fix with ±12m accuracy does not draw a multipath triangle', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.5, lng: 127, at: t, accuracyM: 12, speedMps: 0, staying: true };
  const spike = offset(origin, 32, 28, t + 15_000);
  const back = offset(origin, 6, -22, t + 30_000);
  const drawn = visibleTrail([origin, spike, back]);
  assert.equal(drawn.length, 1);
  assert.equal(trailDecision(origin, offset(origin, 70, 0, t + 12_000)), 'snap');
  assert.equal(drawn[0].lat, origin.lat);
  assert.equal(drawn[0].lng, origin.lng);
  const settled = settleTrailPoint([origin, spike], back, back.at);
  assert.equal(settled.decision, 'snap');
  assert.equal(settled.lat, origin.lat);
  assert.equal(settled.lng, origin.lng);
  assert.equal(visibleTrail(settled.points).length, 1);
  const walked = visibleTrail([origin, spike, back, offset(origin, 70, 0, t + 45_000)]);
  assert.equal(walked.length, 2);
  assert.ok((walked[1].lat - origin.lat) * 111_320 > 60);
});

test('a still phone ignores one fast leap and keeps a sustained walk', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.5, lng: 127, at: t, accuracyM: 15, speedMps: 0, staying: true };
  assert.equal(trailDecision(origin, { ...offset(origin, 110, 0, t + 20_000), speedMps: 0, staying: true, accuracyM: 15 }), 'snap');
  assert.equal(trailDecision(origin, { ...offset(origin, 110, 0, t + 80_000), speedMps: 1.2, staying: true, accuracyM: 15 }), 'keep');
});

test('live pin holds courtyard jitter and follows a relocation the walk filter used to freeze', () => {
  const t = 1_700_000_000_000;
  const hagye = { lat: 37.6365, lng: 127.0678, at: t, accuracyM: 17, speedMps: 0, staying: true };
  const courtyard = { ...offset(hagye, 28, 16, t + 12_000), accuracyM: 17, speedMps: 0, staying: true };
  assert.equal(trailDecision(hagye, courtyard), 'snap');
  const held = settleTrailPoint([hagye], courtyard, courtyard.at);
  assert.equal(held.lat, hagye.lat);
  assert.equal(held.lng, hagye.lng);
  assert.equal(displayCoordinate([hagye], courtyard).lat, hagye.lat);
  assert.equal(visibleTrail([hagye, courtyard]).length, 1);

  const blockLeap = { ...offset(hagye, 100, 0, t + 12_000), accuracyM: 17, speedMps: 0, staying: true };
  assert.equal(isVehicleStep(hagye, blockLeap), true);
  assert.equal(trailDecision(hagye, blockLeap), 'keep');
  const leapt = settleTrailPoint([hagye], blockLeap, blockLeap.at);
  assert.equal(leapt.decision, 'keep');
  assert.equal(leapt.lat, blockLeap.lat);
  assert.equal(leapt.lng, blockLeap.lng);
  assert.equal(displayCoordinate([hagye], blockLeap).lat, blockLeap.lat);
  assert.ok(visibleTrail([hagye, blockLeap]).length >= 2);

  const shortHop = { ...offset(hagye, 1000, 80, t + 15_000), accuracyM: 17, speedMps: 0, staying: true };
  assert.equal(trailDecision(hagye, shortHop), 'drop');
  const spiked = settleTrailPoint([hagye], shortHop, shortHop.at);
  assert.equal(spiked.decision, 'drop');
  assert.equal(spiked.lat, hagye.lat);
  assert.equal(spiked.lng, hagye.lng);
  assert.equal(displayCoordinate([hagye], shortHop).lat, hagye.lat);
  assert.equal(visibleTrail([hagye, shortHop]).length, 1);

  const slowBus = { ...offset(hagye, 1000, 0, t + 90_000), accuracyM: 12, speedMps: null, staying: true };
  const driven = settleTrailPoint([hagye], slowBus, slowBus.at);
  assert.equal(driven.decision, 'keep');
  assert.equal(driven.lat, slowBus.lat);
  assert.equal(liveCoordinate(hagye, slowBus).lat, slowBus.lat);

  const wiggle = { ...offset(slowBus, 18, -12, slowBus.at + 10_000), accuracyM: 17, speedMps: 0, staying: true };
  const stayed = settleTrailPoint(driven.points, wiggle, wiggle.at);
  assert.equal(stayed.lat, slowBus.lat);
  assert.equal(stayed.lng, slowBus.lng);
  assert.equal(displayCoordinate(driven.points, wiggle).lat, slowBus.lat);
});

test('admin, managed, and remote trails drop courtyard spikes and keep a block corner', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.6362, lng: 127.0675, at: t, accuracyM: 15 };
  const sawtooth = (withMotion) => {
    const points = [];
    for (let index = 0; index <= 8; index += 1) {
      const point = offset(origin, index % 2 === 0 ? 0 : 72, index * 55, t + index * 12_000);
      point.accuracyM = 15;
      if (withMotion) {
        point.speedMps = 1.3;
        point.staying = false;
      }
      points.push(point);
    }
    return points;
  };
  const eastOf = (point) => (point.lng - origin.lng) * (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const northOf = (point) => (point.lat - origin.lat) * 111_320;
  for (const points of [sawtooth(true), sawtooth(false)]) {
    const drawn = visibleTrail(points);
    assert.ok(drawn.length >= 2);
    assert.ok(drawn.length < points.length);
    assert.ok(eastOf(drawn[drawn.length - 1]) > 350);
    for (const point of drawn) assert.ok(Math.abs(northOf(point)) < 28);
    let recorded = [points[0]];
    for (const point of points.slice(1)) recorded = settleTrailPoint(recorded, point, point.at).points;
    for (const point of visibleTrail(recorded)) assert.ok(Math.abs(northOf(point)) < 28);
  }

  const shaped = visibleTrail([
    { ...origin, accuracyM: 12, speedMps: 1.3, staying: false },
    { ...offset(origin, 180, 0, t + 160_000), accuracyM: 12, speedMps: 1.3, staying: false },
    { ...offset(origin, 180, 180, t + 300_000), accuracyM: 12, speedMps: 1.3, staying: false },
    { ...offset(origin, 180, 260, t + 360_000), accuracyM: 12, speedMps: 1.3, staying: false },
  ]);
  assert.ok(shaped.some((point) => northOf(point) > 140 && eastOf(point) < 40));

  const opposite = [
    [0, 0], [70, 40], [2, 90], [-68, 130], [0, 190], [75, 230], [0, 280],
  ].map(([north, east], index) => ({
    ...offset(origin, north, east, t + index * 20_000),
    accuracyM: 15,
    speedMps: 1.3,
    staying: false,
  }));
  const flattened = visibleTrail(opposite);
  assert.ok(eastOf(flattened[flattened.length - 1]) > 240);
  for (const point of flattened) assert.ok(Math.abs(northOf(point)) < 20);

  const drive = [0, 1, 2, 3, 4, 5].map((index) => ({
    ...offset(origin, 0, index * 120, t + index * 8_000),
    accuracyM: 8,
    speedMps: 12,
    staying: false,
  }));
  const driven = visibleTrail(drive);
  assert.equal(driven[0].lat, drive[0].lat);
  assert.ok(eastOf(driven[driven.length - 1]) > 500);
  for (const point of driven) assert.ok(Math.abs(northOf(point)) < 12);
});

test('a vehicle pace keeps 2.5s vertices solid and does not say 머무름', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.636, lng: 127.15, at: t, accuracyM: 12, speedMps: 0, staying: true };
  assert.ok(Math.abs(TRAIL_RIDE_MIN_MPS - 7 / 3.6) < 1e-9);
  assert.equal(RIDE_STATUS_FRESH_MS, 45_000);

  const radius = 120;
  const steps = 6;
  const speed = 12;
  const drive = [];
  for (let index = 0; index <= steps; index += 1) {
    const theta = (Math.PI / 2) * (index / steps);
    const north = radius * Math.sin(theta);
    const east = radius * (1 - Math.cos(theta));
    drive.push({
      ...offset(origin, north, east, t + index * 2_500),
      accuracyM: 12,
      speedMps: speed,
      staying: true,
    });
  }
  assert.equal(isRideStep(drive[0], drive[1]), true);
  assert.equal(trailDecision(drive[0], drive[1]), 'keep');
  let recorded = [drive[0]];
  for (const point of drive.slice(1)) recorded = settleTrailPoint(recorded, point, point.at).points;
  const northOf = (point) => (point.lat - origin.lat) * 111_320;
  const eastOf = (point) => (point.lng - origin.lng) * (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const drawn = visibleTrail(recorded);
  assert.ok(drawn.length >= 4, `ride bend kept ${drawn.length} vertices`);
  assert.ok(drawn.some((point) => northOf(point) > 25 && eastOf(point) > 8 && northOf(point) > eastOf(point)));
  const parts = trailDrawParts(recorded);
  assert.equal(parts.some((part) => part.dashed), false);
  assert.equal(liveMotionLabel({ located: true, moving: false, points: recorded, now: drive[drive.length - 1].at + 5_000 }), '지금');
  assert.equal(recentRide(recorded, drive[drive.length - 1].at + 5_000), true);
  assert.equal(lastTravelWasRide(recorded), true);
  assert.equal(stayLabelDwellMs(recorded), RIDE_STAY_LABEL_MS);
  assert.equal(WALK_STAY_LABEL_MS, 45_000);
  assert.equal(RIDE_STAY_LABEL_MS, 3 * 60_000);
  assert.equal(STAY_LABEL_DWELL_MS, WALK_STAY_LABEL_MS);
  assert.equal(liveMotionLabel({ located: true, moving: false, points: recorded, now: drive[drive.length - 1].at + 60_000 }), '지금');
  assert.equal(liveMotionLabel({ located: true, moving: null, points: recorded, now: drive[drive.length - 1].at + 60_000 }), '지금');
  assert.equal(liveMotionLabel({ located: true, moving: false, points: recorded, now: drive[drive.length - 1].at + WALK_STAY_LABEL_MS }), '지금');
  assert.equal(liveMotionLabel({ located: true, moving: false, points: recorded, now: drive[drive.length - 1].at + RIDE_STAY_LABEL_MS }), '머무름');

  const quiet = drive.map((point) => ({ ...point, speedMps: null, staying: true }));
  assert.equal(isRideStep(quiet[0], quiet[1]), true);
  let implied = [quiet[0]];
  for (const point of quiet.slice(1)) implied = settleTrailPoint(implied, point, point.at).points;
  assert.equal(trailDrawParts(implied).some((part) => part.dashed), false);
  assert.ok(visibleTrail(implied).length >= 4);

  const stuck = { ...offset(origin, 4, 0, t + 10_000), accuracyM: 12, speedMps: 12, staying: true };
  assert.equal(isRideStep(origin, stuck), false);
  assert.equal(trailDecision(origin, stuck), 'snap');
  assert.equal(fixShowsRide([origin], stuck), false);

  const hole = {
    ...offset(drive[drive.length - 1], 0, 400, drive[drive.length - 1].at + 40_000),
    accuracyM: 12,
    speedMps: 12,
    staying: true,
  };
  const withHole = settleTrailPoint(recorded, hole, hole.at).points;
  assert.equal(isVehicleStep(drive[drive.length - 1], hole), true);
  assert.equal(trailDrawParts(withHole).some((part) => part.dashed), false);

  const parked = { ...offset(origin, 6, 4, t + 8_000), accuracyM: 12, speedMps: 0, staying: true };
  assert.equal(trailDecision(origin, parked), 'keep');
  const twitch = { ...offset(origin, 3, 1, t + 8_000), accuracyM: 12, speedMps: 0, staying: true };
  assert.equal(trailDecision(origin, twitch), 'snap');
  assert.equal(liveMotionLabel({ located: true, moving: false, points: [origin], now: t + 8_000 }), '머무름');
  assert.equal(liveMotionLabel({ located: false, moving: false, points: recorded, now: t }), '');
});

test('a walk keeps 지금 through sensor gaps and a peer trail uses the same dwell', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.55, lng: 127.02, at: t, accuracyM: 12, speedMps: 1.2, staying: false };
  const walk = [origin];
  for (let index = 1; index <= 8; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 3.2, t + index * 2_500),
      accuracyM: 12,
      speedMps: 1.2,
      staying: false,
    });
  }
  const end = walk[walk.length - 1].at;
  assert.equal(lastTravelAt(walk), end);
  assert.equal(liveMotionLabel({ located: true, moving: false, points: walk, now: end + 2_000 }), '지금');
  assert.equal(liveMotionLabel({ located: true, moving: true, points: walk, now: end + 2_000 }), '지금');
  assert.equal(liveMotionLabel({ located: true, moving: null, points: walk, now: end + 30_000 }), '지금');
  assert.equal(liveMotionLabel({ located: true, moving: false, points: walk, now: end + 30_000 }), '지금');
  assert.equal(lastTravelWasRide(walk), false);
  assert.equal(stayLabelDwellMs(walk), WALK_STAY_LABEL_MS);
  assert.equal(liveMotionLabel({ located: true, moving: false, points: walk, now: end + 60_000 }), '머무름');
  const stillWalking = offset(walk[walk.length - 1], 0, 300, end + 8 * 60_000);
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points: walk,
    now: end + 8 * 60_000 + 1_000,
    pin: { ...stillWalking, accuracyM: 120, speedMps: 0, staying: true },
  }), '머무름');
  const drivingPin = offset(walk[walk.length - 1], 0, 4_000, end + 8 * 60_000);
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points: walk,
    now: end + 8 * 60_000 + 1_000,
    pin: { ...drivingPin, accuracyM: 12, speedMps: 0, staying: true },
  }), '지금');
  const walkedOn = offset(walk[walk.length - 1], 0, 40, end + 50_000);
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points: walk,
    now: end + 55_000,
    pin: { ...walkedOn, accuracyM: 70, speedMps: 1.3, staying: false },
  }), '지금');
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points: walk,
    now: end + 8 * 60_000,
    pin: { ...walkedOn, accuracyM: 70, speedMps: 1.3, staying: false },
  }), '머무름');
  assert.equal(liveMotionLabel({ located: true, moving: null, points: walk, now: end + WALK_STAY_LABEL_MS }), '머무름');
  assert.equal(liveMotionLabel({ located: true, moving: true, points: [], now: end }), '지금');
  const quiet = { ...offset(origin, 4, 2, t + 12_000), accuracyM: 12, speedMps: 0, staying: true };
  assert.equal(lastTravelAt([origin, quiet]), null);
});

test('a short step inside the walking gate is not a vertex, and a poor fix is dropped', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.5, lng: 127, at: t, accuracyM: 12, speedMps: 1.2, staying: false };
  assert.equal(trailDecision(origin, { ...offset(origin, 1.6, 0, t + 2_500), speedMps: 1.2, staying: false }), 'keep');
  assert.equal(trailDecision(origin, { ...offset(origin, 3, 0, t + 2_500), speedMps: 1.2, staying: false, accuracyM: 19 }), 'keep');
  assert.equal(trailDecision(origin, { ...offset(origin, 3, 0, t + 2_500), speedMps: 0, staying: false, accuracyM: 12 }), 'keep');
  assert.equal(trailDecision(origin, { ...offset(origin, 15, 0, t + 10_000), speedMps: 1.2, staying: false }), 'keep');
  const indoor = { ...offset(origin, 70, 0, t + 10_000), accuracyM: 55, speedMps: 1.4, staying: false };
  assert.equal(trailDecision(origin, indoor), 'drop');
  assert.equal(liveCoordinate(origin, indoor).lat, indoor.lat);
  assert.equal(liveCoordinate(origin, { ...indoor, accuracyM: 120 }).lat, origin.lat);
  const relocated = { ...offset(origin, 1000, 0, t + 4 * 60_000), accuracyM: 55, speedMps: 1.4, staying: false };
  assert.equal(trailDecision(origin, relocated), 'keep');
  const coarseMove = { ...offset(origin, 1000, 0, t + 4 * 60_000), accuracyM: 180, speedMps: null, staying: false };
  assert.equal(liveCoordinate(origin, coarseMove).lat, coarseMove.lat);
  assert.equal(trailDecision(origin, coarseMove), 'keep');
  const settled = settleTrailPoint([origin], indoor, indoor.at);
  assert.equal(settled.decision, 'drop');
  assert.equal(settled.lat, indoor.lat);
  assert.equal(settled.points.some((point) => point.lat === indoor.lat), false);
  const stayed = settleTrailPoint([origin], { ...origin, at: t + 4 * 60 * 1000 }, t + 4 * 60 * 1000);
  assert.equal(visibleTrail(stayed.points).length, 1);
  assert.equal(stayed.points.length, 2);
  assert.equal(stayed.points[1].lat, origin.lat);
  assert.equal(stayed.points[1].stayEnd, true);
});

test('stale cached fix is rejected and a fresh precise fix is kept', () => {
  const now = 1_800_000_000_000;
  const stale = acceptFix(null, { lat: 37.5, lng: 127, accuracy: 12, at: now - 31_000 }, { precise: true, now });
  assert.equal(stale.ok, false);
  assert.equal(stale.reason, 'stale');
  const fresh = acceptFix(null, { lat: 37.5, lng: 127, accuracy: 12, at: now - 1_000, speedMps: 1.2 }, { precise: true, now });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.fix.accuracy, 12);
  assert.equal(fresh.fix.speedMps, 1.2);
  const coarse = acceptFix(null, { lat: 37.5, lng: 127, accuracy: 300, at: now }, { precise: true, now });
  assert.equal(coarse.ok, false);
  assert.equal(coarse.reason, 'accuracy');
  const indoor = acceptFix({ lat: 37.5, lng: 127, at: now - 5_000 }, { lat: 37.5004, lng: 127, accuracy: 50, at: now }, { precise: true, now });
  assert.equal(indoor.ok, true);
  assert.equal(indoor.fix.accuracy, 50);
  const laterPoor = acceptFix({ lat: 37.5, lng: 127, at: now - 5_000 }, { lat: 37.5004, lng: 127, accuracy: 120, at: now }, { precise: true, now });
  assert.equal(laterPoor.ok, false);
  assert.equal(laterPoor.reason, 'accuracy');
  const network = acceptFix({ lat: 37.6365, lng: 127.068, at: now - 4 * 60 * 60_000 }, { lat: 37.654, lng: 127.047, accuracy: 180, at: now }, { precise: false, now });
  assert.equal(network.ok, true);
  assert.equal(network.fix.accuracy, 180);
  const cachedCell = acceptFix({ lat: 37.654, lng: 127.047, at: now }, { lat: 37.6365, lng: 127.068, accuracy: 180, at: now - 10_000 }, { precise: false, now });
  assert.equal(cachedCell.ok, false);
  assert.equal(cachedCell.reason, 'stale');
});

test('a single teleport is rejected and a later real move is not', () => {
  const now = 1_800_000_000_000;
  const previous = { lat: 37.5, lng: 127, at: now - 10_000 };
  const jump = acceptFix(previous, { lat: 37.55, lng: 127, accuracy: 10, at: now }, { precise: true, now });
  assert.equal(jump.ok, false);
  assert.equal(jump.reason, 'jump');
  const moved = acceptFix(
    { lat: 37.5, lng: 127, at: now - 30 * 60 * 1000 },
    { lat: 37.55, lng: 127, accuracy: 10, at: now - 1_000 },
    { precise: true, now },
  );
  assert.equal(moved.ok, true);
});

test('a block walk keeps midpoints, stay jitter does not grow, a thin spur drops, and 1km moves the pin', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.6362, lng: 127.0675, at: t, accuracyM: 12, speedMps: 0, staying: true };
  const eastOf = (point) => (point.lng - origin.lng) * (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const northOf = (point) => (point.lat - origin.lat) * 111_320;
  const step = (north, east, at, speed = 0, staying = true) => ({
    ...offset(origin, north, east, at),
    accuracyM: 12,
    speedMps: speed,
    staying,
  });

  let recorded = [step(0, 0, t)];
  for (let index = 1; index <= 40; index += 1) {
    const north = index <= 20 ? index * 4.2 : 20 * 4.2;
    const east = index <= 20 ? 0 : (index - 20) * 4.2;
    const point = step(north, east, t + index * 3_000);
    recorded = settleTrailPoint(recorded, point, point.at).points;
  }
  const drawn = visibleTrail(recorded);
  assert.ok(drawn.length >= 4, `walk midpoints kept, got ${drawn.length}`);
  assert.ok(drawn.some((point) => northOf(point) > 60 && eastOf(point) < 20));
  assert.ok(eastOf(drawn[drawn.length - 1]) > 60);
  assert.ok(northOf(drawn[drawn.length - 1]) > 60);
  const storedWalk = recorded.filter((point) => !point.stayEnd);
  assert.ok(drawn.length >= storedWalk.length * 0.9, `walk samples ${drawn.length} of ${storedWalk.length}`);

  const paced = [];
  for (let index = 0; index <= 6; index += 1) paced.push(step(index * 18, 0, t + index * 14_000, 1.3, false));
  for (let index = 1; index <= 6; index += 1) paced.push(step(6 * 18, index * 18, t + (6 + index) * 14_000, 1.3, false));
  const pacedDrawn = visibleTrail(paced);
  assert.ok(pacedDrawn.length >= 3, `straight legs stay joined at the corner, got ${pacedDrawn.length}`);
  assert.ok(pacedDrawn.some((point) => northOf(point) > 70 && eastOf(point) < 25));

  const jitter = [step(0, 0, t)];
  for (let index = 1; index <= 10; index += 1) {
    jitter.push(step(index % 2 === 0 ? 4 : -3, (index % 3) - 1, t + index * 5_000));
  }
  assert.equal(visibleTrail(jitter).length, 1);
  let stayed = [jitter[0]];
  for (const point of jitter.slice(1)) stayed = settleTrailPoint(stayed, point, point.at).points;
  assert.equal(visibleTrail(stayed).length, 1);

  const tip = step(48, 6, t + 12_000, 1.2, false);
  const back = step(2, 4, t + 24_000, 1.2, false);
  const onward = [origin, tip, back];
  for (let index = 1; index <= 5; index += 1) onward.push(step(2, 4 + index * 20, t + 24_000 + index * 12_000, 1.3, false));
  for (const point of visibleTrail(onward)) assert.ok(northOf(point) < 22, `spur remained at north ${northOf(point)}`);

  const flash = step(1000, 40, t + 20_000, 0, true);
  const spiked = settleTrailPoint([origin], flash, flash.at);
  assert.equal(spiked.decision, 'drop');
  assert.equal(spiked.lat, origin.lat);
  assert.equal(spiked.lng, origin.lng);
  assert.equal(visibleTrail([origin, flash]).length, 1);
  const far = step(1000, 40, t + 90_000, 0, true);
  const moved = settleTrailPoint([origin], far, far.at);
  assert.equal(moved.decision, 'keep');
  assert.equal(moved.lat, far.lat);
  assert.equal(moved.lng, far.lng);
  assert.ok(visibleTrail(moved.points).length >= 2);
});

test('a 5s walk along a bend stays off the straight chord and a continuous run is solid', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.6312, lng: 127.0734, at: t, accuracyM: 15, speedMps: 1.2, staying: false };
  const radius = 40;
  const arcSteps = 11;
  const points = [];
  for (let index = 0; index <= arcSteps; index += 1) {
    const theta = (Math.PI / 2) * (index / arcSteps);
    const north = radius * Math.sin(theta);
    const east = radius * (1 - Math.cos(theta));
    points.push({
      ...offset(origin, north, east, t + index * 5_000),
      accuracyM: 15,
      speedMps: 1.2,
      staying: false,
    });
  }
  let recorded = [points[0]];
  for (const point of points.slice(1)) recorded = settleTrailPoint(recorded, point, point.at).points;
  const northOf = (point) => (point.lat - origin.lat) * 111_320;
  const eastOf = (point) => (point.lng - origin.lng) * (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  const drawn = visibleTrail(recorded);
  assert.ok(drawn.length >= 4, `bend vertices ${drawn.length}`);
  assert.ok(drawn.some((point) => {
    const north = northOf(point);
    const east = eastOf(point);
    return north > 18 && east > 5 && north > east + 8;
  }));
  const parts = trailDrawParts(recorded);
  assert.equal(parts.some((part) => part.dashed), false);
  assert.ok(parts.some((part) => !part.dashed && part.points.length >= 2));
  assert.equal(trailSegmentDashed(points[0], points[1]), false);
  const hole = {
    ...offset(origin, 0, 90, points[points.length - 1].at + 40_000),
    accuracyM: 15,
    speedMps: 1.2,
    staying: false,
  };
  const withHole = settleTrailPoint(recorded, hole, hole.at).points;
  assert.equal(trailDrawParts(withHole).some((part) => part.dashed), false);
});

test('indoor stay drift is not a dashed zigzag or a records scribble, and a real departure still is', () => {
  const t = Date.UTC(2026, 9, 28, 0, 42, 0);
  const origin = { lat: 37.6365, lng: 127.0678, at: t, accuracyM: 18, speedMps: 0, staying: true };
  const hops = [
    [0, 0, 0],
    [40, 70, 120_000],
    [-30, 20, 300_000],
    [80, -60, 480_000],
    [10, 30, 700_000],
    [-50, 90, 900_000],
    [20, -20, 1_100_000],
  ];
  let recorded = [];
  const raw = [];
  for (const [north, east, dt] of hops) {
    const point = { ...offset(origin, north, east, t + dt), accuracyM: 22, speedMps: 0, staying: true };
    raw.push(point);
    const settled = settleTrailPoint(recorded, point, point.at);
    if (dt > 0) assert.equal(settled.decision, 'snap', `indoor hop ${north},${east} was ${settled.decision}`);
    recorded = settled.points;
  }
  assert.equal(visibleTrail(recorded).length, 1);
  assert.equal(trailDrawParts(raw).some((part) => part.dashed), false);
  assert.equal(visibleTrail(raw).length, 1);
  assert.equal(liveTrailDrawable(recorded, t + 1_200_000), false);
  assert.equal(liveMotionLabel({ located: true, moving: false, points: recorded, now: t + 1_200_000 }), '머무름');

  const archived = raw.map(({ lat, lng, at }) => ({ lat, lng, at }));
  const drawn = visibleTrail(archived);
  assert.equal(drawn.length, 1);
  assert.equal(trailDrawParts(archived).some((part) => part.points.length >= 2), false);
  const center = collapseIndoorStayDisplay(archived)[0];
  assert.ok(Math.abs((center.lat - origin.lat) * 111_320) < 80);
  assert.ok(Math.abs((center.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180)) < 80);

  const poor = { ...offset(origin, 35, 12, t + 20_000), accuracyM: 36, speedMps: 0, staying: true };
  assert.equal(settleTrailPoint([origin], poor, poor.at).decision, 'snap');
  assert.equal(visibleTrail([origin, poor]).length, 1);

  const far = { ...offset(origin, 1000, 40, t + 90_000), accuracyM: 12, speedMps: 0, staying: true };
  const moved = settleTrailPoint([origin], far, far.at);
  assert.equal(moved.decision, 'keep');
  assert.ok(visibleTrail(moved.points).length >= 2);

  const walk = [origin];
  for (let index = 1; index <= 16; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 8, t + index * 6_000),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const walked = visibleTrail(walk);
  assert.ok(walked.length >= 2);
  const endEast = (walked[walked.length - 1].lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  assert.ok(endEast > 100, `walk collapsed, east ${endEast.toFixed(1)}`);
  assert.equal(trailDrawParts(walk).some((part) => part.dashed), false);
});

test('stay multipath does not zigzag and a fix outside the stay bubble still moves the pin', () => {
  const t = 1_700_000_000_000;
  const origin = { lat: 37.631, lng: 127.074, at: t, accuracyM: 16, speedMps: 0, staying: true };
  const hops = [[0, 0], [22, 16], [-6, 20], [18, -14], [4, 8], [-12, 18]];
  const points = hops.map(([north, east], index) => ({
    ...offset(origin, north, east, t + index * 6_000),
    accuracyM: 16,
    speedMps: 0,
    staying: true,
  }));
  assert.equal(visibleTrail(points).length, 1);
  let stayed = [points[0]];
  for (const point of points.slice(1)) {
    const settled = settleTrailPoint(stayed, point, point.at);
    const north = Math.abs((settled.lat - origin.lat) * 111_320);
    const east = Math.abs((settled.lng - origin.lng) * (111_320 * Math.cos((origin.lat * Math.PI) / 180)));
    assert.ok(north < 12 && east < 12, `pin drifted ${north.toFixed(1)},${east.toFixed(1)}`);
    stayed = settled.points;
  }
  assert.equal(visibleTrail(stayed).length, 1);
  const bogus = { ...offset(origin, 30, 10, t + 3_000), accuracyM: 16, speedMps: 1.4, staying: true };
  assert.equal(trailDecision(origin, bogus), 'snap');
  assert.equal(liveCoordinate(origin, bogus).lat, origin.lat);
  const left = { ...offset(origin, 70, 10, t + 8_000), accuracyM: 16, speedMps: 0, staying: true };
  assert.equal(trailDecision(origin, left), 'keep');
  const pin = liveCoordinate(origin, left);
  assert.equal(pin.lat, left.lat);
  assert.equal(pin.lng, left.lng);
});

test('fix age says when the pin last updated', () => {
  const now = 1_800_000_000_000;
  assert.equal(formatFixAge(now - 10_000, now), '방금 업데이트');
  assert.equal(formatFixAge(now - 44_000, now), '방금 업데이트');
  assert.equal(formatFixAge(now - 45_000, now), '1분 전 업데이트');
  assert.equal(formatFixAge(now - 3 * 60_000, now), '3분 전 업데이트');
  assert.equal(formatFixAge(now - 3 * 60_000 - 20_000, now), '3분 전 업데이트');
  assert.equal(formatFixAge(now - 2 * 60 * 60_000, now), '2시간 전 업데이트');
});

test('mode thresholds and step estimate', () => {
  assert.equal(classifyMode(4, 800, 12 * 60 * 1000), 'walk');
  assert.equal(classifyMode(10, 2_000, 12 * 60 * 1000), 'bike');
  assert.equal(classifyMode(15, 3_000, 12 * 60 * 1000), 'vehicle');
  assert.equal(classifyMode(60, 10_000, 10 * 60 * 1000), 'vehicle');
  assert.equal(classifyMode(360, 30_000, 5 * 60 * 1000), 'plane');
  assert.equal(classifyMode(360, 500, 5_000), 'vehicle');
  assert.equal(classifyMode(1, 20, 10 * 60 * 1000), 'walk');
  assert.equal(estimateSteps(750), 1000);
  assert.equal(estimateSteps(0), 0);
  assert.equal(formatDurationMs(90 * 60 * 1000), '1시간 30분');
});

test('stop-to-stop segment records walk time and estimated steps', () => {
  const start = Date.UTC(2026, 9, 26, 1, 0, 0);
  const points = [
    { lat: 37.5, lng: 127, at: start },
    { lat: 37.50005, lng: 127, at: start + 3 * 60 * 1000 },
    { lat: 37.50008, lng: 127, at: start + 6 * 60 * 1000 },
    { lat: 37.51, lng: 127, at: start + 16 * 60 * 1000 },
    { lat: 37.52, lng: 127, at: start + 26 * 60 * 1000 },
    { lat: 37.52002, lng: 127.0001, at: start + 32 * 60 * 1000 },
  ];
  const record = buildDayRecord(points, start + 32 * 60 * 1000);
  assert.equal(record.stops.length, 2);
  assert.equal(record.stops[0].leftAt, start + 6 * 60 * 1000);
  assert.equal(record.stops[1].leftAt, null);
  assert.equal(record.segments.length, 1);
  assert.equal(record.segments[0].mode, 'walk');
  assert.equal(record.segments[0].stepsEstimated, true);
  assert.equal(record.segments[0].durationMs, 20 * 60 * 1000);
  assert.ok(record.segments[0].steps > 2000);
  assert.equal(record.segments[0].open, false);
});

function staySamples(point, from, until, stepMs = 60_000) {
  const points = [];
  for (let at = from; at <= until; at += stepMs) {
    points.push({ ...point, at, accuracyM: 12, speedMps: 0, staying: true });
  }
  return points;
}

test('a 2.5s walk keeps a curve and a 5 minute stay archives it', () => {
  const t = Date.UTC(2026, 9, 27, 23, 34);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 12, speedMps: 1.2, staying: false };
  const radius = 28;
  const steps = 16;
  const curve = [];
  for (let index = 0; index <= steps; index += 1) {
    const theta = (Math.PI / 2) * (index / steps);
    curve.push({
      ...offset(origin, radius * Math.sin(theta), radius * (1 - Math.cos(theta)), t + index * 2_500),
      accuracyM: 12,
      speedMps: 1.2,
      staying: false,
    });
  }
  const drawn = visibleTrail(curve);
  assert.ok(drawn.length >= 5, `dense bend vertices ${drawn.length}`);
  const parts = trailDrawParts(curve);
  assert.equal(parts.some((part) => part.dashed), false);
  const painted = parts.reduce((sum, part) => sum + part.points.length, 0);
  assert.ok(painted >= drawn.length, `painted ${painted} drawn ${drawn.length}`);

  const depart = t;
  const walk = [];
  for (let index = 0; index <= 24; index += 1) {
    walk.push({
      ...offset(origin, index * 10, 0, depart + index * 12_000),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const arrive = walk[walk.length - 1].at;
  const early = [...walk, ...staySamples(walk[walk.length - 1], arrive, arrive + 2 * 60 * 1000, 60_000)];
  const tooSoon = splitClosedJourneys(early, arrive + 2 * 60 * 1000);
  assert.equal(tooSoon.journeys.length, 0);
  assert.equal(liveTrailPoints(early, arrive + 2 * 60 * 1000).length, early.length);

  const closed = [...walk, ...staySamples(walk[walk.length - 1], arrive, arrive + JOURNEY_STAY_MS, 60_000)];
  const split = splitClosedJourneys(closed, arrive + JOURNEY_STAY_MS);
  assert.equal(split.journeys.length, 1);
  assert.ok(split.journeys[0].distanceM >= 200);
  assert.ok(split.journeys[0].distanceM < 400);
  assert.equal(split.journeys[0].endedAt, arrive);
  assert.equal(formatJourneyWhen(split.journeys[0].startedAt, split.journeys[0].endedAt, split.journeys[0].startedAt), '08:34–08:38');
  assert.equal(
    formatJourneyWhen(Date.UTC(2026, 9, 28, 12, 28), Date.UTC(2026, 9, 29, 0, 29), Date.UTC(2026, 9, 29, 1, 0)),
    '10/28 21:28 → 10/29 09:29',
  );
  assert.equal(formatJourneyDistance(13_600), '13.6km');
  const live = liveTrailPoints(closed, arrive + JOURNEY_STAY_MS);
  assert.ok(live.length < closed.length);
  assert.ok(live.every((point) => Math.abs((point.lat - walk[walk.length - 1].lat) * 111_320) < 30));
  assert.equal(previewOpenJourney(live, arrive + JOURNEY_STAY_MS), null);

  const again = splitClosedJourneys([...closed, ...staySamples(walk[walk.length - 1], arrive + 60_000, arrive + JOURNEY_STAY_MS, 60_000)], arrive + JOURNEY_STAY_MS + 30_000);
  assert.equal(again.journeys.length, 1);
  assert.equal(again.journeys[0].id, split.journeys[0].id);

  const stale = staySamples(origin, t, t + 3 * 60 * 1000, 3 * 60 * 1000);
  assert.equal(splitClosedJourneys(stale, t + JOURNEY_STAY_MS).journeys.length, 0);

  const fresh = staySamples(origin, t, t + 6 * 60 * 1000, 3 * 60 * 1000);
  const wall = splitClosedJourneys([...walk, ...fresh.map((point) => ({ ...point, at: point.at - t + arrive }))], arrive + JOURNEY_STAY_MS);
  assert.equal(wall.journeys.length, 1);
  assert.equal(liveTrailDrawable(early, arrive + 2 * 60 * 1000), true);
  assert.equal(liveTrailDrawable(closed, arrive + JOURNEY_STAY_MS), false);
});

test('a vehicle stop waits longer than a walk before the live line is archived', () => {
  const t = Date.UTC(2026, 9, 27, 23, 34);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 12, speedMps: 12, staying: false };
  const drive = [];
  for (let index = 0; index <= 30; index += 1) {
    drive.push({
      ...offset(origin, 0, index * 40, t + index * 2_500),
      accuracyM: 12,
      speedMps: 12,
      staying: true,
    });
  }
  const arrive = drive[drive.length - 1].at;
  assert.equal(WALK_JOURNEY_STAY_MS, 5 * 60 * 1000);
  assert.equal(RIDE_JOURNEY_STAY_MS, 12 * 60 * 1000);
  assert.ok(RIDE_JOURNEY_STAY_MS > WALK_JOURNEY_STAY_MS);
  const shortStop = [...drive, ...staySamples(drive[drive.length - 1], arrive, arrive + WALK_JOURNEY_STAY_MS, 60_000)];
  assert.equal(splitClosedJourneys(shortStop, arrive + WALK_JOURNEY_STAY_MS).journeys.length, 0);
  assert.equal(liveTrailDrawable(shortStop, arrive + WALK_JOURNEY_STAY_MS), true);
  const parked = [...drive, ...staySamples(drive[drive.length - 1], arrive, arrive + RIDE_JOURNEY_STAY_MS, 60_000)];
  const split = splitClosedJourneys(parked, arrive + RIDE_JOURNEY_STAY_MS);
  assert.equal(split.journeys.length, 1);
  assert.ok(split.journeys[0].distanceM >= 80);
  assert.equal(liveTrailDrawable(parked, arrive + RIDE_JOURNEY_STAY_MS), false);
  assert.equal(liveTrailPoints(parked, arrive + RIDE_JOURNEY_STAY_MS).some((point) => point.at === drive[0].at), false);
});

test('a short hop after a stay does not become a journey card', () => {
  const t = Date.UTC(2026, 9, 27, 23, 0);
  const origin = { lat: 37.5, lng: 127, at: t, accuracyM: 10, speedMps: 0, staying: true };
  const home = staySamples(origin, t, t + 8 * 60 * 1000, 60_000);
  const hop = offset(origin, 70, 0, t + 10 * 60 * 1000);
  const away = { ...hop, accuracyM: 10, speedMps: 1.2, staying: false };
  const backStay = staySamples(away, away.at, away.at + JOURNEY_STAY_MS, 60_000);
  const split = splitClosedJourneys([...home, away, ...backStay], backStay[backStay.length - 1].at);
  assert.equal(split.journeys.length, 0);
  assert.ok(split.remaining.every((point) => Math.abs((point.lat - away.lat) * 111_320) < 20));
  const labeled = labelJourneyPlace({ lat: origin.lat, lng: origin.lng, label: null }, [{ lat: origin.lat, lng: origin.lng, label: '우리 집', radiusM: 80 }]);
  assert.equal(labeled.label, '우리 집');
});

test('a new walk after archive stays on the live line and old journeys expire', () => {
  const t = Date.UTC(2026, 9, 27, 23, 10);
  const origin = { lat: 37.5, lng: 127, at: t, accuracyM: 10 };
  const walk = [];
  for (let index = 0; index <= 20; index += 1) {
    walk.push({ ...offset(origin, 0, index * 12, t + index * 15_000), accuracyM: 10, speedMps: 1.4, staying: false });
  }
  const arrive = walk[walk.length - 1].at;
  const parked = staySamples(walk[walk.length - 1], arrive, arrive + JOURNEY_STAY_MS, 60_000);
  const next = [];
  for (let index = 1; index <= 12; index += 1) {
    next.push({
      ...offset(walk[walk.length - 1], 0, index * 15, parked[parked.length - 1].at + index * 12_000),
      accuracyM: 10,
      speedMps: 1.4,
      staying: false,
    });
  }
  const now = next[next.length - 1].at;
  const split = splitClosedJourneys([...walk, ...parked, ...next], now);
  assert.equal(split.journeys.length, 1);
  assert.ok(split.journeys[0].distanceM >= 200);
  assert.ok(split.remaining.some((point) => point.at === next[next.length - 1].at));
  assert.equal(split.remaining.some((point) => point.at === walk[0].at), false);
  const open = previewOpenJourney([...walk, ...parked, ...next], now);
  assert.ok(open);
  assert.equal(open.open, true);
  assert.ok(open.distanceM >= 100);
  assert.ok(open.startedAt > arrive);

  const kept = journeysWithinHistory({
    self: [
      split.journeys[0],
      { ...split.journeys[0], id: 'old', endedAt: Date.UTC(2026, 7, 1, 0, 0), startedAt: Date.UTC(2026, 7, 1, 0, 0) },
    ],
  }, now);
  assert.equal(kept.self.length, 1);
  assert.equal(kept.self[0].id, split.journeys[0].id);
});

test('같은 이동을 조금 다르게 다시 쌓아도 카드는 하나다', () => {
  const start = Date.UTC(2026, 9, 28, 3, 49, 0);
  const end = start + 5 * 60_000;
  const points = [
    { lat: 37.63635, lng: 127.07041, at: start },
    { lat: 37.63916, lng: 127.07074, at: end },
  ];
  const first = {
    id: `${start}:${end}:37.6364:127.0704`,
    startedAt: start,
    endedAt: end,
    distanceM: 392,
    points,
    start: { lat: 37.63635, lng: 127.07041, label: null },
    end: { lat: 37.63916, lng: 127.07074, label: null },
  };
  const second = {
    id: `${start + 15_000}:${end + 20_000}:37.6363:127.0704`,
    startedAt: start + 15_000,
    endedAt: end + 20_000,
    distanceM: 398,
    points,
    start: { lat: 37.6364, lng: 127.0705, label: '서울특별시 노원구 중계동' },
    end: { lat: 37.6392, lng: 127.0708, label: null },
  };
  const merged = mergeJourneyLists([first], [second]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].distanceM, 398);
  assert.equal(merged[0].start.label, '서울특별시 노원구 중계동');
  const later = {
    id: 'later-trip',
    startedAt: start + 60 * 60_000,
    endedAt: start + 70 * 60_000,
    distanceM: 800,
    points,
    start: { lat: 37.65, lng: 127.08, label: null },
    end: { lat: 37.66, lng: 127.09, label: null },
  };
  assert.equal(mergeJourneyLists(merged, [later]).length, 2);
});

test('a stay-to-stay hole is not a live line, an open trip, or a journey card', () => {
  const start = Date.UTC(2026, 9, 28, 0, 20, 0);
  const end = start + (1 * 60 + 29) * 60 * 1000;
  const origin = { lat: 37.6365, lng: 127.0678, at: start, accuracyM: 16, speedMps: 0, staying: true };
  const hole = [
    origin,
    { ...offset(origin, 0, 140, end), accuracyM: 16, speedMps: 0, staying: true },
  ];
  const now = end + 71 * 60 * 1000;
  const split = splitClosedJourneys(hole, now);
  assert.equal(split.journeys.length, 0);
  assert.equal(split.remaining.length, 1);
  assert.equal(liveTrailDrawable(hole, now), false);
  assert.equal(previewOpenJourney(hole, end), null);
  assert.equal(trailDrawParts(split.remaining).some((part) => part.points.length >= 2), false);
  const startMark = playbackAnchor(hole, 0);
  const endMark = playbackAnchor(hole, 1);
  assert.equal(startMark.lat, origin.lat);
  assert.equal(startMark.lng, origin.lng);
  assert.equal(endMark.lng, hole[1].lng);
});

test('overnight jitter in one neighborhood does not become a journey', () => {
  const start = Date.UTC(2026, 9, 27, 11, 42, 0);
  const origin = { lat: 37.6362, lng: 127.0675, at: start, accuracyM: 18, speedMps: 0, staying: true };
  const hops = [
    [0, 0, 0],
    [40, 30, 40 * 60 * 1000],
    [-20, 55, 3 * 60 * 60 * 1000],
    [70, -15, 7 * 60 * 60 * 1000],
    [15, 25, 11 * 60 * 60 * 1000],
    [5, -10, 14 * 60 * 60 * 1000 + 38 * 60 * 1000],
  ];
  const cloud = hops.map(([north, east, dt]) => ({
    ...offset(origin, north, east, start + dt),
    accuracyM: 18,
    speedMps: 0,
    staying: true,
  }));
  const now = cloud[cloud.length - 1].at + 6 * 60 * 1000;
  const split = splitClosedJourneys(cloud, now);
  assert.equal(split.journeys.length, 0);
  assert.equal(liveTrailDrawable(cloud, now), false);
  assert.equal(previewOpenJourney(cloud, cloud[cloud.length - 1].at), null);
  const kept = journeysWithinHistory({
    self: [{
      id: 'overnight',
      startedAt: cloud[0].at,
      endedAt: cloud[cloud.length - 1].at,
      distanceM: 253,
      points: cloud,
      start: { lat: cloud[0].lat, lng: cloud[0].lng, label: '노원구 하계동' },
      end: { lat: cloud[cloud.length - 1].lat, lng: cloud[cloud.length - 1].lng, label: '노원구 하계동' },
    }],
  }, now);
  assert.equal(kept.self, undefined);
});

test('a 12 hour 154m home stay is not a journey even if it was saved as a card', () => {
  const start = Date.UTC(2026, 9, 28, 12, 28);
  const end = Date.UTC(2026, 9, 29, 0, 29);
  const origin = { lat: 37.6362, lng: 127.0675, at: start, accuracyM: 18, speedMps: 0, staying: true };
  const hops = [
    [0, 0, 0],
    [80, 40, 3 * 60 * 60 * 1000],
    [-30, 70, 6 * 60 * 60 * 1000],
    [50, -20, 9 * 60 * 60 * 1000],
    [20, 30, end - start],
  ];
  const cloud = hops.map(([north, east, dt]) => ({
    ...offset(origin, north, east, start + dt),
    accuracyM: 18,
    speedMps: 0,
    staying: true,
  }));
  const durationMs = end - start;
  assert.equal(isStayNotJourney(cloud, durationMs, 154), true);
  assert.ok(STAY_BOUND_RADIUS_M >= 300);
  const now = end + 6 * 60 * 1000;
  const kept = journeysWithinHistory({
    self: [{
      id: 'home-stay',
      startedAt: start,
      endedAt: end,
      distanceM: 154,
      cloud: false,
      points: cloud,
      start: { lat: cloud[0].lat, lng: cloud[0].lng, label: '노원구 하계동' },
      end: { lat: cloud[cloud.length - 1].lat, lng: cloud[cloud.length - 1].lng, label: '노원구 하계동' },
    }],
  }, now);
  assert.equal(kept.self, undefined);
});

test('a flash jump is dropped from the trail and does not move the pin', () => {
  const t = Date.UTC(2026, 9, 28, 1, 0, 0);
  const origin = { lat: 37.55, lng: 127.02, at: t, accuracyM: 12, speedMps: 0, staying: true };
  const spike = { ...offset(origin, 0, 480, t + 4_000), accuracyM: 12, speedMps: 0, staying: true };
  const settled = settleTrailPoint([origin], spike, spike.at);
  assert.equal(settled.decision, 'drop');
  assert.equal(settled.lat, origin.lat);
  assert.equal(settled.lng, origin.lng);
  assert.equal(liveCoordinate(origin, spike).lat, origin.lat);
  assert.equal(visibleTrail([origin, spike]).some((point) => point.lng === spike.lng), false);
  const parts = trailDrawParts([origin, spike]);
  assert.equal(parts.some((part) => part.points.length >= 2), false);
});

test('playback stays inside a dense walk and does not cross a later hole', () => {
  const t = Date.UTC(2026, 9, 28, 2, 0, 0);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 12, speedMps: 1.3, staying: false };
  const walk = [];
  for (let index = 0; index <= 20; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 12, t + index * 10_000),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const hole = {
    ...offset(walk[walk.length - 1], 0, 160, walk[walk.length - 1].at + 80 * 60 * 1000),
    accuracyM: 12,
    speedMps: 0,
    staying: true,
  };
  const begin = playbackAnchor(walk, 0);
  const mid = playbackAnchor(walk, 0.5);
  const end = playbackAnchor(walk, 1);
  assert.ok(begin.at < mid.at && mid.at < end.at);
  assert.ok(Math.abs(begin.lng - origin.lng) < 0.0002);
  assert.ok(end.lng > begin.lng);
  const across = playbackAnchor([...walk, hole], 1);
  assert.ok(Math.abs(across.lng - hole.lng) < 0.0004);
});

test('walk and ride samples stay dense; only a jump or stationary noise is dropped', () => {
  const t = Date.UTC(2026, 9, 28, 5, 0, 0);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 8, speedMps: 1.4, staying: false };
  const walk = [];
  for (let index = 0; index <= 24; index += 1) {
    const north = index < 12 ? 0 : (index - 12) * 4;
    const east = index < 12 ? index * 4 : 48;
    walk.push({
      ...offset(origin, north, east, t + index * 2_500),
      accuracyM: 8,
      speedMps: 1.4,
      staying: false,
    });
  }
  let recorded = [walk[0]];
  for (const point of walk.slice(1)) recorded = settleTrailPoint(recorded, point, point.at).points;
  const walkVertices = recorded.filter((point) => !point.stayEnd);
  assert.equal(walkVertices.length, walk.length);

  const rideOrigin = { ...offset(origin, 200, 0, t), accuracyM: 8, speedMps: 12, staying: false };
  const ride = [];
  for (let index = 0; index <= 20; index += 1) {
    ride.push({
      ...offset(rideOrigin, index < 10 ? 0 : (index - 10) * 18, index < 10 ? index * 18 : 180, t + index * 1_000),
      accuracyM: 8,
      speedMps: 12,
      staying: false,
    });
  }
  let driven = [ride[0]];
  for (const point of ride.slice(1)) driven = settleTrailPoint(driven, point, point.at).points;
  assert.equal(driven.filter((point) => !point.stayEnd).length, ride.length);

  const slow = TRAIL_RIDE_MIN_MPS;
  const vehicle = [];
  for (let index = 0; index <= 12; index += 1) {
    vehicle.push({
      ...offset(origin, 0, index * slow * 2.5, t + index * 2_500),
      accuracyM: 8,
      speedMps: slow,
      staying: false,
    });
  }
  let rolling = [vehicle[0]];
  for (const point of vehicle.slice(1)) rolling = settleTrailPoint(rolling, point, point.at).points;
  assert.equal(rolling.filter((point) => !point.stayEnd).length, vehicle.length);

  const beforeNoise = walkVertices.length;
  let noisy = recorded;
  for (let index = 0; index < 8; index += 1) {
    const jitter = {
      ...offset(walk[walk.length - 1], index % 2 === 0 ? 6 : -4, index % 3, walk[walk.length - 1].at + (index + 1) * 2_000),
      accuracyM: 14,
      speedMps: 0,
      staying: true,
    };
    noisy = settleTrailPoint(noisy, jitter, jitter.at).points;
  }
  const keptNoise = noisy.filter((point) => !point.stayEnd).length;
  assert.ok(keptNoise >= beforeNoise);
  const flash = {
    ...offset(walk[walk.length - 1], 0, 500, walk[walk.length - 1].at + 4_000),
    accuracyM: 12,
    speedMps: 0,
    staying: true,
  };
  const spiked = settleTrailPoint(noisy, flash, flash.at);
  assert.equal(spiked.decision, 'drop');
  assert.equal(spiked.points.filter((point) => !point.stayEnd).length, keptNoise);
});

test('a walk after a GPS hole stays in the raw track and later becomes a card', () => {
  const t = Date.UTC(2026, 9, 28, 6, 0, 0);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 10, speedMps: 1.3, staying: false };
  const before = [];
  for (let index = 0; index <= 8; index += 1) {
    before.push({
      ...offset(origin, 0, index * 8, t + index * 6_000),
      accuracyM: 10,
      speedMps: 1.3,
      staying: false,
    });
  }
  const hole = {
    ...offset(before[before.length - 1], 0, 180, before[before.length - 1].at + 8 * 60 * 1000),
    accuracyM: 12,
    speedMps: 0,
    staying: true,
  };
  let points = [...before, hole];
  const opened = storedTrackAfterArchive(points, hole.at + 1_000);
  assert.equal(opened.journeys.length, 0);
  assert.equal(opened.points, points);
  assert.equal(splitClosedJourneys(points, hole.at + 1_000).remaining.some((point) => point.at === hole.at), true);

  const after = [];
  for (let index = 1; index <= 40; index += 1) {
    after.push({
      ...offset(hole, 0, index * 8, hole.at + index * 6_000),
      accuracyM: 10,
      speedMps: 1.3,
      staying: false,
    });
  }
  points = [...points, ...after];
  const during = storedTrackAfterArchive(points, after[after.length - 1].at + 1_000);
  assert.equal(during.journeys.length, 0);
  assert.equal(during.points.length, points.length);
  assert.equal(during.points[during.points.length - 1].lng, after[after.length - 1].lng);

  const arrive = after[after.length - 1].at;
  const stay = [];
  for (let at = arrive; at <= arrive + WALK_JOURNEY_STAY_MS; at += 60_000) {
    stay.push({ ...after[after.length - 1], at, speedMps: 0, staying: true, accuracyM: 10 });
  }
  const closed = storedTrackAfterArchive([...points, ...stay], arrive + WALK_JOURNEY_STAY_MS);
  assert.equal(closed.journeys.length, 1);
  assert.ok(closed.journeys[0].distanceM >= 300, `card distance ${closed.journeys[0].distanceM}`);
  assert.ok(closed.points.length < points.length);
  const kept = trimJourneyList(closed.journeys, arrive + WALK_JOURNEY_STAY_MS);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].distanceM >= 300);
});

test('a straight walk over 300m survives trimJourneyList after compaction', () => {
  const t = Date.UTC(2026, 9, 28, 7, 0, 0);
  const origin = { lat: 37.56, lng: 127.08, at: t, accuracyM: 8, speedMps: 1.4, staying: false };
  const walk = [];
  for (let index = 0; index <= 250; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 3, t + index * 2_000),
      accuracyM: 8,
      speedMps: 1.4,
      staying: false,
    });
  }
  const arrive = walk[walk.length - 1].at;
  const stay = [];
  for (let at = arrive; at <= arrive + WALK_JOURNEY_STAY_MS; at += 60_000) {
    stay.push({ ...walk[walk.length - 1], at, speedMps: 0, staying: true, accuracyM: 8 });
  }
  const split = splitClosedJourneys([...walk, ...stay], arrive + WALK_JOURNEY_STAY_MS);
  assert.equal(split.journeys.length, 1);
  assert.ok(split.journeys[0].distanceM >= 300, `dense distance ${split.journeys[0].distanceM}`);
  assert.ok(split.journeys[0].points.length < walk.length);
  assert.equal(split.journeys[0].points.some((point) => point.speedMps != null), false);
  assert.equal(trailSegmentDashed(split.journeys[0].points[0], split.journeys[0].points[split.journeys[0].points.length - 1]), true);
  const kept = trimJourneyList(split.journeys, arrive + WALK_JOURNEY_STAY_MS);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].distanceM >= 300);
});

test('a 1km loop inside 200m of its centroid survives trim after compaction', () => {
  const t = Date.UTC(2026, 9, 28, 8, 0, 0);
  const origin = { lat: 37.58, lng: 127.02, at: t, accuracyM: 8, speedMps: 1.2, staying: false };
  const radius = 90;
  const laps = 2;
  const steps = 280;
  const walk = [];
  for (let index = 0; index <= steps; index += 1) {
    const theta = laps * 2 * Math.PI * (index / steps);
    walk.push({
      ...offset(origin, radius * Math.sin(theta), radius * Math.cos(theta), t + index * 4_700),
      accuracyM: 8,
      speedMps: 1.2,
      staying: false,
    });
  }
  const arrive = walk[walk.length - 1].at;
  assert.ok(arrive - t >= 21 * 60_000);
  const stay = staySamples(walk[walk.length - 1], arrive, arrive + WALK_JOURNEY_STAY_MS, 60_000);
  const split = splitClosedJourneys([...walk, ...stay], arrive + WALK_JOURNEY_STAY_MS);
  assert.equal(split.journeys.length, 1);
  const card = split.journeys[0];
  assert.ok(card.distanceM >= 1000, `loop distance ${card.distanceM}`);
  assert.equal(card.cloud, false);
  assert.ok(card.points.length < walk.length);
  const kept = trimJourneyList([card], arrive + WALK_JOURNEY_STAY_MS);
  assert.equal(kept.length, 1);
  assert.ok(kept[0].distanceM >= 1000);

  const legacy = {
    id: 'neighborhood-loop',
    startedAt: t,
    endedAt: t + 25 * 60_000,
    distanceM: 1000,
    points: [0, 90, 180, 270, 30].map((deg, index) => {
      const theta = (deg * Math.PI) / 180;
      return offset(origin, radius * Math.sin(theta), radius * Math.cos(theta), t + index * 5 * 60_000);
    }),
    start: { lat: origin.lat, lng: origin.lng, label: null },
    end: { lat: origin.lat, lng: origin.lng, label: null },
  };
  assert.equal(trimJourneyList([legacy], t + 25 * 60_000).length, 1);
});

test('a 2h stay then a 15 minute walk is a 15 minute card', () => {
  const t = Date.UTC(2026, 9, 28, 1, 0, 0);
  const origin = { lat: 37.57, lng: 127.05, at: t, accuracyM: 14, speedMps: 0, staying: true };
  const home = [];
  for (let index = 0; index <= 120; index += 1) {
    const north = index % 2 === 0 ? 28 : -28;
    const east = (index % 3) * 12 - 12;
    home.push({
      ...offset(origin, north, east, t + index * 60_000),
      accuracyM: 14,
      speedMps: 0,
      staying: true,
    });
  }
  const depart = home[home.length - 1].at;
  const walk = [];
  for (let index = 1; index <= 75; index += 1) {
    walk.push({
      ...offset(home[home.length - 1], 0, index * 10, depart + index * 12_000),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const arrive = walk[walk.length - 1].at;
  assert.equal(arrive - depart, 15 * 60_000);
  const away = staySamples(walk[walk.length - 1], arrive, arrive + 30 * 60_000, 60_000);
  const now = away[away.length - 1].at;
  const open = previewOpenJourney([...home, ...walk], arrive);
  assert.ok(open);
  const openMinutes = (open.endedAt - open.startedAt) / 60_000;
  assert.ok(openMinutes >= 14 && openMinutes <= 16, `open preview ${openMinutes.toFixed(1)} min`);
  assert.ok(open.startedAt >= depart);
  assert.ok(open.startedAt < depart + 2 * 60_000);
  assert.ok(open.points.every((point) => point.at >= depart));
  assert.ok(open.points.every((point) => point.at <= arrive));

  const split = splitClosedJourneys([...home, ...walk, ...away], now);
  assert.equal(split.journeys.length, 1);
  const card = split.journeys[0];
  const minutes = (card.endedAt - card.startedAt) / 60_000;
  assert.ok(minutes >= 14 && minutes <= 16, `card ${minutes.toFixed(1)} min`);
  assert.ok(card.startedAt >= depart);
  assert.ok(card.startedAt < depart + 2 * 60_000);
  assert.ok(card.endedAt <= arrive + 60_000);
  assert.ok(card.points.every((point) => point.at >= card.startedAt && point.at <= card.endedAt));
  assert.ok(card.points[0].at > t + 90 * 60_000);
  assert.ok(card.distanceM >= 600 && card.distanceM < 900, `distance ${card.distanceM}`);
  const kept = trimJourneyList(split.journeys, now);
  assert.equal(kept.length, 1);
  assert.ok((kept[0].endedAt - kept[0].startedAt) / 60_000 <= 16);
});

test('a stay-flagged walk with no speed still leaves the 2h stay', () => {
  const t = Date.UTC(2026, 9, 28, 2, 0, 0);
  const origin = { lat: 37.56, lng: 127.04, at: t, accuracyM: 12, speedMps: 0, staying: true };
  const home = staySamples(origin, t, t + 2 * 60 * 60 * 1000, 60_000);
  const depart = home[home.length - 1].at;
  const walk = [];
  for (let index = 1; index <= 75; index += 1) {
    const step = offset(origin, 0, index * 10, depart + index * 12_000);
    walk.push({ lat: step.lat, lng: step.lng, at: step.at, accuracyM: 12, staying: true });
  }
  const arrive = walk[walk.length - 1].at;
  assert.equal(arrive - depart, 15 * 60_000);
  const away = staySamples(walk[walk.length - 1], arrive, arrive + WALK_JOURNEY_STAY_MS, 60_000);
  const now = away[away.length - 1].at;
  const split = splitClosedJourneys([...home, ...walk, ...away], now);
  assert.equal(split.journeys.length, 1);
  const card = split.journeys[0];
  const minutes = (card.endedAt - card.startedAt) / 60_000;
  assert.ok(minutes >= 12 && minutes <= 17, `card ${minutes.toFixed(1)} min`);
  assert.ok(card.startedAt > t + 90 * 60_000);
  assert.ok(card.startedAt < depart + 3 * 60_000);
  assert.ok(card.points[0].at > t + 90 * 60_000);
  const open = previewOpenJourney([...home, ...walk], arrive);
  assert.ok(open);
  const openMinutes = (open.endedAt - open.startedAt) / 60_000;
  assert.ok(openMinutes >= 12 && openMinutes <= 17, `open ${openMinutes.toFixed(1)} min`);
});

test('the clipped card replaces the longer card stored for the same walk', () => {
  const t = Date.UTC(2026, 9, 28, 3, 0, 0);
  const origin = { lat: 37.54, lng: 127.03, at: t, accuracyM: 12, speedMps: 0, staying: true };
  const home = staySamples(origin, t, t + 2 * 60 * 60 * 1000, 60_000);
  const depart = home[home.length - 1].at;
  const walk = [];
  for (let index = 1; index <= 75; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 10, depart + index * 12_000),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const arrive = walk[walk.length - 1].at;
  const away = staySamples(walk[walk.length - 1], arrive, arrive + WALK_JOURNEY_STAY_MS, 60_000);
  const now = away[away.length - 1].at;
  const archived = storedTrackAfterArchive([...home, ...walk, ...away], now);
  assert.equal(archived.journeys.length, 1);
  const clipped = archived.journeys[0];
  assert.ok((clipped.endedAt - clipped.startedAt) / 60_000 <= 17);
  const legacy = {
    id: `${Math.floor(t / 60_000)}:${origin.lat.toFixed(3)}:${origin.lng.toFixed(3)}`,
    startedAt: t,
    endedAt: clipped.endedAt,
    distanceM: clipped.distanceM + 80,
    points: [home[0], home[Math.floor(home.length / 2)], ...clipped.points],
    start: { lat: origin.lat, lng: origin.lng, label: '우리 집' },
    end: { ...clipped.end },
  };
  const merged = mergeJourneyLists([legacy], archived.journeys);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].startedAt, clipped.startedAt);
  assert.equal(merged[0].endedAt, clipped.endedAt);
  assert.equal(merged[0].distanceM, clipped.distanceM);
  assert.equal(merged[0].start.label, '우리 집');
  const again = mergeJourneyLists(merged, archived.journeys);
  assert.equal(again.length, 1);
  assert.equal(again[0].startedAt, clipped.startedAt);
  const kept = trimJourneyList([legacy, clipped], now);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].startedAt, clipped.startedAt);
});

test('a short stop at the destination does not replace the commute', () => {
  const start = Date.UTC(2026, 9, 28, 4, 28, 0);
  const end = start + 32 * 60_000;
  const origin = { lat: 37.6542, lng: 127.0624, at: start };
  const dest = offset(origin, 4000, 7000, end);
  const commute = {
    id: 'commute',
    startedAt: start,
    endedAt: end,
    distanceM: 9500,
    points: [
      { lat: origin.lat, lng: origin.lng, at: start },
      offset(origin, 2000, 3500, start + 16 * 60_000),
      { lat: dest.lat, lng: dest.lng, at: end },
    ],
    start: { lat: origin.lat, lng: origin.lng, label: '노원구 상계6·7동' },
    end: { lat: dest.lat, lng: dest.lng, label: '구리시 인창동' },
  };
  const yardStart = end - 90_000;
  const yardEnd = end + 2 * 60_000;
  const yard = {
    id: 'yard',
    startedAt: yardStart,
    endedAt: yardEnd,
    distanceM: 160,
    points: [
      { lat: dest.lat, lng: dest.lng, at: yardStart },
      offset(dest, 40, 20, yardStart + 60_000),
      offset(dest, 20, 40, yardEnd),
    ],
    start: { lat: dest.lat, lng: dest.lng, label: null },
    end: { ...offset(dest, 20, 40, yardEnd), label: null },
  };
  const merged = mergeJourneyLists([commute], [yard]);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((item) => item.distanceM === 9500 && item.startedAt === start));
  const kept = trimJourneyList([commute, yard], yardEnd + 60_000);
  assert.equal(kept.length, 2);
  assert.ok(kept.some((item) => item.distanceM === 9500));
});

test('playback interpolates a segment midpoint and stays on an L-shaped corner', () => {
  const t = Date.UTC(2026, 9, 28, 3, 0, 0);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 8, speedMps: 8, staying: false };
  const end = { ...offset(origin, 0, 100, t + 10_000), accuracyM: 8, speedMps: 8, staying: false };
  const mid = playbackAnchor([origin, end], 0.5);
  assert.ok(Math.abs(mid.lng - (origin.lng + end.lng) / 2) < 0.00002);
  assert.ok(Math.abs(mid.lat - origin.lat) < 0.00002);
  assert.ok(Math.abs(mid.at - (t + 5_000)) < 80);

  const corner = { ...offset(origin, 0, 120, t + 10_000), accuracyM: 8, speedMps: 8, staying: false };
  const north = { ...offset(corner, 120, 0, t + 20_000), accuracyM: 8, speedMps: 8, staying: false };
  const bend = playbackAnchor([origin, corner, north], 0.5);
  assert.ok(Math.abs(bend.lat - corner.lat) < 0.00003, `lat ${bend.lat} vs ${corner.lat}`);
  assert.ok(Math.abs(bend.lng - corner.lng) < 0.00003, `lng ${bend.lng} vs ${corner.lng}`);
  const chordLat = (origin.lat + north.lat) / 2;
  const chordLng = (origin.lng + north.lng) / 2;
  assert.ok(Math.abs(bend.lat - chordLat) + Math.abs(bend.lng - chordLng) > 0.0003);
});

test('a 32 minute drive counts dashed gaps and is a vehicle, not a 3.2 km walk', () => {
  const start = Date.UTC(2026, 9, 28, 4, 28, 0);
  const origin = { lat: 37.6542, lng: 127.0624, at: start, accuracyM: 12, speedMps: 8.9, staying: false };
  const points = [{ ...origin }];
  let north = 0;
  let east = 0;
  let at = start;
  const push = (dn, de, dt, speed) => {
    north += dn;
    east += de;
    at += dt;
    points.push({
      ...offset(origin, north, east, at),
      accuracyM: 12,
      speedMps: speed,
      staying: false,
    });
  };
  const solid = (steps) => {
    for (let index = 0; index < steps; index += 1) push(6, 16, 2_000, 8.9);
  };
  solid(40);
  push(1100, 2200, 8 * 60 * 1000, 9.2);
  solid(40);
  push(1100, 2200, 8 * 60 * 1000, 9.2);
  solid(40);
  push(900, 1800, 12 * 60 * 1000, 8.5);
  solid(20);
  const duration = points[points.length - 1].at - points[0].at;
  assert.ok(duration >= 31 * 60 * 1000 && duration <= 34 * 60 * 1000, `duration ${Math.round(duration / 1000)}s`);
  let solidOnly = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (!trailSegmentDashed(points[index - 1], points[index])) solidOnly += journeyPathDistance([points[index - 1], points[index]]);
  }
  const measured = journeyPathDistance(points);
  assert.ok(solidOnly > 2_000 && solidOnly < 4_000, `solid ${Math.round(solidOnly)}`);
  assert.ok(measured >= 9_000 && measured <= 11_000, `distance ${Math.round(measured)}`);
  assert.ok(Math.abs(measured - 3_200) > 2_000);
  assert.equal(classifyJourneyMode(points, measured, duration), 'vehicle');
});

test('one short GPS spike does not turn a walk into a vehicle', () => {
  const t = Date.UTC(2026, 9, 28, 6, 0, 0);
  const origin = { lat: 37.55, lng: 127.07, at: t, accuracyM: 10, speedMps: 1.4, staying: false };
  const walk = [];
  for (let index = 0; index <= 40; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 4, t + index * 3_000),
      accuracyM: 10,
      speedMps: 1.4,
      staying: false,
    });
  }
  const last = walk[walk.length - 1];
  const spike = { ...offset(last, 0, 80, last.at + 2_000), accuracyM: 10, speedMps: 40, staying: false };
  const back = { ...offset(spike, 0, 4, spike.at + 3_000), accuracyM: 10, speedMps: 1.4, staying: false };
  const points = [...walk, spike, back];
  const distance = journeyPathDistance(points);
  assert.equal(classifyJourneyMode(points, distance, back.at - walk[0].at), 'walk');
});

test('a walk home then 30 minutes of indoor spikes ends the live line and is not drawn', () => {
  const t = Date.UTC(2026, 10, 1, 2, 24, 0);
  const origin = { lat: 37.6372, lng: 127.0709, at: t, accuracyM: 12, speedMps: 1.3, staying: false };
  let points = [origin];
  for (let index = 1; index <= 30; index += 1) {
    const step = { ...offset(origin, 0, index * 4, t + index * 2_500), accuracyM: 12, speedMps: 1.3, staying: false };
    points = settleTrailPoint(points, step, step.at).points;
  }
  const home = points[points.length - 1];
  const arrived = home.at;
  for (let minute = 1; minute <= 30; minute += 1) {
    const quiet = { ...home, at: arrived + minute * 60_000, accuracyM: 18, speedMps: 0, staying: true };
    points = settleTrailPoint(points, quiet, quiet.at).points;
    if (minute % 4 === 0) {
      const spike = { ...offset(home, 0, 100, quiet.at + 5_000), accuracyM: 65, speedMps: 0, staying: true };
      const back = { ...home, at: quiet.at + 12_000, accuracyM: 20, speedMps: 0, staying: true };
      const spiked = settleTrailPoint(points, spike, spike.at);
      assert.equal(spiked.decision, 'snap', `indoor spike minute ${minute} was ${spiked.decision}`);
      points = settleTrailPoint(spiked.points, back, back.at).points;
    }
  }
  const now = arrived + 30 * 60_000;
  const split = splitClosedJourneys(points, now);
  assert.ok(split.journeys.length >= 1, 'the walk home is a finished journey');
  assert.equal(displayLivePoints(points, now).length, 0);
  const drawn = trailDrawParts(points);
  const spikeEast = (home.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180) + 80;
  for (const part of drawn) {
    for (const point of part.points) {
      const east = (point.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
      assert.ok(east < spikeEast, `spike drawn at ${east.toFixed(0)}m`);
    }
  }
});

test('accurate still jumps between nearby buildings do not stay on the main line', () => {
  const t = Date.UTC(2026, 10, 1, 5, 0, 0);
  const origin = { lat: 37.6372, lng: 127.0709, at: t, accuracyM: 12, speedMps: 1.3, staying: false };
  let points = [origin];
  for (let index = 1; index <= 30; index += 1) {
    const step = { ...offset(origin, 0, index * 4, t + index * 2_500), accuracyM: 12, speedMps: 1.3, staying: false };
    points = settleTrailPoint(points, step, step.at).points;
  }
  const home = points[points.length - 1];
  const arrived = home.at;
  for (let minute = 1; minute <= 8; minute += 1) {
    const east = minute % 2 === 0 ? 80 : 0;
    const jump = { ...offset(home, 0, east, arrived + minute * 60_000), accuracyM: 12, speedMps: 0, staying: true };
    const settled = settleTrailPoint(points, jump, jump.at);
    assert.equal(settled.decision, 'snap', `still jump minute ${minute} was ${settled.decision}`);
    points = settled.points;
  }
  const early = arrived + 2 * 60_000;
  const earlyDrawn = trailDrawParts(points.filter((point) => point.at <= early));
  const limit = (home.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180) + 50;
  for (const part of earlyDrawn) {
    for (const point of part.points) {
      const east = (point.lng - origin.lng) * 111_320 * Math.cos((origin.lat * Math.PI) / 180);
      assert.ok(east < limit, `spike drawn early at ${east.toFixed(0)}m`);
    }
  }
  const now = arrived + 8 * 60_000;
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points,
    now,
    pin: { ...home, at: now, speedMps: 0, staying: true },
  }), '머무름');
  assert.ok(splitClosedJourneys(points, now).journeys.length >= 1);
  const live = displayLivePoints(points, now);
  assert.equal(live.length, 0);
  assert.equal(trailDrawParts(live).some((part) => part.points.length >= 2), false);
});

test('a stored indoor loop that outlasts the stay wait leaves the main line', () => {
  const t = Date.UTC(2026, 10, 1, 5, 20, 0);
  const origin = { lat: 37.6372, lng: 127.0709, at: t, accuracyM: 12, speedMps: 1.3, staying: false };
  const points = [origin];
  for (let index = 1; index <= 30; index += 1) {
    points.push({ ...offset(origin, 0, index * 4, t + index * 2_500), accuracyM: 12, speedMps: 1.3, staying: false });
  }
  const home = points[points.length - 1];
  for (let minute = 1; minute <= 8; minute += 1) {
    points.push({
      ...offset(home, 0, minute % 2 === 0 ? 80 : 0, home.at + minute * 60_000),
      accuracyM: 12,
      speedMps: 0,
      staying: true,
    });
  }
  const now = home.at + 10 * 60_000;
  assert.equal(liveMotionLabel({
    located: true,
    moving: false,
    points,
    now,
    pin: { ...home, at: now, speedMps: 0, staying: true },
  }), '머무름');
  assert.equal(displayLivePoints(points, now).length, 0);
});

test('a stay-to-stay hole adds nothing to the trip distance', () => {
  const start = Date.UTC(2026, 9, 28, 0, 20, 0);
  const end = start + 89 * 60 * 1000;
  const origin = { lat: 37.6365, lng: 127.0678, at: start, accuracyM: 16, speedMps: 0, staying: true };
  const hole = [origin, { ...offset(origin, 0, 140, end), accuracyM: 16, speedMps: 0, staying: true }];
  assert.ok(journeyPathDistance(hole) < 20);
});

test('a long gap stays one solid line, and one stored point still reaches the pin', () => {
  const t = Date.UTC(2026, 10, 4, 6, 0, 0);
  const origin = { lat: 37.63, lng: 127.06, at: t, accuracyM: 12, speedMps: 1.3, staying: false };
  const walk = [origin];
  for (let index = 1; index <= 30; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 4, t + index * 2_500),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const last = walk[walk.length - 1];
  const hole = { ...offset(last, 0, 180, last.at + 8 * 60_000), accuracyM: 12, speedMps: 0, staying: true };
  const points = [hole];
  for (let minute = 0; minute <= 6; minute += 1) {
    points.push({ ...hole, at: hole.at + minute * 60_000, speedMps: 0, staying: true });
  }
  const trail = [...walk, ...points];
  const now = hole.at + 6 * 60_000;
  const before = displayLivePoints([...walk, hole], hole.at + 1_000);
  assert.ok(before.some((point) => point.at === hole.at), 'the straight gap is on the line before the stay closes');
  const split = splitClosedJourneys(trail, now);
  assert.equal(split.journeys.length, 1);
  assert.equal(split.journeys[0].points.some((point) => point.at === hole.at), true);
  const parts = trailDrawParts(split.journeys[0].points);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].dashed, false);
  assert.ok(parts[0].points.length >= 2);
  assert.equal(displayLivePoints(trail, now).length, 0);
  const tip = appendLiveTip(trailDrawParts([origin]), hole);
  assert.equal(tip.length, 1);
  assert.equal(tip[0].dashed, false);
  assert.equal(tip[0].points.length, 2);
  assert.equal(tip[0].points[1].lat, hole.lat);
  assert.equal(tip[0].points[1].lng, hole.lng);
});

test('a finished walk or ride leaves the live line and keeps the same points in records', () => {
  const t = Date.UTC(2026, 10, 4, 7, 0, 0);
  const origin = { lat: 37.62, lng: 127.05, at: t, accuracyM: 12, speedMps: 1.3, staying: false };
  const walk = [origin];
  for (let index = 1; index <= 40; index += 1) {
    walk.push({
      ...offset(origin, 0, index * 4, t + index * 2_500),
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
  }
  const arrived = walk[walk.length - 1];
  const hole = { ...offset(arrived, 0, 180, arrived.at + 8 * 60_000), accuracyM: 12, speedMps: 0, staying: true };
  const withStay = (minutes) => {
    const points = [...walk, hole];
    for (let at = hole.at + 20_000; at <= hole.at + minutes * 60_000; at += 20_000) {
      points.push({ ...hole, at, speedMps: 0, staying: true });
    }
    return points;
  };
  const early = withStay(4);
  const earlyNow = early[early.length - 1].at;
  const earlyArchived = storedTrackAfterArchive(early, earlyNow);
  assert.equal(earlyArchived.journeys.length, 0);
  assert.equal(earlyArchived.points.length, early.length);
  assert.ok(displayLivePoints(early, earlyNow).some((point) => point.at === walk[0].at));

  const closed = withStay(6);
  const now = closed[closed.length - 1].at;
  const archived = storedTrackAfterArchive(closed, now);
  assert.equal(archived.journeys.length, 1);
  const saved = archived.journeys[0].points;
  for (const point of [...walk, hole]) {
    const lat = Number(point.lat.toFixed(6));
    const lng = Number(point.lng.toFixed(6));
    assert.equal(saved.some((item) => item.at === point.at && item.lat === lat && item.lng === lng), true);
  }
  assert.equal(archived.points.some((point) => point.at === walk[0].at), false);
  assert.equal(displayLivePoints(archived.points, now).some((point) => point.at === walk[0].at), false);
  const next = [
    ...archived.points,
    { ...offset(hole, 0, 30, now + 30_000), accuracyM: 12, speedMps: 1.3, staying: false },
    { ...offset(hole, 0, 60, now + 60_000), accuracyM: 12, speedMps: 1.3, staying: false },
  ];
  const drawn = trailDrawParts(displayLivePoints(next, now + 60_000)).flatMap((part) => part.points);
  assert.equal(drawn.some((point) => point.at === walk[0].at), false);
  assert.equal(drawn.some((point) => point.at === now + 60_000), true);

  const rideOrigin = { ...origin, at: t + 3 * 60 * 60_000, speedMps: 8, staying: false };
  const ride = [rideOrigin];
  for (let index = 1; index <= 30; index += 1) {
    ride.push({
      ...offset(rideOrigin, 0, index * 25, rideOrigin.at + index * 2_500),
      accuracyM: 12,
      speedMps: 8,
      staying: false,
    });
  }
  const parked = ride[ride.length - 1];
  const rideStay = (minutes) => {
    const points = [...ride];
    for (let at = parked.at + 20_000; at <= parked.at + minutes * 60_000; at += 20_000) {
      points.push({ ...parked, at, speedMps: 0, staying: true });
    }
    return points;
  };
  const rideEarly = rideStay(5);
  assert.equal(storedTrackAfterArchive(rideEarly, rideEarly[rideEarly.length - 1].at).journeys.length, 0);
  assert.ok(displayLivePoints(rideEarly, rideEarly[rideEarly.length - 1].at).some((point) => point.at === ride[0].at));
  const rideClosed = rideStay(12);
  const rideNow = rideClosed[rideClosed.length - 1].at;
  const rideArchived = storedTrackAfterArchive(rideClosed, rideNow);
  assert.equal(rideArchived.journeys.length, 1);
  for (const point of ride) {
    assert.equal(rideArchived.journeys[0].points.some((item) => item.at === point.at), true);
  }
  assert.equal(rideArchived.points.some((point) => point.at === ride[0].at), false);

  const screen = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  const session = readFileSync(new URL('../components/family/session.tsx', import.meta.url), 'utf8');
  const tracking = readFileSync(new URL('../components/family/useFamilyTracking.ts', import.meta.url), 'utf8');
  assert.equal(screen.includes('saved.slice(0, -1)'), false);
  assert.match(screen, /visibilitychange/);
  assert.match(screen, /closeJourneys\(now\)/);
  assert.match(session, /case 'update-self'/);
  assert.match(session, /archiveJourneys\(/);
  assert.match(session, /case 'close-journeys'/);
  assert.match(tracking, /updateSelf\(fix\.lat/);
});
