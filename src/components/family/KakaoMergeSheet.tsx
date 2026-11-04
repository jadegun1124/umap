export const KAKAO_MERGE_WARNING = '이 카카오는 다른 계정에 연결되어 있습니다. 가져오기를 누르면 기존 계정의 가족 방, 구성원, 우리 집, 설정을 이 계정으로 가져옵니다. 카카오 로그인은 이제 이 계정으로만 됩니다. 예전 계정의 데이터는 남고, 그 복구 코드로는 예전 계정에 들어갈 수 있지만 카카오로는 들어갈 수 없습니다. 암호화된 지난 기록과 가족 암호로 잠긴 위치는 이 폰에서 바로 열리지 않습니다. 가족 폰이 이 폰의 열쇠로 다시 감싸거나, 기록 화면에 예전 복구 코드를 입력하면 열립니다. 서버는 열쇠와 기록을 풀지 않습니다.';

export function KakaoMergeSheet({
  busy,
  onMerge,
  onCancel,
}: {
  busy: boolean;
  onMerge: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end bg-slate-900/40">
      <div className="w-full rounded-t-3xl bg-white px-5 pb-8 pt-5">
        <h2 className="text-lg font-black">기존 계정 구성원 가져오기</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{KAKAO_MERGE_WARNING}</p>
        <button
          type="button"
          disabled={busy}
          onClick={onMerge}
          className="mt-4 w-full rounded-full bg-[#0084FF] py-3.5 text-sm font-bold text-white disabled:opacity-40"
        >
          {busy ? '가져오는 중…' : '기존 계정 구성원 가져오기(병합)'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="mt-2 w-full py-2 text-sm font-bold text-slate-400">
          취소
        </button>
      </div>
    </div>
  );
}
