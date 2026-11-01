import assert from 'node:assert/strict';
import test from 'node:test';
import { memberPlaceLabel } from './memberPlace.mjs';
import { choosePlaceLabel, formatPrecisePlace, NOMINATIM_USER_AGENT, nominatimAddress, placeGridKey, presentPlace, reverseGeocode, reverseGeocodeCached, shortenAddress } from './placeGeocode.mjs';
import { labelCoordinate, stayLabelPoint } from './tracking.mjs';

const SUTAEK = {
  display_name: '수택동, 구리시, 경기도, 11932, 대한민국',
  address: { quarter: '수택동', city: '구리시', province: '경기도' },
};

function jsonResponse(body, ok = true) {
  return { ok, json: async () => body };
}

test('place labels refresh about every 30m and stay inside one cell for a shorter step', () => {
  const step = 30 / 111_320;
  const center = Math.round(37.6365 / step) * step;
  const here = placeGridKey(center, 127.0678);
  assert.equal(placeGridKey(center + step * 0.2, 127.0678), here);
  assert.notEqual(placeGridKey(center + step * 1.2, 127.0678), here);
});

test('shortenAddress keeps the city and neighborhood and drops 근처', () => {
  assert.equal(shortenAddress('경기도 구리시 수택동 12-3'), '구리시 수택동');
  assert.equal(shortenAddress('수택동, 구리시, 경기도, 11932, 대한민국'), '구리시 수택동');
  assert.equal(shortenAddress('경기도 남양주시 다산동'), '남양주시 다산동');
  assert.equal(shortenAddress('근처'), '');
  assert.equal(shortenAddress('근처 근처'), '');
});

test('a Nominatim body becomes 구리시 수택동', () => {
  assert.equal(nominatimAddress(SUTAEK), '구리시 수택동');
  assert.equal(nominatimAddress({ display_name: '다산동, 남양주시, 경기도' }), '남양주시 다산동');
  assert.equal(nominatimAddress({
    display_name: '3404, 29, 다산중앙로123번길, 지막, 다산1동, 남양주시, 경기도, 12248, 대한민국',
    address: { hamlet: '지막', city_district: '다산1동', city: '남양주시', province: '경기도' },
  }), '다산중앙로123번길 29');
});

test('formatPrecisePlace keeps an apartment and a shop, and presentPlace does not strip them', () => {
  assert.equal(formatPrecisePlace({
    dong: '하계동',
    building: '하계1차청구아파트',
    unit: '104',
  }), '하계1차청구아파트 104동');
  assert.equal(formatPrecisePlace({ dong: '다산2동', poi: '이마트' }), '이마트');
  assert.equal(formatPrecisePlace({ dong: '수택동' }), '');
  assert.equal(presentPlace('하계1차청구아파트 104동'), '하계1차청구아파트 104동');
  assert.equal(presentPlace('경기도 구리시 수택동 12-3'), '구리시 수택동');
  assert.equal(presentPlace('근처'), '');
  assert.equal(String(formatPrecisePlace({ dong: '하계동', building: '청구아파트', unit: '104동' })).includes('근처'), false);
});

test('a missing VWorld key uses Nominatim and never says 근처', async () => {
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(String(url));
    if (String(url).includes('nominatim.openstreetmap.org')) {
      assert.equal(init.headers['User-Agent'], NOMINATIM_USER_AGENT);
      assert.equal(init.headers['Accept-Language'], undefined);
      assert.match(String(url), /accept-language=ko/);
      assert.match(String(url), /namedetails=1/);
      return jsonResponse(SUTAEK);
    }
    return jsonResponse({ elements: [] });
  };
  const label = await reverseGeocode(37.5942, 127.1432, { fetch: fetchImpl, key: '', pace: false });
  assert.equal(label, '구리시 수택동');
  assert.equal(urls.some((url) => url.includes('vworld')), false);
  assert.equal(String(label).includes('근처'), false);
});

