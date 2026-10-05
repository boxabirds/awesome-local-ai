/**
 * Story 8 end-to-end tests: undoing and redoing only my own changes, in a real browser
 * against the real room, with more than one person at the board.
 *
 * The unit and component suites prove the undo controller filters by origin and that one
 * gesture is one step. What they cannot prove is the thing the whole story is about: that
 * in two separate browser profiles, each with their own socket and their own history, one
 * person pressing Ctrl+Z does not reach through the room and undo the other person's work —
 * and that both boards still agree, to the last decimal, once the undo has travelled back
 * out. These are the tests for that.
 *
 * A note about who can undo what: undoing a *deletion you made* legitimately brings the note
 * back (that is story 8's deletion requirement). What must never happen — and what TC-23 and
 * TC-24 pin down — is a *different* person's undo resurrecting or garbling a note that someone
 * else deleted. That undo targets something no longer there, so it is inert.
 */

import { expect, test, type Page } from '@playwright/test';
import { BASE_URL } from '../../playwright.config';
import { createSticky, type StickySnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/client/canvas/camera';
import {
  clickObject,
  dragByMouse,
  getBoard,
  objectCentreOnScreen,
  stickyInput,
  worldOf
} from './helpers/board';
import { closeSessions, openSession, type Session } from './helpers/participants';
import { seedBoard } from './helpers/board-writer';

/** Sessions opened here, so a failing test leaves no browsers behind. */
const sessions: Session[] = [];

test.afterEach(async () => {
  await closeSessions(sessions);
});

/** Put notes on a session's shared board, centred on the given screen points, seen by all. */
async function seedNotes(session: Session, centres: Point[]): Promise<string[]> {
  const worlds: Point[] = [];
  for (const centre of centres) worlds.push(await worldOf(session.people[0].page, centre));
  await seedBoard(
    BASE_URL,
    session.boardId,
    (doc) => {
      for (const world of worlds) createSticky(doc, world);
    },
    centres.length
  );
  await session.everyoneSees('everybody holds the whole board', centres.length);
  return (await getBoard(session.people[0].page)).map((note) => note.id);
}

async function shapeOf(page: Page, id: string): Promise<StickySnapshot> {
  const found = (await getBoard(page)).find((note) => note.id === id);
  if (!found) throw new Error(`object ${id} is not on the board`);
  return found;
}

/** How many notes a page holds right now. */
async function noteCount(page: Page): Promise<number> {
  return (await getBoard(page)).length;
}

function closeTo(actual: number, expected: number, tolerance = 0.6): string | true {
  return Math.abs(actual - expected) <= tolerance || `${actual} is not within ${tolerance} of ${expected}`;
}

/** Drag an object from its middle by a screen delta, then let the room settle. */
async function dragObjectBy(page: Page, id: string, deltaX: number, deltaY: number): Promise<void> {
  const centre = await objectCentreOnScreen(page, id);
  await dragByMouse(page, centre, { x: centre.x + deltaX, y: centre.y + deltaY });
}

/** Undo / redo the way the keyboard does, with the board (not an editor) answering. */
async function pressUndo(page: Page): Promise<void> {
  await page.keyboard.press('Control+z');
}
async function pressRedo(page: Page): Promise<void> {
  await page.keyboard.press('Control+Shift+Z');
}

/** Select a note and delete it with the keyboard. */
async function deleteNote(page: Page, id: string): Promise<void> {
  await clickObject(page, id);
  await page.keyboard.press('Delete');
}

test('TC-22: one person undoes only their own move; the other person is left alone, and both stay in sync', async ({
  browser
}) => {
  const session = await openSession(browser, ['ada', 'brin']);
  sessions.push(session);
  const ada = session.person('ada').page;
  const brin = session.person('brin').page;

  const [hers, theirs] = await seedNotes(session, [
    { x: 420, y: 320 },
    { x: 880, y: 460 }
  ]);
  const hersStart = await shapeOf(ada, hers);
  const theirsStart = await shapeOf(ada, theirs);

  // Ada drags her note; Brin drags theirs. Each move converges on both boards.
  await dragObjectBy(ada, hers, 150, 0);
  await session.eventually('Ada sees her note moved', () => shapeOf(ada, hers).then((s) => closeTo(s.x, hersStart.x + 150)));
  await dragObjectBy(brin, theirs, 0, 175);
  await session.eventually('Ada sees Brin move their note', () => shapeOf(ada, theirs).then((s) => closeTo(s.y, theirsStart.y + 175)));
  await session.eventually('Brin agrees on Ada move', () => shapeOf(brin, hers).then((s) => closeTo(s.x, hersStart.x + 150)));

  const theirsMoved = await shapeOf(ada, theirs);

  // Ada undoes. It must reverse only her move — Brin's survives — and both boards must show it.
  await pressUndo(ada);
  await session.eventually('Ada note back where it began', () => shapeOf(ada, hers).then((s) => closeTo(s.x, hersStart.x)));
  await session.eventually('Brin board sees the undo too', () => shapeOf(brin, hers).then((s) => closeTo(s.x, hersStart.x)));
  // Brin's move is untouched, on both boards.
  expect(closeTo((await shapeOf(ada, theirs)).y, theirsMoved.y)).toBe(true);
  expect(closeTo((await shapeOf(brin, theirs)).y, theirsMoved.y)).toBe(true);

  // Redo re-applies only Ada's move.
  await pressRedo(ada);
  await session.eventually('Ada note redone to its moved place', () => shapeOf(ada, hers).then((s) => closeTo(s.x, hersStart.x + 150)));
  await session.eventually('Brin sees the redo', () => shapeOf(brin, hers).then((s) => closeTo(s.x, hersStart.x + 150)));
  expect(closeTo((await shapeOf(ada, theirs)).y, theirsMoved.y)).toBe(true);
});

test('TC-23: undoing a move on a note someone else deleted is inert — it stays deleted, no ghost, no error', async ({
  browser
}) => {
  const session = await openSession(browser, ['ada', 'brin']);
  sessions.push(session);
  const ada = session.person('ada').page;
  const brin = session.person('brin').page;

  const [shared] = await seedNotes(session, [{ x: 520, y: 380 }]);
  const start = await shapeOf(ada, shared);

  // Both people move the one note; it converges.
  await dragObjectBy(ada, shared, 120, 0);
  await dragObjectBy(brin, shared, 0, 130);
  await session.eventually('both moved it', () => shapeOf(ada, shared).then((s) => closeTo(s.x, start.x + 120)));

  // Brin deletes it. It goes away for everybody.
  await deleteNote(brin, shared);
  await session.eventually('gone for everybody', async () => (await noteCount(ada)) === 0 && (await noteCount(brin)) === 0);

  // Ada repeatedly undoes. Her only step on the note is a move whose target no longer exists,
  // so each undo is inert: the note stays deleted, nothing half-comes-back, nothing throws.
  await pressUndo(ada);
  await pressUndo(ada);
  await pressUndo(ada);
  await session.eventually('still deleted on Ada board', () => noteCount(ada).then((n) => n === 0 || `Ada sees ${n} note(s)`));
  await session.eventually('still deleted on Brin board', () => noteCount(brin).then((n) => n === 0 || `Brin sees ${n} note(s)`));

  // And it never silently reappears while they keep poking at history.
  await pressRedo(ada);
  await pressUndo(ada);
  await session.eventually('still nothing on Ada board', () => noteCount(ada).then((n) => n === 0 || `Ada sees ${n} note(s)`));

  // Neither page logged a crash while undoing into a deleted target.
  expect(session.person('ada').errors).toEqual([]);
  expect(session.person('brin').errors).toEqual([]);
});

test('TC-24: undoing my typing into a note someone else deleted neither resurrects it nor throws', async ({
  browser
}) => {
  const session = await openSession(browser, ['ada', 'brin']);
  sessions.push(session);
  const ada = session.person('ada').page;
  const brin = session.person('brin').page;

  const [shared] = await seedNotes(session, [{ x: 560, y: 400 }]);

  // Ada opens the note and types; it syncs to Brin.
  await clickObject(ada, shared);
  await ada.keyboard.press('Enter');
  await expect(stickyInput(ada)).toBeVisible();
  await ada.keyboard.type('hello');
  await ada.keyboard.press('Escape');
  await session.eventually('Brin sees the typed text', async () => {
    const found = (await getBoard(brin)).find((note) => note.id === shared);
    return found?.text === 'hello' || `Brin sees text ${JSON.stringify(found?.text)}`;
  });

  // Brin deletes the note Ada was working on.
  await deleteNote(brin, shared);
  await session.eventually('gone for everybody', async () => (await noteCount(ada)) === 0 && (await noteCount(brin)) === 0);

  // Ada undoes her typing. The note is someone else's deletion now, so the undo must not
  // resurrect it or error — their delete stays.
  await pressUndo(ada);
  await pressUndo(ada);
  await session.eventually('no resurrection on Ada board', () => noteCount(ada).then((n) => n === 0 || `Ada sees ${n} note(s)`));
  await session.eventually('no resurrection on Brin board', () => noteCount(brin).then((n) => n === 0 || `Brin sees ${n} note(s)`));
  expect(session.person('ada').errors).toEqual([]);
});
