import type { CSSProperties } from 'react';
import { Text, Tooltip, ActionIcon, Group } from '@mantine/core';
import { IconQuestionMark } from '@tabler/icons-react';
import { OPTION_META, DOCS_BASE } from '../../config/optionMeta';
import type { OptionMetaKey, OptionMeta } from '../../config/optionMeta';

interface OptionLabelProps {
  metaKey: OptionMetaKey;
  fallback?: string;
  style?: CSSProperties;
}

export function OptionLabel({ metaKey, fallback, style }: OptionLabelProps) {
  const meta: OptionMeta | undefined = OPTION_META[metaKey];
  const label = meta?.label ?? fallback ?? metaKey;
  const hasHelp = !!meta?.description || !!meta?.docsAnchor;

  return (
    <Group gap={2} wrap="nowrap" style={style}>
      <Text
        size="xs"
        c="dimmed"
        title={label}
        style={{
          fontSize: '11px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        {label}
      </Text>
      {hasHelp && (
        <Tooltip
          label={meta?.description ?? 'Open reference docs'}
          multiline
          w={260}
          withArrow
          position="top"
          events={{ hover: true, focus: true, touch: true }}
        >
          <ActionIcon
            component="a"
            href={meta?.docsAnchor ? DOCS_BASE + meta.docsAnchor : undefined}
            target="_blank"
            rel="noopener noreferrer"
            size={14}
            variant="subtle"
            color="gray"
            aria-label={`Open help for ${label}`}
          >
            <IconQuestionMark size={10} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
