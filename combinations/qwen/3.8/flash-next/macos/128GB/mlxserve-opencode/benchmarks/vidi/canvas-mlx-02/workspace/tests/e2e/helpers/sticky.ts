import type { Page, Locator } from '@playwright/test';
import { openBoard } from './board.ts';

export interface Cam {
  x: number;
  y: number;
  zoom: number;
}

// world = screen / zoom + camera.xy (mirrors src/client/canvas/camera.ts).
export function screenToWorld(cam: Cam, p: { x: number; y: number }): { x: number; y: number } {
  return { x: p.x / cam.zoom + cam.x, y: p.y / cam.zoom + cam.y };
}

export async function gotoBoard(page: Page): Promise<string> {
  // A board is opened at its own address now, and only a board the server knows is
  // a board at all.
  return openBoard(page);
}

export async function setCamera(page: Page, cam: Cam): Promise<void> {
  await page.evaluate((c) => {
    const hook = (window as unknown as { __vidi6?: { setCamera(cam: Cam): void } }).__vidi6;
    if (!hook) throw new Error('__vidi6 test hook missing (build in test mode?)');
    hook.setCamera(c);
  }, cam);
  await page.waitForTimeout(60);
}

// The live camera (read-only), so the test never assumes a particular viewport.
export async function getCamera(page: Page): Promise<Cam> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __vidi6?: { getCamera(): Cam } }).__vidi6;
    if (!hook) throw new Error('__vidi6 test hook missing (build in test mode?)');
    return hook.getCamera();
  });
}

export function notes(page: Page): Locator {
  return page.locator('[role="group"][aria-label="Sticky note"]');
}

export function firstNote(page: Page): Locator {
  return notes(page).first();
}

// The note's world top-left, read from its inline left/top (1 world unit == 1px).
export async function noteWorldTopLeft(note: Locator): Promise<{ x: number; y: number }> {
  return note.evaluate((el) => ({
    x: parseFloat((el as HTMLElement).style.left),
    y: parseFloat((el as HTMLElement).style.top),
  }));
}

// Note centre on screen.
export async function noteScreenCenter(
  note: Locator,
): Promise<{ x: number; y: number }> {
  const box = await note.boundingBox();
  if (!box) throw new Error('note bounding box not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Note locator by its data-testid (e.g. returned by noteIdsInPaintOrder).
export function noteByTestId(page: Page, testid: string): Locator {
  return page.locator(`[data-testid="${testid}"]`);
}

// Data-testids of all notes in DOM (paint) order, lowest z first.
export async function noteIdsInPaintOrder(page: Page): Promise<string[]> {
  return page.$$eval('[role="group"][aria-label="Sticky note"]', (els) =>
    els.map((e) => (e as HTMLElement).getAttribute('data-testid') || ''),
  );
}

// Create a note by double-clicking empty board space at a screen point and start
// editing it.
export async function createNoteAt(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.dblclick(x, y);
  await page.waitForSelector('textarea.sticky-editor');
}

// Type into the focused editor.
export async function typeText(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.waitForTimeout(30);
}

// Replace the editor content in one input event (simulates a paste of `text`).
export async function pasteIntoEditor(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const ta = document.activeElement as HTMLTextAreaElement;
    ta.value = t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page.waitForTimeout(30);
}

export function noteTextEl(note: Locator): Locator {
  return note.locator('.sticky-text');
}

// Drag the note from a grabbed screen point by (dx, dy) screen pixels.
export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}

// The reset camera for the default 1280x800 viewport: world (0,0) at the centre.
export function resetCam(): Cam {
  return { x: -640, y: -400, zoom: 1 };
}
