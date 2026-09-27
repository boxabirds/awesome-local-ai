/**
 * tests/e2e/live-collaboration.spec.ts
 *
 * Two or more real browsers, one board, the real `wrangler dev` server (TC-22 to
 * TC-28). Everything here goes through the same path a person takes: a built
 * client, a WebSocket to the Worker, a Durable Object holding the document.
 *
 * "Live" is a number, so every propagation in this file is measured against
 * LIVE_UPDATE_LATENCY_BUDGET_MS rather than waited for until it eventually turns
 * up: `expectDelivered` gives up on the budget, which is the assertion the
 * requirement makes, not a convenience.
 *
 * The three describes are the three workflows from the design: a two-person
 * workshop, a board at its designed capacity, and someone's Wi-Fi going out.
 */
import { expect, test, type Page } from '@playwright/test';

import {
  CATCH_UP_TEST_OUTAGE_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import { waitForRender } from './helpers/board';
import {
  badgeText,
  connectionState,
  expectDelivered,
  noteOn,
  notesOn,
  setOutage,
  withParticipants,
} from './helpers/participants';

/** One participant's note, by id. */
const noteIn = (page: Page, id: string) =>
  page.locator(`[data-testid="sticky-note"][data-id="${id}"]`);

/** The id of the single note a page is showing. */
async function onlyNoteId(page: Page): Promise<string> {
  const notes = await notesOn(page);
  const [note] = notes;
  if (notes.length !== 1 || note === undefined) {
    throw new Error(`expected exactly one note, found ${notes.length}`);
  }
  return note.id;
}

/** Stop editing without deselecting, so the note can be dragged or recoloured. */
async function commitEdit(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await waitForRender(page);
}

/** Select a note and start typing into it, the way a person would. */
async function editNote(page: Page, id: string): Promise<void> {
  await noteIn(page, id).click();
  await page.keyboard.press('Enter');
  await waitForRender(page);
}

async function dragNote(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = await noteIn(page, id).boundingBox();
  if (box === null) throw new Error('note has no bounding box');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
  await waitForRender(page);
}

/** One note's text on a page, `null` when the page does not have that note. */
async function textOf(page: Page, id: string): Promise<string | null> {
  const note = await noteOn(page, id);
  return note === undefined ? null : note.text;
}

// Firefox and WebKit are skipped on hosts that cannot launch them (see
// global-setup), and the two workflows below are chromium-only: one opens
// MAX_CONCURRENT_EDITORS contexts at once, the other cuts the network with the
// devtools protocol, which is the only thing that reliably stops an established
// WebSocket.
const unavailableBrowsers = (process.env.VIDI6_UNAVAILABLE_BROWSERS ?? '').split(',').filter(Boolean);
test.beforeEach(({ browserName }) => {
  test.skip(
    unavailableBrowsers.includes(browserName),
    `${browserName} cannot launch on this host (missing system libraries)`,
  );
});

test.describe('a two-person workshop', () => {
  test('TC-22: every kind of change shows up on the other screen within budget', async ({
    browser,
  }) => {
    await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
      // Create.
      await alex.page.getByTestId('create-sticky').click();
      await commitEdit(alex.page);
      const id = await onlyNoteId(alex.page);
      await expectDelivered('the new note on Sam', async () => (await noteOn(sam.page, id)) !== undefined);

      // Move.
      await dragNote(alex.page, id, 160, 90);
      const moved = await noteOn(alex.page, id);
      if (moved === undefined) throw new Error('the note vanished on its owner');
      await expectDelivered('the move on Sam', async () => {
        const remote = await noteOn(sam.page, id);
        return remote !== undefined && remote.x === moved.x && remote.y === moved.y;
      });

      // Recolour.
      await noteIn(alex.page, id).click();
      await alex.page.getByRole('button', { name: 'Pink colour' }).click();
      await expectDelivered('the colour on Sam', async () => {
        return (await noteOn(sam.page, id))?.color === 'pink';
      });

      // Text.
      await editNote(alex.page, id);
      await alex.page.keyboard.type('hello');
      await expectDelivered('the text on Sam', async () => (await textOf(sam.page, id)) === 'hello');
      await commitEdit(alex.page);

      // Delete.
      await noteIn(alex.page, id).click();
      await alex.page.keyboard.press('Delete');
      await expectDelivered('the delete on Sam', async () => (await noteOn(sam.page, id)) === undefined);

      expect(alex.errors, `Alex's console: ${alex.errors.join('\n')}`).toEqual([]);
      expect(sam.errors, `Sam's console: ${sam.errors.join('\n')}`).toEqual([]);
    });
  });

  test('TC-23: both typing into one note at once keeps every character, identically on both screens', async ({
    browser,
  }) => {
    await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
      await alex.page.getByTestId('create-sticky').click();
      await alex.page.keyboard.type('base');
      await commitEdit(alex.page);
      const id = await onlyNoteId(alex.page);
      await expectDelivered('the note on Sam', async () => (await noteOn(sam.page, id)) !== undefined);

      // Both into the same note, neither waiting for the other.
      await editNote(alex.page, id);
      await editNote(sam.page, id);
      await Promise.all([alex.page.keyboard.type('AAAA'), sam.page.keyboard.type('SSSS')]);

      // The other person's characters arrive within the budget...
      await expectDelivered("the other person's characters", async () => {
        const [mine, theirs] = [await textOf(alex.page, id), await textOf(sam.page, id)];
        return mine !== null && theirs !== null && mine.includes('SSSS') && theirs.includes('AAAA');
      });

      // ...and what both screens settle on is the same text, character for
      // character, with nothing lost.
      await expect
        .poll(
          async () => {
            const [a, s] = [await textOf(alex.page, id), await textOf(sam.page, id)];
            return a === s ? a : null;
          },
          { timeout: 5_000 },
        )
        .toContain('base');
      const both = await textOf(alex.page, id);
      if (both === null) throw new Error('the merged text is gone');
      expect(both.split('A').length - 1).toBe(4);
      expect(both.split('S').length - 1).toBe(4);
      expect(both.startsWith('base')).toBe(true);
    });
  });

  test('TC-24: both dragging the same note at once settle on one position, the same on both screens', async ({
    browser,
  }) => {
    await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
      await alex.page.getByTestId('create-sticky').click();
      await commitEdit(alex.page);
      const id = await onlyNoteId(alex.page);
      await expectDelivered('the note on Sam', async () => (await noteOn(sam.page, id)) !== undefined);

      // Two drags, overlapping in time and pulling different ways.
      const drag = async (page: Page, dx: number, dy: number): Promise<void> => {
        const box = await noteIn(page, id).boundingBox();
        if (box === null) throw new Error('note has no bounding box');
        const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + dx, from.y + dy, { steps: 6 });
        await page.mouse.up();
      };
      await Promise.all([drag(alex.page, 180, 0), drag(sam.page, 0, 140)]);

      // Concurrent writes to one field keep one winner — and whoever lost sees it.
      // A losing drag has to be corrected from the *other* browser, so this is
      // given the budget twice over; what must not happen is two boards.
      await expect
        .poll(
          async () => {
            const a = await noteOn(alex.page, id);
            const s = await noteOn(sam.page, id);
            return a !== undefined && s !== undefined && a.x === s.x && a.y === s.y
              ? `${a.x},${a.y}`
              : null;
          },
          { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 2 },
        )
        .toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
    });
  });

  test('TC-25: a note deleted under somebody typing in it takes its editor with it, quietly', async ({
    browser,
  }) => {
    await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
      await alex.page.getByTestId('create-sticky').click();
      await commitEdit(alex.page);
      const id = await onlyNoteId(alex.page);
      await expectDelivered('the note on Sam', async () => (await noteOn(sam.page, id)) !== undefined);

      // Sam is mid-edit, caret in the text.
      await editNote(sam.page, id);
      await sam.page.keyboard.type('working he');
      await expect(noteIn(sam.page, id)).toHaveAttribute('data-editing', 'true');

      // Alex deletes it.
      await noteIn(alex.page, id).click();
      await alex.page.keyboard.press('Delete');

      // Sam's note goes, and its editor goes with it: no caret left on something
      // that is not there.
      await expectDelivered("Sam's note disappearing", async () => (await noteOn(sam.page, id)) === undefined);
      await expect(sam.page.getByRole('textbox', { name: 'Sticky note text' })).toHaveCount(0);
      await expect(noteIn(sam.page, id)).toHaveCount(0);

      // And the board still works for Sam afterwards.
      await sam.page.getByTestId('create-sticky').click();
      await commitEdit(sam.page);
      expect(await notesOn(sam.page)).toHaveLength(1);
      await expectDelivered("Alex seeing Sam's next note", async () => (await notesOn(alex.page)).length === 1);

      expect(sam.errors, `Sam's console: ${sam.errors.join('\n')}`).toEqual([]);
    });
  });
});

