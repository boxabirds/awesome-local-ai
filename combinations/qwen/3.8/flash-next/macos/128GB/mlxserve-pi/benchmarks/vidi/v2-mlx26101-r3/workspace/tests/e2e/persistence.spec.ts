import { test, expect, type Page } from '@playwright/test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import {
  BOARD_LOAD_BUDGET_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { denseNoteSeeds, writeNote, type NoteSeed } from '../fixtures/boards';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { BoardServer, storageDir } from './helpers/wrangler-process';
import { seedBoard } from './helpers/room-client';
import { Cast, boardJson, openBoardAt, waitConnected, waitForSameBoard } from './helpers/participants';
import {
  centreByIdOnScreen,
  doubleClickBoard,
  dragPointer,
  noteId,
  noteIds,
  notes,
  setColour,
  stateById,
  stopEditing,
  textAt,
  typeInNote,
} from './helpers/sticky';

/**
 * Story 4: coming back to a board and finding everything as it was left.
 *
 * These are the tests that stop the service. A room that reads its board out of storage cannot be
 * tested against a server reused from one test to the next - the memory that has to be lost is the
 * server's own - so each test here starts `wrangler dev` with a storage directory of its own, works
 * on a board, stops the process, starts it again with the same directory, and looks at the board.
 *
 * One limit worth saying out loud (design, "Not covered"): the write is durable before the change
 * is relayed, but the disk behind that is the platform's. TC-20 shows a row surviving a service
 * that is asked to stop, which is what a restart, a deploy and a night's sleep are; it is not a
 * test of a machine losing power, which nothing that runs above the platform can test.
 */

/**
 * Where these tests start looking for a port to serve on; the inspector takes the next one.
 *
 * A starting point and not the port that gets used: `BoardServer` asks whether a port and the
 * inspector's are both free and moves along when they are not. The looking starts in the range the
 * operating system hands out for outbound connections rather than in the low band the other e2e
 * files were given for two reasons that have both been seen on this machine. Some sandboxes will not
 * carry a test's request to an arbitrary port - the attempt is refused by the sandbox itself, with
 * nothing said by whoever may be listening - and the ports that are carried to are few and get
 * occupied by servers this suite left behind on the way, which is likely here because this file
 * restarts its server more than any other. The ephemeral range is carried to everywhere, and a port
 * in it that the operating system lends to something in the meantime is caught by the bind.
 */
const PORT = Number(process.env.PERSIST_E2E_PORT ?? 49_701);

/** Twenty-five short ideas, in the order somebody would have written them. */
const IDEAS = [
  'Onboarding is too long',
  'Show the board, not the tour',
  'Sample board instead of empty one',
  'Ask who is on the team',
  'One question per column',
  'Timer for the quiet ones',
  'Group after, not during',
  'Labels before votes',
  'Keep the winners visible',
  'Export at the end',
  'Colours mean nothing yet',
  'Meaningful colours, then',
  'Too many toolbar buttons',
  'Move the counter',
  'Undo is not optional',
  'Delete needs no dialog',
  'Typing should not select',
  'Notes should not overlap',
  'Zoom to fit at the start',
  'Remember where I was',
  'Comments on a note',
  'Presence, but quiet',
  'Offline should not lose work',
  'Save without asking',
  'It should just be there',
];

/** The colours a few of those ideas end up wearing. */
const COLOURS = ['pink', 'blue', 'green', 'violet', 'orange'] as const;

/**
 * Work on a board the way a person does for a few minutes: notes, text, colours, and one thing
 * moved out of where it was made.
 *
 * This goes through the page rather than the sync path on purpose: what has to end up in storage is
 * what a person's own edits look like when they reach the room - one note per burst of typing, one
 * colour per click on a swatch - and the point of the test is that all of it is still there.
 */
