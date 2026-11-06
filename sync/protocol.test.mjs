import assert from 'node:assert/strict';
import test from 'node:test';
import { startSyncServer } from './dev-server.mjs';
import { bytesToBase64Url } from './webpush.mjs';
import {
  alertPushPayload,
  applyPlace,
  chatPushPayload,
  createMemoryStore,
  departedMemberIds,
  emptyRoom,
  viewFamilyPlaces,
  handleSyncRequest,
  pushesForAlert,
  pushesForChat,
  randomKey,
  roomToken,
  sha256Base64Url,
  syncTokenFor,
  withCors,
} from './protocol.mjs';

/** Phone checks ignore clock fields. An epoch like 1793250105000 contains "010". */
function publicJson(value) {
  return JSON.stringify(value, (key, item) => (key === 'at' ? undefined : item));
}

async function call(store, method, path, { token, readKey, profileKey, member, body, raw } = {}) {
  const headers = new Headers();
  if (token) headers.set('x-umap-sync-key', token);
  if (readKey) headers.set('x-umap-read-key', readKey);
  if (profileKey) headers.set('x-umap-profile-key', profileKey);
  if (member) headers.set('x-umap-member', member);
  if (body !== undefined || raw !== undefined) headers.set('content-type', 'application/json');
  const request = new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleSyncRequest(store, request);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('hash vector stays stable for the client copy', async () => {
  assert.equal(await sha256Base64Url('umap-read-key'), 'BL04F54qEIA94kVM3un2L2ITH4kcV-H8m2JJNnuuHVQ');
});

test('managed publish is visible only to the admin read key, and revoke clears coordinates', async () => {
  const store = createMemoryStore();
  const code = '48291';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const place = {
    code,
    name: '하나',
    lat: 37.64,
    lng: 127.07,
    accuracyM: 12,
    at: Date.now(),
    sharing: true,
    phone: '01012345678',
  };

  const published = await call(store, 'PUT', `/v1/rooms/${code}/place`, { token, body: place });
  assert.equal(published.status, 200);
  assert.deepEqual(published.body, { ok: true });

  const hidden = await call(store, 'GET', `/v1/rooms/${code}`, { token });
  assert.equal(hidden.status, 403);

  const wrongRead = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey: randomKey() });
  assert.equal(wrongRead.status, 403);

  const other = await call(store, 'GET', `/v1/rooms/${code}`, {
    token: await syncTokenFor(randomKey(), readKey),
    readKey,
  });
  assert.equal(other.status, 200);
  assert.deepEqual(other.body.places, []);

  const visible = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(visible.status, 200);
  assert.equal(visible.body.places.length, 1);
  assert.equal(visible.body.places[0].name, '하나');
  assert.equal(visible.body.places[0].lat, 37.64);
  assert.equal(publicJson(visible.body).includes('010'), false);
  assert.equal(visible.body.places[0].phone, undefined);

  const revoked = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: { ...place, lat: 37.64, lng: 127.07, sharing: false, at: place.at + 1000, phone: '01099998888' },
  });
  assert.equal(revoked.status, 200);
  const after = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(after.body.places[0].sharing, false);
  assert.equal(after.body.places[0].lat, null);
  assert.equal(after.body.places[0].lng, null);

  const stale = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: { code, name: '하나', lat: 37.1, lng: 127.1, accuracyM: 8, at: place.at + 500, sharing: true },
  });
  assert.equal(stale.status, 200);
  const stillRevoked = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(stillRevoked.body.places[0].sharing, false);
  assert.equal(stillRevoked.body.places[0].lat, null);
});

test('two names stay in one room and alerts reach only the reader', async () => {
  const store = createMemoryStore();
  const code = '12045';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const now = Date.now();
  for (const name of ['하나', '두리']) {
    const response = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
      token,
      body: { code, name, lat: 37.5, lng: 127.0, accuracyM: 20, at: now, sharing: true },
    });
    assert.equal(response.status, 200);
  }
  const alert = await call(store, 'POST', `/v1/rooms/${code}/alert`, {
    token,
    body: {
      id: 'a-leave-10000001',
      kind: 'leave',
      code,
      from: '하나',
      body: '하나 님이 우리 집 반경 200m 밖으로 나갔습니다.',
      at: now + 10,
      phone: '01000000000',
    },
  });
  assert.equal(alert.status, 200);

  const reader = await call(store, 'GET', `/v1/rooms/${code}?since=${now}`, { token, readKey });
  assert.equal(reader.body.places.length, 2);
  assert.equal(reader.body.alerts.length, 1);
  assert.equal(reader.body.alerts[0].kind, 'leave');
  assert.equal(reader.body.alerts[0].phone, undefined);

  const again = await call(store, 'GET', `/v1/rooms/${code}?since=${now + 10}`, { token, readKey });
  assert.equal(again.body.alerts.length, 0);
  assert.equal(again.body.places.length, 2);
});

test('missing sync key and bad coordinates are rejected', async () => {
  const store = createMemoryStore();
  const missing = await call(store, 'PUT', '/v1/rooms/12345/place', {
    body: { code: '12345', name: '하나', lat: 1, lng: 1, accuracyM: 1, at: Date.now(), sharing: true },
  });
  assert.equal(missing.status, 401);

  const token = await syncTokenFor(randomKey(), randomKey());
  const bad = await call(store, 'PUT', '/v1/rooms/12345/place', {
    token,
    body: { code: '12345', name: '하나', lat: 120, lng: 10, accuracyM: 1, at: Date.now(), sharing: true },
  });
  assert.equal(bad.status, 400);
});

