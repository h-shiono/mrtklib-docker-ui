/**
 * Receiver console (#136), like RxControl's expert console: the commands sent
 * and the receiver's replies as a log, and a line to send any command
 * (Enter sends, ↑ ↓ walk the history).
 */

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ActionIcon, Box, Stack, Text, TextInput } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconSend } from '@tabler/icons-react';
import type { MonitorConsoleEntry } from '../api/streamMonitor';
import { consoleLines } from '../utils/receiverConsole';
import { LogView } from './common/LogView';
import { STATUS_COLOR } from '../utils/status';
import { FONT_SIZE, MONO } from '../utils/typography';

const CONSOLE_HISTORY = 50;

export function ReceiverConsole({ entries, blocked, sendCommand, active }: {
  entries: MonitorConsoleEntry[];
  /** Why commands cannot be sent now, or null. */
  blocked: string | null;
  sendCommand: (command: { line: string }) => Promise<unknown>;
  /** The console is visible: following needs a layout to scroll. */
  active: boolean;
}) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyPos = useRef(-1);
  const { ref, height } = useElementSize();
  const lines = useMemo(() => consoleLines(entries), [entries]);

  const send = () => {
    const line = input.trim();
    if (!line || blocked) return;
    historyRef.current = [line, ...historyRef.current.filter((h) => h !== line)].slice(0, CONSOLE_HISTORY);
    historyPos.current = -1;
    setInput('');
    setError(null);
    sendCommand({ line }).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const h = historyRef.current;
      if (h.length === 0) return;
      e.preventDefault();
      const pos = Math.max(-1, Math.min(h.length - 1, historyPos.current + (e.key === 'ArrowUp' ? 1 : -1)));
      historyPos.current = pos;
      setInput(pos < 0 ? '' : h[pos]);
    }
  };

  return (
    <Stack gap={6} style={{ height: '100%', minHeight: 0 }}>
      <Box ref={ref} style={{ flex: 1, minHeight: 0 }}>
        <LogView
          lines={lines}
          height={Math.max(160, height)}
          active={active}
          severity
          wrapToggle
          emptyText="No commands sent yet."
        />
      </Box>
      {error && <Text c={STATUS_COLOR.error} style={{ fontSize: FONT_SIZE.label, wordBreak: 'break-all' }}>{error}</Text>}
      <TextInput
        aria-label="Command"
        placeholder={blocked ?? 'Command, e.g. getReceiverCapabilities; Enter sends, ↑ ↓ history'}
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        onKeyDown={onKey}
        disabled={!!blocked}
        styles={{ input: { fontFamily: MONO } }}
        rightSection={
          <ActionIcon variant="subtle" onClick={send} disabled={!!blocked || !input.trim()} aria-label="Send command">
            <IconSend size={14} />
          </ActionIcon>
        }
      />
    </Stack>
  );
}
