/**
 * Septentrio mosaic receivers (#136): presets that make a receiver output what
 * MRTKLIB reads, and the receiver's replies read back into settings.
 *
 * Commands and SBF block names are from the mosaic-X5 / mosaic-CLAS /
 * mosaic-G5 Firmware Reference Guides; the blocks per service from the
 * MRTKLIB quickstart guides (CLAS, MADOCA-PPP, Galileo HAS, BeiDou PPP-B2b,
 * SouthPAN PVS), all of which MRTKLIB's SBF decoder reads.
 */

export type SeptentrioModel = 'mosaic-G5' | 'mosaic-X5' | 'mosaic-CLAS';

export const SEPTENTRIO_MODELS: SeptentrioModel[] = ['mosaic-G5', 'mosaic-X5', 'mosaic-CLAS'];

/** Ephemerides as the receiver decodes them (the GPSNav-style blocks
 *  MRTKLIB reads), and the receiver's own position, which the Monitor shows
 *  and #137 compares against. */
const GPS_GAL_NAV = ['GPSNav', 'GALNav'];
const POSITION = ['PVTGeodetic'];

export type PresetId = 'raw' | 'clas' | 'madoca' | 'has' | 'b2b' | 'southpan';

export interface SeptentrioPreset {
  id: PresetId;
  label: string;
  description: string;
  models: SeptentrioModel[];
}

/** Following the receiver setup of mrtklib-quickstart (configure-receiver.ps1:
 *  signal tracking, all satellites, one SBF stream, SBF allowed out of the
 *  port) and the SBF blocks each MRTKLIB quickstart guide lists. */
export const SEPTENTRIO_PRESETS: SeptentrioPreset[] = [
  {
    id: 'raw',
    label: 'Raw observations (RTK / PPP)',
    description: 'Measurements and the broadcast ephemerides of every constellation.',
    models: ['mosaic-G5', 'mosaic-X5', 'mosaic-CLAS'],
  },
  {
    id: 'clas',
    label: 'CLAS PPP-RTK (QZSS L6D)',
    description: 'Measurements, GPS / Galileo / QZSS ephemerides and the QZSS L6D messages.',
    models: ['mosaic-G5', 'mosaic-CLAS'],
  },
  {
    id: 'madoca',
    label: 'MADOCA-PPP (QZSS L6E)',
    description: 'Measurements, GPS / Galileo / QZSS ephemerides, the L6E messages and the L6D ionosphere (PRN 200/201).',
    models: ['mosaic-G5', 'mosaic-CLAS'],
  },
  {
    id: 'has',
    label: 'Galileo HAS (E6)',
    description: 'Measurements, GPS / Galileo ephemerides and the Galileo E6-B C/NAV pages.',
    models: ['mosaic-G5', 'mosaic-X5'],
  },
  {
    id: 'b2b',
    label: 'BeiDou PPP-B2b',
    description: 'Measurements, the B-CNAV1 ephemeris and the BeiDou B2b messages.',
    models: ['mosaic-G5', 'mosaic-X5'],
  },
  {
    id: 'southpan',
    label: 'SouthPAN PVS (SBAS L5)',
    description: 'Measurements, GPS / Galileo ephemerides and the SBAS L5 messages of PRN 122.',
    models: ['mosaic-G5', 'mosaic-X5'],
  },
];

/** What a preset checks, and the commands that must come first. */
export interface PresetSelection {
  blocks: string[];
  /** Tracking and L6 source commands, sent before the stream. */
  commands: string[];
}

/** `setSignalTracking` adding `signals`, unless they are already tracked: the
 *  command restarts every tracking loop. A leading "+" adds to the current
 *  list (Reference Guide 3.1.4). */
function track(signals: string[], tracking: string | null | undefined): string[] {
  if (tracking) {
    const now = new Set(tracking.split(/[+,\s]+/).map((x) => x.toUpperCase()));
    if (signals.every((sig) => now.has(sig.toUpperCase()))) return [];
  }
  return [`setSignalTracking, +${signals.join('+')}`];
}

/** The blocks a preset checks for `model`, given the tracked signals as last
 *  reported (`SignalTracking`), if read. */
