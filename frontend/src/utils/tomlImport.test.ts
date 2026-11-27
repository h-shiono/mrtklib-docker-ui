/**
 * Keys no form field reads are kept in extraToml (#230). The full trip through
 * the backend generator is in tomlRoundTrip.test.ts (case extra-keys).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MRTK_POST_CONFIG, type MrtkPostConfig } from '../types/mrtkPostConfig';
import { configToBackend } from './configToBackend';
import { extrasPreviewLines } from './tomlExtrasPreview';
import { isFormShapedPreset, tomlToConfig, unownedExtras } from './tomlImport';

describe('tomlToConfig extraToml', () => {
  it('keeps keys the form does not read, in their tables', () => {
    const cfg = tomlToConfig({
      positioning: { mode: 'static', future_key: 1, future: { name: 'x' } },
      future_table: { list: [1, 2], on: true },
    });
    expect(cfg.positioning.positioningMode).toBe('static');
    expect(cfg.extraToml).toEqual({
      positioning: { future_key: 1, future: { name: 'x' } },
      future_table: { list: [1, 2], on: true },
    });
  });

  it('is always set, so an import replaces the previous extras', () => {
    expect(tomlToConfig({ positioning: { mode: 'static' } }).extraToml).toEqual({});
  });

  it('does not keep keys the form owns but the mode does not write', () => {
    // signals and frequency are both read; an empty fcb is read too. Keeping
    // them would bring them back after the user switched or cleared them.
    const cfg = tomlToConfig({
      positioning: { signals: ['G1C', 'G2W'], frequency: 'l1+2', satellite_ephemeris: 'precise', ephemeris_option: 'brdc' },
      files: { fcb: '' },
      antenna: { base: { position_type: 'llh', position_1: 90, position_2: 0, position_3: -6335367.6285 } },
    });
    expect(cfg.extraToml).toEqual({});
    expect(cfg.positioning.ephemerisOption).toBe('precise');
  });

  it('does not keep legacy keys the import reads as a fallback', () => {
    // v0.6.5 locations, read when the v0.7.6 key is missing.
    const cfg = tomlToConfig({
      positioning: { madoca: { iono_correction: true }, ppp: { max_bias_dt: 5 } },
      receiver: { iono_correction: false, max_bias_dt: 10, ppp_sat_clock_bias: 1 },
      adaptive_filter: { enabled: true },
      server: { time_interpolation: true, sbas_satellite: 129 },
    });
    expect(cfg.extraToml).toEqual({});
    expect(cfg.receiver.ionoCorrection).toBe(true);
    expect(cfg.receiver.maxBiasDt).toBe(5);
  });

  it('never keeps [streams]', () => {
    const cfg = tomlToConfig({
      streams: { input: { rover: { type: 'ntripcli', path: 'user:pass@host:2101/MNT' } } },
    });
    expect(cfg.extraToml).toEqual({});
  });

  it('reaches the backend config', () => {
    const cfg = tomlToConfig({ future_table: { k: 'v' } });
    expect(configToBackend(cfg).extra_toml).toEqual({ future_table: { k: 'v' } });
    expect(configToBackend(DEFAULT_MRTK_POST_CONFIG).extra_toml).toEqual({});
  });
});

describe('pre-#230 presets (form state)', () => {
  it('reads a preset saved as form state before #230', () => {
    // What the old Save wrote: the camelCase form state, as TOML.
    const saved: MrtkPostConfig = {
      ...DEFAULT_MRTK_POST_CONFIG,
      positioning: { ...DEFAULT_MRTK_POST_CONFIG.positioning, positioningMode: 'static', elevationMask: 12 },
    };
    const dict = JSON.parse(JSON.stringify(saved)) as Record<string, unknown>;
    delete (dict.files as Record<string, unknown>).trace; // a field added later
    expect(isFormShapedPreset(dict)).toBe(true);
    const cfg = tomlToConfig(dict);
    expect(cfg.positioning.positioningMode).toBe('static');
    expect(cfg.positioning.elevationMask).toBe(12);
    expect(cfg.files.trace).toBe(DEFAULT_MRTK_POST_CONFIG.files.trace);
    expect(cfg.extraToml).toEqual({});
  });

  it('tells an MRTKLIB TOML apart', () => {
    const dict = { positioning: { mode: 'static', future_key: 1 } };
    expect(isFormShapedPreset(dict)).toBe(false);
    const cfg = tomlToConfig(dict);
    expect(cfg.positioning.positioningMode).toBe('static');
    expect(cfg.extraToml).toEqual({ positioning: { future_key: 1 } });
  });
});

describe('unownedExtras', () => {
  it('drops kept keys the form reads now', () => {
    // Stored by an older UI that had no field for elevation_mask.
    expect(unownedExtras({ positioning: { elevation_mask: 10, future_key: 1 }, streams: { x: 1 } })).toEqual({
      positioning: { future_key: 1 },
    });
    expect(unownedExtras(undefined)).toEqual({});
  });

  it('is applied by configToBackend', () => {
    const cfg = { ...DEFAULT_MRTK_POST_CONFIG, extraToml: { files: { fcb: '/workspace/x.fcb', future: 'y' } } };
    expect(configToBackend(cfg).extra_toml).toEqual({ files: { future: 'y' } });
  });
});

describe('extrasPreviewLines', () => {
  it('lists the kept keys as TOML tables', () => {
    expect(extrasPreviewLines({ positioning: { future_key: 1, sub: { s: 'a"b' } }, t: { l: [1, { a: 2 }] } })).toEqual([
      '# Kept from the imported TOML (no form field); merged into the tables above on export',
      '',
      '[positioning]',
      'future_key = 1',
      '',
      '[positioning.sub]',
      's = "a\\"b"',
      '',
      '[t]',
      'l = [1, {a = 2}]',
      '',
    ]);
    expect(extrasPreviewLines({})).toEqual([]);
  });
});
