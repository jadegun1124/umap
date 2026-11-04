import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Bike, Car, ChevronRight, Footprints, Pause, Plane, Play } from 'lucide-react';
import { classifyJourneyMode, formatJourneyDistance, formatJourneyWhen, journeyPathDistance, modeLabel, playbackAnchor, trailDrawParts, visibleTrail, type TravelMode } from '../../lib/tracking.mjs';
import { VWORLD_ATTRIBUTION, vworldApiKey, vworldBaseTileUrl } from '../../services/vworld';
import type { Journey } from '../../types/family';

type Place = { lat: number; lng: number; label: string | null };
type Sample = { lat: number; lng: number; at: number; speedMps?: number | null };

export type OpenJourney = {
  id: string;
  startedAt: number;
  endedAt: number;
  distanceM: number;
  points: Sample[];
  start: Place;
  end: Place;
};

function looksLikeCoordinates(text: string) {
  return /^-?\d{1,3}\.\d{2,}\s*,\s*-?\d{1,3}\.\d{2,}/.test(text.trim());
}

function placeText(place: Place, fallback: string) {
  const label = place.label?.trim();
  if (label && label !== '근처' && !looksLikeCoordinates(label)) return label;
  return fallback;
}

function realPlace(place: Place) {
  const label = place.label?.trim();
  if (label && label !== '근처' && !looksLikeCoordinates(label)) return label;
  return '';
}

function seoulClock(at: number, seconds = false) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  }).format(at);
}

function formatDuration(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
}

function seoulMonthDay(at: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at);
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return month && day ? `${month.padStart(2, '0')}/${day.padStart(2, '0')}` : '';
}

function rangeLabel(startedAt: number, endedAt: number, now = Date.now()) {
  return `${formatJourneyWhen(startedAt, endedAt, now).replace('–', ' ~ ')} (${formatDuration(endedAt - startedAt)})`;
}

function journeyNeedsDate(startedAt: number, endedAt: number, now = Date.now()) {
  return formatJourneyWhen(startedAt, endedAt, now).includes('→');
}

function journeyStamp(at: number, startedAt: number, endedAt: number, now = Date.now()) {
  if (!journeyNeedsDate(startedAt, endedAt, now)) return seoulClock(at);
  return `${seoulMonthDay(at)} ${seoulClock(at)}`;
}

function spacedDistance(meters: number) {
  const raw = formatJourneyDistance(meters);
  if (raw.endsWith('km')) return `${raw.slice(0, -2)} km`;
  if (raw.endsWith('m')) return `${raw.slice(0, -1)} m`;
  return raw;
}

function journeyDistance(journey: { distanceM: number; points?: Sample[] }) {
  const measured = journeyPathDistance(journey.points);
  if (!Number.isFinite(measured) || measured <= 0) return journey.distanceM;
  return Math.max(journey.distanceM, Math.round(measured));
}

function journeyMode(journey: { distanceM: number; startedAt: number; endedAt: number; points?: Sample[] }): TravelMode {
  const distanceM = journeyDistance(journey);
  const duration = Math.max(0, journey.endedAt - journey.startedAt);
  return classifyJourneyMode(journey.points, distanceM, duration);
}

export function playbackMark(points: Sample[], ratio: number): { lat: number; lng: number; label: string; at: number; speedKmh: number } | null {
  const anchor = playbackAnchor(points, ratio);
  if (!anchor) return null;
  const speedKmh = Math.max(0, (anchor.speedMps || 0) * 3.6);
  const kmh = Math.round(speedKmh);
  return {
    lat: anchor.lat,
    lng: anchor.lng,
    at: anchor.at,
    speedKmh,
    label: `${seoulClock(anchor.at, true)} / ${kmh} km/h`,
  };
}

function ModeIcon({ mode }: { mode: TravelMode }) {
  const Icon = mode === 'vehicle' ? Car : mode === 'bike' ? Bike : mode === 'plane' ? Plane : Footprints;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8f1fb] text-[#0084FF]" aria-label={modeLabel(mode)}>
      <Icon className="h-4 w-4" aria-hidden="true" />
    </span>
  );
}

function PlaceLine({ text }: { text: string }) {
  return (
    <span className="flex items-center gap-2 text-[13px] leading-5 text-slate-600">
      <span className="h-2 w-2 shrink-0 rounded-full bg-[#0084FF]" />
      <span className="min-w-0 truncate">{text}</span>
    </span>
  );
}

function fitPreview(map: L.Map, points: { lat: number; lng: number }[]) {
  if (points.length < 1) return;
  map.invalidateSize();
  const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
  if (!bounds.isValid()) return;
  const latSpan = bounds.getNorth() - bounds.getSouth();
  const lngSpan = bounds.getEast() - bounds.getWest();
  if (points.length === 1 || (latSpan < 0.0002 && lngSpan < 0.0002)) {
    map.setView(bounds.getCenter(), 16, { animate: false });
    return;
  }
  map.fitBounds(bounds, { padding: [22, 22], maxZoom: 16, animate: false });
}

