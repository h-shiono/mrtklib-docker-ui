import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Badge,
  Text,
  Loader,
  SegmentedControl,
  Checkbox,
  Select,
  Alert,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { analyzeObs } from '../../api/obsQc';
import type { ObsQcResponse } from '../../api/obsQc';
import { SatVisibilityChart } from './SatVisibilityChart';
import { SnrChart } from './SnrChart';

interface ObsViewerModalProps {
  opened: boolean;
  onClose: () => void;
  obsFile: string;
  navFile?: string;
}

type ViewMode = 'visibility' | 'snr-time' | 'snr-elevation';

const CONSTELLATION_OPTIONS = [
  { value: 'G', label: 'GPS', color: '#4CAF50' },
  { value: 'R', label: 'GLO', color: '#F44336' },
  { value: 'E', label: 'GAL', color: '#2196F3' },
  { value: 'C', label: 'BDS', color: '#FF9800' },
  { value: 'J', label: 'QZS', color: '#9C27B0' },
  { value: 'S', label: 'SBAS', color: '#795548' },
  { value: 'I', label: 'IRN', color: '#607D8B' },
];

/** Map RINEX SNR signal codes to friendly labels */
const SIGNAL_LABELS: Record<string, string> = {
  S1C: 'L1 C/A',
  S1S: 'L1 C/A',
  S1W: 'L1 P(Y)',
  S1X: 'L1 B+C',
  S2C: 'L2 C/A',
  S2D: 'L2 Semi-CL',
  S2W: 'L2 P(Y)',
  S2L: 'L2C(L)',
  S2S: 'L2C(M)',
  S2X: 'L2C',
  S2P: 'L2 P',
  S5I: 'L5 I',
  S5Q: 'L5 Q',
  S5X: 'L5 I+Q',
  S6A: 'L6 A',
  S6B: 'L6 B',
  S6C: 'L6 C',
  S6X: 'L6 B+C',
  S7I: 'E5b I',
  S7Q: 'E5b Q',
  S7X: 'E5b I+Q',
  S8I: 'E5 I',
  S8Q: 'E5 Q',
  S8X: 'E5 I+Q',
};

