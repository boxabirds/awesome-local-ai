/**
 * Selecting, moving, resizing and deleting several objects at once (story 7), in a real
 * browser against `wrangler dev`.
 *
 * What these tests add over the component tests is the thing jsdom cannot give: painted
 * geometry. The marquee has to be drawn where the pointer says it is, the handles have to
 * sit where the bounding box says they sit, and a group dragged on to another note has to
 * be *drawn* above it.
 *
 * TC-32 (sel.marquee_ui)  a marquee takes what fits inside it and nothing else
 * TC-33 (sel.transform)   six notes move together, resize together, and stop at the minimum
 * TC-34 (sel.keyboard)    nudges move the selection while neither the page nor the view moves
 * TC-35 (sel.interaction) another person deletes one of my notes and my selection shrinks
 * TC-36 (sel.transform)   five people move different selections at once and end up agreeing
 */
import { expect, test, type Browser } from '@playwright/test';

import {
  MAX_CONCURRENT_EDITORS,
  NUDGE_LARGE_STEP_WORLD,
  NUDGE_STEP_WORLD,
  STICKY_MIN_SIZE_WORLD,
  STICKY_SIZE_WORLD,
} from '../../src/shared/config';
import { openFreshBoard, readCamera, withinTolerance } from './helpers/board';
import {
  NOTE_TOOLBAR,
  dragHandle,
  dragMarquee,
  expectSelectedCount,
  handleCount,
  marqueeEnd,
  marqueeStart,
  outlineCount,
  placeNotes,
  readObjects,
  selectedIds,
  selectionCountText,
  objectIdAtPoint,
} from './helpers/selection';
import {
  openBoard,
  waitForChange,
  waitForIdenticalBoards,
  type Participant,
} from './helpers/participants';

const close = (actual: number, expected: number, tolerance = 1): boolean =>
  withinTolerance(actual, expected, tolerance);

/** A 3 x 2 grid of note centres, far enough apart that nothing overlaps. */
const GRID = [
  { x: 250, y: 250 },
  { x: 550, y: 250 },
  { x: 850, y: 250 },
  { x: 250, y: 550 },
  { x: 550, y: 550 },
  { x: 850, y: 550 },
];

/** Look one object up by id in a list read from the screen. */
function pick<T extends { id: string }>(objects: readonly T[], id: string): T {
  const found = objects.find((object) => object.id === id);
  if (!found) throw new Error(`no object ${id} on screen`);
  return found;
}

