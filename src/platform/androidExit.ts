const EXIT_CONFIRM_MS = 2000;
const EXIT_CONFIRM_TEXT = '한 번 더 누르면 앱이 종료됩니다';

type Closer = () => boolean;

const closers: Closer[] = [];
let armedUntil = 0;
let showToast: (text: string) => void = () => {};

declare global {
  interface Window {
    __umapAndroidBack?: () => boolean;
    __umapAlwaysAllowGate?: boolean;
    UmapAndroid?: { exitApp: () => void; appVersion?: () => string; openUrl?: (url: string) => void };
  }
}

// Node tests cover the same decision in androidBackCore.mjs.
function decideAndroidBack(now: number, until: number, consumed: boolean): { action: 'consumed' | 'toast' | 'exit'; armedUntil: number } {
  if (consumed) return { action: 'consumed', armedUntil: until };
  if (now < until) return { action: 'exit', armedUntil: until };
  return { action: 'toast', armedUntil: now + EXIT_CONFIRM_MS };
}

export function consumeAndroidBack(closer: Closer): () => void {
  closers.push(closer);
  return () => {
    const index = closers.lastIndexOf(closer);
    if (index >= 0) closers.splice(index, 1);
  };
}

export function handleAndroidBack(): boolean {
  if (window.__umapAlwaysAllowGate) return true;
  let consumed = false;
  for (let index = closers.length - 1; index >= 0; index -= 1) {
    if (closers[index]()) {
      consumed = true;
      break;
    }
  }
  const decision = decideAndroidBack(Date.now(), armedUntil, consumed);
  armedUntil = decision.armedUntil;
  if (decision.action === 'toast') showToast(EXIT_CONFIRM_TEXT);
  if (decision.action === 'exit') window.UmapAndroid?.exitApp();
  return true;
}

export function bindAndroidBack(onToast: (text: string) => void): () => void {
  showToast = onToast;
  window.__umapAndroidBack = handleAndroidBack;
  return () => {
    if (window.__umapAndroidBack === handleAndroidBack) delete window.__umapAndroidBack;
  };
}
