import { expect, test } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { TEXT_ANNOTATION } from '../fixtures/texts';
import { near, openBoard } from './helpers/board';
import { joinBoard, newLiveBoardId, trackErrors } from './helpers/live';
import { createNotesAt, dragHandle, marqueeSelect, selectedIds, setFlatCamera } from './helpers/selection';
import {
  clickDeleteText,
  clickTextSize,
  dragTextBy,
  getTexts,
  lineHeightOf,
  pressTextTool,
  renderedLineCount,
  selectionHandles,
  textCard,
  textContent,
  textOf,
  waitForSameTexts,
  waitForText,
  waitForTextCount,
  writeTextWithTool,
} from './helpers/text';

/**
 * Story 9 - free text anywhere on the board, in real browsers (task 10).
 *
 * Everything here goes through the product: the Text tool from the keyboard, a real
 * click, real typing with a real font, a real handle drag, and the real sync server
 * for the cases with more than one screen. Document state is read through the
 * test-only `window.__vidi6` hooks so the assertions are about what the board holds
 * and what it drew, not about how the code got there.
 *
 * Anchors: `text.tool_ui` (the tool and its shortcuts) and `text.object` (the object,
 * its wrapping, its sizes, its handles and its removal when abandoned). TC-26 to TC-31.
 */

const HEADING = 'Went well';

/** Is `needle` a subsequence of `haystack` - its characters, in order? */
function inOrder(haystack: string, needle: string): boolean {
  let at = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, at);
    if (found < 0) {
      return false;
    }
    at = found + 1;
  }
  return true;
}

/** How many of each character a string holds. */
function characterCounts(text: string): string {
  const counts = new Map<string, number>();
  for (const character of text) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  return [...counts.entries()].sort().map(([character, count]) => `${character}:${count}`).join(',');
}

