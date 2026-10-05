/**
 * E2E (story 9): writing free text anywhere on the board.
 *
 * These run in a real browser, with real fonts, so they cannot assert what the unit tests
 * assert — the unit tests know the arithmetic of a fake measurer, a browser knows only what
 * its font engine decided. What only a browser can answer is whether the thing a person is
 * promised actually happens on a real board:
 *
 *  - that a long annotation stops at the width the board allows rather than running off the
 *    screen, and stays editable (`text.auto_width`, TC-26);
 *  - that a side handle gives the text a width of the person's choosing and the words
 *    re-wrap inside it, with no handle anywhere that would drag the height (`text.fixed_width`,
 *    TC-27);
 *  - that a heading can be written, enlarged, moved, deleted and brought back (`text.object`,
 *    TC-28);
 *  - that two people typing into one text finish with the same characters in the same
 *    document (`text.remote`, TC-29);
 *  - that a full room of people writing headings at once ends with every heading on every
 *    screen (`text.create`, TC-30);
 *  - that text abandoned without a character leaves nothing behind, not even a place for a
 *    marquee to catch (`text.empty_delete`, TC-31).
 *
 * Two of the cases below are extras that the story's own list does not name: that a text
 * moves with a marquee selection like any other object, and that a board which failed to
 * load offers no Text tool at all.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  boardObjects,
  createBoardOn,
  dragByMouse,
  dragWithKey,
  marqueeBox,
  notes,
  objectCentreOnScreen,
  openBoard,
  placeTextAt,
  pressedTool,
  resizeHandle,
  selectedCount,
  stickyToolButton,
  textEditor,
  textElement,
  textElements,
  textSizeButton,
  textWords,
  toolButton,
  toolMode,
  worldOf
} from './helpers/board';
import { openBoardAt, openSession } from './helpers/participants';
import type { TextSnapshot } from '../../src/shared/objects/text';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_LINE_HEIGHT,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD
} from '../../src/shared/config';

/** A text as the document holds it, with the fields only a text has. */
async function textOn(page: Page, id: string): Promise<TextSnapshot> {
  const found = (await boardObjects(page)).find((object) => object.id === id);
  if (!found || found.type !== 'text') throw new Error(`text ${id} is not on the board`);
  return found as TextSnapshot;
}

/**
 * One text, read twice in the same browser task: what the document says its box is, and
 * what the browser painted. Reading them in one go is the point — the claim is that the
 * board's number and the pixels on the screen are one measurement, and reading them a frame
 * apart would compare a stored box against a rendering of the one before it.
 */
function measure(page: Page, id: string) {
  return page.evaluate((objectId) => {
    const held = window.__vidi6?.getObjects().find((object) => object.id === objectId);
    const element = document.querySelector<HTMLElement>(`[data-object-id="${objectId}"]`);
    const content = element?.querySelector<HTMLElement>('[data-testid="text-content"]');
    const style = element ? getComputedStyle(element) : null;
    return {
      storedWidth: held?.width ?? -1,
      storedHeight: held?.height ?? -1,
      storedText: 'text' in (held ?? {}) ? (held as { text?: string }).text : undefined,
      storedSize: 'size' in (held ?? {}) ? (held as { size?: string }).size : undefined,
      storedMode: 'widthMode' in (held ?? {}) ? (held as { widthMode?: string }).widthMode : undefined,
      storedX: held?.x ?? -1,
      storedY: held?.y ?? -1,
      paintedWidth: element?.clientWidth ?? -1,
      paintedHeight: element?.clientHeight ?? -1,
      // The widest line as the browser laid it out, and how many lines it needed.
      contentWidth: content?.scrollWidth ?? -1,
      contentHeight: content?.scrollHeight ?? -1,
      background: style?.backgroundColor ?? '',
      border: style?.borderTopWidth ?? '',
      fontSize: style?.fontSize ?? '',
      fontFamily: style?.fontFamily ?? ''
    };
  }, id);
}

