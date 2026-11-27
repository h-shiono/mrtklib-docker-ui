import type { ReactNode } from 'react';
import { Group, Text } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { FONT_SIZE } from '../../utils/typography';

/** Settings of a running process are read-only (#203): a process reads them
 *  at start, so an edit would show settings it is not using. A disabled
 *  fieldset disables every native control inside, links excepted. */
export function ConfigFieldset({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <fieldset
      disabled={locked}
      className={locked ? 'mrtk-config-locked' : undefined}
      // A fieldset is min-content wide by default and would overflow its column.
      style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
    >
      {children}
    </fieldset>
  );
}

/** The one line that says why a form is read-only, the same on every screen.
 *  It does not claim the form is what runs: a run started from another
 *  browser used that browser's settings. */
export function LockedNotice() {
  return (
    <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
      <IconLock size={13} color="var(--mantine-color-dimmed)" aria-hidden style={{ flexShrink: 0 }} />
      <Text c="dimmed" style={{ fontSize: FONT_SIZE.label }}>
        Locked while running. Stop to edit.
      </Text>
    </Group>
  );
}
