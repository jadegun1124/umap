// A phone mints its own room in fresh(), then accept-invite appends every
// family it joins. The same person can show up once per room code.
// 추정: a reinstall or Kakao restore can leave an older guardian list
// next to a newly minted room. 방 합치기 is admin-initiated. The surviving
// room is the one this phone leads (그룹장). If this phone leads none,
// the oldest room remains. History stays on the device.
// The server never sees key material; the next key sync rewraps the
// surviving room for current members.

import { missingWrapMemberIds } from './familyRosterSync.mjs';

const CODE = /^\d{4,6}$/;
const MEMBER_ID = /^local-[a-z0-9]{3,64}$/;

function roomStamp(id) {
  const match = /^g-(\d{10,})$/.exec(typeof id === 'string' ? id : '');
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function listFamilyRooms({ selfId, inviteCode, guardians }) {
  const rooms = [];
  if (CODE.test(inviteCode || '')) {
    rooms.push({ code: inviteCode, ownerId: typeof selfId === 'string' ? selfId : '', at: 0, own: true });
  }
  for (const link of Array.isArray(guardians) ? guardians : []) {
    if (!link || !CODE.test(link.code || '') || rooms.some((room) => room.code === link.code)) continue;
    rooms.push({
      code: link.code,
      ownerId: typeof link.ownerMemberId === 'string' ? link.ownerMemberId : '',
      at: roomStamp(link.id),
      own: false,
    });
  }
  return rooms;
}

function oldest(rooms) {
  return rooms.slice().sort((left, right) => left.at - right.at || left.code.localeCompare(right.code))[0] || null;
}

export function chooseCanonicalRoom(selfId, rooms) {
  const list = Array.isArray(rooms) ? rooms.filter((room) => room && CODE.test(room.code || '')) : [];
  if (!list.length) return null;
  const owned = list.filter((room) => selfId && room.ownerId === selfId);
  if (owned.length) return oldest(owned);
  return oldest(list);
}

function publisherOf(member) {
  if (!member || member.id === 'self' || member.role === 'self') return '';
  if (typeof member.publisherId === 'string' && MEMBER_ID.test(member.publisherId)) return member.publisherId;
  const match = /^family:\d{4,6}:(local-[a-z0-9]{3,64})$/.exec(member.id || '');
  return match ? match[1] : '';
}

function located(member) {
  return !!member && Number.isFinite(member.lat) && Number.isFinite(member.lng);
}

function pickNewest(group, predicate) {
  const pool = predicate ? group.filter(predicate) : group;
  if (!pool.length) return null;
  return pool.reduce((best, item) => ((item.updatedAt || 0) >= (best.updatedAt || 0) ? item : best));
}

export function mergeRoster(members, canonicalCode) {
  const groups = new Map();
  const singles = [];
  for (const member of Array.isArray(members) ? members : []) {
    const pub = publisherOf(member);
    if (!pub) {
      singles.push(member);
      continue;
    }
    const group = groups.get(pub) || [];
    group.push(member);
    groups.set(pub, group);
  }
  const moves = [];
  const merged = [...singles];
  for (const [pub, group] of groups) {
    const place = pickNewest(group, located) || pickNewest(group);
    const battery = pickNewest(group, (item) => typeof item.battery === 'number');
    const id = `family:${canonicalCode}:${pub}`;
    const photo = group.find((item) => typeof item.photo === 'string' && item.photo)?.photo;
    const kept = {
      ...place,
      id,
      publisherId: pub,
      inviteCode: canonicalCode,
      ...(group.some((item) => item.lead === true) ? { lead: true } : {}),
      ...(photo ? { photo } : {}),
    };
    if (battery && (typeof kept.battery !== 'number' || (battery.updatedAt || 0) >= (place.updatedAt || 0))) {
      kept.battery = battery.battery;
      kept.charging = battery.charging;
    }
    for (const item of group) {
      if (item.id && item.id !== id) moves.push({ from: item.id, to: id });
    }
    merged.push(kept);
  }
  return { members: merged, moves };
}

export function planFamilyRoomMerge(input) {
  const source = input || {};
  const rooms = listFamilyRooms(source);
  const members = Array.isArray(source.members) ? source.members : [];
  const guardians = Array.isArray(source.guardians) ? source.guardians : [];
  if (rooms.length < 2) {
    return {
      needed: false,
      rooms,
      canonical: rooms[0] || null,
      members,
      moves: [],
      guardians,
      droppedCodes: [],
    };
  }
  const canonical = chooseCanonicalRoom(source.selfId, rooms, members);
  const roster = mergeRoster(members, canonical.code);
  return {
    needed: true,
    rooms,
    canonical,
    members: roster.members,
    moves: roster.moves,
    guardians: guardians.filter((link) => link && link.code === canonical.code),
    droppedCodes: rooms.filter((room) => room.code !== canonical.code).map((room) => room.code),
  };
}

export function mergePointTrails(records, from, to) {
  if (!records || !from || !to || from === to || !Object.prototype.hasOwnProperty.call(records, from)) return records;
  const next = { ...records };
  const left = Array.isArray(next[to]) ? next[to] : [];
  const right = Array.isArray(next[from]) ? next[from] : [];
  const byAt = new Map();
  for (const point of [...left, ...right]) {
    if (!point || typeof point.at !== 'number') continue;
    byAt.set(point.at, point);
  }
  const merged = [...byAt.values()].sort((leftPoint, rightPoint) => leftPoint.at - rightPoint.at);
  next[to] = merged.length ? merged : [...left, ...right];
  delete next[from];
  return next;
}

export function mergeRecordLists(records, from, to) {
  if (!records || !from || !to || from === to || !Object.prototype.hasOwnProperty.call(records, from)) return records;
  const next = { ...records };
  const left = Array.isArray(next[to]) ? next[to] : [];
  const right = Array.isArray(next[from]) ? next[from] : [];
  const seen = new Set(left.map((item) => item && item.id).filter(Boolean));
  next[to] = [...left, ...right.filter((item) => item && !seen.has(item.id))];
  delete next[from];
  return next;
}

export function syncRooms({ inviteCode, guardians, familyRoomCode }) {
  const ownCode = CODE.test(inviteCode || '') ? inviteCode : '';
  const links = [];
  for (const link of Array.isArray(guardians) ? guardians : []) {
    if (!link || !CODE.test(link.code || '') || links.some((item) => item.code === link.code)) continue;
    links.push(link);
  }
  const locked = CODE.test(familyRoomCode || '') ? familyRoomCode : '';
  if (!locked) {
    const codes = [];
    if (ownCode) codes.push(ownCode);
    for (const link of links) if (!codes.includes(link.code)) codes.push(link.code);
    return { includeOwn: !!ownCode, guardians: links.filter((link) => link.code !== ownCode), codes };
  }
  if (ownCode && locked === ownCode) return { includeOwn: true, guardians: [], codes: [ownCode] };
  const kept = links.filter((link) => link.code === locked);
  return { includeOwn: false, guardians: kept, codes: kept.map((link) => link.code) };
}

export function extraRoomDecision(familyRoomCode, code) {
  if (!CODE.test(familyRoomCode || '')) return 'allow';
  if (familyRoomCode === code) return 'same';
  return 'refuse';
}

export function inviteMintTarget({ inviteCode, familyRoomCode }) {
  const own = CODE.test(inviteCode || '') ? inviteCode : '';
  const locked = CODE.test(familyRoomCode || '') ? familyRoomCode : '';
  if (!locked || locked === own) return { code: own, canMint: !!own };
  return { code: locked, canMint: false };
}

export function remapMemberIds(ids, moves, { keepSource = false } = {}) {
  const map = new Map();
  for (const move of Array.isArray(moves) ? moves : []) {
    if (move && move.from && move.to) map.set(move.from, move.to);
  }
  const next = [];
  const push = (id) => {
    if (typeof id === 'string' && id && !next.includes(id)) next.push(id);
  };
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== 'string' || !id) continue;
    const named = /^family:(\d{4,6}):(.+)$/.exec(id);
    let mapped = map.get(id) || id;
    if (!map.has(id) && named) {
      const move = (Array.isArray(moves) ? moves : []).find((item) => item && typeof item.from === 'string' && item.from.startsWith(`family:${named[1]}:`));
      const canonical = move && /^family:(\d{4,6}):/.exec(move.to);
      if (canonical) mapped = `family:${canonical[1]}:${named[2]}`;
    }
    push(mapped);
    if (keepSource && mapped !== id) push(id);
  }
  return next;
}