/** Wait until the stored box and the painted box are the same measurement, and return it. */
async function settled(page: Page, id: string): Promise<Awaited<ReturnType<typeof measure>>> {
  await expect
    .poll(
      async () => {
        const now = await measure(page, id);
        return Math.max(
          Math.abs(now.storedWidth - now.paintedWidth),
          Math.abs(now.storedHeight - now.paintedHeight)
        );
      },
      { message: 'the stored box and the painted box should be one measurement' }
    )
    .toBeLessThanOrEqual(1);
  return measure(page, id);
}

/** Within a tolerance, as a message a waiting test can print. */
function closeTo(actual: number, expected: number, tolerance = 0.5): string | true {
  return (
    Math.abs(actual - expected) <= tolerance ||
    `${actual} is not within ${tolerance} of ${expected}`
  );
}

/** Drag an object from its own middle by a screen delta. */
async function dragObjectBy(page: Page, objectId: string, deltaX: number, deltaY: number) {
  const centre = await objectCentreOnScreen(page, objectId);
  await dragByMouse(page, centre, { x: centre.x + deltaX, y: centre.y + deltaY });
}

/** Open a text for editing where it sits on the screen. */
async function editText(page: Page, id: string): Promise<void> {
  const centre = await objectCentreOnScreen(page, id);
  await page.mouse.dblclick(centre.x, centre.y);
  await expect(textEditor(page)).toBeVisible();
}

/** The characters of a string, sorted: what a text holds regardless of order. */
function letters(text: string): string {
  return [...text].sort().join('');
}

test('TC-26: a long annotation wraps at the width the board allows and stays editable', async ({
  page
}) => {
  await openBoard(page);

  // The tool is picked up, and shown to be picked up.
  await page.keyboard.press('t');
  expect(await toolMode(page)).toBe('text');
  await expect(toolButton(page, 'text')).toHaveAttribute('aria-pressed', 'true');
  await expect(toolButton(page, 'select')).toHaveAttribute('aria-pressed', 'false');

  // One click, and the text is being written with its top-left where the pointer landed —
  // the first letter appears under the cursor, not a click's width away from it.
  const clicked = { x: 240, y: 200 };
  const world = await worldOf(page, clicked);
  const id = await placeTextAt(page, clicked);
  const created = await textOn(page, id);
  expect(closeTo(created.x, world.x), 'the click is the top-left, not the middle').toBe(true);
  expect(closeTo(created.y, world.y), 'and the first letter starts there').toBe(true);
  expect(created.width, 'before there are words, the narrowest box allowed').toBeCloseTo(
    TEXT_MIN_WIDTH_WORLD,
    6
  );

  // The tool is spent: this was one text, not the start of a text-laying machine.
  expect(await pressedTool(page)).toBe('select');
  expect(await toolMode(page)).toBe('select');

  // A real annotation: three hundred characters of the sort a person writes after a
  // meeting, which is far too wide to be one line of 20 pixel text.
  const sentence =
    'The migration went well overall, the demo landed on time, and the follow-ups are ' +
    'written down below; nobody is blocked, and the risky part is the migration of the ' +
    'old dashboards into the new workspace because the owners have not been named yet.';
  expect(sentence.length).toBeGreaterThan(240);
  await textEditor(page).fill(sentence);
  await page.keyboard.press('Escape');

  await expect(textEditor(page)).toHaveCount(0);
  const wrapped = await settled(page, id);
  expect(wrapped.storedText, 'every character of it is stored').toBe(sentence);
  expect(
    closeTo(wrapped.storedWidth, TEXT_MAX_AUTO_WIDTH_WORLD, 2),
    `a line too wide to fit stops at the widest auto box (${wrapped.storedWidth})`
  ).toBe(true);
  const fontPx = Number.parseFloat(wrapped.fontSize);
  expect(
    wrapped.storedHeight / (fontPx * TEXT_LINE_HEIGHT),
    'and the height grew by whole lines to hold it'
  ).toBeGreaterThan(3);

  // The browser agrees: the words are drawn as several lines, none of them hanging out of
  // the box the board stored.
  expect(
    closeTo(wrapped.contentHeight, wrapped.storedHeight, 2),
    'the lines that were measured are the lines that are painted'
  ).toBe(true);
  expect(
    wrapped.contentWidth <= wrapped.paintedWidth + 2,
    `nothing overflows the box (${wrapped.contentWidth} in ${wrapped.paintedWidth})`
  ).toBe(true);
  // Plain words: nothing behind them, nothing around them, the board's own text font.
  expect(wrapped.background, 'a text has no background').toBe('rgba(0, 0, 0, 0)');
  expect(wrapped.border, 'and no border of its own').toBe('0px');
  expect(wrapped.fontFamily, 'and the board has one text font').toContain('Inter');

  // And it is still editable after all that: double-click, add a word, Escape.
  await editText(page, id);
  await page.keyboard.press('End');
  await page.keyboard.type(' (added later)');
  await page.keyboard.press('Escape');
  expect((await textOn(page, id)).text).toBe(`${sentence} (added later)`);
});

