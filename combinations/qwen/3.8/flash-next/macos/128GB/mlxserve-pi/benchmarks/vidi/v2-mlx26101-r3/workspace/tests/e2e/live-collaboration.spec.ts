/**
 * Two or more real browsers on one board, through the real Worker, the real Durable Object and
 * real WebSockets, driven by their own mice and keyboards.
 *
 * How long a change takes to cross is printed against LIVE_UPDATE_LATENCY_BUDGET_MS and never
 * asserted, exactly as the design asks: a wait that quietly allowed fifteen seconds would only
 * ever report "passed", while the printed number is the thing a person would notice. What is
 * asserted is what each person ends up seeing, and what each person does not see.
 *
 * Every participant is a separate browser context - a separate browser profile on a separate
 * machine, as far as the board is concerned. Two tabs of one profile would talk to each other
 * through the tab-to-tab copy channel that the client deliberately does not use, and the board
 * would look like it worked even with the room broken.
 */

import { expect, test, type Page, type WebSocket } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
  type StickyColor,
} from '../../src/shared/config';
import { readCamera, setCamera, settle, VIEWPORT, type ScreenPoint } from './helpers/board';
import {
  centreByIdOnScreen,
  colourSwatch,
  colourSwatchIn,
  createStickyButton,
  deleteNoteButton,
  deleteNoteButtonIn,
  dragPointer,
  editor,
  isClickable,
  noteId,
  notes,
  setColour,
  stateById,
  stopEditing,
  typeInNote,
  waitForNoteCount,
} from './helpers/sticky';
import {
  Cast,
  badge,
  badgeStory,
  badgeText,
  boardJson,
  editingNoteId,
  faces,
  logLatency,
  logScenario,
  loseConnection,
  measureChange,
  restoreConnection,
  stayShowing,
  waitForSameBoard,
  watchBadge,
  type NoteFace,
} from './helpers/participants';

/** What one board shows, with nobody holding anything: what `boardJson` gives back. */
type Face = Omit<NoteFace, 'selected'>;

/** What the badge says, word for word; the wording itself is pinned by a component test. */
const RECONNECTING = 'Reconnecting…';
const CONNECTED = 'Connected';

/** The text of the note this page is editing. */
async function textOfEditor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const field = document.querySelector('[data-testid="sticky-note-editor"]');
    return field === null ? '' : (field as HTMLTextAreaElement).value;
  });
}

/** Notes whose text starts with a prefix - "whose notes are on the board", in test terms. */
function mine(list: readonly Face[], prefix: string): string[] {
  return list.filter((face) => face.text.startsWith(prefix)).map((face) => face.text);
}

/** Make a note, type into it, and leave it alone, all on one page. */
async function makeNote(page: Page, text: string): Promise<string> {
  await createStickyButton(page).click();
  await expect(editor(page)).toBeVisible();
  await typeInNote(page, text);
  const id = await editingNoteId(page);
  await stopEditing(page);
  return id;
}

/** Give this page a part of the board of its own, so five people's notes cannot be confused. */
async function moveApart(page: Page, index: number): Promise<void> {
  const base = await readCamera(page);
  await setCamera(page, { x: base.x + index * PATCH_WIDTH });
}

/**
 * How far apart two people's parts of the board are, in world units.
 *
 * Wide enough that the four columns of notes a person keeps in their own patch, and the drags
 * that put them there, never come near the next person's patch: a click on a busy board must
 * only ever be able to reach the notes belonging to the person holding the mouse.
 */
const PATCH_WIDTH = 1_200;

/**
 * Enough names for a whole room: one per participant, in the order they arrive. Names are what
 * a person's notes are labelled with in these tests, which is how "whose notes arrived" is
 * read off a board that everybody is looking at.
 */
const NAMES = ['Alex', 'Sam', 'Riley', 'Jo', 'Ana', 'Bo'];

