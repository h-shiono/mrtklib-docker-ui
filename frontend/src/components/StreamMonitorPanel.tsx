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
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure, useElementSize, useLocalStorage } from '@mantine/hooks';
import { IconPlayerPlay, IconPlayerStop, IconPlus, IconQuestionMark } from '@tabler/icons-react';
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
  streamLabel,
  toMetricsPosition,
  toPosEpoch,
} from '../utils/streamMonitor';
import { INPUT_TYPES, useMonitorStream, type MonitorStream } from '../hooks/useMonitorStream';
import { decodeClasSource, formatClasSource } from '../utils/clasSource';
import { MaskedPathInput } from './common/MaskedPathInput';
import { StreamPathHelp } from './StreamPathHelp';
import { RtMetricsRow } from './RtMetricsRow';
import { StreamMonitorStatusRow } from './StreamMonitorStatusRow';
import { ConsoleFrame, ConfigCollapseButton } from './ConsoleFrame';
import { SkySnrPanel } from './SkySnrPanel';
import { StreamMessagePanel } from './StreamMessagePanel';
import { StreamCardHeader } from './common/StreamCardHeader';
import { processTone, STATUS_COLOR } from '../utils/status';
import { PositionViewer, type PositionOverlay, type ViewMode } from './viewer';
import { FONT_SIZE, MONO } from '../utils/typography';
import { FormRow } from './common/FormRow';
import { MIN_PANEL_HEIGHT, PRIMARY_MIN_WIDTH } from '../utils/formLayout';
import { WorkspaceTabBar } from './common/WorkspaceTabBar';
import { LogView } from './common/LogView';
import { useUnseenErrors } from '../hooks/useUnseenErrors';


const NO_SATELLITES: MonitorSatellite[] = [];
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
          receiver or another stream (e.g. <Code style={{ fontSize: FONT_SIZE.label }}>mrtk run</Code> output)
          through <Code style={{ fontSize: FONT_SIZE.label }}>mrtk relay</Code>. A file is read directly, all
          at once or paced by its epoch times.
        </Text>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Label-left / input-right row (project form convention). */
/** The settings of one stream. `pacing`: a file may be replayed paced (one
 *  stream only: files with different start times cannot be aligned, #171). */
function StreamForm({ s, pacing }: { s: MonitorStream; pacing: boolean }) {
  return (
    <Stack gap={6}>
      <FormRow label="Input type">
        <Select
          size="xs"
          value={s.typeMeta.value}
          onChange={(v) => v && s.setInputType(v)}
          data={INPUT_TYPES.map(({ value, label }) => ({ value, label }))}
          allowDeselect={false}
          disabled={s.busy}
        />
      </FormRow>
      <FormRow label="Path">
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
      </FormRow>
      {s.isFile && (
        <FormRow label="Playback">
          <Select
            size="xs"
            value={pacing ? s.fileSpeed : '0'}
            onChange={(v) => v && s.setFileSpeed(v)}
            data={FILE_SPEEDS}
            allowDeselect={false}
            disabled={s.busy || !pacing}
            title={pacing ? undefined : 'With two streams, files are read all at once'}
          />
        </FormRow>
      )}
      {s.requestError && (
        <Text size="sm" c={STATUS_COLOR.error} mt={4}>
          {s.requestError}
        </Text>
      )}
    </Stack>
  );
}

