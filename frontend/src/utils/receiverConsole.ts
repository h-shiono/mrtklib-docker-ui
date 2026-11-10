/**
 * Receiver console entries (#136) as log lines.
 */

import type { MonitorConsoleEntry } from '../api/streamMonitor';

function time(t: number): string {
  return new Date(t * 1000).toLocaleTimeString('en-GB');
}

/** A reply that says the command failed. */
export const isFailure = (e: MonitorConsoleEntry) => e.label === 'Septentrio error' || e.label === 'UBX ACK-NAK';

/** Console entries as log lines: `>` sent, `<` received; errors tagged. */
export function consoleLines(entries: MonitorConsoleEntry[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    const ts = time(e.t);
    if (e.dir === 'tx') {
      out.push(`${ts} > ${e.text ?? ''}`);
      continue;
    }
    const tag = isFailure(e) ? '[ERROR] ' : '';
    if (e.text !== undefined) {
      const lines = e.text.split(/\r?\n/);
      out.push(`${tag}${ts} < ${lines[0]}`);
      for (const l of lines.slice(1)) out.push(`${' '.repeat(ts.length)}   ${l}`);
    } else {
      out.push(`${tag}${ts} < ${e.label}  ${e.summary ?? ''}`);
    }
  }
  return out;
}

/** A command for the receiver: an ASCII line (answered by any reply), or a
 *  binary frame shown as `shown`, answered by the reply `accept` takes. */
export type ReceiverCommand =
  | { line: string }
  | { hex: string; shown: string; accept: (entry: MonitorConsoleEntry) => boolean };

/** How a command shows in the list of steps. */
export const commandText = (c: ReceiverCommand) => ('line' in c ? c.line : c.shown);
