import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./session.tsx', import.meta.url), 'utf8');

function sliceBetween(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} .. ${end}`);
  return source.slice(from, to);
}

test('logout clears the sealed session before the next persist', () => {
  const logout = sliceBetween('logout: () => {', 'withdraw: () => {');
  const cancelAt = logout.indexOf('cancelDeviceSealRestore()');
  const clearAt = logout.indexOf('clearStoredSessions()');
  const dispatchAt = logout.indexOf("dispatchMap({ type: 'logout' })");
  assert.ok(cancelAt >= 0 && clearAt > cancelAt && dispatchAt > clearAt);
  assert.match(logout, /logoutLocalAccount\(/);
  assert.match(logout, /clearDiag\(\)/);
});

test('a late seal restore cannot write after logout', () => {
  const restore = sliceBetween('const epoch = sealEpoch;', '}, []);');
  assert.match(restore, /if \(epoch !== sealEpoch\) return;/);
  const second = source.indexOf('const epoch = sealEpoch;', source.indexOf('const epoch = sealEpoch;') + 1);
  const persist = source.slice(second, source.indexOf('scheduleAccountBackup(state)', second));
  assert.match(persist, /if \(epoch !== sealEpoch\) return;/);
  assert.match(source, /function cancelDeviceSealRestore\(\)/);
  const withdraw = sliceBetween('withdraw: () => {', 'clearFamilyRoom:');
  assert.match(withdraw, /cancelDeviceSealRestore\(\)/);
  assert.match(withdraw, /forgetDurableSession\(\)/);
  assert.match(withdraw, /clearDiag\(\)/);
});

test('logout and reset drop the durable file before the next persist', () => {
  const logout = sliceBetween('logout: () => {', 'withdraw: () => {');
  const forgetAt = logout.indexOf('clearStoredSessions()');
  const dispatchAt = logout.indexOf("dispatchMap({ type: 'logout' })");
  assert.ok(forgetAt >= 0 && forgetAt < dispatchAt);
  const forget = sliceBetween('function forgetDurableSession()', 'const SESSION_KEYS');
  assert.match(forget, /durableHold = ''/);
  assert.match(forget, /writeDurableSession\(''\)/);
  assert.match(source, /function clearStoredSessions\(\) \{\n  forgetDurableSession\(\);/);
  const restore = sliceBetween('if (!deviceReady || restoringDeviceSeal) return;', '}, [deviceReady, historyPulse, state.journeys, state.visits]);');
  const asyncRestore = restore.slice(restore.indexOf('void (async'));
  assert.ok(asyncRestore.indexOf('await loadFamilyAccount') < asyncRestore.indexOf('restoreOnce.current = true'));
  assert.match(asyncRestore, /if \(cancel\) return;/);
});
