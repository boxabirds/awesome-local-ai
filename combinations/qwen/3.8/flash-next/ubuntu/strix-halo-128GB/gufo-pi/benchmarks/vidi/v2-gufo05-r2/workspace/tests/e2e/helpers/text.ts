/**
 * Helpers for story 9's end-to-end tests: free text on the board.
 *
 * The text a person sees is measured by their own browser, so these helpers read
 * both the document (`getTexts`) and the box on screen (`textBoxes`) — the pair
 * that must agree, and the pair that a two-screen test compares.
 */

import { expect, type Page } from '@playwright/test';

import type { TextSnapshot } from '../../../src/shared/objects/text';
import { expectNoPendingCameraFrame, type Pixel } from './board';

export interface TextBox extends Pixel {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** The live text snapshots, in the order they are drawn. */
export async function getTexts(page: Page): Promise<TextSnapshot[]> {
  return page.evaluate(() => {
    const hooks = (
      window as unknown as { __vidi6?: { getTexts?(): TextSnapshot[] } }
    ).__vidi6;
    if (!hooks?.getTexts) {
      throw new Error('window.__vidi6.getTexts missing: e2e needs a test build');
    }
    return hooks.getTexts();
  });
}

/** Screen boxes of every rendered text object, keyed by id. */
export async function textBoxes(page: Page): Promise<Record<string, TextBox>> {
  const raw = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-object-type="text"]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.objectId as string,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
      };
    }),
  );
  const boxes: Record<string, TextBox> = {};
  for (const r of raw) boxes[r.id] = r;
  return boxes;
}

/** The words currently displayed for one text object. */
export async function textWords(page: Page, id: string): Promise<string> {
  const el = page.locator(`[data-object-id="${id}"]`);
  return (await el.textContent()) ?? '';
}

/**
 * Take the Text tool, click the board, and return the id of the text that appeared
 * under the pointer — editing, as the story wants it.
 */
export async function createTextByTool(page: Page, at: Pixel): Promise<string> {
  const before = new Set((await getTexts(page)).map((text) => text.id));
  await page.getByRole('button', { name: 'Text (T)' }).click();
  await page.mouse.click(at.x, at.y);
  await expectNoPendingCameraFrame(page);
  const created = (await getTexts(page)).filter((text) => !before.has(text.id));
  if (created.length !== 1) {
    throw new Error(`expected one new text object, saw ${created.length}`);
  }
  const text = created[0]!;
  await expect(page.getByTestId('text-editor')).toBeVisible();
  return text.id;
}

/** The same with the keyboard shortcut, and nothing else. */
export async function createTextByShortcut(page: Page, at: Pixel): Promise<string> {
  const before = new Set((await getTexts(page)).map((text) => text.id));
  await page.keyboard.press('t');
  await page.mouse.click(at.x, at.y);
  await expectNoPendingCameraFrame(page);
  const created = (await getTexts(page)).filter((text) => !before.has(text.id));
  if (created.length !== 1) {
    throw new Error(`expected one new text object from "t", saw ${created.length}`);
  }
  return created[0]!.id;
}

/** Type into the text editor that is open. */
export async function typeIntoText(page: Page, words: string): Promise<void> {
  await page.getByTestId('text-editor').pressSequentially(words);
}

/** End text editing with Escape, which keeps the object selected. */
export async function endTextEditing(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expectNoPendingCameraFrame(page);
}

/** Open an existing text object for editing by double-clicking it. */
export async function editText(page: Page, id: string): Promise<void> {
  const box = (await textBoxes(page))[id];
  if (!box) throw new Error(`text ${id} is not on this screen`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('text-editor')).toBeVisible();
}

/** Click a text object once, which selects it and brings up its toolbar. */
export async function selectText(page: Page, id: string): Promise<void> {
  const box = (await textBoxes(page))[id];
  if (!box) throw new Error(`text ${id} is not on this screen`);
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(10, box.height / 2));
  await expect(page.getByTestId('text-toolbar')).toBeVisible({ timeout: 5_000 });
}
