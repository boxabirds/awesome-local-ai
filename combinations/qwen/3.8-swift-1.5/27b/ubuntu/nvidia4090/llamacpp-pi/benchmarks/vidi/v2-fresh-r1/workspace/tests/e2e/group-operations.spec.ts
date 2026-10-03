// E2E tests for story 7: select, move, resize and delete several objects
// at once. TC-32 to TC-36.

import { expect, test, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  MAX_CONCURRENT_EDITORS,
} from '../../src/shared/config';
import {
  marqueeSelect,
  selectionCountText,
} from './helpers/board';
import {
  closeParticipant,
  joinBoard,
  noteLocator,
  notesSnapshot,
  openParticipant,
  waitForNotes,
  type Participant,
} from './helpers/participants';
import { gotoFreshBoard } from './helpers/goto-board';

const TOLERANCE_PX = 3;

/** Create a note centred at screen (x, y), then deselect. */
async function createNoteAtDeselected(page: Page, x: number, y: number) {
  await page.mouse.dblclick(x, y);
  await noteLocator(page).last().waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  // Click empty space (bottom-left corner is always empty in our layouts).
  await page.mouse.click(20, 780);
}

/**
 * Screen bounding boxes of all notes, sorted by (y, x). Sorting by position
 * (not DOM order) keeps indices stable across z-order changes: bringing a
 * group to the front reorders the DOM, but the layout rows stay the same.
 */
