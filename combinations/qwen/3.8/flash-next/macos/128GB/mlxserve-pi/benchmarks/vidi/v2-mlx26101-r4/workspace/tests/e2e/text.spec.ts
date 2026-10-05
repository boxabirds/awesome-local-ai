/**
 * e2e tests for free text (story 9, TC-26 to TC-33).
 *
 * These run in a real browser, which is the only place the central question of this story can be asked:
 * how wide does the machine's own font make these words? Every unit test measures with a font of its own
 * making, because a fixed expectation about a font the machine may not have is a test that fails on
 * somebody else's laptop. Here the font is the one the page will really draw with, so what these tests say
 * is that the box and the words agree — that a heading on a real display is not clipped, is not running out
 * of the side of itself, and is the same heading in somebody else's window at the same moment.
 */
import { expect, test } from '@playwright/test';

import { HEADING_TO_IMPROVE, HEADING_WENT_WELL, LONG_ANNOTATION, TOO_LONG_TEXT } from '../fixtures/texts';
import {
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MAX_CHARS,
  TEXT_PADDING_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { expectPixels, openBoard, setCamera, settled } from './helpers/board';
import { expectEventually } from './helpers/participants';
import { boxOf, createNote, dragNote, noteCount, stickies } from './helpers/sticky';
import { closeParticipants, openParticipants } from './helpers/participants';
import type { Page } from '@playwright/test';
import {
  createTextAt,
  dragTextHandle,
  editTextById,
  paintedFontPx,
  paintedText,
  paintedTextIds,
  pressedTool,
  selectButton,
  startTextAt,
  textAt,
  textButton,
  textBox,
  textCentre,
  textContentWidthPx,
  textCount,
  textDeleteButton,
  textEditor,
  textElements,
  textIsArmed,
  textOverflowPx,
  textSizeButton,
  texts,
} from './helpers/text';

const CREATE_AT = { x: 380, y: 260 };
/** A point with room to the right and below it, for text that is going to grow in both directions. */
const ROOMY = { x: 200, y: 120 };

/**
 * Which pieces of text this page draws as selected.
 *
 * Read from what is drawn, as the selection story's tests do it: an outline is what a person can act on,
 * and an outline left on a heading that was thrown away is a fault even when the state behind it is right.
 */
async function selectedTextIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-text-id]')]
      .filter((element) => (element as HTMLElement).dataset.selected === 'true')
      .map((element) => (element as HTMLElement).dataset.textId ?? ''),
  );
}

/**
 * One person's whole turn with the Text tool: arm it, press the board, wait for the editor, type, finish.
 *
 * This is `createTextAt` with its last check taken out. That helper insists the board gained exactly one
 * piece of text, which is a fair thing to ask of a board with one author and a silly thing to ask of a board
 * where four other people are writing at the same moment — by the time this click lands, the list taken
 * before it is four objects out of date. What this test needs instead is the part the helper waits for:
 * that the editor is really open before the words are typed, because letters typed onto the board are
 * shortcuts, and a `t` among them arms the tool all over again.
 */
async function typeAHeading(page: Page, at: { x: number; y: number }, text: string): Promise<void> {
  await textButton(page).click();
  await page.mouse.click(at.x, at.y);
  await expect(textEditor(page), `${at.x},${at.y} did not open a text editor`).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await settled(page);
}

/**
 * The words this page draws, in the order it draws them.
 *
 * Read out of the text layer, not out of the whole object: a selected heading carries its own toolbar as a
 * child, and `S`, `M`, `L` and `XL` are not the words somebody typed.
 */
async function paintedWords(page: Page): Promise<string[]> {
  const words = await page
    .locator('[data-testid="text-content"]')
    .evaluateAll((elements) => elements.map((element) => element.textContent ?? ''));
  return words;
}

