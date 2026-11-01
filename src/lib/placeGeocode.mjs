// Reverse geocode for the family card. This runs on the phone. The family
// server never receives the coordinate for a place name.
// VWorld is first when VITE_VWORLD_API_KEY is set. A building layer, and Kakao
// when VITE_KAKAO_REST_API_KEY is set, add an apartment or POI name.
// Nominatim covers a missing key and a failed VWorld response. Overpass fills
// a named building only when the address is still just a neighborhood.
// The literal place label 「근처」 is never returned.

import { APP_VERSION_NAME } from './appRelease.mjs';

const NOMINATIM_UA = `Kinnex/${APP_VERSION_NAME} (family location; https://github.com/jadegun1124/umap)`;
const CACHE_KEY = 'umap_geocode_cache_v8';
const PLACE_LIMIT = 56;
/** Farther than this, a place is not the nearest label. Inside a polygon, distance is 0. */
export const NEAREST_PLACE_M = 80;
/** A fix on or just outside an apartment polygon still uses the complex, not the next POI. */
export const RESIDENTIAL_NEAR_M = 30;
const NOMINATIM_GAP_MS = 1100;
let nominatimNotBefore = 0;

const DONG_KEYS = ['quarter', 'suburb', 'neighbourhood', 'village', 'hamlet', 'city_district'];
const DISTRICT_KEYS = ['borough', 'city', 'town', 'county', 'municipality'];

function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function readEnvKey(env, name) {
  const key = String(env && env[name] ? env[name] : '').trim();
  if (!key || key === 'undefined' || key === 'null') return '';
  return key;
}

export function readVworldKey(env = import.meta.env) {
  return readEnvKey(env, 'VITE_VWORLD_API_KEY');
}

export function readKakaoKey(env = import.meta.env) {
  return readEnvKey(env, 'VITE_KAKAO_REST_API_KEY');
}

export function shortenAddress(text) {
  const clean = String(text || '').trim().replace(/[,，]/g, ' ').replace(/\s+/g, ' ');
  if (!clean || clean === '근처') return '';
  const road = extractRoadAddress(clean);
  if (road) return road;
  const parts = clean.split(' ').filter((part) => part && part !== '근처');
  const district = parts.find((part) => /(?:시|군|구)$/.test(part) && !/특별|광역|자치/.test(part));
  const dong = parts.find((part) => /(?:동|읍|면|리|가)$/.test(part));
  if (district && dong) return `${district} ${dong}`;
  if (district) return district;
  const joined = parts.join(' ');
  if (!joined || joined === '근처') return '';
  return joined.length > 28 ? `${joined.slice(0, 28)}…` : joined;
}

const PRECISE_WORD = /(?:아파트|단지|빌라|맨션|오피스텔|타운|하우스|마트|백화점|슈퍼|편의점|학교|병원|의원|약국|공원|회관|센터|교회|성당|사찰|역사|역$)/;
const RESIDENTIAL_NAME = /(?:아파트|단지|빌라|맨션|오피스텔|타운하우스|주공|휴먼시아|주택)/;
const RESIDENTIAL_BUILDING = /^(?:apartments|residential|apart|house|dormitory)$/i;
const RESIDENTIAL_LANDUSE = /residential/i;
const POI_NAME = /(?:소방서|파출소|지구대|경찰서|병원|의원|약국|학교|마트|백화점|편의점|공원|주유소|시청|구청|도서관)/;

function cleanToken(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text || text === '근처') return '';
  return text;
}

function isPrecisePlace(text) {
  return PRECISE_WORD.test(text) || /\d+\s*동/.test(text) || Boolean(extractRoadAddress(text));
}

function formatUnit(value) {
  const text = cleanToken(value);
  if (!text) return '';
  if (/^\d+\s*동$/.test(text)) return text.replace(/\s+/g, '');
  if (/^\d+$/.test(text)) return `${text}동`;
  return '';
}

/** Apartment + 동, or a named POI. A plain 구·동 address returns empty. */
export function formatPrecisePlace(parts = {}) {
  const dong = cleanToken(parts.dong);
  const building = cleanToken(parts.building);
  const unit = formatUnit(parts.unit);
  const poi = cleanToken(parts.poi);
  if (building) return [building, unit].filter(Boolean).join(' ').slice(0, PLACE_LIMIT);
  if (poi && poi !== dong) return poi.slice(0, PLACE_LIMIT);
  return '';
}

