// E2E image drop helper (story 12, TC-25/TC-27/TC-28).
//
// Builds a DataTransfer from fixture bytes inside the page and dispatches a
// real drop event at a board point — the same code path a browser file
// drag-and-drop uses (dragenter/dragover are implied by the drop target's
// allow-drop state, which the app sets in onDragOver).

import type { Page } from '@playwright/test';

export interface DropFixture {
  name: string;
  type: string;
  /** base64 of the file bytes (magic bytes must be real for the worker sniff). */
  b64: string;
}

/** A DataTransfer carrying `fixtures`, created in the page context. */
export async function dataTransfer(page: Page, fixtures: DropFixture[]): Promise<import('@playwright/test').JSHandle<DataTransfer>> {
  return page.evaluateHandle((specs: DropFixture[]) => {
    const dt = new DataTransfer();
    for (const s of specs) {
      const bytes = Uint8Array.from(atob(s.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], s.name, { type: s.type }));
    }
    return dt;
  }, fixtures);
}

/** Real drag-and-drop of `fixtures` onto the board viewport at screen (x, y). */
export async function dropFiles(page: Page, fixtures: DropFixture[], x: number, y: number): Promise<void> {
  const dt = await dataTransfer(page, fixtures);
  await page
    .locator('[data-testid="board-viewport"]')
    .dispatchEvent('drop', { dataTransfer: dt, clientX: x, clientY: y });
}
