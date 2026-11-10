/**
 * Messages of the CLAS to RTCM3 bridge (#136): what the receiver sends
 * through the pipeline's relay, read by the server as one more client of the
 * bridge. Read only: while the pipeline runs, the receiver port takes RTCM3
 * and ignores commands.
 */

import { useState } from 'react';
import { Box, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { useStreamSessions } from '../hooks/useStreamSessions';
import { StreamMessagePanel } from './StreamMessagePanel';
import { FONT_SIZE } from '../utils/typography';
import { MIN_PANEL_HEIGHT } from '../utils/formLayout';

/** The CLAS pipeline relay's process ID (services/clas_pipeline_service.py). */
const CLAS_RELAY = 'clas-relay';

export function BridgeMessages({ running }: { running: boolean }) {
  const [label, setLabel] = useState<string | null>(null);
  const { sessions, rows } = useStreamSessions(running && label ? { stream: CLAS_RELAY, label } : null, [CLAS_RELAY]);
  const session = sessions[CLAS_RELAY];
  const live = running && !!session?.status && !session.status.exited;
  const { ref, height } = useElementSize();

  return (
    <Box ref={ref} style={{ height: '100%', minHeight: 0 }}>
      {!live ? (
        <Text c="dimmed" p="xs" style={{ fontSize: FONT_SIZE.label }}>
          {running ? 'Connecting to the bridge…' : 'Start the pipeline to see what the receiver sends.'}
        </Text>
      ) : (
        <StreamMessagePanel
          types={session?.messageTypes ?? []}
          rows={rows}
          selected={label}
          onSelect={setLabel}
          now={session?.messageNow ?? 0}
          showAge
          height={Math.max(MIN_PANEL_HEIGHT, height)}
        />
      )}
    </Box>
  );
}
