import React, { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { hasLocation, haversineMeters } from '../../lib/geo';
import { applyAccountSnapshot, clearDeviceAccount, logoutLocalAccount, readStoredAccountKey } from '../../lib/accountRestore.mjs';
import { resumeRoom } from '../../lib/keySyncPace.mjs';
import { deviceSealAvailable, openDeviceText, sealDeviceText } from '../../lib/deviceSeal.mjs';
import { openAccountSecrets } from '../../lib/familyVault.mjs';
import {
  FAMILY_STORAGE_KEY,
  clearPlainSession,
  collectJsonSnapshots,
  commitDurableSession,
  fillFromAccount,
  needsHistoryRestore,
  readSeal,
} from '../../lib/sessionDurable.mjs';
import { cancelAccountBackup, loadFamilyAccount, scheduleAccountBackup } from '../../services/familyAccount';
import { deviceProfileKey, localProfile } from '../../lib/localProfile.mjs';
import { carryPlace, cleanPlace } from '../../lib/memberPlace.mjs';
import { ensureRoster, isSelfEchoPlace, mergePeerSessions, withoutSelfEcho } from '../../lib/peerFamily.mjs';
import { resolveManagedTarget } from '../../lib/managedPlace.mjs';
import { hiddenKeysForMember, placeHidden } from '../../lib/familyRoom.mjs';
import { bindPlaceToMember, placeIsSelf, placeMemberId } from '../../lib/placeBinding.mjs';
import { hideLeftPublishers, sharedPlaceStopsReporting } from '../../lib/memberPresence.mjs';
import { familyPinId, isMemberId, moveKeyed } from '../../lib/sharedIdentity.mjs';
import { absorbPlaceholderMembers } from '../../lib/memberRoster.mjs';
import { clearDiag, noteDiag } from '../../lib/diagLog.mjs';
import { HISTORY_DAYS, JOURNEY_POINT_CAP, TRAIL_POINT_CAP, fixShowsRide, isWithinHistory, journeysWithinHistory, labelJourneyPlace, lastTravelAt, mergeJourneyLists, seoulDayKey, mergeVisitStops, settleTrailPoint, stayLabelDwellMs, storedTrackAfterArchive, tracksWithinHistory, trimJourneyList, visitsWithinHistory, walkLeavesStay, type JourneyRecord } from '../../lib/tracking.mjs';
import type { DayStop } from '../../lib/tracking.mjs';
import type { SharedPlace, SharedProfile } from '../../services/familyShare';
import { umapLocation } from '../../services/umapLocation';
import { createKeyPart, isKeyPart, splitSyncToken } from '../../services/familySync';
import {
  DEFAULT_CENTER,
  REQUIRED_TERMS,
  type AppMode,
  type FamilyNotice,
  type FamilyTab,
  type GuardianLink,
  type HomeZone,
  type Journey,
  type LeaveAlert,
  type Member,
  type PermissionState,
  type Profile,
  type Session,
  type ShareState,
  type Stage,
  type TrackPoint,
  type Visit,
} from '../../types/family';

type CanonicalTrail = {
  memberId: string;
  at: number;
  moving: boolean;
  points: TrackPoint[];
  journeys: Journey[];
};

const STORAGE_KEY = FAMILY_STORAGE_KEY;
const DEVICE_SEAL_PREFIX = 'umap-device-seal:';
let pendingDeviceSeal = '';
let restoringDeviceSeal = false;
let sealOpened = true;
let appliedPlain = '';
let sealEpoch = 0;

function cancelDeviceSealRestore() {
  sealEpoch += 1;
  restoringDeviceSeal = false;
  pendingDeviceSeal = '';
  sealOpened = true;
}
const SESSION_KEYS = [STORAGE_KEY, `${STORAGE_KEY}:admin`, `${STORAGE_KEY}:managed`] as const;

function clearStoredSessions() {
  sessionStorage.removeItem(STORAGE_KEY);
  clearPlainSession(typeof localStorage === 'undefined' ? null : localStorage);
  for (const key of SESSION_KEYS) {
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}:at`);
  }
}

function storedSnapshots(): Session[] {
  return collectJsonSnapshots(
    typeof localStorage === 'undefined' ? null : localStorage,
    typeof sessionStorage === 'undefined' ? null : sessionStorage,
  ).filter(isSession);
}

const EMPTY_TERMS: Record<string, boolean> = {
  terms: false,
  location: false,
  locationUse: false,
  privacy: false,
  guardian: false,
  marketing: false,
  overseas: false,
};

const EMPTY_PERMISSIONS: PermissionState = {
  notifications: 'unknown',
  accuracy: 'precise',
  locationMode: 'unknown',
  motion: 'unknown',
  battery: 'unknown',
  completed: false,
};

function readInvite(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('invite');
}

function cleanSyncToken(value: unknown): string | null {
  return typeof value === 'string' && splitSyncToken(value) ? value : null;
}

function takeSyncTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('sync')) return null;
  const token = cleanSyncToken(params.get('sync'));
  const url = new URL(window.location.href);
  url.searchParams.delete('sync');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  return token;
}

function shouldReset(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('reset') === '1';
}

function sealedSession() {
  return readSeal(typeof localStorage === 'undefined' ? null : localStorage);
}

function fresh(stage: Stage = 'splash'): Session {
  return {
    stage,
    profile: null,
    survey: null,
    terms: { ...EMPTY_TERMS },
    phone: '',
    phoneVerified: false,
    permissions: { ...EMPTY_PERMISSIONS },
    members: [],
    tracks: {},
    trailDay: seoulDayKey(Date.now()),
    visits: {},
    journeys: {},
    trailRevisions: {},
    shareSelfWithFamily: false,
    locationConsent: true,
    historyLocked: false,
    sealedHistory: null,
    accountVault: null,
    backgroundKeepAlive: false,
    home: null,
    homeCleared: false,
    inviteCode: String(10000 + Math.floor(Math.random() * 90000)),
    notices: [],
    tab: 'map',
    pendingInvite: readInvite(),
    mode: null,
    guardians: [],
    pendingLeaveAlert: readLeaveAlert(),
    syncWriteKey: createKeyPart(),
    syncReadKey: createKeyPart(),
    pendingSyncToken: null,
    hiddenMemberIds: [],
    motionNotifyIds: [],
    motionAlertPhase: 'unknown',
  };
}

function cleanTrailRevisions(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (!/^local-[a-z0-9]{3,64}$/.test(key)) continue;
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    out[key] = at;
  }
  return out;
}

function canonicalTrailAt(state: Session, member: { publisherId?: string }): number {
  const id = member.publisherId || '';
  if (!id) return 0;
  return state.trailRevisions?.[id] || 0;
}

function cleanMotionNotifyIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item === 'self' || item.length > 160) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out.slice(0, 12);
}

function cleanMotionPhase(value: unknown): Session['motionAlertPhase'] {
  return value === 'still' || value === 'moving' ? value : 'unknown';
}

function cleanHidden(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim() || item.length > 160) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out.slice(0, 80);
}

function readLeaveAlert(): LeaveAlert | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const lat = Number(query.get('homeLat'));
  const lng = Number(query.get('homeLng'));
  const radiusM = Number(query.get('homeRadius'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusM)) return null;
  return {
    label: (query.get('homeLabel') || '우리 집').slice(0, 40),
    lat,
    lng,
    radiusM: Math.min(2000, Math.max(50, Math.round(radiusM))),
  };
}

function cleanHome(value: unknown): HomeZone | null {
  if (!value || typeof value !== 'object') return null;
  const home = value as HomeZone;
  if (!Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return null;
  const radius = Number(home.radiusM);
  return {
    label: home.label || '우리 집',
    address: home.address || '',
    lat: home.lat,
    lng: home.lng,
    radiusM: Number.isFinite(radius) ? Math.min(2000, Math.max(50, Math.round(radius))) : 200,
    alertPhone: '',
  };
}

function cleanLeaveAlert(value: unknown): LeaveAlert | null {
  if (!value || typeof value !== 'object') return null;
  const alert = value as LeaveAlert;
  if (!Number.isFinite(alert.lat) || !Number.isFinite(alert.lng) || !Number.isFinite(alert.radiusM)) return null;
  return {
    label: alert.label || '우리 집',
    lat: alert.lat,
    lng: alert.lng,
    radiusM: Math.min(2000, Math.max(50, Math.round(alert.radiusM))),
  };
}

function cleanPhoto(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('data:image/') || value.length > 120_000) return undefined;
  return value;
}

function membersFor(profile: Profile): Member[] {
  const photo = cleanPhoto(profile.photo);
  return [
    {
      id: 'self',
      name: profile.name,
      role: 'self',
      lat: null,
      lng: null,
      accuracyM: 0,
      battery: null,
      charging: null,
      updatedAt: Date.now(),
      moving: null,
      share: 'allowed',
      ...(photo ? { photo } : {}),
    },
  ];
}

function isSeedLocation(lat: number, lng: number): boolean {
  return Math.abs(lat - DEFAULT_CENTER.lat) < 1e-8 && Math.abs(lng - DEFAULT_CENTER.lng) < 1e-8;
}

function isPoint(value: unknown): value is TrackPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as TrackPoint;
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) && Number.isFinite(point.at);
}

function cleanTracks(value: unknown): Record<string, TrackPoint[]> {
  if (!value || typeof value !== 'object') return {};
  const tracks: Record<string, TrackPoint[]> = {};
  for (const [id, points] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(points)) continue;
    const clean = points.filter(isPoint).slice(-(TRAIL_POINT_CAP * (HISTORY_DAYS + 1)));
    if (clean.length > 0) tracks[id] = clean;
  }
  return tracks;
}

function cleanVisits(value: unknown): Record<string, Visit[]> {
  if (!value || typeof value !== 'object') return {};
  const visits: Record<string, Visit[]> = {};
  for (const [id, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const clean: Visit[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const visit = item as Visit;
      if (typeof visit.id !== 'string' || !Number.isFinite(visit.lat) || !Number.isFinite(visit.lng) || !Number.isFinite(visit.arrivedAt)) continue;
      clean.push({
        id: visit.id.slice(0, 120),
        lat: visit.lat,
        lng: visit.lng,
        arrivedAt: visit.arrivedAt,
        leftAt: typeof visit.leftAt === 'number' && Number.isFinite(visit.leftAt) ? visit.leftAt : null,
        label: typeof visit.label === 'string' && visit.label.trim() ? visit.label.trim().slice(0, 120) : null,
        source: visit.source === 'geocode' ? 'geocode' : 'coords',
      });
    }
    if (clean.length > 0) visits[id] = clean.slice(-40);
  }
  return visits;
}

function cleanJourneys(value: unknown): Record<string, Journey[]> {
  if (!value || typeof value !== 'object') return {};
  const journeys: Record<string, Journey[]> = {};
  for (const [id, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const clean: Journey[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const journey = item as Journey;
      if (typeof journey.id !== 'string' || !Number.isFinite(journey.startedAt) || !Number.isFinite(journey.endedAt)) continue;
      if (!journey.start || !journey.end || !Number.isFinite(journey.start.lat) || !Number.isFinite(journey.start.lng) || !Number.isFinite(journey.end.lat) || !Number.isFinite(journey.end.lng)) continue;
      const points = Array.isArray(journey.points) ? journey.points.filter(isPoint).slice(-JOURNEY_POINT_CAP) : [];
      if (points.length < 2) continue;
      const placeLabel = (label: unknown) => (typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null);
      const stored: Journey = {
        id: journey.id.slice(0, 160),
        startedAt: journey.startedAt,
        endedAt: journey.endedAt,
        distanceM: Number.isFinite(journey.distanceM) ? Math.max(0, Math.round(journey.distanceM)) : 0,
        points,
        start: { lat: journey.start.lat, lng: journey.start.lng, label: placeLabel(journey.start.label) },
        end: { lat: journey.end.lat, lng: journey.end.lng, label: placeLabel(journey.end.label) },
      };
      if (journey.cloud === true || journey.cloud === false) stored.cloud = journey.cloud;
      clean.push(stored);
    }
    if (clean.length > 0) journeys[id] = clean.slice(-80);
  }
  return journeys;
}

function knownSpots(state: Session, memberId: string) {
  const spots: { lat: number; lng: number; label: string; radiusM: number }[] = [];
  if (state.home && Number.isFinite(state.home.lat) && Number.isFinite(state.home.lng)) {
    spots.push({ lat: state.home.lat, lng: state.home.lng, label: state.home.label || '우리 집', radiusM: state.home.radiusM });
  }
  for (const visit of state.visits[memberId] ?? []) {
    if (visit.label) spots.push({ lat: visit.lat, lng: visit.lng, label: visit.label, radiusM: 120 });
  }
  return spots;
}

function archiveJourneys(state: Session, now: number): Session {
  let tracks = tracksWithinHistory(state.tracks, now);
  let journeys = journeysWithinHistory(state.journeys ?? {}, now);
  let tracksDirty = tracks !== state.tracks;
  const putTrack = (id: string, nextPoints: Session['tracks'][string]) => {
    if (tracks === state.tracks) tracks = { ...tracks };
    tracksDirty = true;
    if (nextPoints.length === 0) delete tracks[id];
    else tracks[id] = nextPoints;
  };
  for (const [id, points] of Object.entries(tracks)) {
    const archived = storedTrackAfterArchive(points, now);
    if (archived.points !== points) putTrack(id, archived.points);
    if (archived.journeys.length === 0) continue;
    const spots = knownSpots({ ...state, journeys }, id);
    const labeled = archived.journeys.map((journey: JourneyRecord) => ({
      ...journey,
      start: labelJourneyPlace(journey.start, spots),
      end: labelJourneyPlace(journey.end, spots),
    }));
    const merged = trimJourneyList(mergeJourneyLists(journeys[id], labeled), now);
    const current = journeys[id] ?? [];
    if (merged === current) continue;
    const next = { ...journeys };
    if (merged.length === 0) delete next[id];
    else next[id] = merged;
    journeys = next;
  }
  if (!tracksDirty && journeys === (state.journeys ?? {})) return state;
  return {
    ...state,
    trailDay: seoulDayKey(now),
    tracks,
    journeys,
  };
}

function visitsSame(current: Visit[], next: Visit[]): boolean {
  if (current.length !== next.length) return false;
  return current.every((visit, index) => {
    const other = next[index];
    return other && visit.id === other.id && visit.leftAt === other.leftAt && visit.lat === other.lat && visit.lng === other.lng && visit.label === other.label;
  });
}

function asShare(value: unknown, self: boolean): ShareState {
  if (self) return 'allowed';
  if (value === 'accepted' || value === 'allowed' || value === 'revoked' || value === 'invited') return value;
  return 'invited';
}

function cleanGuardians(value: unknown): GuardianLink[] {
  if (!Array.isArray(value)) return [];
  const links: GuardianLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const link = item as GuardianLink;
    const code = typeof link.code === 'string' ? link.code.replace(/\D/g, '').slice(0, 6) : '';
    if (typeof link.id !== 'string' || code.length < 4) continue;
    const share = link.share === 'allowed' || link.share === 'revoked' ? link.share : 'accepted';
    const syncToken = cleanSyncToken(link.syncToken);
    const rosterName = typeof link.rosterName === 'string' ? link.rosterName.trim().slice(0, 80) : '';
    const adminName = typeof link.adminName === 'string' ? link.adminName.trim().slice(0, 20) : '';
    links.push({
      id: link.id,
      label: (link.label || '관리자').slice(0, 20),
      code,
      share,
      leaveAlert: cleanLeaveAlert(link.leaveAlert),
      ...(syncToken ? { syncToken } : {}),
      ...(rosterName ? { rosterName } : {}),
      ...(adminName ? { adminName } : {}),
    });
  }
  return links;
}

function scrubSeed(member: Member, share: ShareState): Member {
  if (hasLocation(member) && isSeedLocation(member.lat, member.lng) && member.accuracyM === 18) {
    return { ...member, share, lat: null, lng: null };
  }
  return { ...member, share };
}

function cleanProfile(value: unknown): Profile | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { id?: unknown; name?: unknown; preview?: unknown; photo?: unknown; profileKey?: unknown };
  let name = typeof raw.name === 'string' ? raw.name : '';
  if (raw.preview === true && (name === '부건' || name === 'Bukeon')) name = '나';
  const id = typeof raw.id === 'string' ? raw.id : '';
  const profile = localProfile(name, id);
  if (!profile) return null;
  const photo = cleanPhoto(raw.photo);
  const profileKey = deviceProfileKey(raw.profileKey);
  return { ...profile, profileKey, ...(photo ? { photo } : {}) };
}

function memberIdOf(place: SharedPlace): string {
  return placeMemberId(place);
}

function withPublisher(member: Member, place: SharedPlace): Member {
  const memberId = memberIdOf(place);
  if (!memberId) return member;
  const name = place.name.trim().slice(0, 80);
  return { ...member, ...(name ? { name } : {}), publisherId: memberId };
}

function describeFamilyPlace(code: string, place: SharedPlace, profiles: SharedProfile[], current: Member[]) {
  const memberId = memberIdOf(place);
  const profile = memberId ? profiles.find((item) => item.memberId === memberId) : undefined;
  const name = (profile?.name || place.name).trim().slice(0, 80) || place.name;
  const photo = profile?.photo ? cleanPhoto(profile.photo) : undefined;
  const id = familyPinId(code, place);
  const battery = typeof place.batteryPct === 'number' ? Math.round(place.batteryPct) : null;
  const charging = place.charging === true ? true : place.charging === false ? false : null;
  const previous = current.find((entry) => entry.id === id || (memberId !== '' && entry.publisherId === memberId));
  return { id, memberId, name, photo: photo || previous?.photo, battery, charging, place };
}

function memberIndexForProfile(members: Member[], profile: SharedProfile, code: string): number {
  const byPublisher = members.findIndex((member) => member.id !== 'self' && member.publisherId === profile.memberId);
  if (byPublisher >= 0) return byPublisher;
  return members.findIndex((member) => member.id === `remote:${code}:${profile.memberId}` || member.id === `family:${code}:${profile.memberId}`);
}

function withoutDemo(session: Session): Session {
  const legacy = session.profile as (Profile & { preview?: boolean }) | null;
  const previewAlias = !!legacy && legacy.preview === true && (legacy.name === '부건' || legacy.name === 'Bukeon');
  const profile = cleanProfile(previewAlias && session.profile ? { ...session.profile, name: '나' } : session.profile);
  const members = session.members
    .filter((member) => member.id !== 'sample' && member.name !== '샘플' && member.role !== 'guardian' && !('isSample' in member && (member as { isSample?: boolean }).isSample))
    .map((member) => {
      const renamed = member.id === 'self' && previewAlias ? { ...member, name: '나' } : member;
      const share = renamed.role === 'admin-share' ? 'allowed' : asShare(renamed.share, renamed.id === 'self');
      const charging = renamed.charging === true ? true : renamed.charging === false ? false : null;
      const battery = typeof renamed.battery === 'number' && renamed.battery >= 0 && renamed.battery <= 100 ? Math.round(renamed.battery) : null;
      const photo = cleanPhoto(renamed.photo) || (renamed.id === 'self' ? cleanPhoto(profile?.photo) : undefined);
      const place = cleanPlace(renamed.place);
      const publisherId = isMemberId(renamed.publisherId) ? renamed.publisherId : '';
      const next = {
        ...renamed,
        share,
        charging,
        battery,
        ...(photo ? { photo } : { photo: undefined }),
        ...(publisherId ? { publisherId } : { publisherId: undefined }),
        ...(place ? { place } : { place: undefined }),
      };
      if (renamed.role === 'admin-share') return next;
      if (renamed.id !== 'self' && share !== 'allowed') return { ...next, lat: null, lng: null };
      return scrubSeed(next, share);
    });
  const kept = new Set(members.map((member) => member.id));
  const tracks: Record<string, TrackPoint[]> = {};
  for (const [id, points] of Object.entries(session.tracks)) {
    if (!kept.has(id)) continue;
    const clean = points.filter((point) => !isSeedLocation(point.lat, point.lng));
    if (clean.length > 0) tracks[id] = clean;
  }
  const journeys: Record<string, Journey[]> = {};
  for (const [id, list] of Object.entries(session.journeys ?? {})) {
    if (!kept.has(id) || !Array.isArray(list) || list.length === 0) continue;
    const trimmed = trimJourneyList(list, Date.now());
    if (trimmed.length === 0) continue;
    journeys[id] = trimmed;
  }
  const profileId = profile?.id;
  const nextMembers = withoutSelfEcho(members, profileId, session.inviteCode, profile?.name);
  return { ...session, profile, members: nextMembers, tracks, journeys, mode: null, guardians: cleanGuardians(session.guardians) };
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const session = value as Session;
  return typeof session.inviteCode === 'string' && Array.isArray(session.members) && !!session.permissions;
}

function load(): Session {
  const pendingSyncToken = takeSyncTokenFromUrl();
  if (shouldReset()) {
    clearStoredSessions();
    const url = new URL(window.location.href);
    url.searchParams.delete('reset');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return { ...fresh(), pendingSyncToken };
  }
  try {
    const merged = mergePeerSessions(storedSnapshots());
    if (!merged || !isSession(merged)) {
      const sealed = sealedSession();
      if (sealed) {
        pendingDeviceSeal = sealed;
        restoringDeviceSeal = true;
        sealOpened = false;
      } else {
        sealOpened = true;
      }
      return { ...fresh(), pendingSyncToken };
    }
    sealOpened = true;
    const parsed = merged;
    const invite = readInvite();
    const base = fresh();
    const session: Session = {
      ...base,
      ...parsed,
      terms: { ...EMPTY_TERMS, ...parsed.terms },
      permissions: { ...EMPTY_PERMISSIONS, ...parsed.permissions },
      tracks: cleanTracks((parsed as Session).tracks),
      home: cleanHome(parsed.home),
      pendingInvite: invite || parsed.pendingInvite,
      mode: null,
      guardians: cleanGuardians(parsed.guardians),
      pendingLeaveAlert: readLeaveAlert() || cleanLeaveAlert(parsed.pendingLeaveAlert),
      syncWriteKey: isKeyPart(parsed.syncWriteKey) ? parsed.syncWriteKey : base.syncWriteKey,
      syncReadKey: isKeyPart(parsed.syncReadKey) ? parsed.syncReadKey : base.syncReadKey,
      pendingSyncToken: pendingSyncToken || cleanSyncToken(parsed.pendingSyncToken),
      hiddenMemberIds: cleanHidden((parsed as Session).hiddenMemberIds),
      motionNotifyIds: cleanMotionNotifyIds((parsed as Session).motionNotifyIds),
      motionAlertPhase: cleanMotionPhase((parsed as Session).motionAlertPhase),
      trailDay: typeof parsed.trailDay === 'string' ? parsed.trailDay : '',
      visits: cleanVisits(parsed.visits),
      journeys: cleanJourneys((parsed as Session).journeys),
      trailRevisions: cleanTrailRevisions((parsed as Session).trailRevisions),
      shareSelfWithFamily: parsed.shareSelfWithFamily === true,
      locationConsent: parsed.locationConsent !== false,
      backgroundKeepAlive: parsed.backgroundKeepAlive === true,
      phoneVerified: false,
      phone: '',
      tab: parsed.tab === 'history' || parsed.tab === 'menu' ? parsed.tab : 'map',
    };
    if (session.stage === 'phone') session.stage = 'permissions';
    const loaded = withoutDemo(session);
    const profile = loaded.profile;
    const now = Date.now();
    const stage = !profile
      ? (loaded.stage === 'splash' ? 'splash' : 'login')
      : loaded.permissions.completed
        ? 'map'
        : (loaded.stage === 'mode' ? 'survey' : loaded.stage);
    return collapseRoster(archiveJourneys({
      ...loaded,
      profile,
      phone: '',
      phoneVerified: false,
      stage,
      trailDay: seoulDayKey(now),
      tracks: tracksWithinHistory(loaded.tracks, now),
      visits: visitsWithinHistory(loaded.visits, now),
      journeys: journeysWithinHistory(loaded.journeys ?? {}, now),
    }, now));
  } catch {
    const sealed = sealedSession();
    if (sealed) {
      pendingDeviceSeal = sealed;
      restoringDeviceSeal = true;
      sealOpened = false;
    } else {
      sealOpened = true;
    }
    return { ...fresh(), pendingSyncToken };
  }
}

type Action =
  | { type: 'splash-done' }
  | { type: 'login'; profile: Profile }
  | { type: 'choose-mode'; mode: AppMode }
  | { type: 'test-switch-mode' }
  | { type: 'reopen-mode' }
  | { type: 'close-mode' }
  | { type: 'skip-survey' }
  | { type: 'pick-survey'; id: string }
  | { type: 'back' }
  | { type: 'toggle-term'; id: string; value: boolean }
  | { type: 'toggle-all-terms'; on: boolean }
  | { type: 'continue-terms' }
  | { type: 'withdraw-location-consent' }
  | { type: 'rehydrate' }
  | { type: 'save-phone'; phone: string }
  | { type: 'skip-phone' }
  | { type: 'finish-permissions'; permissions: PermissionState }
  | { type: 'note-location'; locationMode: PermissionState['locationMode']; accuracy: PermissionState['accuracy'] }
  | { type: 'set-tab'; tab: FamilyTab }
  | { type: 'save-home'; home: HomeZone }
  | { type: 'clear-home' }
  | { type: 'add-member'; name: string; code: string }
  | { type: 'remove-member'; id: string }
  | { type: 'accept-invite'; label: string; code: string; syncToken: string | null; rosterName: string | null; adminName: string | null; ownerMemberId: string | null }
  | { type: 'set-guardian-share'; code: string; share: 'allowed' | 'revoked' }
  | { type: 'leave-guardian'; id: string }
  | { type: 'dismiss-invite' }
  | { type: 'mark-alerts-read' }
  | { type: 'update-self'; lat: number; lng: number; accuracyM: number; speedMps: number | null }
  | { type: 'set-battery'; battery: number | null; charging: boolean | null }
  | { type: 'roll-day'; now: number }
  | { type: 'set-share-self'; share: boolean }
  | { type: 'set-keep-alive'; on: boolean }
  | { type: 'apply-shared-place'; place: SharedPlace }
  | { type: 'apply-shared-profiles'; code: string; profiles: SharedProfile[] }
  | { type: 'set-room-family-places'; code: string; places: SharedPlace[]; profiles: SharedProfile[]; departed?: string[] }
  | { type: 'apply-canonical-trails'; trails: CanonicalTrail[] }
  | { type: 'merge-visits'; memberId: string; stops: DayStop[] }
  | { type: 'set-visit-label'; memberId: string; id: string; label: string }
  | { type: 'set-journey-label'; memberId: string; id: string; which: 'start' | 'end'; label: string; lat?: number; lng?: number }
  | { type: 'set-photo'; photo: string | null }
  | { type: 'set-display-name'; name: string }
  | { type: 'set-self-place'; place: string | null }
  | { type: 'set-member-place'; id: string; place: string | null }
  | { type: 'close-journeys'; now: number }
  | { type: 'set-motion'; moving: boolean }
  | { type: 'set-motion-notify'; ids: string[] }
  | { type: 'set-motion-alert-phase'; phase: Session['motionAlertPhase'] }
  | { type: 'notice'; notice: FamilyNotice }
  | { type: 'logout' }
  | { type: 'fill-history'; journeys: Journey[]; visits: Visit[]; home: Session['home'] }
  | { type: 'unlock-history'; journeys: Journey[]; visits: Visit[]; home: Session['home'] }
  | { type: 'restore-account'; account: Parameters<typeof applyAccountSnapshot>[1] }
  | { type: 'clear-family-room'; serverNote: string | null }
  | { type: 'revisit-permissions' };

function notice(title: string, body: string): FamilyNotice {
  return { id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title, body, at: Date.now(), read: false };
}

function collapseRoster(state: Session, priorNames: Record<string, string> = {}): Session {
  const { members, moves } = absorbPlaceholderMembers(state.members, priorNames);
  if (moves.length === 0) return state;
  let tracks = state.tracks;
  let visits = state.visits;
  let journeys = state.journeys ?? {};
  for (const move of moves) {
    tracks = moveKeyed(tracks, move.from, move.to);
    visits = moveKeyed(visits, move.from, move.to);
    journeys = moveKeyed(journeys, move.from, move.to);
  }
  const moved = new Map(moves.map((move) => [move.from, move.to]));
  const motionNotifyIds: string[] = [];
  for (const id of state.motionNotifyIds || []) {
    const next = moved.get(id) || id;
    if (!motionNotifyIds.includes(next)) motionNotifyIds.push(next);
  }
  return { ...state, members, tracks, visits, journeys, motionNotifyIds };
}

function placePatch(member: Member | undefined, lat: number, lng: number, points: TrackPoint[] | undefined, accuracyM: number, at: number) {
  if (!member) return { place: undefined, placeLat: undefined, placeLng: undefined };
  const kept = carryPlace(member, lat, lng, {
    directed: walkLeavesStay(points, { lat, lng, at, accuracyM, staying: member.moving === false }),
    accuracyM,
  });
  if (!kept) return { place: undefined, placeLat: undefined, placeLng: undefined };
  return {
    place: kept,
    placeLat: Number.isFinite(member.placeLat) ? member.placeLat : member.lat,
    placeLng: Number.isFinite(member.placeLng) ? member.placeLng : member.lng,
  };
}

function reducer(state: Session, action: Action): Session {
  return collapseRoster(reduceSession(state, action));
}

function reduceSession(state: Session, action: Action): Session {
  switch (action.type) {
    case 'splash-done':
      if (!state.profile) return { ...state, stage: 'login' };
      return { ...state, mode: null, stage: state.permissions.completed ? 'map' : 'survey' };
    case 'login': {
      const cleaned = cleanProfile({ ...action.profile, profileKey: action.profile.profileKey || state.profile?.profileKey });
      if (!cleaned) return state;
      const photo = cleaned.photo || cleanPhoto(state.profile?.photo);
      const profile = photo ? { ...cleaned, photo } : cleaned;
      const members = state.members.some((member) => member.id === 'self')
        ? state.members.map((member) => (member.id === 'self' ? { ...member, name: profile.name, ...(photo ? { photo } : {}) } : member))
        : membersFor(profile);
      return withoutDemo({
        ...state,
        profile,
        members,
        mode: null,
        phone: '',
        phoneVerified: false,
        stage: state.permissions.completed ? 'map' : 'survey',
      });
    }
    case 'choose-mode':
    case 'test-switch-mode':
    case 'reopen-mode':
    case 'close-mode':
      return { ...state, mode: null, stage: state.stage === 'mode' ? 'survey' : state.stage };
    case 'skip-survey':
      return { ...state, stage: 'terms' };
    case 'pick-survey':
      return { ...state, survey: action.id, stage: 'terms' };
    case 'back': {
      const order: Stage[] = ['login', 'survey', 'terms', 'permissions'];
      const index = order.indexOf(state.stage);
      if (index <= 0) return state;
      return { ...state, stage: order[index - 1] };
    }
    case 'toggle-term':
      return { ...state, terms: { ...state.terms, [action.id]: action.value } };
    case 'toggle-all-terms':
      return {
        ...state,
        terms: Object.fromEntries(Object.keys(EMPTY_TERMS).map((id) => [id, action.on])),
      };
    case 'continue-terms':
      if (!REQUIRED_TERMS.every((id) => state.terms[id])) return state;
      return { ...state, stage: 'permissions', locationConsent: true };
    case 'withdraw-location-consent':
      return { ...state, locationConsent: false, shareSelfWithFamily: false, backgroundKeepAlive: false };
    case 'rehydrate':
      return load();
    case 'save-phone':
    case 'skip-phone':
      return { ...state, phone: '', phoneVerified: false, stage: 'permissions' };
    case 'finish-permissions':
      return {
        ...state,
        permissions: { ...action.permissions, completed: true },
        stage: 'map',
        tab: 'map',
        shareSelfWithFamily: true,
        guardians: state.guardians.map((link) => ({ ...link, share: 'allowed' as const })),
      };
    case 'note-location': {
      if (state.permissions.locationMode === action.locationMode && state.permissions.accuracy === action.accuracy) return state;
      return {
        ...state,
        permissions: { ...state.permissions, locationMode: action.locationMode, accuracy: action.accuracy },
      };
    }
    case 'set-tab':
      return { ...state, tab: action.tab };
    case 'save-home': {
      const created = notice(
        '우리 집을 저장했습니다',
        `반경 ${action.home.radiusM}m입니다. 위치를 공유한 가족이 이 원을 나가면 이 폰에 알림이 남습니다.`,
      );
      return archiveJourneys({
        ...state,
        home: { ...action.home, alertPhone: '' },
        homeCleared: false,
        phone: state.phone,
        notices: [created, ...state.notices],
        tab: 'map',
      }, Date.now());
    }
    case 'clear-home':
      return { ...state, home: null, homeCleared: true };
    case 'add-member': {
      const name = action.name.trim();
      if (name.length < 1) return state;
      const member: Member = {
        id: `m-${Date.now()}`,
        name,
        role: 'child',
        lat: null,
        lng: null,
        accuracyM: 0,
        battery: null,
        charging: null,
        updatedAt: Date.now(),
        moving: null,
        inviteCode: action.code,
        share: 'invited',
      };
      return {
        ...state,
        members: [...state.members, member],
        notices: [notice('초대를 만들었습니다', `${member.name} 님은 자기 폰에서 초대를 수락한 뒤, 위치 공유를 허용하면 가족 지도에 나타납니다.`), ...state.notices],
      };
    }
    case 'remove-member': {
      if (action.id === 'self') return state;
      const removed = state.members.find((member) => member.id === action.id);
      if (!removed) return state;
      const tracks = { ...state.tracks };
      delete tracks[action.id];
      const journeys = { ...state.journeys };
      delete journeys[action.id];
      const hiddenMemberIds = cleanHidden([...(state.hiddenMemberIds || []), ...hiddenKeysForMember(removed)]);
      return {
        ...state,
        members: state.members.filter((member) => member.id !== action.id),
        tracks,
        journeys,
        hiddenMemberIds,
        motionNotifyIds: (state.motionNotifyIds || []).filter((id) => id !== action.id),
        notices: [notice('가족을 지웠습니다', `${removed.name} 님을 이 기기의 목록과 지도에서 뺐습니다. 같은 방이 다시 받아도 이 폰에는 돌아오지 않습니다.`), ...state.notices],
      };
    }
    case 'accept-invite': {
      const code = action.code.replace(/\D/g, '').slice(0, 6);
      const label = action.label.trim().slice(0, 20) || '가족';
      if (code.length < 4) return state;
      if (state.guardians.some((link) => link.code === code)) return state;
      const leaveAlert = state.pendingInvite === code || readInvite() === code ? state.pendingLeaveAlert : null;
      const syncToken = cleanSyncToken(action.syncToken) || (state.pendingInvite === code ? cleanSyncToken(state.pendingSyncToken) : null);
      const rosterName = typeof action.rosterName === 'string' ? action.rosterName.trim().slice(0, 80) : '';
      const adminName = typeof action.adminName === 'string' ? action.adminName.trim().slice(0, 20) : '';
      const ownerMemberId = typeof action.ownerMemberId === 'string' ? action.ownerMemberId.trim().slice(0, 80) : '';
      const link: GuardianLink = {
        id: `g-${Date.now()}`,
        label,
        code,
        share: state.shareSelfWithFamily ? 'allowed' : 'accepted',
        leaveAlert,
        ...(syncToken ? { syncToken } : {}),
        ...(rosterName ? { rosterName } : {}),
        ...(adminName ? { adminName } : {}),
        ...(ownerMemberId ? { ownerMemberId } : {}),
      };
      const alertNote = leaveAlert ? ` 집 반경 ${leaveAlert.radiusM}m를 나가면 가족 지도에 알림이 남습니다.` : '';
      const sharingNote = state.shareSelfWithFamily
        ? `내 위치 공유는 이미 켜져 있어 이 방에도 바로 나갑니다.${alertNote}`
        : `내 위치는 아직 나가지 않습니다. 가족 목록에서 위치 공유를 허용하면 바로 시작되고, 앱을 다시 열어도 유지됩니다.${alertNote}`;
      return {
        ...state,
        mode: null,
        guardians: [...state.guardians, link],
        pendingInvite: null,
        pendingLeaveAlert: null,
        pendingSyncToken: null,
        notices: [notice('초대를 수락했습니다', `${label} 님의 가족 방에 참여했습니다. ${sharingNote}`), ...state.notices],
      };
    }
    case 'set-guardian-share': {
      const current = state.guardians.find((link) => link.code === action.code);
      if (!current || current.share === action.share) return state;
      const guardians = state.guardians.map((link) => (link.code === action.code ? { ...link, share: action.share } : link));
      const zoneNote = action.share === 'allowed' && current.leaveAlert
        ? ` ${current.leaveAlert.label} 반경 ${current.leaveAlert.radiusM}m를 나가면 가족에게 알립니다.`
        : '';
      const body = action.share === 'allowed'
        ? `${current.label} 님에게 내 위치 공유를 허용했습니다. 끄기 전에는 이 폰에서 공유 상태가 유지됩니다.${zoneNote}`
        : `${current.label} 님에게 보내던 위치 공유를 껐습니다. 집 이탈 알림도 함께 멈춥니다.`;
      return {
        ...state,
        guardians,
        shareSelfWithFamily: action.share === 'allowed' ? true : state.shareSelfWithFamily,
        notices: [notice(action.share === 'allowed' ? '위치 공유를 허용했습니다' : '위치 공유를 껐습니다', body), ...state.notices],
      };
    }
    case 'leave-guardian': {
      const current = state.guardians.find((link) => link.id === action.id);
      if (!current) return state;
      return {
        ...state,
        guardians: state.guardians.filter((link) => link.id !== action.id),
        notices: [notice('연결을 끊었습니다', `${current.label} 님과의 초대와 위치 공유를 이 폰에서 지웠습니다.`), ...state.notices],
      };
    }
    case 'dismiss-invite':
      return { ...state, pendingInvite: null };
    case 'mark-alerts-read':
      return { ...state, notices: state.notices.map((item) => ({ ...item, read: true })) };
    case 'update-self': {
      const at = Date.now();
      const speed = typeof action.speedMps === 'number' && Number.isFinite(action.speedMps) ? action.speedMps : null;
      const self = state.members.find((member) => member.id === 'self');
      const sample = {
        lat: action.lat,
        lng: action.lng,
        at,
        speedMps: speed,
        accuracyM: action.accuracyM,
        staying: self?.moving === false,
      };
      // A cruise often looks still to the accelerometer. GPS pace at bike speed or
      // faster is not a stay, so the vertex is kept and the card does not say 머무름.
      const riding = fixShowsRide(state.tracks.self, sample);
      if (riding) sample.staying = false;
      const settled = settleTrailPoint(state.tracks.self, sample, at);
      noteDiag({
        kind: 'filter',
        member: 'self',
        decision: settled.decision,
        accuracy: action.accuracyM,
        speed: speed ?? 0,
        lat: action.lat,
        lng: action.lng,
        stored: settled.points.length,
      });
      if (settled.decision === 'drop') {
        const nextLat = settled.lat;
        const nextLng = settled.lng;
        const pinMoved = !!self && nextLat != null && nextLng != null && (self.lat !== nextLat || self.lng !== nextLng);
        const tracks = tracksWithinHistory(
          settled.points === state.tracks.self ? state.tracks : { ...state.tracks, self: settled.points },
          at,
        );
        if (!pinMoved && tracks === state.tracks) return archiveJourneys(state, at);
        const selfPlace = pinMoved ? placePatch(self, nextLat, nextLng, state.tracks.self, action.accuracyM, at) : { place: self?.place, placeLat: self?.placeLat, placeLng: self?.placeLng };
        return archiveJourneys({
          ...state,
          visits: visitsWithinHistory(state.visits, at),
          tracks,
          members: pinMoved
            ? state.members.map((member) => (member.id === 'self'
              ? {
                  ...member,
                  lat: nextLat,
                  lng: nextLng,
                  accuracyM: Math.max(1, Math.round(action.accuracyM)),
                  updatedAt: at,
                  ...selfPlace,
                }
              : member))
            : state.members,
        }, at);
      }
      const tracks = tracksWithinHistory(
        settled.points === state.tracks.self ? state.tracks : { ...state.tracks, self: settled.points },
        at,
      );
      const nextLat = settled.lat ?? action.lat;
      const nextLng = settled.lng ?? action.lng;
      const selfPlace = placePatch(self, nextLat, nextLng, state.tracks.self, action.accuracyM, at);
      return archiveJourneys({
        ...state,
        visits: visitsWithinHistory(state.visits, at),
        members: state.members.map((member) =>
          member.id === 'self'
            ? {
                ...member,
                lat: nextLat,
                lng: nextLng,
                accuracyM: Math.max(1, Math.round(action.accuracyM)),
                updatedAt: at,
                ...(riding ? { moving: true } : {}),
                ...selfPlace,
              }
            : member,
        ),
        tracks,
      }, at);
    }
    case 'set-battery': {
      const self = state.members.find((member) => member.id === 'self');
      if (!self || (self.battery === action.battery && self.charging === action.charging)) return state;
      return {
        ...state,
        members: state.members.map((member) => (member.id === 'self' ? { ...member, battery: action.battery, charging: action.charging } : member)),
      };
    }
    case 'roll-day': {
      const visits = visitsWithinHistory(state.visits, action.now);
      const base = visits === state.visits ? state : { ...state, visits };
      return archiveJourneys(base, action.now);
    }
    case 'set-share-self':
      if (state.shareSelfWithFamily === action.share) return state;
      return {
        ...state,
        shareSelfWithFamily: action.share,
        guardians: state.guardians.map((link) => ({ ...link, share: action.share ? 'allowed' as const : 'revoked' as const })),
        notices: [notice(action.share ? '내 위치를 가족에게 공유합니다' : '내 위치 공유를 껐습니다', action.share ? '가족 지도에 내 핀이 나타납니다.' : '가족 지도에서 내 핀이 곧 사라집니다.'), ...state.notices],
      };
    case 'set-keep-alive':
      if (state.backgroundKeepAlive === action.on) return state;
      return { ...state, backgroundKeepAlive: action.on };
    case 'apply-shared-place': {
      const place = action.place;
      if (placeHidden(place.code, place, state.hiddenMemberIds || [])) return state;
      if (placeIsSelf(place, state.profile?.id)) return state;
      // leftover admin stop records are not a leave. Do not hide or delete history.
      if (sharedPlaceStopsReporting(place)) return state;
      const publisher = memberIdOf(place);
      if (place.audience === 'family') return state;
      if (!publisher) return state;
      const target = resolveManagedTarget(state.members, place);
      if (!target.id) return state;
      const liveFix = place.sharing && place.lat != null && place.lng != null && Number.isFinite(place.lat) && Number.isFinite(place.lng);
      if (target.create && !liveFix) return state;
      const members = target.create ? [...state.members, target.create] : state.members;
      const member = members.find((item) => item.id === target.id);
      if (!member) return state;
      state = { ...state, members };
      if (place.lat == null || place.lng == null || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
        const battery = typeof place.batteryPct === 'number' ? Math.round(place.batteryPct) : member.battery;
        const charging = place.charging === true ? true : place.charging === false ? false : member.charging;
        if (hasLocation(member)) {
          const nextName = memberIdOf(place) ? place.name.trim().slice(0, 80) : member.name;
          if (member.share === 'allowed' && member.battery === battery && member.charging === charging && member.name === nextName && (member.publisherId || '') === (memberIdOf(place) || '')) return state;
          return {
            ...state,
            members: state.members.map((item) => (item.id === member.id ? withPublisher({ ...item, share: 'allowed', battery, charging }, place) : item)),
          };
        }
        if (member.share === 'allowed' && (member.publisherId || '') === (memberIdOf(place) || '') && member.name === (memberIdOf(place) ? place.name.trim().slice(0, 80) : member.name)) return state;
        return {
          ...state,
          members: state.members.map((item) => (item.id === member.id ? withPublisher({ ...item, share: 'allowed', lat: null, lng: null, battery, charging }, place) : item)),
        };
      }
      if (isSeedLocation(place.lat, place.lng) && place.accuracyM === 18) return state;
      if (member.updatedAt > place.at && hasLocation(member)) return state;
      const battery = typeof place.batteryPct === 'number' ? Math.round(place.batteryPct) : member.battery;
      const charging = place.charging === true ? true : place.charging === false ? false : member.charging;
      const sameSpot = hasLocation(member) && member.lat === place.lat && member.lng === place.lng;
      const nextName = memberIdOf(place) ? place.name.trim().slice(0, 80) : member.name;
      if (
        sameSpot
        && member.updatedAt === place.at
        && member.battery === battery
        && member.charging === charging
        && member.share === 'allowed'
        && member.name === nextName
        && (member.publisherId || '') === (memberIdOf(place) || '')
      ) return state;
      if (canonicalTrailAt(state, member) > 0 && place.lat != null && place.lng != null) {
        const keptPlace = placePatch(member, place.lat, place.lng, state.tracks[member.id], place.accuracyM || 0, place.at);
        return {
          ...state,
          members: state.members.map((item) =>
            item.id === member.id
              ? withPublisher({
                  ...item,
                  share: 'allowed',
                  lat: place.lat,
                  lng: place.lng,
                  accuracyM: Math.max(1, Math.round(place.accuracyM || item.accuracyM || 1)),
                  battery,
                  charging,
                  updatedAt: place.at,
                  ...keptPlace,
                }, place)
              : item,
          ),
        };
      }
      const now = Date.now();
      const keptTracks = tracksWithinHistory(state.tracks, now);
      const settled = settleTrailPoint(keptTracks[member.id], {
        lat: place.lat,
        lng: place.lng,
        at: place.at,
        accuracyM: place.accuracyM,
      }, now);
      noteDiag({
        kind: 'filter',
        member: 'family',
        decision: settled.decision,
        accuracy: place.accuracyM || 0,
        lat: place.lat,
        lng: place.lng,
        stored: settled.points.length,
      });
      const tracks = isWithinHistory(place.at, now)
        ? { ...keptTracks, [member.id]: settled.points }
        : keptTracks;
      const lat = settled.decision === 'drop' && hasLocation(member) ? member.lat : (settled.lat ?? place.lat);
      const lng = settled.decision === 'drop' && hasLocation(member) ? member.lng : (settled.lng ?? place.lng);
      const keptPlace = placePatch(member, lat, lng, keptTracks[member.id], place.accuracyM || 0, place.at);
      return archiveJourneys({
        ...state,
        visits: visitsWithinHistory(state.visits, now),
        members: state.members.map((item) =>
          item.id === member.id
            ? withPublisher({
                ...item,
                share: 'allowed',
                lat,
                lng,
                accuracyM: Math.max(1, Math.round(place.accuracyM || item.accuracyM || 1)),
                battery,
                charging,
                updatedAt: place.at,
                ...keptPlace,
                needsAppUpdate: place.legacyClient === true,
              }, place)
            : item,
        ),
        tracks,
      }, now);
    }
    case 'set-room-family-places': {
      const joinedRoom = action.code === state.inviteCode || state.guardians.some((link) => link.code === action.code);
      if (!joinedRoom) return state;
      const prefix = `family:${action.code}:`;
      const now = Date.now();
      const today = seoulDayKey(now);
      const profiles = action.profiles ?? [];
      const hidden = state.hiddenMemberIds || [];
      state = hideLeftPublishers(state, action.departed || []);
      const incoming = action.places.filter((place) => (
        place.audience === 'family'
        && place.sharing
        && place.lat != null
        && place.lng != null
        && Number.isFinite(place.lat)
        && Number.isFinite(place.lng)
        && memberIdOf(place) !== ''
        && !placeIsSelf(place, state.profile?.id)
        && !isSelfEchoPlace(place, state.profile?.id, state.inviteCode)
        && !placeHidden(action.code, place, hidden)
      ));
      const current = state.members.filter((member) => member.id.startsWith(prefix));
      const priorNames: Record<string, string> = {};
      const byMember = new Map<string, ReturnType<typeof describeFamilyPlace>>();
      for (const place of incoming) {
        const item = describeFamilyPlace(action.code, place, profiles, current);
        if (!item.id || !item.memberId) continue;
        const prior = typeof place.priorName === 'string' ? place.priorName.trim() : '';
        if (prior) priorNames[item.memberId] = prior;
        const prev = byMember.get(item.memberId);
        if (!prev || place.at >= prev.place.at) byMember.set(item.memberId, item);
      }
      const described = [...byMember.values()];
      const unchanged = current.length === described.length && described.every((item) => {
        const member = current.find((entry) => entry.id === item.id || (item.memberId && entry.publisherId === item.memberId));
        return !!member
          && member.id === item.id
          && member.updatedAt === item.place.at
          && member.lat === item.place.lat
          && member.lng === item.place.lng
          && member.battery === item.battery
          && member.charging === item.charging
          && member.name === item.name
          && (member.photo || '') === (item.photo || '')
          && member.needsAppUpdate === (item.place.legacyClient === true);
      });
      if (unchanged) return collapseRoster(state, priorNames);
      let tracks = tracksWithinHistory(state.tracks, now);
      let visits = visitsWithinHistory(state.visits, now);
      let journeys = state.journeys ?? {};
      let members = state.members.filter((member) => !member.id.startsWith(prefix));
      for (const item of described) {
        const place = item.place;
        if (place.lat == null || place.lng == null) continue;
        const previous = current.find((entry) => entry.id === item.id || (item.memberId !== '' && entry.publisherId === item.memberId));
        if (previous && previous.id !== item.id) {
          tracks = moveKeyed(tracks, previous.id, item.id);
          visits = moveKeyed(visits, previous.id, item.id);
          journeys = moveKeyed(journeys, previous.id, item.id);
        }
        const roster = bindPlaceToMember(members, place);
        if (roster) {
          if (item.id !== roster.id) {
            tracks = moveKeyed(tracks, item.id, roster.id);
            visits = moveKeyed(visits, item.id, roster.id);
            journeys = moveKeyed(journeys, item.id, roster.id);
          }
          const priorPoints = tracks[roster.id];
          const settled = canonicalTrailAt(state, { publisherId: item.memberId }) > 0 || !isWithinHistory(place.at, now)
            ? null
            : settleTrailPoint(priorPoints, { lat: place.lat, lng: place.lng, at: place.at, accuracyM: place.accuracyM }, now);
          if (settled) {
            noteDiag({
              kind: 'filter',
              member: 'family',
              decision: settled.decision,
              accuracy: place.accuracyM || 0,
              lat: place.lat,
              lng: place.lng,
              stored: settled.points.length,
            });
            tracks = { ...tracks, [roster.id]: settled.points };
          }
          const lat = settled && settled.decision === 'drop' && hasLocation(roster) ? roster.lat : (settled?.lat ?? place.lat);
          const lng = settled && settled.decision === 'drop' && hasLocation(roster) ? roster.lng : (settled?.lng ?? place.lng);
          const keptPlace = placePatch(roster, lat, lng, priorPoints, place.accuracyM || 0, place.at);
          members = members.map((entry) => (entry.id === roster.id
            ? {
                ...entry,
                share: 'allowed',
                lat,
                lng,
                accuracyM: Math.max(1, Math.round(place.accuracyM || 1)),
                battery: item.battery ?? entry.battery,
                charging: item.charging ?? entry.charging,
                updatedAt: place.at,
                ...(item.name ? { name: item.name } : {}),
                ...(item.memberId ? { publisherId: item.memberId } : {}),
                ...(item.photo ? { photo: item.photo } : {}),
                ...keptPlace,
                needsAppUpdate: place.legacyClient === true,
              }
            : entry));
          continue;
        }
        const keptPlace = previous ? carryPlace(previous, place.lat, place.lng) : '';
        members = [...members, {
          id: item.id,
          name: item.name,
          role: 'admin-share',
          lat: place.lat,
          lng: place.lng,
          accuracyM: Math.max(1, Math.round(place.accuracyM || 1)),
          battery: item.battery,
          charging: item.charging,
          updatedAt: place.at,
          moving: null,
          share: 'allowed',
          ...(item.memberId ? { publisherId: item.memberId } : {}),
          ...(item.photo ? { photo: item.photo } : {}),
          ...(keptPlace ? { place: keptPlace } : {}),
          needsAppUpdate: place.legacyClient === true,
        }];
        if (canonicalTrailAt(state, { publisherId: item.memberId }) === 0 && isWithinHistory(place.at, now)) {
          const settled = settleTrailPoint(tracks[item.id], { lat: place.lat, lng: place.lng, at: place.at, accuracyM: place.accuracyM }, now);
          noteDiag({
            kind: 'filter',
            member: 'family',
            decision: settled.decision,
            accuracy: place.accuracyM || 0,
            lat: place.lat,
            lng: place.lng,
            stored: settled.points.length,
          });
          tracks = { ...tracks, [item.id]: settled.points };
          const pinned = members[members.length - 1];
          if (pinned && settled.decision !== 'keep' && settled.lat != null && settled.lng != null) {
            members[members.length - 1] = { ...pinned, lat: settled.lat, lng: settled.lng };
          }
        }
      }
      for (const member of current) {
        if (!members.some((item) => item.id === member.id)) delete tracks[member.id];
      }
      return collapseRoster(archiveJourneys({ ...state, members, tracks, visits, journeys, trailDay: today }, now), priorNames);
    }
    case 'apply-canonical-trails': {
      const selfId = state.profile?.id || '';
      let tracks = state.tracks;
      let journeys = state.journeys ?? {};
      let members = state.members;
      let revisions = { ...(state.trailRevisions || {}) };
      let changed = false;
      for (const trail of action.trails) {
        if (!isMemberId(trail.memberId) || trail.memberId === selfId) continue;
        if ((revisions[trail.memberId] || 0) > trail.at) continue;
        const member = members.find((item) => item.id !== 'self' && item.publisherId === trail.memberId);
        if (!member) continue;
        const sameAt = revisions[trail.memberId] === trail.at;
        const sameLine = (tracks[member.id] || []).length === trail.points.length;
        if (sameAt && sameLine && (journeys[member.id] || []).length === trail.journeys.length && member.moving === trail.moving) continue;
        changed = true;
        revisions = { ...revisions, [trail.memberId]: trail.at };
        tracks = { ...tracks, [member.id]: trail.points };
        journeys = { ...journeys, [member.id]: trail.journeys };
        members = members.map((item) => (item.id === member.id ? { ...item, moving: trail.moving } : item));
      }
      if (!changed) return state;
      return { ...state, tracks, journeys, members, trailRevisions: revisions };
    }
    case 'apply-shared-profiles': {
      const profiles = action.profiles.filter((profile) => isMemberId(profile.memberId) && profile.memberId !== state.profile?.id);
      if (profiles.length === 0) return state;
      const ownerMemberId = state.guardians.find((link) => link.code === action.code)?.ownerMemberId || '';
      const ensured = ensureRoster(state.members, profiles, action.code, ownerMemberId);
      let members = ensured.members;
      let changed = ensured.joined.length > 0;
      for (const profile of profiles) {
        const index = memberIndexForProfile(members, profile, action.code);
        if (index < 0) continue;
        const member = members[index];
        const name = profile.name.trim().slice(0, 20);
        if (!name) continue;
        const sentPhoto = typeof profile.photo === 'string' ? cleanPhoto(profile.photo) : undefined;
        const photo = typeof profile.photo === 'string' ? (sentPhoto || member.photo) : undefined;
        const lead = ownerMemberId !== '' && profile.memberId === ownerMemberId;
        if (member.name === name && (member.photo || '') === (photo || '') && member.publisherId === profile.memberId && member.lead === lead) continue;
        changed = true;
        members = members.map((item, itemIndex) => (itemIndex === index
          ? { ...item, name, publisherId: profile.memberId, ...(photo ? { photo } : { photo: undefined }), ...(lead ? { lead: true } : {}) }
          : item));
      }
      if (!changed) return state;
      const notes = ensured.joined.map((name) => notice('가족이 들어왔습니다', `${name} 님이 초대 링크로 가족에 참여했습니다. 그룹장이 목록에서 지울 수 있습니다.`));
      return { ...state, members, ...(notes.length ? { notices: [...notes, ...state.notices] } : {}) };
    }
    case 'merge-visits': {
      const now = Date.now();
      const base = visitsWithinHistory(state.visits, now);
      const current = base[action.memberId] ?? [];
      const next = mergeVisitStops(current, action.stops, now)
        .map((stop) => {
          const id = `${action.memberId}:${stop.arrivedAt}:${stop.lat.toFixed(4)}:${stop.lng.toFixed(4)}`;
          const prev = current.find((visit) => visit.id === id);
          return {
            id,
            lat: stop.lat,
            lng: stop.lng,
            arrivedAt: stop.arrivedAt,
            leftAt: stop.leftAt,
            label: prev?.label ?? null,
            source: prev?.label ? 'geocode' as const : 'coords' as const,
          };
        });
      const visits = visitsWithinHistory({ ...base, [action.memberId]: next }, now);
      const stored = visits[action.memberId] ?? [];
      if (visitsSame(current, stored) && base === state.visits) return state;
      return {
        ...state,
        trailDay: seoulDayKey(now),
        tracks: tracksWithinHistory(state.tracks, now),
        visits,
      };
    }
    case 'set-visit-label': {
      const list = state.visits[action.memberId];
      if (!list || list.some((visit) => visit.id === action.id && visit.label === action.label)) return state;
      return {
        ...state,
        visits: {
          ...state.visits,
          [action.memberId]: list.map((visit) => (visit.id === action.id ? { ...visit, label: action.label, source: 'geocode' } : visit)),
        },
      };
    }
    case 'close-journeys':
      return archiveJourneys(state, action.now);
    case 'set-journey-label': {
      const list = state.journeys[action.memberId];
      if (!list) return state;
      const label = action.label.trim().slice(0, 120);
      if (!label) return state;
      let changed = false;
      const next = list.map((journey) => {
        const place = journey[action.which];
        if (!place || place.label === label) return journey;
        const near = Number.isFinite(action.lat) && Number.isFinite(action.lng)
          && haversineMeters(place, { lat: action.lat as number, lng: action.lng as number }) <= 80;
        if (journey.id !== action.id && !near) return journey;
        if (place.label && journey.id !== action.id) return journey;
        changed = true;
        return { ...journey, [action.which]: { ...place, label } };
      });
      if (!changed) return state;
      return { ...state, journeys: { ...state.journeys, [action.memberId]: next } };
    }
    case 'set-display-name': {
      if (!state.profile) return state;
      const next = localProfile(action.name, state.profile.id);
      if (!next) return state;
      const profile = {
        ...next,
        profileKey: state.profile.profileKey || deviceProfileKey(),
        ...(state.profile.photo ? { photo: state.profile.photo } : {}),
      };
      return {
        ...state,
        profile,
        members: state.members.map((member) => (member.id === 'self' ? { ...member, name: profile.name } : member)),
      };
    }
    case 'set-photo': {
      if (!state.profile) return state;
      const photo = cleanPhoto(action.photo);
      const profile = photo ? { ...state.profile, photo } : { ...state.profile, photo: undefined };
      return {
        ...state,
        profile,
        members: state.members.map((member) => (
          member.id === 'self' ? { ...member, ...(photo ? { photo } : { photo: undefined }) } : member
        )),
      };
    }
    case 'set-self-place':
      return reducer(state, { type: 'set-member-place', id: 'self', place: action.place });
    case 'set-member-place': {
      const place = cleanPlace(action.place);
      const current = state.members.find((member) => member.id === action.id);
      if (!current || cleanPlace(current.place) === place) return state;
      return {
        ...state,
        members: state.members.map((member) => (
          member.id === action.id ? {
            ...member,
            ...(place ? { place, placeLat: member.lat, placeLng: member.lng } : { place: undefined, placeLat: undefined, placeLng: undefined }),
          } : member
        )),
      };
    }
    case 'set-motion': {
      const now = Date.now();
      const traveledAt = lastTravelAt(state.tracks.self);
      if (!action.moving && traveledAt != null && now >= traveledAt && now - traveledAt < stayLabelDwellMs(state.tracks.self)) return state;
      const self = state.members.find((member) => member.id === 'self');
      if (self?.moving === action.moving) return state;
      return {
        ...state,
        members: state.members.map((member) => (member.id === 'self' ? { ...member, moving: action.moving } : member)),
      };
    }
    case 'set-motion-notify': {
      const motionNotifyIds = cleanMotionNotifyIds(action.ids);
      const current = state.motionNotifyIds || [];
      if (motionNotifyIds.length === current.length && motionNotifyIds.every((id, index) => id === current[index])) return state;
      return { ...state, motionNotifyIds };
    }
    case 'set-motion-alert-phase': {
      const phase = cleanMotionPhase(action.phase);
      if ((state.motionAlertPhase || 'unknown') === phase) return state;
      return { ...state, motionAlertPhase: phase };
    }
    case 'notice':
      return { ...state, notices: [action.notice, ...state.notices].slice(0, 40) };
    case 'logout':
      return fresh('login');
    case 'fill-history': {
      const journeysEmpty = !Object.values(state.journeys || {}).some((list) => Array.isArray(list) && list.length > 0);
      const visitsEmpty = !Object.values(state.visits || {}).some((list) => Array.isArray(list) && list.length > 0);
      const nextJourneys = journeysEmpty && action.journeys.length
        ? { ...state.journeys, ...(cleanJourneys({ self: action.journeys })) }
        : state.journeys;
      const nextVisits = visitsEmpty && action.visits.length
        ? { ...state.visits, ...(cleanVisits({ self: action.visits })) }
        : state.visits;
      const nextHome = state.homeCleared ? state.home : (state.home || cleanHome(action.home));
      if (nextJourneys === state.journeys && nextVisits === state.visits && nextHome === state.home) return state;
      return {
        ...state,
        historyLocked: false,
        journeys: nextJourneys,
        visits: nextVisits,
        home: nextHome,
      };
    }
    case 'unlock-history': {
      return {
        ...state,
        historyLocked: false,
        sealedHistory: null,
        home: action.home || state.home,
        journeys: action.journeys.length ? { ...state.journeys, self: action.journeys } : state.journeys,
        visits: action.visits.length ? { ...state.visits, self: action.visits } : state.visits,
      };
    }
    case 'restore-account': {
      const restored = applyAccountSnapshot(state, action.account);
      if (restored === state || !restored.profile) return state;
      return withoutDemo({
        ...restored,
        phone: '',
        phoneVerified: false,
      });
    }
    case 'clear-family-room': {
      const self = state.members.find((member) => member.id === 'self');
      const next = fresh(state.stage);
      const noteBody = action.serverNote
        || '이 폰의 가족 목록과 초대를 지웠고, 그 방 동기화를 멈췄습니다. 내가 만든 방은 서버에서도 지웠습니다.';
      return {
        ...state,
        members: self ? [self] : [],
        tracks: state.tracks.self ? { self: state.tracks.self } : {},
        visits: state.visits.self ? { self: state.visits.self } : {},
        journeys: state.journeys?.self ? { self: state.journeys.self } : {},
        guardians: [],
        home: null,
        homeCleared: true,
        inviteCode: next.inviteCode,
        syncWriteKey: next.syncWriteKey,
        syncReadKey: next.syncReadKey,
        shareSelfWithFamily: false,
        pendingInvite: null,
        pendingLeaveAlert: null,
        pendingSyncToken: null,
        hiddenMemberIds: [],
        motionNotifyIds: [],
        motionAlertPhase: 'unknown',
        trailRevisions: {},
        notices: [notice(action.serverNote ? '가족 방을 나갔습니다' : '가족 방을 지웠습니다', noteBody), ...state.notices].slice(0, 40),
      };
    }
    case 'revisit-permissions':
      return { ...state, stage: 'permissions' };
    default:
      return state;
  }
}

interface FamilyApi {
  state: Session;
  splashDone: () => void;
  login: (profile: Profile) => void;
  restoreAccount: (account: Parameters<typeof applyAccountSnapshot>[1]) => void;
  unlockHistory: (journeys: Journey[], visits: Visit[], home: Session['home']) => void;
  closeMode: () => void;
  skipSurvey: () => void;
  pickSurvey: (id: string) => void;
  back: () => void;
  toggleTerm: (id: string, value: boolean) => void;
  toggleAllTerms: (on: boolean) => void;
  continueTerms: () => void;
  withdrawLocationConsent: () => void;
  savePhone: (phone: string) => void;
  skipPhone: () => void;
  finishPermissions: (permissions: PermissionState) => void;
  noteLocation: (locationMode: PermissionState['locationMode'], accuracy: PermissionState['accuracy']) => void;
  setTab: (tab: FamilyTab) => void;
  saveHome: (home: HomeZone) => void;
  clearHome: () => void;
  addMember: (name: string, code: string) => void;
  removeMember: (id: string) => void;
  acceptInvite: (label: string, code: string, syncToken?: string | null, rosterName?: string | null, adminName?: string | null, ownerMemberId?: string | null) => void;
  setGuardianShare: (code: string, share: 'allowed' | 'revoked') => void;
  leaveGuardian: (id: string) => void;
  dismissInvite: () => void;
  markAlertsRead: () => void;
  updateSelf: (lat: number, lng: number, accuracyM: number, speedMps?: number | null) => void;
  setBattery: (battery: number | null, charging: boolean | null) => void;
  rollDay: (now: number) => void;
  setShareSelf: (share: boolean) => void;
  setKeepAlive: (on: boolean) => void;
  applySharedPlace: (place: SharedPlace) => void;
  applySharedProfiles: (code: string, profiles: SharedProfile[]) => void;
  setRoomFamilyPlaces: (code: string, places: SharedPlace[], profiles?: SharedProfile[], departed?: string[]) => void;
  applyCanonicalTrails: (trails: CanonicalTrail[]) => void;
  mergeVisits: (memberId: string, stops: DayStop[]) => void;
  setVisitLabel: (memberId: string, id: string, label: string) => void;
  closeJourneys: (now: number) => void;
  setJourneyLabel: (memberId: string, id: string, which: 'start' | 'end', label: string, lat?: number, lng?: number) => void;
  setPhoto: (photo: string | null) => void;
  setDisplayName: (name: string) => void;
  setSelfPlace: (place: string | null) => void;
  setMemberPlace: (id: string, place: string | null) => void;
  setMotion: (moving: boolean) => void;
  setMotionNotify: (ids: string[]) => void;
  setMotionAlertPhase: (phase: Session['motionAlertPhase']) => void;
  pushNotice: (title: string, body: string) => void;
  logout: () => void;
  withdraw: () => void;
  clearFamilyRoom: (serverNote?: string | null) => void;
  revisitPermissions: () => void;
}

const FamilyContext = createContext<FamilyApi | null>(null);

export function FamilyProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  const [deviceReady, setDeviceReady] = useState(() => !pendingDeviceSeal);
  const restoreOnce = useRef(false);
  const [historyPulse, setHistoryPulse] = useState(0);
  useEffect(() => {
    const onKeys = () => {
      restoreOnce.current = false;
      setHistoryPulse((value) => value + 1);
    };
    window.addEventListener('umap-family-keys', onKeys);
    return () => window.removeEventListener('umap-family-keys', onKeys);
  }, []);

  useEffect(() => {
    if (state.profile || restoringDeviceSeal || !sealOpened) return;
    void umapLocation.stop();
  }, [state.profile, deviceReady]);

  useEffect(() => {
    const epoch = sealEpoch;
    const sealed = pendingDeviceSeal;
    if (!sealed) {
      setDeviceReady(true);
      return;
    }
    pendingDeviceSeal = '';
    void openDeviceText(sealed).then((plain) => {
      if (epoch !== sealEpoch) return;
      if (!plain) {
        restoringDeviceSeal = false;
        setDeviceReady(true);
        return;
      }
      try {
        sessionStorage.setItem(STORAGE_KEY, plain);
      } catch {
        restoringDeviceSeal = false;
        setDeviceReady(true);
        return;
      }
      sealOpened = true;
      restoringDeviceSeal = false;
      setDeviceReady(true);
      dispatch({ type: 'rehydrate' });
    });
  }, []);

  useEffect(() => {
    if (restoringDeviceSeal) return;
    const epoch = sealEpoch;
    const raw = JSON.stringify({ ...state, mode: null });
    if (!state.profile && sealedSession()) return;
    let wrote = false;
    try {
      const decision = commitDurableSession(typeof localStorage === 'undefined' ? null : localStorage, state, raw, {
        sealText: deviceSealAvailable() ? undefined : null,
        unreadSeal: !sealOpened,
      });
      if (!decision.wrote) {
        if (decision.plain && decision.plain !== appliedPlain) {
          appliedPlain = decision.plain;
          sessionStorage.setItem(STORAGE_KEY, decision.plain);
          dispatch({ type: 'rehydrate' });
        }
        return;
      }
      wrote = true;
      sessionStorage.setItem(STORAGE_KEY, raw);
      if (deviceSealAvailable()) {
        void sealDeviceText(raw).then((sealed) => {
          if (epoch !== sealEpoch) return;
          if (typeof sealed === 'string' && sealed.startsWith(DEVICE_SEAL_PREFIX)) {
            localStorage.setItem(STORAGE_KEY, sealed);
            localStorage.setItem(`${STORAGE_KEY}:at`, String(Date.now()));
          }
        });
      }
      localStorage.removeItem(`${STORAGE_KEY}:admin`);
      localStorage.removeItem(`${STORAGE_KEY}:managed`);
      localStorage.removeItem(`${STORAGE_KEY}:admin:at`);
      localStorage.removeItem(`${STORAGE_KEY}:managed:at`);
    } catch {
      /* 용량이 가득 차도 화면의 상태는 유지한다 */
    }
    if (wrote) scheduleAccountBackup(state);
  }, [state]);

  useEffect(() => {
    if (!deviceReady || restoringDeviceSeal || !needsHistoryRestore(state)) return;
    if (restoreOnce.current) return;
    const storage = typeof localStorage === 'undefined' ? null : localStorage;
    const beforeJ = Object.values(state.journeys || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    const beforeV = Object.values(state.visits || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    const accountKey = readStoredAccountKey(storage);
    restoreOnce.current = true;
    if (!accountKey) {
      noteDiag({ kind: 'restore', result: 'nokey', beforej: beforeJ, beforev: beforeV, afterj: beforeJ, afterv: beforeV });
      return;
    }
    let cancel = false;
    void (async () => {
      const loaded = await loadFamilyAccount(accountKey).catch(() => ({ ok: false as const }));
      if (cancel) return;
      if (!loaded.ok || !loaded.account) {
        noteDiag({ kind: 'restore', result: 'off', beforej: beforeJ, beforev: beforeV, afterj: beforeJ, afterv: beforeV });
        return;
      }
      const account = loaded.account as { sealedHistory?: unknown; updatedAt?: number; journeys?: unknown[]; visits?: unknown[] };
      const seal = account.sealedHistory ? 1 : 0;
      const bytes = account.sealedHistory ? JSON.stringify(account.sealedHistory).length : 0;
      const updated = typeof account.updatedAt === 'number' ? account.updatedAt : 0;
      const opened = await openAccountSecrets(loaded.account, storage).catch(() => null);
      if (cancel || !opened) {
        noteDiag({ kind: 'restore', result: 'off', seal, bytes, updated, beforej: beforeJ, beforev: beforeV, afterj: beforeJ, afterv: beforeV });
        return;
      }
      const openedAccount = opened as { historyLocked?: boolean; journeys?: unknown[]; visits?: unknown[] };
      const decrypt = openedAccount.historyLocked ? 'fail' : 'ok';
      const patch = fillFromAccount(opened);
      const afterJ = patch ? patch.journeys.length : 0;
      const afterV = patch ? patch.visits.length : 0;
      noteDiag({
        kind: 'restore',
        result: openedAccount.historyLocked ? 'locked' : (afterJ || afterV ? 'filled' : 'empty'),
        seal,
        bytes,
        updated,
        decrypt,
        beforej: beforeJ,
        beforev: beforeV,
        afterj: afterJ,
        afterv: afterV,
      });
      if (!patch || openedAccount.historyLocked) return;
      dispatch({
        type: 'fill-history',
        journeys: patch.journeys as Journey[],
        visits: patch.visits as Visit[],
        home: (patch.home || null) as Session['home'],
      });
    })();
    return () => {
      cancel = true;
    };
  }, [deviceReady, historyPulse, state.journeys, state.visits]);

  const api: FamilyApi = {
    state,
    splashDone: () => dispatch({ type: 'splash-done' }),
    login: (profile) => {
      resumeRoom();
      dispatch({ type: 'login', profile });
    },
    restoreAccount: (account) => {
      resumeRoom();
      dispatch({ type: 'restore-account', account });
    },
    unlockHistory: (journeys, visits, home) => dispatch({ type: 'unlock-history', journeys, visits, home }),
    closeMode: () => dispatch({ type: 'close-mode' }),
    skipSurvey: () => dispatch({ type: 'skip-survey' }),
    pickSurvey: (id) => dispatch({ type: 'pick-survey', id }),
    back: () => dispatch({ type: 'back' }),
    toggleTerm: (id, value) => dispatch({ type: 'toggle-term', id, value }),
    toggleAllTerms: (on) => dispatch({ type: 'toggle-all-terms', on }),
    continueTerms: () => dispatch({ type: 'continue-terms' }),
    withdrawLocationConsent: () => dispatch({ type: 'withdraw-location-consent' }),
    savePhone: (phone) => dispatch({ type: 'save-phone', phone }),
    skipPhone: () => dispatch({ type: 'skip-phone' }),
    finishPermissions: (permissions) => dispatch({ type: 'finish-permissions', permissions }),
    noteLocation: (locationMode, accuracy) => dispatch({ type: 'note-location', locationMode, accuracy }),
    setTab: (tab) => dispatch({ type: 'set-tab', tab }),
    saveHome: (home) => dispatch({ type: 'save-home', home }),
    clearHome: () => dispatch({ type: 'clear-home' }),
    addMember: (name, code) => dispatch({ type: 'add-member', name, code }),
    removeMember: (id) => dispatch({ type: 'remove-member', id }),
    acceptInvite: (label, code, syncToken, rosterName, adminName, ownerMemberId) => {
      resumeRoom(code);
      dispatch({ type: 'accept-invite', label, code, syncToken: syncToken ?? null, rosterName: rosterName ?? null, adminName: adminName ?? null, ownerMemberId: ownerMemberId ?? null });
    },
    setGuardianShare: (code, share) => dispatch({ type: 'set-guardian-share', code, share }),
    leaveGuardian: (id) => dispatch({ type: 'leave-guardian', id }),
    dismissInvite: () => dispatch({ type: 'dismiss-invite' }),
    markAlertsRead: () => dispatch({ type: 'mark-alerts-read' }),
    updateSelf: (lat, lng, accuracyM, speedMps) => dispatch({ type: 'update-self', lat, lng, accuracyM, speedMps: speedMps ?? null }),
    setBattery: (battery, charging) => dispatch({ type: 'set-battery', battery, charging }),
    rollDay: (now) => dispatch({ type: 'roll-day', now }),
    setShareSelf: (share) => dispatch({ type: 'set-share-self', share }),
    setKeepAlive: (on) => dispatch({ type: 'set-keep-alive', on }),
    applySharedPlace: (place) => dispatch({ type: 'apply-shared-place', place }),
    applySharedProfiles: (code, profiles) => dispatch({ type: 'apply-shared-profiles', code, profiles }),
    setRoomFamilyPlaces: (code, places, profiles, departed) => dispatch({ type: 'set-room-family-places', code, places, profiles: profiles ?? [], departed }),
    applyCanonicalTrails: (trails) => dispatch({ type: 'apply-canonical-trails', trails }),
    mergeVisits: (memberId, stops) => dispatch({ type: 'merge-visits', memberId, stops }),
    setVisitLabel: (memberId, id, label) => dispatch({ type: 'set-visit-label', memberId, id, label }),
    closeJourneys: (now) => dispatch({ type: 'close-journeys', now }),
    setJourneyLabel: (memberId, id, which, label, lat, lng) => dispatch({ type: 'set-journey-label', memberId, id, which, label, lat, lng }),
    setPhoto: (photo) => dispatch({ type: 'set-photo', photo }),
    setDisplayName: (name) => dispatch({ type: 'set-display-name', name }),
    setSelfPlace: (place) => dispatch({ type: 'set-self-place', place }),
    setMemberPlace: (id, place) => dispatch({ type: 'set-member-place', id, place }),
    setMotion: (moving) => dispatch({ type: 'set-motion', moving }),
    setMotionNotify: (ids) => dispatch({ type: 'set-motion-notify', ids }),
    setMotionAlertPhase: (phase) => dispatch({ type: 'set-motion-alert-phase', phase }),
    pushNotice: (title, body) => dispatch({ type: 'notice', notice: notice(title, body) }),
    logout: () => {
      cancelAccountBackup();
      cancelDeviceSealRestore();
      clearStoredSessions();
      clearDiag();
      logoutLocalAccount(typeof localStorage === 'undefined' ? null : localStorage);
      dispatch({ type: 'logout' });
    },
    withdraw: () => {
      cancelAccountBackup();
      cancelDeviceSealRestore();
      clearDiag();
      clearDeviceAccount(
        typeof localStorage === 'undefined' ? null : localStorage,
        typeof sessionStorage === 'undefined' ? null : sessionStorage,
      );
      dispatch({ type: 'logout' });
    },
    clearFamilyRoom: (serverNote) => dispatch({ type: 'clear-family-room', serverNote: serverNote ?? null }),
    revisitPermissions: () => dispatch({ type: 'revisit-permissions' }),
  };

  return <FamilyContext.Provider value={api}>{children}</FamilyContext.Provider>;
}

export function useFamily(): FamilyApi {
  const value = useContext(FamilyContext);
  if (!value) throw new Error('FamilyProvider가 없습니다.');
  return value;
}