async function workOnABoard(page: Page, count = 25): Promise<string[]> {
  const created: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const idea = IDEAS[index % IDEAS.length] ?? `Idea ${String(index + 1)}`;
    await doubleClickBoard(page, {
      x: 220 + (index % 5) * 170,
      y: 160 + Math.floor(index / 5) * 140,
    });
    await typeInNote(page, idea);
    await stopEditing(page);
    // A new note is drawn on top, so it is the last one in the stack, which is where this note is.
    const id = await noteId(page, index);
    created.push(id);
    // A fifth of them get a colour, while the note is still the selected one - which is how a
    // colour is chosen in the product. A colour is a change to a different part of the document
    // than the text is, and "everything as it was left" has to mean every kind of change.
    if (index % 4 === 0) {
      await setColour(page, id, COLOURS[(index / 4) % COLOURS.length] ?? 'pink');
    }
  }
  // And one note is dragged out of where it was made. The note on top is the one grabbed, because
  // that is the one under the pointer where the pointer goes down.
  const moved = created[created.length - 1];
  if (moved !== undefined) {
    const before = await stateById(page, moved);
    const from = await centreByIdOnScreen(page, moved);
    await dragPointer(page, from, { x: from.x - 90, y: from.y - 60 });
    const after = await stateById(page, moved);
    if (after.x === before.x && after.y === before.y) {
      throw new Error(`note ${moved} was dragged and did not move`);
    }
  }
  await expect
    .poll(async () => (await noteIds(page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return created;
}

/** The board a fixture wrote, in the shape a page reports a board in. */

test.describe('returning to a board', () => {
  // One at a time. Each of these runs a dev server, and the timing they report - how long a board
  // takes to open, how long a change took to be durable - means something only when the machine is
  // not also starting two other servers and rendering two other boards at it.
  test.describe.configure({ mode: 'serial' });
  test('workflow: work, close everything, restart the service, come back (TC-19)', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const server = await BoardServer.start({ port: PORT, persistTo: storageDir() });
    const boardId = newBoardId();

    const before = await browser.newContext({ baseURL: server.origin });
    const working = await before.newPage();
    await openBoardAt(working, boardId);
    await waitConnected(working);
    const startedAt = Date.now();
    await workOnABoard(working, 25);
    console.log(
      `[persist] TC-19: 25 notes written through the page in ${String(Date.now() - startedAt)}ms`,
    );

    // Everything the board says, in the words the person who made it will read again: text, colour,
    // position, stacking order, and the note's own id - the one thing about a note that must not
    // change when it comes back, because it is what every other note's position in the stack and
    // every selection is about.
    const left = await boardJson(working);
    expect(JSON.parse(left)).toHaveLength(25);

    // The person closes the tab; then the service stops, which is where the memory goes.
    await before.close();
    await server.restart();

    // The same storage directory, a new process: what a restart, a deploy and a night's sleep all
    // look like to a board.
    const after = await browser.newContext({ baseURL: server.origin });
    const returning = await after.newPage();
    const reopenedAt = Date.now();
    await openBoardAt(returning, boardId);
    await waitConnected(returning);
    console.log(
      `[persist] TC-19: the board was answered ${String(Date.now() - reopenedAt)}ms after the restart`,
    );
    expect(await boardJson(returning)).toBe(left);
    await expect(textAt(returning, 0)).toBeVisible();

    await after.close();
    await server.dispose();
  });

  test('workflow: leaving immediately after a change somebody else saw (TC-20)', async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const server = await BoardServer.start({ port: PORT, persistTo: storageDir() });
    const cast = await Cast.openAt(server.origin, browser, 'Alex', 'Sam');

    const alex = cast.by('Alex');
    await doubleClickBoard(alex.page, { x: 640, y: 400 });
    await typeInNote(alex.page, 'Written on the way out the door');
    await stopEditing(alex.page);
    // The change is not saved because the test waited for a flush; it is saved because the other
    // person saw it, and seeing it is the thing the room does after the row is written.
    const left = await waitForSameBoard(cast.people);
    const seenAt = Date.now();

    // Both people leave and the service stops, a moment after the change arrived. There is no flush
    // timer in the room, and no idle moment for one to have run in.
    await cast.close();
    await server.restart();
    console.log(
      `[persist] TC-20: ${String(Date.now() - seenAt)}ms from the change being seen to the ` +
        'service stopping and starting again',
    );

    const back = await browser.newContext({ baseURL: server.origin });
    const page = await back.newPage();
    await openBoardAt(page, cast.boardId);
    await waitConnected(page);
    expect(await boardJson(page)).toBe(left);
    await back.close();
    await server.dispose();
  });

  test(`workflow: a board of ${String(PERSIST_TESTED_NOTES)} notes opens completely (TC-21)`, async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const server = await BoardServer.start({ port: PORT, persistTo: storageDir() });
    const boardId = newBoardId();

    const seededAt = Date.now();
    const seeds = denseNoteSeeds();
    // What the room itself says the board is, read by a client that wrote nothing: the room's own
    // answer, ids included. A note's id is given to it when it is made, so the fixture cannot say
    // what the ids will be and no comparison may assume it knows.
    const written = await seedBoard(server.socketUrl(boardId), seeds);
    console.log(
      `[persist] TC-21: ${String(PERSIST_TESTED_NOTES)} notes put on the board through the room's ` +
        `own sync path in ${String(Date.now() - seededAt)}ms`,
    );
    expect(
      shape(written),
      'what the room holds is what the fixture wrote',
    ).toBe(writtenShape(seeds));

    const page = await browser.newPage({ baseURL: server.origin });
    const openedAt = Date.now();
    await openBoardAt(page, boardId);
    // The ordinary wait, for the ordinary thing: every note drawn.
    await expect
      .poll(() => notes(page).count(), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        intervals: [50, 100, 250],
        message: 'every note should end up drawn',
      })
      .toBe(PERSIST_TESTED_NOTES);
    const rendered = Date.now() - openedAt;
    const budget = rendered <= BOARD_LOAD_BUDGET_MS ? 'within' : 'over';
    console.log(
      `[persist] TC-21: ${String(PERSIST_TESTED_NOTES)} notes drawn in ${String(rendered)}ms ` +
        `(${budget} the ${String(BOARD_LOAD_BUDGET_MS)}ms a board is meant to open in)`,
    );
    console.log(
      '[persist] TC-21: reported, not asserted - the model, the browser and the server are all on ' +
        'this one machine',
    );

    // Drawn is not the same as there: 2000 empty boxes would pass a count. The notes have to be the
    // ones that were written, with their text, their colours and the order they end up in - which is
    // what the page's own readout is compared against the room's.
    const shown = JSON.parse(await boardJson(page)) as NoteOnPage[];
    expect(
      firstDifference(shown, written),
      'the board the page drew is the board the room holds',
    ).toBeNull();
    expect(shown.length).toBe(PERSIST_TESTED_NOTES);

    await page.close();
    await server.dispose();
  });
});

