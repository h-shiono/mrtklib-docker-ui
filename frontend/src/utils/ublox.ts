/**
 * u-blox generation 9 receivers (#136): configuration through key-value
 * items (UBX-CFG-VALSET / UBX-CFG-VALGET), and presets that make a receiver
 * output what MRTKLIB reads (RXM-RAWX + RXM-SFRBX; RXM-QZSSL6 on a D9C).
 *
 * Layouts from the u-blox F9 HPG 1.51 and D9 QZS 1.01 Interface
 * Descriptions: a VALSET or VALGET carries at most 64 items; an item's
 * value size is in bits 28-30 of its key ID.
 */

import type { MonitorConsoleEntry } from '../api/streamMonitor';
import type { ReceiverCommand } from './receiverConsole';
import { UBLOX_CATALOG, type UbloxModel, type UbloxPort } from './ubloxCatalog';

export const UBLOX_MODELS: UbloxModel[] = ['ZED-F9P', 'NEO-D9C'];
export const UBLOX_PORTS: UbloxPort[] = ['USB', 'UART1', 'UART2', 'I2C', 'SPI'];

/** VALSET layers. */
export const LAYER_RAM = 0x01;
export const LAYER_BBR = 0x02;
export const LAYER_FLASH = 0x04;

const MAX_ITEMS = 64;

function checksum(bytes: number[]): [number, number] {
  let a = 0;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) & 0xff;
    b = (b + a) & 0xff;
  }
  return [a, b];
}

const hex = (bytes: number[]) => bytes.map((x) => x.toString(16).padStart(2, '0')).join('');

/** A whole UBX frame as hex: sync, class, id, length, payload, checksum. */
export function ubxFrame(cls: number, id: number, payload: number[] = []): string {
  const body = [cls, id, payload.length & 0xff, payload.length >> 8, ...payload];
  return hex([0xb5, 0x62, ...body, ...checksum(body)]);
}

function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** Bytes of an item's value, from bits 28-30 of its key ID. */
export function valueSize(key: number): number {
  switch ((key >>> 28) & 0x7) {
    case 1: // one bit, stored in a byte
    case 2:
      return 1;
    case 3:
      return 2;
    case 4:
      return 4;
    default:
      return 8;
  }
}

function encode(key: number, value: number): number[] {
  const n = valueSize(key);
  const out: number[] = [];
  let v = value < 0 ? value + 2 ** (8 * n) : value; // two's complement
  for (let i = 0; i < n; i++) {
    out.push(v % 256);
    v = Math.floor(v / 256);
  }
  return out;
}

function chunks<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += MAX_ITEMS) out.push(xs.slice(i, i + MAX_ITEMS));
  return out;
}

/** UBX-CFG-VALSET frames (hex) setting `items` in `layers`. */
export function valset(items: [number, number][], layers = LAYER_RAM): string[] {
  return chunks(items).map((part) => ubxFrame(0x06, 0x8a, [
    0x00, layers, 0x00, 0x00,
    ...part.flatMap(([key, value]) => [...u32(key), ...encode(key, value)]),
  ]));
}

/** UBX-CFG-VALGET polls (hex) of `keys` from the RAM layer. */
export function valget(keys: number[]): string[] {
  return chunks(keys).map((part) => ubxFrame(0x06, 0x8b, [0x00, 0x00, 0x00, 0x00, ...part.flatMap(u32)]));
}

/** The wildcard key of an item's group: every item of the group. */
export const groupWildcard = (key: number) => ((key & 0x0fff0000) | 0xffff) >>> 0;

/** UBX-CFG-VALGET poll (hex) of the RAM layer for one (wildcard) key,
 *  skipping the first `position` items of the answer. */
export function valgetFrom(key: number, position: number): string {
  return ubxFrame(0x06, 0x8b, [0x00, 0x00, position & 0xff, position >> 8, ...u32(key)]);
}

/** UBX-MON-VER poll: names the receiver (MOD=...) and its firmware. */
export const MON_VER_POLL = ubxFrame(0x0a, 0x04);

/** Item values (unsigned, as stored) of a UBX-CFG-VALGET response frame. */
export function parseValget(frameHex: string): Map<number, number> {
  const b = frameHex.match(/../g)?.map((x) => parseInt(x, 16)) ?? [];
  const out = new Map<number, number>();
  const len = (b[4] ?? 0) | ((b[5] ?? 0) << 8);
  const p = b.slice(6, 6 + len);
  let i = 4; // version, layer, position
  while (i + 4 <= p.length) {
    const key = (p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24)) >>> 0;
    const n = valueSize(key);
    if (i + 4 + n > p.length) break;
    let v = 0;
    for (let k = n - 1; k >= 0; k--) v = v * 256 + p[i + 4 + k];
    out.set(key, v);
    i += 4 + n;
  }
  return out;
}

/** An I1 item's value read as signed. */
export const signed8 = (v: number) => (v > 127 ? v - 256 : v);

/** Accepts the reply to a VALSET (its ACK / NAK). */
export const acceptsValset = (e: MonitorConsoleEntry) =>
  (e.label === 'UBX ACK-ACK' || e.label === 'UBX ACK-NAK') && !!e.summary?.includes('CFG-VALSET');

/** Accepts the reply to a VALGET (the values, or a NAK). */
export const acceptsValget = (e: MonitorConsoleEntry) =>
  e.label === 'UBX CFG-VALGET' || (e.label === 'UBX ACK-NAK' && !!e.summary?.includes('CFG-VALGET'));

