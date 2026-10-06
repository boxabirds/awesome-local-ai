import { expect } from '@playwright/test';

import { test } from './fixtures.js';
import {
  badge,
  badgeText,
  boardSnapshot,
  closeParticipants,
  connectionState,
  expectNoteCount,
  expectSameBoard,
  measureChange,
  openParticipants,
  person,
  printLatencyReport,
  watchConnections,
  type Participant,
} from './helpers/participants.js';
import {
  createNote,
  docNotes,
  dragNote,
  escapeEditing,
  noteCentre,
  notes,
  typeIntoOpenEditor,
} from './helpers/sticky.js';
import { changeArrived, runRandomOps } from './helpers/random-ui-ops.js';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config.js';

/**
 * The nightly run (tasks 9): the two long checks that are too slow for every
 * commit. Both are collected every time and do nothing unless `VIDI6_NIGHTLY` is
 * set, because between them they hold browsers open for nearly two minutes:
 *
 *     VIDI6_NIGHTLY=1 npm run test:e2e:nightly
 *     VIDI6_NIGHTLY=1 VIDI6_NIGHTLY_SEED=1234 npm run test:e2e:nightly
 *
 * TC-30 runs in chromium only: five browser contexts editing continuously is a
 * load on the machine running the tests, not on the product.
 */

/** Are the long tests wanted? */
const NIGHTLY = process.env.VIDI6_NIGHTLY !== undefined;

/** What the skip says when they are not. */
const SKIP_REASON = '@nightly: set VIDI6_NIGHTLY=1';

/** How long TC-29 leaves the board alone (tasks 9: "no user activity for 45 s"). */
const IDLE_HOLD_MS = 45_000;

/** How often the idle soak looks at the connection. */
const IDLE_SAMPLE_MS = 5_000;

/**
 * How long TC-30 keeps a full house editing (tasks 9: "continuous edits for
 * 60 s"). `VIDI6_NIGHTLY_SOAK_MS` shortens it while somebody is checking the test
 * itself; the nightly run leaves it alone.
 */
const CAPACITY_SOAK_MS = Number(process.env.VIDI6_NIGHTLY_SOAK_MS ?? '60000');

/** The seed the random operations are built from; set it to play a run back. */
const SOAK_SEED = Number(process.env.VIDI6_NIGHTLY_SEED ?? '1');

/**
 * TC-29 — an idle board keeps its document and its connection. Nothing happens
 * for three quarters of a minute. The clients keep their own awareness alive and
 * the room relays it to everyone, so neither socket goes quiet enough to be
 * dropped: the badge must never say "Reconnecting…". At the end the room is asked
 * to relay one more change, which is the real point - the document lived in the
 * room all that time and came back over the same two connections.
 */
test('TC-29: an idle board keeps its document and its connections @nightly', async ({ browser }) => {
  test.skip(!NIGHTLY, SKIP_REASON);
  test.setTimeout(IDLE_HOLD_MS + 180_000);

  const people = await openParticipants(browser, ['Alex', 'Sam']);
  const alex = person(people, 'Alex');
  const sam = person(people, 'Sam');

  // Something on the board before the silence starts.
  await createNote(alex.page);
  await typeIntoOpenEditor(alex.page, 'left behind');
  await escapeEditing(alex.page);
  await expectSameBoard(people);

  // Start counting sockets, and prove the counter works before trusting it:
  // dropping and restoring a connection has to show up as a new socket.
  const sockets = people.map((who) => watchConnections(who));
  await alex.page.evaluate(() => window.__vidi6Connection?.dropConnection());
  await expect(badge(alex.page)).toHaveText('Reconnecting…');
  await alex.page.evaluate(() => window.__vidi6Connection?.restoreConnection());
  await expect
    .poll(() => connectionState(alex.page), { message: 'Alex did not come back' })
    .toBe('connected');
  expect(sockets[0]!.since(), 'the connection counter does not count').toBeGreaterThan(0);
  // From here the counts must not move: every socket after this point is a
  // reconnect, and an idle board does not reconnect.
  const baseline = sockets.map((counter) => counter.since());

  // Hold. Every few seconds, look at both pages.
  const seen: (string | null)[] = [];
  const holdUntil = Date.now() + IDLE_HOLD_MS;
  while (Date.now() < holdUntil) {
    await alex.page.waitForTimeout(IDLE_SAMPLE_MS);
    for (const [index, who] of people.entries()) {
      seen.push(await connectionState(who.page));
      expect(await badgeText(who.page), `${who.name} badge while idle`).not.toBe('Reconnecting…');
      expect(sockets[index]!.since(), `${who.name} reconnected while idle`).toBe(
        baseline[index]!,
      );
    }
  }

  // One state the whole way through, and it was 'connected'.
  expect(seen.every((state) => state === 'connected'), `states seen while idle: ${seen.join(',')}`)
    .toBe(true);
  expect(new Set(seen).size).toBe(1);
  // Nobody had to reconnect: the sockets open when the hold started are still the
  // only ones.
  sockets.forEach((counter, index) => {
    expect(counter.since(), `${people[index]!.name} reconnected while idle`).toBe(baseline[index]!);
  });
  // Both pages still hold the board, note for note.
  await expectNoteCount(alex.page, 1);
  await expectNoteCount(sam.page, 1);

  // And the room still relays: a change made now arrives next door. Silence in
  // both directions cost the document nothing.
  await measureChange(
    'TC-29 a change arrives after the hold',
    async () => {
      const at = await noteCentre(alex.page, 0);
      await dragNote(alex.page, at, { x: at.x + 120, y: at.y + 60 }, 3);
    },
    async () => (await boardSnapshot(alex.page)) === (await boardSnapshot(sam.page)),
  );

  for (const who of people) {
    expect(who.consoleErrors, `${who.name} console errors`).toEqual([]);
    expect(who.dialogs, `${who.name} dialogs`).toEqual([]);
  }
  await closeParticipants(people);
});

