import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocalStorage, useDisclosure } from '@mantine/hooks';
import {
  Card,
  Grid,
  Stack,
  Select,
  SimpleGrid,
  Text,
  Title,
  Group,
  Switch,
  NumberInput,
  Button,
  ActionIcon,
  Tooltip,
  Badge,
  ScrollArea,
  Tabs,
  SegmentedControl,
  Box,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconDownload,
  IconCode,
  IconUpload,
  IconX,
  IconBookmark,
} from '@tabler/icons-react';
import type { MrtkPostConfig } from '../types/mrtkPostConfig';
import { DEFAULT_MRTK_POST_CONFIG } from '../types/mrtkPostConfig';
import type {
  StreamsConfig,
  StreamConfig,
  BaseStreamConfig,
  StreamType,
  StreamFormat,
  RunStatus,
  PositionUpdate,
} from '../types/mrtkRunConfig';
import { DEFAULT_STREAMS } from '../types/mrtkRunConfig';
import { ProcessingConfigPanel, TomlDrawer } from './ProcessingConfigTabs';
import { PresetPanel } from './PresetPanel';
import { StreamPathHelp } from './StreamPathHelp';
import { tomlToConfig } from '../utils/tomlImport';
import { configToBackend } from '../utils/configToBackend';
import { mrtkRunApi } from '../api/mrtkRun';
import { PositionScatter, type PositionPoint } from './PositionScatter';
import { SkySnrPanel, type Satellite } from './SkySnrPanel';
import { TimeSeriesChart, type TimeSeriesPoint } from './TimeSeriesChart';
import { MaskedPathInput } from './common/MaskedPathInput';
import { maskLogLine } from '../utils/maskPath';

// ─── Stream editor sub-component ────────────────────────────────────────────

const STREAM_TYPES: { value: StreamType; label: string }[] = [
  { value: 'off', label: 'OFF' },
  { value: 'serial', label: 'Serial' },
  { value: 'file', label: 'File' },
  { value: 'tcpsvr', label: 'TCP Server' },
  { value: 'tcpcli', label: 'TCP Client' },
  { value: 'ntrip', label: 'NTRIP Client' },
];

const INPUT_FORMATS: { value: StreamFormat; label: string }[] = [
  { value: '', label: '(none)' },
  { value: 'rtcm3', label: 'RTCM3' },
  { value: 'ubx', label: 'u-blox' },
  { value: 'sbf', label: 'Septentrio SBF' },
  { value: 'binex', label: 'BINEX' },
  { value: 'rinex', label: 'RINEX' },
  { value: 'clas', label: 'CLAS L6' },
  { value: 'l6e', label: 'L6E' },
];

const OUTPUT_FORMATS: { value: StreamFormat; label: string }[] = [
  { value: '', label: '(none)' },
  { value: 'nmea', label: 'NMEA' },
];

const LABEL_STYLE = { width: 90, flexShrink: 0, fontSize: '11px' } as const;

