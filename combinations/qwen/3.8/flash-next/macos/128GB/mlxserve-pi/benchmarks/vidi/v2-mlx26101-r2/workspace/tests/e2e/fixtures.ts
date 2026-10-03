import { test as base, expect } from '@playwright/test';

/**
 * Every e2e test is meant to run on chromium, firefox and webkit \u2014 except on a
 * machine that cannot start that browser at all (see tests/e2e/setup.ts).
 * Skipping is decided by an actual launch probe, never by assuming a browser is
 * broken, so nothing quietly stops being tested.
 */
const usable = new Set<string>(JSON.parse(process.env.VIDI6_USABLE_BROWSERS ?? '[]') as string[]);

export const test = base.extend<{ browserSupport: void }>({
  browserSupport: [
    async ({ browserName }, use, testInfo) => {
      if (!usable.has(browserName)) {
        testInfo.annotations.push({
          type: 'browser',
          description: `${browserName} cannot be launched in this environment`,
        });
        base.skip(
          true,
          `${browserName} cannot be launched here \u2014 see the "[e2e] browsers that cannot launch here" line from tests/e2e/setup.ts`,
        );
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