test('health and dev server move a place between two clients', async () => {
  const store = createMemoryStore();
  const health = await call(store, 'GET', '/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.service, 'umap-family-sync');

  const cors = withCors(new Response(null, { status: 204 }));
  assert.equal(cors.headers.get('access-control-allow-origin'), '*');
  assert.match(cors.headers.get('access-control-allow-headers') || '', /x-umap-read-key/);

  const server = await startSyncServer(0);
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const probed = await fetch(`${base}/health`);
    assert.equal((await probed.json()).ok, true);

    const writeKey = randomKey();
    const readKey = randomKey();
    const token = await syncTokenFor(writeKey, readKey);
    const code = '55501';
    const put = await fetch(`${base}/v1/rooms/${code}/place`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-umap-sync-key': token },
      body: JSON.stringify({
        code,
        name: '하나',
        lat: 37.6412,
        lng: 127.0711,
        accuracyM: 9,
        at: Date.now(),
        sharing: true,
      }),
    });
    assert.equal(put.status, 200);

    const got = await fetch(`${base}/v1/rooms/${code}`, {
      headers: { 'x-umap-sync-key': token, 'x-umap-read-key': readKey },
    });
    const payload = await got.json();
    assert.equal(payload.places[0].lat, 37.6412);

    const revoke = await fetch(`${base}/v1/rooms/${code}/place`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-umap-sync-key': token },
      body: JSON.stringify({
        code,
        name: '하나',
        lat: 37.6412,
        lng: 127.0711,
        accuracyM: 9,
        at: Date.now() + 5,
        sharing: false,
      }),
    });
    assert.equal(revoke.status, 200);
    const cleared = await fetch(`${base}/v1/rooms/${code}`, {
      headers: { 'x-umap-sync-key': token, 'x-umap-read-key': readKey },
    });
    const after = await cleared.json();
    assert.equal(after.places[0].sharing, false);
    assert.equal(after.places[0].lat, null);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test('a previous-version plaintext place is accepted and shown to the family', async () => {
  const store = createMemoryStore();
  const code = '39001';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const at = Date.now();
  const previous = {
    code,
    name: '쿤',
    lat: 37.6314,
    lng: 127.0651,
    accuracyM: 18,
    at,
    sharing: true,
    audience: 'family',
    batteryPct: 93,
    charging: false,
  };
  const published = await call(store, 'PUT', `/v1/rooms/${code}/place`, { token, body: previous });
  assert.equal(published.status, 200);
  const seen = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(seen.status, 200);
  const place = seen.body.places.find((item) => item.name === '쿤');
  assert.ok(place);
  assert.equal(place.lat, previous.lat);
  assert.equal(place.lng, previous.lng);
  assert.equal(place.at, at);
  assert.equal(place.seal, undefined);
});

test('same coordinates with a newer timestamp refresh the day, and an older replay does not', () => {
  const room = emptyRoom();
  const yesterday = Date.UTC(2026, 9, 26, 10, 0);
  const today = Date.UTC(2026, 9, 27, 1, 0);
  const first = applyPlace(room, {
    code: '10001',
    name: '하나',
    lat: 37.5,
    lng: 127,
    accuracyM: 8,
    at: yesterday,
    sharing: true,
    batteryPct: 70,
    charging: false,
    audience: 'admin',
  });
  const replay = applyPlace(first.room, {
    code: '10001',
    name: '하나',
    lat: 37.5,
    lng: 127,
    accuracyM: 8,
    at: yesterday,
    sharing: true,
    batteryPct: 70,
    charging: false,
    audience: 'admin',
  });
  assert.equal(replay.ignored, true);
  const refreshed = applyPlace(first.room, {
    code: '10001',
    name: '하나',
    lat: 37.5,
    lng: 127,
    accuracyM: 9,
    at: today,
    sharing: true,
    batteryPct: 40,
    charging: true,
    audience: 'admin',
  });
  assert.equal(refreshed.ignored, false);
  assert.equal(refreshed.room.places['하나'].at, today);
  assert.equal(refreshed.room.places['하나'].batteryPct, 40);
  assert.equal(refreshed.room.places['하나'].charging, true);
  const stale = applyPlace(refreshed.room, {
    code: '10001',
    name: '하나',
    lat: 37.6,
    lng: 127.1,
    accuracyM: 8,
    at: yesterday,
    sharing: true,
    audience: 'admin',
  });
  assert.equal(stale.ignored, true);
  assert.equal(stale.room.places['하나'].at, today);
  assert.equal(stale.room.places['하나'].lat, 37.5);
});

test('alert cursor does not hide places, and family share stays behind the write key', async () => {
  const store = createMemoryStore();
  const code = '24680';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const at = Date.now();
  const child = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: {
      code,
      name: '하나',
      lat: 37.1,
      lng: 127.1,
      accuracyM: 6,
      at,
      sharing: true,
      batteryPct: 88,
      charging: false,
      phone: '01011112222',
    },
  });
  assert.equal(child.status, 200);
  const admin = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: {
      code,
      name: '하나',
      lat: 37.2,
      lng: 127.2,
      accuracyM: 5,
      at: at + 5,
      sharing: true,
      audience: 'family',
      batteryPct: 55,
      charging: true,
    },
  });
  assert.equal(admin.status, 200);

  const reader = await call(store, 'GET', `/v1/rooms/${code}?since=${at + 5}`, { token, readKey });
  assert.equal(reader.status, 200);
  assert.equal(reader.body.places.length, 2);
  assert.equal(reader.body.alerts.length, 0);
  const childPlace = reader.body.places.find((place) => place.audience !== 'family');
  const familyPlace = reader.body.places.find((place) => place.audience === 'family');
  assert.equal(childPlace.lat, 37.1);
  assert.equal(childPlace.batteryPct, 88);
  assert.equal(childPlace.phone, undefined);
  assert.equal(familyPlace.lat, 37.2);
  assert.equal(familyPlace.charging, true);

  const hidden = await call(store, 'GET', `/v1/rooms/${code}/family`);
  assert.equal(hidden.status, 401);
  const managed = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.equal(managed.status, 200);
  assert.equal(managed.body.places.length, 1);
  assert.equal(managed.body.places[0].audience, 'family');
  assert.equal(managed.body.places[0].name, '하나');
  assert.equal(JSON.stringify(managed.body).includes('37.1'), false);

  const stopped = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: { code, name: '하나', lat: null, lng: null, accuracyM: 0, at: at + 10, sharing: false, audience: 'family' },
  });
  assert.equal(stopped.status, 200);
  const after = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.deepEqual(after.body.places, []);
  assert.deepEqual(after.body.departed, []);
  const childStill = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(childStill.body.places.find((place) => place.audience !== 'family').lat, 37.1);
});

