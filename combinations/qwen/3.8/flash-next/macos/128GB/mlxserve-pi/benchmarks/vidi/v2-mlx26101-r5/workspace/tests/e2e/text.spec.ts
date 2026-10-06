/**
 * Writing free text anywhere on the board, in browsers, over a real room.
 *
 * The story is a person who wants to put a heading over a cluster of notes: press T, click where the
 * words should start, type. What the browser is the only place to check is the part of that which is
 * made of fonts — that a long annotation stops at the width the board gives it and goes on over more
 * lines instead of running off, that narrowing a column moves the words to new lines and makes the box
 * taller, and that the size a person picked is the size that is drawn. Where the check could have been
 * done without a browser it was done in the component tests; these are the ones that need a real one.
 *
 * Two of them need more than one browser: the same heading written by two people at once, and a whole
 * room of people each putting a heading down on the same board at the same moment.
 */

import { expect, test } from '@playwright/test';

import {
  createNotesAt,
  dragFromPoint,
  dragObjectAndSettle,
  handleNames,
  handleScreen,
  expectObjectCount,
  marqueeDrag,
  objectCount,
  openBoard,
  selectedIds,
  waitForObjectAtRest,
} from './helpers/board';
import {
  closeParticipants,
  expectEventually,
  expectNoConsoleErrors,
  expectChangeToArrive,
  newBoard,
  openParticipants,
} from './helpers/participants';
import {
  chooseTextSize,
  lineHeightPx,
  LONG_ANNOTATION,
  openText,
  placeText,
  renderedLines,
  stopWriting,
  textContent,
  textCount,
  textEditor,
  textEditorValue,
  textFontPx,
  textIds,
  textSnapshot,
  textToolbar,
  textWorld,
  toolState,
  typeText,
  WRAPPED_NOTE,
} from './helpers/text';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';

