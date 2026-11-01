import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { memberLiveLines } from '../../lib/mapTrail.mjs';
import { liveMotionLabel, liveTrailPoints, settleTrailPoint } from '../../lib/tracking.mjs';

// Node 20's zlib has no zstd. jsdom's undici calls createZstdDecompress.bind at load.
if (typeof zlib.createZstdDecompress !== 'function') {
  zlib.createZstdDecompress = function createZstdDecompress() {
    throw new Error('zstd');
  };
}

const require = createRequire(import.meta.url);

function east(lat, lng, meters) {
  return lng + meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

function walkFixes(count) {
  const lat = 37.57;
  let lng = 127.03;
  const start = Date.UTC(2026, 9, 31, 5, 48, 0);
  const fixes = [];
  for (let index = 0; index < count; index += 1) {
    fixes.push({
      lat,
      lng,
      at: start + index * 2_500,
      accuracyM: 12,
      speedMps: 1.3,
      staying: false,
    });
    lng = east(lat, lng, 3.5);
  }
  return fixes;
}

function ingest(fixes) {
  let points = [];
  for (const fix of fixes) points = settleTrailPoint(points, fix, fix.at).points;
  return points;
}

function trailCount(text) {
  return String(text || '').split(/[; ]/).filter((item) => item.includes(',')).length;
}

test('the main map polyline grows as a foreground walk streams in', async () => {
  const { JSDOM } = require('jsdom');
  const esbuild = require('esbuild');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.ResizeObserver = globalThis.ResizeObserver;
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, width: 390, height: 700, top: 0, left: 0, right: 390, bottom: 700, toJSON() { return {}; } };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 390; } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 700; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 390; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 700; } });

  const dir = path.resolve('node_modules/.cache');
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, 'street-map-trail.mjs');
  await esbuild.build({
    absWorkingDir: path.resolve('src/components/family'),
    entryPoints: ['streetMapTrail.entry.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    define: {
      'import.meta.env.VITE_VWORLD_API_KEY': '""',
    },
    plugins: [{
      name: 'css-empty',
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-empty' }));
        build.onLoad({ filter: /.*/, namespace: 'css-empty' }, () => ({ contents: 'export default "";', loader: 'js' }));
      },
    }],
  });
  const bundled = await import(pathToFileURL(outfile).href);
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const rootNode = document.getElementById('root');
  const root = createRoot(rootNode);
  const firstFixes = walkFixes(8);
  const firstPoints = ingest(firstFixes);
  const now = firstFixes[firstFixes.length - 1].at + 1_000;
  const member = {
    id: 'self',
    role: 'self',
    share: 'allowed',
    lat: firstFixes[firstFixes.length - 1].lat,
    lng: firstFixes[firstFixes.length - 1].lng,
    updatedAt: now,
    accuracyM: 12,
    moving: true,
  };
  const first = memberLiveLines(member, { self: firstPoints }, now);
  assert.equal(first.reason, 'draw', `${first.reason} live ${liveTrailPoints(firstPoints, now).length}`);
  const host = document.createElement('div');
  host.style.width = '390px';
  host.style.height = '700px';
  rootNode.appendChild(host);
  const mapRef = React.createRef();
  await act(async () => {
    root.render(React.createElement(bundled.StreetMap, {
      ref: mapRef,
      center: { lat: member.lat, lng: member.lng },
      zoom: 16,
      members: [],
      home: null,
      trails: first.lines,
      trailColor: '#0084FF',
      onSelect: () => {},
    }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const mapNode = document.querySelector('.leaflet-container');
  const earlyText = mapNode?.dataset?.trail || '';
  const early = trailCount(earlyText);
  assert.ok(early >= 2, `early polyline ${earlyText}`);

  const moreFixes = walkFixes(24);
  const morePoints = ingest(moreFixes);
  const laterNow = moreFixes[moreFixes.length - 1].at + 1_000;
  const laterMember = {
    ...member,
    lat: moreFixes[moreFixes.length - 1].lat,
    lng: moreFixes[moreFixes.length - 1].lng,
    updatedAt: laterNow,
  };
  const later = memberLiveLines(laterMember, { self: morePoints }, laterNow);
  assert.equal(later.reason, 'draw');
  await act(async () => {
    root.render(React.createElement(bundled.StreetMap, {
      ref: mapRef,
      center: { lat: laterMember.lat, lng: laterMember.lng },
      zoom: 16,
      members: [],
      home: null,
      trails: later.lines,
      trailColor: '#0084FF',
      onSelect: () => {},
    }));
  });
  const grownText = mapNode?.dataset?.trail || '';
  const lastLng = (text) => {
    const pairs = String(text).split(/[; ]/).filter((item) => item.includes(','));
    return Number(pairs[pairs.length - 1].split(',')[1]);
  };
  assert.ok(trailCount(grownText) >= 2 && lastLng(grownText) > lastLng(earlyText), `${earlyText} -> ${grownText}`);

  let networkLat = moreFixes[moreFixes.length - 1].lat;
  const networkLng = moreFixes[moreFixes.length - 1].lng;
  let networkPoints = morePoints;
  const networkStart = moreFixes[moreFixes.length - 1].at + 8_000;
  const accuracies = [60, 90, 120, 150, 80];
  for (let index = 0; index < 20; index += 1) {
    networkLat += 12 / 111_320;
    const sample = {
      lat: networkLat,
      lng: networkLng,
      at: networkStart + index * 8_000,
      accuracyM: accuracies[index % accuracies.length],
      speedMps: 0,
      staying: true,
    };
    networkPoints = settleTrailPoint(networkPoints, sample, sample.at).points;
  }
  const networkNow = networkStart + 19 * 8_000 + 500;
  const networkMember = {
    ...laterMember,
    lat: networkLat,
    lng: networkLng,
    updatedAt: networkNow,
    accuracyM: 120,
    moving: false,
  };
  const networkLine = memberLiveLines(networkMember, { self: networkPoints }, networkNow);
  assert.equal(networkLine.reason, 'draw');
  await act(async () => {
    root.render(React.createElement(bundled.StreetMap, {
      ref: mapRef,
      center: { lat: networkMember.lat, lng: networkMember.lng },
      zoom: 16,
      members: [],
      home: null,
      trails: networkLine.lines,
      trailColor: '#0084FF',
      onSelect: () => {},
    }));
  });
  const drawnTip = (mapNode?.dataset?.trail || '').split(/[; ]/).filter((item) => item.includes(',')).pop();
  const tipLat = Number(String(drawnTip).split(',')[0]);
  assert.ok(Math.abs(tipLat - networkMember.lat) < 0.0002, `${drawnTip} vs ${networkMember.lat}`);
  root.unmount();
});

function northOf(lat, meters) {
  return lat + meters / 111_320;
}

function eastOf(lat, lng, meters) {
  return lng + meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

async function openStreetMap() {
  const { JSDOM } = require('jsdom');
  const esbuild = require('esbuild');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.Node = window.Node;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.ResizeObserver = globalThis.ResizeObserver;
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, width: 390, height: 700, top: 0, left: 0, right: 390, bottom: 700, toJSON() { return {}; } };
  };
  for (const key of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight']) {
    Object.defineProperty(window.HTMLElement.prototype, key, { configurable: true, get() { return key.includes('Width') ? 390 : 700; } });
  }
  const dir = path.resolve('node_modules/.cache');
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, 'street-map-trail.mjs');
  await esbuild.build({
    absWorkingDir: path.resolve('src/components/family'),
    entryPoints: ['streetMapTrail.entry.tsx'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    define: { 'import.meta.env.VITE_VWORLD_API_KEY': '""' },
    plugins: [{
      name: 'css-empty',
      setup(build) {
        build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: 'css-empty' }));
        build.onLoad({ filter: /.*/, namespace: 'css-empty' }, () => ({ contents: 'export default "";', loader: 'js' }));
      },
    }],
  });
  const bundled = await import(pathToFileURL(outfile).href);
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const rootNode = document.getElementById('root');
  const host = document.createElement('div');
  host.style.width = '390px';
  host.style.height = '700px';
  rootNode.replaceChildren(host);
  const root = createRoot(host);
  return { React, root, bundled, act: React.act };
}

