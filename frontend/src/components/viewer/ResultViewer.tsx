import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Stack,
  Group,
  Badge,
  Text,
  Loader,
  SegmentedControl,
  Select,
  NumberInput,
  Popover,
  ActionIcon,
  Box,
  Switch,
} from '@mantine/core';
import { IconSettings, IconAdjustments, IconZoomReset } from '@tabler/icons-react';
import { readFile } from '../../api/files';
import { parsePosFile } from './posParser';
import {
  convertToENU,
  computeMeanReference,
  computeMedianReference,
  xyzToLlh,
} from './enuUtils';
import { MapView } from './MapView';
import { ChartView } from './ChartView';
import { Plot2DView } from './Plot2DView';
import type {
  PosEpoch,
  ENUEpoch,
  ReferencePosition,
  ReferenceMode,
  ChartMetric,
} from './types';
import { Q_COLORS, Q_LABELS } from './types';

interface ResultViewerProps {
  filePath: string | null;
  maxHeight: number;
  refreshKey?: number;
}

const REFERENCE_OPTIONS = [
  { value: 'mean', label: 'Mean' },
  { value: 'median', label: 'Median' },
  { value: 'rinex-header', label: 'RINEX Header' },
  { value: 'manual-llh', label: 'Manual (LLH)' },
  { value: 'manual-xyz', label: 'Manual (XYZ)' },
];

const METRICS: ChartMetric[] = ['e', 'n', 'u', 'ns'];

type ViewMode = '2d' | 'enu' | 'map';

interface YRangeSettings {
  auto: boolean;
  min: number;
  max: number;
}

const DEFAULT_Y_RANGE: YRangeSettings = { auto: true, min: 0, max: 0 };

export function ResultViewer({
  filePath,
  maxHeight,
  refreshKey = 0,
}: ResultViewerProps) {
  const [epochs, setEpochs] = useState<PosEpoch[]>([]);
  const [headerRefPos, setHeaderRefPos] = useState<ReferencePosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [refMode, setRefMode] = useState<ReferenceMode>('mean');
  const [manualLat, setManualLat] = useState<number>(0);
  const [manualLon, setManualLon] = useState<number>(0);
  const [manualHeight, setManualHeight] = useState<number>(0);
  const [manualX, setManualX] = useState<number>(0);
  const [manualY, setManualY] = useState<number>(0);
  const [manualZ, setManualZ] = useState<number>(0);
  const [refPopoverOpened, setRefPopoverOpened] = useState(false);

  // Shared X-axis range for ENU charts (null = auto/full range)
  const [xRange, setXRange] = useState<[number, number] | null>(null);

  // Unified Y-axis range for ENU charts (ns is always auto)
  const [enuYRange, setEnuYRange] = useState<YRangeSettings>({ ...DEFAULT_Y_RANGE });
  const [yAxisPopoverOpened, setYAxisPopoverOpened] = useState(false);

  const handleXRangeChange = useCallback((range: [number, number] | null) => {
    setXRange(range);
  }, []);

  // Convert Y-range settings to ChartView prop format
  const getYRange = useCallback(
    (metric: ChartMetric): [number, number] | null => {
      if (metric === 'ns') return null; // ns is always auto
      return enuYRange.auto ? null : [enuYRange.min, enuYRange.max];
    },
    [enuYRange],
  );

  // Load .pos file
  useEffect(() => {
    if (!filePath) {
      setEpochs([]);
      setHeaderRefPos(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    readFile(filePath, 50000)
      .then((res) => {
        if (cancelled) return;
        const parsed = parsePosFile(res.content);
        setEpochs(parsed.epochs);
        setHeaderRefPos(parsed.headerRefPos);
        if (parsed.epochs.length === 0) {
          setError('No position data found in file');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setEpochs([]);
        setHeaderRefPos(null);
        setError(err instanceof Error ? err.message : 'Failed to load file');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, refreshKey]);

  // Reset X range when data changes
  useEffect(() => {
    setXRange(null);
  }, [epochs]);

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

  // Placeholder states
  if (!filePath) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          No result file to display
        </Text>
      </Stack>
    );
  }

  if (loading) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Loader size="sm" color="gray" />
        <Text size="xs" c="dimmed">Loading position data...</Text>
      </Stack>
    );
  }

  if (error && epochs.length === 0) {
    return (
      <Stack align="center" justify="center" h={maxHeight} gap="xs">
        <Text size="sm" c="dimmed" fs="italic" ff="monospace">
          {error}
        </Text>
      </Stack>
    );
  }

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
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={viewMode}
            onChange={(v) => setViewMode(v as ViewMode)}
            data={[
              { label: '2D', value: '2d' },
              { label: 'ENU', value: 'enu' },
              { label: 'Map', value: 'map' },
            ]}
          />
        </Group>

        <Group gap="xs">
          {/* Reset zoom (ENU mode, visible when zoomed) */}
          {viewMode === 'enu' && xRange && (
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
          {viewMode === 'enu' && (
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
          {viewMode !== 'map' && (
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

      {/* Visualization area */}
      <div style={{ flex: 1, minHeight: 0, overflow: viewMode === 'enu' ? 'auto' : undefined }}>
        {viewMode === '2d' && (
          <Plot2DView data={enuData} height={vizHeight} />
        )}
        {viewMode === 'enu' && (
          <Stack gap={0}>
            {METRICS.map((metric) => (
              <ChartView
                key={metric}
                data={enuData}
                height={Math.floor(vizHeight / 4)}
                metric={metric}
                xRange={xRange}
                yRange={getYRange(metric)}
                onXRangeChange={handleXRangeChange}
                cursorSyncKey="enu-sync"
              />
            ))}
          </Stack>
        )}
        {viewMode === 'map' && (
          <MapView data={epochs} height={vizHeight} />
        )}
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
              color="gray"
              styles={{
                root: {
                  '--badge-dot-color': Q_COLORS[Number(q)] || '#888',
                },
              }}
            >
              {Q_LABELS[Number(q)] || `Q${q}`}: {(count / epochs.length * 100).toFixed(1)}% ({count})
            </Badge>
          ))}
      </Group>
    </Stack>
  );
}
