import { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { useLocalStorage, useDisclosure, useElementSize } from '@mantine/hooks';
import {
  Card,
  Stack,
  Select,
  Text,
  Title,
  Group,
  Switch,
  NumberInput,
  TextInput,
  Button,
  ActionIcon,
  Tooltip,
  Badge,
  ScrollArea,
  Tabs,
  Chip,
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
  IconSparkles,
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
import { ConfigAssistantModal } from './ConfigAssistantModal';
import { configToBackend } from '../utils/configToBackend';
import { mrtkRunApi } from '../api/mrtkRun';
import { PositionScatter, type PositionPoint } from './PositionScatter';
import { SkySnrPanel, type Satellite } from './SkySnrPanel';
import { TimeSeriesChart, type TimeSeriesPoint } from './TimeSeriesChart';
import { MaskedPathInput } from './common/MaskedPathInput';
import { ConsoleFrame, ConfigCollapseButton } from './ConsoleFrame';
import { RtMetricsRow } from './RtMetricsRow';
import { MapView, type PosEpoch } from './viewer';
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
  footer,
}: {
  label: string;
  stream: StreamConfig | BaseStreamConfig;
  onChange: (s: StreamConfig | BaseStreamConfig) => void;
  formats?: { value: StreamFormat; label: string }[];
  showNmea?: boolean;
  footer?: ReactNode;
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
      {footer}
    </Stack>
  );
}

// ─── Raw input log (logstrN) ────────────────────────────────────────────────

// mrtk writes each input stream's raw bytes (before decoding) to logstrN:
// log.stream1 = rover, log.stream2 = base, log.stream3 = correction.
type RawLogInput = 'rover' | 'base' | 'correction';

const RAW_LOG_PREFIX: Record<RawLogInput, string> = {
  rover: 'rovr',
  base: 'base',
  correction: 'corr',
};

const RAW_LOG_EXT: Record<StreamFormat, string> = {
  rtcm3: 'rtcm3', ubx: 'ubx', sbf: 'sbf', binex: 'bnx', rinex: 'obs',
  clas: 'l6', l6e: 'l6', nmea: 'nmea', '': 'raw',
};

// Hourly files: %Y=year, %n=DOY, %H=hour code (a-x). Keywords are expanded
// by mrtk in GPST; ::S=1 swaps to a new file every hour.
function defaultRawLogBase(input: RawLogInput, format: StreamFormat): string {
  return `/workspace/rtlog/%Y/%n/${RAW_LOG_PREFIX[input]}_%n%H.${RAW_LOG_EXT[format] ?? 'raw'}`;
}

function parseRawLogPath(path: string): { base: string; timetag: boolean } {
  const [base, ...opts] = path.split('::');
  return { base, timetag: opts.includes('T') };
}

function composeRawLogPath(base: string, timetag: boolean): string {
  return `${base}::S=1${timetag ? '::T' : ''}`;
}

/** Keep an untouched default log path's extension in sync with the input format. */
function syncRawLogFormat(
  log: StreamConfig, input: RawLogInput, oldFormat: StreamFormat, newFormat: StreamFormat,
): StreamConfig {
  const { base, timetag } = parseRawLogPath(log.path);
  if (oldFormat === newFormat || base !== defaultRawLogBase(input, oldFormat)) return log;
  return { ...log, path: composeRawLogPath(defaultRawLogBase(input, newFormat), timetag) };
}

