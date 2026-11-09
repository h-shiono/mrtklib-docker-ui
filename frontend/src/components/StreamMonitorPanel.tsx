/**
 * Stream Monitor (#96 P1): connect to a receiver or any GNSS stream through
 * `mrtk relay`, decode it in the backend and show positions and satellites
 * with the Real-Time views (unchanged, fed through utils/streamMonitor.ts).
 *
 * WebSocket per lessons L17: opened on mount and reconnected on drop; each
 * of the (up to two, #171) streams gets its own messages.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Card,
  Chip,
  Code,
  Group,
  Popover,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure, useElementSize, useLocalStorage } from '@mantine/hooks';
import { IconPlayerPlay, IconPlayerStop, IconPlus, IconQuestionMark, IconTrash } from '@tabler/icons-react';
import {
  streamMonitorApi,
  type MonitorMessage,
  type MonitorSatellite,
  type MonitorStreamId,
} from '../api/streamMonitor';
import {
  STREAM_COLOR,
  alignEpochs,
  commonTimeSystem,
  inputLight,
  rtTimestamp,
  splitRelayLog,
  toMetricsPosition,
  toPosEpoch,
} from '../utils/streamMonitor';
import { DEFAULT_RAW_LOG, INPUT_TYPES, useMonitorStream, type MonitorStream } from '../hooks/useMonitorStream';
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
import { StatusBadge } from './common/StatusBadge';
import { processTone, STATUS_COLOR } from '../utils/status';
import { PositionViewer, type PositionOverlay, type ViewMode } from './viewer';

const MONO = "'IBM Plex Mono', monospace";

const NO_SATELLITES: MonitorSatellite[] = [];
/** The workspace fills the window under the header (lessons L02: the config
 *  column has no tall content to stretch against). */
const WORKSPACE_MIN_HEIGHT = 'calc(100vh - 114px)';
/** Smallest chart / text area, enough for a legible Sky / SNR panel. The
 *  viewer takes a pixel height, so the area is measured. */
const MIN_CHART_HEIGHT = 420;
/** Padding above each tab panel. */
const PANEL_TOP = 6;

/** Chart views in display order: the viewer's (2D / ENU / Map) and Sky / SNR. */
const POSITION_VIEWS: ViewMode[] = ['2d', 'enu', 'map'];
const CHART_VIEWS: string[] = [...POSITION_VIEWS, 'skysnr'];
const DEFAULT_VIEWS = ['2d', 'skysnr'];

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
        <ActionIcon size={14} variant="subtle" color="gray" radius="xl" onClick={toggle}
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

/** The settings of one stream. `pacing`: a file may be replayed paced (one
 *  stream only: files with different start times cannot be aligned, #171). */
function StreamForm({ s, pacing }: { s: MonitorStream; pacing: boolean }) {
  return (
    <>
      <Row label="Input type">
        <Select
          size="xs"
          value={s.typeMeta.value}
          onChange={(v) => v && s.setInputType(v)}
          data={INPUT_TYPES.map(({ value, label }) => ({ value, label }))}
          allowDeselect={false}
          disabled={s.busy}
        />
      </Row>
      <Row label="Path">
        <Group gap={6} wrap="nowrap">
          <Box style={{ flex: 1, minWidth: 0 }}>
            <MaskedPathInput
              size="xs"
              value={s.inputPath}
              onChange={s.setInputPath}
              placeholder={s.typeMeta.placeholder}
              disabled={s.busy}
              styles={{ input: { fontFamily: MONO } }}
            />
          </Box>
          <StreamPathHelp />
        </Group>
      </Row>
      {s.isFile && (
        <Row label="Playback">
          <Select
            size="xs"
            value={pacing ? s.fileSpeed : '0'}
            onChange={(v) => v && s.setFileSpeed(v)}
            data={FILE_SPEEDS}
            allowDeselect={false}
            disabled={s.busy || !pacing}
            title={pacing ? undefined : 'With two streams, files are read all at once'}
          />
        </Row>
      )}
      {!s.isFile && (
        <Row label="Save raw stream" minHeight={30}>
          <Switch
            size="xs"
            checked={s.saveRaw}
            onChange={(e) => s.setSaveRaw(e.currentTarget.checked)}
            disabled={s.busy}
          />
        </Row>
      )}
      {!s.isFile && s.saveRaw && (
        <Row label="Raw log file">
          <TextInput
            size="xs"
            value={s.rawLog}
            onChange={(e) => s.setRawLog(e.currentTarget.value)}
            placeholder={DEFAULT_RAW_LOG}
            disabled={s.busy}
            styles={{ input: { fontFamily: MONO } }}
          />
        </Row>
      )}
      <Row label="CLAS L6 source" minHeight={30}>
        <Switch
          size="xs"
          checked={s.clasSource}
          onChange={(e) => s.setClasSource(e.currentTarget.checked)}
          title="Read the NMEA GGA station id as the CLAS L6 source (PRN / facility). Only for the NMEA output of a CLAS mrtk run: other receivers put their base station id there."
        />
      </Row>
      {s.requestError && (
        <Text size="sm" c={STATUS_COLOR.error} mt={4}>
          {s.requestError}
        </Text>
      )}
    </>
  );
}