export function ObsViewerModal({
  opened,
  onClose,
  obsFile,
  navFile,
}: ObsViewerModalProps) {
  const [data, setData] = useState<ObsQcResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('visibility');
  const [selectedConstellations, setSelectedConstellations] = useState<string[]>([
    'G', 'R', 'E', 'C', 'J',
  ]);
  const [selectedSignal, setSelectedSignal] = useState<string | null>(null);

  const constellationFilter = useMemo(
    () => new Set(selectedConstellations),
    [selectedConstellations],
  );

  // Fetch data when modal opens or signal changes
  useEffect(() => {
    if (!opened || !obsFile) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    analyzeObs({
      obs_file: obsFile,
      nav_file: navFile || undefined,
      signal: selectedSignal || undefined,
    })
      .then((result) => {
        if (cancelled) return;
        setData(result);

        // Auto-select constellations on first load only
        if (!selectedSignal) {
          const foundConstellations = new Set<string>();
          for (const sat of result.satellites) {
            foundConstellations.add(sat[0]);
          }
          setSelectedConstellations(
            CONSTELLATION_OPTIONS.filter((c) => foundConstellations.has(c.value)).map(
              (c) => c.value,
            ),
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Analysis failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [opened, obsFile, navFile, selectedSignal]);

  // Available constellations from data
  const availableConstellations = useMemo(() => {
    if (!data) return [];
    const found = new Set<string>();
    for (const sat of data.satellites) {
      found.add(sat[0]);
    }
    return CONSTELLATION_OPTIONS.filter((c) => found.has(c.value));
  }, [data]);

  // Signal dropdown options
  const signalOptions = useMemo(() => {
    if (!data) return [];
    return data.signals.map((s) => ({
      value: s,
      label: SIGNAL_LABELS[s] ? `${s} (${SIGNAL_LABELS[s]})` : s,
    }));
  }, [data]);

  const handleConstellationChange = useCallback((values: string[]) => {
    setSelectedConstellations(values);
  }, []);

  const vizHeight = 500;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Observation Data QC"
      size="xl"
      styles={{
        body: { padding: '0 16px 16px' },
        title: { fontWeight: 600, fontSize: '14px' },
      }}
    >
      {/* Initial loading (no data yet) */}
      {loading && !data && (
        <Stack align="center" justify="center" h={300} gap="xs">
          <Loader size="sm" color="gray" />
          <Text size="xs" c="dimmed">
            Analyzing observation file...
          </Text>
        </Stack>
      )}

      {error && (
        <Alert
          color="red"
          icon={<IconInfoCircle size={14} />}
          p="xs"
          mt="xs"
        >
          <Text size="xs">{error}</Text>
        </Alert>
      )}

      {data && (
        <Stack gap="xs">
          {/* Header summary */}
          <Group gap="xs" wrap="wrap">
            <Badge size="xs" variant="light" color="blue">
              RINEX {data.header.rinex_version}
            </Badge>
            <Badge size="xs" variant="light" color="gray">
              {data.header.num_epochs.toLocaleString()} epochs
            </Badge>
            <Badge size="xs" variant="light" color="gray">
              {data.header.num_satellites} sats
            </Badge>
            <Badge size="xs" variant="light" color="gray">
              {data.header.interval}s interval
            </Badge>
            {data.decimation_factor > 1 && (
              <Badge size="xs" variant="light" color="orange">
                SNR 1/{data.decimation_factor}
              </Badge>
            )}
            <Badge size="xs" variant="light" color="gray">
              {data.header.start_time}
            </Badge>
          </Group>

          {/* Controls */}
          <Group justify="space-between" wrap="nowrap">
            <SegmentedControl
              size="xs"
              value={viewMode}
              onChange={(v) => setViewMode(v as ViewMode)}
              data={[
                { label: 'Visibility', value: 'visibility' },
                { label: 'SNR/Time', value: 'snr-time' },
                { label: 'SNR/El', value: 'snr-elevation' },
              ]}
            />

            <Group gap="xs">
              <Select
                size="xs"
                value={selectedSignal}
                onChange={setSelectedSignal}
                placeholder="Signal"
                data={signalOptions}
                clearable
                w={160}
                styles={{
                  input: { fontSize: '11px' },
                }}
              />

              <Checkbox.Group
                value={selectedConstellations}
                onChange={handleConstellationChange}
              >
                <Group gap={6}>
                  {availableConstellations.map((c) => (
                    <Checkbox
                      key={c.value}
                      value={c.value}
                      label={
                        <Text size="xs" style={{ color: c.color, fontSize: '10px' }}>
                          {c.label}
                        </Text>
                      }
                      size="xs"
                      styles={{
                        input: { cursor: 'pointer' },
                        label: { paddingLeft: 4, cursor: 'pointer' },
                      }}
                    />
                  ))}
                </Group>
              </Checkbox.Group>
            </Group>
          </Group>

          {/* Visualization */}
          <div style={{ position: 'relative' }}>
            {loading && (
              <Stack
                align="center"
                justify="center"
                style={{
                  position: 'absolute',
                  inset: 0,
                  zIndex: 10,
                  backgroundColor: 'rgba(0,0,0,0.05)',
                  borderRadius: 4,
                }}
              >
                <Loader size="sm" color="gray" />
              </Stack>
            )}
            <div style={{ opacity: loading ? 0.4 : 1, transition: 'opacity 0.2s' }}>
              {viewMode === 'visibility' && (
                <SatVisibilityChart
                  visibility={data.visibility}
                  satellites={data.satellites}
                  snr={data.snr}
                  height={vizHeight}
                  constellationFilter={constellationFilter}
                />
              )}
              {viewMode === 'snr-time' && (
                <SnrChart
                  snr={data.snr}
                  satellites={data.satellites}
                  height={vizHeight}
                  mode="time"
                  constellationFilter={constellationFilter}
                  hasElevation={data.has_elevation}
                />
              )}
              {viewMode === 'snr-elevation' && (
                <SnrChart
                  snr={data.snr}
                  satellites={data.satellites}
                  height={vizHeight}
                  mode="elevation"
                  constellationFilter={constellationFilter}
                  hasElevation={data.has_elevation}
                />
              )}
            </div>
          </div>
        </Stack>
      )}
    </Modal>
  );
}