test.describe('workflow 1: reorganise a cluster of notes', () => {
  test('TC-32 a marquee selects the notes inside it and leaves the rest', async ({ page }) => {
    await openFreshBoard(page);
    // Three notes in a row. A note is 200 board units, which at 100 % zoom is 200 CSS
    // pixels, so A spans x 200-400, B x 600-800 and C x 1000-1200, all of them y 300-500.
    const [a, b, c] = await placeNotes(page, [
      { x: 300, y: 400 },
      { x: 700, y: 400 },
      { x: 1100, y: 400 },
    ]);
    await page.keyboard.press('Escape');
    expect(await selectedIds(page)).toHaveLength(0);

    // Drag the rectangle with the pointer still down, and look at it while it is there.
    await marqueeStart(page, { x: 150, y: 250 }, { x: 650, y: 560 });
    await expect(page.getByTestId('marquee')).toBeVisible();
    await marqueeEnd(page);

    // B is cut by the rectangle's right edge and C never touched it: only A is selected.
    await expectSelectedCount(page, 1);
    expect(await selectedIds(page)).toEqual([a]);
    const selected = await selectedIds(page);
    expect(selected).not.toContain(b);
    expect(selected).not.toContain(c);
    expect(await outlineCount(page)).toBe(1);
    // One sticky note selected is the note's own tools, not the group's count and delete.
    await expect(page.locator(NOTE_TOOLBAR)).toBeVisible();
    expect(await selectionCountText(page)).toBeNull();
  });

  test('TC-33 a group moves together, resizes together, and stops when it gets too small', async ({
    page,
  }) => {
    await openFreshBoard(page);
    const ids = await placeNotes(page, GRID);
    // A note nobody selected, sitting where the group is about to land.
    const [passed] = await placeNotes(page, [{ x: 1150, y: 250 }]);
    await page.keyboard.press('Escape');

    await dragMarquee(page, { x: 100, y: 100 }, { x: 1000, y: 700 });
    await expectSelectedCount(page, 6);
    expect(await handleCount(page)).toBe(8);

    // Move: grab the middle note of the selection and drag the group 300 units right.
    const before = await readObjects(page);
    await page.mouse.move(550, 250);
    await page.mouse.down();
    await page.mouse.move(850, 250, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(120);

    const moved = await readObjects(page);
    for (const id of ids) {
      const from = pick(before, id);
      const to = pick(moved, id);
      expect(close(to.x - from.x, 300)).toBe(true);
      expect(close(to.y - from.y, 0)).toBe(true);
    }
    expect(close(pick(moved, passed!).x, pick(before, passed!).x)).toBe(true);

    // The group crossed the note nobody selected and is drawn above it: every dragged
    // note now out-ranks it, and where they overlap the browser paints a dragged note.
    for (const id of ids) {
      expect(pick(moved, id).z).toBeGreaterThan(pick(moved, passed!).z);
    }
    const onTop = await objectIdAtPoint(page, { x: 1150, y: 250 });
    expect(onTop).not.toBe(passed);
    expect(ids).toContain(onTop);

    // Resize: the selection's south-east handle, pulled back 200 units. The notes are
    // square and aspect-locked, so notes and the gaps between them scale by one factor.
    const sized = await readObjects(page);
    const group = ids.map((id) => pick(sized, id));
    const widthOf = (list: readonly { x: number; width: number }[]): number =>
      Math.max(...list.map((note) => note.x + note.width)) - Math.min(...list.map((note) => note.x));
    const boxWidth = widthOf(group);
    await dragHandle(page, 'se', { x: -200, y: 0 });

    const afterResize = await readObjects(page);
    const resized = ids.map((id) => pick(afterResize, id));
    const scale = resized[0]!.width / group[0]!.width;
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThan(STICKY_MIN_SIZE_WORLD / STICKY_SIZE_WORLD);
    for (let index = 0; index < group.length; index += 1) {
      const was = group[index]!;
      const now = resized[index]!;
      expect(close(now.width, was.width * scale, 1.5)).toBe(true);
      expect(close(now.height, was.height * scale, 1.5)).toBe(true);
      // Still square: an aspect-locked type never becomes a rectangle.
      expect(close(now.width, now.height, 1)).toBe(true);
    }
    // The gap between neighbours scaled with the notes, and so did the whole box.
    const gapBefore = group[1]!.x - (group[0]!.x + group[0]!.width);
    const gapAfter = resized[1]!.x - (resized[0]!.x + resized[0]!.width);
    expect(close(gapAfter, gapBefore * scale, 2)).toBe(true);
    expect(close(widthOf(resized), boxWidth * scale, 2)).toBe(true);

    // And shrinking stops at the type's minimum: pulled far in, the notes end up exactly
    // at STICKY_MIN_SIZE_WORLD and no smaller.
    await dragHandle(page, 'se', { x: -1000, y: 0 });
    const smallest = await readObjects(page);
    for (const id of ids) {
      const note = pick(smallest, id);
      expect(close(note.width, STICKY_MIN_SIZE_WORLD, 1)).toBe(true);
      expect(close(note.height, STICKY_MIN_SIZE_WORLD, 1)).toBe(true);
    }

    // Resizing selected notes never touched the one outside the selection.
    expect(close(pick(smallest, passed!).width, STICKY_SIZE_WORLD)).toBe(true);
  });

  test('TC-34 the keyboard moves a selection a set distance, then deletes it', async ({
    page,
  }) => {
    await openFreshBoard(page);
    const ids = await placeNotes(page, GRID);
    await page.keyboard.press('Escape');

    await page.keyboard.press('Control+a');
    await expectSelectedCount(page, 6);

    const cameraBefore = await readCamera(page);
    const before = await readObjects(page);

    // Three small steps and one large one: the distance a keyboard move takes a selection
    // is the product setting, not whatever the pointer happened to drag.
    for (let index = 0; index < 3; index += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(150);

    const after = await readObjects(page);
    for (const id of ids) {
      expect(close(pick(after, id).x - pick(before, id).x, 3 * NUDGE_STEP_WORLD + NUDGE_LARGE_STEP_WORLD)).toBe(true);
      expect(close(pick(before, id).y - pick(after, id).y, NUDGE_LARGE_STEP_WORLD)).toBe(true);
    }

    // The board did not pan and the document did not scroll: the arrows belong to the
    // selection, not to the page.
    expect(await readCamera(page)).toEqual(cameraBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-object-id]')).toHaveCount(0);
    expect(await outlineCount(page)).toBe(0);
    expect(await selectionCountText(page)).toBeNull();
  });

  test('the selection bar deletes the group, and Escape lets go of it', async ({ page }) => {
    await openFreshBoard(page);
    const ids = await placeNotes(page, GRID);
    await page.keyboard.press('Escape');
    await dragMarquee(page, { x: 100, y: 100 }, { x: 1000, y: 700 });
    await expectSelectedCount(page, 6);
    expect([...(await selectedIds(page))].sort()).toEqual([...ids].sort());

    await page.getByRole('button', { name: 'Delete selection' }).click();
    await expect(page.locator('[data-object-id]')).toHaveCount(0);
    expect(await selectionCountText(page)).toBeNull();

    // A note again, then Escape: selected, then not, with the note still on the board.
    const [one] = await placeNotes(page, [{ x: 640, y: 400 }]);
    expect(await selectedIds(page)).toEqual([one]);
    await page.keyboard.press('Escape');
    expect(await selectedIds(page)).toHaveLength(0);
    expect(await page.locator('[data-object-id]').count()).toBe(1);
  });
});

test.describe('workflow 2: somebody else deletes one of my selected notes', () => {
  test('TC-35 my selection drops the note that went away, and the rest still delete as one', async ({
    browser,
  }) => {
    // Two people on one board. The test calls them Lee, who is selecting, and Sam, who
    // is clearing up.
    const session = await openBoard(browser, 2);
    const lee = session.participants[0] as Participant;
    const sam = session.participants[1] as Participant;

    const ids = await placeNotes(lee.page, [
      { x: 200, y: 300 },
      { x: 500, y: 300 },
      { x: 800, y: 300 },
      { x: 1100, y: 300 },
    ]);
    await lee.page.keyboard.press('Escape');
    await expect(sam.page.locator('[data-object-id]')).toHaveCount(ids.length);

    await dragMarquee(lee.page, { x: 90, y: 170 }, { x: 1215, y: 430 });
    await expectSelectedCount(lee.page, 4);

    // Sam picks one of the four and throws it away.
    const doomed = ids[1]!;
    await sam.selectNote(doomed);
    await sam.page.keyboard.press('Delete');

    // On Lee's screen the note goes, the count follows it, and the outlines left behind
    // are the three that are still there. `waitForChange` reports how long that took
    // against the live-update budget, which is the story 3 convention.
    await waitForChange('TC-35 Lee sees Sam delete one of his selected notes', async () => {
      return (await selectedIds(lee.page)).length === 3;
    });
    await expect(lee.page.locator('[data-object-id]')).toHaveCount(3);
    await expectSelectedCount(lee.page, 3);
    expect(await outlineCount(lee.page)).toBe(3);
    expect(await selectedIds(lee.page)).toEqual([ids[0], ids[2], ids[3]]);

    // What is left in Lee's selection still behaves as one selection.
    await lee.page.keyboard.press('Delete');
    await expect(lee.page.locator('[data-object-id]')).toHaveCount(0);
    await expect(sam.page.locator('[data-object-id]')).toHaveCount(0);

    expect(lee.errors()).toEqual([]);
    expect(sam.errors()).toEqual([]);
    await session.close();
  });
});

test.describe('workflow 3: full-capacity reorganisation', () => {
  test('TC-36 every editor moves a different selection and every board agrees', async ({
    browser,
  }: {
    browser: Browser;
  }) => {
    const session = await openBoard(browser, MAX_CONCURRENT_EDITORS);
    const people = session.participants;

    // One note each, spaced so that no two drags can touch each other.
    const points = people.map((_person, index) => ({
      x: 180 + index * 220,
      y: index % 2 === 0 ? 220 : 540,
    }));
    const ids = await placeNotes(people[0]!.page, points);
    for (const person of people) {
      await expect(person.page.locator('[data-object-id]')).toHaveCount(ids.length);
    }
    await people[0]!.page.keyboard.press('Escape');

    const before = await readObjects(people[0]!.page);
    // Each person drags a different note by the same distance, all at the same time.
    await Promise.all(
      people.map(async (person, index) => {
        await person.selectNote(ids[index]!);
        await person.dragNote(ids[index]!, { x: 60, y: 120 });
      }),
    );

    await waitForIdenticalBoards('TC-36 five simultaneous group moves', people);

    const after = await readObjects(people[0]!.page);
    for (const id of ids) {
      // The writes are absolute, so five people dragging at once still land on one
      // answer: each note moved by exactly its own drag.
      expect(close(pick(after, id).x - pick(before, id).x, 60, 2)).toBe(true);
      expect(close(pick(after, id).y - pick(before, id).y, 120, 2)).toBe(true);
    }
    for (const person of people) expect(person.errors()).toEqual([]);

    await session.close();
  });
});