function metersBetween(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return Infinity;
  const radius = 6_371_000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function ringOf(value) {
  if (!Array.isArray(value) || value.length < 3) return [];
  const ring = [];
  for (const item of value) {
    if (Array.isArray(item) && Number.isFinite(Number(item[0])) && Number.isFinite(Number(item[1]))) {
      ring.push({ lng: Number(item[0]), lat: Number(item[1]) });
      continue;
    }
    if (item && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
      ring.push({ lat: item.lat, lng: item.lon });
      continue;
    }
    if (item && Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      ring.push({ lat: item.lat, lng: item.lng });
    }
  }
  return ring.length >= 3 ? ring : [];
}

export function geometryRings(geometry) {
  if (!geometry) return [];
  if (Array.isArray(geometry)) {
    if (geometry[0] && (Number.isFinite(geometry[0].lat) || Array.isArray(geometry[0]))) {
      const ring = ringOf(geometry);
      return ring.length ? [ring] : [];
    }
    return geometry.flatMap((item) => geometryRings(item));
  }
  if (typeof geometry !== 'object') return [];
  if (geometry.type === 'Polygon') return (geometry.coordinates || []).map(ringOf).filter((ring) => ring.length);
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates || []).flatMap((polygon) => (Array.isArray(polygon) ? polygon : []).map(ringOf)).filter((ring) => ring.length);
  }
  if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
    const lng = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [[{ lat, lng }]] : [];
  }
  if (Array.isArray(geometry.coordinates) && (geometry.type === 'Polygon' || !geometry.type)) {
    return geometryRings({ type: 'Polygon', coordinates: geometry.coordinates });
  }
  if (Array.isArray(geometry.geometry)) return geometryRings(geometry.geometry);
  return [];
}

export function pointInRing(point, ring) {
  if (!point || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const crosses = ((a.lat > point.lat) !== (b.lat > point.lat))
      && (point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / ((b.lat - a.lat) || 1e-12) + a.lng);
    if (crosses) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point, a, b) {
  const toX = (lng) => (lng - point.lng) * 111_320 * Math.cos((point.lat * Math.PI) / 180);
  const toY = (lat) => (lat - point.lat) * 111_320;
  const ax = toX(a.lng);
  const ay = toY(a.lat);
  const bx = toX(b.lng);
  const by = toY(b.lat);
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx + -ay * dy) / length));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

export function distanceToGeometry(point, geometry) {
  const rings = geometryRings(geometry);
  if (!rings.length) {
    const center = geometry && Number.isFinite(geometry.lat) && Number.isFinite(geometry.lng) ? geometry : null;
    return center ? metersBetween(point, center) : Infinity;
  }
  if (rings.length === 1 && rings[0].length === 1) return metersBetween(point, rings[0][0]);
  let inside = false;
  let nearest = Infinity;
  for (const ring of rings) {
    if (ring.length >= 3 && pointInRing(point, ring)) inside = true;
    for (let index = 0; index < ring.length; index += 1) {
      nearest = Math.min(nearest, distanceToSegment(point, ring[index], ring[(index + 1) % ring.length]));
    }
  }
  return inside ? 0 : nearest;
}

export function isResidentialPlace(candidate) {
  if (!candidate) return false;
  if (candidate.kind === 'residential') return true;
  if (candidate.kind === 'poi') return false;
  const name = cleanToken(candidate.name || candidate.building);
  const building = cleanToken(candidate.buildingType || candidate.building);
  const landuse = cleanToken(candidate.landuse);
  if (RESIDENTIAL_NAME.test(name)) return true;
  if (RESIDENTIAL_BUILDING.test(building) && name) return true;
  if (RESIDENTIAL_LANDUSE.test(landuse) && name) return true;
  return false;
}

function candidateLabel(candidate) {
  const name = cleanToken(candidate.name || candidate.building);
  if (!name || isDong(name)) return '';
  if (isResidentialPlace(candidate)) return formatPrecisePlace({ building: name, unit: candidate.unit });
  return formatPrecisePlace({ poi: name }) || name;
}

