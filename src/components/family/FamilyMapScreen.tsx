import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, ChevronLeft, ChevronRight, Copy, Home, LocateFixed, MapPin, Menu, Plus, Route, Settings, UserPlus, X } from 'lucide-react';
import { APP_VERSION_CODE, APP_VERSION_NAME, currentAppVersionLabel, openAppUpdate } from '../../lib/appRelease.mjs';
import { looksLikePhone, localProfile } from '../../lib/localProfile.mjs';
import { KAKAO_SETUP_MESSAGE } from '../../lib/kakaoAuth.mjs';
import { NAVER_SETUP_MESSAGE } from '../../lib/naverAuth.mjs';
import { ACCOUNT_LINKED_OTHER_MESSAGE, ACCOUNT_UNLINKED_MESSAGE, linkedAccountWouldSwitch, readStoredAccountKey, readStoredAccountLinks, readStoredRecoveryCode, rememberAccountSecrets, snapshotFromSession } from '../../lib/accountRestore.mjs';
import { backupFamilyAccount, cancelAccountBackup, deleteFamilyAccount, linkKakaoAccount, loadOwnDisclosures, loadOwnHandling, mintFamilyInvite, persistAccountResult, redeemFamilyInvite, revokeFamilyInvite, type AccountSnapshot, type DisclosureRecord, type HandlingEvent } from '../../services/familyAccount';
import { buildInviteLink, formatClock, hasLocation, haversineMeters, shouldAlertLeave } from '../../lib/geo';
import { buildGroupInviteLink, parseInviteUrl, syncTokenFromInviteFragment } from '../../lib/inviteLink.mjs';
import { ALWAYS_GUIDE_DISMISSED_KEY, CHAT_NOTIFY_ASKED_KEY, KEEP_PERMISSION_ASKED_KEY, KEEP_START_ASKED_KEY, keepEntryPrompt, markSessionFlag, readSessionFlag } from '../../lib/systemSettings.mjs';
import { familyMapShowsTrail, memberLiveLines, recordsDayTrails } from '../../lib/mapTrail.mjs';
import { noteDiag } from '../../lib/diagLog.mjs';
import { shouldAutoFitRecord } from '../../lib/recordMapFit.mjs';
import { createMapFollow, followTargetId, noteFollowTarget, noteRecenter, noteUserDrag, planFollowPan, recenterLabel } from '../../lib/mapFollow.mjs';
import { shouldDeleteCreatedRoom } from '../../lib/familyRoom.mjs';
import { motionAlertCopy, motionNotifyNames, nextMotionAlert } from '../../lib/motionAlert.mjs';
import { collapseDuplicateJourneys, collapseIndoorStayDisplay, displayCoordinate, displayLivePoints, historyDayKeys, historyDayLabel, lastTravelAt, liveMotionLabel, liveTrailDrawable, liveTrailPoints, MOTION_STILL_HOLD_MS, previewOpenJourney, seoulDayEndMs, seoulDayKey } from '../../lib/tracking.mjs';
import { ackFamilyAlert, isFamilyAlertAcked, publishFamilyAlert, readFamilyAlert, subscribeFamilyAlerts, type FamilyAlert } from '../../services/familyAlert';
import { readSharedPlaces, subscribeSharedPlaces } from '../../services/familyShare';
import { openAccountSecrets } from '../../lib/familyVault.mjs';
import { isMemberId } from '../../lib/sharedIdentity.mjs';
import { Capacitor } from '@capacitor/core';
import { CHAT_LIST_POLL_MS } from '../../lib/keySyncPace.mjs';
import { abandonFamilySync, currentSyncPhase, deleteFamilyRoomRemote, familySyncConfigured, familySyncUrl, fetchMyDirectThreads, registerRoomPush, revokeFamilyPlace, rotateRemovedMember, splitSyncToken, startAdminRemoteSync, startSyncMonitor, subscribeSyncPhase, syncRetryDelay, syncTokenFor, type SyncPhase } from '../../services/familySync';
import { keepBanner, keepBannerVisible, keepRestartStatus, serviceAlive } from '../../lib/keepBanner.mjs';
import { OLD_APP_PLACE_LABEL, syncBannerText } from '../../lib/syncBanner.mjs';
import { consumePendingChat, listenChatOpen, openAppSettings, overlayPermissionGranted, umapLocation, umapLocationNative } from '../../services/umapLocation';
import { sounds } from '../../utils/audio';
import { DEFAULT_CENTER, type GuardianLink, type HomeZone, type Member, type Session } from '../../types/family';
import { AlwaysAllowGuide, AlwaysAllowMapHint } from './AlwaysAllowGuide';
import { AlwaysAllowSetup } from './AlwaysAllowSetup';
import { memberFocusStep } from '../../lib/memberFocus.mjs';
import { memberPlaceLabel } from '../../lib/memberPlace.mjs';
import { memberIsStale, memberPresence, memberPresenceLabel } from '../../lib/memberPresence.mjs';
import { mapMembers, rosterMembers } from '../../lib/peerFamily.mjs';
import { AlwaysAllowNotice } from './AlwaysAllowNotice';
import { InviteQrImage, InviteQrScan } from './InviteQr';
import { StreetMap, type StreetMapHandle } from './StreetMap';
import { JourneyCards, JourneyScrubber } from './JourneyCards';
import { FamilyChatSheet, type DirectChatTarget } from './FamilyChatSheet';
import { MemberAvatar } from './MemberAvatar';
import { PhotoPicker } from './ProfilePhoto';
import { chatName, isFamilyChatMessage, mergeDirectChat, subscribeChat, unreadCount } from '../../services/familyChat';
import { TodayRecord } from './TodayRecord';
import { askAlwaysLocation, askBattery, askNotifications } from '../../services/systemPermissions';
import { useFamilyTracking } from './useFamilyTracking';
import { useFamily } from './session';
import { consumeAndroidBack } from '../../platform/androidExit';
import { configuredKakaoLoginKey, signInWithKakao } from '../../services/kakaoSignIn';
import { sendFamilyInvite } from '../../services/inviteShare';
import { KakaoMergeSheet } from './KakaoMergeSheet';
import { configuredNaverClientId, signInWithNaver } from '../../services/naverSignIn';