test('TC-27: the side handle gives the text a width, the words re-wrap, and there is no handle for the height', async ({
  page
}) => {
  await openBoard(page);

  const id = await placeTextAt(page, { x: 120, y: 180 });
  const words =
    'Drag the right handle inwards and these words decide to sit on more lines, ' +
    'which is the whole point of giving them a width of your own instead of the board\'s.';
  await textEditor(page).fill(words);
  await page.keyboard.press('Escape');
  const before = await settled(page, id);
  expect(before.storedMode, 'an auto text is wrapped at the board\'s own width').toBe('auto');
  expect(closeTo(before.storedWidth, TEXT_MAX_AUTO_WIDTH_WORLD, 2)).toBe(true);

  // Only the two sides can be dragged at all: the height belongs to the words.
  await expect(resizeHandle(page, 'e')).toBeVisible();
  await expect(resizeHandle(page, 'w')).toBeVisible();
  await expect(resizeHandle(page, 'n')).toHaveCount(0);
  await expect(resizeHandle(page, 's')).toHaveCount(0);
  await expect(resizeHandle(page, 'ne')).toHaveCount(0);
  await expect(resizeHandle(page, 'nw')).toHaveCount(0);
  await expect(resizeHandle(page, 'se')).toHaveCount(0);
  await expect(resizeHandle(page, 'sw')).toHaveCount(0);

  // Drag the east handle in by 250 pixels.
  const handle = resizeHandle(page, 'e');
  const box = await handle.boundingBox();
  if (!box) throw new Error('the east handle has no box to grab');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await dragByMouse(page, from, { x: from.x - 250, y: from.y });

  const after = await settled(page, id);
  expect(after.storedMode, 'the text now has a width the person set').toBe('fixed');
  expect(closeTo(after.storedWidth, before.storedWidth - 250, 2), 'to the width it was dragged to').toBe(
    true
  );
  expect(
    after.storedHeight,
    'and the words needed more lines in the narrower box'
  ).toBeGreaterThan(before.storedHeight);
  expect(closeTo(after.storedHeight, after.paintedHeight, 1), 'lines measured, lines painted').toBe(
    true
  );
  expect(
    closeTo(after.storedX, before.storedX, 1),
    'the left edge stayed where the words start'
  ).toBe(true);
  expect(after.storedText, 'and no word was lost to the wrapping').toBe(words);

  // A fixed text keeps the width it was given when more words arrive — it does not snap
  // back to the board's idea of a good line.
  await editText(page, id);
  await page.keyboard.press('End');
  await page.keyboard.type(' and one more clause, which wraps too');
  await page.keyboard.press('Escape');
  const grown = await settled(page, id);
  expect(grown.storedMode).toBe('fixed');
  expect(closeTo(grown.storedWidth, after.storedWidth, 1), 'the width stays put').toBe(true);
  expect(grown.storedHeight, 'the height follows the new lines').toBeGreaterThan(after.storedHeight);
});

