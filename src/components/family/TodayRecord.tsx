import { formatClock } from '../../lib/geo';
import type { Visit } from '../../types/family';

export function TodayRecord({ visits }: { visits: Visit[] }) {
  return (
    <div className="space-y-3 text-sm">
      <section>
        <h3 className="text-xs font-bold text-slate-400">방문한 곳</h3>
        {visits.length === 0 ? (
          <p className="mt-1 text-xs leading-5 text-slate-500">아직 방문이 없습니다. 한곳에 머물면 좌표나 주소가 여기에 남습니다.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {visits.map((visit) => (
              <li key={visit.id} className="rounded-2xl bg-slate-50 px-3 py-2">
                <p className="font-bold">{visit.label || `${visit.lat.toFixed(5)}, ${visit.lng.toFixed(5)}`}</p>
                <p className="text-xs text-slate-500">
                  {formatClock(visit.arrivedAt)} 도착
                  {visit.leftAt == null ? ' · 머무는 중' : ` · ${formatClock(visit.leftAt)} 출발`}
                  {visit.label ? '' : ' · 좌표'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-[11px] leading-5 text-slate-400">
        여정과 방문은 이 폰에 서울 날짜로 30일 남고, 같은 기록이 암호화되어 계정에도 올라갑니다.
      </p>
    </div>
  );
}
