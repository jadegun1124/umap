import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAP_LAND_COLOR, VWORLD_TILE_ORIGIN, baseTileLayerOptions } from './mapTiles.mjs';

function text(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('base tiles keep loading during a pan and prefetch a buffer', () => {
  const options = baseTileLayerOptions();
  assert.equal(options.updateWhenIdle, false);
  assert.equal(options.updateWhenZooming, true);
  assert.ok(options.keepBuffer >= 4);
  assert.ok(options.updateInterval > 0 && options.updateInterval <= 100);
  assert.equal(options.maxNativeZoom, 19);
  assert.equal(options.maxZoom, 19);
  assert.equal(MAP_LAND_COLOR, '#efe6d6');
  assert.equal(VWORLD_TILE_ORIGIN, 'https://api.vworld.kr');
  assert.equal(JSON.stringify(options).includes('apiKey'), false);
});

test('the map, the shell, and the worker apply that tile policy', () => {
  const map = text('../components/family/StreetMap.tsx');
  const cards = text('../components/family/JourneyCards.tsx');
  const css = text('../index.css');
  const html = text('../../index.html');
  const worker = text('../../public/sw.js');
  const activity = text('../../android/app/src/main/java/kr/co/umap/tracker/MainActivity.java');
  assert.match(map, /baseTileLayerOptions\(\)/);
  assert.match(cards, /baseTileLayerOptions\(\)/);
  assert.match(css, new RegExp(MAP_LAND_COLOR.replace('#', '\\#')));
  assert.match(html, /rel="preconnect" href="https:\/\/api\.vworld\.kr"/);
  assert.match(html, /rel="dns-prefetch" href="https:\/\/api\.vworld\.kr"/);
  assert.match(worker, /umap-tiles-v1/);
  assert.match(worker, /api\.vworld\.kr/);
  assert.equal(worker.includes('console.log'), false);
  assert.match(activity, /setCacheMode\(WebSettings\.LOAD_DEFAULT\)/);
  assert.match(map, /syncCalloutGeometry/);
  assert.match(map, /pinch/);
  const screen = text('../components/family/FamilyMapScreen.tsx');
  assert.match(screen, /bottom-36/);
  assert.equal(screen.includes('top-[38%]'), false);
});
