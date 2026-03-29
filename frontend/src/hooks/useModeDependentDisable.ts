import { useCallback } from 'react';
import { OPTION_META } from '../config/optionMeta';

export function useModeDependentDisable(currentMode: string) {
  return useCallback(
    (metaKey: string): boolean => {
      const meta = OPTION_META[metaKey];
      if (!meta?.modes) return false;
      return !meta.modes.includes(currentMode);
    },
    [currentMode],
  );
}
