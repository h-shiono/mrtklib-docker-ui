import { useEffect, useState, type ReactNode } from 'react';
import { Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import type { InputStreamState, InputStreamStatus } from '../types/mrtkRunConfig';

// ─── Streaming status (footer of the RT workspace) ───────────────────────────
// Rover / Base / Correction connection state, so a run that keeps going with a
// dead input (e.g. an NTRIP mountpoint that does not exist) is visible at once.

const MONO = "'IBM Plex Mono', monospace";

const LABEL: Record<InputStreamStatus['name'], string> = {
  rover: 'Rover',
  base: 'Base',
  correction: 'Correction',
};

const STATE: Record<InputStreamState, { label: string; color: string }> = {
  receiving:  { label: 'RECEIVING',  color: 'var(--color-fix)' },
  connecting: { label: 'CONNECTING', color: 'var(--color-live)' },
  stalled:    { label: 'STALLED',    color: 'var(--color-float)' },
  nodecode:   { label: 'NO DECODE',  color: 'var(--color-float)' },
  error:      { label: 'ERROR',      color: 'var(--mantine-color-red-6)' },
  off:        { label: 'OFF',        color: 'var(--color-single)' },
};

// Polls run every ~1 s; a slow cycle (telnet timeouts) can take several.
const STALE_MS = 10_000;

const CAP = {
  fontFamily: MONO,
  fontSize: '9.5px',
  letterSpacing: '0.09em',
  textTransform: 'uppercase',
  color: 'var(--mantine-color-dimmed)',
  lineHeight: 1.2,
} as const;

function formatBps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(1)} kbps`;
  return `${bps} bps`;
}

function formatBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

/** Small uppercase caption of a status cell. */
export function StatusCap({ children }: { children: ReactNode }) {
  return <Text component="span" style={CAP}>{children}</Text>;
}

/** Colored dot, state label and an optional rate. */
export function StatusLight({ color, label, labelDimmed = false, rate }: {
  color: string;
  label: string;
  labelDimmed?: boolean;
  rate?: string;
}) {
  return (
    <Group gap={7} align="center" wrap="nowrap" style={{ minWidth: 0 }}>
      <Box style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: color }} />
      <Text component="span" style={{ fontSize: '13px', fontWeight: 700, lineHeight: 1, color: labelDimmed ? 'var(--mantine-color-dimmed)' : color }}>
        {label}
      </Text>
      {rate && (
        <Text component="span" c="dimmed" style={{ fontFamily: MONO, fontSize: '11px', whiteSpace: 'nowrap' }}>
          {rate}
        </Text>
      )}
    </Group>
  );
}

/** "Streaming status" footer of a live workspace (Real-Time, Stream Monitor).
 *  Kept mounted while idle so the panel layout does not jump on Start/Stop. */
export function StatusFooter({ active, faded = false, note, cellGap = 30, children }: {
  /** Show the cells; otherwise "Not running". */
  active: boolean;
  /** The figures are out of date. */
  faded?: boolean;
  /** Warning after the title. */
  note?: string | null;
  /** Space between cells. */
  cellGap?: number;
  children: ReactNode;
}) {
  return (
    <Box
      style={{
        flexShrink: 0,
        minWidth: 0,
        borderTop: '1px solid var(--mantine-color-default-border)',
        padding: '8px 16px 4px',
      }}
    >
      <Text component="span" style={{ ...CAP, display: 'block', marginBottom: 6 }}>
        Streaming status
        {note && (
          <Text component="span" inherit style={{ color: 'var(--color-float)' }}>
            {` · ${note}`}
          </Text>
        )}
      </Text>
      {active ? (
        <Box style={{ display: 'flex', flexWrap: 'wrap', gap: cellGap, rowGap: 10, minWidth: 0, opacity: faded ? 0.45 : 1 }}>
          {children}
        </Box>
      ) : (
        <Text component="span" c="dimmed" style={{ fontFamily: MONO, fontSize: '11px' }}>
          Not running
        </Text>
      )}
    </Box>
  );
}

function StreamCell({ s }: { s: InputStreamStatus }) {
  const st = STATE[s.state] ?? STATE.off;
  const off = s.state === 'off';
  // Error/warning: lead with the cause; otherwise show rtkrcv's message
  // (the connected host/mountpoint).
  const detail = s.hint ?? s.message;

  const tooltip = (
    <Stack gap={2} style={{ fontFamily: MONO, fontSize: 11 }}>
      <span>type: {s.type} · format: {s.format}</span>
      <span>in: {formatBytes(s.in_bytes)} · {formatBps(s.in_bps)}</span>
      {s.decoded !== null && <span>decoded: {s.decoded} · decode errors: {s.errors ?? 0}</span>}
      {s.last_error && <span>last error: {s.last_error}</span>}
      {s.message && <span>message: {s.message}</span>}
    </Stack>
  );

  return (
    <Tooltip label={tooltip} disabled={off} openDelay={300} multiline maw={420} withArrow>
      <Box style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 160px', minWidth: 0 }}>
        <StatusCap>
          {LABEL[s.name]}{!off && ` · ${s.type}`}
        </StatusCap>
        <StatusLight color={st.color} label={st.label} labelDimmed={off} rate={off ? undefined : formatBps(s.in_bps)} />
        {!off && detail && (
          <Text
            component="span"
            c={s.state === 'error' ? 'red.4' : 'dimmed'}
            style={{ fontFamily: MONO, fontSize: '10.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
          >
            {detail}
          </Text>
        )}
      </Box>
    </Tooltip>
  );
}

export function RtInputStatusRow({ streams, updatedAt }: { streams: InputStreamStatus[]; updatedAt: number }) {
  // Re-render every second while running so a stopped update shows as stale
  // (failed polls omit `streams`, which would otherwise freeze the last state).
  const [now, setNow] = useState(() => Date.now());
  const live = streams.length > 0;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  const ageS = Math.max(0, Math.round((now - updatedAt) / 1000));
  const stale = live && now - updatedAt > STALE_MS;

  return (
    <StatusFooter active={live} faded={stale} note={stale ? `no update for ${ageS} s` : null}>
      {streams.map((s) => <StreamCell key={s.name} s={s} />)}
    </StatusFooter>
  );
}