function polygonCovers(origin, geometry) {
  return geometryRings(geometry).some((ring) => ring.length >= 3 && pointInRing(origin, ring));
}

function geometryAreaM2(geometry) {
  const rings = geometryRings(geometry).filter((ring) => ring.length >= 3);
  if (!rings.length) return Infinity;
  let best = Infinity;
  for (const ring of rings) {
    let sum = 0;
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      const mid = ((a.lat + b.lat) / 2) * Math.PI / 180;
      const ax = a.lng * 111_320 * Math.cos(mid);
      const ay = a.lat * 110_540;
      const bx = b.lng * 111_320 * Math.cos(mid);
      const by = b.lat * 110_540;
      sum += ax * by - bx * ay;
    }
    best = Math.min(best, Math.abs(sum) / 2);
  }
  return best;
}

function measuredDistance(origin, candidate, geometry) {
  if (geometry) {
    const distance = distanceToGeometry(origin, geometry);
    if (Number.isFinite(distance)) return distance;
  }
  if (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng)) return metersBetween(origin, candidate);
  if (Number.isFinite(candidate.distanceM)) return candidate.distanceM;
  return Infinity;
}

export function choosePlaceLabel(candidates, point) {
  const origin = {
    lat: Number(point?.lat),
    lng: Number(point?.lng),
  };
  if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return '';
  const scored = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const label = candidateLabel(candidate);
    if (!label) continue;
    const geometry = candidate.geometry || (Number.isFinite(candidate.lat) && Number.isFinite(candidate.lng) ? candidate : null);
    const unit = formatUnit(candidate.unit);
    const residential = isResidentialPlace(candidate);
    const areaM2 = geometryAreaM2(geometry);
    const footprint = geometryRings(geometry).some((ring) => ring.length >= 3);
    scored.push({
      label,
      inside: footprint && polygonCovers(origin, geometry),
      dongBuilding: residential && Boolean(unit),
      landuseShell: residential && !unit && (RESIDENTIAL_LANDUSE.test(String(candidate.landuse || '')) || (footprint && areaM2 > 20_000)),
      areaM2,
      distanceM: measuredDistance(origin, candidate, geometry),
    });
  }
  const inRange = scored.filter((item) => item.distanceM <= NEAREST_PLACE_M);
  if (!inRange.length) return '';
  const dongs = inRange.filter((item) => item.dongBuilding);
  // A complex shell is one polygon. Its edge can sit nearer than a 동 wall
  // while the label would drop the 동. Rank each 동 footprint against POIs.
  const pool = dongs.length
    ? inRange.filter((item) => item.dongBuilding || !item.landuseShell)
    : inRange;
  pool.sort((left, right) => left.distanceM - right.distanceM || left.areaM2 - right.areaM2);
  return pool[0] ? pool[0].label : '';
}

/** Keep a building, a named place, or a road number. A bare 구·동 is only the last resort. */
export function presentPlace(text) {
  const clean = cleanToken(String(text || '').replace(/[,，]/g, ' '));
  if (!clean) return '';
  const road = extractRoadAddress(clean);
  if (road) return road.slice(0, PLACE_LIMIT);
  if (isPrecisePlace(clean)) return clean.slice(0, PLACE_LIMIT);
  return shortenAddress(clean);
}

function addressValues(address, keys) {
  if (!address || typeof address !== 'object') return [];
  const values = [];
  for (const key of keys) {
    const value = address[key];
    if (typeof value === 'string' && value.trim() && value.trim() !== '근처') values.push(value.trim());
  }
  return values;
}

function isDong(value) {
  return /(?:동|읍|면|리|가)$/.test(value);
}

function isRoadName(value) {
  return /(?:로|길)$/.test(value) && !isDong(value);
}

function houseNumber(value) {
  const text = cleanToken(value).replace(/\s+/g, '');
  if (!text || text === '0') return '';
  return /^\d+(?:-\d+)?$/.test(text) ? text : '';
}

/** "마들로3길 15". A road without a number is still closer than 구·동 alone. */
export function roadAddressLabel(road, number) {
  const name = cleanToken(road);
  if (!name || !isRoadName(name)) return '';
  const num = houseNumber(number);
  return num ? `${name} ${num}` : name;
}

