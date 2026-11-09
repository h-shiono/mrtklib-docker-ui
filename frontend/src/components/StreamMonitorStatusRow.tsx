import type { ReactNode } from 'react';
import { Box, Text } from '@mantine/core';
import type { MonitorState, MonitorStatus } from '../api/streamMonitor';
import { maskLogLine } from '../utils/maskPath';
import { STATUS_COLOR } from '../utils/status';
import { inputLight } from '../utils/streamMonitor';
import { StatusCap, StatusFooter, StatusLight } from './RtInputStatusRow';

// ─── Streaming status of the Stream Monitor ──────────────────────────────────
// Footer of the workspace, in the Real-Time "Streaming status" design.

const MONO = "'IBM Plex Mono', monospace";

const TRUNCATE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } as const;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

function Cell({ cap, title, flex = '1 1 100px', children }: {
  cap: string;
  title?: string;
  flex?: string;
  children: ReactNode;
}) {
  return (
    <Box title={title} style={{ display: 'flex', flexDirection: 'column', gap: 4, flex, minWidth: 0 }}>
      <StatusCap>{cap}</StatusCap>
      {children}
    </Box>
  );
}

function Value({ c, children }: { c?: string; children: ReactNode }) {
  return (
    <Text component="span" c={c} style={{ fontFamily: MONO, fontSize: '12px', lineHeight: 1.2, ...TRUNCATE }}>
      {children}
    </Text>
  );
}

function Detail({ c = 'dimmed', children }: { c?: string; children: ReactNode }) {
  return (
    <Text component="span" c={c} style={{ fontFamily: MONO, fontSize: '10.5px', ...TRUNCATE }}>
      {children}
    </Text>
  );
}

interface StreamMonitorStatusRowProps {
  status: MonitorStatus | null;
  state: MonitorState;
  /** A session is running and the WebSocket delivers its figures. */
  live: boolean;
  wsOpen: boolean;
  /** Decoded CLAS L6 source of the last epoch. */
  l6Source: string | null;
  /** GGA station id of the last epoch, when it is not a decoded L6 source. */
  stationId: string | null;
  /** Latest `mrtk relay` status line (kept out of the console). */
  relayLine: string | null;
}

export function StreamMonitorStatusRow({
  status,
  state,
  live,
  wsOpen,
  l6Source,
  stationId,
  relayLine,
}: StreamMonitorStatusRowProps) {
  const disconnected = !!status && !wsOpen;
  const light = inputLight(status, state, live);
  const input = status?.input ? maskLogLine(status.input) : '—';
  const error = state === 'error' ? status?.error_message ?? null : null;
  const file = status?.file ?? null;
  const messages = Object.entries(status?.msg_counts ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${n}`)
    .join(' · ');
  // Unknown bytes are normal at the start (the stream is joined mid-frame);
  // bad checksums and decode errors are not.
  const framingIssues = status ? status.bad_frames + status.decode_errors : 0;

  return (
    <StatusFooter
      active={state !== 'idle'}
      faded={disconnected}
      note={disconnected ? 'connection to the server lost, reconnecting' : null}
      cellGap={16}
    >
      <Cell cap="Input" title={error ?? input} flex="2 1 170px">
        <StatusLight
          color={light.color}
          label={light.label}
          labelDimmed={light.dimmed}
          rate={live && status && !file ? `${formatBytes(status.bytes_per_sec)}/s` : undefined}
        />
        <Detail c={error ? STATUS_COLOR.error : undefined}>{error ?? input}</Detail>
      </Cell>

      {file ? (
        <Cell cap="Read">
          <Value>
            {`${formatBytes(file.read)} of ${formatBytes(file.size)}`
              + ` (${file.size > 0 ? Math.floor((file.read / file.size) * 100) : 100}%)`}
          </Value>
          <Detail>{file.speed ? `${file.speed}× real time` : 'all at once'}</Detail>
        </Cell>
      ) : (
        <Cell cap="Received" title={status?.raw_log ?? undefined}>
          <Value>{status ? formatBytes(status.bytes_total) : '—'}</Value>
          {status?.raw_log && <Detail>{status.raw_log}</Detail>}
        </Cell>
      )}

      <Cell cap="Decoded from" title={`Position: ${status?.epoch_source ?? '—'}\nSatellites: ${status?.satellite_source ?? '—'}`}>
        <Value>{status?.epoch_source ?? '—'}</Value>
        <Detail>{status?.satellite_source ?? '—'}</Detail>
      </Cell>

      {l6Source && (
        <Cell cap="L6 source">
          <Value>{l6Source}</Value>
        </Cell>
      )}
      {stationId && (
        <Cell cap="Station ID">
          <Value>{stationId}</Value>
        </Cell>
      )}

      <Cell cap="Messages" title={messages || undefined}>
        <Value>{messages || '—'}</Value>
      </Cell>
      <Cell
        cap="Undecoded"
        title={status ? `${status.bad_frames} bad frames · ${status.decode_errors} decode errors` : undefined}
      >
        <Value c={framingIssues > 0 ? STATUS_COLOR.warn : undefined}>
          {status ? `${formatBytes(status.unknown_bytes)} unknown` : '—'}
        </Value>
        {status && (
          <Detail c={framingIssues > 0 ? STATUS_COLOR.warn : undefined}>
            {`${status.bad_frames} bad · ${status.decode_errors} errors`}
          </Detail>
        )}
      </Cell>

      <Text
        c="dimmed"
        truncate="end"
        title={relayLine ? maskLogLine(relayLine) : undefined}
        style={{ flexBasis: '100%', minWidth: 0, fontFamily: MONO, fontSize: '11px', minHeight: 17 }}
      >
        {relayLine ? `relay  ${maskLogLine(relayLine)}` : ''}
      </Text>
    </StatusFooter>
  );
}
