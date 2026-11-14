/**
 * Ports, rates, signals and QZSS L6 channels of a u-blox receiver (#136), as
 * read with UBX-CFG-VALGET: what each port may output, the measurement and
 * navigation rates, which signals are enabled, and (NEO-D9C) which QZSS
 * satellite and L6 message each channel decodes.
 */

import { Stack, Table, Text } from '@mantine/core';
import { UBLOX_CATALOG, type UbloxModel, type UbloxPort } from '../utils/ubloxCatalog';
import { UBLOX_PORTS, signed8 } from '../utils/ublox';
import { FONT_SIZE, MONO } from '../utils/typography';

const L6_MSG = ['L6D', 'L6E'];

function sv(v: number | undefined): string {
  if (v === undefined) return '—';
  const n = signed8(v);
  return n < 0 ? 'disabled' : n === 0 ? 'automatic' : `J${String(n).padStart(2, '0')}`;
}

export function UbloxPortsView({ model, values, version, connectedPort }: {
  model: UbloxModel;
  values: Map<number, number>;
  version: string | null;
  /** The port this stream talks to (MON-COMMS), if known. */
  connectedPort: UbloxPort | null;
}) {
  const items = UBLOX_CATALOG[model].items;
  const get = (name: string) => (items[name] ? values.get(items[name][0]) : undefined);
  const cell = { fontFamily: MONO, fontSize: FONT_SIZE.label } as const;
  const head = { fontSize: FONT_SIZE.label } as const;
  const outProtocols = ['UBX', 'NMEA', 'RTCM3X'];
  const ports = UBLOX_PORTS.filter((p) => outProtocols.some((x) => items[`CFG-${p}OUTPROT-${x}`]));
  const signals = Object.keys(items).filter((n) => n.startsWith('CFG-SIGNAL-')).sort();
  const yes = (v: number | undefined) => (v === undefined ? '—' : v ? 'on' : 'off');

  return (
    <Stack gap="xs">
      <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>{version ? `Receiver: ${version}` : 'Not read yet.'}</Text>
      {version && (
        <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
          {connectedPort ? `This stream talks to the receiver's ${connectedPort} port.` : 'The receiver did not say which port this stream uses.'}
        </Text>
      )}

      {ports.length > 0 && (
        <>
          <Text fw={500} style={{ fontSize: FONT_SIZE.body }}>Output protocols per port</Text>
          <Table verticalSpacing={2} horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={head}>Port</Table.Th>
                {outProtocols.map((x) => <Table.Th key={x} style={head}>{x}</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ports.map((p) => (
                <Table.Tr key={p}>
                  <Table.Td style={cell}>{p === connectedPort ? `${p} (connected)` : p}</Table.Td>
                  {outProtocols.map((x) => <Table.Td key={x} style={cell}>{yes(get(`CFG-${p}OUTPROT-${x}`))}</Table.Td>)}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}

      {items['CFG-RATE-MEAS'] && (
        <>
          <Text fw={500} style={{ fontSize: FONT_SIZE.body }}>Rates</Text>
          <Text style={cell}>
            {`measurement ${get('CFG-RATE-MEAS') ?? '—'} ms · navigation every ${get('CFG-RATE-NAV') ?? '—'} measurement(s)`}
          </Text>
        </>
      )}

      {signals.length > 0 && (
        <>
          <Text fw={500} style={{ fontSize: FONT_SIZE.body }}>Signals</Text>
          <Text style={{ ...cell, wordBreak: 'break-all' }}>
            {signals.map((n) => `${n.slice('CFG-SIGNAL-'.length).replace(/_ENA$/, '')} ${yes(get(n))}`).join(' · ')}
          </Text>
        </>
      )}

      {items['CFG-QZSS-L6_SVIDA'] && (
        <>
          <Text fw={500} style={{ fontSize: FONT_SIZE.body }}>QZSS L6 channels</Text>
          <Table verticalSpacing={2} horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={head}>Channel</Table.Th>
                <Table.Th style={head}>Satellite</Table.Th>
                <Table.Th style={head}>Message</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(['A', 'B'] as const).map((ch) => {
                const msg = get(`CFG-QZSS-L6_MSG${ch}`);
                return (
                  <Table.Tr key={ch}>
                    <Table.Td style={cell}>{ch}</Table.Td>
                    <Table.Td style={cell}>{sv(get(`CFG-QZSS-L6_SVID${ch}`))}</Table.Td>
                    <Table.Td style={cell}>{msg === undefined ? '—' : L6_MSG[msg] ?? String(msg)}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
