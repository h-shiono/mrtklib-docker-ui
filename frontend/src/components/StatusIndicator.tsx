import { Group, Text, Box } from '@mantine/core';
import { processTone, STATUS_COLOR, type ProcessState } from '../utils/status';

export type ProcessStatus = 'idle' | 'running' | 'success' | 'error';

interface StatusIndicatorProps {
  status: ProcessState;
  label: string;
}

const isActive = (status: ProcessState) =>
  status === 'running' || status === 'starting' || status === 'stopping';

export function StatusIndicator({ status, label }: StatusIndicatorProps) {
  const color = STATUS_COLOR[processTone(status)];

  return (
    <Group gap="xs">
      <Box
        w={12}
        h={12}
        style={{
          borderRadius: '50%',
          backgroundColor: color,
          animation: isActive(status) ? 'pulse 1.5s ease-in-out infinite' : 'none',
        }}
      />
      <Text size="sm" fw={500} c={color}>
        {label}
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
