import type { ReactNode } from 'react';
import { Box, Group, Tabs } from '@mantine/core';
import { STATUS_COLOR } from '../../utils/status';
import { FONT_SIZE } from '../../utils/typography';

/** The workspace's tabs, with a slot at the right for the active tab's controls.
 *  Render inside a Mantine `Tabs`. */
export function WorkspaceTabBar({ tabs, right, px }: {
  /** `alert`: errors the user has not seen, shown on the tab. */
  tabs: { value: string; label: string; alert?: number }[];
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
        {tabs.map(({ value, label, alert }) => (
          <Tabs.Tab
            key={value}
            value={value}
            style={{ fontSize: FONT_SIZE.label, height: 32, padding: '0 12px' }}
            rightSection={alert ? (
              <Group gap={3} wrap="nowrap" title={`${alert} new errors`} style={{ color: STATUS_COLOR.error, fontSize: FONT_SIZE.caption }}>
                <Box style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
                {alert}
              </Group>
            ) : undefined}
          >
            {label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {right && <Group gap={6} wrap="nowrap">{right}</Group>}
    </Group>
  );
}
