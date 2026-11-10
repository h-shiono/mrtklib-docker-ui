import type { ReactNode } from 'react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import type { MonitorState, MonitorStatus } from '../api/streamMonitor';
import { maskLogLine } from '../utils/maskPath';
import { STATUS_COLOR } from '../utils/status';
import { inputLight } from '../utils/streamMonitor';
import { StatusCap, StatusFooter, StatusLight } from './RtInputStatusRow';
import { FONT_SIZE, MONO } from '../utils/typography';

// ─── Streaming status of the Stream Monitor ──────────────────────────────────
// Footer of the workspace, in the Real-Time design: one row, detail in tooltips.


const TRUNCATE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } as const;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

function Cell({ cap, title, flex = '1 1 0', children }: {
  cap: string;
  title?: string;
  flex?: string;
  children: ReactNode;
}) {
  return (
    <Box title={title} style={{ display: 'flex', flexDirection: 'column', gap: 3, flex, minWidth: 0 }}>
      <StatusCap>{cap}</StatusCap>
      {children}
    </Box>
  );
}

function Value({ c, children }: { c?: string; children: ReactNode }) {
  return (
    <Text component="span" c={c} style={{ fontFamily: MONO, fontSize: FONT_SIZE.body, lineHeight: 1.2, ...TRUNCATE }}>
      {children}
    </Text>
  );
}

const L6_TOGGLE_TITLE = 'Read the NMEA GGA station id as the CLAS L6 source (PRN / facility). '
  + 'Only for the NMEA output of a CLAS mrtk run: other receivers put their base station id there.';

/** Pill toggle beside the station id: read it as the CLAS L6 source. Sized to
 *  the value line so the footer keeps its height. */
function L6Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <UnstyledButton
      aria-pressed={on}
      aria-label="Read the station id as the CLAS L6 source"
      title={L6_TOGGLE_TITLE}
      onClick={() => onChange(!on)}
      style={{
        flexShrink: 0,
        fontSize: FONT_SIZE.caption,
        lineHeight: '14px',
        padding: '0 6px',
        borderRadius: 999,
        // On: filled with the theme's contrast text (black on azure in dark,
        // white in light); off: neutral outline.
        border: `1px solid ${on ? 'var(--mantine-color-blue-filled)' : 'var(--app-input-border)'}`,
        color: on ? 'var(--mantine-primary-color-contrast)' : 'var(--mantine-color-dimmed)',
        backgroundColor: on ? 'var(--mantine-color-blue-filled)' : 'transparent',
      }}
    >
      L6
    </UnstyledButton>
  );
}

/** GGA station id of the last epoch, and its CLAS L6 reading. */
export interface MonitorStation {
  /** Four digits, or null when the station id is 0000 / absent. */
  id: string | null;
  /** Decoded L6 source, when `decodeL6` is on and the id follows the encoding. */
  l6: string | null;
}

interface StreamMonitorStatusRowProps {
  status: MonitorStatus | null;
  state: MonitorState;
  /** A session is running and the WebSocket delivers its figures. */
  live: boolean;
  wsOpen: boolean;
  /** Station id cell; null hides it (not live, or no id and decoding off). */
  station: MonitorStation | null;
  /** Read the station id as the CLAS L6 source (#144). */
  decodeL6: boolean;
  onDecodeL6Change: (on: boolean) => void;
  /** Latest `mrtk relay` status line (kept out of the console). */
  relayLine: string | null;
}

export function StreamMonitorStatusRow({
  status,
  state,
  live,
  wsOpen,
  station,
  decodeL6,
  onDecodeL6Change,
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
    >
      <Cell
        cap="Input"
        title={error ?? [input, relayLine && `relay  ${maskLogLine(relayLine)}`].filter(Boolean).join('\n')}
        flex="2 1 0"
      >
        <StatusLight
          color={light.color}
          label={light.label}
          labelDimmed={light.dimmed}
          rate={error ?? (live && status && !file ? `${formatBytes(status.bytes_per_sec)}/s` : undefined)}
          rateColor={error ? STATUS_COLOR.error : undefined}
        />
      </Cell>

      {file ? (
        <Cell cap="Read" title={file.speed ? `${file.speed}× real time` : 'All at once'}>
          <Value>
            {`${formatBytes(file.read)} of ${formatBytes(file.size)}`
              + ` (${file.size > 0 ? Math.floor((file.read / file.size) * 100) : 100}%)`}
          </Value>
        </Cell>
      ) : (
        <Cell cap="Received">
          <Value>{status ? formatBytes(status.bytes_total) : '—'}</Value>
        </Cell>
      )}

      <Cell cap="Decoded from" flex="1.3 1 0" title={`Position: ${status?.epoch_source ?? '—'}\nSatellites: ${status?.satellite_source ?? '—'}`}>
        <Value>{status?.epoch_source ?? '—'}</Value>
      </Cell>

      {station && (
        <Cell
          cap={decodeL6 ? 'L6 source' : 'Station ID'}
          flex={decodeL6 ? '1.8 1 0' : '1 1 0'}
          title={decodeL6 && station.l6 ? `${station.l6} (station id ${station.id})` : undefined}
        >
          <Box style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {decodeL6 && !station.l6 ? (
              // 0000 or an id that is not an L6 source: say so, keep the id
              <Value c="dimmed">{station.id ? `none (${station.id})` : 'none'}</Value>
            ) : (
              <Value>{decodeL6 ? `${station.l6} (${station.id})` : station.id}</Value>
            )}
            <L6Toggle on={decodeL6} onChange={onDecodeL6Change} />
          </Box>
        </Cell>
      )}

      <Cell cap="Messages" title={messages || undefined}>
        <Value>{messages || '—'}</Value>
      </Cell>
      <Cell
        cap="Undecoded"
        title={status ? `${formatBytes(status.unknown_bytes)} unknown · ${status.bad_frames} bad frames · ${status.decode_errors} decode errors` : undefined}
      >
        <Value c={framingIssues > 0 ? STATUS_COLOR.warn : undefined}>
          {status
            ? formatBytes(status.unknown_bytes) + (framingIssues > 0 ? ` · ${framingIssues} bad` : '')
            : '—'}
        </Value>
      </Cell>
    </StatusFooter>
  );
}
