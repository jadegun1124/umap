import assert from 'node:assert/strict';
import test from 'node:test';
import { spreadPinPositions } from './mapPinSpread.mjs';

test('two members on the same spot shift their bubbles in screen pixels', () => {
  const members = [
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
  ];
  const placed = spreadPinPositions(members);
  const left = placed.get('khoon');
  const right = placed.get('self');
  assert.ok(left && right);
  assert.equal(left.lat, members[1].lat);
  assert.equal(right.lng, members[0].lng);
  assert.ok(Math.abs((left.dx || 0) - (right.dx || 0)) >= 200, `dx ${left.dx},${right.dx}`);
});

test('a member standing alone keeps the real coordinate', () => {
  const placed = spreadPinPositions([
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'far', lat: 37.65, lng: 127.09 },
  ]);
  assert.equal(placed.get('self').lat, 37.6372);
  assert.equal(placed.get('far').lng, 127.09);
});
