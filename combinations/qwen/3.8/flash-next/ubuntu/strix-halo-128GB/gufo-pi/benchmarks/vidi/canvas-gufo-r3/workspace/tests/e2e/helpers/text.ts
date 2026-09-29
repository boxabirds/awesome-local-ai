import { Page, Locator } from '@playwright/test';

export function getTextToolButton(page: Page): Locator {
  return page.locator('[data-testid="tool-text"]');
}

export function getSelectToolButton(page: Page): Locator {
  return page.locator('[data-testid="tool-select"]');
}

export function getTextObjects(page: Page): Locator {
  return page.locator('[data-testid="text-object"]');
}

export async function getTextIds(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="text-object"]', (els) =>
    els.map((e) => (e as HTMLElement).dataset.noteId as string),
  );
}

/** Activate the Text tool and click an empty board point; returns the new text object id. */
export async function createTextByTool(page: Page, x: number, y: number): Promise<string> {
  const before = await getTextIds(page);
  await getTextToolButton(page).click();
  await page.mouse.click(x, y);
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="text-object"]').length > prev,
    before.length,
  );
  const ids = await getTextIds(page);
  return ids.find((id) => !before.includes(id))!;
}

export function getTextEditor(page: Page): Locator {
  return page.locator('[data-testid="text-editor"]');
}

/** Click a text object to select it, then press Enter to edit. */
export async function startEditingText(page: Page, id: string): Promise<void> {
  const box = await getTextScreenBox(page, id);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.press('Enter');
  await getTextEditor(page).waitFor({ state: 'attached' });
}

export async function getTextScreenBox(page: Page, id: string) {
  const box = await page.locator(`[data-testid="text-object"][data-note-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`text ${id} not visible`);
  return box;
}

/** Displayed (non-editing) text content. */
export function getTextDisplay(page: Page, id: string): Locator {
  return page.locator(`[data-testid="text-object"][data-note-id="${id}"] .text-object-plain`);
}

/** Read live doc state for a text object. */
export async function getTextDocState(
  page: Page,
  id: string,
): Promise<{ text: string; size: string; widthMode: string; width: number; height: number } | null> {
  return page.evaluate((objId) => {
    const doc = (window as any).__vidi6?.doc;
    if (!doc) return null;
    const m = doc.getMap('objects').get(objId) as any;
    if (!m) return null;
    const yt = m.get('text');
    return {
      text: yt ? yt.toString() : '',
      size: m.get('size'),
      widthMode: m.get('widthMode'),
      width: m.get('width') as number,
      height: m.get('height') as number,
    };
  }, id);
}

export function getTextToolbarFor(page: Page, id: string): Locator {
  return page.locator(`[data-testid="text-object-wrapper"][data-note-id="${id}"] [data-testid="text-toolbar"]`);
}
