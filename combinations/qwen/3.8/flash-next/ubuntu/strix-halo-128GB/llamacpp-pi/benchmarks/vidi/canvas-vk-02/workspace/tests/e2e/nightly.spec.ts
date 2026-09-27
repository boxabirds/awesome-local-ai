/**
 * tests/e2e/nightly.spec.ts
 *
 * The checks that are too slow for every commit (@nightly, `test:e2e:nightly`).
 *
 * TC-29 is the idle connection: y-websocket drops a socket it has heard nothing
 * from for thirty seconds, so a board that looks connected and quietly isn't is
 * the failure mode this guards — the room's keep-alive and the mapped state are
 * what stop it, and forty-five seconds of nothing is what proves it.
 *
 * TC-30 is the same promise at capacity, with the latency of every change
 * measured rather than assumed.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { STICKY_COLORS, type StickyColor } from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { waitForRender } from './helpers/board';
import {
  badgeText,
  connectionState,
  noteOn,
  notesOn,
  withParticipants,
  type NoteView,
  type Participant,
} from './helpers/participants';

const noteIn = (page: Page, id: string) =>
  page.locator(`[data-testid="sticky-note"][data-id="${id}"]`);

/** A deterministic sequence, so a slow run can be reproduced. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  const value = sorted[index];
  return value === undefined ? 0 : value;
}

test('TC-29 @nightly: an idle board stays connected for longer than the provider would wait on its own', async ({
  browser,
}) => {
  // The idle window plus connecting, with room for a slow machine.
  test.setTimeout(150_000);
  const IDLE_MS = Number(process.env.VIDI6_PROBE_IDLE ?? 45_000);
  const SAMPLE_MS = 2_000;

  await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
    const lapses: string[] = [];

    // Nothing at all happens on the board for IDLE_MS. Both screens are watched
    // the whole time: the badge, and the state the page itself was told.
    const started = Date.now();
    const watch = async (): Promise<void> => {
      for (let waited = 0; waited < IDLE_MS; waited += SAMPLE_MS) {
        console.log(`idle: waited=${waited} real=${Date.now() - started}`);
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
        console.log('idle: slept');
        for (const person of [alex, sam]) {
          console.log(`idle: before state ${person.name}`);
          const state = await connectionState(person.page);
          console.log(`idle: after state ${person.name} ${String(state)}`);
          const badge = await badgeText(person.page);
          console.log(`idle: after badge ${person.name}`);
          if (state !== 'connected') lapses.push(`${person.name}: state ${String(state)}`);
          if (badge !== null && badge.trim() !== '') lapses.push(`${person.name}: badge ${badge}`);
        }
      }
    };
    await watch();

    expect(lapses, 'an idle board was not quietly connected').toEqual([]);

    // And it is a live connection, not a page that stopped updating: a change
    // still crosses inside the budget.
    await alex.page.getByTestId('create-sticky').click();
    await alex.page.keyboard.type('after the quiet');
    await alex.page.keyboard.press('Escape');
    const id = (await notesOn(alex.page))[0]?.id;
    if (id === undefined) throw new Error('no note was made after the idle window');
    await expect
      .poll(
        async () => {
          const note = await noteOn(sam.page, id);
          return note?.text === 'after the quiet';
        },
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS, message: 'the first change after idle was not live' },
      )
      .toBe(true);
  });
});

test('TC-30 @nightly: a full board of editors keeps every change inside the budget', async ({
  browser,
}) => {
  const SOAK_MS = 60_000;
  test.setTimeout(SOAK_MS + 180_000);

  await withParticipants(browser, newBoardId(), MAX_CONCURRENT_EDITORS, async (people) => {
    const random = seeded(0x5eed);
    const pick = <T,>(items: readonly T[]): T => {
      const item = items[Math.floor(random() * items.length)] as T;
      return item;
    };
    const latencies: number[] = [];
    const breaches: string[] = [];
    const colourNames = Object.keys(STICKY_COLORS) as StickyColor[];

    /** Everything the sender's screen shows for one note, compared everywhere else. */
    const matches = (sent: NoteView, got: NoteView | undefined): boolean =>
      got !== undefined &&
      got.x === sent.x &&
      got.y === sent.y &&
      got.color === sent.color &&
      got.text === sent.text;

    const deliver = async (sender: Participant, id: string, gone: boolean): Promise<void> => {
      const sent = await noteOn(sender.page, id);
      if (!gone && sent === undefined) {
        throw new Error(`${sender.name} lost ${id} before it could be delivered`);
      }
      const from = Date.now();
      for (const other of people) {
        if (other === sender) continue;
        let arrived = gone ? (await noteOn(other.page, id)) === undefined : false;
        // Poll to just past the budget: the number we report is when it landed,
        // and the failure we want to see is one that lands after the budget.
        while (!arrived && Date.now() - from < LIVE_UPDATE_LATENCY_BUDGET_MS * 2) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          const got = await noteOn(other.page, id);
          arrived = got === undefined ? gone : sent !== undefined && matches(sent, got);
        }
        const latency = Date.now() - from;
        latencies.push(latency);
        if (!arrived) {
          breaches.push(
            `${sender.name} -> ${other.name}: ${gone ? 'delete' : 'change'} of ${id} never arrived (${latency}ms)`,
          );
        } else if (latency > LIVE_UPDATE_LATENCY_BUDGET_MS) {
          breaches.push(
            `${sender.name} -> ${other.name}: ${latency}ms for ${id}, budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms`,
          );
        }
      }
    };

    const stopAt = Date.now() + SOAK_MS;
    let operations = 0;
    while (Date.now() < stopAt) {
      const sender = pick(people);
      const notes = await notesOn(sender.page);
      const kinds = ['create', 'move', 'text', 'colour', ...(notes.length > 0 ? ['delete'] : [])] as const;
      const kind = pick(kinds);
      operations += 1;

      if (kind === 'create') {
        await sender.page.getByTestId('create-sticky').click();
        await sender.page.keyboard.type(`n${operations}`);
        await sender.page.keyboard.press('Escape');
        await waitForRender(sender.page);
        const created = (await notesOn(sender.page)).find((note) => note.text === `n${operations}`);
        if (created === undefined) throw new Error(`${sender.name} made a note that is not there`);
        await deliver(sender, created.id, false);
      } else {
        const target = pick(notes);
        if (target === undefined) continue;
        const id = target.id;
        if (kind === 'delete') {
          await noteIn(sender.page, id).click();
          await sender.page.keyboard.press('Delete');
          await waitForRender(sender.page);
          await deliver(sender, id, true);
        } else if (kind === 'move') {
          const box = await noteIn(sender.page, id).boundingBox();
          if (box === null) continue;
          const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          await sender.page.mouse.move(from.x, from.y);
          await sender.page.mouse.down();
          await sender.page.mouse.move(from.x + Math.floor(random() * 120) - 60, from.y + Math.floor(random() * 100) - 50, {
            steps: 4,
          });
          await sender.page.mouse.up();
          await waitForRender(sender.page);
          await deliver(sender, id, false);
        } else if (kind === 'text') {
          await noteIn(sender.page, id).click();
          await sender.page.keyboard.press('Enter');
          await sender.page.keyboard.type(`${operations}`);
          await sender.page.keyboard.press('Escape');
          await waitForRender(sender.page);
          await deliver(sender, id, false);
        } else {
          const colour = pick(colourNames);
          const label = `${colour[0]?.toUpperCase()}${colour.slice(1)}`;
          await noteIn(sender.page, id).click();
          await sender.page.getByRole('button', { name: `${label} colour` }).click();
          await waitForRender(sender.page);
          await deliver(sender, id, false);
        }
      }

      // The badge is the promise: while this is going on, nobody was told anything.
      for (const person of people) {
        const badge = await badgeText(person.page);
        expect(
          badge === null || badge.trim() === '',
          `${person.name} was told something during the soak: ${String(badge)}`,
        ).toBe(true);
      }
    }

    // Every screen ends identical.
    const expected = await notesOn(people[0]!.page);
    for (const person of people) {
      await expect
        .poll(async () => JSON.stringify(await notesOn(person.page)) === JSON.stringify(expected), {
          timeout: 10_000,
          message: `${person.name} ended on a different board`,
        })
        .toBe(true);
    }

    console.log(
      `TC-30: ${operations} changes across ${people.length} editors; ` +
        `${latencies.length} deliveries; ` +
        `p50 ${percentile(latencies, 50)}ms, p95 ${percentile(latencies, 95)}ms, ` +
        `max ${percentile(latencies, 100)}ms`,
    );
    expect(breaches, `deliveries outside the budget:\n${breaches.join('\n')}`).toEqual([]);
  });
});
