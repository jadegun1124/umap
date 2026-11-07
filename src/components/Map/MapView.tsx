import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { VWORLD_ATTRIBUTION, vworldApiKey, vworldBaseTileUrl } from '../../services/vworld';
import { Device, Geofence } from '../../types';

interface MapViewProps {
  devices: Device[];
  selectedDevice: Device | null;
  geofences: Geofence[];
  showGeofences: boolean;
  onSelectDevice: (device: Device) => void;
}

export const MapView: React.FC<MapViewProps> = ({
  devices,
  selectedDevice,
  geofences,
  showGeofences,
  onSelectDevice,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const polylinesRef = useRef<Record<string, { recent: L.Polyline; history: L.Polyline }>>({});
  const waypointMarkersRef = useRef<Record<string, L.LayerGroup>>({});
  const geofenceLayersRef = useRef<L.LayerGroup | null>(null);
  const vworldKey = vworldApiKey();

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const initialLat = selectedDevice ? selectedDevice.currentLocation.lat : 37.6550;
    const initialLng = selectedDevice ? selectedDevice.currentLocation.lng : 127.0610;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 15,
      zoomControl: false,
    });

    // Add zoom control at bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const key = vworldApiKey();
    if (key) {
      L.tileLayer(vworldBaseTileUrl(key), {
        attribution: VWORLD_ATTRIBUTION,
        maxZoom: 19,
      }).addTo(map);
    }
    geofenceLayersRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Center on selected device when changed
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedDevice) return;
    mapInstanceRef.current.panTo(
      [selectedDevice.currentLocation.lat, selectedDevice.currentLocation.lng],
      { animate: true, duration: 0.8 }
    );
  }, [selectedDevice?.id]);

  // Render Geofences
  useEffect(() => {
    if (!mapInstanceRef.current || !geofenceLayersRef.current) return;

    geofenceLayersRef.current.clearLayers();

    if (!showGeofences) return;

    geofences.forEach((geo) => {
      // Circle area
      const circle = L.circle([geo.lat, geo.lng], {
        radius: geo.radius,
        color: geo.color,
        fillColor: geo.color,
        fillOpacity: 0.15,
        weight: 2,
        dashArray: '6, 6',
      });

      // Label Icon
      const labelIcon = L.divIcon({
        className: 'geofence-label-marker',
        html: `
          <div style="transform: translate(-50%, -50%);" class="px-2.5 py-1 rounded-full text-[11px] font-bold text-slate-800 shadow-md flex items-center gap-1.5 border border-slate-200 whitespace-nowrap bg-white/95 backdrop-blur-sm">
            <span style="background-color: ${geo.color}; width: 8px; height: 8px; border-radius: 9999px; display: inline-block;"></span>
            ${geo.name} (${geo.radius}m)
          </div>
        `,
        iconSize: [0, 0],
      });

      const labelMarker = L.marker([geo.lat, geo.lng], { icon: labelIcon, interactive: false });

      geofenceLayersRef.current?.addLayer(circle);
      geofenceLayersRef.current?.addLayer(labelMarker);
    });
  }, [geofences, showGeofences]);

  // Render Device Markers & Trails
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    devices.forEach((device) => {
      const isSelected = selectedDevice?.id === device.id;
      const { lat, lng } = device.currentLocation;

      // Colors based on target type
      let themeColor = '#0284c7'; // child - blue
      let iconEmoji = '🎒';
      if (device.type === 'pet') {
        themeColor = '#f59e0b'; // pet - amber
        iconEmoji = '🐕';
      } else if (device.type === 'vehicle') {
        themeColor = '#10b981'; // car - emerald
        iconEmoji = '🚗';
      } else if (device.type === 'valuable') {
        themeColor = '#8b5cf6'; // valuables - purple
        iconEmoji = '🚲';
      } else if (device.type === 'smartphone') {
        themeColor = '#0284c7'; // smartphone - sky blue
        iconEmoji = '📱';
      }

      // Check for emergency / missing mode
      if (device.isMissingMode) {
        themeColor = '#ef4444'; // Red emergency
      }

      // Custom HTML Marker
      const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: `
          <div class="relative flex items-center justify-center cursor-pointer" style="width: 48px; height: 48px;">
            <!-- Outer Pulsing Glow -->
            <div class="absolute inset-0 rounded-full opacity-60 pulse-ring-anim" style="background-color: ${themeColor};"></div>
            
            <!-- Center Pin Bubble -->
            <div class="relative z-10 flex items-center justify-center rounded-2xl shadow-lg transition-transform duration-200 ${
              isSelected ? 'scale-115 ring-3 ring-sky-500' : 'hover:scale-105'
            }" style="width: 38px; height: 38px; background: #ffffff; border: 2.5px solid ${themeColor};">
              <span class="text-lg leading-none">${iconEmoji}</span>
              
              <!-- Battery Indicator Dot -->
              <span class="absolute -top-1.5 -right-1.5 px-1 py-0.2 rounded-full text-[9px] font-black text-white ${
                device.battery <= 20 ? 'bg-red-500' : 'bg-emerald-600'
              } border border-white shadow-xs">
                ${device.battery}%
              </span>
            </div>

            <!-- Name Tag Below Pin -->
            <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-lg text-[11px] font-bold text-slate-800 bg-white/95 backdrop-blur-md shadow-md border border-slate-200 whitespace-nowrap pointer-events-none flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full ${device.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}"></span>
              ${device.name}
            </div>
          </div>
        `,
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });

      // Existing marker update or create new
      if (markersRef.current[device.id]) {
        markersRef.current[device.id].setLatLng([lat, lng]);
        markersRef.current[device.id].setIcon(customIcon);
        markersRef.current[device.id].setZIndexOffset(isSelected ? 1000 : 100);
      } else {
        const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
        marker.on('click', () => {
          onSelectDevice(device);
        });
        markersRef.current[device.id] = marker;
      }

      // Trail Rendering with Waypoint Breadcrumbs
      const points = device.todayTrail.map((p) => [p.lat, p.lng] as [number, number]);
      if (points.length >= 2) {
        const recentPoints = points.slice(-4);
        const olderPoints = points.slice(0, Math.max(1, points.length - 2));

        if (!polylinesRef.current[device.id]) {
          const historyLine = L.polyline(olderPoints, {
            color: themeColor,
            weight: 3.5,
            opacity: 0.5,
            dashArray: '5, 8',
          }).addTo(map);

          const recentLine = L.polyline(recentPoints, {
            color: themeColor,
            weight: 5.5,
            opacity: 0.95,
          }).addTo(map);

          polylinesRef.current[device.id] = { history: historyLine, recent: recentLine };
        } else {
          polylinesRef.current[device.id].history.setLatLngs(olderPoints);
          polylinesRef.current[device.id].history.setStyle({ color: themeColor });
          polylinesRef.current[device.id].recent.setLatLngs(recentPoints);
          polylinesRef.current[device.id].recent.setStyle({ color: themeColor });
        }

        // Draw waypoint circles along the route for the selected device
        if (!waypointMarkersRef.current[device.id]) {
          waypointMarkersRef.current[device.id] = L.layerGroup().addTo(map);
        }
        const wpLayer = waypointMarkersRef.current[device.id];
        wpLayer.clearLayers();

        if (isSelected) {
          // Draw subtle breadcrumb dots for previous points
          device.todayTrail.slice(0, -1).forEach((pt, idx) => {
            const dot = L.circleMarker([pt.lat, pt.lng], {
              radius: idx === 0 ? 6 : 4,
              color: idx === 0 ? '#10b981' : themeColor,
              fillColor: idx === 0 ? '#10b981' : '#ffffff',
              fillOpacity: 0.9,
              weight: 2,
            });
            if (pt.address) {
              dot.bindTooltip(`[${pt.timestamp}] ${pt.address}`, { direction: 'top', offset: [0, -5] });
            }
            wpLayer.addLayer(dot);
          });
        }
      }
    });
  }, [devices, selectedDevice, onSelectDevice]);

  return (
    <div className="relative w-full h-full bg-slate-50">
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* No API Key Required Indicator Badge (Bright White Mode) */}
      <div className="absolute bottom-3 left-4 z-[450] px-3.5 py-1.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200 text-xs text-slate-700 font-bold flex items-center gap-2 shadow-md pointer-events-none">
        <span className={`w-2 h-2 rounded-full ${vworldKey ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
        <span>
          {vworldKey
            ? 'VWorld 2D · 국토교통부'
            : 'VWorld 지도 키가 없습니다. VITE_VWORLD_API_KEY를 넣어 주세요.'}
        </span>
      </div>
    </div>
  );
};
