import { Page, Locator } from '@playwright/test';

/**
 * Story 5: boards are created server-side. Create a fresh board via the
 * public API and open its link; returns the board id.
 */
export async function openNewBoard(page: Page): Promise<string> {
  const resp = await page.request.post('/api/boards');
  if (resp.status() !== 201) {
    throw new Error(`board creation failed: ${resp.status()}`);
  }
  const data = (await resp.json()) as { id: string };
  await page.goto(`/b/${data.id}`);
  // Wait until the board is interactive (doc connected, viewport mounted)
  // so tests can immediately create notes / pan without racing the load.
  await page.getByTestId('board-viewport').waitFor({ state: 'visible', timeout: 20_000 });
  return data.id;
}

export async function getOriginMarker(page: Page): Promise<Locator> {
  return page.getByTestId('origin-marker');
}

export async function getZoomLabel(page: Page): Promise<string> {
  const label = page.getByTestId('zoom-label');
  const text = await label.textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6.setCamera(x, y, zoom);
  }, { x, y, zoom });
}

export async function clickZoomIn(page: Page): Promise<void> {
  await page.getByLabel('Zoom in').click();
}

export async function clickZoomOut(page: Page): Promise<void> {
  await page.getByLabel('Zoom out').click();
}

export async function clickResetView(page: Page): Promise<void> {
  await page.getByLabel('Reset view').click();
}
