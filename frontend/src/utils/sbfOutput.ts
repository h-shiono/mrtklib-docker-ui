/**
 * SBF output streams as check boxes (#136), like RxControl's SBF Output
 * dialog: the receiver's `SBFOutput, Stream1, USB1, Support+PVTGeodetic, sec1`
 * becomes a set of blocks, and a set of blocks becomes the shortest
 * `setSBFOutput` the receiver reads the same way (whole groups by name).
 */

import { SBF_CATALOG, type SbfModelCatalog } from './sbfCatalog';

/** One SBF output stream: where, how often, and which blocks. */
export interface SbfSelection {
  port: string;
  interval: string;
  blocks: Set<string>;
  /** Names that are neither a block nor a predefined group of this model
   *  (user groups Group1-4, or a newer firmware's block): kept as they are. */
  extra: string[];
}

export const SBF_INTERVALS = [
  'OnChange', 'msec10', 'msec20', 'msec40', 'msec50', 'msec100', 'msec200', 'msec500',
  'sec1', 'sec2', 'sec5', 'sec10', 'sec15', 'sec30', 'sec60',
  'min2', 'min5', 'min10', 'min15', 'min30', 'min60',
];
export const DEFAULT_INTERVAL = 'sec1';

/** Connection descriptors a stream can go to. */
export const SBF_PORTS = [
  'USB1', 'USB2', 'COM1', 'COM2', 'COM3', 'COM4',
  'IP10', 'IP11', 'IP12', 'IP13', 'IP14', 'IP15', 'IP16', 'IP17', 'DSK1',
];

export const SBF_STREAM_NAMES = Array.from({ length: 10 }, (_, i) => `Stream${i + 1}`);

export function catalogFor(model: string): SbfModelCatalog {
  return SBF_CATALOG[model] ?? SBF_CATALOG['mosaic-G5'];
}

/** Every group of the model by lower-case name: composite and predefined. */
function groupIndex(cat: SbfModelCatalog): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const [k, v] of Object.entries({ ...cat.composite, ...cat.groups })) m.set(k.toLowerCase(), v);
  return m;
}

function blockIndex(cat: SbfModelCatalog): Map<string, string> {
  const m = new Map<string, string>();
  const all = [...Object.values(cat.composite), ...Object.values(cat.groups), cat.other].flat();
  for (const b of all) m.set(b.toLowerCase(), b);
  return m;
}

/** "Support+PVTGeodetic" → blocks (groups expanded) and unknown names. */
export function expandMessages(messages: string, cat: SbfModelCatalog): { blocks: Set<string>; extra: string[] } {
  const groups = groupIndex(cat);
  const known = blockIndex(cat);
  const blocks = new Set<string>();
  const extra: string[] = [];
  for (const raw of messages.split('+')) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || key === 'none') continue;
    const group = groups.get(key);
    if (group) group.forEach((b) => blocks.add(b));
    else if (known.has(key)) blocks.add(known.get(key)!);
    else extra.push(name);
  }
  return { blocks, extra };
}

/** Blocks → the receiver's Messages argument: a whole group by its name
 *  (largest first), then the remaining blocks; "none" when empty. */
export function compressBlocks(blocks: Set<string>, extra: string[], cat: SbfModelCatalog): string {
  const left = new Set(blocks);
  const names: string[] = [];
  const candidates = [...Object.entries(cat.composite), ...Object.entries(cat.groups)]
    .filter(([, members]) => members.length > 1)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [name, members] of candidates) {
    if (members.every((b) => left.has(b))) {
      names.push(name);
      members.forEach((b) => left.delete(b));
    }
  }
  const order = [...Object.values(cat.groups), cat.other].flat();
  const rest = [...left].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  const all = [...names, ...rest, ...extra];
  return all.length > 0 ? all.join('+') : 'none';
}

export type CheckState = 'all' | 'some' | 'none';

export function groupState(blocks: Set<string>, members: string[]): CheckState {
  const n = members.filter((b) => blocks.has(b)).length;
  return n === 0 ? 'none' : n === members.length ? 'all' : 'some';
}

export function sameSelection(a: SbfSelection, b: SbfSelection): boolean {
  // Two streams with nothing in them are both off, whatever port they name.
  const empty = (x: SbfSelection) => x.blocks.size === 0 && x.extra.length === 0;
  if (empty(a) && empty(b)) return true;
  if (a.port !== b.port || a.blocks.size !== b.blocks.size) return false;
  // An empty stream is off whatever its interval says.
  if (a.blocks.size > 0 && a.interval !== b.interval) return false;
  if ([...a.blocks].some((x) => !b.blocks.has(x))) return false;
  return a.extra.join('+') === b.extra.join('+');
}

/** The command that makes the receiver's stream equal to `sel`. */
export function streamCommand(stream: string, sel: SbfSelection, cat: SbfModelCatalog): string {
  const messages = compressBlocks(sel.blocks, sel.extra, cat);
  if (messages === 'none') return `setSBFOutput, ${stream}, ${sel.port}, none, off`;
  return `setSBFOutput, ${stream}, ${sel.port}, ${messages}, ${sel.interval}`;
}
