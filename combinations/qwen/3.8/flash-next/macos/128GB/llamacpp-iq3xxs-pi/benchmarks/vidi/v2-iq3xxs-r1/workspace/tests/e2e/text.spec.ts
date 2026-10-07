import { expect, test, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  closeScreens,
  gotoNewBoard,
  openScreen,
  waitForSynced,
} from './helpers/sync';
import { marqueeSelect, pressDelete, selectedIds } from './helpers/selection';
import {
  clickText,
  createTextWithTool,
  dragSideHandle,
  dragText,
  endTextEdit,
  editText,
  renderedLineCount,
  renderedText,
  renderedTextHeight,
  seedText,
  sizeButton,
  textById,
  textSnapshots,
  waitForTextCount,
} from './helpers/text';

/**
 * Story 9 — "Write free text anywhere on the board" (TC-26 to TC-31).
 *
 * Free text has no box of its own in the DOM: the object's `width` and `height` come
 * from the shared document and the browser only paints them. So these tests type the
 * way a person types and then compare the numbers in the document with the numbers the
 * browser actually drew — a box that only exists in the model, or only on screen, fails.
 */

/** A sentence with spaces in it, longer than the automatic width can hold. */
const LONG_SENTENCE = [
  'we reorganised the onboarding checklist around the first session, moved the',
  'invite emails to day two, and everyone agreed the empty board needs one obvious',
  'next step rather than a tour that nobody finishes',
].join(' ').repeat(2);

/** Screens to close whatever happens in a test. */
class Screens {
  private readonly pages: Page[] = [];

  add<T extends Page>(page: T): T {
    this.pages.push(page);
    return page;
  }

  all(): Page[] {
    return [...this.pages];
  }

  async close(): Promise<void> {
    await closeScreens(this.pages);
    this.pages.length = 0;
  }
}

/** Another screen on the same board, in its own context. */
async function join(page: Page, boardId: string): Promise<Page> {
  const screen = await openScreen(page, new URL(`/b/${boardId}`, page.url()).toString());
  await waitForSynced(screen);
  return screen;
}

const pressUndo = (page: Page) => page.keyboard.press('Control+z');

