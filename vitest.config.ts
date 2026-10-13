import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/email-core/**/*.test.ts',
      'tests/pkg-xfer/unit/**/*.test.ts',
      'tests/security/unit/**/*.test.ts',
      'tests/finance/unit/**/*.test.ts',
    ],
    exclude: ['node_modules', '.next'],
    reporters: ['default'],
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
