import assert from 'node:assert/strict';
import test from 'node:test';
import { distanceMeters, groupMembersByPlace, SAME_PLACE_METERS, statusCalloutHtml } from './memberStatusGroup.mjs';
import {
  ANCHOR_HOLD_M,
  GROUP_LEAVE_M,
  assignChipOffsets,
  chipBox,
  chooseChipOffset,
  groupChipSize,
  overlapDepth,
  holdAnchor,
  holdSpread,
  stablePlaceGroups,
  stickyStatusHost,
} from './statusLayout.mjs';

function pointAt(origin, meters) {
  let lng = origin.lng + meters / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  for (let step = 0; step < 8; step += 1) {
    const got = distanceMeters(origin, { lat: origin.lat, lng });
    if (!(got > 0)) break;
    lng = origin.lng + (lng - origin.lng) * (meters / got);
  }
  return { lat: origin.lat, lng };
}

test('a centroid inside 8m keeps the chip anchor and a real move releases it', () => {
  const parked = { lat: 37.55, lng: 127.02 };
  const wobble = { lat: parked.lat + 3 / 111_320, lng: parked.lng };
  assert.ok(distanceMeters(parked, wobble) < ANCHOR_HOLD_M);
  assert.deepEqual(holdAnchor(parked, wobble), parked);
  const walked = { lat: parked.lat + 20 / 111_320, lng: parked.lng };
  assert.ok(distanceMeters(parked, walked) > ANCHOR_HOLD_M);
  assert.deepEqual(holdAnchor(parked, walked), walked);
  assert.deepEqual(holdAnchor(null, walked), walked);
});

test('stack slots survive a latitude wobble and the pin lat stays real', () => {
  const previous = new Map([
    ['south', { lat: 37.55, lng: 127.02, dx: 0, dy: 0 }],
    ['north', { lat: 37.55002, lng: 127.02, dx: 0, dy: -80 }],
  ]);
  const next = new Map([
    ['south', { lat: 37.55003, lng: 127.02, dx: 0, dy: -80 }],
    ['north', { lat: 37.55, lng: 127.02, dx: 0, dy: 0 }],
  ]);
  const held = holdSpread(previous, next);
  assert.equal(held.get('south').dy, 0);
  assert.equal(held.get('south').lat, 37.55003);
  assert.equal(held.get('north').dy, -80);
  const far = holdSpread(previous, new Map([
    ['south', { lat: 37.552, lng: 127.02, dx: 0, dy: -80 }],
  ]));
  assert.equal(far.get('south').dy, -80);
  assert.equal(far.get('south').lat, 37.552);
});

test('fresh groups match the 50m rule and a pair already together stays until 62m', () => {
  const self = { id: 'self', role: 'self', name: '나', lat: 37.55, lng: 127.02 };
  const near = { id: 'mom', name: '엄마', ...pointAt(self, 30) };
  const fresh = stablePlaceGroups([self, near], []);
  const plain = groupMembersByPlace([self, near]);
  assert.deepEqual(fresh.map((group) => group.key), plain.map((group) => group.key));
  assert.equal(fresh.length, 1);

  const edge = { id: 'mom', name: '엄마', ...pointAt(self, 55) };
  assert.ok(distanceMeters(self, edge) > SAME_PLACE_METERS);
  assert.ok(distanceMeters(self, edge) < GROUP_LEAVE_M);
  assert.equal(stablePlaceGroups([self, edge], []).length, 2);
  const kept = stablePlaceGroups([self, edge], [{ key: 'mom|self', members: [self, { id: 'mom' }] }]);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].ordered.map((member) => member.id), ['self', 'mom']);

  const apart = { id: 'mom', name: '엄마', ...pointAt(self, 70) };
  assert.ok(distanceMeters(self, apart) > GROUP_LEAVE_M);
  assert.equal(stablePlaceGroups([self, apart], [{ key: 'mom|self', members: [self, { id: 'mom' }] }]).length, 2);
});

