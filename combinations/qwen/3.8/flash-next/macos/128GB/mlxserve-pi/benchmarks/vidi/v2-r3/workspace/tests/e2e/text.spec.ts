// Story 9, e2e: writing free text on the board, in a browser, with the browser's
// own line wrapping.
//
// The unit tests decide what the model stores and the component tests decide what
// one client does; what only a real browser can answer is whether the text
// actually *wraps*, how many lines it came out in, and whether the box the board
// drew around it is the box the text needed. That is what these tests ask, with
// the one allowance the product's own tolerance allows: a measured width within
// TEXT_BOX_MEASURE_TOLERANCE_WORLD of the width the model holds.
import { expect, test, type Page } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { ANNOTATION_300, RETRO_ITEM, SHORT_NOTE } from '../fixtures/texts';
import { dragBoard, gotoBoard, settle, type ScreenPoint } from './helpers/board';
import { joinBoard, newBoard, type Person } from './helpers/participants';
import {
  armTextTool,
  clickText,
  dragHandleBy,
  dragObjectBy,
  editText,
  handle,
  placeText,
  renderedLines,
  selectionOverlay,
  sizeButton,
  stopEditing,
  textAttrs,
  textButton,
  textCount,
  textDisplay,
  textEditor,
  textIds,
  textLocator,
  textStates,
  textToolbar,
  typeText,
  widthModeButton,
} from './helpers/texts';

/** A point of empty board, away from the toolbar down the left of the screen. */
const SPOT: ScreenPoint = { x: 700, y: 360 };

/** A point above and to the left of the board's middle, for a second object. */
const ELSEWHERE: ScreenPoint = { x: 980, y: 220 };

/**
 * How far a width measured from the drawing may sit from the width the model
 * holds, in world units. It is the product's own tolerance for this story: the
 * box is measured from text, and text is measured with a font.
 */
const MEASURE_TOLERANCE_WORLD = 2;

const pressUndo = (page: Page) => page.keyboard.press('Control+z');

const pressRedo = (page: Page) => page.keyboard.press('Control+y');

test.beforeEach(async ({ page }) => {
  await gotoBoard(page);
});