function RoutePreview({ points }: { points: Sample[] }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const trailRef = useRef<L.LayerGroup | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const signature = useMemo(() => {
    return visibleTrail(points).map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(' ');
  }, [points]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || mapRef.current) return;
    const key = vworldApiKey();
    const map = L.map(node, {
      center: [37.5, 127.05],
      zoom: 13,
      zoomControl: false,
      attributionControl: !!key,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      inertia: false,
    });
    if (key) {
      map.attributionControl.setPrefix('');
      map.attributionControl.setPosition('bottomleft');
      L.tileLayer(vworldBaseTileUrl(key), {
        attribution: VWORLD_ATTRIBUTION,
        minZoom: 6,
        maxZoom: 19,
        bounds: L.latLngBounds([32.8, 124.0], [39.8, 132.1]),
      }).addTo(map);
    }
    trailRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => {
      const current = mapRef.current;
      const group = trailRef.current;
      if (!current || !group) return;
      const drawn = group.getLayers().flatMap((layer) => {
        if (layer instanceof L.Polyline && !(layer instanceof L.CircleMarker)) {
          return (layer.getLatLngs() as L.LatLng[]).map((latlng) => ({ lat: latlng.lat, lng: latlng.lng }));
        }
        if (layer instanceof L.CircleMarker) {
          const latlng = layer.getLatLng();
          return [{ lat: latlng.lat, lng: latlng.lng }];
        }
        return [];
      });
      if (drawn.length > 0) fitPreview(current, drawn);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      trailRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = trailRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const segments = trailDrawParts(pointsRef.current).filter((part) => !part.dashed && part.points.length >= 2);
    const drawn = segments.flatMap((part) => part.points).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    const stroke = { smoothFactor: 0, interactive: false, lineCap: 'round' as const, lineJoin: 'round' as const };
    for (const part of segments) {
      const latlngs = part.points.map((point) => [point.lat, point.lng] as [number, number]);
      L.polyline(latlngs, { ...stroke, color: '#ffffff', weight: 8, opacity: 0.95 }).addTo(group);
      L.polyline(latlngs, { ...stroke, color: '#0084FF', weight: 4.5, opacity: 1 }).addTo(group);
    }
    if (drawn.length === 1) {
      L.circleMarker([drawn[0].lat, drawn[0].lng], {
        radius: 6,
        color: '#0084FF',
        weight: 3,
        fillColor: '#ffffff',
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
    }
    const fit = () => fitPreview(map, drawn);
    fit();
    const timer = window.setTimeout(fit, 80);
    return () => window.clearTimeout(timer);
  }, [signature]);

  return <div ref={nodeRef} className="umap-route-preview h-full w-full" aria-hidden="true" />;
}

function TripCard({
  title,
  journey,
  selected,
  onSelect,
  onPlay,
}: {
  title: string | null;
  journey: OpenJourney | Journey;
  selected: boolean;
  onSelect: () => void;
  onPlay: () => void;
}) {
  const mode = journeyMode(journey);
  const distanceM = journeyDistance(journey);
  const start = realPlace(journey.start);
  const end = realPlace(journey.end);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`w-full rounded-[28px] px-3.5 py-3.5 text-left shadow-[0_8px_24px_rgba(15,23,42,0.06)] ${selected ? 'bg-white ring-2 ring-[#0084FF]' : 'bg-white ring-1 ring-slate-200'}`}
    >
      {title && (
        <span className="mb-1.5 flex items-center justify-between gap-2">
          <span className={`text-sm font-black ${title === '지금' ? 'text-[#0084FF]' : 'text-slate-800'}`}>{title}</span>
          <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
        </span>
      )}
      <span className="block text-[15px] font-black tracking-tight text-slate-900">{rangeLabel(journey.startedAt, journey.endedAt)}</span>
      <span className="mt-2 flex items-center gap-2 text-[22px] font-black leading-none text-slate-900">
        <ModeIcon mode={mode} />
        {spacedDistance(distanceM)}
      </span>
      {(start || end) && (
        <span className="mt-2.5 block space-y-1">
          {start && <PlaceLine text={start} />}
          {end && <PlaceLine text={end} />}
        </span>
      )}
      <span className="relative mt-3 block h-36 overflow-hidden rounded-2xl">
        <RoutePreview points={journey.points} />
        <button
          type="button"
          aria-label="전체 기록 보기"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          className="pointer-events-auto absolute bottom-2.5 right-2.5 z-20 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-800 shadow-[0_4px_14px_rgba(15,23,42,0.16)]"
        >
          전체 기록 보기
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

const PLAY_MS = 9000;

type PlaybackMap = {
  setPlayback: (frame: { lat: number; lng: number; label: string } | null, follow?: boolean) => void;
};

export function JourneyScrubber({
  journey,
  points,
  playing,
  mapRef,
  onPlayingChange,
}: {
  journey: OpenJourney | Journey;
  points: Sample[];
  playing: boolean;
  mapRef: RefObject<PlaybackMap | null>;
  onPlayingChange: (playing: boolean) => void;
}) {
  const sliderRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLParagraphElement>(null);
  const ratioRef = useRef(0);
  const speedRef = useRef<number | null>(null);
  const pointsRef = useRef(points);
  const mapHandle = useRef(mapRef);
  const playingRef = useRef(playing);
  const onPlayingRef = useRef(onPlayingChange);
  pointsRef.current = points;
  mapHandle.current = mapRef;
  playingRef.current = playing;
  onPlayingRef.current = onPlayingChange;

  const paint = (ratio: number, follow: boolean) => {
    const clamped = Math.min(1, Math.max(0, ratio));
    ratioRef.current = clamped;
    const anchor = playbackAnchor(pointsRef.current, clamped);
    if (sliderRef.current) sliderRef.current.value = String(Math.round(clamped * 1000));
    if (!anchor) {
      if (labelRef.current) labelRef.current.textContent = '재생';
      mapHandle.current.current?.setPlayback(null);
      return;
    }
    const raw = Math.max(0, (anchor.speedMps || 0) * 3.6);
    const smoothed = speedRef.current == null ? raw : speedRef.current * 0.7 + raw * 0.3;
    speedRef.current = smoothed;
    const label = `${seoulClock(anchor.at, true)} / ${Math.round(smoothed)} km/h`;
    if (labelRef.current) labelRef.current.textContent = label;
    mapHandle.current.current?.setPlayback({ lat: anchor.lat, lng: anchor.lng, label }, follow);
  };

  useLayoutEffect(() => {
    paint(ratioRef.current, false);
  });

  useEffect(() => {
    ratioRef.current = 0;
    speedRef.current = null;
    paint(0, false);
    return () => {
      mapHandle.current.current?.setPlayback(null);
    };
  }, [journey.id]);

  useEffect(() => {
    if (!playing) return;
    let from = ratioRef.current;
    if (from >= 0.999) {
      from = 0;
      ratioRef.current = 0;
      speedRef.current = null;
    }
    const started = performance.now();
    let frame = 0;
    const step = (mark: number) => {
      if (!playingRef.current) return;
      const progress = Math.min(1, (mark - started) / PLAY_MS);
      paint(from + (1 - from) * progress, true);
      if (progress < 1) frame = requestAnimationFrame(step);
      else onPlayingRef.current(false);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, journey.id]);

  return (
    <div className="rounded-3xl bg-slate-50 px-3 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={playing ? '일시정지' : '재생'}
          onClick={() => onPlayingChange(!playing)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0084FF] text-white"
        >
          {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p ref={labelRef} className="text-sm font-black text-slate-900">재생</p>
          <input
            ref={sliderRef}
            type="range"
            min={0}
            max={1000}
            defaultValue={0}
            aria-label="여정 시간"
            onChange={(event) => {
              onPlayingChange(false);
              speedRef.current = null;
              paint(Number(event.target.value) / 1000, false);
            }}
            className="mt-2 w-full accent-[#0084FF]"
          />
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <p className="flex items-center gap-2 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full bg-[#0084FF]" />
          <span className="min-w-0 flex-1 truncate">{placeText(journey.start, '출발지')}</span>
          <span className="font-bold">{journeyStamp(journey.startedAt, journey.startedAt, journey.endedAt)}</span>
        </p>
        <p className="flex items-center gap-2 text-xs text-slate-600">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-[#0084FF] bg-white" />
          <span className="min-w-0 flex-1 truncate">{placeText(journey.end, '도착지')}</span>
          <span className="font-bold">{journeyStamp(journey.endedAt, journey.startedAt, journey.endedAt)}</span>
        </p>
      </div>
    </div>
  );
}

export function JourneyCards({
  journeys,
  open,
  selectedId,
  onSelect,
  onPlay,
}: {
  journeys: Journey[];
  open: OpenJourney | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onPlay?: (id: string) => void;
}) {
  const [latest, ...older] = journeys;
  const play = (id: string) => (onPlay ?? onSelect)(id);
  return (
    <div className="space-y-3">
      {open && (
        <TripCard
          title="지금"
          journey={open}
          selected={selectedId === 'open'}
          onSelect={() => onSelect('open')}
          onPlay={() => play('open')}
        />
      )}
      {latest ? (
        <TripCard
          title="최근 여정"
          journey={latest}
          selected={selectedId === latest.id}
          onSelect={() => onSelect(latest.id)}
          onPlay={() => play(latest.id)}
        />
      ) : (
        <p className="rounded-2xl bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-500">
          아직 끝난 여정이 없습니다. 이동한 뒤 한곳에서 7분 이상 머물면 최근 여정으로 남습니다.
        </p>
      )}
      {older.map((journey) => (
        <TripCard
          key={journey.id}
          title={null}
          journey={journey}
          selected={selectedId === journey.id}
          onSelect={() => onSelect(journey.id)}
          onPlay={() => play(journey.id)}
        />
      ))}
    </div>
  );
}
