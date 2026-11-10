/**
 * Message output of a u-blox receiver (#136), like u-center's message
 * configuration: one row per message (grouped by class, expandable), one
 * column per port, checked when the message is output (rate 1 = every
 * navigation epoch). A preset checks what MRTKLIB reads; the user adds or
 * removes from there. Apply sends the changed rates with UBX-CFG-VALSET (RAM
 * layer), then reads them back. Messages the firmware does not know (it
 * did not report them) have no check box.
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
import { IconChevronDown, IconChevronRight, IconRefresh } from '@tabler/icons-react';
import { FormRow } from './common/FormRow';
import { MRTKLIB_UBX_MESSAGES, UBLOX_CATALOG, type UbloxMessage, type UbloxModel, type UbloxPort } from '../utils/ubloxCatalog';
import {
  UBLOX_PORTS,
  UBLOX_PRESETS,
  acceptsValget,
  acceptsValset,
  ubloxPreset,
  valget,
  valset,
  type UbloxPresetId,
} from '../utils/ublox';
import type { ReceiverCommand } from '../utils/receiverConsole';
import { FONT_SIZE, MONO } from '../utils/typography';

const LABEL_W = 190;
const COL_W = 64;
const CHANGED_BG = 'var(--mantine-color-blue-light)';

interface Props {
  model: UbloxModel;
  /** Item values the receiver reported (RAM layer). */
  values: Map<number, number>;
  canSend: boolean;
  busy: boolean;
  /** Send the commands in order; resolves true when all were accepted. */
  apply: (commands: ReceiverCommand[]) => Promise<boolean>;
  onReload: () => void;
  footer?: ReactNode;
}

