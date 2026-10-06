/**
 * Story 8, end to end: undo and redo that belong to one person on a board everybody shares.
 *
 * Every participant is a real browser context with its own document and its own socket to a real
 * `BoardRoom`, so "my change" and "their change" are the real thing rather than a mock: what Mia
 * undoes is only what Mia's screen wrote, and what Raj sees of it is an ordinary change arriving
 * from the room.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { setCamera } from './helpers/board';
import { dragToPoint, noteById, stopEditing, typeIntoEditor } from './helpers/notes';
import {
  closeParticipants,
  expectConverged,
  notesOf,
  openParticipants,
  personAt,
  SHARED_SERVER_HTTP,
  SHARED_SERVER_WS,
  type Participant,
} from './helpers/participants';
import { ensureBoardOnServer, seedBoard } from './helpers/seed-board';

// Nothing here needs longer than a moment per action; a stuck action should say so early.
test.use({ actionTimeout: 10_000 });

/** Camera that puts world (0,0) in the middle of the viewport, so screen = world + (640, 400). */
const CENTRE = { x: 640, y: 400 };
const atOrigin = (page: Page) => setCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
const screenOf = (world: { x: number; y: number }) => ({
  x: world.x + CENTRE.x,
  y: world.y + CENTRE.y,
});

/** A note made by this screen, centred on this world point. */
const createNote = (page: Page, x: number, y: number): Promise<string> =>
  page.evaluate(({ x, y }) => window.__vidi6!.createNote(x, y), { x, y });

const undoOn = (participant: Participant) => participant.page.keyboard.press('Control+z');
const undoButton = (participant: Participant): Locator =>
  participant.page.getByTestId('undo-button');
const redoButton = (participant: Participant): Locator =>
  participant.page.getByTestId('redo-button');

/** Where a note's top-left corner sits in the document when it is centred on `centre`. */
const cornerOf = (centre: { x: number; y: number }) => ({
  x: centre.x - STICKY_SIZE_WORLD / 2,
  y: centre.y - STICKY_SIZE_WORLD / 2,
});

/** Position, colour and text of every note, keyed by id: the whole visible shape of a board. */
async function shapeOf(participant: Participant): Promise<Record<string, [number, number, string, string]>> {
  const shape: Record<string, [number, number, string, string]> = {};
  for (const note of await notesOf(participant)) {
    shape[note.id] = [note.x, note.y, note.color, note.text];
  }
  return shape;
}

/** Waits until this participant's board holds exactly these note ids. */
async function expectIds(participant: Participant, ids: readonly string[]): Promise<void> {
  await expect
    .poll(() => notesOf(participant).then((notes) => notes.map((note) => note.id).sort()), {
      message: `${participant.name}'s board does not hold ${ids.join(', ')}`,
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    })
    .toEqual([...ids].sort());
}

/** A row of note centres with nothing overlapping: notes are STICKY_SIZE_WORLD across. */
const grid = (columns: number, rows: number, gap = 50) => {
  const step = STICKY_SIZE_WORLD + gap;
  const centres: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      centres.push({
        x: (column - (columns - 1) / 2) * step,
        y: (row - (rows - 1) / 2) * step,
      });
    }
  }
  return centres;
};