export function extractRoadAddress(text) {
  const parts = cleanToken(String(text || '').replace(/[,，]/g, ' ')).split(' ').filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    if (!isRoadName(parts[index])) continue;
    const next = houseNumber(parts[index + 1]);
    if (next) return `${parts[index]} ${next}`;
    const prev = houseNumber(parts[index - 1]);
    if (prev) return `${parts[index]} ${prev}`;
    return parts[index];
  }
  return '';
}

function namedFromAddress(address, namedetails) {
  const sources = [address, namedetails];
  let building = '';
  let poi = '';
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['building', 'residential', 'apartments']) {
      const value = cleanToken(source[key]);
      if (value && !building) building = value;
    }
    for (const key of ['amenity', 'shop', 'tourism', 'leisure', 'office']) {
      const value = cleanToken(source[key]);
      if (value && !poi && !isDong(value)) poi = value;
    }
    const name = cleanToken(source.name);
    if (name && !isDong(name) && !/^(대한민국|한국)$/.test(name)) {
      if (PRECISE_WORD.test(name) && !building) building = name;
      else if (!poi) poi = name;
    }
  }
  return { building, poi };
}

export function nominatimAddress(body) {
  const address = body && typeof body === 'object' ? body.address : null;
  const district = addressValues(address, DISTRICT_KEYS).find((value) => /(?:시|군|구)$/.test(value) && !/특별|광역|자치/.test(value)) || '';
  const dong = addressValues(address, DONG_KEYS).find(isDong) || '';
  const named = namedFromAddress(address, body && body.namedetails);
  const precise = formatPrecisePlace({ dong, building: named.building, poi: named.poi });
  if (precise) return precise;
  const road = roadAddressLabel(address && address.road, address && address.house_number)
    || extractRoadAddress(body && typeof body.display_name === 'string' ? body.display_name : '');
  if (road) return road;
  const structured = shortenAddress([district, dong].filter(Boolean).join(' '));
  const display = shortenAddress(body && typeof body.display_name === 'string' ? body.display_name : '');
  const hasDong = (label) => isDong((label || '').split(' ').at(-1) || '');
  if (hasDong(structured)) return structured;
  if (hasDong(display)) return display;
  return structured || display;
}

export function vworldAddress(body) {
  const text = body && typeof body === 'object' ? body.response?.result?.[0]?.text : '';
  return shortenAddress(typeof text === 'string' ? text : '');
}

/** About 30m. The same cell keeps one label so a building next door can still refresh. */
export function placeGridKey(lat, lng) {
  const latStep = 30 / 111_320;
  const latNumber = Number(lat);
  const lngNumber = Number(lng);
  const latB = Math.round(latNumber / latStep) * latStep;
  const lngStep = latStep / Math.max(0.2, Math.cos((latB * Math.PI) / 180));
  const lngB = Math.round(lngNumber / lngStep) * lngStep;
  return `${latB.toFixed(5)},${lngB.toFixed(5)}`;
}

function storage() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readCache() {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const cache = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim() && value.trim() !== '근처') cache[key] = value;
    }
    return cache;
  } catch {
    return {};
  }
}

function writeCache(cache) {
  const store = storage();
  if (!store) return;
  try {
    const keys = Object.keys(cache);
    const trimmed = keys.length > 200
      ? Object.fromEntries(keys.slice(-200).map((key) => [key, cache[key]]))
      : cache;
    store.setItem(CACHE_KEY, JSON.stringify(trimmed));
  } catch {
    /* 저장 공간이 꽉 차도 주소 표시는 계속한다 */
  }
}

export function cachedAddress(lat, lng) {
  const hit = readCache()[placeGridKey(lat, lng)];
  const label = hit ? presentPlace(hit) : '';
  return label || null;
}

async function paceNominatim() {
  const now = Date.now();
  const wait = nominatimNotBefore - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  nominatimNotBefore = Date.now() + NOMINATIM_GAP_MS;
}

async function readJson(response) {
  if (!response || response.ok === false) return null;
  if (typeof response.json !== 'function') return null;
  return response.json();
}

