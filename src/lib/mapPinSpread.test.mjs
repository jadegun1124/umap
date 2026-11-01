import assert from 'node:assert/strict';
import test from 'node:test';
import { spreadPinPositions } from './mapPinSpread.mjs';

function meters(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

test('two members on the same spot stay far enough apart to read both bubbles', () => {
  const members = [
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
  ];
  const placed = spreadPinPositions(members);
  const left = placed.get('khoon');
  const right = placed.get('self');
  assert.ok(left && right);
  const gap = meters(left, right);
  assert.ok(gap >= 18 && gap <= 30, `gap ${gap}`);
  assert.ok(Math.abs(left.lat - right.lat) < 1e-6);
  assert.notEqual(left.lng, right.lng);
});

test('a member standing alone keeps the real coordinate', () => {
  const placed = spreadPinPositions([
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'far', lat: 37.65, lng: 127.09 },
  ]);
  assert.equal(placed.get('self').lat, 37.6372);
  assert.equal(placed.get('far').lng, 127.09);
});
