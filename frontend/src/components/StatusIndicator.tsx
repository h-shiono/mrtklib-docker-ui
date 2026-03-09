import { Group, Text, Box } from '@mantine/core';

export type ProcessStatus = 'idle' | 'running' | 'success' | 'error';

interface StatusIndicatorProps {
  status: ProcessStatus;
  label?: string;
}

const statusConfig: Record<ProcessStatus, { color: string; label: string; pulse: boolean }> = {
  idle: { color: 'gray', label: 'Idle', pulse: false },
  running: { color: 'blue', label: 'Running', pulse: true },
  success: { color: 'green', label: 'Completed', pulse: false },
  error: { color: 'red', label: 'Error', pulse: false },
};

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
  const config = statusConfig[status];
  const displayLabel = label || config.label;

  return (
    <Group gap="xs">
      <Box
        w={12}
        h={12}
        style={{
          borderRadius: '50%',
          backgroundColor: `var(--mantine-color-${config.color}-6)`,
          boxShadow: config.pulse
            ? `0 0 8px var(--mantine-color-${config.color}-4)`
            : 'none',
          animation: config.pulse ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      <Text size="sm" fw={500} c={config.color}>
        {displayLabel}
      </Text>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}
      </style>
    </Group>
  );
}
