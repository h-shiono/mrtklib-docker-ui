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
  error: 'error',
};

export function processTone(state: ProcessState): StatusTone {
  return PROCESS_TONE[state];
}