function firstText(source, keys) {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = cleanToken(source[key]);
    if (value) return value;
  }
  return '';
}

function vworldStructure(body) {
  const item = body && body.response && Array.isArray(body.response.result) ? body.response.result[0] : null;
  const structure = item && item.structure && typeof item.structure === 'object' ? item.structure : {};
  const text = item && typeof item.text === 'string' ? item.text : '';
  const level4L = cleanToken(structure.level4L);
  const dong = [structure.level4A, structure.level4L, structure.level3].map(cleanToken).find(isDong) || '';
  const district = [structure.level2, structure.level3].map(cleanToken).find((value) => /(?:시|군|구)$/.test(value) && !/특별|광역|자치/.test(value)) || '';
  const fromText = buildingFromText(text);
  const detail = cleanToken(structure.detail);
  const detailBuilding = buildingFromText(detail);
  const road = roadAddressLabel(isRoadName(level4L) ? level4L : '', structure.level5)
    || extractRoadAddress(text)
    || extractRoadAddress(detail);
  return {
    text,
    dong,
    district,
    building: fromText.building || detailBuilding.building,
    unit: fromText.unit || detailBuilding.unit,
    poi: fromText.poi || detailBuilding.poi,
    road,
  };
}

function buildingFromText(text) {
  const parts = cleanToken(text).split(' ').filter(Boolean);
  let building = '';
  let poi = '';
  let unit = '';
  for (const part of parts) {
    if (!unit && /^\d+동$/.test(part)) unit = part;
    if (!building && /(?:아파트|빌라|맨션|오피스텔|타운|하우스|단지)/.test(part)) building = part;
    else if (!poi && /(?:마트|백화점|슈퍼|편의점|학교|병원|의원|약국|공원|회관|센터|교회|성당|사찰)/.test(part) && !isDong(part)) poi = part;
  }
  return { building, unit, poi };
}

function featureName(properties) {
  if (!properties || typeof properties !== 'object') return { building: '', unit: '', poi: '' };
  const building = firstText(properties, ['buld_nm', 'bld_nm', 'bldnm', 'buldNm', 'building_name', 'bldg_nm']);
  const unit = firstText(properties, ['dong_nm', 'buld_dong', 'dongNm']);
  const named = buildingFromText(`${building} ${unit}`);
  return {
    building: named.building || (building && !isDong(building) ? building : ''),
    unit: named.unit || formatUnit(unit),
    poi: named.poi,
  };
}

function placeKind(name, hints = {}) {
  if (POI_NAME.test(name) && !RESIDENTIAL_NAME.test(name)) return 'poi';
  if (RESIDENTIAL_NAME.test(name) || /\d+\s*동/.test(name)) return 'residential';
  if (RESIDENTIAL_BUILDING.test(String(hints.building || ''))) return 'residential';
  if (RESIDENTIAL_LANDUSE.test(String(hints.landuse || ''))) return 'residential';
  return 'poi';
}

function vworldBuilding(body) {
  const features = body && body.response && body.response.result && body.response.result.featureCollection
    ? body.response.result.featureCollection.features
    : [];
  if (!Array.isArray(features)) return { building: '', unit: '', poi: '', candidates: [] };
  const candidates = [];
  for (const feature of features) {
    const named = featureName(feature && feature.properties);
    const name = named.building || named.poi;
    if (!name) continue;
    const kind = placeKind(name);
    candidates.push({
      name,
      unit: named.unit,
      kind,
      geometry: feature.geometry || null,
    });
  }
  const first = candidates[0] || { name: '', unit: '', kind: '' };
  return {
    building: first.kind === 'residential' ? first.name : '',
    unit: first.unit || '',
    poi: first.kind === 'poi' ? first.name : '',
    candidates,
  };
}

