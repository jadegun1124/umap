import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { noteDiag } from '../../lib/diagLog.mjs';
import { hasLocation } from '../../lib/geo';
import { baseTileLayerOptions } from '../../lib/mapTiles.mjs';
import { MEMBER_PIN_PX, markerZIndex, memberCalloutHtml, memberPinIcon, spreadPinPositions, syncCalloutGeometry } from '../../lib/mapPinSpread.mjs';
import { savedPlaceLabel } from '../../lib/memberPlace.mjs';
import { memberIsDimmed, memberPresence, pinAgeLabel } from '../../lib/memberPresence.mjs';
import { firstPlaceLabel, groupPinShiftY, groupStatusLabelHtml, orderStatusMembers } from '../../lib/memberStatusGroup.mjs';
import { assignChipOffsets, groupChipSize, holdSpread, inflateRect, soloChipSize, stablePlaceGroups, stickyStatusHost } from '../../lib/statusLayout.mjs';
import { displaySolidTrail, DISPLAY_TRAIL_CAP, trailGeometryKey } from '../../lib/displayTrail.mjs';
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
  /** Re-place chips after a button or banner appears. No-op while a finger is down. */
  nudgeLayout: () => void;
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

type HeldMarker = { marker: L.Marker; html: string; contentKey: string };

function memberIdFromEvent(event: { originalEvent?: Event }): string {
  const target = event.originalEvent?.target;
  const el = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  return el?.closest('[data-member-id]')?.getAttribute('data-member-id') || '';
}

function memberPlaceText(member: Member, home: HomeZone | null): string {
  if (!hasLocation(member)) return '';
  const savedPlace = savedPlaceLabel(member.lat, member.lng, home);
  const placeText = savedPlace || (typeof member.place === 'string' ? member.place.trim() : '');
  return placeText && placeText !== '근처' ? placeText : '';
}

function soloLabelHtml(member: Member, home: HomeZone | null, selected: boolean, now: number): string {
  const presence = memberPresence(member, now);
  const age = escapeHtml(pinAgeLabel(presence));
  const label = escapeHtml(member.role === 'self' ? '나' : member.name);
  const place = escapeHtml(memberPlaceText(member, home));
  const battery = batteryMarkup(member, selected);
  return `<span data-label style="display:inline-flex;flex-direction:column;align-items:center;margin-bottom:4px;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;max-width:180px;box-shadow:0 1px 2px rgba(15,23,42,.16);background:${selected ? '#0084FF' : '#fff'};color:${selected ? '#fff' : '#0f172a'}"><span style="display:inline-flex;align-items:center;white-space:nowrap">${label}${battery}</span>${place ? `<span style="display:block;max-width:164px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:600;opacity:.85">${place}</span>` : ''}${age ? `<span style="display:block;max-width:164px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:700;opacity:.9">${age}</span>` : ''}</span>`;
}

function groupLabelHtml(members: Member[], home: HomeZone | null, selectedId: string | undefined, now: number): string {
  const rows = orderStatusMembers(members).map((member) => {
    const selected = member.id === selectedId;
    const presence = memberPresence(member, now);
    return {
      id: member.id,
      name: member.role === 'self' ? '나' : member.name,
      batteryHtml: batteryMarkup(member, selected),
      age: pinAgeLabel(presence),
      dimmed: memberIsDimmed(presence),
      selected,
    };
  });
  return groupStatusLabelHtml({ place: firstPlaceLabel(members, (member) => memberPlaceText(member, home)), rows });
}

function pinFaceHtml(member: Member): string {
  const color = '#0084FF';
  const self = member.role === 'self';
  const initial = escapeHtml(self ? '나' : member.name.slice(0, 1));
  const faceBox = `width:${MEMBER_PIN_PX}px;height:${MEMBER_PIN_PX}px;box-sizing:border-box;border-radius:999px;border:4px solid #fff;box-shadow:0 1px 2px rgba(15,23,42,.28)`;
  const photo = typeof member.photo === 'string' && member.photo.startsWith('data:image/') && member.photo.length < 120_000
    ? member.photo
    : '';
  return photo
    ? `<img alt="" src="${escapeHtml(photo)}" style="${faceBox};object-fit:cover"/>`
    : `<span style="${faceBox};background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900">${initial}</span>`;
}

