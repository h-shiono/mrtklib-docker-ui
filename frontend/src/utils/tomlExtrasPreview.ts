/**
 * The kept imported keys (`extraToml`, #230) as TOML lines for the TOML
 * Preview. The backend merges them into the generated tables
 * (services/toml_extras.py); the preview lists them in a block of their own,
 * with credentials masked.
 */
import { maskLogLine } from './maskPath';

type AnyDict = Record<string, unknown>;

function isPlainObject(v: unknown): v is AnyDict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const key = (k: string) => (/^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k));

function value(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(value).join(', ')}]`;
  if (isPlainObject(v)) return `{${Object.entries(v).map(([k, x]) => `${key(k)} = ${value(x)}`).join(', ')}}`;
  // A JSON string, number or boolean is valid TOML.
  return JSON.stringify(v);
}

export function extrasPreviewLines(extra: AnyDict | undefined): string[] {
  const L: string[] = [];
  const table = (d: AnyDict, path: string[]) => {
    const scalars = Object.entries(d).filter(([, v]) => !isPlainObject(v));
    if (path.length > 0 && scalars.length > 0) L.push(`[${path.map(key).join('.')}]`);
    for (const [k, v] of scalars) L.push(`${key(k)} = ${value(v)}`);
    if (path.length > 0 && scalars.length > 0) L.push('');
    for (const [k, v] of Object.entries(d)) if (isPlainObject(v)) table(v, [...path, k]);
  };
  if (extra) table(extra, []);
  if (L.length === 0) return [];
  // Masked for display (passwd = ..., user:pass@); export keeps the values.
  return ['# Kept from the imported TOML (no form field); merged into the tables above on export', '', ...L.map(maskLogLine)];
}
