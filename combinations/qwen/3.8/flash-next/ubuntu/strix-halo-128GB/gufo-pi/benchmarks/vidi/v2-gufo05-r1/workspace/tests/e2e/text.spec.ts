/**
 * Free text in the browser (story 9): the workflows the component tests can only imitate,
 * with real font layout, real pointer drags and more than one person on the board.
 *
 * What is checked here is the thing only a browser can say — that the box stored in the
 * document is the box the words were painted inside. jsdom measures nothing, so every
 * width in the component suite comes from the board's estimate; here it comes from the
 * font.
 *
 * TC-26 a long annotation wraps at the maximum width and grows downwards
 * TC-27 dragging the east handle narrows the column, the words re-wrap, and there is no
 *         handle on the top or the bottom to do anything else
 * TC-28 the golden path: a heading in XL, moved, deleted, and brought back by Ctrl+Z
 * TC-29 two people typing into one piece of text at the same time lose nothing
 * TC-30 everybody on a full board writes a heading at once and all of them arrive
 * TC-31 a click that is never written into leaves nothing on the board
 */
import { expect, test, type Page } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS, TEXT_MAX_AUTO_WIDTH_WORLD, TEXT_SIZES } from '../../src/shared/config';
import { openFreshBoard, withinTolerance, type ScreenPoint } from './helpers/board';
import { PROSE_LIMIT } from '../fixtures/texts';
import { dragFrom } from './helpers/stickies';
import {
  armTextTool,
  dragTextHandle,
  editText,
  handleIds,
  paintedFontSize,
  paintedLineCount,
  paintedText,
  placeText,
  readText,
  readTexts,
  selectText,
  textCount,
  typeIntoText,
  TEXT_EDITOR_SELECTOR,
  TEXT_SELECTOR,
  TEXT_TOOLBAR_SELECTOR,
  waitForBox,
  zoom,
} from './helpers/texts';
import { characterCounts, openBoard } from './helpers/participants';

/** Somewhere on the open board, away from the hint and the controls. */
const POINT: ScreenPoint = { x: 700, y: 380 };

/** Real prose, long enough that no single line can hold it. */
const ANNOTATION = PROSE_LIMIT.slice(0, 300).replace(/\s\S*$/, '');

/** A short sentence: one line at M, and narrow enough to squeeze. */
const SENTENCE = 'Ship the release notes before Friday standup';

/** Wait for two screens to show the same words in the same piece of text. */
async function expectSameText(label: string, first: Page, second: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const [a, b] = await Promise.all([paintedText(first, id), paintedText(second, id)]);
        return a === b ? a : null;
      },
      { message: `${label}: the two screens never showed the same words`, timeout: 15_000 },
    )
    .toBeTruthy();
}

test.describe('workflow: write a heading and a paragraph of plain text', () => {
  test('TC-26 a long annotation wraps at the maximum width and grows downwards', async ({
    page,
  }) => {
    await openFreshBoard(page);

    const id = await placeText(page, POINT);
    const settled = await typeIntoText(page, id, ANNOTATION);
    const scale = await zoom(page);

    // The box stops growing sideways at the maximum and takes the second line instead
    // (`text.auto_width`).
    expect(withinTolerance(settled.width, TEXT_MAX_AUTO_WIDTH_WORLD, 2)).toBe(true);
    // Both stories of that are true at once: the document says several lines, and the
    // layout engine painted them as several lines.
    const lines = await paintedLineCount(page, id);
    expect(lines).toBeGreaterThan(1);
    expect(settled.height).toBeCloseTo(lines * TEXT_SIZES.M * 1.3, 0);
    // And the painted box is the stored one, in pixels.
    expect(withinTolerance(settled.box.width, settled.width * scale, 2)).toBe(true);
    expect(withinTolerance(settled.box.height, settled.height * scale, 2)).toBe(true);
  });

  test('TC-27 the east handle narrows the column; the words wrap and nothing grabs the top', async ({
    page,
  }) => {
    await openFreshBoard(page);

    const id = await placeText(page, POINT);
    const before = await typeIntoText(page, id, SENTENCE);
    expect(before.widthMode).toBe('auto');
    expect(before.length).toBe(SENTENCE.length);

    await page.keyboard.press('Escape');
    await selectText(page, id);
    // Sideways only: a text box has an east and a west handle, and no north or south edge
    // for a person to pull (`text.resize_width`, `text.box`).
    expect(await handleIds(page)).toEqual(['e', 'w']);

    await dragTextHandle(page, 'e', { x: -180, y: 0 });
    const after = await waitForBox(page, id);

    // The width is the one that was dragged to, and it is now a chosen width rather than
    // a measured one.
    expect(after.width).toBeLessThan(before.width);
    expect(withinTolerance(after.width, before.width - 180, 6)).toBe(true);
    expect(after.widthMode).toBe('fixed');
    // The words did not change; they fit themselves into the narrower column, and the box
    // grew by the lines that had to move.
    expect(after.length).toBe(before.length);
    const lines = await paintedLineCount(page, id);
    expect(lines).toBeGreaterThan(1);
    expect(after.height).toBeGreaterThan(before.height);
    expect(after.height).toBeCloseTo(lines * TEXT_SIZES.M * 1.3, 0);
    // The left edge is what was held: the column narrowed towards the pointer, not away.
    expect(after.x).toBeCloseTo(before.x, 0);
  });
});