async function paint(react, root, bundled, lines) {
  const center = lines[0]?.[0] ?? { lat: 37.6, lng: 127 };
  await react.act(async () => {
    root.render(react.createElement(bundled.StreetMap, {
      center,
      zoom: 16,
      members: [],
      home: null,
      trails: lines,
      trailColor: '#0084FF',
      onSelect: () => {},
    }));
  });
  await react.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  return document.querySelector('.leaflet-container')?.dataset?.trail || '';
}

function coordsOf(text) {
  return String(text).split(/[; ]/).filter((item) => item.includes(','));
}

function shapedWalk(kind) {
  const origin = { lat: 37.6368, lng: 127.0675, at: Date.UTC(2026, 9, 31, 3, 49, 0) };
  const fixes = [];
  for (let index = 0; index <= 18; index += 1) {
    const theta = (Math.PI / 2) * (index / 18);
    const sample = {
      lat: northOf(origin.lat, 42 * Math.sin(theta)),
      lng: eastOf(origin.lat, origin.lng, 42 * (1 - Math.cos(theta))),
      at: origin.at + index * 2_500,
      accuracyM: 12,
    };
    if (kind === 'self') Object.assign(sample, { speedMps: 1.3, staying: false });
    fixes.push(sample);
  }
  let tip = fixes[fixes.length - 1];
  const accuracies = [80, 120, 150, 90];
  for (let index = 1; index <= 6; index += 1) {
    const sample = {
      lat: northOf(tip.lat, index * 28),
      lng: tip.lng,
      at: tip.at + index * 20_000,
      accuracyM: accuracies[index % accuracies.length],
    };
    if (kind === 'self') Object.assign(sample, { speedMps: 0, staying: true });
    fixes.push(sample);
  }
  tip = fixes[fixes.length - 1];
  const gap = {
    lat: northOf(tip.lat, 300),
    lng: tip.lng,
    at: tip.at + 90_000,
    accuracyM: 12,
  };
  if (kind === 'self') Object.assign(gap, { speedMps: 0, staying: true });
  fixes.push(gap);
  tip = gap;
  for (let index = 1; index <= 5; index += 1) {
    const sample = {
      lat: tip.lat,
      lng: eastOf(tip.lat, tip.lng, index * 25),
      at: tip.at + index * 18_000,
      accuracyM: 12,
    };
    if (kind === 'self') Object.assign(sample, { speedMps: 0, staying: true });
    fixes.push(sample);
  }
  return fixes;
}