async function fetchVworldAddress(fetchImpl, lat, lng, key, type) {
  const url = new URL('https://api.vworld.kr/req/address');
  url.searchParams.set('service', 'address');
  url.searchParams.set('request', 'getAddress');
  url.searchParams.set('version', '2.0');
  url.searchParams.set('crs', 'epsg:4326');
  url.searchParams.set('point', `${lng},${lat}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('type', type);
  url.searchParams.set('simple', 'false');
  url.searchParams.set('key', key);
  const response = await fetchImpl(url.toString(), { signal: timeoutSignal(8000) });
  return vworldStructure(await readJson(response));
}

function mergeVworldParts(primary, extra) {
  return {
    text: primary.text || extra.text,
    dong: primary.dong || extra.dong,
    district: primary.district || extra.district,
    building: primary.building || extra.building,
    unit: primary.unit || extra.unit,
    poi: primary.poi || extra.poi,
    road: primary.road || extra.road,
  };
}

async function fetchVworld(fetchImpl, lat, lng, key) {
  let parts = { text: '', dong: '', district: '', building: '', unit: '', poi: '', road: '' };
  try {
    parts = mergeVworldParts(parts, await fetchVworldAddress(fetchImpl, lat, lng, key, 'ROAD'));
  } catch {
    /* PARCEL로 이어간다 */
  }
  try {
    parts = mergeVworldParts(parts, await fetchVworldAddress(fetchImpl, lat, lng, key, 'PARCEL'));
  } catch {
    /* 건물 레이어로 이어간다 */
  }
  let building = { building: '', unit: '', poi: '', candidates: [] };
  try {
    const dataUrl = new URL('https://api.vworld.kr/req/data');
    dataUrl.searchParams.set('service', 'data');
    dataUrl.searchParams.set('request', 'GetFeature');
    dataUrl.searchParams.set('data', 'LT_C_BLDGINFO');
    dataUrl.searchParams.set('key', key);
    dataUrl.searchParams.set('format', 'json');
    dataUrl.searchParams.set('crs', 'EPSG:4326');
    dataUrl.searchParams.set('geomFilter', `POINT(${lng} ${lat})`);
    dataUrl.searchParams.set('buffer', '220');
    dataUrl.searchParams.set('size', '40');
    dataUrl.searchParams.set('geometry', 'true');
    const buildingResponse = await fetchImpl(dataUrl.toString(), { signal: timeoutSignal(8000) });
    building = vworldBuilding(await readJson(buildingResponse));
  } catch {
    building = { building: '', unit: '', poi: '', candidates: [] };
  }
  const point = { lat, lng };
  const layer = (Array.isArray(building.candidates) ? building.candidates : []).filter((item) => item.geometry);
  let picked = '';
  try {
    picked = choosePlaceLabel([
      ...layer,
      ...(parts.building ? [{ name: parts.building, unit: parts.unit, kind: 'residential' }] : []),
    ], point);
  } catch {
    picked = '';
  }
  const named = formatPrecisePlace({
    dong: parts.dong,
    building: building.building || parts.building,
    unit: building.unit || parts.unit,
    poi: '',
  });
  const road = parts.road || extractRoadAddress(parts.text);
  const label = picked || named || road || presentPlace(parts.text) || [parts.district, parts.dong].filter(Boolean).join(' ');
  return { label, candidates: layer, road };
}

function featureLocation(body) {
  const lat = Number(body && (body.lat ?? body.latitude));
  const lng = Number(body && (body.lon ?? body.lng));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function nominatimCandidates(body) {
  const address = body && typeof body === 'object' ? body.address : null;
  const named = namedFromAddress(address, body && body.namedetails);
  const geometry = body && body.geojson && geometryRings(body.geojson).length ? body.geojson : null;
  const feature = featureLocation(body);
  const candidates = [];
  if (named.building) {
    const located = geometry ? { geometry } : feature;
    if (located) {
      candidates.push({
        name: named.building,
        kind: 'residential',
        ...located,
      });
    }
  }
  if (named.poi) {
    const kind = POI_NAME.test(named.poi) || !RESIDENTIAL_NAME.test(named.poi) ? 'poi' : 'residential';
    // The reverse hit names one feature. Keep that feature's own polygon or
    // its published coordinate. The query pin is not the feature.
    const ownsGeometry = !named.building;
    const located = ownsGeometry && geometry ? { geometry } : feature;
    if (located) {
      candidates.push({
        name: named.poi,
        kind,
        ...located,
      });
    }
  }
  const road = roadAddressLabel(address && address.road, address && address.house_number)
    || extractRoadAddress(body && typeof body.display_name === 'string' ? body.display_name : '');
  return { label: nominatimAddress(body), candidates, road };
}

async function fetchNominatim(fetchImpl, lat, lng) {
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('polygon_geojson', '1');
  // 한국어는 쿼리로만 받는다. Accept-Language 헤더를 같이 보내면
  // 브라우저에서 Access-Control-Allow-Origin이 빠져 요청이 실패한다.
  url.searchParams.set('accept-language', 'ko');
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      headers: { 'User-Agent': NOMINATIM_UA },
      signal: timeoutSignal(8000),
    });
  } catch (error) {
    const message = error && error.message ? String(error.message) : '';
    if (!(error instanceof TypeError) || !/unsafe header|User-Agent/i.test(message)) throw error;
    response = await fetchImpl(url.toString(), { signal: timeoutSignal(8000) });
  }
  return nominatimCandidates(await readJson(response));
}

async function fetchKakao(fetchImpl, lat, lng, key) {
  const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2address.json');
  url.searchParams.set('x', String(lng));
  url.searchParams.set('y', String(lat));
  const response = await fetchImpl(url.toString(), {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: timeoutSignal(8000),
  });
  const body = await readJson(response);
  const document = body && Array.isArray(body.documents) ? body.documents[0] : null;
  if (!document) return '';
  const road = document.road_address || {};
  const parcel = document.address || {};
  const dong = cleanToken(parcel.region_3depth_name || road.region_3depth_name);
  const building = cleanToken(road.building_name);
  const parsed = buildingFromText(building);
  const precise = formatPrecisePlace({
    dong,
    building: parsed.building || (RESIDENTIAL_NAME.test(building) ? building : ''),
    unit: parsed.unit,
    poi: parsed.poi,
  });
  const main = houseNumber(road.main_building_no);
  const sub = houseNumber(road.sub_building_no);
  const street = roadAddressLabel(road.road_name, main && sub ? `${main}-${sub}` : main);
  if (precise && RESIDENTIAL_NAME.test(precise)) return precise;
  if (parsed.poi) return parsed.poi;
  return street || precise;
}

function overpassCandidates(body, lat, lng) {
  const elements = body && Array.isArray(body.elements) ? body.elements : [];
  const candidates = [];
  for (const element of elements) {
    const tags = element && element.tags;
    if (!tags || typeof tags.name !== 'string') continue;
    const name = cleanToken(tags.name);
    if (!name || name === '근처' || isDong(name)) continue;
    const residential = RESIDENTIAL_NAME.test(name)
      || RESIDENTIAL_BUILDING.test(String(tags.building || ''))
      || RESIDENTIAL_LANDUSE.test(String(tags.landuse || ''));
    const geometry = Array.isArray(element.geometry) ? element.geometry : (Number.isFinite(element.lat) ? { lat: element.lat, lng: element.lon } : { lat, lng });
    candidates.push({
      name,
      unit: formatUnit(tags['addr:unit'] || tags.ref || ''),
      kind: residential ? 'residential' : 'poi',
      buildingType: tags.building,
      landuse: tags.landuse,
      geometry,
    });
  }
  return candidates;
}

async function fetchOverpass(fetchImpl, lat, lng) {
  const query = `[out:json][timeout:12];(way(around:120,${lat},${lng})["name"]["building"];way(around:120,${lat},${lng})["name"]["landuse"="residential"];relation(around:120,${lat},${lng})["name"]["landuse"="residential"];node(around:80,${lat},${lng})["name"];);out tags geom;`;
  const encoded = encodeURIComponent(query);
  const urls = [
    `https://overpass-api.de/api/interpreter?data=${encoded}`,
    `https://overpass.kumi.systems/api/interpreter?data=${encoded}`,
  ];
  let last = null;
  for (const url of urls) {
    try {
      const response = await fetchImpl(url, { signal: timeoutSignal(12000) });
      const body = await readJson(response);
      const candidates = overpassCandidates(body, lat, lng);
      if (candidates.length || (response && response.ok !== false && body)) return candidates;
      last = candidates;
    } catch {
      last = null;
    }
  }
  if (last) return last;
  throw new Error('overpass');
}

