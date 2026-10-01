// Story 3, e2e: two or more people on one board, in real browsers, through the
// real server path (`wrangler dev` serving the build and the Worker's room).
//
// Every person is a browser context of their own: separate sockets, separate
// documents, nothing shared but the board's address. That address is generated
// the way the app generates one, so a test joins a board exactly as a person
// arriving at a shared link does.
//
// Nothing here asserts wall-clock time. A change is waited for up to
// E2E_EVENTUAL_TIMEOUT_MS and how long it took is printed against
// LIVE_UPDATE_LATENCY_BUDGET_MS (design: Timing policy) — the model, the
// browsers and the room all share this one machine, so a slow moment is
// information and not a failure. The latency report is printed at the end of
// each test.
import { expect, test } from '@playwright/test';
import { CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { setCamera, settle } from './helpers/board';
import {
  clickNote,
  createNoteAt,
  deleteButton,
  dragNote,
  editor,
  noteIds,
  noteText,
  noteWorldPos,
  rgb,
  swatch,
} from './helpers/stickies';
import {
  badgeOf,
  badgesSeen,
  expectBoardAgreedAgain,
  expectChangeSeen,
  expectEventually,
  expectNoProblems,
  expectSameBoard,
  joinBoard,
  leaveAll,
  loseTheBoard,
  newBoard,
  noteCountOf,
  noteKeyOf,
  reportLatency,
  statesSeen,
  watchConnection,
  watchNotes,
  type Person,
} from './helpers/participants';

const SCREEN = { width: 1280, height: 800 };
const CENTRE = { x: SCREEN.width / 2, y: SCREEN.height / 2 };

/** The camera that puts the world origin in the middle of the screen at `zoom`. */
const centredAt = (zoom: number) => ({ x: -CENTRE.x / zoom, y: -CENTRE.y / zoom, zoom });

/** Every character of everything that was typed, however it interleaved. */
function characters(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  return counts;
}

/** Every character of every chunk that was typed is in `text`, however they interleaved. */
function containsAll(text: string, ...typed: string[]): string {
  const have = characters(text);
  const missing: string[] = [];
  for (const chunk of typed) {
    for (const [char, count] of characters(chunk)) {
      if ((have.get(char) ?? 0) < count) missing.push(`${char}×${count}`);
    }
  }
  return missing.join(' ');
}

/** The text of one note on every screen, or the first screen that differs. */
const sameText = async (people: Person[], id: string): Promise<string> => {
  const [first, ...rest] = people;
  const mine = await noteText(first!.page, id);
  for (const other of rest) {
    const theirs = await noteText(other.page, id);
    if (theirs !== mine) return `${other.name}: ${theirs} against ${mine}`;
  }
  return '';
};

/** Where one note is on every screen, or the first screen that differs. */
const samePosition = async (people: Person[], id: string): Promise<string> => {
  const [first, ...rest] = people;
  const mine = await noteWorldPos(first!.page, id);
  for (const other of rest) {
    const theirs = await noteWorldPos(other.page, id);
    if (Math.abs(theirs.x - mine.x) > 1 || Math.abs(theirs.y - mine.y) > 1) {
      return `${other.name}: ${theirs.x},${theirs.y} against ${mine.x},${mine.y}`;
    }
  }
  return '';
};

/** The outline that says which note a person has chosen, as this page draws it. */
function selectedOn(page: Person['page'], id: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const el = document.querySelector(`[data-note-id="${id}"]`);
    return el !== null && el.getAttribute('data-selected') === 'true';
  }, id);
}

/** The colour one page paints a note with, as the browser paints it. */
function noteColourOf(page: Person['page'], id: string): Promise<string> {
  return page.evaluate((id: string) => {
    const el = document.querySelector(`[data-note-id="${id}"]`);
    return el === null ? 'gone' : getComputedStyle(el).backgroundColor;
  }, id);
}

test.afterEach(() => {
  reportLatency('changes measured in this test');
});

