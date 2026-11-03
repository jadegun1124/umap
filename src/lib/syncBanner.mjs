/** Banner under the map. The native app must not say the share is browser-only. */
export function syncBannerText(phase, missingSyncKey = false, native = false) {
  if (missingSyncKey) {
    return native
      ? '이 초대에 동기화 키가 없습니다. 초대한 사람이 보낸 링크를 다시 열어 주세요.'
      : '이 초대에 동기화 키가 없어 다른 폰으로 위치가 가지 않습니다. 관리자가 보낸 링크를 다시 열어 주세요. 이 브라우저 안에서는 그대로 공유됩니다.';
  }
  if (phase === 'off') {
    return native
      ? '위치 서버가 설정되지 않았습니다.'
      : '위치 서버가 설정되지 않았습니다. 이 브라우저 안에서만 공유됩니다.';
  }
  if (phase === 'down') {
    return native
      ? '위치 서버에 연결하지 못했습니다. 이 폰에는 마지막으로 받은 위치가 보입니다.'
      : '위치 서버에 연결하지 못했습니다. 이 브라우저 안에서만 공유됩니다.';
  }
  if (phase === 'limited') {
    return native
      ? '위치 서버의 오늘 저장 한도를 넘었습니다. 오전 9시 이후에 다시 이어집니다. 이 폰에는 마지막으로 받은 위치가 보입니다.'
      : '위치 서버의 오늘 저장 한도를 넘었습니다. 오전 9시 이후에 다시 이어집니다. 이 브라우저 안에서만 공유됩니다.';
  }
  if (phase === 'rejected') {
    return native
      ? '가족 연결 키가 맞지 않습니다. 복구 코드로 다시 불러오면 이어서 공유됩니다.'
      : '동기화 키가 맞지 않습니다. 초대 링크를 다시 확인해 주세요. 이 브라우저 안에서만 공유됩니다.';
  }
  return null;
}

export const OLD_APP_PLACE_LABEL = '상대가 앱을 업데이트해야 위치가 보여요';
