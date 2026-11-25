import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`.
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Log colours and highlights depend on a terminal (colorsEnabled); off, so exact log texts do
    // not depend on where the tests run.
    env: { NO_COLOR: '1' },
  },
});
