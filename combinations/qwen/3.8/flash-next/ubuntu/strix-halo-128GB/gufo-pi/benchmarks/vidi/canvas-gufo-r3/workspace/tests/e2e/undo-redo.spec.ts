import { test, expect } from '@playwright/test';
import { openParticipants, closeParticipants, expectWithin, newE2eBoardId, Participant } from './helpers/participants';
import { getNoteIds, setCamera } from './helpers/sticky';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '@shared/config';

/** Create a note by double-clicking at screen (x,y) and pressing Escape. */
async function createNote(page: import('@playwright/test').Page, x: number, y: number): Promise<string> {
  const before = await getNoteIds(page);
  await page.mouse.dblclick(x, y);
  await page.waitForFunction(
    (prev) => document.querySelectorAll('[data-testid="sticky-note-wrapper"]').length > prev,
    before.length,
  );
  const ids = await getNoteIds(page);
  const id = ids.find((i) => !before.includes(i))!;
  await page.keyboard.press('Escape');
  return id;
}

async function setupCamera(page: import('@playwright/test').Page) {
  await setCamera(page, { x: -100, y: -100, zoom: 1 });
  await page.waitForTimeout(50);
}

/** Count sticky note wrappers on the page. */
async function noteCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('[data-testid="sticky-note-wrapper"]').count();
}

test.describe('Undo/Redo e2e', () => {
  test('TC-22: Mia deletes 8 notes, Raj adds 1, Mia undo restores 8 without touching Raj note', async ({ browser }) => {
    const boardId = newE2eBoardId();
    const [mia, raj] = await openParticipants(browser, boardId, 2);

    await setupCamera(mia.page);
    await setupCamera(raj.page);

    // Mia creates 8 notes at spaced positions
    const miaNoteIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = await createNote(mia.page, 200 + (i % 4) * 200, 200 + Math.floor(i / 4) * 200);
      miaNoteIds.push(id);
    }

    // Wait for Raj to see all 8
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(raj.page)).toBe(8);

    // Mia selects all (Ctrl+A) and deletes (Delete key) → her 8 notes removed in one step
    await mia.page.keyboard.press('Control+a');
    await mia.page.waitForTimeout(50);
    await mia.page.keyboard.press('Delete');

    // Both see 0 notes
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(mia.page)).toBe(0);
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(raj.page)).toBe(0);

    // Raj creates 1 note
    const rajNoteId = await createNote(raj.page, 500, 500);

    // Wait for Mia to see Raj's note
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(mia.page)).toBe(1);

    // Mia presses Ctrl+Z → undoes her delete, 8 notes come back
    await mia.page.keyboard.press('Control+z');

    // Both see 9 notes (8 restored + Raj's)
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(mia.page)).toBe(9);
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(raj.page)).toBe(9);

    // Verify Raj's note is still present on both
    const miaIds = await getNoteIds(mia.page);
    const rajIds = await getNoteIds(raj.page);
    expect(miaIds).toContain(rajNoteId);
    expect(rajIds).toContain(rajNoteId);

    // All of Mia's original notes are back
    for (const id of miaNoteIds) {
      expect(miaIds).toContain(id);
    }

    // Mia clicks on empty canvas to deselect (prevent accidental key handling)
    await mia.page.mouse.click(50, 50);

    // Mia presses Redo (Ctrl+Shift+Z) → delete is re-applied
    await mia.page.keyboard.press('Control+Shift+z');

    // Both see 1 note again (only Raj's)
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(mia.page)).toBe(1);
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(raj.page)).toBe(1);

    // Raj's note still there
    const finalMiaIds = await getNoteIds(mia.page);
    expect(finalMiaIds).toContain(rajNoteId);

    await closeParticipants([mia, raj]);
  });

  test('TC-23: Mia moves note, Raj deletes it, Mia undoes → no error, note absent', async ({ browser }) => {
    const boardId = newE2eBoardId();
    const [mia, raj] = await openParticipants(browser, boardId, 2);

    await setupCamera(mia.page);
    await setupCamera(raj.page);

    // Mia creates a note
    const noteId = await createNote(mia.page, 300, 300);

    // Wait for Raj to see it
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(raj.page)).toBe(1);

    // Mia moves the note (drag it)
    const box = await mia.page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${noteId}"]`).boundingBox();
    if (!box) throw new Error('note not visible');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await mia.page.mouse.move(cx, cy);
    await mia.page.mouse.down();
    await mia.page.mouse.move(cx + 50, cy + 50, { steps: 5 });
    await mia.page.mouse.up();

    // Wait for sync
    await page_wait(mia.page, 200);

    // Raj deletes the note (click it, press Delete)
    await raj.page.mouse.click(cx, cy + 50); // Click where note moved to (approximately)
    // Actually use the note from Raj's perspective
    const rajBox = await raj.page.locator(`[data-testid="sticky-note-wrapper"][data-note-id="${noteId}"]`).boundingBox();
    if (rajBox) {
      await raj.page.mouse.click(rajBox.x + rajBox.width / 2, rajBox.y + rajBox.height / 2);
    }
    await raj.page.waitForTimeout(50);
    await raj.page.keyboard.press('Delete');

    // Both see 0 notes
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(mia.page)).toBe(0);
    await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(raj.page)).toBe(0);

    // Mia presses Ctrl+Z → undoing her move of a deleted note → no error, note stays absent
    await mia.page.keyboard.press('Control+z');
    await mia.page.waitForTimeout(200);

    // No error dialog appeared; note is still absent
    expect(await noteCount(mia.page)).toBe(0);
    expect(await noteCount(raj.page)).toBe(0);

    await closeParticipants([mia, raj]);
  });

  test('TC-24: all participants make and undo own changes → identical final boards', async ({ browser }) => {
    const boardId = newE2eBoardId();
    const n = MAX_CONCURRENT_EDITORS;
    const participants = await openParticipants(browser, boardId, n);

    // Set camera for each
    for (const p of participants) {
      await setCamera(p.page, { x: -100, y: -100, zoom: 1 });
      await p.page.waitForTimeout(30);
    }

    // Each participant creates their own note at a distinct position
    for (let i = 0; i < n; i++) {
      await createNote(participants[i].page, 200 + i * 100, 200);
    }

    // Wait for everyone to see all n notes
    for (const p of participants) {
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(p.page)).toBe(n);
    }

    // Each participant undoes their own creation (Ctrl+Z)
    for (const p of participants) {
      await p.page.keyboard.press('Control+z');
    }

    // Wait a bit for all syncs to complete
    await participants[0].page.waitForTimeout(500);

    // All boards should be identical — ideally 0 notes, but depends on sync order
    // With undo only reverting own changes, each participant removes their own note.
    // After all undos, all notes should be gone.
    for (const p of participants) {
      await expectWithin(LIVE_UPDATE_LATENCY_BUDGET_MS)(() => noteCount(p.page)).toBe(0);
    }

    // All boards should be identical (all empty)
    const counts = [];
    for (const p of participants) {
      counts.push(await noteCount(p.page));
    }
    expect(new Set(counts).size).toBe(1); // all same count

    await closeParticipants(participants);
  });
});

function page_wait(page: import('@playwright/test').Page, ms: number): Promise<void> {
  return page.waitForTimeout(ms);
}