test('a family leave with a member id is departed immediately', async () => {
  const store = createMemoryStore();
  const code = '48291';
  const token = await syncTokenFor(randomKey(), randomKey());
  const profileKey = randomKey();
  const memberId = 'local-leave1';
  const at = Date.now();
  const live = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: {
      code,
      name: '민지',
      memberId,
      lat: 37.63,
      lng: 127.06,
      accuracyM: 8,
      at,
      sharing: true,
      audience: 'family',
    },
  });
  assert.equal(live.status, 200);
  const sharing = await call(store, 'GET', `/v1/rooms/${code}/family`, { token, profileKey, member: memberId });
  assert.equal(sharing.body.places.length, 1);
  assert.deepEqual(sharing.body.departed, []);
  const left = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: { code, name: '민지', memberId, lat: null, lng: null, accuracyM: 0, at: at + 10, sharing: false, audience: 'family' },
  });
  assert.equal(left.status, 200);
  const after = await call(store, 'GET', `/v1/rooms/${code}/family`, { token, profileKey, member: memberId });
  assert.deepEqual(after.body.places, []);
  assert.deepEqual(after.body.departed, [memberId]);
});

test('a stale sharing-false alias does not mark a live member departed', () => {
  const room = emptyRoom();
  const memberId = 'local-live1';
  const live = {
    code: '48291',
    name: '민지',
    memberId,
    lat: 37.63,
    lng: 127.06,
    accuracyM: 8,
    at: 2_000,
    sharing: true,
    audience: 'family',
  };
  const stale = {
    code: '48291',
    name: '민지',
    memberId,
    lat: null,
    lng: null,
    accuracyM: 0,
    at: 1_000,
    sharing: false,
    audience: 'family',
  };
  const withLive = applyPlace(room, live).room;
  const withAlias = {
    ...withLive,
    places: {
      ...withLive.places,
      'family\u0000민지': stale,
    },
  };
  assert.deepEqual(departedMemberIds(withAlias, 'family'), []);
  const onlyStop = applyPlace(emptyRoom(), { ...stale, at: 3_000 }).room;
  assert.deepEqual(departedMemberIds(onlyStop, 'family'), [memberId]);
  const adminStop = applyPlace(withLive, {
    ...stale,
    audience: 'admin',
    at: 3_000,
    sharing: false,
  }).room;
  assert.deepEqual(departedMemberIds(adminStop, 'family'), []);
});

test('bad battery and audience are rejected', async () => {
  const store = createMemoryStore();
  const token = await syncTokenFor(randomKey(), randomKey());
  const battery = await call(store, 'PUT', '/v1/rooms/33333/place', {
    token,
    body: { code: '33333', name: '하나', lat: 37, lng: 127, accuracyM: 4, at: Date.now(), sharing: true, batteryPct: 140 },
  });
  assert.equal(battery.status, 400);
  const audience = await call(store, 'PUT', '/v1/rooms/33333/place', {
    token,
    body: { code: '33333', name: '하나', lat: 37, lng: 127, accuracyM: 4, at: Date.now(), sharing: true, audience: 'world' },
  });
  assert.equal(audience.status, 400);
});

test('older sharing change at the same timestamp is kept when the flag flips', () => {
  const room = emptyRoom();
  const first = applyPlace(room, {
    code: '10001',
    name: '하나',
    lat: 37,
    lng: 127,
    accuracyM: 5,
    at: 1_800_000_000_000,
    sharing: true,
  });
  const revoke = applyPlace(first.room, {
    code: '10001',
    name: '하나',
    lat: null,
    lng: null,
    accuracyM: 0,
    at: 1_800_000_000_000,
    sharing: false,
  });
  assert.equal(revoke.ignored, false);
  assert.equal(revoke.room.places['하나'].sharing, false);
});