test.describe('workflow: a heading, a move, a delete, an undo', () => {
  test('TC-28 XL heading, moved, deleted, and restored by Ctrl+Z', async ({ page }) => {
    await openFreshBoard(page);

    const id = await placeText(page, POINT);
    await typeIntoText(page, id, 'Sprint goals');
    await page.keyboard.press('Escape');
    await selectText(page, id);

    await expect(page.locator(TEXT_TOOLBAR_SELECTOR)).toBeVisible();
    await page.getByRole('button', { name: 'Extra large text' }).click();
    const sized = await waitForBox(page, id);
    expect(sized.size).toBe('XL');
    // The browser agrees with the document about how big the words are.
    expect(withinTolerance(await paintedFontSize(page, id), TEXT_SIZES.XL, 1)).toBe(true);

    // Move it: the top-left is the point of the drag, and the box goes with the words.
    const box = await page.locator(`${TEXT_SELECTOR}[data-text-id="${id}"]`).boundingBox();
    if (!box) throw new Error('the heading has no box on screen');
    await dragFrom(page, { x: box.x + 10, y: box.y + box.height - 6 }, { x: 140, y: 90 });
    const moved = await waitForBox(page, id);
    expect(withinTolerance(moved.x, sized.x + 140, 3)).toBe(true);
    expect(withinTolerance(moved.y, sized.y + 90, 3)).toBe(true);
    expect(moved.size).toBe('XL');

    // Delete, and it is gone from this screen.
    await page.keyboard.press('Delete');
    await expect(page.locator(TEXT_SELECTOR)).toHaveCount(0);

    // One Ctrl+Z is one thing: the heading comes back as it was, box and all.
    await page.keyboard.press('Control+z');
    await expect(page.locator(TEXT_SELECTOR)).toHaveCount(1);
    const restored = await waitForBox(page, id);
    expect(await paintedText(page, id)).toBe('Sprint goals');
    expect(restored.size).toBe('XL');
    expect(withinTolerance(restored.x, moved.x, 1)).toBe(true);
    expect(withinTolerance(restored.y, moved.y, 1)).toBe(true);
    expect(restored.height).toBeGreaterThan(TEXT_SIZES.XL);
  });
});

