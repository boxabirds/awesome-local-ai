import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createAndGotoBoard } from './helpers/create-board';
import {
  getTextObjects,
  getTextIds,
  createTextByTool,
  getTextEditor,
  startEditingText,
  getTextScreenBox,
  getTextDisplay,
  getTextDocState,
  getTextToolbarFor,
  getSelectToolButton,
} from './helpers/text';
import { openParticipants, closeParticipants, expectWithin, newE2eBoardId } from './helpers/participants';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '@shared/config';
import { PROSE_1000 } from '../fixtures/texts';

const within = expectWithin(8_000);
const wide = expectWithin(12_000);

const LONG_LINE =
  'The quick brown fox jumps over the lazy dog while the team reviews the quarterly plan together on the board';

test.describe('Write free text anywhere on the board', () => {
  test('TC-26: Text tool (T) creates text, typing lands, S/M/L/XL resize without moving it', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createTextByTool(page, 400, 300);
    expect(id).toBeTruthy();
    await expect(getTextEditor(page)).toBeVisible();

    await page.keyboard.type('Q3 planning');
    await page.keyboard.press('Escape');

    // Text is kept and the object stays selected (toolbar showing).
    await expect(getTextDisplay(page, id)).toHaveText('Q3 planning');
    await expect(getTextToolbarFor(page, id)).toBeVisible();

    const before = await getTextDocState(page, id);
    expect(before!.size).toBe('M');
    const boxBefore = await getTextScreenBox(page, id);

    await getTextToolbarFor(page, id).locator('[data-testid="text-size-XL"]').click();

    const after = await getTextDocState(page, id);
    expect(after!.size).toBe('XL');

    // Rendered font size matches the XL size; the object did not move.
    const fontPx = await getTextDisplay(page, id).evaluate((el) =>
      parseFloat(getComputedStyle(el.parentElement!).fontSize),
    );
    expect(fontPx).toBe(TEXT_SIZES.XL);

    const boxAfter = await getTextScreenBox(page, id);
    expect(Math.abs(boxAfter.x - boxBefore.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxAfter.y - boxBefore.y)).toBeLessThanOrEqual(1);
  });

  test('TC-27: a long annotation auto-grows to a max width then wraps (no clipping)', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createTextByTool(page, 200, 120);
    await page.keyboard.insertText(PROSE_1000);
    await page.keyboard.press('Escape');

    const doc = await getTextDocState(page, id);
    expect(doc!.text.length).toBeGreaterThanOrEqual(900);
    expect(doc!.widthMode).toBe('auto');
    expect(doc!.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 1);

    // On screen (zoom 1) the box respects the max width and is tall (wrapped many lines).
    const box = await getTextScreenBox(page, id);
    expect(box.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2);
    expect(box.height).toBeGreaterThan(300);

    // The whole string is present and nothing overflows the box.
    await expect(getTextDisplay(page, id)).toHaveText(PROSE_1000);
    const clip = await page.locator(`[data-testid="text-object"][data-note-id="${id}"]`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const inner = el.firstElementChild as HTMLElement | null;
      return { overflow: getComputedStyle(el).overflow, scrollH: el.scrollHeight, boxH: r.height, innerText: inner?.textContent ?? '' };
    });
    expect(clip.overflow).toBe('hidden');
    // Content height never exceeds the box (it wrapped, not clipped).
    expect(clip.scrollH).toBeLessThanOrEqual(clip.boxH + 1);
  });

  test('TC-28: abandoned empty text is removed and never recreated by the Select tool', async ({ page }) => {
    await createAndGotoBoard(page);

    await createTextByTool(page, 500, 400);
    await expect(getTextEditor(page).first()).toBeVisible();

    // Escape with nothing typed → object removed, selection cleared.
    await page.keyboard.press('Escape');
    await expect(getTextObjects(page)).toHaveCount(0);
    expect(await page.locator('[data-testid="text-editor"]').count()).toBe(0);

    // Switching to Select and clicking creates nothing.
    await getSelectToolButton(page).click();
    await page.mouse.click(500, 400);
    await expect(getTextObjects(page)).toHaveCount(0);
  });

  test('TC-29: two people edit one text object concurrently → identical merged text', async ({ browser }) => {
    const [a, b] = await openParticipants(browser, newE2eBoardId(), 2);
    try {
      const id = await createTextByTool(a.page, 400, 300);
      await a.page.keyboard.type('base');
      await a.page.keyboard.press('Escape');

      await within(async () => (await getTextDisplay(b.page, id).textContent()) ?? '').toBe('base');

      await startEditingText(a.page, id);
      await startEditingText(b.page, id);

      const left = 'AAA';
      const right = 'BBB';
      for (let i = 0; i < left.length; i++) {
        await a.page.keyboard.type(left[i], { delay: 20 });
        await b.page.keyboard.type(right[i], { delay: 20 });
      }

      await wide(async () => {
        const ta = (await getTextDocState(a.page, id))!.text;
        const tb = (await getTextDocState(b.page, id))!.text;
        return ta === tb ? ta : null;
      }).not.toBeNull();

      const final = (await getTextDocState(a.page, id))!.text;
      expect(final).toContain('base');
      expect(final.split('A').length - 1).toBe(3);
      expect(final.split('B').length - 1).toBe(3);
    } finally {
      await closeParticipants([a, b]);
    }
  });

  test('TC-30: single text shows only E/W handles; dragging one fixes width and rewraps (font unchanged)', async ({ page }) => {
    await createAndGotoBoard(page);

    const id = await createTextByTool(page, 200, 150);
    await page.keyboard.type(LONG_LINE);
    await page.keyboard.press('Escape');

    // Horizontal-only handles.
    await expect(page.locator('[data-testid="handle-e"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="handle-w"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="handle-n"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="handle-s"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="handle-se"]')).toHaveCount(0);

    const before = await getTextDocState(page, id);
    expect(before!.widthMode).toBe('auto');
    const fontBefore = await getTextDisplay(page, id).evaluate((el) =>
      parseFloat(getComputedStyle(el.parentElement!).fontSize),
    );

    // Drag the right (E) handle to the left to narrow the box.
    const handle = page.locator('[data-testid="handle-e"]');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 120, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();

    const after = await getTextDocState(page, id);
    expect(after!.widthMode).toBe('fixed');
    expect(after!.width).toBeLessThan(before!.width);
    // Narrower box → taller (words wrapped onto more lines).
    expect(after!.height).toBeGreaterThan(before!.height);
    // Text and font size are untouched by resizing.
    expect(after!.text).toBe(before!.text);
    const fontAfter = await getTextDisplay(page, id).evaluate((el) =>
      parseFloat(getComputedStyle(el.parentElement!).fontSize),
    );
    expect(fontAfter).toBe(fontBefore);
  });
});
