import { Capacitor, registerPlugin } from '@capacitor/core';

const DeviceSeal = registerPlugin('DeviceSeal');
const PREFIX = 'umap-device-seal:';

export function deviceSealAvailable() {
  return Capacitor.isNativePlatform();
}

export async function sealDeviceText(plain) {
  if (!deviceSealAvailable() || typeof plain !== 'string') return plain;
  try {
    const result = await DeviceSeal.seal({ plain });
    return result && typeof result.sealed === 'string' && result.sealed.startsWith(PREFIX) ? result.sealed : plain;
  } catch {
    return plain;
  }
}

export async function openDeviceText(sealed) {
  if (typeof sealed !== 'string' || !sealed.startsWith(PREFIX)) return sealed;
  if (!deviceSealAvailable()) return '';
  try {
    const result = await DeviceSeal.open({ sealed });
    return result && typeof result.plain === 'string' ? result.plain : '';
  } catch {
    return '';
  }
}

/** App-private file. Survives an APK update. A failed read must not look like an empty file. */
export async function readDurableSession() {
  if (!deviceSealAvailable()) return { ok: false, raw: '' };
  try {
    const result = await DeviceSeal.readSession();
    if (!result || typeof result.raw !== 'string') return { ok: false, raw: '' };
    return { ok: true, raw: result.raw };
  } catch {
    return { ok: false, raw: '' };
  }
}

export async function writeDurableSession(raw) {
  if (!deviceSealAvailable() || typeof raw !== 'string') return false;
  try {
    await DeviceSeal.writeSession({ raw });
    return true;
  } catch {
    return false;
  }
}
