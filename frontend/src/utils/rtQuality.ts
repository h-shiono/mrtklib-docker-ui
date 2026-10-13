/** Solution quality (Q) labels and colours for the Real-Time views. */
export const QUALITY: Record<number, { label: string; color: string }> = {
  1: { label: 'FIX',    color: 'var(--color-fix)' },
  2: { label: 'FLOAT',  color: 'var(--color-float)' },
  3: { label: 'SBAS',   color: '#a855f7' },
  4: { label: 'DGPS',   color: '#6b7280' },
  5: { label: 'SINGLE', color: 'var(--color-single)' },
  6: { label: 'PPP',    color: 'var(--color-live)' },
};
