import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  SAME_PLACE_METERS,
  STATUS_LIFT_PX,
  distanceMeters,
  firstPlaceLabel,
  groupMembersByPlace,
  groupPinShiftY,
  groupStatusLabelHtml,
  orderStatusMembers,
  statusCalloutHtml,
} from './memberStatusGroup.mjs';

function pointEast(origin, meters) {
  const rough = meters / (111_320 * Math.cos((origin.lat * Math.PI) / 180));
  let lng = origin.lng + rough;
  for (let step = 0; step < 8; step += 1) {
    const got = distanceMeters(origin, { lat: origin.lat, lng });
    if (!(got > 0)) break;
    lng = origin.lng + (lng - origin.lng) * (meters / got);
  }
  return { lat: origin.lat, lng };
}

function pointEastAtMost(origin, meters) {
  let point = pointEast(origin, meters);
  let guard = 0;
  while (distanceMeters(origin, point) > meters && guard < 12) {
    point = { lat: point.lat, lng: origin.lng + (point.lng - origin.lng) * 0.999 };
    guard += 1;
  }
  return point;
}

function pointEastBeyond(origin, meters) {
  let point = pointEast(origin, meters + 0.2);
  let guard = 0;
  while (distanceMeters(origin, point) <= meters && guard < 12) {
    point = { lat: point.lat, lng: origin.lng + (point.lng - origin.lng) * 1.002 };
    guard += 1;
  }
  return point;
}

function idsOf(groups) {
  return groups.map((group) => group.ordered.map((member) => member.id));
}

test('the same-place distance is 50m', () => {
  assert.equal(SAME_PLACE_METERS, 50);
});

test('members within 50m share one status group and members outside stay apart', () => {
  const self = { id: 'self', role: 'self', name: '나', lat: 37.6372, lng: 127.07 };
  const near = { id: 'mom', name: '엄마', ...pointEastAtMost(self, 49) };
  const edge = { id: 'dad', name: '아빠', ...pointEastAtMost(self, SAME_PLACE_METERS) };
  const far = { id: 'khoon', name: 'Khoon', ...pointEastBeyond(self, SAME_PLACE_METERS) };
  assert.ok(distanceMeters(self, near) <= SAME_PLACE_METERS);
  assert.ok(distanceMeters(self, edge) <= SAME_PLACE_METERS);
  assert.ok(distanceMeters(self, far) > SAME_PLACE_METERS);

  const inside = groupMembersByPlace([self, near]);
  assert.equal(inside.length, 1);
  assert.deepEqual(inside[0].ordered.map((member) => member.id), ['self', 'mom']);

  const onEdge = groupMembersByPlace([self, edge]);
  assert.equal(onEdge.length, 1);
  assert.deepEqual(onEdge[0].members.map((member) => member.id).sort(), ['dad', 'self']);

  const outside = groupMembersByPlace([self, far]);
  assert.equal(outside.length, 2);
  assert.deepEqual(outside.map((group) => group.members.map((member) => member.id)), [['self'], ['khoon']]);

  const sameNameFar = groupMembersByPlace([
    { ...self, place: '하계청구아파트' },
    { ...far, place: '하계청구아파트' },
  ]);
  assert.equal(sameNameFar.length, 2);
});

test('a three person chain within 50m of the next person is one group', () => {
  const ann = { id: 'ann', name: '엄마', lat: 37.55, lng: 127.02 };
  const bo = { id: 'bo', name: '아빠', ...pointEast(ann, 40) };
  const cy = { id: 'cy', name: '코기', ...pointEast(bo, 40) };
  assert.ok(distanceMeters(ann, bo) <= SAME_PLACE_METERS);
  assert.ok(distanceMeters(bo, cy) <= SAME_PLACE_METERS);
  assert.ok(distanceMeters(ann, cy) > SAME_PLACE_METERS);
  const groups = groupMembersByPlace([cy, ann, bo]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ordered.map((member) => member.id), ['cy', 'ann', 'bo']);
  assert.equal(groups[0].members.length, 3);
  const lat = (ann.lat + bo.lat + cy.lat) / 3;
  const lng = (ann.lng + bo.lng + cy.lng) / 3;
  assert.ok(Math.abs(groups[0].anchor.lat - lat) < 1e-9);
  assert.ok(Math.abs(groups[0].anchor.lng - lng) < 1e-9);
});

test('a member standing alone is their own group', () => {
  const groups = groupMembersByPlace([
    { id: 'self', role: 'self', name: '나', lat: 37.6, lng: 127.01 },
    { id: 'waiting', name: '엄마', lat: null, lng: null },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(idsOf(groups), [['self']]);
  assert.equal(groups[0].anchor.lat, 37.6);
  assert.equal(groups[0].anchor.lng, 127.01);
  assert.equal(groups[0].anchorId, 'self');
  assert.deepEqual(groupMembersByPlace([]), []);
});

test('status order puts me first and keeps everyone else in roster order', () => {
  const ordered = orderStatusMembers([
    { id: 'khoon', name: 'Khoon' },
    { id: 'mom', name: '엄마' },
    { id: 'device-1', role: 'self', name: '부건' },
    { id: 'dad', name: '아빠' },
  ]);
  assert.deepEqual(ordered.map((member) => member.id), ['device-1', 'khoon', 'mom', 'dad']);
  const place = firstPlaceLabel(ordered, (member) => (member.id === 'mom' ? '하계청구아파트' : ''));
  assert.equal(place, '하계청구아파트');
  assert.equal(firstPlaceLabel([{ id: 'self', role: 'self' }, { id: 'mom' }], () => ''), '');
});

test('the merged status marker uses the same overflow override as pins', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
  assert.match(css, /\.umap-member-status,/);
  assert.match(css, /\.leaflet-marker-icon\.umap-member-status,/);
  assert.match(css, /overflow: visible !important/);
});

test('the merged chip is lifted above the group center on a leader', () => {
  const html = statusCalloutHtml('<span data-label>나</span>');
  assert.match(html, /data-pin-leader/);
  assert.match(html, new RegExp(`width:${STATUS_LIFT_PX}px`));
  assert.match(html, /rotate\(-90deg\)/);
  assert.match(html, /data-label-tail/);
  assert.ok(STATUS_LIFT_PX >= 42);
  assert.equal(groupPinShiftY(42), -(STATUS_LIFT_PX - 21));
});

test('a merged chip shows the place once and one name line each', () => {
  const html = groupStatusLabelHtml({
    place: '하계청구아파트',
    rows: [
      { id: 'self', name: '나', batteryHtml: '<span>27%</span>' },
      { id: 'mom', name: '엄마', batteryHtml: '<span>52%</span>' },
      { id: 'khoon', name: 'Khoon', batteryHtml: '<span>65%</span>', age: '3분 전', dimmed: true },
    ],
  });
  assert.equal((html.match(/data-place/g) || []).length, 1);
  assert.equal((html.match(/data-member-row/g) || []).length, 3);
  assert.ok(html.indexOf('하계청구아파트') < html.indexOf('data-name'));
  const names = [...html.matchAll(/data-name[^>]*>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(names, ['나', '엄마', 'Khoon']);
  assert.match(html, /27%/);
  assert.match(html, /52%/);
  assert.match(html, /65%/);
  assert.match(html, /3분 전/);
  assert.match(html, /data-member-id="khoon"[^>]*opacity:0\.55/);
  const bare = groupStatusLabelHtml({ rows: [{ id: 'self', name: '나<script>', batteryHtml: '' }] });
  assert.equal(bare.includes('data-place'), false);
  assert.match(bare, /나&lt;script&gt;/);
});
