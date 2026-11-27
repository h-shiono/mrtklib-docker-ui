import { useCallback, useLayoutEffect, useRef } from 'react';
import { notifications } from '@mantine/notifications';

/** Guard for settings changes that do not come from the form (#203): a
 *  preset load, an import or the Config Assistant can finish after a run
 *  has started, from a modal opened before it, or from another tab. The
 *  ref is read when the change lands, not when it was asked for. */
export function useConfigLock(locked: boolean) {
  const lockedRef = useRef(locked);
  useLayoutEffect(() => {
    lockedRef.current = locked;
  });
  /** Runs `apply` unless the settings are locked now; says so if they are. */
  return useCallback((apply: () => void) => {
    if (lockedRef.current) {
      notifications.show({ title: 'Settings are locked', message: 'Locked while running. Stop to edit.', color: 'yellow' });
      return false;
    }
    apply();
    return true;
  }, []);
}
