/**
 * Two or more people on one board, in real browsers, against the real server path
 * (`wrangler dev` serving the built client and running the room).
 *
 * What this suite can say and the integration tests cannot: a change made in one
 * browser appears in another. Everything below that — the merge, the relay, the
 * backoff — is tested closer to the code, where it can be tested exhaustively and
 * fast. Here the point is the whole path, so the assertions are about what a person
 * would see, read out of the DOM.
 *
 * Latency is measured and printed, never asserted: five browsers, the app, the
 * Worker and the model share one machine here, and a wall-clock number from that is
 * not evidence about a product. Convergence, and only convergence, fails a test.
 *
 * TC-22 every kind of change reaches the other person
 * TC-23 both people typing in one note keep every character
 * TC-24 both people dragging one note settle on one place
 * TC-25 a note deleted while the other person is typing in it goes away cleanly
 * TC-26 the design capacity of people, each making changes, all agreeing afterwards
 * TC-27 a connection that dies and comes back carries everything made in between
 * TC-28 selection and editing stay on the screen they happened on
 */
import { expect, test, type Browser } from '@playwright/test';

import { CATCH_UP_TEST_OUTAGE_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

import {
  characterCounts,
  EVENTUALLY,
  focusWorld,
  logLatencyReport,
  noteWorld,
  openBoard,
  placeNote,
  waitForChange,
  waitForIdenticalBoards,
  withoutSelection,
  type BoardSession,
} from './helpers/participants';

/** Open a board, hand it to the test, close every context whatever the test did. */
async function withBoard(
  browser: Browser,
  count: number,
  run: (session: BoardSession) => Promise<void>,
): Promise<void> {
  const session = await openBoard(browser, count);
  try {
    await run(session);
  } finally {
    await session.close();
  }
}

test.describe('workflow 1: two-person workshop', () => {
  test('TC-22 every change one person makes appears on the other screen', async ({ browser }) => {
    await withBoard(browser, 2, async (session) => {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');
      const world = noteWorld(0, 0);

      // Create, with text.
      const id = await placeNote(alex, world);
      await alex.editNote(id, 'retro');
      await alex.stopEditing();
      await waitForChange('TC-22 create + text reaches Sam', async () => {
        const note = await sam.note(id);
        return note?.text === 'retro';
      });

      // Move.
      await focusWorld(alex.page, world);
      await alex.dragNote(id, { x: 150, y: 80 });
      await waitForChange('TC-22 move reaches Sam', async () => {
        const [mine, theirs] = await Promise.all([alex.note(id), sam.note(id)]);
        return !!mine && !!theirs && mine.x === theirs.x && mine.y === theirs.y && mine.x !== world.x;
      });

      // Recolour.
      await alex.selectNote(id);
      await alex.recolour('Blue');
      await waitForChange('TC-22 recolour reaches Sam', async () => (await sam.note(id))?.color === 'blue');

      // More text, in a note that already exists on both screens.
      await alex.editNote(id, ' and actions');
      await alex.stopEditing();
      await waitForChange('TC-22 later typing reaches Sam', async () => {
        const note = await sam.note(id);
        return note !== undefined && note.text.includes('actions');
      });

      // Delete.
      await alex.selectNote(id);
      await alex.deleteSelectedNote();
      await waitForChange('TC-22 delete reaches Sam', async () => (await sam.note(id)) === undefined);
      await waitForIdenticalBoards('TC-22 both boards empty', [alex, sam]);

      logLatencyReport('TC-22 two-person workshop');
      expect([...alex.errors(), ...sam.errors()], 'nothing went wrong on either screen').toEqual([]);
    });
  });

  test('TC-23 both people typing in one note keep every character', async ({ browser }) => {
    await withBoard(browser, 2, async (session) => {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');
      const world = noteWorld(0, 0);
      const id = await placeNote(alex, world);
      await waitForChange('TC-23 note exists for Sam', async () => (await sam.note(id)) !== undefined);

      // Both open the note, then type at the same moment.
      await alex.selectNote(id);
      await sam.selectNote(id);
      await Promise.all([
        alex.page.keyboard.press('Enter'),
        sam.page.keyboard.press('Enter'),
      ]);
      await Promise.all([alex.type('alpha'), sam.type('beta')]);

      // The two screens must end up identical, and must hold exactly the nine
      // characters that were typed — however they interleaved, nothing was dropped
      // and nothing was invented.
      await waitForChange('TC-23 both screens hold the same text', async () => {
        const [mine, theirs] = await Promise.all([alex.note(id), sam.note(id)]);
        return !!mine && !!theirs && mine.text === theirs.text;
      });
      const final = (await alex.note(id))?.text ?? '';
      expect(characterCounts(final)).toEqual(characterCounts('alphabeta'));
      expect(final).toHaveLength('alpha'.length + 'beta'.length);

      await alex.stopEditing();
      await sam.stopEditing();
      logLatencyReport('TC-23 concurrent typing');
      expect([...alex.errors(), ...sam.errors()]).toEqual([]);
    });
  });

  test('TC-24 both people dragging one note settle on one place', async ({ browser }) => {
    await withBoard(browser, 2, async (session) => {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');
      const world = noteWorld(0, 0);
      const id = await placeNote(alex, world);
      await waitForChange('TC-24 note exists for Sam', async () => (await sam.note(id)) !== undefined);

      const started = Date.now();
      await Promise.all([
        alex.dragNote(id, { x: 160, y: 60 }),
        sam.dragNote(id, { x: -140, y: -90 }),
      ]);
      await waitForChange('TC-24 both screens agree where the note is', async () => {
        const [mine, theirs] = await Promise.all([alex.note(id), sam.note(id)]);
        return !!mine && !!theirs && mine.x === theirs.x && mine.y === theirs.y;
      });
      const settled = Date.now() - started;
      console.log(`[latency] TC-24 drag conflict settled after ${String(settled)} ms (reported, not asserted)`);

      await waitForIdenticalBoards('TC-24 whole boards identical after the drag', [alex, sam]);
      logLatencyReport('TC-24 concurrent drag');
      expect([...alex.errors(), ...sam.errors()]).toEqual([]);
    });
  });

  test('TC-25 a note deleted while the other person is typing in it goes away cleanly', async ({
    browser,
  }) => {
    await withBoard(browser, 2, async (session) => {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');
      const world = noteWorld(0, 0);
      const id = await placeNote(alex, world);
      await waitForChange('TC-25 note exists for Sam', async () => (await sam.note(id)) !== undefined);

      // Sam is mid-sentence in the note.
      await sam.editNote(id, 'half a ');
      expect(await sam.editing()).toBe(true);

      // Alex deletes it.
      await alex.selectNote(id);
      await alex.deleteSelectedNote();

      await waitForChange('TC-25 the note disappears from Sam too', async () => {
        return (await sam.note(id)) === undefined && !(await sam.editing());
      });

      // Nothing is left of it on Sam's screen: no note, no editor, no stranded
      // toolbar, and no complaint in the console.
      expect(await sam.note(id)).toBeUndefined();
      expect(await sam.editing()).toBe(false);
      await expect(sam.page.locator('[data-testid="note-toolbar"]')).toHaveCount(0);
      await waitForIdenticalBoards('TC-25 both boards empty after the delete', [alex, sam]);
      expect(
        [...alex.errors(), ...sam.errors()],
        'a note vanishing under a person is not an error to report',
      ).toEqual([]);
      logLatencyReport('TC-25 delete during edit');
    });
  });

  test('TC-28 selection and editing stay on the screen they happened on', async ({ browser }) => {
    await withBoard(browser, 2, async (session) => {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');
      const world = noteWorld(0, 0);
      const id = await placeNote(alex, world);
      await waitForChange('TC-28 note exists for Sam', async () => (await sam.note(id)) !== undefined);

      await alex.editNote(id, 'mine alone');
      await expect
        .poll(() => alex.note(id).then((note) => note?.selected ?? false), EVENTUALLY)
        .toBe(true);
      expect(await alex.editing()).toBe(true);

      // Sam's screen shows the note, and nothing about what Alex is doing to it.
      const given = Date.now();
      await expect
        .poll(
          async () => {
          const notes = await sam.board();
          const note = notes.find((candidate) => candidate.id === id);
          const editing = await sam.editing();
            return note !== undefined && note.selected === false && !editing;
          },
          EVENTUALLY,
        )
        .toBe(true);
      console.log(`[latency] TC-28 Sam saw the note ${String(Date.now() - given)} ms after Alex opened it`);
      expect(await sam.editing()).toBe(false);
      expect((await sam.board()).some((note) => note.selected)).toBe(false);
      // The text does travel; the caret does not.
      await waitForChange('TC-28 text still syncs while selection does not', async () => {
        const note = await sam.note(id);
        return note !== undefined && note.text.includes('mine alone');
      });
      await alex.stopEditing();
      expect([...alex.errors(), ...sam.errors()]).toEqual([]);
    });
  });
});

test.describe('workflow 2: full-capacity session', () => {
  test(`TC-26 ${MAX_CONCURRENT_EDITORS} people, each making changes, all agreeing afterwards`, async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    await withBoard(browser, MAX_CONCURRENT_EDITORS, async (session) => {
      const notesPerPerson = 5;
      const people = session.participants;

      // Each person makes their own notes in their own part of the board, so a click
      // on one of them can only ever be a click on that one.
      const created = new Map<string, string[]>();
      for (const [index, person] of people.entries()) {
        const ids: string[] = [];
        for (let note = 0; note < notesPerPerson; note += 1) {
          ids.push(await placeNote(person, noteWorld(index, note)));
        }
        created.set(person.name, ids);
      }

      // Every note is on every screen.
      for (const person of people) {
        await waitForChange(`TC-26 ${person.name} sees all the notes`, async () => {
          const ids = new Set(await person.noteIds());
          return ids.size === people.length * notesPerPerson;
        });
      }

      // Each person moves their own notes; every other person has to see each move.
      for (const [index, person] of people.entries()) {
        const ids = created.get(person.name) ?? [];
        for (const [note, id] of ids.entries()) {
          await focusWorld(person.page, noteWorld(index, note));
          await person.dragNote(id, { x: 40 + note * 6, y: -30 - note * 4 });
          for (const watcher of people.filter((candidate) => candidate !== person)) {
            await waitForChange(
              `TC-26 ${watcher.name} sees ${person.name}'s move of note ${String(note)}`,
              async () => {
                const [mine, theirs] = await Promise.all([person.note(id), watcher.note(id)]);
                return !!mine && !!theirs && mine.x === theirs.x && mine.y === theirs.y;
              },
            );
          }
        }
      }

      // And the end state is the same board on every screen.
      await waitForIdenticalBoards('TC-26 every screen holds the same board', people);
      const reference = withoutSelection(await people[0]!.board());
      for (const person of people) {
        expect(withoutSelection(await person.board()), `${person.name} diverged`).toEqual(reference);
      }
      expect(reference).toHaveLength(people.length * notesPerPerson);

      logLatencyReport('TC-26 full-capacity session');
      const complaints = people.flatMap((person) => person.errors());
      expect(complaints, 'nothing went wrong on any screen').toEqual([]);
    });
  });
});

