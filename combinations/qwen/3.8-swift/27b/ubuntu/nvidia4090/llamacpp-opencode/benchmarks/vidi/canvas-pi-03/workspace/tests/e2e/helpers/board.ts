import type { Page } from '@playwright/test';

export async function getOriginMarkerPos(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.getByTestId('origin-marker');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  const label = page.getByTestId('zoom-label');
  const text = await label.textContent();
  return text ?? '';
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  // Wait for the test hook to be available
  await page.waitForFunction(() => (window as any).__vidi6 != null, null, { timeout: 5000 });
  await page.evaluate(({ x, y, zoom }) => {
    (window as any).__vidi6.setCamera({ x, y, zoom });
  }, { x, y, zoom });
}

export interface NoteInfo {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/** Read the current notes from the Y.Doc via the test hook. */
export async function getNotes(page: Page): Promise<NoteInfo[]> {
  await page.waitForFunction(() => (window as any).__vidi6?.doc != null, null, { timeout: 5000 });
  return page.evaluate(() => {
    const w = window as any;
    const objects = w.__vidi6.doc.getMap('objects');
    // The note id is the Y.Map key, not a field of the value.
    return [...objects.keys()].map((key: string) => {
      const obj: any = objects.get(key);
      return {
        id: key,
        x: obj.get('x'),
        y: obj.get('y'),
        z: obj.get('z'),
        color: obj.get('color'),
        text: obj.get('text')?.toString() ?? '',
      };
    });
  });
}

/** Screen position of the centre of the note element with the given id. */
export async function getNoteCenter(page: Page, noteId: string): Promise<{ x: number; y: number }> {
  const el = page.locator(`[data-note-id="${noteId}"]`);
  const b = await el.boundingBox();
  if (!b) throw new Error(`note ${noteId} not found`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
