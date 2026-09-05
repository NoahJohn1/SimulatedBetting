import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: 'node',
          environment: 'node',
          fileParallelism: false,
          include: ['src/**/__tests__/**/*.test.ts'],
          setupFiles: ['src/test/setup.ts'],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/components/ui/__tests__/**/*.test.tsx'],
        },
      },
    ],
  },
});