/**
 * How long the change this person just made takes to show up on the next page,
 * up to `limitMs`. Only that one note is followed, because with a full house the
 * two boards are never identical at any given instant - which is the point of the
 * soak, and would make a whole-board comparison measure nothing.
 */
async function timeChange(
  actor: Participant,
  witness: Participant,
  noteId: string | null,
  limitMs = 5_000,
): Promise<number> {
  const started = Date.now();
  const mine = await docNotes(actor.page);
  while (Date.now() - started < limitMs) {
    if (changeArrived(await docNotes(witness.page), mine, noteId)) return Date.now() - started;
    await witness.page.waitForTimeout(25);
  }
  return limitMs;
}

/**
 * TC-30 — a capacity soak: `MAX_CONCURRENT_EDITORS` people editing one board
 * continuously for a minute with seeded random operations, and one identical
 * board at the end. Chromium only.
 */
test('TC-30: a full house editing at random ends on one identical board @nightly', async ({
  browser,
}) => {
  test.skip(!NIGHTLY, SKIP_REASON);
  test.skip(
    test.info().project.name !== 'chromium',
    'the nightly capacity soak runs in chromium only',
  );
  test.setTimeout(8 * 60_000);

  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `Editor ${i + 1}`);
  // A board of its own, made by the server the soak runs against, so its timings are
  // nobody else's business. The address is printed because a soak that fails at 03:00 is
  // worth being able to look at again.
  const people = await openParticipants(browser, names);
  console.log(`[soak] board ${people[0]?.page.url() ?? '(no board)'}`);
  console.log(
    `[soak] ${names.length} people for ${CAPACITY_SOAK_MS / 1000}s, seed ${SOAK_SEED} ` +
      `(VIDI6_NIGHTLY_SEED plays it back)`,
  );

  const latencies: number[] = [];
  const tallies = await Promise.all(
    people.map(async (who, index) => {
      const witness = people[(index + 1) % people.length]!;
      const tally = await runRandomOps(
        who.page,
        index,
        SOAK_SEED,
        CAPACITY_SOAK_MS,
        async (_op, noteId) => {
          // Every change is timed on its way to the next page. Waiting for it here
          // paces this person's own typing; the others keep coming regardless, so
          // the room is still under a full load.
          latencies.push(await timeChange(who, witness, noteId));
        },
      );
      console.log(
        `[soak] ${who.name}: ${tally.total} tries -> ${tally.create} created, ` +
          `${tally.type} typed, ${tally.move} moved, ${tally.recolour} recoloured, ` +
          `${tally.delete} deleted, ${tally.skipped} not possible`,
      );
      return tally;
    }),
  );

  const total = tallies.reduce((sum, tally) => sum + tally.total - tally.skipped, 0);
  console.log(`[soak] ${total} changes made by ${tallies.length} people`);
  printLatencyReport('TC-30 change arrival at the next page', latencies);

  // Every change went local-first, so nobody froze: the boards are identical,
  // note for note, in the same order in the DOM.
  await expectSameBoard(people);
  const left = (await docNotes(people[0]!.page)).length;
  console.log(`[soak] ${left} notes on the board at the end`);

  // Nobody was pushed out, nobody was told anything, nothing threw.
  for (const who of people) {
    expect(await connectionState(who.page), `${who.name} state`).toBe('connected');
    expect(who.dialogs, `${who.name} dialogs`).toEqual([]);
    expect(who.consoleErrors, `${who.name} console errors`).toEqual([]);
    expect(await notes(who.page).count(), `${who.name} notes drawn`).toBe(left);
  }

  // Teardown: closing a page hands its room back. The people who stay must not
  // notice - no reconnect, no lost work. (The page that closed cannot be watched
  // from outside; what can be watched is that its going did not disturb anyone.)
  const leaver = people[0]!;
  const stayers = people.slice(1);
  const sockets = stayers.map((who) => watchConnections(who));
  const board = await boardSnapshot(stayers[0]!.page);
  await leaver.context.close();
  await stayers[0]!.page.waitForTimeout(3_000);
  stayers.forEach((who, index) => {
    expect(sockets[index]!.since(), `${who.name} reconnected when somebody left`).toBe(0);
  });
  await expectSameBoard(stayers);
  expect(await boardSnapshot(stayers[0]!.page)).toBe(board);

  // And the board is still there for whoever comes next.
  const newcomer = await browser.newContext();
  const fresh = await newcomer.newPage();
  await fresh.goto(new URL(leaver.page.url()).pathname);
  await expect(fresh.locator('[data-testid="sticky-note"]')).toHaveCount(left, {
    timeout: 15_000,
  });
  await newcomer.close();
  await closeParticipants(stayers);
});
