/**
 * E2E test helpers for text objects (story 9).
 */
import { expect, type Page } from '@playwright/test';

/** Get the current Y.Doc objects map as plain JSON. */
export async function getTextObjectsFromDoc(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const doc = window.__vidi6?.getDoc?.();
    if (!doc) throw new Error('__vidi6.getDoc missing');
    const objects = doc.getMap('objects');
    const result: Array<Record<string, unknown>> = [];
    for (const [id, entry] of objects) {
      const type = (entry as any).get?.('type');
      if (type === 'text') {
        const text = (entry as any).get?.('text');
        result.push({
          id,
          x: (entry as any).get?.('x'),
          y: (entry as any).get?.('y'),
          width: (entry as any).get?.('width'),
          height: (entry as any).get?.('height'),
          size: (entry as any).get?.('size'),
          widthMode: (entry as any).get?.('widthMode'),
          text: text?.toString?.() ?? '',
        });
      }
    }
    return result;
  });
}

/** Count text objects on screen. */
export async function textObjectCount(page: Page): Promise<number> {
  return page.locator('[data-testid="text-object"]').count();
}

/** Count text objects in the model. */
export async function textModelCount(page: Page): Promise<number> {
  const objs = await getTextObjectsFromDoc(page);
  return objs.length;
}

/** Activate the Text tool via keyboard shortcut. */
export async function activateTextTool(page: Page): Promise<void> {
  // Make sure no editor is focused
  await page.locator('[data-testid="viewport"]').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('t');
  // Wait for the tool to switch
  await expect(page.locator('[data-testid="viewport"]')).toHaveAttribute('data-tool', 'text');
}

/** Click with the text tool to create a text object at screen position. */
export async function createTextAtScreen(page: Page, x: number, y: number): Promise<void> {
  await page.locator('[data-testid="viewport"]').click({ position: { x, y } });
  // Wait for the editor to appear
  await expect(page.locator('[data-testid="text-editor"]')).toBeVisible();
}

/** Type into the text editor. */
export async function typeIntoTextEditor(page: Page, text: string): Promise<void> {
  await page.locator('[data-testid="text-editor"]').fill(text);
  // Trigger change event to ensure it syncs
  await page.locator('[data-testid="text-editor"]').evaluate((el) => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Press Escape in the text editor. */
export async function pressEscapeInTextEditor(page: Page): Promise<void> {
  await page.locator('[data-testid="text-editor"]').press('Escape');
}

/** Select a text object by clicking it (in select mode). */
export async function selectTextObject(page: Page, index = 0): Promise<void> {
  const els = page.locator('[data-testid="text-object"]');
  await els.nth(index).click();
}

/** Get the bounding rect of a text object. */
export async function textObjectRect(page: Page, index = 0) {
  const el = page.locator('[data-testid="text-object"]').nth(index);
  return el.boundingBox();
}

/** Double-click a text object to edit it. */
export async function dblClickTextObject(page: Page, index = 0): Promise<void> {
  const el = page.locator('[data-testid="text-object"]').nth(index);
  await el.dblclick();
  await expect(page.locator('[data-testid="text-editor"]')).toBeVisible();
}

/** Wait for text objects to stabilize in the document. */
export async function waitForTextStable(page: Page, expectedCount: number): Promise<void> {
  await expect(async () => {
    const count = await textModelCount(page);
    expect(count).toBe(expectedCount);
  }).toPass({ timeout: 5000 });
}
