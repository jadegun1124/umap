// One family room. Stored admin and managed snapshots become the same people.

export function isSelfEchoMember(member, profileId, inviteCode, profileName) {
  if (!member || member.role !== 'admin-share') return false;
  if (profileId && member.publisherId === profileId) return true;
  if (profileId && inviteCode && member.id === `family:${inviteCode}:${profileId}`) return true;
  if (profileName && inviteCode && member.id === `family:${inviteCode}:${profileName}`) return true;
  return false;
}

export function isSelfEchoPlace(place, profileId, inviteCode) {
  if (!place) return false;
  if (profileId && place.memberId === profileId) return true;
  if (inviteCode && place.code === inviteCode && place.audience === 'family' && (!place.memberId || place.memberId === profileId)) return true;
  return false;
}

export function withoutSelfEcho(members, profileId, inviteCode, profileName) {
  return (Array.isArray(members) ? members : []).filter((member) => !isSelfEchoMember(member, profileId, inviteCode, profileName));
}

export function rosterMembers(members, profileId, inviteCode, profileName) {
  return withoutSelfEcho(members, profileId, inviteCode, profileName).filter((member) => member && member.role !== 'guardian');
}

export function ensureRoster(members, profiles, code, ownerId = '') {
  const next = Array.isArray(members) ? members.map((member) => ({ ...member })) : [];
  const joined = [];
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    if (!profile || typeof profile.memberId !== 'string' || typeof profile.name !== 'string') continue;
    const name = profile.name.trim().slice(0, 20);
    if (!name) continue;
    const id = `family:${code}:${profile.memberId}`;
    const index = next.findIndex((member) => member && (member.publisherId === profile.memberId || member.id === id));
    const lead = ownerId !== '' && profile.memberId === ownerId;
    if (index >= 0) {
      next[index] = { ...next[index], name, ...(lead ? { lead: true } : {}) };
      continue;
    }
    next.push({
      id,
      name,
      role: 'admin-share',
      lat: null,
      lng: null,
      accuracyM: 0,
      battery: null,
      charging: null,
      updatedAt: typeof profile.at === 'number' ? profile.at : 0,
      moving: null,
      share: 'allowed',
      publisherId: profile.memberId,
      ...(lead ? { lead: true } : {}),
    });
    joined.push(name);
  }
  return { members: next, joined };
}

export function mapMembers(members, profileId, inviteCode, profileName) {
  return rosterMembers(members, profileId, inviteCode, profileName).filter((member) => {
    if (member.id === 'self') return true;
    if (member.lat == null || member.lng == null) return false;
    if (member.role === 'admin-share') return true;
    return member.share === 'allowed';
  });
}

function memberStamp(member) {
  return typeof member?.updatedAt === 'number' ? member.updatedAt : 0;
}

export function mergedShareSelf(snapshots, guardians) {
  const ranked = [...(Array.isArray(snapshots) ? snapshots : [])].sort((left, right) => (right.savedAt || 0) - (left.savedAt || 0));
  for (const session of ranked) {
    if (session && typeof session.shareSelfWithFamily === 'boolean') return session.shareSelfWithFamily;
  }
  return (Array.isArray(guardians) ? guardians : []).some((link) => link && link.share === 'allowed');
}

export function mergePeerSessions(snapshots) {
  const list = (Array.isArray(snapshots) ? snapshots : []).filter((item) => item && typeof item === 'object');
  if (list.length === 0) return null;
  const ranked = [...list].sort((left, right) => (right.savedAt || 0) - (left.savedAt || 0));
  const base = { ...ranked[0] };
  const members = [];
  const seen = new Set();
  for (const session of ranked) {
    for (const member of session.members || []) {
      if (!member || !member.id || seen.has(member.id)) {
        if (member && seen.has(member.id)) {
          const index = members.findIndex((item) => item.id === member.id);
          if (index >= 0 && memberStamp(member) > memberStamp(members[index])) members[index] = member;
        }
        continue;
      }
      seen.add(member.id);
      members.push(member);
    }
  }
  const guardians = [];
  const codes = new Set();
  for (const session of ranked) {
    for (const link of session.guardians || []) {
      if (!link || !link.code || codes.has(link.code)) continue;
      codes.add(link.code);
      guardians.push(link);
    }
  }
  const profile = ranked.find((session) => session.profile && session.profile.id)?.profile || base.profile || null;
  const profileId = profile && profile.id;
  const profileName = profile && profile.name;
  const host = ranked.find((session) => (session.members || []).some((member) => member && member.role === 'child')) || ranked[0];
  const inviteCode = host.inviteCode || base.inviteCode || '';
  const cleaned = withoutSelfEcho(members, profileId, inviteCode, profileName);
  const completed = ranked.some((session) => session.permissions && session.permissions.completed);
  const sharing = mergedShareSelf(ranked, guardians);
  const sharedGuardians = sharing
    ? guardians
    : guardians.map((link) => (link.share === 'allowed' ? { ...link, share: 'accepted' } : link));
  const stage = !profile
    ? (base.stage === 'splash' ? 'splash' : 'login')
    : completed
      ? 'map'
      : (base.stage === 'mode' || !base.stage ? 'survey' : base.stage);
  const next = {
    ...base,
    profile,
    members: cleaned,
    guardians: sharedGuardians,
    inviteCode,
    syncWriteKey: host.syncWriteKey || base.syncWriteKey,
    syncReadKey: host.syncReadKey || base.syncReadKey,
    shareSelfWithFamily: sharing,
    mode: null,
    stage,
    permissions: { ...(base.permissions || {}), completed: completed || !!(base.permissions && base.permissions.completed) },
  };
  delete next.savedAt;
  return next;
}