function cityDrive(kind) {
  const lat = 37.64;
  const lng = 127.07;
  let at = Date.UTC(2026, 9, 31, 4, 12, 0);
  const legs = [
    [0, 0],
    [0, 170],
    [0, 170],
    [190, 0],
    [190, 0],
    [0, 160],
  ];
  const gaps = [0, 15_000, 15_000, 14_000, 14_000, 16_000];
  let north = 0;
  let east = 0;
  return legs.map((leg, index) => {
    north += leg[0];
    east += leg[1];
    at += gaps[index];
    const sample = {
      lat: northOf(lat, north),
      lng: eastOf(lat, lng, east),
      at,
      accuracyM: 8,
    };
    if (kind === 'self') Object.assign(sample, { speedMps: 0, staying: true });
    return sample;
  });
}

test('the main map matches the records line and ends on the pin for a shaped walk and a city drive', async () => {
  const opened = await openStreetMap();
  const { React, root, bundled } = opened;
  try {
    for (const kind of ['self', 'family']) {
      const fixes = shapedWalk(kind);
      const points = ingest(fixes);
      const last = fixes[fixes.length - 1];
      const pin = {
        lat: northOf(last.lat, 8),
        lng: last.lng,
        at: last.at + 4_000,
        accuracyM: 12,
      };
      const member = {
        id: kind,
        role: kind === 'self' ? 'self' : 'admin-share',
        share: 'allowed',
        lat: pin.lat,
        lng: pin.lng,
        updatedAt: pin.at,
        accuracyM: 12,
        moving: kind === 'self' ? false : null,
        ...(kind === 'self' ? { speedMps: 0, staying: true } : {}),
      };
      const now = pin.at + 500;
      const records = memberLiveLines(member, { [kind]: points }, now, undefined, false);
      const main = memberLiveLines(member, { [kind]: points }, now, undefined, true);
      assert.equal(records.reason, 'draw', `${kind} records ${records.reason}`);
      assert.equal(main.reason, 'draw', `${kind} main ${main.reason}`);
      assert.deepEqual(
        main.lines[0].slice(0, -1).map((point) => [point.lat, point.lng]),
        records.lines[0].map((point) => [point.lat, point.lng]),
      );
      const gap = fixes.reduce((best, fix, index) => {
        if (index === 0) return best;
        const step = Math.abs(fix.lat - fixes[index - 1].lat);
        return step > best.step ? { fix, step } : best;
      }, { fix: fixes[0], step: 0 }).fix;
      assert.equal(records.lines[0].some((point) => Math.abs(point.lat - gap.lat) < 1e-6), true, `${kind} dropped the 300m gap`);
      const recordsPaint = await paint(React, root, bundled, records.lines);
      const mainPaint = await paint(React, root, bundled, main.lines);
      const mainCoords = coordsOf(mainPaint);
      const recordCoords = coordsOf(recordsPaint);
      assert.ok(recordCoords.length >= 2, `${kind} records paint ${recordsPaint}`);
      assert.equal(mainCoords[0], recordCoords[0], kind);
      assert.equal(mainCoords[mainCoords.length - 1], `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`, `${kind} ${mainPaint}`);
      assert.equal(mainPaint.includes(`${gap.lat.toFixed(5)},${gap.lng.toFixed(5)}`), true, kind);
    }

    for (const kind of ['self', 'family']) {
      const fixes = cityDrive(kind);
      const points = ingest(fixes);
      const last = fixes[fixes.length - 1];
      const pin = {
        lat: last.lat,
        lng: eastOf(last.lat, last.lng, 18),
        at: last.at + 4_000,
        accuracyM: 8,
        speedMps: kind === 'self' ? 0 : undefined,
        staying: kind === 'self' ? true : undefined,
      };
      const member = {
        id: kind,
        role: kind === 'self' ? 'self' : 'admin-share',
        share: 'allowed',
        lat: pin.lat,
        lng: pin.lng,
        updatedAt: pin.at,
        accuracyM: 8,
        moving: false,
        speedMps: pin.speedMps,
        staying: pin.staying,
      };
      const now = pin.at + 800;
      assert.notEqual(liveMotionLabel({
        located: true,
        moving: member.moving,
        points,
        now,
        pin,
      }), '머무름', kind);
      const records = memberLiveLines(member, { [kind]: points }, now, undefined, false);
      const main = memberLiveLines(member, { [kind]: points }, now, undefined, true);
      assert.equal(main.reason, 'draw', `${kind} drive ${main.reason} live ${main.live}`);
      assert.deepEqual(main.lines[0].slice(0, -1).map((point) => point.lng), records.lines[0].map((point) => point.lng));
      const painted = await paint(React, root, bundled, main.lines);
      assert.equal(painted.includes(';'), false, `${kind} dashed or split ${painted}`);
      const drawn = coordsOf(painted);
      assert.equal(drawn[drawn.length - 1], `${pin.lat.toFixed(5)},${pin.lng.toFixed(5)}`, painted);
      const north = drawn.map((pair) => Number(pair.split(',')[0]));
      const east = drawn.map((pair) => Number(pair.split(',')[1]));
      const startNorth = north[0];
      const startEast = east[0];
      const onNorthStreet = drawn.some((pair, index) => {
        const movedNorth = (north[index] - startNorth) * 111_320;
        const movedEast = (east[index] - startEast) * 111_320 * Math.cos((startNorth * Math.PI) / 180);
        return movedNorth > 300 && movedEast > 280 && movedEast < 400;
      });
      assert.equal(onNorthStreet, true, `${kind} corner skipped ${painted}`);
      const alongFirstStreet = drawn.some((pair, index) => (
        (north[index] - startNorth) * 111_320 < 30
        && (east[index] - startEast) * 111_320 * Math.cos((startNorth * Math.PI) / 180) > 140
      ));
      assert.equal(alongFirstStreet, true, `${kind} first street skipped ${painted}`);
    }
  } finally {
    root.unmount();
  }
});
