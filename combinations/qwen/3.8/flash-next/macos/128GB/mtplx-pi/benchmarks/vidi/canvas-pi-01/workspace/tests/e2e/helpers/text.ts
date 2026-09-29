/**
 * Story 9 · task 10 — e2e helpers for free text. Reads the rendered text
 * objects straight from the DOM (position + size + painted content) so the
 * tests assert what is drawn, not an internal model. A text object is marked by
 * `data-text-id`; its editor/toolbar/counter are nested inside and excluded.
 */
import type { Page } from '@playwright/test';

export interface TextBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  editing: boolean;
  /** Painted read-mode text (empty while editing). */
  text: string;
}

/** Wait for a camera / DOM commit (no fixed sleep dependency downstream). */
export async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(140);
}

/** All text objects currently painted, in paint order. */
export async function texts(page: Page): Promise<TextBlock[]> {
  return page.evaluate(() => {
    const out: TextBlock[] = [];
    document.querySelectorAll<HTMLElement>('[data-text-id]').forEach((html) => {
      const id = html.getAttribute('data-text-id') ?? '';
      const editor = html.querySelector('textarea');
      const display = html.querySelector('.text-display');
      const rect = html.getBoundingClientRect();
      out.push({
        id,
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        editing: Boolean(editor),
        text: display ? (display.textContent ?? '') : '',
      });
    });
    return out;
  });
}

/** Pick the Text tool from the left toolbar (click). */
export async function selectTextTool(page: Page): Promise<void> {
  await page.getByTestId('tool-text').click();
}
