import React, { useEffect, useRef, useState } from 'react';
import { Bell, BatteryCharging, ChevronLeft, Footprints, MapPin, Shield } from 'lucide-react';
import { localProfile } from '../../lib/localProfile.mjs';
import { accountNeedsDisplayName, clearStoredAccount, readStoredAccountKey, snapshotFromSession } from '../../lib/accountRestore.mjs';
import { openAccountSecrets } from '../../lib/familyVault.mjs';
import { KAKAO_SETUP_MESSAGE } from '../../lib/kakaoAuth.mjs';
import { NAVER_SETUP_MESSAGE } from '../../lib/naverAuth.mjs';
import { backupFamilyAccount, persistAccountResult, recoverFamilyAccount, type AccountSnapshot } from '../../services/familyAccount';
import { configuredKakaoLoginKey, signInWithKakao } from '../../services/kakaoSignIn';
import { configuredNaverClientId, signInWithNaver } from '../../services/naverSignIn';
import { KEEP_PERMISSION_ASKED_KEY, markSessionFlag } from '../../lib/systemSettings.mjs';
import { askAlwaysLocation, askBattery, askMotion, askNotifications, askWhileUsing } from '../../services/systemPermissions';
import { overlayPermissionGranted, umapLocationNative } from '../../services/umapLocation';
import { AlwaysAllowGuide } from './AlwaysAllowGuide';
import { AlwaysAllowSetup } from './AlwaysAllowSetup';
import { REQUIRED_TERMS, type PermissionState, type Profile } from '../../types/family';
import { useFamily } from './session';

const iconSrc = `${import.meta.env.BASE_URL}umap-icon.png`;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full justify-center bg-[#d7e3ee]">
      <div className="flex h-full w-full max-w-[430px] flex-col bg-[#f7f9fc] text-slate-900">{children}</div>
    </div>
  );
}

export function Onboarding() {
  const family = useFamily();
  const { stage } = family.state;

  return (
    <Shell>
      {stage === 'splash' && <Splash onDone={family.splashDone} />}
      {stage === 'login' && <Login onSubmit={family.login} />}
      {stage === 'survey' && (
        <Survey onSkip={family.skipSurvey} onNext={family.pickSurvey} onBack={family.back} />
      )}
      {stage === 'terms' && (
        <Terms
          terms={family.state.terms}
          onToggle={family.toggleTerm}
          onToggleAll={family.toggleAllTerms}
          onNext={family.continueTerms}
          onBack={family.back}
        />
      )}
      {stage === 'permissions' && (
        <Permissions
          initial={family.state.permissions}
          canClose={family.state.permissions.completed}
          onClose={() => family.finishPermissions(family.state.permissions)}
          onBack={family.back}
          onDone={family.finishPermissions}
        />
      )}
    </Shell>
  );
}

function Splash({ onDone }: { onDone: () => void }) {
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });
  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), 1400);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <button type="button" onClick={onDone} className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
      <img src={iconSrc} alt="" className="h-28 w-28 rounded-[28px] shadow-lg" />
      <div>
        <p className="text-3xl font-black tracking-tight">Kinnex</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">동의한 가족의 위치를 함께 봅니다.</p>
      </div>
      <p className="text-xs text-slate-400">화면을 누르면 바로 시작합니다.</p>
    </button>
  );
}