test.describe('workflow: two people in one piece of text', () => {
  test('TC-29 both typing at once keeps every character', async ({ browser }) => {
    const session = await openBoard(browser, 2);
    const alex = session.byName('Alex');
    const sam = session.byName('Sam');

    const id = await placeText(alex.page, { x: 560, y: 340 });
    await alex.page.keyboard.type('Ship it ', { delay: 2 });
    await alex.page.keyboard.press('Escape');

    // Both get into the same piece of text, then type at the same moment.
    await editText(sam.page, id);
    await editText(alex.page, id);
    await Promise.all([
      alex.page.keyboard.type('after the QA pass', { delay: 5 }),
      sam.page.keyboard.type('before the demo', { delay: 5 }),
    ]);

    // They converge on the same words (`sync.merge`), and no keystroke is lost: whichever
    // way the two carets interleaved, every character either person typed is in the result.
    // The order is not asserted — two carets in one run of text interleave, and a board
    // that forced one person's words to stay whole would have to move the other person's
    // caret, which is a worse way to lose an argument than a scrambled heading.
    await expectSameText('two people typing', alex.page, sam.page, id);
    const merged = await paintedText(sam.page, id);
    const typed = 'Ship it ' + 'after the QA pass' + 'before the demo';
    expect(characterCounts(merged)).toEqual(characterCounts(typed));
    expect(merged).toHaveLength(typed.length);
    expect(alex.errors()).toEqual([]);
    expect(sam.errors()).toEqual([]);

    await session.close();
  });

  test('TC-30 everybody on a full board writes a heading at the same time', async ({
    browser,
  }) => {
    const session = await openBoard(browser, MAX_CONCURRENT_EDITORS);
    const people = session.participants;
    // Each person's own heading, known before anybody types, so the last assertion can
    // say what every screen should hold.
    const plans = people.map((person, index) => ({
      person,
      heading: `Heading from ${person.name} ${String(index + 1)}`,
      // One row each, all of them inside the board: a click below the last visible pixel
      // belongs to no object and creates nothing, and the test would be counting a person
      // who never got a turn.
      at: { x: POINT.x, y: 260 + index * 70 },
    }));
    const headings = plans.map((plan) => plan.heading);

    // Everyone arms the Text tool and clicks at the same moment. Each person's heading is
    // their own change; nothing about a text box makes it a private object.
    await Promise.all(
      plans.map(async ({ person, heading, at }) => {
        await armTextTool(person.page);
        await person.page.mouse.click(at.x, at.y);
        await expect(person.page.locator(TEXT_EDITOR_SELECTOR)).toBeVisible();
        await person.page.keyboard.type(heading, { delay: 1 });
        await person.page.keyboard.press('Escape');
        // The words are only somebody else's business once they have left the editor:
        // waiting for the field to go means waiting for the last keystroke to be committed.
        await expect(person.page.locator(TEXT_EDITOR_SELECTOR)).toHaveCount(0);
      }),
    );

    // Every screen ends up with every heading, with the words each person typed. Polling
    // the words rather than their count matters here: the objects arrive first and the
    // typing catches up with them, and a test that stopped at "five objects" would pass on
    // a board where four people's keystrokes never arrived.
    for (const person of people) {
      await expect
        .poll(() => wordsOn(person.page), {
          message: `${person.name}: every heading from every person`,
          timeout: 20_000,
        })
        .toEqual([...headings].sort());
    }
    expect(people.flatMap((person) => person.errors())).toEqual([]);

    await session.close();
  });
});

/** Every piece of text on one screen, as the words painted, sorted. */
async function wordsOn(page: Page): Promise<string[]> {
  const texts = await readTexts(page);
  return (await Promise.all(texts.map((text) => paintedText(page, text.id)))).sort();
}

test.describe('workflow: a piece of text that is never written into', () => {
  test('TC-31 Escape without typing leaves nothing behind, and a marquee there picks nothing up', async ({
    page,
  }) => {
    await openFreshBoard(page);

    const id = await placeText(page, POINT);
    await expect(page.locator(TEXT_EDITOR_SELECTOR)).toBeVisible();
    await page.keyboard.press('Escape');

    // An empty piece of text is not a thing on the board (`text.delete_empty`): no ghost
    // with no words in it, and nothing left for a marquee to find.
    await expect(page.locator(TEXT_SELECTOR)).toHaveCount(0);
    expect(await readText(page, id)).toBeNull();

    await page.mouse.move(POINT.x - 120, POINT.y - 80);
    await page.mouse.down();
    await page.mouse.move(POINT.x + 200, POINT.y + 120, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('[data-testid="selection-count"]')).toHaveCount(0);
    expect(await textCount(page)).toBe(0);
  });
});