function RawLogEditor({
  input,
  inputStream,
  log,
  onChange,
}: {
  input: RawLogInput;
  inputStream: StreamConfig;
  log: StreamConfig;
  onChange: (s: StreamConfig) => void;
}) {
  const enabled = log.type !== 'off';
  const { base, timetag } = parseRawLogPath(log.path);

  return (
    <>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={LABEL_STYLE}>Save Raw</Text>
        <Switch size="xs" checked={enabled}
          disabled={!enabled && inputStream.type === 'off'}
          onChange={(e) => onChange(e.currentTarget.checked
            ? {
                type: 'file',
                path: composeRawLogPath(base || defaultRawLogBase(input, inputStream.format), timetag),
                format: '',
              }
            : { ...log, type: 'off' })} />
        <Tooltip label="Write a .tag file so the log can be replayed in real time (file::T)" openDelay={300}>
          <div>
            <Switch size="xs" label="Time tag" checked={timetag} disabled={!enabled}
              onChange={(e) => onChange({ ...log, path: composeRawLogPath(base, e.currentTarget.checked) })}
              styles={{ label: { fontSize: '11px' } }} />
          </div>
        </Tooltip>
      </Group>
      <Group wrap="nowrap" align="center" gap="xs">
        <Text size="xs" c="dimmed" style={LABEL_STYLE}>Raw Path</Text>
        <TextInput size="xs" value={enabled ? base : ''}
          onChange={(e) => onChange({ ...log, path: composeRawLogPath(e.currentTarget.value, timetag) })}
          placeholder={defaultRawLogBase(input, inputStream.format)}
          disabled={!enabled}
          style={{ flex: 1, minWidth: 0 }}
          styles={{ input: { fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' } }} />
      </Group>
    </>
  );
}

// ─── Quality badge ──────────────────────────────────────────────────────────

// Output stream slots (expandable)
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
];

// ─── Main component ─────────────────────────────────────────────────────────

/** Compact live RT status fed to the global bottom status bar. */
export interface RtLiveStatus {
  lat: number;
  lon: number;
  height: number;
  quality: number;
  ns: number;
  ratio: number;
  age: number;
  satsVisible: number;
}

interface RealTimeProcessingProps {
  onConfigChange?: (config: MrtkPostConfig) => void;
  onNavigateToAiSettings?: () => void;
  aiConfigured?: boolean;
  configOpen?: boolean;
  onToggleConfig?: () => void;
  onLiveStatus?: (status: RtLiveStatus | null) => void;
}

export function RealTimeProcessing({ onConfigChange, onNavigateToAiSettings, aiConfigured, configOpen = true, onToggleConfig, onLiveStatus }: RealTimeProcessingProps) {
  const [config, setConfig] = useLocalStorage<MrtkPostConfig>({
    key: 'mrtklib-web-ui-mrtk-run-config-v3',
    defaultValue: DEFAULT_MRTK_POST_CONFIG,
  });

  const [streams, setStreams] = useLocalStorage<StreamsConfig>({
    key: 'mrtklib-web-ui-mrtk-run-streams-v2',
    defaultValue: DEFAULT_STREAMS,
  });

  const [tomlOpened, { open: openToml, close: closeToml }] = useDisclosure(false);
  const [presetsOpened, { open: openPresets, close: closePresets }] = useDisclosure(false);
  const [assistantOpened, { open: openAssistant, close: closeAssistant }] = useDisclosure(false);
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
  // Derived each render: useLocalStorage hydrates after mount, so a lazy
  // useState initializer would only ever see DEFAULT_STREAMS.
  const [showOutput2, setShowOutput2] = useState(false);
  const outputLogCount = showOutput2 || streams.output.stream2.type !== 'off' ? 2 : 1;
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  // Tracks whether the user currently intends a run to be active (true between
  // handleStart and handleStop). Updated synchronously so the WebSocket
  // onmessage closure (created once with empty deps) never reads a stale value.
  const runIntentRef = useRef(false);
  const [lastPosition, setLastPosition] = useState<PositionUpdate | null>(null);
  const [positionHistory, setPositionHistory] = useState<PositionPoint[]>([]);
  const [timeSeriesHistory, setTimeSeriesHistory] = useState<TimeSeriesPoint[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [chartViews, setChartViews] = useState<string[]>(['scatter']);
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const MAX_HISTORY = 600;

  // Measured height for the live map (leaflet needs an explicit pixel height).
  const { ref: mapWrapRef, height: mapHeight } = useElementSize();

  // Adapt the RT position history to the viewer's PosEpoch shape so the
  // shared MapView (real basemap) can render the live track.
  const mapEpochs = useMemo<PosEpoch[]>(
    () =>
      positionHistory.map((p) => {
        const t = new Date(p.timestamp);
        const time = isNaN(t.getTime()) ? new Date(0) : t;
        return {
          time,
          timeUnix: time.getTime() / 1000,
          lat: p.lat,
          lon: p.lon,
          height: p.height,
          Q: p.quality,
          ns: 0,
          sdn: 0,
          sde: 0,
          sdu: 0,
          age: 0,
          ratio: 0,
        };
      }),
    [positionHistory],
  );

  const handleConfigChange = useCallback((newConfig: MrtkPostConfig) => {
    setConfig(newConfig);
    onConfigChange?.(newConfig);
  }, [setConfig, onConfigChange]);

  const isRunning = runStatus === 'running' || runStatus === 'starting';

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  // Feed live status to the global bottom status bar (null clears it on stop).
  useEffect(() => {
    if (!onLiveStatus) return;
    if (!lastPosition) {
      onLiveStatus(null);
      return;
    }
    onLiveStatus({
      lat: lastPosition.lat,
      lon: lastPosition.lon,
      height: lastPosition.height,
      quality: lastPosition.quality,
      ns: lastPosition.ns,
      ratio: lastPosition.ratio,
      age: lastPosition.age,
      satsVisible: satellites.length,
    });
  }, [lastPosition, satellites, onLiveStatus]);

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
          // Lifecycle (button state) is driven ONLY by explicit process signals,
          // never by the per-poll rtkrcv `server_state`. That field reflects the
          // rtkrcv RTK server *thread* state (run/stop) and can read "stop" while
          // our managed process is still alive and streaming — using it here was
          // what flipped the button back to Start the moment solutions appeared.
          if (msg.running === true) {
            // Positive confirmation the managed process is up (e.g. WS reconnect
            // while a run is active).
            runIntentRef.current = true;
            setRunStatus('running');
          } else if (msg.running === false) {
            // Only return to idle on a genuine process exit, or when we are not
            // intending to run (stale "not running" sent right on WS connect
            // during startup must be ignored so the button stays on Stop).
            if (msg.exited || !runIntentRef.current) {
              runIntentRef.current = false;
              setRunStatus('idle');
            }
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
    runIntentRef.current = true;
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
        runIntentRef.current = false;
        setRunStatus('error');
        setLogLines(prev => [...prev, `[ERROR] ${resp.message}`]);
        disconnectWs();
      }
    } catch (err) {
      runIntentRef.current = false;
      setRunStatus('error');
      setLogLines(prev => [...prev, `[ERROR] ${err instanceof Error ? err.message : String(err)}`]);
      disconnectWs();
    }
  };

  const handleStop = async () => {
    runIntentRef.current = false;
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
    <ConsoleFrame
      configOpen={configOpen}
      onToggleConfig={onToggleConfig ?? (() => {})}
      config={
        <Card withBorder p="xs">
          <Stack gap={4}>
            <Group justify="space-between">
              <Group gap="xs">
                {onToggleConfig && <ConfigCollapseButton onClick={onToggleConfig} />}
                <Title order={6} size="xs">Processing Configuration</Title>
              </Group>
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
                {aiConfigured ? (
                  <Tooltip label="Config Assistant">
                    <ActionIcon variant="light" color="yellow" size="lg" onClick={openAssistant}>
                      <IconSparkles size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <Tooltip label="Configure API key in Tools → AI Settings">
                    <ActionIcon variant="light" color="gray" size="lg" onClick={onNavigateToAiSettings}>
                      <IconSparkles size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
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
                        onChange={(s) => setStreams({
                          ...streams,
                          input: { ...streams.input, rover: s as StreamConfig },
                          log: { ...streams.log, stream1: syncRawLogFormat(streams.log.stream1, 'rover', streams.input.rover.format, s.format) },
                        })}
                        footer={<RawLogEditor input="rover" inputStream={streams.input.rover} log={streams.log.stream1}
                          onChange={(l) => setStreams({ ...streams, log: { ...streams.log, stream1: l } })} />} />
                      <StreamEditor label="Base Station" stream={streams.input.base}
                        onChange={(s) => setStreams({
                          ...streams,
                          input: { ...streams.input, base: s as BaseStreamConfig },
                          log: { ...streams.log, stream2: syncRawLogFormat(streams.log.stream2, 'base', streams.input.base.format, s.format) },
                        })} showNmea
                        footer={<RawLogEditor input="base" inputStream={streams.input.base} log={streams.log.stream2}
                          onChange={(l) => setStreams({ ...streams, log: { ...streams.log, stream2: l } })} />} />
                      <StreamEditor label="Correction (L6 / RTCM / SSR)" stream={streams.input.correction}
                        onChange={(s) => setStreams({
                          ...streams,
                          input: { ...streams.input, correction: s as StreamConfig },
                          log: { ...streams.log, stream3: syncRawLogFormat(streams.log.stream3, 'correction', streams.input.correction.format, s.format) },
                        })}
                        footer={<RawLogEditor input="correction" inputStream={streams.input.correction} log={streams.log.stream3}
                          onChange={(l) => setStreams({ ...streams, log: { ...streams.log, stream3: l } })} />} />

                      <Group justify="space-between" mt="xs">
                        <Group gap={4}><Text size="xs" fw={600}>Output Streams</Text><StreamPathHelp /></Group>
                        {outputLogCount < OUTPUT_LOG_SLOTS.length && (
                          <Tooltip label="Add output stream" openDelay={300}>
                            <ActionIcon size="xs" variant="light" onClick={() => setShowOutput2(true)}>
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
                                setShowOutput2(false);
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
      }
      workspace={
        <Card withBorder p="xs" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Stack gap={6} style={{ flex: 1, minHeight: 0 }}>

            {/* 1. Metrics row (Time · Position · Quality · Ratio · Age · Satellites) */}
            <RtMetricsRow lastPosition={lastPosition} satellites={satellites} />

            {/* 3. Tab bar + 4. Chart area */}
            <Tabs defaultValue="chart" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <Group justify="space-between" align="center" gap={0}>
                <Tabs.List>
                  <Tabs.Tab value="chart" style={{ fontSize: 11 }}>Chart</Tabs.Tab>
                  <Tabs.Tab value="solution" style={{ fontSize: 11 }}>Solution</Tabs.Tab>
                  <Tabs.Tab value="console" style={{ fontSize: 11 }}>Console</Tabs.Tab>
                  <Tabs.Tab value="trace" style={{ fontSize: 11 }}>Trace</Tabs.Tab>
                </Tabs.List>
                {/* Multi-select: show one or more charts side by side */}
                <Chip.Group
                  multiple
                  value={chartViews}
                  onChange={(v) => { if (v.length) setChartViews(v); }}
                >
                  <Group gap={6} wrap="nowrap" style={{ marginRight: 4 }}>
                    <Chip value="scatter" size="xs" variant="light">2D</Chip>
                    <Chip value="map" size="xs" variant="light">Map</Chip>
                    <Chip value="skysnr" size="xs" variant="light">Sky / SNR</Chip>
                    <Chip value="series" size="xs" variant="light">Time series</Chip>
                  </Group>
                </Chip.Group>
              </Group>

              <Tabs.Panel value="chart" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <div style={{ display: 'flex', gap: 10, height: '100%', minHeight: 0 }}>
                  {chartViews.includes('scatter') && (
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      <PositionScatter points={positionHistory} maxPoints={MAX_HISTORY} />
                    </div>
                  )}
                  {chartViews.includes('map') && (
                    <div ref={mapWrapRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      {mapHeight > 0 && <MapView data={mapEpochs} height={mapHeight} />}
                    </div>
                  )}
                  {chartViews.includes('skysnr') && (
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      <SkySnrPanel satellites={satellites} updateTime={lastPosition?.timestamp} />
                    </div>
                  )}
                  {chartViews.includes('series') && (
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      <TimeSeriesChart points={timeSeriesHistory} maxPoints={MAX_HISTORY} />
                    </div>
                  )}
                </div>
              </Tabs.Panel>

              <Tabs.Panel value="solution" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <ScrollArea
                  h={300}
                  styles={{ viewport: { backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)', padding: '8px 12px' } }}
                >
                  <Text
                    c={positionHistory.length > 0 ? 'gray.4' : 'dimmed'}
                    fs={positionHistory.length > 0 ? undefined : 'italic'}
                    style={{ fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: 1.5, wordBreak: 'break-all' }}
                  >
                    {positionHistory.length > 0
                      ? positionHistory.map((p, i) =>
                          `${p.timestamp || i}  ${p.lat.toFixed(8)}  ${p.lon.toFixed(8)}  ${p.height.toFixed(3)}  Q=${p.quality}`
                        ).join('\n')
                      : 'No solution data yet.'}
                  </Text>
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="console" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <ScrollArea
                  h={300}
                  styles={{ viewport: { backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)', padding: '8px 12px' } }}
                >
                  {logLines.length > 0 ? (
                    logLines.map((line, i) => (
                      <Text
                        key={i}
                        size="xs"
                        c="gray.4"
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '11px',
                          lineHeight: 1.5,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}
                      >
                        {maskLogLine(line)}
                      </Text>
                    ))
                  ) : (
                    <Text size="xs" c="dimmed" fs="italic" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}>
                      No log output yet.
                    </Text>
                  )}
                  <div ref={logEndRef} />
                </ScrollArea>
              </Tabs.Panel>

              <Tabs.Panel value="trace" style={{ flex: 1, minHeight: 0, paddingTop: 6 }}>
                <ScrollArea
                  h={300}
                  styles={{ viewport: { backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)', padding: '8px 12px' } }}
                >
                  <Text c="dimmed" fs="italic" style={{ fontFamily: "'IBM Plex Mono', monospace", whiteSpace: 'pre-wrap', fontSize: '11px', lineHeight: 1.5 }}>
                    Trace output will appear here when trace level is enabled.
                  </Text>
                </ScrollArea>
              </Tabs.Panel>
            </Tabs>

          </Stack>
        </Card>
      }
    />
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
    <ConfigAssistantModal
      opened={assistantOpened}
      onClose={closeAssistant}
      mode="realtime"
      onApply={(mapped) => setConfig((prev) => ({ ...prev, ...mapped } as MrtkPostConfig))}
    />
    </>
  );
}
