/**
 * Story 9 end to end: writing free text anywhere on the board.
 *
 * The heart of every case here is the same pair of facts, because text is the first
 * object whose size is *derived*: the words on the screen, and the box the document
 * holds for them. A board where two people see the same words in different boxes is
 * not a shared board, so the two-screen tests compare both, and the single-screen
 * ones compare what is drawn with what is stored.
 *
 * TC-26 two screens, same words, same box · TC-27 a reload keeps position, preset
 * and width mode · TC-28 the 5,000-character limit · TC-29 two people typing in one
 * text keep every character · TC-30 the automatic width grows then wraps at the cap
 * · TC-31 dragging an edge fixes the width, and one undo gives it back.
 */

import { expect, test } from './helpers/live';
import type { Page } from '@playwright/test';
import {
  changeArrives,
  expectNoErrors,
  type Participant,
} from './helpers/live';
import {
  expectNoPendingCameraFrame,
  openBoard,
  setCamera,
  withinTolerance,
} from './helpers/board';
import {
  createTextByShortcut,
  createTextByTool,
  editText,
  endTextEditing,
  selectText,
  textBoxes,
  getTexts,
  textWords,
  typeIntoText,
} from './helpers/text';
import { TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_MAX_CHARS, TEXT_SIZES } from '../../src/shared/config';

const PEOPLE = ['alex', 'sam'] as const;

