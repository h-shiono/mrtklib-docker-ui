/**
 * API client for the optional access token (MRTK_AUTH_TOKEN, #86).
 *
 * Signing in sets an HttpOnly session cookie. The browser then sends it with
 * every fetch, download link and WebSocket handshake to this origin, so no
 * other API module handles credentials.
 */

const API_BASE = '/api/auth';

export interface AuthStatus {
  /** The server has an access token configured. */
  required: boolean;
  /** This browser may use the API. */
  authenticated: boolean;
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const response = await fetch(`${API_BASE}/status`);
  if (!response.ok) throw new Error(`Auth status failed (${response.status})`);
  return response.json();
}

/** Resolves false when the server refuses the token. */
export async function signIn(token: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error(`Sign in failed (${response.status})`);
  return true;
}

export async function signOut(): Promise<void> {
  const response = await fetch(`${API_BASE}/logout`, { method: 'POST' });
  if (!response.ok) throw new Error(`Sign out failed (${response.status})`);
}

// ── 401 from any API call ────────────────────────────────────────────────────

const listeners = new Set<() => void>();
let installed = false;

/**
 * Report every 401 that a fetch receives (the session ended: the token was
 * changed, or the cookie expired). The app calls fetch from many places, so
 * this wraps `window.fetch` once instead of each call site.
 */
export function installUnauthorizedHook(): void {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await original(...args);
    if (response.status === 401) listeners.forEach((listener) => listener());
    return response;
  };
}

/** Subscribe to 401 responses; returns the unsubscribe function. */
export function onUnauthorized(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
