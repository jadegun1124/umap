import { realtimeApi } from './api';
import { gpsPipeline, GpsFilteredResult } from '../utils/gpsFilter';

export interface RealGpsLocation {
  lat: number;
  lng: number;
  rawLat: number;
  rawLng: number;
  speed: number;
  accuracy: number;
  timestamp: string;
  isAccepted: boolean;
  rejectReason?: string;
  kalmanGain: number;
}

export type GpsEventListener = (result: GpsFilteredResult) => void;

export class BrowserGeolocationTracker {
  private watchId: number | null = null;
  private isTracking: boolean = false;
  private deviceId: string = 'my-real-device';
  private resultListeners: GpsEventListener[] = [];
  private wakeLockSentinel: any = null;

  // Request WakeLock so smartphone screen stays awake during active tracking
  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      }
    } catch (err) {
      console.warn('[WakeLock] Unable to acquire wake lock:', err);
    }
  }

  private releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
      } catch (e) {
        // ignore
      }
      this.wakeLockSentinel = null;
    }
  }

  start(deviceId: string, onResult: GpsEventListener): boolean {
    if (!('geolocation' in navigator)) {
      alert('이 브라우저는 실제 GPS 위치 서비스를 지원하지 않습니다.');
      return false;
    }

    this.deviceId = deviceId;
    if (!this.resultListeners.includes(onResult)) {
      this.resultListeners.push(onResult);
    }

    if (this.isTracking) {
      return true;
    }

    this.isTracking = true;
    this.requestWakeLock();

    this.watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude, speed, accuracy, altitude } = pos.coords;
        const timestamp = pos.timestamp || Date.now();

        // ------------------------------------------------------------------
        // Execute the 4 GPS Algorithms in the HighAccuracyGpsPipeline:
        // ① Accuracy filter (<=50m) & Freshness filter (<=10s)
        // ② Distance filter (>=5m movement noise reduction)
        // ③ Kalman Filter coordinate smoothing
        // ④ Velocity Sanity Check (<145km/h jump discard)
        // ------------------------------------------------------------------
        const result = gpsPipeline.processReading({
          lat: latitude,
          lng: longitude,
          accuracy: accuracy || 10,
          timestamp,
          speed: speed ?? 0,
          altitude: altitude ?? null,
        });

        // Notify all subscribers of the processed & filtered outcome
        this.resultListeners.forEach((fn) => {
          try {
            fn(result);
          } catch (e) {
            console.error('[GpsTracker Listener Error]', e);
          }
        });

        // If the reading passes all 4 algorithms, transmit to backend server
        if (result.isAccepted) {
          await realtimeApi.sendGpsPoint(
            this.deviceId,
            result.lat,
            result.lng,
            result.speedKmH
          );
        }
      },
      (err) => {
        console.warn('[Real GPS] Geolocation permission or signal error:', err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    return true;
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
    this.resultListeners = [];
    this.releaseWakeLock();
  }

  getStatus() {
    return this.isTracking;
  }

  getPipelineMetrics() {
    return gpsPipeline.metrics;
  }
}

export const liveGeoTracker = new BrowserGeolocationTracker();
