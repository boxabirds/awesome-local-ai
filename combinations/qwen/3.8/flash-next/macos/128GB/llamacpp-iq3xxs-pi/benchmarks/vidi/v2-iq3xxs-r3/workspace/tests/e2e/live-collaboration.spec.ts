/**
 * TC-22 to TC-28 (story 3: live.propagate, live.merge, live.conflicts,
 * live.delete_wins, live.selection_local, live.status, live.catch_up) — two or
 * more real browser contexts on one board, served by `wrangler dev`, so the
 * whole path is real: browser, Yjs, websocket, Durable Object.
 *
 * Participants are separate browser *contexts*, never two tabs of one: two tabs
 * of the same browser could sync through the BroadcastChannel that the provider
 * has switched off, and the test would pass with a broken server. A change is
 * awaited functionally (up to E2E_EVENTUAL_TIMEOUT_MS) and its wall-clock time
 * is written to the log next to LIVE_UPDATE_LATENCY_BUDGET_MS — measured, never
 * asserted, because model, browsers and server share this one machine.
 */
import { expect, test, type Page } from '@playwright/test';

import { createBoard } from './helpers/share';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  CONNECTED_CONFIRMATION_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';
import { expectPoints, type Point } from './helpers/board';
import { noteTexts, readNotes } from './helpers/notes';
import {
  type NoteView,
  type Participant,
  badge,
  badgeLog,
  centreOf,
  changeVisible,
  createNote,
  dragNoteTo,
  everyPageSees,
  everyoneSeesNoteInPlace,
  expectEveryPageSees,
  notesOf,
  openBoard,
  sameView,
  selectNote,
  selectionOf,
  slot,
  startTyping,
  stopEditing,
  watchBadge,
  zoomOut,
} from './helpers/live';

const FIRST_NOTE = { x: 500, y: 300 };
const NOTES_PER_PERSON = 5;

test('TC-22 every kind of change reaches the other person (latency logged, not asserted)', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId, 'Alex');
  const sam = await openBoard(browser, boardId, 'Sam');
  const pages = [alex.page, sam.page];

  let id = '';
  await changeVisible(
    'create',
    async () => {
      id = await createNote(alex.page, FIRST_NOTE);
    },
    sameView(pages),
  );
  await expectEveryPageSees(pages, 1, 'Alex created a note');
  const [created] = await notesOf(alex.page);
  await expectNoteOn(sam.page, 0, { x: created?.x, y: created?.y, color: created?.color });

  await changeVisible('move', () => dragNoteTo(alex.page, id, { x: 300, y: 480 }), sameView(pages));
  await expectEveryPageSees(pages, 1, 'Alex moved the note');
  const [alexMove] = await notesOf(alex.page);
  await expectNoteOn(sam.page, 0, { x: alexMove?.x, y: alexMove?.y });

  await changeVisible(
    'recolour',
    async () => {
      await selectNote(alex.page, id);
      await alex.page.getByTestId('swatch-violet').click();
    },
    sameView(pages),
  );
  await expectEveryPageSees(pages, 1, 'Alex recoloured the note');
  await expect(sam.page.locator(`.sticky-note[data-note-id="${id}"]`)).toHaveAttribute('data-color', 'violet');

  await changeVisible(
    'text',
    async () => {
      await startTyping(alex.page, id);
      await alex.page.keyboard.type('harbour', { delay: 20 });
      await stopEditing(alex.page);
    },
    sameView(pages),
  );
  await expectEveryPageSees(pages, 1, 'Alex typed into the note');
  expect((await noteTexts(sam.page)).join('')).toBe('harbour');

  await changeVisible(
    'delete',
    async () => {
      await selectNote(alex.page, id);
      await alex.page.keyboard.press('Delete');
    },
    async () => (await readNotes(sam.page)).length === 0,
  );
  await expectEveryPageSees(pages, 0, 'Alex deleted the note');
  expect([...alex.problems, ...sam.problems]).toEqual([]);

  await Promise.all([alex.context.close(), sam.context.close()]);
});

/**
 * `expectNote` from the shared helpers reads raw data attributes; here the
 * expectation comes from the other screen, so it is compared with rounding.
 */
