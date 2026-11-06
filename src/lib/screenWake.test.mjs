import assert from 'node:assert/strict';
import test from 'node:test';
import { bindScreenWake } from './screenWake.mjs';

function fakeDocument() {
  const listeners = new Map();
  let visibilityState = 'visible';
  const releases = [];
  const requests = [];
  const doc = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    defaultView: {
      navigator: {
        wakeLock: {
          async request(kind) {
            requests.push(kind);
            const sentinel = {
              addEventListener(type, listener) {
                sentinel.releaseListener = type === 'release' ? listener : sentinel.releaseListener;
              },
              async release() {
                releases.push(true);
                sentinel.releaseListener?.();
              },
            };
            return sentinel;
          },
        },
      },
    },
  };
  return {
    doc,
    requests,
    releases,
    hide() {
      visibilityState = 'hidden';
      listeners.get('visibilitychange')?.();
    },
    show() {
      visibilityState = 'visible';
      listeners.get('visibilitychange')?.();
    },
  };
}

test('the screen lock is taken while visible, dropped when hidden, and taken again', async () => {
  const page = fakeDocument();
  const stop = bindScreenWake(page.doc);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(page.requests, ['screen']);
  page.hide();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.releases.length, 1);
  page.show();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(page.requests, ['screen', 'screen']);
  stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.releases.length, 2);
  page.show();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.requests.length, 2);
});
