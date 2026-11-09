import type { ReactNode } from 'react';
import { Badge, type BadgeProps } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { STATUS_COLOR, type StatusTone } from '../../utils/status';

/** A lifecycle state: a dot and a word. An error carries an icon instead of the
 *  dot, so it cannot be mistaken for a Single solution. */
export function StatusBadge({ tone, size = 'sm', children }: {
  tone: StatusTone;
  size?: BadgeProps['size'];
  children: ReactNode;
}) {
  if (tone === 'error') {
    return (
      <Badge
        variant="transparent"
        color={STATUS_COLOR.error}
        size={size}
        leftSection={<IconAlertTriangle size={12} aria-hidden />}
        px={0}
      >
        {children}
      </Badge>
    );
  }
  return (
    <Badge variant="dot" color={STATUS_COLOR[tone]} size={size}>
      {children}
    </Badge>
  );
}