async function expectNoteOn(
  page: Page,
  index: number,
  expected: { x?: number | undefined; y?: number | undefined; color?: string | undefined },
): Promise<void> {
  await expect
    .poll(
      async () => {
        const note = (await notesOf(page))[index];
        if (!note) return 'the note is missing';
        if (expected.color !== undefined && note.color !== expected.color) return `color=${note.color}`;
        if (expected.x !== undefined && Math.abs(note.x - expected.x) > 0.5) return `x=${note.x}`;
        if (expected.y !== undefined && Math.abs(note.y - expected.y) > 0.5) return `y=${note.y}`;
        return 'ok';
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe('ok');
}

test('TC-23 both people type in the same note at once and every character survives', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId, 'Alex');
  const sam = await openBoard(browser, boardId, 'Sam');
  const pages = [alex.page, sam.page];

  const id = await createNote(alex.page, FIRST_NOTE);
  await startTyping(alex.page, id);
  await alex.page.keyboard.type('green', { delay: 20 });
  await stopEditing(alex.page);
  await expectEveryPageSees(pages, 1, 'the note is on both screens');

  // Both into edit mode first: the typing below has to overlap, not queue up.
  await startTyping(alex.page, id, 'start');
  await startTyping(sam.page, id, 'end');
  const started = Date.now();
  await Promise.all([
    alex.page.keyboard.type('red ', { delay: 30 }),
    sam.page.keyboard.type(' blue', { delay: 30 }),
  ]);
  await stopEditing(alex.page);
  await stopEditing(sam.page);
  await expect
    .poll(sameView(pages), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(true);
  console.log(`[e2e] simultaneous typing merged after ${Date.now() - started}ms (not asserted)`);

  await expectEveryPageSees(pages, 1, 'both screens hold one note with one text');
  const [alexTexts, samTexts] = [await noteTexts(alex.page), await noteTexts(sam.page)];
  const merged = alexTexts.join('');
  console.log(`[e2e] merged text: alex=${JSON.stringify(alexTexts)} sam=${JSON.stringify(samTexts)}`);
  // The PRD is careful here: both additions have to survive, in a sensible
  // order, but *which* interleaving wins is not specified - and where a remote
  // insertion lands next to a live caret is a story 2 detail, not a story 3
  // one. So: no character lost, no character invented, each person's word still
  // readable in order, and one answer rather than two. (Merged text: logged.)
  expect(merged.length).toBe('red green blue'.length);
  expect(sortedChars(merged)).toBe(sortedChars('red green blue'));
  expect(subsequence('green', merged)).toBe(true);
  expect(subsequence('red', merged)).toBe(true);
  expect(subsequence('blue', merged)).toBe(true);
  expect(samTexts).toEqual(alexTexts);
  console.log(`[e2e] merged text on both screens: ${JSON.stringify(merged)}`);

  await Promise.all([alex.context.close(), sam.context.close()]);
});

/** Every character, sorted: "nothing lost and nothing invented". */
function sortedChars(text: string): string {
  return [...text].sort().join('');
}

/** Are these characters still in this order somewhere in there? */
function subsequence(needle: string, haystack: string): boolean {
  let at = 0;
  for (const character of haystack) {
    if (character === needle[at]) at += 1;
  }
  return at === needle.length;
}

test('TC-24 both people drag the same note elsewhere and end up in the same place', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId, 'Alex');
  const sam = await openBoard(browser, boardId, 'Sam');
  const pages = [alex.page, sam.page];

  const id = await createNote(alex.page, FIRST_NOTE);
  await expectEveryPageSees(pages, 1, 'the note is on both screens');

  const left = { x: 260, y: 220 };
  const right = { x: 820, y: 520 };
  const started = Date.now();
  await Promise.all([dragNoteTo(alex.page, id, left), dragNoteTo(sam.page, id, right)]);
  // One position for two screens: it may be either person's turn, but both
  // screens have to end with the same one.
  await expect.poll(sameView(pages), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
  console.log(`[e2e] concurrent drag: screens agree after ${Date.now() - started}ms (not asserted)`);

  // Positions are board coordinates in the view, screen coordinates here: both
  // cameras are where the app started them, so the note can be compared in the
  // place a person actually sees it.
  const alexCentre = await centreOf(alex.page, id);
  const samCentre = await centreOf(sam.page, id);
  await expectPoints(alexCentre, samCentre, 2);
  const near = (point: Point, target: Point): boolean => Math.abs(point.x - target.x) < 4 && Math.abs(point.y - target.y) < 4;
  expect([near(alexCentre, left), near(alexCentre, right)].some(Boolean)).toBe(true);

  await Promise.all([alex.context.close(), sam.context.close()]);
});

