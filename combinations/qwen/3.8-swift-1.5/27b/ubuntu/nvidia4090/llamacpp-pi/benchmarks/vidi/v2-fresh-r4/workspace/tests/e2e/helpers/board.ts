import type { Page } from '@playwright/test';

/** Screen-space centre of the origin marker (the crosshair at world 0,0). */
export async function originMarkerCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('[data-vidi6="origin-marker"]').boundingBox();
  if (!box) throw new Error('origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The current zoom percentage label text (e.g. "100%"). */
export async function zoomLabel(page: Page): Promise<string> {
  return (await page.locator('[data-vidi6="zoom-label"]').textContent())?.trim() ?? '';
}

/** The board world-layer transform string, for asserting exact camera movement. */
export async function worldTransform(page: Page): Promise<string> {
  return page.locator('[data-vidi6="board-world"]').evaluate((el) => (el as HTMLElement).style.transform);
}

/**
 * Jump the camera directly via the test-only hook. Only present in the test-mode
 * build (import.meta.env.MODE === 'test'), which the e2e web server produces.
 */
export async function setCamera(
  page: Page,
  camera: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.evaluate((cam) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(c: { x: number; y: number; zoom: number }): void } }).__vidi6;
    if (!hook) throw new Error('window.__vidi6 test hook is missing (not a test-mode build)');
    hook.setCamera(cam);
  }, camera);
}

/**
 * Camera updates are coalesced with requestAnimationFrame, so poll the transform
 * until it stops changing to make reads deterministic.
 */
export async function settle(page: Page): Promise<void> {
  let previous = '';
  for (let i = 0; i < 40; i++) {
    const current = await worldTransform(page);
    if (current === previous) return;
    previous = current;
    await page.waitForTimeout(16);
  }
}

/** Read the board grid's computed background size as a number of px. */
export async function gridSpacingPx(page: Page): Promise<number> {
  return page
    .locator('[data-vidi6="board-grid"]')
    .evaluate((el) => {
      const size = getComputedStyle(el).backgroundSize;
      const match = size.match(/([\d.]+)px/);
      return match ? Number(match[1]) : NaN;
    });
}
