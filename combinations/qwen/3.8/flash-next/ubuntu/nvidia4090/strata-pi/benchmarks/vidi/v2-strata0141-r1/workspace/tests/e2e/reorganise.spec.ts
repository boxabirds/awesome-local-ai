import { expect, test } from '@playwright/test';
import {
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { getCamera, near, openBoard } from './helpers/board';
import { getNotes, noteCard, topNoteIdAt } from './helpers/sticky';
import { objectBounds, type StickySnapshot } from '../../src/shared/board-model';
import {
  clickDeleteSelection,
  createNotesAt,
  dragHandle,
  dragObjectBy,
  marqueeSelect,
  notesById,
  resizeHandleCentre,
  selectionBarText,
  selectedIds,
  setFlatCamera,
  waitForSelectionBarText,
  waitForSelectedIds,
} from './helpers/selection';

/**
 * Story 7, task 15 - "Reorganise a cluster": box-select, move, resize, nudge,
 * delete (TC-32, TC-33, TC-34), in real browsers.
 *
 * Each test puts the camera at the world origin at 100%, so a board unit and a
 * screen pixel are the same number and a drag can be described in board units.
 */

/** A note's drawn size, falling back to the type default like the board does. */
const sizeOf = (note: StickySnapshot): { width: number; height: number } => {
  const bounds = objectBounds(note);
  return { width: bounds.width, height: bounds.height };
};

/**
 * The cluster under test, in board units: its bounds are 50..750 x 50..500, which
 * leaves room for every drag this test makes to stay inside the viewport. A
 * pointer that leaves the screen is a broken test, not a broken product.
 */
const CLUSTER = [
  { x: 150, y: 150 },
  { x: 450, y: 150 },
  { x: 750, y: 150 },
  { x: 150, y: 450 },
  { x: 450, y: 450 },
  { x: 750, y: 450 },
];

/** A note the group is moved onto. Created last, so it starts on top of them. */
const OTHER = { x: 1050, y: 250 };

/** A marquee that contains the whole cluster and nothing else. */
const MARQUEE = { from: { x: 20, y: 20 }, to: { x: 880, y: 580 } };

test.describe('story 7: reorganise a cluster', () => {
  test('TC-32: only what is completely inside the box is selected', async ({ page }) => {
    await openBoard(page);
    await setFlatCamera(page);
    // A is fully inside the box, B straddles its right edge, C is nowhere near it.
    const [a, b, c] = await createNotesAt(page, [
      { x: 300, y: 300 }, // 200..400
      { x: 600, y: 300 }, // 500..700
      { x: 1000, y: 650 }, // 900..1100
    ]);

    await marqueeSelect(page, { x: 150, y: 150 }, { x: 620, y: 520 });

    await waitForSelectedIds(page, [a!]);
    expect(await selectedIds(page)).toEqual([a!]);
    expect(await selectionBarText(page)).toBeNull(); // one object is not a group yet
    expect(await noteCard(page, b!).getAttribute('data-selected')).toBe('false');
    expect(await noteCard(page, c!).getAttribute('data-selected')).toBe('false');

    // The notes themselves are untouched: marqueeing selects, it does not move.
    const positions = await notesById(page);
    expect(near(positions.get(a!)!.x, 200)).toBe(true);
    expect(near(positions.get(b!)!.x, 500)).toBe(true);
    expect(near(positions.get(c!)!.x, 900)).toBe(true);
  });

  test('TC-33: a group move and a corner resize keep the group a group', async ({ page }) => {
    await openBoard(page);
    await setFlatCamera(page);
    const cluster = await createNotesAt(page, CLUSTER);
    const other = (await createNotesAt(page, [OTHER]))[0]!;

    await marqueeSelect(page, MARQUEE.from, MARQUEE.to);
    await waitForSelectionBarText(page, '6 selected');
    await waitForSelectedIds(page, cluster);

    // Move the whole group: the pointer grabs one note and 250 units later all
    // six have moved by exactly that, and none of them snapped back.
    const grabbed = cluster[0]!;
    const before = await notesById(page);
    await dragObjectBy(page, grabbed, 250, 60);
    const moved = await notesById(page);
    for (const id of cluster) {
      const was = before.get(id)!;
      const now = moved.get(id)!;
      expect(near(now.x - was.x, 250)).toBe(true);
      expect(near(now.y - was.y, 60)).toBe(true);
    }

    // The group now sits on top of the note it was dragged over.
    const overlapping = moved.get(cluster[2]!)!; // bounds 900..1100 x 110..310
    const top = await topNoteIdAt(page, { x: 1000, y: 200 });
    expect(top).toBe(`sticky-note-${overlapping.id}`);
    expect(moved.get(overlapping.id)!.z).toBeGreaterThan(moved.get(other)!.z);

    // Resize from the bottom-right corner: sizes and gaps scale together and the
    // notes stay square.
    const box = { left: 300, top: 110, right: 1100, bottom: 610 };
    const handle = await resizeHandleCentre(page, 'se');
    expect(near(handle.x, box.right, 2)).toBe(true);
    expect(near(handle.y, box.bottom, 2)).toBe(true);
    await dragHandle(page, 'se', 100, 100);

    const resized = await notesById(page);
    // The box is 800 x 500 and the corner moved 100 on each axis. The y axis moved
    // proportionally more, so the lock follows it: 600 / 500.
    const scale = 600 / 500;
    for (const id of cluster) {
      const was = moved.get(id)!; // the group's position just before the resize
      const now = resized.get(id)!;
      expect(near(sizeOf(now).width, STICKY_SIZE_WORLD * scale, 1)).toBe(true);
      expect(near(sizeOf(now).height, STICKY_SIZE_WORLD * scale, 1)).toBe(true);
      expect(near(now.x, box.left + (was.x - box.left) * scale, 1)).toBe(true);
      expect(near(now.y, box.top + (was.y - box.top) * scale, 1)).toBe(true);
    }
    // Gaps scale with the notes: 100 board units between neighbours became 120.
    const first = resized.get(cluster[0]!)!;
    const second = resized.get(cluster[1]!)!;
    expect(near(second.x - (first.x + sizeOf(first).width), 100 * scale, 1)).toBe(true);

    // The unselected note kept its own size.
    const untouched = resized.get(other)!;
    expect(near(sizeOf(untouched).width, STICKY_SIZE_WORLD, 1)).toBe(true);
    expect(near(sizeOf(untouched).height, STICKY_SIZE_WORLD, 1)).toBe(true);

    // Drag the same corner far past the group: nothing shrinks below the type minimum.
    await dragHandle(page, 'nw', 900, 500);
    const clamped = await notesById(page);
    for (const id of cluster) {
      const note = clamped.get(id)!;
      const size = sizeOf(note);
      expect(size.width).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
      expect(size.height).toBeGreaterThanOrEqual(STICKY_MIN_SIZE_WORLD);
      expect(near(size.width, size.height, 1)).toBe(true);
    }
    expect(near(sizeOf(clamped.get(cluster[0]!)!).width, STICKY_MIN_SIZE_WORLD, 1)).toBe(true);
    expect(await selectionBarText(page)).toBe('6 selected');
  });

  test('TC-34: arrows nudge the group without panning or scrolling, Delete removes it', async ({
    page,
  }) => {
    await openBoard(page);
    await setFlatCamera(page);
    const cluster = await createNotesAt(page, CLUSTER);
    await createNotesAt(page, [OTHER]);

    await marqueeSelect(page, MARQUEE.from, MARQUEE.to);
    await waitForSelectionBarText(page, '6 selected');

    const cameraBefore = await getCamera(page);
    const before = await notesById(page);

    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('ArrowUp');
    await page.keyboard.down('Shift');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.up('Shift');
    await page.waitForTimeout(120);

    const nudged = await notesById(page);
    for (const id of cluster) {
      const was = before.get(id)!;
      const now = nudged.get(id)!;
      expect(near(now.x - was.x, 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD)).toBe(true);
      expect(near(now.y - was.y, -NUDGE_STEP_WORLD)).toBe(true);
    }

    // Arrows moved the selection, not the page or the board.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const cameraAfter = await getCamera(page);
    expect(cameraAfter).toEqual(cameraBefore);

    // The selection bar's own control removes the whole group at once.
    await clickDeleteSelection(page);
    await page.waitForTimeout(120);
    const left = await getNotes(page);
    expect(left).toHaveLength(1);
    expect(left[0]!.id).not.toBe(cluster[0]);
    expect(await selectedIds(page)).toEqual([]);
    expect(await selectionBarText(page)).toBeNull();
  });
});
