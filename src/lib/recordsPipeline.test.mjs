import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDayRecord,
  mergeJourneyLists,
  previewOpenJourney,
  settleTrailPoint,
  storedTrackAfterArchive,
} from './tracking.mjs';
import {
  PLAIN_SESSION_KEY,
  collectJsonSnapshots,
  commitDurableSession,
} from './sessionDurable.mjs';

function offset(lat, lng, east, north) {
  const latRad = (lat * Math.PI) / 180;
  return {
    lat: lat + north / 110540,
    lng: lng + east / (111320 * Math.max(0.2, Math.cos(latRad))),
  };
}

/**
 * The records screen reads the same three results the app computes after each
 * GPS sample: archived journeys, the open preview, and visit stops.
 */
function replayFixes(fixes) {
  let points = [];
  let journeys = [];
  for (const fix of fixes) {
    points = settleTrailPoint(points, fix, fix.at).points;
    const archived = storedTrackAfterArchive(points, fix.at);
    if (archived.journeys.length > 0) {
      journeys = mergeJourneyLists(journeys, archived.journeys);
      points = archived.points;
    }
  }
  const now = fixes[fixes.length - 1].at;
  return {
    points,
    journeys,
    stops: buildDayRecord(points, now).stops,
    open: previewOpenJourney(points, now),
    now,
  };
}

function phoneTrace() {
  const home = { lat: 37.5, lng: 127.1 };
  const start = Date.parse('2026-11-01T02:19:00Z');
  const fixes = [];
  let t = start;
  for (let step = 0; step <= 75; step += 1) {
    const at = offset(home.lat, home.lng, 0, step * 6);
    fixes.push({ ...at, at: t, speedMps: 1.2, accuracyM: 8, staying: false });
    t += 8000;
  }
  const arrived = t;
  const end = arrived + 6 * 60 * 60 * 1000;
  let n = 0;
  while (t < end) {
    const burst = n % 20 === 0;
    const east = burst ? 0 : (n % 2 === 0 ? 60 : 0);
    const north = 450 + (burst ? 0 : 8);
    const at = offset(home.lat, home.lng, east, north);
    fixes.push({
      ...at,
      at: t,
      speedMps: null,
      accuracyM: burst ? 22 : 14,
      staying: false,
    });
    if (burst) {
      const hop = offset(home.lat, home.lng, 20, 450);
      fixes.push({
        ...hop,
        at: t + 4000,
        speedMps: null,
        accuracyM: 22,
        staying: false,
      });
      t += 4000;
    }
    t += 2 * 60 * 1000;
    n += 1;
  }
  return fixes;
}

function memoryStorage() {
  const box = new Map();
  return {
    getItem: (key) => (box.has(key) ? box.get(key) : null),
    setItem: (key, value) => { box.set(key, String(value)); },
    removeItem: (key) => { box.delete(key); },
  };
}

