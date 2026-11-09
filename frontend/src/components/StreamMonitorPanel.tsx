/**
 * Stream Monitor (#96 P1): connect to a receiver or any GNSS stream through
 * `mrtk relay`, decode it in the backend and show positions and satellites
 * with the Real-Time views (unchanged, fed through utils/streamMonitor.ts).
 *
 * WebSocket per lessons L17: opened on mount and reconnected on drop; the
 * `history` message on connect is authoritative; `exited: true` ends a
 * session for every open page.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Code,
  Group,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure, useElementSize, useLocalStorage } from '@mantine/hooks';
import { IconPlayerPlay, IconPlayerStop, IconQuestionMark } from '@tabler/icons-react';
import {
  streamMonitorApi,
  type MonitorEpoch,
  type MonitorInputType,
  type MonitorMessage,
  type MonitorMessageRow,
  type MonitorMessageType,
  type MonitorSatellite,
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
} from '../utils/streamMonitor';
import { mergeMessageRows } from '../utils/streamMessages';
import { maskLogLine } from '../utils/maskPath';
import { decodeClasSource, formatClasSource } from '../utils/clasSource';
import { useFollowScroll } from '../hooks/useFollowScroll';
import { MaskedPathInput } from './common/MaskedPathInput';
import { JumpToLatest } from './common/JumpToLatest';
import { StreamPathHelp } from './StreamPathHelp';
import { RtMetricsRow } from './RtMetricsRow';
import { StreamMonitorStatusRow } from './StreamMonitorStatusRow';
import { ConsoleFrame, ConfigCollapseButton } from './ConsoleFrame';
import { SkySnrPanel } from './SkySnrPanel';
import { StreamMessagePanel } from './StreamMessagePanel';
import { PositionViewer, type ViewMode } from './viewer';

const MONO = "'IBM Plex Mono', monospace";

/** Same cap as the backend history (HISTORY_EPOCHS, 1 Hz → one hour). */
const MAX_EPOCHS = 3600;
const MAX_LOG_LINES = 500;
const NO_SATELLITES: MonitorSatellite[] = [];
/** The workspace fills the window under the header (lessons L02: the config
 *  column has no tall content to stretch against). */
const WORKSPACE_MIN_HEIGHT = 'calc(100vh - 114px)';
/** Smallest chart / text area, enough for a legible Sky / SNR panel. The
 *  viewer takes a pixel height, so the area is measured. */
const MIN_CHART_HEIGHT = 420;
/** Padding above each tab panel. */
const PANEL_TOP = 6;

const INPUT_TYPES: { value: MonitorInputType; label: string; placeholder: string }[] = [
  { value: 'serial', label: 'Serial', placeholder: 'ttyACM0:115200' },
  { value: 'tcpcli', label: 'TCP Client', placeholder: '192.168.1.100:9001' },
  { value: 'tcpsvr', label: 'TCP Server', placeholder: ':9001' },
  { value: 'ntripcli', label: 'NTRIP Client', placeholder: 'user:pass@caster:2101/MOUNT' },
  { value: 'file', label: 'File', placeholder: '/data/rover.sbf' },
];

/** Chart views in display order: the viewer's (2D / ENU / Map) and Sky / SNR. */
const POSITION_VIEWS: ViewMode[] = ['2d', 'enu', 'map'];
const CHART_VIEWS: string[] = [...POSITION_VIEWS, 'skysnr'];
const DEFAULT_VIEWS = ['2d', 'skysnr'];

const DEFAULT_RAW_LOG = '/workspace/rtlog/monitor_%Y%m%d%h%M.raw';

/** File input playback (#161): '0' = the whole file at once, else × real
 *  time paced by the epoch times in the file. */
const FILE_SPEEDS = [
  { value: '0', label: 'All at once' },
  { value: '1', label: 'Real time' },
  { value: '10', label: '10× real time' },
  { value: '60', label: '60× real time' },
];

/** What the Stream Monitor does, behind the ? next to its title. */
function MonitorHelp() {
  const [opened, { toggle, close }] = useDisclosure(false);
  return (
    <Popover opened={opened} onClose={close} position="bottom-start" width={380} shadow="md" withArrow>
      <Popover.Target>
        <ActionIcon size={14} variant="subtle" radius="xl" onClick={toggle} style={{ opacity: 0.5 }}
          aria-label="About the Stream Monitor"
        >
          <IconQuestionMark size={10} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Text size="xs">
          Decodes NMEA, Septentrio SBF, u-blox UBX and MRTKLIB solution text from a
          receiver or another stream (e.g. <Code style={{ fontSize: 10 }}>mrtk run</Code> output)
          through <Code style={{ fontSize: 10 }}>mrtk relay</Code>. A file is read directly, all
          at once or paced by its epoch times.
        </Text>
      </Popover.Dropdown>
    </Popover>
  );
}

