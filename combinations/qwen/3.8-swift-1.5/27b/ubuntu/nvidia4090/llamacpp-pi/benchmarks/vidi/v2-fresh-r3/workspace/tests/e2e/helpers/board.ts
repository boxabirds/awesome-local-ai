import { Page, Locator, APIRequestContext, expect } from '@playwright/test';

/**
 * Creates a board via the real API and opens it in the page (story 5: boards
 * are created server-side and the board UI is only mounted at `/b/<id>` once
 * the board exists). Waits until the board is ready (viewport mounted) so
 * callers can immediately drive the camera / create notes. Returns the id.
 */
export async function openBoardPath(request: APIRequestContext, page: Page): Promise<string> {
  const res = await request.post('/api/boards');
  if (res.status() !== 201) throw new Error(`board creation failed: ${res.status()}`);
  const { id } = (await res.json()) as { id: string };
  await page.goto(`/b/${id}`);
  // The board mounts only after the (async) existence check confirms it.
  await expect(page.getByTestId('board-viewport')).toBeVisible({ timeout: 15000 });
  return id;
}

export function getOriginMarker(page: Page): Locator {
  return page.getByTestId('origin-marker');
}

export function getZoomLabel(page: Page): Locator {
  return page.getByTestId('zoom-label');
}

export function getViewport(page: Page): Locator {
  return page.getByTestId('board-viewport');
}

export async function setCamera(page: Page, x: number, y: number, zoom: number): Promise<void> {
  await page.evaluate(
    ({ x, y, zoom }) => {
      (window as any).__vidi6?.setCamera({ x, y, zoom });
    },
    { x, y, zoom },
  );
}

/**
 * Waits until the zoom label reflects the given zoom. `setCamera` triggers an
 * async React re-render; position-sensitive tests must wait for the camera to
 * actually be applied before driving the mouse.
 */
export async function waitForZoom(page: Page, zoom: number): Promise<void> {
  const pct = Math.round(zoom * 100);
  await expect(page.getByTestId('zoom-label')).toHaveText(`${pct}%`, { timeout: 5000 });
}

export async function getZoomLabelText(page: Page): Promise<string> {
  return (await getZoomLabel(page).textContent())!.trim();
}

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const box = await getOriginMarker(page).boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export interface NoteState {
  id: string;
  x: number;
  y: number;
  color: string;
  text: string;
}

/** Reads the notes (position, colour, text) straight from the Yjs document. */
export async function getNotesState(page: Page): Promise<NoteState[]> {
  return page.evaluate(() => {
    const doc = (window as any).__vidi6.getDoc();
    const objects = doc.getMap('objects');
    return Array.from(objects.entries() as [string, any][]).map(([id, obj]) => ({
      id,
      x: obj.get('x') as number,
      y: obj.get('y') as number,
      color: obj.get('color') as string,
      text: (obj.get('text') as any)?.toString() ?? '',
    }));
  });
}

/** The DOM element for a note by id. */
export function noteByState(page: Page, state: NoteState): Locator {
  return page.locator(`[data-note-id="${state.id}"]`);
}

/** The screen-space bounding box of a note by id. */
export async function noteBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`note ${id} not found in DOM`);
  return box;
}

/** DOM order of the notes (index in the world layer) — equals z-order. */
export async function noteDomOrder(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-note-id]')).map((el) =>
      (el as HTMLElement).dataset.noteId!,
    ),
  );
}

/** Creates a sticky note via the toolbar button (enters editing immediately). */
export async function createNoteViaToolbar(page: Page, text?: string): Promise<void> {
  await page.getByLabel('Sticky note').click();
  if (text) {
    await page.getByTestId('sticky-textarea').waitFor();
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Escape');
}

/** Double-clicks empty board space at a screen point (creates a note there). */
export async function createNoteAtScreen(page: Page, x: number, y: number, text?: string): Promise<void> {
  await page.mouse.dblclick(x, y);
  if (text) {
    await page.getByTestId('sticky-textarea').waitFor();
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Escape');
}

/** Selects a note with a short press at a screen point. */
export async function selectNoteAtScreen(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

/** Drags from a screen point by (dx, dy) screen pixels. */
export async function dragScreen(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}
