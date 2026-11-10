/**
 * The Streams page's workspace (#136): for the selected stream (a running
 * relay), what it carries (Messages), its receiver (Receiver: SBF output,
 * ports and tracking, save), the commands sent and their replies (Console),
 * and the relay's own log (Log).
 *
 * The data comes from the relay's session: the server reads the message tap
 * it added to the relay, and sends commands back through it (-b).
 */

import { useMemo, useState } from 'react';
import { Box, Group, SegmentedControl, Tabs, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { useStreamSessions } from '../hooks/useStreamSessions';
import { LogView } from './common/LogView';
import { WorkspaceTabBar } from './common/WorkspaceTabBar';
import { ReceiverConsole } from './ReceiverConsole';
import { ReceiverPanel, type ReceiverLink } from './ReceiverPanel';
import { StreamMessagePanel } from './StreamMessagePanel';
import { EMPTY_SETTINGS } from '../utils/septentrio';
import { STATUS_COLOR } from '../utils/status';
import { EMPTY_UBLOX } from '../utils/ublox';
import { FONT_SIZE, MONO } from '../utils/typography';
import { MIN_PANEL_HEIGHT } from '../utils/formLayout';

/** What the workspace needs of a stream card. */
export interface WorkspaceStream {
  id: string;
  name: string;
  running: boolean;
  /** The relay's process ID while it runs: the session's key. */
  processId: string | null;
  logLines: string[];
  logCap: number;
}

const PANEL_TOP = 6;

function Empty({ children }: { children: string }) {
  return (
    <Text c="dimmed" p="xs" style={{ fontSize: FONT_SIZE.label }}>{children}</Text>
  );
}

export function StreamWorkspace({ streams, activeId, onSelect }: {
  streams: WorkspaceStream[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState<string | null>('messages');
  // The message type picked per stream (by card id), kept across tabs.
  const [labels, setLabels] = useState<Record<string, string>>({});
  // The last session of each card: after Stop its console stays readable.
  const [lastPid, setLastPid] = useState<Record<string, string>>({});
  const seen = streams.filter((s) => s.processId && lastPid[s.id] !== s.processId);
  if (seen.length > 0) {
    // Derived from props during render (React re-renders before painting).
    setLastPid((prev) => ({ ...prev, ...Object.fromEntries(seen.map((s) => [s.id, s.processId as string])) }));
  }
  const active = streams.find((s) => s.id === activeId) ?? streams[0];
  const pid = active?.running ? active.processId : null;
  const shownPid = active ? active.processId ?? lastPid[active.id] ?? null : null;
  const label = active ? labels[active.id] ?? null : null;
  const subscription = tab === 'messages' && pid && label ? { stream: pid, label } : null;
  const keep = useMemo(
    () => streams.map((s) => s.processId ?? lastPid[s.id]).filter((x): x is string => !!x),
    [streams, lastPid],
  );
  const { sessions, rows, sendCommand } = useStreamSessions(subscription, keep);
  const session = shownPid ? sessions[shownPid] : undefined;
  const status = pid ? session?.status ?? null : null;
  const live = !!pid && !!status && !status.exited;
  const { ref: panelsRef, height: panelsHeight } = useElementSize();
  const panelHeight = Math.max(MIN_PANEL_HEIGHT, panelsHeight - PANEL_TOP);

  // Why this stream cannot take commands now, or null.
  const blocked = !active?.running ? 'Start the stream first'
    : !live ? 'This stream has no message tap (a file read at full speed, or four outputs without a TCP Server)'
    : status?.blocked ?? (!status?.connected ? 'Connecting to the relay…' : null);

  const link = useMemo((): ReceiverLink | null => {
    if (!active) return null;
    return {
      name: active.name,
      storageKey: `mrtk-streams-receiver-${active.id}`,
      blocked,
      note: null,
      session: pid,
      septentrio: session?.septentrio ?? EMPTY_SETTINGS,
      ublox: session?.ublox ?? EMPTY_UBLOX,
      sendCommand: (command, accept) => (pid ? sendCommand(pid, command, accept) : Promise.reject(new Error('Not running'))),
    };
  }, [active, blocked, pid, session?.septentrio, session?.ublox, sendCommand]);

  if (!active) return null;

  const rate = live && status ? `${(status.bytes_per_sec / 1024).toFixed(1)} KiB/s` : null;

  return (
    <Box style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {streams.length > 1 && (
        <Box px="xs" pt="xs">
          <SegmentedControl
            size="xs"
            fullWidth
            value={active.id}
            onChange={onSelect}
            data={streams.map((s) => ({
              value: s.id,
              label: (
                <Group gap={6} wrap="nowrap" justify="center">
                  <Box style={{ width: 6, height: 6, borderRadius: '50%', background: s.running ? STATUS_COLOR.ok : STATUS_COLOR.off }} />
                  <Text size="xs" truncate="end">{s.name}</Text>
                </Group>
              ),
            }))}
          />
        </Box>
      )}
      <Tabs value={tab} onChange={setTab} keepMounted={false} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <WorkspaceTabBar
          px="xs"
          tabs={[
            { value: 'messages', label: 'Messages' },
            { value: 'receiver', label: 'Receiver' },
            { value: 'console', label: 'Console' },
            { value: 'log', label: 'Log' },
          ]}
          right={rate && (
            <Text c="dimmed" style={{ fontFamily: MONO, fontSize: FONT_SIZE.label }}>{rate}</Text>
          )}
        />
        <div ref={panelsRef} style={{ flex: 1, minHeight: 0, padding: '0 8px 8px' }}>
          <Tabs.Panel value="messages" pt={PANEL_TOP} style={{ height: '100%' }}>
            {!active.running ? <Empty>Start the stream to see what it carries.</Empty>
              : !live ? <Empty>{blocked ?? ''}</Empty>
              : (
                <StreamMessagePanel
                  types={session?.messageTypes ?? []}
                  rows={rows}
                  selected={label}
                  onSelect={(l) => setLabels((prev) => ({ ...prev, [active.id]: l }))}
                  now={session?.messageNow ?? 0}
                  showAge
                  height={panelHeight}
                />
              )}
          </Tabs.Panel>
          <Tabs.Panel value="receiver" pt={PANEL_TOP} style={{ height: panelHeight + PANEL_TOP }}>
            {/* One panel per stream and session: edits made for one receiver
                must never be applied to another. */}
            {link && <ReceiverPanel key={`${active.id}:${pid ?? ''}`} link={link} />}
          </Tabs.Panel>
          <Tabs.Panel value="console" pt={PANEL_TOP} style={{ height: panelHeight + PANEL_TOP }}>
            <ReceiverConsole
              entries={session?.consoleEntries ?? []}
              blocked={blocked}
              sendCommand={(command) => (pid ? sendCommand(pid, command) : Promise.reject(new Error('Not running')))}
              active={tab === 'console'}
            />
          </Tabs.Panel>
          <Tabs.Panel value="log" pt={PANEL_TOP} style={{ height: panelHeight + PANEL_TOP }}>
            <LogView
              lines={active.logLines}
              height={panelHeight}
              wrap
              severity
              running={active.running}
              cap={active.logCap}
            />
          </Tabs.Panel>
        </div>
      </Tabs>
    </Box>
  );
}