function StreamEditor({
  label,
  stream,
  onChange,
  formats = INPUT_FORMATS,
  showNmea = false,
}: {
  label: string;
  stream: StreamConfig | BaseStreamConfig;
  onChange: (s: StreamConfig | BaseStreamConfig) => void;
  formats?: { value: StreamFormat; label: string }[];
  showNmea?: boolean;
}) {
  const isOff = stream.type === 'off';
  const baseStream = stream as BaseStreamConfig;

  return (
    <Stack gap={4}>
      <Text size="xs" fw={600} mb={2}>{label}</Text>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={LABEL_STYLE}>Type</Text>
        <Select size="xs" value={stream.type}
          onChange={(v: any) => onChange({ ...stream, type: v as StreamType })}
          data={STREAM_TYPES} style={{ flex: 1 }} />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={LABEL_STYLE}>Path</Text>
        <MaskedPathInput size="xs" value={stream.path}
          onChange={(v) => onChange({ ...stream, path: v })}
          placeholder={isOff ? '' : ({
            serial: 'ttyUSB0:115200',
            tcpcli: '192.168.1.100:2101',
            tcpsvr: ':2101',
            ntrip: 'user:pass@rtk2go.com:2101/MOUNT',
            file: '/workspace/data.ubx',
            off: '',
          } as Record<string, string>)[stream.type] || 'e.g. host:port'}
          disabled={isOff} style={{ flex: 1 }}
          styles={{ input: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' } }} />
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={LABEL_STYLE}>Format</Text>
        <Select size="xs" value={stream.format}
          onChange={(v: any) => onChange({ ...stream, format: v as StreamFormat })}
          data={formats} disabled={isOff} style={{ flex: 1 }} />
      </Group>
      {showNmea && !isOff && (
        <>
          <Group wrap="nowrap" align="center" gap="xs">
            <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA Req.</Text>
            <Switch size="xs" checked={baseStream.nmeareq ?? false}
              onChange={(e) => onChange({ ...baseStream, nmeareq: e.currentTarget.checked })} />
          </Group>
          <Group wrap="nowrap" align="center" gap="xs">
            <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA Lat</Text>
            <NumberInput size="xs" value={baseStream.nmealat ?? 0}
              onChange={(v: any) => onChange({ ...baseStream, nmealat: Number(v) })}
              decimalScale={6} disabled={!baseStream.nmeareq} style={{ flex: 1 }} />
          </Group>
          <Group wrap="nowrap" align="center" gap="xs">
            <Text size="xs" c="dimmed" style={LABEL_STYLE}>NMEA Lon</Text>
            <NumberInput size="xs" value={baseStream.nmealon ?? 0}
              onChange={(v: any) => onChange({ ...baseStream, nmealon: Number(v) })}
              decimalScale={6} disabled={!baseStream.nmeareq} style={{ flex: 1 }} />
          </Group>
        </>
      )}
    </Stack>
  );
}

// ─── Quality badge ──────────────────────────────────────────────────────────

// Output & Log stream slots (unified list, expandable)
const OUTPUT_LOG_SLOTS = [
  {
    key: 'out1', label: 'Output 1 (Solution)', formats: OUTPUT_FORMATS,
    get: (s: StreamsConfig) => s.output.stream1,
    set: (s: StreamsConfig, v: StreamConfig): StreamsConfig => ({ ...s, output: { ...s.output, stream1: v } }),
  },
  {
    key: 'out2', label: 'Output 2', formats: OUTPUT_FORMATS,
    get: (s: StreamsConfig) => s.output.stream2,
    set: (s: StreamsConfig, v: StreamConfig): StreamsConfig => ({ ...s, output: { ...s.output, stream2: v } }),
  },
  {
    key: 'log1', label: 'Log 1', formats: INPUT_FORMATS,
    get: (s: StreamsConfig) => s.log.stream1,
    set: (s: StreamsConfig, v: StreamConfig): StreamsConfig => ({ ...s, log: { ...s.log, stream1: v } }),
  },
  {
    key: 'log2', label: 'Log 2', formats: INPUT_FORMATS,
    get: (s: StreamsConfig) => s.log.stream2,
    set: (s: StreamsConfig, v: StreamConfig): StreamsConfig => ({ ...s, log: { ...s.log, stream2: v } }),
  },
  {
    key: 'log3', label: 'Log 3', formats: INPUT_FORMATS,
    get: (s: StreamsConfig) => s.log.stream3,
    set: (s: StreamsConfig, v: StreamConfig): StreamsConfig => ({ ...s, log: { ...s.log, stream3: v } }),
  },
];

// ─── Main component ─────────────────────────────────────────────────────────

interface RealTimeProcessingProps {
  onConfigChange?: (config: MrtkPostConfig) => void;
}

export function RealTimeProcessing({ onConfigChange }: RealTimeProcessingProps) {
  const [config, setConfig] = useLocalStorage<MrtkPostConfig>({
    key: 'mrtklib-web-ui-mrtk-run-config-v2',
    defaultValue: DEFAULT_MRTK_POST_CONFIG,
  });

  const [streams, setStreams] = useLocalStorage<StreamsConfig>({
    key: 'mrtklib-web-ui-mrtk-run-streams-v2',
    defaultValue: DEFAULT_STREAMS,
  });

  const [tomlOpened, { open: openToml, close: closeToml }] = useDisclosure(false);
  const [presetsOpened, { open: openPresets, close: closePresets }] = useDisclosure(false);
  const importFileRef = useRef<HTMLInputElement>(null);
  const handleImportToml = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const res = await fetch('/api/config/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toml_content: text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Import failed' }));
        throw new Error(err.detail || 'Import failed');
      }
      const { config: parsed } = await res.json();
      const mapped = tomlToConfig(parsed);
      setConfig((prev) => ({ ...prev, ...mapped } as MrtkPostConfig));
      notifications.show({ title: 'Import successful', message: `Loaded ${file.name}`, color: 'green' });
    } catch (e) {
      notifications.show({ title: 'Import failed', message: e instanceof Error ? e.message : 'Unknown error', color: 'red' });
    }
  }, [setConfig]);
  const [outputLogCount, setOutputLogCount] = useState(1);
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [lastPosition, setLastPosition] = useState<PositionUpdate | null>(null);
  const [positionHistory, setPositionHistory] = useState<PositionPoint[]>([]);
  const [timeSeriesHistory, setTimeSeriesHistory] = useState<TimeSeriesPoint[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [chartView, setChartView] = useState<'scatter' | 'series' | 'skysnr'>('scatter');
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const MAX_HISTORY = 600;

  const handleConfigChange = useCallback((newConfig: MrtkPostConfig) => {
    setConfig(newConfig);
    onConfigChange?.(newConfig);
  }, [setConfig, onConfigChange]);

  const isRunning = runStatus === 'running' || runStatus === 'starting';

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  // Build backend-compatible streams config
  const buildStreamsPayload = useCallback(() => ({
    input_rover: streams.input.rover,
    input_base: streams.input.base,
    input_correction: streams.input.correction,
    output_stream1: streams.output.stream1,
    output_stream2: streams.output.stream2,
    log_stream1: streams.log.stream1,
    log_stream2: streams.log.stream2,
    log_stream3: streams.log.stream3,
  }), [streams]);

  // Connect WebSocket for real-time updates
  const connectWs = useCallback(() => {
    if (wsRef.current) return;
    const ws = mrtkRunApi.connectWs();
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          if (msg.server_state === 'run') {
            setRunStatus('running');
          } else if (msg.server_state === 'stop') {
            setRunStatus('idle');
          }
          if (msg.lat !== undefined) {
            const pos: PositionUpdate = {
              timestamp: msg.timestamp || '',
              lat: msg.lat,
              lon: msg.lon,
              height: msg.height || 0,
              quality: msg.quality || 0,
              ns: msg.ns || 0,
              ratio: msg.ratio || 0,
              age: msg.age || 0,
            };
            setLastPosition(pos);
            setPositionHistory(prev => [
              ...prev.slice(-(MAX_HISTORY - 1)),
              { lat: pos.lat, lon: pos.lon, height: pos.height, quality: pos.quality, timestamp: pos.timestamp },
            ]);
            setTimeSeriesHistory(prev => [
              ...prev.slice(-(MAX_HISTORY - 1)),
              { timestamp: pos.timestamp, quality: pos.quality, ns: pos.ns, ratio: pos.ratio },
            ]);
          }
          if (msg.satellites) {
            setSatellites(msg.satellites as Satellite[]);
          }
        } else if (msg.type === 'log') {
          setLogLines(prev => [...prev.slice(-500), msg.message]);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, []);

  // Disconnect WebSocket
  const disconnectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const handleStart = async () => {
    setRunStatus('starting');
    setLogLines(prev => [...prev, '[INFO] Starting mrtk run -s ...']);
    try {
      // Connect WebSocket FIRST so we receive logs during start()
      connectWs();
      // Wait for WebSocket to open
      await new Promise<void>((resolve) => {
        const ws = wsRef.current;
        if (!ws) { resolve(); return; }
        if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
        const onOpen = () => { ws.removeEventListener('open', onOpen); resolve(); };
        ws.addEventListener('open', onOpen);
        // Timeout fallback
        setTimeout(resolve, 2000);
      });

      const resp = await mrtkRunApi.start({
        config: configToBackend(config),
        streams: buildStreamsPayload(),
      });
      if (resp.status === 'ok') {
        setRunStatus('running');
        setLogLines(prev => [...prev, `[INFO] ${resp.message}`]);
      } else {
        setRunStatus('error');
        setLogLines(prev => [...prev, `[ERROR] ${resp.message}`]);
        disconnectWs();
      }
    } catch (err) {
      setRunStatus('error');
      setLogLines(prev => [...prev, `[ERROR] ${err instanceof Error ? err.message : String(err)}`]);
      disconnectWs();
    }
  };

  const handleStop = async () => {
    setRunStatus('stopping');
    setLogLines(prev => [...prev, '[INFO] Stopping ...']);
    try {
      await mrtkRunApi.stop();
      setRunStatus('idle');
      setLastPosition(null);
      setPositionHistory([]);
      setTimeSeriesHistory([]);
      disconnectWs();
      setLogLines(prev => [...prev, '[INFO] Stopped']);
    } catch (err) {
      setRunStatus('error');
      setLogLines(prev => [...prev, `[ERROR] ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  return (
    <>
    <Grid gutter="md">
      {/* Left Column: Configuration */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p="xs">
          <Stack gap={4}>
            <Group justify="space-between">
              <Title order={6} size="xs">Processing Configuration</Title>
              <Group gap="xs">
                {runStatus !== 'idle' && (
                  <Badge color={isRunning ? 'green' : runStatus === 'error' ? 'red' : 'gray'} variant="dot" size="sm">
                    {runStatus}
                  </Badge>
                )}
                {!isRunning ? (
                  <Button size="xs" color="green" leftSection={<IconPlayerPlay size={14} />}
                    onClick={handleStart} disabled={streams.input.rover.type === 'off'}>
                    Start
                  </Button>
                ) : (
                  <Button size="xs" color="red" leftSection={<IconPlayerStop size={14} />}
                    onClick={handleStop}>
                    Stop
                  </Button>
                )}
                <Tooltip label="Presets">
                  <ActionIcon variant="light" color="gray" size="lg" onClick={openPresets}>
                    <IconBookmark size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Import TOML">
                  <ActionIcon variant="light" color="gray" size="lg" onClick={() => importFileRef.current?.click()}>
                    <IconUpload size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="TOML Preview">
                  <ActionIcon variant="light" color="gray" size="lg" onClick={openToml}>
                    <IconCode size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Download TOML">
                  <ActionIcon variant="light" color="blue" size="lg" disabled={isRunning} onClick={async () => {
                    try {
                      const backendCfg = configToBackend(config);
                      const payload = { config: backendCfg, streams: buildStreamsPayload() };
                      const res = await fetch('/api/mrtk-run/export-toml', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                      });
                      if (!res.ok) throw new Error('Export failed');
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'rtkrcv.toml'; a.click();
                      URL.revokeObjectURL(url);
                    } catch { /* ignore */ }
                  }}>
                    <IconDownload size={16} />
                  </ActionIcon>
                </Tooltip>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".toml"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleImportToml(f);
                    e.target.value = '';
                  }}
                />
              </Group>
            </Group>

            <ProcessingConfigPanel
              config={config}
              onConfigChange={handleConfigChange}
              defaultSection="streams"
              streamPanels={[
                {
                  key: 'streams',
                  label: 'I/O Streams',
                  content: (
                    <Stack gap="xs">
                      <Group gap={4}><Text size="xs" fw={600}>Input Streams</Text><StreamPathHelp /></Group>
                      <StreamEditor label="Rover" stream={streams.input.rover}
                        onChange={(s) => setStreams({ ...streams, input: { ...streams.input, rover: s as StreamConfig } })} />
                      <StreamEditor label="Base Station" stream={streams.input.base}
                        onChange={(s) => setStreams({ ...streams, input: { ...streams.input, base: s as BaseStreamConfig } })} showNmea />
                      <StreamEditor label="Correction (L6 / RTCM / SSR)" stream={streams.input.correction}
                        onChange={(s) => setStreams({ ...streams, input: { ...streams.input, correction: s as StreamConfig } })} />

                      <Group justify="space-between" mt="xs">
                        <Group gap={4}><Text size="xs" fw={600}>Output & Log Streams</Text><StreamPathHelp /></Group>
                        {outputLogCount < 5 && (
                          <Tooltip label="Add output/log stream" openDelay={300}>
                            <ActionIcon size="xs" variant="light" onClick={() => setOutputLogCount(c => Math.min(c + 1, 5))}>
                              <IconPlus size={12} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </Group>
                      {OUTPUT_LOG_SLOTS.slice(0, outputLogCount).map((slot, idx) => (
                        <Group key={slot.key} wrap="nowrap" align="flex-start" gap={4}>
                          <div style={{ flex: 1 }}>
                            <StreamEditor
                              label={slot.label}
                              stream={slot.get(streams)}
                              onChange={(s) => setStreams(slot.set(streams, s as StreamConfig))}
                              formats={slot.formats}
                            />
                          </div>
                          {idx > 0 && (
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="xs"
                              mt={24}
                              onClick={() => {
                                // Reset this slot to off and shrink count
                                const reset: StreamConfig = { type: 'off', path: '', format: '' };
                                setStreams(slot.set(streams, reset));
                                setOutputLogCount(c => Math.max(1, c - 1));
                              }}
                              title="Remove"
                            >
                              <IconX size={12} />
                            </ActionIcon>
                          )}
                        </Group>
                      ))}
                    </Stack>
                  ),
                },
              ]}
            />
          </Stack>
        </Card>
      </Grid.Col>

      {/* Right Column: Monitor (always visible) */}
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Card withBorder p="xs" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Stack gap={6} style={{ flex: 1, minHeight: 0 }}>

            {/* 1. Live coordinates row */}
            <SimpleGrid cols={4} spacing="xs">
              {([
                { label: 'Latitude', value: lastPosition?.lat.toFixed(8) },
                { label: 'Longitude', value: lastPosition?.lon.toFixed(8) },
                { label: 'Height (m)', value: lastPosition?.height.toFixed(3) },
              ] as const).map((item) => (
                <div key={item.label}>
                  <Text c="dimmed" style={{ fontSize: 9, lineHeight: 1.2 }}>{item.label}</Text>
                  <Text
                    ff="monospace"
                    style={{ fontSize: 14, lineHeight: 1.3, color: item.value ? 'var(--color-live, #3b82f6)' : undefined }}
                    c={item.value ? undefined : 'dimmed'}
                  >
                    {item.value ?? '---'}
                  </Text>
                </div>
              ))}
              <div>
                <Text c="dimmed" style={{ fontSize: 9, lineHeight: 1.2 }}>Quality</Text>
                <Group gap={4} align="center">
                  {lastPosition ? (
                    <Badge
                      size="sm"
                      variant="filled"
                      color={lastPosition.quality === 1 ? 'green' : lastPosition.quality === 2 ? 'yellow' : 'gray'}
                    >
                      {lastPosition.quality === 1 ? 'FIX' : lastPosition.quality === 2 ? 'FLOAT' : lastPosition.quality === 5 ? 'SINGLE' : `Q=${lastPosition.quality}`}
                    </Badge>
                  ) : (
                    <Text ff="monospace" c="dimmed" style={{ fontSize: 14, lineHeight: 1.3 }}>---</Text>
                  )}
                </Group>
              </div>
            </SimpleGrid>

            {/* 2. Quality metrics row */}
            <SimpleGrid cols={4} spacing="xs">
              <div>
                <Text c="dimmed" style={{ fontSize: 9, lineHeight: 1.2 }}>AR Ratio</Text>
                <Group gap={4} align="center">
                  <Text ff="monospace" style={{ fontSize: 14, lineHeight: 1.3, color: lastPosition ? 'var(--color-live, #3b82f6)' : undefined }} c={lastPosition ? undefined : 'dimmed'}>
                    {lastPosition?.ratio.toFixed(1) ?? '---'}
                  </Text>
                  {lastPosition && (
                    <Badge
                      size="xs"
                      variant="filled"
                      color={lastPosition.quality === 1 ? 'green' : lastPosition.quality === 2 ? 'yellow' : 'gray'}
                    >
                      {lastPosition.quality === 1 ? 'FIXED' : lastPosition.quality === 2 ? 'FLOAT' : 'SINGLE'}
                    </Badge>
                  )}
                </Group>
              </div>
              <div>
                <Text c="dimmed" style={{ fontSize: 9, lineHeight: 1.2 }}>Satellites</Text>
                <Text ff="monospace" style={{ fontSize: 14, lineHeight: 1.3, color: lastPosition ? 'var(--color-live, #3b82f6)' : undefined }} c={lastPosition ? undefined : 'dimmed'}>
                  {lastPosition?.ns ?? '---'}
                </Text>
              </div>
              <div>
                <Text c="dimmed" style={{ fontSize: 9, lineHeight: 1.2 }}>Age (s)</Text>
                <Text ff="monospace" style={{ fontSize: 14, lineHeight: 1.3, color: lastPosition ? 'var(--color-live, #3b82f6)' : undefined }} c={lastPosition ? undefined : 'dimmed'}>
                  {lastPosition?.age.toFixed(1) ?? '---'}
                </Text>
              </div>
              <div>
                <Text c="dimmed" style={{ fontSize: 9, lineHeight: 1.2 }}>Time (GPST)</Text>
                <Text ff="monospace" c="dimmed" style={{ fontSize: 11, lineHeight: 1.5 }}>
                  {lastPosition?.timestamp ?? '---'}
                </Text>
              </div>
            </SimpleGrid>

            {/* 3. Tab bar + 4. Chart area */}
            <Tabs defaultValue="chart" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <Group justify="space-between" align="center" gap={0}>
                <Tabs.List>
                  <Tabs.Tab value="chart" style={{ fontSize: 11 }}>Chart</Tabs.Tab>
                  <Tabs.Tab value="solution" style={{ fontSize: 11 }}>Solution</Tabs.Tab>
                  <Tabs.Tab value="console" style={{ fontSize: 11 }}>Console</Tabs.Tab>
                  <Tabs.Tab value="trace" style={{ fontSize: 11 }}>Trace</Tabs.Tab>
                </Tabs.List>
                <SegmentedControl
                  size="xs"
                  value={chartView}
                  onChange={(v) => setChartView(v as 'scatter' | 'series' | 'skysnr')}
                  data={[
                    { label: 'Scatter', value: 'scatter' },
                    { label: 'Series', value: 'series' },
                    { label: 'Sky+SNR', value: 'skysnr' },
                  ]}
                  styles={{ root: { marginRight: 4 } }}
                />
              </Group>

              <Tabs.Panel value="chart" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                {chartView === 'scatter' && (
                  <PositionScatter points={positionHistory} maxPoints={MAX_HISTORY} />
                )}
                {chartView === 'series' && (
                  <TimeSeriesChart points={timeSeriesHistory} maxPoints={MAX_HISTORY} />
                )}
                {chartView === 'skysnr' && (
                  <SkySnrPanel satellites={satellites} updateTime={lastPosition?.timestamp} />
                )}
              </Tabs.Panel>

              <Tabs.Panel value="solution" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <ScrollArea h={300}>
                  <Text ff="monospace" style={{ whiteSpace: 'pre-wrap', fontSize: 10, lineHeight: 1.4 }}>
                    {positionHistory.length > 0
                      ? positionHistory.map((p, i) =>
                          `${p.timestamp || i}  ${p.lat.toFixed(8)}  ${p.lon.toFixed(8)}  ${p.height.toFixed(3)}  Q=${p.quality}`
                        ).join('\n')
                      : 'No solution data yet.'}
                  </Text>
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="console" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <ScrollArea h={300}>
                  <Text ff="monospace" style={{ whiteSpace: 'pre-wrap', fontSize: 10, lineHeight: 1.4 }}>
                    {logLines.length > 0 ? logLines.map(maskLogLine).join('\n') : 'No log output yet.'}
                  </Text>
                  <div ref={logEndRef} />
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="trace" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <ScrollArea h={300}>
                  <Text ff="monospace" c="dimmed" style={{ whiteSpace: 'pre-wrap', fontSize: 10, lineHeight: 1.4 }}>
                    Trace output will appear here when trace level is enabled.
                  </Text>
                </ScrollArea>
              </Tabs.Panel>
            </Tabs>

            {/* 5. Console strip (always visible) */}
            <Box
              style={{
                height: 72,
                overflow: 'hidden',
                backgroundColor: 'var(--app-surface, var(--mantine-color-dark-7))',
                borderRadius: 4,
                padding: '4px 8px',
              }}
            >
              <Text c="dimmed" tt="uppercase" style={{ fontSize: 9, lineHeight: 1.2, marginBottom: 2 }}>Console</Text>
              <Text ff="monospace" c="dimmed" style={{ whiteSpace: 'pre-wrap', fontSize: 9, lineHeight: 1.35 }}>
                {logLines.length > 0
                  ? logLines.slice(-4).map(maskLogLine).join('\n')
                  : 'No log output yet.'}
              </Text>
            </Box>

          </Stack>
        </Card>
      </Grid.Col>
    </Grid>
    <TomlDrawer config={config} opened={tomlOpened} onClose={closeToml} streams={{
      'input.rover': streams.input.rover,
      'input.base': { type: streams.input.base.type, path: streams.input.base.path, format: streams.input.base.format },
      'input.correction': streams.input.correction,
      'output.stream1': streams.output.stream1,
      'output.stream2': streams.output.stream2,
      'log.stream1': streams.log.stream1,
      'log.stream2': streams.log.stream2,
      'log.stream3': streams.log.stream3,
    }} />
    <PresetPanel
      opened={presetsOpened}
      onClose={closePresets}
      mode="realtime"
      currentConfig={config}
      onLoad={(c) => setConfig(c)}
    />
    </>
  );
}
