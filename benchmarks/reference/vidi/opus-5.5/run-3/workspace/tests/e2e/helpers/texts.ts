import { expect, type Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';
import type { TextSnapshot } from '../../../src/shared/objects/text';

/** Every text object on the board, from the doc (test hook). */
export async function texts(page: Page): Promise<TextSnapshot[]> {
  return page.evaluate(
    () => (window.__vidi6!.objects?.() ?? []).filter((o) => o.type === 'text') as unknown as TextSnapshot[],
  );
}

export function textById(page: Page, id: string) {
  return page.locator(`[data-text-id="${id}"]`);
}

export function textEditor(page: Page) {
  return page.getByRole('textbox', { name: 'Text' });
}

/** Presses T, clicks the board at `at` and returns the id of the new text being edited. */
export async function placeText(page: Page, at: Point): Promise<string> {
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(at.x, at.y);
  const editor = textEditor(page);
  await expect(editor).toBeFocused();
  return editor.evaluate((el) => el.closest<HTMLElement>('[data-text-id]')!.dataset.textId!);
}

export async function centreOfText(page: Page, id: string): Promise<Point> {
  const box = await textById(page, id).boundingBox();
  if (!box) throw new Error(`text ${id} not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