test('a live fix survives an empty heartbeat, replaces a newer placeholder, and keeps battery', () => {
  const now = Date.UTC(2026, 9, 27, 3, 0);
  const first = applyPlace(emptyRoom(), {
    code: '10001',
    name: '하나',
    lat: 37.5,
    lng: 127,
    accuracyM: 8,
    at: now,
    sharing: true,
    batteryPct: 70,
    charging: false,
    audience: 'admin',
  });
  const heartbeat = applyPlace(first.room, {
    code: '10001',
    name: '하나',
    lat: null,
    lng: null,
    accuracyM: 0,
    at: now + 60_000,
    sharing: true,
    audience: 'admin',
  });
  assert.equal(heartbeat.ignored, true);
  assert.equal(heartbeat.room.places['하나'].lat, 37.5);
  assert.equal(heartbeat.room.places['하나'].batteryPct, 70);
  assert.equal(heartbeat.room.places['하나'].at, now);

  const placeholder = applyPlace(emptyRoom(), {
    code: '10001',
    name: '하나',
    lat: null,
    lng: null,
    accuracyM: 0,
    at: now + 60_000,
    sharing: true,
    audience: 'admin',
  });
  const fix = applyPlace(placeholder.room, {
    code: '10001',
    name: '하나',
    lat: 37.2,
    lng: 127.2,
    accuracyM: 9,
    at: now,
    sharing: true,
    batteryPct: 41,
    charging: true,
    audience: 'admin',
  });
  assert.equal(fix.ignored, false);
  assert.equal(fix.room.places['하나'].lat, 37.2);
  assert.equal(fix.room.places['하나'].batteryPct, 41);

  const moved = applyPlace(fix.room, {
    code: '10001',
    name: '하나',
    lat: 37.3,
    lng: 127.3,
    accuracyM: 7,
    at: now + 120_000,
    sharing: true,
    audience: 'admin',
  });
  assert.equal(moved.room.places['하나'].lat, 37.3);
  assert.equal(moved.room.places['하나'].batteryPct, 41);
  assert.equal(moved.room.places['하나'].charging, true);

  const revoked = applyPlace(moved.room, {
    code: '10001',
    name: '하나',
    lat: null,
    lng: null,
    accuracyM: 0,
    at: now + 180_000,
    sharing: false,
    audience: 'admin',
  });
  assert.equal(revoked.room.places['하나'].sharing, false);
  assert.equal(revoked.room.places['하나'].lat, null);
});

test('SOS push subscription is kept for the admin reader and hidden from the room view', async () => {
  const store = createMemoryStore();
  const code = '13579';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const key = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/umap-test-device',
    p256dh: bytesToBase64Url(publicRaw),
    auth: bytesToBase64Url(auth),
    phone: '01012345678',
  };
  const denied = await call(store, 'PUT', `/v1/rooms/${code}/push`, { token, body: subscription });
  assert.equal(denied.status, 403);
  const saved = await call(store, 'PUT', `/v1/rooms/${code}/push`, { token, readKey, body: subscription });
  assert.equal(saved.status, 200);
  const local = await call(store, 'PUT', `/v1/rooms/${code}/push`, {
    token,
    readKey,
    body: { ...subscription, endpoint: 'https://127.0.0.1/push' },
  });
  assert.equal(local.status, 400);

  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(JSON.stringify(reader.body).includes('fcm.googleapis.com'), false);
  assert.equal(publicJson(reader.body).includes('010'), false);
  const id = await roomToken(code, writeKey, token.split('.')[1]);
  const room = await store.read(id);
  assert.equal(room.pushes.length, 1);
  assert.equal(room.pushes[0].phone, undefined);
  assert.equal(room.pushes[0].endpoint, subscription.endpoint);
});

test('direct messages stay on the pair and off the family view', async () => {
  const store = createMemoryStore();
  const code = '48291';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const message = { id: 'chatmsg01', from: '엄마', to: '하나', text: '집 근처예요', at: Date.now() };
  const posted = await call(store, 'POST', `/v1/rooms/${code}/chat`, { token, body: message });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.messages.length, 1);
  assert.equal(posted.body.messages[0].text, '집 근처예요');

  const other = { id: 'chatmsg03', from: '엄마', to: '둘', text: '둘만 봐요', at: Date.now() };
  const postedOther = await call(store, 'POST', `/v1/rooms/${code}/chat`, { token, body: other });
  assert.equal(postedOther.status, 200);

  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(reader.body.messages, undefined);
  assert.equal(JSON.stringify(reader.body).includes('집 근처예요'), false);
  assert.equal(JSON.stringify(reader.body).includes('둘만 봐요'), false);
  assert.equal(JSON.stringify(reader.body).includes('writeKey'), false);

  const family = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.equal(family.body.messages, undefined);
  assert.equal(JSON.stringify(family.body).includes('집 근처예요'), false);

  const open = await call(store, 'GET', `/v1/rooms/${code}/chat`, { token });
  assert.equal(open.status, 400);

  const pair = await call(store, 'GET', `/v1/rooms/${code}/chat?me=${encodeURIComponent('하나')}&with=${encodeURIComponent('엄마')}`, { token });
  assert.equal(pair.status, 200);
  assert.equal(pair.body.messages.length, 1);
  assert.equal(pair.body.messages[0].from, '엄마');
  assert.equal(JSON.stringify(pair.body).includes('둘만 봐요'), false);

  const sibling = await call(store, 'GET', `/v1/rooms/${code}/chat?me=${encodeURIComponent('둘')}&with=${encodeURIComponent('엄마')}`, { token });
  assert.equal(sibling.body.messages.length, 1);
  assert.equal(sibling.body.messages[0].text, '둘만 봐요');
  assert.equal(JSON.stringify(sibling.body).includes('집 근처예요'), false);

  const mine = await call(store, 'GET', `/v1/rooms/${code}/chat?me=${encodeURIComponent('엄마')}`, { token });
  assert.equal(mine.body.threads.length, 2);
  assert.deepEqual(mine.body.threads.map((thread) => thread.peer).sort(), ['둘', '하나']);

  const stranger = await call(store, 'GET', `/v1/rooms/${code}/chat?me=${encodeURIComponent('셋')}`, { token });
  assert.equal(stranger.body.threads.length, 0);

  const phone = await call(store, 'POST', `/v1/rooms/${code}/chat`, {
    token,
    body: { id: 'chatmsg02', from: '엄마', to: '하나', text: '01012345678', at: Date.now() },
  });
  assert.equal(phone.status, 400);
  const selfNote = await call(store, 'POST', `/v1/rooms/${code}/chat`, {
    token,
    body: { id: 'chatmsg04', from: '엄마', to: '엄마', text: '나에게', at: Date.now() },
  });
  assert.equal(selfNote.status, 400);
  const legacy = await call(store, 'POST', `/v1/rooms/${code}/chat`, {
    token,
    body: { id: 'chatmsg05', name: '하나', text: '예전 전체 대화', at: Date.now() },
  });
  assert.equal(legacy.status, 400);
  const again = await call(store, 'POST', `/v1/rooms/${code}/chat`, { token, body: message });
  assert.equal(again.status, 200);
  const once = await call(store, 'GET', `/v1/rooms/${code}/chat?me=${encodeURIComponent('엄마')}&with=${encodeURIComponent('하나')}`, { token });
  assert.equal(once.body.messages.length, 1);
});