test('TC-25 a note deleted while its editor is open simply goes away', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId, 'Alex');
  const sam = await openBoard(browser, boardId, 'Sam');

  const id = await createNote(alex.page, FIRST_NOTE);
  await expectEveryPageSees([alex.page, sam.page], 1, 'the note is on both screens');

  // Sam is inside the note, typing.
  await startTyping(sam.page, id);
  await sam.page.keyboard.type('but I was', { delay: 20 });
  await expect(sam.page.getByTestId('sticky-textarea')).toBeVisible();

  // Alex deletes it from the other context.
  await selectNote(alex.page, id);
  await alex.page.keyboard.press('Delete');

  // Sam: no note, no editor, and nothing asked of Sam. The board stays usable.
  await expect
    .poll(async () => (await readNotes(sam.page)).length, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(0);
  await expect(sam.page.getByTestId('sticky-textarea')).toHaveCount(0);
  await expect(sam.page.locator('.sticky-note')).toHaveCount(0);
  expect(sam.problems).toEqual([]);
  expect(alex.problems).toEqual([]);

  const second = await createNote(sam.page, { x: 700, y: 250 });
  await expectEveryPageSees([alex.page, sam.page], 1, 'Sam keeps working after the delete');
  expect((await notesOf(alex.page))[0]?.id).toBe(second);

  await Promise.all([alex.context.close(), sam.context.close()]);
});

test(
  `TC-26 ${MAX_CONCURRENT_EDITORS} people on one board, each creating and moving ${NOTES_PER_PERSON} notes, end with one identical board`,
  async ({ browser, request }) => {
    // 5 contexts, 50 changes, each awaited: the default per-test budget is for
    // a single page.
    test.setTimeout(300_000);
    const boardId = await createBoard(request);
    const people: Participant[] = [];
    for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
      people.push(await openBoard(browser, boardId, `person ${index + 1}`));
    }
    const pages = people.map((person) => person.page);
    // One screen each: at 25 % zoom every note of every person is far enough
    // from every other that a click or a drag can only mean one of them.
    await Promise.all(pages.map((page) => zoomOut(page, 0.25)));

    let created = 0;
    const ids: string[][] = [];
    for (const [column, person] of people.entries()) {
      const own: string[] = [];
      ids.push(own);
      for (let row = 0; row < NOTES_PER_PERSON; row += 1) {
        const point = slot(column, row);
        await changeVisible(
          // The next change is only awaited once every screen - not just the
          // one that made it - shows this many notes, the same ones.
          `person ${column + 1} creates note ${row + 1}`,
          async () => {
            own.push(await createNote(person.page, point));
          },
          async () => (await everyPageSees(pages, created + 1)) === 'identical',
        );
        created += 1;
      }
    }

    for (const [column, person] of people.entries()) {
      for (let index = 0; index < NOTES_PER_PERSON; index += 1) {
        const id = (ids[column] as string[])[index] as string;
        const from = slot(column, index);
        const target = { x: from.x + 40, y: from.y + 40 };
        await changeVisible(
          `person ${column + 1} moves note ${index + 1}`,
          () => dragNoteTo(person.page, id, target),
          everyoneSeesNoteInPlace(person.page, pages, id),
        );
      }
    }
    await expectEveryPageSees(pages, MAX_CONCURRENT_EDITORS * NOTES_PER_PERSON, 'one board, every screen');
    const lists = await Promise.all(pages.map(notesOf));
    const positions = new Set((lists[0] as NoteView[]).map((note) => `${note.x},${note.y}`));
    // That many notes in that many different places: every create and every
    // move of every person arrived, exactly once.
    expect(positions.size).toBe(MAX_CONCURRENT_EDITORS * NOTES_PER_PERSON);

    for (const person of people) await person.context.close();
  },
);

