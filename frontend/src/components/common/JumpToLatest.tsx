import { Button } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';

/** Overlay shown while a following log view is held (scrolled up). Place it
 *  inside a `position: relative` wrapper around the ScrollArea. */
export function JumpToLatest({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="compact-xs"
      variant="filled"
      color="gray"
      leftSection={<IconArrowDown size={12} />}
      onClick={onClick}
      style={{ position: 'absolute', right: 16, bottom: 10, zIndex: 1, opacity: 0.92 }}
    >
      Paused · Jump to latest
    </Button>
  );
}
