/**
 * Stream Monitor (#96 P1): connect to a receiver or any GNSS stream through
 * `mrtk relay`, decode it in the backend and show positions and satellites
 * with the Real-Time views (unchanged, fed through utils/streamMonitor.ts).
 *
 * WebSocket per lessons L17: opened on mount and reconnected on drop; the
 * `history` message on connect is authoritative; `exited: true` ends a
 * session for every open page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Grid,
  Group,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useElementSize, useLocalStorage } from '@mantine/hooks';
import { IconPlayerPlay, IconPlayerStop } from '@tabler/icons-react';
import {
  streamMonitorApi,
  type MonitorEpoch,
  type MonitorInputType,
  type MonitorMessage,
  type MonitorSatellites,
  type MonitorState,
  type MonitorStatus,
} from '../api/streamMonitor';
import {
  isRelayStatusLine,
  rtTimestamp,
  splitRelayLog,
  toMetricsPosition,
  toPosEpoch,
  toPositionPoint,
  toSatellite,
  toTimeSeriesPoint,
} from '../utils/streamMonitor';
import { maskLogLine } from '../utils/maskPath';
import { useFollowScroll } from '../hooks/useFollowScroll';
import { MaskedPathInput } from './common/MaskedPathInput';
import { JumpToLatest } from './common/JumpToLatest';
import { StreamPathHelp } from './StreamPathHelp';
import { RtMetricsRow } from './RtMetricsRow';
import { PositionScatter } from './PositionScatter';
import { SkySnrPanel } from './SkySnrPanel';
import { TimeSeriesChart } from './TimeSeriesChart';
import { MapView } from './viewer';

const MONO = "'IBM Plex Mono', monospace";

/** Same cap as the backend history (HISTORY_EPOCHS, 1 Hz → one hour). */
const MAX_EPOCHS = 3600;
/** Time series (Recharts) slows down with many points; RT shows 600. */
const MAX_SERIES = 600;
const MAX_LOG_LINES = 500;
/** Height of the chart / text area. The page has no tall sibling to stretch
 *  against, and the map needs a measured pixel height (lessons L02). */
const CHART_HEIGHT = 460;

const INPUT_TYPES: { value: MonitorInputType; label: string; placeholder: string }[] = [
  { value: 'serial', label: 'Serial', placeholder: 'ttyACM0:115200' },
  { value: 'tcpcli', label: 'TCP Client', placeholder: '192.168.1.100:9001' },
  { value: 'tcpsvr', label: 'TCP Server', placeholder: ':9001' },
  { value: 'ntripcli', label: 'NTRIP Client', placeholder: 'user:pass@caster:2101/MOUNT' },
  { value: 'file', label: 'File', placeholder: '/data/rover.sbf' },
];

const DEFAULT_RAW_LOG = '/workspace/rtlog/monitor_%Y%m%d%h%M.raw';

const STATE_COLOR: Record<MonitorState, string> = {
  idle: 'gray',
  starting: 'yellow',
  running: 'green',
  stopped: 'gray',
  error: 'red',
};

/** Label-left / input-right row (project form convention). */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" align="center" mb={6} wrap="nowrap">
      <Text size="sm" c="dimmed" style={{ width: 130, flexShrink: 0 }}>
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