/** Dot, name and state of a stream, for its card and the selector. */
function StreamName({ s }: { s: MonitorStream }) {
  const light = inputLight(s.status, s.state, s.live);
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <Box style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: light.color }} />
      <Text size="xs" fw={600} style={{ whiteSpace: 'nowrap' }}>{streamLabel(s.id)}</Text>
      <Text c="dimmed" style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, whiteSpace: 'nowrap' }}>{light.label}</Text>
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
  const chartHeight = Math.max(MIN_PANEL_HEIGHT, panelsHeight - PANEL_TOP);
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
      label: streamLabel(primary.id),
      color: STREAM_COLOR[primary.id],
      other: {
        label: streamLabel(secondary.id),
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
  // The footer's station id cell, read as the CLAS L6 source when its toggle
  // is on. Shown while live, for a non-zero id or while decoding is on.
  const lastL6 = clasSource ? decodeClasSource(last?.refid) : null;
  const station = live && (clasSource || last?.refid)
    ? { id: last?.refid ? String(last.refid).padStart(4, '0') : null, l6: lastL6 ? formatClasSource(lastL6) : null }
    : null;
  const satellites = sats?.satellites ?? NO_SATELLITES;
  const satTime = sats?.time ? `${rtTimestamp(sats.time)} ${sats.time_sys}` : undefined;

  const relayLog = useMemo(() => splitRelayLog(logLines), [logLines]);
  const solutionLines = useMemo(
    () => epochs.map((e) => [
                                  `${rtTimestamp(e.time)} ${e.time_sys}`,
                                  e.lat.toFixed(8).padStart(13),
                                  e.lon.toFixed(8).padStart(14),
                                  (e.height != null ? e.height.toFixed(3) : '—').padStart(10),
                                  `Q=${e.Q}`,
                                  `ns=${e.ns ?? '—'}`,
                                ].join('  ')),
    [epochs],
  );
  const unseenErrors = useUnseenErrors(relayLog.console, tab === 'console');

  // The relay's status line is only current while it runs.
  const relayStatusLine = live ? relayLog.status : null;

  return (
    <ConsoleFrame
      configOpen={configOpen}
      onToggleConfig={onToggleConfig ?? (() => {})}
      config={
        <Card withBorder p="xs" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Group justify="space-between" mb="xs" wrap="nowrap">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              {onToggleConfig && <ConfigCollapseButton onClick={onToggleConfig} />}
              <Title order={6} size="sm">Stream Monitor</Title>
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
              {anyRunning ? (
                <Button
                  size="xs"
                  miw={PRIMARY_MIN_WIDTH}
                  color="red"
                  leftSection={<IconPlayerStop size={14} />}
                  onClick={handleStopAll}
                  loading={!twoStreams && submitting}
                >
                  Stop All
                </Button>
              ) : (
                <Button
                  size="xs"
                  miw={PRIMARY_MIN_WIDTH}
                  color="green"
                  leftSection={<IconPlayerPlay size={14} />}
                  onClick={handleStartAll}
                  loading={!twoStreams && submitting}
                  disabled={startable.length === 0}
                >
                  Start All
                </Button>
              )}
            </Group>
          </Group>
          <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
          <Stack gap="xs">
            {streams.map((s) => (
              <Card
                key={s.id}
                withBorder
                p="xs"
                onClick={() => setSelectedId(s.id)}
                style={{ borderColor: selected.id === s.id ? 'var(--mantine-color-blue-5)' : undefined }}
              >
                <Stack gap="xs">
                  <StreamCardHeader
                    name={streamLabel(s.id)}
                    dotColor={inputLight(s.status, s.state, s.live).color}
                    tone={processTone(s.state)}
                    status={s.state}
                    running={s.running}
                    loading={s.submitting}
                    startDisabled={!s.inputPath.trim()}
                    removeDisabled={s.id === 'a' || s.busy}
                    onStart={() => void s.start(!twoStreams)}
                    onStop={() => void s.stop()}
                    onRemove={(e) => {
                      e.stopPropagation(); // the card would select this stream again
                      setSecondAdded(false);
                      setSelectedId('a');
                    }}
                  />
                  <StreamForm s={s} pacing={!twoStreams} />
                </Stack>
              </Card>
            ))}
          </Stack>
          </ScrollArea>
        </Card>
      }
      workspace={
        <Card withBorder p="xs" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              <WorkspaceTabBar
                tabs={[
                  { value: 'chart', label: 'Chart' },
                  { value: 'solution', label: 'Solution' },
                  { value: 'console', label: 'Console', alert: unseenErrors },
                  { value: 'message', label: 'Message' },
                ]}
                right={tab === 'chart' && (
                  <>
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
                    <Group gap={6} wrap="nowrap">
                      <Chip value="2d" size="xs" variant="light">2D</Chip>
                      <Chip value="enu" size="xs" variant="light">ENU</Chip>
                      <Chip value="map" size="xs" variant="light">Map</Chip>
                      <Chip value="skysnr" size="xs" variant="light">Sky / SNR</Chip>
                    </Group>
                  </Chip.Group>
                  </>
                )}
              />

              {/* A fixed basis, not its content: the measured height must not feed back. */}
              <div ref={panelsRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                  <LogView
                    lines={solutionLines}
                    height={chartHeight}
                    active={tab === 'solution'}
                    running={live}
                    emptyText="No solution data yet."
                  />
                </Tabs.Panel>

                <Tabs.Panel value="console" pt={PANEL_TOP}>
                  <LogView
                    lines={relayLog.console}
                    height={chartHeight}
                    active={tab === 'console'}
                    wrap
                    severity
                    running={live}
                    startLabel="Start All"
                    cap={500}
                  />
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
              station={station}
              decodeL6={clasSource}
              onDecodeL6Change={selected.setClasSource}
              relayLine={relayStatusLine}
            />
          </Stack>
        </Card>
      }
    />
  );
}
