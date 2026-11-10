import { ActionIcon, Popover, Stack, Text, Code } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconQuestionMark } from '@tabler/icons-react';
import { FONT_SIZE, MONO } from '../utils/typography';

const STREAM_FORMATS = [
  { type: 'serial',  path: 'port[:brate[:bsize[:parity[:stopb[:fctr]]]]]', example: 'ttyUSB0:115200' },
  { type: 'tcpsvr',  path: ':port',                                        example: ':2101' },
  { type: 'tcpcli',  path: 'addr[:port]',                                  example: '192.168.1.100:2101' },
  { type: 'ntrip',   path: '[user[:passwd]@]addr[:port][/mntpnt]',         example: 'user:pass@rtk2go.com:2101/MOUNT' },
  { type: 'ntrips',  path: '[:passwd@]addr[:port]/mntpnt[:str]',           example: ':pass@caster:2101/MOUNT', note: 'output only' },
  { type: 'ntripc',  path: '[user:passwd@][:port]/mntpnt[:srctbl]',        example: 'user:pass@:2101/MOUNT', note: 'output only' },
  { type: 'file',    path: 'path[::T][::+start][::xseppd][::S=swap]',     example: '/workspace/out_%Y%m%d.ubx::S=1' },
];

export function StreamPathHelp() {
  const [opened, { toggle, close }] = useDisclosure(false);

  return (
    <Popover opened={opened} onClose={close} position="bottom-start" width={440} shadow="md" withArrow>
      <Popover.Target>
        <ActionIcon size={14} variant="subtle" color="gray" radius="xl" onClick={toggle}>
          <IconQuestionMark size={10} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p="xs">
        <Stack gap={4}>
          <Text size="xs" fw={600} mb={2}>Stream Path Format</Text>
          <Text size="xs" c="dimmed" mb={4}>
            Select a type, then enter the path portion after <Code style={{ fontSize: FONT_SIZE.label }}>type://</Code>
          </Text>
          {STREAM_FORMATS.map(({ type, path, note }) => (
            <div key={type} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <Code style={{ fontSize: FONT_SIZE.label, flexShrink: 0, minWidth: 52 }}>{type}</Code>
              <Text size="xs" style={{ fontSize: FONT_SIZE.label, fontFamily: MONO, color: 'var(--mantine-color-dimmed)' }}>
                {path}
                {note && <Text span size="xs" c="yellow.6" ml={4} style={{ fontSize: FONT_SIZE.label }}>({note})</Text>}
              </Text>
            </div>
          ))}
          <Text size="xs" c="dimmed" mt={4} style={{ fontSize: FONT_SIZE.label }}>
            Monitor only: <Code style={{ fontSize: FONT_SIZE.label }}>Browser serial</Code> opens
            a serial or USB port on the computer running this browser (Chrome or Edge, page on
            localhost or https), so Docker needs no USB access. The port is chosen on Start;
            closing the tab ends the stream.
          </Text>
          <Text size="xs" c="dimmed" mt={4} style={{ fontSize: FONT_SIZE.label }}>
            Example: Type=NTRIP, Path=<Code style={{ fontSize: FONT_SIZE.label }}>user:pass@rtk2go.com:2101/MOUNT</Code>
          </Text>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