function paintHeld(held: HeldMarker, contentKey: string, html: string, icon: L.DivIcon, offset: { dx: number; dy: number }) {
  const el = held.marker.getElement();
  if (el && held.contentKey === contentKey) {
    syncCalloutGeometry(el, offset.dx, offset.dy);
    held.html = html;
    return;
  }
  if (el) {
    el.innerHTML = html;
    held.contentKey = contentKey;
    held.html = html;
    return;
  }
  held.marker.setIcon(icon);
  held.contentKey = contentKey;
  held.html = html;
}

function measuredCalloutSize(marker: L.Marker | undefined, fallback: { width: number; height: number }) {
  const callout = marker?.getElement()?.querySelector('[data-callout]');
  if (!(callout instanceof HTMLElement)) return fallback;
  const box = callout.getBoundingClientRect();
  if (box.width < 8 || box.height < 8 || box.width > 280 || box.height > 360) return fallback;
  return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
}

function dropHeld(store: Map<string, HeldMarker>, keep: Set<string>) {
  for (const [id, held] of store) {
    if (keep.has(id)) continue;
    held.marker.remove();
    store.delete(id);
  }
}

function movedEnough(marker: L.Marker, lat: number, lng: number): boolean {
  const at = marker.getLatLng();
  if (!at) return true;
  const dLat = ((at.lat - lat) * Math.PI) / 180;
  const dLng = ((at.lng - lng) * Math.PI) / 180;
  const lat1 = (at.lat * Math.PI) / 180;
  const lat2 = (lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h))) > 0.4;
}

function markHeld(marker: L.Marker, lat: number, lng: number, dx: number, dy: number) {
  const el = marker.getElement();
  if (!el) return;
  el.dataset.heldLat = lat.toFixed(7);
  el.dataset.heldLng = lng.toFixed(7);
  el.dataset.offsetX = String(dx);
  el.dataset.offsetY = String(dy);
}

function measureObstacles(map: L.Map) {
  const container = map.getContainer();
  const host = container.parentElement?.parentElement;
  if (!host) return [];
  const origin = container.getBoundingClientRect();
  const rects: { left: number; right: number; top: number; bottom: number }[] = [];
  host.querySelectorAll('[data-map-obstacle]').forEach((node) => {
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return;
    rects.push(inflateRect({
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top,
    }, 6));
  });
  return rects;
}

