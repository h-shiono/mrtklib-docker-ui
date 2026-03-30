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
 * Same mask applied to a full log line.
 * Masks any occurrence of user:pass@ pattern in the line.
 */
export function maskLogLine(line: string): string {
  return line.replace(
    /([^:@/\s]+):([^@\s]+)@/g,
    (_, user) => `${user}:***@`
  );
}
