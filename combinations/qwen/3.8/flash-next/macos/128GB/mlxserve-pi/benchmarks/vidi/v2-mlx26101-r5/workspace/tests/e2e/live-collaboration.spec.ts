/**
 * Two people on one board, in two browsers, over a real room.
 *
 * What is checked here is the promise the story makes: what one person does shows up in the
 * other person's browser, on its own, without that browser reloading, clicking "sync" or
 * doing anything else. Every wait for a change is timed; the timings are printed at the end
 * of the run (`helpers/latency-report.ts`) and not asserted, because model, browsers and
 * server all share one machine here.
 *
 * Selection and the text editor are deliberately left out of what travels: a board shows
 * what the board holds, not what somebody else has their cursor on.
 */

import { expect, test } from '@playwright/test';

import {
  clickNote,
  dragNote,
  editorLocator,
  editorValue,
  note,
  noteColor,
  noteScreenBox,
  noteText,
  noteWorld,
  settled,
  toolbarCreate,
  waitForNoteAtRest,
} from './helpers/board';
import {
  closeParticipants,
  openParticipant,
  expectChangeToArrive,
  expectEventually,
  expectNoConsoleErrors,
  expectSameBoard,
  newBoard,
  noteCount,
  openParticipants,
  stopEditing,
  writeLatencyReport,
  type Participant,
} from './helpers/participants';

/** How many times `character` occurs in `text`. */
function countCharacter(text: string, character: string): number {
  return text.split(character).length - 1;
}

/**
 * Every character both people typed is in the text, once each.
 *
 * The order they came in is not asserted, and cannot be: two people typing at the same spot
 * in one text box is not a sequence. What the story asks is that nobody loses a character
 * and that both browsers hold the same text, so that is what is checked.
 */
function hasExactlyTheseCharacters(text: string, base: string, typed: string): boolean {
  return (
    text.length === base.length + typed.length &&
    [...typed].every((character) => countCharacter(text, character) === 1) &&
    [...base].every((character) => countCharacter(text, character) === countCharacter(base, character))
  );
}

/** Types at the end of what is in the box, one person at a time. */
async function typeIntoEditor(person: Participant, text: string): Promise<void> {
  await person.page.keyboard.type(text);
}

