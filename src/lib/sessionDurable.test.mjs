import assert from 'node:assert/strict';
import test from 'node:test';
import { journeysWithinHistory } from './tracking.mjs';
import { prepareBackup } from './familyVault.mjs';
import {
  PLAIN_SESSION_KEY,
  collectJsonSnapshots,
  commitDurableSession,
  mergedSessionRaw,
  fillFromAccount,
  historyScore,
  parseStoredSession,
} from './sessionDurable.mjs';

function memoryStorage(initial = {}) {
  const box = new Map(Object.entries(initial));
  return {
    getItem: (key) => (box.has(key) ? box.get(key) : null),
    setItem: (key, value) => { box.set(key, String(value)); },
    removeItem: (key) => { box.delete(key); },
    dump: () => box,
  };
}

function journey(version, now) {
  const startedAt = now - 15 * 60 * 1000;
  const endedAt = now - 60 * 1000;
  return {
    id: `journey-${version}`,
    startedAt,
    endedAt,
    distanceM: 420,
    cloud: false,
    points: [
      { lat: 37.6365, lng: 127.068, at: startedAt },
      { lat: 37.6402, lng: 127.072, at: endedAt },
    ],
    start: { lat: 37.6365, lng: 127.068, label: '집' },
    end: { lat: 37.6402, lng: 127.072, label: '학교' },
  };
}

function visit(now) {
  return {
    id: 'visit-home',
    lat: 37.6365,
    lng: 127.068,
    arrivedAt: now - 3 * 60 * 60 * 1000,
    leftAt: now - 2 * 60 * 60 * 1000,
    label: '집',
    source: 'geocode',
  };
}

/** Shape written by 1.40–1.43 JSON.stringify of the family session. */
function releaseSession(version, now) {
  return {
    stage: 'map',
    profile: { id: 'self', name: '개발자', profileKey: 'profilekeyAAAAAAAA' },
    permissions: {
      notifications: 'granted',
      accuracy: 'precise',
      locationMode: 'always',
      motion: 'granted',
      battery: 'unknown',
      completed: true,
    },
    members: [{
      id: 'self',
      name: '개발자',
      role: 'self',
      lat: 37.6365,
      lng: 127.068,
      accuracyM: 12,
      battery: 70,
      charging: false,
      updatedAt: now,
      moving: false,
      share: 'allowed',
    }],
    tracks: {
      self: [
        { lat: 37.6365, lng: 127.068, at: now - 2 * 60 * 1000 },
        { lat: 37.637, lng: 127.069, at: now },
      ],
    },
    visits: { self: [visit(now)] },
    journeys: { self: [journey(version, now)] },
    inviteCode: '48291',
    backgroundKeepAlive: true,
    savedBy: version,
    mode: null,
  };
}

/**
 * 1.40–1.43 persist: plaintext in sessionStorage, and on a phone only the
 * Keystore seal in localStorage. The plain key did not exist yet.
 */
function persistLikePreviousRelease(local, tab, state, { native }) {
  const raw = JSON.stringify({ ...state, mode: null });
  tab.setItem('umap_family_v1', raw);
  if (native) local.setItem('umap_family_v1', `umap-device-seal:${Buffer.from(raw).toString('base64url')}`);
  else local.setItem('umap_family_v1', raw);
  local.setItem('umap_family_v1:at', String(Date.now()));
  return raw;
}

function emptySession() {
  return {
    inviteCode: '10000',
    members: [],
    permissions: { completed: false },
    journeys: {},
    visits: {},
    tracks: {},
    profile: null,
  };
}

test('1.40 through 1.43 records load on the new session and survive an update', () => {
  const now = Date.now();
  for (const version of ['1.40.0', '1.41.0', '1.42.0', '1.43.0']) {
    const state = releaseSession(version, now);
    const local = memoryStorage();
    const tab = memoryStorage();
    const raw = persistLikePreviousRelease(local, tab, state, { native: true });

    tab.removeItem('umap_family_v1');
    assert.equal(collectJsonSnapshots(local, tab).length, 0, `${version} seal is not plaintext`);

    const wiped = commitDurableSession(local, emptySession(), JSON.stringify(emptySession()), {
      unreadSeal: true,
      sealText: 'umap-device-seal:empty',
    });
    assert.equal(wiped.wrote, false);
    assert.equal(wiped.reason, 'hold-seal');
    assert.notEqual(local.getItem('umap_family_v1'), 'umap-device-seal:empty');
    assert.equal(local.getItem(PLAIN_SESSION_KEY), null);

    tab.setItem('umap_family_v1', raw);
    const opened = collectJsonSnapshots(local, tab);
    assert.equal(opened.length, 1);
    assert.equal(opened[0].journeys.self[0].id, `journey-${version}`);
    assert.equal(opened[0].visits.self[0].id, 'visit-home');
    assert.equal(opened[0].tracks.self.length, 2);
    const kept = journeysWithinHistory(opened[0].journeys, now);
    assert.equal(kept.self.length, 1);
    assert.equal(kept.self[0].id, `journey-${version}`);

    const saved = commitDurableSession(local, opened[0], raw, { unreadSeal: false, sealText: undefined });
    assert.equal(saved.wrote, true);
    tab.removeItem('umap_family_v1');
    const afterUpdate = collectJsonSnapshots(local, tab);
    assert.equal(afterUpdate.length, 1);
    assert.equal(afterUpdate[0].journeys.self[0].id, `journey-${version}`);
    assert.equal(historyScore(afterUpdate[0]) > 0, true);
    assert.equal(parseStoredSession(local.getItem('umap_family_v1')), null);
  }
});

