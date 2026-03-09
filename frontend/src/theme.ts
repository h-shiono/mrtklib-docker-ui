import { createTheme } from '@mantine/core';

// Custom primary color palette (10 shades required)
const primary: readonly [string, string, string, string, string, string, string, string, string, string] = [
  '#e5f4ff',
  '#cde2ff',
  '#9bc2ff',
  '#64a0ff',
  '#3984fe',
  '#1d72fe',
  '#0969ff',
  '#0058e4',
  '#004ecc',
  '#0043b5',
];

export const theme = createTheme({
  // Typography
  fontFamily: '"Inter Variable", Inter, system-ui, -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono Variable", "JetBrains Mono", Consolas, monospace',
  headings: {
    fontFamily: '"Inter Variable", Inter, system-ui, -apple-system, sans-serif',
    fontWeight: '600',
  },

  // Colors
  primaryColor: 'primary',
  colors: {
    primary,
  },

  // Default radius
  defaultRadius: 'md',

  // Component defaults
  components: {
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    Paper: {
      defaultProps: {
        radius: 'md',
        withBorder: true,
      },
    },
    Card: {
      defaultProps: {
        radius: 'md',
        withBorder: true,
      },
    },
    Code: {
      styles: {
        root: {
          fontFamily: 'var(--mantine-font-family-monospace)',
        },
      },
    },
  },
});
