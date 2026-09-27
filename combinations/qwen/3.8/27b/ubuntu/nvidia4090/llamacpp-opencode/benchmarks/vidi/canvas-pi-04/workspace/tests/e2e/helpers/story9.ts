// Story 9 e2e helpers (TC-26..TC-31).
//
// Text objects are created through the real Text tool (T + click) so the full
// path runs in the browser: tool switch, click-to-create, editor mount.
// Helpers are camera-aware like helpers/story7.ts: world points are converted
// to viewport-local screen with the parked camera.

import { expect, type Page } from '@playwright/test';
import type { Camera } from '../../../src/client/canvas/camera';

export const TEXT_OBJECT = '.text-object';
export const TEXT_CONTENT = '.text-object__content';
export const TEXT_EDITOR = 'textarea[aria-label="Text object text"]';
export const VIEWPORT = '[data-testid="board-viewport"]';

/** Viewport-local screen point for a world point under `camera`. */
function localOf(camera: Camera, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - camera.x) * camera.zoom, y: (wy - camera.y) * camera.zoom };
}

/** Press T, click the board at world (wx, wy) -> a new text being edited. */
export async function createTextAt(
  page: Page,
  camera: Camera,
  wx: number,
  wy: number,
): Promise<void> {
  // The `__vidi6` test hook (used by parkCamera) is exposed before React
  // mounts the board, so wait for the viewport to actually be on screen
  // before interacting: a press before mount is silently lost.
  const vp = page.locator(VIEWPORT);
  await vp.waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('t');
  // The tool switch is an async React re-render; wait for it to land so the
  // click below is handled as a Text-tool press (not a plain board click).
  await page.locator(`${VIEWPORT}.is-text-tool`).waitFor({ timeout: 10_000 });
  const box = (await vp.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const s = localOf(camera, wx, wy);
  await page.mouse.click(box.x + s.x, box.y + s.y);
  await page.locator(TEXT_EDITOR).waitFor({ timeout: 10_000 });
}

/** Type (insert at the caret) into the open text editor, key by key. */
export async function typeInEditor(page: Page, text: string): Promise<void> {
  await page.locator(TEXT_EDITOR).focus();
  await page.locator(TEXT_EDITOR).pressSequentially(text);
}

/** Set the whole editor value in one deterministic input event. */
export async function fillEditor(page: Page, text: string): Promise<void> {
  await page.locator(TEXT_EDITOR).fill(text);
}

/** End text editing (Escape: keeps non-empty text selected, removes empty). */
export async function endTextEdit(page: Page): Promise<void> {
  // Focus the editor so Escape is handled by it (not the board keys): a lost
  // focus under load would let the board swallow the key and leave the edit
  // open (or, on empty text, skip the empty-removal path).
  const editor = page.locator(TEXT_EDITOR);
  if ((await editor.count()) > 0) await editor.first().focus();
  await page.keyboard.press('Escape');
}

/** Wait until `count` text objects are rendered. */
export async function expectTextCount(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => page.locator(TEXT_OBJECT).count(), { timeout: 15_000 })
    .toBe(count);
}

/** The rendered world box of the nth text object (style values are world px). */
export async function textWorld(
  page: Page,
  nth = 0,
): Promise<{ x: number; y: number; w: number; h: number; fontSize: string }> {
  return page.locator(TEXT_OBJECT).nth(nth).evaluate((el) => {
    const s = el.style;
    return {
      x: parseFloat(s.left),
      y: parseFloat(s.top),
      w: parseFloat(s.width),
      h: parseFloat(s.height),
      fontSize: s.fontSize,
    };
  });
}

/** The rendered content of every text object (in DOM order). */
export async function textContents(page: Page): Promise<string[]> {
  return page.locator(TEXT_CONTENT).evaluateAll((els) =>
    els.map((el) => el.textContent ?? ''),
  );
}

/** True when every character of `needed` occurs at least as often in `text`. */
export function containsAllChars(text: string, needed: string): boolean {
  const count = (s: string, ch: string): number => s.split(ch).length - 1;
  const distinct = [...new Set(needed.split(''))];
  return distinct.every((ch) => count(text, ch) >= count(needed, ch));
}
