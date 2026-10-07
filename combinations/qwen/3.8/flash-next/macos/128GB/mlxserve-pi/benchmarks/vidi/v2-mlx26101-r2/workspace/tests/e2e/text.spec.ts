import { expect, test } from './fixtures.js';
import type { Page } from '@playwright/test';
import { CENTRE, expectNear, openBoard } from './helpers/board.js';
import { notes, noteAt, stickyEditor } from './helpers/sticky.js';
import {
  characterCounts,
  clickTextSize,
  clickTextToolButton,
  docObjects,
  docTexts,
  drawnFontSize,
  drawnLineHeight,
  drawnTextLines,
  escapeText,
  expectedCounts,
  placeText,
  pressTextTool,
  pressedTextSize,
  selectToolButton,
  selectedTextIds,
  textAt,
  textBoxOnScreen,
  textCentre,
  textContents,
  textCount,
  textData,
  textEditor,
  textElements,
  textIdsInOrder,
  textById,
  textToolButton,
  textToolbar,
  topTextId,
  waitForTextCount,
  typeIntoText,
} from './helpers/text.js';
import {
  clearSelection,
  dragBy,
  dragHandle,
  handleLocator,
  marquee,
  pressDelete,
  seedStickyAt,
  selectionBar,
  selectionCount,
} from './helpers/select.js';
import {
  closeParticipants,
  expectSameBoard,
  openParticipants,
  person,
} from './helpers/participants.js';
import { ANNOTATION_300 } from '../fixtures/texts.js';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config.js';

/**
 * Story 9 (write free text anywhere on the board) in a real browser.
 *
 * What only a browser can say: that the box the board stores is a box *these words*
 * need at *this font size* on this screen - the measurement comes out of real font
 * metrics, and the wrapping the board predicts has to be the wrapping the browser
 * draws. Everything here reads both sides of that bargain: the stored box from the
 * document, the lines from the layout engine, and the two are compared.
 *
 * The view starts at the standard zoom with the board origin in the middle of a
 * 1280×800 window, so a world unit is a CSS pixel and a screen point is the world
 * point minus the centre - which is what makes "it is drawn where it was clicked"
 * an assertion rather than a feeling.
 */

/** True when `point` (screen) falls inside the drawn box of the note at `index`. */
async function overNote(page: Page, index: number, point: { x: number; y: number }): Promise<boolean> {
  const box = await noteAt(page, index).boundingBox();
  if (box === null) throw new Error(`note ${index} is not drawn`);
  return (
    point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
  );
}

/**
 * TC-26 - the long annotation. A whole paragraph typed into a text object without
 * once touching a handle: the box grows to its automatic maximum and the words go
 * over onto several lines instead of running off the board.
 */
test('TC-26 a long annotation reaches the automatic width maximum and wraps', async ({ page }) => {
  await openBoard(page);
  expect(ANNOTATION_300).toHaveLength(300);

  const id = await placeText(page, { x: 260, y: 180 });
  // The object appeared at the click and nowhere else: at the standard zoom the
  // screen point and the world point differ by the centre of the window.
  const whileTyping = await textById(page, id);
  expectNear(whileTyping.x, 260 - CENTRE.x, 1, 'x where it was clicked');
  expectNear(whileTyping.y, 180 - CENTRE.y, 1, 'y where it was clicked');
  expect(whileTyping.size).toBe('M');
  expect(whileTyping.widthMode).toBe('auto');

  await typeIntoText(page, id, ANNOTATION_300);

  const typed = await textById(page, id);
  expect(typed.text).toBe(ANNOTATION_300);
  expect(typed.widthMode).toBe('auto');
  // 300 characters at 20 px do not fit on one 600-unit line, so the width stops at
  // the maximum the story names rather than running into the next board.
  expectNear(typed.width!, TEXT_MAX_AUTO_WIDTH_WORLD, 2, 'stored width');
  const lineHeight = await drawnLineHeight(page, 0);
  expect(typed.height! / lineHeight).toBeGreaterThan(2);

  // The box on the screen is the box in the document.
  const drawn = await textBoxOnScreen(page, 0);
  expectNear(drawn.width, typed.width!, 1, 'drawn width');
  expectNear(drawn.height, typed.height!, 1, 'drawn height');

  // And the words really are on several lines, with none of them sticking out.
  await escapeText(page);
  expect(await drawnTextLines(page, 0)).toBeGreaterThanOrEqual(3);
  const fits = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('[data-testid="text-object"] [data-testid="text-content"]');
    if (!content) throw new Error('the annotation is not drawn');
    return content.scrollWidth <= content.clientWidth + 1;
  });
  expect(fits, 'some of the annotation is drawn outside its box').toBe(true);

  // Leaving it did not cost anything: it is still one text object, selected.
  await expect(textElements(page)).toHaveCount(1);
  expect((await selectedTextIds(page)).length).toBe(1);
});

