/**
 * Type roles (DESIGN.md "The Six Sizes Rule"). Sizes are px and these are the
 * only sizes the interface uses.
 */
export const FONT_SIZE = {
  /** Uppercase captions and chart tick labels only; the size floor. */
  caption: 10,
  /** Field labels, tabs, logs, status bar, help text. */
  label: 11,
  /** Input contents and status values. */
  body: 12,
  /** Section headers and panel titles. */
  title: 14,
  /** Coordinates and timestamps. */
  data: 16,
  /** Quality, Ratio, Age and Satellites. */
  metric: 24,
} as const;

/** Every number, path, log line and code value in the DOM. */
export const MONO = 'var(--mantine-font-family-monospace)';

/** The same face for canvas drawing, which cannot read CSS variables. */
export const CANVAS_MONO = '"IBM Plex Mono", monospace';
