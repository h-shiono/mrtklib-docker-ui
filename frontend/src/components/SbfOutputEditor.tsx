/**
 * SBF output of a Septentrio receiver as check boxes (#136), modelled on
 * RxControl's SBF Output dialog: one column per stream in use, rows for the
 * groups (expandable to their blocks). A preset checks what MRTKLIB needs;
 * the user adds or removes from there. Apply sends only what changed, after
 * showing the commands.
 */

import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconPlus, IconRefresh, IconX } from '@tabler/icons-react';
import { FormRow } from './common/FormRow';
import { MRTKLIB_SBF_BLOCKS } from '../utils/sbfCatalog';
import {
  DEFAULT_INTERVAL,
  SBF_INTERVALS,
  SBF_PORTS,
  SBF_STREAM_NAMES,
  catalogFor,
  expandMessages,
  groupState,
  sameSelection,
  streamCommand,
  type SbfSelection,
} from '../utils/sbfOutput';
import {
  SEPTENTRIO_PRESETS,
  presetSelection,
  type PresetId,
  type SeptentrioModel,
  type SeptentrioSettings,
} from '../utils/septentrio';
import { FONT_SIZE, MONO } from '../utils/typography';

const LABEL_W = 168;
const COL_W = 100;
const CHANGED_BG = 'var(--mantine-color-blue-light)';
const NEW_STREAM = 'new';

function cloneSel(sel: SbfSelection): SbfSelection {
  return { ...sel, blocks: new Set(sel.blocks), extra: [...sel.extra] };
}

interface Props {
  /** Under the grid, e.g. the outcome of the last Apply. */
  footer?: ReactNode;
  model: SeptentrioModel;
  settings: SeptentrioSettings;
  /** The port this stream talks to: the default for a new stream. */
  port: string;
  canSend: boolean;
  busy: boolean;
  /** Send the commands in order; resolves true when all were accepted. */
  apply: (commands: string[]) => Promise<boolean>;
  onReload: () => void;
}

