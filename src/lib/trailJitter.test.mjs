import assert from 'node:assert/strict';
import test from 'node:test';
import { settleTrailPoint, trailDecision, trailDrawParts, walkLeavesStay } from './tracking.mjs';

function east(lat, lng, metersEast) {
  return { lat, lng: lng + metersEast / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

function north(lat, lng, metersNorth) {
  return { lat: lat + metersNorth / 110540, lng };
}

function meters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 1.51 kept this as soon as the speed badge looked like a walk. Heading was not checked. */
function keptOn151(last, point) {
  const reported = point.speedMps;
  const accuracy = point.accuracyM;
  return reported >= 0.7 && reported <= 2.6 && accuracy > 0 && accuracy <= 25 && meters(last, point) >= 0.2;
}

test('a sideways hop inside the accuracy bubble is dropped, and 1.51 would have kept it', () => {
  const home = { lat: 37.55, lng: 127.05 };
  const t = 1_700_000_000_000;
  const first = { ...home, at: t, speedMps: 1.2, accuracyM: 12, staying: false };
  const second = { ...east(home.lat, home.lng, 3), at: t + 2_500, speedMps: 1.2, accuracyM: 12, staying: false };
  const hop = { ...north(second.lat, second.lng, 6), at: t + 5_000, speedMps: 1.2, accuracyM: 22, staying: false };
  assert.equal(keptOn151(second, hop), true);
  assert.equal(trailDecision(second, hop), 'keep');
  let points = settleTrailPoint([], first, first.at).points;
  points = settleTrailPoint(points, second, second.at).points;
  const settled = settleTrailPoint(points, hop, hop.at);
  assert.equal(settled.decision, 'snap');
  assert.equal(settled.points.filter((point) => !point.stayEnd).length, 2);
});

test('a 2.5s walk and a real corner stay, and a walk still leaves a stay', () => {
  const home = { lat: 37.55, lng: 127.05 };
  const t = 1_700_000_000_000;
  let points = [];
  for (let index = 0; index <= 20; index += 1) {
    const at = t + index * 2_500;
    const sample = { ...east(home.lat, home.lng, index * 3), at, speedMps: 1.2, accuracyM: 19, staying: false };
    points = settleTrailPoint(points, sample, at).points;
  }
  assert.equal(points.filter((point) => !point.stayEnd).length, 21);
  const tip = points[points.length - 1];
  const corner = { ...north(tip.lat, tip.lng, 3), at: tip.at + 2_500, speedMps: 1.2, accuracyM: 12, staying: false };
  const turned = settleTrailPoint(points, corner, corner.at);
  assert.equal(turned.decision, 'keep');
  const quietCorner = { ...north(tip.lat, tip.lng, 3), at: tip.at + 2_500, speedMps: null, accuracyM: 18, staying: false };
  assert.equal(settleTrailPoint(points, quietCorner, quietCorner.at).decision, 'keep');
  const zeroCorner = { ...north(tip.lat, tip.lng, 3), at: tip.at + 2_500, speedMps: 0, accuracyM: 18, staying: false };
  assert.equal(settleTrailPoint(points, zeroCorner, zeroCorner.at).decision, 'keep');
  assert.equal(trailDrawParts(turned.points).some((part) => part.dashed), false);

  let stayed = [];
  for (let index = 0; index < 8; index += 1) {
    const at = t + index * 60_000;
    stayed = settleTrailPoint(stayed, { ...home, at, speedMps: 0, accuracyM: 12, staying: true }, at).points;
  }
  const anchorAt = stayed.filter((point) => !point.stayEnd).at(-1).at;
  const leave = { ...east(home.lat, home.lng, 12), at: anchorAt + 8_000, speedMps: 1.2, accuracyM: 8, staying: false };
  assert.equal(walkLeavesStay(stayed, leave), true);
  assert.equal(settleTrailPoint(stayed, leave, leave.at).decision, 'keep');
});
