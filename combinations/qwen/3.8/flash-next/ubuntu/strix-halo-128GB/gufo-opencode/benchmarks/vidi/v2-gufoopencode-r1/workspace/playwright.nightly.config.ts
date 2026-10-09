import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Nightly soak: TC-29 (45 s idle stability) and TC-30 (60 s capacity convergence
// with a latency report). Excluded from test:e2e; run separately, expect minutes.
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: /nightly\.spec\.ts/,
  timeout: 240_000,
  projects: base.projects?.filter((project) => project.name === 'chromium')
});