test('chat push names the recipient and hides the endpoint', async () => {
  const store = createMemoryStore();
  const code = '24680';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const key = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const base = {
    p256dh: bytesToBase64Url(publicRaw),
    auth: bytesToBase64Url(auth),
  };
  const child = {
    ...base,
    endpoint: 'https://fcm.googleapis.com/fcm/send/umap-child',
    name: '하나',
  };
  const savedChild = await call(store, 'PUT', `/v1/rooms/${code}/push`, { token, body: child });
  assert.equal(savedChild.status, 200);
  const phoneName = await call(store, 'PUT', `/v1/rooms/${code}/push`, {
    token,
    body: { ...child, endpoint: 'https://fcm.googleapis.com/fcm/send/umap-phone', name: '01012345678' },
  });
  assert.equal(phoneName.status, 403);
  const parent = {
    ...base,
    endpoint: 'https://fcm.googleapis.com/fcm/send/umap-parent',
    name: '엄마',
  };
  const savedParent = await call(store, 'PUT', `/v1/rooms/${code}/push`, { token, readKey, body: parent });
  assert.equal(savedParent.status, 200);

  const id = await roomToken(code, writeKey, token.split('.')[1]);
  const room = await store.read(id);
  assert.equal(room.pushes.length, 2);
  assert.equal(room.pushes.find((item) => item.name === '하나').endpoint.includes('umap-child'), true);
  assert.equal(room.pushes.some((item) => item.phone), false);

  const message = { id: 'chatpush01', from: '엄마', to: '하나', text: '집 근처예요', at: Date.now() };
  const posted = await call(store, 'POST', `/v1/rooms/${code}/chat`, { token, body: message });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.pushes, undefined);
  assert.equal(JSON.stringify(posted.body).includes('fcm.googleapis.com'), false);
  const after = await store.read(id);
  const targets = pushesForChat(after, message);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].name, '하나');
  const payload = chatPushPayload(message, code);
  assert.equal(payload.kind, 'chat');
  assert.equal(payload.title, '엄마');
  assert.equal(payload.body, '집 근처예요');
  assert.equal(payload.code, code);
  assert.equal(publicJson(payload).includes('010'), false);
  const longText = `${'가'.repeat(90)}`;
  const longPayload = chatPushPayload({ ...message, text: longText }, code);
  assert.equal(longPayload.body.length, 80);
  assert.equal(longPayload.body.endsWith('…'), true);
  assert.equal(longPayload.text, longText);

  const alertTargets = pushesForAlert(after, { from: '엄마', kind: 'sos' });
  assert.equal(alertTargets.some((item) => item.name === '엄마'), false);
  assert.equal(alertTargets.some((item) => item.name === '하나'), true);
  const motionTargets = pushesForAlert(after, { from: '엄마', kind: 'motion', to: ['하나'] });
  assert.deepEqual(motionTargets.map((item) => item.name), ['하나']);
  assert.equal(pushesForAlert(after, { from: '엄마', kind: 'motion', to: [] }).length, 0);

  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(JSON.stringify(reader.body).includes('fcm.googleapis.com'), false);
  assert.equal(JSON.stringify(reader.body).includes('집 근처예요'), false);
});