test('VWorld is primary and Nominatim covers a failed VWorld response', async () => {
  const urls = [];
  const vworldThenOsm = async (url) => {
    urls.push(String(url));
    if (String(url).includes('vworld.kr')) {
      return jsonResponse({ response: { result: [{ text: '서울특별시 노원구 하계동 273' }] } });
    }
    if (String(url).includes('nominatim.openstreetmap.org')) {
      return jsonResponse({
        display_name: '하계1차청구아파트, 하계동, 노원구, 서울',
        address: { building: '하계1차청구아파트', suburb: '하계동', borough: '노원구' },
        namedetails: { name: '하계1차청구아파트' },
      });
    }
    return jsonResponse({ elements: [] });
  };
  const label = await reverseGeocode(37.6362, 127.0675, { fetch: vworldThenOsm, key: 'test-key', pace: false });
  assert.equal(label, '하계1차청구아파트');
  assert.equal(urls.some((url) => String(url).includes('type=ROAD')), true);
  assert.equal(urls.some((url) => String(url).includes('type=PARCEL')), true);

  const recoveredUrls = [];
  const fallback = async (url) => {
    recoveredUrls.push(String(url));
    if (String(url).includes('vworld.kr')) return jsonResponse({ response: { status: 'ERROR' } }, false);
    return jsonResponse(SUTAEK);
  };
  const recovered = await reverseGeocode(37.5942, 127.1432, { fetch: fallback, key: 'test-key', pace: false });
  assert.equal(recovered, '구리시 수택동');
  assert.equal(recoveredUrls.some((url) => url.includes('nominatim.openstreetmap.org')), true);
  assert.equal(recovered.includes('근처'), false);
});

test('VWorld building layer becomes an apartment and 동 number', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('LT_C_BLDGINFO')) {
      return jsonResponse({
        response: {
          result: {
            featureCollection: {
              features: [{ properties: { buld_nm: '하계1차청구아파트', dong_nm: '104동' } }],
            },
          },
        },
      });
    }
    if (String(url).includes('vworld.kr')) {
      return jsonResponse({
        response: {
          result: [{
            text: '서울특별시 노원구 하계동',
            structure: { level2: '노원구', level4L: '하계동' },
          }],
        },
      });
    }
    return jsonResponse({ elements: [] });
  };
  const label = await reverseGeocode(37.6362, 127.0675, { fetch: fetchImpl, key: 'test-key', pace: false });
  assert.equal(label, '하계1차청구아파트 104동');
  assert.equal(String(label).includes('근처'), false);
});

test('a browser that refuses User-Agent still receives the neighborhood', async () => {
  let calls = 0;
  const fetchImpl = async (_url, init) => {
    calls += 1;
    if (init.headers && init.headers['User-Agent']) throw new TypeError('Refused to set unsafe header "User-Agent"');
    return jsonResponse({ display_name: '다산동, 남양주시, 경기도' });
  };
  const label = await reverseGeocode(37.6, 127.15, { fetch: fetchImpl, key: '', pace: false });
  assert.equal(label, '남양주시 다산동');
  assert.ok(calls >= 2);
  assert.equal(label.includes('근처'), false);
});