test('a new member does not move the merged chip off the pin that already carries it', () => {
  const previous = new Map([
    ['self', 'self'],
    ['mom', 'self'],
  ]);
  assert.equal(stickyStatusHost(['self', 'mom', 'dad'], previous, 'dad'), 'self');
  assert.equal(stickyStatusHost(['mom', 'khoon'], new Map([['mom', 'uncle'], ['khoon', 'uncle']]), 'mom'), 'mom');
  assert.equal(stickyStatusHost(['self', 'mom'], new Map(), 'mom'), 'mom');
});

test('a chip keeps its slot until it covers a button, then returns only when the preferred slot is clear', () => {
  const anchor = { x: 200, y: 400 };
  const size = groupChipSize(2);
  const blocked = [{ left: 40, right: 360, top: 180, bottom: 400 }];
  const first = chooseChipOffset({
    kind: 'status',
    anchor,
    size,
    obstacles: blocked,
    preferred: { dx: 0, dy: -72 },
  });
  assert.ok(first.dx !== 0 || first.dy !== -72);
  const again = chooseChipOffset({
    kind: 'status',
    anchor,
    size,
    obstacles: blocked,
    previous: first,
    preferred: { dx: 0, dy: -72 },
  });
  assert.deepEqual(again, first);
  const home = chooseChipOffset({
    kind: 'status',
    anchor,
    size,
    obstacles: [],
    previous: first,
    preferred: { dx: 0, dy: -72 },
  });
  assert.deepEqual(home, { dx: 0, dy: -72 });
  const crowded = assignChipOffsets([
    {
      id: 'status:a',
      kind: 'status',
      anchor,
      size,
      obstacles: blocked,
      previous: null,
      preferred: { dx: 0, dy: -72 },
    },
  ]);
  assert.equal(crowded.changed, true);
  assert.equal(crowded.offsets.get('status:a').dx !== 0 || crowded.offsets.get('status:a').dy !== -72, true);
});

test('a few pixels of button overlap still leaves the slot', () => {
  const anchor = { x: 200, y: 300 };
  const size = { width: 120, height: 80 };
  const button = [{ left: 150, right: 250, top: 224, bottom: 260 }];
  const stayed = chipBox('status', anchor, { dx: 0, dy: -72 }, size);
  assert.ok(overlapDepth(stayed, button[0]) > 0);
  assert.ok(overlapDepth(stayed, button[0]) <= 8);
  const moved = chooseChipOffset({
    kind: 'status',
    anchor,
    size,
    obstacles: button,
    previous: { dx: 0, dy: -72 },
    preferred: { dx: 0, dy: -72 },
  });
  const box = chipBox('status', anchor, moved, size);
  assert.equal(overlapDepth(box, button[0]), 0);
  assert.ok(moved.dx !== 0 || moved.dy !== -72);
});

test('a chip beside the top buttons stays on screen instead of climbing off the map', () => {
  const anchor = { x: 300, y: 140 };
  const size = groupChipSize(2);
  const buttons = [{ left: 330, right: 390, top: 8, bottom: 170 }];
  const offset = chooseChipOffset({
    kind: 'status',
    anchor,
    size,
    obstacles: buttons,
    preferred: { dx: 0, dy: -72 },
    viewport: { width: 390, height: 700 },
  });
  const box = chipBox('status', anchor, offset, size);
  assert.ok(box.top >= 4, `top ${box.top}`);
  assert.ok(box.left >= 4 && box.right <= 386, JSON.stringify(box));
  assert.equal(overlapDepth(box, buttons[0]), 0);
});

test('a side offset still draws one leader from the anchor', () => {
  const html = statusCalloutHtml('<span data-label>나</span>', '#fff', { dx: 160, dy: -72 });
  assert.match(html, /data-pin-leader/);
  assert.match(html, /data-label-tail/);
  assert.match(html, /160px/);
  assert.equal(html.includes('rotate(-90deg)'), false);
  const straight = statusCalloutHtml('<span data-label>나</span>', '#fff', { dx: 0, dy: -72 });
  assert.match(straight, /rotate\(-90deg\)/);
  assert.match(straight, /width:72px/);
});
