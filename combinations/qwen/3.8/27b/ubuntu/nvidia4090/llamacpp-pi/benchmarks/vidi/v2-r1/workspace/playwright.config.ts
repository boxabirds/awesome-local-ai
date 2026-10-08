import { defineConfig } from '@playwright/test';

const PORT = 28432;

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    viewport: { width: 1280, height: 800 },
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
      // persistence/broken-board specs run their own wrangler process under
      // playwright.persistence.config.ts; share.spec.ts likewise runs under
      // playwright.share.config.ts; selection-collab.spec.ts (multi-context
      // collaboration) runs under playwright.selection.config.ts, undo.spec.ts
      // under playwright.undo.config.ts, and text.spec.ts (free text; also
      // firefox/webkit) under playwright.text.config.ts — all no shared
      // webServer.
      testIgnore: [
        'nightly.spec.ts',
        'persistence.spec.ts',
        'broken-board.spec.ts',
        'share.spec.ts',
        'selection-collab.spec.ts',
        'undo.spec.ts',
        'text.spec.ts',
        'shapes.spec.ts',
        'connectors.spec.ts',
      ],
    },
    {
      name: 'nightly',
      use: { browserName: 'chromium' },
      testMatch: ['nightly.spec.ts'],
    },
  ],
  webServer: {
    command: 'npm run dev:test',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
