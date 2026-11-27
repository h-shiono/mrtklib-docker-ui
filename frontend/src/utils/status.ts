/**
 * Process and stream state: the one colour map for lifecycle status
 * (DESIGN.md "The Two Layers Rule"). Solution quality is utils/quality.ts.
 * CSS variables, so each colour scheme gets its own readable value.
 */

export type StatusTone = 'off' | 'starting' | 'ok' | 'warn' | 'error';

export const STATUS_COLOR: Record<StatusTone, string> = {
  off: 'var(--status-off)',
  starting: 'var(--status-starting)',
  ok: 'var(--status-ok)',
  warn: 'var(--status-warn)',
  error: 'var(--status-error)',
};

export type ProcessState =
  | 'idle'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'running'
  | 'converting'
  | 'success'
  | 'done'
  | 'failed'
  | 'exited'
  | 'error';

const PROCESS_TONE: Record<ProcessState, StatusTone> = {
  idle: 'off',
  stopped: 'off',
  starting: 'starting',
  stopping: 'starting',
  running: 'ok',
  converting: 'ok',
  success: 'ok',
  done: 'ok',
  failed: 'error',
  exited: 'error',
  error: 'error',
};

export function processTone(state: ProcessState): StatusTone {
  // The state comes from the backend, which may add one this UI does not know.
  return PROCESS_TONE[state] ?? 'off';
}

/** A process that is alive, as the header reports it (#202). */
export type LiveState = 'starting' | 'stopping' | 'running';

const LIVE: Partial<Record<ProcessState, LiveState>> = {
  starting: 'starting',
  stopping: 'stopping',
  running: 'running',
  converting: 'running',
};

/** The live state of a screen from the states of its processes: running if
 *  any runs, else the first on its way up or down, otherwise none. Ended
 *  states (stopped, failed, error) are not live: the screen itself reports
 *  those, and some come from form checks rather than a process. */
export function liveState(states: readonly (ProcessState | null | undefined)[]): LiveState | null {
  let result: LiveState | null = null;
  for (const s of states) {
    const live = s ? LIVE[s] : undefined;
    if (live === 'running') return 'running';
    if (live && !result) result = live;
  }
  return result;
}

export const LIVE_TONE: Record<LiveState, StatusTone> = { starting: 'starting', stopping: 'starting', running: 'ok' };
