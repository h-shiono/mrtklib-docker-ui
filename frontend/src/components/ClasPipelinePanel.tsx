import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Autocomplete,
  Button,
  Card,
  Code,
  Grid,
  Group,
  NumberInput,
  Popover,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconLock,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconQuestionMark,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { StreamPathHelp } from './StreamPathHelp';
import { randomUUID } from '../utils/uuid';
import { useWebSocket, type LogMessage } from '../hooks';
import * as clasApi from '../api/clasPipeline';
import { StatusBadge } from './common/StatusBadge';
import { processTone, type ProcessState } from '../utils/status';
import { FONT_SIZE, MONO } from '../utils/typography';
import { FormRow } from './common/FormRow';
import { FORM_LABEL_GAP, FORM_LABEL_WIDTH } from '../utils/formLayout';
import { LogView } from './common/LogView';

const MAX_LOG_LINES = 500;
const RECEIVER_REQUEST_URL =
  'https://github.com/h-shiono/mrtklib-docker-ui/issues/new?template=receiver-request.yml';

const RELAY_PROCESS_ID = 'clas-relay';
const CSSR_PROCESS_ID = 'clas-cssr2rtcm3';

/** What CLAS to RTCM3 does and what it needs, behind the ? next to its title. */
function ClasHelp() {
  const [opened, { toggle, close }] = useDisclosure(false);
  const code = { fontSize: FONT_SIZE.label, whiteSpace: 'nowrap' } as const;
  return (
    <Popover opened={opened} onClose={close} position="bottom-start" width={400} shadow="md" withArrow>
      <Popover.Target>
        <ActionIcon size={14} variant="subtle" color="gray" radius="xl" onClick={toggle}
          aria-label="About CLAS to RTCM3"
        >
          <IconQuestionMark size={10} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap={6}>
          <Text size="xs">
            For the receiver's own RTK engine: converts CLAS (the QZSS L6 message in
            the receiver's raw SBF) to RTCM3 with <Code style={code}>mrtk cssr2rtcm3</Code> and
            sends it back to the receiver. <Code style={code}>mrtk relay</Code> runs
            bidirectionally (<Code style={code}>-b 1</Code>), so one serial port carries
            both the SBF uplink and the RTCM3 downlink.
          </Text>
          <Text size="xs">
            To watch the receiver's position and messages, open the Stream Monitor
            with input type <b>Stream Relay</b> and pick <b>CLAS to RTCM3</b> (the
            bridge, or another TCP Server output).
          </Text>
          <Text size="xs">
            Pass the serial device through to the container
            (e.g. <Code style={code}>--device=/dev/ttyUSB0</Code>) and configure the receiver
            to output SBF and accept RTCM3 on that same port.
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

/** Further relay outputs: record the raw SBF, or hand it to other apps. */
type OutputType = 'file' | 'tcpsvr';
interface ClasOutput { id: string; type: OutputType; path: string }

const OUTPUT_TYPES = [
  { value: 'file', label: 'File' },
  { value: 'tcpsvr', label: 'TCP Server' },
];
const OUTPUT_DEFAULT: Record<OutputType, string> = {
  file: '/workspace/clas/sbf_%Y%m%d_%h%M%S.sbf',
  tcpsvr: ':9871',
};
const MAX_OUTPUTS = 4;

const outputArg = (o: ClasOutput) => `${o.type}://${o.path.trim()}`;

/** The receiver input: a serial port (`device[:baud]`, as in Stream Relay) or
 *  a TCP client (`host:port`), e.g. a relay on another machine that serves
 *  the receiver's serial port with `-b 1`. */
type InputType = 'serial' | 'tcpcli';
const INPUT_TYPES = [
  { value: 'serial', label: 'Serial' },
  { value: 'tcpcli', label: 'TCP Client' },
];
const INPUT_PLACEHOLDER: Record<InputType, string> = {
  serial: 'ttyACM0:115200',
  tcpcli: 'host.docker.internal:9001',
};
const DEFAULT_BAUD = 115200;

/** Split `device[:baud]`; a missing baud takes the receiver's default. */
function splitSerialPath(path: string, defaultBaud: number): { device: string; baud: number } {
  const m = /^(.*):(\d+)$/.exec(path.trim());
  return m ? { device: m[1], baud: Number(m[2]) } : { device: path.trim(), baud: defaultBaud };
}

const STATE_LABEL: Record<string, string> = {
  idle: 'Idle', starting: 'Starting', running: 'Running',
  stopping: 'Stopping', stopped: 'Stopped', error: 'Error',
};

export function ClasPipelinePanel() {
  // --- Reference data ---
  const [receivers, setReceivers] = useState<clasApi.ReceiverPreset[]>([]);
  const [serialPorts, setSerialPorts] = useState<clasApi.SerialPort[]>([]);
  const [refreshingPorts, setRefreshingPorts] = useState(false);

  // --- Form state ---
  const [receiverId, setReceiverId] = useState<string>('septentrio-mosaic-g5');
  const [inputType, setInputType] = useState<InputType>('serial');
  const [inputPath, setInputPath] = useState<string>('');
  const [bridgePort, setBridgePort] = useState<number>(9870);
  const [outputs, setOutputs] = useState<ClasOutput[]>([]);

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

  // --- Logs of the two processes ---
  const [relayLog, setRelayLog] = useState<string[]>([]);
  const [cssrLog, setCssrLog] = useState<string[]>([]);


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
          setInputPath((cur) => cur || `${ports[0].path}:${DEFAULT_BAUD}`);
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

  const refreshSerialPorts = useCallback(async () => {
    setRefreshingPorts(true);
    try {
      const ports = await clasApi.listSerialPorts();
      setSerialPorts(ports);
      if (ports.length > 0) {
        setInputPath((cur) => cur || `${ports[0].path}:${DEFAULT_BAUD}`);
      }
    } catch {
      setSerialPorts([]);
    } finally {
      setRefreshingPorts(false);
    }
  }, []);

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
    }
  }, []);

  useWebSocket({ onMessage: handleMessage });

  // --- Actions ---
  /** The API's input: a serial device and baud, or a TCP client URL. */
  const startInput = (): { input_device: string; input_baud: number } => {
    if (inputType === 'tcpcli') {
      return { input_device: `tcpcli://${inputPath.trim()}`, input_baud: DEFAULT_BAUD };
    }
    const defaultBaud = receivers.find((r) => r.id === receiverId)?.default_input_baud ?? DEFAULT_BAUD;
    const { device, baud } = splitSerialPath(inputPath, defaultBaud);
    // A bare name (ttyACM0), as Stream Relay paths take it, is under /dev.
    return { input_device: device.startsWith('/') ? device : `/dev/${device}`, input_baud: baud };
  };

  const handleStart = async () => {
    setSubmitting(true);
    setRelayLog([]);
    setCssrLog([]);
    try {
      const status = await clasApi.startPipeline({
        receiver_id: receiverId,
        ...startInput(),
        bridge_port: bridgePort,
        outputs: outputs.map(outputArg),
      });
      setPipelineStatus(status);
      // A file output that would overwrite an existing file is numbered
      // (_2, _3, ...) by the server; say which file is written.
      const numbered = outputs.flatMap((o, i) => {
        const written = status.outputs?.[i];
        return written && written !== outputArg(o) ? [`[INFO] Target in use, writing to ${written}`] : [];
      });
      if (numbered.length) setRelayLog((prev) => [...prev, ...numbered]);
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
  const canStart = !isRunning && !!inputPath.trim() && !submitting;
  // Serial ports with the receiver's default baud, as `device:baud`.
  const portOptions = useMemo(() => {
    const baud = receivers.find((r) => r.id === receiverId)?.default_input_baud ?? DEFAULT_BAUD;
    return serialPorts.map((p) => ({ value: `${p.path}:${baud}`, label: `${p.label}:${baud}` }));
  }, [serialPorts, receivers, receiverId]);
  const receiverOptions = useMemo(
    () => receivers.map((r) => ({ value: r.id, label: r.label })),
    [receivers],
  );
  const selectedReceiver = receivers.find((r) => r.id === receiverId);

  return (
    <Grid gutter="md" align="stretch" overflow="hidden" h={{ base: 'auto', md: '100%' }} styles={{ inner: { height: 'calc(100% + var(--mantine-spacing-md))' } }}>
      {/* Left column: form + status + actions */}
      <Grid.Col span={{ base: 12, md: 6 }} h={{ base: 'auto', md: '100%' }}>
      <Card withBorder p="xs" h="100%" style={{ overflowY: 'auto' }}>
        {/* Header: title, ?, state, then Start / Stop at the far right */}
        <Group justify="space-between" mb="xs" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Title order={5} size="sm">CLAS to RTCM3</Title>
            <ClasHelp />
            <Tooltip
              label={`mrtk relay: ${pipelineStatus.relay_state} · mrtk cssr2rtcm3: ${pipelineStatus.cssr_state}`}
              openDelay={300}
            >
              <div>
                <StatusBadge tone={processTone(pipelineStatus.state as ProcessState)}>
                  {STATE_LABEL[pipelineStatus.state] ?? pipelineStatus.state}
                </StatusBadge>
              </div>
            </Tooltip>
          </Group>
          {isRunning ? (
            <Button
              variant="filled"
              color="red"
              size="compact-xs"
              leftSection={<IconPlayerStop size={12} />}
              onClick={handleStop}
              loading={submitting}
            >
              Stop
            </Button>
          ) : (
            <Button
              variant="filled"
              color="green"
              size="compact-xs"
              leftSection={<IconPlayerPlay size={12} />}
              onClick={handleStart}
              loading={submitting}
              disabled={!canStart}
            >
              Start
            </Button>
          )}
        </Group>
        <Stack gap={6}>
          {/* Receiver picker */}
          <FormRow label="Receiver">
            <Select
              value={receiverId}
              onChange={(v) => v && setReceiverId(v)}
              data={receiverOptions}
              disabled={isRunning}
              allowDeselect={false}
            />
          </FormRow>
          <Text c="dimmed" pl={FORM_LABEL_WIDTH + FORM_LABEL_GAP} style={{ fontSize: FONT_SIZE.label }}>
            {selectedReceiver?.notes}{selectedReceiver?.notes ? ' ' : ''}
            <Anchor href={RECEIVER_REQUEST_URL} target="_blank" rel="noreferrer" inherit>
              Request another receiver
            </Anchor>
          </Text>

          {/* Input, as in Stream Relay: one bidirectional stream, SBF in and
              RTCM3 back. The baud rate is part of a serial path. */}
          <FormRow
            label={<Group gap={4} wrap="nowrap">Input<StreamPathHelp /></Group>}
            trailing={
              <Tooltip label="Re-enumerate serial ports" openDelay={300}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={30}
                  onClick={refreshSerialPorts}
                  loading={refreshingPorts}
                  disabled={isRunning || inputType !== 'serial'}
                  aria-label="Re-enumerate serial ports"
                >
                  <IconRefresh size={16} />
                </ActionIcon>
              </Tooltip>
            }
          >
            <Group gap={FORM_LABEL_GAP} wrap="nowrap">
              <Select
                aria-label="Input type"
                value={inputType}
                onChange={(v) => {
                  if (!v || v === inputType) return;
                  setInputType(v as InputType);
                  setInputPath('');
                }}
                data={INPUT_TYPES}
                allowDeselect={false}
                disabled={isRunning}
                style={{ width: 120, flexShrink: 0 }}
              />
              <Autocomplete
                aria-label="Input path"
                value={inputPath}
                onChange={setInputPath}
                data={inputType === 'serial' ? portOptions : []}
                placeholder={INPUT_PLACEHOLDER[inputType]}
                disabled={isRunning}
                style={{ flex: 1, minWidth: 0 }}
                styles={{ input: { fontFamily: MONO } }}
              />
            </Group>
          </FormRow>

          {/* Outputs, as in Stream Relay. The first is the bridge to
              cssr2rtcm3 and must stay first: -b 1 relays back from it. */}
          <FormRow
            label={<Group gap={4} wrap="nowrap">Outputs<StreamPathHelp /></Group>}
            align="flex-start"
            trailing={
              <ActionIcon
                variant="light"
                color="blue"
                size="xs"
                onClick={() => setOutputs((prev) => [...prev, { id: randomUUID(), type: 'file', path: OUTPUT_DEFAULT.file }])}
                disabled={isRunning || outputs.length >= MAX_OUTPUTS}
                aria-label="Add output"
              >
                <IconPlus size={10} />
              </ActionIcon>
            }
          >
            <Stack gap={6}>
              <Group gap={FORM_LABEL_GAP} wrap="nowrap">
                <Select
                  aria-label="Bridge output type"
                  value="tcpsvr"
                  data={OUTPUT_TYPES}
                  disabled
                  style={{ width: 120, flexShrink: 0 }}
                />
                <NumberInput
                  aria-label="Bridge port"
                  value={bridgePort}
                  onChange={(v) => setBridgePort(typeof v === 'number' ? v : 9870)}
                  min={1025}
                  max={65535}
                  hideControls
                  prefix=":"
                  disabled={isRunning}
                  style={{ flex: 1, minWidth: 0 }}
                  styles={{ input: { fontFamily: MONO } }}
                />
                <Tooltip
                  label="Bridge: feeds mrtk cssr2rtcm3 and takes its RTCM3 back to the receiver (relay-back). Always the first output."
                  multiline
                  w={260}
                  openDelay={300}
                >
                  <ActionIcon variant="subtle" color="gray" size="xs" aria-label="About the bridge output" style={{ flexShrink: 0 }}>
                    <IconLock size={10} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {outputs.map((o) => (
                <Group key={o.id} gap={FORM_LABEL_GAP} wrap="nowrap">
                  <Select
                    aria-label="Output type"
                    value={o.type}
                    onChange={(v) => v && setOutputs((prev) => prev.map((x) => (
                      x.id === o.id ? { ...x, type: v as OutputType, path: OUTPUT_DEFAULT[v as OutputType] } : x
                    )))}
                    data={OUTPUT_TYPES}
                    allowDeselect={false}
                    disabled={isRunning}
                    style={{ width: 120, flexShrink: 0 }}
                  />
                  <TextInput
                    aria-label="Output path"
                    value={o.path}
                    onChange={(e) => {
                      const path = e.currentTarget.value;
                      setOutputs((prev) => prev.map((x) => (x.id === o.id ? { ...x, path } : x)));
                    }}
                    placeholder={OUTPUT_DEFAULT[o.type]}
                    disabled={isRunning}
                    style={{ flex: 1, minWidth: 0 }}
                    styles={{ input: { fontFamily: MONO } }}
                  />
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="xs"
                    onClick={() => setOutputs((prev) => prev.filter((x) => x.id !== o.id))}
                    disabled={isRunning}
                    aria-label="Remove output"
                    style={{ flexShrink: 0 }}
                  >
                    <IconTrash size={10} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          </FormRow>

          {pipelineStatus.error_message && (
            <Alert
              color="red"
              icon={<IconAlertCircle size={16} />}
              title="Pipeline error"
            >
              <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>
                {pipelineStatus.error_message}
              </Text>
            </Alert>
          )}

        </Stack>
      </Card>
      </Grid.Col>

      {/* Right column: the two processes' logs. Positions are watched in the
          Stream Monitor, which reads the bridge like any relay output. */}
      <Grid.Col span={{ base: 12, md: 6 }} h={{ base: 'auto', md: '100%' }}>
        <Card withBorder p="sm" h="100%" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Tabs defaultValue="relay" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Tabs.List>
              <Tabs.Tab value="relay">mrtk relay</Tabs.Tab>
              <Tabs.Tab value="cssr">mrtk cssr2rtcm3</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="relay" pt="xs" style={{ flex: 1, minHeight: 0 }}>
              <LogView lines={relayLog} wrap severity running={isRunning} startLabel="Start" cap={MAX_LOG_LINES} />
            </Tabs.Panel>
            <Tabs.Panel value="cssr" pt="xs" style={{ flex: 1, minHeight: 0 }}>
              <LogView lines={cssrLog} wrap severity running={isRunning} startLabel="Start" cap={MAX_LOG_LINES} />
            </Tabs.Panel>
          </Tabs>
        </Card>
      </Grid.Col>
    </Grid>
  );
}