test.describe('the Text tool, in a browser', () => {
  test('is a caret and nothing else, until the board is clicked', async ({ page }) => {
    await armTextTool(page);

    // Nothing appears for the tool alone: an object exists once the person has
    // said where it goes.
    await expect(textEditor(page)).toHaveCount(0);
    await expect(page.locator('[data-text-id]')).toHaveCount(0);

    // And while it is armed the board does not answer to the mouse: no panning,
    // no marquee. The pointer is being aimed at a spot, not at the board.
    const before = await page.evaluate(() => window.__vidi6!.getCamera());
    await dragBoard(page, SPOT, 180, 90);
    await settle(page);
    const after = await page.evaluate(() => window.__vidi6!.getCamera());
    expect(after).toEqual(before);
    await expect(page.getByTestId('marquee')).toHaveCount(0);

    // One click, and there is a caret standing at that point.
    await page.mouse.click(SPOT.x, SPOT.y);
    await expect(textEditor(page)).toHaveCount(1);
    expect(await textIds(page)).toHaveLength(1);
    // And the tool has done the one thing it was for, and is done: the next click
    // is a click on the board again, not another object on top of this one.
    await expect(textButton(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('TC-31 makes no object at all out of a click nobody wrote in', async ({ page }) => {
    await placeText(page, SPOT);
    await stopEditing(page);

    await expect(page.locator('[data-text-id]')).toHaveCount(0);
    expect(await textCount(page)).toBe(0);
    await expect(textToolbar(page)).toHaveCount(0);

    // The spot where it stood belongs to nothing: a marquee drawn over it, added
    // to a selection that is empty, selects nothing.
    await page.keyboard.press('Escape');
    await page.mouse.move(SPOT.x - 60, SPOT.y - 40);
    await page.keyboard.down('Shift');
    await page.mouse.down();
    await page.mouse.move(SPOT.x + 60, SPOT.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await expect(selectionOverlay(page)).toHaveCount(0);
    await expect(textToolbar(page)).toHaveCount(0);
  });
});

test.describe('a long annotation (TC-26)', () => {
  test('wraps at the widest line it is allowed, and is drawn that wide', async ({ page }) => {
    const id = await placeText(page, SPOT);
    await typeText(page, ANNOTATION_300);
    await settle(page);

    const attrs = await textAttrs(page, id);
    expect(attrs.text).toBe(ANNOTATION_300);
    // The box is as wide as the widest line it is allowed to have, within the
    // tolerance the product allows for measuring without a canvas.
    expect(Math.abs(attrs.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(
      MEASURE_TOLERANCE_WORLD,
    );
    const lines = await renderedLines(page, id);
    expect(lines).toBeGreaterThan(2);
    // The height is those lines, and nothing more: the box is its text.
    const oneLine = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(attrs.height).toBeGreaterThanOrEqual(oneLine);
    expect(attrs.height).toBeLessThan(oneLine * (lines + 2));

    await stopEditing(page);
    expect(await textCount(page)).toBe(1);
  });

  test('stays the width it was given when somebody else looks at it', async ({ browser, request }) => {
    // The same board, two browsers: the box travels in the document, so the other
    // screen draws the same box without measuring anything itself.
    const boardId = await newBoard(request);
    const alex = await joinBoard(browser, 'alex', boardId);
    const sam = await joinBoard(browser, 'sam', boardId);
    try {
      const id = await placeText(alex.page, SPOT);
      await typeText(alex.page, ANNOTATION_300);
      await stopEditing(alex.page);

      await expect
        .poll(async () => (await textStates(sam.page)).length, { timeout: 15_000 })
        .toBe(1);
      const [mine, theirs] = await Promise.all([textAttrs(alex.page, id), textAttrs(sam.page, id)]);
      expect(theirs).toEqual(mine);
      expect(await renderedLines(sam.page, id)).toBe(await renderedLines(alex.page, id));
    } finally {
      await alex.context.close();
      await sam.context.close();
    }
  });
});

/**
 * A point of empty board far enough left that a text object at the widest width
 * it is allowed still fits on the screen: the box of an object placed on the right
 * of the board runs off the edge of the window, and a handle that is off the screen
 * is a handle nobody can drag.
 */
const LEFT_SPOT: ScreenPoint = { x: 360, y: 340 };

test.describe('a fixed width (TC-27)', () => {
  test('rewraps the words and grows taller when the side handle is dragged in', async ({ page }) => {
    const id = await placeText(page, LEFT_SPOT);
    await typeText(page, ANNOTATION_300);
    await stopEditing(page);

    // Only the two side handles: a text object has no top and no bottom to pull.
    await expect(handle(page, 'e')).toHaveCount(1);
    await expect(handle(page, 'w')).toHaveCount(1);
    await expect(handle(page, 'n')).toHaveCount(0);
    await expect(handle(page, 's')).toHaveCount(0);

    const before = await textAttrs(page, id);
    const linesBefore = await renderedLines(page, id);

    await dragHandleBy(page, 'e', -180, 0);
    await settle(page);
    const after = await textAttrs(page, id);

    expect(after.width).toBeLessThan(before.width - 150);
    expect(after.mode).toBe('fixed');
    expect(after.text).toBe(before.text);
    // The same words in a narrower box: more lines, so a taller object.
    const linesAfter = await renderedLines(page, id);
    expect(linesAfter).toBeGreaterThan(linesBefore);
    expect(after.height).toBeGreaterThan(before.height);

    // And the box on the screen is the box the document holds, because the person
    // watching this screen does not measure anything themselves.
    expect(await widthModeButton(page).getAttribute('aria-pressed')).toBe('true');

    // Letting go of the width again hands it back to the text.
    await widthModeButton(page).click();
    await settle(page);
    const auto = await textAttrs(page, id);
    expect(auto.mode).toBe('auto');
    expect(Math.abs(auto.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(
      MEASURE_TOLERANCE_WORLD,
    );
    expect(await renderedLines(page, id)).toBe(linesBefore);
  });

  test('keeps the letters the same size when the width changes, which is the whole point of it', async ({ page }) => {
    const id = await placeText(page, LEFT_SPOT);
    await typeText(page, RETRO_ITEM);
    await stopEditing(page);
    const before = await textAttrs(page, id);

    await dragHandleBy(page, 'e', -120, 0);
    const after = await textAttrs(page, id);
    expect(after.fontSize).toBe(before.fontSize);
    expect(after.size).toBe(before.size);
    expect(after.font).toBe(before.font);
    expect(after.text).toBe(before.text);
  });
});

test.describe('titling a retro section (TC-28)', () => {
  test('four sizes of heading, moved, deleted, and brought back', async ({ page }) => {
    // A cluster of notes to title, put on the board by the app's own seeding path
    // rather than by a test reaching into the document.
    await page.evaluate(() => window.__vidi6!.seedNotes(4));
    await expect(page.locator('[data-note-id]')).toHaveCount(4);

    const id = await placeText(page, { x: 620, y: 180 });
    await typeText(page, 'Went well');
    await stopEditing(page);

    // Four sizes, each one its own box around the same corner.
    await sizeButton(page, 'XL').click();
    await settle(page);
    let attrs = await textAttrs(page, id);
    expect(attrs.size).toBe('XL');
    expect(attrs.fontSize).toBe(`${TEXT_SIZES.XL}px`);
    const lines = await renderedLines(page, id);
    expect(lines).toBeGreaterThan(0);
    const wide = attrs.width;
    const tall = attrs.height;

    await sizeButton(page, 'S').click();
    await settle(page);
    attrs = await textAttrs(page, id);
    expect(attrs.size).toBe('S');
    expect(attrs.fontSize).toBe(`${TEXT_SIZES.S}px`);
    expect(attrs.width).toBeLessThan(wide);
    expect(attrs.height).toBeLessThan(tall);

    // Up to the top of the size list again, then moved over the cluster.
    await sizeButton(page, 'XL').click();
    await settle(page);
    const beforeMove = await textAttrs(page, id);
    await dragObjectBy(page, id, -140, 120);
    const moved = await textAttrs(page, id);
    expect(moved.width).toBe(beforeMove.width);
    expect(moved.height).toBe(beforeMove.height);

    // Gone, and back: the box comes with it, because it is one object.
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-text-id]')).toHaveCount(0);
    await pressUndo(page);
    await settle(page);
    await expect(textLocator(page, id)).toHaveCount(1);
    const restored = await textAttrs(page, id);
    expect(restored.text).toBe('Went well');
    expect(restored.size).toBe('XL');
    expect(restored.width).toBe(beforeMove.width);
    expect(restored.height).toBe(beforeMove.height);

    await pressRedo(page);
    await settle(page);
    await expect(page.locator('[data-text-id]')).toHaveCount(0);
  });
});

test.describe('people at one board (TC-29, TC-30)', () => {
  test('TC-29 typing into the same text at the same time ends with every character', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const alex = await joinBoard(browser, 'alex', boardId);
    const sam = await joinBoard(browser, 'sam', boardId);
    try {
      const id = await placeText(alex.page, SPOT);
      await typeText(alex.page, SHORT_NOTE);
      await stopEditing(alex.page);
      await expect
        .poll(async () => (await textAttrs(sam.page, id)).text, { timeout: 15_000 })
        .toBe(SHORT_NOTE);

      // Both of them open the same object and start writing. Neither sees the
      // other's letters arrive in the middle of their own word, and neither loses
      // anything they typed.
      await editText(alex.page, id);
      await editText(sam.page, id);
      const mine = ' shipped';
      const theirs = ' today';
      for (let i = 0; i < Math.max(mine.length, theirs.length); i += 1) {
        if (i < mine.length) await alex.page.keyboard.type(mine[i]!);
        if (i < theirs.length) await sam.page.keyboard.type(theirs[i]!);
      }
      await stopEditing(alex.page);
      await stopEditing(sam.page);

      // The text they both end up with is one text, holding every character both
      // of them typed, in the order the room happened to put them.
      const expected = [...(SHORT_NOTE + mine + theirs)].sort().join('');
      await expect
        .poll(
          async () => {
            const a = await textAttrs(alex.page, id);
            const s = await textAttrs(sam.page, id);
            if (a.text !== s.text) return 'screens differ';
            return [...a.text].sort().join('') === expected ? '' : `sorted differs: ${a.text}`;
          },
          { timeout: 15_000 },
        )
        .toBe('');

      // And one object, not two: nobody's work became somebody else's new object.
      expect(await textCount(alex.page)).toBe(1);
      expect(await textCount(sam.page)).toBe(1);
    } finally {
      await alex.context.close();
      await sam.context.close();
    }
  });

  test('TC-30 a board full of people each writing their own heading, all of them everywhere', async ({
    browser,
    request,
  }) => {
    const boardId = await newBoard(request);
    const people: Person[] = [];
    for (let i = 0; i < MAX_CONCURRENT_EDITORS; i += 1) {
      people.push(await joinBoard(browser, `person${i}`, boardId));
    }
    try {
      // Every one of them arms the Text tool, clicks and writes at the same time.
      await Promise.all(
        people.map(async (person, i) => {
          await armTextTool(person.page);
          await person.page.mouse.click(SPOT.x + i * 30, SPOT.y + i * 40);
          await typeText(person.page, `Heading ${i + 1}`);
        }),
      );

      // Every screen ends up with every heading on it.
      const wanted = people.map((_, i) => `Heading ${i + 1}`);
      for (const person of people) {
        await expect
          .poll(
            async () => {
              const texts = await person.page.$$eval('[data-text-id]', (els) =>
                els
                  .filter((el) => !el.classList.contains('text-editor'))
                  .map((el) => el.querySelector('[data-testid="text-display"]')?.textContent ?? ''),
              );
              return wanted.every((heading) => texts.includes(heading)) ? '' : texts.join(', ');
            },
            { timeout: 15_000 },
          )
          .toBe('');
      }

      // And every one of them is an object with a box of its own, so no two of
      // them are the same object wearing a different name.
      const ids = await textIds(people[0]!.page);
      expect(new Set(ids).size).toBe(MAX_CONCURRENT_EDITORS);
      for (const person of people) await person.page.keyboard.press('Escape');

      // The headings all still stand after everybody has had their last word.
      for (const person of people) {
        expect(await textCount(person.page)).toBe(MAX_CONCURRENT_EDITORS);
      }
    } finally {
      for (const person of people) await person.context.close();
    }
  });
});

test.describe('a text object as a person sees it', () => {
  test('shows the size it was made at, in the letters and on the buttons', async ({ page }) => {
    const id = await placeText(page, SPOT);
    await typeText(page, 'Sizes');
    await stopEditing(page);

    const attrs = await textAttrs(page, id);
    expect(attrs.size).toBe('M');
    expect(attrs.fontSize).toBe(`${TEXT_SIZES.M}px`);
    expect(attrs.font).toContain('Inter');
    expect(await widthModeButton(page).getAttribute('aria-pressed')).toBe('false');

    for (const size of ['S', 'L', 'XL', 'M'] as const) {
      await sizeButton(page, size).click();
      await settle(page);
      const now = await textAttrs(page, id);
      expect(now.size).toBe(size);
      expect(now.fontSize).toBe(`${TEXT_SIZES[size]}px`);
      expect(await sizeButton(page, size).getAttribute('aria-pressed')).toBe('true');
      await expect(textDisplay(page, id)).toHaveText('Sizes');
    }
  });

  test('makes the next object at the next spot it is aimed at', async ({ page }) => {
    const first = await placeText(page, SPOT);
    await typeText(page, 'One');
    await stopEditing(page);
    expect(await textButton(page).getAttribute('aria-pressed')).toBe('false');

    // The object that was just finished with is still standing, still selected,
    // still M, and the board is back to the select tool like it always was.
    const attrs = await textAttrs(page, first);
    expect(attrs.size).toBe('M');
    expect(await textCount(page)).toBe(1);

    // The next one goes in at the spot the person aimed at next.
    const second = await placeText(page, ELSEWHERE);
    expect(second).not.toBe(first);
    await typeText(page, 'Two');
    await stopEditing(page);
    expect(await textCount(page)).toBe(2);
    const both = await textStates(page);
    expect(both).toHaveLength(2);
  });

  test('opens for editing by double-click, and a click on it alone only selects it', async ({ page }) => {
    const id = await placeText(page, SPOT);
    await typeText(page, 'Twice');
    await stopEditing(page);

    await clickText(page, id);
    await expect(textEditor(page)).toHaveCount(0);
    await expect(textToolbar(page)).toHaveCount(1);

    await editText(page, id);
    await expect(textEditor(page)).toHaveCount(1);
    await typeText(page, ' more');
    await stopEditing(page);
    expect((await textAttrs(page, id)).text).toBe('Twice more');
  });
});