test.describe('free text on the board (TC-26 to TC-31)', () => {
  test('TC-26 types a long annotation and the box stops growing sideways', async ({ page }) => {
    const screens = new Screens();
    screens.add(page);
    try {
      await gotoNewBoard(page);
      await waitForSynced(page);

      const id = await createTextWithTool(page, { x: 460, y: 300 });
      expect(LONG_SENTENCE.length).toBeGreaterThan(300);
      await page.keyboard.type(LONG_SENTENCE);
      await endTextEdit(page);

      const text = await textById(page, id);
      expect(text).not.toBeNull();
      expect(text!.text.replace(/\s+/g, ' ').trim().length).toBeGreaterThan(300);
      // Automatic width grows to its limit and no further (PRD text.auto_width).
      expect(text!.widthMode).toBe('auto');
      expect(Math.abs(text!.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
      // From here on it grows downwards: more than one line, in the document and on screen.
      const oneLine = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
      expect(text!.height).toBeGreaterThan(oneLine + 1);
      expect(await renderedLineCount(page, id)).toBeGreaterThan(1);
      expect(await renderedText(page, id)).toContain('reorganised');

      // What the document says is what was drawn, at zoom 1 and to the pixel.
      const drawn = await page
        .locator(`[data-text-id="${id}"]`)
        .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
      expect(Math.abs(drawn.width - text!.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(drawn.height - text!.height)).toBeLessThanOrEqual(1);
      // And the painted lines fill that height rather than overflowing it.
      expect(Math.abs((await renderedTextHeight(page, id)) - text!.height)).toBeLessThanOrEqual(4);
    } finally {
      await screens.close();
    }
  });

  test('TC-27 drags the side handle and the words re-wrap inside the new width', async ({
    page,
  }) => {
    const screens = new Screens();
    screens.add(page);
    try {
      await gotoNewBoard(page);
      await waitForSynced(page);

      const id = await seedText(
        page,
        { x: 460, y: 300 },
        'narrow the box and the sentence takes more lines',
      );
      const before = await textById(page, id);
      expect(before).not.toBeNull();
      expect(before!.widthMode).toBe('auto');
      const heightOfOneLine = before!.height;

      await clickText(page, id);
      // A text is resized sideways only: no top, bottom or corner handles at all.
      await expect(page.getByTestId('handle-e')).toBeVisible();
      await expect(page.getByTestId('handle-w')).toBeVisible();
      for (const forbidden of ['handle-n', 'handle-s', 'handle-ne', 'handle-nw', 'handle-se', 'handle-sw']) {
        await expect(page.getByTestId(forbidden)).toHaveCount(0);
      }

      await dragSideHandle(page, 'e', -180);

      const after = await textById(page, id);
      expect(after).not.toBeNull();
      expect(after!.widthMode).toBe('fixed'); // PRD text.fixed_width
      expect(Math.abs(after!.width - (before!.width - 180))).toBeLessThanOrEqual(6);
      expect(after!.height).toBeGreaterThan(heightOfOneLine + 1);
      // Only the right edge moved.
      expect(after!.x).toBeCloseTo(before!.x, 0);
      expect(after!.y).toBeCloseTo(before!.y, 0);
      expect(await renderedLineCount(page, id)).toBeGreaterThan(1);
      // The narrower box is what is drawn.
      const drawn = await page
        .locator(`[data-text-id="${id}"]`)
        .evaluate((el) => ({ width: el.clientWidth, height: el.clientHeight }));
      expect(Math.abs(drawn.width - after!.width)).toBeLessThanOrEqual(1);
    } finally {
      await screens.close();
    }
  });

  test('TC-28 makes a heading, moves it, deletes it, and gets it back', async ({ page }) => {
    const screens = new Screens();
    screens.add(page);
    try {
      await gotoNewBoard(page);
      await waitForSynced(page);

      // Title a retro section (design "E2E scenario 1").
      const id = await createTextWithTool(page, { x: 480, y: 260 });
      await page.keyboard.type('Retro 2024-06');
      const placed = await textById(page, id); // where the click put its top-left
      // Escape leaves the typing but keeps the text selected, so the toolbar is up.
      await page.keyboard.press('Escape');
      await expect(sizeButton(page, 'XL')).toBeVisible();
      expect((await textById(page, id))!.widthMode).toBe('auto');

      await sizeButton(page, 'XL').click();
      const heading = await textById(page, id);
      expect(heading).toMatchObject({ size: 'XL', text: 'Retro 2024-06' });
      // The top-left does not move when the size changes (PRD text.size): it is where
      // the click put it, read back from the object rather than assumed about the camera.
      expect(heading!.x).toBe(placed!.x);
      expect(heading!.y).toBe(placed!.y);
      const widthAtXL = heading!.width;
      expect(widthAtXL).toBeGreaterThan(0);

      // Drag it somewhere else with the pointer, on the text itself.
      await dragText(page, id, 120, 60);
      const moved = await textById(page, id);
      expect(moved!.x).toBeCloseTo(heading!.x + 120, 0);
      expect(moved!.y).toBeCloseTo(heading!.y + 60, 0);

      // Delete it, then bring it back exactly as it was.
      await clickText(page, id);
      await pressDelete(page);
      await waitForTextCount(page, 0);

      await pressUndo(page);
      await expect
        .poll(async () => (await textSnapshots(page)).length, { timeout: 5_000 })
        .toBe(1);
      const restored = await textById(page, id);
      expect(restored).toMatchObject({
        text: 'Retro 2024-06',
        size: 'XL',
        width: widthAtXL,
      });
      expect(restored!.x).toBeCloseTo(moved!.x, 0);
      expect(restored!.y).toBeCloseTo(moved!.y, 0);
      expect(await renderedText(page, id)).toBe('Retro 2024-06');
    } finally {
      await screens.close();
    }
  });

  test('TC-29 has two people type in one text and keeps every character', async ({ page }) => {
    const screens = new Screens();
    screens.add(page);
    try {
      const boardId = await gotoNewBoard(page);
      await waitForSynced(page);
      const second = screens.add(await join(page, boardId));

      const id = await seedText(page, { x: 500, y: 300 }, 'Retro');
      await expect
        .poll(async () => (await textSnapshots(second)).length, { timeout: 5_000 })
        .toBe(1);

      // Both click into the same text (PRD live.concurrent_text).
      await editText(page, id);
      await editText(second, id);

      // Keystrokes arrive interleaved, one pair at a time.
      const mine = 'abcde';
      const theirs = '12345';
      for (let i = 0; i < mine.length; i++) {
        await Promise.all([page.keyboard.type(mine[i]!), second.keyboard.type(theirs[i]!)]);
      }
      await page.keyboard.press('Escape');
      await second.keyboard.press('Escape');

      // Convergence is what a Yjs document promises: every keystroke of both people,
      // in one text that both screens see the same way. Only the order they landed in
      // is theirs to decide, so this waits for the two screens to agree and then
      // compares the characters, not the string.
      const everyCharacter = [...mine, ...theirs].sort().join('');
      await expect
        .poll(
          async () => {
            const here = await textById(page, id);
            const there = await textById(second, id);
            if (!here || !there || here.text !== there.text) return 'the screens differ';
            if (!here.text.startsWith('Retro')) return 'the first word was lost';
            return [...here.text.slice('Retro'.length)].sort().join('');
          },
          { timeout: 15_000 },
        )
        .toBe(everyCharacter);

      // And both screens drew the text they both hold.
      const painted = 'Retro'.length + mine.length + theirs.length;
      for (const screen of [page, second]) {
        await expect
          .poll(async () => (await renderedText(screen, id)).length, { timeout: 5_000 })
          .toBe(painted);
      }
    } finally {
      await screens.close();
    }
  });

  test('TC-30 lets every screen create a heading at the same time', async ({ page }) => {
    test.setTimeout(120_000);
    const screens = new Screens();
    screens.add(page);
    try {
      const boardId = await gotoNewBoard(page);
      await waitForSynced(page);

      // One screen per concurrent editor, all on one board.
      const others: Page[] = [];
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        others.push(screens.add(await join(page, boardId)));
      }
      const all = [page, ...others];
      expect(all).toHaveLength(MAX_CONCURRENT_EDITORS);

      // Distinct spots, so a heading is never written on top of another.
      const spots = [
        { x: 360, y: 220 },
        { x: 900, y: 220 },
        { x: 360, y: 460 },
        { x: 900, y: 460 },
        { x: 620, y: 340 },
      ].slice(0, MAX_CONCURRENT_EDITORS);

      // Everybody presses T and clicks at once.
      await Promise.all(
        all.map(async (screen, i) => {
          const id = await createTextWithTool(screen, spots[i]!);
          await screen.keyboard.type(`heading ${i + 1}`);
          await endTextEdit(screen);
          return id;
        }),
      );

      // Every screen sees every heading, on every other screen (PRD text.create).
      for (const screen of all) {
        await expect
          .poll(async () => (await textSnapshots(screen)).length, { timeout: 10_000 })
          .toBe(MAX_CONCURRENT_EDITORS);
      }
      const onFirst = await textSnapshots(page);
      const texts = onFirst.map((t) => t.text).sort();
      expect(texts).toEqual(
        Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `heading ${i + 1}`).sort(),
      );
      // Distinct objects: nobody's heading was overwritten by somebody else's.
      expect(new Set(onFirst.map((t) => t.id)).size).toBe(MAX_CONCURRENT_EDITORS);
      const everyone = await textSnapshots(all[1]!);
      expect(everyone.map((t) => t.id).sort()).toEqual(onFirst.map((t) => t.id).sort());
    } finally {
      await screens.close();
    }
  });

  test('TC-31 leaves nothing behind when a text is abandoned empty', async ({ page }) => {
    const screens = new Screens();
    screens.add(page);
    try {
      await gotoNewBoard(page);
      await waitForSynced(page);

      const id = await createTextWithTool(page, { x: 600, y: 320 });
      expect(await textById(page, id)).not.toBeNull();

      // Escape without a single character: the object is gone, not hidden.
      await endTextEdit(page);
      await waitForTextCount(page, 0);
      await expect(page.locator(`[data-text-id="${id}"]`)).toHaveCount(0);

      // A rubber band over the area it was in selects nothing, because nothing is there.
      await marqueeSelect(page, { x: 520, y: 240 }, { x: 780, y: 420 });
      expect(await selectedIds(page)).toHaveLength(0);
      expect(await textSnapshots(page)).toHaveLength(0);
    } finally {
      await screens.close();
    }
  });
});
