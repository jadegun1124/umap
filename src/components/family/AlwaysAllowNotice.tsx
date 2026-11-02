import type { PermissionState } from '../../types/family';
import { keepStatus } from '../../lib/keepStatus.mjs';

export function AlwaysAllowNotice({
  locationMode,
  keepAlive,
  native,
  batteryUnrestricted = null,
  serviceRunning = false,
  onOpenSettings,
  onShowGuide,
  onBattery,
  onStart,
  note,
}: {
  locationMode: PermissionState['locationMode'];
  keepAlive: boolean;
  native: boolean;
  batteryUnrestricted?: boolean | null;
  serviceRunning?: boolean;
  onOpenSettings: () => void;
  onShowGuide: () => void;
  onBattery: () => void;
  onStart: () => void;
  note?: string | null;
}) {
  const status = keepStatus({ locationMode, batteryUnrestricted, serviceRunning });
  const live = locationMode === 'always' && keepAlive && status.battery !== 'restricted';
  const fix = (action: 'always' | 'battery') => (action === 'battery' ? onBattery : onOpenSettings);
  return (
    <div className="mb-2 rounded-2xl bg-slate-50 px-3 py-2">
      <p className="text-xs font-bold text-slate-700">{live ? '위치 유지 켜짐' : '위치 유지'}</p>
      <dl className="mt-2 space-y-1 text-[12px] leading-5 text-slate-700">
        <div className="flex items-center justify-between gap-2">
          <dt>위치 허용</dt>
          <dd className="font-bold">{status.locationLabel}</dd>
        </div>
        {native && (
          <div className="flex items-center justify-between gap-2">
            <dt>배터리 제한 없음</dt>
            <dd className="font-bold">{status.batteryLabel}</dd>
          </div>
        )}
        {native && (
          <div className="flex items-center justify-between gap-2">
            <dt>위치 유지</dt>
            <dd className="font-bold">{status.serviceLabel}</dd>
          </div>
        )}
      </dl>
      {status.fixes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {status.fixes.map((item) => (
            <button key={item.action} type="button" onClick={fix(item.action)} className="rounded-full bg-[#0084FF] px-3 py-1.5 text-[11px] font-bold text-white">
              {item.label}
            </button>
          ))}
          {status.location !== 'always' && (
            <button type="button" onClick={onShowGuide} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700">
              방법 보기
            </button>
          )}
        </div>
      )}
      {status.fixes.length === 0 && locationMode === 'always' && !keepAlive && (
        <button type="button" onClick={onStart} className="mt-2 rounded-full bg-[#0084FF] px-3 py-1.5 text-[11px] font-bold text-white">
          위치 유지 켜기
        </button>
      )}
      {live && (
        <p className="mt-2 text-[11px] font-semibold leading-4 text-slate-500">
          걷는 동안은 2.5초, 차나 자전거는 1초마다 기록합니다. 머무는 동안은 30초에서 1분마다 움직임만 확인합니다.
        </p>
      )}
      {note && <p className="mt-1 text-[11px] font-semibold leading-4 text-slate-500">{note}</p>}
    </div>
  );
}