test.describe('undo and redo are personal', () => {
  test('TC-22 an accidental delete comes back for the person who made it, while the colleague goes on working', async ({
    browser,
  }) => {
    // a board that was lived in before anybody arrived here: 12 notes in all six colours, most of
    // them carrying text. Nobody's own history holds any of it.
    const boardId = newBoardId();
    await ensureBoardOnServer(SHARED_SERVER_HTTP, boardId);
    const fixture = await seedBoard(SHARED_SERVER_WS, boardId, 12);
    const participants = await openParticipants(browser, boardId, 2);
    const mia = personAt(participants, 0);
    const raj = personAt(participants, 1);
    try {
      await expectConverged(participants);
      for (const participant of participants) {
        await expectIds(participant, fixture.map((note) => note.id));
      }

      // Mia selects everything on the board and deletes it - 12 notes she did not make, which is
      // the point: they were on the board, and her delete is her own change to take back
      await mia.page.keyboard.press('Control+a');
      await mia.page.keyboard.press('Delete');
      await expectIds(mia, []);
      await expectConverged(participants);

      // Raj arrives at the empty board and adds a note of his own
      const rajHome = { x: 0, y: 600 };
      const rajNote = await createNote(raj.page, rajHome.x, rajHome.y);
      await expectConverged(participants);

      // Mia takes her delete back. Raj's note is not hers to take back, and stays.
      await undoOn(mia);
      await expectConverged(participants);
      const asTheyWere: Record<string, [number, number, string, string]> = {};
      for (const note of fixture) asTheyWere[note.id] = [note.x, note.y, note.color, note.text];
      for (const participant of participants) {
        await expectIds(participant, [...fixture.map((note) => note.id), rajNote]);
        // text, colour and position, exactly as they were before the delete
        expect(await shapeOf(participant)).toEqual({
          ...asTheyWere,
          [rajNote]: [cornerOf(rajHome).x, cornerOf(rajHome).y, 'yellow', ''],
        });
      }

      // the toolbar's Redo button deletes the 12 again - and only the 12
      await redoButton(mia).click();
      await expectConverged(participants);
      for (const participant of participants) await expectIds(participant, [rajNote]);

      // the Undo button brings them back
      await undoButton(mia).click();
      await expectConverged(participants);
      const restored = [...fixture.map((note) => note.id), rajNote];
      for (const participant of participants) await expectIds(participant, restored);

      // and her history stops there: her own undo is used up, so the button is disabled, while the
      // board keeps every note - Raj's and the ones she only ever deleted
      await expect(undoButton(mia)).toBeDisabled();
      for (const participant of participants) {
        await expectIds(participant, restored);
        expect(await shapeOf(participant)).toEqual({
          ...asTheyWere,
          [rajNote]: [cornerOf(rajHome).x, cornerOf(rajHome).y, 'yellow', ''],
        });
      }

      // on Raj's screen none of this was an error, or anything at all
      for (const participant of participants) expect(participant.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-23 undoing a move of a note the colleague deleted is quiet: no error, and it stays deleted', async ({
    browser,
  }) => {
    const participants = await openParticipants(browser, newBoardId(), 2);
    const mia = personAt(participants, 0);
    const raj = personAt(participants, 1);
    try {
      await atOrigin(mia.page);
      await atOrigin(raj.page);

      const home = { x: 200, y: 200 };
      const mine = await createNote(mia.page, home.x, home.y);
      await expectConverged(participants);

      // Mia drags her note somewhere else
      const drag = { x: 120, y: 60 };
      const moved = screenOf({ x: home.x + drag.x, y: home.y + drag.y });
      await dragToPoint(mia.page, screenOf(home), moved);
      await expect
        .poll(() => notesOf(mia).then((notes) => notes.find((note) => note.id === mine)?.x))
        .toBeCloseTo(cornerOf(home).x + drag.x, 0);
      await expectConverged(participants);

      // Raj, who can see that note, deletes it
      await raj.page.mouse.click(moved.x, moved.y);
      await raj.page.keyboard.press('Delete');
      await expectIds(raj, []);
      await expectConverged(participants);

      // Mia now takes back her move. The note is not there any more: nothing is recreated, nothing
      // throws, and the board keeps working for her.
      await undoOn(mia);
      await expectConverged(participants);
      for (const participant of participants) {
        await expectIds(participant, []);
        await expect(noteById(participant.page, mine)).toHaveCount(0);
      }

      // her history is still hers: a new note, one undo, and it is gone again
      const next = await createNote(mia.page, 500, 300);
      await expectConverged(participants);
      await undoOn(mia);
      await expectConverged(participants);
      for (const participant of participants) await expectIds(participant, []);
      expect(next).toBeTruthy();

      for (const participant of participants) expect(participant.consoleErrors).toEqual([]);
    } finally {
      await closeParticipants(participants);
    }
  });

  test('TC-24 everybody undoing at the same time takes back only their own work, and the board stays one board', async ({
    browser,
  }) => {
    const people = await openParticipants(browser, newBoardId(), MAX_CONCURRENT_EDITORS);
    try {
      for (const participant of people) await atOrigin(participant.page);

      // one note per person, each in a place of their own
      const homes = grid(MAX_CONCURRENT_EDITORS, 1);
      const plan: { participant: Participant; id: string; home: { x: number; y: number } }[] = [];
      for (const [index, participant] of people.entries()) {
        const home = homes[index]!;
        plan.push({ participant, home, id: await createNote(participant.page, home.x, home.y) });
      }
      await expectConverged(people);

      // each person drags their own note to a new place
      const drag = { x: 30, y: 120 };
      for (const { participant, home } of plan) {
        await dragToPoint(participant.page, screenOf(home), screenOf({ x: home.x + drag.x, y: home.y + drag.y }));
      }
      await expectConverged(people);

      // and each person writes in their own note
      for (const { participant, id } of plan) {
        await noteById(participant.page, id).dblclick();
        await typeIntoEditor(participant.page, `note ${id.slice(0, 4)}`);
        await stopEditing(participant.page);
      }
      await expectConverged(people);
      for (const { participant, id } of plan) {
        const notes = await notesOf(participant);
        expect(notes.find((note) => note.id === id)?.text).toBe(`note ${id.slice(0, 4)}`);
      }

      // Now everybody presses Ctrl+Z. Each takes back their own typing, and nobody takes back
      // anybody else's: once things settle, every note is empty of text again.
      await Promise.all(people.map((participant) => undoOn(participant)));
      await expectConverged(people);
      const afterOne = await shapeOf(personAt(people, 0));
      for (const [id, row] of Object.entries(afterOne)) {
        expect(row[3], `note ${id} still holds text somebody's undo should have taken`).toBe('');
      }
      // at the dragged places, which nobody else's undo disturbed
      for (const participant of people) expect(await shapeOf(participant)).toEqual(afterOne);

      // A second Ctrl+Z: each takes back their own move.
      await Promise.all(people.map((participant) => undoOn(participant)));
      await expectConverged(people);
      const settled = await shapeOf(personAt(people, 0));
      expect(Object.keys(settled).sort()).toEqual(plan.map((entry) => entry.id).sort());
      for (const { id, home } of plan) {
        expect(settled[id], `note ${id} is not where its own person first put it`).toEqual([
          cornerOf(home).x,
          cornerOf(home).y,
          'yellow',
          '',
        ]);
      }
      for (const participant of people) {
        expect(await shapeOf(participant)).toEqual(settled);
        expect(participant.consoleErrors).toEqual([]);
      }
    } finally {
      await closeParticipants(people);
    }
  });
});
