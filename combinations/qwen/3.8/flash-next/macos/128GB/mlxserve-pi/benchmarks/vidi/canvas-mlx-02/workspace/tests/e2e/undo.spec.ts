// Story 8, undo.controls (e2e): undo across real browsers on one board, over the real
// provider and the real room.
//
// This is the only place the story's central claim can be proved at all: that what a
// person steps back is their own work and nobody else's, with the other people's
// changes arriving over actual sockets instead of a stand-in. The unit and component
// tests argue it about transaction origins inside one document; here it is argued
// about two screens, and then five, each with a history of its own, watching the same
// twelve notes.
//
// Every board begins as the fixture the design names - a retrospective board of twelve
// notes, eight of them in one cluster - handed to the room through its test seed hook,
// so that what is on screen when a person arrives is content that person was GIVEN:
// none of it is anything their own Undo could take back, and that is the ground every
// scenario below stands on. Each person is a browser context of their own, so nothing
// is shared between them but the board.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id.ts';
import { MAX_CONCURRENT_EDITORS, STICKY_SIZE_WORLD } from '../../src/shared/config.ts';
import type { Point } from '../../src/shared/geometry.ts';
import { buildRetroBoard, type RetroBoard, type RetroNote } from '../fixtures/boards.ts';
import { newCollaborator, openBoard } from './helpers/room.ts';
import { readNotes, seedRoom, type NoteOnScreen } from './helpers/persistence.ts';
import {
  createNoteAt,
  dragBy,
  noteByTestId,
  noteScreenCenter,
  noteTextEl,
  resetCam,
  setCamera,
  typeText,
} from './helpers/sticky.ts';

// One hop between two people is budgeted by LIVE_UPDATE_LATENCY_BUDGET_MS. What is
// waited for here is a whole board agreeing, which is that budget with room for the
// eight notes a single undo puts back on the wire at once.
const AGREE_MS = 20_000;

// These scenarios open a context per person and wait for every one of them to agree,
// which is slower than the nightly default allows.
test.setTimeout(180_000);

/** A note as a screen holds it: named the way the DOM names it, where it stands, and
 *  what it says. Everything these tests assert is a list of these, on a screen. */
