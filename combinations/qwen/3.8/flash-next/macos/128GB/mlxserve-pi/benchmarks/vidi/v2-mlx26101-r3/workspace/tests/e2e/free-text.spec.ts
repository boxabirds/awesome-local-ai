/**
 * Free text on the board, in a real browser with real fonts (TC-26 to TC-31).
 *
 * What a text object *is* cannot be checked without a browser: it is a box whose size is a measurement
 * of words, made with a font that only exists on the machine doing the looking. The component suite
 * gets its widths by counting characters, because jsdom will not hand out a canvas to measure with.
 * Here the app measures glyph widths it has actually seen, so the interesting assertions in this file
 * are the ones that put the stored number next to what the browser did with the same words - a height
 * against the lines the page really laid out, a width against the words that had to fit inside it.
 *
 * The other thing only a room can do is the pair of cases at the end: two people typing into one
 * object, and five people each making a heading at the same moment. Both end the way every multiplayer
 * case in this suite ends, which is the way they should - every screen showing the same board.
 *
 * Numbers that come from a measurement are compared with a tolerance, because the PRD asks for "within
 * a couple of units" and because two machines hint a font slightly differently. The numbers asserted
 * exactly are the ones that are decisions rather than measurements: the size names, the handles
 * offered, the words typed.
 */

import { expect, test, type Page } from '@playwright/test';
import { openBoard, settle } from './helpers/board';
import { proseOfLength } from '../fixtures/texts';
import { Cast } from './helpers/participants';
import {
  centreOnScreen,
  createNotesAt,
  dragHandleBy,
  dragObjectBy,
  marqueeDrag,
  outlineIds,
  paintTopId,
  placeOf,
  pressBoardKey,
  screenOf,
  selectionBar,
} from './helpers/selection';
import { noteIds, waitForNoteCount } from './helpers/sticky';
import {
  MAX_CONCURRENT_EDITORS,
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_MIN_WIDTH_WORLD,
  TEXT_SIZES,
} from '../../src/shared/config';
import {
  chooseTextSize,
  chooseTextTool,
  createTextAt,
  drawnText,
  expectTool,
  heightFor,
  handleNames,
  lineHeight,
  linesOf,
  measured,
  openText,
  placeTextAt,
  pressedSize,
  selectText,
  stopTyping,
  textEditor,
  textIds,
  waitForSameText,
  waitForTextCount,
  wordsOf,
} from './helpers/text';

/** A long annotation: three hundred characters of English, no newlines. */
const ANNOTATION = proseOfLength(300);

/** The heading the retro gets a title of, in the PRD's own words. */
const HEADING = 'Went well';

/** How far off a measurement a test will accept, in world units. */
const OFF = 2;

