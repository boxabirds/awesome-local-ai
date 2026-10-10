#!/usr/bin/env node
/**
 * Print, as one line of JSON, which Playwright browsers can actually start in
 * this environment.
 *
 * Playwright projects for a browser that cannot start fail the suite with a
 * launch error instead of running anything. Probing first lets the config skip
 * those browsers with a clear reason (see `playwright.config.ts`).
 */
import { chromium, firefox, webkit } from 'playwright-core';

const CANDIDATES = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

const report = await Promise.all(
  CANDIDATES.map(async ([name, browserType]) => {
    try {
      const browser = await browserType.launch({ timeout: 30_000 });
      await browser.close();
      return { name, ok: true };
    } catch (error) {
      const message = String(error?.message ?? error).split('\n')[0];
      return { name, ok: false, error: message.slice(0, 200) };
    }
  }),
);

console.log(JSON.stringify(report));
