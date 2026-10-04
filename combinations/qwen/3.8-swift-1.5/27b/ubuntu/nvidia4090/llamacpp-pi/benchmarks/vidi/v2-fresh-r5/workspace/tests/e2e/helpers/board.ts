import type { Page } from '@playwright/test';
import { createBoard } from './api';

/**
 * Create a fresh board (story 5: POST /api/boards) and navigate to it. Since
 * story 3 boards live at `/b/:boardId`, e2e tests go straight to a real
 * board URL. Returns the board id.
 *
 * Waits for the board to mount (the first-use hint is the signal): the board
 * mounts only after the existence check resolves, and a test's first board
 * action (e.g. a dblclick) must land on a mounted board.
 */
export async function gotoBoard(page: Page): Promise<string> {
  const boardId = await createBoard();
  await page.goto(`/b/${boardId}`);
  await page.getByText(/Drag to move around/).waitFor({ timeout: 15_000 });
  return boardId;
}

/** Locate the origin crosshair marker (world 0,0). */
export function originMarker(page: Page) {
  return page.locator('[data-testid="origin"]');
}

/** Centre of the origin marker in viewport pixels. */
export async function originCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await originMarker(page).boundingBox();
  if (!box) throw new Error('Origin marker has no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Read the current zoom percentage label text (e.g. "100%"). */
export async function readZoomLabel(page: Page): Promise<string> {
  return (await page.locator('.zoom-controls output').textContent())?.trim() ?? '';
}

/** Jump the camera via the test-only hook (test build only).
 *
 * Waits for the hook first: `gotoBoard` returns at the load event, and the
 * hook is installed by a React effect after the board mounts, so an immediate
 * `page.evaluate` can race ahead of it.
 */
export async function setCamera(
  page: Page,
  cam: { x: number; y: number; zoom: number },
): Promise<void> {
  await page.waitForFunction(() => typeof (window as any).__vidi6?.setCamera === 'function');
  await page.evaluate((c) => (window as any).__vidi6.setCamera(c), cam);
}
