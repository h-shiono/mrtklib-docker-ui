import { describe, expect, it } from 'vitest';
import { lastErrorLine } from './logSeverity';

describe('lastErrorLine', () => {
  it('returns the newest [ERROR] line without its tag', () => {
    expect(lastErrorLine([
      '[ERROR] first',
      '[INFO] between',
      '[ERROR]  input open error: ntrip://caster:2101/M ',
      '[WARN] after',
    ])).toBe('input open error: ntrip://caster:2101/M');
  });
  it('is null without an [ERROR] line, or for an empty one', () => {
    expect(lastErrorLine([])).toBeNull();
    expect(lastErrorLine(['[INFO] ok', '[WARN] slow', 'error: untagged'])).toBeNull();
    expect(lastErrorLine(['[ERROR]   '])).toBeNull();
  });
});