test.describe('story 9: free text on the board', () => {
  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    // Board units and screen pixels become the same number, so a drag can be
    // stated in board units.
    await setFlatCamera(page);
  });

  test('TC-26: a long annotation wraps at the automatic maximum and grows lines', async ({
    page,
  }) => {
    const id = await writeTextWithTool(page, { x: 100, y: 120 }, TEXT_ANNOTATION);

    // The editor is open, because the click started the text and typing has not
    // stopped it.
    await expect(page.getByTestId('text-editor')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('text-editor')).toHaveCount(0);

    const stored = await textOf(page, id);
    expect(stored.text).toBe(TEXT_ANNOTATION);
    // `text.auto_width`: as wide as the board allows and no wider.
    expect(near(stored.width, TEXT_MAX_AUTO_WIDTH_WORLD, 2)).toBe(true);

    // Several lines, drawn as well as stored (`text.height`).
    const lines = await renderedLineCount(page, id);
    expect(lines).toBeGreaterThanOrEqual(3);
    const storedLines = Math.round(stored.height / lineHeightOf('M'));
    expect(storedLines).toBeGreaterThanOrEqual(3);
    expect(Math.abs(storedLines - lines)).toBeLessThanOrEqual(1);

    // The drawn box is the stored box, at zoom 1 one board unit to the pixel.
    const drawn = await textCard(page, id).boundingBox();
    if (!drawn) {
      throw new Error('the text object was not drawn');
    }
    expect(near(drawn.width, stored.width, 2)).toBe(true);
    expect(near(drawn.height, stored.height, 2)).toBe(true);

    // The size is the default one, and the width is still content-derived.
    expect(stored.size).toBe('M');
    expect(stored.widthMode).toBe('auto');
    expect(stored.text.length).toBe(TEXT_ANNOTATION.length);
  });

  test('TC-27: dragging the right handle narrower rewraps the words and grows the height', async ({
    page,
  }) => {
    const id = await writeTextWithTool(
      page,
      { x: 80, y: 100 },
      'Grouping similar notes next to each other turned a messy hour into a clear plan.',
    );
    await page.keyboard.press('Escape');

    // Selected text has sideways handles and nothing else (`text.fixed_width`).
    expect((await selectionHandles(page)).sort()).toEqual(['e', 'w']);

    const before = await textOf(page, id);
    expect(before.widthMode).toBe('auto');

    await dragHandle(page, 'e', -220, 0);

    const after = await textOf(page, id);
    expect(after.widthMode).toBe('fixed');
    expect(near(after.width, before.width - 220, 3)).toBe(true);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.text).toBe(before.text);
    expect(after.size).toBe('M');

    // The words really did rewrap on the screen, in a narrower box.
    const lines = await renderedLineCount(page, id);
    expect(lines).toBeGreaterThanOrEqual(2);
    expect(near(after.height, Math.round(after.height / lineHeightOf('M')) * lineHeightOf('M'), 1)).toBe(
      true,
    );

    // Still no top or bottom handle, before or after the drag (`text.height`).
    const handles = await selectionHandles(page);
    expect(handles).not.toContain('n');
    expect(handles).not.toContain('s');
    expect(handles.sort()).toEqual(['e', 'w']);
  });

  test('TC-28: a title for a retro section - write it, size it, move it, delete it, bring it back', async ({
    page,
  }) => {
    const cluster = await createNotesAt(page, [
      { x: 260, y: 360 },
      { x: 420, y: 360 },
      { x: 260, y: 520 },
      { x: 420, y: 520 },
    ]);

    // Write the heading above the cluster with the Text tool.
    const id = await writeTextWithTool(page, { x: 220, y: 140 }, HEADING);
    await page.keyboard.press('Escape');

    // Make it a heading.
    await clickTextSize(page, 'XL');
    const sized = await textOf(page, id);
    expect(sized.size).toBe('XL');
    expect(sized.text).toBe(HEADING);
    expect(near(sized.height, lineHeightOf('XL'), 1)).toBe(true);

    // Move it over the cluster it titles.
    const before = await textOf(page, id);
    await dragTextBy(page, id, 120, 160);
    const moved = await textOf(page, id);
    expect(near(moved.x, before.x + 120, 2)).toBe(true);
    expect(near(moved.y, before.y + 160, 2)).toBe(true);
    await expect(textContent(page, id)).toHaveText(HEADING);

    // Delete it, and bring it back.
    await clickDeleteText(page);
    await waitForText(page, id, false);
    expect(await getTexts(page)).toHaveLength(0);

    await page.keyboard.press('Control+z');
    await waitForText(page, id, true);
    const restored = await textOf(page, id);
    expect(restored.text).toBe(HEADING);
    expect(restored.size).toBe('XL');
    expect(near(restored.x, moved.x, 1)).toBe(true);
    expect(near(restored.y, moved.y, 1)).toBe(true);
    await expect(textContent(page, id)).toHaveText(HEADING);

    // The notes were never part of any of this.
    expect(await getTexts(page)).toHaveLength(1);
    const notes = await page.evaluate(() => window.__vidi6?.notes().length ?? 0);
    expect(notes).toBe(cluster.length);
  });

  test('TC-29: two people typing into the same text end up with the same words', async ({
    browser,
  }) => {
    const boardId = newLiveBoardId();
    const context = await browser.newContext();

    const first = await joinBoard(context, boardId);
    const second = await joinBoard(context, boardId);
    const errors = [...trackErrors(first), ...trackErrors(second)];

    await setFlatCamera(first);
    await setFlatCamera(second);

    // One person starts the sentence.
    const id = await writeTextWithTool(first, { x: 200, y: 200 }, 'Retro: ');
    await first.keyboard.press('Escape');
    // Both people have to be typing into the same object, so the object has to be on
    // both boards first. The seed text itself is deliberately not waited for: one
    // person's typing arrives character by character, and a merge is a merge whether
    // or not the second screen has every seed character yet. What the test asserts
    // below is true either way - both screens end identical, and nobody's characters
    // are lost or reordered.
    await waitForText(first, id, true);
    await waitForText(second, id, true);

    // Both open the same text and both type, at the same time.
    const centre = await textCard(second, id).boundingBox();
    if (!centre) {
      throw new Error('the text object is not drawn on the second screen');
    }
    await second.mouse.dblclick(centre.x + 10, centre.y + 10);
    await second.waitForSelector('[data-testid="text-editor"]');
    await first.mouse.dblclick(
      (await textCard(first, id).boundingBox())!.x + 10,
      (await textCard(first, id).boundingBox())!.y + 10,
    );
    await first.waitForSelector('[data-testid="text-editor"]');

    await Promise.all([
      first.keyboard.type('everyone brought an example'),
      second.keyboard.type('the rounds were timeboxed'),
    ]);

    // Both people finish.
    await first.keyboard.press('Escape');
    await second.keyboard.press('Escape');

    // Every screen ends with the same text, holding both people's characters.
    // Two people typing into one `Y.Text` at the same time is a genuine merge: each
    // person's characters keep their order, and whose word lands in front is the
    // merge's choice, not the product losing a character (`text.concurrent`).
    const texts = await waitForSameTexts([first, second]);
    expect(texts).toHaveLength(1);
    const merged = texts[0]!.text;
    const mine = 'everyone brought an example';
    const theirs = 'the rounds were timeboxed';

    expect(inOrder(merged, mine)).toBe(true);
    expect(inOrder(merged, theirs)).toBe(true);
    // Nothing was lost and nothing was doubled: the merged text holds exactly the
    // seed plus both people's characters, and each person's own words keep their
    // order inside it.
    expect(merged.length).toBe('Retro: '.length + mine.length + theirs.length);
    expect(characterCounts(merged)).toEqual(
      characterCounts(`Retro: ${mine}${theirs}`),
    );

    // And it is the same on the screen, not only in the model.
    const drawnFirst = await textContent(first, id).textContent();
    const drawnSecond = await textContent(second, id).textContent();
    expect(drawnFirst).toBe(drawnSecond);
    expect(drawnFirst).toBe(merged);

    for (const page of [first, second]) {
      await page.close();
    }
    expect(errors.flat()).toEqual([]);
  });

  test('TC-30: every person can start writing at the same moment and all see each other', async ({
    browser,
  }) => {
    const boardId = newLiveBoardId();
    const context = await browser.newContext();
    const pages = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
      pages.push(await joinBoard(context, boardId));
    }
    const errors = pages.map((page) => trackErrors(page));
    for (const page of pages) {
      await setFlatCamera(page);
    }

    const headings = ['Went well', 'To improve', 'Actions', 'Open questions', 'Thank you'];

    // All of them hold the Text tool and click, at the same time.
    await Promise.all(
      pages.map(async (page, index) => {
        await writeTextWithTool(page, { x: 120 + index * 100, y: 120 + index * 40 }, headings[index]!);
        await page.keyboard.press('Escape');
      }),
    );

    // Every screen shows every heading, and the boards are identical.
    for (const page of pages) {
      await waitForTextCount(page, MAX_CONCURRENT_EDITORS);
    }
    const texts = await waitForSameTexts(pages);
    expect(texts.map((entry) => entry.text).sort()).toEqual([...headings].sort());

    for (const page of pages) {
      for (const entry of texts) {
        await expect(textContent(page, entry.id)).toHaveText(entry.text);
        await expect(textCard(page, entry.id)).toBeVisible();
      }
    }

    expect(errors.flat()).toEqual([]);
    await Promise.all(pages.map((page) => page.close()));
  });

  test('TC-31: text that was started and left empty is not left on the board', async ({ page }) => {
    const errors = trackErrors(page);

    await pressTextTool(page);
    await page.mouse.click(400, 300);
    await page.waitForSelector('[data-testid="text-editor"]');
    // Nothing typed, and the person leaves.
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('text-editor')).toHaveCount(0);
    expect(await getTexts(page)).toHaveLength(0);
    await expect(page.locator('[data-testid^="text-object-"]')).toHaveCount(0);

    // The spot it was drawn on holds nothing to select: a marquee over it selects
    // nothing, and no selection UI is left behind.
    await marqueeSelect(page, { x: 330, y: 240 }, { x: 520, y: 380 });
    expect(await selectedIds(page)).toHaveLength(0);
    await expect(page.locator('[data-testid="selection-overlay"]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test('a heading keeps its size while it is being edited, and the board stays clean', async ({
    page,
  }) => {
    const id = await writeTextWithTool(page, { x: 150, y: 150 }, 'A heading that is quite long');

    // The size changes under the open editor and the text re-wraps (`text.sizes`).
    await clickTextSize(page, 'XL');
    const grown = await textOf(page, id);
    expect(grown.size).toBe('XL');
    expect(grown.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(grown.height).toBe(
      Math.round(grown.height / lineHeightOf('XL')) * lineHeightOf('XL'),
    );

    await page.keyboard.press('Escape');
    expect(await renderedLineCount(page, id)).toBeGreaterThanOrEqual(1);

    await page.keyboard.press('Control+z');
    const back = await textOf(page, id);
    expect(back.size).toBe('M');
    expect(back.text).toBe('A heading that is quite long');

    expect(TEXT_SIZES.M).toBeLessThan(TEXT_SIZES.XL);
    expect(TEXT_LINE_HEIGHT).toBeGreaterThan(1);
  });
});
