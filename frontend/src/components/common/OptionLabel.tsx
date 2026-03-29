import { Text, Tooltip, ActionIcon, Group } from '@mantine/core';
import { IconQuestionMark } from '@tabler/icons-react';
import { OPTION_META, DOCS_BASE } from '../../config/optionMeta';
import type { OptionMeta } from '../../config/optionMeta';

interface OptionLabelProps {
  metaKey: string;
  fallback?: string;
  style?: React.CSSProperties;
}

export function OptionLabel({ metaKey, fallback, style }: OptionLabelProps) {
  const meta: OptionMeta | undefined = OPTION_META[metaKey];
  const label = meta?.label ?? fallback ?? metaKey;
  const hasHelp = !!meta?.description || !!meta?.docsAnchor;

  return (
    <Group gap={2} wrap="nowrap" style={style}>
      <Text size="xs" c="dimmed" style={{ fontSize: '11px' }}>
        {label}
      </Text>
      {hasHelp && (
        <Tooltip
          label={meta?.description ?? 'Open reference docs'}
          multiline
          w={260}
          withArrow
          position="top"
          events={{ hover: true, focus: false, touch: true }}
        >
          <ActionIcon
            size={14}
            variant="subtle"
            color="gray"
            onClick={() => {
              if (meta?.docsAnchor) {
                window.open(DOCS_BASE + meta.docsAnchor, '_blank');
              }
            }}
          >
            <IconQuestionMark size={10} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
