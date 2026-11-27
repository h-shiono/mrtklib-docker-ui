export type LogSeverity = 'error' | 'warn';

/** Level of a log line from its leading [ERROR] or [WARN] tag. */
export function logSeverity(line: string): LogSeverity | null {
  const m = /^\s*\[(ERROR|WARN(?:ING)?)\]/i.exec(line);
  if (!m) return null;
  return m[1].toUpperCase() === 'ERROR' ? 'error' : 'warn';
}

/** The newest [ERROR] line of a log, without its tag; null if there is none. */
export function lastErrorLine(lines: readonly string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*\[ERROR\]\s*(.*)$/i.exec(lines[i]);
    if (m && m[1].trim()) return m[1].trim();
  }
  return null;
}