test('motion alerts push only to the named family members', async () => {
  const store = createMemoryStore();
  const code = '13579';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const key = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const base = { p256dh: bytesToBase64Url(publicRaw), auth: bytesToBase64Url(auth) };
  for (const [name, endpoint] of [['하나', 'umap-child'], ['아빠', 'umap-dad'], ['엄마', 'umap-mom']]) {
    const saved = await call(store, 'PUT', `/v1/rooms/${code}/push`, {
      token,
      readKey,
      body: { ...base, endpoint: `https://fcm.googleapis.com/fcm/send/${endpoint}`, name },
    });
    assert.equal(saved.status, 200);
  }
  const at = Date.now();
  const missing = await call(store, 'POST', `/v1/rooms/${code}/alert`, {
    token,
    body: { id: 'motion-start-01', kind: 'motion', code, from: '엄마', body: '엄마님이 움직이기 시작했어요', at },
  });
  assert.equal(missing.status, 400);
  const phone = await call(store, 'POST', `/v1/rooms/${code}/alert`, {
    token,
    body: { id: 'motion-start-02', kind: 'motion', code, from: '엄마', body: '엄마님이 움직이기 시작했어요', at, to: ['01012345678'] },
  });
  assert.equal(phone.status, 400);
  const posted = await call(store, 'POST', `/v1/rooms/${code}/alert`, {
    token,
    body: { id: 'motion-start-03', kind: 'motion', code, from: '엄마', body: '엄마님이 움직이기 시작했어요', at, to: ['하나', '아빠'] },
  });
  assert.equal(posted.status, 200);
  const id = await roomToken(code, writeKey, token.split('.')[1]);
  const room = await store.read(id);
  const stored = room.alerts.find((item) => item.id === 'motion-start-03');
  assert.deepEqual(stored.to, ['하나', '아빠']);
  const targets = pushesForAlert(room, stored);
  assert.deepEqual(targets.map((item) => item.name).sort(), ['아빠', '하나']);
  const payload = alertPushPayload(stored);
  assert.equal(payload.kind, 'motion');
  assert.equal(payload.title, '엄마님이 움직이기 시작했어요');
  assert.equal(payload.body, '엄마님이 움직이기 시작했어요');
  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(reader.body.alerts.some((item) => item.kind === 'motion' && item.body === '엄마님이 움직이기 시작했어요'), true);
  const sos = alertPushPayload({ id: 'a-sos', kind: 'sos', body: '엄마 님이 SOS를 눌렀습니다.' });
  assert.equal(sos.title, 'SOS');
  const selfDropped = await call(store, 'POST', `/v1/rooms/${code}/alert`, {
    token,
    body: { id: 'motion-stop-04', kind: 'motion', code, from: '엄마', body: '엄마님이 멈췄어요', at: at + 1, to: ['엄마', '하나'] },
  });
  assert.equal(selfDropped.status, 200);
  const afterDrop = await store.read(id);
  const stopped = afterDrop.alerts.find((item) => item.id === 'motion-stop-04');
  assert.deepEqual(stopped.to, ['하나']);
  assert.deepEqual(pushesForAlert(afterDrop, stopped).map((item) => item.name), ['하나']);
});

test('member id keeps the fix across a rename and only the profile key can change it', async () => {
  const store = createMemoryStore();
  const code = '48291';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const profileKey = randomKey();
  const otherKey = randomKey();
  const memberId = 'local-abc123';
  const at = Date.now();
  const photo = 'data:image/jpeg;base64,aaaa';

  const legacy = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: { code, name: '딸', lat: 37.51, lng: 127.02, accuracyM: 8, at, sharing: true },
  });
  assert.equal(legacy.status, 200);

  const missingKey = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: { code, name: '민지', memberId, priorName: '딸', lat: 37.52, lng: 127.03, accuracyM: 8, at: at + 1000, sharing: true },
  });
  assert.equal(missingKey.status, 403);

  const renamed = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: { code, name: '민지', memberId, priorName: '딸', lat: 37.51, lng: 127.02, accuracyM: 8, at: at + 2000, sharing: true },
  });
  assert.equal(renamed.status, 200);

  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(reader.body.places.length, 1);
  assert.equal(reader.body.places[0].name, '민지');
  assert.equal(reader.body.places[0].memberId, memberId);
  assert.equal(reader.body.places[0].lat, 37.51);
  assert.equal(reader.body.places[0].lng, 127.02);
  assert.equal(JSON.stringify(reader.body).includes(profileKey), false);

  const again = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: { code, name: '민지', memberId, lat: 37.55, lng: 127.08, accuracyM: 6, at: at + 3000, sharing: true },
  });
  assert.equal(again.status, 200);
  const moved = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(moved.body.places.length, 1);
  assert.equal(moved.body.places[0].lat, 37.55);

  const stolen = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey: otherKey,
    body: { code, name: '도둑', memberId, lat: 1, lng: 1, accuracyM: 4, at: at + 4000, sharing: true },
  });
  assert.equal(stolen.status, 403);
  const still = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(still.body.places[0].name, '민지');
  assert.equal(still.body.places[0].lat, 37.55);

  const published = await call(store, 'PUT', `/v1/rooms/${code}/profile`, {
    token,
    profileKey,
    body: { memberId, name: '민지', photo, at: at + 5000 },
  });
  assert.equal(published.status, 200);
  const withPhoto = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(withPhoto.body.profiles.length, 1);
  assert.equal(withPhoto.body.profiles[0].name, '민지');
  assert.equal(withPhoto.body.profiles[0].photo, photo);
  assert.equal(withPhoto.body.profiles[0].memberId, memberId);
  const hash = await sha256Base64Url(profileKey);
  assert.equal(JSON.stringify(withPhoto.body).includes(profileKey), false);
  assert.equal(JSON.stringify(withPhoto.body).includes(hash), false);

  const family = await call(store, 'GET', `/v1/rooms/${code}/family`, { token, profileKey, member: memberId });
  assert.equal(family.body.profiles[0].photo, photo);
  assert.equal(family.body.places.length, 0);

  const hijack = await call(store, 'PUT', `/v1/rooms/${code}/profile`, {
    token,
    profileKey: otherKey,
    body: { memberId, name: '도둑', photo: null, at: at + 6000 },
  });
  assert.equal(hijack.status, 403);
  const kept = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(kept.body.profiles[0].name, '민지');
  assert.equal(kept.body.profiles[0].photo, photo);

  const phone = await call(store, 'PUT', `/v1/rooms/${code}/profile`, {
    token,
    profileKey,
    body: { memberId, name: '01012345678', photo, at: at + 7000 },
  });
  assert.equal(phone.status, 400);
  const png = await call(store, 'PUT', `/v1/rooms/${code}/profile`, {
    token,
    profileKey,
    body: { memberId, name: '민지', photo: 'data:image/png;base64,aaaa', at: at + 7000 },
  });
  assert.equal(png.status, 400);
  const hugePhoto = `data:image/jpeg;base64,${'a'.repeat(25_000)}`;
  const oversized = await call(store, 'PUT', `/v1/rooms/${code}/profile`, {
    token,
    profileKey,
    body: { memberId, name: '민지', photo: hugePhoto, at: at + 7000 },
  });
  assert.equal(oversized.status, 400);
  const hugeBody = await call(store, 'PUT', `/v1/rooms/${code}/profile`, {
    token,
    profileKey,
    raw: `{"photo":"${'a'.repeat(40_000)}"}`,
  });
  assert.equal(hugeBody.status, 413);
  const hugePlace = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    raw: `{"name":"${'a'.repeat(40_000)}"}`,
  });
  assert.equal(hugePlace.status, 413);

  const siblingKey = randomKey();
  const sibling = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey: siblingKey,
    body: { code, name: '아들', memberId: 'local-bbb999', lat: 36.1, lng: 127.4, accuracyM: 9, at: at + 8000, sharing: true },
  });
  assert.equal(sibling.status, 200);
  const both = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(both.body.places.length, 2);
  assert.equal(both.body.places.find((place) => place.memberId === memberId).lat, 37.55);
  assert.equal(both.body.places.find((place) => place.name === '아들').lat, 36.1);
});

