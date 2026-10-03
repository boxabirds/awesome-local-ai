import { chromium, firefox, webkit } from '@playwright/test';

/**
 * Global setup: find out which of the three browsers can actually be launched
 * here, and tell the workers through the environment.
 *
 * Some sandboxes (containers without the ability to spawn a browser content
 * process, CI images missing the WebKit system libraries) can run Chromium but
 * abort on `firefox.launch()` / `webkit.launch()`. The suite is written to be
 * browser-agnostic, so the right behaviour is: test every browser that works,
 * skip the ones that cannot start \u2014 loudly, and never fail with a launch error
 * that has nothing to do with the product.
 */
const CANDIDATES = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
] as const;

export default async function globalSetup(): Promise<void> {
  const usable: string[] = [];
  const unusable: Record<string, string> = {};

  for (const [name, type] of CANDIDATES) {
    try {
      const browser = await type.launch();
      const page = await browser.newPage();
      await page.setContent('<div id="probe">ok</div>');
      if ((await page.locator('#probe').textContent()) !== 'ok') {
        throw new Error('probe page did not render');
      }
      await browser.close();
      usable.push(name);
    } catch (error) {
      unusable[name] = (error as Error).message.split('\n')[0] ?? 'unknown launch error';
    }
  }

  process.env.VIDI6_USABLE_BROWSERS = JSON.stringify(usable);
  const summary = usable.length > 0 ? usable.join(', ') : 'none';
  const skipped = Object.entries(unusable)
    .map(([name, message]) => `${name} (${message})`)
    .join('; ');
  console.log(`[e2e] browsers under test: ${summary}`);
  if (skipped) console.log(`[e2e] browsers that cannot launch here: ${skipped}`);
}