test.describe('one person editing, another watching', () => {
  test('TC-22: create, move, recolour, type and delete all reach the other person', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');

      // Made and typed into: Sam is shown the note with its text on it.
      const started = Date.now();
      await createStickyButton(alex.page).click();
      await typeInNote(alex.page, 'first note');
      await stopEditing(alex.page);
      const id = await noteId(alex.page);
      await expect
        .poll(() => faces(sam.page).then((list) => list.map((face) => face.text)), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
          intervals: [10, 25, 50],
        })
        .toEqual(['first note']);
      logLatency('a new note, with its text on it', started);

      // Moved. Alex dragged it on Alex's screen; what is checked is the world position Sam sees.
      const before = await stateById(sam.page, id);
      const centre = await centreByIdOnScreen(alex.page, id);
      await measureChange(
        'a move of the note',
        async () => {
          await dragPointer(alex.page, centre, { x: centre.x + 120, y: centre.y + 80 });
        },
        async () => {
          const after = await stateById(sam.page, id);
          return after.x === before.x + 120 && after.y === before.y + 80;
        },
      );

      // Recoloured. The note is still held from the drag, so its colours are within reach.
      await measureChange(
        'a new colour',
        async () => {
          await setColour(alex.page, id, 'blue');
        },
        async () => (await stateById(sam.page, id)).color === 'blue',
      );

      // Typed into from the editor this time, not from the moment of creation.
      const editPoint = await centreByIdOnScreen(alex.page, id);
      await measureChange(
        'text typed into the note',
        async () => {
          await alex.page.mouse.dblclick(editPoint.x, editPoint.y);
          await expect(editor(alex.page)).toBeVisible();
          await alex.page.keyboard.type(' and more');
          await alex.page.keyboard.press('Escape');
        },
        async () => (await faces(sam.page)).some((face) => face.text === 'first note and more'),
      );

      // Deleted. One note for one person is no notes for the other.
      await measureChange(
        'the note being deleted',
        async () => {
          await alex.page.mouse.click(editPoint.x, editPoint.y);
          await deleteNoteButton(alex.page).click();
          await expect(notes(alex.page)).toHaveCount(0);
        },
        async () => (await faces(sam.page)).length === 0,
      );

      expect(alex.problems).toEqual([]);
      expect(sam.problems).toEqual([]);
    } finally {
      await cast.close();
    }
  });
});

