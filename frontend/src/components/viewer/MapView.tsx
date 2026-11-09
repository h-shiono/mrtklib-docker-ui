import { useCallback, useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import { Button, useMantineColorScheme } from '@mantine/core';
import type { LatLngBoundsExpression } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PosEpoch } from './types';
import { qualityColor, qualityLabel } from '../../utils/quality';
import { decodeClasSource, formatClasSource } from '../../utils/clasSource';
import { FONT_SIZE } from '../../utils/typography';

/** Tooltip line for the CLAS L6 source (#144); nothing without one. */
function clasSourceLine(refid: number | null | undefined) {
  const s = decodeClasSource(refid);
  return s ? <div>L6: {formatClasSource(s)}</div> : null;
}

interface MapViewProps {
  data: PosEpoch[];
  height: number;
  /** Time system of the epoch times, shown in the tooltip. */
  timeSystem?: string;
  /** Identifies the data source. The map follows the data (fits it as it
   *  changes) until the user drags or zooms; a new key follows again. */
  fitKey?: string;
  /** Show the GGA station id as the CLAS L6 source (PositionViewer). */
  clasSource?: boolean;
  /** Name of `data`, in the tooltip, when another solution is overlaid. */
  label?: string;
  /** One colour for every point of `data`; without it, by quality. */
  color?: string;
  /** Second solution, under `data`. Without `color`: by quality, as rings. */
  overlay?: { data: PosEpoch[]; label: string; timeSystem: string; color?: string };
}

/** Drop null/invalid solutions at (0, 0, 0) so they don't map to "null island". */
const isValid = (e: PosEpoch) => !(e.lat === 0 && e.lon === 0 && (e.height ?? 0) === 0);

// OpenStreetMap tiles in both themes. Dark mode darkens them with a CSS
// filter on the tile layer (.mrtk-tiles-dark in index.css) instead of a
// dark tile service: CARTO's dark_all now answers keyless requests with an
// "API KEY REQUIRED" image, and this app ships without third-party keys.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** Sub-component that fits the map to the data while following */
function AutoFitBounds({ data, follow }: { data: PosEpoch[]; follow: boolean }) {
  const map = useMap();

  useEffect(() => {
    if (!follow || data.length === 0) return;

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
  }, [data, map, follow]);

  return null;
}

/** Calls `onMove` when the user drags or zooms the map (not when we fit it). */
function UserMoveListener({ onMove }: { onMove: () => void }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.addEventListener('pointerdown', onMove);
    el.addEventListener('wheel', onMove, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', onMove);
      el.removeEventListener('wheel', onMove);
    };
  }, [map, onMove]);
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

export function MapView({
  data,
  height,
  timeSystem = 'GPST',
  fitKey = '',
  clasSource = false,
  label,
  color,
  overlay,
}: MapViewProps) {
  const { colorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';
  // The source the user moved the map away from; follow any other source.
  const [movedKey, setMovedKey] = useState<string | null>(null);
  const follow = movedKey !== fitKey;
  const onUserMove = useCallback(() => setMovedKey(fitKey), [fitKey]);

  const validData = useMemo(() => data.filter(isValid), [data]);
  const validOverlay = useMemo(() => overlay?.data.filter(isValid) ?? [], [overlay]);
  const fitData = useMemo(() => [...validData, ...validOverlay], [validData, validOverlay]);

  // Downsample for rendering performance (Canvas handles ~5000 markers well)
  const maxPoints = overlay ? 2500 : 5000;
  const displayData = useMemo(() => downsample(validData, maxPoints), [validData, maxPoints]);
  const displayOverlay = useMemo(() => downsample(validOverlay, maxPoints), [validOverlay, maxPoints]);

  const marker = (
    epoch: PosEpoch,
    key: string,
    fixedColor: string | undefined,
    ring: boolean,
    stream: string | undefined,
    timeLabel: string,
  ) => (
    <CircleMarker
      key={key}
      center={[epoch.lat, epoch.lon]}
      radius={ring ? 2.5 : 2}
      pathOptions={{
        color: fixedColor ?? qualityColor(epoch.Q),
        fillColor: fixedColor ?? qualityColor(epoch.Q),
        fillOpacity: ring ? 0 : 0.8,
        weight: ring ? 1 : 0,
      }}
    >
      <Tooltip>
        <div style={{ fontSize: FONT_SIZE.label, lineHeight: 1.4 }}>
          {stream && <div>{stream}</div>}
          <div><b>{epoch.time.toISOString().replace('T', ' ').replace('Z', '')} {timeLabel}</b></div>
          <div>Q={epoch.Q} ({qualityLabel(epoch.Q)})</div>
          <div>Lat: {epoch.lat.toFixed(8)}°</div>
          <div>Lon: {epoch.lon.toFixed(8)}°</div>
          <div>Height: {epoch.height != null ? `${epoch.height.toFixed(4)} m` : '—'}</div>
          <div>ns={epoch.ns ?? '—'} ratio={epoch.ratio != null ? epoch.ratio.toFixed(1) : '—'}</div>
          {clasSource && clasSourceLine(epoch.refid)}
        </div>
      </Tooltip>
    </CircleMarker>
  );

  // Default center (Tokyo) if no data
  const defaultCenter: [number, number] = validData.length > 0
    ? [validData[0].lat, validData[0].lon]
    : [35.68, 139.77];

  return (
    <div style={{ position: 'relative', height, width: '100%' }}>
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
        <AutoFitBounds data={fitData} follow={follow} />
        <UserMoveListener onMove={onUserMove} />
        {/* The overlay first: the selected stream stays on top */}
        {overlay && displayOverlay.map((epoch, i) =>
          marker(epoch, `o${i}`, overlay.color, !overlay.color, overlay.label, overlay.timeSystem))}
        {displayData.map((epoch, i) => marker(epoch, `d${i}`, color, false, label, timeSystem))}
      </MapContainer>
      {!follow && validData.length > 0 && (
        <Button
          size="compact-xs"
          variant="default"
          onClick={() => setMovedKey(null)}
          title="Fit the map to the data and follow it again"
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000 }}
        >
          Fit
        </Button>
      )}
    </div>
  );
}
