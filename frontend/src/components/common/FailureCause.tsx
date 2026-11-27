import { Group, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { maskLogLine } from '../../utils/maskPath';
import { STATUS_COLOR } from '../../utils/status';
import { FONT_SIZE, MONO } from '../../utils/typography';

/** Why a start or a run failed, where the state is shown (#202), so it does
 *  not wait in Console. Masked here like LogView: a start error can carry a
 *  `user:pass@` path (L13). Renders nothing when no cause is known. */
export function FailureCause({ cause, icon = true }: {
  cause: string | null;
  /** Off beside an error badge, which carries the icon already. */
  icon?: boolean;
}) {
  if (!cause) return null;
  const text = maskLogLine(cause);
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }} role="alert">
      {icon && <IconAlertTriangle size={14} color={STATUS_COLOR.error} aria-hidden style={{ flexShrink: 0 }} />}
      <Text
        span
        title={text}
        style={{
          fontFamily: MONO,
          fontSize: FONT_SIZE.label,
          color: STATUS_COLOR.error,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
      </Text>
    </Group>
  );
}
