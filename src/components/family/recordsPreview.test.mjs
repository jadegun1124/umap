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

function journey(index, count = 200) {
  const points = [];
  const start = Date.UTC(2026, 10, 6, 0, 0, 0) + index * 3_600_000;
  for (let step = 0; step < count; step += 1) {
    const gap = index === 0 && step === Math.floor(count / 2) ? 0.2 : 0;
    points.push({
      lat: 37.5 + index * 0.002,
      lng: 127 + step * 0.00015 + gap,
      at: start + step * 2_000,
      speedMps: 1.3,
      accuracyM: 12,
    });
  }
  return {
    id: `j-${index}`,
    startedAt: points[0].at,
    endedAt: points[points.length - 1].at,
    distanceM: 1500,
    points,
    start: { lat: points[0].lat, lng: points[0].lng, label: '출발' },
    end: { lat: points[points.length - 1].lat, lng: points[points.length - 1].lng, label: '도착' },
  };
}

function installDom() {
  const { JSDOM } = require('jsdom');
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
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  delete window.IntersectionObserver;
  delete globalThis.IntersectionObserver;
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserver;
  globalThis.ResizeObserver = ResizeObserver;
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, width: 390, height: 144, top: 0, left: 0, right: 390, bottom: 144, toJSON() { return {}; } };
  };
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 390; } });
  Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 144; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 390; } });
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return 144; } });
  const pending = new Set();
  const origSet = window.setTimeout.bind(window);
  const origClear = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    const id = origSet(() => {
      pending.delete(id);
      if (typeof fn === 'function') fn();
    }, ms, ...rest);
    pending.add(id);
    return id;
  };
  window.clearTimeout = (id) => {
    pending.delete(id);
    return origClear(id);
  };
  const listeners = new Set();
  const origAdd = window.addEventListener.bind(window);
  const origRemove = window.removeEventListener.bind(window);
  window.addEventListener = (type, listener, options) => {
    listeners.add(listener);
    return origAdd(type, listener, options);
  };
  window.removeEventListener = (type, listener, options) => {
    listeners.delete(listener);
    return origRemove(type, listener, options);
  };
  window.__pendingTimers = pending;
  window.__windowListeners = listeners;
  return window;
}

test('records list mounts a capped number of maps and releases them on each close', async () => {
  const window = installDom();
  const esbuild = require('esbuild');
  const dir = path.resolve('node_modules/.cache');
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, 'records-preview.mjs');
  await esbuild.build({
    absWorkingDir: path.resolve('src/components/family'),
    entryPoints: ['recordsPreview.entry.tsx'],
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
  bundled.resetRecordPreviewMaps();
  const rootNode = document.getElementById('root');
  const root = createRoot(rootNode);
  const trips = Array.from({ length: 40 }, (_, index) => journey(index));
  const gap = trips[0].points;
  const renderList = () => root.render(React.createElement(bundled.JourneyCards, {
    journeys: trips,
    open: null,
    selectedId: null,
    onSelect: () => {},
    onPlay: () => {},
  }));
  const started = performance.now();
  await act(async () => {
    renderList();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
  const mountMs = performance.now() - started;
  const maps = document.querySelectorAll('.leaflet-container').length;
  const sketches = document.querySelectorAll('svg').length;
  console.log(`records 40 cards mount ${mountMs.toFixed(1)}ms; leaflet ${maps}; svg ${sketches}; cap ${bundled.RECORD_PREVIEW_MAP_CAP}`);
  assert.ok(maps >= 1 && maps <= bundled.RECORD_PREVIEW_MAP_CAP, `leaflet maps ${maps}`);
  assert.ok(sketches >= 40 - bundled.RECORD_PREVIEW_MAP_CAP, `svg sketches ${sketches}`);
  assert.equal(gap.length, 200);
  const preview = document.querySelector('[data-preview]')?.dataset.preview || '';
  const vertices = preview.split(' ').filter((item) => item.includes(','));
  assert.ok(vertices.length >= 2 && vertices.length <= 80, preview);
  assert.equal(preview.includes(';'), false);
  assert.ok(preview.includes(gap[0].lat.toFixed(5)));
  assert.ok(preview.includes(gap[gap.length - 1].lng.toFixed(5)));
  const listenersAfterMount = window.__windowListeners.size;
  let timersAfterClose = 0;
  for (let round = 0; round < 8; round += 1) {
    await act(async () => {
      renderList();
    });
    await act(async () => {
      root.render(React.createElement('div'));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    assert.equal(document.querySelectorAll('.leaflet-container').length, 0, `round ${round} leaked a map`);
    timersAfterClose = window.__pendingTimers.size;
  }
  const listenersAfterClose = window.__windowListeners.size;
  console.log(`after 8 close cycles timers ${timersAfterClose}; window listeners mount ${listenersAfterMount} close ${listenersAfterClose}`);
  assert.ok(listenersAfterClose <= listenersAfterMount, `listeners grew ${listenersAfterMount} -> ${listenersAfterClose}`);
  assert.ok(timersAfterClose < 8, `timers left ${timersAfterClose}`);

  let fail = true;
  function Boom() {
    if (fail) throw new Error('records render');
    return React.createElement('p', null, '여정이 보입니다');
  }
  const errors = console.error;
  console.error = () => {};
  try {
    await act(async () => {
      root.render(React.createElement(bundled.RecordsBoundary, null, React.createElement(Boom)));
    });
  } finally {
    console.error = errors;
  }
  assert.match(document.body.textContent, /기록을 열지 못했습니다/);
  assert.equal(document.body.textContent.includes('여정이 보입니다'), false);
  fail = false;
  await act(async () => {
    document.querySelector('button').click();
  });
  assert.match(document.body.textContent, /여정이 보입니다/);
  await act(async () => {
    root.unmount();
  });
  assert.equal(document.querySelectorAll('.leaflet-container').length, 0);
});
