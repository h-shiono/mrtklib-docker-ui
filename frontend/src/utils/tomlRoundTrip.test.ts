/**
 * TOML export → import round trip.
 *
 * Export: configToBackend → backend `generate_conf_file`. Import: backend
 * `/api/config/import` (tomllib) → tomlToConfig. The backend half is stored
 * in tests/fixtures/config_roundtrip/ by tests/test_config_roundtrip_fixtures.py:
 *
 * - `ui-*.input.json`: configToBackend() of the UI configs below (written here,
 *   checked here; `UPDATE_FIXTURES=1 npm test` rewrites them);
 * - `<case>.json`: the backend config, the dict the import returns for its
 *   TOML, and the fields that TOML does not carry (pytest writes these, from
 *   the ui-*.input.json files and from its own all-fields-changed configs).
 *
 * After changing either side, regenerate in this order:
 *   UPDATE_FIXTURES=1 npm test -- tomlRoundTrip
 *   UPDATE_FIXTURES=1 uv run pytest tests/test_config_roundtrip_fixtures.py
 */
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MRTK_POST_CONFIG,
  coerceCorrection,
  type MrtkPostConfig,
  type PositioningMode,
} from '../types/mrtkPostConfig';
import { configToBackend } from './configToBackend';
import { tomlToConfig } from './tomlImport';
import { fixturePath, readFixture } from '../test/fixtures';

const D = DEFAULT_MRTK_POST_CONFIG;

/** Configs the UI can produce, exported through the real backend generator. */
const UI_CONFIGS: Record<string, MrtkPostConfig> = {
  default: D,
  'static-rtk': {
    ...D,
    positioning: {
      ...D.positioning,
      positioningMode: 'static',
      frequency: 'l1+l2+l5',
      filterType: 'combined',
      elevationMask: 10,
      constellations: { ...D.positioning.constellations, glonass: false, sbas: false },
      excludedSatellites: 'G04 J07',
      bds2Sats: 'C01-C18',
      snrMask: {
        enableRover: true,
        enableBase: false,
        mask: [
          [35, 35, 35, 35, 35, 35, 35, 35, 35],
          [30, 30, 30, 30, 30, 30, 30, 30, 30],
          [0, 0, 0, 0, 0, 0, 0, 0, 0],
        ],
      },
      atmosphere: { ionosphere: 'dual-freq', troposphere: 'est-ztd' },
    },
    ambiguityResolution: {
      ...D.ambiguityResolution,
      mode: 'fix-and-hold',
      glonassAr: 'autocal',
      thresholds: { ...D.ambiguityResolution.thresholds, ratio: 2.5, elevationMask: 15 },
    },
    antenna: {
      ...D.antenna,
      base: {
        ...D.antenna.base,
        mode: 'xyz',
        values: [-3961904.9, 3348993.8, 3698211.8],
        antennaTypeEnabled: true,
        antennaType: 'TRM59800.00     NONE',
        antennaDelta: [0, 0, 0.1],
      },
    },
    output: { ...D.output, solutionFormat: 'enu', timeFormat: 'utc', outputSolutionStatus: 'state' },
  },
  'ppp-kinematic-mgex': {
    ...D,
    positioning: {
      ...D.positioning,
      positioningMode: 'ppp-kinematic',
      correction: 'igs',
      frequency: 'l1+l2+l5',
      ephemerisOption: 'precise',
      corrections: {
        ...D.positioning.corrections,
        satelliteAntenna: true,
        receiverAntenna: true,
        phaseWindup: 'on',
        excludeEclipse: true,
        tidalCorrection: 'on',
      },
      atmosphere: { ionosphere: 'est-stec', troposphere: 'est-ztd-grad' },
    },
    ambiguityResolution: { ...D.ambiguityResolution, mode: 'ppp-ar', systems: 0x01 | 0x08 },
    antenna: {
      ...D.antenna,
      rover: { ...D.antenna.rover, antennaTypeEnabled: true, antennaType: 'JAVRINGANT_DM   NONE' },
    },
    files: { ...D.files, satelliteAtx: '/opt/mrtklib/corrections/madoca/igs20.atx' },
  },
  'ppp-rtk-clas': {
    ...D,
    positioning: {
      ...D.positioning,
      positioningMode: 'ppp-rtk',
      correction: 'qzs-clas',
      ephemerisOption: 'broadcast+ssrapc',
      constellations: { ...D.positioning.constellations, glonass: false, beidou: false, sbas: false },
      corrections: {
        ...D.positioning.corrections,
        satelliteAntenna: true,
        receiverAntenna: true,
        phaseWindup: 'on',
        ionoCompensation: 'ssr',
        tidalCorrection: 'solid+otl-clasgrid+pole',
      },
      atmosphere: { ionosphere: 'est-stec', troposphere: 'est-ztd' },
      clas: { ...D.positioning.clas, gridSelectionRadius: 500, l6Merge: 1 },
    },
    adaptiveFilter: { ...D.adaptiveFilter, enabled: true, ionoForgetting: 0.3, ionoGain: 0.5 },
    receiver: { ...D.receiver, isb: true, phaseShift: 'table' },
    files: { ...D.files, cssrGrid: '/opt/mrtklib/corrections/clas/clas_grid.def' },
  },
};