test.describe('workflow 3: flaky Wi-Fi', () => {
  test('TC-27 a connection that dies and comes back carries everything made in between', async ({
    browser,
  }) => {
    // The outage itself lasts CATCH_UP_TEST_OUTAGE_MS, by design: it is the length the
    // story says a person may be cut off for and still catch up.
    test.setTimeout(180_000);
    await withBoard(browser, 2, async (session) => {
      const alex = session.byName('Alex');
      const sam = session.byName('Sam');

      await alex.goOffline();
      await expect
        .poll(() => alex.badge(), { ...EVENTUALLY, message: 'Alex never saw the Reconnecting badge' })
        .toContain('Reconnecting');
      expect(await alex.connectionState()).toBe('reconnecting');

      // Both keep working. Alex cannot reach anybody; Sam cannot reach Alex.
      const alexIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        alexIds.push(await placeNote(alex, noteWorld(0, index)));
      }
      const samIds: string[] = [];
      for (let index = 0; index < 3; index += 1) {
        samIds.push(await placeNote(sam, noteWorld(1, index)));
      }
      expect(await alex.noteIds()).toHaveLength(3);
      expect(await sam.noteIds()).toHaveLength(3);

      // The outage the story names, in full.
      await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS);

      await alex.goOnline();
      await expect
        .poll(() => alex.badge(), { ...EVENTUALLY, message: 'Alex never got the Connected confirmation' })
        .toContain('Connected');
      await expect.poll(() => alex.connectionState(), EVENTUALLY).toBe('confirmed');

      await waitForChange('TC-27 Alex catches up with Sam', async () => (await alex.noteIds()).length === 6);
      await waitForChange('TC-27 Sam catches up with Alex', async () => (await sam.noteIds()).length === 6);
      const alexIdsAfter = await alex.noteIds();
      for (const id of [...alexIds, ...samIds]) {
        expect(alexIdsAfter, `the note made during the outage is missing: ${id}`).toContain(id);
      }
      await waitForIdenticalBoards('TC-27 both boards hold all six notes', [alex, sam]);

      // The badge stands out of the way again once its moment has passed.
      await expect
        .poll(() => alex.badge(), { ...EVENTUALLY, message: 'the confirmation badge did not hide itself' })
        .toBeNull();

      // And the board is live, not a stale copy: a new change goes both ways.
      const fresh = await sam.createNote({ x: 640, y: 640 });
      await waitForChange(
        'TC-27 live again after the outage',
        async () => (await alex.note(fresh)) !== undefined,
      );
      logLatencyReport('TC-27 outage and catch-up');
    });
  });
});
