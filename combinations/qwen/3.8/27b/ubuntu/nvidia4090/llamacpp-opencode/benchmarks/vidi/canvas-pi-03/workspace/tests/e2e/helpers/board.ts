import { expect, type Page } from '@playwright/test';

/** Mirrors src/shared/board-id (e2e cannot use the `@` alias). */
function newBoardId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return Buffer.from(binary, 'binary').toString('base64url');
}

/**
 * Navigate to a fresh board and wait until it is rendered. The app redirects
 * `/` to `/b/<id>` via a full-page reload, which would race the test's first
 * action, so we go straight to a valid board URL instead.
 */
export async function gotoBoard(page: Page): Promise<void> {
  await page.goto('/b/' + newBoardId());
  await page.waitForSelector('[data-testid="board-viewport"]', { timeout: 15_000 });
}

export async function getOriginMarkerPosition(page: Page): Promise<{ x: number; y: number }> {
  const marker = page.locator('[data-testid="origin-marker"]');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Origin marker not found');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function getZoomLabel(page: Page): Promise<string> {
  const text = await page.locator('[data-testid="zoom-label"]').textContent();
  return text ?? '';
}

export async function setCamera(page: Page, cam: { x: number; y: number; zoom: number }): Promise<void> {
  await page.evaluate((c) => {
    (window as any).__vidi6?.setCamera(c);
  }, cam);
}

export async function getHintVisible(page: Page): Promise<boolean> {
  const hint = page.locator('[data-testid="navigation-hint"]');
  return await hint.isVisible();
}

export interface NoteSnapshot {
  id: string;
  type: string;
  x: number;
  y: number;
  color: string;
  text: string;
  z: number;
  createdAt: number;
}

/** Story 2: the board's sticky notes, read through the test hooks. */
export async function getNotes(page: Page): Promise<NoteSnapshot[]> {
  return page.evaluate(() => {
    const h = (window as any).__vidi6;
    return h ? h.getNotes() : [];
  });
}

/** Waits until the note's bounding box matches the expected screen rect. */
export async function waitForNoteBox(page: Page, noteId: string, expected: { x: number; y: number; width: number; height: number }): Promise<void> {
  await expect
    .poll(async () => {
      const box = await page.locator(`[data-id="${noteId}"]`).boundingBox();
      if (!box) return false;
      return (
        Math.abs(box.x - expected.x) < 2 &&
        Math.abs(box.y - expected.y) < 2 &&
        Math.abs(box.width - expected.width) < 2 &&
        Math.abs(box.height - expected.height) < 2
      );
    })
    .toBeTruthy();
}