/** Every character both people typed is in the text, once each. */
function countCharacter(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * The text is made of the characters it was made of, and nothing was lost.
 *
 * The order is not asserted and cannot be: two people writing at one spot in one text is not a sequence.
 * What the story promises is that nobody loses a character, and that both browsers end up holding one
 * text rather than two halves of one.
 */
function hasExactlyTheseCharacters(text: string, base: string, typed: string): boolean {
  return (
    text.length === base.length + typed.length &&
    [...typed].every((character) => countCharacter(text, character) === 1) &&
    [...base].every((character) => countCharacter(text, character) === countCharacter(base, character))
  );
}

test.describe('writing anywhere on the board', () => {
  test('TC-26 an annotation longer than the board is wide stops at the width and goes down', async ({
    page,
  }) => {
    await openBoard(page);

    const id = await placeText(page, 320, 240);
    // The fixture is the one the story describes: a whole paragraph pasted in one go.
    expect(LONG_ANNOTATION, 'the fixture is three hundred characters').toHaveLength(300);
    await typeText(page, LONG_ANNOTATION);

    // The box stops at the width the board gives it. The number is measured by the person typing and put
    // in the document, which is why the other screens do not have to guess it.
    const box = await textWorld(page, id);
    expect(Math.abs(box.width - TEXT_MAX_AUTO_WIDTH_WORLD)).toBeLessThanOrEqual(2);
    expect(box.widthMode, 'nobody has taken the width yet').toBe('auto');
    expect(box.height, 'taller than one line').toBeGreaterThan(lineHeightPx('M'));

    // And it is drawn that way: the words are over more than one line on the screen, the height is a
    // whole number of lines, and no counter is shouting about a limit that is nowhere near.
    await stopWriting(page);
    expect(await renderedLines(page, id)).toBeGreaterThan(1);
    const drawn = await textWorld(page, id);
    expect(drawn.height / lineHeightPx('M'), 'the box is a whole number of lines').toBeCloseTo(
      Math.round(drawn.height / lineHeightPx('M')),
      6,
    );
    expect(await textEditor(page).count(), 'the editor is gone once writing stops').toBe(0);
    expect((await textToolbar(page).count()) > 0, 'the bar over one piece of text').toBe(true);
  });

  test('TC-27 pulling a side in moves the words to new lines and makes the box taller', async ({
    page,
  }) => {
    await openBoard(page);

    const id = await placeText(page, 300, 260);
    await typeText(page, WRAPPED_NOTE);
    await stopWriting(page);

    // Two handles, and only two: this is a thing whose height comes out of its words, so there is nothing
    // a handle above or below could be asked to do.
    expect(await handleNames(page)).toEqual(['w', 'e']);

    const was = await textWorld(page, id);
    const lines = await renderedLines(page, id);
    expect(lines).toBeGreaterThan(1);

    await dragFromPoint(page, await handleScreen(page, 'e'), -150, 0);
    await waitForObjectAtRest(page, id);
    const now = await textWorld(page, id);

    // The width is the drag's, and now it is the object's too: it holds a width somebody chose, and will
    // keep it over the lines that follow. The height is still the words' — more of them, on more lines.
    expect(Math.abs(now.width - (was.width - 150))).toBeLessThanOrEqual(2);
    expect(now.widthMode, 'a width somebody pulled is a width they asked for').toBe('fixed');
    expect(now.height).toBeGreaterThan(was.height);
    expect(await renderedLines(page, id)).toBeGreaterThan(lines);

    // Still nothing above or below it, and the words are the words they were.
    expect(await handleNames(page)).toEqual(['w', 'e']);
    expect(await textContent(page, id)).toBe(WRAPPED_NOTE);
  });

  test('TC-28 a heading, sized, moved, deleted and Undo-ed, in that order', async ({ page }) => {
    await openBoard(page);

    // A cluster of notes to put a heading over.
    const notes = await createNotesAt(page, [
      { x: 520, y: 520 },
      { x: 780, y: 520 },
    ]);
    expect(notes).toHaveLength(2);

    // A heading above them, written with the Text tool and left selected.
    const heading = await placeText(page, 480, 300);
    await typeText(page, 'Went well');
    await stopWriting(page);
    expect(await toolState(page)).toBe('select');

    // Made a heading. The size in the bar is the size the words are drawn at, and the box is measured for
    // the size it has become, in the same step.
    await chooseTextSize(page, 'XL');
    const sized = await textWorld(page, heading);
    expect(sized.size).toBe('XL');
    expect(await textFontPx(page, heading)).toBe(TEXT_SIZES.XL);
    expect(Math.abs(sized.height - lineHeightPx('XL'))).toBeLessThanOrEqual(1);

    // Dragged over the cluster, on top of the notes it belongs to.
    const moved = await dragObjectAndSettle(page, heading, 120, 220);
    expect(Math.abs(moved.x - (sized.x + 120))).toBeLessThanOrEqual(1);
    expect(moved.z, 'the heading is above the notes').toBeGreaterThan(
      (await waitForObjectAtRest(page, notes[0] as string)).z,
    );

    // Gone: one press, and the board has only its notes on it.
    await page.keyboard.press('Delete');
    await expectObjectCount(page, notes.length);
    expect(await textCount(page)).toBe(0);

    // One press back, and it is there again — with its words and its size, which is the whole point of the
    // size change and the object being one thing a person did rather than two.
    await page.keyboard.press('Control+z');
    await expectObjectCount(page, notes.length + 1);
    expect(await textContent(page, heading)).toBe('Went well');
    const back = await textWorld(page, heading);
    expect(back.size).toBe('XL');
    expect(back.widthMode).toBe('auto');

    // The notes were never part of any of it: three objects on the board, one of them a heading.
    expect(await textCount(page)).toBe(1);
    expect(await objectCount(page)).toBe(3);
  });

  test('TC-29 two people writing in one heading keep every character', async ({ browser }, testInfo) => {
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);

    // Alex lays a heading down and stops writing; Sam sees it and opens it, and so does Alex.
    const id = await placeText(alex.page, 420, 260);
    await typeText(alex.page, 'retro: ');
    await stopWriting(alex.page);
    await expectChangeToArrive([sam], 'the heading Alex wrote', () =>
      textContent(sam.page, id).then((text) => text === 'retro: '),
    );

    await openText(alex.page, id);
    await openText(sam.page, id);
    expect(await textEditor(alex.page).count()).toBe(1);
    expect(await textEditor(sam.page).count()).toBe(1);

    // Both write at once, as far as two browsers manage: neither one finishes before the other starts.
    const typedByAlex = 'abc';
    const typedBySam = 'xyz';
    for (const [byAlex, bySam] of [['a', 'x'], ['b', 'y'], ['c', 'z']] as const) {
      await Promise.all([alex.page.keyboard.type(byAlex), sam.page.keyboard.type(bySam)]);
    }

    // Every character is there, in both browsers, and the two browsers hold one text rather than two
    // arguments about it. `hasExactlyTheseCharacters` is the accounting: the base, plus one of each of
    // the six characters, and nothing else — so the length is settled there rather than here.
    await expectEventually(alex, 'Sam’s writing in Alex’s browser', () =>
      textEditorValue(alex.page).then((text) => 'xyz'.split('').every((c) => text.includes(c))),
    );
    const seenByAlex = await textEditorValue(alex.page);
    await stopWriting(alex.page);
    await stopWriting(sam.page);
    const seenBySam = await textContent(sam.page, id);
    expect(await textContent(alex.page, id)).toBe(seenBySam);
    expect(hasExactlyTheseCharacters(seenBySam, 'retro: ', typedByAlex + typedBySam)).toBe(true);
    expect(seenByAlex.length).toBe(seenBySam.length);

    // One heading, one box around it on both screens, and nobody's console complaining.
    expect(await textSnapshot(alex.page)).toBe(await textSnapshot(sam.page));
    expectNoConsoleErrors([alex, sam]);
    await testInfo.attach('heading', {
      body: `${seenBySam}\n${await textSnapshot(alex.page)}`,
      contentType: 'text/plain',
    });
    await closeParticipants([alex, sam]);
  });

  test(`TC-30 a room of people, each writing a heading at once`, async ({ browser }) => {
    const boardId = newBoard();
    const names = ['Ada', 'Bo', 'Cy', 'Di', 'Eve', 'Fay', 'Gus', 'Hal'].slice(0, MAX_CONCURRENT_EDITORS);
    const people = await openParticipants(browser, names, boardId);

    // Everyone takes the Text tool and clicks at the same moment, at points spread over the board. Each
    // creation is one object in one document, and the room is full: nobody is told to go away.
    const started = await Promise.all(
      people.map(async (person, index) => {
        const point = { x: 180 + index * 120, y: 220 + (index % 2) * 300 };
        return placeText(person.page, point.x, point.y);
      }),
    );
    expect(new Set(started).size, 'every heading is its own object').toBe(started.length);

    // Everyone writes at once too, so the room is writing as well as creating.
    await Promise.all(people.map((person, index) => typeText(person.page, `heading ${index + 1}`)));

    // Every screen ends up with every heading on it, including the one that person wrote themselves —
    // and the words, not just the boxes: what has to arrive is the writing, and an object that turned up
    // with nothing in it would be the bug this test exists to catch.
    const written = names.map((_, index) => `heading ${index + 1}`);
    for (const person of people) {
      await expectEventually(person, `${names.length} headings on ${person.name}’s board`, () =>
        textSnapshot(person.page).then((snap) => written.every((words) => snap.includes(words))),
      );
    }
    const everyone = await Promise.all(people.map((person) => textSnapshot(person.page)));
    for (const [index, snapshot] of everyone.entries()) {
      expect(snapshot, `${names[index]}’s board matches the next`).toBe(everyone[0]);
    }
    for (const person of people) {
      expect(
        await textSnapshot(person.page).then((snap) =>
          started.every((id) => snap.includes(id)),
        ),
        'every heading is on the board by its own id',
      ).toBe(true);
    }
    expectNoConsoleErrors(people);
    await closeParticipants(people);
  });

  test('TC-31 a heading given up on leaves nothing on the board', async ({ page }) => {
    await openBoard(page);

    // The pointer was put down to write and nothing was written.
    const point = { x: 460, y: 300 };
    await page.keyboard.press('t');
    await page.mouse.click(point.x, point.y);
    await expect(textEditor(page)).toBeVisible();
    expect(await textCount(page)).toBe(1);

    await stopWriting(page);

    // There is no object: not on the board, and not in the document either, which is what "not an
    // invisible object" means for anybody looking at the board afterwards.
    expect(await textCount(page)).toBe(0);
    expect(await objectCount(page)).toBe(0);
    expect(await toolState(page)).toBe('select');

    // A rectangle pulled over the spot where the words would have been picks up nothing at all.
    await marqueeDrag(page, { x: point.x - 60, y: point.y - 40 }, { x: point.x + 160, y: point.y + 60 });
    expect(await selectedIds(page)).toEqual([]);
    expect(await textCount(page)).toBe(0);

    // And the board is still a board: a heading written after it works the same as one written before.
    const id = await placeText(page, point.x, point.y);
    await typeText(page, 'still here');
    await stopWriting(page);
    expect(await textContent(page, id)).toBe('still here');
    expect(await objectCount(page)).toBe(1);
    expect(await textIds(page)).toEqual([id]);
  });
});