test.describe('both people working on the same note', () => {
  test('TC-23: both typing in the same note at the same time keeps every character', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');

      // Alex makes a note and stays inside it; Sam opens the same note and stays inside it too.
      await createStickyButton(alex.page).click();
      const id = await editingNoteId(alex.page);
      await waitForNoteCount(sam.page, 1);
      const onSam = await centreByIdOnScreen(sam.page, id);
      await sam.page.mouse.dblclick(onSam.x, onSam.y);
      await expect(editor(sam.page)).toBeVisible();
      await expect(editor(alex.page)).toBeVisible();

      // Two keyboards at the same moment. The letters are deliberately each person's own, so
      // that "the merged text holds every character typed" is something a test can say exactly.
      const started = Date.now();
      await Promise.all([
        alex.page.keyboard.type('aaaaaa', { delay: 15 }),
        sam.page.keyboard.type('bbbbbb', { delay: 15 }),
      ]);

      await expect
        .poll(() => textOfEditor(alex.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toMatch(/^[ab]{12}$/);
      const merged = await textOfEditor(alex.page);
      await expect
        .poll(() => textOfEditor(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(merged);
      logScenario('twelve keystrokes from two keyboards in one note', started);

      expect(merged.split('a').length - 1).toBe(6);
      expect(merged.split('b').length - 1).toBe(6);

      // Out of the editor on both sides, and still one note holding one text on both boards.
      await alex.page.keyboard.press('Escape');
      await sam.page.keyboard.press('Escape');
      const settled = await waitForSameBoard(cast.people);
      const [note] = JSON.parse(settled) as Face[];
      expect(note).toBeDefined();
      expect(await noteId(alex.page)).toBe(await noteId(sam.page));
    } finally {
      await cast.close();
    }
  });

  test('TC-24: both dragging the same note to different places leaves one position on both boards', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');
      const id = await makeNote(alex.page, 'one note');
      await waitForNoteCount(sam.page, 1);
      await settle(alex.page);
      await settle(sam.page);

      const onAlex = await centreByIdOnScreen(alex.page, id);
      const onSam = await centreByIdOnScreen(sam.page, id);

      // One note, two drags, at the same time, to opposite corners of the screen.
      //
      // Both hands go down before either of them moves. That ordering is not decoration: a note that
      // has already travelled thirty units by the time the second person presses is a note that
      // person then drags from thirty units on, and the position it ends at belongs to neither
      // pointer - which is the app being right (a drag carries an object from where it was when the
      // press happened, which is the only way a board with five people on it stays one board) and the
      // test asking a question its own setup never settled. Both pointers are therefore already
      // holding the note when the note starts moving, which is the situation this test is named after.
      await Promise.all([alex.page.mouse.move(onAlex.x, onAlex.y), sam.page.mouse.move(onSam.x, onSam.y)]);
      await Promise.all([alex.page.mouse.down(), sam.page.mouse.down()]);
      const before = await stateById(alex.page, id);
      await Promise.all([
        alex.page.mouse.move(onAlex.x - 160, onAlex.y - 90, { steps: 8 }),
        sam.page.mouse.move(onSam.x + 160, onSam.y + 90, { steps: 8 }),
      ]);
      await Promise.all([alex.page.mouse.up(), sam.page.mouse.up()]);
      await settle(alex.page);
      await settle(sam.page);

      const started = Date.now();
      const settled = await waitForSameBoard(cast.people);
      const elapsed = logScenario('two people dragging one note to one place', started);

      const [note] = JSON.parse(settled) as Face[];
      expect(note).toBeDefined();
      // One of the two positions won on both boards - the same one on both - and the note is
      // neither doubled nor gone. Which one wins is yjs's business; that both boards agree is
      // the requirement, so `elapsed` is printed rather than asserted.
      expect(Math.abs(note!.x - (before.x - 160)) < 2 || Math.abs(note!.x - (before.x + 160)) < 2).toBe(
        true,
      );
      expect(JSON.parse(await boardJson(sam.page))).toEqual(JSON.parse(await boardJson(alex.page)));
      expect(elapsed).toBeGreaterThanOrEqual(0);
    } finally {
      await cast.close();
    }
  });

  test('TC-25: a note deleted while the other person is typing in it goes away for them too', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');
      const id = await makeNote(alex.page, 'doomed');
      await waitForNoteCount(sam.page, 1);

      // Sam is mid-sentence in that note.
      const onSam = await centreByIdOnScreen(sam.page, id);
      await sam.page.mouse.dblclick(onSam.x, onSam.y);
      await expect(editor(sam.page)).toBeFocused();
      await sam.page.keyboard.type('but someone else is');

      // Alex deletes the very note Sam is typing in.
      const onAlex = await centreByIdOnScreen(alex.page, id);
      await alex.page.mouse.click(onAlex.x, onAlex.y);
      await deleteNoteButton(alex.page).click();
      await expect(notes(alex.page)).toHaveCount(0);

      // Sam's note goes and the editor goes with it, without a fuss: nothing put up a dialog,
      // nothing threw, nothing was written to the console as an error.
      await expect
        .poll(() => faces(sam.page).then((list) => list.length), {
          timeout: E2E_EVENTUAL_TIMEOUT_MS,
        })
        .toBe(0);
      await expect(editor(sam.page)).toHaveCount(0);
      await settle(sam.page);
      expect(sam.problems).toEqual([]);
      expect(alex.problems).toEqual([]);

      // And the board still works for both of them afterwards.
      const fresh = await makeNote(sam.page, 'still here');
      await waitForSameBoard(cast.people);
      expect(JSON.parse(await boardJson(alex.page))).toEqual([
        expect.objectContaining({ id: fresh, text: 'still here' }),
      ]);
    } finally {
      await cast.close();
    }
  });
});

