import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryAccountStore } from './account.mjs';
import { cleanDiagEvents } from './diag.mjs';
import { createMemoryStore, handleSyncRequest } from './protocol.mjs';

function snapshot() {
  return {
    memberId: 'local-diaguser1',
    profileKey: 'profilekeyAAAAAAAA',
    profile: { name: '개발자', photo: null },
    room: { code: '48291', writeKey: 'writeKeyAAAAAAAAAA', readKey: 'readKeyAAAAAAAAAAA' },
    guardians: [],
    home: null,
    journeys: [],
    visits: [],
  };
}

async function call(accounts, method, path, { body, accountKey, now, authorization, diagReadToken } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (accountKey) headers.set('x-umap-account-key', accountKey);
  if (authorization) headers.set('authorization', authorization);
  const response = await handleSyncRequest(createMemoryStore(), new Request(`http://sync.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { accounts, now, diagReadToken });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('geocode candidates and the app version are kept in a diagnostic report', () => {
  const names = '하계청구아파트,하계 1차청구아파트,105동';
  const events = cleanDiagEvents([{
    kind: 'geocode',
    t: 1,
    label: '하계 1차청구아파트 105동',
    candidates: names,
    version: '1.44.0',
  }]);
  assert.equal(events[0].candidates, names);
  assert.equal(events[0].label, '하계 1차청구아파트 105동');
  assert.equal(events[0].version, '1.44.0');
});

test('a diagnostic report is stored on the account and read only by its id', async () => {
  const accounts = createMemoryAccountStore();
  const created = await call(accounts, 'POST', '/v1/account', { body: snapshot() });
  assert.equal(created.status, 200);
  const accountKey = created.body.account.accountKey;
  const denied = await call(accounts, 'POST', '/v1/diag', { body: { events: [{ kind: 'fix', t: 1, lat: 37.5, lng: 127 }] } });
  assert.equal(denied.status, 404);

  const saved = await call(accounts, 'POST', '/v1/diag', {
    accountKey,
    body: {
      events: [
        { kind: 'fix', t: 10, channel: 'native', source: 'gps', fg: true, accuracy: 12, lat: 37.55, lng: 127.02, ok: true, reason: 'accepted' },
        { kind: 'trail', t: 11, member: 'self', reason: 'draw', stored: 4, live: 4, segments: 1 },
      ],
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.ok(saved.body.id.length >= 16, saved.body.id);
  const report = await call(accounts, 'GET', `/v1/diag/${saved.body.id}`);
  assert.equal(report.status, 200);
  assert.equal(report.body.events.length, 2);
  assert.equal(report.body.events[0].lat, 37.55);
  assert.equal(report.body.events[0].source, 'gps');
  const missing = await call(accounts, 'GET', '/v1/diag/not-a-real-diag-id-value');
  assert.equal(missing.status, 404);

  const handling = await call(accounts, 'GET', '/v1/account/handling', { accountKey });
  assert.equal(handling.body.events.some((event) => event.kind === 'collect' && event.categories.includes('location')), true);
  assert.equal(JSON.stringify(handling.body).includes('37.55'), false);

  const expired = await call(accounts, 'GET', `/v1/diag/${saved.body.id}`, { now: saved.body.exp + 1 });
  assert.equal(expired.status, 404);

  const [left, right] = await Promise.all([
    call(accounts, 'POST', '/v1/diag', { accountKey, body: { events: [{ kind: 'fix', t: 1, lat: 37.1, lng: 127.1 }] } }),
    call(accounts, 'POST', '/v1/diag', { accountKey, body: { events: [{ kind: 'fix', t: 2, lat: 37.2, lng: 127.2 }] } }),
  ]);
  assert.equal(left.status, 200);
  assert.equal(right.status, 200);
  assert.notEqual(left.body.id, right.body.id);
  assert.equal((await call(accounts, 'GET', `/v1/diag/${left.body.id}`)).status, 200);
  assert.equal((await call(accounts, 'GET', `/v1/diag/${right.body.id}`)).status, 200);
});

test('diag recent is closed unless DIAG_READ_TOKEN matches', async () => {
  const accounts = createMemoryAccountStore();
  const created = await call(accounts, 'POST', '/v1/account', { body: snapshot() });
  const accountKey = created.body.account.accountKey;
  const older = await call(accounts, 'POST', '/v1/diag', {
    accountKey,
    now: 1_000,
    body: { events: [{ kind: 'keep', t: 1, version: '1.44.0' }] },
  });
  const newer = await call(accounts, 'POST', '/v1/diag', {
    accountKey,
    now: 5_000,
    body: { events: [{ kind: 'keep', t: 2, version: '1.45.0', label: '하계 1차청구아파트 105동' }] },
  });
  assert.equal(older.status, 200);
  assert.equal(newer.status, 200);
  const unset = await call(accounts, 'GET', '/v1/diag/recent?limit=10', { authorization: 'Bearer anything', now: 10_000 });
  assert.equal(unset.status, 404);
  assert.equal(unset.body.error, 'disabled');
  const missing = await call(accounts, 'GET', '/v1/diag/recent', { diagReadToken: 'dev-read-token', now: 10_000 });
  assert.equal(missing.status, 401);
  const wrong = await call(accounts, 'GET', '/v1/diag/recent', {
    diagReadToken: 'dev-read-token',
    authorization: 'Bearer other-token',
    now: 10_000,
  });
  assert.equal(wrong.status, 401);
  const listed = await call(accounts, 'GET', '/v1/diag/recent?limit=10', {
    diagReadToken: 'dev-read-token',
    authorization: 'Bearer dev-read-token',
    now: 10_000,
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.reports.length, 2);
  assert.equal(listed.body.reports[0].id, newer.body.id);
  assert.equal(listed.body.reports[1].id, older.body.id);
  assert.equal(listed.body.reports[0].version, '1.45.0');
  assert.equal(listed.body.reports[0].memberId, 'local-diaguser1');
  assert.equal(listed.body.reports[0].name, '개발자');
  assert.match(listed.body.reports[0].receivedKst, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(listed.body.reports[0].bytes > 0, true);
  assert.equal(JSON.stringify(listed.body).includes('하계'), false);
  const still = await call(accounts, 'GET', `/v1/diag/${newer.body.id}`, { now: 10_000 });
  assert.equal(still.status, 200);
  assert.equal(still.body.events[0].version, '1.45.0');
});
