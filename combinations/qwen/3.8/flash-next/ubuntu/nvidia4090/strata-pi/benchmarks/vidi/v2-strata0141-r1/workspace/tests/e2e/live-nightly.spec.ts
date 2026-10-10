import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  CAPACITY_SOAK_MS,
  IDLE_STABILITY_TEST_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  E2E_EVENTUAL_TIMEOUT_MS,
  STICKY_COLOR_NAMES,
  type StickyColor,
} from '../../src/shared/config';
import type { StickySnapshot } from '../../src/shared/board-model';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH, setCamera } from './helpers/board';
import {
  badgeText,
  boardDomSnapshot,
  connectionState,
  joinBoard,
  newLiveBoardId,
  trackErrors,
  waitForNote,
  waitForSameBoard,
} from './helpers/live';
import {
  clickCreateStickyButton,
  clickDeleteButton,
  clickSwatch,
  dragNote,
  getNotes,
  noteCard,
  noteCentre,
  selectNote,
  topNoteIdAt,
} from './helpers/sticky';

/**
 * Story 3, task 9 (`test:e2e:nightly`, anchor `sync.client`): the long-running
 * verification of the connection contract that is too slow for every commit.
 *
 *   TC-29  an idle board stays connected with nobody touching it
 *   TC-30  MAX_CONCURRENT_EDITORS people editing continuously for CAPACITY_SOAK_MS
 *
 * Both are tagged `@nightly` so the default `npm run test:e2e` skips them
 * (`--grep-invert @nightly`). Latency is measured and printed; no test here
 * fails because a change took longer than LIVE_UPDATE_LATENCY_BUDGET_MS.
 */

const soakLatencies: number[] = [];

/** Reproducible edit sequence: the same soak runs the same actions every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const tokenOf = (note: StickySnapshot): string =>
  `${note.id}|${note.text}|${note.color}|${note.x}|${note.y}`;

const tokenFor = async (page: Page, id: string): Promise<string | null> => {
  const notes = await getNotes(page);
  const note = notes.find((candidate) => candidate.id === id);
  return note ? tokenOf(note) : null;
};

/**
 * How long the sender's latest state of `id` takes to show up on every other
 * page. `removed` means the change was a delete, so the note must be gone.
 * Fails if it never arrives; otherwise returns the measured latency.
 */
async function converge(
  sender: Page,
  others: readonly Page[],
  id: string,
  options: { removed?: boolean } = {},
): Promise<number> {
  const started = Date.now();
  const target = options.removed ? null : await tokenFor(sender, id);
  await expect
    .poll(
      async () => {
        for (const page of others) {
          const token = await tokenFor(page, id);
          if (options.removed ? token !== null : token !== target) {
            return false;
          }
        }
        return true;
      },
      {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: `the change to note ${id} never reached every other board`,
      },
    )
    .toBe(true);
  const ms = Date.now() - started;
  soakLatencies.push(ms);
  return ms;
}

/**
 * A note from `mine` that this page can act on: on screen, and the topmost note
 * at its own centre. Notes are shared and stacked, so a click can otherwise land
 * on somebody else's note, which would make the soak delete the wrong thing.
 */
async function reachableNote(
  page: Page,
  mine: readonly string[],
  random: () => number,
): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const id = mine[Math.floor(random() * mine.length)] as string | undefined;
    if (id === undefined) {
      return null;
    }
    const centre = await noteCentre(page, id);
    if (
      centre.x < 0 ||
      centre.y < 0 ||
      centre.x > VIEWPORT_WIDTH ||
      centre.y > VIEWPORT_HEIGHT
    ) {
      continue;
    }
    if ((await topNoteIdAt(page, centre)) === `sticky-note-${id}`) {
      return id;
    }
  }
  return null;
}

