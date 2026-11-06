import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calloutAnchors, memberCalloutHtml, memberPinIcon, spreadPinPositions } from './mapPinSpread.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('the avatar stays on the projected lat/lng at every zoom', () => {
  const members = [
    { id: 'khoon', lat: 37.6372, lng: 127.07085 },
    { id: 'mom', lat: 37.6372, lng: 127.07085 },
    { id: 'self', lat: 37.6372, lng: 127.0709 },
  ];
  const placed = spreadPinPositions(members);
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
      assert.equal(slot.lat, member.lat);
      assert.equal(slot.lng, member.lng);
      assert.equal(anchors.pin.x, anchors.origin.x);
      assert.equal(anchors.pin.y, anchors.origin.y);
      assert.ok(Math.abs(anchors.labelTail.x - anchors.pin.x - (slot.dx || 0)) < 1e-6);
      assert.ok(Math.abs(anchors.labelTail.y - anchors.pin.y - (slot.dy || 0)) < 1e-6);
    }
  }
  const metersPerLng = 111320 * Math.cos((37.6372 * Math.PI) / 180);
  const shifted = 127.07085 + 22 / metersPerLng;
  const low = calloutAnchors({ lat: 37.6372, lng: shifted, dx: 120, dy: 0, zoom: 16 });
  const high = calloutAnchors({ lat: 37.6372, lng: shifted, dx: 120, dy: 0, zoom: 19 });
  const baseLow = calloutAnchors({ lat: 37.6372, lng: 127.07085, dx: 120, dy: 0, zoom: 16 });
  const baseHigh = calloutAnchors({ lat: 37.6372, lng: 127.07085, dx: 120, dy: 0, zoom: 19 });
  const grow = (high.pin.x - baseHigh.pin.x) / (low.pin.x - baseLow.pin.x);
  assert.ok(grow > 7, `a 22m offset grew ${grow}`);
  assert.equal(high.pin.x - high.origin.x, 0);
  assert.equal(high.labelTail.x - high.pin.x, 120);
});

test('the circle is the marker anchor and the label shift does not move it', () => {
  const html = memberCalloutHtml({
    dx: 150,
    dy: 0,
    dimmed: false,
    tailColor: '#fff',
    labelHtml: '<span data-label>Khoon</span>',
    faceHtml: 'K',
  });
  assert.match(html, /data-pin-root/);
  assert.match(html, /data-pin-anchor/);
  assert.match(html, /data-label-tail/);
  assert.match(html, /width:max-content/);
  assert.match(html, /width:42px/);
  assert.match(html, /translate\(calc\(-50% \+ 150px\), 0px\)/);
  const pin = html.slice(html.indexOf('data-pin-root'), html.indexOf('data-callout'));
  assert.equal(pin.includes('150px'), false);
  assert.equal(html.includes('translate(150px, 0px)'), false);
  assert.deepEqual(memberPinIcon(), { iconSize: [42, 42], iconAnchor: [21, 21] });
  const screen = text('../components/family/StreetMap.tsx');
  assert.match(screen, /memberCalloutHtml/);
  assert.match(screen, /memberPinIcon/);
  const marker = screen.slice(screen.indexOf('const marker = L.marker([at.lat, at.lng]'), screen.indexOf("marker.on('click'"));
  assert.match(marker, /iconSize: pinIcon\.iconSize/);
  assert.match(marker, /iconAnchor: pinIcon\.iconAnchor/);
  assert.equal(marker.includes('iconSize: [0, 0]'), false);
  assert.equal(marker.includes('iconAnchor: [0, 0]'), false);
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
  assert.match(workflow, /1\.71\.0/);
});
