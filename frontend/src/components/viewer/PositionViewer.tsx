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
} from '@mantine/core';
import { IconSettings, IconAdjustments, IconZoomReset } from '@tabler/icons-react';
import {
  convertToENU,
  computeMeanReference,
  computeMedianReference,
  xyzToLlh,
} from './enuUtils';
import { MapView } from './MapView';
import { ChartView, X_AXIS_LABELLED, X_AXIS_TICKS_ONLY } from './ChartView';
import { Plot2DView } from './Plot2DView';
import type {
  PosEpoch,
  ENUEpoch,
  ReferencePosition,
  ReferenceMode,
  ChartMetric,
} from './types';
import { qualityColor, qualityLabel } from '../../utils/quality';

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

const DEFAULT_Y_RANGE: YRangeSettings = { auto: true, symmetric: false, min: 0, max: 0 };

export function PositionViewer({
  epochs,
  dataKey,
  maxHeight,
  timeSystem = 'GPST',
  headerRefPos = null,
  notice = null,
  emptyText = 'No position data',
  views,
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

  const renderView = (v: ViewMode) => {
    if (v === '2d') {
      return <Plot2DView data={enuData} height={vizHeight} resetKey={`${dataKey}\0${refMode}`} />;
    }
    if (v === 'map') {
      return <MapView data={epochs} height={vizHeight} timeSystem={timeSystem} fitKey={dataKey} />;
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
              />
            </div>
          );
        })}
      </Stack>
    );
  };

  const isManual = refMode === 'manual-llh' || refMode === 'manual-xyz';

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
                  <Group justify="space-between">
                    <Text size="xs" fw={500}>ENU Y-Axis Range</Text>
                    <Switch
                      size="xs"
                      label="Auto"
                      checked={enuYRange.auto}
                      onChange={(e) =>
                        setEnuYRange((prev) => ({ ...prev, auto: e.currentTarget.checked }))
                      }
                      styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                    />
                  </Group>
                  {enuYRange.auto && (
                    <Switch
                      size="xs"
                      label="Symmetric about 0"
                      checked={enuYRange.symmetric}
                      onChange={(e) =>
                        setEnuYRange((prev) => ({ ...prev, symmetric: e.currentTarget.checked }))
                      }
                      styles={{ label: { fontSize: '10px', paddingLeft: 4 } }}
                    />
                  )}
                  {!enuYRange.auto && (
                    <Group gap={4}>
                      <NumberInput
                        size="xs"
                        label="Min (m)"
                        value={enuYRange.min}
                        onChange={(v) => setEnuYRange((prev) => ({ ...prev, min: Number(v) }))}
                        decimalScale={4}
                        hideControls
                        styles={{ root: { flex: 1 }, label: { fontSize: '10px' } }}
                      />
                      <NumberInput
                        size="xs"
                        label="Max (m)"
                        value={enuYRange.max}
                        onChange={(v) => setEnuYRange((prev) => ({ ...prev, max: Number(v) }))}
                        decimalScale={4}
                        hideControls
                        styles={{ root: { flex: 1 }, label: { fontSize: '10px' } }}
                      />
                    </Group>
                  )}
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
      </Group>
    </Stack>
  );
}
