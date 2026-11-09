/**
 * Solution quality (Q, MRTKLIB SOLQ_*): the one label and colour table for
 * every view (CLAUDE.md "Color semantics"). Hex values, not CSS variables:
 * the canvas charts (uPlot, 2D plot) and Leaflet need real colours.
 */

export const QUALITY_COLOR: Record<number, string> = {
  1: '#22c55e', // Fix
  2: '#f59e0b', // Float
  3: '#a855f7', // SBAS
  4: '#6b7280', // DGPS
  5: '#ef4444', // Single
  6: '#3b82f6', // PPP
  7: '#06b6d4', // DR (dead reckoning)
};

export const QUALITY_LABEL: Record<number, string> = {
  1: 'Fix',
  2: 'Float',
  3: 'SBAS',
  4: 'DGPS',
  5: 'Single',
  6: 'PPP',
  7: 'DR',
};

/** Any other Q (0 = no solution, or a value from a newer MRTKLIB). */
export const UNKNOWN_QUALITY_COLOR = '#9ca3af';

export function qualityColor(q: number): string {
  return QUALITY_COLOR[q] ?? UNKNOWN_QUALITY_COLOR;
}

/** The marks read as text on dark surfaces, except DGPS, which is too faint. */
export const QUALITY_TEXT_DARK: Record<number, string> = {
  ...QUALITY_COLOR,
  4: '#9ca3ab',
};

/** Darkened for text on light surfaces (at least 4.5:1 on white). */
export const QUALITY_TEXT_LIGHT: Record<number, string> = {
  1: '#15803d',
  2: '#b45309',
  3: '#7e22ce',
  4: '#4b5563',
  5: '#dc2626',
  6: '#2563eb',
  7: '#0e7490',
};

/** CSS variables behind qualityTextColor, set per colour scheme by the theme. */
export function qualityTextVariables(table: Record<number, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(table).map(([q, color]) => [`--quality-text-${q}`, color]));
}

/** Colour for a quality shown as text. DOM only: canvas and Leaflet marks use
 *  qualityColor, which is a real colour rather than a CSS variable. */
export function qualityTextColor(q: number): string {
  return q in QUALITY_COLOR ? `var(--quality-text-${q})` : 'var(--mantine-color-dimmed)';
}

export function qualityLabel(q: number): string {
  return QUALITY_LABEL[q] ?? `Q=${q}`;
}