test('an apartment polygon beats the fire station next door', async () => {
  const hagye = { lat: 37.6365, lng: 127.0680 };
  const fire = { lat: 37.6354, lng: 127.0678 };
  const apartment = {
    name: '하계1차청구아파트',
    unit: '104동',
    kind: 'residential',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [127.0672, 37.6372],
        [127.0688, 37.6372],
        [127.0688, 37.6358],
        [127.0672, 37.6358],
        [127.0672, 37.6372],
      ]],
    },
  };
  const station = { name: '노원소방서', kind: 'poi', lat: fire.lat, lng: fire.lng };
  assert.equal(choosePlaceLabel([station, apartment], hagye), '하계1차청구아파트 104동');
  assert.equal(choosePlaceLabel([station, apartment], { lat: 37.6359, lng: 127.0680 }), '하계1차청구아파트 104동');
  assert.equal(choosePlaceLabel([station, apartment], { lat: 37.63585, lng: 127.0680 }), '하계1차청구아파트 104동');
  assert.equal(choosePlaceLabel([station, apartment], { lat: 37.6353, lng: 127.0680 }), '노원소방서');
  const stationBuilding = {
    name: '노원소방서',
    kind: 'poi',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [127.0676, 37.63555],
        [127.0682, 37.63555],
        [127.0682, 37.63515],
        [127.0676, 37.63515],
        [127.0676, 37.63555],
      ]],
    },
  };
  assert.equal(choosePlaceLabel([stationBuilding, apartment], { lat: 37.63535, lng: 127.0679 }), '노원소방서');
  assert.equal(String(choosePlaceLabel([station, apartment], hagye)).includes('소방서'), false);

  const fetchImpl = async (url) => {
    if (String(url).includes('LT_C_BLDGINFO')) {
      return jsonResponse({
        response: {
          result: {
            featureCollection: {
              features: [
                { properties: { buld_nm: '노원소방서' }, geometry: { type: 'Point', coordinates: [fire.lng, fire.lat] } },
                { properties: { buld_nm: '하계1차청구아파트', dong_nm: '104동' }, geometry: apartment.geometry },
              ],
            },
          },
        },
      });
    }
    if (String(url).includes('vworld.kr')) {
      return jsonResponse({ response: { result: [{ text: '서울특별시 노원구 하계동' }] } });
    }
    if (String(url).includes('nominatim.openstreetmap.org')) {
      return jsonResponse({
        display_name: '노원소방서, 하계동, 노원구, 서울',
        address: { amenity: '노원소방서', suburb: '하계동', borough: '노원구' },
        namedetails: { name: '노원소방서' },
      });
    }
    return jsonResponse({
      elements: [
        { type: 'node', lat: fire.lat, lon: fire.lng, tags: { name: '노원소방서', amenity: 'fire_station' } },
        { type: 'way', tags: { name: '하계1차청구아파트', building: 'apartments', ref: '104동' }, geometry: apartment.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lon: lng })) },
      ],
    });
  };
  const label = await reverseGeocode(hagye.lat, hagye.lng, { fetch: fetchImpl, key: 'test-key', pace: false });
  assert.equal(label, '하계1차청구아파트 104동');
  assert.equal(String(label).includes('소방서'), false);
  const yard = await reverseGeocode(37.6353, 127.0680, { fetch: fetchImpl, key: 'test-key', pace: false });
  assert.equal(yard, '노원소방서');

  const jitter = [
    { lat: 37.6366, lng: 127.0679, at: 1, staying: true },
    { lat: 37.6364, lng: 127.0681, at: 2, staying: true },
    { lat: 37.6365, lng: 127.0680, at: 3, staying: true },
    { lat: fire.lat, lng: fire.lng, at: 4, staying: true },
  ];
  const snapped = stayLabelPoint(jitter, fire, false);
  assert.ok(snapped);
  assert.ok(Math.abs(snapped.lat - 37.63625) < 0.002);
  const snappedLabel = choosePlaceLabel([station, apartment], snapped);
  assert.equal(snappedLabel, '하계1차청구아파트 104동');
  const accurate = jitter.map((point, index) => ({ ...point, accuracyM: index === jitter.length - 1 ? 55 : 12, staying: true }));
  const namedAt = labelCoordinate(accurate, { ...fire, accuracyM: 55 }, false);
  assert.equal(choosePlaceLabel([station, apartment], namedAt), '하계1차청구아파트 104동');
  const closed = [
    { lat: 37.6365, lng: 127.0680, at: 1, staying: true, accuracyM: 12, stayEnd: true },
    { lat: fire.lat, lng: fire.lng, at: 2, staying: true, accuracyM: 55 },
  ];
  assert.equal(labelCoordinate(closed, { ...fire, accuracyM: 55 }, false).lat, 37.6365);
});

