/**
 * Masks the password portion of a stream path string.
 * Handles NTRIP format: [user[:passwd]@]addr[:port][/mntpnt]
 * Passwords containing '@' are not supported (not used in NTRIP).
 *
 * Examples:
 *   "user:pass@rtk2go.com:2101/MOUNT" → "user:***@rtk2go.com:2101/MOUNT"
 *   "user@rtk2go.com:2101/MOUNT"      → "user@rtk2go.com:2101/MOUNT" (no pass)
 *   "/dev/ttyUSB0:115200"             → "/dev/ttyUSB0:115200" (no change)
 *   ""                                → ""
 */
export function maskPath(path: string): string {
  if (!path) return path;
  return path.replace(
    /^([^:@/]+):([^@]+)@/,
    (_, user) => `${user}:***@`
  );
}

/**
 * Mask credentials in a full log line. Mirrors the backend's
 * services/mask_credentials.py (the backend masks before broadcasting; this
 * is a second line of defence for lines composed in the browser):
 * user:pass@ (password up to the last '@'), secret query parameters,
 * secret-looking assignments, and Authorization Bearer/Basic values.
 */
export function maskLogLine(line: string): string {
  return line
    .replace(/([^:@/\s]+):([^/\s]*)@/g, (_, user) => `${user}:***@`)
    .replace(
      /([?&](?:password|passwd|pass|pwd|token|access_token|api_key|apikey|key|secret)=)[^&\s]+/gi,
      (_, key) => `${key}***`,
    )
    .replace(
      /(\b\w*(?:password|passwd|token|api_key|apikey|secret)\w*\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,&]+)/gi,
      (_, key, value: string) => {
        const q = value[0] === '"' || value[0] === "'" ? value[0] : '';
        return `${key}${q}***${q}`;
      },
    )
    .replace(/(\b(?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]+/gi, (_, p) => `${p}***`);
}
