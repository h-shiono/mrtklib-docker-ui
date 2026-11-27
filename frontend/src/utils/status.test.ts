import { describe, expect, it } from 'vitest';
import { liveState } from './status';

describe('liveState', () => {
  it.each([
    [[], null],
    [['idle', 'stopped'], null],
    // Ended states are the screen's to report, not live processes.
    [['error', 'failed', 'exited', 'done', 'success'], null],
    [['starting'], 'starting'],
    [['stopping'], 'starting'],
    [['converting'], 'running'],
    // Any running process wins over one still starting.
    [['starting', 'running', 'error'], 'running'],
    [['idle', null, undefined, 'starting'], 'starting'],
  ] as const)('%j → %s', (states, expected) => {
    expect(liveState(states)).toBe(expected);
  });
});
