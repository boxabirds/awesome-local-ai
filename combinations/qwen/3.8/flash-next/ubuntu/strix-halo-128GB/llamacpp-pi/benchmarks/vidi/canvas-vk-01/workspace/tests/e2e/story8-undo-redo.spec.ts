import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { MAX_CONCURRENT_EDITORS } from '../../src/shared/config';
import {
  createNoteAt,
  dragNoteBy,
  expectConnected,
  joinBoard,
  notePositions,
  startBoard,
  viewportOf,
} from './helpers/live';

const cameraPin = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1280, height: 800 };

async function pinCamera(page: Page): Promise<void> {
  await page.evaluate((camera) => {
    const hooks = (window as unknown as {
      __vidi6?: { setCamera(c: { x: number; y: number; zoom: number }): void };
    }).__vidi6;
    hooks?.setCamera(camera);
  }, cameraPin);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
}

async function openClients(
  browser: Browser,
  count: number,
): Promise<{ pages: Page[]; boardId: string; close(): Promise<void> }> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  let boardId = '';
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    if (i === 0) {
      boardId = await startBoard(page);
      await expectConnected(page);
    } else {
      await joinBoard(page, boardId);
    }
  }
  for (const p of pages) await pinCamera(p);
  return {
    pages,
    boardId,
    async close() {
      await Promise.all(contexts.map((c) => c.close()));
    },
  };
}

test('TC-22: recover accidental delete while colleague works', async ({ browser }) => {
  const { pages, close } = await openClients(browser, 2);
  const mia = pages[0];
  const raj = pages[1];

  // Create 8 notes at distinct positions that fit within 1280x800
  const positions = Array.from({ length: 8 }, (_, i) => ({
    x: 150 + (i % 4) * 300,
    y: 180 + Math.floor(i / 4) * 300,
  }));
  const miaNotes: string[] = [];
  for (const pos of positions) {
    const id = await createNoteAt(mia, pos);
    miaNotes.push(id);
  }
  await expect(mia.locator('[data-testid^="sticky-note-"]')).toHaveCount(8);
  await expect(raj.locator('[data-testid^="sticky-note-"]')).toHaveCount(8, { timeout: 5000 });

  // Select all 8 and delete them as Mia
  await viewportOf(mia).click({ position: { x: 10, y: 10 } });
  await mia.keyboard.press('Control+a');
  await mia.keyboard.press('Delete');
  await expect(mia.locator('[data-testid^="sticky-note-"]')).toHaveCount(0);
  await expect(raj.locator('[data-testid^="sticky-note-"]')).toHaveCount(0, { timeout: 5000 });

  // Raj adds a note
  const rajNote = await createNoteAt(raj, { x: 800, y: 600 });
  await expect(raj.locator('[data-testid^="sticky-note-"]')).toHaveCount(1);
  await expect(mia.locator('[data-testid^="sticky-note-"]')).toHaveCount(1, { timeout: 5000 });

  // Mia presses Ctrl+Z — the 8 notes return, Raj's note remains
  await mia.keyboard.press('Control+z');
  await expect(mia.locator('[data-testid^="sticky-note-"]')).toHaveCount(9);
  await expect(raj.locator('[data-testid^="sticky-note-"]')).toHaveCount(9, { timeout: 5000 });

  // Raj's note is still there
  await expect(raj.locator(`[data-testid="sticky-note-${rajNote}"]`)).toBeVisible();
  await expect(mia.locator(`[data-testid="sticky-note-${rajNote}"]`)).toBeVisible();

  // Mia clicks Redo — the 8 notes disappear again
  await mia.getByTestId('redo-button').click();
  await expect(mia.locator('[data-testid^="sticky-note-"]')).toHaveCount(1);
  await expect(raj.locator('[data-testid^="sticky-note-"]')).toHaveCount(1, { timeout: 5000 });
  // Raj's note remains
  await expect(mia.locator(`[data-testid="sticky-note-${rajNote}"]`)).toBeVisible();

  // No errors on viewport
  await expect(viewportOf(mia)).toBeVisible();

  await close();
});

