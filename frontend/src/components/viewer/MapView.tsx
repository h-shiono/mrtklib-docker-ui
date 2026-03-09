import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { useMantineColorScheme } from '@mantine/core';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PosEpoch } from './types';
import { Q_COLORS, Q_LABELS } from './types';

interface MapViewProps {
  data: PosEpoch[];
  height: number;
}

const TILE_URLS = {
  light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};

const TILE_ATTRIBUTIONS = {
  light: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  dark: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
};

/** Sub-component that auto-fits map bounds when data changes */
function AutoFitBounds({ data }: { data: PosEpoch[] }) {
  const map = useMap();

  useEffect(() => {
    if (data.length === 0) return;

    let minLat = Infinity, maxLat = -Infinity;
    let minLon = Infinity, maxLon = -Infinity;

    for (const epoch of data) {
      if (epoch.lat < minLat) minLat = epoch.lat;
      if (epoch.lat > maxLat) maxLat = epoch.lat;
      if (epoch.lon < minLon) minLon = epoch.lon;
      if (epoch.lon > maxLon) maxLon = epoch.lon;
    }

    const bounds: LatLngBoundsExpression = [
      [minLat, minLon],
      [maxLat, maxLon],
    ];

    map.fitBounds(bounds, { padding: [20, 20], maxZoom: 18 });
  }, [data, map]);

  return null;
}

/** Downsample data for rendering by taking every Nth point */
function downsample(data: PosEpoch[], maxPoints: number): PosEpoch[] {
  if (data.length <= maxPoints) return data;
  const step = Math.ceil(data.length / maxPoints);
  const result: PosEpoch[] = [];
  for (let i = 0; i < data.length; i += step) {
    result.push(data[i]);
  }
  // Always include the last point
  if (result[result.length - 1] !== data[data.length - 1]) {
    result.push(data[data.length - 1]);
  }
  return result;
}

export function MapView({ data, height }: MapViewProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  // Downsample for rendering performance (Canvas handles ~5000 markers well)
  const displayData = useMemo(() => downsample(data, 5000), [data]);

  // Default center (Tokyo) if no data
  const defaultCenter: [number, number] = data.length > 0
    ? [data[0].lat, data[0].lon]
    : [35.68, 139.77];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={15}
      preferCanvas={true}
      style={{ height, width: '100%' }}
    >
      <TileLayer
        attribution={isDark ? TILE_ATTRIBUTIONS.dark : TILE_ATTRIBUTIONS.light}
        url={isDark ? TILE_URLS.dark : TILE_URLS.light}
      />
      <AutoFitBounds data={data} />
      {displayData.map((epoch, i) => (
        <CircleMarker
          key={i}
          center={[epoch.lat, epoch.lon]}
          radius={2}
          pathOptions={{
            color: Q_COLORS[epoch.Q] || '#888',
            fillColor: Q_COLORS[epoch.Q] || '#888',
            fillOpacity: 0.8,
            weight: 0,
          }}
        >
          <Tooltip>
            <div style={{ fontSize: '11px', lineHeight: 1.4 }}>
              <div><b>{epoch.time.toISOString().replace('T', ' ').replace('Z', '')} GPST</b></div>
              <div>Q={epoch.Q} ({Q_LABELS[epoch.Q] || 'Unknown'})</div>
              <div>Lat: {epoch.lat.toFixed(8)}°</div>
              <div>Lon: {epoch.lon.toFixed(8)}°</div>
              <div>Height: {epoch.height.toFixed(4)} m</div>
              <div>ns={epoch.ns} ratio={epoch.ratio.toFixed(1)}</div>
            </div>
          </Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