export function SbfOutputEditor({ model, settings, port, canSend, busy, apply, onReload, footer }: Props) {
  const cat = catalogFor(model);
  // Streams as the receiver reports them.
  const receiver = useMemo(() => {
    const m = new Map<string, SbfSelection>();
    for (const o of settings.sbfOutputs) {
      const { blocks, extra } = expandMessages(o.messages, cat);
      m.set(o.stream, { port: o.port, interval: o.interval, blocks, extra });
    }
    return m;
  }, [settings.sbfOutputs, cat]);
  // The user's changes, per stream: a whole selection that replaces the
  // receiver's until applied. Commands a preset needs first (tracking).
  const [edits, setEdits] = useState<Record<string, SbfSelection>>({});
  const [preCommands, setPreCommands] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [presetId, setPresetId] = useState<PresetId>('raw');
  const [target, setTarget] = useState<string>('');
  const [showCommands, setShowCommands] = useState(false);

  // A stream the receiver reports as off has port "none": a new column takes
  // this connection's port instead, or Apply would send its blocks nowhere.
  const off = (stream: string): SbfSelection => ({
    port: [undefined, 'none'].includes(receiver.get(stream)?.port.toLowerCase()) ? port : receiver.get(stream)!.port,
    interval: DEFAULT_INTERVAL,
    blocks: new Set(),
    extra: [],
  });
  const selOf = (stream: string): SbfSelection => edits[stream] ?? receiver.get(stream) ?? off(stream);
  const isActive = (sel: SbfSelection | undefined) => !!sel && (sel.blocks.size > 0 || sel.extra.length > 0);

  // Columns: streams in use on the receiver, and those being edited.
  const columns = SBF_STREAM_NAMES.filter((n) => isActive(receiver.get(n)) || n in edits);
  const nextFree = SBF_STREAM_NAMES.find((n) => !columns.includes(n));

  const setSel = (stream: string, sel: SbfSelection) => {
    setEdits((prev) => {
      const next = { ...prev };
      const base = receiver.get(stream) ?? off(stream);
      // Back to what the receiver has: no longer an edit (a new, empty
      // column stays until removed).
      if (stream in prev && isActive(receiver.get(stream)) && sameSelection(sel, base)) delete next[stream];
      else next[stream] = sel;
      return next;
    });
  };
  const edit = (stream: string, change: (sel: SbfSelection) => void) => {
    const sel = cloneSel(selOf(stream));
    change(sel);
    setSel(stream, sel);
  };
  const toggle = (stream: string, members: string[]) => edit(stream, (sel) => {
    const all = groupState(sel.blocks, members) === 'all';
    members.forEach((b) => (all ? sel.blocks.delete(b) : sel.blocks.add(b)));
  });
  const addStream = () => {
    if (nextFree) setEdits((prev) => ({ ...prev, [nextFree]: off(nextFree) }));
  };
  const removeStream = (stream: string) => {
    if (isActive(receiver.get(stream))) setSel(stream, { ...off(stream), port: selOf(stream).port });
    else setEdits((prev) => {
      const next = { ...prev };
      delete next[stream];
      return next;
    });
  };

  const presets = SEPTENTRIO_PRESETS.filter((p) => p.models.includes(model));
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const defaultTarget = columns.find((c) => selOf(c).port === port) ?? NEW_STREAM;
  const presetTarget = target === NEW_STREAM || columns.includes(target) ? target : defaultTarget;
  const loadPreset = () => {
    const stream = presetTarget === NEW_STREAM ? nextFree : presetTarget;
    if (!stream) return;
    const { blocks, commands } = presetSelection(preset.id, model, settings.tracking);
    const current = selOf(stream);
    setSel(stream, {
      port: presetTarget === NEW_STREAM ? port : current.port,
      interval: isActive(current) ? current.interval : DEFAULT_INTERVAL,
      blocks: new Set(blocks),
      extra: [],
    });
    setPreCommands(commands);
    setTarget(stream);
  };

  // What Apply sends: the preset's first commands, then each changed stream,
  // and SBF allowed out of each port that will carry a stream.
  const changed = columns.filter((c) => c in edits && !sameSelection(edits[c], receiver.get(c) ?? off(c)));
  const commands = [...preCommands];
  const sbfPorts = new Set<string>();
  for (const c of changed) {
    commands.push(streamCommand(c, edits[c], cat));
    if (isActive(edits[c])) sbfPorts.add(edits[c].port);
  }
  for (const p of sbfPorts) {
    const io = settings.dataInOut.find((d) => d.port === p);
    if (!io || !/(^|\+)SBF(\+|$)/i.test(io.output)) commands.push(`setDataInOut, ${p}, , +SBF`);
  }

  const revert = () => {
    setEdits({});
    setPreCommands([]);
  };
  const onApply = async () => {
    if (await apply(commands)) revert();
  };

  const toggleExpand = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });

  const cellStyle = { width: COL_W, textAlign: 'center' } as const;
  const labelStyle = { width: LABEL_W, fontSize: FONT_SIZE.label, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

  /** One check box row; `members` are the blocks it stands for. */
  const row = (key: string, label: ReactNode, members: string[], opts: { indent?: boolean; bold?: boolean; name?: string } = {}) => (
    <Table.Tr key={key}>
      <Table.Td style={{ ...labelStyle, paddingLeft: opts.indent ? 28 : 6, fontWeight: opts.bold ? 600 : undefined }}>
        {label}
      </Table.Td>
      {columns.map((c) => {
        const state = groupState(selOf(c).blocks, members);
        const was = groupState(receiver.get(c)?.blocks ?? new Set(), members);
        return (
          <Table.Td key={c} style={{ ...cellStyle, background: c in edits && state !== was ? CHANGED_BG : undefined }}>
            <Checkbox
              size="xs"
              checked={state === 'all'}
              indeterminate={state === 'some'}
              onChange={() => toggle(c, members)}
              disabled={!canSend}
              aria-label={`${opts.name ?? key} in ${c}`}
              styles={{ body: { justifyContent: 'center' } }}
            />
          </Table.Td>
        );
      })}
      <Table.Td />
    </Table.Tr>
  );

  const expandable = (name: string, members: string[]) => {
    const open = expanded.has(name);
    return (
      <Fragment key={name}>
        {row(
          name,
          <UnstyledButton onClick={() => toggleExpand(name)} style={{ fontSize: FONT_SIZE.label, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
            {name}
          </UnstyledButton>,
          members,
        )}
        {open && members.map((b) => row(
          `${name}/${b}`,
          <Group gap={4} wrap="nowrap" component="span">
            <Text span inherit style={{ fontFamily: MONO }}>{b}</Text>
            {MRTKLIB_SBF_BLOCKS.has(b) && (
              <Box component="span" title="Read by MRTKLIB" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mantine-color-blue-5)', flexShrink: 0 }} />
            )}
          </Group>,
          [b],
          { indent: true, name: b },
        ))}
      </Fragment>
    );
  };

  return (
    <Stack gap="xs" style={{ height: '100%', minHeight: 0 }}>
      <FormRow
        label="Preset"
        trailing={
          <ActionIcon variant="subtle" size={30} onClick={onReload} disabled={!canSend || busy} title="Read the SBF output again" aria-label="Read the SBF output again">
            <IconRefresh size={14} />
          </ActionIcon>
        }
      >
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Preset"
            value={preset.id}
            onChange={(v) => v && setPresetId(v as PresetId)}
            data={presets.map((p) => ({ value: p.id, label: p.label }))}
            allowDeselect={false}
            title={preset.description}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Select
            aria-label="Load into"
            value={presetTarget}
            onChange={(v) => v && setTarget(v)}
            data={[
              ...columns.map((c) => ({ value: c, label: `into ${c}` })),
              ...(nextFree ? [{ value: NEW_STREAM, label: `into ${nextFree} (new)` }] : []),
            ]}
            allowDeselect={false}
            style={{ width: 150, flexShrink: 0 }}
          />
          <Button variant="light" onClick={loadPreset} disabled={!canSend || (presetTarget === NEW_STREAM && !nextFree)} style={{ flexShrink: 0 }}>
            Load
          </Button>
        </Group>
      </FormRow>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
        <Table stickyHeader layout="fixed" verticalSpacing={1} horizontalSpacing={4} withRowBorders={false} style={{ width: LABEL_W + COL_W * columns.length + 40 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={labelStyle} />
              {columns.map((c) => (
                <Table.Th key={c} style={{ ...cellStyle, fontSize: FONT_SIZE.label }}>
                  <Group gap={2} justify="center" wrap="nowrap">
                    <Text inherit fw={600} c={changed.includes(c) ? 'blue' : undefined}>{c}</Text>
                    <ActionIcon variant="subtle" color="gray" size={16} onClick={() => removeStream(c)} disabled={!canSend} title={`Turn ${c} off`} aria-label={`Turn ${c} off`}>
                      <IconX size={10} />
                    </ActionIcon>
                  </Group>
                </Table.Th>
              ))}
              <Table.Th style={{ width: 40 }}>
                <ActionIcon variant="light" size={22} onClick={addStream} disabled={!canSend || !nextFree} title="Add a stream" aria-label="Add a stream">
                  <IconPlus size={12} />
                </ActionIcon>
              </Table.Th>
            </Table.Tr>
            <Table.Tr>
              <Table.Td style={labelStyle}>Port</Table.Td>
              {columns.map((c) => (
                <Table.Td key={c} style={cellStyle}>
                  <Select
                    aria-label={`${c} port`}
                    value={selOf(c).port}
                    onChange={(v) => v && edit(c, (sel) => { sel.port = v; })}
                    data={[...new Set([port, ...SBF_PORTS, selOf(c).port])]}
                    allowDeselect={false}
                    disabled={!canSend}
                    styles={{ input: { fontFamily: MONO, paddingInline: 6 } }}
                  />
                </Table.Td>
              ))}
              <Table.Td />
            </Table.Tr>
            <Table.Tr>
              <Table.Td style={labelStyle}>Interval</Table.Td>
              {columns.map((c) => (
                <Table.Td key={c} style={cellStyle}>
                  <Select
                    aria-label={`${c} interval`}
                    value={SBF_INTERVALS.includes(selOf(c).interval) ? selOf(c).interval : DEFAULT_INTERVAL}
                    onChange={(v) => v && edit(c, (sel) => { sel.interval = v; })}
                    data={SBF_INTERVALS}
                    allowDeselect={false}
                    disabled={!canSend}
                    styles={{ input: { fontFamily: MONO, paddingInline: 6 } }}
                  />
                </Table.Td>
              ))}
              <Table.Td />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {columns.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={2}>
                  <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
                    {settings.sbfOutputs.length === 0
                      ? 'No SBF output read from the receiver yet (Septentrio receivers). Read it with ⟳, or load a preset.'
                      : 'No SBF stream is on. Load a preset or add a stream.'}
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {columns.length > 0 && (
              <>
                {Object.entries(cat.composite).map(([name, members]) => row(name, name, members, { bold: true }))}
                {Object.entries(cat.groups).map(([name, members]) => expandable(name, members))}
                {cat.other.length > 0 && expandable('Other', cat.other)}
              </>
            )}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {commands.length > 0 && (
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <UnstyledButton onClick={() => setShowCommands((v) => !v)} style={{ fontSize: FONT_SIZE.label, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {showCommands ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              {commands.length} command{commands.length > 1 ? 's' : ''} to send
            </UnstyledButton>
            <Group gap="xs" wrap="nowrap">
              <Button variant="subtle" onClick={revert} disabled={busy}>Revert</Button>
              <Button onClick={() => void onApply()} loading={busy} disabled={!canSend}>Apply</Button>
            </Group>
          </Group>
          <Collapse in={showCommands}>
            <Box style={{ fontFamily: MONO, fontSize: FONT_SIZE.label, wordBreak: 'break-all' }}>
              {commands.map((c, i) => <div key={i}>{c}</div>)}
            </Box>
          </Collapse>
        </Stack>
      )}
      {footer}
    </Stack>
  );
}
