/**
 * TC-22, TC-23, TC-24 (story 8, `undo.controls` / `undo.only_own`) — undo across
 * a real room.
 *
 * Two or five browser *contexts* (never two tabs: the provider's BroadcastChannel
 * is off, and a test that could pass with a broken server is not worth having)
 * on one board served by `wrangler dev`. This is the only place the story's
 * central claim can be proved: that a change which arrived over the wire is not
 * in this person's history, because the transaction that carried it did not come
 * from this tab. Everything above the socket is the app's own — the real
 * provider, the real `UndoManager`, the real keystrokes — and the assertions are
 * made by reading what each *screen* shows, so a change that stayed local, or an
 * undo that reached the other person's notes, fails the test.
 *
 * Where notes have to exist before the story begins they are seeded through
 * `__vidi6Board.seed`, which writes with no transaction origin: seeding is what
 * another client did, and it must never land in this tab's history.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import type { SeedPlacement } from '../fixtures/boards';
import { createBoard } from './helpers/share';
import {
  type NoteView,
  type Participant,
  changeVisible,
  createNote,
  dragNoteTo,
  everyPageSees,
  everyoneSeesNoteInPlace,
  expectEveryPageSees,
  notesOf,
  openBoard,
  selectNote,
  slot,
  startTyping,
  stopEditing,
  zoomOut,
} from './helpers/live';
import { seedNotes } from './helpers/selection';

/** The two controls, as the toolbar shows them. */
const undoButton = (page: Page): Locator => page.getByTestId('undo-button');
const redoButton = (page: Page): Locator => page.getByTestId('redo-button');

/** Eight notes, far enough apart that one of them can be named by id. */
const EIGHT: SeedPlacement[] = Array.from({ length: 8 }, (_, index) => ({
  x: -460 + (index % 4) * 200,
  y: -160 + Math.floor(index / 4) * 220,
  text: `Seeded note ${index + 1}`,
  color: (index % 2 === 0 ? 'yellow' : 'blue') as SeedPlacement['color'],
}));

/** A board, every note of it: the ids, in render order. */
async function idsOn(page: Page): Promise<string[]> {
  return (await notesOf(page)).map((note) => note.id);
}

/** A board told independently of the order its notes happen to render in. */
const byId = (notes: readonly NoteView[]): string =>
  [...notes]
    .map((note) => `${note.id} ${note.x},${note.y} z${note.z} ${note.color} ${note.text}`)
    .sort()
    .join(' | ');

/** Every screen shows exactly this board, and all of them agree on it. */
async function everyPageShows(
  pages: readonly Page[],
  expected: readonly NoteView[],
): Promise<string> {
  const identical = await everyPageSees(pages, expected.length);
  if (identical !== 'identical') return identical;
  const seen = await notesOf(pages[0] as Page);
  return byId(seen) === byId(expected) ? 'as expected' : `expected ${byId(expected)} ; saw ${byId(seen)}`;
}