test.describe('free text', () => {
  test('workflow: pick the tool, click, type, leave it — a heading is on the board', async ({
    page,
  }) => {
    await openBoard(page);

    // T takes the tool; the board says so.
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const id = await createTextByTool(page, { x: 420, y: 300 });
    await typeIntoText(page, 'What went well');
    await endTextEditing(page);

    const stored = (await getTexts(page)).find((text) => text.id === id)!;
    expect(stored.text).toBe('What went well');
    expect(stored.size).toBe('M');
    expect(stored.widthMode).toBe('auto');
    // Drawn where the document says, in the size the document says.
    const drawn = (await textBoxes(page))[id]!;
    // Its top-left is under the pointer — a heading is placed by the corner the
    // finger chose, not centred on it the way a sticky note is.
    expect(withinTolerance(drawn.x, 420, 2)).toBe(true);
    expect(withinTolerance(drawn.y, 300, 2)).toBe(true);
    expect(withinTolerance(drawn.width, stored.width!, 2)).toBe(true);
    expect(withinTolerance(drawn.height, stored.height!, 2)).toBe(true);
    await expect(page.locator(`[data-object-id="${id}"]`)).toHaveCSS(
      'font-size',
      `${TEXT_SIZES.M}px`,
    );
    // Plain words: no background.
    await expect(page.locator(`[data-object-id="${id}"]`)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    // The tool went back to Select on its own.
    await expect(page.getByRole('button', { name: 'Text (T)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Escape with nothing typed leaves nothing behind either.
    const empty = await createTextByShortcut(page, { x: 700, y: 300 });
    await endTextEditing(page);
    expect((await getTexts(page)).find((text) => text.id === empty)).toBeUndefined();
    expect(await getTexts(page)).toHaveLength(1);
  });

  test('TC-26: two screens see the same words in the same box', async ({ liveBoards }) => {
    const { people } = await liveBoards.open([...PEOPLE]);
    const [alex, sam] = people as [Participant, Participant];

    let id = '';
    await changeArrives(
      'TC-26 create',
      async () => {
        id = await createTextByTool(alex.page, { x: 420, y: 300 });
      },
      async () => (await getTexts(sam.page)).some((text) => text.id === id),
    );

    const words = 'Retro: shipped the board';
    await changeArrives(
      'TC-26 typing',
      async () => {
        await typeIntoText(alex.page, words);
      },
      async () => (await getTexts(sam.page)).find((text) => text.id === id)?.text === words,
    );

    // Both screens, both facts: identical words, and a box that agrees to the
    // board unit, even though each browser measured its own fonts.
    await expect
      .poll(
        async () => {
          const onAlex = await textBoxes(alex.page);
          const onSam = await textBoxes(sam.page);
          const stored = (await getTexts(alex.page)).find((text) => text.id === id)!;
          return (
            withinTolerance(onAlex[id]!.width, onSam[id]!.width, 1) &&
            withinTolerance(onAlex[id]!.height, onSam[id]!.height, 1) &&
            withinTolerance(onSam[id]!.width, stored.width!, 1) &&
            withinTolerance(onSam[id]!.height, stored.height!, 1)
          );
        },
        { timeout: 5_000, message: 'the two screens disagree about the box' },
      )
      .toBe(true);

    expect(await textWords(sam.page, id)).toBe(words);

    // And Sam's screen did not "correct" the box by measuring it again.
    const before = (await getTexts(sam.page)).find((text) => text.id === id)!;
    await sam.page.mouse.move(600, 500);
    await sam.page.mouse.down();
    await sam.page.mouse.move(640, 540);
    await sam.page.mouse.up();
    const after = (await getTexts(sam.page)).find((text) => text.id === id)!;
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);

    expectNoErrors(people);
  });

  test('TC-27: a reload brings back position, size preset, width mode and words', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createTextByTool(page, { x: 500, y: 260 });
    await typeIntoText(page, 'Kept');
    // A bigger preset, then a fixed width from the right edge.
    await endTextEditing(page);
    await selectText(page, id);
    await page.getByRole('button', { name: /Large/ }).click();
    await dragRightEdge(page, id, 160);
    await expect
      .poll(async () => (await getTexts(page)).find((text) => text.id === id)?.widthMode)
      .toBe('fixed');

    const before = (await getTexts(page)).find((text) => text.id === id)!;
    await page.reload();
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    // The board arrives from the room, so the object appears when the load does.
    await expect
      .poll(async () => (await getTexts(page)).some((text) => text.id === id))
      .toBe(true);

    const after = (await getTexts(page)).find((text) => text.id === id)!;
    expect(after.text).toBe(before.text);
    expect(after.size).toBe('L');
    expect(after.widthMode).toBe('fixed');
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  test('TC-28: characters past the limit are not added, and both screens agree', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createTextByTool(page, { x: 420, y: 300 });
    const words = 'x'.repeat(TEXT_MAX_CHARS + 250);

    // Pasted whole: whatever the clipboard brings, the object keeps 5,000.
    await page.getByTestId('text-editor').evaluate((el, value) => {
      const field = el as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, words);

    await expect
      .poll(async () => (await getTexts(page)).find((text) => text.id === id)?.text.length)
      .toBe(TEXT_MAX_CHARS);
    const stored = (await getTexts(page)).find((text) => text.id === id)!;
    expect(stored.text).toHaveLength(TEXT_MAX_CHARS);
    // The words wrap into a box that holds them, and stay on the board.
    expect(stored.height!).toBeGreaterThan(100);
  });

  test('TC-29: two people typing in one text object keep every character', async ({
    liveBoards,
  }) => {
    const { people } = await liveBoards.open([...PEOPLE]);
    const [alex, sam] = people as [Participant, Participant];

    let id = '';
    await changeArrives(
      'TC-29 create',
      async () => {
        id = await createTextByTool(alex.page, { x: 420, y: 300 });
      },
      async () => (await getTexts(sam.page)).some((text) => text.id === id),
    );

    // Sam opens the same text; both cursors are inside it.
    await editText(sam.page, id);
    expect(sam.page.getByTestId('text-editor')).toBeVisible();

    const byAlex = 'alex: shipped ';
    const bySam = 'sam: tested ';
    const everyCharacter = [...(byAlex + bySam)].sort().join('');

    await Promise.all([
      alex.page.getByTestId('text-editor').pressSequentially(byAlex),
      sam.page.getByTestId('text-editor').pressSequentially(bySam),
    ]);

    await expect
      .poll(
        async () => {
          const a = (await getTexts(alex.page)).find((text) => text.id === id)?.text ?? '';
          const s = (await getTexts(sam.page)).find((text) => text.id === id)?.text ?? '';
          return [...a].sort().join('') === everyCharacter && a === s;
        },
        { timeout: 15_000, message: 'concurrent typing did not merge into the same words' },
      )
      .toBe(true);

    // And once the typing stopped, both screens measure the same box for them.
    await expect
      .poll(
        async () => {
          const onAlex = (await textBoxes(alex.page))[id]!;
          const onSam = (await textBoxes(sam.page))[id]!;
          return (
            withinTolerance(onAlex.width, onSam.width, 1) &&
            withinTolerance(onAlex.height, onSam.height, 1)
          );
        },
        { timeout: 5_000 },
      )
      .toBe(true);

    expectNoErrors(people);
  });

  test('TC-30: the automatic width grows with the words, then wraps at the cap', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createTextByTool(page, { x: 200, y: 240 });

    const short = await typeWords(page, id, 'Short');
    expect(short.width!).toBeLessThan(200);

    // Enough words that the line would run past the cap: the width stops there and
    // the height takes up the lines instead.
    const long = await typeWords(
      page,
      id,
      'the quick brown fox jumps over the lazy dog and keeps on running through the whole board',
      true,
    );
    expect(long.width!).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(long.height!).toBeGreaterThan(short.height!);

    const drawn = (await textBoxes(page))[id]!;
    const stored = (await getTexts(page)).find((text) => text.id === id)!;
    expect(withinTolerance(drawn.width, stored.width!, 2)).toBe(true);
    expect(withinTolerance(drawn.height, stored.height!, 2)).toBe(true);
    // Nothing about this looks like a box: the words are still plain words.
    await expect(page.locator(`[data-object-id="${id}"]`)).toHaveCSS('border-width', '0px');
  });

  test('TC-31: dragging an edge fixes the width; one undo gives the automatic width back', async ({
    page,
  }) => {
    await openBoard(page);
    // Zoomed out so a long line of words fits on one screen.
    await setCamera(page, { x: -200, y: 0, zoom: 0.5 });
    const id = await createTextByTool(page, { x: 300, y: 200 });
    await typeWords(
      page,
      id,
      'the quick brown fox jumps over the lazy dog and keeps on running',
    );
    await endTextEditing(page);
    await selectText(page, id);

    // Only the two edges: the height is not anybody's to drag.
    await expect(page.getByTestId('resize-handle-e')).toBeVisible();
    await expect(page.getByTestId('resize-handle-w')).toBeVisible();
    await expect(page.getByTestId('resize-handle-ne')).toHaveCount(0);
    await expect(page.getByTestId('resize-handle-s')).toHaveCount(0);

    const before = (await getTexts(page)).find((text) => text.id === id)!;
    expect(before.widthMode).toBe('auto');

    const linesBefore = Math.round(before.height! / (TEXT_SIZES.M * 1.3));
    // Narrower: same words, more lines.
    await dragRightEdge(page, id, -240);

    const dragged = (await getTexts(page)).find((text) => text.id === id)!;
    expect(dragged.widthMode).toBe('fixed');
    expect(dragged.x).toBe(before.x);
    expect(dragged.y).toBe(before.y);
    expect(dragged.width!).toBeLessThan(before.width!);
    expect(Math.round(dragged.height! / (TEXT_SIZES.M * 1.3))).toBeGreaterThan(linesBefore);

    // One undo, and the object is auto-width again — not a step that only half
    // reverted.
    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => (await getTexts(page)).find((text) => text.id === id)?.widthMode)
      .toBe('auto');
    const restored = (await getTexts(page)).find((text) => text.id === id)!;
    expect(restored.width).toBe(before.width);
    expect(restored.height).toBe(before.height);
  });
});

/**
 * Put a whole phrase into a text object and read it back.
 *
 * Opens the object first unless this page is already typing in it, so a test can
 * add to text that is already on the board.
 */
async function typeWords(page: Page, id: string, words: string, replace = false) {
  if (!(await page.getByTestId('text-editor').isVisible().catch(() => false))) {
    await editText(page, id);
  }
  if (replace) {
    // Start from nothing: the words this test measures are exactly the ones below.
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
  }
  await typeIntoText(page, words);
  await endTextEditing(page);
  const stored = (await getTexts(page)).find((text) => text.id === id)!;
  expect(stored.text).toBe(words);
  return stored;
}

/**
 * Drag the right edge of a text object by `dx` screen pixels.
 *
 * The handle is small and the object's height changes while the drag runs, so the
 * press is aimed at the centre of the edge as it is at the start.
 */
async function dragRightEdge(page: Page, id: string, dx: number) {
  const handle = page.getByTestId('resize-handle-e');
  const box = await handle.boundingBox();
  if (!box) throw new Error(`text ${id} has no right edge handle on screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 4 });
  await page.mouse.move(from.x + dx, from.y, { steps: 4 });
  await page.mouse.up();
  await expectNoPendingCameraFrame(page);
}
