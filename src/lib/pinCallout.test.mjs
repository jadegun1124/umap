import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calloutAnchors, memberCalloutHtml, spreadPinPositions } from './mapPinSpread.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the label tail and the pin share one projected point at every zoom', () => {
  const members = [
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
    { id: 'mom', lat: 37.6372, lng: 127.07085 },
    { id: 'self', lat: 37.6372, lng: 127.0709 },
  ];
  const placed = spreadPinPositions(members);
  const deltas = [];
  for (const zoom of [16, 18, 19]) {
    for (const member of members) {
      const slot = placed.get(member.id);
      const anchors = calloutAnchors({
        lat: slot.lat,
        lng: slot.lng,
        dx: slot.dx,
        dy: slot.dy,
        zoom,
      });
      assert.equal(anchors.pin.x, anchors.labelTail.x);
      assert.equal(anchors.pin.y, anchors.labelTail.y);
      assert.ok(Math.abs(anchors.pin.x - anchors.origin.x - (slot.dx || 0)) < 1e-6);
      assert.ok(Math.abs(anchors.pin.y - anchors.origin.y - (slot.dy || 0)) < 1e-6);
      deltas.push(anchors.pin.x - anchors.origin.x);
    }
  }
  assert.equal(new Set(deltas.filter((_, index) => index % 3 === 0)).size, 1);
  const metersPerLng = 111320 * Math.cos((37.6372 * Math.PI) / 180);
  const shifted = 127.07085 + 22 / metersPerLng;
  const low = calloutAnchors({ lat: 37.6372, lng: shifted, dx: 0, dy: 0, zoom: 16 });
  const high = calloutAnchors({ lat: 37.6372, lng: shifted, dx: 0, dy: 0, zoom: 19 });
  const baseLow = calloutAnchors({ lat: 37.6372, lng: 127.07085, dx: 0, dy: 0, zoom: 16 });
  const baseHigh = calloutAnchors({ lat: 37.6372, lng: 127.07085, dx: 0, dy: 0, zoom: 19 });
  const grow = (high.origin.x - baseHigh.origin.x) / (low.origin.x - baseLow.origin.x);
  assert.ok(grow > 7, `a 22m offset grew ${grow}`);
});

test('the callout box has a real width so the tail stays on the pin', () => {
  const html = memberCalloutHtml({
    dx: 150,
    dy: 0,
    dimmed: false,
    tailColor: '#fff',
    labelHtml: '<span data-label>Khoon</span>',
    faceHtml: 'K',
  });
  assert.match(html, /inline-flex/);
  assert.match(html, /width:max-content/);
  assert.match(html, /data-label-tail/);
  assert.match(html, /data-pin-anchor/);
  assert.match(html, /translate\(150px, 0px\)/);
  assert.equal(html.includes('calc(-50%'), false);
  const screen = text('../components/family/StreetMap.tsx');
  assert.match(screen, /memberCalloutHtml/);
  const tracking = text('../components/family/useFamilyTracking.ts');
  assert.equal(/id === 'self' && haversineMeters\(here, home\)/.test(tracking), false);
});

test('the release notes do not promise dashed walks or a diag code', () => {
  const workflow = text('../../.github/workflows/build-apk.yml');
  assert.equal(workflow.includes('48m·20초 이상 빈 걸음 구간은 점선'), false);
  assert.equal(workflow.includes('걸음 구멍은 점선'), false);
  assert.equal(workflow.includes('진단 코드를 보여 줍니다'), false);
  assert.equal(workflow.includes('코드만 있으면 그 기록을 볼 수 있습니다'), false);
  assert.match(workflow, /키 업로드/);
  assert.match(workflow, /10초/);
  assert.match(workflow, /30초/);
  assert.match(workflow, /1\.67\.0/);
});