test.describe('a board at capacity', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'capacity soak runs in chromium only');
  test('TC-26: at the designed capacity every change reaches everybody within budget, and every screen ends identical', async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    await withParticipants(browser, newBoardId(), MAX_CONCURRENT_EDITORS, async (people) => {
      const owned = new Map<string, string[]>();

      // Five notes each, every one of them on every other screen inside the
      // budget — at capacity, that is the promise.
      for (const person of people) {
        const ids: string[] = [];
        for (let note = 0; note < 5; note++) {
          await person.page.getByTestId('create-sticky').click();
          await person.page.keyboard.type(`${person.name}-${note}`);
          await commitEdit(person.page);
          const mine = (await notesOn(person.page)).filter((n) => n.text.startsWith(`${person.name}-`));
          const newest = mine[mine.length - 1];
          if (newest === undefined) throw new Error(`${person.name} lost a note while making it`);
          ids.push(newest.id);

          await expectDelivered(`${person.name}'s note ${note} on everybody`, async () => {
            for (const other of people) {
              if ((await noteOn(other.page, newest.id)) === undefined) return false;
            }
            return true;
          });
          const expected = (people.indexOf(person) + 1) * 5 - (5 - ids.length);
          for (const other of people) {
            expect(await notesOn(other.page), `${other.name} has the wrong count`).toHaveLength(expected);
          }
        }
        owned.set(person.name, ids);
      }

      // Moves at capacity, too.
      for (const person of people) {
        for (const [note, id] of (owned.get(person.name) ?? []).entries()) {
          await dragNote(person.page, id, 30 + note * 8, 22 + note * 6);
          const moved = await noteOn(person.page, id);
          if (moved === undefined) throw new Error(`${person.name}'s note vanished while moving it`);
          await expectDelivered(`${person.name}'s move of note ${note}`, async () => {
            for (const other of people) {
              const remote = await noteOn(other.page, id);
              if (remote === undefined || remote.x !== moved.x || remote.y !== moved.y) return false;
            }
            return true;
          });
        }
      }

      // One board, seen identically from every chair.
      const expected = await notesOn(people[0]!.page);
      expect(expected).toHaveLength(MAX_CONCURRENT_EDITORS * 5);
      for (const person of people) {
        await expect
          .poll(
            async () => JSON.stringify(await notesOn(person.page)) === JSON.stringify(expected),
            { timeout: 5_000, message: `${person.name} sees a different board` },
          )
          .toBe(true);
        expect(person.errors, `${person.name}'s console: ${person.errors.join('\n')}`).toEqual([]);
      }
    });
  });
});