test.describe('two people on one board', () => {
  test('TC-22 one person’s changes appear on the other person’s screen', async ({ browser }) => {
    const board = newBoard();
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);
    await watchNotes(alex.page);
    await watchNotes(sam.page);

    // Alex starts a board. Sam was already there, and sees it as it is drawn.
    let sent = Date.now();
    const id = await createNoteAt(alex.page, CENTRE, 'kickoff');
    await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'a note Alex makes');

    // Alex moves it.
    sent = Date.now();
    await dragNote(alex.page, id, 140, 90);
    await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'a note Alex moves');

    // Alex makes it pink.
    await clickNote(alex.page, id);
    sent = Date.now();
    await swatch(alex.page, 'pink').click();
    await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'a note Alex recolours');
    await expectEventually(
      'the colour Sam sees is the colour Alex chose',
      () => noteColourOf(sam.page, id),
      rgb('pink'),
    );

    // Alex writes in it, in front of what is already there.
    await clickNote(alex.page, id);
    await alex.page.keyboard.press('Enter');
    await expect(editor(alex.page)).toBeVisible();
    sent = Date.now();
    await alex.page.keyboard.type('agenda: ');
    await alex.page.keyboard.press('Escape');
    await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'text Alex types');

    // And Alex throws it away.
    await clickNote(alex.page, id);
    sent = Date.now();
    await deleteButton(alex.page).click();
    await expectEventually('the note vanishes for Sam too', () => noteCountOf(sam.page), 0);

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });

  test('TC-23 both type into one note at the same time and keep everything', async ({ browser }) => {
    const board = newBoard();
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);
    await watchNotes(alex.page);
    await watchNotes(sam.page);

    const id = await createNoteAt(alex.page, CENTRE, 'paint ');
    await expectEventually('the note is on both screens', () => noteCountOf(sam.page), 1);

    // Both open the same note and both type, at the same moment.
    await clickNote(alex.page, id);
    await alex.page.keyboard.press('Enter');
    await clickNote(sam.page, id);
    await sam.page.keyboard.press('Enter');
    await expect(editor(alex.page)).toBeVisible();
    await expect(editor(sam.page)).toBeVisible();

    await Promise.all([alex.page.keyboard.type('AAAA'), sam.page.keyboard.type('bbbb')]);
    await Promise.all([alex.page.keyboard.press('Escape'), sam.page.keyboard.press('Escape')]);

    // One text, on both screens.
    await expectEventually('both screens hold one text', () => sameText([alex, sam], id), '');
    const text = await noteText(alex.page, id);
    // Every character either person typed is in it: the note's own word, then
    // four characters from each side, in whichever order the merge put them.
    expect(containsAll(text, 'paint ', 'AAAA', 'bbbb')).toBe('');
    expect(text).toHaveLength('paint '.length + 4 + 4);

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });

  test('TC-24 both drag the same note at once and end up in the same place', async ({ browser }) => {
    const board = newBoard();
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);
    await watchNotes(alex.page);
    await watchNotes(sam.page);

    const id = await createNoteAt(alex.page, CENTRE, 'shared');
    await expectEventually('the note is on both screens', () => noteCountOf(sam.page), 1);
    const where = await noteWorldPos(alex.page, id);

    const sent = Date.now();
    await Promise.all([dragNote(alex.page, id, 180, 60), dragNote(sam.page, id, -120, -150)]);

    // The note ends in one place, which is the place both screens agree on: the
    // two drags are one property written twice, and the merge gives one answer.
    await expectEventually('both screens agree where the note ended up', () => samePosition([alex, sam], id), '');
    const ended = await noteWorldPos(alex.page, id);
    expect(Math.abs(ended.x - where.x) + Math.abs(ended.y - where.y)).toBeGreaterThan(1); // it really moved
    // And that answer is on the other screen too, which is the change arriving.
    await expectChangeSeen(sam, id, await noteKeyOf(alex.page, id), sent, 'the note’s last position');

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });

  test('TC-25 a note deleted while the other person is typing in it goes away for both', async ({ browser }) => {
    const board = newBoard();
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);
    await watchNotes(alex.page);
    await watchNotes(sam.page);

    const id = await createNoteAt(alex.page, CENTRE, 'doomed');
    await expectEventually('the note is on both screens', () => noteCountOf(sam.page), 1);

    // Sam is in the note, typing.
    await clickNote(sam.page, id);
    await sam.page.keyboard.press('Enter');
    await sam.page.keyboard.type('while I was writing');
    await expect(editor(sam.page)).toBeVisible();

    // Alex throws the note away while Sam is inside it.
    await clickNote(alex.page, id);
    await deleteButton(alex.page).click();

    // Sam's note disappears, and the editor goes with it: what is left is an
    // empty board, not a half-finished editor over nothing.
    await expectEventually('the note disappears for Sam', () => noteCountOf(sam.page), 0);
    await expectEventually('Sam’s editor is gone with it', async () => {
      const open = await sam.page.locator('textarea').count();
      return open === 0 ? 'closed' : 'open';
    }, 'closed');
    expect(await noteIds(alex.page)).toEqual([]);

    // And it stays gone: the typing Sam did into the note does not bring it
    // back, not immediately and not a moment later.
    await sam.page.waitForTimeout(1_500);
    expect(await noteCountOf(sam.page)).toBe(0);
    expect(await noteCountOf(alex.page)).toBe(0);
    expect(await noteIds(sam.page)).toEqual([]);

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });

  test('TC-28 choosing and editing a note is nobody else’s business', async ({ browser }) => {
    const board = newBoard();
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);

    const id = await createNoteAt(alex.page, CENTRE, 'mine to hold');
    await expectEventually('the note is on both screens', () => noteCountOf(sam.page), 1);

    // Alex selects the note and goes into it.
    await clickNote(alex.page, id);
    await expectEventually('the note is selected on Alex’s screen', () => selectedOn(alex.page, id), true);
    await alex.page.keyboard.press('Enter');
    await expect(editor(alex.page)).toBeVisible();

    // None of that is Sam's: not the outline, not the editor. Selection and
    // editing are this person's own state, and nothing about them goes over the
    // wire — which is what a second screen shows.
    await sam.page.waitForTimeout(1_000);
    expect(await selectedOn(sam.page, id)).toBe(false);
    expect(await sam.page.locator('textarea').count()).toBe(0);
    expect(await noteText(sam.page, id)).toBe('mine to hold');

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });
});