export const StreetMap = forwardRef<StreetMapHandle, {
  center: { lat: number; lng: number };
  zoom: number;
  members: Member[];
  home: HomeZone | null;
  trails: TrackPoint[][];
  trailColor: string;
  /** Records detail. One solid line, display vertices only. The live map keeps its own painter. */
  solidTrails?: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
  onClear?: () => void;
  onMove?: (center: { lat: number; lng: number }) => void;
  /** Pinch, drag, or the zoom buttons. Programmatic fit and playback pan do not call this. */
  onUserView?: () => void;
  /** User drag or pinch. Cancels a follow pan already in flight. */
  onGesture?: () => void;
  /** After the finger lifts. The follow chip updates here, not on the drag frame. */
  onGestureEnd?: () => void;
}>(function StreetMap({ center, zoom, members, home, trails, trailColor, solidTrails = false, selectedId, onSelect, onClear, onMove, onUserView, onGesture, onGestureEnd }, ref) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);
  const trailRef = useRef<L.LayerGroup | null>(null);
  const pinMarkersRef = useRef(new Map<string, HeldMarker>());
  const statusAnchorRef = useRef(new Map<string, string>());
  const statusHostRef = useRef(new Map<string, string>());
  const hostShiftRef = useRef(new Map<string, { dx: number; dy: number }>());
  const groupsRef = useRef<Array<{ key: string; members: Member[]; anchor: { lat: number; lng: number }; anchorId: string }>>([]);
  const spreadRef = useRef(new Map<string, { lat: number; lng: number; dx: number; dy: number }>());
  const offsetsRef = useRef(new Map<string, { dx: number; dy: number }>());
  const movingRef = useRef(false);
  const layoutFrameRef = useRef(0);
  const layoutRef = useRef<() => void>(() => {});
  const placeRef = useRef<(reason?: 'data' | 'moveend' | 'obstacle') => void>(() => {});
  const membersRef = useRef(members);
  const homeRef = useRef(home);
  const selectedIdRef = useRef(selectedId);
  membersRef.current = members;
  homeRef.current = home;
  selectedIdRef.current = selectedId;
  const playbackRef = useRef<L.Marker | null>(null);
  const playbackPanRef = useRef(0);
  const homeLayersRef = useRef<{ circle: L.Circle; label: L.Marker } | null>(null);
  const drawnTrailKeyRef = useRef('');
  const trailsDirtyRef = useRef(false);
  const paintTrailsRef = useRef<() => void>(() => {});
  const renderNotedAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [tileNote, setTileNote] = useState('');
  const key = vworldApiKey();
  const initialRef = useRef({ center, zoom });
  const onSelectRef = useRef(onSelect);
  const onClearRef = useRef(onClear);
  const onMoveRef = useRef(onMove);
  const onUserViewRef = useRef(onUserView);
  const onGestureRef = useRef(onGesture);
  const onGestureEndRef = useRef(onGestureEnd);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onClearRef.current = onClear;
    onMoveRef.current = onMove;
    onUserViewRef.current = onUserView;
    onGestureRef.current = onGesture;
    onGestureEndRef.current = onGestureEnd;
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
      // setZoom has no original event, so zoomend would not reveal 내 위치로.
      onGestureEndRef.current?.();
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
    nudgeLayout() {
      if (movingRef.current) return;
      layoutRef.current();
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
      // Pinch keeps the fractional zoom under the fingers. Integer buttons still add 1.
      zoomSnap: 0,
      zoomDelta: 1,
      inertia: true,
      inertiaDeceleration: 3000,
      zoomAnimation: true,
      // Markers stay in the scaled pane. Per-frame setLatLng during a pinch
      // restyled the status chip on the gesture frames.
      markerZoomAnimation: false,
      fadeAnimation: true,
      bounceAtZoomLimits: false,
    });
    map.attributionControl.setPosition('bottomleft');
    trailRef.current = L.layerGroup().addTo(map);
    layersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    Object.defineProperty(node, '__kinnexMap', { value: map, configurable: true });
    let moveFrame = 0;
    let userGesture = false;
    const emitMove = () => {
      moveFrame = 0;
      const current = map.getCenter();
      onMoveRef.current?.({ lat: current.lat, lng: current.lng });
    };
    // One center read per frame. Home placement is the only listener that writes state.
    map.on('move', () => {
      if (moveFrame) return;
      moveFrame = window.requestAnimationFrame(emitMove);
    });
    map.on('moveend', () => {
      if (moveFrame) window.cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      emitMove();
    });
    map.on('click', () => onClearRef.current?.());
    let moveSafety = 0;
    let endFrame = 0;
    const gestureActive = () => {
      const handlers = [map.dragging, map.touchZoom, map.boxZoom];
      for (const handler of handlers) {
        if (!handler) continue;
        const active = handler as { moving?: () => boolean; _zooming?: boolean; _moving?: boolean };
        if (typeof active.moving === 'function' && active.moving()) return true;
        if (active._zooming === true || active._moving === true) return true;
      }
      return false;
    };
    const armSafety = () => {
      window.clearTimeout(moveSafety);
      // A stuck animation still lays out once. A finger or pinch that is still down waits.
      moveSafety = window.setTimeout(() => {
        if (!movingRef.current) return;
        if (gestureActive()) {
          armSafety();
          return;
        }
        movingRef.current = false;
        map.getContainer().classList.remove('umap-gesturing');
        const gesture = userGesture;
        userGesture = false;
        if (trailsDirtyRef.current) {
          trailsDirtyRef.current = false;
          paintTrailsRef.current();
        }
        if (gesture) onGestureEndRef.current?.();
        placeRef.current('moveend');
      }, 1200);
    };
    const onMoveStart = () => {
      movingRef.current = true;
      map.getContainer().classList.add('umap-gesturing');
      armSafety();
    };
    const onMoveEnd = () => {
      window.clearTimeout(moveSafety);
      const gesture = userGesture;
      userGesture = false;
      movingRef.current = false;
      map.getContainer().classList.remove('umap-gesturing');
      if (trailsDirtyRef.current) {
        trailsDirtyRef.current = false;
        paintTrailsRef.current();
      }
      if (gesture) onGestureEndRef.current?.();
      // zoomend and moveend both fire for a pinch. One layout after the frame.
      if (endFrame) return;
      endFrame = window.requestAnimationFrame(() => {
        endFrame = 0;
        if (movingRef.current) return;
        placeRef.current('moveend');
      });
    };
    map.on('movestart', onMoveStart);
    map.on('zoomstart', onMoveStart);
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);
    const noteUserView = (event: L.LeafletEvent) => {
      if (!(event as L.LeafletEvent & { originalEvent?: Event }).originalEvent) return;
      userGesture = true;
      onUserViewRef.current?.();
      onGestureRef.current?.();
    };
    map.on('zoomstart', noteUserView);
    // Leaflet already stops a pan animation before dragstart. Calling the public
    // stop method here would setZoom and reset the pane under the finger.
    map.on('dragstart', () => {
      userGesture = true;
      movingRef.current = true;
      map.getContainer().classList.add('umap-gesturing');
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
      if (moveFrame) window.cancelAnimationFrame(moveFrame);
      if (endFrame) window.cancelAnimationFrame(endFrame);
      window.clearTimeout(moveSafety);
      if (movingRef.current || userGesture) {
        userGesture = false;
        movingRef.current = false;
        onGestureEndRef.current?.();
      }
      if (layoutFrameRef.current) window.cancelAnimationFrame(layoutFrameRef.current);
      observer.disconnect();
      setReady(false);
      map.off('move');
      map.off('moveend');
      map.off('movestart', onMoveStart);
      map.off('zoomstart', onMoveStart);
      map.off('zoomend', onMoveEnd);
      map.off('click');
      map.off('zoomstart', noteUserView);
      map.off('dragstart');
      playbackRef.current = null;
      homeLayersRef.current = null;
      drawnTrailKeyRef.current = '';
      pinMarkersRef.current.forEach((held) => held.marker.remove());
      pinMarkersRef.current.clear();
      statusAnchorRef.current.clear();
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
      ...baseTileLayerOptions(),
      attribution: VWORLD_ATTRIBUTION,
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
    const place = (reason: 'data' | 'moveend' | 'obstacle' = 'data') => {
      const group = layersRef.current;
      const map = mapRef.current;
      const people = membersRef.current;
      const zone = homeRef.current;
      const selected = selectedIdRef.current;
      if (!ready || !group || !map) return;
      // A finger or pinch owns the frame. Members that arrive now wait for moveend.
      if (movingRef.current && reason !== 'moveend') return;
      if (nodeRef.current) {
        nodeRef.current.dataset.layoutRuns = String(Number(nodeRef.current.dataset.layoutRuns || 0) + 1);
      }
      const paintHome = () => {
        const held = homeLayersRef.current;
        if (!zone) {
          if (held) {
            held.circle.remove();
            held.label.remove();
            homeLayersRef.current = null;
          }
          return;
        }
        if (held) {
          held.circle.setLatLng([zone.lat, zone.lng]);
          held.circle.setRadius(zone.radiusM);
          held.label.setLatLng([zone.lat, zone.lng]);
          return;
        }
        const circle = L.circle([zone.lat, zone.lng], {
          radius: zone.radiusM,
          color: '#0084FF',
          weight: 2,
          fillColor: '#0084FF',
          fillOpacity: 0.14,
        }).addTo(group);
        const label = L.marker([zone.lat, zone.lng], {
          interactive: false,
          icon: L.divIcon({
            className: 'umap-home-label',
            html: '<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#fff;color:#0f172a;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(15,23,42,.16)">우리 집</span>',
            iconSize: [64, 22],
            iconAnchor: [32, 28],
          }),
        }).addTo(group);
        homeLayersRef.current = { circle, label };
      };
      if (reason === 'data') {
        group.clearLayers();
        homeLayersRef.current = null;
        paintHome();
      } else {
        // Finger-up still moves the ring, and still removes it when the pick was cancelled.
        paintHome();
      }

      const now = Date.now();
      const pins = holdSpread(spreadRef.current, spreadPinPositions(people));
      spreadRef.current = pins;
      const pinIcon = memberPinIcon();
      const clusters = stablePlaceGroups(people, groupsRef.current);
      groupsRef.current = clusters;
      const anchorIds = new Map<string, string>();
      const hosted = new Set<string>();
      for (const cluster of clusters) {
        if (cluster.members.length < 2) continue;
        const host = stickyStatusHost(
          cluster.members.map((member) => member.id),
          statusHostRef.current,
          cluster.anchorId,
        );
        anchorIds.set(cluster.key, host);
        for (const member of cluster.members) {
          const id = String(member.id);
          statusHostRef.current.set(id, host);
          hosted.add(id);
        }
        const shiftKey = `status:${cluster.key}`;
        if (!offsetsRef.current.has(shiftKey)) {
          const remembered = hostShiftRef.current.get(host);
          if (remembered) offsetsRef.current.set(shiftKey, remembered);
        }
      }
      for (const id of [...statusHostRef.current.keys()]) {
        if (!hosted.has(id)) statusHostRef.current.delete(id);
      }
      statusAnchorRef.current = anchorIds;
      const clusterOf = new Map(clusters.flatMap((cluster) => cluster.members.map((member) => [member.id, cluster] as const)));
      const seenPins = new Set<string>();
      for (const member of people) {
        if (!hasLocation(member)) continue;
        seenPins.add(member.id);
        const at = pins.get(member.id) || { lat: member.lat, lng: member.lng, dx: 0, dy: 0 };
        const cluster = clusterOf.get(member.id);
        const grouped = (cluster?.members.length || 0) > 1;
        const anchorId = grouped && cluster ? anchorIds.get(cluster.key) : '';
        const isAnchor = !!anchorId && anchorId === member.id;
        const chosen = isAnchor
          ? offsetsRef.current.get(`status:${cluster?.key}`) || { dx: 0, dy: groupPinShiftY(MEMBER_PIN_PX) }
          : !grouped
            ? offsetsRef.current.get(`pin:${member.id}`) || null
            : null;
        const dx = chosen ? chosen.dx : grouped ? 0 : at.dx;
        const dy = chosen ? chosen.dy : grouped ? 0 : at.dy;
        const isSelected = member.id === selected;
        const presence = memberPresence(member, now);
        const dimmed = memberIsDimmed(presence);
        const labelHtml = isAnchor && cluster
          ? groupLabelHtml(cluster.members, zone, selected, now)
          : grouped
            ? ''
            : soloLabelHtml(member, zone, isSelected, now);
        const faceHtml = pinFaceHtml(member);
        const contentKey = `${isAnchor ? 'g' : grouped ? 'm' : 's'}|${dimmed ? 1 : 0}|${labelHtml}|${faceHtml}`;
        const html = memberCalloutHtml({
          dx,
          dy,
          dimmed,
          tailColor: isSelected ? '#0084FF' : '#fff',
          labelHtml,
          faceHtml,
        });
        const raised = isAnchor && !!cluster?.members.some((item) => item.id === selected);
        const zIndex = isAnchor ? (raised ? 3000 : 2500) : markerZIndex(dy, isSelected);
        const icon = L.divIcon({
          className: isAnchor ? 'umap-member-pin umap-member-status' : 'umap-member-pin',
          html,
          iconSize: pinIcon.iconSize,
          iconAnchor: pinIcon.iconAnchor,
        });
        const held = pinMarkersRef.current.get(member.id);
        if (held) {
          if (movedEnough(held.marker, at.lat, at.lng)) held.marker.setLatLng([at.lat, at.lng]);
          held.marker.setZIndexOffset(zIndex);
          const iconEl = held.marker.getElement();
          if (iconEl) iconEl.classList.toggle('umap-member-status', isAnchor);
          paintHeld(held, contentKey, html, icon, { dx, dy });
          const placed = held.marker.getLatLng();
          markHeld(held.marker, placed?.lat ?? at.lat, placed?.lng ?? at.lng, dx, dy);
          continue;
        }
        const marker = L.marker([at.lat, at.lng], { icon, zIndexOffset: zIndex });
        marker.on('click', (event) => {
          L.DomEvent.stopPropagation(event);
          onSelectRef.current(memberIdFromEvent(event) || member.id);
        });
        marker.addTo(map);
        pinMarkersRef.current.set(member.id, { marker, html, contentKey });
        markHeld(marker, at.lat, at.lng, dx, dy);
      }
      dropHeld(pinMarkersRef.current, seenPins);
      for (const key of [...statusAnchorRef.current.keys()]) {
        if (!anchorIds.has(key)) statusAnchorRef.current.delete(key);
      }

      if (reason !== 'obstacle') scheduleLayout();
    };
    const runLayout = () => {
      const current = mapRef.current;
      if (movingRef.current || !current) return;
      try {
        const obstacles = measureObstacles(current);
        const size = current.getSize();
        const viewport = { width: size.x, height: size.y };
        const grouped = new Set<string>();
        const chips = [];
        for (const cluster of groupsRef.current) {
          if (cluster.members.length < 2) continue;
          for (const member of cluster.members) grouped.add(member.id);
          const anchorId = statusAnchorRef.current.get(cluster.key) || cluster.anchorId;
          const anchorMember = cluster.members.find((item) => item.id === anchorId) || cluster.members[0];
          if (!anchorMember || !hasLocation(anchorMember)) continue;
          const point = current.latLngToContainerPoint([anchorMember.lat, anchorMember.lng]);
          const marker = pinMarkersRef.current.get(anchorMember.id)?.marker;
          chips.push({
            id: `status:${cluster.key}`,
            kind: 'pin' as const,
            anchor: { x: point.x, y: point.y },
            size: measuredCalloutSize(marker, groupChipSize(cluster.members.length)),
            obstacles,
            previous: offsetsRef.current.get(`status:${cluster.key}`) || null,
            preferred: { dx: 0, dy: groupPinShiftY(MEMBER_PIN_PX) },
            viewport,
          });
        }
        for (const member of membersRef.current) {
          if (!hasLocation(member) || grouped.has(member.id)) continue;
          const point = current.latLngToContainerPoint([member.lat, member.lng]);
          const slot = spreadRef.current.get(member.id);
          const marker = pinMarkersRef.current.get(member.id)?.marker;
          chips.push({
            id: `pin:${member.id}`,
            kind: 'pin' as const,
            anchor: { x: point.x, y: point.y },
            size: measuredCalloutSize(marker, soloChipSize()),
            obstacles,
            previous: offsetsRef.current.get(`pin:${member.id}`) || null,
            preferred: { dx: slot?.dx || 0, dy: slot?.dy || 0 },
            viewport,
          });
        }
        const assigned = assignChipOffsets(chips);
        const live = new Set(assigned.offsets.keys());
        for (const key of offsetsRef.current.keys()) {
          if (!live.has(key)) offsetsRef.current.delete(key);
        }
        for (const [id, offset] of assigned.offsets) {
          offsetsRef.current.set(id, offset);
          if (String(id).startsWith('status:')) {
            const host = statusAnchorRef.current.get(String(id).slice('status:'.length));
            if (host) hostShiftRef.current.set(host, offset);
          }
        }
        if (assigned.changed) placeRef.current('obstacle');
      } catch {
        /* The map has no container point until it has a size. */
      }
    };
    const scheduleLayout = () => {
      if (layoutFrameRef.current) window.cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = window.requestAnimationFrame(() => {
        layoutFrameRef.current = window.requestAnimationFrame(() => {
          layoutFrameRef.current = 0;
          runLayout();
        });
      });
    };
    layoutRef.current = scheduleLayout;
    placeRef.current = place;
    place('data');
    return () => {
      if (layoutFrameRef.current) window.cancelAnimationFrame(layoutFrameRef.current);
      layoutFrameRef.current = 0;
    };
  }, [home, members, ready, selectedId]);

  useEffect(() => {
    const paint = () => {
    const trailGroup = trailRef.current;
    if (!ready || !trailGroup) return;
    if (movingRef.current) {
      trailsDirtyRef.current = true;
      return;
    }
    const geometryKey = `${solidTrails ? 's' : 'l'}|${trailColor}|${trailGeometryKey(trails)}`;
    if (geometryKey === drawnTrailKeyRef.current) return;
    drawnTrailKeyRef.current = geometryKey;
    trailGroup.clearLayers();
    const stroke = { smoothFactor: 0, lineCap: 'round' as const, lineJoin: 'round' as const };
    const drawn: string[] = [];
    let pointCount = 0;
    const paintLine = (latlngs: [number, number][], weight: number) => {
      L.polyline(latlngs, { ...stroke, color: '#ffffff', weight: weight + 3, opacity: 0.9 }).addTo(trailGroup);
      L.polyline(latlngs, { ...stroke, color: trailColor, weight, opacity: 1 }).addTo(trailGroup);
    };
    const paintEnds = (start: { lat: number; lng: number } | undefined, end: { lat: number; lng: number } | undefined) => {
      if (!start) return;
      L.circleMarker([start.lat, start.lng], {
        radius: 5,
        color: trailColor,
        weight: 2,
        fillColor: trailColor,
        fillOpacity: 1,
      }).addTo(trailGroup);
      if (end && (end.lat !== start.lat || end.lng !== start.lng)) {
        L.circleMarker([end.lat, end.lng], {
          radius: 6,
          color: trailColor,
          weight: 3,
          fillColor: '#ffffff',
          fillOpacity: 1,
        }).addTo(trailGroup);
      }
    };
    for (const trail of trails) {
      if (!trail || trail.length < 2) continue;
      if (solidTrails) {
        const line = displaySolidTrail(trail, DISPLAY_TRAIL_CAP);
        if (line.length < 2) continue;
        pointCount += line.length;
        drawn.push(line.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(' '));
        paintLine(line.map((point) => [point.lat, point.lng] as [number, number]), 6);
        paintEnds(line[0], line[line.length - 1]);
        continue;
      }
      const parts = appendLiveTip(trailDrawParts(trail), trail[trail.length - 1]);
      if (parts.length === 0) continue;
      for (const part of parts) {
        pointCount += part.points.length;
        drawn.push(part.points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(' '));
        const latlngs = part.points.map((point) => [point.lat, point.lng] as [number, number]);
        paintLine(latlngs, 6);
      }
      const start = parts[0]?.points[0] ?? trail[0];
      const end = parts[parts.length - 1]?.points.at(-1) ?? trail[trail.length - 1];
      paintEnds(start, end);
    }
    if (nodeRef.current) nodeRef.current.dataset.trail = drawn.join(';');
    const notedAt = Date.now();
    if (notedAt - renderNotedAt.current >= 30_000) {
      renderNotedAt.current = notedAt;
      noteDiag({ kind: 'render', points: pointCount, segments: drawn.length });
    }
    };
    paintTrailsRef.current = paint;
    paint();
  }, [ready, solidTrails, trails, trailColor]);

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
