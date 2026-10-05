/**
 * Story 11 e2e (task 6): TC-17 to TC-20 — the pen from the hand to the other
 * person's screen.
 *
 * The paths are the fixtures from `tests/fixtures/pen-paths.ts` replayed with a
 * real mouse: a jittery handwritten loop and an underline. Everything is read
 * back from the board model on every screen — a stroke is *shared* when the
 * other person's model has it, not when mine says it should be there.
 */
import { expect, test, type Page } from '@playwright/test';

import { PEN_THICKNESS_WORLD, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { handwrittenLoop, moveTo, underline } from '../fixtures/pen-paths';
import { gotoBoard, worldTranslate } from './helpers/board';
import { objectsOn, screenOfWorld, dragOnBoard } from './helpers/flow';
import {
  closeParticipants,
  createBoard,
  expectEventually,
  openParticipants,
  printLatencyReport,
} from './helpers/participants';

/** A stroke as the model holds it. */
interface StrokeModel {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
  baseWidth: number;
  baseHeight: number;
  color: string;
  thickness: string;
}

const strokesOn = async (page: Page): Promise<StrokeModel[]> =>
  (await objectsOn(page)).filter((object) => object.type === 'stroke') as unknown as StrokeModel[];

/** Replay a recorded path with the mouse; returns before `up` was pressed. */
async function tracePath(page: Page, points: { x: number; y: number }[]): Promise<void> {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    await page.mouse.move(p.x, p.y);
  }
}

/** The preview path as of the next animation frame (empty when there is none). */
const readPreview = (page: Page): Promise<string> =>
  page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        requestAnimationFrame(() => {
          const path = document.querySelector<SVGPathElement>('[data-testid="pen-preview"] path');
          resolve(path ? path.getAttribute('d') ?? '' : '');
        });
      }),
  );

/**
 * Sample the preview path across animation frames while the mouse keeps
 * moving: two different `d` values with the finger still down mean the preview
 * moved during the drag, not after it.
 */
async function previewChangesWhileDragging(page: Page, points: { x: number; y: number }[]): Promise<void> {
  const samples: string[] = [];
  for (const [index, p] of points.entries()) {
    await page.mouse.move(p.x, p.y);
    // Sample every few moves; each sample waits for a real frame to pass.
    if (index % 15 === 14) samples.push(await readPreview(page));
  }
  expect(samples.length).toBeGreaterThan(1);
  expect(samples.every((d) => d !== '')).toBe(true);
  expect(new Set(samples).size).toBeGreaterThan(1);
}

