import { Box, Group, Stack, Text } from '@mantine/core';
import type { PositionUpdate } from '../types/mrtkRunConfig';
import type { Satellite } from './SkySnrPanel';
import { isUsed } from '../utils/rtSatellites';
import { QUALITY } from '../utils/rtQuality';

// ─── Real-time metrics row (console redesign Phase 4) ────────────────────────
// Borderless at-a-glance metrics. Order: Time · Position(LLH) · Quality · Ratio
// · Age · Satellites(per-system). All numerics in IBM Plex Mono.

const MONO = "'IBM Plex Mono', monospace";

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
  fontSize: '9.5px',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--mantine-color-dimmed)',
  lineHeight: 1.2,
} as const;

const NUM = {
  fontFamily: MONO,
  fontSize: '24px',
  fontWeight: 500,
  lineHeight: 1,
} as const;

const DASH = '—';

function Cell({ caption, children, minWidth }: { caption: string; children: React.ReactNode; minWidth: number }) {
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth }}>
      <Text component="span" style={CAP}>{caption}</Text>
      {children}
    </Box>
  );
}

export function RtMetricsRow({
  lastPosition,
  satellites,
}: {
  lastPosition: PositionUpdate | null;
  satellites: Satellite[];
}) {
  const q = lastPosition ? QUALITY[lastPosition.quality] : undefined;

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

  return (
    <Box
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 30,
        rowGap: 14,
        padding: '14px 16px 10px',
        alignItems: 'flex-start',
        flexShrink: 0,
      }}
    >
      {/* Time */}
      <Cell caption="Current time · GPST" minWidth={140}>
        <Text component="span" style={{ ...NUM, fontSize: '22px' }}>
          {lastPosition?.timestamp || DASH}
        </Text>
      </Cell>

      {/* Position (LLH) — stacked Lat / Lon / Height */}
      <Cell caption="Position · LLH" minWidth={196}>
        <Stack gap={3} style={{ width: '100%' }}>
          {([
            ['Lat', lastPosition ? lastPosition.lat.toFixed(8) : DASH, ''],
            ['Lon', lastPosition ? lastPosition.lon.toFixed(8) : DASH, ''],
            ['Height', lastPosition ? lastPosition.height.toFixed(3) : DASH, 'm'],
          ] as const).map(([label, value, unit]) => (
            <Group key={label} justify="space-between" wrap="nowrap" gap="sm">
              <Text component="span" c="dimmed" style={{ fontSize: '10.5px' }}>{label}</Text>
              <Text component="span" style={{ fontFamily: MONO, fontSize: '15px', lineHeight: 1.25 }}>
                {value}
                {unit && <Text component="span" c="dimmed" style={{ fontSize: '11px' }}> {unit}</Text>}
              </Text>
            </Group>
          ))}
        </Stack>
      </Cell>

      {/* Quality */}
      <Cell caption="Quality" minWidth={90}>
        <Group gap={7} align="center" wrap="nowrap" style={{ lineHeight: 1 }}>
          <Box
            style={{
              width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: q?.color ?? 'var(--color-single)',
            }}
          />
          <Text component="span" style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1, color: q?.color ?? 'var(--mantine-color-dimmed)' }}>
            {q?.label ?? DASH}
          </Text>
        </Group>
      </Cell>

      {/* Ratio */}
      <Cell caption="Ratio" minWidth={70}>
        <Text component="span" style={{ ...NUM, color: 'var(--mantine-color-blue-text)' }}>
          {lastPosition ? lastPosition.ratio.toFixed(2) : DASH}
        </Text>
      </Cell>

      {/* Age */}
      <Cell caption="Age" minWidth={70}>
        <Text component="span" style={NUM}>
          {lastPosition ? lastPosition.age.toFixed(1) : DASH}
          {lastPosition && <Text component="span" c="dimmed" style={{ fontSize: '14px' }}>s</Text>}
        </Text>
      </Cell>

      {/* Satellites — per-system used/total */}
      <Cell caption="Satellites" minWidth={150}>
        <Group gap={6} align="baseline" wrap="nowrap">
          <Text component="span" style={NUM}>{totalVis ? totalUsed : DASH}</Text>
          {totalVis > 0 && (
            <Text component="span" c="dimmed" style={{ fontFamily: MONO, fontSize: '13px' }}>
              / {totalVis} used
            </Text>
          )}
        </Group>
        {sysList.length > 0 && (
          <Stack gap={3} mt={4}>
            {sysList.map((sys) => {
              const m = SYS_META[sys];
              const { used, total } = counts[sys];
              const pct = total > 0 ? (used / total) * 100 : 0;
              return (
                <Group key={sys} gap={7} wrap="nowrap" align="center">
                  <Text component="span" style={{ fontFamily: MONO, fontSize: '10px', color: m.color, width: 9, flexShrink: 0 }}>
                    {m.letter}
                  </Text>
                  <Box style={{ width: 72, height: 4, borderRadius: 2, background: 'var(--mantine-color-default-border)', flexShrink: 0, position: 'relative' }}>
                    <Box style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: m.color, borderRadius: 2 }} />
                  </Box>
                  <Text component="span" c="dimmed" style={{ fontFamily: MONO, fontSize: '10px' }}>
                    {used}/{total}
                  </Text>
                </Group>
              );
            })}
          </Stack>
        )}
      </Cell>
    </Box>
  );
}