test.describe('a board full of people', () => {
  test('TC-26 everyone sees every change made by everyone else', async ({ browser }) => {
    test.setTimeout(300_000);
    const board = newBoard();
    // The capacity the product is designed for, and the number of people this
    // test puts on one board. Nothing here is the +1 case: the room has no limit,
    // and that is the room's own test (TC-13).
    const names = ['Ana', 'Bo', 'Cy', 'Di', 'Eli'].slice(0, MAX_CONCURRENT_EDITORS);
    const people: Person[] = [];
    for (const name of names) {
      const person = await joinBoard(browser, name, board);
      // Half the zoom, so five people each have a row of their own to work in.
      await setCamera(person.page, centredAt(0.5));
      await settle(person.page);
      await watchNotes(person.page);
      people.push(person);
    }

    // Each person makes five notes of their own, in a place of their own.
    const mine = new Map<string, string[]>();
    for (const [index, person] of people.entries()) {
      mine.set(person.name, []);
      for (let round = 0; round < 5; round++) {
        const at = { x: 240 + round * 220, y: 160 + index * 120 };
        const sent = Date.now();
        const id = await createNoteAt(person.page, at, `${person.name}${round}`);
        (mine.get(person.name) as string[]).push(id);
        const state = await noteKeyOf(person.page, id);
        // Every other screen sees this note appear.
        for (const other of people.filter((candidate) => candidate !== person)) {
          await expectChangeSeen(other, id, state, sent, `${person.name} creates a note → ${other.name}`);
        }
      }
    }

    // Each person moves the five notes they made.
    for (const person of people) {
      for (const id of mine.get(person.name) as string[]) {
        const sent = Date.now();
        await dragNote(person.page, id, 30, 24);
        const state = await noteKeyOf(person.page, id);
        for (const other of people.filter((candidate) => candidate !== person)) {
          await expectChangeSeen(other, id, state, sent, `${person.name} moves a note → ${other.name}`);
        }
      }
    }

    // Every screen draws the same board: same notes, same places, same colours,
    // same words, in the same order.
    await expectSameBoard(people, 'the whole board on every screen');
    expect(await noteCountOf(people[0]!.page)).toBe(MAX_CONCURRENT_EDITORS * 5);

    await expectNoProblems(people);
    await leaveAll(people);
  });
});

test.describe('a board one person loses', () => {
  test('TC-27 a board missed while the link is down arrives when it comes back', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 150_000);
    const board = newBoard();
    const alex = await joinBoard(browser, 'Alex', board);
    const sam = await joinBoard(browser, 'Sam', board);
    await watchNotes(alex.page);
    await watchNotes(sam.page);
    // The badge is up for two seconds and the outage is over in a moment of it,
    // so what happened is heard as it happens rather than asked about afterwards.
    await watchConnection(alex.page);

    // Alex loses the board — the outage the product is specified against, not a
    // momentary one. Alex's board stays on screen and stays workable.
    await loseTheBoard(alex, CATCH_UP_TEST_OUTAGE_MS);
    await expectEventually('Alex is told the board is out of reach', () => badgeOf(alex.page), 'Reconnecting…');

    const ids: string[] = [];
    for (let round = 0; round < 3; round++) {
      // Alex keeps working on the board they can still see.
      const id = await createNoteAt(alex.page, { x: 300 + round * 240, y: 300 }, `offline ${round}`);
      ids.push(id);
      // Sam keeps working on the board as the room has it, and cannot see any of
      // what Alex is doing: nothing travels while the link is down.
      await createNoteAt(sam.page, { x: 300 + round * 240, y: 500 }, `online ${round}`);
    }
    expect(await noteCountOf(alex.page)).toBe(3);
    expect(await noteCountOf(sam.page)).toBe(3);
    expect(await badgesSeen(alex.page)).toContain('Reconnecting…');

    // The link comes back on its own, and both people are told, once: everything
    // either of them made while they could not see each other is on both screens.
    await expectBoardAgreedAgain(alex, 'Alex’s board');
    const seen = await badgesSeen(alex.page);
    expect(seen).toContain('Reconnecting…');
    expect(seen[seen.indexOf('Reconnecting…') + 1]).toBe('Connected');
    await expectSameBoard([alex, sam], 'the board both people were working on');
    expect(await noteCountOf(alex.page)).toBe(6);
    expect(await noteCountOf(sam.page)).toBe(6);
    for (const id of ids) {
      expect(await noteText(sam.page, id)).toBe(await noteText(alex.page, id));
    }
    // The states the connection passed through, in order: agreed, out of reach,
    // agreed again. Nothing else, and no flapping about in the middle.
    const states = await statesSeen(alex.page);
    expect(states).toEqual(['connected', 'reconnecting', 'confirmed']);

    await expectNoProblems([alex, sam]);
    await leaveAll([alex, sam]);
  });
});