test('a walk then six hours indoors closes the journey, leaves a visit, and survives an update', () => {
  const played = replayFixes(phoneTrace());
  const openMinutes = played.open ? (played.open.endedAt - played.open.startedAt) / 60000 : 0;
  assert.equal(played.open, null, `open journey still ${Math.round(openMinutes)} min / ${played.open?.distanceM} m`);
  const walk = played.journeys.filter((journey) => journey.distanceM >= 200 && (journey.endedAt - journey.startedAt) < 30 * 60 * 1000);
  assert.equal(walk.length >= 1, true, `closed walks ${played.journeys.map((journey) => journey.distanceM).join(',')}`);
  const indoorCard = played.journeys.find((journey) => (journey.endedAt - journey.startedAt) > 60 * 60 * 1000);
  assert.equal(indoorCard, undefined);
  const stay = played.stops.find((stop) => ((stop.leftAt || played.now) - stop.arrivedAt) >= 5 * 60 * 60 * 1000);
  assert.ok(stay, `stops ${played.stops.length}`);

  const session = {
    stage: 'map',
    profile: { id: 'self', name: '개발자', profileKey: 'profilekeyAAAAAAAA' },
    permissions: { completed: true, locationMode: 'always', accuracy: 'precise', notifications: 'granted', motion: 'unknown', battery: 'unknown' },
    members: [{ id: 'self', name: '개발자', role: 'self', lat: 37.5, lng: 127.1, accuracyM: 16, updatedAt: played.now, moving: false, share: 'allowed' }],
    tracks: { self: played.points },
    journeys: { self: played.journeys },
    visits: {
      self: played.stops.map((stop) => ({
        id: `self:${stop.arrivedAt}`,
        ...stop,
        label: null,
        source: 'coords',
      })),
    },
    inviteCode: '48291',
    mode: null,
  };
  const raw = JSON.stringify(session);
  const local = memoryStorage();
  const tab = memoryStorage();
  tab.setItem('umap_family_v1', raw);
  local.setItem('umap_family_v1', `umap-device-seal:${Buffer.from(raw).toString('base64url')}`);
  local.setItem('umap_family_v1:at', String(played.now));
  tab.removeItem('umap_family_v1');
  const wiped = commitDurableSession(local, {
    inviteCode: '10000',
    members: [],
    permissions: { completed: false },
    journeys: {},
    visits: {},
    tracks: {},
  }, JSON.stringify({ inviteCode: '10000', members: [], permissions: { completed: false } }), {
    unreadSeal: true,
    sealText: 'umap-device-seal:empty',
  });
  assert.equal(wiped.wrote, false);
  tab.setItem('umap_family_v1', raw);
  const opened = collectJsonSnapshots(local, tab);
  assert.equal(opened[0].journeys.self.length, played.journeys.length);
  assert.equal(opened[0].visits.self.length, session.visits.self.length);
  const saved = commitDurableSession(local, opened[0], raw, { unreadSeal: false, sealText: undefined });
  assert.equal(saved.wrote, true);
  tab.removeItem('umap_family_v1');
  const after = collectJsonSnapshots(local, tab);
  assert.equal(after[0].journeys.self[0].distanceM >= 200, true);
  assert.equal(after[0].visits.self.length >= 1, true);
  assert.equal(local.getItem(PLAIN_SESSION_KEY) != null, true);
});

test('a 1.43 plaintext session still loads after sessionStorage is cleared', () => {
  const now = Date.parse('2026-11-01T08:12:00Z');
  const startedAt = now - 20 * 60 * 1000;
  const endedAt = now - 8 * 60 * 1000;
  const session = {
    stage: 'map',
    profile: { id: 'self', name: '개발자', profileKey: 'profilekeyAAAAAAAA' },
    permissions: { completed: true, locationMode: 'always', accuracy: 'precise', notifications: 'granted', motion: 'unknown', battery: 'unknown' },
    members: [{ id: 'self', name: '개발자', role: 'self', lat: 37.5, lng: 127.1, accuracyM: 10, updatedAt: now, moving: false, share: 'allowed' }],
    tracks: { self: [{ lat: 37.5, lng: 127.1, at: now - 60000 }, { lat: 37.501, lng: 127.101, at: now }] },
    journeys: {
      self: [{
        id: 'journey-1.43.0',
        startedAt,
        endedAt,
        distanceM: 420,
        cloud: false,
        points: [
          { lat: 37.5, lng: 127.1, at: startedAt },
          { lat: 37.504, lng: 127.104, at: endedAt },
        ],
        start: { lat: 37.5, lng: 127.1, label: '집' },
        end: { lat: 37.504, lng: 127.104, label: '학교' },
      }],
    },
    visits: {
      self: [{
        id: 'visit-1.43.0',
        lat: 37.5,
        lng: 127.1,
        arrivedAt: now - 3 * 60 * 60 * 1000,
        leftAt: now - 2 * 60 * 60 * 1000,
        label: '집',
        source: 'geocode',
      }],
    },
    inviteCode: '48291',
    mode: null,
  };
  const raw = JSON.stringify(session);
  const local = memoryStorage();
  const tab = memoryStorage();
  local.setItem('umap_family_v1', raw);
  local.setItem('umap_family_v1:at', String(now - 1000));
  const found = collectJsonSnapshots(local, tab);
  assert.equal(found[0].journeys.self[0].id, 'journey-1.43.0');
  assert.equal(found[0].visits.self[0].id, 'visit-1.43.0');
});
