// E2E tests for story 8 (undo.controls): TC-22 to TC-24. Runs against
// `dev:test` (wrangler dev) like the other e2e specs; multi-participant
// tests use isolated browser contexts. These are the only tests that prove
// a real provider's remote origin is never captured: after my undo/redo,
// every participant's screen shows my change reverted and everyone else's
// changes intact.

import { expect, test } from '@playwright/test';
import {
  collectErrors,
  connectParticipants,
  disposeAll,
  expectWithin,
  getNotes,
  newBoard,
  sortedNotes,
  type Participant,
} from './helpers/participants';
import { MAX_CONCURRENT_EDITORS, STICKY_SIZE_WORLD } from '../../src/shared/config';

type Page = import('@playwright/test').Page;

/** Seeding helper (test mode only): creates a note centred on (x, y). */
async function createNoteAt(page: Page, x: number, y: number): Promise<string> {
  const id = await page.evaluate(([px, py]) => window.__vidi6?.createSticky(px, py) ?? null, [x, y]);
  if (id === null) throw new Error('seed hook unavailable');
  await page.locator('[data-testid="sticky-note"][data-id="' + id + '"]').waitFor();
  return id;
}

/** Drags the note with `id` by (dx, dy) screen pixels via the real gesture. */
async function dragNote(page: Page, id: string, dx: number, dy: number): Promise<void> {
  const box = (await page.locator('[data-testid="sticky-note"][data-id="' + id + '"]').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
}

/** Shift+drag a marquee from (x1,y1) to (x2,y2) in screen space. */
async function marqueeSelect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

/** Double-clicks a note, types `text` into its editor, then Escape. */
async function typeInNote(page: Page, id: string, text: string): Promise<void> {
  const box = (await page.locator('[data-testid="sticky-note"][data-id="' + id + '"]').boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  const input = page.getByTestId('sticky-editor-input');
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

test.describe('story 8: per-person undo/redo (e2e)', () => {
  test('TC-22: Mia deletes 8, Raj adds a note, Mia undoes → 8 back on both screens, Raj\'s note remains; redo removes 8 again', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [mia, raj] = await connectParticipants(browser, boardId, 2);
    try {
      // Raj seeds 8 notes in a 2×4 cluster centred on the origin. Seeding
      // them from Raj (a remote origin for Mia) keeps Mia's undo stack free of
      // setup steps: her ONLY step will be the delete, so "history exhausted"
      // is well-defined after her single undo.
      const ids: string[] = [];
      for (let i = 0; i < 8; i++) {
        ids.push(await createNoteAt(raj.page, 200 * (i % 4) - 300, 200 * Math.floor(i / 4) - 100));
      }
      await expectWithin(async () => (await getNotes(mia.page)).length).toBe(8);

      // Mia box-selects the cluster and presses Delete: ONE of her steps.
      // (Story 7: the marquee must fully contain a note to select it, so the
      // rect spans the whole viewport — the cluster sits inside it.)
      await marqueeSelect(mia.page, 50, 50, 1230, 750);
      await mia.page.keyboard.press('Delete');
      await expectWithin(async () => (await getNotes(mia.page)).length).toBe(0);
      await expectWithin(async () => (await getNotes(raj.page)).length).toBe(0);

      // Raj adds his own note in the meantime (outside the marquee rect).
      const rajId = await createNoteAt(raj.page, 300, -280);
      await expectWithin(async () => (await getNotes(mia.page)).length).toBe(1);

      // Mia undoes: her 8 come back on BOTH screens; Raj's note is untouched.
      await mia.page.keyboard.press('Control+z');
      await expectWithin(async () => (await getNotes(mia.page)).length).toBe(9);
      await expectWithin(async () => (await getNotes(raj.page)).length).toBe(9);
      const rajBoard = await sortedNotes(raj.page);
      expect(rajBoard.map((n) => n.id)).toContain(rajId);
      for (const id of ids) expect(rajBoard.map((n) => n.id)).toContain(id);
      // Mia's history is exhausted: Undo is disabled, Redo is enabled.
      await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeDisabled();
      await expect(mia.page.getByRole('button', { name: 'Redo' })).toBeEnabled();

      // Mia clicks the Redo button: the 8 go away again on both screens;
      // Raj's note remains. The delete step returns to her undo stack, so
      // Undo is enabled again.
      await mia.page.getByRole('button', { name: 'Redo' }).click();
      await expectWithin(async () => (await getNotes(mia.page)).length).toBe(1);
      await expectWithin(async () => (await getNotes(raj.page)).length).toBe(1);
      const final = await sortedNotes(raj.page);
      expect(final[0]?.id).toBe(rajId);
      await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeEnabled();
      await expect(mia.page.getByRole('button', { name: 'Redo' })).toBeDisabled();
    } finally {
      await disposeAll([mia, raj]);
    }
  });

  test('TC-23: Mia moves a note, Raj deletes it, Mia undoes → no error, note absent on both', async ({
    browser,
  }) => {
    const boardId = newBoard();
    const [mia, raj] = await connectParticipants(browser, boardId, 2);
    try {
      const id = await createNoteAt(mia.page, 0, 0);
      await expectWithin(async () => (await getNotes(raj.page)).some((n) => n.id === id)).toBe(true);

      const errorsMia = collectErrors(mia.page);
      const errorsRaj = collectErrors(raj.page);

      // Mia moves the note (one gesture step on her stack).
      await dragNote(mia.page, id, 150, 80);

      // Raj deletes it in the meantime.
      await raj.page.evaluate((nid: string) => window.__vidi6?.deleteSticky(nid), id);
      await expectWithin(async () => (await getNotes(mia.page)).some((n) => n.id === id)).toBe(false);

      // Mia undoes: the top of her stack targets a deleted object — the
      // inverse has no effect, nothing is thrown, and the note stays absent
      // on both screens (it is NOT recreated by undoing its move).
      await mia.page.keyboard.press('Control+z');
      expect(errorsMia()).toEqual([]);
      expect(errorsRaj()).toEqual([]);
      expect((await getNotes(mia.page)).some((n) => n.id === id)).toBe(false);
      expect((await getNotes(raj.page)).some((n) => n.id === id)).toBe(false);
    } finally {
      await disposeAll([mia, raj]);
    }
  });

  test('TC-24: all MAX_CONCURRENT_EDITORS make and undo own changes concurrently → identical final boards, each own change reverted', async ({
    browser,
  }) => {
    // Five real browser contexts against one local wrangler dev: give the
    // connections (and the concurrent work) more headroom than 30 s.
    test.setTimeout(90_000);
    const boardId = newBoard();
    const participants: Participant[] = await connectParticipants(browser, boardId, MAX_CONCURRENT_EDITORS);
    try {
      const N = MAX_CONCURRENT_EDITORS;
      // Seed N notes in a centred row (seeded by the first participant; they
      // sync to everyone). The camera centres the world origin, so spread them
      // symmetrically to keep every note on-screen and draggable. createSticky
      // centres the note on (x, y); entry x/y are the top-left corner.
      const cx = Array.from({ length: N }, (_, i) => 200 * (i - (N - 1) / 2));
      const seeded: string[] = [];
      for (let i = 0; i < N; i++) {
        seeded.push(await createNoteAt(participants[0].page, cx[i], 0));
      }
      await Promise.all(
        participants.map((p) =>
          expectWithin(async () => (await getNotes(p.page)).length).toBe(N),
        ),
      );

      // Phase 1: each editor concurrently moves THEIR OWN note.
      await Promise.all(participants.map((p, i) => dragNote(p.page, seeded[i], 40, 20)));
      // Phase 2: each editor types into a DIFFERENT note (the next one in the
      // ring) — while nobody is dragging.
      await Promise.all(participants.map((p, i) => typeInNote(p.page, seeded[(i + 1) % N], 'x')));
      // Phase 3: everyone undoes twice: their own typing, then their own move.
      await Promise.all(
        participants.map(async (p) => {
          await p.page.keyboard.press('Control+z');
          await p.page.keyboard.press('Control+z');
        }),
      );

      // Every board converges to the identical seeded state: notes back at
      // their start, text cleared, nobody's change left behind (poll within
      // the live-update budget).
      const expectState = async (p: Participant) => {
        const notes = await getNotes(p.page);
        if (notes.length !== N) return false;
        for (let i = 0; i < N; i++) {
          const n = notes.find((m) => m.id === seeded[i]);
          if (!n || n.x !== cx[i] - STICKY_SIZE_WORLD / 2 || n.y !== -STICKY_SIZE_WORLD / 2 || n.text !== '') return false;
        }
        return true;
      };
      await expectWithin(async () => {
        for (const p of participants) if (!(await expectState(p))) return false;
        return true;
      }).toBe(true);
      // Boards are identical across all editors.
      const snapshots = await Promise.all(participants.map((p) => sortedNotes(p.page)));
      for (let i = 1; i < snapshots.length; i++) {
        expect(snapshots[i]).toEqual(snapshots[0]);
      }
    } finally {
      await disposeAll(participants);
    }
  });
});
