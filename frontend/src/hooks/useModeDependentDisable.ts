import { useCallback } from 'react';
import { OPTION_META } from '../config/optionMeta';
import type { OptionMetaKey } from '../config/optionMeta';
import type { PositioningMode } from '../types/mrtkPostConfig';

export function useModeDependentDisable(currentMode: PositioningMode) {
  return useCallback(
    (metaKey: OptionMetaKey): boolean => {
      const meta = OPTION_META[metaKey];
      if (!meta?.modes) return false;
      return !meta.modes.includes(currentMode);
    },
    [currentMode],
  );
}
