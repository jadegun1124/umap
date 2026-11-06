import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  CALLOUT_BLOCK_PX,
  CALLOUT_STACK_PX,
  bubbleSlot,
  calloutBoxesOverlap,
  calloutScreenBox,
  markerZIndex,
  memberCalloutHtml,
  spreadPinPositions,
  syncCalloutGeometry,
} from './mapPinSpread.mjs';

const require = createRequire(import.meta.url);

test('two members on the same spot keep the real coordinate and stack labels above it', () => {
  const members = [
    { id: 'self', lat: 37.6372, lng: 127.07085 },
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
  ];
  const placed = spreadPinPositions(members);
  const lower = placed.get('khoon');
  const upper = placed.get('self');
  assert.ok(lower && upper);
  assert.equal(lower.lat, members[1].lat);
  assert.equal(lower.lng, members[1].lng);
  assert.equal(upper.lat, members[0].lat);
  assert.equal(upper.lng, members[0].lng);
  assert.equal(lower.dx, 0);
  assert.equal(upper.dx, 0);
  assert.equal(lower.dy, 0);
  assert.equal(upper.dy, -CALLOUT_STACK_PX);
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

test('stacked callouts stay above their own pins and do not overlap at any zoom', () => {
  const south = { id: 'mom', lat: 37.6372, lng: 127.07085 };
  const north = { id: 'self', lat: 37.6372 + 30 / 111320, lng: 127.07085 };
  const same = [
    { id: 'mom', lat: 37.6372, lng: 127.07085 },
    { id: 'self', lat: 37.6372, lng: 127.07085 },
  ];
  for (const members of [[south, north], same]) {
    const placed = spreadPinPositions(members);
    for (const zoom of [15, 17, 19]) {
      const boxes = members.map((member) => {
        const slot = placed.get(member.id);
        const box = calloutScreenBox({ lat: slot.lat, lng: slot.lng, dx: slot.dx, dy: slot.dy, zoom });
        assert.equal(slot.lat, member.lat);
        assert.equal(slot.lng, member.lng);
        assert.equal(box.tail.x, box.pin.x);
        assert.ok(box.bottom <= box.pin.y - 21 + 0.001);
        return box;
      });
      assert.equal(calloutBoxesOverlap(boxes[0], boxes[1]), false);
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
  assert.equal(placed.get('south').dy, 0);
  assert.equal(placed.get('mid').dy, -CALLOUT_STACK_PX);
  assert.equal(placed.get('north').dy, -2 * CALLOUT_STACK_PX);
  assert.ok(markerZIndex(placed.get('south').dy, false) > markerZIndex(placed.get('north').dy, false));
  assert.ok(markerZIndex(-CALLOUT_STACK_PX * 8, true) > markerZIndex(0, false));
});

test('a pin without a status chip does not draw an empty callout', () => {
  const html = memberCalloutHtml({ dx: 0, dy: -80, labelHtml: '', faceHtml: '엄' });
  assert.equal(html.includes('data-callout'), false);
  assert.equal(html.includes('data-pin-leader'), false);
  assert.equal(html.includes('data-label-tail'), false);
  assert.match(html, /data-pin-anchor/);
});

test('a seated chip grows a leader when the slot leaves the pin', () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(`<div id="pin">${memberCalloutHtml({ dx: 0, dy: 0, labelHtml: '<span data-label>나</span>', faceHtml: '나' })}</div>`);
  const root = dom.window.document.querySelector('[data-pin-root]');
  assert.equal(root.querySelector('[data-pin-leader]'), null);
  syncCalloutGeometry(root, 160, -16);
  const leader = root.querySelector('[data-pin-leader]');
  assert.ok(leader);
  assert.match(leader.style.width, /px/);
  assert.notEqual(leader.style.display, 'none');
  assert.match(root.querySelector('[data-callout]').style.transform, /160px/);
  syncCalloutGeometry(root, 0, 0);
  assert.equal(root.querySelector('[data-pin-leader]').style.display, 'none');
});