test('the creator read key deletes the room and a write token cannot', async () => {
  const store = createMemoryStore();
  const code = '48291';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const published = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: {
      code,
      name: '하나',
      lat: 37.5,
      lng: 127,
      accuracyM: 12,
      at: Date.now(),
      sharing: true,
      audience: 'family',
    },
  });
  assert.equal(published.status, 200);

  const denied = await call(store, 'DELETE', `/v1/rooms/${code}`, { token });
  assert.equal(denied.status, 403);
  const still = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.equal(still.status, 200);
  assert.equal(still.body.places.length, 1);

  const removed = await call(store, 'DELETE', `/v1/rooms/${code}`, { token, readKey });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { ok: true });
  const after = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.equal(after.status, 200);
  assert.deepEqual(after.body.places, []);

  const again = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    body: {
      code,
      name: '하나',
      lat: 37.5,
      lng: 127,
      accuracyM: 12,
      at: Date.now(),
      sharing: true,
      audience: 'family',
    },
  });
  assert.equal(again.status, 200);
  const back = await call(store, 'GET', `/v1/rooms/${code}/family`, { token });
  assert.equal(back.body.places.length, 1);
});

test('a member trail replaces the room copy and a stop removes it', async () => {
  const store = createMemoryStore();
  const code = '48291';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const profileKey = randomKey();
  const memberId = 'local-abc123';
  const at = Date.now();
  const trail = {
    memberId,
    at,
    moving: true,
    points: [
      { lat: 37.65, lng: 127.06, at: at - 60_000, speedMps: 8.9, staying: false },
      { lat: 37.66, lng: 127.08, at, speedMps: 9.1, staying: false },
    ],
    journeys: [],
  };
  const missing = await call(store, 'PUT', `/v1/rooms/${code}/trail`, { token, body: trail });
  assert.equal(missing.status, 403);
  const published = await call(store, 'PUT', `/v1/rooms/${code}/trail`, { token, profileKey, body: trail });
  assert.equal(published.status, 200);
  const older = await call(store, 'PUT', `/v1/rooms/${code}/trail`, {
    token,
    profileKey,
    body: { ...trail, at: at - 1000, points: [{ lat: 37.1, lng: 127.1, at: at - 1000 }] },
  });
  assert.equal(older.status, 200);
  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(reader.body.trails.length, 1);
  assert.equal(reader.body.trails[0].points.length, 2);
  assert.equal(reader.body.trails[0].points[1].lat, 37.66);
  assert.equal(JSON.stringify(reader.body).includes(profileKey), false);
  const family = await call(store, 'GET', `/v1/rooms/${code}/family`, { token, profileKey, member: memberId });
  assert.equal(family.body.trails[0].moving, true);
  const stopped = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: { code, name: '민지', memberId, lat: null, lng: null, accuracyM: 0, at: at + 1000, sharing: false },
  });
  assert.equal(stopped.status, 200);
  const after = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(after.body.trails.length, 0);
});

