import { defineConfig, devices } from '@playwright/test';

// Story 4 restart e2e. This project deliberately has NO webServer: each test owns
// its `wrangler dev` process outright (spawning and killing it) so it can prove a
// board is rebuilt from on-disk state after the process forgets everything in
// memory. Pages are opened by absolute URL, so baseURL only needs to be well-formed.
//
// Run it with `npm run test:e2e:persist`, which builds the client in test mode
// first (that build is what enables `window.__vidi6TestBoard` for seeding).
//
// Ports here are unique per wrangler phase so a socket lingering from a stopped
// process can never collide with the next phase. The shared e2e server uses
// 28394/28395; these stay clear of it and of each other.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /persistence\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:28384',
    viewport: { width: 1280, height: 800 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
          ],
        },
      },
    },
  ],
});
