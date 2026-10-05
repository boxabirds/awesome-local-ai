/**
 * A board with as many people on it as it is designed for.
 *
 * `MAX_CONCURRENT_EDITORS` browsers, all on one board, all working at once. What is checked
 * is that nothing gets dropped or mangled at capacity: everything anybody does turns up on
 * everybody else's screen, and in the end all five browsers hold one board.
 *
 * The timings are collected and written out for the report at the end of the run. They are
 * not asserted: five browsers, the server and the model all share one machine here, and a
 * number from that is not a pass/fail signal. What is asserted is that every change arrives.
 */

import { expect, test } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS, STICKY_COLORS } from '../../src/shared/config';
import {
  clickNote,
  doubleClickCreate,
  dragNote,
  noteColor,
  noteIds,
  noteText,
  noteWorld,
  expectNoteCount,
} from './helpers/board';
import {
  closeParticipants,
  expectChangeToArrive,
  expectEventually,
  expectNoConsoleErrors,
  expectSameBoard,
  latencyReport,
  latencySamples,
  newBoard,
  openParticipants,
  resetLatencySamples,
  stopEditing,
  writeLatencyReport,
  type Participant,
} from './helpers/participants';

/**
 * The names the test speaks of the people by: one per editor the board is designed for.
 * If MAX_CONCURRENT_EDITORS changes, the first test's own assertion says so.
 */
const NAMES = ['Alex', 'Sam', 'Robin', 'Jo', 'Casey'] as const;

/** Colours the people recolour to, one each, none of them the default. */
const COLOURS: readonly (keyof typeof STICKY_COLORS)[] = ['orange', 'green', 'blue', 'pink', 'violet'].slice(
  0,
  MAX_CONCURRENT_EDITORS,
) as readonly (keyof typeof STICKY_COLORS)[];

/** Where each person puts their own note, so no two notes land on top of each other. */
const SPOTS = NAMES.map((_, index) => ({ x: 200 + index * 220, y: 260 }));

/** Everybody except one. */
function everyoneElse(people: readonly Participant[], person: Participant): Participant[] {
  return people.filter((other) => other !== person);
}

test('TC-26 a full board of people all see the same board', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  resetLatencySamples();
  const boardId = newBoard();
  const people = await openParticipants(browser, NAMES, boardId);
  expect(people.length).toBe(MAX_CONCURRENT_EDITORS);

  // Everyone starts on an empty board together.
  for (const person of people) await expect(expectNoteCount(person.page, 0)).resolves.toEqual([]);

  // Each person makes a note, types into it, and the others see it — while that person is
  // still working, and without anybody reloading.
  const made: string[] = [];
  for (const [index, person] of people.entries()) {
    const spot = SPOTS[index] as { x: number; y: number };
    const id = await doubleClickCreate(person.page, spot.x, spot.y);
    made.push(id);
    const words = `hello from ${person.name}`;
    await person.page.keyboard.type(words);
    await stopEditing(person.page);
    await expectChangeToArrive(
      everyoneElse(people, person),
      `${person.name}’s note, with the words in it`,
      (other) => noteText(other.page, id).then((text) => text === words),
    );
  }

  // Every note is on every board exactly once.
  for (const person of people) {
    const ids = await expectNoteCount(person.page, MAX_CONCURRENT_EDITORS);
    expect([...ids].sort()).toEqual([...made].sort());
    for (const other of people) {
      if (other === person) continue;
      const readable = await person.page.locator('.sticky-text').allInnerTexts();
      expect(readable, `${person.name} can read ${other.name}’s note`).toContain(`hello from ${other.name}`);
    }
  }

  // Each person recolours their own note; everyone else sees the colour change.
  for (const [index, person] of people.entries()) {
    const id = made[index] as string;
    const colour = COLOURS[index] as string;
    await clickNote(person.page, id);
    await person.page.getByTestId(`color-${colour}`).click();
    await expectChangeToArrive(everyoneElse(people, person), `${person.name}’s new colour`, (other) =>
      noteColor(other.page, id).then((seen) => seen === colour),
    );
  }

  // Each person drags their own note somewhere else; everyone else sees it arrive.
  for (const [index, person] of people.entries()) {
    const id = made[index] as string;
    await dragNote(person.page, id, 50 + index * 25, -35 - index * 20);
    const place = await noteWorld(person.page, id);
    await expectChangeToArrive(everyoneElse(people, person), `${person.name}’s note in its new place`, async (other) => {
      const seen = await noteWorld(other.page, id);
      return Math.abs(seen.x - place.x) < 3 && Math.abs(seen.y - place.y) < 3;
    });
  }

  // The last word: five browsers, one board, byte for byte.
  const snapshot = await expectSameBoard(people, 'one board in five browsers', 30_000);
  expect(snapshot.split('|').length).toBe(MAX_CONCURRENT_EDITORS);
  for (const person of people) {
    const ids = await noteIds(person.page);
    expect(new Set(ids).size, `${person.name} has no duplicated notes`).toBe(MAX_CONCURRENT_EDITORS);
  }

  expectNoConsoleErrors(people);
  // The number the story asks about, on the test's own output. (Before the report file is
  // written: writing it clears what this worker measured.)
  const measured = latencySamples();
  console.info(`${latencyReport(measured)} across ${measured.length} changes at full capacity`);
  await writeLatencyReport(testInfo, 'tc-26-capacity');
  await closeParticipants(people);
});

test('a sixth person joins a full board and edits it like anybody else', async ({ browser }, testInfo) => {
  // The capacity in the name is a design number, not a turnstile: one more person joins and
  // nothing about their board is different.
  test.setTimeout(180_000);
  resetLatencySamples();
  const boardId = newBoard();
  const people = await openParticipants(browser, NAMES, boardId);
  const [late] = await openParticipants(browser, ['FifthAndSixth'], boardId);

  const [alex] = people;
  const first = await doubleClickCreate(alex.page, 300, 300);
  await alex.page.keyboard.type('made before you got here');
  await stopEditing(alex.page);

  await expectEventually(
    late,
    'the note that was already on the board',
    () => noteText(late.page, first).then((text) => text === 'made before you got here'),
  );

  // And what the late arrival does goes back to everybody already on it.
  const theirs = await doubleClickCreate(late.page, 520, 340);
  await late.page.keyboard.type('made by the last one in');
  await stopEditing(late.page);
  await expectChangeToArrive(people, 'the late arrival’s note', (other) =>
    noteText(other.page, theirs).then((text) => text === 'made by the last one in'),
  );

  await expectSameBoard([...people, late], 'six people, one board', 30_000);
  expectNoConsoleErrors([...people, late]);
  await writeLatencyReport(testInfo, 'sixth-person');
  await closeParticipants([late, ...people]);
});
