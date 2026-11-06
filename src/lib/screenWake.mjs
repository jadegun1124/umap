/**
 * Screen Wake Lock for the open page. The browser drops it when the page
 * hides, so a visible page asks again. Android WebView often ignores this;
 * MainActivity also sets FLAG_KEEP_SCREEN_ON while the activity is resumed.
 */
export function bindScreenWake(doc = globalThis.document) {
  if (!doc || typeof doc.addEventListener !== 'function') return () => {};
  let sentinel = null;
  let stopped = false;
  const view = doc.defaultView || globalThis;

  const request = async () => {
    if (stopped || doc.visibilityState === 'hidden') return;
    if (sentinel) return;
    const locks = view.navigator?.wakeLock;
    if (!locks || typeof locks.request !== 'function') return;
    try {
      const next = await locks.request('screen');
      if (stopped || doc.visibilityState === 'hidden') {
        try { await next.release?.(); } catch { /* already released */ }
        return;
      }
      sentinel = next;
      if (typeof next.addEventListener === 'function') {
        next.addEventListener('release', () => {
          if (sentinel === next) sentinel = null;
          if (!stopped && doc.visibilityState !== 'hidden') void request();
        });
      }
    } catch {
      sentinel = null;
    }
  };

  const onVisible = () => {
    if (doc.visibilityState === 'hidden') {
      const current = sentinel;
      sentinel = null;
      if (current && typeof current.release === 'function') Promise.resolve(current.release()).catch(() => {});
      return;
    }
    void request();
  };

  void request();
  doc.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    doc.removeEventListener('visibilitychange', onVisible);
    const current = sentinel;
    sentinel = null;
    if (current && typeof current.release === 'function') Promise.resolve(current.release()).catch(() => {});
  };
}