export function presetSelection(id: PresetId, model: SeptentrioModel, tracking?: string | null): PresetSelection {
  const qzsL6 = (source: 'L6D' | 'L6E', g5Blocks: string[]): PresetSelection => {
    const commands = track(['QZSL6'], tracking);
    let l6 = g5Blocks;
    if (model === 'mosaic-CLAS') {
      // One L6 block; the receiver decodes the L6D or the L6E stream.
      commands.push(`setL6CLASSource, auto, ${source}`);
      l6 = ['QZSRawL6'];
    }
    return { blocks: ['MeasEpoch', ...l6, ...GPS_GAL_NAV, 'QZSNav', ...POSITION], commands };
  };
  let sel: PresetSelection;
  switch (id) {
    case 'clas':
      sel = qzsL6('L6D', ['QZSRawL6D']);
      break;
    case 'madoca':
      sel = qzsL6('L6E', ['QZSRawL6E', 'QZSRawL6D']);
      break;
    case 'has':
      sel = { blocks: ['MeasEpoch', 'GALRawCNAV', ...GPS_GAL_NAV, ...POSITION], commands: track(['GALE6BC'], tracking) };
      break;
    case 'b2b':
      // B-CNAV1 comes from B1C.
      sel = { blocks: ['MeasEpoch', 'BDSRawB2b', 'BDSCNav1', ...POSITION], commands: track(['BDSB2b', 'BDSB1C'], tracking) };
      break;
    case 'southpan':
      // Observations on GPS L5 and Galileo E5a, messages on SBAS L5.
      sel = { blocks: ['MeasEpoch', 'GEORawL5', ...GPS_GAL_NAV, ...POSITION], commands: track(['GEOL5', 'GPSL5', 'GALE5a'], tracking) };
      break;
    default:
      sel = { blocks: ['MeasEpoch', 'GPSNav', 'GLONav', 'GALNav', 'BDSNav', 'QZSNav', ...POSITION], commands: [] };
  }
  sel.commands.push('setSatelliteTracking, all');
  return sel;
}

/** Commands that read the settings shown in the Current tab. Get-commands
 *  are sent without arguments, for every stream / port. */
export const READ_COMMANDS = ['getReceiverInterface', 'getSBFOutput', 'getDataInOut', 'getSignalTracking'];

/** Makes the current configuration the boot configuration. */
export const SAVE_COMMAND = 'exeCopyConfigFile, Current, Boot';

export interface SbfOutput {
  stream: string;
  port: string;
  messages: string;
  interval: string;
}

export interface DataInOut {
  port: string;
  input: string;
  output: string;
  show: string;
}

/** Receiver settings as its replies report them. */
export interface SeptentrioSettings {
  rxName: string | null;
  /** Connection descriptor of the last prompt, e.g. USB1: the port this
   *  stream talks to. */
  port: string | null;
  sbfOutputs: SbfOutput[];
  dataInOut: DataInOut[];
  tracking: string | null;
}

export const EMPTY_SETTINGS: SeptentrioSettings = {
  rxName: null, port: null, sbfOutputs: [], dataInOut: [], tracking: null,
};

const PROMPT = /(?:^|\n)([A-Z]{2,4}[0-9]{1,2})>\s*$/;

/** Fold one reply into the settings. Set-commands echo the configuration
 *  after the change, so a preset updates them as well as a read does. */
export function applyReply(settings: SeptentrioSettings, text: string): SeptentrioSettings {
  const next: SeptentrioSettings = {
    ...settings,
    sbfOutputs: [...settings.sbfOutputs],
    dataInOut: [...settings.dataInOut],
  };
  const prompt = PROMPT.exec(text);
  if (prompt) next.port = prompt[1];
  for (const raw of text.split(/\r?\n/).slice(1)) {
    const f = raw.split(',').map((s) => s.trim());
    switch (f[0]) {
      case 'SBFOutput':
        if (f.length >= 5) {
          const row = { stream: f[1], port: f[2], messages: f[3], interval: f[4] };
          next.sbfOutputs = [...next.sbfOutputs.filter((r) => r.stream !== row.stream), row]
            .sort((a, b) => a.stream.localeCompare(b.stream, undefined, { numeric: true }));
        }
        break;
      case 'DataInOut':
        if (f.length >= 4) {
          const row = { port: f[1], input: f[2], output: f[3], show: f[4] ?? '' };
          next.dataInOut = [...next.dataInOut.filter((r) => r.port !== row.port), row]
            .sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));
        }
        break;
      case 'SignalTracking':
        if (f.length >= 2) next.tracking = f.slice(1).join(', ');
        break;
      case 'ReceiverInterface':
        if (f[1] === 'RxName' && f[2]) next.rxName = f[2];
        break;
    }
  }
  return next;
}

/** The model a receiver name points to, if it is one of ours. */
export function modelFromName(name: string | null): SeptentrioModel | null {
  if (!name) return null;
  const n = name.toUpperCase();
  if (n.includes('CLAS')) return 'mosaic-CLAS';
  if (n.includes('G5')) return 'mosaic-G5';
  if (n.includes('X5')) return 'mosaic-X5';
  return null;
}