test.describe('sketching with a pen', () => {
  test('TC-17 a handwritten loop becomes one stroke around the notes', async ({ page }) => {
    await gotoBoard(page);
    // A cluster to annotate: one note, created the ordinary way.
    await page.keyboard.press('n');
    await page.keyboard.press('Escape'); // stop editing; the note stays

    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Black pen' })).toBeVisible();

    const loop = moveTo(handwrittenLoop(), { x: 560, y: 340 });
    await page.mouse.move(loop[0]!.x, loop[0]!.y);
    await page.mouse.down();
    const halfway = Math.floor(loop.length / 2);
    await previewChangesWhileDragging(page, loop.slice(1, halfway));

    const strokesMid = await strokesOn(page);
    expect(strokesMid).toHaveLength(0); // `pen.preview`: nothing while drawing

    for (const p of loop.slice(halfway)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();

    await expect.poll(() => strokesOn(page).then((s) => s.length)).toBe(1);
    const [stroke] = await strokesOn(page);
    // The stroke spans the loop: roughly 340x230 screen px at zoom 1.
    expect(stroke!.width).toBeGreaterThan(250);
    expect(stroke!.height).toBeGreaterThan(150);
    await expect(page.locator('[data-object-type="stroke"]')).toHaveCount(1);
    // Nothing else appeared, and no second stroke followed the release.
    await page.waitForTimeout(300);
    expect(await strokesOn(page)).toHaveLength(1);
    expect((await objectsOn(page)).filter((o) => o.type === 'sticky')).toHaveLength(1);
  });

  test('TC-17 the underline keeps its shape and its ink', async ({ page }) => {
    await gotoBoard(page);
    await page.keyboard.press('p');
    await page.getByRole('button', { name: 'Green pen' }).click();
    await page.getByRole('button', { name: 'Thick' }).click();

    const line = moveTo(underline(), { x: 480, y: 380 });
    await tracePath(page, line);
    await page.mouse.up();

    await expect.poll(() => strokesOn(page).then((s) => s.length)).toBe(1);
    const [stroke] = await strokesOn(page);
    expect(stroke!.color).toBe('green');
    expect(stroke!.thickness).toBe('thick');
    // A line, not a blob: ~300 wide, much wider than tall.
    expect(stroke!.width).toBeGreaterThan(250);
    expect(stroke!.height).toBeLessThan(stroke!.width / 4);
    await expect(
      page.locator(`[data-testid="stroke-line-${stroke!.id}"]`),
    ).toHaveAttribute('stroke-width', String(PEN_THICKNESS_WORLD.thick));
  });

  test('TC-18 a sketch travels to the other person when the pen lifts', async ({
    browser,
    request,
  }) => {
    const boardId = await createBoard(request);
    const [priya, sam] = await openParticipants(browser, boardId, ['Priya', 'Sam']);
    try {
      await priya.page.keyboard.press('p');
      const loop = moveTo(handwrittenLoop(), { x: 500, y: 320 });
      await priya.page.mouse.move(loop[0]!.x, loop[0]!.y);
      await priya.page.mouse.down();
      for (const p of loop.slice(1, Math.floor(loop.length / 2))) {
        await priya.page.mouse.move(p.x, p.y);
      }

      // Halfway through, Sam sees nothing: no object, and no preview of
      // Priya's hand on Sam's screen.
      expect(await strokesOn(sam.page)).toHaveLength(0);
      await expect(sam.page.getByTestId('pen-preview')).toHaveCount(0);

      for (const p of loop.slice(Math.floor(loop.length / 2))) {
        await priya.page.mouse.move(p.x, p.y);
      }
      await priya.page.mouse.up();

      const ms = await expectEventually(
        'TC-18 stroke visible to the other person',
        () => strokesOn(sam.page),
        (strokes) => strokes.length === 1,
      );
      // Loopback is fast; a second here would mean the stroke waited for
      // something other than the update.
      expect(ms).toBeLessThan(1_000);

      // Same object, same ink, on both models.
      const [onSam] = await strokesOn(sam.page);
      const [onPriya] = await strokesOn(priya.page);
      expect(onSam!.id).toBe(onPriya!.id);
      expect(onSam!.color).toBe(onPriya!.color);
      expect(onSam!.points.length).toBe(onPriya!.points.length);
      expect(priya.consoleErrors).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      printLatencyReport('TC-18');
      await closeParticipants([priya, sam]);
    }
  });

  test('TC-19 the pen draws over notes; the wheel still pans', async ({ page }) => {
    await gotoBoard(page);
    await page.keyboard.press('n');
    await page.keyboard.press('Escape');
    const [note] = (await objectsOn(page)).filter((o) => o.type === 'sticky');
    if (!note) throw new Error('the note was not created');

    // Wheel navigation works with the pen up.
    await page.keyboard.press('p');
    await page.mouse.move(640, 400); // the wheel acts where the cursor is
    const before = await worldTranslate(page);
    await page.mouse.wheel(0, -240);
    await expect
      .poll(() => worldTranslate(page))
      .not.toEqual(before);

    // A drag that starts on the note draws; it neither moves the note nor pans.
    const centre = await screenOfWorld(page, {
      x: note.x + STICKY_SIZE_WORLD / 2,
      y: note.y + STICKY_SIZE_WORLD / 2,
    });
    const cameraNow = await worldTranslate(page);
    await dragOnBoard(page, centre, { x: centre.x + 120, y: centre.y + 90 }, 12);

    expect(await strokesOn(page)).toHaveLength(1);
    const stillNote = (await objectsOn(page)).find((o) => o.id === note.id);
    expect(stillNote!.x).toBe(note.x);
    expect(stillNote!.y).toBe(note.y);
    expect(await worldTranslate(page)).toEqual(cameraNow);
  });

  test('TC-20 select, scale, move and delete a shared sketch', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const [priya, sam] = await openParticipants(browser, boardId, ['Priya', 'Sam']);
    try {
      await priya.page.keyboard.press('p');
      const line = moveTo(underline(), { x: 420, y: 360 });
      await tracePath(priya.page, line);
      await priya.page.mouse.up();
      await expectEventually(
        'TC-20 stroke shared before editing',
        () => strokesOn(sam.page),
        (strokes) => strokes.length === 1,
      );

      // Priya puts the pen down (Escape → Select) and clicks the line itself:
      // it becomes the selection.
      await priya.page.keyboard.press('Escape');
      let [stroke] = await strokesOn(priya.page);
      const atFirst = await screenOfWorld(priya.page, {
        x: stroke!.x + stroke!.points[0]!,
        y: stroke!.y + stroke!.points[1]!,
      });
      await priya.page.mouse.click(atFirst.x, atFirst.y);
      await expect(priya.page.locator('[data-resize-handle="se"]')).toBeVisible();

      // Corner drag: the picture scales in proportion and the pen stays the same.
      const handle = priya.page.locator('[data-resize-handle="se"]');
      const box = await handle.boundingBox();
      if (!box) throw new Error('the corner handle has no box');
      const before = { ...stroke! };
      await priya.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await priya.page.mouse.down();
      await priya.page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, {
        steps: 6,
      });
      await priya.page.mouse.up();

      [stroke] = await strokesOn(priya.page);
      const ratioBefore = before.width / before.height;
      const ratioAfter = stroke!.width / stroke!.height;
      expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);
      expect(stroke!.thickness).toBe('medium');
      await expect(
        priya.page.locator(`[data-testid="stroke-line-${stroke!.id}"]`),
      ).toHaveAttribute('stroke-width', '4');

      // Drag the line itself: the whole drawing moves, points untouched.
      const scale = stroke!.width / stroke!.baseWidth;
      const onLine = await screenOfWorld(priya.page, {
        x: stroke!.x + stroke!.points[2]! * scale,
        y: stroke!.y + stroke!.points[3]! * scale,
      });
      await dragOnBoard(priya.page, onLine, { x: onLine.x + 100, y: onLine.y + 40 }, 8);
      const [moved] = await strokesOn(priya.page);
      expect(moved!.x).toBeCloseTo(stroke!.x + 100, 1);
      expect(moved!.y).toBeCloseTo(stroke!.y + 40, 1);
      expect(moved!.points).toEqual(stroke!.points);

      // Keyboard delete: gone from both boards, and from both screens.
      await priya.page.keyboard.press('Delete');
      await expectEventually(
        'TC-20 deletion shared',
        () => strokesOn(sam.page),
        (strokes) => strokes.length === 0,
      );
      expect(await strokesOn(priya.page)).toHaveLength(0);
      await expect(priya.page.locator('[data-object-type="stroke"]')).toHaveCount(0);
      await expect(sam.page.locator('[data-object-type="stroke"]')).toHaveCount(0);
      expect(priya.consoleErrors).toEqual([]);
      expect(sam.consoleErrors).toEqual([]);
    } finally {
      printLatencyReport('TC-20');
      await closeParticipants([priya, sam]);
    }
  });
});