type Dict = Record<string, unknown>;

interface RoundTripCase {
  config: Dict;
  toml: Dict;
  not_written: string[];
}

function leaves(o: unknown, prefix = '', out: Record<string, unknown> = {}) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) leaves(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = o;
  }
  return out;
}

const update = !!process.env.UPDATE_FIXTURES;
const uiDefault = leaves(configToBackend(D));
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

describe('UI configs sent to the backend', () => {
  it.each(Object.keys(UI_CONFIGS))('ui-%s.input.json is current', (name) => {
    const path = fixturePath('config_roundtrip', `ui-${name}.input.json`);
    const want = configToBackend(UI_CONFIGS[name]);
    if (update) writeFileSync(path, json(want));
    expect(existsSync(path), `${path} missing; run UPDATE_FIXTURES=1 npm test`).toBe(true);
    expect(readFixture('config_roundtrip', `ui-${name}.input.json`)).toEqual(want);
  });
});

/**
 * Known differences: the generator writes a placeholder for a value it does
 * not carry, and the import reads the placeholder into the form instead of
 * falling back to the default. Not data the user set, but the form shows it
 * after an import. key -> the value the import gives. An entry that no case
 * hits any more fails the last test, so this list cannot go stale.
 */
const KNOWN_PLACEHOLDERS: Record<string, unknown> = {
  // Antenna type off: written as "*" (use the RINEX header); imported as "*".
  'antenna.rover.antenna_type': '*',
  // single / ppp-kinematic / ppp-static: base position written as the pole
  // sentinel (llh 90, 0, -6335367.6285); imported as the base position.
  'antenna.base.values': [90, 0, -6335367.6285],
};
const placeholdersSeen = new Set<string>();

const caseFiles = readdirSync(fixturePath('config_roundtrip')).filter(
  (f) => f.endsWith('.json') && !f.endsWith('.input.json'),
);

describe('TOML round trip: configToBackend(tomlToConfig(import(export(config))))', () => {
  it('has a case for every UI config', () => {
    for (const name of Object.keys(UI_CONFIGS)) expect(caseFiles).toContain(`ui-${name}.json`);
  });

  it.each(caseFiles)('%s', (file) => {
    const { config, toml, not_written } = readFixture<RoundTripCase>('config_roundtrip', file);
    const back = leaves(configToBackend(tomlToConfig(toml)));
    const want = leaves(config);
    const mode = (config.positioning as Dict).positioning_mode as PositioningMode;

    const lost: string[] = [];
    for (const key of Object.keys(want)) {
      if (JSON.stringify(back[key]) === JSON.stringify(want[key])) continue;
      // Not in the TOML for this mode (or never written): the import can only
      // give the UI default back.
      if (not_written.includes(key) && JSON.stringify(back[key]) === JSON.stringify(uiDefault[key])) continue;
      if (
        not_written.includes(key) &&
        key in KNOWN_PLACEHOLDERS &&
        JSON.stringify(back[key]) === JSON.stringify(KNOWN_PLACEHOLDERS[key])
      ) {
        placeholdersSeen.add(key);
        continue;
      }
      // Import moves a provider the mode does not allow to a valid one, on
      // purpose (types/mrtkPostConfig.ts coerceCorrection). The pytest
      // all-fields-changed configs pair e.g. kinematic with igs.
      if (
        key === 'positioning.correction' &&
        back[key] === coerceCorrection(mode, want[key] as MrtkPostConfig['positioning']['correction']) &&
        back[key] !== want[key]
      ) continue;
      lost.push(`${key}: exported ${JSON.stringify(want[key])}, imported ${JSON.stringify(back[key])}`);
    }
    expect(lost).toEqual([]);

    // configToBackend must not grow keys the backend model does not have.
    expect(Object.keys(back).filter((k) => !(k in want))).toEqual([]);
  });

  it('every known placeholder still shows up', () => {
    expect([...placeholdersSeen].sort()).toEqual(Object.keys(KNOWN_PLACEHOLDERS).sort());
  });
});