test.describe("someone's Wi-Fi goes out", () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'cutting the network needs the devtools protocol',
  );
  test('TC-27: work done offline reaches the other screen the moment the connection is back', async ({
    browser,
  }) => {
    // Long by design: the outage itself lasts CATCH_UP_TEST_OUTAGE_MS, and the
    // provider's backoff has to run out inside the rest of it.
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
      await setOutage(alex, true);

      // The board says what is happening, while still being usable.
      await expect
        .poll(() => badgeText(alex.page), {
          timeout: CATCH_UP_TEST_OUTAGE_MS + 20_000,
          message: 'Alex was never told the connection was lost',
        })
        .toBe('Reconnecting…');

      // Both keep working while they are cut off.
      for (let i = 0; i < 3; i++) {
        await alex.page.getByTestId('create-sticky').click();
        await alex.page.keyboard.type(`offline-${i}`);
        await commitEdit(alex.page);
      }
      for (let i = 0; i < 3; i++) {
        await sam.page.getByTestId('create-sticky').click();
        await sam.page.keyboard.type(`online-${i}`);
        await commitEdit(sam.page);
      }
      expect(await notesOn(alex.page)).toHaveLength(3);
      expect(await notesOn(sam.page)).toHaveLength(3);

      // Back on the network, the work is there in both directions.
      await setOutage(alex, false);
      await expect
        .poll(() => connectionState(alex.page), { timeout: 40_000, message: 'Alex never reconnected' })
        .toBe('connected');
      await expect
        .poll(async () => (await notesOn(alex.page)).length, { timeout: 20_000 })
        .toBe(6);
      await expect
        .poll(async () => (await notesOn(sam.page)).length, { timeout: 20_000 })
        .toBe(6);

      const [a, s] = [await notesOn(alex.page), await notesOn(sam.page)];
      expect(JSON.stringify(a)).toBe(JSON.stringify(s));
      expect(a.map((note) => note.text).sort()).toEqual([
        'offline-0',
        'offline-1',
        'offline-2',
        'online-0',
        'online-1',
        'online-2',
      ]);
    });
  });

  test('TC-28: what one person has selected and is editing stays theirs', async ({ browser }) => {
    await withParticipants(browser, newBoardId(), 2, async ([alex, sam]) => {
      await alex.page.getByTestId('create-sticky').click();
      await alex.page.keyboard.type('private');
      const id = await onlyNoteId(alex.page);
      await expectDelivered('the note on Sam', async () => (await noteOn(sam.page, id)) !== undefined);

      // On Alex's screen there is a selection and a caret.
      await expect(noteIn(alex.page, id)).toHaveAttribute('data-editing', 'true');
      await expect(noteIn(alex.page, id)).toHaveAttribute('data-selected', 'true');

      // Sam sees the same note and nothing of Alex's session with it: no
      // selection outline, no editor, no toolbar of Alex's.
      await expect(noteIn(sam.page, id)).toHaveCount(1);
      await expect(noteIn(sam.page, id)).toHaveAttribute('data-selected', 'false');
      await expect(noteIn(sam.page, id)).toHaveAttribute('data-editing', 'false');
      await expect(sam.page.getByRole('textbox', { name: 'Sticky note text' })).toHaveCount(0);
      await expect(sam.page.getByTestId('note-toolbar')).toHaveCount(0);

      // Alex's continued typing puts text on Sam's screen and still no caret.
      await alex.page.keyboard.type(' more');
      await expectDelivered("Alex's text on Sam", async () => (await textOf(sam.page, id)) === 'private more');
      await expect(sam.page.getByRole('textbox', { name: 'Sticky note text' })).toHaveCount(0);
    });
  });
});
