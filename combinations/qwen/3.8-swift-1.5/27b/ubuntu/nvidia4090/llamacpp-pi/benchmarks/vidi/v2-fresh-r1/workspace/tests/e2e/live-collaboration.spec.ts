// E2E: live collaboration (story 3). Two or more real browsers on the same
// board, served by `wrangler dev` with the BoardRoom Durable Object.
// TC-22 to TC-28. Latency is logged against the 1-second budget, not asserted.

import { expect, test, type Page } from '@playwright/test';
import {
  CATCH_UP_TEST_OUTAGE_MS,
  E2E_EVENTUAL_TIMEOUT_MS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  STICKY_COLORS,
} from '../../src/shared/config';
import {
  badgeState,
  closeParticipant,
  createNoteAt,
  createNoteWithText,
  joinBoard,
  noteLocator,
  notesCount,
  notesSnapshot,
  openParticipant,
  setOffline,
  startEditingFirstNote,
  waitForBadge,
  waitForNotes,
  type Participant,
} from './helpers/participants';

const TOLERANCE_PX = 2;

/** Measure how long a change takes to appear on the other page; log only. */
async function measureDelivery(
  page: Page,
  probe: () => Promise<boolean>,
  label: string,
): Promise<void> {
  const start = Date.now();
  await expect.poll(probe, { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(true);
  const ms = Date.now() - start;
  console.log(`[latency] ${label}: ${ms}ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS}ms)`);
}

test.describe('story 3: see other people\'s edits appear live on the same board', () => {
    test('TC-22 every change type propagates: create, move, recolour, text, delete', async ({ browser }) => {
    test.setTimeout(90_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await joinBoard(sam.page, alex.boardId);

      // 1. Create.
      await createNoteWithText(alex.page, 'one', 400, 300);
      await measureDelivery(sam.page, async () => (await notesCount(sam.page)) === 1, 'create');
      await expect(noteLocator(sam.page).first()).toBeVisible();

      // 2. Move.
      const box = (await noteLocator(alex.page).first().boundingBox())!;
      const before = (await noteLocator(sam.page).first().boundingBox())!;
      await alex.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await alex.page.mouse.down();
      await alex.page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, {
        steps: 8,
      });
      await alex.page.mouse.up();
      await measureDelivery(
        sam.page,
        async () => {
          const b = (await noteLocator(sam.page).first().boundingBox())!;
          return Math.abs(b.x - (before.x + 60)) <= TOLERANCE_PX;
        },
        'move',
      );

      // 3. Recolour.
      const aBox = (await noteLocator(alex.page).first().boundingBox())!;
      await alex.page.mouse.click(aBox.x + aBox.width / 2, aBox.y + aBox.height / 2);
      await alex.page.getByTestId('swatch-green').click();
      await measureDelivery(
        sam.page,
        async () => {
          const bg = await noteLocator(sam.page).first().evaluate((el) => {
            const rgb = getComputedStyle(el).backgroundColor;
            const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
            return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
          });
          return bg.toLowerCase() === STICKY_COLORS.green.toLowerCase();
        },
        'recolour',
      );

      // 4. Text.
      await startEditingFirstNote(alex.page);
      await alex.page.keyboard.type(' two');
      await alex.page.keyboard.press('Escape');
      await measureDelivery(
        sam.page,
        async () => (await noteLocator(sam.page).first().textContent() ?? '').includes('two'),
        'text',
      );

      // 5. Delete.
      const dBox = (await noteLocator(alex.page).first().boundingBox())!;
      await alex.page.mouse.click(dBox.x + dBox.width / 2, dBox.y + dBox.height / 2);
      await alex.page.keyboard.press('Delete');
      await measureDelivery(sam.page, async () => (await notesCount(sam.page)) === 0, 'delete');
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-23 simultaneous typing merges: both pages end with identical text containing every character', async ({ browser }) => {
    test.setTimeout(90_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await createNoteWithText(alex.page, 'green', 400, 300);
      await joinBoard(sam.page, alex.boardId);
      await waitForNotes(sam.page, 1);

      // Both start editing the same note, then type at the same time.
      await Promise.all([startEditingFirstNote(alex.page), startEditingFirstNote(sam.page)]);
      // Let both editors settle (Firefox can drop key events fired mid
      // render-swap between display and edit mode).
      await Promise.all([alex.page.waitForTimeout(200), sam.page.waitForTimeout(200)]);
      const alexText = ' red';
      const samText = ' blue';
      await Promise.all([
        alex.page.keyboard.type(alexText, { delay: 30 }),
        sam.page.keyboard.type(samText, { delay: 30 }),
      ]);
      await Promise.all([
        alex.page.keyboard.press('Escape'),
        sam.page.keyboard.press('Escape'),
      ]);

      const expectedChars = [...('green' + alexText + samText)].sort().join('');
      // Display text only (not the whole note subtree: the toolbar has a 🗑
      // button). No trim: spaces are part of the typed characters.
      const displayText = async (page: Page) =>
        (await page.locator('.sticky-note__text').first().textContent()) ?? '';
      let finalText = '';
      await expect
        .poll(async () => {
          const a = await displayText(alex.page);
          const b = await displayText(sam.page);
          if (a === b) {
            finalText = a;
            return true;
          }
          return false;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
      expect([...finalText].sort().join('')).toBe(expectedChars);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-24 simultaneous drags of the same note settle to an identical position', async ({ browser }) => {
    test.setTimeout(90_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await createNoteWithText(alex.page, 'move me', 400, 300);
      await joinBoard(sam.page, alex.boardId);
      await waitForNotes(sam.page, 1);

      // Both drag the same note in different directions, at the same time.
      const drag = (page: Page, dx: number, dy: number) =>
        (async () => {
          const box = (await noteLocator(page).first().boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, {
            steps: 10,
          });
          await page.mouse.up();
        })();
      await Promise.all([drag(alex.page, 120, 0), drag(sam.page, 0, 120)]);

      // Both pages settle on the same (winner's) position.
      await expect
        .poll(async () => {
          const a = (await noteLocator(alex.page).first().boundingBox())!;
          const b = (await noteLocator(sam.page).first().boundingBox())!;
          return Math.abs(a.x - b.x) <= TOLERANCE_PX && Math.abs(a.y - b.y) <= TOLERANCE_PX;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-25 delete while the other side is editing: editor gone, no errors', async ({ browser }) => {
    test.setTimeout(90_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await createNoteWithText(alex.page, 'doomed', 400, 300);
      await joinBoard(sam.page, alex.boardId);
      await waitForNotes(sam.page, 1);

      const errors: string[] = [];
      sam.page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      sam.page.on('pageerror', (err) => errors.push(String(err)));

      // Sam starts editing the note; Alex deletes it.
      await startEditingFirstNote(sam.page);
      const box = (await noteLocator(alex.page).first().boundingBox())!;
      await alex.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await alex.page.keyboard.press('Delete');

      // Sam's note and its editor disappear.
      await expect.poll(() => notesCount(sam.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS }).toBe(0);
      await expect(sam.page.locator('.sticky-text-editor__textarea')).toHaveCount(0);
      expect(errors).toHaveLength(0);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-26 full capacity: all participants end on identical boards', async ({ browser }) => {
    test.setTimeout(180_000);
    const participants: Participant[] = [];
    try {
      // One board, MAX_CONCURRENT_EDITORS participants.
      const host = await openParticipant(browser);
      participants.push(host);
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        const p = await openParticipant(browser);
        await joinBoard(p.page, host.boardId);
        participants.push(p);
      }

      // Each participant creates 5 notes (own row, unique texts) then
      // moves them all.
      for (let i = 0; i < participants.length; i++) {
        const page = participants[i].page;
        for (let j = 0; j < 5; j++) {
          await createNoteWithText(page, `p${i}n${j}`, 170 + j * 220, 150 + i * 140);
        }
      }
      const total = MAX_CONCURRENT_EDITORS * 5;
      for (const p of participants) {
        await waitForNotes(p.page, total);
      }

      // Move each participant's notes.
      for (let i = 0; i < participants.length; i++) {
        const page = participants[i].page;
        for (let j = 0; j < 5; j++) {
          // Find this participant's j-th note by its text.
          const note = page
            .getByTestId('sticky-note')
            .filter({ hasText: `p${i}n${j}` })
            .first();
          const box = (await note.boundingBox())!;
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 16, {
            steps: 4,
          });
          await page.mouse.up();
        }
      }

      // Everyone ends on the identical board (pairwise: re-read all pages in
      // each poll so a transiently stale snapshot cannot pin the comparison).
      await expect
        .poll(async () => {
          const snaps = await Promise.all(participants.map((p) => notesSnapshot(p.page)));
          return snaps.every((s) => JSON.stringify(s) === JSON.stringify(snaps[0]));
        }, { timeout: 30_000 })
        .toBe(true);
      const reference = await notesSnapshot(participants[0].page);
      expect(reference).toHaveLength(total);
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });

  test('TC-27 outage: badge Reconnecting then Connected; both sides catch up to 6 notes', async ({ browser }) => {
    test.setTimeout(CATCH_UP_TEST_OUTAGE_MS + 120_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await joinBoard(sam.page, alex.boardId);

      // Alex goes offline for the full outage window. setOffline() blocks
      // new connections; the established connection is dropped explicitly
      // (the test-only disconnect hook) as a real outage would.
      const outageStart = Date.now();
      await setOffline(alex.context, true);
      await alex.page.evaluate(() => window.__vidi6?.disconnect());
      await waitForBadge(alex.page, 'reconnecting');

      // Both add 3 notes while the link is down (Alex's edits stay in the
      // local doc and must catch up later).
      for (let i = 0; i < 3; i++) {
        await createNoteWithText(alex.page, `A${i}`, 250 + i * 240, 250);
        await createNoteWithText(sam.page, `S${i}`, 250 + i * 240, 480);
      }
      // Hold the outage for the spec'd duration.
      const elapsed = Date.now() - outageStart;
      if (elapsed < CATCH_UP_TEST_OUTAGE_MS) {
        await alex.page.waitForTimeout(CATCH_UP_TEST_OUTAGE_MS - elapsed);
      }

      // Back online (and resume the provider's connection loop, which the
      // disconnect hook stopped).
      await setOffline(alex.context, false);
      await alex.page.evaluate(() => window.__vidi6?.reconnect());
      await waitForBadge(alex.page, 'confirmed');
      await waitForBadge(alex.page, 'connected');

      // Both pages converge on all 6 notes.
      await waitForNotes(alex.page, 6);
      await waitForNotes(sam.page, 6);
      await expect
        .poll(async () => {
          const a = JSON.stringify(await notesSnapshot(alex.page));
          const b = JSON.stringify(await notesSnapshot(sam.page));
          return a === b;
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });

  test('TC-28 selection and editing are local: the other page shows neither', async ({ browser }) => {
    test.setTimeout(90_000);
    const alex = await openParticipant(browser);
    const sam = await openParticipant(browser);
    try {
      await createNoteWithText(alex.page, 'shared', 400, 300);
      await joinBoard(sam.page, alex.boardId);
      await waitForNotes(sam.page, 1);

      // Alex selects the note and starts editing it.
      const box = (await noteLocator(alex.page).first().boundingBox())!;
      await alex.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await alex.page.keyboard.press('Enter');
      await alex.page.locator('.sticky-text-editor__textarea').waitFor();

      // Sam sees the note, but no selection outline and no editor.
      await expect(noteLocator(sam.page)).toHaveCount(1);
      await expect(sam.page.locator('[data-selected]')).toHaveCount(0);
      await expect(sam.page.locator('[data-editing]')).toHaveCount(0);
      await expect(sam.page.locator('.sticky-text-editor__textarea')).toHaveCount(0);
    } finally {
      await closeParticipant(alex);
      await closeParticipant(sam);
    }
  });
});
