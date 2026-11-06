import { useEffect, useRef, useState } from 'react';
import { fixChannelSource, noteDiag } from '../../lib/diagLog.mjs';
import { hasLocation, haversineMeters } from '../../lib/geo';
import { isSelfEchoPlace } from '../../lib/peerFamily.mjs';
import { placePriorName } from '../../lib/placeAlias.mjs';
import { journeysToPublish } from '../../lib/historyMerge.mjs';
import { buildDayRecord, liveMotionLabel } from '../../lib/tracking.mjs';
import type { AcceptedFix } from '../../lib/tracking.mjs';
import { readSharedPlaces, publishSharedPlace, subscribeSharedPlaces, type SharedPlace } from '../../services/familyShare';
import { bytesToBase64Url } from '../../lib/familySeal.mjs';
import { familyKeyRecord } from '../../lib/familyVault.mjs';
import { syncRooms } from '../../lib/roomMerge.mjs';
import { familyEndpointAvailable, familySyncUrl, publishProfileRemote, publishTrailRemote, splitSyncToken, startManagedFamilySync, syncFamilyKeys, syncTokenFor } from '../../services/familySync';
import { startLocationWatch } from '../../services/locationWatch';
import { cleanPlace, savedPlaceLabel } from '../../lib/memberPlace.mjs';
import { cachedAddress, placeGridKey, presentPlace, reverseGeocodeCached } from '../../services/placeGeocode';
import { openAlwaysLocation, readNativeBattery, umapLocation, umapLocationNative, type KeepAliveTarget } from '../../services/umapLocation';
import { useFamily } from './session';

const WAITING_KO: Record<string, string> = {
  stale: '저장된 위치는 두고, 방금 받은 위치를 기다리는 중입니다',
  accuracy: '오차가 큰 점은 버리고 더 정확한 위치를 기다립니다',
  coords: '위치 값을 다시 확인하는 중입니다',
  jump: '튀는 위치는 무시하고 있습니다',
  denied: '위치 권한을 확인해 주세요',
  retry: '위치를 다시 요청하는 중입니다',
};

interface BatteryLike {
  level: number;
  charging: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
}

function liveRooms<T extends { code: string }>(state: { inviteCode: string; guardians: T[]; familyRoomCode?: string }) {
  return syncRooms({
    inviteCode: state.inviteCode,
    guardians: state.guardians,
    familyRoomCode: state.familyRoomCode || '',
  }) as { includeOwn: boolean; guardians: T[]; codes: string[] };
}

