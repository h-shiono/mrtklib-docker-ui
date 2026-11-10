/**
 * Receiver configuration of one stream (#136), Septentrio mosaic and u-blox
 * ZED-F9P / NEO-D9C: the Receiver tab of the Streams page, next to the stream's Messages tab, which
 * shows at once whether the receiver now outputs what was asked.
 *
 * Commands go through the stream's own connection (the browser's serial
 * port, or the relay with `-b 1`); the receiver's replies come back in the
 * stream's console entries. Modelled on RxControl: the SBF Output dialog as
 * check boxes (with presets for what MRTKLIB reads), the port and tracking
 * settings, saving to the boot configuration, and an expert console.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Group,
  Popover,
  ScrollArea,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { IconCheck, IconDeviceFloppy, IconRefresh, IconX } from '@tabler/icons-react';
import type { MonitorConsoleEntry } from '../api/streamMonitor';
import { FormRow } from './common/FormRow';
import { commandText, isFailure, type ReceiverCommand } from '../utils/receiverConsole';
import { SbfOutputEditor } from './SbfOutputEditor';
import { UbloxOutputEditor } from './UbloxOutputEditor';
import { UbloxPortsView } from './UbloxPortsView';
import type { UbloxModel } from '../utils/ubloxCatalog';
import {
  LAYER_BBR,
  LAYER_FLASH,
  UBLOX_MODELS,
  acceptsValset,
  readKeys,
  ubloxModelFromVersion,
  ubloxReadCommands,
  ubloxSettings,
  valset,
} from '../utils/ublox';
import { STATUS_COLOR } from '../utils/status';
import { FONT_SIZE, MONO } from '../utils/typography';
import {
  EMPTY_SETTINGS,
  READ_COMMANDS,
  SAVE_COMMAND,
  SEPTENTRIO_MODELS,
  applyReply,
  modelFromName,
  type SeptentrioModel,
  type SeptentrioSettings,
} from '../utils/septentrio';

type StepState = 'waiting' | 'ok' | 'error' | 'timeout' | 'skipped';

interface Step {
  line: string;
  state: StepState;
  reply?: string;
}

/** What the panel needs from the stream that reaches the receiver: its
 *  session on the Streams page (#136). */
export interface ReceiverLink {
  /** Shown in the title, e.g. "Stream 1". */
  name: string;
  /** Prefix of the keys the panel keeps settings under. */
  storageKey: string;
  /** Why commands cannot be sent now, or null when they can. */
  blocked: string | null;
  /** Shown under the receiver row, e.g. limits of this connection. */
  note?: string | null;
  /** Changes with each new session: the panel reads the receiver again. */
  session: string | null;
  consoleEntries: MonitorConsoleEntry[];
  /** Send one command; resolves with its answer (the first reply `accept`
   *  takes, if given), null after a timeout. */
  sendCommand: (
    command: { line: string } | { hex: string },
    accept?: (entry: MonitorConsoleEntry) => boolean,
  ) => Promise<MonitorConsoleEntry | null>;
}

type ReceiverModel = SeptentrioModel | UbloxModel;

const MODEL_OPTIONS = [
  { group: 'Septentrio', items: SEPTENTRIO_MODELS.map((m) => ({ value: m, label: `Septentrio ${m}` })) },
  { group: 'u-blox', items: UBLOX_MODELS.map((m) => ({ value: m, label: `u-blox ${m}` })) },
];

const isUbloxModel = (m: string): m is UbloxModel => (UBLOX_MODELS as string[]).includes(m);

/** What a fresh session reads from the receiver. */
function readCommands(model: ReceiverModel): ReceiverCommand[] {
  return isUbloxModel(model) ? ubloxReadCommands(model) : READ_COMMANDS.map((line) => ({ line }));
}

/** The command `c` makes from its reply (the next page of a poll), if any. */
const follow = (c: ReceiverCommand, reply: MonitorConsoleEntry | null) =>
  (reply && 'next' in c && c.next ? c.next(reply) : null);

const STEP_COLOR: Record<StepState, string> = {
  waiting: STATUS_COLOR.starting,
  ok: STATUS_COLOR.ok,
  error: STATUS_COLOR.error,
  timeout: STATUS_COLOR.warn,
  skipped: STATUS_COLOR.off,
};

