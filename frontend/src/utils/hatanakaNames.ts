export type HatanakaDirection = 'compress' | 'decompress';

/**
 * Default output path for rnx2crx / crx2rnx (#81).
 *
 * Swaps the RINEX / Compact RINEX extension (`.24o` <-> `.24d`,
 * `.rnx` <-> `.crx`; anything else becomes `.crx` / `.rnx`), drops an input
 * `.gz` and adds one when `gzip` is set. Inputs under /workspace keep their
 * directory; others (read-only /data) go to /workspace.
 */
export function hatanakaOutputPath(input: string, direction: HatanakaDirection, gzip: boolean): string {
  const path = input.trim();
  if (!path) return '';
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1).replace(/\.gz$/i, '');
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const upper = ext !== '' && ext === ext.toUpperCase() && /[A-Z]/.test(ext);

  let outExt: string;
  if (direction === 'compress') {
    outExt = /^\d\d[oO]$/.test(ext) ? ext.slice(0, 2) + (upper ? 'D' : 'd') : upper ? 'CRX' : 'crx';
  } else {
    outExt = /^\d\d[dD]$/.test(ext) ? ext.slice(0, 2) + (upper ? 'O' : 'o') : upper ? 'RNX' : 'rnx';
  }

  const dir = path.startsWith('/workspace/') ? path.slice(0, slash) : '/workspace';
  return `${dir}/${stem}.${outExt}${gzip ? '.gz' : ''}`;
}
