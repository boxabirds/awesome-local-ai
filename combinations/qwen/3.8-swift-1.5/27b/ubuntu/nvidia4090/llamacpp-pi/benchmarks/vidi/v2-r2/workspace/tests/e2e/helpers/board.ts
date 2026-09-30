import type { Page } from '@playwright/test';

export function getOriginMarker(page: Page) {
  return page.getByTestId('origin-marker');
}

export async function getZoomLabel(page: Page): Promise<string> {
  const text = await page.getByTestId('zoom-label').textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6?.setCamera({ x, y, zoom });
  }, { x, y, zoom });
}

/** Base URL of the shared Playwright webServer (port 8787). */
export const E2E_BASE_URL = 'http://localhost:8787';

/**
 * Story 5: create a board through the public API. Boards must exist before
 * anyone can open them — a WebSocket connection no longer creates one.
 */
export async function apiCreateBoard(baseURL: string = E2E_BASE_URL): Promise<string> {
  const res = await fetch(`${baseURL}/api/boards`, { method: 'POST' });
  if (res.status !== 201) throw new Error(`POST /api/boards → ${res.status}`);
  return (await res.json() as { id: string }).id;
}

/** Wait until the board UI reports a live connection (via the __vidi6 hook). */
export async function waitForBoardReady(page: Page, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6
        ?.connectionState === 'connected',
    { timeout: timeoutMs }
  );
}

/** Open a fresh board end-to-end: create via API, navigate, wait for connect. */
export async function openBoard(page: Page): Promise<string> {
  const id = await apiCreateBoard();
  await page.goto(`/b/${id}`);
  await waitForBoardReady(page);
  return id;
}
