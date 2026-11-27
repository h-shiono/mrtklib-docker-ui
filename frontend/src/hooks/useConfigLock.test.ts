import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConfigLock } from './useConfigLock';

vi.mock('@mantine/notifications', () => ({ notifications: { show: vi.fn() } }));

describe('useConfigLock', () => {
  it('drops a change that lands while locked, applies it once unlocked', () => {
    const { result, rerender } = renderHook(({ locked }) => useConfigLock(locked), { initialProps: { locked: true } });
    // Held from before the lock changed, as a modal's handler would be.
    const unlessLocked = result.current;
    const apply = vi.fn();

    expect(unlessLocked(apply)).toBe(false);
    expect(apply).not.toHaveBeenCalled();

    rerender({ locked: false });
    expect(unlessLocked(apply)).toBe(true);
    expect(apply).toHaveBeenCalledOnce();

    rerender({ locked: true });
    expect(unlessLocked(apply)).toBe(false);
    expect(apply).toHaveBeenCalledOnce();
  });
});
