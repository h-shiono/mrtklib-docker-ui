import type { ReactNode } from 'react';
import { ActionIcon, Box, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { FONT_SIZE } from '../utils/typography';
import { SCREEN_HEIGHT } from '../utils/formLayout';

// ─── Console redesign Phase 3: collapsible 1:1 Config | Workspace frame ───────
// The left Config column collapses to a 50px rail; the right Workspace fills the
// freed space. On narrow screens it stacks vertically (config above workspace)
// and the collapse affordance is hidden. The config slot stays mounted while
// collapsed (display:none) so its internal state is preserved.

interface ConsoleFrameProps {
  configOpen: boolean;
  onToggleConfig: () => void;
  config: ReactNode;
  workspace: ReactNode;
}

/** « collapse control — render this inside the config panel header. */
export function ConfigCollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="sm"
      onClick={onClick}
      title="Collapse configuration"
      aria-label="Collapse configuration"
    >
      <IconChevronLeft size={16} />
    </ActionIcon>
  );
}

function ConfigRail({ onExpand }: { onExpand: () => void }) {
  return (
    <Box
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px 0',
        border: '1px solid var(--app-border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--app-surface)',
      }}
    >
      <ActionIcon
        variant="default"
        size="md"
        onClick={onExpand}
        title="Expand configuration"
        aria-label="Expand configuration"
      >
        <IconChevronRight size={16} />
      </ActionIcon>
      <Box style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: 0 }}>
        <Text
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: FONT_SIZE.label,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--mantine-color-dimmed)',
            whiteSpace: 'nowrap',
          }}
        >
          Configuration
        </Text>
      </Box>
    </Box>
  );
}

export function ConsoleFrame({ configOpen, onToggleConfig, config, workspace }: ConsoleFrameProps) {
  // `?? true` keeps SSR/first-paint desktop-first; the hook resolves on mount.
  const isDesktop = useMediaQuery('(min-width: 48em)') ?? true;

  if (!isDesktop) {
    // Stack vertically on narrow screens; no collapse rail.
    return (
      <Stack gap="md">
        <Box style={{ minWidth: 0 }}>{config}</Box>
        <Box style={{ minWidth: 0 }}>{workspace}</Box>
      </Stack>
    );
  }

  return (
    <Box style={{ display: 'flex', gap: 'var(--mantine-spacing-md)', alignItems: 'stretch', minWidth: 0, height: SCREEN_HEIGHT }}>
      {/* Config column — stays mounted when collapsed so state survives. */}
      <Box
        style={{
          flexGrow: configOpen ? 1 : 0,
          flexShrink: configOpen ? 1 : 0,
          flexBasis: configOpen ? 0 : 50,
          minWidth: 0,
          minHeight: 0,
          alignSelf: 'stretch',
        }}
      >
        <Box style={{ display: configOpen ? undefined : 'none', height: '100%' }}>{config}</Box>
        {!configOpen && <ConfigRail onExpand={onToggleConfig} />}
      </Box>

      {/* Workspace column */}
      <Box style={{ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0 }}>{workspace}</Box>
    </Box>
  );
}