function settledLabel(label, residentialKnown, settled = true) {
  const text = label ? presentPlace(label) : '';
  const keep = settled && !(text && POI_NAME.test(text) && !residentialKnown);
  return { label: text || null, settled: keep };
}

async function lookupPlace(lat, lng, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { label: null, settled: false };
  const key = options.key !== undefined ? String(options.key || '') : readVworldKey();
  const kakaoKey = options.kakaoKey !== undefined ? String(options.kakaoKey || '') : readKakaoKey();
  const point = { lat: Number(lat), lng: Number(lng) };
  const candidates = Array.isArray(options.candidates) ? [...options.candidates] : [];
  let coarse = '';
  let road = '';
  let residentialKnown = false;
  const finish = (label, settled = true) => settledLabel(label, residentialKnown, settled);
  const rememberRoad = (value) => {
    const next = extractRoadAddress(value);
    if (next) road = next;
  };
  if (key) {
    try {
      const fromVworld = await fetchVworld(fetchImpl, lat, lng, key);
      candidates.push(...(fromVworld.candidates || []));
      rememberRoad(fromVworld.road || fromVworld.label);
      if (fromVworld.label && isPrecisePlace(fromVworld.label) && RESIDENTIAL_NAME.test(fromVworld.label)) {
        const agreed = choosePlaceLabel(candidates, point);
        residentialKnown = true;
        if (agreed && RESIDENTIAL_NAME.test(agreed)) return finish(agreed, true);
        return finish(fromVworld.label, true);
      }
      if (fromVworld.label && !isPrecisePlace(fromVworld.label)) coarse = fromVworld.label;
    } catch {
      /* Kakao·Nominatim으로 넘어간다 */
    }
  }
  if (kakaoKey) {
    try {
      const fromKakao = await fetchKakao(fetchImpl, lat, lng, kakaoKey);
      if (fromKakao && RESIDENTIAL_NAME.test(fromKakao)) return finish(fromKakao, true);
      rememberRoad(fromKakao);
    } catch {
      /* Nominatim으로 넘어간다 */
    }
  }
  try {
    if (options.pace !== false) await paceNominatim();
    const fromNominatim = await fetchNominatim(fetchImpl, lat, lng);
    candidates.push(...fromNominatim.candidates);
    rememberRoad(fromNominatim.road || fromNominatim.label);
    if (candidates.some((item) => isResidentialPlace(item) && geometryRings(item.geometry).some((ring) => ring.length >= 3))) {
      residentialKnown = true;
    }
    try {
      const area = await fetchOverpass(fetchImpl, lat, lng);
      candidates.push(...area);
      if (area.some((item) => isResidentialPlace(item))) residentialKnown = true;
    } catch {
      /* 도로·장소가 있으면 구·동으로 내려가지 않는다 */
    }
    const picked = choosePlaceLabel(candidates, point);
    if (picked) return finish(picked);
    if (road) return finish(road);
    if (fromNominatim.label && isPrecisePlace(fromNominatim.label) && RESIDENTIAL_NAME.test(fromNominatim.label)) {
      return finish(fromNominatim.label, true);
    }
    if (fromNominatim.label && isPrecisePlace(fromNominatim.label)) return finish(fromNominatim.label);
    if (fromNominatim.label && !road) return finish(fromNominatim.label);
  } catch {
    const picked = choosePlaceLabel(candidates, point);
    if (picked) return finish(picked);
  }
  const leftover = choosePlaceLabel(candidates, point);
  if (leftover) return finish(leftover);
  if (road) return finish(road);
  return coarse ? finish(coarse) : finish('', false);
}

export async function reverseGeocode(lat, lng, options = {}) {
  const found = await lookupPlace(lat, lng, options);
  return found.label;
}

export async function reverseGeocodeCached(lat, lng, options = {}) {
  const key = placeGridKey(lat, lng);
  const cached = readCache()[key];
  if (cached) {
    const label = presentPlace(cached);
    if (label) return { label, settled: true };
  }
  const found = await lookupPlace(lat, lng, options);
  if (!found.label || found.label === '근처') return { label: null, settled: false };
  if (!found.settled) return found;
  const cache = readCache();
  cache[key] = found.label;
  writeCache(cache);
  return found;
}

export const NOMINATIM_USER_AGENT = NOMINATIM_UA;