test.describe('a room full of people', () => {
  test('TC-26: on a full board everyone sees everyone else make and move notes', async ({
    browser,
  }) => {
    const people = NAMES.slice(0, MAX_CONCURRENT_EDITORS);
    const cast = await Cast.open(browser, ...people);
    try {
      const started = Date.now();
      await Promise.all(
        cast.people.map(async (person, index) => {
          // Everybody starts on the same view, so their notes would land on each other and a
          // drag would pick up somebody else's note. Each person gets their own part of the
          // board first; notes are still made the way they are made, in the middle of wherever
          // that person is looking.
          await moveApart(person.page, index);
          for (let step = 1; step <= 5; step += 1) {
            await createStickyButton(person.page).click();
            await expect(editor(person.page)).toBeVisible();
            await typeInNote(person.page, `${person.name.toLowerCase()}-${step}`);
            const id = await editingNoteId(person.page);
            await stopEditing(person.page);
            // Moved while it is still the top of its own stack, which is the one moment a drag
            // is certain to be grabbing the note this person just made.
            const centre = await centreByIdOnScreen(person.page, id);
            await dragPointer(person.page, centre, {
              x: centre.x + 60 + index * 30,
              y: centre.y - 120 - step * 30,
            });
          }
        }),
      );

      // Every note and every move arrived everywhere.
      const settled = await waitForSameBoard(cast.people);
      const all = JSON.parse(settled) as Face[];
      expect(all).toHaveLength(people.length * 5);
      for (const name of people) {
        expect(mine(all, `${name.toLowerCase()}-`)).toHaveLength(5);
      }
      // No two notes ended up on the same spot, which is what the moves were for.
      expect(new Set(all.map((note) => `${note.x},${note.y}`)).size).toBe(all.length);
      logScenario(`${people.length} people making and moving 5 notes each`, started);

      // One single change, timed on its way to the next person over.
      const alex = cast.by(people[0]!);
      const sam = cast.by(people[1]!);
      await measureChange(
        'one more note, to the next person over',
        async () => {
          await makeNote(alex.page, 'timed');
        },
        async () => (await faces(sam.page)).some((face) => face.text === 'timed'),
      );

      // And the person who arrived last is holding the whole board too.
      await waitForSameBoard(cast.people);
      expect(JSON.parse(await boardJson(cast.people.at(-1)!.page))).toHaveLength(all.length + 1);
    } finally {
      await cast.close();
    }
  });
});

test.describe('a connection that goes away and comes back', () => {
  test('TC-27: what both people made while they could not reach each other arrives afterwards', async ({
    browser,
  }) => {
    // An outage is long by definition: one person has to be noticed as gone, keep working
    // through it, come back, and be caught up on both sides.
    test.setTimeout(240_000);
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');
      // What each badge said, read out by the page itself: the way back is only shown for two
      // seconds, and a test that happens to look away would otherwise blame the product.
      const saidOnSam = await watchBadge(sam.page);
      const saidOnAlex = await watchBadge(alex.page);

      // Alex's socket dies, and the way back is blocked so that it stays dead. The room is
      // untouched, so this is Alex's outage and not the board's.
      await loseConnection(alex);
      const outage = Date.now();

      // However a connection dies - the browser letting go of it, or nothing arriving for so
      // long that the client gives up on it - this is the one thing the person on that
      // connection can be told, and it comes within a few hundred milliseconds.
      await expect
        .poll(() => badgeText(alex.page), { timeout: 10_000, intervals: [50, 100] })
        .toBe(RECONNECTING);
      // Sam is not told anything, because nothing is wrong with Sam's own connection: who is
      // here and who has gone is presence, which is story 9's business, not the badge's.
      expect(badgeStory(saidOnSam)).toBe('(hidden)');

      // Both of them carry on working, in the dark, three notes each.
      for (let step = 1; step <= 3; step += 1) {
        await makeNote(alex.page, `away-${step}`);
      }
      for (let step = 1; step <= 3; step += 1) {
        await makeNote(sam.page, `here-${step}`);
      }

      // Apart, they hold six notes between them, and neither can see the other's three.
      expect(mine(await faces(alex.page), 'away-')).toHaveLength(3);
      expect(mine(await faces(sam.page), 'here-')).toHaveLength(3);
      expect(mine(await faces(alex.page), 'here-')).toHaveLength(0);
      expect(mine(await faces(sam.page), 'away-')).toHaveLength(0);

      // The outage lasts as long as the config says one lasts, with this client knocked and
      // retrying the whole way: the badge must not get optimistic about a handshake that
      // never completes.
      await stayShowing(alex.page, RECONNECTING, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - outage));
      await restoreConnection(alex);

      // The way back is said out loud, and then goes quiet again.
      await expect
        .poll(() => badgeText(alex.page), { timeout: 30_000, intervals: [100] })
        .toBe(CONNECTED);
      await expect(badge(alex.page)).toHaveCount(0, { timeout: 30_000 });

      // Six notes on both boards: nothing either of them made while they were apart is missing,
      // and nothing is there twice.
      await waitForSameBoard(cast.people);
      expect(JSON.parse(await boardJson(alex.page))).toHaveLength(6);
      await expect(notes(alex.page)).toHaveCount(6);
      expect(mine(await faces(sam.page), 'away-')).toHaveLength(3);
      expect(mine(await faces(alex.page), 'here-')).toHaveLength(3);

      // And Sam, who heard nothing the whole time, is simply shown the three notes Alex made.
      expect(badgeStory(saidOnSam)).toBe('(hidden)');
      console.log(
        `[outage] Alex was cut off for ${Math.round((Date.now() - outage) / 100) / 10}s; ` +
          `Alex's badge said: ${badgeStory(saidOnAlex)}`,
      );
      expect(badgeStory(saidOnAlex)).toContain(RECONNECTING);
      expect(badgeStory(saidOnAlex)).toContain(CONNECTED);
    } finally {
      await cast.close();
    }
  });
});