export function FamilyMapScreen() {
  const family = useFamily();
  const { state } = family;
  const self = state.members.find((member) => member.id === 'self');
  const center = DEFAULT_CENTER;
  const [showZone, setShowZone] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [draftHome, setDraftHome] = useState<HomeZone | null>(null);
  const [placingHome, setPlacingHome] = useState(false);
  const mapRef = useRef<StreetMapHandle>(null);
  const [sheet, setSheet] = useState<'invite' | 'accept' | 'add' | 'today' | null>(state.pendingInvite ? 'accept' : null);
  const [shareAsk, setShareAsk] = useState(false);
  const [historyCode, setHistoryCode] = useState('');
  const [historyNote, setHistoryNote] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'leave' | 'delete-room' | 'logout' | 'delete-account'; id: string; name: string } | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [incoming, setIncoming] = useState<FamilyAlert | null>(null);
  const [sirenOn, setSirenOn] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const insideRef = useRef<Record<string, boolean>>({});
  const familyRef = useRef(family);
  useEffect(() => {
    familyRef.current = family;
  });
  const notifyOk = state.permissions.notifications === 'granted';
  const fittedShare = useRef(false);
  const [syncPhase, setSyncPhase] = useState<SyncPhase>(() => currentSyncPhase());
  const [now, setNow] = useState(() => Date.now());
  const tracking = useFamilyTracking(() => {
    // The first fix used to pan to self. Follow decides the camera after that.
  });
  const [settingsNote, setSettingsNote] = useState<string | null>(null);
  const [keepPrompt, setKeepPrompt] = useState<'permission' | 'start' | 'none'>(() => keepEntryPrompt({
    notifications: state.permissions.notifications,
    locationMode: state.permissions.locationMode,
    keepAlive: state.backgroundKeepAlive,
    permissionAsked: readSessionFlag(KEEP_PERMISSION_ASKED_KEY),
    startAsked: readSessionFlag(KEEP_START_ASKED_KEY),
  }));
  const [keepBusy, setKeepBusy] = useState(false);
  const [keepNote, setKeepNote] = useState<string | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [historyDay, setHistoryDay] = useState(() => seoulDayKey(Date.now()));
  const [dayPicker, setDayPicker] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [dm, setDm] = useState<DirectChatTarget | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [motionShade, setMotionShade] = useState<string | null>(null);
  const motionSentRef = useRef<string | null>(null);
  const [alwaysGuide, setAlwaysGuide] = useState(false);
  const [alwaysSetup, setAlwaysSetup] = useState(false);
  const [guideBusy, setGuideBusy] = useState(false);
  const [guideHintHidden, setGuideHintHidden] = useState(() => readSessionFlag(ALWAYS_GUIDE_DISMISSED_KEY));
  const [keepHint, setKeepHint] = useState<ReturnType<typeof keepBanner>>(null);
  const [keepPhase, setKeepPhase] = useState<'idle' | 'starting' | 'on' | 'blocked'>('idle');
  const keepDismissRef = useRef<{ kind: string; at: number } | null>(null);
  const keepPhaseRef = useRef<{ phase: 'idle' | 'starting' | 'on' | 'blocked'; until: number }>({ phase: 'idle', until: 0 });
  const [keepLive, setKeepLive] = useState<{ battery: boolean | null; running: boolean; location: string }>({ battery: null, running: false, location: '' });
  const [profileOpen, setProfileOpen] = useState(false);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [managedSettings, setManagedSettings] = useState(false);
  const [adminSettings, setAdminSettings] = useState(false);
  const [chatTick, setChatTick] = useState(0);
  const placingRef = useRef(false);
  const followRef = useRef(createMapFollow());
  const [followOn, setFollowOn] = useState(true);
  const [awaitingFamilyFit, setAwaitingFamilyFit] = useState(false);

  useEffect(() => subscribeSyncPhase(setSyncPhase), []);
  useEffect(() => subscribeChat(() => setChatTick((value) => value + 1)), []);
  useEffect(() => {
    placingRef.current = placingHome;
  }, [placingHome]);
  useEffect(() => startSyncMonitor(), []);
  useEffect(() => {
    const openInvite = () => {
      const raw = (window as unknown as { __umapInviteUrl?: string }).__umapInviteUrl || '';
      if (!raw) return;
      try {
        sessionStorage.setItem('umap_invite_url', raw);
      } catch {
        /* 저장이 거절돼도 화면의 초대 입력은 남습니다. */
      }
      setSheet('accept');
    };
    window.addEventListener('umap-invite', openInvite);
    openInvite();
    return () => window.removeEventListener('umap-invite', openInvite);
  }, []);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 15_000);
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
    if (!umapLocationNative() || state.stage !== 'map') {
      setKeepHint(null);
      return;
    }
    let cancel = false;
    let noted = '';
    const refresh = () => {
      void umapLocation.status().then((status) => {
        if (cancel) return;
        const location = status.location || state.permissions.locationMode || 'unknown';
        const alive = serviceAlive({
          serviceRunning: status.running === true,
          heartbeatAt: status.heartbeatAt,
          lastFixAt: status.lastFixAt,
          now: Date.now(),
        });
        setKeepLive({
          battery: status.batteryUnrestricted === false ? false : status.batteryUnrestricted === true ? true : null,
          running: alive,
          location,
        });
        const banner = keepBannerVisible(keepBanner({
          native: true,
          onMap: true,
          serviceRunning: alive,
          heartbeatAt: status.heartbeatAt,
          lastFixAt: status.lastFixAt,
          userStopped: status.userStopped,
          keepAlive: state.backgroundKeepAlive,
          locationMode: location,
          batteryUnrestricted: status.batteryUnrestricted,
          reason: status.reason || '',
        }), keepDismissRef.current, Date.now());
        setKeepHint(banner);
        const phase = keepPhaseRef.current;
        if (phase.phase === 'starting' && Date.now() >= phase.until) {
          const next = banner == null && alive ? 'on' : 'blocked';
          keepPhaseRef.current = { phase: next, until: next === 'on' ? Date.now() + 4_000 : 0 };
          setKeepPhase(next);
        } else if (phase.phase === 'on' && Date.now() >= phase.until) {
          keepPhaseRef.current = { phase: 'idle', until: 0 };
          setKeepPhase('idle');
        }
        const row = [
          APP_VERSION_NAME,
          state.backgroundKeepAlive ? 'on' : 'off',
          status.running ? 'yes' : 'no',
          location,
          status.batteryUnrestricted === false ? 'restricted' : 'open',
        ].join('|');
        if (row === noted) return;
        noted = row;
        if (status.location && status.location !== state.permissions.locationMode) {
          familyRef.current.noteLocation(status.location, status.precise === false ? 'approximate' : 'precise');
        }
        noteDiag({
          kind: 'keep',
          version: status.versionName || APP_VERSION_NAME,
          code: typeof status.versionCode === 'number' ? status.versionCode : APP_VERSION_CODE,
          keep: state.backgroundKeepAlive ? 'on' : 'off',
          running: status.running ? 'yes' : 'no',
          location,
          precise: status.precise === false ? 'coarse' : 'fine',
          battery: status.batteryUnrestricted === false ? 'restricted' : 'open',
        });
      }).catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('umap-keep-status', refresh);
    return () => {
      cancel = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('umap-keep-status', refresh);
    };
  }, [state.backgroundKeepAlive, state.permissions.locationMode, state.stage]);
  useEffect(() => {
    familyRef.current.closeJourneys(now);
  }, [now]);

  const watchFamilyRoom = Boolean(state.syncWriteKey && state.syncReadKey);
  useEffect(() => {
    if (!watchFamilyRoom) return;
    const apply = (place: Parameters<typeof familyRef.current.applySharedPlace>[0]) => {
      familyRef.current.applySharedPlace(place);
    };
    for (const place of readSharedPlaces()) apply(place);
    return subscribeSharedPlaces(apply);
  }, [watchFamilyRoom]);

  useEffect(() => {
    if (state.permissions.motion !== 'granted') return;
    let stillSince = 0;
    let lastMoving: boolean | null = null;
    const onMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x == null || acc.y == null || acc.z == null) return;
      const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
      const active = Math.abs(magnitude - 9.8) > 3;
      const at = Date.now();
      if (active) {
        stillSince = 0;
        if (lastMoving === true) return;
        lastMoving = true;
        familyRef.current.setMotion(true);
        return;
      }
      if (lastMoving === true) lastMoving = null;
      if (stillSince === 0) stillSince = at;
      if (at - stillSince < MOTION_STILL_HOLD_MS) return;
      familyRef.current.setMotion(false);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [state.permissions.motion]);

  useEffect(() => {
    const points = state.tracks.self;
    const phase = state.motionAlertPhase || 'unknown';
    const decided = nextMotionAlert({ points, now, phase });
    if (decided.phase !== phase) familyRef.current.setMotionAlertPhase(decided.phase);
    if (!decided.event) return;
    const current = familyRef.current.state;
    const targets = motionNotifyNames(current.members, current.motionNotifyIds);
    if (targets.length === 0) return;
    const stamp = `${decided.event}:${lastTravelAt(points) ?? 0}`;
    if (motionSentRef.current === stamp) return;
    motionSentRef.current = stamp;
    const from = current.profile?.name || '가족';
    void deliverMotionAlert(current, from, motionAlertCopy(from, decided.event), targets);
  }, [now, state.motionAlertPhase, state.motionNotifyIds, state.tracks.self]);

  useEffect(() => {
    if (!motionShade) return;
    const timer = window.setTimeout(() => setMotionShade(null), 6000);
    return () => window.clearTimeout(timer);
  }, [motionShade]);

  useEffect(() => {
    if (!state.home) return;
    for (const member of state.members) {
      if (!hasLocation(member)) continue;
      if (member.id !== 'self' && member.share !== 'allowed') continue;
      const inside = haversineMeters(member, state.home) <= state.home.radiusM;
      const previous = insideRef.current[member.id];
      if (previous !== undefined && previous !== inside) {
        if (member.id === 'self') {
          insideRef.current[member.id] = inside;
          continue;
        }
        const title = inside ? `${member.name} 님이 집에 도착했습니다` : `${member.name} 님이 집 반경 ${state.home.radiusM}m 밖으로 나갔습니다`;
        const body = state.home.label || '우리 집 안심존';
        familyRef.current.pushNotice(title, body);
        if (notifyOk && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(title, { body });
          } catch {
            /* 알림 표시만 거절된 경우 */
          }
        }
      }
      insideRef.current[member.id] = inside;
    }
  }, [notifyOk, state.home, state.members]);

  useEffect(() => {
    if (!self || !hasLocation(self)) return;
    const profileName = state.profile?.name || '가족';
    for (const link of state.guardians) {
      const zone = link.leaveAlert;
      if (!zone) continue;
      const inside = haversineMeters(self, zone) <= zone.radiusM;
      const previous = insideRef.current[`leave-${link.id}`];
      if (shouldAlertLeave(previous, inside, link.share === 'allowed')) {
        publishFamilyAlert({
          kind: 'leave',
          code: link.code,
          from: profileName,
          body: `${profileName} 님이 집 반경을 벗어났습니다.`,
        }, link.syncToken);
      }
      insideRef.current[`leave-${link.id}`] = inside;
    }
  }, [self, state.guardians, state.mode, state.profile?.name]);

  useEffect(() => {
    if (!watchFamilyRoom) return;
    const seen = new Set<string>();
    const handle = (alert: FamilyAlert) => {
      if (seen.has(alert.id) || isFamilyAlertAcked(alert.id)) return;
      if (Date.now() - alert.at > 3 * 60 * 1000) return;
      const current = familyRef.current.state;
      if (alert.kind === 'motion') {
        const codes = new Set([current.inviteCode, ...current.guardians.map((link) => link.code)]);
        if (!codes.has(alert.code)) return;
        const me = myChatName(current, alert.code);
        if (!me || chatName(alert.from) === me) return;
        if (!Array.isArray(alert.to) || !alert.to.includes(me)) return;
        seen.add(alert.id);
        setMotionShade(alert.body);
        familyRef.current.pushNotice(alert.body, '움직임');
        if (notifyOk && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(alert.body);
          } catch {
            /* 알림 표시만 거절된 경우 */
          }
        }
        return;
      }
      if (alert.code !== current.inviteCode) return;
      seen.add(alert.id);
      setIncoming(alert);
      sounds.startSiren();
      const title = alert.kind === 'sos' ? 'SOS' : '집 반경을 나갔습니다';
      familyRef.current.pushNotice(title, alert.body);
      if (notifyOk && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, { body: alert.body });
        } catch {
          /* 알림 표시만 거절된 경우 */
        }
      }
    };
    const latest = readFamilyAlert();
    if (latest) handle(latest);
    const onPush = (event: MessageEvent) => {
      const data = event.data as { type?: string; alert?: FamilyAlert } | null;
      if (data?.type === 'umap-alert' && data.alert) handle(data.alert);
    };
    navigator.serviceWorker?.addEventListener('message', onPush);
    const stopLocal = subscribeFamilyAlerts(handle);
    const stopRemote = startAdminRemoteSync(
      { code: state.inviteCode, writeKey: state.syncWriteKey, readKey: state.syncReadKey },
      {
        onPlace: (place) => familyRef.current.applySharedPlace(place),
        onProfiles: (profiles) => familyRef.current.applySharedProfiles(familyRef.current.state.inviteCode, profiles),
        onTrails: (trails) => familyRef.current.applyCanonicalTrails(trails),
        onAlert: handle,
      },
      {
        memberId: state.profile?.profileKey ? state.profile.id : '',
        profileKey: state.profile?.profileKey || '',
      },
    );
    return () => {
      stopLocal();
      stopRemote();
      navigator.serviceWorker?.removeEventListener('message', onPush);
    };
  }, [notifyOk, state.inviteCode, watchFamilyRoom, state.syncReadKey, state.syncWriteKey, state.profile?.id, state.profile?.profileKey]);

  const dmRoomKey = `peer:${state.inviteCode}:${state.syncWriteKey}:${state.guardians.map((link) => `${link.code}:${link.syncToken ?? ''}`).join('|')}`;
  useEffect(() => {
    if (state.tab !== 'map') return;
    let cancel = false;
    const tick = async () => {
      const current = familyRef.current.state;
      const rooms = [
        { code: current.inviteCode, me: myChatName(current, current.inviteCode), writeKey: current.syncWriteKey, readKey: current.syncReadKey, token: null as string | null },
        ...current.guardians
          .filter((link) => link.syncToken)
          .map((link) => ({ code: link.code, me: myChatName(current, link.code), token: link.syncToken ?? null, writeKey: '', readKey: '' })),
      ];
      for (const room of rooms) {
        if (cancel) return;
        const token = room.token && room.token.includes('.')
          ? room.token
          : room.writeKey && room.readKey
            ? await syncTokenFor(room.writeKey, room.readKey)
            : null;
        if (!token || cancel) continue;
        const threads = await fetchMyDirectThreads(room.code, token, room.me);
        if (!threads) continue;
        for (const thread of threads) mergeDirectChat(room.code, room.me, thread.peer, thread.messages);
      }
    };
    void tick();
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => {
        void tick().finally(() => {
          if (!cancel) arm();
        });
      }, syncRetryDelay('chat', CHAT_LIST_POLL_MS));
    };
    arm();
    const onResume = () => { void tick(); };
    window.addEventListener('umap-room-resume', onResume);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      window.removeEventListener('umap-room-resume', onResume);
    };
  }, [dmRoomKey, state.tab]);

  useEffect(() => {
    if (!familySyncConfigured() || state.permissions.notifications !== 'unknown' || keepPrompt !== 'none') return;
    if (readSessionFlag(CHAT_NOTIFY_ASKED_KEY)) return;
    markSessionFlag(CHAT_NOTIFY_ASKED_KEY);
    void askNotifications().then((result) => {
      const notifications = result.state === 'granted' || result.state === 'denied' || result.state === 'skipped' ? result.state : 'denied';
      const current = familyRef.current.state.permissions;
      familyRef.current.finishPermissions({ ...current, notifications, completed: true });
    });
  }, [keepPrompt, state.mode, state.permissions.notifications]);

  const chatIdentity = `${dmRoomKey}:${state.profile?.name ?? ''}:${notifyOk ? '1' : '0'}`;
  useEffect(() => {
    if (!notifyOk || !familySyncConfigured()) return;
    let cancel = false;
    void (async () => {
      const current = familyRef.current.state;
      const rooms: Array<{ code: string; token: string; me: string; readKey?: string }> = [];
      if (current.syncWriteKey && current.syncReadKey) {
        const token = await syncTokenFor(current.syncWriteKey, current.syncReadKey);
        rooms.push({
          code: current.inviteCode,
          token,
          me: myChatName(current, current.inviteCode),
          readKey: current.syncReadKey,
        });
      }
      for (const link of current.guardians) {
        if (!link.syncToken?.includes('.')) continue;
        rooms.push({ code: link.code, token: link.syncToken, me: myChatName(current, link.code) });
      }
      if (cancel || rooms.length === 0) return;
      let allPushed = true;
      for (const room of rooms) {
        const pushed = await registerRoomPush({ code: room.code, token: room.token, name: room.me, readKey: room.readKey });
        if (!pushed) allPushed = false;
      }
      if (cancel || allPushed || !umapLocationNative()) return;
      const status = await umapLocation.alertWatchStatus().catch(() => ({ running: false, userStopped: false }));
      if (cancel || status.userStopped) return;
      const base = familySyncUrl();
      if (!base) return;
      await umapLocation.startAlertWatch({
        config: JSON.stringify({
          baseUrl: base,
          rooms: rooms.map((room) => ({
            code: room.code,
            token: room.token,
            me: room.me,
            ...(room.readKey ? { readKey: room.readKey } : {}),
          })),
        }),
      }).catch(() => undefined);
    })();
    return () => {
      cancel = true;
    };
  }, [chatIdentity, notifyOk]);

  useEffect(() => {
    const open = (code: string, peer: string) => {
      const target = chatTargetFor(familyRef.current.state, code, peer);
      if (!target) return;
      setMenuOpen(false);
      setAdminSettings(false);
      setManagedSettings(false);
      setSheet(null);
      setDm(target);
    };
    const onPush = (event: MessageEvent) => {
      const data = event.data as { type?: string; code?: string; peer?: string; message?: unknown } | null;
      if (!data) return;
      if (data.type === 'umap-open-chat' && data.code && data.peer) {
        open(data.code, data.peer);
        return;
      }
      if (data.type !== 'umap-chat' || !data.code || !isFamilyChatMessage(data.message)) return;
      const current = familyRef.current.state;
      const me = myChatName(current, data.code);
      const peer = chatName(data.message.from) === me ? data.message.to : data.message.from;
      mergeDirectChat(data.code, me, peer, [data.message]);
    };
    navigator.serviceWorker?.addEventListener('message', onPush);
    const params = new URLSearchParams(window.location.search);
    const queryPeer = chatName(params.get('chat') || '');
    const queryCode = (params.get('room') || '').replace(/\D/g, '').slice(0, 6);
    if (queryPeer && /^\d{4,6}$/.test(queryCode) && chatTargetFor(familyRef.current.state, queryCode, queryPeer)) {
      open(queryCode, queryPeer);
      params.delete('chat');
      params.delete('room');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    let removeNative = () => {};
    void consumePendingChat().then((pending) => {
      if (pending) open(pending.code, pending.peer);
    });
    void listenChatOpen((pending) => {
      open(pending.code, pending.peer);
      void consumePendingChat();
    }).then((remove) => {
      removeNative = remove;
    });
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onPush);
      removeNative();
    };
  }, [state.mode, state.inviteCode, state.profile?.name, state.guardians]);

  const stopIncoming = () => {
    if (incoming) ackFamilyAlert(incoming.id);
    sounds.stopSiren();
    setIncoming(null);
    setSirenOn(false);
  };

  const triggerSos = () => {
    const name = state.profile?.name || '가족';
    const links = state.guardians.filter((link) => link.share !== 'revoked');
    sounds.startSiren();
    setSirenOn(true);
    if (links.length === 0) {
      family.pushNotice('SOS', '연결된 관리자가 없습니다. 이 폰에서만 사이렌이 울립니다.');
      return;
    }
    for (const link of links) {
      publishFamilyAlert({ kind: 'sos', code: link.code, from: name, body: `${name} 님이 SOS를 눌렀습니다.` }, link.syncToken);
    }
    if (state.syncWriteKey && state.syncReadKey) {
      void syncTokenFor(state.syncWriteKey, state.syncReadKey).then((token) => {
        publishFamilyAlert({ kind: 'sos', code: state.inviteCode, from: name, body: `${name} 님이 SOS를 눌렀습니다.` }, token);
      });
    }
  };

  const eraseFamilyRoom = () => {
    const current = familyRef.current.state;
    const profile = current.profile;
    const name = (profile?.name || '가족').trim().slice(0, 20) || '가족';
    const memberId = profile?.profileKey ? profile.id : '';
    const guardians = current.guardians.filter((link) => link.syncToken);
    const room = { code: current.inviteCode, writeKey: current.syncWriteKey, readKey: current.syncReadKey };
    void (async () => {
      await abandonFamilySync();
      for (const link of guardians) {
        await revokeFamilyPlace({
          code: link.code,
          token: link.syncToken as string,
          name,
          memberId,
          profileKey: profile?.profileKey,
        });
      }
      await umapLocation.stop().catch(() => undefined);
      await umapLocation.ackStopped().catch(() => undefined);
      const removed = shouldDeleteCreatedRoom(null, 'delete')
        ? await deleteFamilyRoomRemote(room.code, room.writeKey, room.readKey)
        : 'off';
      const serverNote = removed === 'failed'
        ? '서버의 가족 방은 지우지 못했습니다. 이 폰에서는 나갔고, 그 방 동기화는 멈췄습니다.'
        : null;
      familyRef.current.clearFamilyRoom(serverNote);
    })();
  };

  const managed = false;
  const selected = (recordId ? state.members.find((member) => member.id === recordId) : null)
    ?? state.members.find((member) => member.id === selectedId)
    ?? state.members.find((member) => member.id === 'self');
  const liveDay = seoulDayKey(now);
  const visibleMembers = mapMembers(state.members, state.profile?.id, state.inviteCode, state.profile?.name).map((member) => {
    if (!hasLocation(member)) return member;
    const todayPoints = liveTrailPoints(
      (state.tracks[member.id] ?? []).filter((point) => seoulDayKey(point.at) === liveDay),
      now,
    );
    const stable = displayCoordinate(todayPoints, {
      lat: member.lat,
      lng: member.lng,
      at: member.updatedAt || now,
      accuracyM: member.accuracyM,
      staying: liveMotionLabel({
        located: true,
        moving: member.moving,
        points: state.tracks[member.id],
        now,
        pin: { lat: member.lat, lng: member.lng, at: member.updatedAt || now, accuracyM: member.accuracyM },
      }) === '머무름',
    });
    if (stable.lat === member.lat && stable.lng === member.lng) return member;
    return { ...member, lat: stable.lat, lng: stable.lng };
  });
  const shareKey = visibleMembers
    .filter(hasLocation)
    .map((member) => `${member.id}:${member.lat.toFixed(5)},${member.lng.toFixed(5)}`)
    .join('|');
  useEffect(() => {
    if (fittedShare.current) return;
    const points = state.members.filter((member) => member.role !== 'guardian' && hasLocation(member) && (member.id === 'self' || member.share === 'allowed'));
    if (points.length < 2) {
      setAwaitingFamilyFit(false);
      return;
    }
    setAwaitingFamilyFit(true);
    const timer = window.setInterval(() => {
      if (!mapRef.current) return;
      fittedShare.current = true;
      followRef.current = noteUserDrag(followRef.current);
      setFollowOn(false);
      mapRef.current.fit(points.flatMap((member) => (hasLocation(member) ? [{ lat: member.lat, lng: member.lng }] : [])));
      setAwaitingFamilyFit(false);
      window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, [shareKey, state.members, state.mode]);
  const historyDays = historyDayKeys(now);
  const activeHistoryDay = historyDays.includes(historyDay) ? historyDay : historyDays[0];
  const viewingRecords = recordId != null && !placingHome;
  const followId = followTargetId(selected?.id);
  const followMember = visibleMembers.find((member) => member.id === followId) ?? null;
  const followLat = followMember && hasLocation(followMember) ? followMember.lat : null;
  const followLng = followMember && hasLocation(followMember) ? followMember.lng : null;
  const familyFitPending = !fittedShare.current && visibleMembers.filter(hasLocation).length >= 2;
  const pathDay = viewingRecords ? activeHistoryDay : liveDay;
  const memberPoints = selected ? state.tracks[selected.id] ?? [] : [];
  const dayPoints = useMemo(
    () => memberPoints.filter((point) => seoulDayKey(point.at) === pathDay),
    [memberPoints, pathDay],
  );
  const dayNow = pathDay === liveDay ? now : seoulDayEndMs(pathDay);
  const liveLine = useMemo(() => liveTrailPoints(dayPoints, dayNow), [dayNow, dayPoints]);
  const openMapLine = useMemo(() => displayLivePoints(dayPoints, dayNow), [dayNow, dayPoints]);
  const memberJourneys = selected ? state.journeys[selected.id] ?? [] : [];
  const dayJourneys = useMemo(
    () => collapseDuplicateJourneys(memberJourneys.filter((journey) => seoulDayKey(journey.endedAt) === pathDay))
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt),
    [memberJourneys, pathDay],
  );
  const openJourney = useMemo(
    () => (pathDay === liveDay ? previewOpenJourney(dayPoints, now) : null),
    [dayPoints, liveDay, now, pathDay],
  );
  useEffect(() => {
    setDetailId(null);
    setPlaying(false);
  }, [pathDay, selected?.id]);
  useEffect(() => {
    if (state.tab !== 'map') familyRef.current.setTab('map');
  }, [state.tab]);
  useEffect(() => {
    if (!viewingRecords) {
      setDetailId(null);
      setPlaying(false);
      setDayPicker(false);
    }
  }, [viewingRecords]);
  const detailJourney = detailId && detailId !== 'open'
    ? dayJourneys.find((journey) => journey.id === detailId) ?? null
    : null;
  const detailOpen = viewingRecords && !!detailId && (detailId === 'open' ? !!openJourney : !!detailJourney);
  const mapShown = state.tab === 'map' && !placingHome && !detailOpen && !viewingRecords;
  useEffect(() => {
    const id = window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
    return () => window.clearTimeout(id);
  }, [viewingRecords, detailOpen]);
  const detailPoints = useMemo(
    () => collapseIndoorStayDisplay(detailId === 'open' ? openMapLine : detailJourney?.points ?? []),
    [detailId, detailJourney, openMapLine],
  );
  const liveDrawable = liveTrailDrawable(liveLine, dayNow);
  const showPath = familyMapShowsTrail({
    viewingRecords,
    detailOpen,
    showTrail,
    member: selected,
    liveDrawable,
  });
  const mapTrails = useMemo(() => {
    if (detailOpen) return detailPoints.length >= 2 ? [detailPoints] : [];
    if (viewingRecords) {
      if (!showPath || !selected) return [];
      const saved = recordsDayTrails({ journeys: dayJourneys, livePoints: [], liveDrawable: false });
      if (pathDay !== liveDay) return saved;
      return saved.concat(overviewLinesFor(selected, state.tracks, now, liveDay, false));
    }
    const lines = [];
    for (const member of state.members) {
      for (const line of overviewLinesFor(member, state.tracks, now, liveDay)) lines.push(line);
    }
    return lines;
  }, [dayJourneys, detailOpen, detailPoints, liveDay, now, pathDay, selected, showPath, state.members, state.tracks, viewingRecords]);
  useEffect(() => {
    if (viewingRecords) return;
    for (const member of state.members) {
      const report = memberLiveLines(member, state.tracks, now, liveDay);
      noteDiag({
        kind: 'trail',
        member: member.id === 'self' ? 'self' : 'family',
        reason: report.reason,
        stored: report.stored,
        live: report.live,
        segments: report.lines.length,
      });
    }
  }, [liveDay, now, state.members, state.tracks, viewingRecords]);
  const dayVisits = useMemo(() => {
    const list = selected ? state.visits[selected.id] ?? [] : [];
    return list.filter((visit) => seoulDayKey(visit.arrivedAt) === pathDay);
  }, [pathDay, selected, state.visits]);
  const unreadAlerts = state.notices.some((item) => !item.read);
  const recordFitKey = detailOpen ? `${selected?.id ?? ''}:${pathDay}:${detailId ?? ''}` : '';
  const fittedRecordKey = useRef('');
  const recordViewLocked = useRef(false);
  useEffect(() => {
    recordViewLocked.current = false;
    fittedRecordKey.current = '';
  }, [recordFitKey]);
  useEffect(() => {
    const points = detailPoints;
    if (!shouldAutoFitRecord({
      recordKey: recordFitKey,
      fittedKey: fittedRecordKey.current,
      userAdjusted: recordViewLocked.current,
      pointCount: points.length,
    })) return;
    const key = recordFitKey;
    const timer = window.setTimeout(() => {
      if (recordViewLocked.current || fittedRecordKey.current === key) return;
      mapRef.current?.fit(points);
      fittedRecordKey.current = key;
    }, 120);
    return () => window.clearTimeout(timer);
  }, [detailPoints, recordFitKey]);
  const missingSyncKey = state.guardians.some((link) => (link.share === 'allowed' || link.share === 'revoked') && !link.syncToken);
  const syncBanner = syncBannerText(syncPhase, missingSyncKey, Capacitor.isNativePlatform());
  const remoteLive = syncPhase === 'live';

  useEffect(() => {
    followRef.current = noteFollowTarget(followRef.current, followId);
    setFollowOn(followRef.current.following);
  }, [followId]);
  useEffect(() => {
    if (followLat == null || followLng == null || familyFitPending || awaitingFamilyFit) return;
    const foreground = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    const planned = planFollowPan(followRef.current, {
      now: Date.now(),
      foreground,
      mapVisible: mapShown,
      memberId: followId,
      lat: followLat,
      lng: followLng,
    });
    followRef.current = planned.state;
    if (planned.pan) mapRef.current?.followTo(planned.pan.lat, planned.pan.lng);
  }, [awaitingFamilyFit, familyFitPending, followId, followLat, followLng, mapShown]);
  const recenterFollow = () => {
    followRef.current = noteRecenter(followRef.current);
    setFollowOn(true);
    if (followLat == null || followLng == null) return;
    mapRef.current?.followTo(followLat, followLng);
    followRef.current = planFollowPan(followRef.current, {
      now: Date.now(),
      foreground: true,
      mapVisible: true,
      memberId: followId,
      lat: followLat,
      lng: followLng,
    }).state;
  };

  const focusMember = (member: Member, fitTrail: boolean) => {
    setSelectedId(member.id);
    const points = overviewLinesFor(member, state.tracks, now, liveDay).flat();
    if (fitTrail && showTrail && points.length >= 2) mapRef.current?.fit(points);
    else if (hasLocation(member)) mapRef.current?.showMember(member.lat, member.lng);
  };

  const closeDetail = () => {
    setDetailId(null);
    setPlaying(false);
  };
  const openDetail = (id: string, play: boolean) => {
    setDetailId(id);
    setPlaying(play);
  };
  const startHomePick = () => {
    const existing = state.home;
    const located = self && hasLocation(self) ? { lat: self.lat, lng: self.lng } : null;
    const start = existing
      ? { lat: existing.lat, lng: existing.lng }
      : located ?? mapRef.current?.getCenter() ?? center;
    setShowZone(true);
    setDraftHome(existing
      ? { ...existing, lat: start.lat, lng: start.lng, alertPhone: '' }
      : { label: '우리 집', address: '', lat: start.lat, lng: start.lng, radiusM: 200, alertPhone: '' });
    setMenuOpen(false);
    setManagedSettings(false);
    setAdminSettings(false);
    setRecordId(null);
    setPlacingHome(true);
    family.setTab('map');
    window.setTimeout(() => mapRef.current?.panTo(start.lat, start.lng), 60);
  };
  const openPerson = (member: Member) => {
    setSelectedId(member.id);
    setRecordId(member.id);
    setHistoryDay(seoulDayKey(Date.now()));
    setDetailId(null);
    setPlaying(false);
    setDm(null);
    if (hasLocation(member)) mapRef.current?.panTo(member.lat, member.lng);
  };
  const selectMember = (member: Member) => {
    const step = memberFocusStep({
      focusedId: recordId ?? selectedId,
      recordsOpen: recordId != null,
    }, member.id);
    if (step.action === 'keep') return;
    if (step.action === 'records') {
      openPerson(member);
      return;
    }
    if (recordId) {
      setRecordId(null);
      setDetailId(null);
      setPlaying(false);
    }
    focusMember(member, false);
  };
  const clearMemberFocus = () => {
    if (!selectedId && !recordId) return;
    setSelectedId(null);
    if (!recordId) return;
    setRecordId(null);
    setDetailId(null);
    setPlaying(false);
  };
  const applyLocationResult = (result: { location: string; note: string | null }) => {
    setSettingsNote(result.note);
    if (result.location === 'always' || result.location === 'while-using' || result.location === 'denied') {
      family.finishPermissions({ ...state.permissions, locationMode: result.location, completed: true });
    }
  };
  const openLocationSettings = () => {
    setMenuOpen(false);
    setAlwaysSetup(true);
  };
  const openGuideSettings = () => {
    setGuideBusy(true);
    void (async () => {
      const overlay = tracking.native ? await overlayPermissionGranted() : false;
      return askAlwaysLocation(state.permissions.accuracy === 'precise', { overlay });
    })().then((result) => {
      setGuideBusy(false);
      setAlwaysGuide(false);
      applyLocationResult(result);
    });
  };
  const openBatterySettings = () => {
    void askBattery().then((result) => setSettingsNote(result.note));
  };
  useEffect(() => consumeAndroidBack(() => {
    if (shareAsk) {
      setShareAsk(false);
      return true;
    }
    if (alwaysSetup) {
      setAlwaysSetup(false);
      return true;
    }
    if (alwaysGuide) {
      setAlwaysGuide(false);
      return true;
    }
    if (confirm) {
      setConfirm(null);
      return true;
    }
    if (keepPrompt !== 'none') {
      setKeepPrompt('none');
      return true;
    }
    if (dayPicker) {
      setDayPicker(false);
      return true;
    }
    if (dm) {
      setDm(null);
      return true;
    }
    if (alertsOpen) {
      setAlertsOpen(false);
      return true;
    }
    if (sheet) {
      setSheet(null);
      return true;
    }
    if (profileOpen) {
      setProfileOpen(false);
      return true;
    }
    if (managedSettings) {
      setManagedSettings(false);
      return true;
    }
    if (adminSettings) {
      setAdminSettings(false);
      return true;
    }
    if (motionOpen) {
      setMotionOpen(false);
      return true;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return true;
    }
    if (placingHome) {
      setDraftHome(null);
      setPlacingHome(false);
      return true;
    }
    if (detailId) {
      setDetailId(null);
      setPlaying(false);
      return true;
    }
    if (recordId) {
      setRecordId(null);
      return true;
    }
    return false;
  }), [adminSettings, alertsOpen, alwaysGuide, alwaysSetup, confirm, dayPicker, detailId, dm, keepPrompt, managedSettings, menuOpen, motionOpen, placingHome, profileOpen, recordId, shareAsk, sheet]);
  const people = rosterMembers(state.members, state.profile?.id, state.inviteCode, state.profile?.name);
  const extraChats = guardianThreads(state).filter((thread) => chatTick >= 0 || thread.peer);

  return (
    <div className="flex h-full justify-center bg-[#d7e3ee]">
      <div className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-white pb-[env(safe-area-inset-bottom)]">
        <div className={`relative min-h-0 flex-1 ${viewingRecords && !detailOpen ? 'invisible pointer-events-none' : ''}`}>
          <StreetMap
            ref={mapRef}
            center={center}
            zoom={16}
            members={detailOpen ? [] : visibleMembers}
            home={detailOpen ? null : (draftHome ?? (showZone ? state.home : null))}
            trails={mapTrails}
            trailColor="#0084FF"
            selectedId={selected?.id}
            onSelect={(id) => {
              const member = state.members.find((item) => item.id === id);
              if (!member) return;
              selectMember(member);
            }}
            onClear={clearMemberFocus}
            onUserView={() => {
              recordViewLocked.current = true;
            }}
            onGesture={() => {
              followRef.current = noteUserDrag(followRef.current);
              setFollowOn(false);
            }}
            onMove={(next) => {
              if (!placingRef.current) return;
              setDraftHome((prev) => {
                if (!prev) return prev;
                if (Math.abs(prev.lat - next.lat) < 0.000001 && Math.abs(prev.lng - next.lng) < 0.000001) return prev;
                return { ...prev, lat: next.lat, lng: next.lng };
              });
            }}
          />

          {!detailOpen && !viewingRecords && (
          <>
            <button
              type="button"
              aria-label="메뉴"
              onClick={() => setMenuOpen(true)}
              className="absolute left-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md"
            >
              <Menu className="h-5 w-5 text-slate-800" />
            </button>
          <button
            type="button"
            aria-label="알림"
            onClick={() => setAlertsOpen(true)}
            className="absolute left-16 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md"
          >
            <Bell className={`h-5 w-5 ${unreadAlerts ? 'text-[#0084FF]' : 'text-slate-700'}`} />
            {unreadAlerts && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[#ff8a34]" />}
          </button>
          {placingHome && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-full">
              <span className="rounded-full bg-white px-2 py-1 text-[11px] font-black text-slate-800 shadow">집</span>
            </div>
          )}

          {(keepHint || keepPhase !== 'idle') && !placingHome && (
            <div className="absolute inset-x-4 top-16 z-30 rounded-2xl bg-white px-4 py-3 text-left shadow">
              {keepHint && (
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-black text-slate-900">{keepHint.title}</p>
                  <button
                    type="button"
                    aria-label="나중에"
                    onClick={() => {
                      keepDismissRef.current = { kind: keepHint.kind, at: Date.now() };
                      keepPhaseRef.current = { phase: 'idle', until: 0 };
                      setKeepPhase('idle');
                      setKeepHint(null);
                    }}
                    className="shrink-0 text-xs font-bold text-slate-500"
                  >
                    닫기
                  </button>
                </div>
              )}
              {keepHint && <p className="mt-1 text-sm font-semibold leading-6 text-slate-700">{keepHint.text}</p>}
              {keepRestartStatus(keepPhase) && <p className="mt-1 text-xs font-bold text-[#0084FF]">{keepRestartStatus(keepPhase)}</p>}
              {keepHint && (
                <div className="mt-2 flex gap-2">
                  {keepHint.primary && (
                    <button
                      type="button"
                      onClick={() => {
                        keepPhaseRef.current = { phase: 'starting', until: Date.now() + 1_500 };
                        setKeepPhase('starting');
                        window.dispatchEvent(new Event('umap-retry-keep'));
                      }}
                      className="rounded-full bg-[#0084FF] px-3 py-2 text-xs font-bold text-white"
                    >
                      {keepHint.primary}
                    </button>
                  )}
                  {keepHint.settingsLabel && (
                    <button
                      type="button"
                      onClick={() => {
                        if (keepHint.settingsAction === 'battery') openBatterySettings();
                        else if (keepHint.settingsAction === 'always') openLocationSettings();
                        else void openAppSettings();
                      }}
                      className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-800"
                    >
                      {keepHint.settingsLabel}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {state.permissions.locationMode !== 'always' && !guideHintHidden && !placingHome && (
            <AlwaysAllowMapHint
              onOpen={() => setAlwaysSetup(true)}
              onDismiss={() => {
                markSessionFlag(ALWAYS_GUIDE_DISMISSED_KEY);
                setGuideHintHidden(true);
              }}
            />
          )}
          <div className="absolute right-3 top-3 z-30 flex flex-col gap-2">
            <RoundButton label="안심존 표시" onClick={() => setShowZone((value) => !value)}>
              <Home className={`h-5 w-5 ${showZone ? 'text-[#0084FF]' : 'text-slate-400'}`} />
            </RoundButton>
            {viewingRecords && (
            <RoundButton
              label="이동 경로"
              onClick={() => {
                setShowTrail((value) => {
                  const next = !value;
                  if (next && selected) {
                    const saved = recordsDayTrails({ journeys: dayJourneys, livePoints: [], liveDrawable: false });
                    const live = pathDay === liveDay ? overviewLinesFor(selected, state.tracks, now, liveDay, false) : [];
                    const points = saved.concat(live).flat();
                    if (points.length >= 2) mapRef.current?.fit(points);
                  }
                  return next;
                });
              }}
            >
              <Route className={`h-5 w-5 ${showPath ? 'text-[#0084FF]' : 'text-slate-400'}`} />
            </RoundButton>
            )}
            <RoundButton label="확대" onClick={() => mapRef.current?.zoomBy(1)}>
              <Plus className="h-5 w-5" />
            </RoundButton>
            <RoundButton
              label={placingHome ? '내 위치로' : recenterLabel(followId, followMember?.name)}
              onClick={() => {
                if (placingHome) {
                  if (self && hasLocation(self)) mapRef.current?.panTo(self.lat, self.lng);
                  return;
                }
                recenterFollow();
              }}
            >
              <LocateFixed className="h-5 w-5 text-[#0084FF]" />
            </RoundButton>
          </div>

          {(syncBanner || tracking.waiting) && (
            <p className="absolute inset-x-3 bottom-16 z-30 rounded-2xl bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-4 text-amber-950 shadow">
              {tracking.waiting}
              {tracking.waiting && syncBanner ? ' ' : ''}
              {syncBanner}
            </p>
          )}
          <button
            type="button"
            onClick={sirenOn ? stopIncoming : triggerSos}
            className={`absolute bottom-3 left-3 z-30 rounded-full px-5 py-4 text-base font-black text-white shadow-lg ${sirenOn ? 'bg-slate-900' : 'bg-red-600'}`}
          >
            {sirenOn ? '사이렌 끄기' : 'SOS'}
          </button>
          {motionShade && (
            <div role="status" className="absolute inset-x-3 top-16 z-40 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white shadow-lg">
              {motionShade}
            </div>
          )}
          {incoming && (
            <div className="absolute inset-x-4 top-24 z-40 rounded-3xl bg-red-600 px-4 py-4 text-white shadow-xl">
              <p className="text-lg font-black">{incoming.kind === 'sos' ? 'SOS' : '집 반경 이탈'}</p>
              <p className="mt-1 text-sm leading-5">{incoming.body}</p>
              <p className="mt-1 text-xs leading-5 text-red-100">
                {remoteLive
                  ? '같은 가족 방의 다른 폰에도 사이렌이 전달됩니다.'
                  : '위치 서버에 연결되지 않아 이 브라우저에서만 사이렌이 들립니다.'}
              </p>
              <button type="button" onClick={stopIncoming} className="mt-3 w-full rounded-full bg-white py-3 text-sm font-black text-red-600">
                사이렌 끄기
              </button>
            </div>
          )}
          {!followOn && !detailOpen && !placingHome && (
            <button
              type="button"
              onClick={recenterFollow}
              className="absolute left-1/2 top-[38%] z-30 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-black text-[#0084FF] shadow-md"
            >
              {recenterLabel(followId, followMember?.name)}
            </button>
          )}
          <button
            type="button"
            aria-label="가족 추가"
            onClick={() => setSheet('add')}
            className="absolute bottom-3 right-3 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[#0084FF] text-white shadow-lg"
          >
            <Plus className="h-6 w-6" />
          </button>
          </>
          )}
          {detailOpen && (
            <>
              <button
                type="button"
                onClick={closeDetail}
                className="absolute left-3 top-3 z-30 flex items-center gap-1 rounded-full bg-white px-3 py-2 text-sm font-bold text-slate-800 shadow-md"
              >
                <ChevronLeft className="h-5 w-5" />
                기록
              </button>
              <div className="absolute right-3 top-3 z-30 flex flex-col gap-2">
                <RoundButton label="확대" onClick={() => mapRef.current?.zoomBy(1)}>
                  <Plus className="h-5 w-5" />
                </RoundButton>
              </div>
            </>
          )}
        </div>

        {placingHome && draftHome && (
          <HomePlaceBar
            draft={draftHome}
            saved={!!state.home}
            canUseSelf={!!self && hasLocation(self)}
            onDraft={setDraftHome}
            onUseSelf={() => {
              if (self && hasLocation(self)) mapRef.current?.panTo(self.lat, self.lng);
            }}
            onCancel={() => {
              setDraftHome(null);
              setPlacingHome(false);
            }}
            onSave={() => {
              family.saveHome(draftHome);
              setDraftHome(null);
              setPlacingHome(false);
              setShowZone(true);
            }}
            onClear={() => {
              family.clearHome();
              setDraftHome(null);
              setPlacingHome(false);
            }}
          />
        )}

        {recordId && !placingHome && !detailOpen && (
          <section className="absolute inset-0 z-20 flex min-h-0 flex-col overflow-y-auto bg-white px-4 pb-3 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="truncate text-lg font-black">{selected?.id === 'self' ? '내 기록' : `${selected?.name ?? ''} 기록`}</h2>
              <button type="button" onClick={() => { setRecordId(null); setDetailId(null); setPlaying(false); }} aria-label="기록 닫기" className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold">
                닫기
              </button>
            </div>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`날짜 ${historyDayLabel(activeHistoryDay, now)}`}
              onClick={() => setDayPicker(true)}
              className="flex w-full items-center justify-between rounded-2xl bg-slate-100 px-4 py-3 text-left"
            >
              <span>
                <span className="block text-[11px] font-semibold text-slate-400">날짜</span>
                <span className="block text-sm font-black text-slate-900">{historyDayLabel(activeHistoryDay, now)}</span>
              </span>
              <span className="text-xs font-bold text-[#0084FF]">변경</span>
            </button>
            {selected && selected.id !== 'self' && directThreadFor(state, selected) && (
              <button
                type="button"
                onClick={() => {
                  const thread = directThreadFor(state, selected);
                  if (thread) setDm(thread);
                }}
                className="mt-2 w-full rounded-full bg-[#0084FF] py-2.5 text-sm font-black text-white"
              >
                개인 대화
              </button>
            )}
            <div className="mt-3 space-y-3">
              <JourneyCards
                journeys={dayJourneys}
                open={openJourney}
                selectedId={detailId}
                onSelect={(id) => openDetail(id, false)}
                onPlay={(id) => openDetail(id, true)}
              />
              <TodayRecord visits={dayVisits} />
            </div>
          </section>
        )}

        {!placingHome && !recordId && (
          <section className="rounded-t-3xl bg-white px-4 pb-2 pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)]">
            <div className="mb-1">
              <h2 className="text-lg font-black">우리 가족</h2>
              <p className="text-[11px] font-semibold text-slate-400">한 번 누르면 지도에서 보고, 한 번 더 누르면 기록을 봅니다</p>
            </div>
            {state.historyLocked && (
              <form
                className="mb-2 rounded-2xl bg-amber-50 px-3 py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  setHistoryNote('');
                  void openAccountSecrets({
                    vault: state.accountVault,
                    mergedVault: state.mergedVault,
                    sealedHistory: state.sealedHistory,
                    memberId: state.profile?.id,
                    journeys: [],
                    visits: [],
                    home: null,
                  }, localStorage, historyCode).then((opened) => {
                    if (opened.historyLocked) {
                      setHistoryNote('복구 코드가 맞지 않습니다. 가족 폰에서 Kinnex를 열면 지난 기록과 우리 집이 자동으로 돌아옵니다.');
                      return;
                    }
                    const journeys = Array.isArray(opened.journeys) ? opened.journeys as Session['journeys'][string] : [];
                    const visits = Array.isArray(opened.visits) ? opened.visits as Session['visits'][string] : [];
                    family.unlockHistory(journeys, visits, (opened.home || null) as Session['home']);
                  });
                }}
              >
                <p className="text-sm font-black text-slate-900">가족 폰에서 Kinnex를 열면 지난 기록이 자동으로 돌아옵니다</p>
                <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">다른 가족 폰이 온라인이면 그 폰이 이 기기에 기록 열쇠를 다시 감싸 줍니다. 우리 집도 그때 돌아옵니다. 복구 코드가 있으면 여기서도 열 수 있습니다.</p>
                <input
                  value={historyCode}
                  onChange={(event) => setHistoryCode(event.target.value.toUpperCase())}
                  placeholder="복구 코드"
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm outline-none"
                />
                <button type="submit" className="mt-2 w-full rounded-full bg-[#0084FF] py-2.5 text-sm font-bold text-white">기록 열기</button>
                {historyNote && <p className="mt-2 text-xs font-semibold leading-5 text-rose-600">{historyNote}</p>}
              </form>
            )}
            {!state.shareSelfWithFamily && (people.some((member) => member.id !== 'self') || state.guardians.length > 0) && (
              <button
                type="button"
                onClick={() => setShareAsk(true)}
                className="mb-2 w-full rounded-2xl bg-amber-50 px-3 py-3 text-left"
              >
                <span className="block text-sm font-black text-slate-900">내 위치는 아직 가족에게 나가지 않습니다</span>
                <span className="mt-1 block text-xs font-semibold leading-5 text-slate-600">위치 공유 허용을 누르면 지금 바로 공유가 시작되고, 앱을 다시 열어도 유지됩니다.</span>
              </button>
            )}
            <div className="max-h-52 overflow-y-auto">
              {people.map((member) => {
                const joinedOther = state.guardians.some((link) => link.ownerMemberId && link.ownerMemberId !== state.profile?.id);
                const shown = member.lead || (member.id === 'self' && !joinedOther) ? { ...member, lead: true } : member;
                const thread = directThreadFor(state, shown);
                const unread = thread ? unreadCount(thread.code, thread.me, thread.peer) : 0;
                return (
                  <MemberCard
                    key={shown.id}
                    member={shown}
                    home={state.home}
                    selected={member.id === selected?.id}
                    unread={chatTick >= 0 ? unread : 0}
                    live={personLive(member, state.tracks[member.id], now)}
                    onSelect={() => selectMember(member)}
                    onPhoto={member.id === 'self' ? (photo) => family.setPhoto(photo) : undefined}
                    onRemove={member.id !== 'self' ? () => setConfirm({ kind: 'remove', id: member.id, name: member.name }) : undefined}
                  />
                );
              })}
              {extraChats.map((thread) => (
                <button
                  key={`${thread.code}:${thread.peer}`}
                  type="button"
                  onClick={() => setDm(thread)}
                  className="flex w-full items-center justify-between rounded-2xl px-1 py-2 text-left"
                >
                  <span>
                    <span className="block font-bold">{thread.label}</span>
                    <span className="block text-xs text-slate-500">개인 대화</span>
                  </span>
                  {unreadCount(thread.code, thread.me, thread.peer) > 0 && (
                    <span className="rounded-full bg-[#ff8a34] px-2 py-0.5 text-[10px] font-black text-white">{unreadCount(thread.code, thread.me, thread.peer)}</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {detailOpen && (detailJourney || openJourney) && (
          <section className="bg-white px-4 pb-3 pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)]">
            <JourneyScrubber
              key={(detailJourney ?? openJourney)!.id}
              journey={(detailJourney ?? openJourney)!}
              points={detailPoints}
              playing={playing}
              mapRef={mapRef}
              onPlayingChange={setPlaying}
            />
          </section>
        )}

        {dm && (
          <FamilyChatSheet
            target={dm}
            onClose={() => setDm(null)}
          />
        )}
        {dayPicker && !detailOpen && !!recordId && (
          <Sheet title="날짜" onClose={() => setDayPicker(false)}>
            <p className="mb-3 text-sm leading-6 text-slate-500">오늘부터 30일 전입니다. 서울 날짜로 고릅니다.</p>
            <div className="space-y-1">
              {historyDays.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    setHistoryDay(day);
                    setDayPicker(false);
                  }}
                  className={`flex w-full rounded-2xl px-3 py-3 text-left text-sm font-bold ${day === activeHistoryDay ? 'bg-[#0084FF] text-white' : 'bg-slate-50 text-slate-800'}`}
                >
                  {historyDayLabel(day, now)}
                </button>
              ))}
            </div>
          </Sheet>
        )}
        {alertsOpen && (
          <Sheet
            title="알림"
            onClose={() => {
              family.markAlertsRead();
              setAlertsOpen(false);
            }}
          >
            {state.notices.length === 0 ? (
              <p className="text-sm leading-6 text-slate-500">아직 알림이 없습니다. 우리 집을 저장하면 들어오고 나갈 때 여기에 기록됩니다.</p>
            ) : (
              <ul className="space-y-2">
                {state.notices.map((item) => (
                  <li key={item.id} className={`rounded-2xl px-3 py-3 ${item.read ? 'bg-slate-50' : 'bg-blue-50'}`}>
                    <p className="text-sm font-bold">{item.title}</p>
                    <p className="text-xs leading-5 text-slate-500">{item.body}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{formatClock(item.at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Sheet>
        )}
        {sheet === 'add' && (
          <Sheet title="가족" onClose={() => setSheet(null)}>
            <p className="text-sm leading-6 text-slate-500">초대하거나, 받은 초대를 수락합니다. 수락만으로는 위치가 나가지 않습니다.</p>
            <button
              type="button"
              onClick={() => setSheet('invite')}
              className="mt-4 w-full rounded-2xl bg-slate-50 px-4 py-4 text-left"
            >
              <span className="block text-sm font-black text-slate-900">초대하기</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">코드와 QR로 가족을 초대합니다</span>
            </button>
            <button
              type="button"
              onClick={() => setSheet('accept')}
              className="mt-2 w-full rounded-2xl bg-slate-50 px-4 py-4 text-left"
            >
              <span className="block text-sm font-black text-slate-900">초대 수락</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">받은 코드나 QR로 들어갑니다</span>
            </button>
          </Sheet>
        )}
        {sheet === 'invite' && (
          <AdminInviteSheet
            code={state.inviteCode}
            writeKey={state.syncWriteKey}
            readKey={state.syncReadKey}
            home={state.home}
            senderName={state.profile?.name || ''}
            onClose={() => setSheet(null)}
            sharing={state.shareSelfWithFamily}
            onAllowShare={() => family.setShareSelf(true)}
          />
        )}
        {sheet === 'accept' && (
          <ManagedInviteSheet
            pending={state.pendingInvite}
            pendingSyncToken={state.pendingSyncToken}
            guardians={state.guardians}
            onClose={() => {
              family.dismissInvite();
              setSheet(null);
            }}
            onAccept={(label, code, syncToken, rosterName, adminName, ownerMemberId) => family.acceptInvite(label, code, syncToken, rosterName, adminName, ownerMemberId)}
            alreadySharing={state.shareSelfWithFamily}
            onShare={() => family.setShareSelf(true)}
          />
        )}
        {keepPrompt !== 'none' && !state.backgroundKeepAlive && (
          <KeepNoticeSheet
            mode={keepPrompt}
            busy={keepBusy}
            note={keepNote}
            onLater={() => {
              markSessionFlag(keepPrompt === 'start' ? KEEP_START_ASKED_KEY : KEEP_PERMISSION_ASKED_KEY);
              setKeepPrompt('none');
            }}
            onPrimary={() => {
              if (keepPrompt === 'start') {
                markSessionFlag(KEEP_START_ASKED_KEY);
                if (family.state.locationConsent !== false) family.setKeepAlive(true);
                setKeepPrompt('none');
                return;
              }
              setKeepBusy(true);
              void askNotifications().then((result) => {
                setKeepBusy(false);
                markSessionFlag(KEEP_PERMISSION_ASKED_KEY);
                const notifications = result.state === 'granted' || result.state === 'denied' || result.state === 'skipped' ? result.state : 'denied';
                family.finishPermissions({ ...state.permissions, notifications, completed: true });
                if (state.permissions.locationMode === 'always') {
                  markSessionFlag(KEEP_START_ASKED_KEY);
                  if (family.state.locationConsent !== false) family.setKeepAlive(true);
                  setKeepPrompt('none');
                  if (result.state !== 'granted') {
                    setSettingsNote('위치 유지를 켰습니다. 알림 목록에 위치 유지 카드가 남습니다. SOS 알림은 알림 권한이 필요합니다.');
                  }
                  return;
                }
                if (result.state === 'granted') {
                  setSettingsNote('알림을 허용했습니다. 위치를 항상 허용으로 고르면 위치 유지를 켤 수 있습니다. 위치 유지를 켜면 알림 목록에 카드가 남습니다.');
                  setKeepPrompt('none');
                  return;
                }
                setKeepNote(result.note ?? '알림을 허용하지 않았습니다. 위치를 항상 허용으로 고르면 위치 유지를 켤 수 있습니다. SOS와 새 대화 알림은 알림 권한이 필요합니다.');
              });
            }}
          />
        )}
        {motionOpen && (
          <MotionNotifySheet
            members={people.filter((member) => member.id !== 'self')}
            selected={state.motionNotifyIds || []}
            onToggle={(id) => {
              const current = state.motionNotifyIds || [];
              const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
              family.setMotionNotify(next);
            }}
            onClose={() => setMotionOpen(false)}
          />
        )}
        {menuOpen && (
          <AdminMenu
            name={state.profile?.name || '나'}
            photo={state.profile?.photo}
            home={state.home}
            alertHint={unreadAlerts ? '새 알림이 있습니다' : '들어오고 나간 기록'}
            onProfile={() => setProfileOpen(true)}
            onClose={() => {
              setProfileOpen(false);
              setAdminSettings(false);
              setMenuOpen(false);
            }}
            onHome={startHomePick}
            onAlerts={() => {
              setMenuOpen(false);
              setAlertsOpen(true);
            }}
            onMotion={() => {
              setMenuOpen(false);
              setMotionOpen(true);
            }}
            motionHint={motionMenuHint(people, state.motionNotifyIds || [])}
            onSettings={() => setAdminSettings(true)}
            onAlwaysGuide={openLocationSettings}
            onAcceptInvite={() => {
              setMenuOpen(false);
              setSheet('accept');
            }}
            onLeaveFamily={() => {
              setMenuOpen(false);
              setAdminSettings(false);
              setConfirm({ kind: 'delete-room', id: 'room', name: '가족 방' });
            }}
          />
        )}
        {profileOpen && (
          <ProfileSettingsSheet
            name={state.profile?.name || '나'}
            photo={state.profile?.photo}
            onPhoto={(photo) => family.setPhoto(photo)}
            onSave={(name) => {
              family.setDisplayName(name);
              setProfileOpen(false);
            }}
            onClose={() => setProfileOpen(false)}
          />
        )}
        {managed && managedSettings && (
          <Sheet title="설정" onClose={() => setManagedSettings(false)}>
            <p className="text-sm leading-6 text-slate-500">위치는 초대를 수락하고 공유를 허용한 뒤에만 나갑니다. 위치 유지를 켠 뒤에는 이 화면에서 끄지 않습니다.</p>
            <AppVersionLine />
            <RecoveryCodePanel />
            <DisclosureLogPanel />
            <DiagSendButton />
            <LocationConsentRow />
            <button
              type="button"
              onClick={openLocationSettings}
              className="mt-4 w-full rounded-full bg-slate-100 py-3 text-sm font-bold"
            >
              {tracking.native ? '항상 허용' : '위치 허용'}
            </button>
            <button type="button" onClick={() => setAlwaysGuide(true)} className="mt-2 w-full py-2 text-sm font-bold text-[#0084FF]">
              방법 보기
            </button>
            {tracking.native && (
              <button type="button" onClick={openBatterySettings} className="mt-2 w-full rounded-full bg-slate-100 py-3 text-sm font-bold">
                배터리 제한 없음
              </button>
            )}
            {!(state.permissions.locationMode === 'always' && state.backgroundKeepAlive) && (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const notifications = await askNotifications();
                    if (notifications.note) setSettingsNote(notifications.note);
                    if (tracking.native) {
                      const battery = await askBattery();
                      if (battery.note) setSettingsNote(battery.note);
                    }
                    if (family.state.locationConsent !== false) family.setKeepAlive(true);
                  })();
                }}
                className="mt-2 w-full rounded-full bg-[#0084FF] py-3 text-sm font-black text-white"
              >
                위치 유지 켜기
              </button>
            )}
            {state.backgroundKeepAlive && state.permissions.locationMode === 'always' && (
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">위치 유지가 켜져 있습니다. 끄는 버튼은 없습니다.</p>
            )}
            {settingsNote && <p className="mt-3 text-xs leading-5 text-amber-800">{settingsNote}</p>}
            {state.guardians.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => {
                  setManagedSettings(false);
                  setMenuOpen(false);
                  setConfirm({ kind: 'leave', id: link.id, name: link.label });
                }}
                className="mt-3 w-full py-2 text-sm font-bold text-slate-400"
              >
                {link.label} 연결 끊기
              </button>
            ))}
          </Sheet>
        )}
        {!managed && adminSettings && (
          <Sheet title="설정" onClose={() => setAdminSettings(false)}>
            <p className="text-sm leading-6 text-slate-500">가족은 같은 방에서 위치를 나눕니다. 위치 유지를 켠 뒤에는 이 화면에서 끄지 않습니다.</p>
            <AppVersionLine />
            <RecoveryCodePanel />
            <DisclosureLogPanel />
            <DiagSendButton />
            <LocationConsentRow />
            <div className="mt-3">
              <AlwaysAllowNotice
                locationMode={keepLive.location === 'always' || keepLive.location === 'while-using' || keepLive.location === 'denied' ? keepLive.location : state.permissions.locationMode}
                keepAlive={state.backgroundKeepAlive}
                native={tracking.native}
                batteryUnrestricted={keepLive.battery}
                serviceRunning={keepLive.running}
                note={settingsNote}
                onOpenSettings={openLocationSettings}
                onShowGuide={openLocationSettings}
                onBattery={openBatterySettings}
                onStart={() => {
                  void (async () => {
                    const notifications = await askNotifications();
                    if (notifications.note) setSettingsNote(notifications.note);
                    if (tracking.native) {
                      const battery = await askBattery();
                      if (battery.note) setSettingsNote(battery.note);
                    }
                    if (family.state.locationConsent !== false) family.setKeepAlive(true);
                  })();
                }}
              />
            </div>
            {state.backgroundKeepAlive && state.permissions.locationMode === 'always' && (
              <p className="text-xs font-semibold leading-5 text-slate-500">위치 유지가 켜져 있습니다. 끄는 버튼은 없습니다.</p>
            )}
            <dl className="mt-3 space-y-2 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
              <Line k="알림" v={labelOf(state.permissions.notifications)} />
              <Line k="위치 정확도" v={state.permissions.accuracy === 'precise' ? '정확한 위치' : '대략적인 위치'} />
              <Line k="위치 허용" v={locationLabel(state.permissions.locationMode)} />
              <Line k="움직임" v={labelOf(state.permissions.motion)} />
              <Line k="배터리 안내" v={state.permissions.battery === 'acknowledged' ? '확인함' : state.permissions.battery === 'skipped' ? '나중에' : '해당 없음'} />
            </dl>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              가족 위치와 배터리는 초대를 수락하고 위치 공유를 허용한 뒤에만 가족 방에 올라갑니다. 예시 좌표는 없습니다. 알림을 허용하면 앱을 닫아도 SOS, 움직임 시작·멈춤, 새 대화가 알림 목록에 옵니다. 움직임 알림은 메뉴에서 고른 가족에게만 갑니다. 전화번호로는 위치를 찾지 않습니다.
            </p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              「항상 허용」 고르기. 「정확한 위치 사용」 켜기. 배터리 제한 없음.
            </p>
            <div className="mt-4 space-y-2">
              <button type="button" onClick={family.revisitPermissions} className="w-full rounded-full bg-slate-100 py-3 text-sm font-bold">
                권한 안내 다시 보기
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminSettings(false);
                  setConfirm({ kind: 'logout', id: 'logout', name: '' });
                }}
                className="w-full rounded-full py-3 text-sm font-bold text-slate-500"
              >
                로그아웃
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminSettings(false);
                  setConfirm({ kind: 'delete-account', id: 'account', name: '' });
                }}
                className="w-full rounded-full py-3 text-sm font-bold text-red-600"
              >
                회원 탈퇴
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdminSettings(false);
                  setConfirm({ kind: 'delete-room', id: 'room', name: '가족 방' });
                }}
                className="w-full rounded-full py-3 text-sm font-bold text-red-600"
              >
                가족 방 지우기
              </button>
            </div>
          </Sheet>
        )}
        {confirm && (
          <ConfirmSheet
            title={confirm.kind === 'remove'
              ? '가족에서 지울까요?'
              : confirm.kind === 'delete-room'
                ? '가족 방을 지울까요?'
                : confirm.kind === 'logout'
                  ? '로그아웃할까요?'
                  : confirm.kind === 'delete-account'
                    ? '회원 탈퇴'
                    : '연결을 끊을까요?'}
            body={confirm.kind === 'remove'
              ? `${confirm.name} 님을 이 기기의 목록과 지도에서 지웁니다. 같은 방이 다시 받아도 이 폰에는 돌아오지 않습니다. 상대 폰의 공유 허용은 그 폰에서 꺼야 합니다.`
              : confirm.kind === 'delete-room'
                ? '이 폰의 가족 목록, 초대, 위치 공유를 지우고 그 방 동기화를 멈춥니다. 내가 만든 가족 방은 서버에서도 지웁니다. 초대로 들어간 방은 이 폰에서만 나가고, 상대의 방은 그대로 둡니다.'
                : confirm.kind === 'logout'
                  ? '이 폰의 로그인만 끝냅니다. 서버 백업은 남아 있고, 카카오·네이버 또는 복구 코드로 다시 불러올 수 있습니다.'
                  : confirm.kind === 'delete-account'
                    ? '서버 계정, 위치 기록, 카카오·네이버 연결과 복구 코드를 영구히 삭제합니다. 제3자 제공 기록은 값과 좌표 없이 6개월이 지난 뒤에 지웁니다. 이 작업은 되돌릴 수 없습니다.'
                    : `${confirm.name} 님과의 초대와 위치 공유를 이 폰에서 지웁니다.`}
            confirmLabel={confirm.kind === 'remove'
              ? '지우기'
              : confirm.kind === 'delete-room'
                ? '가족 방 지우기'
                : confirm.kind === 'logout'
                  ? '로그아웃'
                  : confirm.kind === 'delete-account'
                    ? '탈퇴'
                    : '연결 끊기'}
            danger={confirm.kind === 'delete-account'}
            busy={accountBusy}
            onClose={() => {
              if (accountBusy) return;
              setConfirm(null);
            }}
            onConfirm={() => {
              if (confirm.kind === 'remove') {
                const member = state.members.find((item) => item.id === confirm.id);
                const removedId = member && isMemberId(member.publisherId) ? member.publisherId : '';
                const selfId = state.profile?.profileKey ? state.profile.id : '';
                const profileKey = state.profile?.profileKey || '';
                if (removedId && selfId && profileKey && state.syncWriteKey && state.syncReadKey) {
                  void syncTokenFor(state.syncWriteKey, state.syncReadKey).then((token) => rotateRemovedMember({
                    code: state.inviteCode,
                    token,
                    memberId: selfId,
                    profileKey,
                    removedId,
                  }));
                }
                family.removeMember(confirm.id);
                setConfirm(null);
                return;
              }
              if (confirm.kind === 'delete-room') {
                eraseFamilyRoom();
                setConfirm(null);
                return;
              }
              if (confirm.kind === 'logout') {
                void umapLocation.stopAlertWatch();
                family.logout();
                setConfirm(null);
                return;
              }
              if (confirm.kind === 'delete-account') {
                if (accountBusy) return;
                setAccountBusy(true);
                cancelAccountBackup();
                void deleteFamilyAccount().then(async (result) => {
                  if (!result.ok) {
                    setAccountBusy(false);
                    setSettingsNote(result.message || '계정을 지우지 못했습니다. 다시 시도해 주세요.');
                    setConfirm(null);
                    setAdminSettings(true);
                    return;
                  }
                  await umapLocation.stopAlertWatch().catch(() => undefined);
                  await umapLocation.stop().catch(() => undefined);
                  await abandonFamilySync();
                  familyRef.current.withdraw();
                  setAccountBusy(false);
                  setConfirm(null);
                  setAdminSettings(false);
                });
                return;
              }
              family.leaveGuardian(confirm.id);
              setConfirm(null);
            }}
          />
        )}
        {alwaysGuide && (
          <AlwaysAllowGuide
            native={tracking.native}
            busy={guideBusy}
            note={settingsNote}
            onOpenSettings={openGuideSettings}
            onBattery={openBatterySettings}
            onClose={() => setAlwaysGuide(false)}
          />
        )}
        {alwaysSetup && (
          <AlwaysAllowSetup
            precise={state.permissions.accuracy === 'precise'}
            native={tracking.native}
            onClose={() => setAlwaysSetup(false)}
            onDone={(result) => {
              setAlwaysSetup(false);
              applyLocationResult(result);
              if (result.fallback && result.location !== 'always') setAlwaysGuide(true);
            }}
          />
        )}
        {shareAsk && (
          <div className="absolute inset-0 z-[70] flex items-end bg-slate-900/40" role="dialog" aria-modal="true" aria-labelledby="share-consent-title">
            <div className="w-full rounded-t-3xl bg-white px-5 pb-8 pt-5">
              <h2 id="share-consent-title" className="text-lg font-black">위치 공유 허용</h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">이 가족과 내 위치를 나눌까요? 허용하면 지금 바로 공유가 시작되고, 앱을 다시 열어도 유지됩니다. 나중에를 고르면 내 위치는 나가지 않습니다.</p>
              <button
                type="button"
                onClick={() => {
                  family.setShareSelf(true);
                  setShareAsk(false);
                }}
                className="mt-5 w-full rounded-full bg-[#0084FF] py-3.5 text-base font-black text-white"
              >
                위치 공유 허용
              </button>
              <button type="button" onClick={() => setShareAsk(false)} className="mt-2 w-full py-3 text-sm font-bold text-slate-500">
                나중에
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function motionMenuHint(members: Member[], ids: string[]): string {
  const picked = members.filter((member) => member.id !== 'self' && ids.includes(member.id)).map((member) => member.name);
  if (picked.length === 0) return '고른 가족에게만 · 기본은 보내지 않음';
  return `${picked.join(', ')}에게 시작·멈춤`;
}

function MotionNotifySheet({
  members,
  selected,
  onToggle,
  onClose,
}: {
  members: Member[];
  selected: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[60]">
      <Sheet title="움직임 알림" onClose={onClose}>
        <p className="text-sm leading-6 text-slate-500">
          내가 움직이기 시작하거나 멈출 때, 고른 가족에게만 짧은 알림을 보냅니다. 아무도 고르지 않으면 보내지 않습니다. 걸음은 약 45초, 차나 자전거는 약 3분 넘게 머물면 멈춤으로 보고, 실제로 이동한 뒤에만 시작 알림을 보냅니다.
        </p>
        {members.length === 0 ? (
          <p className="mt-4 rounded-2xl bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-500">가족이 아직 없습니다. 초대를 수락한 뒤에 고를 수 있습니다.</p>
        ) : (
          <ul className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
            {members.map((member) => {
              const on = selected.includes(member.id);
              return (
                <li key={member.id} className="border-t border-slate-100 first:border-t-0">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(member.id)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left"
                  >
                    <MemberAvatar name={member.name} photo={member.photo} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-slate-900">{member.name}</span>
                      <span className="block text-xs text-slate-400">{on ? '시작·멈춤을 받습니다' : '받지 않습니다'}</span>
                    </span>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${on ? 'bg-[#0084FF] text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {on ? '켜짐' : '꺼짐'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Sheet>
    </div>
  );
}

function MenuRow({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 border-t border-slate-100 px-4 py-3.5 text-left first:border-t-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-slate-900">{label}</span>
        <span className="block truncate text-xs text-slate-400">{hint}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
    </button>
  );
}

function ProfileSettingsSheet({
  name,
  photo,
  onPhoto,
  onSave,
  onClose,
}: {
  name: string;
  photo?: string;
  onPhoto: (photo: string) => void;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="absolute inset-0 z-[60]">
      <Sheet title="프로필 설정" onClose={onClose}>
        <div className="flex items-center gap-3">
          <PhotoPicker name={draft || name} photo={photo} onPhoto={onPhoto} />
          <p className="text-sm leading-6 text-slate-500">이름과 사진은 이 기기에 바로 저장됩니다. 가족 서버에 연결되면 같은 초대의 다른 폰 지도와 목록에도 보입니다. 다른 사람의 프로필은 바꿀 수 없습니다. 전화번호는 쓰지 않습니다.</p>
        </div>
        <label className="mt-4 block text-xs font-bold text-slate-400" htmlFor="profile-name">
          표시 이름
        </label>
        <input
          id="profile-name"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setNote(null);
          }}
          maxLength={20}
          placeholder="이름"
          className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3 outline-none focus:border-[#0084FF]"
        />
        {note && <p className="mt-2 text-sm leading-6 text-amber-800">{note}</p>}
        <button
          type="button"
          onClick={() => {
            const trimmed = draft.trim();
            if (!trimmed) {
              setNote('이름을 입력해 주세요.');
              return;
            }
            if (looksLikePhone(trimmed) || !localProfile(trimmed)) {
              setNote('전화번호는 이름으로 쓰지 않습니다.');
              return;
            }
            onSave(draft.trim());
          }}
          className="mt-4 w-full rounded-full bg-[#0084FF] py-3.5 text-sm font-black text-white"
        >
          저장
        </button>
      </Sheet>
    </div>
  );
}

function ManagedMenu({
  name,
  photo,
  home,
  alertHint,
  onProfile,
  onClose,
  onHome,
  onAlerts,
  onMotion,
  motionHint,
  onInvite,
  onSettings,
  onAlwaysGuide,
}: {
  name: string;
  photo?: string;
  home: HomeZone | null;
  alertHint: string;
  onProfile: () => void;
  onClose: () => void;
  onHome: () => void;
  onAlerts: () => void;
  onMotion: () => void;
  motionHint: string;
  onInvite: () => void;
  onSettings: () => void;
  onAlwaysGuide: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#f2f4f7]">
      <header className="flex items-center bg-white px-1 py-2">
        <button type="button" aria-label="닫기" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-slate-800">
          <X className="h-6 w-6" />
        </button>
        <h2 className="flex-1 text-center text-base font-bold">메뉴</h2>
        <span className="h-11 w-11" />
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <button type="button" onClick={onProfile} className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-4 text-left shadow-sm">
          <MemberAvatar name={name} photo={photo} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-black">{name}</span>
            <span className="block text-xs text-slate-400">프로필 설정</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
        </button>
        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <MenuRow icon={<Home className="h-4 w-4" />} label="우리 집 설정" hint={home ? `${home.label || '우리 집'} · 반경 ${home.radiusM}m` : '지도에서 집 위치를 정합니다'} onClick={onHome} />
          <MenuRow icon={<Bell className="h-4 w-4" />} label="알림" hint={alertHint} onClick={onAlerts} />
          <MenuRow icon={<Bell className="h-4 w-4" />} label="움직임 알림" hint={motionHint} onClick={onMotion} />
          <MenuRow icon={<UserPlus className="h-4 w-4" />} label="초대 수락" hint="관리자에게 받은 코드" onClick={onInvite} />
          <MenuRow icon={<MapPin className="h-4 w-4" />} label="항상 허용 방법" hint="앱을 닫아도 위치를 보내기" onClick={onAlwaysGuide} />
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <MenuRow icon={<Settings className="h-4 w-4" />} label="설정" hint="위치 권한" onClick={onSettings} />
        </div>
      </div>
    </div>
  );
}

function AdminMenu({
  name,
  photo,
  home,
  alertHint,
  onProfile,
  onClose,
  onHome,
  onAlerts,
  onMotion,
  motionHint,
  onSettings,
  onAlwaysGuide,
  onAcceptInvite,
  onLeaveFamily,
}: {
  name: string;
  photo?: string;
  home: HomeZone | null;
  alertHint: string;
  onProfile: () => void;
  onClose: () => void;
  onHome: () => void;
  onAlerts: () => void;
  onMotion: () => void;
  motionHint: string;
  onSettings: () => void;
  onAlwaysGuide: () => void;
  onAcceptInvite: () => void;
  onLeaveFamily: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#f2f4f7]">
      <header className="flex items-center bg-white px-1 py-2">
        <button type="button" aria-label="닫기" onClick={onClose} className="flex h-11 w-11 items-center justify-center text-slate-800">
          <X className="h-6 w-6" />
        </button>
        <h2 className="flex-1 text-center text-base font-bold">메뉴</h2>
        <span className="h-11 w-11" />
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <button type="button" onClick={onProfile} className="flex w-full items-center gap-3 rounded-2xl bg-white px-4 py-4 text-left shadow-sm">
          <MemberAvatar name={name} photo={photo} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-black">{name}</span>
            <span className="block text-xs text-slate-400">프로필 설정</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
        </button>
        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <MenuRow icon={<Home className="h-4 w-4" />} label="우리 집 설정" hint={home ? `${home.label || '우리 집'} · 반경 ${home.radiusM}m` : '지도에서 집 위치를 정합니다'} onClick={onHome} />
          <MenuRow icon={<Bell className="h-4 w-4" />} label="알림" hint={alertHint} onClick={onAlerts} />
          <MenuRow icon={<Bell className="h-4 w-4" />} label="움직임 알림" hint={motionHint} onClick={onMotion} />
          <MenuRow icon={<MapPin className="h-4 w-4" />} label="항상 허용 방법" hint="앱을 닫아도 위치를 보내기" onClick={onAlwaysGuide} />
          <MenuRow icon={<UserPlus className="h-4 w-4" />} label="초대 수락" hint="가족에게 받은 코드" onClick={onAcceptInvite} />
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl bg-white shadow-sm">
          <MenuRow icon={<Settings className="h-4 w-4" />} label="설정" hint="위치 권한" onClick={onSettings} />
          <MenuRow icon={<X className="h-4 w-4" />} label="가족 방 지우기" hint="이 폰에서 나가고 동기화를 멈춥니다" onClick={onLeaveFamily} />
        </div>
      </div>
    </div>
  );
}

async function deliverMotionAlert(state: Pick<Session, 'inviteCode' | 'syncWriteKey' | 'syncReadKey' | 'guardians'>, from: string, body: string, targets: string[]) {
  const rooms: { code: string; token: string }[] = [];
  if (state.syncWriteKey && state.syncReadKey && /^\d{4,6}$/.test(state.inviteCode)) {
    rooms.push({ code: state.inviteCode, token: await syncTokenFor(state.syncWriteKey, state.syncReadKey) });
  }
  for (const link of state.guardians) {
    if (link.share === 'revoked' || !link.syncToken || rooms.some((room) => room.code === link.code)) continue;
    rooms.push({ code: link.code, token: link.syncToken });
  }
  for (const room of rooms) {
    publishFamilyAlert({ kind: 'motion', code: room.code, from, body, to: targets }, room.token);
  }
}

function chatTargetFor(state: {
  mode: string | null;
  profile: { name?: string } | null;
  guardians: GuardianLink[];
  inviteCode: string;
  syncWriteKey: string;
  syncReadKey: string;
}, code: string, peer: string): DirectChatTarget | null {
  const name = chatName(peer);
  if (!name || !/^\d{4,6}$/.test(code)) return null;
  const me = myChatName(state, code);
  if (!me || me === name) return null;
  if (code === state.inviteCode) return { code, me, peer: name, label: name, writeKey: state.syncWriteKey, readKey: state.syncReadKey };
  const link = state.guardians.find((item) => item.code === code && item.syncToken);
  if (!link) return null;
  return { code, me, peer: name, label: name, token: link.syncToken };
}

function myChatName(state: { mode: string | null; profile: { name?: string } | null; guardians: GuardianLink[] }, code: string): string {
  const own = chatName(state.profile?.name);
  if (own) return own;
  const link = state.guardians.find((item) => item.code === code);
  return chatName(link?.rosterName) || '나';
}

function directThreadFor(state: {
  mode: string | null;
  profile: { name?: string } | null;
  guardians: GuardianLink[];
  inviteCode: string;
  syncWriteKey: string;
  syncReadKey: string;
}, member: Member): DirectChatTarget | null {
  if (member.id === 'self') return null;
  const codeFromId = member.id.startsWith('family:') ? member.id.split(':')[1] || '' : '';
  const link = state.guardians.find((item) => item.share !== 'revoked' && item.code === codeFromId)
    ?? state.guardians.find((item) => item.share !== 'revoked' && chatName(item.adminName || item.label) === chatName(member.name));
  const code = member.inviteCode || link?.code || codeFromId || state.inviteCode;
  if (!code) return null;
  const peer = chatName(member.name);
  const me = myChatName(state, code);
  if (!peer || peer === me) return null;
  if (code === state.inviteCode) {
    return { code, me, peer, label: member.name, writeKey: state.syncWriteKey, readKey: state.syncReadKey };
  }
  return { code, me, peer, label: member.name, token: link?.syncToken ?? null };
}

function guardianThreads(state: {
  mode: string | null;
  profile: { name?: string } | null;
  guardians: GuardianLink[];
  members: Member[];
}): DirectChatTarget[] {
  if (state.guardians.length === 0) return [];
  const shown = new Set(state.members.filter((member) => member.role === 'admin-share').map((member) => chatName(member.name)));
  const shownCodes = new Set(state.members.filter((member) => member.role === 'admin-share' && member.id.startsWith('family:')).map((member) => member.id.split(':')[1] || ''));
  const threads: DirectChatTarget[] = [];
  for (const link of state.guardians) {
    if (link.share === 'revoked' || shownCodes.has(link.code)) continue;
    const peer = chatName(link.adminName || link.label);
    const me = myChatName(state, link.code);
    if (!peer || peer === me || shown.has(peer)) continue;
    threads.push({
      code: link.code,
      me,
      peer,
      label: link.adminName || link.label,
      token: link.syncToken ?? null,
    });
  }
  return threads;
}

function personArea(member: Member, home: HomeZone | null) {
  const atHome = !!(home && hasLocation(member) && haversineMeters(member, home) <= home.radiusM);
  return memberPlaceLabel({
    place: member.place,
    located: hasLocation(member),
    atHome,
    homeLabel: home?.label,
  });
}

function overviewLinesFor(
  member: Member,
  tracks: Session['tracks'],
  now: number,
  liveDay: string,
  withPin = true,
) {
  return memberLiveLines(member, tracks, now, liveDay, withPin).lines;
}

function personLive(member: Member, points: { lat: number; lng: number; at: number; speedMps?: number | null; stayEnd?: boolean }[] | undefined, now: number) {
  if (member.id !== 'self' && member.needsAppUpdate) return OLD_APP_PLACE_LABEL;
  const presence = memberPresence(member, now);
  const stale = memberPresenceLabel(presence);
  if (stale) return stale;
  return liveMotionLabel({
    located: hasLocation(member),
    moving: member.moving,
    points,
    now,
    pin: hasLocation(member)
      ? { lat: member.lat, lng: member.lng, at: member.updatedAt || now, accuracyM: member.accuracyM }
      : undefined,
  });
}

function MemberCard({
  member,
  home,
  selected,
  unread = 0,
  live = '',
  onSelect,
  onPhoto,
  onRemove,
}: {
  member: Member;
  home: HomeZone | null;
  selected: boolean;
  unread?: number;
  live?: string;
  onSelect: () => void;
  onPhoto?: (photo: string) => void;
  onRemove?: () => void;
}) {
  const presence = memberPresence(member, Date.now());
  const dimmed = memberIsStale(presence);
  const disconnected = presence.kind === 'disconnected';
  return (
    <div className={`flex w-full items-center gap-3 rounded-2xl px-1 py-2 text-left ${selected ? 'bg-blue-50' : ''} ${dimmed ? 'opacity-60' : ''}`}>
      {onPhoto ? (
        <PhotoPicker name={member.name} photo={member.photo} onPhoto={onPhoto} />
      ) : (
        <MemberAvatar name={member.name} photo={member.photo} />
      )}
      <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
        <span className="block truncate font-bold">{member.name}{member.lead && <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-600">그룹장</span>}</span>
        <span className="block truncate text-xs text-slate-500">
          {disconnected ? '연결 끊김' : [personArea(member, home), live].filter(Boolean).join(' · ')}
        </span>
      </button>
      {unread > 0 && <span className="shrink-0 rounded-full bg-[#ff8a34] px-2 py-0.5 text-[10px] font-black text-white">{unread}</span>}
      {member.battery != null && !dimmed && <span className="shrink-0 text-xs font-bold text-slate-500">{member.battery}%</span>}
      {onRemove && disconnected && (
        <button type="button" onClick={onRemove} className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
          지우기
        </button>
      )}
      {onRemove && !disconnected && (
        <button type="button" onClick={onRemove} aria-label={`${member.name} 지우기`} className="shrink-0 rounded-full p-2 text-slate-400">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

const HOME_RADIUS_CHOICES = [100, 200, 300, 500];

function HomePlaceBar({
  draft,
  saved,
  canUseSelf,
  onDraft,
  onUseSelf,
  onCancel,
  onSave,
  onClear,
}: {
  draft: HomeZone;
  saved: boolean;
  canUseSelf: boolean;
  onDraft: (home: HomeZone) => void;
  onUseSelf: () => void;
  onCancel: () => void;
  onSave: () => void;
  onClear: () => void;
}) {
  const setRadius = (radiusM: number) => {
    const clamped = Math.min(2000, Math.max(50, Math.round(radiusM) || 50));
    onDraft({ ...draft, radiusM: clamped });
  };
  return (
    <section className="rounded-t-3xl bg-white px-4 pb-3 pt-3 shadow-[0_-8px_30px_rgba(15,23,42,0.08)]">
      <h2 className="text-lg font-black">{saved ? '우리 집 위치' : '우리 집 정하기'}</h2>
      <p className="text-xs leading-5 text-slate-500">지도를 움직여 파란 원 가운데를 집에 맞추세요. 가족이 이 원을 나가면 알림이 남습니다.</p>
      <label className="mt-3 block text-xs font-bold text-slate-400" htmlFor="home-address">
        집 이름
      </label>
      <input
        id="home-address"
        value={draft.address}
        onChange={(event) => {
          const address = event.target.value;
          onDraft({ ...draft, address, label: address.trim() || '우리 집' });
        }}
        placeholder="우리 집"
        className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3 outline-none focus:border-[#0084FF]"
      />
      <p className="mt-3 text-xs font-bold text-slate-400">반경 {draft.radiusM}m</p>
      <div className="mt-2 flex gap-2">
        {HOME_RADIUS_CHOICES.map((radius) => (
          <button
            key={radius}
            type="button"
            onClick={() => setRadius(radius)}
            className={`flex-1 rounded-full py-2 text-xs font-bold ${draft.radiusM === radius ? 'bg-[#0084FF] text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            {radius}m
          </button>
        ))}
      </div>
      <input
        aria-label="집 반경"
        type="range"
        min={50}
        max={2000}
        step={10}
        value={draft.radiusM}
        onChange={(event) => setRadius(Number(event.target.value))}
        className="mt-3 w-full"
      />
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-full bg-slate-100 py-3 text-sm font-bold">
          취소
        </button>
        <button type="button" onClick={onSave} className="flex-[2] rounded-full bg-[#ff8a34] py-3 text-sm font-black text-white">
          이 위치로 저장
        </button>
      </div>
      {canUseSelf && (
        <button type="button" onClick={onUseSelf} className="mt-2 w-full rounded-full bg-slate-100 py-2 text-xs font-bold text-slate-600">
          내 현재 위치로 맞추기
        </button>
      )}
      {saved && (
        <button type="button" onClick={onClear} className="mt-1 w-full py-2 text-sm font-bold text-slate-400">
          우리 집 지우기
        </button>
      )}
    </section>
  );
}

function AdminInviteSheet({
  code,
  writeKey,
  readKey,
  home,
  senderName,
  sharing,
  onAllowShare,
  onClose,
}: {
  code: string;
  writeKey: string;
  readKey: string;
  home: HomeZone | null;
  senderName: string;
  sharing: boolean;
  onAllowShare: () => void;
  onClose: () => void;
}) {
  const [sentName] = useState('가족');
  const [declinedShare, setDeclinedShare] = useState(false);
  const [copied, setCopied] = useState('');
  const [token, setToken] = useState('');
  const [ticket, setTicket] = useState('');
  const [ticketNote, setTicketNote] = useState('');
  const syncReady = familySyncConfigured();

  useEffect(() => {
    let cancel = false;
    syncTokenFor(writeKey, readKey).then((value) => {
      if (!cancel) setToken(value);
    });
    return () => {
      cancel = true;
    };
  }, [readKey, writeKey]);

  useEffect(() => {
    if (!token || !syncReady) return undefined;
    let cancel = false;
    void mintFamilyInvite(code, token, '', true).then((result) => {
      if (cancel) return;
      if (result.ok) setTicket(result.ticket);
      else setTicketNote(result.message);
    });
    return () => {
      cancel = true;
    };
  }, [code, syncReady, token]);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
    } catch {
      setCopied('복사하지 못했습니다');
    }
  };

  if (!sharing && !declinedShare) {
    return (
      <Sheet title="위치 공유 허용" onClose={onClose}>
        <p className="text-sm leading-6 text-slate-600">
          {sentName} 님과 내 위치를 나눌까요? 허용하면 지금 바로 공유가 시작되고, 앱을 다시 열어도 유지됩니다. 나중에를 고르면 내 위치는 나가지 않습니다.
        </p>
        <button
          type="button"
          onClick={onAllowShare}
          className="mt-5 w-full rounded-full bg-[#0084FF] py-3.5 text-base font-black text-white"
        >
          위치 공유 허용
        </button>
        <button type="button" onClick={() => setDeclinedShare(true)} className="mt-2 w-full py-3 text-sm font-bold text-slate-500">
          나중에
        </button>
      </Sheet>
    );
  }

  const groupLink = ticket && token && familySyncUrl()
    ? buildGroupInviteLink(familySyncUrl() || '', code, ticket, token)
    : '';
  const shareKakao = async () => {
    if (!groupLink) return;
    try {
      const sent = await sendFamilyInvite(groupLink);
      if (sent.ok && sent.path === 'chooser') {
        const triedKakao = sent.tried.some((item) => item === 'kakao-share' || item === 'kakao-intent');
        setCopied(triedKakao ? '다른 앱으로 보낼 수 있습니다' : '카카오톡이 없어 다른 앱으로 보냅니다');
        return;
      }
      if (sent.ok) {
        setCopied('카카오톡으로 보냈습니다');
        return;
      }
    } catch {
      /* 보내기가 거절돼도 링크 복사는 남습니다. */
    }
    setCopied('보내지 못했습니다. 링크 복사를 눌러 주세요');
  };

  return (
    <Sheet title="가족 초대 링크" onClose={onClose}>
      <p className="text-sm leading-6 text-slate-500">
        링크를 받은 사람은 지금 가족 전체를 함께 봅니다. 따로 한 사람씩 넣지 않습니다. QR은 가까이 있을 때 씁니다.
        {sharing ? ' 내 위치는 이미 이 가족에게 나가고 있습니다.' : ' 내 위치는 아직 나가지 않습니다.'}
        {' '}전화번호로는 위치를 찾지 않습니다.
      </p>
      <p className="mt-4 text-center text-4xl font-black tracking-[0.25em] text-[#0084FF]">{code}</p>
      <button type="button" disabled={!groupLink} onClick={() => void shareKakao()} className="mt-4 w-full rounded-full bg-[#0084FF] py-3.5 font-bold text-white disabled:opacity-40">
        카카오톡으로 보내기
      </button>
      <button type="button" disabled={!groupLink} onClick={() => copy(groupLink, '링크를 복사했습니다')} className="mt-2 w-full rounded-full bg-slate-100 py-3 text-sm font-bold text-slate-800 disabled:opacity-40">
        링크 복사
      </button>
      {groupLink && <InviteQrImage text={groupLink} />}
      {token && <p className="mt-2 text-center text-[11px] leading-5 text-slate-400">초대 링크는 7일 동안 여러 사람이 쓸 수 있습니다. 방 열쇠는 주소의 # 뒤에만 있어 서버로 전달되지 않습니다. 그룹장이 취소할 수 있습니다.</p>}
      {ticketNote && <p className="mt-2 text-center text-xs leading-5 text-amber-800">{ticketNote}</p>}
      <label className="mt-4 block text-xs font-bold text-slate-400" htmlFor="sync-token">
        동기화 키
      </label>
      <input id="sync-token" readOnly value={token} aria-label="동기화 키" className="mt-1 w-full break-all rounded-2xl border border-slate-200 px-3 py-2 text-[11px] text-slate-600" />
      <button type="button" onClick={() => copy(code, '코드를 복사했습니다')} className="mt-3 w-full rounded-full bg-slate-100 py-2 text-xs font-bold">
        <Copy className="mr-1 inline h-3.5 w-3.5" />
        코드 복사
      </button>
      {token && (
        <button type="button" onClick={() => copy(token, '동기화 키를 복사했습니다')} className="mt-2 w-full rounded-full bg-slate-100 py-2 text-xs font-bold">
          동기화 키 복사
        </button>
      )}
      {copied && <p className="mt-2 text-center text-xs font-semibold text-[#0084FF]">{copied}</p>}
      <p className="mt-4 text-xs leading-5 text-slate-400">
        {syncReady
          ? '링크를 연 폰에서 위치 공유를 허용하면 그 폰의 최신 위치와 배터리가 위치 서버를 통해 이 지도에 나타납니다. 미리 넣어 둔 좌표는 없습니다. 공유를 끄면 핀이 곧 사라집니다. 코드만 입력하면 같은 브라우저에서만 공유됩니다.'
          : '이 빌드에는 위치 서버 주소가 없습니다. 코드는 같은 브라우저 안에서만 공유됩니다.'}
        {' '}
        {home ? `링크에는 집 반경 ${home.radiusM}m가 들어 있습니다. 상대가 위치 공유를 허용한 뒤 그 원을 나가면 관리자 화면에 사이렌이 울립니다.` : '우리 집을 저장한 뒤 링크를 다시 복사하면 집 반경 이탈 사이렌이 연결됩니다.'}
        {' '}위치를 공유한 가족이 이 반경을 나가면 가족 방에 알림이 남습니다. SOS는 같은 방에서 울리고, 알림을 허용하면 앱을 닫아도 옵니다.
      </p>
      {ticket && (
        <button
          type="button"
          onClick={() => {
            void revokeFamilyInvite(ticket).then((result) => {
              setCopied(result.ok ? '초대를 취소했습니다' : result.message);
              if (result.ok) setTicket('');
            });
          }}
          className="mt-2 w-full py-2 text-xs font-bold text-slate-400"
        >
          초대 링크 취소
        </button>
      )}
      <button type="button" onClick={onClose} className="mt-4 w-full rounded-full bg-slate-100 py-3.5 font-bold text-slate-800">
        완료
      </button>
    </Sheet>
  );
}

function parseInviteDraft(value: string): { code: string; syncToken: string | null; ticket: string | null; rosterName: string | null; adminName: string | null } {
  const trimmed = value.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('kinnex://')) {
    try {
      const url = new URL(trimmed);
      const code = (url.searchParams.get('invite') || url.searchParams.get('code') || '').replace(/\D/g, '').slice(0, 6);
      const queryToken = splitSyncToken(url.searchParams.get('sync')) ? url.searchParams.get('sync') : null;
      const syncToken = syncTokenFromInviteFragment(url.hash) || parseInviteUrl(trimmed)?.syncToken || queryToken;
      const ticket = (url.searchParams.get('ticket') || '').trim() || null;
      const rosterName = (url.searchParams.get('who') || '').trim().slice(0, 80) || null;
      const adminName = (url.searchParams.get('from') || '').trim().slice(0, 20) || null;
      return { code, syncToken, ticket, rosterName, adminName };
    } catch {
      /* 링크가 아니면 코드로 봅니다. */
    }
  }
  return { code: trimmed.replace(/\D/g, '').slice(0, 6), syncToken: null, ticket: null, rosterName: null, adminName: null };
}

function ManagedInviteSheet({
  pending,
  pendingSyncToken,
  guardians,
  alreadySharing,
  onClose,
  onAccept,
  onShare,
}: {
  pending: string | null;
  pendingSyncToken: string | null;
  guardians: GuardianLink[];
  alreadySharing: boolean;
  onClose: () => void;
  onAccept: (label: string, code: string, syncToken: string | null, rosterName: string | null, adminName: string | null, ownerMemberId?: string | null) => void;
  onShare: () => void;
}) {
  const [code, setCode] = useState(pending ?? '');
  const [syncToken, setSyncToken] = useState(pendingSyncToken ?? '');
  const [rosterName, setRosterName] = useState(() => new URLSearchParams(window.location.search).get('who')?.trim().slice(0, 80) ?? '');
  const [adminName, setAdminName] = useState(() => new URLSearchParams(window.location.search).get('from')?.trim().slice(0, 20) ?? '');
  const [label, setLabel] = useState('');
  const [step, setStep] = useState<'join' | 'share'>('join');
  const [joinedCode, setJoinedCode] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [ownerMemberId, setOwnerMemberId] = useState('');
  const joined = guardians.find((link) => link.code === joinedCode);

  const applyParsed = (parsed: ReturnType<typeof parseInviteDraft>) => {
    if (parsed.code) setCode(parsed.code);
    if (parsed.syncToken) setSyncToken(parsed.syncToken);
    if (parsed.rosterName) setRosterName(parsed.rosterName);
    if (parsed.adminName) setAdminName(parsed.adminName);
    if (!parsed.ticket) return;
    void redeemFamilyInvite(parsed.ticket).then((result) => {
      if (!result.ok) {
        setInviteNote(result.message);
        return;
      }
      setCode(result.code);
      if (result.syncToken) setSyncToken(result.syncToken);
      if (result.ownerMemberId) setOwnerMemberId(result.ownerMemberId);
      setInviteNote('');
    });
  };

  const redeemedTicket = useRef('');
  useEffect(() => {
    let stored = '';
    try {
      stored = sessionStorage.getItem('umap_invite_url') || '';
      if (stored) sessionStorage.removeItem('umap_invite_url');
    } catch {
      stored = '';
    }
    if (stored) applyParsed(parseInviteDraft(stored));
    const ticket = new URLSearchParams(window.location.search).get('ticket');
    if (!ticket || redeemedTicket.current === ticket) return;
    redeemedTicket.current = ticket;
    applyParsed({ code: pending ?? '', syncToken: null, ticket, rosterName: null, adminName: null });
  }, [pending]);

  return (
    <Sheet title={step === 'join' ? '1. 초대를 수락할까요?' : '2. 위치를 공유할까요?'} onClose={onClose}>
      {step === 'join' ? (
        <>
          <p className="text-sm leading-6 text-slate-500">관리자에게 받은 코드를 입력하거나 초대 링크를 붙여 넣습니다. 링크는 한 번만 쓸 수 있습니다. 수락만으로는 위치가 나가지 않습니다. 전화번호는 쓰지 않습니다.</p>
          {inviteNote && <p className="mt-2 text-xs leading-5 text-amber-800">{inviteNote}</p>}
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="가족 이름 (예: 엄마)" className="mt-4 w-full rounded-2xl border border-slate-200 px-3 py-3 outline-none focus:border-[#0084FF]" />
          <input
            value={code}
            onChange={(event) => {
              const next = event.target.value;
              if (next.trim().startsWith('http://') || next.trim().startsWith('https://') || next.trim().startsWith('kinnex://')) {
                applyParsed(parseInviteDraft(next));
                return;
              }
              setCode(next.replace(/\D/g, '').slice(0, 6));
            }}
            placeholder="초대 코드 또는 링크"
            inputMode="text"
            className="mt-2 w-full rounded-2xl border border-slate-200 px-3 py-3 outline-none focus:border-[#0084FF]"
          />
          <InviteQrScan
            onText={(value) => {
              applyParsed(parseInviteDraft(value));
            }}
          />
          <label className="mt-3 block text-xs font-bold text-slate-400" htmlFor="managed-sync-token">
            동기화 키 (다른 폰과 나눌 때)
          </label>
          <input
            id="managed-sync-token"
            value={syncToken}
            onChange={(event) => setSyncToken(event.target.value.trim())}
            placeholder="링크를 열면 채워집니다"
            className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-[#0084FF]"
          />
          <button
            type="button"
            disabled={code.length < 4}
            onClick={() => {
              const token = splitSyncToken(syncToken) ? syncToken : null;
              onAccept(label, code, token, rosterName.trim() || null, adminName.trim() || null, ownerMemberId || null);
              if (alreadySharing) {
                onClose();
                return;
              }
              setJoinedCode(code);
              setStep('share');
            }}
            className="mt-3 w-full rounded-full bg-[#ff8a34] py-3.5 font-bold text-white disabled:opacity-40"
          >
            초대 수락
          </button>
        </>
      ) : (
        <>
          <p className="text-sm leading-6 text-slate-600">
            {label.trim() || '가족'} 님과 내 위치를 나눌까요? 허용하면 지금 바로 공유가 시작되고, 앱을 다시 열어도 유지됩니다. 나중에를 고르면 이 연결은 아직 내 위치를 받지 않습니다. 가족 목록에서 다시 허용할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={() => {
              if (!joined) return;
              onShare();
              onClose();
            }}
            disabled={!joined}
            className="mt-4 w-full rounded-full bg-[#0084FF] py-3.5 font-bold text-white disabled:opacity-40"
          >
            위치 공유 허용
          </button>
          <button type="button" onClick={onClose} className="mt-2 w-full py-3 text-sm font-bold text-slate-500">
            나중에
          </button>
        </>
      )}
    </Sheet>
  );
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
  danger = false,
  busy = false,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Sheet title={title} onClose={onClose}>
      <p className="text-sm leading-6 text-slate-500">{body}</p>
      <button
        type="button"
        disabled={busy}
        onClick={onConfirm}
        className={`mt-4 w-full rounded-full py-3.5 font-bold text-white disabled:opacity-40 ${danger ? 'bg-red-600' : 'bg-[#ff8a34]'}`}
      >
        {busy ? '처리 중…' : confirmLabel}
      </button>
      <button type="button" disabled={busy} onClick={onClose} className="mt-2 w-full py-2 text-sm font-bold text-slate-400">
        취소
      </button>
    </Sheet>
  );
}

function KeepNoticeSheet({
  mode,
  busy,
  note,
  onPrimary,
  onLater,
}: {
  mode: 'permission' | 'start';
  busy: boolean;
  note: string | null;
  onPrimary: () => void;
  onLater: () => void;
}) {
  return (
    <div className="absolute inset-0 z-[60] flex items-end bg-slate-900/40">
      <div className="w-full rounded-t-3xl bg-white px-5 pb-8 pt-5">
        <h2 className="text-lg font-black">{mode === 'permission' ? '알림을 허용할까요?' : '위치 유지를 켤까요?'}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          {mode === 'permission'
            ? '알림 권한은 SOS, 집 반경, 움직임 시작·멈춤, 새 대화에 씁니다. 허용을 누르면 알림 창이 열립니다. 위치 공유 중에는 알림 목록에 Kinnex 카드가 나오지 않습니다. 앱이 혼자 켜지 않습니다. 전화번호는 쓰지 않습니다.'
            : '켜면 앱을 닫아도 위치를 기록합니다. 걷는 동안은 2초, 차나 자전거는 1초마다 받습니다. 머무는 동안은 20초마다 움직임만 확인하고 점은 남기지 않습니다. 가족에게는 이동 중 30초, 머무는 중 60초마다 묶어서 보냅니다. 알림 목록에 위치 유지 카드가 남습니다. 삼성 절전 앱·수면 중 앱에서는 Kinnex를 제외해 주세요. 배터리 제한 없음도 켜 주세요. 앱이 혼자 켜지 않습니다.'}
        </p>
        {note && <p className="mt-3 text-sm leading-6 text-amber-800">{note}</p>}
        <button type="button" disabled={busy} onClick={onPrimary} className="mt-4 w-full rounded-full bg-[#0084FF] py-3.5 font-bold text-white disabled:opacity-40">
          {busy ? '확인 중…' : mode === 'permission' ? '알림 허용' : '위치 유지 켜기'}
        </button>
        <button type="button" disabled={busy} onClick={onLater} className="mt-2 w-full py-2 text-sm font-bold text-slate-400">
          나중에
        </button>
      </div>
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-50 flex items-end bg-slate-900/40">
      <div className="max-h-[86%] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pb-8 pt-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-black">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400" aria-label="닫기">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RoundButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-md">
      {children}
    </button>
  );
}

function LocationConsentRow() {
  const family = useFamily();
  const withdrawn = family.state.locationConsent === false;
  return (
    <section className="mt-4" aria-label="개인위치정보 이용 동의">
      <h3 className="text-sm font-black text-slate-800">개인위치정보 이용 동의</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        {withdrawn ? '동의를 철회해 이 폰의 위치 수집을 멈췄습니다.' : '가족 지도와 이동 기록에 이 폰의 위치를 씁니다.'}
        {' '}
        <a className="font-bold text-[#0084FF]" href="/location-terms.html">약관 보기</a>
      </p>
      {!withdrawn && (
        <button type="button" onClick={() => family.withdrawLocationConsent()} className="mt-2 text-xs font-bold text-red-600">
          동의 철회
        </button>
      )}
    </section>
  );
}

function AppVersionLine() {
  return (
    <div className="mt-2">
      <p className="text-xs font-semibold text-slate-500">{currentAppVersionLabel()}</p>
      <button type="button" onClick={() => openAppUpdate()} className="mt-2 w-full rounded-full bg-slate-100 py-3 text-sm font-bold text-slate-800">
        앱 업데이트
      </button>
      <p className="mt-1 text-xs leading-5 text-slate-400">원할 때 최신 설치 파일을 브라우저에서 받습니다.</p>
    </div>
  );
}

function DiagSendButton() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="mt-4 rounded-2xl bg-slate-50 px-3 py-3">
      <p className="text-sm font-black text-slate-900">진단 기록 보내기</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-slate-500">최근 2시간의 위치·궤적 판단을 개발자에게 바로 보냅니다. 좌표가 포함되고 7일 뒤 지워집니다. 가족 위치와 기록 암호화는 그대로입니다.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setNote('');
          void import('../../services/familyAccount').then(({ uploadDiagReport }) => uploadDiagReport()).then((result) => {
            if (result.ok && result.id) {
              setNote('보냈습니다');
              return;
            }
            setNote(result.message || '올리지 못했습니다.');
          }).finally(() => setBusy(false));
        }}
        className="mt-2 w-full rounded-full bg-slate-900 py-3 text-sm font-bold text-white disabled:opacity-60"
      >
        {busy ? '올리는 중…' : '진단 기록 보내기'}
      </button>
      {note && <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">{note}</p>}
    </div>
  );
}

const DISCLOSURE_LABEL: Record<DisclosureRecord['categories'][number], string> = {
  name: '표시 이름',
  kakao: '카카오 계정',
  naver: '네이버 계정',
  family: '가족 구성',
  device: '기기 정보',
  account: '계정·복구 정보',
  location: '위치',
  history: '기록',
  place: '장소 이름',
  other: '기타 개인정보',
};

function disclosureCategoryLine(row: DisclosureRecord): string {
  return row.categories.map((category) => (
    category === 'other' && row.detail ? `기타 개인정보(${row.detail})` : DISCLOSURE_LABEL[category]
  )).join(', ');
}

function formatDisclosureWhen(ms: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

function handlingLine(event: HandlingEvent): string {
  if (event.kind === 'collect') return event.categories.includes('history') ? '수집 · 이동 기록을 올렸습니다' : '수집 · 위치를 올렸습니다';
  return `이용 · ${event.actor} 님이 위치를 확인했습니다`;
}

function DisclosureLogPanel() {
  const [rows, setRows] = useState<DisclosureRecord[] | null>(null);
  const [events, setEvents] = useState<HandlingEvent[] | null>(null);
  const [intact, setIntact] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadOwnDisclosures().then((result) => {
      if (!live) return;
      setRows(result.disclosures);
      setIntact(result.intact);
      setMessage(result.ok ? null : (result.message || '제공 기록을 불러오지 못했습니다.'));
    });
    void loadOwnHandling().then((result) => {
      if (!live) return;
      setEvents(result.events);
      if (!result.ok && result.message) setMessage(result.message);
    });
    return () => {
      live = false;
    };
  }, []);
  const empty = rows !== null && events !== null && rows.length === 0 && events.length === 0 && !message;
  return (
    <section className="mt-4" aria-label="위치정보 이용·제공 기록">
      <h3 className="text-sm font-black text-slate-800">위치정보 이용·제공 기록</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        위치를 올리거나 가족이 확인한 사실, 제3자에게 넘긴 종류의 기록입니다. 표시 이름, 카카오·네이버 계정, 가족 구성, 기기, 계정·복구 정보, 위치, 기록, 장소 이름이 적힐 수 있습니다. 그 값과 좌표는 적지 않습니다. 올린 날부터 6개월 뒤 지우고, 회원 탈퇴 후에도 그 기간이 끝날 때까지 남습니다.
      </p>
      {rows === null && <p className="mt-3 text-xs leading-5 text-slate-500">불러오는 중</p>}
      {rows !== null && message && <p className="mt-3 text-xs leading-5 text-slate-500">{message}</p>}
      {empty && (
        <p className="mt-3 text-xs leading-5 text-slate-500">제3자에게 개인정보나 위치, 기록을 제공한 내역이 없습니다.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="mt-3 space-y-2">
          {events.map((event, index) => (
            <li key={`${event.at}-${event.kind}-${index}`} className="rounded-2xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              <p className="font-bold text-slate-800">{handlingLine(event)}</p>
              <p>{formatDisclosureWhen(event.at)}</p>
            </li>
          ))}
        </ul>
      )}
      {rows !== null && !message && !intact && (
        <p className="mt-3 text-xs leading-5 text-amber-800">이 기록의 연결이 맞지 않습니다.</p>
      )}
      {rows !== null && !message && rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li key={`${row.at}-${row.categories.join('-')}-${index}`} className="rounded-2xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              <p className="font-bold text-slate-800">{disclosureCategoryLine(row)} · {formatDisclosureWhen(row.rangeStart)} – {formatDisclosureWhen(row.rangeEnd)}</p>
              <p>받는 곳 {row.recipient}</p>
              <p>이유 {row.purpose}</p>
              <p>처리 {row.actor} · {formatDisclosureWhen(row.at)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecoveryCodePanel() {
  const family = useFamily();
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [linkDetail, setLinkDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState(() => readStoredAccountLinks(typeof localStorage === 'undefined' ? null : localStorage));
  const [kakaoMerge, setKakaoMerge] = useState<{ accessToken: string; snapshot: AccountSnapshot | null } | null>(null);
  const code = readStoredRecoveryCode(typeof localStorage === 'undefined' ? null : localStorage);
  const kakaoKey = configuredKakaoLoginKey();
  const naverId = configuredNaverClientId();

  const prepareLinkSnapshot = async (): Promise<AccountSnapshot | null> => {
    const snapshot = snapshotFromSession(family.state);
    const key = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage);
    if (snapshot && !key) {
      const saved = await backupFamilyAccount(snapshot).catch(() => ({ ok: false as const }));
      if (saved.ok && saved.account) {
        await persistAccountResult(saved);
        return {
          ...snapshot,
          ...saved.account,
          profile: saved.account.profile || snapshot.profile,
          room: saved.account.room || snapshot.room,
        };
      }
    }
    return snapshot;
  };

  const linkProvider = (
    start: (snapshot: AccountSnapshot | null) => Promise<{ ok: boolean; snapshot?: AccountSnapshot; message?: string; detail?: string; conflict?: boolean; accessToken?: string }>,
    setup: string,
    configured: string,
    missing: string,
  ) => {
    if (!configured) {
      setNote(setup);
      return;
    }
    setBusy(true);
    setNote(null);
    setLinkDetail(null);
    void prepareLinkSnapshot().then(async (snapshot) => ({ snapshot, result: await start(snapshot) })).then(({ snapshot, result }) => {
      setBusy(false);
      if (!result.ok) {
        if (result.conflict && result.accessToken) {
          setKakaoMerge({ accessToken: result.accessToken, snapshot });
          return;
        }
        setNote(result.message || missing);
        setLinkDetail(result.detail || null);
        return;
      }
      if (linkedAccountWouldSwitch(family.state.profile?.id, result.snapshot)) {
        setNote(ACCOUNT_LINKED_OTHER_MESSAGE);
        return;
      }
      if (result.snapshot) rememberAccountSecrets(localStorage, result.snapshot);
      setLinks(readStoredAccountLinks(localStorage));
      setNote('이 계정에 연결했습니다. 다시 설치한 뒤에도 같은 사람으로 돌아옵니다.');
    }).catch(() => {
      setBusy(false);
      setNote(missing);
    });
  };

  return (
    <section className="mt-4" aria-label="계정 연결">
      <h3 className="text-sm font-black text-slate-800">계정 연결</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">
        카카오, 네이버, 복구 코드를 이 계정에 연결합니다. 다시 설치한 뒤 어느 방법으로 들어와도 같은 사람, 가족, 기록으로 돌아갑니다.
      </p>
      {code ? (
        <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold text-slate-500">복구 코드</p>
            <p className="text-xs font-bold text-slate-700">연결됨</p>
          </div>
          <p className="mt-1 font-mono text-base font-black tracking-[0.18em] text-slate-800">{code}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">앱을 다시 설치한 뒤 「복구 코드로 불러오기」에 넣으면 같은 사람과 가족 방으로 돌아갑니다.</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }).catch(() => undefined);
            }}
            className="mt-2 text-xs font-bold text-[#0084FF]"
          >
            {copied ? '복사했습니다' : '코드 복사'}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          복구 코드는 이 폰이 서버에 계정을 만든 뒤 여기에 나타납니다. 연결되면 「연결됨」으로 보입니다.
        </p>
      )}
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <p className="text-xs font-bold text-slate-500">카카오</p>
          <p className="text-xs font-bold text-slate-700">{links.kakao ? '연결됨' : '연결 안 됨'}</p>
        </div>
        <button
          type="button"
          disabled={busy || !kakaoKey}
          onClick={() => linkProvider((snapshot) => signInWithKakao(snapshot, { persist: true, mode: 'link' }), KAKAO_SETUP_MESSAGE, kakaoKey, ACCOUNT_UNLINKED_MESSAGE)}
          className="w-full rounded-full bg-[#FEE500] py-2.5 text-xs font-bold text-[#191919] disabled:opacity-40"
        >
          카카오 연결
        </button>
        <div className="flex items-center justify-between gap-3 px-1 pt-1">
          <p className="text-xs font-bold text-slate-500">네이버</p>
          <p className="text-xs font-bold text-slate-700">{links.naver ? '연결됨' : '연결 안 됨'}</p>
        </div>
        <button
          type="button"
          disabled={busy || !naverId}
          onClick={() => linkProvider((snapshot) => signInWithNaver(snapshot, { persist: true, mode: 'link' }), NAVER_SETUP_MESSAGE, naverId, ACCOUNT_UNLINKED_MESSAGE)}
          className="w-full rounded-full bg-[#03C75A] py-2.5 text-xs font-bold text-white disabled:opacity-40"
        >
          네이버 연결
        </button>
      </div>
      {note && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-slate-600">{note}</p>}
      {linkDetail && <p className="mt-1 text-xs leading-5 text-slate-400">{linkDetail}</p>}
      {kakaoMerge && (
        <KakaoMergeSheet
          busy={busy}
          onCancel={() => {
            setKakaoMerge(null);
            setNote('카카오 연결을 취소했습니다. 이 폰의 지도는 그대로입니다.');
          }}
          onMerge={() => {
            const pendingMerge = kakaoMerge;
            setBusy(true);
            void linkKakaoAccount(pendingMerge.accessToken, pendingMerge.snapshot, 'link', true).then(async (linked) => {
              setBusy(false);
              if (!linked.ok || !linked.account) {
                setNote(linked.message || '기존 계정을 가져오지 못했습니다. 카카오 로그인을 다시 해 주세요.');
                return;
              }
              setKakaoMerge(null);
              rememberAccountSecrets(localStorage, linked.account);
              setLinks(readStoredAccountLinks(localStorage));
              const opened = await openAccountSecrets(linked.account, localStorage);
              setNote('기존 계정의 가족 방을 이 계정으로 가져왔습니다. 카카오 로그인은 이제 이 계정입니다. 암호화된 지난 기록은 가족 폰이 열쇠를 다시 감쌀 때까지 열리지 않을 수 있습니다.');
              family.restoreAccount(opened);
            }).catch(() => {
              setBusy(false);
              setNote('기존 계정을 가져오지 못했습니다. 위치 서버에 다시 연결해 주세요.');
            });
          }}
        />
      )}
    </section>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{k}</dt>
      <dd className="font-semibold text-slate-800">{v}</dd>
    </div>
  );
}

function labelOf(value: string): string {
  if (value === 'granted') return '허용';
  if (value === 'denied') return '허용 안 함';
  if (value === 'skipped') return '건너뜀';
  if (value === 'acknowledged') return '확인함';
  return '아직 없음';
}

function locationLabel(value: string): string {
  if (value === 'while-using') return '앱 사용 중에만';
  if (value === 'always') return '항상 허용(선호 저장)';
  if (value === 'denied') return '허용 안 함';
  return '아직 없음';
}