test('a fix inside 하계1차청구아파트 near 노원소방서 keeps the complex and 동', async () => {
  // Nominatim reverse on 2026-10-31 named this south-edge point 노원소방서.
  // The point is inside the 하계청구아파트 landuse and outside the fire station.
  const inside = { lat: 37.6386, lng: 127.0712 };
  const fire = { lat: 37.6385019, lng: 127.070962 };
  const complex = {
    name: '하계1차청구아파트',
    kind: 'residential',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [127.0706087, 37.6393963],
        [127.0706822, 37.6392001],
        [127.0709294, 37.6386864],
        [127.071066, 37.638725],
        [127.071409, 37.6379255],
        [127.072104, 37.638076],
        [127.072057, 37.638387],
        [127.072393, 37.638424],
        [127.072347, 37.638986],
        [127.072739, 37.639082],
        [127.072672, 37.639308],
        [127.072283, 37.639768],
        [127.072573, 37.639916],
        [127.072204, 37.6406],
        [127.070874, 37.640216],
        [127.070751, 37.640169],
        [127.0706087, 37.6393963],
      ]],
    },
  };
  const dong = {
    name: '하계1차청구아파트',
    unit: '103동',
    kind: 'residential',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [127.07105, 37.63845],
        [127.07135, 37.63845],
        [127.07135, 37.63875],
        [127.07105, 37.63875],
        [127.07105, 37.63845],
      ]],
    },
  };
  const station = {
    name: '노원소방서',
    kind: 'poi',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [127.0708, 37.63842],
        [127.07105, 37.63842],
        [127.07105, 37.63858],
        [127.0708, 37.63858],
        [127.0708, 37.63842],
      ]],
    },
  };
  assert.equal(choosePlaceLabel([station, complex, dong], inside), '하계1차청구아파트 103동');
  assert.equal(choosePlaceLabel([station, complex], inside), '하계1차청구아파트');
  assert.equal(choosePlaceLabel([station, complex], fire), '노원소방서');

  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('nominatim.openstreetmap.org')) {
      return jsonResponse({
        display_name: '노원소방서, 8, 한글비석로1길, 하계동, 하계1동, 노원구, 서울특별시, 01791, 대한민국',
        address: { amenity: '노원소방서', suburb: '하계1동', borough: '노원구' },
        namedetails: { name: '노원소방서' },
        geojson: station.geometry,
      });
    }
    if (target.includes('overpass')) {
      return jsonResponse({
        elements: [
          { type: 'node', lat: fire.lat, lon: fire.lng, tags: { name: '노원소방서', amenity: 'fire_station' } },
          {
            type: 'way',
            tags: { name: '하계1차청구아파트', landuse: 'residential', building: 'apartments' },
            geometry: complex.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lon: lng })),
          },
          {
            type: 'way',
            tags: { name: '하계1차청구아파트', building: 'apartments', ref: '103동' },
            geometry: dong.geometry.coordinates[0].map(([lng, lat]) => ({ lat, lon: lng })),
          },
        ],
      });
    }
    return jsonResponse({ response: { result: [{ text: '서울특별시 노원구 하계동' }] } });
  };
  const label = await reverseGeocode(inside.lat, inside.lng, { fetch: fetchImpl, key: '', pace: false });
  assert.equal(label, '하계1차청구아파트 103동');
  assert.equal(String(label).includes('소방서'), false);

  const slow = async (url) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return fetchImpl(url);
  };
  const poiOnly = async (url) => {
    if (String(url).includes('nominatim')) {
      return jsonResponse({
        display_name: '노원소방서',
        address: { amenity: '노원소방서' },
        namedetails: { name: '노원소방서' },
        geojson: station.geometry,
      });
    }
    throw new Error('overpass down');
  };
  const [apartment, poi] = await Promise.all([
    reverseGeocodeCached(inside.lat, inside.lng, { fetch: slow, key: '', pace: false }),
    reverseGeocodeCached(fire.lat, fire.lng, { fetch: poiOnly, key: '', pace: false }),
  ]);
  assert.equal(apartment.label, '하계1차청구아파트 103동');
  assert.equal(apartment.settled, true);
  assert.equal(poi.label, '노원소방서');
  assert.equal(poi.settled, false);
});