export function ReceiverPanel({ link }: { link: ReceiverLink }) {
  const [storedModel, setModel] = useLocalStorage<string>({ key: `${link.storageKey}-model`, defaultValue: 'mosaic-G5' });
  const model = ([...SEPTENTRIO_MODELS, ...UBLOX_MODELS] as string[]).includes(storedModel)
    ? (storedModel as ReceiverModel) : 'mosaic-G5';
  const ublox = isUbloxModel(model);
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>('sbf');

  // Settings as the replies report them (reads, and every set-command's echo).
  const settings = useMemo(
    () => link.consoleEntries.reduce(
      (acc, e) => (e.dir === 'rx' && e.text && e.label === 'Septentrio reply' ? applyReply(acc, e.text) : acc),
      EMPTY_SETTINGS,
    ),
    [link.consoleEntries],
  );
  const ubx = useMemo(() => ubloxSettings(link.consoleEntries), [link.consoleEntries]);
  const detected: ReceiverModel | null = ublox ? ubloxModelFromVersion(ubx.version) : modelFromName(settings.rxName);
  const reportedName = ublox ? ubx.version : settings.rxName;
  const port = settings.port ?? 'USB1';

  const why = link.blocked;
  const takesCommands = why === null;
  const canSend = takesCommands && !busy;

  // Read the receiver once per session and model: Septentrio, its name,
  // prompt (the port this stream talks to, e.g. IP10 over TCP), SBF output
  // and port settings; u-blox, MON-VER and every item the tab shows.
  const startedAt = link.session;
  const { sendCommand } = link;
  const readRef = useRef<string | null>(null); // once, also under StrictMode
  useEffect(() => {
    const key = `${startedAt}:${model}`;
    if (!takesCommands || !startedAt || readRef.current === key) return;
    readRef.current = key;
    void (async () => {
      const queue = readCommands(model);
      // Stops when the model changes: another read has started.
      for (let c = queue.shift(); c && readRef.current === key; c = queue.shift()) {
        try {
          const reply = await sendCommand('line' in c ? { line: c.line } : { hex: c.hex }, 'line' in c ? undefined : c.accept);
          const more = follow(c, reply);
          if (more) queue.unshift(more);
        } catch {
          return;
        }
      }
    })();
  }, [takesCommands, startedAt, model, sendCommand]);

  /** Send lines one by one, each after the previous answer; stop at a
   *  failure unless `keepGoing`. Returns the steps, or null if the server
   *  refused to send. */
  const run = async (initial: ReceiverCommand[], keepGoing = false): Promise<Step[] | null> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    const commands = [...initial];
    const list: Step[] = commands.map((c) => ({ line: commandText(c), state: 'waiting' }));
    setSteps(list);
    try {
      for (let i = 0; i < list.length; i++) {
        const c = commands[i];
        const reply = await sendCommand('line' in c ? { line: c.line } : { hex: c.hex }, 'line' in c ? undefined : c.accept);
        const state: StepState = !reply ? 'timeout' : isFailure(reply) ? 'error' : 'ok';
        list[i] = { ...list[i], state, reply: reply?.text?.split(/\r?\n/)[0] ?? reply?.summary ?? undefined };
        const more = state === 'ok' ? follow(c, reply) : null;
        if (more) {
          commands.splice(i + 1, 0, more);
          list.splice(i + 1, 0, { line: commandText(more), state: 'waiting' });
        }
        const stop = state !== 'ok' && !keepGoing;
        if (stop) for (let j = i + 1; j < list.length; j++) list[j] = { ...list[j], state: 'skipped' };
        setSteps([...list]);
        if (stop) break;
      }
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** Run commands and say in one line how it went; true when all were accepted. */
  const runReported = async (commands: ReceiverCommand[], done: string, keepGoing = false): Promise<boolean> => {
    const result = await run(commands, keepGoing);
    if (!result) return false;
    const bad = result.find((st) => st.state !== 'ok');
    if (!bad) {
      setNotice(done);
      setSteps([]);
      return true;
    }
    setError(bad.state === 'timeout' ? `No answer to: ${bad.line}` : `${bad.line}: ${bad.reply ?? bad.state}`);
    return false;
  };


  /** Septentrio: copy the current configuration to boot. u-blox: write the
   *  values read from RAM to BBR and flash (CFG-VALSET; the D9 has no
   *  CFG-CFG). */
  const saveCommands = (): ReceiverCommand[] => {
    if (!ublox) return [{ line: SAVE_COMMAND }];
    const keys = new Set(readKeys(model));
    const items = [...ubx.values].filter(([k]) => keys.has(k));
    const frames = valset(items, LAYER_BBR | LAYER_FLASH);
    return frames.map((hex, i) => ({ hex, shown: `CFG-VALSET ${i + 1}/${frames.length} (BBR + flash)`, accept: acceptsValset }));
  };
  const readAll = () => void runReported(readCommands(model), 'Read.', true);

  return (
    <Stack gap="xs" style={{ height: '100%', minHeight: 0 }}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Title order={6} size="sm" style={{ whiteSpace: 'nowrap' }}>Receiver · {link.name}</Title>
        </Group>
        <SaveButton
          disabled={!canSend || (ublox && ubx.values.size === 0)}
          what={ublox ? 'CFG-VALSET of every value read, to the BBR and flash layers' : SAVE_COMMAND}
          onSave={() => void runReported(saveCommands(), 'Saved as the boot configuration.')}
        />
      </Group>

      <Stack gap={6}>
        <FormRow label="Receiver">
          <Select
            value={model}
            onChange={(v) => v && setModel(v)}
            data={MODEL_OPTIONS}
            allowDeselect={false}
          />
        </FormRow>
        {detected && detected !== model && (
          <Text c={STATUS_COLOR.warn} style={{ fontSize: FONT_SIZE.label }}>
            The receiver reports {reportedName}.{' '}
            <Text span inherit td="underline" style={{ cursor: 'pointer' }} onClick={() => setModel(detected)}>
              Use {detected}
            </Text>
          </Text>
        )}
        {!ublox && settings.port && (
          <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
            This stream talks to the receiver through <Text span inherit ff="monospace">{settings.port}</Text>.
          </Text>
        )}
        {why && <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>{why}.</Text>}
        {link.note && <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>{link.note}</Text>}
        {notice && <Text c={STATUS_COLOR.ok} style={{ fontSize: FONT_SIZE.label }}>{notice}</Text>}
        {error && (
          <Alert color="red" variant="light" p="xs" withCloseButton onClose={() => setError(null)}>
            <Text style={{ fontSize: FONT_SIZE.label, wordBreak: 'break-all' }}>{error}</Text>
          </Alert>
        )}
      </Stack>

      <Tabs value={tab} onChange={setTab} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Tabs.List>
          <Tabs.Tab value="sbf" style={{ fontSize: FONT_SIZE.label }}>{ublox ? 'Message output' : 'SBF output'}</Tabs.Tab>
          <Tabs.Tab value="receiver" style={{ fontSize: FONT_SIZE.label }}>{ublox ? 'Ports & signals' : 'Ports & tracking'}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="sbf" pt="xs" style={{ flex: 1, minHeight: 0 }}>
          {ublox ? (
            <UbloxOutputEditor
              key={model}
              model={model}
              values={ubx.values}
              canSend={canSend}
              busy={busy}
              apply={(commands) => runReported(commands, 'Applied. Check the result in the Messages tab.')}
              onReload={readAll}
              footer={steps.length > 0 && <StepList steps={steps} />}
            />
          ) : (
            <SbfOutputEditor
              model={model}
              settings={settings}
              port={port}
              canSend={canSend}
              busy={busy}
              apply={(commands) => runReported(commands.map((line) => ({ line })), 'Applied. Check the result in the Messages tab.')}
              onReload={() => void runReported([{ line: 'getSBFOutput' }, { line: 'getDataInOut' }], 'Read.', true)}
              footer={steps.length > 0 && <StepList steps={steps} />}
            />
          )}
        </Tabs.Panel>

        <Tabs.Panel value="receiver" pt="xs" style={{ flex: 1, minHeight: 0 }}>
          <ScrollArea h="100%" offsetScrollbars>
            <Stack gap="xs">
              <Group justify="space-between">
                <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
                  {ublox ? '' : settings.rxName ? `Receiver: ${settings.rxName}` : 'Not read yet.'}
                </Text>
                <Button
                  variant="light"
                  size="compact-xs"
                  leftSection={<IconRefresh size={12} />}
                  onClick={readAll}
                  loading={busy}
                  disabled={!canSend}
                >
                  Read
                </Button>
              </Group>
              {ublox
                ? <UbloxPortsView model={model} values={ubx.values} version={ubx.version} />
                : <PortsAndTracking settings={settings} />}
            </Stack>
          </ScrollArea>
        </Tabs.Panel>

      </Tabs>
    </Stack>
  );
}

function StepList({ steps }: { steps: Step[] }) {
  return (
    <ScrollArea.Autosize mah={140}>
      <Stack gap={2}>
        {steps.map((st, i) => (
          <Group key={i} gap={6} wrap="nowrap" align="flex-start">
            <Box style={{ width: 14, flexShrink: 0, color: STEP_COLOR[st.state], paddingTop: 2 }}>
              {st.state === 'ok' ? <IconCheck size={12} /> : st.state === 'waiting' || st.state === 'skipped' ? '·' : <IconX size={12} />}
            </Box>
            <Box style={{ minWidth: 0 }}>
              <Text style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, wordBreak: 'break-all' }}>{st.line}</Text>
              {st.state !== 'ok' && st.state !== 'waiting' && (
                <Text c={STEP_COLOR[st.state]} style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, wordBreak: 'break-all' }}>
                  {st.state === 'timeout' ? 'No answer within 5 s' : st.state === 'skipped' ? 'Not sent' : st.reply}
                </Text>
              )}
            </Box>
          </Group>
        ))}
      </Stack>
    </ScrollArea.Autosize>
  );
}