test.describe('what stays with the person holding the mouse', () => {
  test('TC-28: one person selects and edits a note, and the other sees neither', async ({
    browser,
  }) => {
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');
      await createStickyButton(alex.page).click();
      await typeInNote(alex.page, 'alex is typing');
      const id = await editingNoteId(alex.page);
      await expect(editor(alex.page)).toBeVisible();

      // Sam has the note, and has hold of nothing: no selection outline, no caret, no editor.
      await expect
        .poll(
          async () => {
            const note = (await faces(sam.page)).find((face) => face.id === id);
            return note === undefined ? null : { text: note.text, selected: note.selected };
          },
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toEqual({ text: 'alex is typing', selected: false });
      await expect(editor(sam.page)).toHaveCount(0);

      // The note Alex is holding is drawn as held, and only on Alex's own screen.
      expect((await faces(alex.page)).find((face) => face.id === id)?.selected).toBe(true);

      // Sam's keyboard does not type into Alex's note, because Sam is not in it.
      await sam.page.keyboard.type('xyz');
      await expect(editor(sam.page)).toHaveCount(0);
      expect((await faces(sam.page)).find((face) => face.id === id)?.text).toBe('alex is typing');
      expect(await textOfEditor(alex.page)).toBe('alex is typing');
    } finally {
      await cast.close();
    }
  });

  test('TC-28b: the connection message is not in the way of the board', async ({ browser }) => {
    const cast = await Cast.open(browser, 'Alex');
    try {
      const alex = cast.by('Alex');
      // A connected board shows nothing at all, so nothing is sitting on top of the board.
      await expect(badge(alex.page)).toHaveCount(0);
      await makeNote(alex.page, 'unobstructed');
      expect(await colourSwatch(alex.page, 'blue').isVisible()).toBe(true);
      expect((await faces(alex.page))[0]?.selected).toBe(true);
    } finally {
      await cast.close();
    }
  });
});

/* The two that are long on purpose: `npm run test:e2e:nightly`. -------------------- */