test('TC-28: an XL heading, a move, a delete, and Ctrl+Z puts the whole thing back', async ({
  page
}) => {
  await openBoard(page);

  const id = await placeTextAt(page, { x: 300, y: 160 });
  await textEditor(page).fill('Retro');
  await page.keyboard.press('Escape');
  await expect(textElement(page)).toHaveAttribute('data-selected', 'true');
  await expect(textSizeButton(page, 'M')).toHaveAttribute('aria-pressed', 'true');

  // The heading gets bigger. Escape left it selected, which is what makes the toolbar the
  // next thing you reach for.
  const beforeSize = await textOn(page, id);
  const beforeFont = (await measure(page, id)).fontSize;
  await textSizeButton(page, 'XL').click();
  const heading = await settled(page, id);
  expect(heading.storedSize).toBe('XL');
  expect(await textSizeButton(page, 'XL').getAttribute('aria-pressed')).toBe('true');
  expect(closeTo(heading.storedX, beforeSize.x, 0.001), 'the first letter stays put').toBe(true);
  expect(closeTo(heading.storedY, beforeSize.y, 0.001)).toBe(true);
  expect(
    Number.parseFloat(heading.fontSize),
    'and the letters really are bigger'
  ).toBeGreaterThan(Number.parseFloat(beforeFont) * 2);

  // Somewhere else on the board, with the rest of them.
  await dragObjectBy(page, id, 180, 90);
  const moved = await textOn(page, id);
  expect(closeTo(moved.x, beforeSize.x + 180, 1), 'moved by the hand').toBe(true);
  expect(closeTo(moved.y, beforeSize.y + 90, 1)).toBe(true);

  // Deleted — and brought back by one Ctrl+Z, exactly as it was.
  await page.keyboard.press('Delete');
  await expect(textElement(page)).toHaveCount(0);
  expect((await boardObjects(page)).length, 'nothing on the board').toBe(0);

  await page.keyboard.press('Control+z');
  await expect(textElement(page)).toHaveCount(1);
  const restored = await settled(page, id);
  expect(restored.storedText, 'the same words').toBe('Retro');
  expect(restored.storedSize, 'the same size').toBe('XL');
  expect(closeTo(restored.storedX, moved.x, 1), 'in the same place').toBe(true);
  expect(closeTo(restored.storedY, moved.y, 1)).toBe(true);
  expect(closeTo(restored.storedWidth, moved.width, 1), 'and the same box').toBe(true);
  await expect(textWords(page)).toContainText('Retro');
});

test('TC-29: two people typing into one text finish with the same characters', async ({
  browser
}) => {
  const session = await openSession(browser, ['ada', 'grace']);
  try {
    const ada = session.person('ada').page;
    const grace = session.person('grace').page;

    // One text, opened by both of them at once.
    const id = await placeTextAt(ada, { x: 320, y: 260 });
    await textEditor(ada).fill('Action items: ');
    await editText(ada, id);
    await editText(grace, id);
    await expect(textEditor(grace)).toBeVisible();

    // Both type, at the same time, into the same words. The keystrokes are not awaited one
    // by one, because a test that waits between them would be a test of taking turns.
    const mine = 'owner: ada, due Friday';
    const theirs = 'owner: grace, due Monday';
    await Promise.all([
      ada.keyboard.press('End').then(() => ada.keyboard.type(mine)),
      grace.keyboard.press('End').then(() => grace.keyboard.type(theirs))
    ]);
    // Both done typing.
    await ada.keyboard.press('Escape');
    await grace.keyboard.press('Escape');

    // One document, in two browsers, holding every character either of them typed.
    await session.eventually('both screens hold the same text, with all the characters', async () => {
      const here = (await textOn(ada, id)).text;
      const there = (await textOn(grace, id)).text;
      if (here !== there) return `the two screens differ:\n  ada:   ${JSON.stringify(here)}\n  grace: ${JSON.stringify(there)}`;
      if (here.length !== 'Action items: '.length + mine.length + theirs.length) {
        return `${here.length} characters instead of ${'Action items: '.length + mine.length + theirs.length}`;
      }
      const expected = letters(`Action items: ${mine}${theirs}`);
      if (letters(here) !== expected) return 'a character was lost in the merge';
      return true;
    });

    // And what they agree on is on screen, not only in the document.
    await expect(textWords(grace)).toContainText('Action items:');
    await expect(textWords(grace)).toContainText('owner:');
    // The box each of them holds is the same box, because only the client that changed the
    // words measures them — five writers, one set of dimensions.
    const hers = await textOn(ada, id);
    const theirsNow = await textOn(grace, id);
    expect(closeTo(hers.width, theirsNow.width, 0.001)).toBe(true);
    expect(closeTo(hers.height, theirsNow.height, 0.001)).toBe(true);

    expect(session.person('ada').errors, 'no errors on ada').toEqual([]);
    expect(session.person('grace').errors, 'no errors on grace').toEqual([]);
    session.report();
  } finally {
    await session.close();
  }
});

