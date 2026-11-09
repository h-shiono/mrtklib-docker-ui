import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
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
import { deserializeWithDefaults } from '../utils/withDefaults';
import type {
  StreamsConfig,
  StreamConfig,
  BaseStreamConfig,
  StreamType,
  StreamFormat,
  RunStatus,
  PositionUpdate,
  InputStreamStatus,
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
import { SkySnrPanel } from './SkySnrPanel';
import type { Satellite } from '../types/satellite';
import { TimeSeriesChart, type TimeSeriesPoint } from './TimeSeriesChart';
import { MaskedPathInput } from './common/MaskedPathInput';
import { ConsoleFrame, ConfigCollapseButton } from './ConsoleFrame';
import { ENDED_OPACITY, RtMetricsRow } from './RtMetricsRow';
import { RtInputStatusRow } from './RtInputStatusRow';
import { MapView, type PosEpoch } from './viewer';
import { StatusBadge } from './common/StatusBadge';
import { processTone } from '../utils/status';
import { FONT_SIZE, MONO } from '../utils/typography';
import { FormRow } from './common/FormRow';
import { MIN_PANEL_HEIGHT } from '../utils/formLayout';
import { SectionHeader } from './common/SectionHeader';
import { WorkspaceTabBar } from './common/WorkspaceTabBar';
import { PRIMARY_MIN_WIDTH } from '../utils/formLayout';
import { LogView } from './common/LogView';
import { useUnseenErrors } from '../hooks/useUnseenErrors';

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

/** Padding above each tab panel. */
const PANEL_TOP = 6;

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
    <Stack gap={6}>
      <Text size="xs" fw={600} mb={2}>{label}</Text>
      <FormRow label="Type">
        <Select size="xs" value={stream.type}
          onChange={(v) => onChange({ ...stream, type: v as StreamType })}
          data={STREAM_TYPES} style={{ flex: 1 }} />
      </FormRow>
      <FormRow label="Path">
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
          styles={{ input: { fontFamily: MONO } }} />
      </FormRow>
      <FormRow label="Format">
        <Select size="xs" value={stream.format}
          onChange={(v) => onChange({ ...stream, format: v as StreamFormat })}
          data={formats} disabled={isOff} style={{ flex: 1 }} />
      </FormRow>
      {showNmea && !isOff && (
        <>
          <FormRow label="NMEA Req.">
            <Switch size="xs" checked={baseStream.nmeareq ?? false}
              onChange={(e) => onChange({ ...baseStream, nmeareq: e.currentTarget.checked })} />
          </FormRow>
          <FormRow label="NMEA Lat">
            <NumberInput size="xs" value={baseStream.nmealat ?? 0}
              onChange={(v) => onChange({ ...baseStream, nmealat: Number(v) })}
              decimalScale={6} disabled={!baseStream.nmeareq} style={{ flex: 1 }} />
          </FormRow>
          <FormRow label="NMEA Lon">
            <NumberInput size="xs" value={baseStream.nmealon ?? 0}
              onChange={(v) => onChange({ ...baseStream, nmealon: Number(v) })}
              decimalScale={6} disabled={!baseStream.nmeareq} style={{ flex: 1 }} />
          </FormRow>
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

/**
 * Raw logs are file-only. Logs saved by the old generic Log 1-3 editor may
 * carry another transport (tcpcli, serial, ...); treat any enabled log as a
 * file so what the switch shows is what mrtk gets (a non-file path is then
 * rejected at start instead of silently streaming elsewhere).
 */
function asRawLogFile(log: StreamConfig): StreamConfig {
  return log.type === 'off' || log.type === 'file' ? log : { ...log, type: 'file' };
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
      <FormRow label="Save Raw">
        <Group gap="xs" wrap="nowrap">
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
                onChange={(e) => onChange({ ...log, type: 'file', path: composeRawLogPath(base, e.currentTarget.checked) })}
                styles={{ label: { fontSize: FONT_SIZE.label } }} />
            </div>
          </Tooltip>
        </Group>
      </FormRow>
      <FormRow label="Raw Path">
        <TextInput size="xs" value={enabled ? base : ''}
          onChange={(e) => onChange({ ...log, type: 'file', path: composeRawLogPath(e.currentTarget.value, timetag) })}
          placeholder={defaultRawLogBase(input, inputStream.format)}
          disabled={!enabled}
          style={{ flex: 1, minWidth: 0 }}
          styles={{ input: { fontFamily: MONO } }} />
      </FormRow>
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
    // A config saved by an older UI lacks newer fields: fill them from the defaults.
    deserialize: deserializeWithDefaults(DEFAULT_MRTK_POST_CONFIG),
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
  // True only while /start is in flight: a "not running" status without
  // `exited` (sent on WS connect) is stale then and must not reset the button.
  // A ref so the WebSocket onmessage closure (created once with empty deps)
  // never reads a stale value.
  const startingRef = useRef(false);
  // A run that has ended stays on screen, dimmed, until the next one starts.
  const [ended, setEndedState] = useState<{ at: string; exitCode: number | null } | null>(null);
  const endedRef = useRef(ended);
  const setEnded = useCallback((value: typeof ended) => {
    endedRef.current = value;
    setEndedState(value);
  }, []);
  const runStatusRef = useRef(runStatus);
  useLayoutEffect(() => {
    runStatusRef.current = runStatus;
  });
  const [lastPosition, setLastPosition] = useState<PositionUpdate | null>(null);
  const [positionHistory, setPositionHistory] = useState<PositionPoint[]>([]);
  const [timeSeriesHistory, setTimeSeriesHistory] = useState<TimeSeriesPoint[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  // Debug trace of the current (or last) run, tailed by the backend.
  const [traceLines, setTraceLines] = useState<string[]>([]);
  const [traceFile, setTraceFile] = useState<string | null>(null);
  const [chartViews, setChartViews] = useState<string[]>(['scatter']);
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [inputStreams, setInputStreams] = useState<InputStreamStatus[]>([]);
  // When the last `streams` arrived (a failed poll omits it: shown as stale).
  const [inputStreamsAt, setInputStreamsAt] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const [monitorTab, setMonitorTab] = useState<string | null>('chart');
  const MAX_HISTORY = 600;
  const MAX_TRACE_LINES = 1000;

  // Measured height for the live map (leaflet needs an explicit pixel height).
  const { ref: panelsRef, height: panelsHeight } = useElementSize();
  const panelHeight = Math.max(MIN_PANEL_HEIGHT, panelsHeight - PANEL_TOP);
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

  // Keep the Solution / Console / Trace panels at their latest line, and
  // hold them still while the user scrolls up to read.
  const unseenErrors = useUnseenErrors(logLines, monitorTab === 'console');
  const solutionLines = useMemo(
    () => positionHistory.map((p, i) => `${p.timestamp || i}  ${p.lat.toFixed(8)}  ${p.lon.toFixed(8)}  ${p.height.toFixed(3)}  Q=${p.quality}`),
    [positionHistory],
  );

  // Feed live status to the global bottom status bar (null clears it on stop).
  useEffect(() => {
    if (!onLiveStatus) return;
    if (!lastPosition || ended) {
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
  }, [lastPosition, ended, satellites, onLiveStatus]);

  // Build backend-compatible streams config
  const buildStreamsPayload = useCallback(() => ({
    input_rover: streams.input.rover,
    input_base: streams.input.base,
    input_correction: streams.input.correction,
    output_stream1: streams.output.stream1,
    output_stream2: streams.output.stream2,
    log_stream1: asRawLogFile(streams.log.stream1),
    log_stream2: asRawLogFile(streams.log.stream2),
    log_stream3: asRawLogFile(streams.log.stream3),
  }), [streams]);

  // WebSocket for real-time updates. Connected for the component's whole
  // lifetime (not per run) and re-established on drop, so a reloaded page or a
  // reconnected SSH tunnel reattaches to a run the backend is still doing.
  const endSession = useCallback((exitCode: number | null) => {
    if (!endedRef.current) {
      setEnded({ at: new Date().toLocaleTimeString('en-GB', { hour12: false }), exitCode });
    }
    setRunStatus(exitCode ? 'exited' : 'stopped');
    setInputStreams([]);
  }, [setEnded]);

  const clearSession = useCallback(() => {
    setEnded(null);
    setLastPosition(null);
    setPositionHistory([]);
    setTimeSeriesHistory([]);
    setSatellites([]);
    setInputStreams([]);
  }, [setEnded]);

  const connectWs = useCallback(() => {
    if (wsRef.current || unmountedRef.current) return;
    const ws = mrtkRunApi.connectWs();
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history') {
          // Sent once on connect: what the backend buffered for this run. It is
          // authoritative, so an empty list (no run, or it ended while we were
          // disconnected) clears positions left over from before.
          if (Array.isArray(msg.logs)) setLogLines(msg.logs as string[]);
          setTraceLines(Array.isArray(msg.traces) ? (msg.traces as string[]) : []);
          setTraceFile(typeof msg.trace_file === 'string' ? msg.trace_file : null);
          const positions = (Array.isArray(msg.positions) ? msg.positions : []) as PositionUpdate[];
          // Empty: nothing new to show. A run that ended while we were away is
          // ended by the status that follows, and stays on screen.
          if (positions.length > 0) {
            setEnded(null);
            const pts = positions.map((p) => ({
              timestamp: p.timestamp || '',
              lat: p.lat,
              lon: p.lon,
              height: p.height || 0,
              quality: p.quality || 0,
              ns: p.ns || 0,
              ratio: p.ratio || 0,
              age: p.age || 0,
            }));
            setLastPosition(pts[pts.length - 1]);
            setPositionHistory(pts.slice(-MAX_HISTORY).map((p) => (
              { lat: p.lat, lon: p.lon, height: p.height, quality: p.quality, timestamp: p.timestamp }
            )));
            setTimeSeriesHistory(pts.slice(-MAX_HISTORY).map((p) => (
              { timestamp: p.timestamp, quality: p.quality, ns: p.ns, ratio: p.ratio }
            )));
          }
        } else if (msg.type === 'status') {
          // Lifecycle (button state) is driven ONLY by explicit process signals,
          // never by the per-poll rtkrcv `server_state`. That field reflects the
          // rtkrcv RTK server *thread* state (run/stop) and can read "stop" while
          // our managed process is still alive and streaming — using it here was
          // what flipped the button back to Start the moment solutions appeared.
          if (msg.running === true) {
            // Positive confirmation the managed process is up (e.g. WS reconnect
            // while a run is active). Started from another tab: the last
            // session goes, as on a local Start.
            if (endedRef.current) clearSession();
            setRunStatus('running');
          } else if (msg.running === false) {
            // A genuine exit carries `exited`. Without it this is the status
            // sent on connect, which ends a run we believed was live (it ended
            // while this client was disconnected) and must not disturb a start
            // in flight or a page that was idle.
            if (msg.exited) {
              endSession(typeof msg.exit_code === 'number' ? msg.exit_code : null);
            } else if (!startingRef.current && (runStatusRef.current === 'running' || runStatusRef.current === 'stopping')) {
              endSession(null);
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
          if (Array.isArray(msg.streams)) {
            setInputStreams(msg.streams as InputStreamStatus[]);
            setInputStreamsAt(Date.now());
          }
        } else if (msg.type === 'log') {
          setLogLines(prev => [...prev.slice(-500), msg.message]);
        } else if (msg.type === 'trace_reset') {
          // A run was started (possibly from another tab).
          setTraceFile(null);
          setTraceLines([]);
        } else if (msg.type === 'trace_file') {
          // A new run's trace file: drop the previous run's lines.
          setTraceFile(msg.path as string);
          setTraceLines([]);
        } else if (msg.type === 'trace' && Array.isArray(msg.lines)) {
          setTraceLines(prev => [...prev, ...(msg.lines as string[])].slice(-MAX_TRACE_LINES));
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      // A stale socket (already replaced or torn down) must not touch state.
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (unmountedRef.current) return;
      wsReconnectRef.current = setTimeout(() => {
        wsReconnectRef.current = null;
        connectWs();
      }, 2000);
    };
  }, [clearSession, endSession, setEnded]);

  useEffect(() => {
    unmountedRef.current = false;
    connectWs();
    return () => {
      unmountedRef.current = true;
      if (wsReconnectRef.current) clearTimeout(wsReconnectRef.current);
      wsReconnectRef.current = null;
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [connectWs]);

  const handleStart = async () => {
    startingRef.current = true;
    clearSession();
    setRunStatus('starting');
    setLogLines(prev => [...prev, '[INFO] Starting mrtk run -s ...']);
    setTraceLines([]);
    setTraceFile(null);
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
      }
    } catch (err) {
      setRunStatus('error');
      setLogLines(prev => [...prev, `[ERROR] ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      startingRef.current = false;
    }
  };

  const handleStop = async () => {
    setRunStatus('stopping');
    setLogLines(prev => [...prev, '[INFO] Stopping ...']);
    try {
      await mrtkRunApi.stop();
      endSession(null);
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
        <Card withBorder p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Stack gap={4} style={{ flex: 1, minHeight: 0 }}>
            <Group justify="space-between">
              <Group gap="xs">
                {onToggleConfig && <ConfigCollapseButton onClick={onToggleConfig} />}
                <Title order={6} size="sm">Processing Configuration</Title>
              </Group>
              <Group gap="xs">
                <StatusBadge tone={processTone(runStatus)}>
                  {runStatus === 'exited' ? `exited (code ${ended?.exitCode})` : runStatus}
                </StatusBadge>
                <Tooltip label="Presets">
                  <ActionIcon aria-label="Presets" variant="light" color="gray" size={30} onClick={openPresets}>
                    <IconBookmark size={16} />
                  </ActionIcon>
                </Tooltip>
                {aiConfigured ? (
                  <Tooltip label="Config Assistant">
                    <ActionIcon aria-label="Config Assistant" variant="light" color="gray" size={30} onClick={openAssistant}>
                      <IconSparkles size={16} />
                    </ActionIcon>
                  </Tooltip>
                ) : (
                  <Tooltip label="Configure API key in Tools → AI Settings">
                    <ActionIcon aria-label="Configure API key in Tools → AI Settings" variant="light" color="gray" size={30} onClick={onNavigateToAiSettings}>
                      <IconSparkles size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
                <Tooltip label="Import TOML">
                  <ActionIcon aria-label="Import TOML" variant="light" color="gray" size={30} onClick={() => importFileRef.current?.click()}>
                    <IconUpload size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="TOML Preview">
                  <ActionIcon aria-label="TOML Preview" variant="light" color="gray" size={30} onClick={openToml}>
                    <IconCode size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Download TOML">
                  <ActionIcon aria-label="Download TOML" variant="light" color="gray" size={30} disabled={isRunning} onClick={async () => {
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
                {runStatus !== 'running' && runStatus !== 'stopping' ? (
                  <Button size="xs" miw={PRIMARY_MIN_WIDTH} color="green" leftSection={<IconPlayerPlay size={14} />}
                    onClick={handleStart} loading={runStatus === 'starting'} disabled={streams.input.rover.type === 'off'}>
                    Start
                  </Button>
                ) : (
                  <Button size="xs" miw={PRIMARY_MIN_WIDTH} color="red" leftSection={<IconPlayerStop size={14} />}
                    onClick={handleStop} loading={runStatus === 'stopping'}>
                    Stop
                  </Button>
                )}
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
                      <SectionHeader title="Input Streams" help={<StreamPathHelp />} />
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

                      <SectionHeader
                        title="Output Streams"
                        mt={6}
                        help={<>
                          <StreamPathHelp />
                          {outputLogCount < OUTPUT_LOG_SLOTS.length && (
                          <Tooltip label="Add output stream" openDelay={300}>
                            <ActionIcon aria-label="Add output stream" size="xs" variant="light" onClick={() => setShowOutput2(true)}>
                              <IconPlus size={12} />
                            </ActionIcon>
                          </Tooltip>
                        )}
                        </>}
                      />
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
                            <ActionIcon aria-label="Remove output stream"
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
            <RtMetricsRow lastPosition={lastPosition} satellites={satellites} endedAt={lastPosition ? ended?.at ?? null : null} />

            {/* 3. Tab bar + 4. Chart area */}
            <Tabs value={monitorTab} onChange={setMonitorTab} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <WorkspaceTabBar
                tabs={[
                  { value: 'chart', label: 'Chart' },
                  { value: 'solution', label: 'Solution' },
                  { value: 'console', label: 'Console', alert: unseenErrors },
                  { value: 'trace', label: 'Trace' },
                ]}
                right={monitorTab === 'chart' && (
                <Chip.Group
                  multiple
                  value={chartViews}
                  onChange={(v) => { if (v.length) setChartViews(v); }}
                >
                  <Group gap={6} wrap="nowrap">
                    <Chip value="scatter" size="xs" variant="light">2D</Chip>
                    <Chip value="map" size="xs" variant="light">Map</Chip>
                    <Chip value="skysnr" size="xs" variant="light">Sky / SNR</Chip>
                    <Chip value="series" size="xs" variant="light">Time series</Chip>
                  </Group>
                </Chip.Group>
                )}
              />

              <div ref={panelsRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              <Tabs.Panel value="chart" pt={PANEL_TOP}>
                <div style={{ display: 'flex', gap: 10, height: panelHeight, minHeight: 0, opacity: ended ? ENDED_OPACITY : 1 }}>
                  {chartViews.includes('scatter') && (
                    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                      <PositionScatter fit points={positionHistory} maxPoints={MAX_HISTORY} />
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

              <Tabs.Panel value="solution" pt={PANEL_TOP}>
                <LogView
                  lines={solutionLines}
                  height={panelHeight}
                  active={monitorTab === 'solution'}
                  running={isRunning}
                  emptyText="No solution data yet."
                />
              </Tabs.Panel>

              <Tabs.Panel value="console" pt={PANEL_TOP}>
                <LogView
                  lines={logLines}
                  height={panelHeight}
                  active={monitorTab === 'console'}
                  wrap
                  severity
                  running={isRunning}
                  cap={500}
                />
              </Tabs.Panel>

              <Tabs.Panel value="trace" pt={PANEL_TOP}>
                <LogView
                  lines={traceLines}
                  height={panelHeight}
                  active={monitorTab === 'trace'}
                  wrap
                  wrapToggle
                  note={traceFile && (
                    <Text c="dimmed" truncate="start" title={traceFile} style={{ fontFamily: MONO, fontSize: FONT_SIZE.label }}>
                      {traceFile}
                    </Text>
                  )}
                  actions={traceFile && traceFile.startsWith('/workspace/') && (
                      <Button
                        variant="light"
                        leftSection={<IconDownload size={12} />}
                        size="compact-xs"
                        component="a"
                        href={`/api/files/download?path=${encodeURIComponent(traceFile)}`}
                        download
                        style={{ flexShrink: 0 }}
                      >
                        Download
                      </Button>
                    )}
                  emptyText={
                    traceFile
                      ? 'Waiting for trace output...'
                      : config.output.debugTrace === 'off'
                        ? 'Trace output is disabled. Set Debug Trace level > 0 in the Output section.'
                        : isRunning
                          ? 'Waiting for the trace file...'
                          : 'Trace output will appear here while running.'
                  }
                />
              </Tabs.Panel>
            </div>
            </Tabs>

            {/* 5. Streaming status (Rover · Base · Correction) */}
            <RtInputStatusRow streams={inputStreams} updatedAt={inputStreamsAt} />
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
      'log.stream1': asRawLogFile(streams.log.stream1),
      'log.stream2': asRawLogFile(streams.log.stream2),
      'log.stream3': asRawLogFile(streams.log.stream3),
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
