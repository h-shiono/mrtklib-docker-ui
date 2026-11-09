import { useState, useMemo, useCallback } from 'react';
import {
  Stack,
  Group,
  Badge,
  Text,
  SegmentedControl,
  Select,
  NumberInput,
  Popover,
  ActionIcon,
  Box,
  Switch,
  Divider,
} from '@mantine/core';
import { IconSettings, IconAdjustments, IconZoomReset } from '@tabler/icons-react';
import {
  convertToENU,
  computeMeanReference,
  computeMedianReference,
  xyzToLlh,
} from './enuUtils';
import { MapView } from './MapView';
import { ChartView, X_AXIS_LABELLED, X_AXIS_TICKS_ONLY, type ChartMarker } from './ChartView';
import { Plot2DView } from './Plot2DView';
import type {
  PosEpoch,
  ENUEpoch,
  ReferencePosition,
  ReferenceMode,
  ChartMetric,
} from './types';
import { qualityColor, qualityLabel } from '../../utils/quality';
import { clasSourceChanges, formatClasSource, shortClasSource } from '../../utils/clasSource';

/**
 * Position views (2D / ENU / Map) over a list of epochs, from any source:
 * a solution file (ResultViewer), or live epochs (Stream Monitor) that grow
 * while it is shown. Zoom, pan and the map view are kept as epochs arrive
 * and reset when `dataKey` changes (another file or session).
 */
interface PositionViewerProps {
  epochs: PosEpoch[];
  /** Identifies the data source (file + reload, or live session). */
  dataKey: string;
  maxHeight: number;
  /** Time system of the epoch times ("GPST", "UTC", "JST"). */
  timeSystem?: string;
  /** Reference position from the source (e.g. the .pos header). */
  headerRefPos?: ReferencePosition | null;
  /** Caveat about the data, shown next to the view switch. */
  notice?: string | null;
  /** Shown instead of the views while there are no epochs. */
  emptyText?: string;
  /** Views to show side by side, chosen outside (Stream Monitor chips).
   *  Without it, one view at a time with a 2D / ENU / Map switch (PP). The
   *  reference, y range and Q legend are shared by all views shown. */
  views?: ViewMode[];
  /** Read the GGA station id as the CLAS L6 source (#144). Only when the
   *  data is known to be CLAS output: any other receiver puts its base
   *  station id there, which can look like a valid source. */
  clasSource?: boolean;
}

const REFERENCE_OPTIONS = [
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'rinex-header', label: 'RINEX Header' },
  { value: 'manual-llh', label: 'Manual (LLH)' },
  { value: 'manual-xyz', label: 'Manual (XYZ)' },
];

const METRICS: ChartMetric[] = ['e', 'n', 'u', 'ns'];

export type ViewMode = '2d' | 'enu' | 'map';

interface YRangeSettings {
  auto: boolean;
  /** Auto range symmetric about 0 */
  symmetric: boolean;
  min: number;
  max: number;
}

const DEFAULT_Y_RANGE: YRangeSettings = { auto: true, symmetric: true, min: 0, max: 0 };

