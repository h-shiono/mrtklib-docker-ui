import { useMemo, useState } from 'react';
import { logSeverity } from '../utils/logSeverity';

/** [ERROR] lines added while the log's tab was not open, for a count on the tab. */
export function useUnseenErrors(lines: string[], active: boolean): number {
  const count = useMemo(() => lines.filter((l) => logSeverity(l) === 'error').length, [lines]);
  const [seen, setSeen] = useState(0);
  // A smaller count is a new run or a trimmed buffer.
  if (active ? seen !== count : count < seen) setSeen(count);
  return active ? 0 : Math.max(0, count - seen);
}
