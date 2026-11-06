import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

if (typeof zlib.createZstdDecompress !== 'function') {
  zlib.createZstdDecompress = function createZstdDecompress() {
    throw new Error('zstd');
  };
}

const require = createRequire(import.meta.url);

function east(lat, lng, meters) {
  return lng + meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

function member(id, name, lat, lng, extra = {}) {
  return {
    id,
    name,
    role: id === 'self' ? 'self' : 'guardian',
    share: 'allowed',
    lat,
    lng,
    accuracyM: 10,
    battery: extra.battery ?? 50,
    charging: false,
    updatedAt: extra.updatedAt ?? Date.now(),
    moving: false,
    place: extra.place ?? '',
    ...extra,
    id,
    name,
    lat,
    lng,
  };
}

test('nearby members share one status chip and the markers stay put', async () => {
  const { JSDOM } = require('jsdom');
  const esbuild = require('esbuild');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
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

  const dir = path.resolve('node_modules/.cache');
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, 'street-map-status.mjs');
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
  const { act } = React;
  const root = createRoot(document.getElementById('root'));
  const selected = [];
  const cleared = [];
  const lat = 37.6372;
  const lng = 127.07085;
  const staleAt = Date.now() - 4 * 60 * 1000;
  const near = [
    member('self', '부건', lat, lng, { battery: 27, place: '하계청구아파트' }),
    member('mom', '엄마', lat + 20 / 111_320, lng, { battery: 52, place: '하계청구아파트' }),
    member('khoon', 'Khoon', lat, east(lat, lng, 30), { battery: 65, place: '다른 건물', updatedAt: staleAt }),
  ];
  const far = member('uncle', '삼촌', lat + 0.01, lng, { battery: 10, place: '상계동' });

  const render = (members, selectedId) => act(async () => {
    root.render(React.createElement(bundled.StreetMap, {
      center: { lat, lng },
      zoom: 17,
      members,
      home: null,
      trails: [],
      trailColor: '#0084FF',
      selectedId,
      onSelect: (id) => selected.push(id),
      onClear: () => cleared.push(true),
    }));
  });

  await render([...near, far]);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

  const status = document.querySelectorAll('.umap-member-status');
  const pins = [...document.querySelectorAll('.umap-member-pin')];
  assert.equal(status.length, 1);
  assert.equal(pins.length, 4);
  const chip = status[0].innerHTML;
  assert.equal((chip.match(/data-place/g) || []).length, 1);
  assert.match(chip, /하계청구아파트/);
  assert.equal(chip.includes('다른 건물'), false);
  assert.equal(chip.includes('상계동'), false);
  const names = [...chip.matchAll(/data-name[^>]*>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(names, ['나', '엄마', 'Khoon']);
  assert.match(chip, /27%/);
  assert.match(chip, /52%/);
  assert.match(chip, /65%/);
  assert.match(chip, /분 전/);
  assert.match(chip, /data-member-id="khoon"[^>]*opacity:0\.55/);
  for (const pin of pins) assert.equal(pin.innerHTML.includes('data-status-group'), false);
  const solo = document.querySelector('.umap-member-pin');
  assert.ok(pins.some((pin) => pin.innerHTML.includes('data-label') && pin.innerHTML.includes('삼촌')));
  assert.ok(pins.filter((pin) => pin.innerHTML.includes('data-label')).length === 1);
  assert.ok(solo);

  const pinNodes = pins;
  const statusNode = status[0];
  const heldBefore = statusNode.dataset.heldLat;
  assert.match(heldBefore, /37\.637/);
  const moved = near.map((person, index) => (
    index === 0 ? { ...person, lat: person.lat + 0.00001, battery: 28 } : person
  ));
  await render([...moved, far]);
  const pinsAfter = [...document.querySelectorAll('.umap-member-pin')];
  const statusAfter = document.querySelector('.umap-member-status');
  assert.equal(pinsAfter.length, 4);
  assert.equal(statusAfter, statusNode);
  assert.deepEqual(pinsAfter, pinNodes);
  assert.equal(statusAfter.dataset.heldLat, heldBefore);
  assert.match(statusAfter.innerHTML, /28%/);
  assert.match(statusAfter.innerHTML, /data-pin-leader/);

  const row = statusAfter.querySelector('[data-member-id="mom"]');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(selected, ['mom']);

  await render([near[0]]);
  assert.equal(document.querySelectorAll('.umap-member-status').length, 0);
  assert.equal(document.querySelectorAll('.umap-member-pin').length, 1);
  const alone = document.querySelector('.umap-member-pin').innerHTML;
  assert.match(alone, /data-label/);
  assert.match(alone, /나/);
  assert.match(alone, /data-label-tail/);
  assert.match(alone, /하계청구아파트/);

  const mapNode = document.querySelector('.umap-street-map');
  const leafletMap = mapNode.__kinnexMap;
  assert.ok(leafletMap, 'map instance');
  const runsBefore = Number(mapNode.dataset.layoutRuns || 0);
  let rects = 0;
  const proto = window.HTMLElement.prototype;
  const origRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function countRect() {
    rects += 1;
    return origRect.apply(this, arguments);
  };
  const started = performance.now();
  leafletMap.fire('movestart');
  leafletMap.fire('dragstart');
  for (let step = 0; step < 40; step += 1) leafletMap.fire('move');
  const dragMs = performance.now() - started;
  const runsDuring = Number(mapNode.dataset.layoutRuns || 0);
  proto.getBoundingClientRect = origRect;
  leafletMap.fire('moveend');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const runsAfter = Number(mapNode.dataset.layoutRuns || 0);
  console.log(JSON.stringify({
    dragMs: Number(dragMs.toFixed(2)),
    perMoveMs: Number((dragMs / 40).toFixed(3)),
    rects,
    runsBefore,
    runsDuring,
    runsAfter,
  }));
  assert.ok(dragMs < 50, `40 move events ${dragMs.toFixed(1)}ms`);
  assert.equal(rects, 0);
  assert.equal(runsDuring, runsBefore);
  assert.ok(runsAfter - runsBefore <= 2, `layouts ${runsBefore} -> ${runsAfter}`);
});