async function noteBoxes(page: Page) {
  const boxes = await noteLocator(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
  return boxes.sort((a, b) => a.y - b.y || a.x - b.x);
}

test.describe('story 7: select, move, resize and delete several objects at once', () => {
  // TC-32: A inside, B half inside, C outside → only A selected.
  test('TC-32 marquee selects only fully-inside objects', async ({ page }) => {
    await gotoFreshBoard(page);

    // Three notes in a row (world = screen - (640, 400) at default camera):
    // A world x -440..-240, B world x -100..100, C world x 240..440.
    await createNoteAtDeselected(page, 300, 300); // A
    await createNoteAtDeselected(page, 640, 300); // B
    await createNoteAtDeselected(page, 980, 300); // C

    // Marquee world x -440..-80: fully contains A, half-overlaps B, misses C.
    await marqueeSelect(page, 200, 150, 560, 450);

    const selected = page.locator('[data-testid="sticky-note"][data-selected]');
    await expect(selected).toHaveCount(1);
    // The selected one is A (the leftmost).
    const first = noteLocator(page).first();
    expect(await first.getAttribute('data-selected')).not.toBeNull();
  });

  // TC-33: 6 notes move 300 units together above a 4th note; corner resize
  // scales sizes and gaps; notes stay square.
  test('TC-33 group move and corner resize scale sizes and gaps', async ({ page }) => {
    await gotoFreshBoard(page);

    // 3x2 grid of 6 notes (screen 150..850 x 100..550) plus one unselected
    // note below the grid (590..790). Dragging the group 300 px right puts
    // it entirely above (smaller y than) the 7th note, on-screen.
    const grid: [number, number][] = [
      [250, 200],
      [500, 200],
      [750, 200],
      [250, 450],
      [500, 450],
      [750, 450],
    ];
    for (const [x, y] of grid) await createNoteAtDeselected(page, x, y);
    await createNoteAtDeselected(page, 250, 690); // the note below the grid

    // Marquee the 6; the 7th is outside.
    await marqueeSelect(page, 110, 60, 890, 570);
    await expect(page.locator('[data-testid="sticky-note"][data-selected]')).toHaveCount(6);

    const before = await noteBoxes(page);

    // Drag the group 300 screen px right (zoom 1 → 300 world).
    await page.mouse.move(250, 200);
    await page.mouse.down();
    await page.mouse.move(550, 200, { steps: 10 });
    await page.mouse.up();

    const afterMove = await noteBoxes(page);
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(afterMove[i].x - (before[i].x + 300))).toBeLessThanOrEqual(TOLERANCE_PX);
      expect(Math.abs(afterMove[i].y - before[i].y)).toBeLessThanOrEqual(TOLERANCE_PX);
    }
    // The 7th note did not move.
    expect(Math.abs(afterMove[6].x - before[6].x)).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(afterMove[6].y - before[6].y)).toBeLessThanOrEqual(TOLERANCE_PX);
    // The group is now above the 7th note (its bottom edge is higher).
    expect(Math.max(...afterMove.slice(0, 6).map((b) => b.y + b.height))).toBeLessThan(
      afterMove[6].y,
    );

    // Corner-resize the selection: drag the SE handle out by (100, 100).
    const se = page.getByTestId('resize-handle-se');
    const seBox = await se.boundingBox();
    expect(seBox).not.toBeNull();
    await page.mouse.move(seBox!.x + seBox!.width / 2, seBox!.y + seBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(seBox!.x + 100, seBox!.y + 100, { steps: 10 });
    await page.mouse.up();

    const afterResize = await noteBoxes(page);
    // Selection box was 700x650 world; SE drag (100,100) with locked aspect
    // → width 800 → uniform scale factor 800/700.
    const factor = 800 / 700;
    for (let i = 0; i < 6; i++) {
      const b = afterResize[i];
      // Notes stay square.
      expect(Math.abs(b.width - b.height)).toBeLessThanOrEqual(2);
      // Sizes scaled by the factor.
      expect(Math.abs(b.width - 200 * factor)).toBeLessThanOrEqual(TOLERANCE_PX);
    }
    // Gaps scaled by the same factor (centre-to-centre x distance).
    const gapBefore = before[1].x - before[0].x;
    const gapAfter = afterResize[1].x - afterResize[0].x;
    expect(Math.abs(gapAfter - gapBefore * factor)).toBeLessThanOrEqual(TOLERANCE_PX + 2);
  });

  // TC-34: arrows move the selection without page scroll or board pan;
  // Delete removes all.
  test('TC-34 arrow keys nudge without scroll/pan; Delete removes the group', async ({
    page,
  }) => {
    await gotoFreshBoard(page);
    await createNoteAtDeselected(page, 400, 300);
    await createNoteAtDeselected(page, 700, 300);

    await marqueeSelect(page, 250, 150, 850, 450);
    await expect(page.locator('[data-testid="sticky-note"][data-selected]')).toHaveCount(2);

    const before = await noteBoxes(page);
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');

    const after = await noteBoxes(page);
    const scrollAfter = await page.evaluate(() => window.scrollY);

    // Both notes nudged by (+1, -1) screen px (zoom 1, 1 world unit) —
    // any camera pan would shift every note together and break this.
    for (let i = 0; i < 2; i++) {
      expect(Math.abs(after[i].x - (before[i].x + 1))).toBeLessThanOrEqual(1);
      expect(Math.abs(after[i].y - (before[i].y - 1))).toBeLessThanOrEqual(1);
    }
    // No page scroll.
    expect(scrollAfter).toBe(scrollBefore);

    // Delete removes all selected.
    await page.keyboard.press('Delete');
    await expect(noteLocator(page)).toHaveCount(0);
  });

  // TC-35: Sam deletes one of Lee's selected notes → Lee's count drops by 1.
  test('TC-35 remote delete prunes the selection', async ({ browser }) => {
    const lee = await openParticipant(browser);
    try {
      // Lee creates 3 notes and selects them all.
      await createNoteAtDeselected(lee.page, 300, 300);
      await createNoteAtDeselected(lee.page, 600, 300);
      await createNoteAtDeselected(lee.page, 900, 300);
      await marqueeSelect(lee.page, 150, 150, 1050, 450);
      await expect
        .poll(() => selectionCountText(lee.page), { timeout: 5000 })
        .toBe('3 selected');

      // Sam joins and deletes the middle note.
      const sam = await openParticipant(browser);
      try {
        await joinBoard(sam.page, lee.boardId);
        await waitForNotes(sam.page, 3);
        const middle = noteLocator(sam.page).nth(1);
        const box = (await middle.boundingBox())!;
        await sam.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await sam.page.keyboard.press('Delete');
      } finally {
        await closeParticipant(sam);
      }

      // Lee's selection count drops to 2 (eventual delivery).
      await expect
        .poll(() => selectionCountText(lee.page), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe('2 selected');
      await waitForNotes(lee.page, 2);
    } finally {
      await closeParticipant(lee);
    }
  });

  // TC-36: MAX_CONCURRENT_EDITORS contexts move different selections
  // simultaneously → identical final positions.
  test('TC-36 concurrent group moves converge to identical positions', async ({ browser }) => {
    const first = await openParticipant(browser);
    const participants: Participant[] = [first];
    try {
      // Lee creates one note per participant, in a row.
      for (let i = 0; i < MAX_CONCURRENT_EDITORS; i++) {
        await createNoteAtDeselected(first.page, 200 + i * 220, 300);
      }

      // Everyone else joins.
      for (let i = 1; i < MAX_CONCURRENT_EDITORS; i++) {
        const p = await openParticipant(browser);
        await joinBoard(p.page, first.boardId);
        await waitForNotes(p.page, MAX_CONCURRENT_EDITORS);
        participants.push(p);
      }

      // Each participant selects their own note and drags it by a different
      // amount — truly simultaneously (one drag per context, in parallel).
      await Promise.all(
        participants.map(async (p, i) => {
          const note = noteLocator(p.page).nth(i);
          const box = (await note.boundingBox())!;
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          await p.page.mouse.move(cx, cy);
          await p.page.mouse.down();
          await p.page.mouse.move(cx + 40 * (i + 1), cy, { steps: 5 });
          await p.page.mouse.up();
        }),
      );

      // Every context converges to the same final layout (eventual
      // consistency: poll until all views agree with each other).
      const allSnapshots = () =>
        Promise.all(participants.map((p) => notesSnapshot(p.page)));
      await expect
        .poll(async () => {
          const all = await allSnapshots();
          const [ref, ...rest] = all;
          const refJson = JSON.stringify(ref);
          return rest.every((s) => JSON.stringify(s) === refJson);
        }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
        .toBe(true);
    } finally {
      for (const p of participants) await closeParticipant(p);
    }
  });
});