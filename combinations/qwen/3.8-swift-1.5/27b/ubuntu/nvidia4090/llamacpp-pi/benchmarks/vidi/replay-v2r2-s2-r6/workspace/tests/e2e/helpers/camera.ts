import type { Page } from '@playwright/test';

export interface BoardSnapshotEntry {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/**
 * Deterministic camera for e2e tests: zoom 1, world origin at screen (640,400).
 * With this camera, screen (sx,sy) maps to world (sx-640, sy-400).
 */
export const TEST_CAMERA = { x: -640, y: -400, zoom: 1 };

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((c) => window.__vidi6?.setCamera(c), cam);
}

export async function getBoardSnapshot(page: Page): Promise<readonly BoardSnapshotEntry[]> {
  return page.evaluate(() => window.__vidi6?.getBoardSnapshot() ?? []);
}

export async function worldTransform(page: Page): Promise<string> {
  return page.locator('[data-testid="world-layer"]').evaluate((el) => el.style.transform);
}
