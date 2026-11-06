import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  applyMergeIdentity,
  canonicalWrapMembers,
  chooseCanonicalRoom,
  extraRoomDecision,
  inviteMintTarget,
  keptFamilyRoomCode,
  listFamilyRooms,
  mergePointTrails,
  mergeRecordLists,
  planFamilyRoomMerge,
  syncRooms,
} from './roomMerge.mjs';

const selfId = 'local-selfself';
const mom = 'local-mommmmm';
const dad = 'local-daddddd';

function member(id, extra) {
  return {
    id,
    name: extra.name || '가족',
    role: 'admin-share',
    lat: null,
    lng: null,
    accuracyM: 0,
    battery: null,
    charging: null,
    updatedAt: 0,
    moving: null,
    share: 'allowed',
    ...extra,
  };
}

test('the room this phone leads is canonical, otherwise the oldest room', () => {
  const rooms = listFamilyRooms({
    selfId,
    inviteCode: '55555',
    guardians: [
      { id: 'g-1700000001000', code: '44444', ownerMemberId: mom },
      { id: 'g-1700000002000', code: '33333', ownerMemberId: dad },
    ],
  });
  assert.equal(rooms.length, 3);
  assert.equal(chooseCanonicalRoom(selfId, rooms, [
    member('family:55555:local-mommmmm', { publisherId: mom, inviteCode: '55555', lat: 37.5, lng: 127.0 }),
  ]).code, '55555');

  const joinedOnly = listFamilyRooms({
    selfId,
    inviteCode: '55555',
    guardians: [{ id: 'g-1700000001000', code: '44444', ownerMemberId: mom }],
  });
  assert.equal(chooseCanonicalRoom(selfId, joinedOnly, [
    member('family:44444:local-mommmmm', { publisherId: mom, inviteCode: '44444', lat: 37.1, lng: 127.1 }),
  ]).code, '55555');

  const noLead = [
    { code: '20000', ownerId: mom, at: 50, own: false },
    { code: '10000', ownerId: dad, at: 10, own: false },
  ];
  assert.equal(chooseCanonicalRoom('', noLead, []).code, '10000');
});

test('merge keeps one card per person and does not drop a fix or a battery', () => {
  const plan = planFamilyRoomMerge({
    selfId,
    inviteCode: '55555',
    guardians: [{ id: 'g-1700000001000', code: '44444', ownerMemberId: mom, syncToken: 'write.readtokenvalue' }],
    members: [
      member('self', { role: 'self', name: '나' }),
      member('family:55555:local-mommmmm', {
        name: '엄마',
        publisherId: mom,
        inviteCode: '55555',
        lat: 37.51,
        lng: 127.02,
        accuracyM: 12,
        battery: null,
        updatedAt: 200,
      }),
      member('family:44444:local-mommmmm', {
        name: '엄마',
        publisherId: mom,
        inviteCode: '44444',
        lat: null,
        lng: null,
        battery: 81,
        charging: false,
        updatedAt: 120,
      }),
      member('family:44444:local-daddddd', {
        name: '아빠',
        publisherId: dad,
        inviteCode: '44444',
        lat: 37.2,
        lng: 127.2,
        battery: 40,
        updatedAt: 90,
      }),
    ],
  });
  assert.equal(plan.needed, true);
  assert.equal(plan.canonical.code, '55555');
  assert.equal(plan.canonical.own, true);
  assert.deepEqual(plan.droppedCodes, ['44444']);
  assert.equal(plan.guardians.length, 0);
  const ids = plan.members.map((item) => item.id).sort();
  assert.deepEqual(ids, ['family:55555:local-daddddd', 'family:55555:local-mommmmm', 'self']);
  const keptMom = plan.members.find((item) => item.publisherId === mom);
  assert.equal(keptMom.lat, 37.51);
  assert.equal(keptMom.lng, 127.02);
  assert.equal(keptMom.battery, 81);
  assert.equal(keptMom.inviteCode, '55555');
  const keptDad = plan.members.find((item) => item.publisherId === dad);
  assert.equal(keptDad.lat, 37.2);
  assert.equal(keptDad.battery, 40);
  assert.equal(plan.moves.some((move) => move.from === 'family:44444:local-mommmmm' && move.to === 'family:55555:local-mommmmm'), true);
});

test('a newer fix replaces the older one and both trails stay', () => {
  const plan = planFamilyRoomMerge({
    selfId,
    inviteCode: '55555',
    guardians: [{ id: 'g-10', code: '44444', ownerMemberId: mom }],
    members: [
      member('family:55555:local-mommmmm', { publisherId: mom, lat: 1, lng: 1, updatedAt: 10, battery: 10 }),
      member('family:44444:local-mommmmm', { publisherId: mom, lat: 2, lng: 3, updatedAt: 20, battery: 55, charging: true }),
    ],
  });
  const kept = plan.members[0];
  assert.equal(kept.lat, 2);
  assert.equal(kept.lng, 3);
  assert.equal(kept.battery, 55);
  assert.equal(kept.charging, true);
  const tracks = mergePointTrails(
    mergePointTrails({ 'family:55555:local-mommmmm': [{ lat: 1, lng: 1, at: 10 }] }, 'family:44444:local-mommmmm', 'family:55555:local-mommmmm'),
    'missing',
    'family:55555:local-mommmmm',
  );
  const withBoth = mergePointTrails(
    { 'family:55555:local-mommmmm': [{ lat: 1, lng: 1, at: 10 }], 'family:44444:local-mommmmm': [{ lat: 2, lng: 3, at: 20 }] },
    'family:44444:local-mommmmm',
    'family:55555:local-mommmmm',
  );
  assert.deepEqual(withBoth['family:55555:local-mommmmm'].map((point) => point.at), [10, 20]);
  assert.equal(withBoth['family:44444:local-mommmmm'], undefined);
  assert.equal(tracks['family:55555:local-mommmmm'].length, 1);
  const visits = mergeRecordLists(
    { a: [{ id: 'v1' }], b: [{ id: 'v2' }, { id: 'v1' }] },
    'b',
    'a',
  );
  assert.deepEqual(visits.a.map((item) => item.id), ['v1', 'v2']);
  assert.equal(visits.b, undefined);
});