test('TC-30: a full room of people writing headings at once leaves every heading on every screen', async ({
  browser
}) => {
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, index) => `writer${index + 1}`);
  const session = await openSession(browser, names);
  try {
    // Spread out, so every heading is somewhere a person clicked rather than in a pile.
    const spots = names.map((_, index) => ({ x: 120 + index * 190, y: 140 + (index % 2) * 320 }));

    await Promise.all(
      names.map(async (name, index) => {
        const page = session.person(name).page;
        await placeTextAt(page, spots[index] as { x: number; y: number });
        await page.keyboard.type(`Heading ${index + 1}`);
        await page.keyboard.press('Escape');
      })
    );

    const expected = names.map((_, index) => `Heading ${index + 1}`).sort();
    await session.eventually('every screen holds every heading the room wrote', async () => {
      for (const person of session.people) {
        const held = await boardObjects(person.page);
        const texts = held
          .filter((object) => object.type === 'text')
          .map((object) => (object as TextSnapshot).text)
          .sort();
        if (texts.join('|') !== expected.join('|')) {
          return `${person.name} holds ${JSON.stringify(texts)}`;
        }
        const drawn = await textElements(person.page).count();
        if (drawn !== expected.length) return `${person.name} draws ${drawn} of ${expected.length}`;
      }
      return true;
    });

    // Each heading is where the person who wrote it clicked: the top-left under their own
    // pointer, not under somebody else's.
    const first = session.person(names[0] as string).page;
    const headings = (await boardObjects(first)).filter((object) => object.type === 'text');
    expect(headings).toHaveLength(MAX_CONCURRENT_EDITORS);
    const places = headings.map((object) => `${Math.round(object.x)},${Math.round(object.y)}`).sort();
    const worlds = [];
    for (const spot of spots) worlds.push(await worldOf(first, spot));
    expect(places).toEqual(
      worlds.map((point) => `${Math.round(point.x)},${Math.round(point.y)}`).sort()
    );

    // Nobody was told to stop typing by anybody else typing.
    for (const person of session.people) {
      expect(person.errors, `no errors on ${person.name}`).toEqual([]);
    }
    session.report();
  } finally {
    await session.close();
  }
});

test('TC-31: text abandoned without a character leaves nothing, not even somewhere to select', async ({
  page
}) => {
  await openBoard(page);

  const spot = { x: 460, y: 320 };
  await placeTextAt(page, spot);
  expect((await boardObjects(page)).length, 'the text exists while it is being written').toBe(1);

  // Walk away.
  await page.keyboard.press('Escape');

  expect((await boardObjects(page)).length, 'nothing was typed, so nothing stays').toBe(0);
  await expect(textElement(page)).toHaveCount(0);
  await expect(textEditor(page)).toHaveCount(0);

  // A marquee over exactly that spot takes nothing with it: the abandoned text is not a
  // ghost that can be selected, moved and deleted a third time.
  await dragWithKey(page, { x: spot.x - 120, y: spot.y - 90 }, { x: spot.x + 220, y: spot.y + 120 }, 'Shift');
  expect(await selectedCount(page), 'nothing was there to select').toBe(0);
  await expect(marqueeBox(page)).toHaveCount(0);
  expect((await boardObjects(page)).length).toBe(0);

  // And the double-click that makes a note is untouched by any of this: one gesture, one
  // note. The board holds the click that placed the text for a moment, so that a single
  // click cannot be both a placed text and half a double-click; this is a new gesture, made
  // after that window, the way a person's would be.
  await page.waitForTimeout(400);
  await page.mouse.dblclick(spot.x, spot.y);
  await expect(notes(page)).toHaveCount(1);
  expect((await boardObjects(page)).length, 'a note, and only a note').toBe(1);
});

