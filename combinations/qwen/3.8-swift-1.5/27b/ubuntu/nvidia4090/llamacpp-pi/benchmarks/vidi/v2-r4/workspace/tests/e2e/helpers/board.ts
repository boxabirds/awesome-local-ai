import type { Page, Locator } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8787';

/**
 * Creates a board via the API and returns its id. The board must exist before
 * a client connects (the worker rejects unknown board ids), so every e2e test
 * creates its board first rather than navigating to a bare newBoardId().
 */
export async function createBoard(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/boards`, { method: 'POST' });
  if (!res.ok) throw new Error(`createBoard failed: ${res.status}`);
  const body = (await res.json()) as { id: string };
  return body.id;
}

export function getOriginMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export function getZoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}

export async function setCamera(
  page: Page,
  xOrCamera: number | { x: number; y: number; zoom: number },
  y?: number,
  zoom?: number,
): Promise<void> {
  const camera = typeof xOrCamera === 'number'
    ? { x: xOrCamera, y: y ?? 0, zoom: zoom ?? 1 }
    : xOrCamera;
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6?.setCamera({ x, y, zoom });
  }, camera);
}

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = getOriginMarker(page);
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getNoteCount(page: Page): Promise<number> {
  return page.locator('[data-testid="sticky-note"]').count();
}

export async function getNotePosition(page: Page, index: number): Promise<{ x: number; y: number } | null> {
  const notes = page.locator('[data-testid="sticky-note"]');
  if (await notes.count() <= index) return null;
  
  return page.evaluate((idx) => {
    const notes = document.querySelectorAll('[data-testid="sticky-note"]');
    const note = notes[idx] as HTMLElement | undefined;
    if (!note) return null;
    // Read the position from the data attributes or style
    const left = parseFloat(note.style.left) || 0;
    const top = parseFloat(note.style.top) || 0;
    return { x: left, y: top };
  }, index);
}

export async function createNoteByDoubleClick(page: Page, x: number, y: number): Promise<void> {
  await page.dblclick('[data-testid="board-viewport"]', { position: { x, y } });
}