test.afterAll(async () => {
  if (soakLatencies.length === 0) {
    return;
  }
  const sorted = [...soakLatencies].sort((a, b) => a - b);
  const at = (quantile: number): number => {
    const index = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * quantile));
    return sorted[index] ?? 0;
  };
  const overBudget = sorted.filter((ms) => ms > LIVE_UPDATE_LATENCY_BUDGET_MS).length;
  console.log(
    `\nTC-30 latency report (${sorted.length} changes, budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, ` +
      `reported not asserted): p50=${at(0.5)} ms p95=${at(0.95)} ms max=${at(1)} ms ` +
      `over budget=${overBudget}`,
  );
});

test.describe('live collaboration (nightly)', () => {
  test('TC-29 @nightly: two idle boards stay connected for IDLE_STABILITY_TEST_MS', async ({
    browser,
  }) => {
    test.setTimeout(IDLE_STABILITY_TEST_MS + 120_000);
    const board = newLiveBoardId();
    const contexts: BrowserContext[] = [];
    try {
      const first = await browser.newContext();
      const second = await browser.newContext();
      contexts.push(first, second);
      const a = await joinBoard(first, board);
      const b = await joinBoard(second, board);
      const errors = [...trackErrors(a), ...trackErrors(b)];

      // One note exists, then nobody does anything at all.
      const created = await clickCreateStickyButton(a).then(async () => {
        await a.keyboard.press('Escape');
        const notes = await getNotes(a);
        return notes[0] as StickySnapshot;
      });
      await waitForNote(b, created.id);

      const statesSeen = new Set<string>();
      const deadline = Date.now() + IDLE_STABILITY_TEST_MS;
      while (Date.now() < deadline) {
        await a.waitForTimeout(3_000);
        for (const page of [a, b]) {
          const state = await connectionState(page);
          statesSeen.add(state);
          // Never "Reconnecting…", never back to "Connecting…".
          expect(state).toBe('connected');
          expect(await badgeText(page)).toBe('');
        }
      }
      expect([...statesSeen]).toEqual(['connected']);
      expect(errors).toEqual([]);

      // Still connected: a change made after the idle period arrives promptly.
      const started = Date.now();
      await clickCreateStickyButton(a);
      await a.keyboard.press('Escape');
      const notes = await getNotes(a);
      const latest = (notes[notes.length - 1] as StickySnapshot).id;
      await waitForNote(b, latest);
      const ms = Date.now() - started;
      soakLatencies.push(ms);
      console.log(`TC-29 post-idle change reached the other board in ${ms} ms`);
      await waitForSameBoard([a, b]);
    } finally {
      for (const context of contexts) {
        await context.close();
      }
    }
  });

  test(`TC-30 @nightly: ${MAX_CONCURRENT_EDITORS} people editing continuously for ${CAPACITY_SOAK_MS} ms`, async ({
    browser,
  }) => {
    test.setTimeout(CAPACITY_SOAK_MS + 180_000);
    const board = newLiveBoardId();
    const contexts: BrowserContext[] = [];
    const errors: string[] = [];
    try {
      const pages: Page[] = [];
      const others: Page[][] = [];
      for (let index = 0; index < MAX_CONCURRENT_EDITORS; index += 1) {
        const context = await browser.newContext();
        contexts.push(context);
        const page = await joinBoard(context, board);
        errors.push(...trackErrors(page));
        // Each person works far away from the others, so the note this person
        // clicks is always their own, while every note is still on everyone's
        // board (nothing is culled: all notes are rendered on all boards).
        await setCamera(page, { x: index * 4_000, y: index * 4_000, zoom: 1 });
        pages.push(page);
      }
      for (const [index, page] of pages.entries()) {
        others[index] = pages.filter((candidate) => candidate !== page);
      }

      const random = seeded(0x5eed);
      const own: string[][] = pages.map(() => []);
      /** Where each note was created, so a random walk cannot wander off screen. */
      const home = new Map<string, { x: number; y: number }>();
      const deadline = Date.now() + CAPACITY_SOAK_MS;
      let changes = 0;
      let words = 0;
      let lastReport = Date.now();

      while (Date.now() < deadline) {
        for (const [index, page] of pages.entries()) {
          const mine = own[index] as string[];
          const pick = random();
          const create =
            mine.length === 0 ||
            mine.length < 3 ||
            pick < 0.3 ||
            (pick > 0.9 && mine.length >= 6);

          if (create) {
            // Create through the toolbar, then move it to its own spot so the
            // next person's click cannot land on the wrong note.
            const before = new Set((await getNotes(page)).map((note) => note.id));
            await clickCreateStickyButton(page);
            await page.keyboard.press('Escape');
            const fresh = (await getNotes(page)).find((note) => !before.has(note.id));
            if (!fresh) {
              throw new Error('the toolbar did not create a note');
            }
            const id = fresh.id;
            mine.push(id);
            home.set(id, { x: fresh.x, y: fresh.y });
            const slot = mine.length - 1;
            await dragNote(page, id, 60 + slot * 24, 40 + slot * 18);
            await converge(page, others[index] as Page[], id);
            changes += 1;
            continue;
          }

          // Notes are stacked and shared, so only a note this person can actually
          // reach - on screen, and on top at its own centre - is worth acting on.
          const reachable = await reachableNote(page, mine, random);
          if (reachable === null) {
            continue;
          }
          const id = reachable;
          const action = random();
          if (action < 0.25) {
            // A bounded random walk: a note that has drifted far from where its
            // author created it is pulled back, so it stays reachable.
            const notes = await getNotes(page);
            const note = notes.find((candidate) => candidate.id === id);
            const origin = home.get(id);
            let dx = Math.round((random() - 0.5) * 200);
            let dy = Math.round((random() - 0.5) * 160);
            if (note && origin) {
              const driftX = note.x - origin.x;
              const driftY = note.y - origin.y;
              if (Math.abs(driftX) > 400) dx = -Math.round(driftX * 0.8);
              if (Math.abs(driftY) > 400) dy = -Math.round(driftY * 0.8);
            }
            await dragNote(page, id, dx, dy);
            await converge(page, others[index] as Page[], id);
          } else if (action < 0.5) {
            words += 1;
            await noteCard(page, id).dblclick();
            await page.keyboard.type(` w${words}`);
            await page.keyboard.press('Escape');
            await converge(page, others[index] as Page[], id);
          } else if (action < 0.75) {
            const color = (STICKY_COLOR_NAMES[Math.floor(random() * STICKY_COLOR_NAMES.length)] ??
              'yellow') as StickyColor;
            await selectNote(page, id);
            await clickSwatch(page, color);
            await converge(page, others[index] as Page[], id);
          } else {
            await selectNote(page, id);
            await clickDeleteButton(page);
            own[index] = mine.filter((candidate) => candidate !== id);
            home.delete(id);
            await converge(page, others[index] as Page[], id, { removed: true });
          }
          changes += 1;
        }

        if (Date.now() - lastReport > 10_000) {
          lastReport = Date.now();
          const partial = [...soakLatencies].sort((a, b) => a - b);
          const max = partial[partial.length - 1] ?? 0;
          console.log(
            `TC-30 ${changes} changes so far, ${soakLatencies.length} measured, ` +
              `latest max ${max} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
          );
        }
      }

      // Every change arrived: all boards hold the same notes and paint them the
      // same way.
      const notes = await waitForSameBoard(pages);
      expect(notes.length).toBeGreaterThan(0);
      const snapshots = await Promise.all(pages.map(async (page) => await boardDomSnapshot(page)));
      for (const snapshot of snapshots.slice(1)) {
        expect(snapshot).toBe(snapshots[0]);
      }
      expect(errors).toEqual([]);
      console.log(`TC-30 finished: ${changes} changes, ${notes.length} notes on every board`);
    } finally {
      for (const context of contexts) {
        await context.close();
      }
    }
  });
});