test(
  'TC-27 through a long outage both keep writing, and both end up with all six notes',
  async ({ browser, request }) => {
    // The outage the PRD names is 30 seconds of waiting on purpose.
    test.setTimeout(300_000);
    const boardId = await createBoard(request);
    const alex = await openBoard(browser, boardId, 'Alex');
    const sam = await openBoard(browser, boardId, 'Sam');
    const pages = [alex.page, sam.page];

    // Alex walks away from the network - and the live socket, which an
    // emulation of "offline" leaves standing (see NOTES.md).
    const offlineAt = Date.now();
    await alex.context.setOffline(true);
    await alex.page.evaluate(() => {
      const drop = window.__vidi6?.connectionDrop;
      if (!drop) throw new Error('nothing to drop: window.__vidi6.connectionDrop is missing');
      drop();
    });
    await expect(badge(alex.page), 'Alex notices the outage').toHaveText('Reconnecting…', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });

    // Each writes while they cannot reach each other.
    for (let index = 0; index < 3; index += 1) {
      await createNote(alex.page, { x: 260 + index * 230, y: 220 });
      await createNote(sam.page, { x: 260 + index * 230, y: 520 });
    }
    await expect.poll(async () => (await readNotes(alex.page)).length).toBe(3);
    await expect.poll(async () => (await readNotes(sam.page)).length).toBe(3);

    // The whole outage the PRD describes, no more and no less.
    await alex.page.waitForTimeout(Math.max(0, CATCH_UP_TEST_OUTAGE_MS - (Date.now() - offlineAt)));

    // From here on the badge is watched from inside the page: "Connected" only
    // lasts CONNECTED_CONFIRMATION_MS and is easy to miss from the outside.
    await watchBadge(alex.page);
    const backOnlineAt = Date.now();
    await alex.context.setOffline(false);
    // Reaching the room again is the retry's own job, and its backoff is capped
    // at RECONNECT_MAX_BACKOFF_MS per attempt, so the first wait after an outage
    // allows for a whole one.
    const backOffline = E2E_EVENTUAL_TIMEOUT_MS + RECONNECT_MAX_BACKOFF_MS;

    await expect
      .poll(async () => (await badgeLog(alex.page)).includes('Connected'), {
        timeout: backOffline,
        message: `Alex never showed "Connected" after coming back (badge log: ${JSON.stringify(await badgeLog(alex.page))})`,
      })
      .toBe(true);
    const log = await badgeLog(alex.page);
    const reconnecting = log.indexOf('Reconnecting…');
    const confirmed = log.indexOf('Connected');
    expect(reconnecting).toBeGreaterThanOrEqual(0);
    expect(confirmed).toBeGreaterThan(reconnecting);

    // Catch-up in both directions: three notes from each side, on both screens.
    await expectEveryPageSees(pages, 6, 'both screens show all six notes', backOffline);
    console.log(
      `[e2e] outage ${Math.round((Date.now() - offlineAt) / 1000)}s: the 6 notes of both sides met after ${Date.now() - backOnlineAt}ms (not asserted)`,
    );

    // And the badge is out of the way again within its confirmation window.
    await expect(badge(alex.page)).toHaveCount(0, { timeout: CONNECTED_CONFIRMATION_MS + 5_000 });
    expect(
      alex.problems.filter((problem) => !/websocket/i.test(problem)),
      'Alex kept working through the outage',
    ).toEqual([]);

    await Promise.all([alex.context.close(), sam.context.close()]);
  },
);

test('TC-28 what I select and what I am editing stays on my own screen', async ({ browser, request }) => {
  const boardId = await createBoard(request);
  const alex = await openBoard(browser, boardId, 'Alex');
  const sam = await openBoard(browser, boardId, 'Sam');

  const id = await createNote(alex.page, FIRST_NOTE);
  await expectEveryPageSees([alex.page, sam.page], 1, 'the note is on both screens');

  await startTyping(alex.page, id);
  await alex.page.keyboard.type('my private draft', { delay: 20 });
  await expect(alex.page.locator(`.sticky-note[data-note-id="${id}"]`)).toHaveAttribute('data-selected', 'true');
  await expect(alex.page.getByTestId('sticky-textarea')).toBeVisible();

  // Sam sees the note and its text — but nothing of Alex's interaction with it.
  await expect
    .poll(async () => (await noteTexts(sam.page)).join(''), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe('my private draft');
  expect(await selectionOf(sam.page)).toEqual([]);
  await expect(sam.page.locator('.sticky-note')).toHaveAttribute('data-selected', 'false');
  await expect(sam.page.getByTestId('sticky-textarea')).toHaveCount(0);
  await expect(sam.page.getByTestId('note-toolbar')).toHaveCount(0);
  await expect(sam.page.getByTestId('char-counter')).toHaveCount(0);
  expect(await selectionOf(alex.page)).toEqual([id]); // it really is selected — there

  await stopEditing(alex.page);
  await Promise.all([alex.context.close(), sam.context.close()]);
});