test('after merge only the canonical room is polled and new invites stay there', () => {
  const open = syncRooms({
    inviteCode: '55555',
    guardians: [{ code: '44444', syncToken: 'aa.bb' }],
    familyRoomCode: '',
  });
  assert.deepEqual(open.codes, ['55555', '44444']);
  assert.equal(open.includeOwn, true);

  const locked = syncRooms({
    inviteCode: '55555',
    guardians: [{ code: '44444', syncToken: 'aa.bb' }, { code: '33333', syncToken: 'cc.dd' }],
    familyRoomCode: '55555',
  });
  assert.deepEqual(locked.codes, ['55555']);
  assert.equal(locked.includeOwn, true);
  assert.equal(locked.guardians.length, 0);

  const joined = syncRooms({
    inviteCode: '55555',
    guardians: [{ code: '44444', syncToken: 'aa.bb' }],
    familyRoomCode: '44444',
  });
  assert.equal(joined.includeOwn, false);
  assert.deepEqual(joined.codes, ['44444']);

  assert.equal(extraRoomDecision('', '44444'), 'allow');
  assert.equal(extraRoomDecision('55555', '55555'), 'same');
  assert.equal(extraRoomDecision('55555', '44444'), 'refuse');
  assert.deepEqual(inviteMintTarget({ inviteCode: '55555', familyRoomCode: '55555' }), { code: '55555', canMint: true });
  assert.deepEqual(inviteMintTarget({ inviteCode: '55555', familyRoomCode: '44444' }), { code: '44444', canMint: false });
  assert.deepEqual(inviteMintTarget({ inviteCode: '55555', familyRoomCode: '' }), { code: '55555', canMint: true });
});

test('the surviving room rewraps every current member who does not have the key yet', () => {
  const ids = canonicalWrapMembers(selfId, [
    member('family:55555:local-mommmmm', { publisherId: mom }),
    member('family:55555:local-daddddd', { publisherId: dad }),
  ], {
    pubs: {
      [selfId]: 'self-pub',
      [mom]: 'mom-pub',
      [dad]: 'dad-pub',
      'local-oldoldold': 'left-pub',
    },
    wraps: { [selfId]: { epk: 'a', iv: 'b', ct: 'c' } },
    revoked: [dad],
  });
  assert.deepEqual(ids, [mom]);
});

test('merge retargets hidden people and motion alerts onto the surviving card', () => {
  const plan = planFamilyRoomMerge({
    selfId,
    inviteCode: '55555',
    guardians: [{ id: 'g-1700000001000', code: '44444', ownerMemberId: mom }],
    members: [
      member('family:55555:local-mommmmm', { publisherId: mom, name: '엄마', lat: 1, lng: 2, updatedAt: 10 }),
      member('family:44444:local-mommmmm', { publisherId: mom, name: '엄마', lat: 3, lng: 4, updatedAt: 20 }),
      member('family:44444:local-daddddd', { publisherId: dad, name: '아빠', lat: 5, lng: 6, updatedAt: 20 }),
    ],
  });
  const hidden = applyMergeIdentity(plan, ['family:44444:local-daddddd'], ['family:44444:local-mommmmm']);
  assert.equal(hidden.members.some((item) => item.publisherId === dad), false);
  assert.equal(hidden.members.some((item) => item.publisherId === mom), true);
  assert.ok(hidden.hiddenMemberIds.includes('family:55555:local-daddddd'));
  assert.ok(hidden.hiddenMemberIds.includes('family:44444:local-daddddd'));
  assert.deepEqual(hidden.motionNotifyIds, ['family:55555:local-mommmmm']);
});

test('a restored account drops a room lock that is no longer one of its rooms', () => {
  assert.equal(keptFamilyRoomCode('55555', '99999', [{ code: '44444' }]), '');
  assert.equal(keptFamilyRoomCode('99999', '99999', []), '99999');
  assert.equal(keptFamilyRoomCode('44444', '99999', [{ code: '44444' }]), '44444');
  assert.equal(syncRooms({ inviteCode: '99999', guardians: [{ code: '44444' }], familyRoomCode: '' }).codes.length, 2);
});

test('the menu offers one admin merge and does not add a worker route', () => {
  const screen = readFileSync(new URL('../components/family/FamilyMapScreen.tsx', import.meta.url), 'utf8');
  const session = readFileSync(new URL('../components/family/session.tsx', import.meta.url), 'utf8');
  assert.match(screen, /가족 방 합치기/);
  assert.match(session, /merge-family-rooms/);
  assert.match(session, /planFamilyRoomMerge/);
  const worker = readFileSync(new URL('../../sync/worker.mjs', import.meta.url), 'utf8');
  assert.equal(worker.includes('merge-rooms'), false);
});
