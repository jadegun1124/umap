import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface UmapFix {
  lat: number;
  lng: number;
  accuracyM: number;
  speedMps: number | null;
  at: number;
  provider?: string;
}

export interface KeepAliveTarget {
  token: string;
  code: string;
  audience: 'admin' | 'family';
  sharing: boolean;
}

export interface KeepAliveConfig {
  baseUrl: string;
  name: string;
  memberId?: string;
  profileKey?: string;
  precise: boolean;
  targets: KeepAliveTarget[];
}

export interface NativePromptResult {
  state: 'granted' | 'denied' | 'unavailable';
  openedSettings: boolean;
}

export type AlwaysSettingsScreen = 'location-radio' | 'app-permissions' | 'app-details' | 'background-dialog' | 'foreground-dialog' | 'none';

export interface AlwaysLocationResult {
  opened: boolean;
  location: 'always' | 'while-using' | 'denied' | 'unavailable';
  native: boolean;
  screen: AlwaysSettingsScreen;
  overlay: boolean;
}

export interface BatteryOptimizationResult {
  opened: boolean;
  unrestricted: boolean;
}

export interface NativeBattery {
  pct: number | null;
  charging: boolean | null;
}

interface UmapLocationPlugin {
  openSettings(): Promise<{ opened: boolean }>;
  openAlwaysLocation(options?: { overlay?: boolean }): Promise<AlwaysLocationResult>;
  locationAccess(): Promise<{ location: 'always' | 'while-using' | 'denied' | 'unavailable'; precise?: boolean; background?: boolean }>;
  openAlwaysGate(): Promise<AlwaysLocationResult>;
  overlayPermission(): Promise<{ granted: boolean }>;
  openOverlaySettings(): Promise<{ opened: boolean; granted: boolean }>;
  requestForeground(): Promise<{ location: 'while-using' | 'denied' | 'unavailable' }>;
  requestNotifications(): Promise<NativePromptResult>;
  requestCamera(): Promise<NativePromptResult>;
  requestMotion(): Promise<NativePromptResult>;
  openBattery(): Promise<BatteryOptimizationResult>;
  battery(): Promise<{ pct?: number | null; charging?: boolean | null }>;
  start(options: { config: string }): Promise<{ started: boolean; reason?: string }>;
  stop(): Promise<{ stopped: boolean }>;
  status(): Promise<{
    running: boolean;
    userStopped: boolean;
    native: boolean;
    reason?: string;
    batteryUnrestricted?: boolean;
    location?: 'always' | 'while-using' | 'denied';
    precise?: boolean;
    versionName?: string;
    versionCode?: number;
    heartbeatAt?: number;
    lastFixAt?: number;
    fixStale?: boolean;
  }>;
  startAlertWatch(options: { config: string }): Promise<{ started: boolean; reason?: string }>;
  stopAlertWatch(): Promise<{ stopped: boolean }>;
  alertWatchStatus(): Promise<{ running: boolean; userStopped: boolean }>;
  consumePendingChat(): Promise<{ code?: string; peer?: string }>;
  ackStopped(): Promise<void>;
  addListener(eventName: 'fix', listenerFunc: (fix: UmapFix) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'chat', listenerFunc: (event: { code?: string; peer?: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'resume', listenerFunc: () => void): Promise<PluginListenerHandle>;
}

const web: UmapLocationPlugin = {
  async openSettings() {
    return { opened: false };
  },
  async openAlwaysLocation() {
    return { opened: false, location: 'unavailable', native: false, screen: 'none', overlay: false };
  },
  async locationAccess() {
    return { location: 'unavailable' as const, precise: false, background: false };
  },
  async openAlwaysGate() {
    return { opened: false, location: 'unavailable' as const, native: false, screen: 'none' as const, overlay: false };
  },
  async overlayPermission() {
    return { granted: false };
  },
  async openOverlaySettings() {
    return { opened: false, granted: false };
  },
  async requestForeground() {
    return { location: 'unavailable' };
  },
  async requestNotifications() {
    return { state: 'unavailable', openedSettings: false };
  },
  async requestCamera() {
    return { state: 'unavailable', openedSettings: false };
  },
  async requestMotion() {
    return { state: 'unavailable', openedSettings: false };
  },
  async openBattery() {
    return { opened: false, unrestricted: false };
  },
  async battery() {
    return { pct: null, charging: null };
  },
  async start() {
    return { started: false, reason: 'web' };
  },
  async stop() {
    return { stopped: true };
  },
  async status() {
    return { running: false, userStopped: false, native: false };
  },
  async ackStopped() {},
  async startAlertWatch() {
    return { started: false, reason: 'web' };
  },
  async stopAlertWatch() {
    return { stopped: true };
  },
  async alertWatchStatus() {
    return { running: false, userStopped: false };
  },
  async consumePendingChat() {
    return { code: '', peer: '' };
  },
  async addListener() {
    return { remove: async () => {} };
  },
};

const plugin = registerPlugin<UmapLocationPlugin>('UmapLocation', { web });

export function umapLocationNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function openAppSettings(): Promise<boolean> {
  if (!umapLocationNative()) return false;
  try {
    const result = await plugin.openSettings();
    return result.opened === true;
  } catch {
    return false;
  }
}

const ALWAYS_SCREENS: AlwaysSettingsScreen[] = ['location-radio', 'app-permissions', 'app-details', 'background-dialog', 'foreground-dialog'];

function normalizeAlways(result: Partial<AlwaysLocationResult> | null | undefined, native: boolean): AlwaysLocationResult {
  const location = result?.location === 'always' || result?.location === 'while-using' || result?.location === 'denied' ? result.location : 'unavailable';
  const opened = result?.opened === true;
  const screen = opened && result.screen && ALWAYS_SCREENS.includes(result.screen) ? result.screen : opened ? 'location-radio' : 'none';
  return { opened, location, native, screen, overlay: result?.overlay === true };
}

export async function openAlwaysLocation(options?: { overlay?: boolean }): Promise<AlwaysLocationResult> {
  if (!umapLocationNative()) return { opened: false, location: 'unavailable', native: false, screen: 'none', overlay: false };
  try {
    return normalizeAlways(await plugin.openAlwaysLocation({ overlay: options?.overlay === true }), true);
  } catch {
    return { opened: false, location: 'unavailable', native: true, screen: 'none', overlay: false };
  }
}

export async function openAlwaysAllowGate(): Promise<AlwaysLocationResult> {
  if (!umapLocationNative()) return { opened: false, location: 'unavailable', native: false, screen: 'none', overlay: false };
  try {
    return normalizeAlways(await plugin.openAlwaysGate(), true);
  } catch {
    return { opened: false, location: 'unavailable', native: true, screen: 'none', overlay: false };
  }
}

export interface LocationAccessSnapshot {
  location: 'always' | 'while-using' | 'denied' | 'unavailable';
  precise: boolean | null;
  background: boolean;
}

export async function readLocationSnapshot(): Promise<LocationAccessSnapshot> {
  if (!umapLocationNative()) return { location: 'unavailable', precise: null, background: false };
  try {
    const result = await plugin.locationAccess();
    const location = result.location === 'always' || result.location === 'while-using' || result.location === 'denied' ? result.location : 'unavailable';
    const precise = result.precise === true ? true : result.precise === false ? false : null;
    return { location, precise, background: result.background === true || location === 'always' };
  } catch {
    return { location: 'unavailable', precise: null, background: false };
  }
}

export async function listenAppResume(listener: () => void): Promise<() => void> {
  if (!umapLocationNative()) return () => {};
  try {
    const handle = await plugin.addListener('resume', () => listener());
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}

export async function readLocationAccess(): Promise<'always' | 'while-using' | 'denied' | 'unavailable'> {
  if (!umapLocationNative()) return 'unavailable';
  try {
    const result = await plugin.locationAccess();
    return result.location === 'always' || result.location === 'while-using' || result.location === 'denied' ? result.location : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function overlayPermissionGranted(): Promise<boolean> {
  if (!umapLocationNative()) return false;
  try {
    const result = await plugin.overlayPermission();
    return result.granted === true;
  } catch {
    return false;
  }
}

export async function openOverlaySettings(): Promise<{ opened: boolean; granted: boolean }> {
  if (!umapLocationNative()) return { opened: false, granted: false };
  try {
    const result = await plugin.openOverlaySettings();
    return { opened: result.opened === true, granted: result.granted === true };
  } catch {
    return { opened: false, granted: false };
  }
}

export async function requestForegroundLocation(): Promise<'while-using' | 'denied' | 'unavailable'> {
  if (!umapLocationNative()) return 'unavailable';
  try {
    const result = await plugin.requestForeground();
    return result.location === 'while-using' || result.location === 'denied' ? result.location : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function requestNotificationPermission(): Promise<NativePromptResult> {
  if (!umapLocationNative()) return { state: 'unavailable', openedSettings: false };
  try {
    const result = await plugin.requestNotifications();
    const state = result.state === 'granted' || result.state === 'denied' ? result.state : 'unavailable';
    return { state, openedSettings: result.openedSettings === true };
  } catch {
    return { state: 'unavailable', openedSettings: false };
  }
}

export async function requestCameraPermission(): Promise<NativePromptResult> {
  if (!umapLocationNative()) return { state: 'unavailable', openedSettings: false };
  try {
    const result = await plugin.requestCamera();
    const state = result.state === 'granted' || result.state === 'denied' ? result.state : 'unavailable';
    return { state, openedSettings: result.openedSettings === true };
  } catch {
    return { state: 'unavailable', openedSettings: false };
  }
}

export async function requestMotionPermission(): Promise<NativePromptResult> {
  if (!umapLocationNative()) return { state: 'unavailable', openedSettings: false };
  try {
    const result = await plugin.requestMotion();
    const state = result.state === 'granted' || result.state === 'denied' ? result.state : 'unavailable';
    return { state, openedSettings: result.openedSettings === true };
  } catch {
    return { state: 'unavailable', openedSettings: false };
  }
}

export async function openBatteryOptimization(): Promise<BatteryOptimizationResult> {
  if (!umapLocationNative()) return { opened: false, unrestricted: false };
  try {
    const result = await plugin.openBattery();
    return { opened: result.opened === true, unrestricted: result.unrestricted === true };
  } catch {
    return { opened: false, unrestricted: false };
  }
}

export async function readNativeBattery(): Promise<NativeBattery> {
  if (!umapLocationNative()) return { pct: null, charging: null };
  try {
    const result = await plugin.battery();
    const pct = typeof result.pct === 'number' && result.pct >= 0 && result.pct <= 100 ? Math.round(result.pct) : null;
    const charging = result.charging === true ? true : result.charging === false ? false : null;
    return { pct, charging };
  } catch {
    return { pct: null, charging: null };
  }
}

export async function consumePendingChat(): Promise<{ code: string; peer: string } | null> {
  if (!umapLocationNative()) return null;
  try {
    const result = await plugin.consumePendingChat();
    const code = typeof result.code === 'string' ? result.code : '';
    const peer = typeof result.peer === 'string' ? result.peer.trim() : '';
    if (!/^\d{4,6}$/.test(code) || !peer) return null;
    return { code, peer: peer.slice(0, 20) };
  } catch {
    return null;
  }
}

export async function listenChatOpen(listener: (event: { code: string; peer: string }) => void): Promise<() => void> {
  if (!umapLocationNative()) return () => {};
  try {
    const handle = await plugin.addListener('chat', (event) => {
      const code = typeof event.code === 'string' ? event.code : '';
      const peer = typeof event.peer === 'string' ? event.peer.trim() : '';
      if (/^\d{4,6}$/.test(code) && peer) listener({ code, peer: peer.slice(0, 20) });
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}

export const umapLocation = plugin;