test.describe('a board left alone, and a board at capacity', () => {
  /**
   * How long a client will go without a single message from the room before it gives up on the
   * connection it has and dials again: y-websocket's `messageReconnectTimeout`, looked at once
   * every tenth of it. Deliberately not in src/shared/config, because it is not ours to set -
   * it belongs to the library - but an idle board is measured entirely against it, so it is
   * written down here where a change to the library can be noticed.
   *
   * The room is never quiet for that long, and is not meant to be: each client renews its own
   * awareness every fifteen seconds, and the room relays every awareness message to every
   * socket in the room including the one it arrived from - which is the part that keeps a
   * person on their own alive. Two people doing nothing at all are therefore holding each
   * other's connections open without either of them knowing anything about it.
   */
  const SILENCE_LIMIT_MS = 30_000;

  /** The colours a note can be given, in the order the toolbar shows them. */
  const COLOURS = Object.keys(STICKY_COLORS) as StickyColor[];

  /**
   * A soak that fails has to be dialled up again on the same board, so the randomness is
   * seeded rather than drawn: the same seed moves the same notes in the same order.
   */
  function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The value below `fraction` of a sorted list of durations. */
  function percentile(sorted: readonly number[], fraction: number): number {
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
  }

  /** How many notes fit in one person's patch: four across, three down. */
  const PATCH_SLOTS = 12;

  /**
   * Where a note goes in its owner's patch, as a drag from the middle of the view: four notes
   * across, three rows down, all of it well inside one person's screen and one person's patch.
   */
  function slotOffset(slot: number): ScreenPoint {
    return {
      x: ((slot % 4) - 1.5) * 260,
      y: (Math.floor(slot / 4) - 1) * 220,
    };
  }

  /**
   * The part of the screen a note may be left in during a soak: the whole of the note and its
   * toolbar inside the window, which is 150 px in from the sides and 200 px from the top - the
   * toolbar is drawn inside the note, along its bottom edge, so a note whose bottom is below the
   * window has a toolbar that cannot be clicked at all. That is not a bug in the board, which is
   * endless in every direction and expects you to pan; it is a limitation of a test that clicks
   * without panning. So every drag in here ends inside this box.
   */
  function onScreen(point: ScreenPoint): ScreenPoint {
    return {
      x: Math.min(VIEWPORT.width - 150, Math.max(150, point.x)),
      y: Math.min(VIEWPORT.height - 210, Math.max(200, point.y)),
    };
  }

  /**
   * Where slot `slot` of the view sits on the screen. Every page in a soak is looking at the
   * middle of its own patch, and the board fills the window, so the middle of the view is the
   * middle of the window for all of them.
   */
  function slotPoint(slot: number): ScreenPoint {
    const offset = slotOffset(slot);
    return onScreen({ x: VIEWPORT.width / 2 + offset.x, y: VIEWPORT.height / 2 + offset.y });
  }

  /** Put a note in its slot, so that no two notes are ever sitting on top of each other. */
  async function fanToSlot(page: Page, id: string, slot: number): Promise<void> {
    const centre = await centreByIdOnScreen(page, id);
    await dragPointer(page, centre, slotPoint(slot));
  }

  /** Which note this page is editing, or null while it is editing nothing. */
  async function editingNoteIdOrNull(page: Page): Promise<string | null> {
    // `count` rather than a visible assertion: this asks a question about the present moment and
    // waits for nothing.
    if ((await editor(page).count()) === 0) {
      return null;
    }
    return editingNoteId(page);
  }

  test('TC-29: a board nobody has touched for longer than the silence limit is still the same connection', {
    tag: '@nightly',
  }, async ({ browser }) => {
    test.setTimeout(SILENCE_LIMIT_MS + 120_000);
    const cast = await Cast.open(browser, 'Alex', 'Sam');
    try {
      const alex = cast.by('Alex');
      const sam = cast.by('Sam');
      const saidOnAlex = await watchBadge(alex.page);
      const saidOnSam = await watchBadge(sam.page);

      // Every number the pages dial from here on, counted rather than described. The connection
      // each board opened with is already open by the time this is put in place, so what this
      // catches is a second attempt: a reconnect that went unnoticed, or one that was only
      // briefly admitted to. Playwright prints these as their addresses, so an attempt says
      // which room it was for.
      const dialsByAlex: WebSocket[] = [];
      const dialsBySam: WebSocket[] = [];
      alex.page.on('websocket', (socket) => dialsByAlex.push(socket));
      sam.page.on('websocket', (socket) => dialsBySam.push(socket));

      // Longer than the limit, and not much longer: the moment worth looking at is the one just
      // after a client would have given up on a connection nobody had spoken over.
      const quiet = Date.now();
      await alex.page.waitForTimeout(SILENCE_LIMIT_MS + 15_000);

      // Nobody was told anything about the connection, in either direction: the awareness the
      // room keeps relaying was traffic enough for both of them.
      expect(badgeStory(saidOnAlex)).toBe('(hidden)');
      expect(badgeStory(saidOnSam)).toBe('(hidden)');
      // And nobody re-dialled: the connection that was there when the board opened is still the
      // only one there is.
      expect(dialsByAlex).toEqual([]);
      expect(dialsBySam).toEqual([]);
      logScenario(
        `two people doing nothing at all for ${Math.round((Date.now() - quiet) / 100) / 10}s`,
        quiet,
      );

      // A connection that outlived the quiet still carries a change, at the speed changes
      // normally go.
      await measureChange(
        'a note made after half a minute of nothing',
        async () => {
          await makeNote(alex.page, 'after the quiet');
        },
        async () => (await faces(sam.page)).some((face) => face.text === 'after the quiet'),
      );
      await waitForSameBoard(cast.people);
      expect(alex.problems).toEqual([]);
      expect(sam.problems).toEqual([]);
    } finally {
      await cast.close();
    }
  });

  test('TC-30: everyone editing continuously for a minute, with every change arriving everywhere', {
    tag: '@nightly',
  }, async ({ browser }) => {
    // A minute of continuous editing by a full room is a minute at least, plus the time it takes
    // five browsers to arrive and to be checked afterwards.
    test.setTimeout(300_000);
    const SOAK_MS = 60_000;
    const SOAK_SEED = 20260_103;

    const names = NAMES.slice(0, MAX_CONCURRENT_EDITORS);
    const cast = await Cast.open(browser, ...names);
    try {
      // Nothing in a soak should take ten seconds to click, and a click that waits the full
      // thirty seconds of the default - for a toolbar that is not there, because the note under
      // the pointer was somebody else's - eats the whole test one stall at a time.
      for (const person of cast.people) {
        person.page.setDefaultTimeout(10_000);
      }
      /**
       * Every note this soak made, and what became of it. An assertion that counts notes can
       * only say how many went missing; an assertion that looks each one up by its own id can
       * say which one, and can say the same about the ones that were deleted - that they went
       * away everywhere. `alive` is what this test asked the browser to do to the note, which is
       * the thing being compared with what the board ended up showing.
       */
      const known: { label: string; id: string; owner: string; alive: boolean }[] = [];

      // Everybody gets a patch of the board and one note in it before the clock starts. After
      // this, a click can only ever land on a note belonging to the person holding the mouse,
      // which is what makes five people editing at the same time readable as a test: whose note
      // changed is never in doubt, only whether the change arrived.
      await Promise.all(
        cast.people.map(async (person, index) => {
          await moveApart(person.page, index);
          const owner = person.name.toLowerCase();
          const id = await makeNote(person.page, `${owner}-0`);
          known.push({ label: `${owner}-0`, id, owner, alive: true });
          await fanToSlot(person.page, id, 0);
        }),
      );
      // One board in front of everybody before the clock starts, so the first round is not
      // racing the warm-up.
      await waitForSameBoard(cast.people);

      const random = seeded(SOAK_SEED);
      const durations: number[] = [];
      /** Notes each person has made beyond their first, which is also what the next is called. */
      const made = names.map(() => 0);
      // What the room actually managed to do, as opposed to what the rounds rolled for: a round
      // whose toolbar was lying under another note did nothing, and a soak that could not say the
      // difference could pass by doing almost nothing at all.
      let recolours = 0;
      let deletions = 0;
      let edits = 0;
      const started = Date.now();
      let rounds = 0;

      while (Date.now() - started < SOAK_MS) {
        rounds += 1;
        const round = Date.now();
        await Promise.all(
          cast.people.map(async (person, index) => {
            // Lowercased, exactly the way the notes were labelled in the warm-up: this is how a
            // person's own notes are picked out of a board everybody is looking at.
            const name = person.name.toLowerCase();
            const own = known.filter((note) => note.owner === name && note.alive);
            const chosen = own[Math.floor(random() * own.length)]!;
            const roll = random();
            if (roll < 0.25 && own.length < PATCH_SLOTS) {
              // A new note, put in a slot straight away: left where it was made - the middle of
              // the view - it would sit on top of the note already there, and the next click this
              // person makes would pick up the wrong one. A patch holding PATCH_SLOTS notes is as
              // full as this test dares to make it, so past that the round does something else.
              made[index]! += 1;
              const label = `${name}-${made[index]}`;
              const id = await makeNote(person.page, label);
              known.push({ label, id, owner: name, alive: true });
              await fanToSlot(person.page, id, Math.floor(random() * PATCH_SLOTS));
            } else if (roll < 0.5) {
              // Moved into a slot. The slots are where notes are kept on the screen and clear of
              // the fixed toolbar, so that a minute of dragging cannot walk a note to somewhere
              // this test has no way left to click.
              const centre = await centreByIdOnScreen(person.page, chosen.id);
              await dragPointer(person.page, centre, slotPoint(Math.floor(random() * PATCH_SLOTS)));
            } else if (roll < 0.65) {
              // Recoloured, from the toolbar of the note this person is now holding.
              const centre = await centreByIdOnScreen(person.page, chosen.id);
              await person.page.mouse.click(centre.x, centre.y);
              // Whatever is on top at that point is the note that got selected, and on a patch
              // that has been pushed around for a minute that is not always the one this round
              // chose. A round that does nothing is allowed by the totals below, and is honest;
              // recolouring a note nobody chose would be neither.
              if (!(await stateById(person.page, chosen.id)).selected) {
                return;
              }
              const swatch = colourSwatchIn(
                person.page,
                chosen.id,
                COLOURS[Math.floor(random() * COLOURS.length)]!,
              );
              if (!(await isClickable(swatch))) {
                // A swatch belonging to a note that is lying under another one: this round does
                // nothing, and says so in the totals, which count what was done and not what was
                // attempted.
                return;
              }
              await swatch.click();
              recolours += 1;
            } else if (roll < 0.8) {
              // More text on it, from the editor of the note this person is now holding.
              const centre = await centreByIdOnScreen(person.page, chosen.id);
              await person.page.mouse.dblclick(centre.x, centre.y);
              // The same allowance as for the colour above: this double click opened the editor
              // of whichever note was on top, and if that was not the chosen one, nothing happens
              // - and the editor that did open is closed on the way out, because an editor left
              // open on this page is a button click that goes nowhere in the round after this.
              if ((await editingNoteIdOrNull(person.page)) !== chosen.id) {
                await person.page.keyboard.press('Escape');
                return;
              }
              await person.page.keyboard.type(' x');
              await person.page.keyboard.press('Escape');
              edits += 1;
            } else if (own.length > 1) {
              // Deleted: a change going the other way, and one that has to arrive everywhere too.
              // One note per person is kept, so that there is always something of theirs on the
              // board to pick up - and always a note this round could have chosen.
              const centre = await centreByIdOnScreen(person.page, chosen.id);
              await person.page.mouse.click(centre.x, centre.y);
              if (!(await stateById(person.page, chosen.id)).selected) {
                return;
              }
              const remove = deleteNoteButtonIn(person.page, chosen.id);
              if (!(await isClickable(remove))) {
                return;
              }
              await remove.click();
              chosen.alive = false;
              deletions += 1;
            }
          }),
        );

        // How long the rest of the room took to be shown all of this. The clock runs from the
        // moment the round's hands started moving, because that is the moment a person waiting
        // for a change is waiting from - and here five browsers are doing mouse work on one
        // machine at once, which is why the number is printed rather than asserted.
        await waitForSameBoard(cast.people);
        durations.push(Date.now() - round);
      }

      // The board every person is looking at, once the editing stops, is one board: the wait
      // above is the proof, because a change that had been lost on the way would have left two
      // people disagreeing about it forever.
      const settled = JSON.parse(await waitForSameBoard(cast.people)) as Face[];
      const present = new Set(settled.map((face) => face.id));
      // Every note this soak believes it made is a different note: a label reused between two
      // entries here would make the totals below wrong, and would be the soak's own bug rather
      // than the board's.
      expect(new Set(known.map((note) => note.id)).size).toBe(known.length);
      for (const note of known) {
        // One assertion in both directions: a note that was made and left alone is on the board
        // everybody agrees on, and a note that was deleted is not. `soft` because a soak that
        // lost three notes should say all three, not the first one it came across.
        expect
          .soft(present.has(note.id), `${note.label} should be on the board: ${note.alive}`)
          .toBe(note.alive);
      }
      // The board holds exactly the notes that were made and not thrown away - and `known`
      // includes the one each person was given before the clock started, because that was made by
      // this test too.
      expect(settled).toHaveLength(known.filter((note) => note.alive).length);
      for (const person of cast.people) {
        expect(person.problems, `${person.name} saw no complaints in the console`).toEqual([]);
      }

      const sorted = [...durations].sort((a, b) => a - b);
      const deleted = known.filter((note) => !note.alive).length;
      console.log(
        `[soak] ${rounds} rounds of editing by ${names.length} people in ` +
          `${Math.round((Date.now() - started) / 100) / 10}s (${recolours} recolours, ${edits} ` +
          `edits, ${deletions} deletions): ${known.length} notes made, ` +
          `${deleted} deleted, ${settled.length} left on the board; from a round of hands to the ` +
          `whole room agreeing: p50 ${percentile(sorted, 0.5)}ms, p95 ${percentile(sorted, 0.95)}ms, ` +
          `max ${percentile(sorted, 1)}ms. The budget for one change is ` +
          `${LIVE_UPDATE_LATENCY_BUDGET_MS}ms, printed and not asserted: ${names.length} browsers ` +
          `are sharing one machine here`,
      );
      // Proof that the minute was spent editing: every kind of change happened more than once, so
      // the soak cannot pass by clicking itself into a corner where only drags are possible.
      expect(rounds).toBeGreaterThan(10);
      expect(recolours).toBeGreaterThan(5);
      expect(edits).toBeGreaterThan(5);
      expect(deletions).toBeGreaterThan(5);
    } finally {
      await cast.close();
    }
  });
});