/** `actual` within `off` of `expected`, said in a way that names both. */
function measuredAs(actual: number, expected: number, off = OFF): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${off} units of ${expected}`,
  ).toBeLessThanOrEqual(off);
}

/** The board's undo shortcut, pressed where the keyboard is: on the board. */
async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
  await settle(page);
}

/** How big the browser drew the words, in pixels of its own font. */
async function drawnFontSize(page: Page, id: string): Promise<number> {
  return drawnText(page, id).evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
}

/** The characters of `text` in a fixed order, so two strings can be compared for their contents. */
function sortedCharacters(text: string): string {
  return [...text].sort().join('');
}

test.describe('a long annotation, put there with the Text tool', () => {
  test('TC-26: three hundred characters get a box capped at six hundred units and laid out in lines', async ({
    page,
  }) => {
    await openBoard(page);
    // T, a click, three hundred characters. Nobody made a box first, which is the whole of what makes
    // this a text object rather than a note.
    const id = await placeTextAt(page, { x: -300, y: -200 });
    await textEditor(page).fill(ANNOTATION);
    await settle(page);
    // Out of the field first: while somebody is typing, the field is what is drawn, and what a field
    // wraps at is its own business (a fresh object is forty units wide and the field gives itself room
    // to type in). The lines below are about the box the words ended up in.
    await stopTyping(page);

    const face = await measured(page, id);
    expect(face.text.length, 'the fixture is three hundred characters long').toBe(300);
    expect(face.widthMode, 'nobody dragged a width, so the words still ask for their own').toBe('auto');
    // That line is far wider than the widest box the product sells, so the box is the cap rather than
    // the measurement - within a couple of units, since the measurement is of real glyphs.
    measuredAs(face.width, TEXT_MAX_AUTO_WIDTH_WORLD);
    expect(face.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD + OFF);

    // And the browser put those words into several lines, in a box tall enough for the number of lines
    // it came to. The stored height is the app's own arithmetic on its own measurement; this is the
    // only place in the suite where the two can be set side by side.
    const lines = await linesOf(page, id);
    expect(lines, 'three hundred characters do not fit on one line').toBeGreaterThan(3);
    measuredAs(face.height, lineHeight('M') * lines, lineHeight('M'));

    // The words are still there, drawn rather than being typed.
    await expect(textEditor(page)).toHaveCount(0);
    expect(await wordsOf(page, id)).toBe(ANNOTATION);
    expect(await handleNames(page), 'a long annotation is resized from the sides only').toEqual([
      'e',
      'w',
    ]);
  });

  test('TC-27: dragging the right handle sideways rewraps the words and grows the height', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createTextAt(page, { x: -400, y: -150 }, ANNOTATION, { paste: true });

    const before = await measured(page, id);
    expect(await handleNames(page)).toEqual(['e', 'w']);
    const drawn = await linesOf(page, id);

    // Two hundred units inwards, and released. The drag is horizontal on purpose: what a side handle
    // does to a text object is a width, and the height is the object's own business afterwards.
    await selectText(page, id);
    await dragHandleBy(page, 'e', { x: -200, y: 0 });

    const after = await measured(page, id);
    measuredAs(after.width, before.width - 200);
    expect(after.widthMode, 'the words are inside a width somebody chose now').toBe('fixed');
    // The box grew by itself: the same words in a narrower width come to more lines, and the height is
    // the number of lines. Nothing in this drag said "taller".
    expect(after.height, 'a narrower box holds the same words in more lines').toBeGreaterThan(
      before.height,
    );
    const afterLines = await linesOf(page, id);
    expect(
      afterLines,
      'the words rewrapped in the browser too, not only in the document',
    ).toBeGreaterThan(drawn);
    measuredAs(after.height, heightFor('M', afterLines), lineHeight('M'));
    // Still two handles and only two: a box that grew on its own has not been offered a handle for
    // growing, which is the promise this whole story is built on.
    expect(await handleNames(page)).toEqual(['e', 'w']);
    expect(await wordsOf(page, id)).toBe(ANNOTATION);
  });

  test('TC-27b: a width dragged narrow enough to be silly stops at the narrowest the product sells', async ({
    page,
  }) => {
    await openBoard(page);
    const id = await createTextAt(page, { x: -100, y: -120 }, HEADING);
    const before = await measured(page, id);

    await selectText(page, id);
    // Four fifths of the box's own width, to the right: the side handle takes the left edge of the box
    // with it, so pulling right is what narrows a box, and this finishes the pointer far past where
    // the words leave off - a width nobody can read, which is the point. It stops short of the far
    // edge of the box on purpose: a box dragged flat to nothing is the degenerate case every object on
    // the board shares, and the floor being looked at here is the one this object's own type sets.
    await dragHandleBy(page, 'w', { x: Math.round(before.width * 0.8), y: 0 });

    const face = await measured(page, id);
    measuredAs(face.width, TEXT_MIN_WIDTH_WORLD, 0);
    expect(face.width, 'the floor is a floor rather than a suggestion').toBeGreaterThanOrEqual(
      TEXT_MIN_WIDTH_WORLD,
    );
    expect(await wordsOf(page, id), 'the heading survived being squeezed').toBe(HEADING);
    expect(
      await linesOf(page, id),
      'and it came to more lines rather than to fewer words',
    ).toBeGreaterThan(1);
  });
});

test.describe('titling a retro section', () => {
  test('TC-28: a heading made bigger, dropped on the cluster, deleted and got back', async ({
    page,
  }) => {
    await openBoard(page);
    // A cluster of notes is what a heading goes over. Made first, so that the heading is later than
    // every one of them and should lie on top without anybody having to ask.
    const notes = await createNotesAt(page, [
      { x: -150, y: 120 },
      { x: 60, y: 120 },
      { x: -45, y: 300 },
    ]);
    expect(notes).toHaveLength(3);

    // The heading, above the cluster, typed with the Text tool.
    const id = await createTextAt(page, { x: -60, y: -80 }, HEADING);
    expect(await pressedSize(page), 'a heading that has been selected is offered its sizes').toBe('M');

    // Bigger from the bar. XL is a size of the letters rather than a scale of the box, so the words are
    // drawn at fifty-six pixels and the box was measured at that size before it was stored.
    await chooseTextSize(page, id, 'XL');
    expect(await pressedSize(page)).toBe('XL');
    measuredAs(await drawnFontSize(page, id), TEXT_SIZES.XL, 0);
    const big = await measured(page, id);
    expect(big.height).toBe(heightFor('XL', await linesOf(page, id)));

    // Dropped on the cluster: it moves as a whole, and lies over the note it covers - which is the
    // sentence in the spec about a title being on top of the section it titles, said in the only
    // language a browser understands: which element the pointer hits first.
    await dragObjectBy(page, id, { x: 60, y: 200 });
    const moved = await placeOf(page, id);
    measuredAs(moved.x, big.x + 60);
    measuredAs(moved.y, big.y + 200);
    expect(
      await paintTopId(page, {
        x: moved.x + moved.width / 2,
        y: moved.y + moved.height / 2,
      }),
      'the heading is the topmost thing where it landed',
    ).toBe(id);
    expect(await noteIds(page), 'the notes are still there under it').toHaveLength(3);

    // Gone, with the board's own Delete key. Only the heading goes: the notes were never part of it.
    await pressBoardKey(page, 'Delete');
    await waitForTextCount(page, 0);
    await waitForNoteCount(page, 3);
    expect(await outlineIds(page)).toEqual([]);

    // And back with one Ctrl+Z: the object, its words, and the size it had been given. An undo that
    // brought back an empty heading, or one that had forgotten it was a title, would be a history that
    // remembered a deletion but not the thing that was deleted.
    await pressUndo(page);
    await waitForTextCount(page, 1);
    const back = await measured(page, (await textIds(page))[0]!);
    expect(back.text).toBe(HEADING);
    expect(back.size).toBe('XL');
    // The width is still the one the words asked for: nothing in this test dragged a side handle,
    // which is the only thing that turns a text object into one inside a width somebody chose. An undo
    // that brought the words back in a fixed width would be a history that remembered a drag that
    // never happened.
    expect(back.widthMode).toBe('auto');
  });

  test('TC-28b: undoing a heading leaves the notes it was sitting on alone', async ({ page }) => {
    await openBoard(page);
    const notes = await createNotesAt(page, [
      { x: -150, y: 120 },
      { x: 60, y: 120 },
    ]);

    await createTextAt(page, { x: 0, y: -60 }, HEADING);
    // Two presses, because two things happened: putting a heading on the board is one thing that
    // occurred to the board, and the letters typed into it are the next one - the same history that
    // takes a written sentence back in one press takes a heading back in two. What matters here is
    // what does not move in between: the notes were somebody else's doing, at least as far as this
    // person's history is concerned.
    await pressUndo(page);
    expect(await noteIds(page)).toEqual(notes);
    await pressUndo(page);

    // The heading is undone and the notes are not. History is a person's own, and the notes were put
    // down by a different action than this one - so a history that swept them up too would be a
    // history that undid the board rather than the person.
    await waitForTextCount(page, 0);
    const stillThere = await noteIds(page);
    expect(stillThere).toHaveLength(2);
    expect(stillThere).toEqual(notes);
    expect(await outlineIds(page)).toEqual([]);
  });
});

test.describe('two people in one heading', () => {
  test('TC-29: typing into the same text at the same time leaves both sets of words, once each', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'alex', 'sam');
    const alex = cast.by('alex');
    const sam = cast.by('sam');

    // One person makes the heading; the other sees it before either of them types in it again, so that
    // what follows is a collision inside one object rather than a race about whether it exists.
    const id = await createTextAt(alex.page, { x: -120, y: -60 }, 'Retro: ');
    await waitForTextCount(sam.page, 1);

    // Both of them open it. There is no lock in this product, and this is the case that shows why the
    // words in a text object are a shared sequence of characters rather than a string somebody writes.
    await openText(alex.page, id);
    await openText(sam.page, id);

    const LEFT = 'went well overall';
    const RIGHT = 'two things to fix';
    // At the same moment, on two machines, into one field. Neither knows about the other while it is
    // happening: leaving that to the document is the entire design.
    await Promise.all([alex.page.keyboard.type(LEFT), sam.page.keyboard.type(RIGHT)]);
    await settle(alex.page);
    await settle(sam.page);

    // Same words on both screens, and every character either person typed is in them exactly as often
    // as it was typed. Where they landed is the merge's business - a caret that shifts under a person
    // typing is an annoyance, not a loss - but a character that went missing while two people were
    // typing is the failure this case exists to catch.
    const settled = await waitForSameText([alex, sam]);
    const words = await wordsOf(alex.page, id);
    expect(sortedCharacters(words)).toBe(sortedCharacters(`Retro: ${LEFT}${RIGHT}`));
    expect(settled).toContain('Retro: ');

    await stopTyping(alex.page);
    await stopTyping(sam.page);
    // Both out of the field, and what they are left looking at is one heading, not two, and not a note
    // made out of the collision.
    await waitForTextCount(alex.page, 1);
    await waitForSameText([alex, sam]);
    expect(await textIds(sam.page)).toEqual(await textIds(alex.page));
    expect(alex.problems, 'alex saw no complaints in the console').toEqual([]);
    expect(sam.problems, 'sam saw no complaints in the console').toEqual([]);

    await cast.close();
  });

  test('TC-29b: the person watching a heading being written sees it arrive', async ({ browser }) => {
    const cast = await Cast.open(browser, 'alex', 'sam');
    const alex = cast.by('alex');
    const sam = cast.by('sam');

    const id = await createTextAt(alex.page, { x: -120, y: -60 }, 'one');
    await waitForTextCount(sam.page, 1);
    expect(await wordsOf(sam.page, id)).toBe('one');

    // Alex keeps writing, in front: the box grows because the words grew, and Sam's screen follows a
    // box it had nothing to do with measuring.
    await openText(alex.page, id);
    await alex.page.keyboard.type(' of them');
    await stopTyping(alex.page);

    const settled = await waitForSameText([alex, sam]);
    expect(await wordsOf(sam.page, id)).toBe('one of them');
    expect(settled).toContain('one of them');
    expect(sam.problems).toEqual([]);

    await cast.close();
  });
});

test.describe('a room full of headings', () => {
  test(`TC-30: ${MAX_CONCURRENT_EDITORS} people each put a heading on the board at once`, async ({
    browser,
  }) => {
    const names = ['alex', 'sam', 'jules', 'ray', 'nadia'].slice(0, MAX_CONCURRENT_EDITORS);
    const cast = await Cast.open(browser, ...names);
    // Spread out, so that nobody's click lands on anybody else's heading, and so that a heading that
    // arrives late can be told from a heading that never arrived.
    const places = names.map((_name, index) => ({
      x: -500 + index * 220,
      y: index % 2 === 0 ? -160 : 120,
    }));
    const headings = names.map((_name, index) => `Heading ${index + 1}`);

    // All at once: five Text tools, five clicks, five sets of keystrokes, five documents being written
    // simultaneously. Nothing here waits for anybody else, which is what makes it simultaneous rather
    // than a queue.
    await Promise.all(
      names.map(async (_name, index) => {
        const person = cast.by(names[index]!);
        await placeTextAt(person.page, places[index]!);
        await person.page.keyboard.type(headings[index]!);
        await stopTyping(person.page);
      }),
    );

    // Every heading on every screen: the count, and the words. A heading that only exists on the
    // machine that typed it is the failure this case is about - and it is the same failure a board
    // would have if text objects were drawn but never written into the document.
    const settled = await waitForSameText(cast.people);
    await Promise.all(cast.people.map((person) => waitForTextCount(person.page, names.length)));
    const seen = JSON.parse(settled) as { words: string }[];
    expect(seen.map((face) => face.words).sort()).toEqual(headings.slice().sort());

    // And one of those screens, looked at directly: each heading is drawn with its own words, in a box
    // of its own, and the box is the size of those words.
    const first = cast.by(names[0]!);
    const id = (await textIds(first.page)).sort()[0]!;
    const face = await measured(first.page, id);
    expect(headings).toContain(face.text);
    expect(face.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
    expect(face.height).toBeGreaterThanOrEqual(heightFor(face.size, 1));
    expect(await linesOf(first.page, id)).toBe(1);

    for (const person of cast.people) {
      expect(person.problems, `${person.name} saw no complaints in the console`).toEqual([]);
    }

    await cast.close();
  });

  test('TC-30b: a heading is on everybody else\'s screen while it is still being typed', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'alex', 'sam');
    const alex = cast.by('alex');
    const sam = cast.by('sam');

    // Alex puts a heading down and both pages have seen it, so that the timing below is about words
    // rather than about whether a new object makes it across a room at all.
    const id = await createTextAt(alex.page, { x: -120, y: -60 }, 'Went');
    await waitForTextCount(sam.page, 1);

    // Alex goes back into the same heading and finishes the sentence, without ever leaving the field.
    await openText(alex.page, id);
    const started = Date.now();
    await alex.page.keyboard.type(' well');
    // Sam sees the finished sentence within a second of it being written, while Alex is still in the
    // middle of it: the words travel while the caret is still in them, which is the difference between
    // a board that is shared and a board that is eventually filed.
    await expect
      .poll(() => wordsOf(sam.page, id).then((words) => words === 'Went well'), {
        timeout: 1_000,
        intervals: [25, 50, 100],
        message: "sam should see the words alex is still typing within a second",
      })
      .toBe(true);
    console.log(`[latency] TC-30b finished sentence reached sam in ${Date.now() - started}ms`);

    // And Alex, still in the field, is looking at a box that was measured around those words - which it
    // can be, because whoever writes the words is the one who writes the box.
    const face = await measured(alex.page, id);
    expect(face.width).toBeGreaterThan(TEXT_MIN_WIDTH_WORLD);
    expect(face.widthMode).toBe('auto');

    await stopTyping(alex.page);
    await waitForSameText([alex, sam]);
    await cast.close();
  });
});

test.describe('text nobody wanted', () => {
  test('TC-31: a click with the Text tool and nothing typed leaves no object at all', async ({
    page,
  }) => {
    await openBoard(page);
    const at = { x: 200, y: -50 };

    // A click that puts a text object down, and an Escape that decides against it.
    await chooseTextTool(page);
    const screen = await screenOf(page, at);
    await page.mouse.click(screen.x, screen.y);
    await expect(textEditor(page), 'a click with the Text tool up should open a field').toBeFocused();
    await page.keyboard.press('Escape');
    await settle(page);

    // No text object. Not an empty one, not an invisible one, not one a marquee will find later.
    await waitForTextCount(page, 0);
    expect(await textIds(page)).toEqual([]);
    // And not a note either: the click was a click, and it was the Text tool holding the mouse - the
    // board's oldest gesture has to stay out of the way of the newest one.
    expect(await noteIds(page)).toEqual([]);
    await expectTool(page, 'select');
    expect(await outlineIds(page)).toEqual([]);

    // Drag a box over the spot where the object was made and abandoned: the marquee finds nothing,
    // because there is nothing there, rather than finding an object nobody can see.
    await marqueeDrag(page, { x: at.x - 80, y: at.y - 60 }, { x: at.x + 120, y: at.y + 60 });
    expect(await outlineIds(page)).toEqual([]);
    await expect(selectionBar(page)).toHaveCount(0);
  });

  test('TC-31b: words typed and then rubbed out are abandoned too', async ({ page }) => {
    await openBoard(page);
    await placeTextAt(page, { x: 200, y: -50 }, HEADING);

    // Back to nothing the way a person does it, and then Escape: the object was empty when the typing
    // ended, and an empty text object is not a thing this board keeps lying around.
    await textEditor(page).fill('');
    await settle(page);
    await stopTyping(page);

    await waitForTextCount(page, 0);
    expect(await textIds(page)).toEqual([]);
    expect(await outlineIds(page)).toEqual([]);
    expect(await noteIds(page)).toEqual([]);
  });

  test("TC-31c: the Text tool over somebody's note is a click, not a new note", async ({ page }) => {
    await openBoard(page);
    const notes = await createNotesAt(page, [{ x: 0, y: 0 }], ['a note about handover']);

    await chooseTextTool(page);
    // A click on the note, with the Text tool up: the tool wants to put a heading down wherever the
    // pointer goes, and a note already lying there does not stop it. What it must not do is make a
    // second note, which is the one thing a careless implementation of "click to place" does.
    const at = await centreOnScreen(page, notes[0]!);
    await page.mouse.click(at.x, at.y);
    await expect(textEditor(page), 'a heading can be started on top of a note').toBeFocused();
    await page.keyboard.type('on top');
    await stopTyping(page);

    await waitForNoteCount(page, 1);
    await waitForTextCount(page, 1);
    const heading = (await textIds(page))[0]!;
    expect(await wordsOf(page, heading)).toBe('on top');
    // The heading came out on top of the note it was dropped on, which is what a heading over a note
    // means: the newest object is the nearest one.
    const face = await placeOf(page, heading);
    expect(
      await paintTopId(page, { x: face.x + face.width / 2, y: face.y + face.height / 2 }),
      'the heading lies over the note it was dropped on',
    ).toBe(heading);
    expect(await linesOf(page, heading)).toBe(1);
    // And the page is not typing in anything: the field closed when the heading did, and the note under
    // it was never opened, because a heading being written is not a note being written.
    await expect(textEditor(page)).toHaveCount(0);
    await expect(page.getByTestId('sticky-note-editor')).toHaveCount(0);
  });
});
