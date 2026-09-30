// Free text on the board, in a real browser (story 9).
//
// What a unit test cannot tell anybody is whether the words land where the hand
// clicked, whether the box around them is the box the words need, and whether the
// thing that was typed survives a reload and reaches the other person. So this file
// types into a real browser against the real Worker, and reads the answer out of the
// screen: `data-size`, the box the browser was told to draw, the handle names the
// selection is showing.
//
// Numbers are compared as relationships (wraps to more lines, gets narrower and
// taller) rather than as pixels, because the pixels belong to the font the machine
// has; the *rules* are what story 9 promises.
//
// Spec: spec/stories/009-write-free-text-anywhere-on-the-board/design.md
import { expect, test } from '@playwright/test';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import { openBoard, readCamera, settle, STANDARD_VIEW, VIEWPORT } from './helpers/board';
import { noteAt, stopEditing as stopEditingNote } from './helpers/sticky';
import {
  clickSize,
  clickTextToolButton,
  dragHandle,
  editTextById,
  focusBoard,
  textCentre,
  handleNames,
  lineCount,
  onlyText,
  placeText,
  pressTextToolKey,
  readTexts,
  selectText,
  selectedCount,
  selectToolIsOn,
  stopEditingText,
  textCount,
  textEditor,
  textToolIsOn,
  textIds,
  toolbarSize,
  typeText,
} from './helpers/text';
import {
  expectChangeEventually,
  expectEventually,
  openParticipants,
  printLatencyReport,
  type Participant,
} from './helpers/participants';
import { marquee } from './helpers/sticky';

const CENTER = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

/**
 * The same characters, in any order: what two people typing into one object owe each
 * other is that nobody's letters go missing, not that they arrive in a fixed order.
 */
const sameCharacters = (a: string, b: string): boolean =>
  a.split('').sort().join('') === b.split('').sort().join('');

/**
 * Long enough that no box on this board could hold it on one line, in any font: how
 * many lines it becomes is the machine's business, which is why the assertions below
 * speak in "more lines" and "fewer lines" and never in a number of them.
 */
const LONG_TEXT =
  'The quick brown fox jumps over the lazy dog, and then does it again, because a ' +
  'board with one sentence on it is a board that has nothing to say. '.repeat(4);

test.afterAll(() => {
  printLatencyReport('Free text: a change, and when the other person sees it');
});

