import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkApiHealth, useApiHealth } from './useApiHealth';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('checkApiHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is ok only for 200 {"status":"ok"}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ status: 'ok' })));
    expect(await checkApiHealth()).toBe('ok');
  });

  it.each([
    // A dev or reverse proxy answers 502 for a backend that is gone.
    ['a proxy 502', () => Promise.resolve(new Response('Bad Gateway', { status: 502 }))],
    ['a body that is not ok', () => Promise.resolve(json({ status: 'degraded' }))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
    ['a refused connection', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('is lost for %s', async (_name, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    expect(await checkApiHealth()).toBe('lost');
  });

  it('is lost when the request hangs past its deadline', async () => {
    // A dropped SSH tunnel neither answers nor refuses.
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'TimeoutError')));
    })));
    expect(await checkApiHealth(20)).toBe('lost');
  });
});

describe('useApiHealth', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('re-checks, so a backend that goes away reads lost, then ok again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ status: 'ok' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const { result, unmount } = renderHook(() => useApiHealth(5000));
    expect(result.current).toBe('checking');
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toBe('ok');

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current).toBe('lost');

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
