/**
 * Fill fields missing from a stored value with their defaults.
 *
 * Configs persisted in localStorage by an older UI version lack fields added
 * since (e.g. bds2Sats in v0.7.17 support), and code that calls methods on
 * them (`.trim()`) crashes the page. Plain objects are merged recursively; any
 * other stored value (string, number, boolean, array, null) replaces the
 * default. Keys only in the stored value are kept.
 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function withDefaults<T>(defaults: T, stored: unknown): T {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) {
    return stored === undefined ? defaults : (stored as T);
  }
  const out: Record<string, unknown> = { ...stored };
  for (const [k, d] of Object.entries(defaults)) {
    out[k] = withDefaults(d, stored[k]);
  }
  return out as T;
}

/**
 * `deserialize` for Mantine `useLocalStorage`: JSON-parse the stored string
 * and fill in missing fields from `defaults`. Unreadable data gives `defaults`.
 */
export function deserializeWithDefaults<T>(defaults: T) {
  return (value: string | undefined): T => {
    if (value === undefined) return defaults;
    try {
      return withDefaults(defaults, JSON.parse(value));
    } catch {
      return defaults;
    }
  };
}