test.describe('free text on the board', () => {
  test('TC-26: the tool, a click and a heading, measured with the font this machine really has', async ({ page }) => {
    await openBoard(page);
    const camera = await settled(page);

    const id = await createTextAt(page, CREATE_AT, HEADING_WENT_WELL);

    const text = await textAt(page);
    expect(text.text).toBe(HEADING_WENT_WELL);
    expect(text.type).toBe('text');
    // The size everybody starts at, and a box nobody has pinned to a width.
    expect(text.size).toBe('M');
    expect(text.widthMode).toBe('auto');

    // The words are where they were asked to be: the click is the top-left of a piece of text, which is
    // what makes a heading land where the pointer was aiming instead of drifting a box-and-a-half away.
    const box = await textBox(page);
    expectPixels(box.x, CREATE_AT.x, 'the text starts at the point that was clicked');
    expectPixels(box.y, CREATE_AT.y, 'the text starts at the point that was clicked');

    // One line, so the height is the sum of things that are known exactly.
    expectPixels(box.height, TEXT_SIZES.M * TEXT_LINE_HEIGHT * camera.zoom, 'one line at the default size');

    // This is the assertion the whole story turns on, and it is the one a headless test cannot make: the
    // width the machine's font gives these words, against the width the box was given. `scrollWidth` is what
    // the words need and `clientWidth` is what they were given; equal means the box was measured from the
    // words rather than guessed at, and nothing is clipped.
    expect(await textOverflowPx(page)).toBe(0);

    // And the box is not merely large enough — with its padding taken back out, it *is* the words, to
    // within the rounding of a pixel. This is the assertion that a guessed width cannot pass: the board laid
    // the box out from a measurement of these characters in this font, and the page now draws those same
    // characters at the width that measurement said. Two numbers from two different machines — the canvas
    // that measured and the line box that drew — saying the same thing.
    const words = await textContentWidthPx(page);
    expect(words).toBeGreaterThan(0);
    expectPixels(box.width - 2 * TEXT_PADDING_WORLD * camera.zoom, words, 'the box is the width of the words');

    // The stored box and the painted box are the same box: the number in the document is what the page drew,
    // which is the only way a second person's screen can be expected to agree.
    expectPixels(box.width, text.width * camera.zoom, 'the painted width is the stored width');
    expect(id).toBe(text.id);
  });

  test('TC-26b: a long heading stops growing sideways and starts growing downward instead', async ({ page }) => {
    await openBoard(page);
    const camera = await settled(page);

    await createTextAt(page, ROOMY, LONG_ANNOTATION);

    const text = await textAt(page);
    // The box stopped at the widest it is allowed and wrapped there, rather than running off into the
    // distance for anybody to read by scrolling.
    expect(text.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2 * TEXT_PADDING_WORLD);
    expect(text.widthMode).toBe('auto');

    // More than one line, which is what a height counted in lines is for.
    const box = await textBox(page);
    const oneLine = TEXT_SIZES.M * TEXT_LINE_HEIGHT * camera.zoom;
    expect(box.height).toBeGreaterThan(oneLine * 2);
    expectPixels(box.height, text.height * camera.zoom, 'as many lines as the document counted');

    // Every line is inside the box that holds it. A box that capped its width without wrapping the words
    // would be exactly as clipped as one that never measured at all, and would look like a font problem.
    expect(await textOverflowPx(page)).toBe(0);
  });

  test('TC-27: the four sizes, and where each one does and does not move the text', async ({ page }) => {
    await openBoard(page);
    const camera = await settled(page);

    await createTextAt(page, CREATE_AT, HEADING_WENT_WELL);
    const before = await textBox(page);

    // Bigger, then bigger still: two steps rather than four, because what is being checked is that the box
    // follows the letters and the letters stay where they were put.
    for (const size of ['L', 'S'] as const) {
      await page.getByTestId(`text-size-${size}`).click();
      await settled(page);

      const text = await textAt(page);
      expect(text.size).toBe(size);
      // The letters are drawn at the size the button said, in screen pixels, which is the only sense in which
      // a size exists at all.
      expectPixels(await paintedFontPx(page), TEXT_SIZES[size] * camera.zoom, `drawn at ${size}`);
      // A line's height is the font's, multiplied by the one setting that says what a line is worth.
      expectPixels((await textBox(page)).height, TEXT_SIZES[size] * TEXT_LINE_HEIGHT * camera.zoom, `${size} line`);
    }

    // Where the text sits did not move when its letters did. A heading that shifted as it was sized would
    // make the fourth size impossible to judge against the first, and would drag a board's layout about
    // every time somebody changed their mind.
    const after = await textBox(page);
    expectPixels(after.x, before.x, 'the text did not move sideways');
    expectPixels(after.y, before.y, 'the text did not move up or down');

    // S really is smaller than L, in both measurements a person can see.
    const small = await textAt(page);
    await page.getByTestId('text-size-L').click();
    await settled(page);
    const large = await textAt(page);
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });

  test('TC-28: the width is dragged, the words wrap, and the letters stay the size they were chosen', async ({ page }) => {
    await openBoard(page);

    await createTextAt(page, CREATE_AT, LONG_ANNOTATION);
    const before = await textAt(page);
    const beforeBox = await textBox(page);

    // Pull the west handle outward: wider, and it takes the words with it.
    await dragTextHandle(page, 'w', -160);

    const wider = await textAt(page);
    expect(wider.widthMode).toBe('fixed');
    const camera = await settled(page);
    expectPixels(wider.width, before.width + 160 / camera.zoom, 'the box took the drag');
    expectPixels((await textBox(page)).x, beforeBox.x - 160 / camera.zoom, 'and its left edge with it');
    // Nothing is lost by a box getting bigger, which is worth saying out loud because a paste gets cut and a
    // clipped box cuts nothing either.
    expect(wider.text).toBe(LONG_ANNOTATION);

    // Now inward, to a third of the width. The words break into more lines and the box gets taller to hold
    // them: a resize that kept the height would push most of the heading out of the bottom of its own box.
    await dragTextHandle(page, 'e', -300);
    const narrower = await textAt(page);
    expect(narrower.width).toBeLessThan(wider.width);
    expect(narrower.height).toBeGreaterThan(wider.height);
    expect(narrower.text).toBe(LONG_ANNOTATION);
    expect(await textOverflowPx(page)).toBe(0);

    // And through all of it the letters are the size they were chosen. No drag has ever made a font size: the
    // box is what a resize is for, and a heading whose letters stretched with the box would be a heading with
    // letters stretched out of the alphabet.
    expect(narrower.size).toBe('M');
    expectPixels(await paintedFontPx(page), TEXT_SIZES.M * camera.zoom, 'the font size outlived the resize');
  });

  test('TC-29: a text with nothing typed into it is not left on the board', async ({ page }) => {
    await openBoard(page);

    // The click that makes a text is how a person changes their mind too, so the two have to be separable:
    // here the tool is used, the board is clicked and nothing at all is typed.
    await startTextAt(page, CREATE_AT);
    expect(await textCount(page)).toBe(1);
    await expect(textEditor(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(textEditor(page)).toHaveCount(0);
    await settled(page);

    // Not on the board, and not in the document either — not an empty object in the marquee, in the undo
    // history, in the byte count, or in the list a second person is shown. A click that leaves something
    // behind is a click a person learns to be afraid of.
    expect(await textCount(page)).toBe(0);
    await expect(textElements(page)).toHaveCount(0);

    // The tool put the board back the way it found it: the next click is a click again, not another text.
    expect(await textIsArmed(page)).toBe(false);
    expect(await pressedTool(page)).toBe('Select (V)');

    // And a text that *is* typed into is kept, so this cannot be an over-broad cleanup that throws away
    // anything that was newly made.
    const kept = await createTextAt(page, { x: 500, y: 400 }, ' ');
    expect(await textCount(page)).toBe(1);
    expect((await textAt(page)).text).toBe(' ');
    expect(kept).toBeTruthy();
  });

  test('TC-30: letters typed into a note and into a heading are letters, not shortcuts', async ({ page }) => {
    await openBoard(page);
    const opening = await settled(page);

    // The two keys this story adds are both letters, and letters are what people type. A note is opened and
    // given the word 'note', which contains the sticky-note key; then a piece of text is given 'text', which
    // contains the text tool's.
    const noteId = await createNote(page, { x: 260, y: 500 }, 'note');
    await createTextAt(page, { x: 700, y: 200 }, 'text');

    const note = (await stickies(page)).find((item) => item.id === noteId);
    const text = await textAt(page);
    expect(note?.text).toBe('note');
    expect(text.text).toBe('text');

    // One note and one text: not two notes and two texts, which is what a board that read the letters as
    // commands would have made.
    expect(await noteCount(page)).toBe(1);
    expect(await textCount(page)).toBe(1);

    // The tool is still wherever the typing left it — which is to say, wherever it was before: typing does
    // not reach out of the field it is in and change the board's mode underneath it.
    expect(await textIsArmed(page)).toBe(false);
    expect(await pressedTool(page)).toBe('Select (V)');

    // The note is where it was put, at the size it always is, and the text is a text: nothing got merged,
    // replaced or resized by the letters that went into it.
    const camera = opening;
    expect(note?.width).toBe(STICKY_SIZE_WORLD);
    expect(text.type).toBe('text');
    expectPixels((await textBox(page)).height, TEXT_SIZES.M * TEXT_LINE_HEIGHT * camera.zoom, 'one line');
  });

  test('TC-31: two browsers, one heading, one box', async ({ browser }) => {
    const [alex, sam] = await openParticipants(browser, 2);
    try {
      // Alex writes a heading and then drags it narrower. Both are things Sam never took part in, and Sam's
      // screen has to end up saying the same thing anyway.
      const id = await createTextAt(alex.page, CREATE_AT, LONG_ANNOTATION);
      await dragTextHandle(alex.page, 'e', -260);
      await settled(alex.page);

      const mine = await textAt(alex.page);
      const fields = (item: Awaited<ReturnType<typeof textAt>> | undefined) =>
        item === undefined
          ? null
          : [item.text, item.width, item.height, item.size, item.widthMode, item.x, item.y];
      // Waited for as a whole, not for the words alone. The words arrived first — they were written first —
      // and a test that stopped waiting at them would then be comparing Alex's finished box against whatever
      // part of the resize Sam had been told about, which is a race wearing the clothes of an assertion about
      // measurement.
      await expect
        .poll(async () => fields((await texts(sam.page)).find((item) => item.id === id)), { timeout: 10_000 })
        .toEqual(fields(mine));

      const theirs = (await texts(sam.page)).find((item) => item.id === id);
      // The same words, the same size, the same box — the same box *exactly*, because Sam's client does not
      // measure Alex's words again: a second measurement of the same words is a second opinion about what a
      // word is worth, and the two boards would never stop disagreeing.
      expect(theirs?.width).toBe(mine.width);
      expect(theirs?.height).toBe(mine.height);
      expect(theirs?.size).toBe(mine.size);
      expect(theirs?.widthMode).toBe(mine.widthMode);
      expect(theirs?.x).toBe(mine.x);
      expect(theirs?.y).toBe(mine.y);

      // And it is not only the documents that agree: what each browser painted is the same box on the same
      // words, which is the version of this a person can actually see.
      const painted = await Promise.all([paintedText(alex.page), paintedText(sam.page)]);
      expect(painted[0]!.text).toBe(painted[1]!.text);
      expectPixels(painted[0]!.width, painted[1]!.width, 'same painted width');
      expectPixels(painted[0]!.height, painted[1]!.height, 'same painted height');
      expectPixels(painted[0]!.fontPx, painted[1]!.fontPx, 'same letters');
      // Neither of them is clipping.
      expect(await textOverflowPx(alex.page)).toBe(0);
      expect(await textOverflowPx(sam.page)).toBe(0);
    } finally {
      await closeParticipants([alex, sam]);
    }
  });

  test('TC-32: the words fit their box at every size and at every zoom', async ({ page }) => {
    await openBoard(page);

    await createTextAt(page, ROOMY, LONG_ANNOTATION);

    // The same words, the same box rule, four sizes and two zooms. `scrollWidth === clientWidth` is the whole
    // test: what the words need against what they were given. A box that stopped being measured at any one of
    // these sizes, or that was scaled somewhere the text inside it was not, shows up here as text running out
    // of the side of a heading — which is the failure this story is defined by not having.
    for (const size of ['S', 'M', 'L', 'XL'] as const) {
      await page.getByTestId(`text-size-${size}`).click();
      await settled(page);
      expect(await textOverflowPx(page)).toBe(0);

      const text = await textAt(page);
      const box = await textBox(page);
      const camera = await settled(page);
      expectPixels(box.width, text.width * camera.zoom, `the painted box is the stored box at ${size}`);
    }

    // Zoom is the other way a display changes how much room words need. The board scales and so do the words;
    // if the text were laid out in screen pixels somewhere, one of these two zooms would clip it.
    for (const zoom of [0.5, 2]) {
      await setCamera(page, { zoom });
      expect(await textOverflowPx(page)).toBe(0);
    }
  });

  test('TC-32b: a heading stays inside its box while it is being typed into', async ({ page }) => {
    await openBoard(page);

    // The field is laid out at the width the box is measured at, padding and all: if it were any wider or
    // narrower, every word in the document would step sideways the moment somebody clicked on it, and the
    // box would be wrong again the moment they stopped. The field stops where the text stops, which is the
    // padding away from the edge of the box.
    await startTextAt(page, ROOMY);
    await page.keyboard.type(LONG_ANNOTATION);

    const camera = await settled(page);
    const editor = await boxOf(textEditor(page));
    const object = await textBox(page);
    expectPixels(
      editor.width,
      object.width - 2 * TEXT_PADDING_WORLD * camera.zoom,
      'the field is as wide as the text it is being typed in',
    );

    await page.keyboard.press('Escape');
    await settled(page);
    expect(await textOverflowPx(page)).toBe(0);
  });

  test('a paste one character over the limit leaves exactly the limit', async ({ page }) => {
    await openBoard(page);

    await startTextAt(page, ROOMY);
    await page.keyboard.insertText(TOO_LONG_TEXT);
    await settled(page);

    // The document holds five thousand characters, not five thousand and one, and not the whole paste
    // refused: what a person gets is as much as they asked for, to the character.
    await expect.poll(async () => (await textAt(page)).text.length).toBe(TEXT_MAX_CHARS);
    expect((await textAt(page)).text).toBe(TOO_LONG_TEXT.slice(0, TEXT_MAX_CHARS));

    // The field says so too, and stops saying it once there is no longer anything to warn about.
    await expect(page.getByTestId('text-counter')).toHaveText(`${TEXT_MAX_CHARS}/${TEXT_MAX_CHARS}`);

    // And a box built out of five thousand characters is still a box that holds them.
    await page.keyboard.press('Escape');
    await settled(page);
    expect(await textOverflowPx(page)).toBe(0);
    expect((await textAt(page)).width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 2 * TEXT_PADDING_WORLD);
  });

  test('one piece of text is selected with the handles it can use, and deleted like anything else', async ({ page }) => {
    await openBoard(page);

    await createTextAt(page, CREATE_AT, HEADING_WENT_WELL);

    // Two handles. A piece of text whose height is counted in lines cannot be dragged taller, and a handle
    // that offered that would be an offer the board cannot keep.
    expect(await page.locator('[data-testid^="resize-handle-"]').count()).toBe(2);
    await expect(page.locator('[data-testid="resize-handle-n"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="resize-handle-se"]')).toHaveCount(0);

    await textDeleteButton(page).click();
    await settled(page);
    expect(await textCount(page)).toBe(0);

    // The tool button puts the board into the mood for a heading, and the board says so with a different
    // cursor. Then a click makes one, and the board is back to being a board.
    await textButton(page).click();
    expect(await textIsArmed(page)).toBe(true);
    expect(await selectButton(page).getAttribute('aria-pressed')).toBe('false');
    await page.mouse.click(CREATE_AT.x + 200, CREATE_AT.y + 120);
    await page.keyboard.type(HEADING_TO_IMPROVE);
    await page.keyboard.press('Escape');
    await settled(page);
    expect(await textCount(page)).toBe(1);
    expect(await pressedTool(page)).toBe('Select (V)');
  });
  // tasks.md task 10, workflow 'Title a retro section'. The whole story in one go: a heading made above the
  // things it belongs to, given a size, moved, thrown away and brought back.
  test('a heading is made over a cluster, sized, moved, deleted and brought back by one undo', async ({
    page,
  }) => {
    await openBoard(page);
    for (const at of [
      { x: 300, y: 380 },
      { x: 520, y: 380 },
      { x: 410, y: 560 },
    ]) {
      await createNote(page, at, 'item');
    }

    const id = await createTextAt(page, { x: 300, y: 200 }, HEADING_WENT_WELL);
    await textSizeButton(page, 'XL').click();
    await settled(page);
    const titled = await textAt(page);
    expect(titled.size).toBe('XL');
    expect(titled.text).toBe(HEADING_WENT_WELL);

    // The heading sits above the cluster it names — above it in the stacking order as well as above it on
    // the screen, because it was the last thing made and nothing about being moved changes that.
    const painted = await paintedTextIds(page);
    expect(painted[painted.length - 1], 'the heading is the topmost thing on the board').toBe(id);

    const press = await textCentre(page, id);
    await dragNote(page, press, 60, 180);
    const moved = await textAt(page);
    expect(moved.x).toBeGreaterThan(titled.x);
    expect(moved.y).toBeGreaterThan(titled.y);
    // A move moves. The box and the letters in it are the same ones, which is what Key decision 1 means for
    // a drag: nothing in this gesture measures anything.
    expect(moved.width).toBe(titled.width);
    expect(moved.height).toBe(titled.height);
    expect(moved.size).toBe('XL');
    expect(moved.text).toBe(titled.text);

    // Throw it away, and the three notes it was written over are none the worse.
    await page.keyboard.press('Delete');
    await settled(page);
    await expect.poll(() => textCount(page)).toBe(0);
    expect(await noteCount(page)).toBe(3);

    // One undo, and it comes back as the same heading: the same id, the same words, the same size, the same
    // box, in the place it had been dragged to. Story 8's undo takes the words and their box as one step;
    // this is that promise seen from the far end, where the step being undone is a deletion.
    await page.keyboard.press('Control+z');
    await settled(page);
    await expect.poll(() => textCount(page)).toBe(1);
    const restored = await textAt(page);
    expect(restored.id, 'the same heading, not a new one').toBe(id);
    expect(restored.text).toBe(HEADING_WENT_WELL);
    expect(restored.size).toBe('XL');
    expect(restored.width).toBe(moved.width);
    expect(restored.height).toBe(moved.height);
    expect(restored.x).toBe(moved.x);
    expect(restored.y).toBe(moved.y);
  });

  // tasks.md task 10: two people in one heading.
  test('two people type into one heading at the same time and end up with the same words', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, 2);
    const [alex, sam] = people;
    try {
      const id = await createTextAt(alex.page, { x: 260, y: 220 }, 'Went');
      await expectEventually('Sam sees the heading', () => textCount(sam.page)).toBe(1);

      // Both open it, and both type without waiting for the other. This is the case Y.Text exists for: one
      // piece of text, two carets, two places at once — and the reason a heading can share the sticky note's
      // editor down to the constant (Key decision 3) instead of needing its own answer.
      await editTextById(alex.page, id);
      await editTextById(sam.page, id);
      await Promise.all([
        alex.page.keyboard.type(' well', { delay: 30 }),
        sam.page.keyboard.type(' today', { delay: 30 }),
      ]);

      const letters = (text: string) => [...text].sort().join('');
      const expected = letters('Went well today');
      await expect
        .poll(
          async () => {
            const [mine, theirs] = [await texts(alex.page), await texts(sam.page)];
            return letters(mine[0]?.text ?? '') === expected && letters(theirs[0]?.text ?? '') === expected;
          },
          { timeout: 20_000 },
        )
        .toBe(true);

      // Every character from both of them, once each, on both screens. Neither editor's box clamp ate any of
      // it, because 15 characters is nowhere near 5,000.
      for (const [name, page] of [
        ['Alex', alex.page],
        ['Sam', sam.page],
      ] as const) {
        const text = (await texts(page))[0];
        expect(letters(text?.text ?? ''), `${name} has every character both people typed, and no others`).toBe(
          expected,
        );
      }
    } finally {
      await closeParticipants(people);
    }
  });

  // tasks.md task 10: as many headings as the board lets people edit at once, all at the same moment.
  test(`${MAX_CONCURRENT_EDITORS} people each put a heading on the board at once, and every screen shows them all`, async ({
    browser,
  }) => {
    const people = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      const words = people.map((person) => `${person.name} was here`);
      // All of them arm the Text tool and click, at the same time, in the same second. Nothing here is
      // queued or takes a turn: every one of them makes its own object in its own document, and the room is
      // what makes five documents into one board.
      await Promise.all(
        people.map(async (person, index) => {
          await typeAHeading(person.page, { x: 260 + index * 90, y: 180 + (index % 2) * 70 }, words[index]);
        }),
      );

      const expected = [...words].sort();
      for (const person of people) {
        await expect
          .poll(async () => (await texts(person.page)).map((text) => text.text).sort(), { timeout: 20_000 })
          .toEqual(expected);
        // Not only in the document: on the screen, as objects, with the words drawn.
        // Sorted, because what is promised is that all five are there, not what they are stacked in: the
        // order they were made in belongs to whoever made them (Key decision 6 of the selection story).
        await expect
          .poll(async () => (await paintedWords(person.page)).sort(), { timeout: 20_000 })
          .toEqual(expected);
      }
    } finally {
      await closeParticipants(people);
    }
  });

  // tasks.md task 10, workflow 'Abandoned text', second half: the spot it was made at holds nothing that a
  // marquee could pick up afterwards.
  test('a marquee over the spot an abandoned heading was made at selects nothing', async ({ page }) => {
    await openBoard(page);
    await textButton(page).click();
    await page.mouse.click(CREATE_AT.x, CREATE_AT.y);
    await expect(textEditor(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect.poll(() => textCount(page)).toBe(0);

    // Shift-drag a box over that exact spot, the way the selection story's tests do it. There is no object
    // there to catch it, because the heading was removed rather than left invisible (Key decision 8).
    await page.keyboard.down('Shift');
    await page.mouse.move(CREATE_AT.x - 40, CREATE_AT.y - 40);
    await page.mouse.down();
    await page.mouse.move(CREATE_AT.x + 40, CREATE_AT.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await settled(page);

    expect(await selectedTextIds(page), 'nothing is drawn as selected').toEqual([]);
    expect(await page.getByTestId('selection-bar').count()).toBe(0);
    expect(await textCount(page)).toBe(0);
  });});
