import { test, expect } from '@playwright/test';
import {
  newBoardId,
  openBoard,
  closeAll,
  getNotes,
  notesKey,
  expectWithin,
  createNoteAt,
  dragNoteBy,
  deleteNote,
  getNote,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  MAX_CONCURRENT_EDITORS,
  type Participant,
} from './participants';
import { seedNotes } from './helpers/selection';

/**
 * Story 8 e2e (TC-22 to TC-24). Chromium, against the real worker + WebSocket.
 *
 * These are the only tests that can prove the *personal* undo scope end to end:
 * each participant's tab runs its own UndoController that tracks only its own
 * LOCAL_ORIGIN transactions, so undoing one person's change must never touch
 * anyone else's — verified across real, independently-synced browsers.
 */
test.describe('Story 8 undo e2e', () => {
  test.describe.configure({ timeout: 180_000 });

  test('TC-22 Mia deletes 8 while Raj adds a note; Mia undo restores the 8 on both screens, Redo removes them again', async ({ browser }) => {
    const boardId = newBoardId();
    const mia = await openBoard(browser, boardId);
    const raj = await openBoard(browser, boardId);
    try {
      // Mia's cluster of 8 notes (seeded with a non-local origin, so they are
      // NOT on either person's undo stack).
      const ids = [...Array(8)].map(() => crypto.randomUUID());
      await seedNotes(
        mia.page,
        ids.map((id, i) => ({ id, x: -500 + (i % 2) * 140, y: -260 + Math.floor(i / 2) * 140, z: i, size: 120 })),
      );
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Raj sees the 8 seeded notes', async () => (await getNotes(raj.page)).length === 8);

      // Mia selects everything and deletes it in ONE step.
      await mia.page.keyboard.press('Control+a');
      await mia.page.keyboard.press('Delete');
      await expect.poll(async () => (await getNotes(mia.page)).length, { timeout: 5000 }).toBe(0);
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Raj sees the 8 deleted', async () => (await getNotes(raj.page)).length === 0);

      // Raj adds his own note (his own LOCAL_ORIGIN change).
      const rajNoteId = await createNoteAt(raj.page, 900, 600);

      // Raj's note synced to Mia, so each screen now also carries it.
      const hasAll = (notes: Awaited<ReturnType<typeof getNotes>>) =>
        ids.every((x) => notes.some((y) => y.id === x)) && notes.some((y) => y.id === rajNoteId);
      const hasNone = (notes: Awaited<ReturnType<typeof getNotes>>) =>
        ids.every((x) => !notes.some((y) => y.id === x)) && notes.some((y) => y.id === rajNoteId);

      // Mia undoes her delete: the 8 come back on BOTH screens; Raj's note is
      // untouched (it is not on Mia's stack). Each screen: 8 + Raj's note = 9.
      await mia.page.keyboard.press('Control+z');
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Mia has the 8 restored plus Raj note', async () => {
        const n = await getNotes(mia.page);
        return n.length === 9 && hasAll(n);
      });
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Raj has the 8 restored plus his note', async () => {
        const n = await getNotes(raj.page);
        return n.length === 9 && hasAll(n);
      });

      // Mia redoes: the 8 are removed again on both screens; only Raj's note
      // remains on each.
      await mia.page.keyboard.press('Control+Shift+z');
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Mia has only Raj note', async () => {
        const n = await getNotes(mia.page);
        return n.length === 1 && hasNone(n);
      });
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Raj has only his note', async () => {
        const n = await getNotes(raj.page);
        return n.length === 1 && hasNone(n);
      });
    } finally {
      await closeAll(mia, raj);
    }
  });

  test('TC-23 Mia moves a note that Raj deletes; Mia undoes with no error and the note stays absent on both', async ({ browser }) => {
    const boardId = newBoardId();
    const mia = await openBoard(browser, boardId);
    const raj = await openBoard(browser, boardId);
    const pageErrors: string[] = [];
    mia.page.on('pageerror', (err) => pageErrors.push(`Mia: ${err.message}`));
    raj.page.on('pageerror', (err) => pageErrors.push(`Raj: ${err.message}`));
    try {
      // One note (seeded remotely, so only Mia's move is on her stack).
      const id = crypto.randomUUID();
      await seedNotes(mia.page, [{ id, x: -60, y: -20, z: 0, size: 120 }]);
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Raj sees the note', async () => (await getNote(raj.page, id)) !== null);

      // Mia moves it (her one own step).
      await dragNoteBy(mia.page, id, 120, 0);
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Raj sees the move', async () => {
        const n = await getNote(raj.page, id);
        return n !== null && Math.abs(n.x - 60) < 2;
      });

      // Raj deletes it (remote delete).
      await deleteNote(raj.page, id);
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'Mia sees it deleted', async () => (await getNote(mia.page, id)) === null);

      // Mia undoes: the inverse move targets the (deleted) note, so it has no
      // effect and must not throw; the note stays absent on both screens.
      await mia.page.keyboard.press('Control+z');
      await expect
        .poll(async () => (await getNote(mia.page, id)) === null, { timeout: 5000, message: 'note must stay absent on Mia' })
        .toBe(true);
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'note stays absent on Raj', async () => (await getNote(raj.page, id)) === null);

      // The "no error" requirement: neither tab threw an uncaught error.
      expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
    } finally {
      await closeAll(mia, raj);
    }
  });

  test('TC-24 all MAX_CONCURRENT_EDITORS make and undo their own changes concurrently; final boards identical and each own change reverted', async ({ browser }) => {
    const N = MAX_CONCURRENT_EDITORS;
    const boardId = newBoardId();
    const parts: Participant[] = [];
    for (let i = 0; i < N; i += 1) parts.push(await openBoard(browser, boardId));
    const pageErrors: string[] = [];
    for (const p of parts) p.page.on('pageerror', (err) => pageErrors.push(`p: ${err.message}`));
    try {
      // Three shared notes (remote origin) — the same on every screen.
      const seeded = [...Array(3)].map(() => crypto.randomUUID());
      await seedNotes(
        parts[0].page,
        seeded.map((id, i) => ({ id, x: -520 + i * 140, y: -220, z: i, size: 120 })),
      );
      for (const p of parts) {
        await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, 'everyone sees the 3 seeded notes', async () => (await getNotes(p.page)).length === 3);
      }

      // Each participant creates one note at a distinct (empty) spot — their
      // own LOCAL_ORIGIN change, so it lands only on their own undo stack.
      const spots = [
        [820, 560],
        [940, 560],
        [1060, 560],
        [820, 680],
        [940, 680],
      ];
      const created: string[] = [];
      for (let i = 0; i < N; i += 1) created.push(await createNoteAt(parts[i].page, spots[i][0], spots[i][1]));
      for (let i = 0; i < N; i += 1) {
        await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, `p${i} sees 3 + ${N} = ${3 + N} notes`, async () => (await getNotes(parts[i].page)).length === 3 + N);
      }

      // Each participant undoes their own change (Ctrl+Z). Only their own note
      // is on their stack, so each revert removes exactly their own note.
      for (let i = 0; i < N; i += 1) await parts[i].page.keyboard.press('Control+z');

      // Final boards are identical (back to the 3 seeded notes) and each
      // participant's own note is gone.
      const keys = new Set<string>();
      for (let i = 0; i < N; i += 1) {
        await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS, `p${i} back to the 3 seeded notes`, async () => (await getNotes(parts[i].page)).length === 3);
        const notes = await getNotes(parts[i].page);
        expect(notes.some((n) => n.id === created[i]), `p${i}'s own note should be reverted`).toBe(false);
        keys.add(notesKey(notes));
      }
      expect(keys.size, 'all final boards should be identical').toBe(1);
      expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toHaveLength(0);
    } finally {
      await closeAll(...parts);
    }
  });
});
