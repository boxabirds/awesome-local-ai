import { expect, type Page } from '@playwright/test';
import type { StickySnapshot } from '../../../src/shared/board-model';

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  left: number;
  top: number;
  width: number;
  height: number;
}




/** The board document snapshot, in paint order (bottom to top). */
export function snapshot(page: Page): Promise<readonly StickySnapshot[]> {
  return page.evaluate(() => window.__vidi6!.getSnapshot());
}

export function getCamera(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  return page.evaluate(() => window.__vidi6!.getCamera());
}

export function selection(page: Page): Promise<{
  selectedId: string | null;
  editingId: string | null;
}> {
  return page.evaluate(() => window.__vidi6!.getSelection());
}

/** Note ids in DOM order, which is paint order (bottom to top). */
export function noteIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-note-id]')).map(
      (el) => (el as HTMLElement).dataset.noteId ?? '',
    ),
  );
}

/** Screen box of one note, identified by its document id. */
export function noteBox(page: Page, id: string): Promise<Box> {
  return page.evaluate((noteId) => {
    const el = document.querySelector(`[data-note-id="${noteId}"]`);
    if (!el) throw new Error(`note ${noteId} missing`);
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  }, id);
}

export function center(box: Box): Point {
  return { x: box.x, y: box.y };
}

/** Create a note with the toolbar button (it lands in the centre of the view). */
export async function createViaToolbar(page: Page): Promise<string> {
  await page.getByTestId('create-sticky').click();
  const all = await snapshot(page);
  return all[all.length - 1]!.id;
}

/** Create a note by double-clicking empty board space. */
export async function createByDoubleClick(page: Page, at: Point): Promise<string> {
  await page.mouse.dblclick(at.x, at.y);
  const all = await snapshot(page);
  return all[all.length - 1]!.id;
}

/** Leave editing mode (the note stays selected). */
export async function stopEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

/** A real mouse drag: press, move in `steps`, release. */
export async function dragTo(page: Page, from: Point, to: Point, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** True once the world layer's CSS transform matches the camera in the model. */
export async function waitForRender(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const cam = window.__vidi6!.getCamera();
          const el = document.querySelector('[data-testid="board-world"]');
          if (!el) return false;
          const m = new DOMMatrix(getComputedStyle(el).transform);
          return (
            Math.abs(m.a - cam.zoom) < 1e-6 &&
            Math.abs(m.e + cam.x * cam.zoom) < 0.5 &&
            Math.abs(m.f + cam.y * cam.zoom) < 0.5
          );
        }),
      { timeout: 5000 },
    )
    .toBe(true);
}

/** Keep the world point at the centre of the screen and change the zoom. */
export async function setZoom(page: Page, zoom: number): Promise<void> {
  await page.evaluate((z) => {
    const api = window.__vidi6!;
    const cam = api.getCamera();
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const wx = cx / cam.zoom + cam.x;
    const wy = cy / cam.zoom + cam.y;
    api.setCamera({ x: wx - cx / z, y: wy - cy / z, zoom: z });
  }, zoom);
  await waitForRender(page);
}

/** Travel far away from the origin without changing the zoom. */
export async function panFar(page: Page, dxScreen = 900, dyScreen = 700): Promise<void> {
  await page.evaluate(
    ({ dx, dy }) => {
      const api = window.__vidi6!;
      const cam = api.getCamera();
      api.setCamera({ x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom });
    },
    { dx: dxScreen, dy: dyScreen },
  );
  await waitForRender(page);
}

/** Id of the note that is on top at a screen point (paint order, not DOM order). */
export function noteAtPoint(page: Page, at: Point): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-note-id]');
    return el ? ((el as HTMLElement).dataset.noteId ?? null) : null;
  }, at);
}

export interface TextMeasurement {
  fontSize: string;
  scrollHeight: number;
  containerClientHeight: number;
  overflowClass: boolean;
  fadePresent: boolean;
}

/** Layout of a note's text, as the browser really laid it out. */
export function textInnerStyle(page: Page, id: string): Promise<TextMeasurement> {
  return page.evaluate((noteId) => {
    const note = document.querySelector(`[data-note-id="${noteId}"]`);
    const outer = note?.querySelector('[data-testid="sticky-text"]');
    const inner = note?.querySelector('[data-testid="sticky-text-inner"]');
    if (!note || !outer || !inner) throw new Error('note text missing');
    return {
      fontSize: getComputedStyle(inner).fontSize,
      scrollHeight: inner.scrollHeight,
      containerClientHeight: (outer as HTMLElement).clientHeight,
      overflowClass: (outer as HTMLElement).classList.contains('sticky-text-overflow'),
      fadePresent: !!note.querySelector('[data-testid="sticky-text-fade"]'),
    };
  }, id);
}

export function textareaValue(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="sticky-note-input"]') as
      | HTMLTextAreaElement
      | null;
    return el ? el.value : null;
  });
}
