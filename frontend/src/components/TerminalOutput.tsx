import { useRef, useEffect } from 'react';
import { Box, Code, ScrollArea, Group, ActionIcon, Text } from '@mantine/core';
import { IconTrash, IconCopy } from '@tabler/icons-react';

interface TerminalOutputProps {
  lines: string[];
  maxHeight?: number;
  onClear?: () => void;
}

export function TerminalOutput({ lines, maxHeight = 400, onClear }: TerminalOutputProps) {
  const viewportRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines are added
  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTo({
        top: viewportRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [lines]);

  const handleCopy = () => {
    navigator.clipboard.writeText(lines.join('\n'));
  };

  return (
    <Box
      style={{
        backgroundColor: 'var(--mantine-color-dark-8)',
        borderRadius: 'var(--mantine-radius-sm)',
        overflow: 'hidden',
      }}
    >
      {/* Terminal Header */}
      <Group
        justify="space-between"
        px="sm"
        py="xs"
        style={{
          backgroundColor: 'var(--mantine-color-dark-7)',
          borderBottom: '1px solid var(--mantine-color-dark-6)',
        }}
      >
        <Group gap="xs">
          <Box w={12} h={12} style={{ borderRadius: '50%', backgroundColor: '#ff5f57' }} />
          <Box w={12} h={12} style={{ borderRadius: '50%', backgroundColor: '#febc2e' }} />
          <Box w={12} h={12} style={{ borderRadius: '50%', backgroundColor: '#28c840' }} />
        </Group>
        <Group gap="xs">
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            <IconCopy size={14} />
          </ActionIcon>
          {onClear && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={onClear}
              title="Clear terminal"
            >
              <IconTrash size={14} />
            </ActionIcon>
          )}
        </Group>
      </Group>

      {/* Terminal Content */}
      <ScrollArea h={maxHeight} viewportRef={viewportRef} p="sm">
        {lines.length === 0 ? (
          <Text size="sm" c="dimmed" fs="italic" ff="monospace">
            Waiting for output...
          </Text>
        ) : (
          <Code
            block
            style={{
              backgroundColor: 'transparent',
              color: 'var(--mantine-color-green-4)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              fontSize: '12px',
              lineHeight: 1.6,
            }}
          >
            {lines.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </Code>
        )}
      </ScrollArea>
    </Box>
  );
}