/**
 * TC-27 - the same annotation given a width by hand. A text object has two side
 * handles and nothing else: it is as tall as its words, and the only size a person
 * can ask for is how wide the lines may get.
 */
test('TC-27 dragging a side handle rewraps the words and grows the height', async ({ page }) => {
  await openBoard(page);
  const id = await placeText(page, { x: 300, y: 200 });
  await typeIntoText(
    page,
    id,
    'The team agreed that the first draft of the onboarding guide was far too long to read in one sitting.',
  );
  await escapeText(page);

  const before = await textById(page, id);
  expect(before.widthMode).toBe('auto');
  const linesBefore = await drawnTextLines(page, 0);

  // Two handles, on the sides. A text object is as wide as its words and as tall as
  // its lines: there is no top or bottom of it to pull.
  await expect(handleLocator(page, 'e')).toBeVisible();
  await expect(handleLocator(page, 'w')).toBeVisible();
  for (const side of ['n', 's', 'ne', 'nw', 'se', 'sw'] as const) {
    await expect(handleLocator(page, side)).toHaveCount(0);
  }

  // Take the east handle 250 units in.
  await dragHandle(page, 'e', { x: -250, y: 0 });

  const after = await textById(page, id);
  expect(after.widthMode, 'a handle asked for a width, so the width is now stored').toBe('fixed');
  expectNear(after.width!, before.width! - 250, 3, 'stored width');
  expect(after.x, 'the west edge stayed where it was').toBeCloseTo(before.x, 3);
  expect(after.height!, 'narrower box, more lines').toBeGreaterThan(before.height!);
  // The words rewrapped: what the browser drew, not what the document claims.
  expect(await drawnTextLines(page, 0)).toBeGreaterThan(linesBefore);
  // The font size is not a thing a handle touches.
  expect(await drawnFontSize(page, 0)).toBe(TEXT_SIZES.M);
  // Still two handles, and still nothing above or below.
  await expect(handleLocator(page, 'w')).toBeVisible();
  await expect(handleLocator(page, 'n')).toHaveCount(0);

  // A handle can be taken all the way to the width the story allows and no further.
  const floorPlusSixty = TEXT_MIN_WIDTH_WORLD + 60;
  await dragHandle(page, 'e', { x: floorPlusSixty - after.width!, y: 0 });
  const narrow = await textById(page, id);
  expectNear(narrow.width!, floorPlusSixty, 3, 'stored width after a second drag');
  // And on past it: the minimum is a floor, not a suggestion.
  await dragHandle(page, 'e', { x: -2000, y: 0 });
  const clamped = await textById(page, id);
  expectNear(clamped.width!, TEXT_MIN_WIDTH_WORLD, 1, 'the minimum width held');
  expect(await drawnTextLines(page, 0)).toBeGreaterThan(1);
  expect(await textCount(page)).toBe(1);
});

/**
 * TC-28 - the golden path of the story, in order: title a retro section. Text is
 * placed above a cluster of notes, made XL, dragged into place over them, deleted,
 * and brought back - and it behaves like an object the whole way, because it is one.
 */
