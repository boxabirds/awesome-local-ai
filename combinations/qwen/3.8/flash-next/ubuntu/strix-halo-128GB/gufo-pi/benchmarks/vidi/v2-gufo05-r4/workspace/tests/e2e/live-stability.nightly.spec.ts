/**
 * Nightly: the two things worth checking that are far too slow for every commit.
 *
 * TC-29 sits on two idle boards for three quarters of a minute and looks for a
 * connection that quietly gives up — a sync client can stay open and still stop
 * listening, and nothing shorter than the reconnect schedule would catch it. TC-30
 * puts `MAX_CONCURRENT_EDITORS` people at one board and lets them edit for a
 * minute, asserting that every change reaches everybody else and that the boards end
 * up identical, while measuring how long propagation took.
 *
 * Run them with `npm run test:e2e:nightly`. They are a Playwright project of their
 * own and carry the `@nightly` tag, so an ordinary `npm run test:e2e` — which runs
 * every project in the config — never waits for them. The soak prints its
 * seed and its latency numbers: the seed replays a failure, and the numbers are the
 * report the design asks for — a change that arrives slower than the budget is a
 * line in that report, not a red test, because this machine runs the browsers, the
 * model and the server at once.
 */

import { expect, test, type Browser } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  NIGHTLY_CAPACITY_SOAK_MS,
  NIGHTLY_IDLE_STABILITY_MS,
  RECONNECT_MAX_BACKOFF_MS
} from '../../src/shared/config';
import { doubleClickBoard, setCamera } from './helpers/board';
import { boardOf, closeSessions, connectionOf, openSession, type Session } from './helpers/participants';
import {
  randomEdit,
  reportSoak,
  startConnectionWatch,
  stopConnectionWatch,
  waitForEveryone,
  type ConnectionReading,
  type SoakOp
} from './helpers/soak';
import { createRandom, randomSeed } from '../helpers/random';

/** Sessions opened by the running test, so nothing leaks when one fails. */
const sessions: Session[] = [];

test.afterEach(async () => {
  await closeSessions(sessions);
});

async function withPeople(browser: Browser, ...names: string[]): Promise<Session> {
  const session = await openSession(browser, names);
  sessions.push(session);
  return session;
}

test('TC-29: two idle boards stay connected and say nothing', { tag: '@nightly' }, async ({ browser }) => {
  test.setTimeout(NIGHTLY_IDLE_STABILITY_MS + 120_000);
  const session = await withPeople(browser, 'alex', 'sam');

  // Sampled inside each page, so a momentary slip cannot happen between reads.
  await startConnectionWatch(session.person('alex').page);
  await startConnectionWatch(session.person('sam').page);

  await session.person('alex').page.waitForTimeout(NIGHTLY_IDLE_STABILITY_MS);

  const seen: { who: string; reading: ConnectionReading }[] = [];
  for (const name of ['alex', 'sam']) {
    for (const reading of await stopConnectionWatch(session.person(name).page)) {
      seen.push({ who: name, reading });
    }
  }
  // A reading every quarter second, for the whole idle period.
  expect(seen.length).toBeGreaterThan(NIGHTLY_IDLE_STABILITY_MS / 500);
  for (const { who, reading } of seen) {
    expect(reading.state, `${who}'s connection was ${reading.state} at +${reading.at}ms`).toBe(
      'connected'
    );
    expect(reading.badge, `${who}'s badge said ${JSON.stringify(reading.badge)} at +${reading.at}ms`).toBeNull();
  }

  // An idle connection is not a dead one: the next change still travels.
  const alex = session.person('alex').page;
  await doubleClickBoard(alex, 500, 350);
  await alex.keyboard.type('still here');
  await alex.mouse.click(140, 700);
  const sam = session.person('sam').page;
  await expect
    .poll(async () => (await boardOf(sam)).length, { message: 'the note should reach Sam' })
    .toBe(1);

  for (const person of session.people) expect(person.errors).toEqual([]);
});

test('TC-30: at capacity, every change reaches everybody else', { tag: '@nightly' }, async ({ browser }) => {
  test.setTimeout(NIGHTLY_CAPACITY_SOAK_MS + 240_000);
  const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_unused, index) => `editor${index}`);
  const session = await withPeople(browser, ...names);

  // Each editor works in their own part of the board, at zoom 1, so that a screen
  // point means the same world distance for everyone and a double-click never lands
  // on somebody else's note.
  await Promise.all(
    names.map((name, index) =>
      setCamera(session.person(name).page, { x: index * 4000, y: 0, zoom: 1 })
    )
  );

  const seed = randomSeed();
  const random = createRandom(seed);
  /** Which slot each of a person's notes belongs to, so moves stay near home. */
  const slots = new Map<string, Map<string, { x: number; y: number }>>();
  const homeOf = (name: string): Map<string, { x: number; y: number }> => {
    let mine = slots.get(name);
    if (!mine) {
      mine = new Map();
      slots.set(name, mine);
    }
    return mine;
  };

  const ops: SoakOp[] = [];
  const log: string[] = [];
  const deadline = Date.now() + NIGHTLY_CAPACITY_SOAK_MS;
  let turn = 0;

  try {
    while (Date.now() < deadline) {
      const actor = session.people[turn % session.people.length];
      turn += 1;
      const what = `${actor.name} ${await randomEdit(actor.page, random, homeOf(actor.name))}`;
      const others = session.people
        .filter((person) => person !== actor)
        .map((person) => ({ name: person.name, page: person.page }));
      const ms = await waitForEveryone(what, actor.page, others, E2E_EVENTUAL_TIMEOUT_MS);
      ops.push({ what, ms });
      log.push(`${String(ops.length).padStart(3)}. ${what} — ${ms}ms`);
    }
  } catch (error) {
    // Without the seed and the last few moves, a soak failure is unreproducible.
    console.log(
      `capacity soak failed with seed ${seed} after ${ops.length} change(s):\n${log.slice(-30).join('\n')}`
    );
    throw error;
  }

  reportSoak(seed, ops, LIVE_UPDATE_LATENCY_BUDGET_MS, 'capacity soak');

  // The point of all of it: one board, seen the same way by everybody.
  const first = JSON.stringify(await boardOf(session.people[0].page));
  for (const person of session.people) {
    expect(JSON.stringify(await boardOf(person.page)), `${person.name} holds a different board`).toBe(
      first
    );
  }

  // Closing a board stops its connection rather than leaving it flapping: with the
  // others gone, the one left behind stays connected, still says nothing, and none
  // of the closed ones logged a reconnect attempt on the way out.
  const [keeper, ...leaving] = session.people;
  for (const person of leaving) await person.context.close();
  await keeper.page.waitForTimeout(RECONNECT_MAX_BACKOFF_MS + 2_000);
  expect(await connectionOf(keeper.page)).toBe('connected');
  for (const person of [keeper, ...leaving]) expect(person.errors).toEqual([]);
});
