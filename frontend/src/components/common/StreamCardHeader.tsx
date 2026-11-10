import type { MouseEvent, ReactNode } from 'react';
import { ActionIcon, Badge, Box, Group, Text } from '@mantine/core';
import { IconAlertTriangle, IconPlayerPlay, IconPlayerStop, IconTrash } from '@tabler/icons-react';
import { STATUS_COLOR, type StatusTone } from '../../utils/status';

/** Top row of a stream card in Stream Relay and Stream Monitor: state dot,
 *  name and badge, then start or stop and remove. */
export function StreamCardHeader({
  name, dotColor, tone, status, running, loading, startDisabled, removeDisabled, onStart, onStop, onRemove, actions,
}: {
  name: string;
  dotColor: string;
  tone: StatusTone;
  status: string;
  running: boolean;
  loading: boolean;
  startDisabled?: boolean;
  removeDisabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onRemove: (e: MouseEvent) => void;
  /** More buttons before start / stop, e.g. Configure receiver. */
  actions?: ReactNode;
}) {
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
        <Box style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor, flexShrink: 0 }} />
        <Text size="xs" fw={600} style={{ whiteSpace: 'nowrap' }}>{name}</Text>
        <Badge
          size="xs"
          variant="light"
          color={STATUS_COLOR[tone]}
          leftSection={tone === 'error' ? <IconAlertTriangle size={10} aria-hidden /> : undefined}
        >
          {status}
        </Badge>
      </Group>
      <Group gap={4} wrap="nowrap">
        {actions}
        {running ? (
          <ActionIcon
            variant="light"
            color="red"
            size="xs"
            onClick={onStop}
            loading={loading}
            title={`Stop ${name}`}
            aria-label={`Stop ${name}`}
          >
            <IconPlayerStop size={12} />
          </ActionIcon>
        ) : (
          <ActionIcon
            variant="light"
            color="green"
            size="xs"
            onClick={onStart}
            loading={loading}
            disabled={startDisabled}
            title={`Start ${name}`}
            aria-label={`Start ${name}`}
          >
            <IconPlayerPlay size={12} />
          </ActionIcon>
        )}
        <ActionIcon
          variant="subtle"
          color="red"
          size="xs"
          onClick={onRemove}
          disabled={removeDisabled}
          title="Remove stream"
          aria-label={`Remove ${name}`}
        >
          <IconTrash size={12} />
        </ActionIcon>
      </Group>
    </Group>
  );
}