test('TC-28 title a retro section: place, resize, move, delete, undo', async ({ page }) => {
  await openBoard(page);
  const cluster = [
    { x: 240, y: 540 },
    { x: 500, y: 600 },
    { x: 300, y: 720 },
  ];
  const noteIds = await seedStickyAt(page, cluster);
  expect(noteIds).toHaveLength(3);

  const heading = await placeText(page, { x: 260, y: 200 });
  await typeIntoText(page, heading, 'Went well');
  await escapeText(page);

  // One text object selected: the selection bar is showing its four sizes, and the
  // object's own size is the one pressed.
  await expect(textToolbar(page)).toBeVisible();
  expect(await pressedTextSize(page)).toBe('M');

  const placed = await textById(page, heading);
  expect(await drawnFontSize(page, 0)).toBe(TEXT_SIZES.M);

  await clickTextSize(page, 'XL');

  const big = await textById(page, heading);
  expect(big.size).toBe('XL');
  // Bigger words, same place: a text object is anchored by its top left, so making
  // it bigger does not slide it anywhere.
  expect(big.x).toBe(placed.x);
  expect(big.y).toBe(placed.y);
  expect(big.width!, 'bigger words need more room').toBeGreaterThan(placed.width!);
  expect(big.height!).toBeGreaterThan(placed.height!);
  expect(await drawnFontSize(page, 0)).toBe(TEXT_SIZES.XL);
  expect(await pressedTextSize(page)).toBe('XL');
  expect(big.text, 'changing the size touched no characters').toBe('Went well');

  // Drag it down over the cluster.
  const from = await textCentre(page, 0);
  const delta = { x: 60, y: 330 };
  await dragBy(page, from, delta);

  const moved = await textById(page, heading);
  expect(moved.x).toBeCloseTo(big.x + delta.x, 1);
  expect(moved.y).toBeCloseTo(big.y + delta.y, 1);

  // Stand back and look at the pixels, with nothing of the board's own chrome in the
  // way: the selection outline and the text toolbar are drawn around a selected
  // object, and a stacking test that read them would be measuring the wrong thing.
  await clearSelection(page);
  const centre = await textCentre(page, 0);
  expect(await overNote(page, 1, centre), 'the heading did not land over the cluster').toBe(true);
  expect(await topTextId(page, centre)).toBe(heading);
  // It is drawn above the note it landed on, which is what the stacking number in the
  // document is for: a text object made after a note sits over it, like anything else.
  const underneat = (await docObjects(page)).find(
    (object) => object.type === 'sticky' && object.id === noteIds[1],
  );
  if (!underneat) throw new Error('the note the heading landed on is gone from the document');
  expect(moved.z, 'the heading is above the note it landed on').toBeGreaterThan(underneat.z);

  // Select it again the way a person does, delete it, and take it back.
  await page.mouse.click(centre.x, centre.y);
  expect((await selectedTextIds(page)).length).toBe(1);
  await pressDelete(page);
  await expect(textElements(page)).toHaveCount(0);
  expect(await textCount(page)).toBe(0);

  await page.keyboard.press('Control+z');
  await expect(textElements(page)).toHaveCount(1);
  const back = await textById(page, heading);
  expect(back.text).toBe('Went well');
  expect(back.size).toBe('XL');
  // Back exactly as it stood: words, size, place and the box those words measured.
  for (const field of ['x', 'y', 'width', 'height', 'z'] as const) {
    expect(back[field]).toBe(moved[field]);
  }
  // The notes are still three notes.
  await expect(notes(page)).toHaveCount(3);
  await expect(textElements(page)).toHaveCount(1);
});

/**
 * TC-29 - two people, one piece of text, at the same time. The box is measured by
 * whoever changed it, and the characters are a shared sequence: nothing is lost and
 * both screens end up with the same words in the same box.
 */
test('TC-29 two people typing into one text object keep every character', async ({ browser }) => {
  test.setTimeout(120_000);
  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  const heading = await placeText(alex.page, { x: 300, y: 260 });
  await typeIntoText(alex.page, heading, 'Went well');
  await escapeText(alex.page);
  await waitForTextCount(sam.page, 1);

  const at = await textCentre(alex.page, 0);
  // Both open the same text object and both start typing, a character at a time.
  await alex.page.mouse.dblclick(at.x, at.y);
  await sam.page.mouse.dblclick(at.x, at.y);
  await expect(textEditor(alex.page)).toBeFocused();
  await expect(textEditor(sam.page)).toBeFocused();

  const typed = { Alex: ' - shipped early', Sam: ', docs with the code' };
  await Promise.all([
    alex.page.keyboard.type(typed.Alex, { delay: 30 }),
    sam.page.keyboard.type(typed.Sam, { delay: 30 }),
  ]);
  await escapeText(alex.page);
  await escapeText(sam.page);

  await expectSameBoard(people);

  const textAlex = (await textById(alex.page, heading)).text;
  const textSam = (await textById(sam.page, heading)).text;
  expect(textSam).toBe(textAlex);
  // Every character either of them typed is in the result, and nothing else is: the
  // two streams interleave, which is what a merge is.
  expect(textAlex).toHaveLength('Went well'.length + typed.Alex.length + typed.Sam.length);
  expect(characterCounts(textAlex)).toEqual(
    expectedCounts(['Went well', typed.Alex, typed.Sam]),
  );

  // One text object, one box, and the box is big enough for the merged words.
  await expect(textElements(alex.page)).toHaveCount(1);
  const box = await textById(alex.page, heading);
  expect(box.text).toBe(textAlex);
  const drawn = await textBoxOnScreen(alex.page, 0);
  expectNear(drawn.width, box.width!, 1, 'drawn width agrees with the document');
  expect(await drawnTextLines(alex.page, 0)).toBeGreaterThanOrEqual(1);
  await closeParticipants(people);
});

/**
 * TC-30 - a full house on the Text tool: `MAX_CONCURRENT_EDITORS` people each press
 * T, each click, each type, all at once. Every heading reaches every screen, and no
 * one of them ends up editing somebody else's object.
 */
