import { Group, Text, Box } from '@mantine/core';
import { STATUS_COLOR } from '../utils/status';

export type ProcessStatus = 'idle' | 'running' | 'success' | 'error';

interface StatusIndicatorProps {
  status: ProcessStatus;
  label?: string;
}

const statusConfig: Record<ProcessStatus, { color: string; label: string; pulse: boolean }> = {
  idle: { color: STATUS_COLOR.off, label: 'Idle', pulse: false },
  running: { color: STATUS_COLOR.ok, label: 'Running', pulse: true },
  success: { color: STATUS_COLOR.ok, label: 'Completed', pulse: false },
  error: { color: STATUS_COLOR.error, label: 'Error', pulse: false },
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
          backgroundColor: config.color,
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