test('a previous release plaintext localStorage copy still loads', () => {
  const now = Date.now();
  for (const version of ['1.40.0', '1.41.0', '1.42.0']) {
    const local = memoryStorage();
    const tab = memoryStorage();
    persistLikePreviousRelease(local, tab, releaseSession(version, now), { native: false });
    tab.removeItem('umap_family_v1');
    const found = collectJsonSnapshots(local, tab);
    assert.equal(found[0].journeys.self[0].id, `journey-${version}`);
    assert.equal(journeysWithinHistory(found[0].journeys, now).self[0].distanceM, 420);
  }
});

test('an empty session does not replace a plain copy that still has records', () => {
  const now = Date.now();
  const local = memoryStorage();
  const raw = JSON.stringify(releaseSession('1.43.0', now));
  commitDurableSession(local, releaseSession('1.43.0', now), raw, { unreadSeal: false, sealText: null });
  const blocked = commitDurableSession(local, emptySession(), JSON.stringify(emptySession()), {
    unreadSeal: false,
    sealText: null,
  });
  assert.equal(blocked.wrote, false);
  assert.equal(blocked.reason, 'richer-plain');
  assert.equal(JSON.parse(local.getItem(PLAIN_SESSION_KEY)).journeys.self[0].id, 'journey-1.43.0');
  assert.equal(JSON.parse(local.getItem('umap_family_v1')).visits.self.length, 1);
});

test('a plain copy older than 30 days does not block a newer save', () => {
  const now = Date.now();
  const stale = releaseSession('1.43.0', now);
  const old = now - 40 * 24 * 60 * 60 * 1000;
  stale.journeys.self[0].startedAt = old - 60 * 60 * 1000;
  stale.journeys.self[0].endedAt = old;
  stale.journeys.self[0].points[0].at = old - 60 * 60 * 1000;
  stale.journeys.self[0].points[1].at = old;
  stale.visits.self[0].arrivedAt = old - 60 * 60 * 1000;
  stale.visits.self[0].leftAt = old;
  stale.tracks.self[0].at = old;
  stale.tracks.self[1].at = old;
  const local = memoryStorage();
  const raw = JSON.stringify(stale);
  commitDurableSession(local, stale, raw, { unreadSeal: false, sealText: null });
  const next = emptySession();
  next.profile = { id: 'self', name: '개발자' };
  const decision = commitDurableSession(local, next, JSON.stringify(next), { unreadSeal: false, sealText: null });
  assert.equal(decision.wrote, true);
  assert.equal(JSON.parse(local.getItem(PLAIN_SESSION_KEY)).profile.name, '개발자');
});

test('an empty journey list still uploads a home', async () => {
  const storage = memoryStorage();
  const saved = await prepareBackup({
    memberId: 'self',
    profileKey: 'profilekeyAAAAAAAA',
    journeys: [],
    visits: [],
    home: { label: '우리 집', lat: 37.6365, lng: 127.068, radiusM: 150 },
  }, storage, 'ABCD2345EFGH');
  assert.equal(saved.keepHistory, true);
  assert.equal(saved.sealedHistory, undefined);
  assert.equal(saved.home.label, '우리 집');
  assert.equal(saved.clearHome, undefined);
});

test('an empty backup keeps server history instead of sealing an empty list', async () => {
  const storage = memoryStorage();
  const empty = await prepareBackup({
    memberId: 'self',
    profileKey: 'profilekeyAAAAAAAA',
    journeys: [],
    visits: [],
    home: null,
  }, storage, 'ABCD2345EFGH');
  assert.equal(empty.keepHistory, true);
  assert.equal(empty.sealedHistory, undefined);
  assert.equal(empty.journeys, undefined);
  assert.equal(empty.visits, undefined);
  assert.equal(empty.home, undefined);
  assert.equal(empty.clearHome, undefined);
  const cleared = await prepareBackup({
    memberId: 'self',
    profileKey: 'profilekeyAAAAAAAA',
    journeys: [],
    visits: [],
    home: null,
    homeCleared: true,
  }, storage, 'ABCD2345EFGH');
  assert.equal(cleared.clearHome, true);
  assert.equal(cleared.keepHistory, true);
});

test('an update that clears web storage still restores the durable session', () => {
  const now = Date.now();
  const local = memoryStorage();
  const tab = memoryStorage();
  const rich = releaseSession('1.74.0', now);
  const durable = JSON.stringify(rich);
  tab.removeItem('umap_family_v1');
  assert.equal(collectJsonSnapshots(local, tab).length, 0);
  const merged = mergedSessionRaw(durable, JSON.stringify(emptySession()));
  const kept = JSON.parse(merged);
  assert.equal(kept.journeys.self[0].id, 'journey-1.74.0');
  assert.equal(kept.tracks.self.length, 2);
  assert.equal(kept.inviteCode, rich.inviteCode);
  const again = mergedSessionRaw(merged, JSON.stringify(emptySession()));
  assert.equal(JSON.parse(again).journeys.self[0].id, 'journey-1.74.0');
});

test('server history can fill an empty phone without a profile wipe', () => {
  const patch = fillFromAccount({
    journeys: [{ id: 'server-journey' }],
    visits: [{ id: 'server-visit' }],
    home: { label: '집', lat: 37.6, lng: 127.0, radiusM: 150 },
    members: [{ id: 'other' }],
  });
  assert.deepEqual(patch.journeys.map((item) => item.id), ['server-journey']);
  assert.equal(patch.visits[0].id, 'server-visit');
  assert.equal(patch.home.label, '집');
  assert.equal(fillFromAccount({ journeys: [], visits: [], home: null }), null);
});
