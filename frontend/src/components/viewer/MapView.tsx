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
  /** Time system of the epoch times, shown in the tooltip. */
  timeSystem?: string;
}

// OpenStreetMap tiles in both themes. Dark mode darkens them with a CSS
// filter on the tile layer (.mrtk-tiles-dark in index.css) instead of a
// dark tile service: CARTO's dark_all now answers keyless requests with an
// "API KEY REQUIRED" image, and this app ships without third-party keys.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

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

export function MapView({ data, height, timeSystem = 'GPST' }: MapViewProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';

  // Drop null/invalid solutions at (0, 0, 0) so they don't map to "null island".
  const validData = useMemo(
    () => data.filter((e) => !(e.lat === 0 && e.lon === 0 && e.height === 0)),
    [data],
  );

  // Downsample for rendering performance (Canvas handles ~5000 markers well)
  const displayData = useMemo(() => downsample(validData, 5000), [validData]);

  // Default center (Tokyo) if no data
  const defaultCenter: [number, number] = validData.length > 0
    ? [validData[0].lat, validData[0].lon]
    : [35.68, 139.77];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={15}
      preferCanvas={true}
      style={{ height, width: '100%' }}
    >
      <TileLayer
        // className is fixed when Leaflet creates the layer; remount on theme change.
        key={isDark ? 'dark' : 'light'}
        attribution={TILE_ATTRIBUTION}
        url={TILE_URL}
        className={isDark ? 'mrtk-tiles-dark' : undefined}
      />
      <AutoFitBounds data={validData} />
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
              <div><b>{epoch.time.toISOString().replace('T', ' ').replace('Z', '')} {timeSystem}</b></div>
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
