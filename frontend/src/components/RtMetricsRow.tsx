import type { ReactNode } from 'react';
import { Box, Group, Text } from '@mantine/core';
import type { PositionUpdate } from '../types/mrtkRunConfig';
import type { Satellite } from '../types/satellite';
import { isUsed } from '../utils/satellites';
import { qualityColor, qualityLabel, qualityTextColor } from '../utils/quality';
import { STATUS_COLOR } from '../utils/status';
import { FONT_SIZE, MONO } from '../utils/typography';

// ─── Real-time metrics row (console redesign Phase 4) ────────────────────────
// At-a-glance metrics in two rows of fixed height, so the panels below do not
// move as data arrives: Time, Quality, Ratio, Age, then Position and Satellites.
// All numerics in IBM Plex Mono.

// Constellation order + letter + color (matches the project's SYS_COLOR / Sky+SNR).
const SYS_ORDER = ['GPS', 'GLONASS', 'Galileo', 'QZSS', 'BeiDou', 'SBAS', 'NavIC'];
const SYS_META: Record<string, { letter: string; color: string }> = {
  GPS:     { letter: 'G', color: '#3b82f6' },
  GLONASS: { letter: 'R', color: '#a855f7' },
  Galileo: { letter: 'E', color: '#f59e0b' },
  QZSS:    { letter: 'J', color: '#22c55e' },
  BeiDou:  { letter: 'C', color: '#ef4444' },
  SBAS:    { letter: 'S', color: '#6b7280' },
  NavIC:   { letter: 'I', color: '#14b8a6' },
};

const CAP = {
  fontFamily: MONO,
  fontSize: FONT_SIZE.caption,
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--mantine-color-dimmed)',
  lineHeight: 1.2,
} as const;

const NUM = {
  fontFamily: MONO,
  fontSize: FONT_SIZE.metric,
  fontWeight: 500,
  lineHeight: 1,
} as const;

const DASH = '—';

/** The fields shown here. A PositionUpdate fits; the Stream Monitor passes
 *  `null` for what its stream format does not carry (shown as —). */
export type MetricsPosition = Pick<PositionUpdate, 'timestamp' | 'lat' | 'lon' | 'quality'> & {
  height: number | null;
  ratio: number | null;
  age: number | null;
};

const TRUNCATE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

function Cell({ caption, children, grow = false, minWidth }: {
  caption: string;
  children: ReactNode;
  /** Takes the row's remaining width and truncates. */
  grow?: boolean;
  minWidth?: number;
}) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: grow ? 0 : minWidth, flex: grow ? '1 1 0' : '0 0 auto' }}>
      <Text component="span" style={CAP}>{caption}</Text>
      {children}
    </Box>
  );
}

const ROW = { display: 'flex', gap: 24, alignItems: 'flex-start', minWidth: 0 } as const;

export function RtMetricsRow({
  lastPosition,
  satellites,
  timeSystem = 'GPST',
}: {
  lastPosition: MetricsPosition | null;
  satellites: Satellite[];
  /** Time system of `lastPosition.timestamp`. */
  timeSystem?: string;
}) {
  const q = lastPosition
    ? {
        label: qualityLabel(lastPosition.quality).toUpperCase(),
        mark: qualityColor(lastPosition.quality),
        text: qualityTextColor(lastPosition.quality),
      }
    : undefined;

  // Per-system used/total breakdown.
  const counts: Record<string, { used: number; total: number }> = {};
  for (const s of satellites) {
    const c = (counts[s.system] ??= { used: 0, total: 0 });
    c.total += 1;
    if (isUsed(s)) c.used += 1;
  }
  const sysList = SYS_ORDER.filter((s) => counts[s]);
  const totalUsed = Object.values(counts).reduce((n, c) => n + c.used, 0);
  const totalVis = Object.values(counts).reduce((n, c) => n + c.total, 0);

  const dataText = { fontFamily: MONO, fontSize: FONT_SIZE.data, fontWeight: 500, lineHeight: 1.25 } as const;
  const sysSummary = sysList.map((sys) => `${SYS_META[sys].letter} ${counts[sys].used}/${counts[sys].total}`).join('  ');

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 16px 6px', flexShrink: 0 }}>
      <Box style={ROW}>
        <Cell caption={`Current time · ${timeSystem}`} grow>
          <Text component="span" title={lastPosition?.timestamp || undefined} style={{ ...dataText, lineHeight: '24px', ...TRUNCATE }}>
            {lastPosition?.timestamp || DASH}
          </Text>
        </Cell>

        <Cell caption="Quality" minWidth={104}>
          <Group gap={7} align="center" wrap="nowrap" style={{ lineHeight: 1 }}>
            <Box
              style={{
                width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                background: q?.mark ?? STATUS_COLOR.off,
              }}
            />
            <Text component="span" style={{ fontSize: FONT_SIZE.metric, fontWeight: 700, lineHeight: 1, color: q?.text ?? 'var(--mantine-color-dimmed)' }}>
              {q?.label ?? DASH}
            </Text>
          </Group>
        </Cell>

        <Cell caption="Ratio" minWidth={72}>
          <Text component="span" style={NUM}>
            {lastPosition?.ratio != null ? lastPosition.ratio.toFixed(2) : DASH}
          </Text>
        </Cell>

        <Cell caption="Age" minWidth={60}>
          <Text component="span" style={NUM}>
            {lastPosition?.age != null ? lastPosition.age.toFixed(1) : DASH}
            {lastPosition?.age != null && <Text component="span" c="dimmed" style={{ fontSize: FONT_SIZE.title }}>s</Text>}
          </Text>
        </Cell>
      </Box>

      <Box style={ROW}>
        <Cell caption="Position · LLH">
          <Group gap={12} wrap="nowrap" style={dataText}>
            <span>{lastPosition ? lastPosition.lat.toFixed(8) : DASH}</span>
            <span>{lastPosition ? lastPosition.lon.toFixed(8) : DASH}</span>
            <span>
              {lastPosition?.height != null ? lastPosition.height.toFixed(3) : DASH}
              <Text component="span" c="dimmed" style={{ fontSize: FONT_SIZE.label }}> m</Text>
            </span>
          </Group>
        </Cell>

        <Cell caption="Satellites · used / visible" grow>
          <Group gap={10} wrap="nowrap" title={sysSummary || undefined} style={{ ...dataText, overflow: 'hidden' }}>
            <span style={{ flexShrink: 0 }}>{totalVis ? `${totalUsed}/${totalVis}` : DASH}</span>
            {sysList.map((sys) => (
              <span key={sys} style={{ fontSize: FONT_SIZE.label, fontWeight: 400, whiteSpace: 'nowrap' }}>
                <span style={{ color: SYS_META[sys].color }}>{SYS_META[sys].letter}</span>
                <Text component="span" inherit c="dimmed"> {counts[sys].used}/{counts[sys].total}</Text>
              </span>
            ))}
          </Group>
        </Cell>
      </Box>
    </Box>
  );
}
