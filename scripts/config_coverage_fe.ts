/**
 * Helper for scripts/gen_config_coverage.py (bundled with esbuild, run by node).
 *
 * Changes each leaf of DEFAULT_MRTK_POST_CONFIG in turn and prints, as JSON,
 * which leaves of configToBackend()'s output change: frontend field ->
 * backend fields.
 */
import { configToBackend } from '../frontend/src/utils/configToBackend';
import { DEFAULT_MRTK_POST_CONFIG } from '../frontend/src/types/mrtkPostConfig';

type Obj = Record<string, unknown>;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

function flat(o: unknown, p = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Obj)) Object.assign(out, flat(v, p ? `${p}.${k}` : k));
  } else {
    out[p] = JSON.stringify(o);
  }
  return out;
}

function alternatives(v: unknown): unknown[] {
  if (typeof v === 'boolean') return [!v];
  if (typeof v === 'number') return [v + 3.25, v === 0 ? 1 : 0];
  if (typeof v === 'string') return [`${v}_x`, 'zz'];
  if (Array.isArray(v)) {
    return v.length && typeof v[0] === 'number' ? [v.map((x) => (x as number) + 1.5)] : [[...v, 'X'], []];
  }
  return [];
}

const base = clone(DEFAULT_MRTK_POST_CONFIG) as unknown as Obj;
const b0 = flat(configToBackend(base as never));
const result: Record<string, string[]> = {};
for (const path of Object.keys(flat(base))) {
  const keys = path.split('.');
  const changed = new Set<string>();
  let original: unknown = base;
  for (const k of keys) original = (original as Obj)[k];
  for (const a of alternatives(original)) {
    const d = clone(base);
    let cur: Obj = d;
    for (const k of keys.slice(0, -1)) cur = cur[k] as Obj;
    cur[keys[keys.length - 1]] = a;
    let b1: Record<string, string>;
    try {
      b1 = flat(configToBackend(d as never));
    } catch {
      continue;
    }
    for (const k of new Set([...Object.keys(b0), ...Object.keys(b1)])) {
      if (b0[k] !== b1[k]) changed.add(k);
    }
  }
  result[path] = [...changed].sort();
}
console.log(JSON.stringify(result));
