import { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Code, ScrollArea, Group, ActionIcon, Text, Tabs } from '@mantine/core';
import { IconTrash, IconCopy, IconRefresh, IconTerminal2, IconFileText, IconBug, IconChartDots } from '@tabler/icons-react';
import { FilePreview } from './FilePreview';
import { ResultViewer } from './viewer';
import type { ProcessStatus } from './StatusIndicator';

interface TabbedTerminalOutputProps {
  logLines: string[];
  maxHeight?: number;
  onClearLog?: () => void;
  outputFilePath: string;
  traceEnabled: boolean;
  processStatus: ProcessStatus;
}

export function TabbedTerminalOutput({
  logLines,
  maxHeight = 400,
  onClearLog,
  outputFilePath,
  traceEnabled,
  processStatus,
}: TabbedTerminalOutputProps) {
  const [activeTab, setActiveTab] = useState<string | null>('console');
  const [refreshKey, setRefreshKey] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const prevStatusRef = useRef(processStatus);

  // Auto-scroll console to bottom when new lines arrive
  useEffect(() => {
    if (activeTab === 'console' && viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [logLines, activeTab]);

  // Auto-refresh previews when processing completes
  useEffect(() => {
    if (prevStatusRef.current === 'running' && processStatus === 'success') {
      setRefreshKey((k) => k + 1);
    }
    prevStatusRef.current = processStatus;
  }, [processStatus]);

  const handleCopyLog = useCallback(() => {
    navigator.clipboard.writeText(logLines.join('\n'));
  }, [logLines]);

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const traceFilePath = outputFilePath ? `${outputFilePath}.trace` : null;

  // Content height = maxHeight minus header row (~36px)
  const contentHeight = maxHeight - 36;

  return (
    <Box
      style={{
        backgroundColor: 'light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))',
        borderRadius: 'var(--mantine-radius-sm)',
        overflow: 'hidden',
      }}
    >
      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        keepMounted={false}
      >
        {/* Single header row: tabs on left, action buttons on right */}
        <Group
          justify="space-between"
          wrap="nowrap"
          px="sm"
          style={{
            backgroundColor: 'light-dark(var(--mantine-color-gray-1), var(--mantine-color-dark-7))',
            borderBottom: 'light-dark(1px solid var(--mantine-color-gray-3), 1px solid var(--mantine-color-dark-6))',
          }}
        >
          <Tabs.List
            style={{
              borderBottom: 'none',
              flexWrap: 'nowrap',
            }}
          >
            <Tabs.Tab
              value="console"
              leftSection={<IconTerminal2 size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Console
            </Tabs.Tab>
            <Tabs.Tab
              value="result"
              leftSection={<IconFileText size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Result
            </Tabs.Tab>
            <Tabs.Tab
              value="trace"
              leftSection={<IconBug size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Trace
            </Tabs.Tab>
            <Tabs.Tab
              value="viewer"
              leftSection={<IconChartDots size={13} />}
              style={{ fontSize: '11px', padding: '6px 10px' }}
            >
              Map/Chart
            </Tabs.Tab>
          </Tabs.List>

          <Group gap="xs" wrap="nowrap">
            {activeTab === 'console' ? (
              <>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="sm"
                  onClick={handleCopyLog}
                  title="Copy to clipboard"
                >
                  <IconCopy size={14} />
                </ActionIcon>
                {onClearLog && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    onClick={onClearLog}
                    title="Clear terminal"
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                )}
              </>
            ) : (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleRefresh}
                title="Refresh"
              >
                <IconRefresh size={14} />
              </ActionIcon>
            )}
          </Group>
        </Group>

        <Tabs.Panel value="console">
          <ScrollArea h={contentHeight} viewportRef={viewportRef} p="sm">
            {logLines.length === 0 ? (
              <Text size="sm" c="dimmed" fs="italic" ff="monospace">
                Waiting for output...
              </Text>
            ) : (
              <Code
                block
                style={{
                  backgroundColor: 'transparent',
                  color: 'light-dark(var(--mantine-color-dark-8), var(--mantine-color-green-4))',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  fontSize: '12px',
                  lineHeight: 1.6,
                }}
              >
                {logLines.map((line, index) => (
                  <div key={index}>{line}</div>
                ))}
              </Code>
            )}
          </ScrollArea>
        </Tabs.Panel>

        <Tabs.Panel value="result">
          <FilePreview
            filePath={outputFilePath}
            maxHeight={contentHeight}
            refreshKey={refreshKey}
          />
        </Tabs.Panel>

        <Tabs.Panel value="trace">
          <FilePreview
            filePath={traceFilePath}
            maxHeight={contentHeight}
            refreshKey={refreshKey}
            disabledMessage={
              !traceEnabled
                ? 'Trace output is disabled. Set Debug Trace level > 0 in the Output tab.'
                : undefined
            }
          />
        </Tabs.Panel>

        <Tabs.Panel value="viewer">
          <ResultViewer
            filePath={outputFilePath}
            maxHeight={contentHeight}
            refreshKey={refreshKey}
          />
        </Tabs.Panel>
      </Tabs>
    </Box>
  );
}
