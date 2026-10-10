import { expect, test, type Browser, type Page } from '@playwright/test';
import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import { createBoard, getNotes } from './helpers/board';
import { openParticipants, snapshotKey, type Participant } from './helpers/participants';
import { seedNotes } from './helpers/seed-client';

const PORT = Number(process.env.E2E_PORT ?? 22704);

async function openOnBoard(
  browser: Browser,
  boardId: string,
  name: string
): Promise<Participant> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  return { name, context, page };
}

async function createNote(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(({ x: cx, y: cy }) => window.__vidi6!.createNote({ x: cx, y: cy }), {
    x,
    y
  });
}

async function noteCount(page: Page): Promise<number> {
  return (await getNotes(page)).length;
}

async function waitForNotes(page: Page, count: number): Promise<void> {
  await expect
    .poll(() => noteCount(page), { timeout: 15_000 })
    .toBe(count);
}

async function boardsIdentical(pages: Page[]): Promise<boolean> {
  const keys = await Promise.all(pages.map(async (p) => snapshotKey(await getNotes(p))));
  return keys.every((k) => k === keys[0]);
}

test.describe('undo e2e', () => {
  // TC-22: Mia deletes all 8 notes, Raj keeps working, Mia undoes her delete
  // only — the 8 come back on both screens and Raj's new note is untouched;
  // Redo removes the 8 again.
  test('TC-22 undo recovers my mass delete without touching a colleague', async ({ browser }) => {
    test.setTimeout(120_000);
    const bootstrap = await browser.newContext();
    const boardId = await createBoard(bootstrap.request);
    await bootstrap.close();
    await seedNotes(PORT, boardId, 8);

    const mia = await openOnBoard(browser, boardId, 'mia');
    const raj = await openOnBoard(browser, boardId, 'raj');
    await waitForNotes(mia.page, 8);
    await waitForNotes(raj.page, 8);

    // Snapshot the 8 original notes from Mia's view for a fidelity compare.
    const before = snapshotKey(await getNotes(mia.page));

    await mia.page.keyboard.press('Control+a');
    await mia.page.keyboard.press('Delete');
    await waitForNotes(mia.page, 0);
    await waitForNotes(raj.page, 0);

    // Raj adds a note of his own while Mia's delete is already on the wire.
    const rajNote = await createNote(raj.page, 500, 500);
    await waitForNotes(mia.page, 1);
    await waitForNotes(raj.page, 1);

    await mia.page.keyboard.press('Control+z');
    await waitForNotes(mia.page, 9);
    await waitForNotes(raj.page, 9);

    // The 8 restored notes match their pre-delete state exactly (positions,
    // colours, z, text) and Raj's note is present on both screens.
    for (const p of [mia, raj]) {
      const notes = await getNotes(p.page);
      const restored = snapshotKey(notes.filter((n) => n.id !== rajNote));
      expect(restored).toBe(before);
      expect(notes.some((n) => n.id === rajNote)).toBe(true);
    }

    // Undo is exhausted (only the delete was ever captured); Redo re-removes 8.
    await expect(mia.page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await expect(mia.page.getByRole('button', { name: 'Redo' })).toBeEnabled();
    await mia.page.keyboard.press('Control+z');
    // Empty undo stack: a further Ctrl+Z is a no-op, the notes stay up.
    await waitForNotes(mia.page, 9);

    await mia.page.getByRole('button', { name: 'Redo' }).click();
    await waitForNotes(mia.page, 1);
    await waitForNotes(raj.page, 1);
    const afterRedo = await getNotes(raj.page);
    expect(afterRedo.length).toBe(1);
    expect(afterRedo[0].id).toBe(rajNote);
  });

  // TC-23: Mia moves a note she did NOT create; Raj deletes it; Mia's undo
  // inverse targets a deleted note -> no effect, no error, note stays gone.
  test('TC-23 undo after a colleague deleted the note I moved', async ({ browser }) => {
    test.setTimeout(120_000);
    const bootstrap = await browser.newContext();
    const boardId = await createBoard(bootstrap.request);
    await bootstrap.close();
    await seedNotes(PORT, boardId, 1);

    const mia = await openOnBoard(browser, boardId, 'mia');
    const raj = await openOnBoard(browser, boardId, 'raj');
    await waitForNotes(mia.page, 1);
    await waitForNotes(raj.page, 1);

    const notes = await getNotes(mia.page);
    const targetId = notes[0].id;
    const before = notes[0];

    // Mia nudges the note right (one undo step) with the arrow key.
    await mia.page.keyboard.press('Control+a');
    await mia.page.keyboard.press('ArrowRight');
    await expect
      .poll(
        async () => {
          const moved = await getNotes(mia.page);
          const m = moved.find((n) => n.id === targetId);
          return m !== undefined && m.x > before.x;
        },
        { timeout: 10_000 }
      )
      .toBe(true);

    // Raj deletes it.
    await raj.page.keyboard.press('Control+a');
    await raj.page.keyboard.press('Delete');
    await waitForNotes(mia.page, 0);
    await waitForNotes(raj.page, 0);

    // Mia undoes. The move inverse targets a note that no longer exists, so
    // nothing happens, but no error is thrown and the note stays gone on both.
    await mia.page.keyboard.press('Control+z');
    await waitForNotes(mia.page, 0);
    await waitForNotes(raj.page, 0);
    await expect(mia.page.getByRole('alert')).toHaveCount(0);
    await expect
      .poll(() => boardsIdentical([mia.page, raj.page]), { timeout: 10_000 })
      .toBe(true);
  });

  // TC-24: MAX_CONCURRENT_EDITORS tabs each create their own note, then each
  // undoes only its own — every other note stays, boards identical each step.
  test('TC-24 everyone undoes only their own change at once', async ({ browser }) => {
    test.setTimeout(180_000);
    const names = Array.from({ length: MAX_CONCURRENT_EDITORS }, (_, i) => `editor-${i}`);
    const parts = await openParticipants(browser, names);
    const pages = parts.map((p) => p.page);

    const createdIds: string[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const id = await createNote(pages[i], i * 300, 200);
      createdIds.push(id);
    }
    for (const page of pages) {
      await waitForNotes(page, MAX_CONCURRENT_EDITORS);
    }

    // Undo one participant at a time: only that participant's note vanishes on
    // every screen, all others remain, and all boards agree.
    for (let i = 0; i < parts.length; i += 1) {
      await pages[i].keyboard.press('Control+z');
      await expect
        .poll(
          async () => {
            const counts = await Promise.all(pages.map(noteCount));
            return counts.every((c) => c === MAX_CONCURRENT_EDITORS - i - 1);
          },
          { timeout: 10_000 }
        )
        .toBe(true);
      const notes = await getNotes(pages[i]);
      expect(notes.some((n) => n.id === createdIds[i])).toBe(false);
      for (let j = i + 1; j < parts.length; j += 1) {
        expect(notes.some((n) => n.id === createdIds[j])).toBe(true);
      }
      await expect
        .poll(() => boardsIdentical(pages), { timeout: 10_000 })
        .toBe(true);
    }
    await expect.poll(() => noteCount(pages[0]), { timeout: 10_000 }).toBe(0);
  });
});
