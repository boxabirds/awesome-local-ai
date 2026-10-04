/**
 * Story 8 — e2e: recover my mistakes while colleagues work (TC-22 to TC-24).
 *
 * Real browsers (chromium) against `wrangler dev`, real y-webrtc sync.
 * Undo/redo is personal: each participant's shortcuts and buttons only
 * touch their own LOCAL_ORIGIN history.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  createParticipants,
  expectEventually,
  type Participant,
} from './helpers/participants';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';

/** Shift+drag marquee selection from one screen point to another. */
async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Collect console and page errors on a page. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

/** Close all participants. */
async function closeAll(pages: Participant[]): Promise<void> {
  await Promise.all(pages.map((p) => p.close()));
}

test.describe('story 8: undo and redo my own changes', () => {
  test('TC-22: recover an accidental delete while a colleague adds a note', async ({ browser }) => {
    test.setTimeout(60_000);
    const [mia, raj] = await createParticipants(browser, 2);
    try {
      // Raj creates 8 notes in a 4×2 grid (screen = world at default camera).
      // Raj creates them so Mia's personal history starts empty: her only
      // step will be the delete, so her Undo button is exhausted after redo.
      for (let i = 0; i < 8; i++) {
        const col = i % 4;
        const row = Math.floor(i / 4);
        await raj.createNote(`Note ${i + 1}`, 200 + col * 250, 200 + row * 300);
      }
      const before = await mia.boardSnapshot();
      expect(before).toHaveLength(8);

      // Mia box-selects all 8 notes and deletes them. Notes are centred on the
      // grid points, so they span x 100..1050 and y 100..600; the marquee must
      // fully contain them (objectsInRect uses containment).
      await marquee(mia.page, { x: 95, y: 85 }, { x: 1100, y: 660 });
      await mia.page.keyboard.press('Delete');
      await expectEventually(
        'mia sees 0 notes after delete',
        async () => (await mia.notes().count()) === 0,
      );

      // Raj adds his own note after Mia's delete (in-viewport, well clear of
      // the grid so dblclick retries never land on an existing note).
      await raj.createNote('Raj note', 1150, 650);
      await expectEventually(
        'mia sees raj note',
        async () => (await mia.notes().count()) === 1,
      );

      // Mia undoes her delete → her 8 notes return on BOTH screens;
      // Raj's note remains.
      await mia.page.keyboard.press('Control+z');
      await expectEventually(
        'mia sees 9 notes after undo',
        async () => (await mia.notes().count()) === 9,
      );
      await expectEventually(
        'raj sees 9 notes after undo',
        async () => (await raj.notes().count()) === 9,
      );

      // All 8 restored with text and positions; Raj's note intact.
      const afterUndo = await mia.boardSnapshot();
      expect(afterUndo).toHaveLength(9);
      const rajEntry = afterUndo.find((e) => e.startsWith('Raj note@'));
      expect(rajEntry).toBeTruthy();
      // The 8 restored entries exactly match the pre-delete snapshot.
      expect(afterUndo.filter((e) => e !== rajEntry)).toEqual(before);

      // Restored notes keep their colour and size.
      const restored = await mia.page
        .locator('[data-testid="sticky-note"]')
        .evaluateAll((els) =>
          els.map((el) => ({
            bg: getComputedStyle(el).backgroundColor,
            w: el.clientWidth,
            h: el.clientHeight,
          })),
        );
      for (const r of restored) {
        expect(r.bg).toBe('rgb(255, 245, 157)'); // yellow (#FFF59D)
        expect(r.w).toBe(200);
        expect(r.h).toBe(200);
      }

      // Mia clicks the Redo button → the 8 disappear again on both screens.
      await mia.page.getByTestId('redo-btn').click();
      await expectEventually(
        'mia sees 1 note after redo',
        async () => (await mia.notes().count()) === 1,
      );
      await expectEventually(
        'raj sees 1 note after redo',
        async () => (await raj.notes().count()) === 1,
      );
      expect(await raj.noteTexts()).toEqual(['Raj note']);

      // Undo the re-delete: the 8 return a second time and Mia's history is
      // now exhausted → Undo button disabled.
      await mia.page.keyboard.press('Control+z');
      await expectEventually(
        'mia sees 9 notes after second undo',
        async () => (await mia.notes().count()) === 9,
      );
      await expect(mia.page.getByTestId('undo-btn')).toBeDisabled();
    } finally {
      await closeAll([mia, raj]);
    }
  });

  test('TC-23: colleague deleted my object → undo is a safe no-op', async ({ browser }) => {
    test.setTimeout(60_000);
    const [mia, raj] = await createParticipants(browser, 2);
    try {
      const miaErrors = collectErrors(mia.page);

      // Mia creates a note and moves it twice (two undo steps).
      await mia.createNote('Mia note', 300, 250);
      await mia.dragNote('Mia note', 60, 40);
      await mia.dragNote('Mia note', 60, 40);

      // Raj deletes the note.
      await raj.selectNote('Mia note');
      await raj.deleteSelected('Mia note');

      // Mia undoes → no error, note stays absent on both screens.
      await mia.page.keyboard.press('Control+z');
      await mia.page.waitForTimeout(600);
      expect(miaErrors).toEqual([]);
      expect(await mia.note('Mia note').count()).toBe(0);
      expect(await raj.note('Mia note').count()).toBe(0);

      // Mia's next undo still works (second move step; also a safe no-op).
      await mia.page.keyboard.press('Control+z');
      await mia.page.waitForTimeout(600);
      expect(miaErrors).toEqual([]);
      expect(await mia.note('Mia note').count()).toBe(0);
      expect(await raj.note('Mia note').count()).toBe(0);
    } finally {
      await closeAll([mia, raj]);
    }
  });

  test('TC-24: everyone undoing at once reverts only their own changes', async ({ browser }) => {
    test.setTimeout(180_000);
    const pages = await createParticipants(browser, MAX_CONCURRENT_EDITORS);
    try {
      const [first] = pages;

      // 2 notes per participant in a 5×2 grid.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS * 2; i++) {
        const col = i % MAX_CONCURRENT_EDITORS;
        const row = Math.floor(i / MAX_CONCURRENT_EDITORS);
        await first.createNote(`N${i}`, 200 + col * 250, 200 + row * 300);
      }
      const initial = await first.boardSnapshot();
      expect(initial).toHaveLength(MAX_CONCURRENT_EDITORS * 2);

      // Each participant moves note 2i and types in note 2i+1.
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        await p.dragNote(`N${2 * i}`, 50 * (i + 1), 30 * (i + 1));
        await p.startEditNote(`N${2 * i + 1}`);
        await p.page.getByTestId('sticky-textarea').fill(`edit ${i}`);
        await p.ensureNoEditing();
      }
      // Everyone's changes are visible on everyone's board.
      await expectEventually(
        'edit 0 visible on first board',
        async () => (await first.noteTexts()).includes('edit 0'),
      );

      // All participants press Ctrl+Z twice.
      for (const p of pages) {
        await p.page.keyboard.press('Control+z');
        await p.page.keyboard.press('Control+z');
      }

      // All boards identical to the initial state.
      for (const p of pages) {
        await expectEventually(
          `${p.name} board back to initial state`,
          async () => (await p.boardSnapshot()).join('|') === initial.join('|'),
        );
      }
    } finally {
      await closeAll(pages);
    }
  });
});
