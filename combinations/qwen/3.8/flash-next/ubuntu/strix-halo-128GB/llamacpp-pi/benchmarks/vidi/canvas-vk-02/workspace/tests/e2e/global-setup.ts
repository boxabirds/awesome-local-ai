import { firefox, webkit, type BrowserType } from '@playwright/test';

/**
 * Firefox and WebKit need GTK libraries that not every host has (the docker
 * images for the three engines differ). Probe them once here; the spec skips the
 * engines that cannot launch instead of reporting a false failure, so a
 * Chromium-only host is green and a full host still covers all three.
 */
export default async function globalSetup(): Promise<void> {
  const unavailable: string[] = [];
  const candidates: Array<[string, BrowserType<never>]> = [
    ['firefox', firefox],
    ['webkit', webkit],
  ];

  for (const [name, browser] of candidates) {
    try {
      const instance = await browser.launch({ timeout: 60_000 });
      await instance.close();
    } catch {
      unavailable.push(name);
    }
  }

  process.env.VIDI6_UNAVAILABLE_BROWSERS = unavailable.join(',');
}
