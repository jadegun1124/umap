import assert from 'node:assert/strict';
import test from 'node:test';
import { carryPlace, memberPlaceLabel } from './memberPlace.mjs';

test('member status uses the nearest address and never says nearby', () => {
  assert.equal(memberPlaceLabel({ place: '근처', located: true, address: '강북구 수유동' }), '강북구 수유동');
  assert.equal(memberPlaceLabel({ place: '도봉구 쌍문동', located: true }), '도봉구 쌍문동');
  assert.equal(memberPlaceLabel({ place: '', located: true, atHome: true, homeLabel: '우리 집' }), '우리 집');
  assert.equal(memberPlaceLabel({ place: '', located: false }), '위치 기다리는 중');
  assert.equal(memberPlaceLabel({ place: '근처', located: true, address: '' }), '');
  assert.equal(memberPlaceLabel({ place: '', located: true, address: '근처' }), '');
  const joined = ['강북구 수유동', '머무름'].join(' · ');
  assert.equal(joined.includes('근처'), false);
  const card = (place, live) => [memberPlaceLabel({ place, located: true }), live].filter(Boolean).join(' · ');
  assert.equal(card('구리시 수택동', '지금'), '구리시 수택동 · 지금');
  assert.equal(card('남양주시 다산동', '머무름'), '남양주시 다산동 · 머무름');
  assert.equal(card('근처', '지금').includes('근처'), false);
  assert.equal(card('근처 근처', '머무름'), '머무름');
});

test('a moved pin does not keep the previous neighborhood', () => {
  const previous = { lat: 37.64, lng: 127.01, place: '강북구 수유동' };
  assert.equal(carryPlace(previous, 37.6401, 127.0101), '강북구 수유동');
  assert.equal(carryPlace(previous, 37.55, 127.01), '');
  assert.equal(carryPlace({ lat: 37.64, lng: 127.01, place: '근처' }, 37.64, 127.01), '');
  const home = { lat: 37.6372, lng: 127.07085, place: '하계1차청구아파트 105동' };
  const indoor = { lat: home.lat, lng: home.lng + 100 / (111_320 * Math.cos((home.lat * Math.PI) / 180)) };
  assert.equal(carryPlace(home, indoor.lat, indoor.lng), '하계1차청구아파트 105동');
  assert.equal(['하계1차청구아파트 105동', '머무름'].filter(Boolean).join(' · '), '하계1차청구아파트 105동 · 머무름');
});
