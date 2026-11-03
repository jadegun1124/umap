import { useState } from 'react';
import {
  nextAlwaysAllowAction,
  type ForegroundPhase,
} from '../../lib/alwaysAllowFlow.mjs';
import { askAlwaysLocation } from '../../services/systemPermissions';
import {
  openOverlaySettings,
  overlayPermissionGranted,
  readLocationAccess,
  requestForegroundLocation,
} from '../../services/umapLocation';

export type AlwaysSetupResult = {
  location: 'always' | 'while-using' | 'denied' | 'unavailable';
  note: string | null;
  fallback: boolean;
};

export function AlwaysAllowSetup({
  native,
  precise,
  onClose,
  onDone,
}: {
  native: boolean;
  precise: boolean;
  onClose: () => void;
  onDone: (result: AlwaysSetupResult) => void;
}) {
  const [phase, setPhase] = useState<'coach' | 'overlay' | 'busy'>('coach');

  const openSettings = async (overlay: boolean, fallback: boolean) => {
    setPhase('busy');
    const result = await askAlwaysLocation(precise, { overlay });
    onDone({
      location: result.location,
      note: result.note,
      fallback: fallback || (overlay && !result.overlay),
    });
  };

  const continueAfter = async (foreground: ForegroundPhase) => {
    const granted = native && foreground === 'while-using' ? await overlayPermissionGranted() : false;
    const action = nextAlwaysAllowAction({
      native,
      foreground,
      overlay: granted ? 'granted' : 'unknown',
    });
    if (action === 'done') {
      onDone({ location: 'always', note: '위치 권한이 항상 허용입니다.', fallback: false });
      return;
    }
    if (action === 'stop') {
      onDone({ location: 'denied', note: '위치 허용을 거절했습니다.', fallback: false });
      return;
    }
    if (action === 'browser') {
      const result = await askAlwaysLocation(precise);
      onDone({ location: result.location, note: result.note, fallback: false });
      return;
    }
    if (action === 'settings-with-overlay') {
      await openSettings(true, false);
      return;
    }
    setPhase('overlay');
  };

  const onNext = async () => {
    setPhase('busy');
    if (!native) {
      await continueAfter('need');
      return;
    }
    let access = await readLocationAccess();
    if (access !== 'always' && access !== 'while-using') {
      const requested = await requestForegroundLocation();
      if (requested !== 'while-using') {
        await continueAfter('denied');
        return;
      }
      access = await readLocationAccess();
    }
    await continueAfter(access === 'always' ? 'always' : 'while-using');
  };

  return (
    <div className="absolute inset-0 z-[80] flex flex-col bg-white">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <button type="button" onClick={onClose} className="p-2 text-slate-500" aria-label="닫기">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
        <span className="text-base font-semibold text-slate-700">위치</span>
        <div className="w-10" />
      </div>

      {phase !== 'overlay' ? (
        <div className="flex flex-1 flex-col px-6">
          <h2 className="mt-4 text-center text-xl font-bold leading-snug text-[#0084FF]">
            위치 권한을 '항상 허용'으로 설정하세요
          </h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-slate-600">
            Kinnex가 정상적으로 작동하려면 '항상'으로 설정해야 합니다.
          </p>

          <div className="mt-8 space-y-6">
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">1. 설정에서 위치 선택</p>
              <div className="flex items-center justify-between rounded-xl border-2 border-[#0084FF] bg-white px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded bg-[#0084FF]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
                      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-slate-800">위치</span>
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">2. 그런 다음 항상 탭</p>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-medium text-slate-800">항상</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0084FF" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            </div>
          </div>

          <p className="mt-auto mb-2 text-center text-xs leading-relaxed text-slate-400">
            회원님의 위치 데이터는 개인정보처리방침 및 사용자 설정에 따라 연구, 맞춤형 광고, 분석 목적 등을 위해 제3자와 공유될 수 있습니다.
          </p>

          <button
            type="button"
            disabled={phase === 'busy'}
            onClick={() => void onNext()}
            className="mb-6 w-full rounded-xl bg-[#0084FF] py-4 text-base font-bold text-white disabled:opacity-50"
          >
            {phase === 'busy' ? '여는 중…' : '설정으로 이동'}
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col px-6">
          <h2 className="mt-10 text-center text-xl font-bold text-slate-800">다른 앱 위에 표시</h2>
          <p className="mt-3 text-center text-sm leading-relaxed text-slate-600">
            설정 화면 위에 항상 허용 안내를 띄웁니다.
          </p>
          <div className="mt-auto space-y-3 pb-6">
            <button
              type="button"
              onClick={() => {
                setPhase('busy');
                void (async () => {
                  await openOverlaySettings();
                  const granted = await overlayPermissionGranted();
                  await openSettings(granted, !granted);
                })();
              }}
              className="w-full rounded-xl bg-[#0084FF] py-4 text-base font-bold text-white"
            >
              표시 허용
            </button>
            <button
              type="button"
              onClick={() => void openSettings(false, true)}
              className="w-full py-3 text-sm font-semibold text-slate-500"
            >
              건너뛰기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