export function applyMergeIdentity(plan, hiddenMemberIds, motionNotifyIds) {
  const moves = plan && Array.isArray(plan.moves) ? plan.moves : [];
  const hiddenMemberIdsNext = remapMemberIds(hiddenMemberIds, moves, { keepSource: true });
  const hidden = new Set(hiddenMemberIdsNext);
  const members = (plan && Array.isArray(plan.members) ? plan.members : []).filter((member) => {
    if (!member || member.id === 'self' || member.role === 'self') return true;
    if (member.id && hidden.has(member.id)) return false;
    if (member.publisherId && hidden.has(member.publisherId)) return false;
    if (member.inviteCode && member.name && hidden.has(`family:${member.inviteCode}:${member.name}`)) return false;
    if (!member.publisherId && member.name && hidden.has(`name:${member.name}`)) return false;
    return true;
  });
  return {
    members,
    hiddenMemberIds: hiddenMemberIdsNext,
    motionNotifyIds: remapMemberIds(motionNotifyIds, moves),
  };
}

export function keptFamilyRoomCode(previous, inviteCode, guardians) {
  const code = typeof previous === 'string' ? previous.replace(/\D/g, '').slice(0, 6) : '';
  if (code.length < 4) return '';
  if (code === inviteCode) return code;
  if ((Array.isArray(guardians) ? guardians : []).some((link) => link && link.code === code)) return code;
  return '';
}

export function canonicalWrapMembers(selfId, members, keys) {
  const pubs = keys && keys.pubs && typeof keys.pubs === 'object' ? keys.pubs : {};
  const live = new Set();
  if (typeof selfId === 'string' && MEMBER_ID.test(selfId)) live.add(selfId);
  for (const member of Array.isArray(members) ? members : []) {
    const pub = publisherOf(member);
    if (pub) live.add(pub);
  }
  const filtered = {};
  for (const id of Object.keys(pubs)) {
    if (live.has(id)) filtered[id] = pubs[id];
  }
  return missingWrapMemberIds({
    pubs: filtered,
    wraps: keys && keys.wraps,
    revoked: keys && keys.revoked,
  });
}