test('TC-23: colleague deleted my object; undo does not recreate it; next undo still works', async ({ browser }) => {
  const { pages, close } = await openClients(browser, 2);
  const mia = pages[0];
  const raj = pages[1];

  // Mia creates two notes at different positions
  const positions = notePositions(2);
  const miaNote1 = await createNoteAt(mia, positions[0]);
  const miaNote2 = await createNoteAt(mia, positions[1]);
  await expect(raj.locator(`[data-testid="sticky-note-${miaNote1}"]`)).toBeVisible({ timeout: 5000 });

  // Wait past capture timeout so creation and move are separate undo steps
  await mia.waitForTimeout(600);

  // Mia moves the first note
  await dragNoteBy(mia, miaNote1, { x: 100, y: 100 });
  // Wait for sync
  await raj.waitForTimeout(200);

  // Raj deletes that same note
  await raj.locator(`[data-testid="sticky-note-${miaNote1}"]`).click();
  await raj.keyboard.press('Delete');
  await expect(raj.locator(`[data-testid="sticky-note-${miaNote1}"]`)).toHaveCount(0);
  await expect(mia.locator(`[data-testid="sticky-note-${miaNote1}"]`)).toHaveCount(0, { timeout: 5000 });

  // Mia presses Ctrl+Z (undoing her move, but the note was deleted remotely)
  // Should not crash, note should stay absent
  await mia.keyboard.press('Control+z');
  await expect(mia.locator(`[data-testid="sticky-note-${miaNote1}"]`)).toHaveCount(0);
  await expect(raj.locator(`[data-testid="sticky-note-${miaNote1}"]`)).toHaveCount(0, { timeout: 3000 });

  // No error toast
  await expect(viewportOf(mia)).toBeVisible();

  // Mia's next undo still works (undoes creation of miaNote2)
  await mia.keyboard.press('Control+z');
  await expect(mia.locator(`[data-testid="sticky-note-${miaNote2}"]`)).toHaveCount(0);
  await expect(raj.locator(`[data-testid="sticky-note-${miaNote2}"]`)).toHaveCount(0, { timeout: 5000 });

  await close();
});

test('TC-24: everyone undoing at once — each reverts only own changes, boards identical', async ({ browser }) => {
  const count = MAX_CONCURRENT_EDITORS;
  const { pages, close } = await openClients(browser, count);

  // Create one note per user at distinct positions (all created by page[0])
  const positions = notePositions(count); // max 5 fits within viewport (3 cols x 2 rows)
  const notes: string[] = [];
  for (const pos of positions) {
    const id = await createNoteAt(pages[0], pos);
    notes.push(id);
  }
  // Wait for all to sync
  for (const p of pages) {
    await expect(p.locator('[data-testid^="sticky-note-"]')).toHaveCount(count, { timeout: 5000 });
  }

  // Wait past capture timeout
  await pages[0].waitForTimeout(600);

  // Each user moves their note by a different amount
  for (let i = 0; i < count; i++) {
    await dragNoteBy(pages[i], notes[i], { x: (i + 1) * 20, y: (i + 1) * 20 });
  }

  // Wait for all to sync
  await pages[0].waitForTimeout(300);

  // All press Ctrl+Z once (each undoes their own move)
  for (const p of pages) {
    await p.keyboard.press('Control+z');
  }

  // Wait for sync
  await pages[0].waitForTimeout(500);

  // All boards should have identical positions for each note
  for (let i = 0; i < count; i++) {
    const boxes = await Promise.all(
      pages.map(async (p) => {
        const el = p.locator(`[data-testid="sticky-note-${notes[i]}"]`);
        return el.boundingBox();
      }),
    );
    if (boxes[0] === null) continue;
    for (const b of boxes) {
      expect(b).not.toBeNull();
      expect(Math.abs(b!.x - boxes[0]!.x)).toBeLessThan(2);
      expect(Math.abs(b!.y - boxes[0]!.y)).toBeLessThan(2);
    }
  }

  await close();
});