export const acceptsMonVer = (e: MonitorConsoleEntry) => e.label === 'UBX MON-VER';

/** Every key the Receiver tab reads for `model`. */
export function readKeys(model: UbloxModel): number[] {
  const cat = UBLOX_CATALOG[model];
  return [
    ...cat.messages.flatMap((m) => Object.values(m.keys) as number[]),
    ...Object.values(cat.items).map(([key]) => key),
  ];
}

/** What the Receiver tab reads: MON-VER, then each group of items it shows
 *  with a wildcard VALGET, 64 items a page. A poll naming a key the firmware
 *  does not know is refused whole, so it never names single keys: older
 *  firmware just answers with fewer items. */
export function ubloxReadCommands(model: UbloxModel): ReceiverCommand[] {
  const cat = UBLOX_CATALOG[model];
  const groups = new Map<number, string>();
  for (const m of cat.messages) for (const key of Object.values(m.keys) as number[]) groups.set(groupWildcard(key), 'CFG-MSGOUT');
  for (const [name, [key]] of Object.entries(cat.items)) groups.set(groupWildcard(key), name.replace(/-[^-]+$/, ''));
  const page = (key: number, name: string, position: number): ReceiverCommand => ({
    hex: valgetFrom(key, position),
    shown: `CFG-VALGET ${name}${position ? ` from ${position}` : ''}`,
    accept: acceptsValget,
    // A full page: there may be more.
    next: (reply) => (reply.label === 'UBX CFG-VALGET' && parseValget(reply.data ?? '').size >= MAX_ITEMS
      ? page(key, name, position + MAX_ITEMS) : null),
  });
  return [
    { hex: MON_VER_POLL, shown: 'MON-VER (poll)', accept: acceptsMonVer },
    ...[...groups].map(([key, name]) => page(key, name, 0)),
  ];
}

/** u-blox settings as the receiver reported them: item values by key. */
export interface UbloxSettings {
  values: Map<number, number>;
  /** MON-VER: software, hardware and extension strings. */
  version: string | null;
}

export const EMPTY_UBLOX: UbloxSettings = { values: new Map(), version: null };

/** Fold the receiver's VALGET and MON-VER replies into the settings. */
export function ubloxSettings(entries: MonitorConsoleEntry[]): UbloxSettings {
  const values = new Map<number, number>();
  let version: string | null = null;
  for (const e of entries) {
    if (e.dir !== 'rx' || !e.data) continue;
    if (e.label === 'UBX CFG-VALGET') parseValget(e.data).forEach((v, k) => values.set(k, v));
    else if (e.label === 'UBX MON-VER') version = e.summary ?? null;
  }
  return { values, version };
}

/** The model a MON-VER reply names, if it is one of ours. */
export function ubloxModelFromVersion(version: string | null): UbloxModel | null {
  if (!version) return null;
  // MOD= names the module; FWVER= the firmware line (HPG: F9P, QZS: D9C).
  // Not a bare "QZS": an F9P lists the GNSS it supports, QZSS among them.
  const mod = /MOD=(\S+)/.exec(version)?.[1];
  if (mod) return mod.includes('D9C') ? 'NEO-D9C' : mod.includes('F9P') ? 'ZED-F9P' : null;
  const fw = /FWVER=(\S+)/.exec(version)?.[1];
  if (fw === 'QZS') return 'NEO-D9C';
  if (fw === 'HPG') return 'ZED-F9P';
  return null;
}

export type UbloxPresetId = 'raw' | 'clas' | 'madoca';

export interface UbloxPreset {
  id: UbloxPresetId;
  label: string;
  description: string;
  models: UbloxModel[];
}

export const UBLOX_PRESETS: UbloxPreset[] = [
  {
    id: 'raw',
    label: 'Raw observations (RTK / PPP)',
    description: 'RXM-RAWX and RXM-SFRBX (what MRTKLIB reads), and NAV-PVT, the receiver position.',
    models: ['ZED-F9P'],
  },
  {
    id: 'clas',
    label: 'CLAS PPP-RTK (QZSS L6D)',
    description: 'RXM-QZSSL6, with channel A decoding L6D from the best QZSS satellite.',
    models: ['NEO-D9C'],
  },
  {
    id: 'madoca',
    label: 'MADOCA-PPP (QZSS L6E)',
    description: 'RXM-QZSSL6, with channel A decoding L6E from the best QZSS satellite.',
    models: ['NEO-D9C'],
  },
];

/** What a preset turns on: output rates (message name → 1) on `port`, and
 *  other items (key → value), e.g. UBX output allowed on the port. */
export function ubloxPreset(id: UbloxPresetId, model: UbloxModel, port: UbloxPort): {
  messages: string[];
  items: [number, number][];
} {
  const items = UBLOX_CATALOG[model].items;
  const set: [number, number][] = [];
  const item = (name: string, value: number) => {
    if (items[name]) set.push([items[name][0], value]);
  };
  if (id === 'raw') {
    item(`CFG-${port}OUTPROT-UBX`, 1);
    return { messages: ['UBX_RXM_RAWX', 'UBX_RXM_SFRBX', 'UBX_NAV_PVT'], items: set };
  }
  // D9C: channel A, automatic satellite, L6D (0) or L6E (1).
  item('CFG-QZSS-L6_SVIDA', 0);
  item('CFG-QZSS-L6_MSGA', id === 'clas' ? 0 : 1);
  return { messages: ['UBX_RXM_QZSSL6'], items: set };
}