test.describe('two people, one board', () => {
  test('TC-22 what one person does shows up in the other person’s browser', async ({
    browser,
  }, testInfo) => {
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);

    // Alex creates a note from the toolbar. It arrives on its own, and keeps its id.
    const id = await toolbarCreate(alex.page);
    await expectChangeToArrive([sam], 'the note Alex created', () => noteCount(sam.page).then((n) => n === 1));
    await expectEventually(sam, 'the same note id on Sam’s board', () =>
      note(sam.page, id).isVisible(),
    );

    // Alex types. The words arrive while Alex is still typing them.
    await typeIntoEditor(alex, 'good morning');
    await expectChangeToArrive([sam], 'the words Alex typed', () =>
      noteText(sam.page, id).then((text) => text === 'good morning'),
    );
    await stopEditing(alex.page);

    // Alex recolours it.
    await alex.page.getByTestId('color-pink').click();
    await expectChangeToArrive([sam], 'the new colour', () =>
      noteColor(sam.page, id).then((color) => color === 'pink'),
    );

    // Alex drags it somewhere else.
    await dragNote(alex.page, id, 160, -110);
    await expectChangeToArrive([sam], 'the note Alex moved', async () => {
      const here = await noteWorld(sam.page, id);
      const there = await noteWorld(alex.page, id);
      return Math.abs(here.x - there.x) < 3 && Math.abs(here.y - there.y) < 3;
    });

    // Alex deletes it, and it goes away for everybody.
    await alex.page.getByTestId('delete-note').click();
    await expectChangeToArrive([sam], 'the note being deleted', () =>
      noteCount(sam.page).then((count) => count === 0),
    );

    await expectSameBoard([alex, sam], 'both boards empty after the delete');
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'tc-22');
    await closeParticipants([alex, sam]);
  });

  test('TC-22 a page that is not reloaded and a person who does nothing', async ({
    browser,
  }, testInfo) => {
    // The awkward case in the PRD: Sam's browser has been open the whole time. Sam does not
    // reload, does not click anything, and still ends up looking at Alex's board.
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);
    const samUrlBefore = sam.page.url();

    for (let index = 0; index < 3; index += 1) {
      await toolbarCreate(alex.page);
      await typeIntoEditor(alex, `note ${index + 1}`);
      await stopEditing(alex.page);
    }

    await expectEventually(
      sam,
      'all three notes Alex made',
      async () => (await noteCount(sam.page)) === 3,
      { timeoutMs: 30_000 },
    );
    for (const index of [1, 2, 3]) {
      const found = await sam.page
        .locator('.sticky-text')
        .allInnerTexts()
        .then((texts) => texts.includes(`note ${index}`));
      expect(found, `Sam can read "note ${index}"`).toBe(true);
    }

    expect(sam.page.url(), 'Sam’s browser never navigated').toBe(samUrlBefore);
    await expectSameBoard([alex, sam], 'three notes on both boards');
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'tc-22-no-reload');
    await closeParticipants([alex, sam]);
  });

  test('TC-23 two people typing in one note keep every character', async ({
    browser,
  }, testInfo) => {
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);

    const id = await toolbarCreate(alex.page);
    await typeIntoEditor(alex, 'shopping: ');
    await stopEditing(alex.page);
    await expectEventually(sam, 'the note to arrive', () => noteText(sam.page, id).then((t) => t === 'shopping: '));

    // Both open the same note for editing, and then type at the same time.
    await clickNote(alex.page, id);
    await alex.page.keyboard.press('Enter');
    await clickNote(sam.page, id);
    await sam.page.keyboard.press('Enter');
    await expect(editorLocator(alex.page)).toBeVisible();
    await expect(editorLocator(sam.page)).toBeVisible();

    const alexTyped = 'abc';
    const samTyped = 'xyz';
    const keystrokes: ReadonlyArray<readonly [string, string]> = [
      ['a', 'x'],
      ['b', 'y'],
      ['c', 'z'],
    ];
    for (const [byAlex, bySam] of keystrokes) {
      // Simultaneously, as far as two browsers get: neither one finishes before the other starts.
      await Promise.all([alex.page.keyboard.type(byAlex), sam.page.keyboard.type(bySam)]);
    }

    await stopEditing(alex.page);
    await stopEditing(sam.page);

    const base = 'shopping: ';
    await expectEventually(
      alex,
      'Sam’s typing in Alex’s browser',
      () => noteText(alex.page, id).then((text) => countCharacter(text, 'x') + countCharacter(text, 'y') + countCharacter(text, 'z') === 3),
    );
    const alexSees = await noteText(alex.page, id);
    const samSees = await noteText(sam.page, id);
    // Both browsers hold one text, and it is made of exactly what both of them typed.
    expect(alexSees).toBe(samSees);
    expect(hasExactlyTheseCharacters(alexSees, base, alexTyped + samTyped)).toBe(true);

    await expectSameBoard([alex, sam], 'one note, both people’s typing');
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'tc-23');
    await closeParticipants([alex, sam]);
  });

  test('TC-24 two people dragging one note agree where it ended up', async ({ browser }, testInfo) => {
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);

    const id = await toolbarCreate(alex.page);
    await stopEditing(alex.page);
    await waitForNoteAtRest(alex.page, id);
    await settled(alex.page);
    const start = await noteWorld(alex.page, id);

    // Both press the same note at the same moment and pull it their own way.
    const box = await noteScreenBox(alex.page, id);
    const cx = box.cx;
    const cy = box.cy;
    await Promise.all([alex.page.mouse.move(cx, cy), sam.page.mouse.move(cx, cy)]);
    await Promise.all([alex.page.mouse.down(), sam.page.mouse.down()]);
    for (let step = 1; step <= 6; step += 1) {
      await alex.page.mouse.move(cx + step * 20, cy - step * 12);
      await sam.page.mouse.move(cx - step * 18, cy + step * 20);
    }
    const alexEnded = { x: start.x + 120, y: start.y - 72 };
    const samEnded = { x: start.x - 108, y: start.y + 120 };
    await Promise.all([alex.page.mouse.up(), sam.page.mouse.up()]);

    // One place, in both browsers: they never disagree, whoever won.
    await expectEventually(alex, 'the note to come to rest', async () => {
      const here = await noteWorld(alex.page, id);
      return Math.abs(here.x - start.x) > 20 || Math.abs(here.y - start.y) > 20;
    });
    const alexPlace = await noteWorld(alex.page, id);
    const samPlace = await noteWorld(sam.page, id);
    expect(Math.abs(alexPlace.x - samPlace.x)).toBeLessThan(3);
    expect(Math.abs(alexPlace.y - samPlace.y)).toBeLessThan(3);
    // And the place is one of the two drags, not something in between that belongs to nobody.
    const nearAlex = Math.abs(alexPlace.x - alexEnded.x) < 6 && Math.abs(alexPlace.y - alexEnded.y) < 6;
    const nearSam = Math.abs(alexPlace.x - samEnded.x) < 6 && Math.abs(alexPlace.y - samEnded.y) < 6;
    expect(nearAlex || nearSam, `note ended at ${JSON.stringify(alexPlace)}`).toBe(true);

    await expectSameBoard([alex, sam], 'the note in one place on both boards');
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'tc-24');
    await closeParticipants([alex, sam]);
  });

  test('TC-25 deleting a note out from under somebody who is typing in it', async ({
    browser,
  }, testInfo) => {
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);

    const id = await toolbarCreate(alex.page);
    await typeIntoEditor(alex, 'do not delete me');
    await stopEditing(alex.page);
    await expectEventually(sam, 'the note to arrive', () => noteText(sam.page, id).then((t) => t === 'do not delete me'));

    // Sam is editing it when Alex deletes it.
    await clickNote(sam.page, id);
    await sam.page.keyboard.press('Enter');
    await expect(editorLocator(sam.page)).toBeVisible();
    const samWasTyping = await editorValue(sam.page);

    await alex.page.getByTestId('delete-note').click();

    await expectChangeToArrive([sam], 'the note being deleted', () =>
      noteCount(sam.page).then((count) => count === 0),
    );
    // The editor Sam was typing into goes with it: no box left behind, nothing to type into.
    await expectEventually(sam, 'the editor to close', async () => (await editorLocator(sam.page).count()) === 0);
    await expectEventually(sam, 'nothing selected', async () => {
      const selected = await sam.page.locator('[data-selected="true"]').count();
      return selected === 0;
    });
    expect(await noteCount(sam.page)).toBe(0);
    expect(samWasTyping.length).toBeGreaterThan(0);

    await expectSameBoard([alex, sam], 'an empty board on both sides');
    // Deleting the note under somebody's caret must not throw anything in their browser.
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'tc-25');
    await closeParticipants([alex, sam]);
  });

  test('TC-28 where one person’s cursor is stays where it is', async ({ browser }, testInfo) => {
    const boardId = newBoard();
    const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);

    const first = await toolbarCreate(alex.page);
    await typeIntoEditor(alex, 'a private thought');
    await stopEditing(alex.page);
    await expectEventually(sam, 'the note and its text', () =>
      noteText(sam.page, first).then((text) => text === 'a private thought'),
    );

    // Alex selects the note and opens it. Sam's board shows the note, unselected, with no
    // text box: selection and the editor are not part of the board.
    expect(
      await note(alex.page, first).getAttribute('data-selected'),
      'the note is selected in the browser that selected it',
    ).toBe('true');
    await alex.page.keyboard.press('Enter');
    await expect(editorLocator(alex.page)).toBeVisible();

    await expectEventually(sam, 'the note to be unselected for Sam', async () => {
      const selected = await note(sam.page, first).getAttribute('data-selected');
      return selected === null;
    });
    // The text box Alex is typing into is on Alex's screen only.
    expect(
      await note(alex.page, first).locator('.sticky-editor').count(),
      'the editor is on the note in the browser that opened it',
    ).toBe(1);
    expect(
      await note(sam.page, first).locator('.sticky-editor').count(),
      'no editor for Sam, on that note or any other',
    ).toBe(0);
    expect(await editorLocator(sam.page).count()).toBe(0);

    // And the other way round: Sam selecting and typing does not put a selection or a text
    // box on Alex's screen.
    const second = await toolbarCreate(sam.page);
    await typeIntoEditor(sam, 'sam’s note');
    await stopEditing(sam.page);
    await expectEventually(alex, 'Sam’s note', () => noteText(alex.page, second).then((t) => t === 'sam’s note'));
    expect(await note(alex.page, second).getAttribute('data-selected'), 'Alex has it unselected').toBe(null);
    await expectEventually(alex, 'no editor on Sam’s note', async () => {
      const editors = await note(alex.page, second).locator('.sticky-editor').count();
      return editors === 0;
    });

    // Alex is still editing the first note, undisturbed, while Sam works on the second.
    await expect(editorLocator(alex.page)).toBeVisible();
    expect(await editorValue(alex.page)).toBe('a private thought');
    // Alex closes the editor; from here both browsers are looking at the same board.
    await stopEditing(alex.page);

    await expectSameBoard([alex, sam], 'two notes, no selection shared');
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'tc-28');
    await closeParticipants([alex, sam]);
  });

  test('a board is reached by its address, and everybody on it shares it', async ({
    browser,
  }, testInfo) => {
    // The address is the board: a browser opened later, on the same link, joins the same
    // board and the notes that are already there.
    const boardId = newBoard();
    const [alex] = await openParticipants(browser, ['Alex'], boardId);
    const id = await toolbarCreate(alex.page);
    await typeIntoEditor(alex, 'left here by Alex');
    await stopEditing(alex.page);

    const sam = await openParticipant(browser, 'Sam', boardId);
    await expectEventually(
      sam,
      'the note that was already on the board',
      () => noteText(sam.page, id).then((text) => text === 'left here by Alex'),
    );
    expect(sam.page.url(), 'the board is in the address bar').toContain(`/b/${boardId}`);

    // Now both are on it, so anything either of them does shows up for the other.
    await toolbarCreate(sam.page);
    await expectChangeToArrive([alex], 'the note Sam made after joining', () =>
      noteCount(alex.page).then((count) => count === 2),
    );
    await expectSameBoard([alex, sam], 'two notes in two browsers');
    expectNoConsoleErrors([alex, sam]);
    await writeLatencyReport(testInfo, 'join-by-address');
    await closeParticipants([sam]);
    await closeParticipants([alex]);
  });
});