test('TC-30 everybody placing a heading at once puts every heading on every board', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
  const people = await openParticipants(browser, names);

  const headings = names.map((_, i) => `Heading ${i + 1}`);
  const spots = names.map((_, i) => ({ x: 180 + i * 190, y: 220 + (i % 2) * 160 }));

  // All of them, at the same time: the key, the click, the words.
  await Promise.all(
    people.map(async (participant, index) => {
      const page = participant.page;
      await page.keyboard.press('t');
      await page.mouse.click(spots[index]!.x, spots[index]!.y);
      await expect(textEditor(page)).toBeFocused();
      await page.keyboard.type(headings[index]!, { delay: 20 });
    }),
  );
  await Promise.all(people.map((participant) => escapeText(participant.page)));

  await expectSameBoard(people);

  const expected = [...headings].sort();
  for (const participant of people) {
    await waitForTextCount(participant.page, MAX_CONCURRENT_EDITORS);
    // Every heading, in this page's document and drawn on this page's screen.
    expect([...(await textContents(participant.page))].sort(), participant.name).toEqual(expected);
    const drawn = await participant.page.$$eval(
      '[data-testid="text-object"] [data-testid="text-content"]',
      (elements) => elements.map((element) => element.textContent ?? ''),
    );
    expect([...drawn].sort(), `${participant.name} drawn text`).toEqual(expected);
    // Each heading is where the person who typed it clicked: 100% zoom, so the
    // world point is the screen point minus the centre of the window.
    const documents = await docTexts(participant.page);
    for (const heading of documents) {
      const index = headings.indexOf(heading.text);
      expect(index, `a heading nobody typed is on ${participant.name}'s board`).toBeGreaterThanOrEqual(0);
      expectNear(heading.x, spots[index]!.x - CENTRE.x, 1, `heading ${index + 1} x`);
      expectNear(heading.y, spots[index]!.y - CENTRE.y, 1, `heading ${index + 1} y`);
    }
  }

  // Nobody was left inside an editor, and the tool stood down on every screen.
  for (const participant of people) {
    await expect(textEditor(participant.page)).toHaveCount(0);
    await expect(textToolButton(participant.page)).toHaveAttribute('aria-pressed', 'false');
    await expect(selectToolButton(participant.page)).toHaveAttribute('aria-pressed', 'true');
    expect(participant.dialogs, 'the board raised a dialog').toEqual([]);
    expect(participant.consoleErrors, 'the board logged an error').toEqual([]);
  }
  await closeParticipants(people);
});

/**
 * TC-31 - the abandoned text. The Text tool summons an object the moment it is
 * clicked, and a person who changes their mind leaves behind a box with no words in
 * it, which is not board content. It goes away, and the board does not remember it.
 */
test('TC-31 text abandoned without a single character leaves nothing behind', async ({ page }) => {
  await openBoard(page);

  await pressTextTool(page);
  await page.mouse.click(400, 300);
  // The object exists the moment it is clicked into - that is what makes the caret
  // real - and it is the only thing on the board.
  await expect(textEditor(page)).toBeFocused();
  await expect(textElements(page)).toHaveCount(1);
  expect(await textCount(page)).toBe(1);

  await page.keyboard.press('Escape');

  await expect(textEditor(page)).toHaveCount(0);
  await expect(textElements(page)).toHaveCount(0);
  expect(await textCount(page)).toBe(0);
  // It did not stay selected either: an object that is not there cannot be in a
  // selection, and a toolbar for it would be a button that does nothing.
  expect(await selectedTextIds(page)).toEqual([]);
  await expect(selectionBar(page)).toHaveCount(0);
  // The tool that was standing down to let the person type is back to Select, which
  // is why the next click is a click and not another object.
  await expect(selectToolButton(page)).toHaveAttribute('aria-pressed', 'true');

  // A marquee over the spot where it was selects nothing.
  await marquee(page, { x: 300, y: 200 }, { x: 520, y: 420 });
  expect(await selectedTextIds(page)).toEqual([]);
  expect(await selectionCount(page)).toBeNull();

  // And the board still works: a note, and then text next to it, both fine.
  await page.keyboard.press('n');
  await expect(stickyEditor(page)).toBeFocused();
  await expect(notes(page)).toHaveCount(1);
  await page.keyboard.type('a note, as ever');
  await page.keyboard.press('Escape');

  await clickTextToolButton(page);
  await page.mouse.click(700, 300);
  await expect(textEditor(page)).toBeFocused();
  const placed = await textIdsInOrder(page);
  const id = placed[placed.length - 1]!;
  await page.keyboard.type('kept');
  await escapeText(page);
  expect(await textCount(page)).toBe(1);
  expect((await textData(page, 0)).text).toBe('kept');
  expect((await textData(page, 0)).id).toBe(id);
  await clearSelection(page);
  await expect(textAt(page, 0)).toBeVisible();
});