test('free text moves with everything else in a marquee, and stays itself', async ({ page }) => {
  await openBoard(page);

  const first = await placeTextAt(page, { x: 200, y: 140 });
  await textEditor(page).fill('One');
  await page.keyboard.press('Escape');
  const second = await placeTextAt(page, { x: 200, y: 300 });
  await textEditor(page).fill('Two');
  await page.keyboard.press('Escape');
  await stickyToolButton(page).click();
  await expect(notes(page)).toHaveCount(1);
  await page.mouse.click(1150, 720);

  const note = (await boardObjects(page)).find((object) => object.type !== 'text')!;
  const before = {
    first: await textOn(page, first),
    second: await textOn(page, second),
    note: { x: note.x, y: note.y }
  };

  await dragWithKey(page, { x: 140, y: 90 }, { x: 780, y: 520 }, 'Shift');
  await expect(textElement(page, 0)).toHaveAttribute('data-selected', 'true');
  await expect(notes(page).first()).toHaveAttribute('data-selected', 'true');

  // Move the block by dragging the note: story 7 moves what is selected, whatever it is.
  await dragObjectBy(page, note.id, 90, 60);

  const movedNote = (await boardObjects(page)).find((object) => object.id === note.id)!;
  const after = {
    first: await textOn(page, first),
    second: await textOn(page, second),
    note: { x: movedNote.x, y: movedNote.y }
  };
  for (const [name, moved] of [
    ['text one', { before: before.first, after: after.first }],
    ['text two', { before: before.second, after: after.second }],
    ['note', { before: before.note, after: after.note }]
  ] as const) {
    expect(closeTo(moved.after.x, moved.before.x + 90, 1), `${name} moved with the block`).toBe(
      true
    );
    expect(closeTo(moved.after.y, moved.before.y + 60, 1)).toBe(true);
  }

  // And each of them is still what it was: one line each, at the size they were made at,
  // with the width their own words gave them.
  for (const [id, words, ownWidth] of [
    [first, 'One', before.first.width],
    [second, 'Two', before.second.width]
  ] as const) {
    const shape = await textOn(page, id);
    expect(shape.text).toBe(words);
    expect(shape.size).toBe('M');
    expect(closeTo(shape.height, before.first.height, 1), 'still one line tall').toBe(true);
    expect(closeTo(shape.width, ownWidth, 1), 'still as wide as its own word').toBe(true);
  }
});

test('a board that could not be loaded offers no Text tool', async ({ browser, request }) => {
  const boardId = await createBoardOn();

  // Make the board real: one note, written the way anybody would write it.
  const maker = await browser.newContext();
  const makerPage = await maker.newPage();
  await openBoardAt(makerPage, boardId);
  await stickyToolButton(makerPage).click();
  await expect(notes(makerPage)).toHaveCount(1);
  await maker.close();

  const corrupted = await request.post(`/__test/boards/${boardId}/corrupt-snapshot`);
  expect(corrupted.status()).toBe(200);

  const visitor = await browser.newContext();
  const page = await visitor.newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  // Not the "open a board" helper: that waits for the board to be in sync, which is the one
  // thing this board will not be.
  await page.goto(`/b/${boardId}`);

  // The tool is there, and it is refused, in the same way the note button is refused.
  await expect(toolButton(page, 'text')).toBeDisabled();
  await expect(toolButton(page, 'select')).toBeEnabled();

  // T does nothing at all: no tool, no text, no half-written object in the document.
  await page.keyboard.press('t');
  expect(await toolMode(page)).not.toBe('text');
  expect(await pressedTool(page)).not.toBe('text');
  await page.mouse.click(400, 300);
  await expect(textEditor(page)).toHaveCount(0);
  await expect(textElement(page)).toHaveCount(0);
  expect((await boardObjects(page)).length).toBe(0);

  expect(consoleErrors, 'a broken board must not break the page').toEqual([]);
  await visitor.close();
});