const STATE_COLOR: Record<MonitorState, string> = {
  idle: 'gray',
  starting: 'yellow',
  running: 'green',
  stopped: 'gray',
  error: 'red',
};

/** Label-left / input-right row (project form convention). */
function Row({ label, children, minHeight }: {
  label: string;
  children: React.ReactNode;
  /** Form rows whose control is shorter than an input (a switch) take the
   *  input height, so every form row has the same pitch. */
  minHeight?: number;
}) {
  return (
    <Group justify="space-between" align="center" mb={6} wrap="nowrap" style={{ minHeight }}>
      <Text size="xs" c="dimmed" style={{ width: 130, flexShrink: 0, fontSize: 11 }}>
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

/** Keep at most one relay status line (the newest): they arrive every few
 *  seconds and would push everything else out of the buffer. */
function appendLog(prev: string[], line: string): string[] {
  const base = isRelayStatusLine(line) ? prev.filter((l) => !isRelayStatusLine(l)) : prev;
  return [...base.slice(-(MAX_LOG_LINES - 1)), line];
}

export function StreamMonitorPanel({ configOpen = true, onToggleConfig }: {
  configOpen?: boolean;
  onToggleConfig?: () => void;
}) {
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
  const [fileSpeed, setFileSpeed] = useLocalStorage<string>({
    key: 'mrtk-stream-monitor-file-speed',
    defaultValue: '0',
  });
  // Read the GGA station id as the CLAS L6 source (#144). Off by default:
  // only `mrtk run` CLAS output puts the source there; any other receiver
  // puts its base station id, which can look like a valid source.
  const [clasSource, setClasSource] = useLocalStorage<boolean>({
    key: 'mrtk-stream-monitor-clas-source',
    defaultValue: false,
  });
  const typeMeta = INPUT_TYPES.find((t) => t.value === inputType) ?? INPUT_TYPES[1];
  const isFile = typeMeta.value === 'file';

  // ── session data
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [epochs, setEpochs] = useState<MonitorEpoch[]>([]);
  const [sats, setSats] = useState<MonitorSatellites | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  // Message tab (#136): counters of every type, rows of the selected one.
  const [messageTypes, setMessageTypes] = useState<MonitorMessageType[]>([]);
  const [messageNow, setMessageNow] = useState(0);
  const [messageLabel, setMessageLabel] = useState<string | null>(null);
  const [messageRows, setMessageRows] = useState<MonitorMessageRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  // The page's WebSocket is open. While it is not, the last status is stale.
  const [wsOpen, setWsOpen] = useState(false);

  const [tab, setTab] = useState<string | null>('chart');
  const { ref: panelsRef, height: panelsHeight } = useElementSize();
  const chartHeight = Math.max(MIN_CHART_HEIGHT, panelsHeight - PANEL_TOP);
  // Chart views, side by side; kept per browser. A stored value from an
  // older layout (e.g. 'position') is dropped (L28).
  const [storedViews, setChartViews] = useLocalStorage<string[]>({
    key: 'mrtk-stream-monitor-views',
    defaultValue: DEFAULT_VIEWS,
  });
  const chartViews = useMemo(() => {
    const known = (Array.isArray(storedViews) ? storedViews : []).filter((v) => CHART_VIEWS.includes(v));
    return known.length > 0 ? known : DEFAULT_VIEWS;
  }, [storedViews]);
  const positionViews = POSITION_VIEWS.filter((v) => chartViews.includes(v));

  // What the backend streams rows for: only while the tab is open.
  const subscribedLabel = tab === 'message' ? messageLabel : null;
  const subscribedLabelRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    subscribedLabelRef.current = subscribedLabel;
  });

  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  // A start request is in flight: a "not running" status sent before it
  // (e.g. on WS connect) must not flip the page back to idle.
  const startingRef = useRef(false);
  // Counts `exited` statuses. A Start response that arrives after a session
  // ended (relay exit, Stop from another page) is older than that exit and
  // must not bring Running back: no further status would correct it.
  const exitCountRef = useRef(0);
  // `started_at` of the session this page shows. A status with another one
  // means a new session (maybe started from another page): its console and
  // data start empty. `undefined` = take the next status as is (`history`
  // just replaced everything).
  const sessionRef = useRef<string | null | undefined>(undefined);

  const clearData = useCallback(() => {
    setEpochs([]);
    setSats(null);
    setMessageTypes([]);
    setMessageRows([]);
  }, []);

  const connectWs = useCallback(() => {
    if (wsRef.current || unmountedRef.current) return;
    const ws = streamMonitorApi.connectWs();
    wsRef.current = ws;

    ws.onopen = () => {
      if (wsRef.current === ws) setWsOpen(true);
    };

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
          setMessageTypes(msg.messages?.types ?? []);
          setMessageNow(msg.messages?.now ?? 0);
          setLogLines((msg.logs ?? []).reduce(appendLog, [] as string[]));
          sessionRef.current = undefined;
          break;
        case 'status':
          if (!msg.running && !msg.exited && startingRef.current) break;
          if (
            sessionRef.current !== undefined &&
            msg.started_at &&
            msg.started_at !== sessionRef.current
          ) {
            clearData();
            setLogLines([]);
          }
          sessionRef.current = msg.started_at;
          setStatus(msg);
          if (msg.exited) {
            exitCountRef.current += 1;
            clearData();
          }
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
        case 'messages':
          setMessageTypes(msg.types);
          setMessageNow(msg.now);
          break;
        case 'message_rows':
          // Rows of the previous selection may still be on their way.
          if (msg.label === subscribedLabelRef.current) {
            setMessageRows((prev) => mergeMessageRows(prev, msg.rows, msg.reset));
          }
          break;
      }
    };

    ws.onclose = () => {
      // A stale socket (already replaced or torn down) must not touch state.
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (unmountedRef.current) return;
      setWsOpen(false);
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

  // Tell the backend what to send; again after a reconnect, which starts
  // a new client there.
  useEffect(() => {
    const ws = wsRef.current;
    if (!wsOpen || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'select_message', label: subscribedLabel }));
  }, [subscribedLabel, wsOpen]);

  const handleSelectMessage = (label: string) => {
    if (label === messageLabel) return;
    setMessageLabel(label);
    setMessageRows([]);
  };

  const running = !!status?.running;
  const busy = running || submitting;
  // Live figures only while the WebSocket delivers them.
  const live = running && wsOpen;

  const handleStart = async () => {
    startingRef.current = true;
    setSubmitting(true);
    setRequestError(null);
    clearData();
    setLogLines([]);
    const exitsBefore = exitCountRef.current;
    try {
      const st = await streamMonitorApi.start({
        input: { type: typeMeta.value, path: inputPath.trim() },
        raw_log: !isFile && saveRaw && rawLog.trim() ? rawLog.trim() : null,
        file_speed: isFile && Number(fileSpeed) > 0 ? Number(fileSpeed) : null,
      });
      // A session that ended meanwhile keeps its exit status. If the exit
      // was another session's, the next status tick (1 s) shows this one.
      if (exitCountRef.current === exitsBefore) setStatus(st);
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
  const posEpochs = useMemo(() => epochs.map(toPosEpoch), [epochs]);
  const lastL6 = live && clasSource ? decodeClasSource(last?.refid) : null;
  // Without a decoded source, a non-zero station id is still shown as is.
  const lastStationId = live && !lastL6 && last?.refid ? String(last.refid).padStart(4, '0') : null;
  const satellites = sats?.satellites ?? NO_SATELLITES;
  const satTime = sats?.time ? `${rtTimestamp(sats.time)} ${sats.time_sys}` : undefined;

  const relayLog = useMemo(() => splitRelayLog(logLines), [logLines]);
  const solutionScroll = useFollowScroll(tab === 'solution', epochs);
  const consoleScroll = useFollowScroll(tab === 'console', relayLog.console);

  const state: MonitorState = submitting && !running ? 'starting' : status?.state ?? 'idle';
  // The relay's status line is only current while it runs.
  const relayStatusLine = live ? relayLog.status : null;

  return (
    <ConsoleFrame
      configOpen={configOpen}
      onToggleConfig={onToggleConfig ?? (() => {})}
      config={
        <Card withBorder p="xs" h="100%">
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              {onToggleConfig && <ConfigCollapseButton onClick={onToggleConfig} />}
              <Title order={6} size="xs">Stream Monitor</Title>
              <MonitorHelp />
            </Group>
            <Group gap="xs" wrap="nowrap">
              {state !== 'idle' && (
                <Badge color={STATE_COLOR[state]} variant="dot" size="sm">
                  {state}
                </Badge>
              )}
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
          </Group>
          <Row label="Input type">
            <Select
              size="xs"
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
                  size="xs"
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
          {isFile && (
            <Row label="Playback">
              <Select
                size="xs"
                value={fileSpeed}
                onChange={(v) => v && setFileSpeed(v)}
                data={FILE_SPEEDS}
                allowDeselect={false}
                disabled={busy}
              />
            </Row>
          )}
          {!isFile && (
            <Row label="Save raw stream" minHeight={30}>
              <Switch
                size="xs"
                checked={saveRaw}
                onChange={(e) => setSaveRaw(e.currentTarget.checked)}
                disabled={busy}
              />
            </Row>
          )}
          {!isFile && saveRaw && (
            <Row label="Raw log file">
              <TextInput
                size="xs"
                value={rawLog}
                onChange={(e) => setRawLog(e.currentTarget.value)}
                placeholder={DEFAULT_RAW_LOG}
                disabled={busy}
                styles={{ input: { fontFamily: MONO } }}
              />
            </Row>
          )}
          <Row label="CLAS L6 source" minHeight={30}>
            <Switch
              size="xs"
              checked={clasSource}
              onChange={(e) => setClasSource(e.currentTarget.checked)}
              title="Read the NMEA GGA station id as the CLAS L6 source (PRN / facility). Only for the NMEA output of a CLAS mrtk run: other receivers put their base station id there."
            />
          </Row>
          {requestError && (
            <Text size="sm" c="red" mt={4}>
              {requestError}
            </Text>
          )}
        </Card>
      }
      workspace={
        <Card withBorder p="xs" style={{ display: 'flex', flexDirection: 'column', minHeight: WORKSPACE_MIN_HEIGHT }}>
          <Stack gap={6} style={{ flex: '1 1 auto', minHeight: 0 }}>
            <RtMetricsRow
              lastPosition={metricsPosition}
              satellites={satellites}
              timeSystem={last?.time_sys ?? 'GPST'}
            />

            <Tabs value={tab} onChange={setTab} style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <Group justify="space-between" align="center" gap={0}>
                <Tabs.List>
                  <Tabs.Tab value="chart" style={{ fontSize: 11 }}>Chart</Tabs.Tab>
                  <Tabs.Tab value="solution" style={{ fontSize: 11 }}>Solution</Tabs.Tab>
                  <Tabs.Tab value="console" style={{ fontSize: 11 }}>Console</Tabs.Tab>
                  <Tabs.Tab value="message" style={{ fontSize: 11 }}>Message</Tabs.Tab>
                </Tabs.List>
                <Chip.Group multiple value={chartViews} onChange={(v) => { if (v.length) setChartViews(v); }}>
                  <Group gap={6} wrap="nowrap" style={{ marginRight: 4 }}>
                    <Chip value="2d" size="xs" variant="light">2D</Chip>
                    <Chip value="enu" size="xs" variant="light">ENU</Chip>
                    <Chip value="map" size="xs" variant="light">Map</Chip>
                    <Chip value="skysnr" size="xs" variant="light">Sky / SNR</Chip>
                  </Group>
                </Chip.Group>
              </Group>

              {/* A fixed basis, not its content: the measured height must not feed back. */}
              <div ref={panelsRef} style={{ flex: `1 1 ${MIN_CHART_HEIGHT + PANEL_TOP}px`, minHeight: 0, overflow: 'hidden' }}>
                <Tabs.Panel value="chart" pt={PANEL_TOP}>
                  <div style={{ display: 'flex', gap: 10, height: chartHeight, minHeight: 0 }}>
                    {positionViews.length > 0 && (
                      // One share of the width per view
                      <div style={{ flex: positionViews.length, minWidth: 0, minHeight: 0 }}>
                        {/* The PP Result Viewer's views over the live epochs,
                            sharing reference and legend; a new session
                            (started_at) resets zoom and map. */}
                        <PositionViewer
                          epochs={posEpochs}
                          dataKey={status?.started_at ?? ''}
                          maxHeight={chartHeight}
                          timeSystem={last?.time_sys ?? 'GPST'}
                          emptyText={live ? 'Waiting for positions…' : 'No position data'}
                          views={positionViews}
                          clasSource={clasSource}
                        />
                      </div>
                    )}
                    {chartViews.includes('skysnr') && (
                      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
                        <SkySnrPanel satellites={satellites} updateTime={satTime} />
                      </div>
                    )}
                  </div>
                </Tabs.Panel>

                <Tabs.Panel value="solution" pt={PANEL_TOP}>
                  <Box pos="relative">
                    <ScrollArea
                      h={chartHeight}
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

                <Tabs.Panel value="console" pt={PANEL_TOP}>
                  <Box pos="relative">
                    <ScrollArea
                      h={chartHeight}
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

                <Tabs.Panel value="message" pt={PANEL_TOP}>
                  {tab === 'message' && (
                    <StreamMessagePanel
                      types={messageTypes}
                      rows={messageRows}
                      selected={messageLabel}
                      onSelect={handleSelectMessage}
                      now={messageNow}
                      showAge={!status?.file}
                      height={chartHeight}
                    />
                  )}
                </Tabs.Panel>
              </div>
            </Tabs>

            {/* Streaming status (same footer as Real-Time) */}
            <StreamMonitorStatusRow
              status={status}
              state={state}
              live={live}
              wsOpen={wsOpen}
              l6Source={lastL6 ? `${formatClasSource(lastL6)} (${String(last?.refid).padStart(4, '0')})` : null}
              stationId={lastStationId}
              relayLine={relayStatusLine}
            />
          </Stack>
        </Card>
      }
    />
  );
}
