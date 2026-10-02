import { Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

/**
 * Helper functions for E2E board tests.
 */

const BASE_URL = 'http://127.0.0.1:27952';

/**
 * Create a board through the real API (story 5). Returns the board id.
 */
export async function createBoard(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) {
    throw new Error(`createBoard: expected 201, got ${res.status}`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

/**
 * Seed a legacy board (updates rows, no created_at) through the test hook.
 * (story 5, share.legacy_boards)
 */
export async function seedLegacyBoard(boardId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/__test/boards/${boardId}/seed-legacy`, { method: 'POST' });
  if (res.status !== 200) {
    throw new Error(`seedLegacyBoard: expected 200, got ${res.status}`);
  }
}

/**
 * Open an existing board in a page and wait for the board UI to be ready
 * (existence check passed, board rendered, test hooks registered).
 */
export async function openBoardInPage(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await page.getByTestId('board-viewport').waitFor({ timeout: E2E_EVENTUAL_TIMEOUT_MS });
  await page.waitForFunction(() => !!(window as any).__vidi6, undefined, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
}

/** Get the world layer element */
export async function getWorldLayer(page: Page) {
  return page.getByTestId('world-layer');
}

/** Get the board viewport element */
export async function getViewport(page: Page) {
  return page.getByTestId('board-viewport');
}

/** Get the zoom label element */
export async function getZoomLabel(page: Page) {
  return page.getByTestId('zoom-label');
}

/** Get the navigation hint element */
export async function getNavigationHint(page: Page) {
  return page.getByTestId('navigation-hint');
}

/** Get the zoom in button */
export async function getZoomInButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom in' });
}

/** Get the zoom out button */
export async function getZoomOutButton(page: Page) {
  return page.getByRole('button', { name: 'Zoom out' });
}

/** Get the reset view button */
export async function getResetButton(page: Page) {
  return page.getByRole('button', { name: 'Reset view' });
}

/** Read the current camera state from the test hook */
export async function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => (window as any).__vidi6.getCamera());
}

/**
 * Drag on the viewport from start to end position.
 * Uses mouse events for maximum compatibility.
 */
export async function dragBoard(page: Page, startX: number, startY: number, endX: number, endY: number) {
  const viewport = await getViewport(page);
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Viewport not found');

  // Convert to viewport-relative coordinates
  const absStartX = box.x + startX;
  const absStartY = box.y + startY;
  const absEndX = box.x + endX;
  const absEndY = box.y + endY;

  await page.mouse.move(absStartX, absStartY);
  await page.mouse.down();
  // Move in steps to simulate a natural drag
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    const x = absStartX + (absEndX - absStartX) * (i / steps);
    const y = absStartY + (absEndY - absStartY) * (i / steps);
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}

/**
 * Scroll (wheel) on the viewport.
 */
export async function scrollBoard(page: Page, deltaX: number, deltaY: number, x: number, y: number) {
  const viewport = await getViewport(page);
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Viewport not found');

  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.wheel(deltaX, deltaY);
}

/**
 * Ctrl+scroll (zoom) on the viewport.
 * Uses dispatchEvent because page.mouse.wheel() doesn't support modifier keys.
 */
export async function ctrlScrollBoard(page: Page, deltaY: number, x: number, y: number) {
  const viewport = await getViewport(page);
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Viewport not found');

  // Move mouse to position first (for hover state)
  await page.mouse.move(box.x + x, box.y + y);
  
  // Dispatch wheel event with ctrlKey via evaluate
  await page.evaluate(({ deltaY, clientX, clientY }) => {
    const el = document.querySelector('[data-testid="board-viewport"]');
    if (!el) return;
    el.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY,
      deltaX: 0,
      clientX,
      clientY,
      ctrlKey: true,
    }));
  }, { deltaY, clientX: box.x + x, clientY: box.y + y });
}
