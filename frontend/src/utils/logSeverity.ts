export type LogSeverity = 'error' | 'warn';

/** Level of a log line from its leading [ERROR] or [WARN] tag. */
export function logSeverity(line: string): LogSeverity | null {
  const m = /^\s*\[(ERROR|WARN(?:ING)?)\]/i.exec(line);
  if (!m) return null;
  return m[1].toUpperCase() === 'ERROR' ? 'error' : 'warn';
}