function Login({ onSubmit }: { onSubmit: (profile: Profile) => void }) {
  const family = useFamily();
  const [step, setStep] = useState<'choose' | 'name'>('choose');
  const [pending, setPending] = useState<AccountSnapshot | null>(null);
  const [name, setName] = useState('');
  const [recovery, setRecovery] = useState('');
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const kakaoKey = configuredKakaoLoginKey();
  const naverId = configuredNaverClientId();

  const openName = (account: AccountSnapshot | null) => {
    setPending(account);
    const existing = account?.profile?.name?.trim() || '';
    setName(existing === '가족' ? '' : existing);
    setStep('name');
    setMessage(null);
            setDetail(null);
    setBusy(false);
  };

  const providerCall = () => {
    const key = readStoredAccountKey(typeof localStorage === 'undefined' ? null : localStorage);
    const mode = family.state.profile || key ? 'link' as const : 'login' as const;
    const snapshot = mode === 'link' ? snapshotFromSession(family.state) : null;
    return { snapshot, mode };
  };

  const finishAccount = (account: AccountSnapshot, typedCode = '') => {
    void openAccountSecrets(account, typeof localStorage === 'undefined' ? null : localStorage, typedCode).then((opened) => {
      if (accountNeedsDisplayName(opened)) {
        openName(opened);
        return;
      }
      family.restoreAccount(opened);
    });
  };

  const finishProvider = (
    result: { ok: boolean; snapshot?: AccountSnapshot; message?: string; detail?: string; restored?: boolean },
    fallback: string,
  ) => {
    setBusy(false);
    if (!result.ok || !result.snapshot) {
      setMessage(result.message || fallback);
      setDetail(result.detail || null);
      return;
    }
    setDetail(null);
    finishAccount({ ...result.snapshot, restored: result.restored === true });
  };

  if (step === 'name') {
    const trimmed = name.trim();
    return (
      <div className="flex h-full flex-col px-6 pb-10 pt-8">
        <button
          type="button"
          onClick={() => {
            setStep('choose');
            setMessage(null);
            setDetail(null);
          }}
          className="self-start p-2 text-slate-500"
          aria-label="이전"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="mt-4 text-[28px] font-black leading-tight">가족 지도에 보일 이름</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          이 이름으로 가족에게 보입니다. 전화번호는 쓰지 않습니다.
        </p>
        <form
          className="mt-8"
          onSubmit={(event) => {
            event.preventDefault();
            const profile = localProfile(trimmed);
            if (!profile) {
              setMessage('전화번호는 이름으로 쓰지 않습니다. 가족에게 보일 이름을 적어 주세요.');
              return;
            }
            if (!pending) {
              onSubmit(profile);
              return;
            }
            setBusy(true);
            const next: AccountSnapshot = {
              ...pending,
              profile: { ...pending.profile, name: profile.name },
              nameChosen: true,
            };
            void backupFamilyAccount(next).then(async (saved) => {
              if (saved.ok && saved.account) await persistAccountResult(saved);
              const merged = {
                ...next,
                ...(saved.account || {}),
                profile: { name: profile.name, photo: saved.account?.profile?.photo ?? pending.profile?.photo ?? null },
              };
              const opened = await openAccountSecrets(merged, localStorage);
              family.restoreAccount(opened);
            }).catch(() => {
              family.restoreAccount(next);
            });
          }}
        >
          <label className="block text-xs font-bold text-slate-400" htmlFor="local-name">
            표시 이름
          </label>
          <input
            id="local-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setMessage(null);
            setDetail(null);
            }}
            placeholder="이름"
            maxLength={20}
            autoComplete="nickname"
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 outline-none focus:border-[#0084FF]"
          />
          <button
            type="submit"
            disabled={busy || trimmed.length < 1}
            className="mt-4 w-full rounded-full bg-[#0084FF] py-3.5 text-sm font-bold text-white disabled:opacity-40"
          >
            다음
          </button>
        </form>
        {message && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{message}</p>}
        {detail && <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-6 pb-10 pt-16">
      <img src={iconSrc} alt="" className="h-16 w-16 rounded-2xl shadow-md" />
      <h1 className="mt-6 text-[28px] font-black leading-tight">로그인</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        카카오, 네이버, 복구 코드로 같은 사람과 가족, 기록을 불러옵니다. 처음이면 새로 시작합니다. 전화번호는 쓰지 않습니다.
      </p>
      <button
        type="button"
        disabled={busy || !kakaoKey}
        onClick={() => {
          if (!kakaoKey) {
            setMessage(KAKAO_SETUP_MESSAGE);
            return;
          }
          setBusy(true);
          setMessage(null);
            setDetail(null);
          const call = providerCall();
          void signInWithKakao(call.snapshot, { mode: call.mode, persist: true }).then((result) => {
            finishProvider(result, '카카오 로그인을 마치지 못했습니다. 이 상태로 시작하지 않습니다.');
          });
        }}
        className="mt-6 w-full rounded-full bg-[#FEE500] py-3.5 text-sm font-bold text-[#191919] disabled:opacity-40"
      >
        {busy ? '카카오 확인 중' : '카카오로 로그인'}
      </button>
      {!kakaoKey && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{KAKAO_SETUP_MESSAGE}</p>}
      <button
        type="button"
        disabled={busy || !naverId}
        onClick={() => {
          if (!naverId) {
            setMessage(NAVER_SETUP_MESSAGE);
            return;
          }
          setBusy(true);
          setMessage(null);
            setDetail(null);
          const call = providerCall();
          void signInWithNaver(call.snapshot, { mode: call.mode, persist: true }).then((result) => {
            finishProvider(result, '네이버 로그인을 마치지 못했습니다. 이 상태로 시작하지 않습니다.');
          });
        }}
        className="mt-3 w-full rounded-full bg-[#03C75A] py-3.5 text-sm font-bold text-white disabled:opacity-40"
      >
        {busy ? '네이버 확인 중' : '네이버로 로그인'}
      </button>
      {!naverId && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{NAVER_SETUP_MESSAGE}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setRecoverOpen((open) => !open);
          setMessage(null);
            setDetail(null);
        }}
        className="mt-3 w-full rounded-full bg-slate-100 py-3 text-sm font-bold text-slate-700 disabled:opacity-40"
      >
        복구 코드로 불러오기
      </button>
      {recoverOpen && (
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setMessage(null);
            setDetail(null);
            void recoverFamilyAccount(recovery).then((result) => {
              setBusy(false);
              if (!result.ok || !result.account) {
                setMessage(result.message || '복구 코드를 확인하지 못했습니다. 코드를 다시 입력해 주세요.');
                return;
              }
              void persistAccountResult(result);
              finishAccount({ ...result.account, restored: result.restored === true }, recovery);
            }).catch(() => {
              setBusy(false);
              setMessage('복구 코드를 확인하지 못했습니다. 위치 서버에 다시 연결해 주세요.');
            });
          }}
        >
          <label className="block text-xs font-bold text-slate-400" htmlFor="recovery-code">
            복구 코드
          </label>
          <input
            id="recovery-code"
            value={recovery}
            onChange={(event) => setRecovery(event.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="one-time-code"
            className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 tracking-[0.2em] outline-none focus:border-[#0084FF]"
          />
          <button type="submit" disabled={busy || recovery.trim().length < 12} className="mt-3 w-full rounded-full bg-[#0084FF] py-3 text-sm font-bold text-white disabled:opacity-40">
            이 사람으로 불러오기
          </button>
        </form>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          clearStoredAccount(typeof localStorage === 'undefined' ? null : localStorage);
          setPending(null);
          setName('');
          setRecoverOpen(false);
          setStep('name');
          setMessage(null);
            setDetail(null);
        }}
        className="mt-3 w-full rounded-full py-3 text-sm font-bold text-slate-500 disabled:opacity-40"
      >
        새로 시작
      </button>
      {message && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-600">{message}</p>}
      {detail && <p className="mt-1 text-xs leading-5 text-slate-400">{detail}</p>}
    </div>
  );
}

const INTERESTS = [
  { id: 'live', title: '가족의 실시간 위치' },
  { id: 'home', title: '집에 들어오고 나갈 때 알림' },
  { id: 'commute', title: '등원·하원처럼 도착을 확인하고 싶어요' },
];

function Survey({ onSkip, onNext, onBack }: { onSkip: () => void; onNext: (id: string) => void; onBack: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between px-4 pt-4">
        <button type="button" onClick={onBack} className="p-2 text-slate-500" aria-label="이전">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button type="button" onClick={onSkip} className="px-2 text-sm font-semibold text-slate-500">
          건너뛰기
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <h1 className="mt-6 text-[26px] font-black leading-snug">어떤 안심이 가장 필요하세요?</h1>
        <p className="mt-2 text-sm text-slate-500">위치 공유에 쓰는 선택입니다. 건너뛰어도 됩니다.</p>
        <div className="mt-8 space-y-3">
          {INTERESTS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPicked(item.id)}
              className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-4 text-left ${
                picked === item.id ? 'border-[#0084FF] bg-blue-50' : 'border-slate-200'
              }`}
            >
              <span className={`h-5 w-5 rounded-full border-2 ${picked === item.id ? 'border-[#0084FF] bg-[#0084FF]' : 'border-slate-300'}`} />
              <span className="font-semibold">{item.title}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="px-6 pb-8">
        <button
          type="button"
          disabled={!picked}
          onClick={() => picked && onNext(picked)}
          className="w-full rounded-full bg-[#ff8a34] py-3.5 text-base font-bold text-white disabled:opacity-40"
        >
          다음
        </button>
      </div>
    </div>
  );
}

const TERM_COPY: { id: string; title: string; required: boolean; body: string }[] = [
  {
    id: 'terms',
    title: '이용약관 동의',
    required: true,
    body: 'Kinnex은 초대한 가족의 위치를 나누는 앱입니다. 동의하지 않은 사람을 찾거나, 주변 소리와 메시지를 읽지 않습니다.',
  },
  {
    id: 'location',
    title: '위치기반서비스 이용약관 동의',
    required: true,
    body: '가족 지도, 우리 집 안심존, 들어오고 나간 알림, 이 기기에 남기는 이동 경로에 위치를 사용합니다. 최근 30일 여정·방문은 다시 설치해도 찾을 수 있게 가족 서버 계정에 백업합니다.',
  },
  {
    id: 'locationUse',
    title: '개인위치정보 이용 동의',
    required: true,
    body: '내 위치 수집과 가족에게 보여주는 이용에 동의합니다. 설정에서 철회하면 수집이 멈춥니다.',
  },
  {
    id: 'privacy',
    title: '개인정보 수집·이용 동의',
    required: true,
    body: '표시 이름과 가족 방 키는 계정에 둡니다. 최근 30일 여정·방문과 장소 이름은 이 기기에서 암호화해 서버에는 암호문만 둡니다. 전화번호는 받지 않습니다. 지난 기록을 다시 열려면 복구 코드가 필요합니다.',
  },
  {
    id: 'guardian',
    title: '만 14세 미만 법정대리인 정보 수집 동의',
    required: true,
    body: '아이의 위치를 보려면 보호자가 초대하고, 아이 기기도 Kinnex에서 위치 공유에 동의해야 합니다.',
  },
  {
    id: 'marketing',
    title: '마케팅 목적 개인정보 수집·이용 동의',
    required: false,
    body: '제품 소식을 보내는 선택입니다. 거절해도 위치 공유는 사용할 수 있습니다.',
  },
  {
    id: 'overseas',
    title: '개인정보 국외 이전 동의',
    required: false,
    body: '카카오·네이버로 로그인하면 계정 확인에 그 서비스를 사용합니다. 지도 타일은 국토교통부 VWorld에서 불러옵니다.',
  },
];

function Terms({
  terms,
  onToggle,
  onToggleAll,
  onNext,
  onBack,
}: {
  terms: Record<string, boolean>;
  onToggle: (id: string, value: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const allOn = Object.values(terms).every(Boolean);
  const ready = REQUIRED_TERMS.every((id) => terms[id]);
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center px-2 pt-3">
        <button type="button" onClick={onBack} className="p-2 text-slate-500" aria-label="이전">
          <ChevronLeft className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        <h1 className="px-1 text-2xl font-black">이용 약관</h1>
        <button
          type="button"
          onClick={() => onToggleAll(!allOn)}
          className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-4 text-left font-bold"
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-white ${allOn ? 'bg-[#0084FF]' : 'bg-slate-200'}`}>✓</span>
          약관 전체 동의
        </button>
        <ul className="mt-2">
          {TERM_COPY.map((term) => (
            <li key={term.id} className="border-b border-slate-100">
              <div className="flex items-center gap-3 py-3">
                <button type="button" onClick={() => onToggle(term.id, !terms[term.id])} className="flex flex-1 items-center gap-3 text-left">
                  <span className={`text-lg ${terms[term.id] ? 'text-[#0084FF]' : 'text-slate-300'}`}>✓</span>
                  <span className="text-sm font-semibold">
                    {term.title} ({term.required ? '필수' : '선택'})
                  </span>
                </button>
                <button type="button" onClick={() => setOpen(open === term.id ? null : term.id)} className="px-2 text-xs text-slate-400">
                  {open === term.id ? '닫기' : '보기'}
                </button>
              </div>
              {open === term.id && (
                <div className="px-9 pb-3 text-sm leading-6 text-slate-500">
                  <p>{term.body}</p>
                  {term.id === 'locationUse' && (
                    <a className="mt-1 inline-block font-bold text-[#0084FF]" href="/location-terms.html">개인위치정보 이용약관</a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="px-5 pb-8">
        <button type="button" disabled={!ready} onClick={onNext} className="w-full rounded-full bg-[#0084FF] py-3.5 font-bold text-white disabled:opacity-40">
          다음
        </button>
      </div>
    </div>
  );
}

function Permissions({
  initial,
  canClose,
  onClose,
  onBack,
  onDone,
}: {
  initial: PermissionState;
  canClose: boolean;
  onClose: () => void;
  onBack: () => void;
  onDone: (permissions: PermissionState) => void;
}) {
  const [step, setStep] = useState<'intro' | 'location' | 'motion' | 'battery'>('intro');
  const [keepSeen, setKeepSeen] = useState(initial.notifications === 'granted' || initial.notifications === 'skipped');
  const [draft, setDraft] = useState<PermissionState>({ ...initial, completed: false });
  const [busy, setBusy] = useState(false);
  const [askedAlways, setAskedAlways] = useState(false);
  const [alwaysGuide, setAlwaysGuide] = useState(false);
  const [alwaysSetup, setAlwaysSetup] = useState(false);
  const [guideThenMotion, setGuideThenMotion] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const finish = (next: PermissionState, wantsBackground = false) => {
    if ((next.locationMode === 'always' || wantsBackground) && step !== 'battery') {
      setDraft(next);
      setNote(null);
      setStep('battery');
      return;
    }
    onDone(next);
  };

  return (
    <div className="relative flex h-full flex-col bg-[#eef3f8]">
      <div className="flex items-center justify-between px-3 pt-3">
        <button type="button" onClick={onBack} className="p-2 text-slate-500" aria-label="이전">
          <ChevronLeft className="h-5 w-5" />
        </button>
        {canClose && (
          <button type="button" onClick={onClose} className="px-2 text-sm font-semibold text-slate-500">
            닫기
          </button>
        )}
      </div>
      {step === 'intro' && (
        <div className="flex flex-1 flex-col px-5 pb-8">
          <h1 className="mt-4 text-[26px] font-black leading-snug">가족 위치 공유를 시작할까요?</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">쓰는 권한만 차례로 묻습니다. 마이크, 문자, 주변 소리는 요청하지 않습니다.</p>
          <div className="mt-5 space-y-3 rounded-3xl bg-white p-4 shadow-sm">
            <Row icon={<Bell className="h-5 w-5" />} title="알림" body="SOS와 집 반경 알림에 씁니다. 위치 공유 중에는 알림 목록에 Kinnex 카드가 나오지 않습니다." />
            <Row icon={<MapPin className="h-5 w-5" />} title="위치" body="정확한 위치 또는 대략적인 위치를 고릅니다. 항상 허용은 설정 화면에서 직접 바꿉니다." />
            <Row icon={<Footprints className="h-5 w-5" />} title="움직임" body="안드로이드에서는 신체 활동 권한 창을 엽니다. 선택입니다." />
            <Row icon={<BatteryCharging className="h-5 w-5" />} title="배터리" body="항상 허용을 고르면 배터리 제한 없음 창을 엽니다. 스위치는 직접 고릅니다." />
          </div>
          <div className="mt-auto pt-6">
            <button type="button" onClick={() => setStep('location')} className="w-full rounded-full bg-[#0084FF] py-3.5 font-bold text-white">
              다음
            </button>
          </div>
        </div>
      )}

      {step === 'location' && !keepSeen && (
        <Dialog
          icon={<Bell className="h-7 w-7 text-[#0084FF]" />}
          title="알림을 허용할까요?"
          body="알림 권한은 SOS, 집 반경, 새 대화에 씁니다. 허용을 누르면 알림 창이 열립니다. 위치 공유 중에는 알림 목록에 Kinnex 카드가 나오지 않습니다. 앱이 혼자 위치를 백그라운드로 올리지 않습니다. 전화번호는 쓰지 않습니다."
          note={note}
          busy={busy}
          primary="알림 허용"
          onPrimary={async () => {
            setBusy(true);
            const result = await askNotifications();
            setBusy(false);
            setNote(result.note);
            setDraft({ ...draft, notifications: result.state });
            markSessionFlag(KEEP_PERMISSION_ASKED_KEY);
            setKeepSeen(true);
          }}
          onSecondary={() => {
            setDraft({ ...draft, notifications: 'denied' });
            markSessionFlag(KEEP_PERMISSION_ASKED_KEY);
            setNote(null);
            setKeepSeen(true);
          }}
        />
      )}

      {step === 'location' && keepSeen && (
        <div className="flex flex-1 flex-col px-5 pb-6">
          <div className="mt-2 flex justify-center text-[#0084FF]">
            <MapPin className="h-8 w-8" />
          </div>
          <h1 className="mt-3 text-center text-xl font-black leading-snug">Kinnex이 이 기기의 위치에 접근하도록 허용하시겠습니까?</h1>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <AccuracyCard
              selected={draft.accuracy === 'precise'}
              title="정확한 위치"
              body="지도에 점을 가깝게 찍습니다."
              onClick={() => setDraft({ ...draft, accuracy: 'precise' })}
            />
            <AccuracyCard
              selected={draft.accuracy === 'approximate'}
              title="대략적인 위치"
              body="동네 단위로만 표시합니다."
              onClick={() => setDraft({ ...draft, accuracy: 'approximate' })}
            />
          </div>
          <p className="mt-3 text-center text-sm font-semibold leading-6 text-slate-600">
            「위치 액세스 권한」에서 「항상 허용」을 고르고 「정확한 위치 사용」을 켭니다.
          </p>
          <p className="mt-2 text-center text-xs leading-5 text-slate-500">
            {draft.notifications === 'granted'
              ? '알림을 허용했습니다. 항상 허용을 고른 뒤 지도에서 위치 유지를 켭니다. 알림 목록에 Kinnex 카드는 나오지 않습니다.'
              : draft.notifications === 'denied'
                ? '알림을 허용하지 않았습니다. 위치 유지는 항상 허용 뒤에 켤 수 있습니다. SOS와 새 대화 알림은 알림 권한이 필요합니다.'
                : '이 브라우저에는 알림 창이 없습니다.'}
          </p>
          {note && <p className="mt-3 text-center text-sm leading-6 text-slate-600">{note}</p>}
          <div className="mt-auto space-y-2 pt-4 text-center">
            <TextButton
              disabled={busy}
              label="앱 사용 중에만 허용"
              onClick={async () => {
                setBusy(true);
                const result = await askWhileUsing(draft.accuracy === 'precise');
                setBusy(false);
                setNote(result.note);
                const next = { ...draft, locationMode: result.location === 'while-using' ? 'while-using' as const : 'denied' as const };
                setDraft(next);
                setStep('motion');
              }}
            />
            <TextButton
              disabled={busy}
              label="항상 허용"
              onClick={() => {
                setAskedAlways(true);
                setAlwaysSetup(true);
              }}
            />
            <TextButton
              disabled={busy}
              label="방법 보기"
              onClick={() => setAlwaysGuide(true)}
            />
            <TextButton
              disabled={busy}
              label="허용 안 함"
              onClick={() => {
                const next = { ...draft, locationMode: 'denied' as const };
                setDraft(next);
                setStep('motion');
              }}
            />
          </div>
        </div>
      )}

      {alwaysSetup && (
        <AlwaysAllowSetup
          native={umapLocationNative()}
          precise={draft.accuracy === 'precise'}
          onClose={() => setAlwaysSetup(false)}
          onDone={(result) => {
            setAlwaysSetup(false);
            setNote(result.note);
            if (result.location === 'unavailable' && !result.fallback) return;
            const locationMode = result.location === 'always' ? 'always' as const : result.location === 'while-using' ? 'while-using' as const : 'denied' as const;
            if (result.location === 'always' || result.location === 'while-using' || result.location === 'denied') {
              setDraft({ ...draft, locationMode });
            }
            if (result.fallback && result.location !== 'always') {
              setGuideThenMotion(true);
              setAlwaysGuide(true);
              return;
            }
            setStep('motion');
          }}
        />
      )}

      {alwaysGuide && (
        <AlwaysAllowGuide
          native={umapLocationNative()}
          busy={busy}
          note={note}
          onClose={() => {
            setAlwaysGuide(false);
            if (guideThenMotion) {
              setGuideThenMotion(false);
              setStep('motion');
            }
          }}
          onBattery={() => {
            setBusy(true);
            void askBattery().then((result) => {
              setBusy(false);
              setNote(result.note);
            });
          }}
          onOpenSettings={() => {
            setBusy(true);
            void (async () => {
              const overlay = umapLocationNative() ? await overlayPermissionGranted() : false;
              return askAlwaysLocation(draft.accuracy === 'precise', { overlay });
            })().then((result) => {
              setBusy(false);
              setAlwaysGuide(false);
              if (result.location === 'unavailable') {
                setNote(result.note);
                return;
              }
              setNote(result.note);
              const locationMode = result.location === 'always' ? 'always' as const : result.location === 'while-using' ? 'while-using' as const : 'denied' as const;
              const next = { ...draft, locationMode };
              setDraft(next);
              setStep('motion');
            });
          }}
        />
      )}

      {step === 'motion' && (
        <Dialog
          icon={<Footprints className="h-7 w-7 text-[#0084FF]" />}
          title="움직임 정보로 위치 정확도를 높일까요?"
          body="이동 중인지 머무르는지 구분합니다. 허용을 누르면 안드로이드 신체 활동 권한 창이 열리고, 이미 거절했다면 설정으로 이동합니다. 건강 기록이나 마이크는 보지 않습니다."
          note={note}
          busy={busy}
          primary="허용"
          onPrimary={async () => {
            setBusy(true);
            const result = await askMotion();
            setBusy(false);
            setNote(result.note);
            const next = { ...draft, motion: result.state };
            setDraft(next);
            finish(next, askedAlways || next.locationMode === 'always');
          }}
          onSecondary={() => {
            const next = { ...draft, motion: 'denied' as const };
            setDraft(next);
            finish(next);
          }}
        />
      )}

      {step === 'battery' && (
        <div className="flex flex-1 flex-col px-6 pb-8">
          <BatteryCharging className="mt-6 h-8 w-8 text-[#0084FF]" />
          <h1 className="mt-4 text-2xl font-black leading-snug">배터리 최적화 안내</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            버튼을 누르면 이 앱의 배터리 제한 없음 팝업이 바로 열립니다. 허용은 그 팝업에서 직접 고릅니다.
          </p>
          {note && <p className="mt-3 text-sm leading-6 text-amber-800">{note}</p>}
          <div className="mt-auto space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const result = await askBattery();
                setBusy(false);
                setNote(result.note);
                if (result.opened || result.unrestricted) onDone({ ...draft, battery: 'acknowledged' });
              }}
              className="w-full rounded-full bg-[#0084FF] py-3.5 font-bold text-white disabled:opacity-40"
            >
              {busy ? '여는 중…' : '배터리 제한 없음 열기'}
            </button>
            <button
              type="button"
              onClick={() => onDone({ ...draft, battery: 'acknowledged' })}
              className="w-full rounded-full bg-slate-100 py-3 text-sm font-bold"
            >
              확인했습니다
            </button>
            <button type="button" onClick={() => onDone({ ...draft, battery: 'skipped' })} className="w-full py-3 text-sm font-bold text-slate-500">
              나중에
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 text-[#0084FF]">{icon}</div>
      <div>
        <p className="font-bold">{title}</p>
        <p className="text-sm leading-5 text-slate-500">{body}</p>
      </div>
    </div>
  );
}

function Dialog({
  icon,
  title,
  body,
  note,
  primary,
  busy,
  onPrimary,
  onSecondary,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  note?: string | null;
  primary: string;
  busy: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center px-6 pb-8 pt-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm">{icon}</div>
      <h1 className="mt-5 text-xl font-black leading-snug">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">{body}</p>
      {note && <p className="mt-3 text-sm leading-6 text-amber-800">{note}</p>}
      <div className="mt-auto w-full">
        <button type="button" disabled={busy} onClick={onPrimary} className="w-full py-3 text-lg font-bold text-[#0084FF] disabled:opacity-40">
          {busy ? '확인 중…' : primary}
        </button>
        <button type="button" disabled={busy} onClick={onSecondary} className="w-full py-3 text-lg font-bold text-slate-700">
          허용 안 함
        </button>
      </div>
    </div>
  );
}

function AccuracyCard({ selected, title, body, onClick }: { selected: boolean; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl border bg-white p-3 text-left ${selected ? 'border-[#0084FF] ring-2 ring-[#0084FF]/30' : 'border-slate-200'}`}>
      <Shield className={`h-4 w-4 ${selected ? 'text-[#0084FF]' : 'text-slate-300'}`} />
      <p className="mt-2 text-sm font-bold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{body}</p>
    </button>
  );
}

function TextButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className="w-full py-3 text-base font-bold text-slate-800 disabled:opacity-40">
      {label}
    </button>
  );
}