export function PositionViewer({
  epochs,
  dataKey,
  maxHeight,
  timeSystem = 'GPST',
  headerRefPos = null,
  notice = null,
  emptyText = 'No position data',
  views,
  clasSource = false,
}: PositionViewerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [refMode, setRefMode] = useState<ReferenceMode>('mean');
  const [manualLat, setManualLat] = useState<number>(0);
  const [manualLon, setManualLon] = useState<number>(0);
  const [manualHeight, setManualHeight] = useState<number>(0);
  const [manualX, setManualX] = useState<number>(0);
  const [manualY, setManualY] = useState<number>(0);
  const [manualZ, setManualZ] = useState<number>(0);
  const [refPopoverOpened, setRefPopoverOpened] = useState(false);

  // Shared X-axis range for ENU charts (null = auto/full range). Tagged with
  // the data source it was set for: another file or session resets it to
  // auto, while live epochs arriving keep it.
  const [xRangeFor, setXRangeFor] = useState<{ key: string; range: [number, number] } | null>(null);
  const xRange = xRangeFor?.key === dataKey ? xRangeFor.range : null;
  const setXRange = useCallback(
    (range: [number, number] | null) => setXRangeFor(range ? { key: dataKey, range } : null),
    [dataKey],
  );

  // Unified Y-axis range for ENU charts (ns is always auto)
  const [enuYRange, setEnuYRange] = useState<YRangeSettings>({ ...DEFAULT_Y_RANGE });
  const [yAxisPopoverOpened, setYAxisPopoverOpened] = useState(false);
  const [showEnuStats, setShowEnuStats] = useState(true);

  const handleXRangeChange = setXRange;

  // Convert Y-range settings to ChartView prop format
  const getYRange = useCallback(
    (metric: ChartMetric): [number, number] | null => {
      if (metric === 'ns') return null; // ns is always auto
      return enuYRange.auto ? null : [enuYRange.min, enuYRange.max];
    },
    [enuYRange],
  );

  // Compute reference position based on selected mode
  const referencePos = useMemo((): ReferencePosition | null => {
    if (epochs.length === 0) return null;

    switch (refMode) {
      case 'mean':
        return computeMeanReference(epochs);
      case 'median':
        return computeMedianReference(epochs);
      case 'rinex-header':
        return headerRefPos || computeMeanReference(epochs);
      case 'manual-llh':
        return { lat: manualLat, lon: manualLon, height: manualHeight };
      case 'manual-xyz':
        return xyzToLlh(manualX, manualY, manualZ);
      default:
        return computeMeanReference(epochs);
    }
  }, [epochs, refMode, headerRefPos, manualLat, manualLon, manualHeight, manualX, manualY, manualZ]);

  // Convert to ENU
  const enuData = useMemo((): ENUEpoch[] => {
    if (!referencePos || epochs.length === 0) return [];
    return convertToENU(epochs, referencePos);
  }, [epochs, referencePos]);

  // CLAS L6 source changes (GGA station id in MRTKLIB NMEA output, #144):
  // marked on the ENU charts and summed up next to the Q legend. Nothing
  // shows when no epoch names a source, or the data is not CLAS output.
  const l6Changes = useMemo(() => (clasSource ? clasSourceChanges(epochs) : []), [epochs, clasSource]);
  const l6Markers = useMemo(
    (): ChartMarker[] => l6Changes.map((c) => ({ t: c.timeUnix, label: shortClasSource(c.source) })),
    [l6Changes],
  );
  const l6Summary = useMemo(() => {
    if (l6Changes.length === 0) return null;
    const hhmmss = (t: number) => new Date(t * 1000).toISOString().slice(11, 19);
    const n = l6Changes.length - 1;
    return {
      text: n === 0
        ? `L6 ${formatClasSource(l6Changes[0].source)}`
        : `L6 ${shortClasSource(l6Changes[n].source)} · ${n} change${n > 1 ? 's' : ''}`,
      title: l6Changes
        .map((c) => `${hhmmss(c.timeUnix)} ${timeSystem}  ${String(c.id).padStart(4, '0')}  ${formatClasSource(c.source)}`)
        .join('\n'),
    };
  }, [l6Changes, timeSystem]);

  // Q-flag statistics
  const qStats = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const epoch of epochs) {
      counts[epoch.Q] = (counts[epoch.Q] || 0) + 1;
    }
    return counts;
  }, [epochs]);

  // Layout
  const controlBarHeight = 32;
  const legendHeight = 28;
  const vizHeight = maxHeight - controlBarHeight - legendHeight;
  const shown: ViewMode[] = views ?? [viewMode];
  const showsEnu = shown.includes('enu');

  if (epochs.length === 0) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          {emptyText}
        </Text>
      </Stack>
    );
  }

  const isManual = refMode === 'manual-llh' || refMode === 'manual-xyz';
  // The 2D view refits when the data source or the reference changes. A
  // manual reference counts by value; the mean / last reference moves with
  // every live epoch and must not refit while the user is zoomed in.
  const refKey = isManual && referencePos
    ? `${refMode}:${referencePos.lat},${referencePos.lon},${referencePos.height}`
    : refMode;

  const renderView = (v: ViewMode) => {
    if (v === '2d') {
      return <Plot2DView data={enuData} height={vizHeight} resetKey={`${dataKey}\0${refKey}`} />;
    }
    if (v === 'map') {
      return <MapView data={epochs} height={vizHeight} timeSystem={timeSystem} fitKey={dataKey} clasSource={clasSource} />;
    }
    return (
      <Stack gap={0}>
        {METRICS.map((metric, i) => {
          // Time labels on the bottom chart only; the plot areas share
          // the rest of the height equally.
          const last = i === METRICS.length - 1;
          const plotH = Math.floor(
            (vizHeight - (METRICS.length - 1) * X_AXIS_TICKS_ONLY - X_AXIS_LABELLED) / METRICS.length,
          );
          return (
            <div
              key={metric}
              style={{
                // Alternate bands and a rule mark where each chart starts
                backgroundColor: i % 2 === 1
                  ? 'light-dark(rgba(0,0,0,0.025), rgba(255,255,255,0.025))'
                  : undefined,
                borderTop: i > 0 ? '1px solid var(--mantine-color-default-border)' : undefined,
              }}
            >
              <ChartView
                data={enuData}
                height={plotH + (last ? X_AXIS_LABELLED : X_AXIS_TICKS_ONLY) - (i > 0 ? 1 : 0)}
                metric={metric}
                xRange={xRange}
                yRange={getYRange(metric)}
                ySymmetric={enuYRange.auto && enuYRange.symmetric}
                onXRangeChange={handleXRangeChange}
                cursorSyncKey="enu-sync"
                showXLabels={last}
                markers={l6Markers}
                showMarkerLabels={i === 0}
                showStats={showEnuStats}
              />
            </div>
          );
        })}
      </Stack>
    );
  };

  return (
    <Stack gap={0} h={maxHeight}>
      {/* Control bar */}
      <Group
        justify="space-between"
        px="sm"
        py={4}
        style={{ height: controlBarHeight, flexShrink: 0 }}
      >
        <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          {!views && (
            <SegmentedControl
              size="xs"
              style={{ flexShrink: 0 }}
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              data={[
                { label: '2D', value: '2d' },
                { label: 'ENU', value: 'enu' },
                { label: 'Map', value: 'map' },
              ]}
            />
          )}
          {notice && (
            <Text size="xs" c="dimmed" truncate title={notice} style={{ minWidth: 0 }}>
              {notice}
            </Text>
          )}
        </Group>

        <Group gap="xs">
          {/* Reset zoom (ENU mode, visible when zoomed) */}
          {showsEnu && xRange && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="xs"
              onClick={() => setXRange(null)}
              title="Reset zoom"
            >
              <IconZoomReset size={14} />
            </ActionIcon>
          )}

          {/* Y-Axis settings (ENU mode only) */}
          {showsEnu && (
            <Popover
              opened={yAxisPopoverOpened}
              onChange={setYAxisPopoverOpened}
              position="bottom-end"
              withArrow
              shadow="md"
              width={300}
            >
              <Popover.Target>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={() => setYAxisPopoverOpened((o) => !o)}
                >
                  <IconAdjustments size={14} />
                </ActionIcon>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  <Text size="xs" fw={500}>ENU Y-Axis Range</Text>
                  <Switch
                    size="xs"
                    label="Auto"
                    checked={enuYRange.auto}
                    onChange={(e) => {
                      const auto = e.currentTarget.checked;
                      setEnuYRange((prev) => ({ ...prev, auto }));
                    }}
                    styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                  />
                  <Switch
                    size="xs"
                    label="Symmetric about 0"
                    checked={enuYRange.symmetric}
                    disabled={!enuYRange.auto}
                    onChange={(e) => {
                      const symmetric = e.currentTarget.checked;
                      setEnuYRange((prev) => ({ ...prev, symmetric }));
                    }}
                    styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                  />
                  <Group gap={6} wrap="nowrap">
                    {(['min', 'max'] as const).map((bound) => (
                      <Group key={bound} gap={4} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          c={enuYRange.auto ? 'dimmed' : undefined}
                          style={{ fontSize: '10px', flexShrink: 0 }}
                        >
                          {bound === 'min' ? 'Min (m)' : 'Max (m)'}
                        </Text>
                        <NumberInput
                          size="xs"
                          aria-label={bound === 'min' ? 'Min (m)' : 'Max (m)'}
                          value={enuYRange[bound]}
                          disabled={enuYRange.auto}
                          onChange={(v) => setEnuYRange((prev) => ({ ...prev, [bound]: Number(v) }))}
                          decimalScale={4}
                          hideControls
                          styles={{
                            root: { flex: 1, minWidth: 0 },
                            input: { fontFamily: 'var(--mantine-font-family-monospace)' },
                          }}
                        />
                      </Group>
                    ))}
                  </Group>
                  <Divider />
                  <Switch
                    size="xs"
                    label="Show statistics"
                    checked={showEnuStats}
                    onChange={(e) => setShowEnuStats(e.currentTarget.checked)}
                    styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                  />
                </Stack>
              </Popover.Dropdown>
            </Popover>
          )}

          {/* Reference coordinate settings */}
          {shown.some((v) => v !== 'map') && (
            <Popover
              opened={refPopoverOpened}
              onChange={setRefPopoverOpened}
              position="bottom-end"
              withArrow
              shadow="md"
              width={280}
            >
              <Popover.Target>
                <Group
                  gap={4}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setRefPopoverOpened((o) => !o)}
                >
                  <Text size="xs" c="dimmed" style={{ fontSize: '10px' }}>
                    Ref: {REFERENCE_OPTIONS.find((o) => o.value === refMode)?.label}
                  </Text>
                  <ActionIcon variant="subtle" color="gray" size="xs">
                    <IconSettings size={12} />
                  </ActionIcon>
                </Group>
              </Popover.Target>
              <Popover.Dropdown>
                <Stack gap="xs">
                  <Select
                    size="xs"
                    label="Reference Coordinates"
                    value={refMode}
                    onChange={(v) => v && setRefMode(v as ReferenceMode)}
                    data={REFERENCE_OPTIONS}
                    styles={{ label: { fontSize: '10px' } }}
                  />
                  {refMode === 'manual-llh' && (
                    <Box>
                      <Text size="xs" c="dimmed" mb={4}>WGS84 LLH</Text>
                      <Stack gap={4}>
                        <NumberInput size="xs" label="Latitude (deg)" value={manualLat} onChange={(v) => setManualLat(Number(v))} decimalScale={9} step={0.001} styles={{ label: { fontSize: '10px' } }} />
                        <NumberInput size="xs" label="Longitude (deg)" value={manualLon} onChange={(v) => setManualLon(Number(v))} decimalScale={9} step={0.001} styles={{ label: { fontSize: '10px' } }} />
                        <NumberInput size="xs" label="Height (m)" value={manualHeight} onChange={(v) => setManualHeight(Number(v))} decimalScale={4} step={0.1} styles={{ label: { fontSize: '10px' } }} />
                      </Stack>
                    </Box>
                  )}
                  {refMode === 'manual-xyz' && (
                    <Box>
                      <Text size="xs" c="dimmed" mb={4}>ECEF XYZ (m)</Text>
                      <Stack gap={4}>
                        <NumberInput size="xs" label="X (m)" value={manualX} onChange={(v) => setManualX(Number(v))} decimalScale={4} step={1} styles={{ label: { fontSize: '10px' } }} />
                        <NumberInput size="xs" label="Y (m)" value={manualY} onChange={(v) => setManualY(Number(v))} decimalScale={4} step={1} styles={{ label: { fontSize: '10px' } }} />
                        <NumberInput size="xs" label="Z (m)" value={manualZ} onChange={(v) => setManualZ(Number(v))} decimalScale={4} step={1} styles={{ label: { fontSize: '10px' } }} />
                      </Stack>
                    </Box>
                  )}
                  {referencePos && !isManual && (
                    <Text size="xs" c="dimmed" style={{ fontSize: '10px' }}>
                      {referencePos.lat.toFixed(8)}°, {referencePos.lon.toFixed(8)}°, {referencePos.height.toFixed(3)}m
                    </Text>
                  )}
                </Stack>
              </Popover.Dropdown>
            </Popover>
          )}
          <Badge size="xs" variant="light" color="gray">
            {epochs.length.toLocaleString()} epochs
          </Badge>
        </Group>
      </Group>

      {/* Visualization area: one view, or the chosen views side by side */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {shown.map((v, i) => (
          <div
            key={v}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              overflow: v === 'enu' ? 'auto' : undefined,
              borderLeft: i > 0 ? '1px solid var(--mantine-color-default-border)' : undefined,
            }}
          >
            {renderView(v)}
          </div>
        ))}
      </div>

      {/* Q-flag legend */}
      <Group gap="xs" px="sm" py={2} style={{ height: legendHeight, flexShrink: 0 }}>
        {Object.entries(qStats)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([q, count]) => (
            <Badge
              key={q}
              size="xs"
              variant="dot"
              color={qualityColor(Number(q))}
            >
              {qualityLabel(Number(q))}: {(count / epochs.length * 100).toFixed(1)}% ({count})
            </Badge>
          ))}
        {l6Summary && (
          // Hover for every source and when it started
          <Badge size="xs" variant="outline" color="gray" title={l6Summary.title}
            style={{ marginLeft: 'auto', textTransform: 'none', fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {l6Summary.text}
          </Badge>
        )}
      </Group>
    </Stack>
  );
}
