import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // E2E boots the full AppModule against the local database from .env. Vitest sets its own
    // MODE=test in process.env, which would otherwise shadow MODE from .env.
    // NO_COLOR: log colours and highlights depend on a terminal (colorsEnabled); off, so exact log
    // texts do not depend on where the tests run.
    env: { ...loadEnv('', process.cwd(), ''), NO_COLOR: '1' },
    // Every e2e file boots AppModule and synchronizes the same dev database.
    fileParallelism: false,
  },
});
