import { useState } from 'react';
import { logSeverity } from '../utils/logSeverity';

/**
 * How many lines `next` added to `prev`. Logs append at the end and trim at
 * the front (`prev.slice(k)` + new lines), so the longest suffix of `prev`
 * that is a prefix of `next` is the overlap. `null` when there is none: a
 * new run, or a log that was replaced.
 */
export function appendedCount(prev: string[], next: string[]): number | null {
  if (prev === next) return 0;
  if (prev.length === 0) return next.length;
  for (let n = Math.min(prev.length, next.length); n > 0; n--) {
    const from = prev.length - n;
    let same = true;
    for (let i = 0; i < n; i++) {
      if (prev[from + i] !== next[i]) { same = false; break; }
    }
    if (same) return next.length - n;
  }
  return null;
}

/**
 * [ERROR] lines that arrived while the log's tab was not open, for a count on
 * the tab. Counts arriving lines, not errors in the buffer: once the buffer
 * rolls, an old error leaving and a new one arriving would cancel out.
 */
export function useUnseenErrors(lines: string[], active: boolean): number {
  const [prev, setPrev] = useState(lines);
  const [unseen, setUnseen] = useState(0);
  if (lines !== prev) {
    const added = appendedCount(prev, lines);
    const fresh = lines.slice(lines.length - (added ?? lines.length));
    const errors = fresh.filter((l) => logSeverity(l) === 'error').length;
    setPrev(lines);
    // No overlap: a new run starts its own count.
    setUnseen(active ? 0 : (added === null ? 0 : unseen) + errors);
  } else if (active && unseen !== 0) {
    setUnseen(0);
  }
  return active ? 0 : unseen;
}
