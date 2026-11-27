import { describe, expect, it } from 'vitest';
import { maskLogLine, maskPath } from './maskPath';
import { readFixture } from '../test/fixtures';

interface MaskCase {
  group: string;
  line: string;
  expected: string;
}

// Shared with tests/test_mask_credentials.py (backend mask_log_line).
const { cases } = readFixture<{ cases: MaskCase[] }>('mask_cases.json');

describe('maskLogLine (shared cases with the backend)', () => {
  it('has cases', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
  it.each(cases)('$group: $line', ({ line, expected }) => {
    expect(maskLogLine(line)).toBe(expected);
  });
});

describe('maskPath', () => {
  it.each([
    ['user:pass@rtk2go.com:2101/MOUNT', 'user:***@rtk2go.com:2101/MOUNT'],
    ['user:p@ss@caster:2101/M', 'user:***@caster:2101/M'],
    ['user:pa/ss@caster:2101/MOUNT', 'user:***@caster:2101/MOUNT'],
    ['me@example.com:pass@rtk2go.com:2101/M', 'me@example.com:***@rtk2go.com:2101/M'],
    ['user@rtk2go.com:2101/MOUNT', 'user@rtk2go.com:2101/MOUNT'],
    ['/dev/ttyUSB0:115200', '/dev/ttyUSB0:115200'],
    ['ttyACM0:115200:8:n:1', 'ttyACM0:115200:8:n:1'],
    ['192.168.1.10:2101', '192.168.1.10:2101'],
    ['', ''],
  ])('%s', (path, expected) => {
    expect(maskPath(path)).toBe(expected);
  });
});