export function useFamilyTracking(onFirstFix: (lat: number, lng: number) => void): { waiting: string | null; familyShareNote: string | null; native: boolean; openSettings: () => ReturnType<typeof openAlwaysLocation> } {
  const family = useFamily();
  const { state } = family;
  const familyRef = useRef(family);
  const onFirstFixRef = useRef(onFirstFix);
  const centered = useRef(false);
  const nativeFixAt = useRef(0);
  const sharedTokens = useRef<Record<string, string>>({});
  const adminShared = useRef(false);
  const nativeAdminShared = useRef(false);
  const remoteRooms = useRef<Record<string, SharedPlace[] | undefined>>({});
  const triedGeocode = useRef(new Set<string>());
  const [waiting, setWaiting] = useState<string | null>(null);
  const [familyShareNote, setFamilyShareNote] = useState<string | null>(null);

  useEffect(() => {
    familyRef.current = family;
  });
  useEffect(() => {
    onFirstFixRef.current = onFirstFix;
  });

  const self = state.members.find((member) => member.id === 'self');
  const precise = state.permissions.accuracy === 'precise';
  const trackingOn = state.permissions.locationMode === 'while-using' || state.permissions.locationMode === 'always';
  const nativeKeeps = umapLocationNative() && state.backgroundKeepAlive && state.permissions.locationMode === 'always';
  const [appVisible, setAppVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onVis = () => setAppVisible(document.visibilityState !== 'hidden');
    const onResume = () => setAppVisible(true);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('resume', onResume);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('resume', onResume);
    };
  }, []);
  // Foreground fixes are published from this watch even when background keep is on.
  // Keep's native service covers the time the screen is off. If that service is
  // not registered, freezing the key would stop family updates while the pin still moves.
  const selfPublishKey = `${self?.lat ?? ''}:${self?.lng ?? ''}:${self?.updatedAt ?? ''}:${self?.battery ?? ''}:${self?.charging ?? ''}`;

  useEffect(() => {
    const tick = () => familyRef.current.rollDay(Date.now());
    tick();
    const timer = window.setInterval(tick, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (!nav.getBattery) return;
    let dead = false;
    let battery: BatteryLike | null = null;
    const emit = () => {
      if (!battery || dead) return;
      const pct = Math.round(battery.level * 100);
      if (!Number.isFinite(pct)) return;
      familyRef.current.setBattery(Math.min(100, Math.max(0, pct)), battery.charging);
    };
    void nav.getBattery().then((next) => {
      if (dead) return;
      battery = next;
      next.addEventListener('levelchange', emit);
      next.addEventListener('chargingchange', emit);
      emit();
    }).catch(() => undefined);
    const timer = window.setInterval(emit, 60_000);
    return () => {
      dead = true;
      window.clearInterval(timer);
      battery?.removeEventListener('levelchange', emit);
      battery?.removeEventListener('chargingchange', emit);
    };
  }, []);

  useEffect(() => {
    if (!umapLocationNative()) return;
    let dead = false;
    const pull = () => {
      void readNativeBattery().then((battery) => {
        if (dead || battery.pct == null) return;
        familyRef.current.setBattery(battery.pct, battery.charging);
      });
    };
    pull();
    const timer = window.setInterval(pull, 60_000);
    return () => {
      dead = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!trackingOn) return;
    if (nativeKeeps && !appVisible) return;
    const apply = (fix: AcceptedFix) => {
      familyRef.current.updateSelf(fix.lat, fix.lng, fix.accuracy, fix.speedMps);
      if (!centered.current) {
        centered.current = true;
        onFirstFixRef.current(fix.lat, fix.lng);
      }
      setWaiting((current) => (current === null ? current : null));
    };
    return startLocationWatch({
      precise,
      onFix: apply,
      onWaiting: (reason) => {
        if (reason && Date.now() - nativeFixAt.current < 30_000) return;
        setWaiting(reason ? WAITING_KO[reason] ?? null : null);
      },
    });
  }, [appVisible, nativeKeeps, precise, trackingOn]);

  useEffect(() => {
    if (!trackingOn || !umapLocationNative()) return;
    let remove = () => {};
    void umapLocation.addListener('fix', (fix) => {
      const speed = typeof fix.speedMps === 'number' ? fix.speedMps : null;
      noteDiag({
        kind: 'fix',
        channel: 'native',
        source: fixChannelSource('native', fix.provider, true),
        fg: document.visibilityState !== 'hidden',
        accuracy: fix.accuracyM || 0,
        speed: speed ?? 0,
        lat: fix.lat,
        lng: fix.lng,
        ok: true,
        reason: 'accepted',
      });
      nativeFixAt.current = Date.now();
      setWaiting(null);
      familyRef.current.updateSelf(fix.lat, fix.lng, fix.accuracyM || 1, speed);
      if (!centered.current) {
        centered.current = true;
        onFirstFixRef.current(fix.lat, fix.lng);
      }
    }).then((handle) => {
      remove = () => { void handle.remove(); };
    }).catch(() => undefined);
    return () => remove();
  }, [trackingOn]);

  useEffect(() => {
    if (state.locationConsent === false) return;
    const name = (state.profile?.name || self?.name || '가족').trim().slice(0, 20) || '가족';
    const memberId = state.profile?.profileKey ? state.profile.id : undefined;
    const rooms = liveRooms(state);
    const nextTokens: Record<string, string> = {};
    for (const link of rooms.guardians) {
      if (link.syncToken) nextTokens[link.code] = link.syncToken;
    }
    for (const [code, token] of Object.entries(sharedTokens.current)) {
      if (nextTokens[code]) continue;
      const priorName = placePriorName(code, 'family', name) || placePriorName(code, 'admin', name) || undefined;
      publishSharedPlace({
        code,
        name,
        ...(memberId ? { memberId } : {}),
        ...(priorName ? { priorName } : {}),
        audience: 'family',
        lat: null,
        lng: null,
        accuracyM: 0,
        at: Date.now(),
        sharing: false,
      }, token, state.profile?.profileKey);
    }
    sharedTokens.current = nextTokens;
    if (rooms.guardians.length === 0) return;
    const located = self && hasLocation(self) ? self : null;
    for (const link of rooms.guardians) {
      const sharing = link.share === 'allowed';
      const remote = link.syncToken && (sharing || link.share === 'revoked') ? link.syncToken : null;
      if (nativeKeeps && sharing && located) continue;
      // No fix yet: do not publish a newer empty point. That used to replace the native service's coordinates.
      if (sharing && !located) continue;
      const priorName = placePriorName(link.code, 'admin', name) || (link.rosterName && link.rosterName !== name ? link.rosterName : '');
      publishSharedPlace({
        code: link.code,
        name,
        ...(memberId ? { memberId } : {}),
        ...(priorName ? { priorName } : {}),
        audience: 'family',
        lat: sharing && located ? located.lat : null,
        lng: sharing && located ? located.lng : null,
        accuracyM: located?.accuracyM ?? 0,
        at: Date.now(),
        sharing,
        batteryPct: sharing ? (self?.battery ?? null) : null,
        charging: sharing ? (self?.charging ?? null) : null,
      }, remote, state.profile?.profileKey);
    }
  }, [nativeKeeps, selfPublishKey, state.familyRoomCode, state.guardians, state.mode, state.profile?.id, state.profile?.name, state.profile?.profileKey]);

  useEffect(() => {
    if (state.locationConsent === false) return;
    if (!liveRooms(state).includeOwn) return;
    if (!state.syncWriteKey || !state.syncReadKey) return;
    let cancel = false;
    const name = (state.profile?.name || self?.name || '가족').trim().slice(0, 20) || '가족';
    const memberId = state.profile?.profileKey ? state.profile.id : undefined;
    const share = state.shareSelfWithFamily;
    const located = self && hasLocation(self) ? self : null;
    if (!share) setFamilyShareNote(null);
    if (!share && !adminShared.current) return;
    if (share && !located) return;
    const sending = share && !!located;
    if (nativeKeeps && sending) return;
    void syncTokenFor(state.syncWriteKey, state.syncReadKey).then(async (token) => {
      if (cancel || !splitSyncToken(token)) return;
      const ready = await familyEndpointAvailable(state.inviteCode, token);
      if (cancel) return;
      if (!ready) {
        setFamilyShareNote(share ? '가족 위치 서버를 갱신하기 전에는 다른 폰으로 내 위치를 보내지 않습니다. 이 폰 지도에는 내 위치가 그대로 보입니다.' : null);
        return;
      }
      setFamilyShareNote(null);
      const priorName = placePriorName(state.inviteCode, 'family', name);
      publishSharedPlace({
        code: state.inviteCode,
        name,
        ...(memberId ? { memberId } : {}),
        ...(priorName ? { priorName } : {}),
        lat: sending && located ? located.lat : null,
        lng: sending && located ? located.lng : null,
        accuracyM: located?.accuracyM ?? 0,
        at: Date.now(),
        sharing: sending,
        audience: 'family',
        batteryPct: sending ? located?.battery ?? null : null,
        charging: sending ? located?.charging ?? null : null,
      }, token, state.profile?.profileKey);
      adminShared.current = share;
    });
    return () => {
      cancel = true;
    };
  }, [nativeKeeps, selfPublishKey, state.familyRoomCode, state.inviteCode, state.mode, state.profile?.id, state.profile?.name, state.profile?.profileKey, state.shareSelfWithFamily, state.syncReadKey, state.syncWriteKey]);

  const profileSyncKey = [
    state.mode,
    state.profile?.id ?? '',
    state.profile?.name ?? '',
    state.profile?.photo ?? '',
    state.profile?.profileKey ?? '',
    state.inviteCode,
    state.syncWriteKey,
    state.syncReadKey,
    state.familyRoomCode ?? '',
    state.guardians.map((link) => `${link.code}:${link.syncToken ?? ''}`).join('|'),
  ].join('~');
  useEffect(() => {
    const current = familyRef.current.state;
    const profile = current.profile;
    if (!profile?.profileKey || !profile.id || !profile.name) return;
    let cancel = false;
    const send = (code: string, token: string) => {
      if (cancel) return;
      publishProfileRemote({
        memberId: profile.id,
        name: profile.name,
        photo: profile.photo ?? null,
        at: Date.now(),
      }, code, token, profile.profileKey);
    };
    const rooms = liveRooms(current);
    for (const link of rooms.guardians) {
      if (link.syncToken) send(link.code, link.syncToken);
    }
    if (rooms.includeOwn && current.syncWriteKey && current.syncReadKey) {
      void syncTokenFor(current.syncWriteKey, current.syncReadKey).then((token) => {
        if (!cancel) send(current.inviteCode, token);
      });
    }
    return () => {
      cancel = true;
    };
  }, [profileSyncKey]);

  const keepKey = [
    state.mode,
    state.permissions.locationMode,
    state.permissions.accuracy,
    state.backgroundKeepAlive,
    state.shareSelfWithFamily,
    state.locationConsent === false ? '0' : '1',
    state.profile?.name ?? '',
    state.profile?.id ?? '',
    state.profile?.profileKey ?? '',
    state.inviteCode,
    state.syncWriteKey,
    state.syncReadKey,
    state.familyRoomCode ?? '',
    state.guardians.map((link) => `${link.code}:${link.share}:${link.syncToken ?? ''}`).join('|'),
  ].join('~');

  const syncKeepAlive = useRef<(refreshKeys?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    syncKeepAlive.current = async (refreshKeys = true) => {
      try {
      const current = familyRef.current.state;
      const status = await umapLocation.status().catch(() => ({ running: false, userStopped: false, native: false as const }));
      if (status.userStopped) {
        if (familyRef.current.state.backgroundKeepAlive) familyRef.current.setKeepAlive(false);
        await umapLocation.ackStopped().catch(() => undefined);
        await umapLocation.stop().catch(() => undefined);
        return;
      }
      const wanted = current.locationConsent !== false && current.permissions.locationMode === 'always' && current.backgroundKeepAlive;
      const base = familySyncUrl();
      if (!wanted || !base || !umapLocationNative()) {
        if (status.running) await umapLocation.stop().catch(() => undefined);
        return;
      }
      const targets: KeepAliveTarget[] = [];
      const rooms = liveRooms(current);
      for (const link of rooms.guardians) {
        if (!link.syncToken || !splitSyncToken(link.syncToken)) continue;
        if (link.share !== 'allowed' && link.share !== 'revoked') continue;
        targets.push({ token: link.syncToken, code: link.code, audience: 'family', sharing: link.share === 'allowed' });
      }
      if (rooms.includeOwn && (current.shareSelfWithFamily || nativeAdminShared.current)) {
        const token = await syncTokenFor(current.syncWriteKey, current.syncReadKey);
        if (splitSyncToken(token) && await familyEndpointAvailable(current.inviteCode, token)) {
          targets.push({ token, code: current.inviteCode, audience: 'family', sharing: current.shareSelfWithFamily });
          nativeAdminShared.current = current.shareSelfWithFamily;
        }
      }
      if (targets.length === 0) {
        // 업데이트 직후 가족 토큰이 아직 없으면 켜 둔 위치 유지를 끄지 않는다.
        return;
      }
      const memberId = current.profile?.profileKey ? current.profile.id : '';
      const profileKey = current.profile?.profileKey || '';
      const seals: Record<string, { kid: string; key: string }> = {};
      if (memberId && profileKey) {
        for (const target of targets) {
          if (!target.sharing) continue;
          if (refreshKeys) await syncFamilyKeys(target.code, target.token, memberId, profileKey);
          const record = familyKeyRecord(localStorage, target.code);
          if (record) seals[target.code] = { kid: record.kid, key: bytesToBase64Url(record.key) };
        }
      }
      const config: Parameters<typeof JSON.stringify>[0] = {
        baseUrl: base,
        name: (current.profile?.name || '가족').trim().slice(0, 20) || '가족',
        memberId,
        profileKey,
        precise: current.permissions.accuracy === 'precise',
        seals,
        targets,
      };
      await umapLocation.start({ config: JSON.stringify(config) }).catch(() => undefined);
      } finally {
        if (typeof window !== 'undefined') window.dispatchEvent(new Event('umap-keep-status'));
      }
    };
  }, [keepKey]);

  useEffect(() => {
    void syncKeepAlive.current();
    const onVisible = () => {
      if (document.visibilityState === 'hidden') return;
      void syncKeepAlive.current();
    };
    const timer = window.setInterval(() => void syncKeepAlive.current(), 20_000);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onVisible);
    const onKeys = () => {
      if (document.visibilityState === 'hidden') return;
      void syncKeepAlive.current(false);
    };
    window.addEventListener('umap-family-keys', onKeys);
    window.addEventListener('umap-retry-keep', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onVisible);
      window.removeEventListener('umap-family-keys', onKeys);
      window.removeEventListener('umap-retry-keep', onVisible);
    };
  }, [keepKey]);

  const familyLinkKey = `${state.familyRoomCode ?? ''}:${state.inviteCode}:${state.syncWriteKey}:${state.guardians.map((link) => `${link.code}:${link.syncToken ?? ''}`).join('|')}`;
  useEffect(() => {
    let stopped = false;
    let stop = () => {};
    void (async () => {
      const current = familyRef.current.state;
      const rooms = liveRooms(current);
      const links = rooms.guardians
        .filter((link) => link.syncToken)
        .map((link) => ({ code: link.code, token: link.syncToken as string }));
      if (rooms.includeOwn && current.syncWriteKey && current.syncReadKey) {
        const token = await syncTokenFor(current.syncWriteKey, current.syncReadKey);
        if (!stopped && splitSyncToken(token)) links.push({ code: current.inviteCode, token });
      }
      if (stopped || links.length === 0) return;
      const self = {
        memberId: current.profile?.profileKey ? current.profile.id : '',
        profileKey: current.profile?.profileKey || '',
      };
      stop = startManagedFamilySync(links, (code, places, profiles, trails, departed) => {
        remoteRooms.current[code] = places;
        familyRef.current.setRoomFamilyPlaces(code, places, profiles, departed);
        familyRef.current.applySharedProfiles(code, profiles);
        if (trails.length > 0) familyRef.current.applyCanonicalTrails(trails);
      }, self);
    })();
    return () => {
      stopped = true;
      stop();
    };
  }, [familyLinkKey]);

  const trailSentRef = useRef(0);
  const trailJourneyRef = useRef(state.journeys?.self?.length ?? 0);
  const trailKey = `${state.tracks.self?.length ?? 0}:${state.tracks.self?.at(-1)?.at ?? 0}:${state.journeys?.self?.length ?? 0}:${state.journeys?.self?.[0]?.endedAt ?? 0}:${state.shareSelfWithFamily}`;
  useEffect(() => {
    const current = familyRef.current.state;
    if (umapLocationNative() && current.backgroundKeepAlive && current.permissions.locationMode === 'always') return;
    const memberId = current.profile?.profileKey ? current.profile.id : '';
    const profileKey = current.profile?.profileKey || '';
    if (!memberId || !profileKey) return;
    const points = (current.tracks.self || []).slice(-800).map((point) => ({
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      at: point.at,
      ...(typeof point.speedMps === 'number' ? { speedMps: Number(point.speedMps.toFixed(2)) } : {}),
      ...(typeof point.accuracyM === 'number' ? { accuracyM: Math.round(point.accuracyM) } : {}),
      ...(point.staying === true ? { staying: true } : {}),
      ...(point.stayEnd === true ? { stayEnd: true } : {}),
    }));
    const journeys = journeysToPublish(current.journeys?.self).map((journey) => ({
      id: journey.id,
      startedAt: journey.startedAt,
      endedAt: journey.endedAt,
      distanceM: journey.distanceM,
      points: journey.points.slice(0, 240),
      start: journey.start,
      end: journey.end,
    }));
    const moving = liveMotionLabel({
      located: true,
      moving: current.members.find((member) => member.id === 'self')?.moving ?? null,
      points: current.tracks.self,
      now: Date.now(),
    }) !== '머무름';
    const body = { memberId, at: Date.now(), moving, points, journeys };
    let cancel = false;
    const fire = async () => {
      if (cancel) return;
      trailSentRef.current = Date.now();
      const rooms = liveRooms(current);
      for (const link of rooms.guardians) {
        if (link.share !== 'allowed' || !link.syncToken) continue;
        publishTrailRemote(link.code, link.syncToken, body, profileKey);
      }
      if (!rooms.includeOwn || !current.shareSelfWithFamily || !current.syncWriteKey || !current.syncReadKey) return;
      const token = await syncTokenFor(current.syncWriteKey, current.syncReadKey);
      if (cancel || !splitSyncToken(token)) return;
      publishTrailRemote(current.inviteCode, token, body, profileKey);
    };
    const journeyCount = current.journeys?.self?.length ?? 0;
    const journeyChanged = trailJourneyRef.current !== journeyCount;
    trailJourneyRef.current = journeyCount;
    const wait = journeyChanged ? 0 : Math.max(0, 10_000 - (Date.now() - trailSentRef.current));
    const timer = window.setTimeout(() => void fire(), wait);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [trailKey, state.backgroundKeepAlive, state.familyRoomCode, state.guardians, state.permissions.locationMode]);

  useEffect(() => {
    const joined = new Set(liveRooms(state).codes);
    if (joined.size === 0) return;
    const apply = () => {
      const current = familyRef.current.state;
      const grouped = new Map<string, SharedPlace[]>();
      for (const place of readSharedPlaces()) {
        if (!joined.has(place.code) || place.audience !== 'family' || !place.sharing || place.lat == null || place.lng == null) continue;
        if (isSelfEchoPlace(place, current.profile?.id, current.inviteCode)) continue;
        const list = grouped.get(place.code) ?? [];
        list.push(place);
        grouped.set(place.code, list);
      }
      for (const [code, places] of grouped) {
        if (remoteRooms.current[code]) continue;
        familyRef.current.setRoomFamilyPlaces(code, places);
      }
    };
    apply();
    return subscribeSharedPlaces(apply);
  }, [familyLinkKey]);

  useEffect(() => {
    const now = Date.now();
    for (const [memberId, points] of Object.entries(state.tracks)) {
      familyRef.current.mergeVisits(memberId, buildDayRecord(points, now).stops);
    }
  }, [state.tracks, state.trailDay]);

  useEffect(() => {
    let pending: { memberId: string; id: string; lat: number; lng: number } | null = null;
    for (const [memberId, list] of Object.entries(state.visits)) {
      for (const visit of list) {
        if (!visit.label && !triedGeocode.current.has(visit.id)) {
          pending = { memberId, id: visit.id, lat: visit.lat, lng: visit.lng };
          break;
        }
      }
      if (pending) break;
    }
    if (!pending) return;
    const next = pending;
    triedGeocode.current.add(next.id);
    let cancel = false;
    const cached = cachedAddress(next.lat, next.lng);
    if (cached) {
      familyRef.current.setVisitLabel(next.memberId, next.id, cached);
      return;
    }
    void reverseGeocodeCached(next.lat, next.lng).then((found) => {
      if (!cancel && found.label) familyRef.current.setVisitLabel(next.memberId, next.id, found.label);
    });
    return () => {
      cancel = true;
    };
  }, [state.visits]);

  useEffect(() => {
    let pending: { memberId: string; id: string; which: 'start' | 'end'; lat: number; lng: number } | null = null;
    for (const [memberId, list] of Object.entries(state.journeys ?? {})) {
      for (const journey of list) {
        for (const which of ['start', 'end'] as const) {
          const place = journey[which];
          const key = `${memberId}:${journey.id}:${which}`;
          if (!place?.label && !triedGeocode.current.has(key)) {
            pending = { memberId, id: journey.id, which, lat: place.lat, lng: place.lng };
            break;
          }
        }
        if (pending) break;
      }
      if (pending) break;
    }
    if (!pending) return;
    const next = pending;
    triedGeocode.current.add(`${next.memberId}:${next.id}:${next.which}`);
    let cancel = false;
    const cached = cachedAddress(next.lat, next.lng);
    if (cached) {
      familyRef.current.setJourneyLabel(next.memberId, next.id, next.which, cached, next.lat, next.lng);
      return;
    }
    void reverseGeocodeCached(next.lat, next.lng).then((found) => {
      if (!cancel && found.label) familyRef.current.setJourneyLabel(next.memberId, next.id, next.which, found.label, next.lat, next.lng);
    });
    return () => {
      cancel = true;
    };
  }, [state.journeys]);

  const placeKeys = useRef<Record<string, string>>({});
  const placeJobs = useRef<Record<string, string>>({});
  const placeTimers = useRef<Record<string, number>>({});
  const geocodeAlive = useRef(true);
  useEffect(() => () => {
    geocodeAlive.current = false;
    for (const timer of Object.values(placeTimers.current)) window.clearTimeout(timer);
    placeTimers.current = {};
  }, []);
  const memberPlaceKey = state.members
    .filter((member) => hasLocation(member))
    .map((member) => `${member.id}:${member.lat == null || member.lng == null ? '' : placeGridKey(member.lat, member.lng)}:${member.place ?? ''}`)
    .join('|');
  useEffect(() => {
    if (state.stage !== 'map') {
      geocodeAlive.current = false;
      for (const timer of Object.values(placeTimers.current)) window.clearTimeout(timer);
      placeTimers.current = {};
      placeJobs.current = {};
      return undefined;
    }
    geocodeAlive.current = true;
    const current = familyRef.current.state;
    const home = current.home;
    for (const member of current.members) {
      if (!hasLocation(member) || member.role === 'guardian' || member.lat == null || member.lng == null) continue;
      const here = { lat: member.lat, lng: member.lng };
      const key = placeGridKey(here.lat, here.lng);
      const id = member.id;
      const neighborDisagrees = current.members.some((other) => {
        if (other.id === id || !hasLocation(other) || other.lat == null || other.lng == null) return false;
        if (haversineMeters(here, { lat: other.lat, lng: other.lng }) > 40) return false;
        const theirs = cleanPlace(other.place);
        const mine = cleanPlace(member.place);
        return Boolean(theirs && mine && theirs !== mine);
      });
      const needsFresh = !cleanPlace(member.place) || neighborDisagrees;
      if (!needsFresh && placeKeys.current[id] === key) continue;
      const job = `${id}:${key}:${needsFresh ? 'fresh' : 'cell'}`;
      if (placeJobs.current[id] === job) continue;
      placeJobs.current[id] = job;
      const apply = (label: string | null, settled: boolean, attempt = 0) => {
        if (!geocodeAlive.current || placeJobs.current[id] !== job) return;
        const short = label ? presentPlace(label) : '';
        if (!short) {
          delete placeJobs.current[id];
          return;
        }
        if (settled) {
          placeKeys.current[id] = key;
          window.clearTimeout(placeTimers.current[id]);
          delete placeTimers.current[id];
        }
        const latest = familyRef.current.state.members.find((item) => item.id === id);
        if (latest && cleanPlace(latest.place) !== short) familyRef.current.setMemberPlace(id, short);
        if (!settled && attempt < 2) {
          window.clearTimeout(placeTimers.current[id]);
          const timer = window.setTimeout(() => {
            delete placeTimers.current[id];
            if (!geocodeAlive.current || placeJobs.current[id] !== job) return;
            void reverseGeocodeCached(here.lat, here.lng).then((found) => apply(found.label, found.settled, attempt + 1));
          }, 60_000);
          placeTimers.current[id] = timer;
        }
      };
      const saved = savedPlaceLabel(here.lat, here.lng, home);
      if (saved) {
        apply(saved, true);
        continue;
      }
      const cached = cachedAddress(here.lat, here.lng);
      if (cached) {
        apply(cached, true);
        continue;
      }
      void reverseGeocodeCached(here.lat, here.lng).then((found) => apply(found.label, found.settled));
    }
    return undefined;
  }, [memberPlaceKey, state.home, state.stage]);

  return { waiting, familyShareNote, native: umapLocationNative(), openSettings: openAlwaysLocation };
}
