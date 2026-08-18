import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The physics library is pure TS and needs no DOM. jsdom costs ~90s of
    // worker startup here for no benefit; crypto.subtle (used by the
    // certificate hash chain) is available on globalThis in Node 20+.
    environment: 'node',
    pool: 'threads',
    globals: false,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The physics suites are CPU-bound, not I/O-bound: several step the engine
    // tens of thousands of times, and the conformal coverage test draws 4000
    // samples. They finish in ~10s on an idle machine but drift past Vitest's
    // 5s default when the box is busy — which turns deterministic tests into
    // ones that fail depending on what else is running. Give them room.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
