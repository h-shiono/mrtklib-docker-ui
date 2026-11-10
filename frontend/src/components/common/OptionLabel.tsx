import type { CSSProperties } from 'react';
import { Text, Tooltip, ActionIcon, Group } from '@mantine/core';
import { IconQuestionMark } from '@tabler/icons-react';
import { OPTION_META, DOCS_BASE } from '../../config/optionMeta';
import type { OptionMetaKey, OptionMeta } from '../../config/optionMeta';
import { FONT_SIZE } from '../../utils/typography';

/**
 * ActionIcon element props for the `?` help icon: a real external link when a
 * docs URL exists, otherwise a plain button. Avoids rendering an `<a>` with an
 * undefined href (a focusable link with no destination that confuses AT).
 */
function helpIconProps(href: string | undefined) {
  return href
    ? ({ component: 'a', href, target: '_blank', rel: 'noopener noreferrer' } as const)
    : ({ component: 'button', type: 'button' } as const);
}

interface OptionLabelProps {
  metaKey: OptionMetaKey;
  fallback?: string;
  style?: CSSProperties;
}

/**
 * Label for a combined row that holds several sub-fields. Shows the group
 * `label` plus a single `?` whose tooltip lists each sub-field's description
 * (so the per-input labels can be dropped). The `?` links to the first
 * available docs anchor. Renders no `?` when none of the fields have help.
 */
export function ComboLabel({
  label,
  fields,
  style,
}: {
  label: string;
  fields: { name: string; metaKey?: OptionMetaKey }[];
  style?: CSSProperties;
}) {
  const described = fields.filter((f) => f.metaKey && OPTION_META[f.metaKey]?.description);
  const anchor = fields.map((f) => (f.metaKey ? OPTION_META[f.metaKey]?.docsAnchor : undefined)).find(Boolean);
  const hasHelp = described.length > 0 || !!anchor;
  return (
    <Group gap={2} wrap="nowrap" style={style}>
      <Text
        size="xs"
        c="dimmed"
        title={label}
        style={{ fontSize: FONT_SIZE.label, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
      >
        {label}
      </Text>
      {hasHelp && (
        <Tooltip
          label={
            described.length > 0
              ? described.map((f) => `${f.name}: ${OPTION_META[f.metaKey!]!.description}`).join('\n')
              : 'Open reference docs'
          }
          multiline
          w={300}
          withArrow
          position="top"
          events={{ hover: true, focus: true, touch: true }}
          styles={{ tooltip: { whiteSpace: 'pre-line' } }}
        >
          <ActionIcon
            {...helpIconProps(anchor ? DOCS_BASE + anchor : undefined)}
            size={14}
            variant="subtle"
            color="gray"
            aria-label={`Help for ${label}`}
            style={{ flexShrink: 0 }}
          >
            <IconQuestionMark size={10} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}

/**
 * Just the `?` help icon + tooltip for a metaKey, for compact/combined rows
 * where the full OptionLabel does not fit. Renders nothing unless the option
 * has a description, so it can be dropped after every input safely.
 */
export function MetaHelp({ metaKey }: { metaKey: OptionMetaKey }) {
  const meta: OptionMeta | undefined = OPTION_META[metaKey];
  if (!meta?.description) return null;
  return (
    <Tooltip
      label={meta.description}
      multiline
      w={260}
      withArrow
      position="top"
      events={{ hover: true, focus: true, touch: true }}
    >
      <ActionIcon
        {...helpIconProps(meta.docsAnchor ? DOCS_BASE + meta.docsAnchor : undefined)}
        size={14}
        variant="subtle"
        color="gray"
        aria-label={`Open help for ${meta.label ?? metaKey}`}
        style={{ flexShrink: 0 }}
      >
        <IconQuestionMark size={10} />
      </ActionIcon>
    </Tooltip>
  );
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
          fontSize: FONT_SIZE.label,
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
            {...helpIconProps(meta?.docsAnchor ? DOCS_BASE + meta.docsAnchor : undefined)}
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
