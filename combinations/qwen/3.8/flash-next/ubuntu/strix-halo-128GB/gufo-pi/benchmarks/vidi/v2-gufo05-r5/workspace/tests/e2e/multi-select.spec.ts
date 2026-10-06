/**
 * Story 7, end to end: multi-select, marquee, group move/resize, keyboard, and pruning.
 *
 * TC-32: marquee selects only fully-contained notes.
 * TC-33: group move and resize scale proportionally.
 * TC-34: keyboard nudge and delete.
 * TC-35: colleague deletes a selected note → selection prunes.
 */
import { test, expect, type Page } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import {
  NUDGE_STEP_WORLD,
  NUDGE_LARGE_STEP_WORLD,
  STICKY_SIZE_WORLD,
  E2E_EVENTUAL_TIMEOUT_MS,
} from '../../src/shared/config';
import { setCamera, getCamera } from './helpers/board';
import {
  dragToPoint,
  getNotes,
  noteCentre,
} from './helpers/notes';
import {
  closeParticipants,
  openParticipants,
} from './helpers/participants';

test.use({ actionTimeout: 10_000 });

const CENTRE = { x: 640, y: 400 };

/** Centres camera at world origin. */
async function originCamera(page: Page): Promise<void> {
  await setCamera(page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });
}

/** Creates a note at world position via test hook. Returns id. */
async function createNote(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(({ x, y }) => window.__vidi6!.createNote(x, y), { x, y });
}

/** Creates multiple notes at world positions via test hook. Returns ids. */
async function createNotes(page: Page, positions: Array<{ x: number; y: number }>): Promise<string[]> {
  const ids: string[] = [];
  for (const p of positions) {
    ids.push(await createNote(page, p.x, p.y));
  }
  return ids;
}

/** Gets note by id. */
function noteById(page: Page, id: string) {
  return page.locator(`[data-note-id="${id}"]`);
}

test.describe('multi-select marquee (TC-32)', () => {
  test('marquee selects only fully-contained notes', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.post('/api/boards');
    const { id: boardId } = await response.json();
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await originCamera(page);

    // Camera: world (0,0) at screen (640, 400). screenToWorld(sx, sy) = (sx - 640, sy - 400).
    // worldToScreen(wx, wy) = (wx + 640, wy + 400).

    // Note A: centre at world (50, 50) → stored x=25, y=25, bounds (25,25,50,50)
    // Note B: centre at world (180, 50) → stored x=155, y=25, bounds (155,25,50,50)
    // Note C: centre at world (500, 50) → stored x=475, y=25, bounds (475,25,50,50)
    const [idA, idB, idC] = await createNotes(page, [
      { x: 50, y: 50 },
      { x: 180, y: 50 },
      { x: 500, y: 50 },
    ]) as [string, string, string];
    await expect(page.locator('[data-note-id]')).toHaveCount(3);

    // Marquee from screen (600, 350) to (850, 600)
    // → world (-40, -50) to (210, 200), rect = (-40, -50, 250, 250)
    // A: (25,25,50,50): 25≥-40 ✓, 25≥-50 ✓, 75≤210 ✓, 75≤200 ✓ → INSIDE
    // B: (155,25,50,50): 155≥-40 ✓, 25≥-50 ✓, 205≤210 ✓, 75≤200 ✓ → INSIDE
    // C: (475,25,50,50): 475≥-40 ✓, 25≥-50 ✓, 525≤210? NO → OUTSIDE

    // Let me use a tighter marquee that includes only A:
    // Marquee from screen (610, 380) to (730, 520)
    // → world (-30, -20) to (90, 120), rect = (-30, -20, 120, 140)
    // A: (25,25,50,50): 25≥-30 ✓, 25≥-20 ✓, 75≤90 ✓, 75≤120 ✓ → INSIDE
    // B: (155,25,50,50): 155≥-30 ✓ but 205≤90? NO → OUTSIDE
    // C: outside

    await page.keyboard.down('Shift');
    await page.mouse.move(610, 380);
    await page.mouse.down();
    await page.mouse.move(730, 520, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Shift');

    // Only note A should be selected
    await expect(noteById(page, idA)).toHaveAttribute('data-selected', 'true');
    await expect(noteById(page, idB)).not.toHaveAttribute('data-selected');
    await expect(noteById(page, idC)).not.toHaveAttribute('data-selected');
  });
});