test('a pin beside 105동 ranks the building edge ahead of a southern fire station', () => {
  // West of 105동 and 104동, on the road. The complex centroid is farther
  // from this pin than 노원소방서, which sits well south of the complex.
  const pin = { lat: 37.6372, lng: 127.07085 };
  const centroid = { name: '하계1차청구아파트', kind: 'residential', lat: 37.63755, lng: 127.07135 };
  const station = { name: '노원소방서', kind: 'poi', lat: 37.63695, lng: 127.07085 };
  const box = (west, south, east, north) => ({
    type: 'Polygon',
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  });
  const dong105 = {
    name: '하계1차청구아파트',
    unit: '105동',
    kind: 'residential',
    geometry: box(127.07095, 37.63705, 127.07125, 37.63735),
  };
  const dong104 = {
    name: '하계1차청구아파트',
    unit: '104동',
    kind: 'residential',
    geometry: box(127.07095, 37.6367, 127.07125, 37.63698),
  };
  assert.equal(choosePlaceLabel([centroid, station], pin), '노원소방서');
  assert.equal(choosePlaceLabel([centroid, station, dong104, dong105], pin), '하계1차청구아파트 105동');
  const church = { name: '만나교회', kind: 'poi', lat: pin.lat, lng: pin.lng };
  assert.equal(choosePlaceLabel([church, dong105], pin), '만나교회');
  const shortDong = { ...dong105, name: '하계청구아파트' };
  const longerShell = {
    name: '하계1차청구아파트',
    kind: 'residential',
    landuse: 'residential',
    geometry: box(127.0707, 37.6366, 127.0716, 37.6376),
  };
  assert.equal(choosePlaceLabel([centroid, station, shortDong, longerShell], pin), '하계1차청구아파트 105동');
  const only105 = { name: '105동', kind: 'residential', geometry: dong105.geometry };
  const only104 = { name: '104동', kind: 'residential', geometry: dong104.geometry };
  const shortComplex = { name: '하계청구아파트', kind: 'residential', lat: 37.6374, lng: 127.0712 };
  const spaced = { name: '하계 1차청구아파트', kind: 'residential', lat: 37.63735, lng: 127.07115 };
  assert.equal(choosePlaceLabel([shortComplex, spaced, only104, only105], pin), '하계 1차청구아파트 105동');
  const second = { name: '하계 2차청구아파트', kind: 'residential', lat: 37.63745, lng: 127.0713 };
  const first = { name: '하계1차청구아파트', kind: 'residential', lat: pin.lat, lng: pin.lng + 0.0002 };
  assert.equal(choosePlaceLabel([second, first, only105], pin), '하계1차청구아파트 105동');
  const full = { name: '하계1차청구아파트 105동', kind: 'residential', geometry: dong105.geometry };
  assert.equal(choosePlaceLabel([station, full], pin), '하계1차청구아파트 105동');
  const onlyNumber105 = { name: '105', buildingType: 'apartments', kind: 'residential', geometry: dong105.geometry };
  const onlyNumber104 = { name: '104', buildingType: 'apartments', kind: 'residential', geometry: dong104.geometry };
  const shell = {
    name: '하계청구아파트',
    kind: 'residential',
    landuse: 'residential',
    geometry: box(127.0704, 37.6365, 127.0718, 37.6378),
  };
  assert.equal(choosePlaceLabel([shell, station, onlyNumber104, onlyNumber105], pin), '하계청구아파트 105동');
});

test('a previous cache generation does not keep the short complex name', async () => {
  const pin = { lat: 37.6372, lng: 127.07085 };
  const key = placeGridKey(pin.lat, pin.lng);
  const saved = globalThis.localStorage;
  const store = new Map([['umap_geocode_cache_v8', JSON.stringify({ [key]: '하계청구아파트' })]]);
  globalThis.localStorage = {
    getItem: (id) => (store.has(id) ? store.get(id) : null),
    setItem: (id, value) => { store.set(id, value); },
  };
  let called = 0;
  try {
    await reverseGeocodeCached(pin.lat, pin.lng, {
      fetch: async () => {
        called += 1;
        return { ok: false, json: async () => null };
      },
      key: '',
      kakaoKey: '',
      pace: false,
    });
  } finally {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  }
  assert.equal(called > 0, true);
});

