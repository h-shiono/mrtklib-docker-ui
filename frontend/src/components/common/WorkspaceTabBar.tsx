import type { ReactNode } from 'react';
import { Group, Tabs } from '@mantine/core';
import { FONT_SIZE } from '../../utils/typography';

/** The workspace's tabs, with a slot at the right for the active tab's controls.
 *  Render inside a Mantine `Tabs`. */
export function WorkspaceTabBar({ tabs, right, px }: {
  tabs: { value: string; label: string }[];
  right?: ReactNode;
  px?: string;
}) {
  return (
    <Group
      justify="space-between"
      align="center"
      gap="xs"
      wrap="nowrap"
      px={px}
      style={{ minHeight: 32, flexShrink: 0, borderBottom: '1px solid var(--mantine-color-default-border)' }}
    >
      <Tabs.List style={{ borderBottom: 'none', flexWrap: 'nowrap' }}>
        {tabs.map(({ value, label }) => (
          <Tabs.Tab key={value} value={value} style={{ fontSize: FONT_SIZE.label, height: 32, padding: '0 12px' }}>
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {right && <Group gap={6} wrap="nowrap">{right}</Group>}
    </Group>
  );
}
