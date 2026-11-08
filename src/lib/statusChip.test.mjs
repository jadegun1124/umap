import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batteryText,
  groupMembersByPlace,
  groupStatusHtml,
  orderStatusMembers,
  representativePlace,
  statusPaintKey,
} from './statusChip.mjs';

function east(lat, lng, meters) {
  return lng + meters / (111320 * Math.cos((lat * Math.PI) / 180));
}

function person(id, name, lat, lng, extra = {}) {
  return { id, name, role: id === 'self' ? 'self' : 'guardian', lat, lng, battery: 10, place: '', ...extra };
}

test('people within 50m share a group and 51m stays apart', () => {
  const lat = 37.6372;
  const lng = 127.07085;
  const near = [
    person('self', '부건', lat, lng),
    person('mom', '엄마', lat, east(lat, lng, 49)),
    person('khoon', 'Khoon', lat, east(lat, lng, 20), { battery: 65 }),
  ];
  const far = person('uncle', '삼촌', lat, east(lat, lng, 120));
  const groups = groupMembersByPlace([...near, far]);
  const sizes = groups.map((group) => group.length).sort((a, b) => b - a);
  assert.deepEqual(sizes, [3, 1]);
  const together = groups.find((group) => group.length === 3);
  assert.deepEqual(together.map((member) => member.id).sort(), ['khoon', 'mom', 'self']);
  assert.equal(groupMembersByPlace([near[0], far]).every((group) => group.length === 1), true);
  const edge = person('edge', '경계', lat, east(lat, lng, 51));
  assert.equal(groupMembersByPlace([near[0], edge]).length, 2);
});

test('the self row is first and everyone else keeps the given order', () => {
  const ordered = orderStatusMembers([
    person('mom', '엄마', 1, 1),
    person('khoon', 'Khoon', 1, 1),
    person('self', '부건', 1, 1),
  ]);
  assert.deepEqual(ordered.map((member) => member.id), ['self', 'mom', 'khoon']);
});

test('the place name is chosen once', () => {
  const shared = [
    person('mom', '엄마', 1, 1, { place: '하계청구아파트' }),
    person('self', '부건', 1, 1, { place: '하계청구아파트' }),
  ];
  assert.equal(representativePlace(shared, (member) => member.place), '하계청구아파트');
  const mixed = [
    person('mom', '엄마', 1, 1, { place: '상계동' }),
    person('self', '부건', 1, 1, { place: '하계청구아파트' }),
  ];
  assert.equal(representativePlace(mixed, (member) => member.place), '하계청구아파트');
  const onlyOther = [
    person('mom', '엄마', 1, 1, { place: '상계동' }),
    person('khoon', 'Khoon', 1, 1, { place: '' }),
  ];
  assert.equal(representativePlace(onlyOther, (member) => member.place), '상계동');
  assert.equal(representativePlace([person('self', '부건', 1, 1, { place: '근처' })], (member) => member.place), '');
});

test('a merged chip lists the place once and a dash when battery is missing', () => {
  const html = groupStatusHtml([
    person('mom', '엄마', 1, 1, { battery: 52 }),
    person('khoon', 'Khoon', 1, 1, { battery: null }),
    person('self', '부건', 1, 1, { battery: 27 }),
  ], '하계청구아파트');
  assert.equal((html.match(/data-place/g) || []).length, 1);
  assert.match(html, /하계청구아파트/);
  assert.equal(html.includes('box-shadow'), false);
  assert.equal(html.includes('backdrop-filter'), false);
  assert.match(html, /pointer-events:none/);
  const names = [...html.matchAll(/data-name>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(names, ['나', '엄마', 'Khoon']);
  assert.match(html, /27%/);
  assert.match(html, /52%/);
  assert.match(html, /—/);
  assert.equal(batteryText({ battery: null }), '—');
  assert.equal(batteryText({ battery: 27.4 }), '27%');
});

test('the same coordinates and battery skip a repaint', () => {
  const members = [
    person('self', '부건', 37.1, 127.1, { battery: 27, place: '하계청구아파트' }),
    person('mom', '엄마', 37.1, 127.1, { battery: 52, place: '하계청구아파트' }),
  ];
  const again = members.map((member) => ({ ...member }));
  assert.equal(statusPaintKey(members, 'self'), statusPaintKey(again, 'self'));
  again[1] = { ...again[1], battery: 53 };
  assert.notEqual(statusPaintKey(members, 'self'), statusPaintKey(again, 'self'));
  const now = 1_700_000_000_000;
  const stamped = members.map((member) => ({ ...member, updatedAt: now, charging: false }));
  assert.equal(statusPaintKey(stamped, 'self', now), statusPaintKey(stamped.map((member) => ({ ...member })), 'self', now));
  assert.notEqual(statusPaintKey(stamped, 'self', now), statusPaintKey(stamped.map((member, index) => (index === 0 ? { ...member, charging: true } : member)), 'self', now));
  assert.notEqual(statusPaintKey(stamped, 'self', now), statusPaintKey(stamped.map((member, index) => (index === 0 ? { ...member, photo: 'data:image/png;base64,abc' } : member)), 'self', now));
  assert.notEqual(statusPaintKey(stamped, 'self', now), statusPaintKey(stamped, 'self', now + 10 * 60_000));
});