/** Dot, name and state of a stream, for its card and the selector. */
function StreamName({ s }: { s: MonitorStream }) {
  const light = inputLight(s.status, s.state, s.live);
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <Box style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: light.color }} />
      <Text size="xs" fw={600} style={{ whiteSpace: 'nowrap' }}>Stream {s.id.toUpperCase()}</Text>
      <Text c="dimmed" style={{ fontFamily: MONO, fontSize: 10, whiteSpace: 'nowrap' }}>{light.label}</Text>
    </Group>
  );
}

export function StreamMonitorPanel({ configOpen = true, onToggleConfig }: {
  configOpen?: boolean;
  onToggleConfig?: () => void;
}) {
  // The page's WebSocket is open. While it is not, the last status is stale.
  const [wsOpen, setWsOpen] = useState(false);
  const streamA = useMonitorStream('a', wsOpen);
  const streamB = useMonitorStream('b', wsOpen);
  const onMessageA = streamA.handleMessage;
  const onMessageB = streamB.handleMessage;

  // The second stream is shown once added, and whenever it runs: it may
  // have been started from another browser (L16).
  const [secondAdded, setSecondAdded] = useLocalStorage<boolean>({
    key: 'mrtk-stream-monitor-second',
    defaultValue: false,
  });
  const twoStreams = secondAdded || streamB.busy;
  const streams = twoStreams ? [streamA, streamB] : [streamA];
  const [selectedId, setSelectedId] = useState<MonitorStreamId>('a');
  const [overlayOn, setOverlayOn] = useLocalStorage<boolean>({
    key: 'mrtk-stream-monitor-overlay',
    defaultValue: true,
  });
  const selected = twoStreams && selectedId === 'b' ? streamB : streamA;
  const {
    status, epochs, sats, logLines, messageTypes, messageNow, messageLabel, messageRows,
    live, state, submitting, clasSource,
  } = selected;

  const anyRunning = streams.some((s) => s.running);
  const startable = streams.filter((s) => !s.busy && s.inputPath.trim());
  const handleStartAll = () => startable.forEach((s) => void s.start(!twoStreams));
  const handleStopAll = () => streams.filter((s) => s.running).forEach((s) => void s.stop());

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
  const subscribedStream = selected.id;
  const subscribedRef = useRef<{ stream: MonitorStreamId; label: string | null }>({ stream: 'a', label: null });
  useLayoutEffect(() => {
    subscribedRef.current = { stream: subscribedStream, label: subscribedLabel };
  });

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (wsRef.current || closed) return;
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
        const stream = msg.stream ?? 'a';
        if (msg.type === 'message_rows') {
          // Rows of the previous selection may still be on their way.
          const sub = subscribedRef.current;
          if (stream !== sub.stream || msg.label !== sub.label) return;
        }
        (stream === 'b' ? onMessageB : onMessageA)(msg);
      };

      ws.onclose = () => {
        // A stale socket (already replaced or torn down) must not touch state.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        if (closed) return;
        setWsOpen(false);
        reconnect = setTimeout(() => {
          reconnect = null;
          connect();
        }, 2000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      const ws = wsRef.current;
      wsRef.current = null;
      ws?.close();
    };
  }, [onMessageA, onMessageB]);

  // Tell the backend what to send; again after a reconnect, which starts
  // a new client there.
  useEffect(() => {
    const ws = wsRef.current;
    if (!wsOpen || ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'select_message', stream: subscribedStream, label: subscribedLabel }));
  }, [subscribedStream, subscribedLabel, wsOpen]);

  // ── adapters to the RT components
  const last = epochs.length > 0 ? epochs[epochs.length - 1] : null;
  const metricsPosition = useMemo(() => (last ? toMetricsPosition(last) : null), [last]);
  const posA = useMemo(() => streamA.epochs.map(toPosEpoch), [streamA.epochs]);
  const posB = useMemo(() => streamB.epochs.map(toPosEpoch), [streamB.epochs]);
  const posOf = (s: MonitorStream) => (s.id === 'a' ? posA : posB);

  // Overlay: the selected stream on top of the other; while it has no epochs
  // the other is shown alone, so there is nothing to compare yet.
  const other = selected.id === 'a' ? streamB : streamA;
  const overlaying = twoStreams && overlayOn;
  const primary = overlaying && posOf(selected).length === 0 && posOf(other).length > 0 ? other : selected;
  const secondary = primary.id === 'a' ? streamB : streamA;
  const primaryPos = posOf(primary);
  const secondaryPos = posOf(secondary);
  const showOverlay = overlaying && primaryPos.length > 0 && secondaryPos.length > 0;
  // One time system while overlaid, or the ENU charts would be seconds apart.
  const overlayTimeSystem = useMemo(
    () => (showOverlay ? commonTimeSystem([...primary.epochs, ...secondary.epochs]) : 'GPST'),
    [showOverlay, primary.epochs, secondary.epochs],
  );
  const primaryEpochs = useMemo(
    () => (showOverlay ? alignEpochs(primary.epochs, primaryPos, overlayTimeSystem) : primaryPos),
    [showOverlay, primary.epochs, primaryPos, overlayTimeSystem],
  );
  const secondaryEpochs = useMemo(
    () => (showOverlay ? alignEpochs(secondary.epochs, secondaryPos, overlayTimeSystem) : secondaryPos),
    [showOverlay, secondary.epochs, secondaryPos, overlayTimeSystem],
  );
  const positionOverlay = useMemo((): PositionOverlay | undefined => {
    if (!showOverlay) return undefined;
    return {
      label: `Stream ${primary.id.toUpperCase()}`,
      color: STREAM_COLOR[primary.id],
      other: {
        label: `Stream ${secondary.id.toUpperCase()}`,
        color: STREAM_COLOR[secondary.id],
        epochs: secondaryEpochs,
        timeSystem: overlayTimeSystem,
      },
    };
  }, [showOverlay, primary.id, secondary.id, secondaryEpochs, overlayTimeSystem]);
  // Another source, reference or overlay refits the views; epochs do not.
  const positionKey = [
    `${primary.id}:${primary.status?.started_at ?? ''}`,
    showOverlay ? `${secondary.id}:${secondary.status?.started_at ?? ''}` : '',
  ].join('|');
  const lastL6 = live && clasSource ? decodeClasSource(last?.refid) : null;
  // Without a decoded source, a non-zero station id is still shown as is.
  const lastStationId = live && !lastL6 && last?.refid ? String(last.refid).padStart(4, '0') : null;
  const satellites = sats?.satellites ?? NO_SATELLITES;
  const satTime = sats?.time ? `${rtTimestamp(sats.time)} ${sats.time_sys}` : undefined;

  const relayLog = useMemo(() => splitRelayLog(logLines), [logLines]);
  const solutionScroll = useFollowScroll(tab === 'solution', epochs);
  const consoleScroll = useFollowScroll(tab === 'console', relayLog.console);

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
              <Button
                variant="light"
                size="compact-xs"
                leftSection={<IconPlus size={12} />}
                onClick={() => setSecondAdded(true)}
                disabled={twoStreams}
              >
                Add Stream
              </Button>
              {!twoStreams && state !== 'idle' && (
                <StatusBadge tone={processTone(state)}>{state}</StatusBadge>
              )}
              {anyRunning ? (
                <Button
                  size="xs"
                  color="red"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={handleStopAll}
                  loading={!twoStreams && submitting}
                >
                  {twoStreams ? 'Stop All' : 'Stop'}
                </Button>
              ) : (
                <Button
                  size="xs"
                  color="green"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={handleStartAll}
                  loading={!twoStreams && submitting}
                  disabled={startable.length === 0}
                >
                  {twoStreams ? 'Start All' : 'Start'}
                </Button>
              )}
            </Group>
          </Group>
          {twoStreams ? (
            <Stack gap="xs">
              {streams.map((s) => (
                <Card
                  key={s.id}
                  withBorder
                  p="xs"
                  onClick={() => setSelectedId(s.id)}
                  style={{ borderColor: selected.id === s.id ? 'var(--mantine-color-blue-5)' : undefined }}
                >
                  <Group justify="space-between" wrap="nowrap" mb={6}>
                    <StreamName s={s} />
                    <Group gap={4} wrap="nowrap">
                      {s.state !== 'idle' && (
                        <StatusBadge tone={processTone(s.state)} size="xs">{s.state}</StatusBadge>
                      )}
                      {s.running ? (
                        <ActionIcon
                          variant="light"
                          color="red"
                          size="xs"
                          onClick={() => void s.stop()}
                          loading={s.submitting}
                          title={`Stop stream ${s.id.toUpperCase()}`}
                          aria-label={`Stop stream ${s.id.toUpperCase()}`}
                        >
                          <IconPlayerStop size={12} />
                        </ActionIcon>
                      ) : (
                        <ActionIcon
                          variant="light"
                          color="green"
                          size="xs"
                          onClick={() => void s.start(false)}
                          loading={s.submitting}
                          disabled={!s.inputPath.trim()}
                          title={`Start stream ${s.id.toUpperCase()}`}
                          aria-label={`Start stream ${s.id.toUpperCase()}`}
                        >
                          <IconPlayerPlay size={12} />
                        </ActionIcon>
                      )}
                      {s.id === 'b' && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          size="xs"
                          onClick={(e) => {
                            e.stopPropagation(); // the card would select this stream again
                            setSecondAdded(false);
                            setSelectedId('a');
                          }}
                          disabled={s.busy}
                          title="Remove stream"
                          aria-label="Remove stream"
                        >
                          <IconTrash size={12} />
                        </ActionIcon>
                      )}
                    </Group>
                  </Group>
                  <StreamForm s={s} pacing={false} />
                </Card>
              ))}
            </Stack>
          ) : (
            <StreamForm s={streamA} pacing />
          )}
        </Card>
      }
      workspace={
        <Card withBorder p="xs" style={{ display: 'flex', flexDirection: 'column', minHeight: WORKSPACE_MIN_HEIGHT }}>
          <Stack gap={6} style={{ flex: '1 1 auto', minHeight: 0 }}>
            {/* One selector for every per-stream view (#171) */}
            {twoStreams && (
              <SegmentedControl
                size="xs"
                value={selected.id}
                onChange={(v) => setSelectedId(v as MonitorStreamId)}
                data={streams.map((s) => ({ value: s.id, label: <StreamName s={s} /> }))}
              />
            )}
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
                <Group gap={6} wrap="nowrap">
                  {twoStreams && (
                    <Chip
                      size="xs"
                      variant="light"
                      checked={overlayOn}
                      onChange={setOverlayOn}
                      title="Draw both streams on the 2D, ENU and Map views"
                    >
                      Overlay
                    </Chip>
                  )}
                  <Chip.Group multiple value={chartViews} onChange={(v) => { if (v.length) setChartViews(v); }}>
                    <Group gap={6} wrap="nowrap" style={{ marginRight: 4 }}>
                      <Chip value="2d" size="xs" variant="light">2D</Chip>
                      <Chip value="enu" size="xs" variant="light">ENU</Chip>
                      <Chip value="map" size="xs" variant="light">Map</Chip>
                      <Chip value="skysnr" size="xs" variant="light">Sky / SNR</Chip>
                    </Group>
                  </Chip.Group>
                </Group>
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
                          epochs={primaryEpochs}
                          dataKey={positionKey}
                          maxHeight={chartHeight}
                          timeSystem={showOverlay ? overlayTimeSystem : primary.epochs[primary.epochs.length - 1]?.time_sys ?? 'GPST'}
                          emptyText={live ? 'Waiting for positions…' : 'No position data'}
                          views={positionViews}
                          clasSource={primary.clasSource}
                          overlay={positionOverlay}
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
                      styles={{ viewport: { backgroundColor: 'var(--app-console-bg)', padding: '8px 12px' } }}
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
                      styles={{ viewport: { backgroundColor: 'var(--app-console-bg)', padding: '8px 12px' } }}
                    >
                      {consoleScroll.shown.length > 0 ? (
                        consoleScroll.shown.map((line, i) => (
                          <Text
                            key={i}
                            c="var(--app-console-fg)"
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
                      onSelect={selected.selectMessage}
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