async function expectEveryPageShows(
  pages: readonly Page[],
  expected: readonly NoteView[],
  label: string,
): Promise<void> {
  await expect
    .poll(() => everyPageShows(pages, expected), {
      message: label,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('as expected');
}

test('TC-22 undo brings my eight notes back and leaves my colleague’s note alone', async ({
  browser,
  request,
}) => {
  test.setTimeout(180_000);
  const boardId = await createBoard(request);
  const mia = await openBoard(browser, boardId, 'Mia');
  const raj = await openBoard(browser, boardId, 'Raj');
  const pages = [mia.page, raj.page];

  const seeded = await seedNotes(mia.page, EIGHT);
  await expectEveryPageSees(pages, 8, 'the eight notes are on both screens');
  // The eight as they stood, down to their text and colour: this is the board
  // Mia's undo has to put back, and nothing else.
  const eight = await notesOf(mia.page);
  // Nothing of this is Mia's to undo: the eight came from the seeder, and the
  // board she is looking at already had them.
  await expect(undoButton(mia.page)).toBeDisabled();
  await expect(redoButton(mia.page)).toBeDisabled();

  // One accidental Delete, eight notes gone — one step, because it was one action.
  await changeVisible(
    'Mia deletes the eight',
    async () => {
      await mia.page.keyboard.press('Control+a');
      await expect(mia.page.getByTestId('selection-count')).toContainText('8');
      await mia.page.keyboard.press('Delete');
    },
    async () => (await everyPageSees(pages, 0)) === 'identical',
  );
  await expect(undoButton(mia.page)).toBeEnabled();

  // Raj works in the meantime. His note is not in Mia's history at all.
  const his = await createNote(raj.page, slot(0, 0));
  await expectEveryPageSees(pages, 1, 'Raj’s note reaches Mia');
  const hisNote = (await notesOf(raj.page)).find((note) => note.id === his);
  if (!hisNote) throw new Error('Raj’s note is not on his own screen');

  await changeVisible(
    'Mia undoes her delete',
    () => mia.page.keyboard.press('Control+z'),
    async () => (await everyPageSees(pages, 9)) === 'identical',
  );
  // Back on both screens, and back exactly: same ids, same places, same colours,
  // same text — and Raj's note next to them, unchanged, which is the whole
  // point of a history that only holds this person's own steps.
  await expectEveryPageShows(
    pages,
    [...eight, hisNote],
    'the eight are back exactly as they were, next to Raj’s untouched note',
  );
  expect((await idsOn(mia.page)).sort()).toEqual([...seeded, his].sort());
  await expect(undoButton(mia.page)).toBeDisabled();
  await expect(redoButton(mia.page)).toBeEnabled();

  // And Redo removes the eight again — still only Mia's own step, still Raj's note.
  await changeVisible(
    'Mia redoes her delete',
    () => mia.page.keyboard.press('Control+Shift+z'),
    async () => (await everyPageSees(pages, 1)) === 'identical',
  );
  await expectEveryPageShows(pages, [hisNote], 'one note left on both screens: Raj’s');

  expect([...mia.problems, ...raj.problems]).toEqual([]);
  await Promise.all([mia.context.close(), raj.context.close()]);
});

test('TC-23 undoing the move of a note somebody else deleted is not an error', async ({
  browser,
  request,
}) => {
  const boardId = await createBoard(request);
  const mia = await openBoard(browser, boardId, 'Mia');
  const raj = await openBoard(browser, boardId, 'Raj');
  const pages = [mia.page, raj.page];

  const id = await createNote(mia.page, slot(0, 0));
  await expectEveryPageSees(pages, 1, 'Mia’s note reaches Raj');

  await changeVisible(
    'Mia moves it',
    () => dragNoteTo(mia.page, id, slot(2, 2)),
    everyoneSeesNoteInPlace(mia.page, pages, id),
  );
  await changeVisible(
    'Raj deletes it',
    async () => {
      await selectNote(raj.page, id);
      await raj.page.keyboard.press('Delete');
    },
    async () => (await everyPageSees(pages, 0)) === 'identical',
  );

  // Mia does not know it is gone, and takes her move back. Nothing about the
  // object her step refers to is there any more, so her board has nothing to
  // put right — and says nothing about it.
  await mia.page.keyboard.press('Control+z');
  await expect
    .poll(async () => (await everyPageSees(pages, 0)) === 'identical', {
      message: 'the note stays gone on both screens',
    })
    .toBe(true);
  expect([...mia.problems, ...raj.problems]).toEqual([]);
  await expect(mia.page.getByTestId('board-app')).toBeVisible();

  // She keeps working: a board whose history stumbled is not a broken board.
  const next = await createNote(mia.page, slot(1, 1));
  await expectEveryPageSees(pages, 1, 'Mia makes another note, and Raj sees it');
  expect(await idsOn(raj.page)).toEqual([next]);

  expect([...mia.problems, ...raj.problems]).toEqual([]);
  await Promise.all([mia.context.close(), raj.context.close()]);
});

test(`TC-24 ${MAX_CONCURRENT_EDITORS} people undoing at once undo only their own steps`, async ({
  browser,
  request,
}) => {
  // Five contexts, each creating, typing and moving, then undoing three steps.
  test.setTimeout(300_000);
  const boardId = await createBoard(request);
  const people: Participant[] = [];
  for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
    people.push(await openBoard(browser, boardId, `person ${index + 1}`));
  }
  const pages = people.map((person) => person.page);
  await Promise.all(pages.map((page) => zoomOut(page, 0.25)));

  // Each person makes one note of their own and writes their name in it, so a
  // note is recognisable as somebody's work after anyone else's undo.
  const own: string[] = [];
  for (const [index, person] of people.entries()) {
    const id = await createNote(person.page, slot(index, 0));
    own.push(id);
    const text = `written by ${person.name}`;
    await startTyping(person.page, id);
    await person.page.keyboard.type(text);
    await stopEditing(person.page);
    await expect
      .poll(async () => (await everyPageSees(pages, own.length)) === 'identical', {
        message: `${person.name}'s note and text reach every screen`,
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(true);
  }
  const ids = [...own];
  const typed = async (page: Page): Promise<number> =>
    (await notesOf(page)).filter((note) => note.text.startsWith('written by ')).length;
  expect(await typed(pages[0] as Page)).toBe(MAX_CONCURRENT_EDITORS);

  // Where each note was before anybody touched it: the board the undos end at.
  const atRest = await notesOf(pages[0] as Page);

  // Everyone moves at the same time, so every note of the board is somebody's
  // own move away from where it belongs.
  await Promise.all(
    people.map(async (person, index) => {
      const id = ids[index] as string;
      await dragNoteTo(person.page, id, slot(index, 2));
    }),
  );
  await expectEveryPageSees(pages, MAX_CONCURRENT_EDITORS, 'every move reaches every screen');
  const moved = await notesOf(pages[0] as Page);
  expect(byId(moved)).not.toBe(byId(atRest));

  // Everyone undoes. Each one takes back their own move and nobody else's.
  await Promise.all(pages.map((page) => page.keyboard.press('Control+z')));
  await expectEveryPageShows(pages, atRest, 'every note back where its own person moved it from');
  // Every one of those notes has a name in it still: five people undid, and not
  // one of them lost somebody else's typing on the way.
  expect(await typed(pages[0] as Page)).toBe(MAX_CONCURRENT_EDITORS);

  // Again: now the typing goes, note by note, and only its own person's.
  await Promise.all(pages.map((page) => page.keyboard.press('Control+z')));
  await expect
    .poll(() => everyPageSees(pages, MAX_CONCURRENT_EDITORS), {
      message: 'the notes are all still there after the second undo',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('identical');
  await expect
    .poll(() => typed(pages[0] as Page), {
      message: 'no note has any text left: each person undid their own typing',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe(0);

  // Once more: each person's own creation. Five notes, five people, all gone.
  await Promise.all(pages.map((page) => page.keyboard.press('Control+z')));
  await expect
    .poll(() => everyPageSees(pages, 0), {
      message: 'every note was undone by the person who made it',
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toBe('identical');

  // A history that reaches into somebody else's work shows up here first: nobody
  // in this test logged a console error or an uncaught exception.
  expect(people.flatMap((person) => person.problems)).toEqual([]);
  await Promise.all(people.map((person) => person.context.close()));
});