function PortsAndTracking({ settings }: { settings: SeptentrioSettings }) {
  const cell = { fontFamily: MONO, fontSize: FONT_SIZE.label, verticalAlign: 'top' } as const;
  const head = { fontSize: FONT_SIZE.label } as const;
  return (
    <Stack gap="xs">
      <Text fw={500} style={{ fontSize: FONT_SIZE.body }}>Input / output per port</Text>
      {settings.dataInOut.length === 0 ? (
        <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>Not read yet.</Text>
      ) : (
        <Table verticalSpacing={2} horizontalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={head}>Port</Table.Th>
              <Table.Th style={head}>Input</Table.Th>
              <Table.Th style={head}>Output</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {settings.dataInOut.map((d) => (
              <Table.Tr key={d.port}>
                <Table.Td style={cell}>{d.port}</Table.Td>
                <Table.Td style={cell}>{d.input}</Table.Td>
                <Table.Td style={{ ...cell, wordBreak: 'break-all' }}>{d.output.replaceAll('+', ' ')}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text fw={500} style={{ fontSize: FONT_SIZE.body }}>Tracked signals</Text>
      <Text c={settings.tracking ? undefined : 'dimmed'} style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, wordBreak: 'break-all' }}>
        {settings.tracking ? settings.tracking.replaceAll('+', ' ') : 'Not read yet.'}
      </Text>
    </Stack>
  );
}

function SaveButton({ disabled, onSave, what }: { disabled: boolean; onSave: () => void; what: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" width={260} withArrow shadow="md">
      <Popover.Target>
        <Button
          variant="light"
          size="compact-xs"
          leftSection={<IconDeviceFloppy size={12} />}
          disabled={disabled}
          onClick={() => setOpened((o) => !o)}
        >
          Save to boot
        </Button>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap={6}>
          <Text style={{ fontSize: FONT_SIZE.label }}>
            Make the receiver&apos;s current settings its boot settings
            (<Text span inherit ff="monospace">{what}</Text>)?
          </Text>
          <Group justify="flex-end" gap={6}>
            <Button variant="subtle" size="compact-xs" onClick={() => setOpened(false)}>Cancel</Button>
            <Button
              size="compact-xs"
              onClick={() => {
                setOpened(false);
                onSave();
              }}
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
