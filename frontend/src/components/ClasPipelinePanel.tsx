import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Grid,
  Group,
  NumberInput,
  ScrollArea,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconInfoCircle,
  IconPlayerPlay,
  IconPlayerStop,
  IconRefresh,
} from '@tabler/icons-react';
import { useWebSocket, type LogMessage } from '../hooks';
import * as clasApi from '../api/clasPipeline';
import { ClasFlowMeter, type FlowStats } from './ClasFlowMeter';
import { PositionScatter, type PositionPoint } from './PositionScatter';
import { StatusIndicator } from './StatusIndicator';
import { FONT_SIZE } from '../utils/typography';

const ROW_LABEL_WIDTH = 130;
const MAX_POSITION_POINTS = 3600;
const MAX_LOG_LINES = 500;
const RECEIVER_REQUEST_URL =
  'https://github.com/h-shiono/mrtklib-docker-ui/issues/new?template=receiver-request.yml';

const RELAY_PROCESS_ID = 'clas-relay';
const CSSR_PROCESS_ID = 'clas-cssr2rtcm3';

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" align="center" mb={6} wrap="nowrap">
      <Text size="sm" c="dimmed" style={{ width: ROW_LABEL_WIDTH, flexShrink: 0 }}>
        {label}
      </Text>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

export function ClasPipelinePanel() {
  // --- Reference data ---
  const [receivers, setReceivers] = useState<clasApi.ReceiverPreset[]>([]);
  const [serialPorts, setSerialPorts] = useState<clasApi.SerialPort[]>([]);
  const [refreshingPorts, setRefreshingPorts] = useState(false);

  // --- Form state ---
  const [receiverId, setReceiverId] = useState<string>('septentrio-mosaic-g5');
  const [inputDevice, setInputDevice] = useState<string>('');
  const [inputBaud, setInputBaud] = useState<number>(115200);
  const [bridgePort, setBridgePort] = useState<number>(9870);
  const [recordSbf, setRecordSbf] = useState<boolean>(false);
  const [sbfRecordPath, setSbfRecordPath] = useState<string>(
    '/workspace/clas/sbf_%Y%m%d_%h%M%S.sbf',
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  // --- Pipeline runtime state ---
  const [pipelineStatus, setPipelineStatus] = useState<clasApi.PipelineStatus>({
    state: 'idle',
    relay_state: 'idle',
    cssr_state: 'idle',
    started_at: null,
    error_message: null,
    bridge_port: null,
  });
  const [submitting, setSubmitting] = useState(false);

  // --- Streamed visualization state ---
  const [points, setPoints] = useState<PositionPoint[]>([]);
  const [flowStats, setFlowStats] = useState<FlowStats | null>(null);
  const [relayLog, setRelayLog] = useState<string[]>([]);
  const [cssrLog, setCssrLog] = useState<string[]>([]);

  const relayScrollRef = useRef<HTMLDivElement>(null);
  const cssrScrollRef = useRef<HTMLDivElement>(null);

  // --- Initial load (mount only — refreshSerialPorts is intentionally
  // excluded from deps to avoid re-fetching on every input edit) ---
  useEffect(() => {
    void (async () => {
      try {
        setReceivers(await clasApi.listReceivers());
      } catch {
        /* surfaced on Start instead */
      }
    })();
    void (async () => {
      try {
        const ports = await clasApi.listSerialPorts();
        setSerialPorts(ports);
        if (ports.length > 0) {
          setInputDevice((cur) => cur || ports[0].path);
        }
      } catch {
        setSerialPorts([]);
      }
    })();
    void (async () => {
      try {
        setPipelineStatus(await clasApi.getPipelineStatus());
      } catch {
        /* harmless on first load */
      }
    })();
  }, []);

  // --- When the receiver preset changes, refresh defaults ---
  useEffect(() => {
    const preset = receivers.find((r) => r.id === receiverId);
    if (preset) {
      setInputBaud(preset.default_input_baud);
    }
  }, [receivers, receiverId]);

  const refreshSerialPorts = useCallback(async () => {
    setRefreshingPorts(true);
    try {
      const ports = await clasApi.listSerialPorts();
      setSerialPorts(ports);
      if (ports.length > 0) {
        if (!inputDevice) setInputDevice(ports[0].path);
      }
    } catch {
      setSerialPorts([]);
    } finally {
      setRefreshingPorts(false);
    }
  }, [inputDevice]);

  // --- WebSocket: receive logs, status, PVT, flow stats ---
  const handleMessage = useCallback((msg: LogMessage) => {
    if (msg.type === 'log' && msg.process_id && msg.message) {
      if (msg.process_id === RELAY_PROCESS_ID) {
        setRelayLog((prev) => [...prev.slice(-MAX_LOG_LINES + 1), msg.message!]);
      } else if (msg.process_id === CSSR_PROCESS_ID) {
        setCssrLog((prev) => [...prev.slice(-MAX_LOG_LINES + 1), msg.message!]);
      }
    } else if (msg.type === 'status' && msg.process_id) {
      // The ProcessManager broadcasts state changes; reflect them in the
      // top-level status by polling — cheaper than maintaining a derived
      // map and accurate enough for a 1-Hz UI.
      void (async () => {
        try {
          setPipelineStatus(await clasApi.getPipelineStatus());
        } catch { /* ignore */ }
      })();
    } else if (msg.type === 'clas_pvt' && msg.lat !== undefined && msg.lon !== undefined) {
      setPoints((prev) => {
        const next = [
          ...prev,
          {
            lat: msg.lat!,
            lon: msg.lon!,
            height: msg.hgt ?? 0,
            quality: msg.quality ?? 5,
            timestamp: msg.time_gpst ?? msg.timestamp,
          },
        ];
        return next.length > MAX_POSITION_POINTS
          ? next.slice(next.length - MAX_POSITION_POINTS)
          : next;
      });
    } else if (msg.type === 'clas_flow') {
      setFlowStats({
        bytes_total: msg.bytes_total ?? 0,
        blocks_total: msg.blocks_total ?? 0,
        bytes_per_sec: msg.bytes_per_sec ?? 0,
        msg_per_sec: msg.msg_per_sec ?? 0,
        last_block_at: msg.last_block_at ?? null,
        last_pvt_at: msg.last_pvt_at ?? null,
      });
    }
  }, []);

  useWebSocket({ onMessage: handleMessage });

  // --- Auto-scroll log viewports ---
  useEffect(() => {
    relayScrollRef.current?.scrollTo({ top: relayScrollRef.current.scrollHeight });
  }, [relayLog]);
  useEffect(() => {
    cssrScrollRef.current?.scrollTo({ top: cssrScrollRef.current.scrollHeight });
  }, [cssrLog]);

  // --- Actions ---
  const handleStart = async () => {
    setSubmitting(true);
    setRelayLog([]);
    setCssrLog([]);
    setPoints([]);
    setFlowStats(null);
    try {
      const status = await clasApi.startPipeline({
        receiver_id: receiverId,
        input_device: inputDevice,
        input_baud: inputBaud,
        bridge_port: bridgePort,
        sbf_record_path: recordSbf ? sbfRecordPath : null,
      });
      setPipelineStatus(status);
    } catch (e) {
      setPipelineStatus((prev) => ({
        ...prev,
        state: 'error',
        error_message: e instanceof Error ? e.message : 'Failed to start',
      }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStop = async () => {
    setSubmitting(true);
    try {
      const status = await clasApi.stopPipeline();
      setPipelineStatus(status);
    } catch (e) {
      setPipelineStatus((prev) => ({
        ...prev,
        state: 'error',
        error_message: e instanceof Error ? e.message : 'Failed to stop',
      }));
    } finally {
      setSubmitting(false);
    }
  };

  // --- Derived values ---
  const isRunning =
    pipelineStatus.state === 'running' || pipelineStatus.state === 'starting';
  const canStart = !isRunning && !!inputDevice && !submitting;
  const portOptions = useMemo(
    () => serialPorts.map((p) => ({ value: p.path, label: p.label })),
    [serialPorts],
  );
  const receiverOptions = useMemo(
    () => receivers.map((r) => ({ value: r.id, label: r.label })),
    [receivers],
  );
  const selectedReceiver = receivers.find((r) => r.id === receiverId);

  return (
    <Grid gutter="md" align="stretch">
      {/* Left column: form + status + actions */}
      <Grid.Col span={{ base: 12, md: 6 }}>
      <Card withBorder p="md" h="100%">
        <Stack gap="xs">
          <Title order={5}>CLAS Pipeline</Title>
          <Text size="xs" c="dimmed">
            Wraps <Code>mrtk relay</Code> and <Code>mrtk cssr2rtcm3</Code> into
            a single workflow. Forward raw SBF (with the QZSS L6 CLAS message)
            from the receiver, decode it to RTCM3 with cssr2rtcm3, and send it
            back so the receiver can run VRS-RTK on its own engine. The relay
            runs bidirectionally (<Code>-b 1</Code>), so a single serial port
            carries both the SBF uplink and the RTCM3 downlink.
          </Text>

          <Divider my={4} />

          {/* Receiver picker */}
          <FormRow label="Receiver">
            <Select
              size="sm"
              value={receiverId}
              onChange={(v) => v && setReceiverId(v)}
              data={receiverOptions}
              disabled={isRunning}
              allowDeselect={false}
            />
          </FormRow>
          {selectedReceiver && (
            <Text size="xs" c="dimmed" pl={ROW_LABEL_WIDTH + 8}>
              {selectedReceiver.notes}
            </Text>
          )}
          <Text size="xs" pl={ROW_LABEL_WIDTH + 8}>
            <Anchor href={RECEIVER_REQUEST_URL} target="_blank" rel="noreferrer">
              Don&apos;t see your receiver? Request one →
            </Anchor>
          </Text>

          <Divider my={4} />

          {/* Serial port — single bidirectional port for SBF in / RTCM3 out */}
          <FormRow label="Serial port">
            <Group gap="xs" wrap="nowrap" style={{ width: '100%' }}>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Autocomplete
                  size="sm"
                  value={inputDevice}
                  onChange={setInputDevice}
                  data={portOptions}
                  placeholder="/dev/ttyUSB0  or  tcpcli://host:9000  or  ntripcli://user:pass@host:2101/MOUNT"
                  disabled={isRunning}
                />
              </Box>
              <ActionIcon
                variant="subtle"
                size="lg"
                onClick={refreshSerialPorts}
                loading={refreshingPorts}
                disabled={isRunning}
                title="Re-enumerate serial ports"
              >
                <IconRefresh size={16} />
              </ActionIcon>
            </Group>
          </FormRow>
          <FormRow label="Baud rate">
            <NumberInput
              size="sm"
              value={inputBaud}
              onChange={(v) => setInputBaud(typeof v === 'number' ? v : 115200)}
              min={1200}
              max={3000000}
              disabled={isRunning}
            />
          </FormRow>

          <Divider my={4} />

          {/* SBF recording — tee the relay's SBF stream to a file */}
          <FormRow label="Record raw SBF">
            <Checkbox
              size="sm"
              checked={recordSbf}
              onChange={(e) => setRecordSbf(e.currentTarget.checked)}
              disabled={isRunning}
              label="Save the SBF stream to /workspace for post-mortem analysis"
            />
          </FormRow>
          {recordSbf && (
            <FormRow label="SBF file path">
              <TextInput
                size="sm"
                value={sbfRecordPath}
                onChange={(e) => setSbfRecordPath(e.currentTarget.value)}
                disabled={isRunning}
                placeholder="/workspace/clas/sbf_%Y%m%d_%h%M%S.sbf"
                description="mrtk relay expands %Y %m %d %h %M %S at write time."
                styles={{
                  input: { fontFamily: 'var(--mantine-font-family-monospace)' },
                  description: { fontSize: FONT_SIZE.label },
                }}
              />
            </FormRow>
          )}

          {/* Advanced */}
          <Anchor
            size="xs"
            component="button"
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide' : 'Show'} advanced
          </Anchor>
          {showAdvanced && (
            <FormRow label="Bridge TCP port">
              <NumberInput
                size="sm"
                value={bridgePort}
                onChange={(v) => setBridgePort(typeof v === 'number' ? v : 9870)}
                min={1025}
                max={65535}
                disabled={isRunning}
                description="Loopback port between mrtk relay and mrtk cssr2rtcm3."
              />
            </FormRow>
          )}

          <Divider my={4} />

          {/* Action row */}
          <Group justify="space-between">
            <Group gap="md">
              <StatusIndicator
                status={pipelineStatus.state}
                label={pipelineStatus.state}
              />
              <Badge size="sm" variant="light" color="gray">
                relay: {pipelineStatus.relay_state}
              </Badge>
              <Badge size="sm" variant="light" color="gray">
                cssr2rtcm3: {pipelineStatus.cssr_state}
              </Badge>
            </Group>
            {isRunning ? (
              <Button
                color="red"
                leftSection={<IconPlayerStop size={16} />}
                onClick={handleStop}
                loading={submitting}
              >
                Stop pipeline
              </Button>
            ) : (
              <Button
                leftSection={<IconPlayerPlay size={16} />}
                onClick={handleStart}
                loading={submitting}
                disabled={!canStart}
              >
                Start pipeline
              </Button>
            )}
          </Group>

          {pipelineStatus.error_message && (
            <Alert
              color="red"
              icon={<IconAlertCircle size={16} />}
              title="Pipeline error"
            >
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                {pipelineStatus.error_message}
              </Text>
            </Alert>
          )}

          {pipelineStatus.state === 'idle' && (
            <Alert
              color="blue"
              variant="light"
              icon={<IconInfoCircle size={16} />}
            >
              <Text size="xs">
                Make sure the serial device is passed through to the container
                (e.g. <Code>--device=/dev/ttyUSB0</Code>) and that the receiver
                is configured to output SBF and accept RTCM3 on that same port.
              </Text>
            </Alert>
          )}
        </Stack>
      </Card>
      </Grid.Col>

      {/* Right column: live monitoring (flow meter, scatter, logs) */}
      <Grid.Col span={{ base: 12, md: 6 }}>
      <Stack gap="md" h="100%" style={{ minHeight: 0 }}>
        <ClasFlowMeter stats={flowStats} />
        <Card withBorder p="sm">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Position (from SBF PVTGeodetic)
            </Text>
            <PositionScatter points={points} />
          </Stack>
        </Card>
        <Card withBorder p="sm" style={{ flex: 1, minHeight: 0 }}>
          <Tabs defaultValue="relay">
            <Tabs.List>
              <Tabs.Tab value="relay">mrtk relay</Tabs.Tab>
              <Tabs.Tab value="cssr">mrtk cssr2rtcm3</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="relay" pt="xs">
              <ScrollArea h={260} viewportRef={relayScrollRef}>
                <Code
                  block
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: FONT_SIZE.label,
                    fontFamily: 'var(--mantine-font-family-monospace)',
                  }}
                >
                  {relayLog.length === 0
                    ? 'Waiting for relay output…'
                    : relayLog.join('\n')}
                </Code>
              </ScrollArea>
            </Tabs.Panel>
            <Tabs.Panel value="cssr" pt="xs">
              <ScrollArea h={260} viewportRef={cssrScrollRef}>
                <Code
                  block
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: FONT_SIZE.label,
                    fontFamily: 'var(--mantine-font-family-monospace)',
                  }}
                >
                  {cssrLog.length === 0
                    ? 'Waiting for cssr2rtcm3 output…'
                    : cssrLog.join('\n')}
                </Code>
              </ScrollArea>
            </Tabs.Panel>
          </Tabs>
        </Card>
      </Stack>
      </Grid.Col>
    </Grid>
  );
}
