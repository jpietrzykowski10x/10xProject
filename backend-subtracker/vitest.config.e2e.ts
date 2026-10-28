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
    env: loadEnv('', process.cwd(), ''),
  },
});