test.describe('free text', () => {
  // TC-26: the tool, the click, the words, and a box that grows down rather than sideways.
  test('TC-26 a click writes text that wraps into the box it needs', async ({ page }) => {
    await openBoard(page);
    expect(await selectToolIsOn(page)).toBe(true);

    await placeText(page, 400, 300);
    // The tool did its job and left: a second click would be a second object.
    expect(await textToolIsOn(page)).toBe(false);
    expect(await selectToolIsOn(page)).toBe(true);

    await typeText(page, LONG_TEXT);
    await stopEditingText(page);

    const text = await onlyText(page);
    expect(text.text).toBe(LONG_TEXT);
    // It wrapped: the box is at most the maximum auto width, and it is lines deep.
    expect(text.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + 1);
    expect(text.width).toBeGreaterThan(200);
    // Several lines deep, and the box is as deep as the lines are.
    expect(lineCount(text)).toBeGreaterThanOrEqual(4);
    expect(text.size).toBe('M');
    expect(text.widthMode).toBe('auto');
    expect(text.selected).toBe(true);

    // Text has no background: the words sit on the board itself.
    const painted = await page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="text-object"]');
      if (!element) return null;
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, shadow: style.boxShadow };
    });
    expect(painted?.background).toBe('rgba(0, 0, 0, 0)');
    expect(painted?.shadow).toBe('none');
  });

  // TC-26, the other half: a short line takes only the room it needs.
  test('TC-26b a short line is a small box, and a longer one is a wider box', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, 300, 250);
    await typeText(page, 'Hi');
    await stopEditingText(page);
    const short = await onlyText(page);

    await placeText(page, 300, 450);
    await typeText(page, 'A slightly longer sentence');
    await stopEditingText(page);
    const texts = await readTexts(page);
    const long = texts.find((text) => text.text === 'A slightly longer sentence');
    if (!long) throw new Error('the second piece of text is not on the board');

    expect(long.width).toBeGreaterThan(short.width);
    // Both are one line tall: the box grows sideways while the words fit.
    expect(lineCount(short)).toBe(1);
    expect(lineCount(long)).toBe(1);
  });

  // TC-27: a side handle is about width, and never about the size of the font.
  test('TC-27 a side handle fixes the width and rewraps the words', async ({ page }) => {
    await openBoard(page);
    // Far enough left that there is board to the right of it to drag into.
    await placeText(page, 300, 300);
    await typeText(page, LONG_TEXT);
    await stopEditingText(page);

    // One text object selected: two side handles, and no corner ones to scale the box.
    expect((await handleNames(page)).sort()).toEqual(['e', 'w']);

    const before = await onlyText(page);
    expect(before.widthMode).toBe('auto');

    // A wide box: the same words need fewer lines in it.
    await dragHandle(page, 'e', 250, 0);
    await settle(page);
    const wide = await onlyText(page);
    expect(wide.widthMode).toBe('fixed');
    expect(wide.width).toBeGreaterThan(before.width);
    expect(wide.height).toBeLessThan(before.height);
    expect(lineCount(wide)).toBeLessThan(lineCount(before));
    // A resize never changes the size of the text.
    expect(wide.size).toBe('M');
    expect(await toolbarSize(page)).toBe('M');

    // And the same handle the other way needs more lines, from the same words.
    await dragHandle(page, 'e', -500, 0);
    await settle(page);
    const narrow = await onlyText(page);
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(lineCount(narrow)).toBeGreaterThan(lineCount(wide));
    expect(narrow.size).toBe('M');
  });

  // TC-27, the same handle from the other side: the edge that was not dragged stays put.
  test('TC-27b pulling the west handle moves the left edge and not the right one', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, 500, 300);
    await typeText(page, LONG_TEXT);
    await stopEditingText(page);

    const before = await onlyText(page);
    // A drag far enough to need more lines, not one that only moves an edge.
    await dragHandle(page, 'w', 400, 0);
    await settle(page);
    const after = await onlyText(page);

    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeLessThan(before.width);
    expect(after.width).toBeGreaterThanOrEqual(TEXT_MIN_WIDTH_WORLD);
    // The edge that was not grabbed did not move, and the words rewrapped into the
    // narrower box by getting taller.
    expect(after.left + after.width).toBeCloseTo(before.left + before.width, 0);
    expect(lineCount(after)).toBeGreaterThan(lineCount(before));
    expect(after.size).toBe('M');
  });

  // TC-21 in the browser: the size buttons, and what a size does to the box.
  test('TC-21 the size buttons change the words, not the place they stand', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, 400, 300);
    await typeText(page, 'Ship the demo');
    await stopEditingText(page);

    expect(await toolbarSize(page)).toBe('M');
    const before = await onlyText(page);

    await clickSize(page, 'XL');
    await settle(page);

    const after = await onlyText(page);
    expect(after.size).toBe('XL');
    expect(await toolbarSize(page)).toBe('XL');
    // It grew down and to the right from the corner it stands on.
    expect(after.left).toBe(before.left);
    expect(after.top).toBe(before.top);
    expect(after.height).toBeGreaterThan(before.height);
    // The height is a whole number of XL lines, because that is what the box is
    // counted in: lines of the size the words are set in.
    const lines = after.height / (TEXT_SIZES.XL * TEXT_LINE_HEIGHT);
    expect(lines).toBeCloseTo(Math.round(lines), 1);
    // A bigger font fits fewer characters per line, so the box gets wider too.
    expect(after.width).toBeGreaterThan(before.width);
  });

  // TC-28: an empty box is not an object, and Ctrl+Z is the person's way back.
  test('TC-28 a box that came to nothing is not left behind, and one undo brings it back', async ({
    page,
  }) => {
    await openBoard(page);
    await clickTextToolButton(page);
    expect(await textToolIsOn(page)).toBe(true);
    await page.mouse.click(400, 300);
    await expect(textEditor(page)).toBeVisible();
    // Empty, with the word that says so: a placeholder, not yet an object.
    expect((await onlyText(page)).placeholder).toBe(true);

    // Walk away without typing: the box goes with the caret.
    await page.keyboard.press('Escape');
    await settle(page);
    expect(await textCount(page)).toBe(0);
    expect(await textToolIsOn(page)).toBe(false);
    // And there is nothing there to sweep up: a marquee over the spot selects nothing.
    await marquee(page, { x: 320, y: 240 }, { x: 520, y: 380 });
    expect(await selectedCount(page)).toBe(0);

    // One undo puts the whole thing back: the object, its box, and the caret in it.
    await page.keyboard.press('Control+z');
    await settle(page);
    expect(await textCount(page)).toBe(1);
    expect((await onlyText(page)).text).toBe('');
  });

  // TC-28, the words themselves: deleting them with the keyboard is undoable.
  test('TC-28b an accidental Delete takes the text away and Ctrl+Z puts it back', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, 400, 300);
    await typeText(page, 'Ship it');
    await stopEditingText(page);
    expect(await textCount(page)).toBe(1);

    await page.keyboard.press('Delete');
    await settle(page);
    expect(await textCount(page)).toBe(0);

    await page.keyboard.press('Control+z');
    await settle(page);
    const back = await onlyText(page);
    expect(back.text).toBe('Ship it');
    // Its box came back with it, not at some size measured again on the way.
    expect(back.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
  });

  // TC-29: the note is still a note, wherever the tool is.
  test('TC-29 N still makes a sticky note in the middle of the view', async ({ page }) => {
    await openBoard(page);
    const camera = await readCamera(page);
    await page.keyboard.press('n');
    await expect(page.getByTestId('sticky-note')).toHaveCount(1);

    const note = await noteAt(page, 0);
    const centre = {
      x: note.left + note.width / 2,
      y: note.top + note.height / 2,
    };
    const expected = { x: CENTER.x / camera.zoom + camera.x, y: CENTER.y / camera.zoom + camera.y };
    expect(centre.x).toBeCloseTo(expected.x, 0);
    expect(centre.y).toBeCloseTo(expected.y, 0);

    // And the keys belong to the note now: typing types, and does not switch tools.
    await page.keyboard.type('a note');
    await stopEditingNote(page);
    expect((await noteAt(page, 0)).text).toBe('a note');
    expect(await textToolIsOn(page)).toBe(false);
    expect(await textCount(page)).toBe(0);
  });

  // TC-29b the tool is visible, and the key and the button are the same tool.
  test('TC-29b the rail shows which tool is up', async ({ page }) => {
    await openBoard(page);
    // Nothing has been clicked, so the board holds the focus and the keys are its own.
    await page.keyboard.press('t');
    expect(await textToolIsOn(page)).toBe(true);
    await page.keyboard.press('v');
    expect(await textToolIsOn(page)).toBe(false);

    await clickTextToolButton(page);
    expect(await textToolIsOn(page)).toBe(true);
    await page.getByTestId('tool-select').click();
    expect(await textToolIsOn(page)).toBe(false);
    expect(await selectToolIsOn(page)).toBe(true);

    // Escape gets out of a mode the same way.
    await clickTextToolButton(page);
    await page.keyboard.press('Escape');
    expect(await textToolIsOn(page)).toBe(false);

    // Where the click was is where the box's top-left went, at the standard view.
    await clickTextToolButton(page);
    await page.mouse.click(700, 250);
    await expect(textEditor(page)).toBeVisible();
    const placed = await onlyText(page);
    const expected = { x: 700 / STANDARD_VIEW.zoom + STANDARD_VIEW.x, y: 250 + STANDARD_VIEW.y };
    expect(placed.left).toBeCloseTo(expected.x, 0);
    expect(placed.top).toBeCloseTo(expected.y, 0);
  });

  // TC-31: two people, one set of words, one box.
  test('TC-31 the other person sees the words and the same box around them', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people as [Participant, Participant];

    await placeText(alex.page, 500, 300);
    await typeText(alex.page, 'Ship it');
    const written = await onlyText(alex.page);

    await expectEventually(
      `${sam.name} sees the text ${alex.name} wrote`,
      () => readTexts(sam.page),
      { is: (texts) => texts.some((text) => text.text === 'Ship it') },
    );

    const seen = (await readTexts(sam.page)).find((text) => text.text === 'Ship it');
    if (!seen) throw new Error('the words never arrived');
    // The box arrives with the words. Sam's screen does not measure anything and
    // write it back: the two screens agree without trying to.
    expect(seen.width).toBe(written.width);
    expect(seen.height).toBe(written.height);
    expect(seen.size).toBe('M');

    // Sam changes the size: Alex sees the size and the new box, and neither screen
    // ends up with a box that does not fit its own words.
    const id = seen.id;
    await selectText(sam.page, 0);
    await clickSize(sam.page, 'L');
    await expectChangeEventually(
      `${alex.name} sees Sam's bigger text`,
      async () => {
        const texts = await readTexts(alex.page);
        const text = texts.find((candidate) => candidate.id === id);
        return text ? [text.size, text.height] : [];
      },
      ['L', (await readTexts(sam.page)).find((text) => text.id === id)?.height],
    );

    // A box with nothing in it disappears for everybody, not only for who made it.
    await placeText(sam.page, 900, 500);
    await sam.page.keyboard.press('Escape');
    await expectChangeEventually(
      `${alex.name} sees Sam's empty box go away`,
      () => readTexts(alex.page).then((texts) => texts.length),
      1,
    );
  });

  // Task case TC-28 (the tasks list numbers these itself): the whole point of the
  // tool, start to finish — a heading written over a cluster, made big, moved onto
  // it, deleted by mistake, and got back.
  test('TC-28c a heading is typed, made XL, moved, deleted and comes back whole', async ({
    page,
  }) => {
    await openBoard(page);
    await placeText(page, 400, 250);
    await typeText(page, 'Went well');
    await stopEditingText(page);

    await clickSize(page, 'XL');
    await focusBoard(page);
    const titled = await onlyText(page);
    expect(titled.size).toBe('XL');
    expect(titled.text).toBe('Went well');

    // A heading is moved the way everything else on the board is moved.
    const centre = await textCentre(page, 0);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 100, centre.y + 60, { steps: 5 });
    await page.mouse.move(centre.x + 200, centre.y + 120, { steps: 5 });
    await page.mouse.up();
    await settle(page);

    const moved = await onlyText(page);
    expect(moved.left).toBeCloseTo(titled.left + 200, 0);
    expect(moved.top).toBeCloseTo(titled.top + 120, 0);

    await page.keyboard.press('Delete');
    await settle(page);
    expect(await textCount(page)).toBe(0);

    await page.keyboard.press('Control+z');
    await settle(page);
    const back = await onlyText(page);
    // The whole heading comes back: the words, the size they are set in, the place.
    expect(back.text).toBe('Went well');
    expect(back.size).toBe('XL');
    expect(back.left).toBeCloseTo(moved.left, 0);
    expect(back.top).toBeCloseTo(moved.top, 0);
  });

  // Task case TC-29: two sets of hands in one piece of text at the same time.
  test('TC-29c two people type into one text and nobody loses a character', async ({
    browser,
  }) => {
    const { people } = await openParticipants(browser, 2);
    const [alex, sam] = people as [Participant, Participant];

    await placeText(alex.page, 500, 300);
    await typeText(alex.page, 'Ship');
    await stopEditingText(alex.page);
    const id = (await onlyText(alex.page)).id;

    await expectEventually(
      `${sam.name} sees the text to type into`,
      () => textIds(sam.page),
      { is: (ids) => ids.includes(id) },
    );

    // Both open the same text: two carets in one object, on two machines. The board's
    // own way in is Enter with the object selected, which puts the caret at the end of
    // what is there rather than on top of it.
    await selectText(sam.page, 0);
    await sam.page.keyboard.press('Enter');
    await expect(sam.page.locator('[data-testid="text-object-editor"]')).toBeVisible();
    await alex.page.keyboard.press('Enter');
    await expect(alex.page.locator('[data-testid="text-object-editor"]')).toBeVisible();

    // Alternating keystrokes, so the two writes really do land in each other's middle.
    await alex.page.keyboard.type(' it');
    await sam.page.keyboard.type(' tod');
    await alex.page.keyboard.type(' in a day');
    await sam.page.keyboard.type('ay');

    const typed = 'Ship' + ' it' + ' in a day' + ' tod' + 'ay';
    await expectEventually(
      'every character either person typed is in the text',
      () => readTexts(alex.page).then((texts) => texts.map((text) => text.text).join('')),
      { is: (text) => sameCharacters(text, typed) },
    );

    await alex.page.keyboard.press('Escape');
    await sam.page.keyboard.press('Escape');
    // And the two screens hold the same text: the merge is Y.Text's to do, and both
    // machines end up reading it the same way.
    await expectChangeEventually(
      `${sam.name} and ${alex.name} hold the same text`,
      () => readTexts(sam.page).then((texts) => texts.map((text) => text.text).join('')),
      (await readTexts(alex.page)).map((text) => text.text).join(''),
    );
  });

  // Task case TC-30: as many people as the board allows, each writing a heading.
  test('TC-30 every person on the board writes a heading at once', async ({ browser }) => {
    const { people } = await openParticipants(browser, MAX_CONCURRENT_EDITORS);
    const words = people.map((who) => `${who.name} was here`);

    await Promise.all(
      people.map(async (who, index) => {
        await placeText(who.page, 260 + index * 90, 220 + index * 70);
        await typeText(who.page, words[index] ?? '');
      }),
    );

    for (const who of people) {
      await expectEventually(
        `${who.name} sees all ${String(MAX_CONCURRENT_EDITORS)} headings`,
        () => readTexts(who.page),
        {
          is: (texts) =>
            texts.length === MAX_CONCURRENT_EDITORS &&
            words.every((word) => texts.some((text) => text.text === word)),
        },
      );
    }
  });
});
