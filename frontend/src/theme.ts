import { createTheme } from '@mantine/core';
import type { MantineColorsTuple, CSSVariablesResolver } from '@mantine/core';
import { QUALITY_TEXT_DARK, QUALITY_TEXT_LIGHT, qualityTextVariables } from './utils/quality';

// ── "A — Carbon / Azure" palette ───────────────────────────────────────────
// Drop-in replacement for frontend/src/theme.ts.
// Dark = near-black neutral graphite; Light = white pair. Accent = azure blue.
// Status colours are the --status-* roles below; quality marks are utils/quality.ts.

// Azure primary ramp. primaryShade picks [4] in dark (#4C8DFF) and [6] in light (#2563EB).
const blue: MantineColorsTuple = [
  '#E8F1FF', '#CFE0FF', '#9DBDFF', '#6A9BFF',
  '#4C8DFF', '#2F7BFF', '#2563EB', '#1D4ED8',
  '#1B46C2', '#173A9E',
];

// Neutral near-black dark ramp (NOT blue-tinted). Index roles preserved from the
// original theme so existing `dark.N` references keep their meaning.
const dark: MantineColorsTuple = [
  '#ECEEF1', // [0] text primary
  '#C7CCD2', // [1] text secondary
  '#9CA3AB', // [2] text muted
  '#2D333B', // [3] border strong
  '#262B32', // [4] border default
  '#1B1F24', // [5] border subtle / input bg
  '#13161A', // [6] Paper / Card bg
  '#0F1217', // [7] body bg
  '#0C0E12', // [8] deeper bg
  '#0A0C0F', // [9] deepest bg
];

export const theme = createTheme({
  fontFamily: "'IBM Plex Sans', sans-serif",
  fontFamilyMonospace: "'IBM Plex Mono', monospace",
  headings: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    fontWeight: '500',
  },
  primaryColor: 'blue',
  primaryShade: { light: 6, dark: 4 },
  // Filled controls choose black or white text by the fill's luminance. 0.18 is
  // where the two give equal contrast; Mantine's 0.3 leaves white on azure 3.2:1.
  autoContrast: true,
  luminanceThreshold: 0.18,
  colors: { blue, dark },
  defaultRadius: 'md',
  components: {
    Button: { defaultProps: { radius: 'md' } },
    Paper: { defaultProps: { radius: 'md', withBorder: true } },
    Card: { defaultProps: { radius: 'md', withBorder: true } },
    Code: { styles: { root: { fontFamily: "'IBM Plex Mono', monospace" } } },
  },
});

// Colour roles are defined per scheme (DESIGN.md). The light theme is the outdoor
// theme: text holds 4.5:1 and field outlines 3:1 on their surfaces.
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: {
    '--mantine-color-body': '#F4F6F8',
    '--mantine-color-default': '#FFFFFF',
    '--mantine-color-default-hover': '#EDF0F3',
    '--mantine-color-dimmed': '#5C6670',
    '--mantine-color-placeholder': '#6B7480',
    // Text of subtle and light gray controls: header navigation, utility icons.
    '--mantine-color-gray-light-color': '#5C6670',
    // Selected rail items and light buttons: blue[6] is 4.2:1 on its own tint.
    '--mantine-color-blue-light-color': '#1D4ED8',
    '--app-surface': '#FFFFFF',
    '--app-card': '#FFFFFF',
    '--app-border': 'rgba(0, 0, 0, 0.08)',
    '--app-input-border': '#8A939E',
    '--app-console-bg': '#F7F8FA',
    '--app-console-fg': '#25292E',
    '--status-off': '#5C6670',
    '--status-starting': '#2563EB',
    '--status-ok': '#15803D',
    '--status-warn': '#B45309',
    '--status-error': '#DC2626',
    ...qualityTextVariables(QUALITY_TEXT_LIGHT),
  },
  dark: {
    '--mantine-color-body': '#0F1217',
    '--mantine-color-default': '#13161A',
    '--mantine-color-default-hover': '#1B1F24',
    // Mantine maps these to dark[3] and dark[6], which this ramp uses as border
    // and surface colours; left alone, placeholders are 1.4:1.
    '--mantine-color-placeholder': '#7A838E',
    '--mantine-color-disabled-color': '#5F6873',
    '--mantine-color-disabled': '#1F242B',
    '--app-surface': '#13161A',
    '--app-card': '#161A1F',
    '--app-border': 'rgba(255, 255, 255, 0.07)',
    '--app-input-border': '#4A525C',
    '--app-console-bg': '#0C0E12',
    '--app-console-fg': '#C7CCD2',
    '--status-off': '#9CA3AB',
    '--status-starting': '#3B82F6',
    '--status-ok': '#22C55E',
    '--status-warn': '#F59E0B',
    '--status-error': '#EF4444',
    ...qualityTextVariables(QUALITY_TEXT_DARK),
  },
});
