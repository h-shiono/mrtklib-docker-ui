/**
 * Stream Monitor's Message tab (#136): every message type with its counters
 * on the left; the selected type on the right, one row per satellite for
 * navigation data, its latest frames otherwise. A row opens the whole frame.
 *
 * Presentational: the data arrives through StreamMonitorPanel's WebSocket
 * (lessons L09), and the backend sends rows only for the selected type.
 */

import { useMemo, useState, type KeyboardEvent } from 'react';
import { Box, Group, ScrollArea, Table, Text } from '@mantine/core';
import type { MonitorMessageRow, MonitorMessageType } from '../api/streamMonitor';
import {
  formatAge,
  formatRate,
  hexDump,
  messageRowId,
  sortMessageTypes,
} from '../utils/streamMessages';
import { FONT_SIZE, MONO } from '../utils/typography';

const LIST_WIDTH = 380;
const DETAIL_HEIGHT = 170;
const SELECTED_BG = 'var(--mantine-primary-color-light)';
const PANE_BG = 'var(--app-console-bg)';
const CELL = {
  fontFamily: MONO,
  fontSize: FONT_SIZE.label,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
} as const;
const RIGHT = { ...CELL, textAlign: 'right' } as const;

function activateOnKey(event: KeyboardEvent, activate: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  activate();
}

function Placeholder({ children }: { children: string }) {
  return (
    <Text c="dimmed" fs="italic" p="xs" style={{ fontFamily: MONO, fontSize: FONT_SIZE.label }}>
      {children}
    </Text>
  );
}

interface StreamMessagePanelProps {
  types: MonitorMessageType[];
  rows: MonitorMessageRow[];
  selected: string | null;
  onSelect: (label: string) => void;
  /** Server time of the last counters; ages are measured against it. */
  now: number;
  /** Time since reception means nothing for a file. */
  showAge: boolean;
  height: number;
}