interface Placed {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** How the notes of the fixture are named once they are on a screen. */
function onScreen(notes: readonly RetroNote[]): Placed[] {
  return notes.map((n) => ({ id: `sticky-${n.id}`, x: n.x, y: n.y, text: n.text }));
}

/** The same note after this person moved it. */
function moved(note: RetroNote, dx: number, dy: number): Placed {
  return { id: `sticky-${note.id}`, x: note.x + dx, y: note.y + dy, text: note.text };
}

function sorted(notes: readonly Placed[]): Placed[] {
  return [...notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Why this screen's notes are not those notes: the first note missing, worded wrong or
 * out of place, then one that turned up uninvited. A failure here has to say which note
 * on whose screen and what it got instead, because with five people working at once a
 * bare "the boards differ" explains nothing.
 */
function whyDiffer(want: readonly Placed[], got: readonly Placed[]): string {
  for (const w of want) {
    const g = got.find((n) => n.id === w.id);
    if (!g) return `${w.id} is missing`;
    if (g.text !== w.text) return `${w.id} says ${JSON.stringify(g.text)}, not ${JSON.stringify(w.text)}`;
    if (Math.abs(g.x - w.x) > 1 || Math.abs(g.y - w.y) > 1) {
      return `${w.id} stands at ${Math.round(g.x)},${Math.round(g.y)}, not ${w.x},${w.y}`;
    }
  }
  for (const g of got) if (!want.some((w) => w.id === g.id)) return `${g.id} is there uninvited`;
  return '';
}

function describeScreen(got: readonly Placed[]): string {
  return `[${got.map((n) => `${n.id.replace('sticky-', '').slice(0, 8)}@${Math.round(n.x)},${Math.round(n.y)}`).join(' ')}]`;
}

/**
 * This screen must hold exactly these notes, in the places they belong and with the
 * words in them - the assertion every scenario below ends with.
 */
async function expectReadings(page: Page, expected: readonly Placed[]): Promise<void> {
  const want = sorted(expected);
  await expect
    .poll(
      async () => {
        const got = sorted(await readNotes(page));
        const why = whyDiffer(want, got);
        return why === '' ? '' : `${why} (screen holds ${describeScreen(got)})`;
      },
      { timeout: AGREE_MS, intervals: [100] },
    )
    .toBe('');
}

const readings = (page: Page): Promise<NoteOnScreen[]> => readNotes(page);

/** The one note on this screen that was not on the board a moment ago. */
/**
 * The note a screen gained between two readings. With `at`, it is the note standing
 * at that place: on a board where several people pin a note at the same moment,
 * "whichever note appeared" would just as rightly name a colleague's note that came
 * in from the server in between.
 */
function onlyNew(before: readonly Placed[], after: readonly NoteOnScreen[], at?: Point): Placed {
  const known = new Set(before.map((n) => n.id));
  const fresh = after.filter(
    (n) => !known.has(n.id) && (at === undefined || (n.x === at.x && n.y === at.y)),
  );
  if (fresh.length !== 1) {
    throw new Error(`${fresh.length} new note(s)${at ? ' at the spot that was clicked' : ''}, wanted exactly one`);
  }
  const note = fresh[0]!;
  return { id: note.id, x: note.x, y: note.y, text: note.text };
}

/**
 * Where the bottom-left corner of a note lands when the board is double-clicked at
 * a screen point with the camera the helper puts every screen at: the world and the
 * screen are the same size at that zoom, offset by half a viewport.
 */
const pinnedTopLeft = (screenX: number, screenY: number): Point => ({
  x: screenX - -resetCam().x - STICKY_SIZE_WORLD / 2,
  y: screenY - -resetCam().y - STICKY_SIZE_WORLD / 2,
});

/**
 * Point at these notes and click them one after another, Shift held from the second
 * one on: how a person gathers the eight notes of a cluster into one selection.
 */
async function clickToSelect(page: Page, notes: readonly Placed[]): Promise<void> {
  for (const [i, note] of notes.entries()) {
    const centre = await noteScreenCenter(noteByTestId(page, note.id));
    if (i > 0) await page.keyboard.down('Shift');
    await page.mouse.click(centre.x, centre.y);
    if (i > 0) await page.keyboard.up('Shift');
    await page.waitForTimeout(30);
  }
}

/** One person, on a screen of their own, at the board they were given the code for. */
async function openPerson(browser: Browser, boardId: string): Promise<Page> {
  const page = await newCollaborator(browser);
  await openBoard(page, boardId);
  await setCamera(page, resetCam());
  return page;
}

/**
 * The retrospective board the scenarios are stated on: seeded into the room, opened by
 * each person named, and every one of them waits until all twelve notes stand in front
 * of them before the scenario is allowed to begin.
 */
async function seededBoard(
  browser: Browser,
  ...people: string[]
): Promise<{ board: RetroBoard; boardId: string; given: Placed[]; pages: Map<string, Page> }> {
  const board = buildRetroBoard();
  const boardId = newBoardId();
  await seedRoom(boardId, board.update);
  const given = onScreen(board.notes);
  const pages = new Map<string, Page>();
  for (const name of people) {
    const page = await openPerson(browser, boardId);
    await expectReadings(page, given);
    pages.set(name, page);
  }
  return { board, boardId, given, pages };
}

test('TC-22 the deleted cluster comes back with the colleague note intact', async ({
  browser,
}) => {
  const { board, given, pages } = await seededBoard(browser, 'Mia', 'Raj');
  const mia = pages.get('Mia')!;
  const raj = pages.get('Raj')!;
  const untouched = onScreen(board.scattered);

  // Nothing on the board she was handed is Mia's own work, so there is nothing for her
  // Undo to take back yet.
  await expect(mia.getByTestId('undo-button')).toBeDisabled();

  // Mia gathers the eight notes of the cluster and deletes them.
  await clickToSelect(mia, onScreen(board.cluster));
  await expect(mia.getByTestId('selection-bar')).toContainText('8 selected');
  await mia.keyboard.press('Backspace');

  // Both screens are left with the four notes nobody touched.
  await expectReadings(mia, untouched);
  await expectReadings(raj, untouched);

  // Raj pins a note of his own while she is looking at the damage.
  const beforeRaj = await readings(raj);
  await createNoteAt(raj, 140, 700);
  await typeText(raj, 'Raj was here');
  await raj.keyboard.press('Escape');
  const rajsNote = onlyNew(beforeRaj, await readings(raj));
  const withRajsNote = [...untouched, rajsNote];
  await expectReadings(raj, withRajsNote);
  await expectReadings(mia, withRajsNote);

  // Mia takes her delete back. The eight notes return to the places they stood, with
  // the words that were on them, on both screens - and nothing of Raj's work is stirred
  // by it.
  await mia.keyboard.press('Control+z');
  const restored = [...given, rajsNote];
  await expectReadings(mia, restored);
  await expectReadings(raj, restored);
  await expect(noteTextEl(noteByTestId(mia, rajsNote.id))).toHaveText('Raj was here');

  // Redo takes the eight away again, and only the eight.
  await mia.keyboard.press('Control+Shift+z');
  await expectReadings(mia, withRajsNote);
  await expectReadings(raj, withRajsNote);
  await expect(noteTextEl(noteByTestId(raj, rajsNote.id))).toHaveText('Raj was here');

  // Mia stands at the end of her own history again: her Redo is spent, and her Undo
  // is offered - of a step of hers, and of nothing that Raj did. Pressing it walks
  // the same road a third time: the eight come back, on her screen and on Raj's,
  // and Raj's note is where Raj left it.
  await expect(mia.getByTestId('undo-button')).toBeEnabled();
  await expect(mia.getByTestId('redo-button')).toBeDisabled();
  await mia.keyboard.press('Control+z');
  await expectReadings(mia, restored);
  await expectReadings(raj, restored);
  await expect(noteTextEl(noteByTestId(raj, rajsNote.id))).toHaveText('Raj was here');
  await expect(mia.getByTestId('undo-button')).toBeDisabled();
  await expect(mia.getByTestId('redo-button')).toBeEnabled();

  // Raj's own Undo holds the two things Raj did and nothing that Mia did. The first
  // press takes the words off his note - what was typed is a step of its own - and
  // every screen sees exactly that much.
  await expect(raj.getByTestId('undo-button')).toBeEnabled();
  await expect(raj.getByTestId('redo-button')).toBeDisabled();
  await raj.keyboard.press('Control+z');
  await expect(noteTextEl(noteByTestId(raj, rajsNote.id))).toHaveText('');
  await expect(noteTextEl(noteByTestId(mia, rajsNote.id))).toHaveText('');
  // The second press takes the note itself, and the eight notes Mia walked back are
  // standing where she left them, untouched, on both screens.
  await raj.keyboard.press('Control+z');
  await expectReadings(raj, given);
  await expectReadings(mia, given);
  // His own history is spent; hers is untouched by anything he just did.
  await expect(raj.getByTestId('undo-button')).toBeDisabled();
  await expect(raj.getByTestId('redo-button')).toBeEnabled();
  await expect(mia.getByTestId('undo-button')).toBeDisabled();
  await expect(mia.getByTestId('redo-button')).toBeEnabled();
});

test('TC-23 undoing the move of a note a colleague deleted harms nothing', async ({
  browser,
}) => {
  const { board, given, pages } = await seededBoard(browser, 'Mia', 'Raj');
  const mia = pages.get('Mia')!;
  const raj = pages.get('Raj')!;
  const note = board.scattered[1];
  const noteTestId = `sticky-${note.id}`;

  // Mia moves the note, and Raj watches it happen, as he is entitled to.
  const MIA_MOVES_BY = { dx: -160, dy: 60 };
  await dragBy(
    mia,
    await noteScreenCenter(noteByTestId(mia, noteTestId)),
    MIA_MOVES_BY.dx,
    MIA_MOVES_BY.dy,
  );
  const whereMiaPutIt = [
    ...given.filter((n) => n.id !== noteTestId),
    moved(note, MIA_MOVES_BY.dx, MIA_MOVES_BY.dy),
  ];
  await expectReadings(mia, whereMiaPutIt);
  await expectReadings(raj, whereMiaPutIt);

  // Raj deletes that very note. It leaves both screens.
  const whereRajSeesIt = await noteScreenCenter(noteByTestId(raj, noteTestId));
  await raj.mouse.click(whereRajSeesIt.x, whereRajSeesIt.y);
  await raj.keyboard.press('Backspace');
  const remaining = given.filter((n) => n.id !== noteTestId);
  await expectReadings(mia, remaining);
  await expectReadings(raj, remaining);

  // Mia now asks for the one undo she has: the move of a note that is nowhere any more.
  // The inverse of her change has no left-to-restore-to, no object to put it back on.
  await mia.keyboard.press('Control+z');

  // Nothing is shown to her as an error, and no note on her board moves.
  await expect(mia.locator('[data-state="load_failed"]')).toHaveCount(0);
  await expect(mia.getByTestId('board-checking')).toHaveCount(0);
  await expect(mia.locator('[role="alert"]')).toHaveCount(0);
  await expectReadings(mia, remaining);
  await expectReadings(raj, remaining);

  // The step was consumed rather than stranded: she is not left holding an Undo that
  // goes on doing nothing, and no step of anybody else's work was pulled up in its
  // place - which is why the next assertion is that her board still answers her.
  await expect(mia.getByTestId('undo-button')).toBeDisabled();

  const next = board.scattered[2];
  const nextTestId = `sticky-${next.id}`;
  await dragBy(mia, await noteScreenCenter(noteByTestId(mia, nextTestId)), 60, 0);
  await expectReadings(raj, [
    ...remaining.filter((n) => n.id !== nextTestId),
    moved(next, 60, 0),
  ]);
});

test('TC-24 five people undoing at the same moment leave one board behind', async ({
  browser,
}) => {
  const people = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i}`);
  const { board, given, pages } = await seededBoard(browser, ...people);

  // Half of them pin a note of their own, half of them move a note they were given.
  // They do it at the same time, each on their own screen. The pinning spots are
  // spread along the bottom of the board and stop short of the corner where the zoom
  // controls live, so every one of them is empty board to double-click on.
  const PIN_SPOTS = [160, 560, 960];
  const PIN_Y = 740;
  const own: Placed[] = [];
  await Promise.all(
    people.map(async (name, i) => {
      const page = pages.get(name)!;
      if (i % 2 === 0) {
        // A note pinned in the strip of empty board along the bottom, well below
        // the lowest note the board was handed with, and clear of the zoom controls
        // that live in the corner down there.
        const before = await readings(page);
        const spot = PIN_SPOTS[i >> 1]!;
        await createNoteAt(page, spot, PIN_Y);
        await page.keyboard.press('Escape');
        own[i] = onlyNew(before, await readings(page), pinnedTopLeft(spot, PIN_Y));
      } else {
        const note = board.scattered[i - 1];
        await dragBy(page, await noteScreenCenter(noteByTestId(page, `sticky-${note.id}`)), 60, 40);
        own[i] = moved(note, 60, 40);
      }
    }),
  );

  // Every screen now holds all of it: the notes nobody of them touched, the notes their
  // colleagues moved, the notes their colleagues pinned.
  const movedIds = new Set(own.filter((_, i) => i % 2 === 1).map((n) => n.id));
  const atPeak = [...given.filter((n) => !movedIds.has(n.id)), ...own];
  for (const page of pages.values()) await expectReadings(page, atPeak);

  // And now everyone presses Ctrl+Z at the same moment.
  await Promise.all([...pages.values()].map((page) => page.keyboard.press('Control+z')));

  // Each undo took back its own author's work and nothing beside it, so the board that
  // is left is the board everybody was handed - and all five screens say so, note for
  // note, word for word, place for place.
  for (const page of pages.values()) await expectReadings(page, given);

  // Nobody is left holding a step back into somebody else's work; each still has their
  // own one step to come back should they ask for it.
  for (const page of pages.values()) {
    await expect(page.getByTestId('undo-button')).toBeDisabled();
    await expect(page.getByTestId('redo-button')).toBeEnabled();
  }

  // One of them steps forwards again while everyone else looks on: what comes back is
  // her own note and nothing beside it.
  const first = pages.get(people[0]!)!;
  const hers = own[0]!;
  await first.keyboard.press('Control+Shift+z');
  await expectReadings(first, [...given, hers]);

  // Her colleagues watch that note arrive as the ordinary change it is to them - and not
  // one of them is offered an Undo by it, which is the promise the whole story makes.
  for (const page of pages.values()) {
    if (page === first) continue;
    await expectReadings(page, [...given, hers]);
    await expect(page.getByTestId('undo-button')).toBeDisabled();
  }
});


