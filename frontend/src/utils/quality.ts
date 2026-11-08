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

export function qualityLabel(q: number): string {
  return QUALITY_LABEL[q] ?? `Q=${q}`;
}