export function StreamMessagePanel({
  types,
  rows,
  selected,
  onSelect,
  now,
  showAge,
  height,
}: StreamMessagePanelProps) {
  const sorted = useMemo(() => sortMessageTypes(types), [types]);

  return (
    <div style={{ display: 'flex', gap: 10, height, minHeight: 0 }}>
      <div style={{ width: LIST_WIDTH, flexShrink: 0, minWidth: 0, minHeight: 0 }}>
        <ScrollArea h={height}>
          {sorted.length === 0 ? (
            <Placeholder>No messages yet.</Placeholder>
          ) : (
            <Table stickyHeader highlightOnHover verticalSpacing={2} horizontalSpacing={6} layout="fixed">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={CELL}>Message</Table.Th>
                  <Table.Th style={{ ...RIGHT, width: 62 }}>Count</Table.Th>
                  <Table.Th style={{ ...RIGHT, width: 46 }}>Hz</Table.Th>
                  <Table.Th style={{ ...RIGHT, width: 46 }}>Size</Table.Th>
                  <Table.Th style={{ ...RIGHT, width: 52 }}>Age</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {sorted.map((t) => (
                  <Table.Tr
                    key={t.label}
                    tabIndex={0}
                    aria-selected={t.label === selected}
                    onClick={() => onSelect(t.label)}
                    onKeyDown={(e) => activateOnKey(e, () => onSelect(t.label))}
                    style={{
                      cursor: 'pointer',
                      backgroundColor: t.label === selected ? SELECTED_BG : undefined,
                    }}
                  >
                    <Table.Td style={CELL} title={t.label}>{t.label}</Table.Td>
                    <Table.Td style={RIGHT}>{t.count.toLocaleString('en-US')}</Table.Td>
                    <Table.Td style={RIGHT}>{formatRate(t.rate)}</Table.Td>
                    <Table.Td style={RIGHT}>{t.length}</Table.Td>
                    <Table.Td style={RIGHT}>{showAge ? formatAge(now - t.last) : '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </ScrollArea>
      </div>

      {/* A new type starts with no open row. */}
      <MessageRows key={selected ?? ''} rows={rows} selected={selected} now={now} showAge={showAge} />
    </div>
  );
}

function MessageRows({
  rows,
  selected,
  now,
  showAge,
}: Pick<StreamMessagePanelProps, 'rows' | 'selected' | 'now' | 'showAge'>) {
  const [openId, setOpenId] = useState<string | number | null>(null);
  // A satellite's open row follows its updates; a listed frame stays until
  // it leaves the list.
  const open = rows.find((row) => messageRowId(row) === openId) ?? null;
  const keyed = rows.some((row) => row.key !== null);
  const hasSummary = rows.some((row) => row.summary !== null);

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Group justify="space-between" wrap="nowrap" gap="xs" style={{ flexShrink: 0, padding: '0 4px' }}>
        <Text size="xs" truncate="end" style={{ fontFamily: MONO, minWidth: 0 }}>
          {selected ?? ' '}
        </Text>
        {rows.length > 0 && (
          <Text size="xs" c="dimmed" style={{ flexShrink: 0, fontSize: FONT_SIZE.label }}>
            {keyed ? 'latest per satellite' : `latest ${rows.length}, newest first`}
          </Text>
        )}
      </Group>

      <ScrollArea style={{ flex: 1, minHeight: 0 }}>
        {selected === null ? (
          <Placeholder>Select a message type on the left.</Placeholder>
        ) : rows.length === 0 ? (
          <Placeholder>Waiting for this message…</Placeholder>
        ) : (
          <Table
            stickyHeader
            highlightOnHover
            verticalSpacing={2}
            horizontalSpacing={6}
            layout="fixed"
            style={{ minWidth: 620 }}
          >
            <Table.Thead>
              <Table.Tr>
                {keyed && <Table.Th style={{ ...CELL, width: 96 }}>SV</Table.Th>}
                <Table.Th style={{ ...RIGHT, width: 52 }}>Age</Table.Th>
                <Table.Th style={{ ...RIGHT, width: 46 }}>Len</Table.Th>
                {hasSummary && <Table.Th style={{ ...CELL, width: 320 }}>Info</Table.Th>}
                <Table.Th style={CELL}>Data</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => {
                const id = messageRowId(row);
                const toggle = () => setOpenId((cur) => (cur === id ? null : id));
                return (
                  <Table.Tr
                    key={id}
                    tabIndex={0}
                    aria-expanded={id === openId}
                    onClick={toggle}
                    onKeyDown={(e) => activateOnKey(e, toggle)}
                    style={{ cursor: 'pointer', backgroundColor: id === openId ? SELECTED_BG : undefined }}
                  >
                    {keyed && <Table.Td style={CELL}>{row.key}</Table.Td>}
                    <Table.Td style={RIGHT}>{showAge ? formatAge(now - row.t) : '—'}</Table.Td>
                    <Table.Td style={RIGHT}>{row.length}</Table.Td>
                    {hasSummary && <Table.Td style={CELL} title={row.summary ?? undefined}>{row.summary}</Table.Td>}
                    <Table.Td style={CELL}>{row.preview ?? row.data}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </ScrollArea>

      {open && <FrameDetail row={open} />}
    </div>
  );
}

function FrameDetail({ row }: { row: MonitorMessageRow }) {
  // No preview = a text frame (NMEA, solution text): `data` is the line.
  const text = useMemo(() => (row.preview === null ? row.data : hexDump(row.data)), [row]);
  return (
    <Box style={{ flexShrink: 0, minHeight: 0 }}>
      <ScrollArea h={DETAIL_HEIGHT} styles={{ viewport: { backgroundColor: PANE_BG, padding: '6px 8px' } }}>
        <Text
          c="var(--app-console-fg)"
          style={{
            fontFamily: MONO,
            fontSize: FONT_SIZE.label,
            lineHeight: 1.5,
            whiteSpace: row.preview === null ? 'pre-wrap' : 'pre',
            wordBreak: row.preview === null ? 'break-all' : undefined,
          }}
        >
          {text}
        </Text>
      </ScrollArea>
    </Box>
  );
}