function Mono({ children, c }: { children: React.ReactNode; c?: string }) {
  return (
    <Text size="sm" c={c} truncate="end" style={{ fontFamily: MONO, fontSize: 12 }}>
      {children}
    </Text>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

/** Keep at most one relay status line (the newest): they arrive every few
 *  seconds and would push everything else out of the buffer. */
function appendLog(prev: string[], line: string): string[] {
  const base = isRelayStatusLine(line) ? prev.filter((l) => !isRelayStatusLine(l)) : prev;
  return [...base.slice(-(MAX_LOG_LINES - 1)), line];
}

export function StreamMonitorPanel() {
  // ── form (persisted; separate keys so an old stored shape cannot break it, L28)
  const [inputType, setInputType] = useLocalStorage<string>({
    key: 'mrtk-stream-monitor-input-type',
    defaultValue: 'tcpcli',
  });
  const [inputPath, setInputPath] = useLocalStorage<string>({
    key: 'mrtk-stream-monitor-input-path',
    defaultValue: '',
  });
  const [saveRaw, setSaveRaw] = useLocalStorage<boolean>({
    key: 'mrtk-stream-monitor-save-raw',
    defaultValue: false,
  });
  const [rawLog, setRawLog] = useLocalStorage<string>({
    key: 'mrtk-stream-monitor-raw-log',
    defaultValue: DEFAULT_RAW_LOG,
  });
  const typeMeta = INPUT_TYPES.find((t) => t.value === inputType) ?? INPUT_TYPES[1];

  // ── session data
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [epochs, setEpochs] = useState<MonitorEpoch[]>([]);
  const [sats, setSats] = useState<MonitorSatellites | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [tab, setTab] = useState<string | null>('chart');
  const [chartViews, setChartViews] = useState<string[]>(['scatter', 'skysnr']);
  const { ref: mapWrapRef, height: mapHeight } = useElementSize();

  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // A start request is in flight: a "not running" status sent before it
  // (e.g. on WS connect) must not flip the page back to idle.
  const startingRef = useRef(false);

  const clearData = useCallback(() => {
    setEpochs([]);
    setSats(null);
  }, []);

  const connectWs = useCallback(() => {
    if (wsRef.current || unmountedRef.current) return;
    const ws = streamMonitorApi.connectWs();
    wsRef.current = ws;

    ws.onmessage = (event) => {
      let msg: MonitorMessage;
      try {
        msg = JSON.parse(event.data) as MonitorMessage;
      } catch {
        return;
      }
      switch (msg.type) {
        case 'history':
          // Authoritative: empty when no session is running.
          setEpochs((msg.epochs ?? []).slice(-MAX_EPOCHS));
          setSats(msg.satellites ?? null);
          setLogLines((msg.logs ?? []).reduce(appendLog, [] as string[]));
          break;
        case 'status':
          if (!msg.running && !msg.exited && startingRef.current) break;
          setStatus(msg);
          if (msg.exited) clearData();
          break;
        case 'epochs':
          setEpochs((prev) => [...prev, ...msg.epochs].slice(-MAX_EPOCHS));
          break;
        case 'satellites':
          setSats({ time: msg.time, time_sys: msg.time_sys, satellites: msg.satellites });
          break;
        case 'log':
          setLogLines((prev) => appendLog(prev, msg.message));
          break;
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
  }, [clearData]);

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

  const running = !!status?.running;
  const busy = running || submitting;

  const handleStart = async () => {
    startingRef.current = true;
    setSubmitting(true);
    setRequestError(null);
    clearData();
    setLogLines([]);
    try {
      const st = await streamMonitorApi.start({
        input: { type: typeMeta.value, path: inputPath.trim() },
        raw_log: saveRaw && rawLog.trim() ? rawLog.trim() : null,
      });
      setStatus(st);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      startingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleStop = async () => {
    setSubmitting(true);
    setRequestError(null);
    try {
      setStatus(await streamMonitorApi.stop());
      clearData();
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ── adapters to the RT components
  const last = epochs.length > 0 ? epochs[epochs.length - 1] : null;
  const metricsPosition = useMemo(() => (last ? toMetricsPosition(last) : null), [last]);
  const points = useMemo(() => epochs.map(toPositionPoint), [epochs]);
  const series = useMemo(() => epochs.slice(-MAX_SERIES).map(toTimeSeriesPoint), [epochs]);
  const mapEpochs = useMemo(() => epochs.map(toPosEpoch), [epochs]);
  const satellites = useMemo(() => (sats ? sats.satellites.map(toSatellite) : []), [sats]);
  const satTime = sats?.time ? `${rtTimestamp(sats.time)} ${sats.time_sys}` : undefined;

  const relayLog = useMemo(() => splitRelayLog(logLines), [logLines]);
  const solutionScroll = useFollowScroll(tab === 'solution', epochs);
  const consoleScroll = useFollowScroll(tab === 'console', relayLog.console);

  const state: MonitorState = submitting && !running ? 'starting' : status?.state ?? 'idle';
  const msgCounts = Object.entries(status?.msg_counts ?? {}).sort((a, b) => b[1] - a[1]);
  // Unknown bytes are normal at the start (the stream is joined mid-frame);
  // bad checksums and decode errors are not.
  const framingIssues = status ? status.bad_frames + status.decode_errors : 0;
  // The relay's status line is only current while it runs.
  const relayStatusLine = running ? relayLog.status : null;

  return (
    <Stack gap="sm">
      <Grid gutter="sm" align="stretch">
        {/* Input */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder p="md" h="100%">
            <Group justify="space-between" mb="xs">
              <Title order={5}>Stream Monitor</Title>
              {!running ? (
                <Button
                  size="xs"
                  color="green"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={handleStart}
                  loading={submitting}
                  disabled={!inputPath.trim()}
                >
                  Start
                </Button>
              ) : (
                <Button
                  size="xs"
                  color="red"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={handleStop}
                  loading={submitting}
                >
                  Stop
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed" mb="sm">
              Decodes NMEA, Septentrio SBF, u-blox UBX and MRTKLIB solution text
              from a receiver or another stream (e.g. <code>mrtk run</code> output) through{' '}
              <code>mrtk relay</code>.
            </Text>
            <Row label="Input type">
              <Select
                size="sm"
                value={typeMeta.value}
                onChange={(v) => v && setInputType(v)}
                data={INPUT_TYPES.map(({ value, label }) => ({ value, label }))}
                allowDeselect={false}
                disabled={busy}
              />
            </Row>
            <Row label="Path">
              <Group gap={6} wrap="nowrap">
                <Box style={{ flex: 1, minWidth: 0 }}>
                  <MaskedPathInput
                    size="sm"
                    value={inputPath}
                    onChange={setInputPath}
                    placeholder={typeMeta.placeholder}
                    disabled={busy}
                    styles={{ input: { fontFamily: MONO } }}
                  />
                </Box>
                <StreamPathHelp />
              </Group>
            </Row>
            <Row label="Save raw stream">
              <Switch
                size="sm"
                checked={saveRaw}
                onChange={(e) => setSaveRaw(e.currentTarget.checked)}
                disabled={busy}
              />
            </Row>
            {saveRaw && (
              <Row label="Raw log file">
                <TextInput
                  size="sm"
                  value={rawLog}
                  onChange={(e) => setRawLog(e.currentTarget.value)}
                  placeholder={DEFAULT_RAW_LOG}
                  disabled={busy}
                  styles={{ input: { fontFamily: MONO } }}
                />
              </Row>
            )}
            {requestError && (
              <Text size="sm" c="red" mt={4}>
                {requestError}
              </Text>
            )}
          </Card>
        </Grid.Col>

        {/* Stream status */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder p="md" h="100%">
            <Title order={5} mb="xs">Stream</Title>
            <Row label="State">
              <Group gap="xs" wrap="nowrap">
                <Badge color={STATE_COLOR[state]} variant="dot" size="sm">
                  {state}
                </Badge>
                {running && status && (
                  // `connected` is the backend's link to the relay, not the
                  // relay's input: judge the input by the bytes arriving.
                  <Text size="xs" c={status.bytes_per_sec > 0 ? 'green' : 'orange'}>
                    {status.bytes_per_sec > 0 ? 'receiving' : status.connected ? 'no data' : 'starting relay'}
                  </Text>
                )}
              </Group>
            </Row>
            {state === 'error' && status?.error_message && (
              <Row label="Error">
                <Text size="sm" c="red">{status.error_message}</Text>
              </Row>
            )}
            <Row label="Input">
              <Mono>{status?.input ? maskLogLine(status.input) : '—'}</Mono>
            </Row>
            {status?.raw_log && (
              <Row label="Raw log">
                <Mono>{status.raw_log}</Mono>
              </Row>
            )}
            <Row label="Data rate">
              <Mono>
                {status && running
                  ? `${formatBytes(status.bytes_per_sec)}/s · ${formatBytes(status.bytes_total)} total`
                  : '—'}
              </Mono>
            </Row>
            <Row label="Position from">
              <Mono>{status?.epoch_source ?? '—'}</Mono>
            </Row>
            <Row label="Satellites from">
              <Mono>{status?.satellite_source ?? '—'}</Mono>
            </Row>
            <Row label="Messages">
              <Mono>
                {msgCounts.length > 0
                  ? msgCounts.map(([k, n]) => `${k} ${n}`).join(' · ')
                  : '—'}
              </Mono>
            </Row>
            <Row label="Undecoded">
              <Mono c={framingIssues > 0 ? 'orange' : undefined}>
                {status
                  ? `${formatBytes(status.unknown_bytes)} unknown · ${status.bad_frames} bad frames · ${status.decode_errors} decode errors`
                  : '—'}
              </Mono>
            </Row>
          </Card>
        </Grid.Col>
      </Grid>

      {/* Workspace */}
      <Card withBorder p="xs">
        <Stack gap={6}>
          <RtMetricsRow
            lastPosition={metricsPosition}
            satellites={satellites}
            timeSystem={last?.time_sys ?? 'GPST'}
          />

          <Tabs value={tab} onChange={setTab}>
            <Group justify="space-between" align="center" gap={0}>
              <Tabs.List>
                <Tabs.Tab value="chart" style={{ fontSize: 11 }}>Chart</Tabs.Tab>
                <Tabs.Tab value="solution" style={{ fontSize: 11 }}>Solution</Tabs.Tab>
                <Tabs.Tab value="console" style={{ fontSize: 11 }}>Console</Tabs.Tab>
              </Tabs.List>
              <Chip.Group multiple value={chartViews} onChange={(v) => { if (v.length) setChartViews(v); }}>
                <Group gap={6} wrap="nowrap" style={{ marginRight: 4 }}>
                  <Chip value="scatter" size="xs" variant="light">2D</Chip>
                  <Chip value="map" size="xs" variant="light">Map</Chip>
                  <Chip value="skysnr" size="xs" variant="light">Sky / SNR</Chip>
                  <Chip value="series" size="xs" variant="light">Time series</Chip>
                </Group>
              </Chip.Group>
            </Group>

            <Tabs.Panel value="chart" pt={6}>
              <div style={{ display: 'flex', gap: 10, height: CHART_HEIGHT, minHeight: 0 }}>
                {chartViews.includes('scatter') && (
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <PositionScatter points={points} maxPoints={MAX_EPOCHS} />
                  </div>
                )}
                {chartViews.includes('map') && (
                  <div ref={mapWrapRef} style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    {mapHeight > 0 && <MapView data={mapEpochs} height={mapHeight} timeSystem={last?.time_sys} />}
                  </div>
                )}
                {chartViews.includes('skysnr') && (
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <SkySnrPanel satellites={satellites} updateTime={satTime} />
                  </div>
                )}
                {chartViews.includes('series') && (
                  <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                    <TimeSeriesChart points={series} maxPoints={MAX_SERIES} />
                  </div>
                )}
              </div>
            </Tabs.Panel>

            <Tabs.Panel value="solution" pt={6}>
              <Box pos="relative">
                <ScrollArea
                  h={CHART_HEIGHT}
                  {...solutionScroll.scrollProps}
                  styles={{ viewport: { backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)', padding: '8px 12px' } }}
                >
                  <Text
                    c={epochs.length > 0 ? 'gray.4' : 'dimmed'}
                    fs={epochs.length > 0 ? undefined : 'italic'}
                    style={{ fontFamily: MONO, whiteSpace: 'pre', fontSize: '11px', lineHeight: 1.5 }}
                  >
                    {solutionScroll.shown.length > 0
                      ? solutionScroll.shown
                          .map((e) =>
                            [
                              `${rtTimestamp(e.time)} ${e.time_sys}`,
                              e.lat.toFixed(8).padStart(13),
                              e.lon.toFixed(8).padStart(14),
                              (e.height != null ? e.height.toFixed(3) : '—').padStart(10),
                              `Q=${e.Q}`,
                              `ns=${e.ns ?? '—'}`,
                            ].join('  '),
                          )
                          .join('\n')
                      : 'No solution data yet.'}
                  </Text>
                </ScrollArea>
                {solutionScroll.held && <JumpToLatest onClick={solutionScroll.resume} />}
              </Box>
            </Tabs.Panel>

            <Tabs.Panel value="console" pt={6}>
              <Box pos="relative">
                <ScrollArea
                  h={CHART_HEIGHT}
                  {...consoleScroll.scrollProps}
                  styles={{ viewport: { backgroundColor: 'var(--mantine-color-dark-8, #1a1b1e)', padding: '8px 12px' } }}
                >
                  {consoleScroll.shown.length > 0 ? (
                    consoleScroll.shown.map((line, i) => (
                      <Text
                        key={i}
                        c="gray.4"
                        style={{ fontFamily: MONO, fontSize: '11px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
                      >
                        {maskLogLine(line)}
                      </Text>
                    ))
                  ) : (
                    <Text c="dimmed" fs="italic" style={{ fontFamily: MONO, fontSize: '11px' }}>
                      No log output yet.
                    </Text>
                  )}
                </ScrollArea>
                {consoleScroll.held && <JumpToLatest onClick={consoleScroll.resume} />}
              </Box>
            </Tabs.Panel>
          </Tabs>

          {/* Latest mrtk relay status line (kept out of the console) */}
          <Text
            c="dimmed"
            truncate="end"
            title={relayStatusLine ? maskLogLine(relayStatusLine) : undefined}
            style={{ fontFamily: MONO, fontSize: '11px', padding: '0 4px', minHeight: 17 }}
          >
            {relayStatusLine ? `relay  ${maskLogLine(relayStatusLine)}` : ''}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
