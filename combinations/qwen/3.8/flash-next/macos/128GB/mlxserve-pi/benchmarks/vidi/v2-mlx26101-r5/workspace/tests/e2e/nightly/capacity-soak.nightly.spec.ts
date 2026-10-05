/**
 * A minute of everybody typing at once.
 *
 * As many people on one board as it is designed for, all of them creating, dragging, typing
 * into, recolouring and deleting notes for a full minute, at the same time, through the real
 * mouse and keyboard. This is where a sync layer that drops things drops them: five browsers,
 * five documents, one room, all writing.
 *
 * What is asserted is that nothing is lost — every note a person made turns up on everybody
 * else's board, and at the end all five browsers hold the same board — and that nothing in any
 * browser complained. The *timing* of arrival is measured and printed, and not asserted, except
 * for the one number the story does promise (a single change reaching another person inside
 * LIVE_UPDATE_LATENCY_BUDGET_MS), which is measured while only one change is in flight: with
 * forty changes a second crossing one machine, wall-clock numbers say more about the machine
 * than about the board.
 *
 * The work is seeded and the seed is printed, so a run that goes wrong can be had again with
 * `VIDI6_SEED=<seed> npm run test:e2e:nightly`.
 *
 * Nightly (see `playwright.config.ts`).
 */

import { expect, test, type Page } from '@playwright/test';

import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../../src/shared/config';
import { doubleClickCreate, noteIds, noteText } from '../helpers/board';
import {
  boardSnapshot,
  closeParticipants,
  connectionStates,
  expectChangeToArrive,
  expectEventually,
  expectNoConsoleErrors,
  expectSameBoard,
  latencyReport,
  latencySamples,
  newBoard,
  openParticipants,
  resetLatencySamples,
  stopEditing,
  writeLatencyReport,
  type Participant,
} from '../helpers/participants';
import { describeSoak, mulberry32, soakCounts, soakOps, soakSeed } from '../helpers/soak';

/** How long everybody keeps working. The story's own number. */
const SOAK_MS = 60_000;

/** Things each person does per round; a round is one go around all the browsers. */
const OPS_PER_ROUND = 3;

/** Names to speak of the people by, one per editor the board is designed for. */
const NAMES = ['Alex', 'Sam', 'Robin', 'Jo', 'Casey'].slice(0, MAX_CONCURRENT_EDITORS);

/** Do all these browsers hold the same board right now? (A question, not an assertion.) */
async function boardsAgree(people: readonly Participant[]): Promise<boolean> {
  const snapshots = await Promise.all(people.map((person) => boardSnapshot(person.page)));
  return snapshots.every((snapshot) => snapshot === snapshots[0]);
}

/** Is this note on this browser? */
function hasNote(page: Page, id: string): Promise<boolean> {
  return noteIds(page).then((ids) => ids.includes(id));
}

test('TC-30 a busy board full of people ends up as one board', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  resetLatencySamples();

  const seed = soakSeed();
  const random = mulberry32(seed);
  const totals = soakCounts();
  console.info(`soak seed ${seed} — VIDI6_SEED=${seed} does this run again`);

  const boardId = newBoard();
  const people = await openParticipants(browser, NAMES, boardId);
  expect(people.length).toBe(MAX_CONCURRENT_EDITORS);

  const started = Date.now();
  let rounds = 0;
  /** Notes made in this round, by whoever made them, so their trip can be timed. */
  const fresh: { id: string; maker: Participant }[] = [];
  while (Date.now() - started < SOAK_MS) {
    rounds += 1;
    fresh.length = 0;
    // All at the same time: one call per browser, none of them waiting on another.
    const madeBy = await Promise.all(
      people.map(async (person) => ({ person, ids: await soakOps(person, OPS_PER_ROUND, random, totals) })),
    );
    for (const { person, ids } of madeBy) {
      for (const id of ids) fresh.push({ id, maker: person });
    }

    // Time the trip of each note made this round. A note that has since been deleted — by the
    // soak itself, on the maker's own screen — has still told us what we asked: the change
    // arrived, and so did its going away.
    for (const { id, maker } of fresh) {
      await expectChangeToArrive(
        people.filter((other) => other !== maker),
        `${maker.name}’s note ${id} on the other screens`,
        (other) =>
          Promise.all([hasNote(other.page, id), hasNote(maker.page, id)]).then(
            ([there, stillMade]) => there || !stillMade,
          ),
      );
    }

    // Then the whole board agrees again.
    await expectEventually(
      people[0] as Participant,
      'every browser holding the same board again',
      () => boardsAgree(people),
      { timeoutMs: 30_000 },
    );
  }
  const soakedFor = Date.now() - started;

  // Nobody left behind: one board, in as many browsers as there are people.
  const snapshot = await expectSameBoard(people, `${NAMES.length} browsers, one board`, 30_000);
  const ids = await noteIds((people[0] as Participant).page);
  expect(ids.length, 'the soak left notes behind to compare').toBeGreaterThan(0);
  for (const person of people) {
    const theirs = await noteIds(person.page);
    expect(theirs.length, `${person.name} has as many notes as anybody`).toBe(ids.length);
    const states = await connectionStates(person.page);
    expect(states[states.length - 1], `${person.name} is in the room`).toBe('connected');
  }
  expect(snapshot.split('|').length).toBe(ids.length);

  // The one promised number, measured on its own: with a board that has settled, one change
  // travels from one person to another inside the budget the story gives it.
  const [alex, sam] = people as [Participant, Participant];
  const probeId = await doubleClickCreate(alex.page, 640, 400);
  await alex.page.keyboard.type('the last one');
  await stopEditing(alex.page);
  const singleChangeIn = await expectChangeToArrive([sam], 'one change, on a settled board', (other) =>
    noteText(other.page, probeId).then((text) => text === 'the last one'),
  );

  expectNoConsoleErrors(people);

  const measured = latencySamples();
  console.info(
    `${rounds} rounds of ${describeSoak(totals)} in ${(soakedFor / 1000).toFixed(1)}s with ${NAMES.length} people; ` +
      `one change on a settled board took ${singleChangeIn}ms; ${latencyReport(measured)}`,
  );
  expect(
    singleChangeIn,
    `a single change arrives inside the ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms budget`,
  ).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);
  await writeLatencyReport(testInfo, 'tc-30-soak');
  await closeParticipants(people);
});
