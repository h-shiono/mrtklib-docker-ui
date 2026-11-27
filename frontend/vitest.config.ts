import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Component and unit tests (`npm test`). Test files sit next to the code
// as *.test.ts(x); src/test/ holds the setup and the render helper.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // Mantine's CSS is not needed to test behaviour.
      css: false,
    },
  }),
)
