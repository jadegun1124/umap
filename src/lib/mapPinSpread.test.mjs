import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CALLOUT_BLOCK_PX,
  CALLOUT_STACK_PX,
  bubbleSlot,
  markerZIndex,
  spreadPinPositions,
} from './mapPinSpread.mjs';

test('two members on the same spot keep the real coordinate and are not spread', () => {
  const members = [
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
  ];
  const placed = spreadPinPositions(members);
  for (const member of members) {
    const slot = placed.get(member.id);
    assert.equal(slot.lat, member.lat);
    assert.equal(slot.lng, member.lng);
    assert.equal(slot.dx, 0);
    assert.equal(slot.dy, 0);
  }
  assert.ok(CALLOUT_STACK_PX >= CALLOUT_BLOCK_PX);
});

test('a member standing alone keeps the real coordinate and the label on the pin', () => {
  const placed = spreadPinPositions([
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'far', lat: 37.65, lng: 127.09 },
  ]);
  assert.equal(placed.get('self').lat, 37.6372);
  assert.equal(placed.get('self').dx, 0);
  assert.equal(placed.get('self').dy, 0);
  assert.equal(placed.get('far').lng, 127.09);
  assert.equal(placed.get('far').dy, 0);
});

test('nearby pins stay on their coordinates with no callout offset', () => {
  const south = { id: 'mom', lat: 37.6372, lng: 127.07085 };
  const north = { id: 'self', lat: 37.6372 + 30 / 111320, lng: 127.07085 };
  const same = [
    { id: 'mom', lat: 37.6372, lng: 127.07085 },
    { id: 'self', lat: 37.6372, lng: 127.07085 },
  ];
  for (const members of [[south, north], same]) {
    const placed = spreadPinPositions(members);
    for (const member of members) {
      const slot = placed.get(member.id);
      assert.equal(slot.lat, member.lat);
      assert.equal(slot.lng, member.lng);
      assert.equal(slot.dx, 0);
      assert.equal(slot.dy, 0);
    }
  }
});

test('the southern chip stays on its circle and northern chips climb', () => {
  const members = [
    { id: 'north', lat: 37.6374, lng: 127.07085 },
    { id: 'south', lat: 37.6372, lng: 127.07085 },
    { id: 'mid', lat: 37.6373, lng: 127.07085 },
  ];
  const placed = spreadPinPositions(members);
  assert.deepEqual(bubbleSlot(0, 3), { dx: 0, dy: 0 });
  for (const member of members) {
    assert.equal(placed.get(member.id).dy, 0);
    assert.equal(placed.get(member.id).lat, member.lat);
  }
  assert.ok(markerZIndex(0, true) > markerZIndex(0, false));
});