/** A note as a page or a client reports it, which is all a board can be asked about. */
interface NoteOnPage {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  text: string;
}

/**
 * Notes by their content, without their ids: the same notes in the same order, for a comparison
 * where the identity of a note is not the thing being asked about - which is only ever a question
 * asked of a fixture, since the fixture does not choose the ids its notes get.
 */
function shape(notes: readonly { x: number; y: number; color: string; text: string }[]): string {
  return JSON.stringify(
    notes
      .map(({ x, y, color, text }) => ({ x, y, color, text }))
      .sort((a, b) => a.text.localeCompare(b.text) || a.x - b.x || a.y - b.y),
  );
}

/**
 * What the fixture wrote, as the model would report it.
 *
 * This goes through `writeNote` rather than reading the seeds themselves because a note is not the
 * number it was given: where a note is put and where it ends up are the model's business, and a
 * comparison that expected the fixture's own numbers back would fail on every note for a reason
 * that has nothing to do with persistence. Ids aside, as above.
 */
function writtenShape(seeds: readonly NoteSeed[]): string {
  const doc = new Y.Doc();
  initDoc(doc);
  for (const seed of seeds) {
    writeNote(doc, seed);
  }
  return shape(snapshot(doc));
}

/**
 * The first note the two boards disagree about, said in a way that can be read - or null if they
 * agree. Comparing two strings of 2000 notes says nothing useful when they differ; which note, and
 * in what, is the question a failure has to answer.
 */
function firstDifference(
  shown: readonly NoteOnPage[],
  written: readonly NoteOnPage[],
): string | null {
  if (shown.length !== written.length) {
    return `the page drew ${String(shown.length)} notes and ${String(written.length)} were written`;
  }
  for (let index = 0; index < written.length; index += 1) {
    const want = written[index]!;
    const got = shown[index]!;
    if (got.id !== want.id) {
      return `note ${String(index)} is ${got.id} on the page and ${want.id} in what was written`;
    }
    for (const field of ['x', 'y', 'z', 'color', 'text'] as const) {
      if (got[field] !== want[field]) {
        return `note ${want.id} has ${field} ${JSON.stringify(got[field])} on the page and ${JSON.stringify(
          want[field],
        )} in what was written`;
      }
    }
  }
  return null;
}
