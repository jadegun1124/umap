// Card status is the nearest saved address for that pin, not a proximity claim.

export function cleanPlace(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text || text === '근처' || text.split(' ').every((part) => part === '근처')) return '';
  return text.slice(0, 56);
}

export function samePlaceBucket(aLat, aLng, bLat, bLng) {
  // About 300m. An indoor spike must not blank a label that still belongs to this building.
  return Math.abs(aLat - bLat) < 0.0027 && Math.abs(aLng - bLng) < 0.0035;
}

function metersBetween(aLat, aLng, bLat, bLng) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function carryPlace(previous, lat, lng, options = {}) {
  if (!previous || previous.lat == null || previous.lng == null) return '';
  const anchorLat = Number.isFinite(previous.placeLat) ? previous.placeLat : previous.lat;
  const anchorLng = Number.isFinite(previous.placeLng) ? previous.placeLng : previous.lng;
  const moved = metersBetween(anchorLat, anchorLng, lat, lng);
  const accuracy = Number(options.accuracyM);
  const accurate = !Number.isFinite(accuracy) || accuracy <= 25;
  if (options.directed === true && accurate && moved >= 40) return '';
  if (!samePlaceBucket(anchorLat, anchorLng, lat, lng)) return '';
  return cleanPlace(previous.place);
}

export function memberPlaceLabel({ place, located, atHome, homeLabel, address }) {
  const named = cleanPlace(place);
  if (named) return named;
  if (atHome) return homeLabel || '우리 집';
  if (!located) return '위치 기다리는 중';
  const near = cleanPlace(address);
  if (near) return near;
  return '';
}
