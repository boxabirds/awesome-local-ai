/**
 * Nightly checks (tagged `@nightly`, run by `npm run test:e2e:nightly`): the two
 * things that take too long for the ordinary suite — a board left sitting idle,
 * and the soft capacity of five people working at once.
 *
 * `npm run test:e2e` skips everything in here with `--grep-invert @nightly`.
 */
import { expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  E2E_PROPAGATION_GUARD_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  createParticipants,
  everyoneSynced,
  expectEventually,
  freshBoardId,
  openParticipant,
  randomBoardOps,
  screensMatch,
  waitForSameScreen,
  type Participant,
} from './helpers/participants';

/** Page time to sit idle: longer than any reconnect or confirmation timer. */
const IDLE_SOAK_MS = 45_000;
/** Operations each of the five people performs in the capacity soak. */
const OPS_PER_PERSON = 200;
/** How long all five screens are given to agree after that many writes. */
const CONVERGENCE_BUDGET_MS = 30_000;

/**
 * Watch the badge from inside the page and remember every text it ever showed.
 * A MutationObserver needs no timers, so it keeps working while the page clock is
 * frozen — which is exactly how an idle period is stretched out.
 */
async function watchBadge(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __badgeStates: (string | null)[] };
    w.__badgeStates = [];
    const read = (): string | null => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.textContent?.trim() ?? null;
    };
    const record = () => {
      const text = read();
      const seen = w.__badgeStates;
      if (seen[seen.length - 1] !== text) seen.push(text);
    };
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    record();
  });
}

function badgeStates(
  page: import('@playwright/test').Page,
): Promise<(string | null)[]> {
  return page.evaluate(() => (window as never as { __badgeStates: (string | null)[] }).__badgeStates);
}

test.describe('nightly', () => {
  test('TC-29 a board left idle stays connected and still works @nightly', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const boardId = freshBoardId();
    const people = await createParticipants(browser, boardId, ['alex', 'sam']);
    const [alex, sam] = people as [Participant, Participant];

    const note = await alex.createNote('settled');
    await expectEventually(
      () => sam.noteText(note),
      (text) => text === 'settled',
    );

    await watchBadge(alex.page);
    // Stretch the clock on Alex's page: forty-five seconds of page time in a moment,
    // in steps so that a timer which only ever looks that far ahead still runs.
    await alex.page.clock.install();
    for (let elapsed = 0; elapsed < IDLE_SOAK_MS; elapsed += 5_000) {
      await alex.page.clock.runFor(5_000);
    }

    // Nothing was ever shown to the user: no reconnecting, no confirmation, not
    // even a flicker — the recorded states are only "no badge".
    expect(await badgeStates(alex.page)).toEqual([null]);
    expect(await alex.connectionState()).toBe('connected');

    // And the socket that has been sitting there is still a working one.
    const later = await alex.createNote('after the idle');
    const { ms } = await expectEventually(
      () => sam.noteText(later),
      (text) => text === 'after the idle',
      E2E_PROPAGATION_GUARD_MS,
      'the idle socket was dead',
    );
    console.log(
      `[TC-29] after ${IDLE_SOAK_MS} ms of idle page time a change still arrived in ` +
        `${ms} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
    );
    await waitForSameScreen(people);
    expect(people.flatMap((p) => p.pageErrors)).toEqual([]);
    await Promise.all(people.map((p) => p.close()));
  });

  test('TC-30 five people at the soft capacity converge @nightly', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const boardId = freshBoardId();
    const people = await createParticipants(browser, boardId, [
      'alex',
      'sam',
      'rita',
      'kim',
      'jo',
    ]);
    expect(people).toHaveLength(MAX_CONCURRENT_EDITORS);

    // Everyone starts with something of their own on the board.
    for (const person of people) await person.createNote(`note by ${person.name}`);
    await waitForSameScreen(people);

    // Each of the five makes a long, varied series of changes at the same time.
    // Different seed per person, so their operations do not line up.
    const started = Date.now();
    await Promise.all(
      people.map((p, i) => p.applyOps(randomBoardOps(OPS_PER_PERSON, 20260214 + i))),
    );
    const writes = people.length * OPS_PER_PERSON;
    console.log(`[TC-30] ${writes} operations issued in ${Date.now() - started} ms`);

    // However they interleave, every screen ends up showing the same board.
    const { screen, ms } = await waitForSameScreen(people, CONVERGENCE_BUDGET_MS);
    console.log(
      `[TC-30] ${people.length} people × ${OPS_PER_PERSON} operations converged in ` +
        `${ms} ms (budget ${CONVERGENCE_BUDGET_MS} ms); ${screen.length} notes on screen`,
    );
    expect(screen.length).toBeGreaterThan(0);

    // A 6th person is not turned away, and joins the board as it now is.
    const sixth = await openParticipant(browser, boardId, 'sixth');
    await everyoneSynced([sixth]);
    await expectEventually(
      () => sixth.screen(),
      async () => screensMatch([...people, sixth]),
      E2E_EVENTUAL_TIMEOUT_MS,
      'the 6th person never caught up',
    );

    // And the board is still quick for one more change.
    await sixth.createNote('late but on time');
    const late = await expectEventually(
      () => people[0]!.screen(),
      async (screenNow) => screenNow.some((n) => n.text === 'late but on time'),
      E2E_PROPAGATION_GUARD_MS,
      'a change after the soak was too slow',
    );
    console.log(`[TC-30] a change after the soak arrived in ${late.ms} ms`);
    expect(people.concat(sixth).flatMap((p) => p.pageErrors)).toEqual([]);
    await Promise.all(people.concat(sixth).map((p) => p.close()));
  });
});
