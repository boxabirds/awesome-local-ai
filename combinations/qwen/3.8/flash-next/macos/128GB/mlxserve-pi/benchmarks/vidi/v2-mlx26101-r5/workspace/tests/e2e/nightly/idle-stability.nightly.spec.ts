/**
 * A board that is left alone stays in the room.
 *
 * Two people open the same board and then do nothing for three quarters of a minute — no
 * typing, no dragging, no scrolling, no reloading. A connection that is only kept alive by
 * traffic dies in exactly this situation: the browser's own idea of a live connection and the
 * room's idea of one both go quiet, and the usual outcome is a line that has been dropped
 * while nobody was looking, discovered the moment somebody types.
 *
 * So this checks two things: that nothing ever claimed to be reconnecting while the board sat
 * still, and that the line was in fact still working afterwards, by making a change and timing
 * it. The first is asked of a record the board keeps of its own states, because a test that
 * glances at the badge once a second is exactly the thing that misses a connection that
 * dropped and came back between two glances.
 *
 * Nightly (see `playwright.config.ts`): too slow to run on every commit for what it checks.
 */

import { expect, test } from '@playwright/test';

import { LIVE_UPDATE_LATENCY_BUDGET_MS, ROOM_RESYNC_INTERVAL_MS } from '../../../src/shared/config';
import { doubleClickCreate, noteText } from '../helpers/board';
import {
  badgeText,
  closeParticipants,
  connectionStates,
  expectChangeToArrive,
  expectNoConsoleErrors,
  expectSameBoard,
  latencyReport,
  latencySamples,
  newBoard,
  openParticipants,
  resetLatencySamples,
  stopEditing,
  writeLatencyReport,
} from '../helpers/participants';

/** How long the board sits doing nothing. The story's own number. */
const IDLE_MS = 45_000;

/** How often to look at the badge while waiting. A look, not a measurement. */
const LOOK_MS = 1_000;

test('TC-29 a board nobody is using stays connected', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  resetLatencySamples();
  const boardId = newBoard();
  const [alex, sam] = await openParticipants(browser, ['Alex', 'Sam'], boardId);
  const people = [alex, sam];

  // Nothing happens. The only thing asked of each browser is what its badge says, which is
  // also the only thing that keeps these pages awake while they wait.
  const idleStarted = Date.now();
  let looks = 0;
  while (Date.now() - idleStarted < IDLE_MS) {
    for (const person of people) {
      const said = await badgeText(person.page);
      expect(
        said,
        `${person.name}’s badge while the board sat still for ${Math.round(IDLE_MS / 1000)}s`,
      ).toBeNull();
    }
    looks += 1;
    await alex.page.waitForTimeout(LOOK_MS);
  }
  const idledFor = Date.now() - idleStarted;

  // What the board says it went through. A healthy idle board was connecting and then was
  // connected, and never had anything to say about the connection in between.
  for (const person of people) {
    const states = await connectionStates(person.page);
    expect(
      states.filter((state) => state === 'reconnecting'),
      `${person.name} never had to reconnect`,
    ).toEqual([]);
    expect(states[states.length - 1], `${person.name} is in the room`).toBe('connected');
  }

  // And the line was still carrying changes, not merely still open: a note made here turns up
  // there, inside the budget the story sets for a change travelling between two people.
  const id = await doubleClickCreate(alex.page, 340, 300);
  const words = 'after sitting still';
  await alex.page.keyboard.type(words);
  await stopEditing(alex.page);
  const arrivedIn = await expectChangeToArrive([sam], 'a change made after the idle period', (other) =>
    noteText(other.page, id).then((text) => text === words),
  );

  await expectSameBoard(people, 'two browsers, one board, after sitting still');
  expectNoConsoleErrors(people);

  const measured = latencySamples();
  console.info(
    `idled for ${(idledFor / 1000).toFixed(1)}s (${looks} looks, a keepalive every ${ROOM_RESYNC_INTERVAL_MS / 1000}s), ` +
      `nothing reconnected, change after it arrived in ${arrivedIn}ms — ${latencyReport(measured)}`,
  );
  expect(
    arrivedIn,
    `a change after the idle period arrives inside the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget`,
  ).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);
  await writeLatencyReport(testInfo, 'tc-29-idle');
  await closeParticipants(people);
});