test('a point beside a church on a 길 uses the place or the road, not 구·동', async () => {
  const church = { lat: 37.63142, lng: 127.06518 };
  const pin = { lat: 37.6314, lng: 127.0651 };
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('vworld.kr') && target.includes('getAddress')) {
      return jsonResponse({
        response: {
          result: [{
            text: '서울특별시 노원구 월계3동 마들로3길 15',
            structure: { level2: '노원구', level4A: '월계3동', level4L: '마들로3길', level5: '15' },
          }],
        },
      });
    }
    if (target.includes('LT_C_BLDGINFO')) return jsonResponse({ response: { result: { featureCollection: { features: [] } } } });
    if (target.includes('nominatim.openstreetmap.org')) {
      return jsonResponse({
        display_name: '월계3동, 노원구, 서울특별시',
        address: { suburb: '월계3동', borough: '노원구', city: '서울특별시' },
      });
    }
    if (target.includes('overpass')) {
      return jsonResponse({
        elements: [
          { type: 'node', lat: church.lat, lon: church.lng, tags: { name: '만나교회', amenity: 'place_of_worship' } },
        ],
      });
    }
    return jsonResponse({ elements: [] });
  };
  const beside = await reverseGeocode(pin.lat, pin.lng, { fetch: fetchImpl, key: 'test-key', pace: false });
  assert.match(beside, /만나교회|마들로3길 15/);
  assert.equal(beside, '만나교회');
  const roadOnly = async (url) => {
    if (String(url).includes('overpass')) return jsonResponse({ elements: [] });
    return fetchImpl(url);
  };
  const road = await reverseGeocode(pin.lat, pin.lng, { fetch: roadOnly, key: 'test-key', pace: false });
  assert.equal(road, '마들로3길 15');
  assert.equal(road.includes('월계3동'), false);
  const farComplex = async (url) => {
    const target = String(url);
    if (target.includes('LT_C_BLDGINFO')) {
      return jsonResponse({
        response: {
          result: {
            featureCollection: {
              features: [{
                properties: { buld_nm: '하계1차청구아파트', dong_nm: '101동' },
                geometry: { type: 'Point', coordinates: [127.0672, 37.6314] },
              }],
            },
          },
        },
      });
    }
    if (target.includes('nominatim')) {
      return jsonResponse({
        display_name: '마들로3길, 월계3동, 노원구',
        address: { road: '마들로3길', suburb: '월계3동', borough: '노원구' },
      });
    }
    if (target.includes('overpass')) return jsonResponse({ elements: [] });
    return fetchImpl(url);
  };
  const keptNumber = await reverseGeocode(pin.lat, pin.lng, { fetch: farComplex, key: 'test-key', pace: false });
  assert.equal(keptNumber, '마들로3길 15');
});

test('reverse geocode of the 105동 west edge does not keep 노원소방서', async () => {
  const pin = { lat: 37.6372, lng: 127.07085 };
  const station = { lat: 37.6354, lng: 127.0711 };
  const box = (west, south, east, north) => ([[
    [west, south], [east, south], [east, north], [west, north], [west, south],
  ]]);
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.includes('LT_C_BLDGINFO')) {
      return jsonResponse({
        response: {
          result: {
            featureCollection: {
              features: [
                { properties: { buld_nm: '하계1차청구아파트', dong_nm: '105동' }, geometry: { type: 'Polygon', coordinates: box(127.07095, 37.63705, 127.07125, 37.63735) } },
                { properties: { buld_nm: '하계1차청구아파트', dong_nm: '104동' }, geometry: { type: 'Polygon', coordinates: box(127.07095, 37.6367, 127.07125, 37.63698) } },
                { properties: { buld_nm: '노원소방서' }, geometry: { type: 'Point', coordinates: [station.lng, station.lat] } },
              ],
            },
          },
        },
      });
    }
    if (target.includes('vworld.kr')) {
      return jsonResponse({ response: { result: [{ text: '서울특별시 노원구 하계동', structure: { level2: '노원구', level4L: '하계동' } }] } });
    }
    if (target.includes('nominatim')) {
      return jsonResponse({
        lat: String(station.lat),
        lon: String(station.lng),
        display_name: '노원소방서, 하계동, 노원구, 서울',
        address: { amenity: '노원소방서', suburb: '하계동', borough: '노원구' },
        namedetails: { name: '노원소방서' },
      });
    }
    if (target.includes('kakao.com')) {
      return jsonResponse({
        documents: [{
          road_address: { building_name: '다른아파트', road_name: '하계로', main_building_no: '9', region_3depth_name: '하계동' },
          address: { region_3depth_name: '하계동' },
        }],
      });
    }
    return jsonResponse({ elements: [] });
  };
  const label = await reverseGeocode(pin.lat, pin.lng, { fetch: fetchImpl, key: 'test-key', kakaoKey: 'kakao', pace: false });
  assert.equal(label, '하계1차청구아파트 105동');
});

test('family card status starts with the neighborhood, never 근처', () => {
  const line = (place, live) => [memberPlaceLabel({ place, located: true }), live].filter(Boolean).join(' · ');
  assert.equal(line('구리시 수택동', '지금'), '구리시 수택동 · 지금');
  assert.equal(line('남양주시 다산동', '머무름'), '남양주시 다산동 · 머무름');
  assert.equal(line('근처', '머무름'), '머무름');
  assert.equal(line('근처', '지금').includes('근처'), false);
  assert.equal(line('구리시 수택동', '지금').startsWith('구리시 수택동'), true);
  assert.equal(line('', '지금').includes('근처'), false);
});
