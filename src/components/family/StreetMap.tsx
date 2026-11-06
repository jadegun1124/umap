import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { noteDiag } from '../../lib/diagLog.mjs';
import { hasLocation } from '../../lib/geo';
import { MEMBER_PIN_PX, memberCalloutHtml, memberPinIcon, spreadPinPositions } from '../../lib/mapPinSpread.mjs';
import { savedPlaceLabel } from '../../lib/memberPlace.mjs';
import { memberIsStale, memberPresence, pinAgeLabel } from '../../lib/memberPresence.mjs';
import { appendLiveTip, trailDrawParts } from '../../lib/tracking.mjs';
import { VWORLD_ATTRIBUTION, vworldApiKey, vworldBaseTileUrl } from '../../services/vworld';
import type { HomeZone, Member, TrackPoint } from '../../types/family';

export interface StreetMapHandle {
  panTo: (lat: number, lng: number) => void;
  followTo: (lat: number, lng: number) => void;
  showMember: (lat: number, lng: number) => void;
  zoomBy: (delta: number) => void;
  fit: (points: { lat: number; lng: number }[]) => void;
  getCenter: () => { lat: number; lng: number };
  invalidateSize: () => void;
  setPlayback: (frame: { lat: number; lng: number; label: string } | null, follow?: boolean) => void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function batteryMarkup(member: Member, selected: boolean): string {
  if (member.battery == null) return '';
  const pct = Math.max(0, Math.min(100, Math.round(member.battery)));
  const charging = member.charging === true;
  const color = selected ? '#ffffff' : pct <= 20 ? '#dc2626' : '#334155';
  const bolt = charging
    ? `<svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path fill="${selected ? '#ffffff' : '#d97706'}" d="M13 2 4 14h7l-1 8 10-14h-7l0-6z"/></svg>`
    : '';
  return `<span style="display:inline-flex;align-items:center;gap:2px;margin-left:4px;color:${color};font-weight:800">${batteryIcon(pct, color)}<span>${pct}%</span>${bolt}</span>`;
}

function batteryIcon(pct: number, color: string): string {
  const fillWidth = Math.max(1, Math.round((pct / 100) * 12));
  return `<svg width="16" height="12" viewBox="0 0 20 12" aria-hidden="true"><rect x="0.75" y="1.25" width="16.5" height="9.5" rx="2" fill="none" stroke="${color}" stroke-width="1.4"/><rect x="17.6" y="4" width="1.6" height="4" rx="0.6" fill="${color}"/><rect x="2.2" y="3" width="${fillWidth}" height="6" rx="1" fill="${color}"/></svg>`;
}

export const StreetMap = forwardRef<StreetMapHandle, {
  center: { lat: number; lng: number };
  zoom: number;
  members: Member[];
  home: HomeZone | null;
  trails: TrackPoint[][];
  trailColor: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onMove?: (center: { lat: number; lng: number }) => void;
  /** Pinch, drag, or the zoom buttons. Programmatic fit and playback pan do not call this. */
  onUserView?: () => void;
  /** User drag or pinch. Cancels a follow pan already in flight. */
  onGesture?: () => void;
}>(function StreetMap({ center, zoom, members, home, trails, trailColor, selectedId, onSelect, onClear, onMove, onUserView, onGesture }, ref) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const trailRef = useRef<L.LayerGroup | null>(null);
  const playbackRef = useRef<L.Marker | null>(null);
  const playbackPanRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [tileNote, setTileNote] = useState('');
  const key = vworldApiKey();
  const initialRef = useRef({ center, zoom });
  const onSelectRef = useRef(onSelect);
  const onClearRef = useRef(onClear);
  const onMoveRef = useRef(onMove);
  const onUserViewRef = useRef(onUserView);
  const onGestureRef = useRef(onGesture);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onClearRef.current = onClear;
    onMoveRef.current = onMove;
    onUserViewRef.current = onUserView;
    onGestureRef.current = onGesture;
  });

  useImperativeHandle(ref, () => ({
    panTo(lat, lng) {
      mapRef.current?.panTo([lat, lng], { animate: true });
    },
    followTo(lat, lng) {
      const map = mapRef.current;
      if (!map) return;
      const dragging = map.dragging as { _dragging?: boolean } | undefined;
      if (dragging?._dragging) return;
      map.panTo([lat, lng], { animate: true, duration: 0.65, easeLinearity: 0.2 });
    },
    showMember(lat, lng) {
      const map = mapRef.current;
      if (!map) return;
      map.setView([lat, lng], Math.min(19, Math.max(map.getZoom(), 17)), { animate: true });
      onUserViewRef.current?.();
    },
    zoomBy(delta) {
      const map = mapRef.current;
      if (!map) return;
      map.setZoom(Math.min(19, Math.max(7, map.getZoom() + delta)));
      onUserViewRef.current?.();
      onGestureRef.current?.();
    },
    fit(points) {
      const map = mapRef.current;
      if (!map || points.length < 1) return;
      if (points.length === 1) {
        map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 16), { animate: true });
        return;
      }
      map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng])), {
        padding: [48, 48],
        maxZoom: 17,
        animate: true,
      });
    },
    getCenter() {
      const current = mapRef.current?.getCenter();
      return current ? { lat: current.lat, lng: current.lng } : center;
    },
    invalidateSize() {
      mapRef.current?.invalidateSize();
    },
    setPlayback(frame, follow) {
      const map = mapRef.current;
      if (!map) return;
      if (!frame) {
        playbackRef.current?.remove();
        playbackRef.current = null;
        return;
      }
      let marker = playbackRef.current;
      if (!marker) {
        marker = L.marker([frame.lat, frame.lng], {
          interactive: false,
          zIndexOffset: 900,
          icon: L.divIcon({
            className: 'umap-playback',
            html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%)">
              <span data-playback-label style="margin-bottom:4px;padding:3px 8px;border-radius:999px;background:#0f172a;color:#fff;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 1px 4px rgba(15,23,42,.2)"></span>
              <span style="width:16px;height:16px;border-radius:999px;background:#0084FF;border:3px solid #fff;box-shadow:0 2px 6px rgba(15,23,42,.28)"></span>
            </div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
        }).addTo(map);
        playbackRef.current = marker;
      }
      marker.setLatLng([frame.lat, frame.lng]);
      const caption = marker.getElement()?.querySelector('[data-playback-label]');
      if (caption) caption.textContent = frame.label;
      if (!follow) return;
      const dragging = map.dragging as { _dragging?: boolean } | undefined;
      if (dragging?._dragging) return;
      if (map.getBounds().pad(-0.16).contains([frame.lat, frame.lng])) return;
      const now = performance.now();
      if (now - playbackPanRef.current < 700) return;
      playbackPanRef.current = now;
      // Follow the marker without changing the zoom the user chose.
      map.panTo([frame.lat, frame.lng], { animate: true, duration: 0.45, easeLinearity: 0.25 });
    },
  }));

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || mapRef.current) return;
    const start = initialRef.current;
    const map = L.map(node, {
      center: [start.center.lat, start.center.lng],
      zoom: start.zoom,
      zoomControl: false,
      attributionControl: true,
      minZoom: 6,
      maxZoom: 19,
    });
    map.attributionControl.setPosition('bottomleft');
    trailRef.current = L.layerGroup().addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    let moveTick = 0;
    const emitMove = () => {
      const current = map.getCenter();
      onMoveRef.current?.({ lat: current.lat, lng: current.lng });
    };
    map.on('move', () => {
      window.clearTimeout(moveTick);
      moveTick = window.setTimeout(emitMove, 80);
    });
    map.on('moveend', emitMove);
    map.on('click', () => onClearRef.current?.());
    const noteUserView = (event: L.LeafletEvent) => {
      if (!(event as L.LeafletEvent & { originalEvent?: Event }).originalEvent) return;
      onUserViewRef.current?.();
      onGestureRef.current?.();
    };
    map.on('zoomstart', noteUserView);
    map.on('dragstart', () => {
      map.stop();
      onUserViewRef.current?.();
      onGestureRef.current?.();
    });
    setReady(true);
    const resize = () => map.invalidateSize();
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    const timer = window.setTimeout(resize, 250);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(moveTick);
      observer.disconnect();
      setReady(false);
      map.off('move');
      map.off('moveend');
      map.off('click');
      map.off('zoomstart', noteUserView);
      map.off('dragstart');
      playbackRef.current = null;
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
      trailRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !key) return;
    const tiles = L.tileLayer(vworldBaseTileUrl(key), {
      attribution: VWORLD_ATTRIBUTION,
      minZoom: 6,
      maxZoom: 19,
      // 브이월드 Base는 한국 영역만 제공한다. 영역 밖 404가 키 오류로 남지 않게 한다.
      bounds: L.latLngBounds([32.8, 124.0], [39.8, 132.1]),
    });
    tiles.addTo(map);
    let loads = 0;
    const report = () => {
      if (loads > 0) return;
      const origin = window.location.origin;
      setTileNote(`브이월드 지도를 불러오지 못했습니다. 키는 이 빌드에 있습니다. 인증키 도메인에 ${origin} 을 등록해 주세요.`);
    };
    tiles.on('tileload', () => {
      loads += 1;
      setTileNote('');
    });
    const watchdog = window.setTimeout(report, 8000);
    return () => {
      window.clearTimeout(watchdog);
      tiles.off();
      map.removeLayer(tiles);
    };
  }, [key, ready]);

  useEffect(() => {
    const group = layersRef.current;
    if (!ready || !group) return;
    group.clearLayers();

    if (home) {
      L.circle([home.lat, home.lng], {
        radius: home.radiusM,
        color: '#0084FF',
        weight: 2,
        fillColor: '#0084FF',
        fillOpacity: 0.14,
      }).addTo(group);
      L.marker([home.lat, home.lng], {
        interactive: false,
        icon: L.divIcon({
          className: 'umap-home-label',
          html: '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fff;color:#0f172a;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(15,23,42,.16)">우리 집</span>',
          iconSize: [64, 22],
          iconAnchor: [32, 28],
        }),
      }).addTo(group);
    }

    const pins = spreadPinPositions(members);
    const pinIcon = memberPinIcon();
    const faceBox = `width:${MEMBER_PIN_PX}px;height:${MEMBER_PIN_PX}px;box-sizing:border-box;border-radius:999px;border:4px solid #fff;box-shadow:0 6px 16px rgba(15,23,42,.2)`;
    for (const member of members) {
      if (!hasLocation(member)) continue;
      const at = pins.get(member.id) || { lat: member.lat, lng: member.lng, dx: 0, dy: 0 };
      const selected = member.id === selectedId;
      const presence = memberPresence(member, Date.now());
      const dimmed = memberIsStale(presence);
      const age = escapeHtml(pinAgeLabel(presence));
      const color = '#0084FF';
      const self = member.role === 'self';
      const label = escapeHtml(self ? '나' : member.name);
      const savedPlace = savedPlaceLabel(member.lat, member.lng, home);
      const placeText = savedPlace || (typeof member.place === 'string' ? member.place.trim() : '');
      const place = placeText && placeText !== '근처' ? escapeHtml(placeText) : '';
      const initial = escapeHtml(self ? '나' : member.name.slice(0, 1));
      const battery = batteryMarkup(member, selected);
      const photo = typeof member.photo === 'string' && member.photo.startsWith('data:image/') && member.photo.length < 120_000
        ? member.photo
        : '';
      const face = photo
        ? `<img alt="" src="${escapeHtml(photo)}" style="${faceBox};object-fit:cover"/>`
        : `<span style="${faceBox};background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900">${initial}</span>`;
      const marker = L.marker([at.lat, at.lng], {
        zIndexOffset: selected ? 800 : 400,
        icon: L.divIcon({
          className: 'umap-member-pin',
          html: memberCalloutHtml({
            dx: at.dx,
            dy: at.dy,
            dimmed,
            tailColor: selected ? '#0084FF' : '#fff',
            labelHtml: `<span data-label style="display:inline-flex;flex-direction:column;align-items:center;margin-bottom:4px;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;max-width:180px;box-shadow:0 1px 4px rgba(15,23,42,.16);background:${selected ? '#0084FF' : '#fff'};color:${selected ? '#fff' : '#0f172a'}"><span style="display:inline-flex;align-items:center;white-space:nowrap">${label}${battery}</span>${place ? `<span style="display:block;max-width:164px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600;opacity:.85">${place}</span>` : ''}${age ? `<span style="display:block;max-width:164px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:700;opacity:.9">${age}</span>` : ''}</span>`,
            faceHtml: face,
          }),
          iconSize: pinIcon.iconSize,
          iconAnchor: pinIcon.iconAnchor,
        }),
      });
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        onSelectRef.current(member.id);
      });
      marker.addTo(group);
    }
  }, [home, members, ready, selectedId]);

  useEffect(() => {
    const trailGroup = trailRef.current;
    if (!ready || !trailGroup) return;
    trailGroup.clearLayers();
    const stroke = { smoothFactor: 0, lineCap: 'round' as const, lineJoin: 'round' as const };
    const drawn: string[] = [];
    let pointCount = 0;
    for (const trail of trails) {
      if (!trail || trail.length < 2) continue;
      const parts = appendLiveTip(trailDrawParts(trail), trail[trail.length - 1]);
      if (parts.length === 0) continue;
      for (const part of parts) {
        pointCount += part.points.length;
        drawn.push(part.points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(' '));
        const latlngs = part.points.map((point) => [point.lat, point.lng] as [number, number]);
        L.polyline(latlngs, {
          ...stroke,
          color: '#ffffff',
          weight: 9,
          opacity: 0.9,
        }).addTo(trailGroup);
        L.polyline(latlngs, {
          ...stroke,
          color: trailColor,
          weight: 6,
          opacity: 1,
        }).addTo(trailGroup);
      }
      const start = parts[0]?.points[0] ?? trail[0];
      if (!start) continue;
      L.circleMarker([start.lat, start.lng], {
        radius: 5,
        color: trailColor,
        weight: 2,
        fillColor: trailColor,
        fillOpacity: 1,
      }).addTo(trailGroup);
      const end = parts[parts.length - 1]?.points.at(-1) ?? trail[trail.length - 1];
      if (end && (end.lat !== start.lat || end.lng !== start.lng)) {
        L.circleMarker([end.lat, end.lng], {
          radius: 6,
          color: trailColor,
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(trailGroup);
      }
    }
    if (nodeRef.current) nodeRef.current.dataset.trail = drawn.join(';');
    noteDiag({ kind: 'render', points: pointCount, segments: drawn.length });
  }, [ready, trails, trailColor]);

  const missingKey = !key;

  return (
    <div className="relative h-full min-h-[240px] w-full">
      <div ref={nodeRef} className="umap-street-map h-full min-h-[240px] w-full" />
      {(missingKey || tileNote) && (
        <div className="pointer-events-none absolute inset-x-4 top-16 z-20 rounded-2xl bg-white/95 px-4 py-3 text-center text-sm font-semibold leading-6 text-slate-700 shadow">
          {missingKey
            ? 'VWorld 지도 키가 이 빌드에 없습니다. APK와 Pages는 빌드 시 VITE_VWORLD_API_KEY가 있어야 타일을 받습니다.'
            : tileNote}
        </div>
      )}
    </div>
  );
});