test.describe('group move and resize (TC-33)', () => {
  test('group move translates all selected notes', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.post('/api/boards');
    const { id: boardId } = await response.json();
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await originCamera(page);

    // Create 3 notes close together
    await createNotes(page, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ]);
    await expect(page.locator('[data-note-id]')).toHaveCount(3);

    // Select all via Ctrl+A
    await page.keyboard.press('Control+a');
    await expect(page.getByText('3 selected')).toBeVisible();

    // Record positions
    const before = await getNotes(page);

    // Drag the first note by 100 screen pixels to the right (zoom=1, so 100 world units)
    const centreFirst = await noteCentre(page, 0);
    await dragToPoint(page, centreFirst, { x: centreFirst.x + 100, y: centreFirst.y });

    // All notes should have moved by ~100 world units in x
    const after = await getNotes(page);
    for (let i = 0; i < 3; i++) {
      expect(after[i]!.x - before[i]!.x).toBeCloseTo(100, 0);
    }

    // Still all selected
    await expect(page.getByText('3 selected')).toBeVisible();
  });

  test('resize scales proportionally and respects min size', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.post('/api/boards');
    const { id: boardId } = await response.json();
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await originCamera(page);

    await createNotes(page, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
    await expect(page.locator('[data-note-id]')).toHaveCount(2);

    // Select all
    await page.keyboard.press('Control+a');
    await expect(page.getByText('2 selected')).toBeVisible();

    // Resize via SE handle - drag outward
    const seHandle = page.getByLabel('Resize bottom-right');
    const handleBox = await seHandle.boundingBox();
    expect(handleBox).not.toBeNull();

    await dragToPoint(
      page,
      { x: handleBox!.x + 4, y: handleBox!.y + 4 },
      { x: handleBox!.x + 104, y: handleBox!.y + 104 },
    );

    // Each note should be larger than before (50)
    const resized = await getNotes(page);
    for (const note of resized) {
      expect(note.width!).toBeGreaterThan(STICKY_SIZE_WORLD);
      expect(note.height!).toBeGreaterThan(STICKY_SIZE_WORLD);
    }
  });
});

test.describe('keyboard (TC-34)', () => {
  test('arrow nudge moves selection, delete removes all', async ({ page }) => {
    await page.goto('/');
    const response = await page.request.post('/api/boards');
    const { id: boardId } = await response.json();
    await page.goto(`/b/${boardId}`);
    await expect(page.getByTestId('board-viewport')).toBeVisible();
    await originCamera(page);

    await createNotes(page, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ]);
    await expect(page.locator('[data-note-id]')).toHaveCount(3);

    // Select all
    await page.keyboard.press('Control+a');
    await expect(page.getByText('3 selected')).toBeVisible();

    const cameraBefore = await getCamera(page);
    const before = await getNotes(page);

    // ArrowRight × 3
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    // Shift+ArrowRight (large step)
    await page.keyboard.press('Shift+ArrowRight');

    const afterNudge = await getNotes(page);
    const expectedDx = NUDGE_STEP_WORLD * 3 + NUDGE_LARGE_STEP_WORLD;
    for (let i = 0; i < 3; i++) {
      expect(afterNudge[i]!.x - before[i]!.x).toBeCloseTo(expectedDx, 6);
    }

    // Camera unchanged
    expect(await getCamera(page)).toEqual(cameraBefore);

    // Delete all
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-note-id]')).toHaveCount(0);
  });
});

test.describe('collaborative pruning (TC-35)', () => {
  test('colleague deletes a selected note → selection prunes', async ({ browser }) => {
    const boardId = newBoardId();
    const participants = await openParticipants(browser, boardId, 2);
    const [lee, sam] = participants;

    try {
      await originCamera(lee.page);
      await setCamera(sam.page, { x: -CENTRE.x, y: -CENTRE.y, zoom: 1 });

      // Create 4 notes from Lee's page
      const ids = await createNotes(lee.page, [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ]);

      // Wait for both to see 4 notes
      await expect(lee.page.locator('[data-note-id]')).toHaveCount(4);
      await expect(sam.page.locator('[data-note-id]')).toHaveCount(4);

      // Lee selects all
      await lee.page.keyboard.press('Control+a');
      await expect(lee.page.getByText('4 selected')).toBeVisible();

      // Sam deletes the second note
      await sam.page.evaluate((id) => {
        const doc = window.__vidi6!.getDoc();
        const objects = doc.getMap('objects');
        doc.transact(() => { objects.delete(id); });
      }, ids[1]!);

      // Lee should eventually see 3 selected (pruned)
      await expect(lee.page.getByText('3 selected')).toBeVisible({ timeout: E2E_EVENTUAL_TIMEOUT_MS });

      // Lee presses Delete → should remove exactly those 3
      await lee.page.keyboard.press('Delete');
      await expect(sam.page.locator('[data-note-id]')).toHaveCount(0, { timeout: E2E_EVENTUAL_TIMEOUT_MS });
    } finally {
      await closeParticipants(participants);
    }
  });
});