export function UbloxOutputEditor({ model, values, canSend, busy, apply, onReload, footer }: Props) {
  const cat = UBLOX_CATALOG[model];
  const ports = UBLOX_PORTS.filter((p) => cat.messages.some((m) => m.keys[p] !== undefined));
  const groups = useMemo(() => {
    const out = new Map<string, UbloxMessage[]>();
    for (const m of cat.messages) out.set(m.group, [...(out.get(m.group) ?? []), m]);
    return [...out.entries()];
  }, [cat]);
  // Key → name, for the list of changes.
  const names = useMemo(() => {
    const out = new Map<number, string>();
    for (const m of cat.messages) for (const p of UBLOX_PORTS) if (m.keys[p] !== undefined) out.set(m.keys[p]!, `${m.label} ${p}`);
    for (const [name, [key]] of Object.entries(cat.items)) out.set(key, name);
    return out;
  }, [cat]);

  const [edits, setEdits] = useState<Map<number, number>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['UBX RXM']));
  const [presetId, setPresetId] = useState<UbloxPresetId | null>(null);
  const [port, setPort] = useState<UbloxPort>('USB');
  const [showCommands, setShowCommands] = useState(false);

  const presets = UBLOX_PRESETS.filter((p) => p.models.includes(model));
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const rate = (key: number | undefined) => (key === undefined ? undefined : edits.get(key) ?? values.get(key));
  const read = values.size > 0;
  // Only items the receiver reported: its firmware refuses a whole VALSET
  // naming a key it does not know.
  const known = (key: number | undefined): key is number => key !== undefined && values.has(key);

  const setRate = (key: number, value: number) => setEdits((prev) => {
    const next = new Map(prev);
    if (values.get(key) === value) next.delete(key);
    else next.set(key, value);
    return next;
  });
  const toggle = (keys: number[]) => {
    const allOn = keys.every((k) => (rate(k) ?? 0) > 0);
    keys.forEach((k) => setRate(k, allOn ? 0 : 1));
  };
  const loadPreset = () => {
    const { messages, items } = ubloxPreset(preset.id, model, port);
    setEdits((prev) => {
      const next = new Map(prev);
      for (const name of messages) {
        const key = cat.messages.find((m) => m.name === name)?.keys[port];
        if (known(key) && values.get(key) !== 1) next.set(key, 1);
      }
      for (const [key, value] of items) if (known(key) && values.get(key) !== value) next.set(key, value);
      return next;
    });
  };

  const changes = [...edits.entries()];

  /** CFG-VALSET of the changes (RAM), then CFG-VALGET to read them back. */
  const onApply = async () => {
    const set = valset(changes).map((hex, i, all): ReceiverCommand => ({
      hex,
      shown: `CFG-VALSET${all.length > 1 ? ` ${i + 1}/${all.length}` : ''} (RAM)`,
      accept: acceptsValset,
    }));
    const back = valget(changes.map(([k]) => k)).map((hex): ReceiverCommand => ({
      hex, shown: 'CFG-VALGET (read back)', accept: acceptsValget,
    }));
    if (await apply([...set, ...back])) setEdits(new Map());
  };
  const toggleExpand = (g: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    return next;
  });

  const cell = { width: COL_W, textAlign: 'center' } as const;
  const labelStyle = { width: LABEL_W, fontSize: FONT_SIZE.label, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

  const checkbox = (keys: number[], name: string) => {
    if (keys.length === 0) return null;
    const on = keys.filter((k) => (rate(k) ?? 0) > 0).length;
    const changed = keys.some((k) => edits.has(k));
    const r = keys.length === 1 ? rate(keys[0]) : undefined;
    return (
      <Box style={{ background: changed ? CHANGED_BG : undefined, borderRadius: 4, display: 'inline-flex' }} title={r !== undefined && r > 1 ? `every ${r} epochs` : undefined}>
        <Checkbox
          size="xs"
          checked={on === keys.length}
          indeterminate={on > 0 && on < keys.length}
          onChange={() => toggle(keys)}
          disabled={!canSend || !read}
          aria-label={name}
        />
      </Box>
    );
  };

  return (
    <Stack gap="xs" style={{ height: '100%', minHeight: 0 }}>
      <FormRow
        label="Preset"
        trailing={
          <ActionIcon variant="subtle" size={30} onClick={onReload} disabled={!canSend || busy} title="Read the settings again" aria-label="Read the settings again">
            <IconRefresh size={14} />
          </ActionIcon>
        }
      >
        <Group gap="xs" wrap="nowrap">
          <Select
            aria-label="Preset"
            value={preset.id}
            onChange={(v) => v && setPresetId(v as UbloxPresetId)}
            data={presets.map((p) => ({ value: p.id, label: p.label }))}
            allowDeselect={false}
            title={preset.description}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Select
            aria-label="Output port"
            value={port}
            onChange={(v) => v && setPort(v as UbloxPort)}
            data={ports.map((p) => ({ value: p, label: `on ${p}` }))}
            allowDeselect={false}
            style={{ width: 110, flexShrink: 0 }}
          />
          <Button variant="light" onClick={loadPreset} disabled={!canSend || !read} style={{ flexShrink: 0 }}>
            Load
          </Button>
        </Group>
      </FormRow>

      <ScrollArea style={{ flex: 1, minHeight: 0 }} offsetScrollbars>
        {!read ? (
          <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
            Not read from the receiver yet. Read it with ⟳ (u-blox generation 9: CFG-VALGET).
          </Text>
        ) : (
          <Table stickyHeader layout="fixed" verticalSpacing={1} horizontalSpacing={4} withRowBorders={false} style={{ width: LABEL_W + COL_W * ports.length }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={labelStyle} />
                {ports.map((p) => (
                  <Table.Th key={p} style={{ ...cell, fontSize: FONT_SIZE.label }}>{p}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map(([group, messages]) => {
                const open = expanded.has(group);
                return (
                  <Fragment key={group}>
                    <Table.Tr>
                      <Table.Td style={labelStyle}>
                        <UnstyledButton onClick={() => toggleExpand(group)} style={{ fontSize: FONT_SIZE.label, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                          {group}
                        </UnstyledButton>
                      </Table.Td>
                      {ports.map((p) => (
                        <Table.Td key={p} style={cell}>
                          {checkbox(messages.flatMap((m) => (known(m.keys[p]) ? [m.keys[p]!] : [])), `${group} on ${p}`)}
                        </Table.Td>
                      ))}
                    </Table.Tr>
                    {open && messages.map((m) => (
                      <Table.Tr key={m.name}>
                        <Table.Td style={{ ...labelStyle, paddingLeft: 28 }}>
                          <Group gap={4} wrap="nowrap" component="span">
                            <Text span inherit style={{ fontFamily: MONO }}>{m.label.replace(/^(UBX|NMEA|PUBX|RTCM3) /, '')}</Text>
                            {MRTKLIB_UBX_MESSAGES.has(m.name) && (
                              <Box component="span" title="Read by MRTKLIB" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mantine-color-blue-5)', flexShrink: 0 }} />
                            )}
                          </Group>
                        </Table.Td>
                        {ports.map((p) => (
                          <Table.Td key={p} style={cell}>
                            {known(m.keys[p]) && checkbox([m.keys[p]!], `${m.label} on ${p}`)}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Fragment>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </ScrollArea>

      {changes.length > 0 && (
        <Stack gap={4}>
          <Group justify="space-between" wrap="nowrap">
            <UnstyledButton onClick={() => setShowCommands((v) => !v)} style={{ fontSize: FONT_SIZE.label, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {showCommands ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
              {changes.length} item{changes.length > 1 ? 's' : ''} to set (CFG-VALSET, RAM)
            </UnstyledButton>
            <Group gap="xs" wrap="nowrap">
              <Button variant="subtle" onClick={() => setEdits(new Map())} disabled={busy}>Revert</Button>
              <Button onClick={() => void onApply()} loading={busy} disabled={!canSend}>Apply</Button>
            </Group>
          </Group>
          <Collapse in={showCommands}>
            <Box style={{ fontFamily: MONO, fontSize: FONT_SIZE.label }}>
              {changes.map(([key, value]) => (
                <div key={key}>{`${names.get(key) ?? `0x${key.toString(16)}`} = ${value}`}</div>
              ))}
            </Box>
          </Collapse>
        </Stack>
      )}
      {footer}
    </Stack>
  );
}
