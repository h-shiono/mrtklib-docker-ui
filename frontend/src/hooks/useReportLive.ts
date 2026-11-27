import { useEffect } from 'react';
import { liveState, type LiveState, type ProcessState } from '../utils/status';

/** Report a screen's live state to the header (#202). The report fires only
 *  when the derived state changes, not on every render. */
export function useReportLive(
  report: ((state: LiveState | null) => void) | undefined,
  states: readonly (ProcessState | null | undefined)[],
) {
  const live = liveState(states);
  useEffect(() => {
    report?.(live);
  }, [report, live]);
}