test('a newer trail with no journeys keeps the stored vehicle trip', async () => {
  const store = createMemoryStore();
  const code = '40306';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const profileKey = randomKey();
  const memberId = 'local-khoon01';
  const at = Date.now();
  const drive = {
    id: 'khoon-drive',
    startedAt: at - 20 * 60_000,
    endedAt: at - 5 * 60_000,
    distanceM: 6400,
    points: [
      { lat: 37.50, lng: 127.02, at: at - 20 * 60_000 },
      { lat: 37.55, lng: 127.08, at: at - 5 * 60_000 },
    ],
    start: { lat: 37.50, lng: 127.02, label: '집' },
    end: { lat: 37.55, lng: 127.08, label: '학교' },
  };
  const first = await call(store, 'PUT', `/v1/rooms/${code}/trail`, {
    token,
    profileKey,
    body: { memberId, at, moving: false, points: drive.points, journeys: [drive] },
  });
  assert.equal(first.status, 200);
  const empty = await call(store, 'PUT', `/v1/rooms/${code}/trail`, {
    token,
    profileKey,
    body: { memberId, at: at + 1000, moving: false, points: [], journeys: [] },
  });
  assert.equal(empty.status, 200);
  const reader = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(reader.body.trails[0].journeys.some((item) => item.id === 'khoon-drive'), true);
  const stopped = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: { code, name: 'Khoon', memberId, lat: null, lng: null, accuracyM: 0, at: at + 2000, sharing: false },
  });
  assert.equal(stopped.status, 200);
  const after = await call(store, 'GET', `/v1/rooms/${code}`, { token, readKey, profileKey, member: memberId });
  assert.equal(after.body.trails[0].journeys.some((item) => item.id === 'khoon-drive'), true);
});

test('family view keeps the newest place when one memberId was stored twice', () => {
  const room = {
    ...emptyRoom(),
    places: {
      old: { code: '48291', audience: 'family', name: '엄마', memberId: 'local-aaa', lat: 37.5, lng: 127, accuracyM: 8, sharing: true, at: 10 },
      next: { code: '48291', audience: 'family', name: '민지', memberId: 'local-aaa', lat: 37.6, lng: 127.1, accuracyM: 8, sharing: true, at: 20 },
    },
  };
  const view = viewFamilyPlaces(room);
  const mine = view.places.filter((place) => place.memberId === 'local-aaa');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].name, '민지');
});

test('an older plaintext fix does not replace a newer sealed place', () => {
  const sealed = applyPlace(emptyRoom(), {
    code: '48291',
    name: '하나',
    lat: null,
    lng: null,
    accuracyM: 0,
    at: 200,
    sharing: true,
    audience: 'family',
    memberId: 'local-sealowner',
    seal: { v: 1, alg: 'A256GCM', kid: 'abcdefghijklmnop', iv: 'AAAAAAAAAAAAAAAA', ct: 'BBBBBBBBBBBBBBBBBBBBBBBB' },
  });
  const older = applyPlace(sealed.room, {
    code: '48291',
    name: '하나',
    lat: 37.1,
    lng: 127.1,
    accuracyM: 8,
    at: 100,
    sharing: true,
    audience: 'family',
    memberId: 'local-sealowner',
  });
  const stored = Object.values(older.room.places)[0];
  assert.equal(stored.lat, null);
  assert.equal(stored.seal.kid, 'abcdefghijklmnop');
});

test('a sealed place keeps ciphertext only and a removed member cannot register again', async () => {
  const { mintFamilyKey, sealJson } = await import('../src/lib/familySeal.mjs');
  const store = createMemoryStore();
  const code = '48291';
  const writeKey = randomKey();
  const readKey = randomKey();
  const token = await syncTokenFor(writeKey, readKey);
  const profileKey = randomKey();
  const otherKey = randomKey();
  const family = await mintFamilyKey();
  const seal = await sealJson(family.key, family.kid, { lat: 37.6365, lng: 127.068, accuracyM: 18, label: '하계1차청구아파트' });
  const published = await call(store, 'PUT', `/v1/rooms/${code}/place`, {
    token,
    profileKey,
    body: {
      code,
      name: '하나',
      lat: 37.6365,
      lng: 127.068,
      accuracyM: 18,
      at: Date.now(),
      sharing: true,
      audience: 'family',
      memberId: 'local-sealowner',
      seal,
    },
  });
  assert.equal(published.status, 200);
  const visible = await call(store, 'GET', `/v1/rooms/${code}/family`, { token, profileKey, member: 'local-sealowner' });
  assert.equal(visible.body.places.length, 1);
  assert.equal(visible.body.places[0].lat, null);
  assert.equal(visible.body.places[0].lng, null);
  assert.equal(visible.body.places[0].accuracyM, 0);
  assert.equal(JSON.stringify(visible.body.places[0]).includes('하계1차청구아파트'), false);
  assert.equal(JSON.stringify(visible.body.places[0]).includes('37.6365'), false);

  const ownerPub = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const guestPub = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const registered = await call(store, 'PUT', `/v1/rooms/${code}/keys`, {
    token,
    profileKey,
    body: { memberId: 'local-sealowner', publicKey: ownerPub },
  });
  assert.equal(registered.status, 200);
  await call(store, 'PUT', `/v1/rooms/${code}/keys`, {
    token,
    profileKey: otherKey,
    body: { memberId: 'local-sealguest', publicKey: guestPub },
  });
  const rotated = await call(store, 'PUT', `/v1/rooms/${code}/keys`, {
    token,
    profileKey,
    body: {
      memberId: 'local-sealowner',
      publicKey: ownerPub,
      revoke: 'local-sealguest',
      rotate: true,
      kid: family.kid,
      wraps: {
        'local-sealowner': { epk: ownerPub, iv: 'AAAAAAAAAAAAAAAA', ct: 'BBBBBBBBBBBBBBBBBBBBBBBB' },
      },
    },
  });
  assert.equal(rotated.status, 200);
  assert.equal(rotated.body.keys.revoked.includes('local-sealguest'), true);
  assert.equal(rotated.body.keys.pubs['local-sealguest'], undefined);
  const blocked = await call(store, 'PUT', `/v1/rooms/${code}/keys`, {
    token,
    profileKey: otherKey,
    body: { memberId: 'local-sealguest', publicKey: guestPub },
  });
  assert.equal(blocked.status, 403);
});
