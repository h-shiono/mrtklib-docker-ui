import { useEffect, useState } from 'react';

/** `checking` until the first answer; `lost` once a check fails. */
export type ApiHealth = 'checking' | 'ok' | 'lost';

export const HEALTH_INTERVAL_MS = 5000;
/** A dropped SSH tunnel hangs instead of refusing, so a check needs a deadline. */
export const HEALTH_TIMEOUT_MS = 4000;

/** One check. Anything but `200 {"status":"ok"}` is lost: a dev or reverse
 *  proxy answers 502 for a backend that is gone, it does not reject. */
export async function checkApiHealth(timeoutMs = HEALTH_TIMEOUT_MS): Promise<'ok' | 'lost'> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return 'lost';
    const body = await res.json();
    return body?.status === 'ok' ? 'ok' : 'lost';
  } catch {
    return 'lost';
  }
}

/** The backend's reachability, re-checked every few seconds for the page's
 *  lifetime (#202). One check at mount said OK long after the backend or the
 *  tunnel to it had gone. `/api/health` is public, so the token plays no part. */
export function useApiHealth(intervalMs = HEALTH_INTERVAL_MS): ApiHealth {
  const [health, setHealth] = useState<ApiHealth>('checking');
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      const result = await checkApiHealth();
      if (stopped) return;
      setHealth(result);
      // The next check waits for this one, so a slow answer never piles up.
      timer = setTimeout(run, intervalMs);
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs]);
  return health;
}
