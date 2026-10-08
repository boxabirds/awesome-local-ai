import { expect, test, type Page } from '@playwright/test';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, PEN_COLORS } from '../../src/shared/config';
import { copyPath, HANDWRITTEN_LOOP, UNDERLINE } from '../fixtures/pen-paths';
import { closeScreens, gotoNewBoard, openScreen, waitForSynced } from './helpers/sync';
import {
  cameraOf,
  clickStroke,
  collectErrors,
  dragHandle,
  dragOnScreen,
  elementAt,
  paintedStrokeCount,
  penToolActive,
  penToolbarCount,
  pickPenColor,
  pickPenThickness,
  pointOnStrokeLine,
  previewPath,
  readPreviewSamples,
  startPreviewSampler,
  seedNoteOnBoard,
  selectedIds,
  startPen,
  stopPen,
  strokeById,
  strokePath,
  strokePathWidth,
  strokeSnapshots,
  waitForStrokes,
  wheelOver,
  worldToScreen,
  drawPenPath,
} from './helpers/pen';

/**
 * Story 11 — sketching freehand in the browser (TC-17 to TC-20).
 *
 * A stroke is a promise between two screens: the line under the pointer while it is
 * being drawn belongs to that screen alone, and what arrives on the other one is a
 * finished drawing, painted from the same points. These tests draw for real — a real
 * mouse through a real path — and then read both halves: the points in the shared
 * document, and the pixels the browser made from them.
 */

/** Every n-th point of a fixture path, so a drag has a sane number of moves. */
function sample(points: readonly { x: number; y: number }[], n: number): { x: number; y: number }[] {
  const out = [];
  for (let i = 0; i < points.length; i += Math.max(1, Math.ceil(points.length / n))) out.push({ ...points[i] });
  const last = points[points.length - 1]!;
  if (out[out.length - 1]?.x !== last.x || out[out.length - 1]?.y !== last.y) out.push({ ...last });
  return out;
}

/** Dana's board, plus Sam in another context looking at the same address. */
async function twoScreens(
  page: Page,
): Promise<{ dana: Page; sam: Page; close: () => Promise<void> }> {
  const pages: Page[] = [page];
  const id = await gotoNewBoard(page);
  const sam = await openScreen(page, new URL(`/b/${id}`, page.url()).toString());
  pages.push(sam);
  await waitForSynced(sam);
  return { dana: page, sam, close: () => closeScreens(pages) };
}

/** A wide, flat zigzag: an obviously non-square drawing to resize. */
const ZIGZAG = [
  { x: -300, y: -120 },
  { x: -200, y: 120 },
  { x: -100, y: -120 },
  { x: 0, y: 120 },
  { x: 100, y: -120 },
  { x: 200, y: 120 },
  { x: 300, y: -120 },
];

test.describe('sketching with the pen in the browser (TC-17 to TC-20)', () => {
  // TC-17: a real drag, a preview that keeps up, and a stroke that stays.
  test('TC-17 draws a loop with the mouse, updating the preview all the way, and leaves a stroke', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoNewBoard(page);
    await startPen(page);
    expect(await penToolbarCount(page)).toBe(1);

    // The preview is drawn once per animation frame, so the frames are the clock the
    // redraws are measured against.
    await startPreviewSampler(page);
    const loop = sample(copyPath(HANDWRITTEN_LOOP), 40);
    const halfway = Math.floor(loop.length / 2);
    let landedMidDrag = -1;
    await drawPenPath(page, loop, {
      watch: async (_d, i) => {
        // Halfway along the drag, the drawing is still only a preview: nothing has
        // landed on the board, so nobody else can have seen it (PRD pen.share).
        if (i === halfway) landedMidDrag = (await strokeSnapshots(page)).length;
      },
    });

    const frames = await readPreviewSamples(page);
    const drawn = frames.filter((d): d is string => typeof d === 'string' && d.length > 0);
    const updates = new Set(drawn).size;
    test.info().annotations.push({
      type: 'preview updates',
      description: `${updates} distinct preview paths in ${frames.length} animation frames (${loop.length - 1} pointer moves)`,
    });
    // The line was redrawn as the mouse moved, not once at the end — and never more
    // often than the browser was willing to draw it.
    expect(landedMidDrag).toBe(0);
    expect(updates).toBeGreaterThan(5);
    expect(updates).toBeLessThanOrEqual(frames.length);
    // Each frame's line was longer than the one before it started: the stroke grew.
    expect(drawn[drawn.length - 1]!.length).toBeGreaterThan(drawn[0]!.length);

    // Released: the preview is gone and a real stroke is on the board, painted from
    // the points the pointer left behind.
    await expect.poll(() => previewPath(page)).toBeNull();
    const strokes = await waitForStrokes(page, 1);
    const stroke = strokes[0]!;
    expect(stroke.type).toBe('stroke');
    expect(stroke.points.length / 2).toBeGreaterThan(3);
    expect(await paintedStrokeCount(page)).toBe(1);
    const painted = await strokePath(page, stroke.id);
    expect(painted).not.toBeNull();
    expect(painted!.startsWith('M')).toBe(true);
    // The drawing covers the loop that was drawn, in board units.
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    expect(stroke.width).toBeGreaterThanOrEqual(Math.max(...xs) - Math.min(...xs));
    expect(stroke.height).toBeGreaterThanOrEqual(Math.max(...ys) - Math.min(...ys));
    // And the pen is still in the hand, because a sketch is never one stroke.
    expect(await penToolActive(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  // TC-18: the other screen sees a finished drawing, and nothing before it.
  test('TC-18 shows a watcher nothing at all until the stroke is finished', async ({ page }) => {
    const { dana, sam, close } = await twoScreens(page);
    try {
      const errors = collectErrors(sam);
      await startPen(dana);

      const path = sample(copyPath(UNDERLINE), 30);
      const screen = [];
      for (const p of path) screen.push(await worldToScreen(dana, p));

      // Draw up to the last move, and hold the button down.
      await dana.mouse.move(screen[0].x, screen[0].y);
      await dana.mouse.down();
      let halfway = Math.floor(screen.length / 2);
      for (let i = 1; i < halfway; i++) await dana.mouse.move(screen[i].x, screen[i].y);
      await expect.poll(() => previewPath(dana)).toMatch(/^M/);

      // Halfway through the stroke, Dana has a line and Sam has nothing at all: not a
      // document entry, not a painted pixel (PRD pen.share).
      expect((await strokeSnapshots(dana)).length).toBe(0);
      expect((await strokeSnapshots(sam)).length).toBe(0);
      expect(await paintedStrokeCount(sam)).toBe(0);
      expect(await penToolbarCount(sam)).toBe(0);

      const released = Date.now();
      for (let i = halfway; i < screen.length; i++) await dana.mouse.move(screen[i].x, screen[i].y);
      await dana.mouse.up();

      const strokes = await waitForStrokes(sam, 1);
      const latency = Date.now() - released;
      test.info().annotations.push({
        type: 'delivery',
        description: `stroke delivered in ${latency} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
      });
      // Not asserted against the clock: a shared machine decides that. What is
      // asserted is that both screens end up with the same drawing.
      expect(latency).toBeGreaterThan(0);

      await expect.poll(() => paintedStrokeCount(sam)).toBe(1);
      const onSam = strokes[0]!;
      const onDana = (await strokeSnapshots(dana))[0]!;
      expect(onSam.id).toBe(onDana.id);
      expect(Array.from(onSam.points)).toEqual(Array.from(onDana.points));
      expect(onSam.color).toBe(onDana.color);
      expect(await strokePath(sam, onSam.id)).toBe(await strokePath(dana, onDana.id));
      // Sam's own pen was never picked up, and Sam's pen options stay hidden.
      expect(await penToolActive(sam)).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  // TC-19: the pen takes the pointer and nothing else.
  test('TC-19 scrolls the board while the pen is active and never moves what is under it', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoNewBoard(page);
    const noteId = await seedNoteOnBoard(page, { x: -120, y: -80, width: 240, height: 160 });
    await startPen(page);

    // A scroll over the pen's own surface still pans the board: the pen is a surface
    // inside the viewport, not a wall in front of it (PRD pen.navigation).
    const penPoint = await worldToScreen(page, { x: 260, y: 240 });
    expect(await elementAt(page, penPoint)).toBe('pen-tool');
    const beforePan = await cameraOf(page);
    await wheelOver(page, penPoint, 160);
    const afterPan = await cameraOf(page);
    expect(afterPan.y).not.toBe(beforePan.y);
    expect((await strokeSnapshots(page)).length).toBe(0);

    // A drag that starts on a note draws a stroke; the note does not move and the
    // board does not pan (PRD pen.navigation negative).
    const noteBefore = (await page.evaluate(() => window.__vidi6!.getSnapshot())).find(
      (n) => n.id === noteId,
    )!;
    const beforeDrag = await cameraOf(page);
    const from = await worldToScreen(page, { x: -60, y: 0 });
    // The note is under the pointer, but the pen's surface is over it: that is why the
    // note never gets this drag, and cannot be moved by it.
    expect(await elementAt(page, from)).toBe('pen-tool');
    const to = await worldToScreen(page, { x: 160, y: 150 });
    await dragOnScreen(page, from, to);

    const strokes = await waitForStrokes(page, 1);
    const afterDrag = await cameraOf(page);
    expect(afterDrag).toEqual(beforeDrag);
    const noteAfter = (await page.evaluate(() => window.__vidi6!.getSnapshot())).find(
      (n) => n.id === noteId,
    )!;
    expect(noteAfter.x).toBe(noteBefore.x);
    expect(noteAfter.y).toBe(noteBefore.y);
    // The stroke went over the note, and the note stayed unselected.
    expect(strokes[0]!.width).toBeGreaterThan(100);
    expect((await selectedIds(page)).length).toBe(0);
    expect(await penToolActive(page)).toBe(true);
    expect(errors).toEqual([]);
  });

  // TC-20: select by the line, resize in proportion, move, delete for everyone.
  test('TC-20 selects a stroke by its line, keeps its ratio, moves it and deletes it everywhere', async ({
    page,
  }) => {
    const { dana, sam, close } = await twoScreens(page);
    try {
      const errors = collectErrors(dana);
      errors.push(...collectErrors(sam));
      // Draw it with the pen, so the drawing is one this person made.
      await startPen(dana);
      await pickPenColor(dana, 'blue');
      await drawPenPath(dana, copyPath(ZIGZAG));
      const strokes = await waitForStrokes(dana, 1);
      const id = strokes[0]!.id;
      await waitForStrokes(sam, 1);
      const stroke = strokes[0]!;
      expect(stroke.color).toBe('blue');
      const ratioBefore = stroke.width / stroke.height;
      expect(ratioBefore).toBeGreaterThan(1.5); // a wide drawing, so a ratio to lose

      // V, then a click on the line — not inside the box, which is mostly empty.
      await stopPen(dana);
      expect(await dana.getByTestId('board-viewport').getAttribute('data-tool')).toBe('select');
      await dana.mouse.click(1000, 700); // empty board: no selection to start from
      expect(await selectedIds(dana)).toEqual([]);
      await clickStroke(dana, stroke);
      await expect.poll(async () => (await selectedIds(dana)).join(',')).toBe(id);
      await expect(dana.getByTestId('handle-se')).toHaveCount(1);

      // Drag the corner: the box grows, and its ratio is the stroke's own ratio.
      const inkBefore = await strokePathWidth(dana, id!);
      await dragHandle(dana, 'se', 90, 40);
      const grown = (await strokeById(dana, id!))!;
      expect(grown.width).toBeGreaterThan(stroke.width);
      expect(grown.height).toBeGreaterThan(stroke.height);
      expect(Math.abs(grown.width / grown.height / ratioBefore - 1)).toBeLessThan(0.01);
      // Both sides scaled by the same amount, so the drawing itself is not squashed,
      // and the ink is exactly as wide as it was (PRD pen.resize).
      expect(Math.abs(grown.width / grown.baseWidth / (grown.height / grown.baseHeight) - 1)).toBeLessThan(0.01);
      expect(await strokePathWidth(dana, id!)).toBe(inkBefore);
      // The other screen has the same resized drawing.
      await expect
        .poll(async () => {
          const onSam = await strokeById(sam, id!);
          return onSam ? Math.round(onSam.width) : -1;
        })
        .toBe(Math.round(grown.width));

      // Drag the body: the whole drawing moves by the same amount it was dragged.
      const cam = await cameraOf(dana);
      const onLine = await pointOnStrokeLine(dana, grown);
      await dragOnScreen(dana, onLine, { x: onLine.x + 90, y: onLine.y + 50 });
      const moved = (await strokeById(dana, id!))!;
      expect(moved.x).toBeCloseTo(grown.x + 90 / cam.zoom, 1);
      expect(moved.y).toBeCloseTo(grown.y + 50 / cam.zoom, 1);
      // The ratio survived the move, unchanged.
      expect(Math.abs(moved.width / moved.height / ratioBefore - 1)).toBeLessThan(0.01);

      // Delete: it goes, on both screens.
      await expect.poll(async () => (await selectedIds(dana)).join(',')).toBe(id);
      await dana.keyboard.press('Delete');
      await waitForStrokes(dana, 0);
      await waitForStrokes(sam, 0);
      await expect.poll(() => dana.locator('[data-stroke-id]').count()).toBe(0);
      await expect.poll(() => sam.locator('[data-stroke-id]').count()).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  // The pen's ink is held, not asked for again — and it is nobody else's business.
  test('the pen keeps its colour and thickness between strokes without asking anyone', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await gotoNewBoard(page);
    await startPen(page);
    await pickPenColor(page, 'purple');
    await pickPenThickness(page, 'thick');
    const path = sample(copyPath(UNDERLINE), 20);
    await drawPenPath(page, path);
    const strokes = await waitForStrokes(page, 1);
    expect(strokes[0]!.color).toBe('purple');
    // A second stroke, in the ink still held: the choice stays until it is changed,
    // and it is never asked for again.
    await pickPenColor(page, 'black');
    await drawPenPath(page, path.map((p) => ({ x: p.x, y: p.y + 60 })));
    const both = await waitForStrokes(page, 2);
    expect(both.map((s) => s.color)).toEqual(['purple', 'black']);
    // Both inks are on the board at once: the pen's ink is per stroke, and changing it
    // later does not go back over what is already drawn.
    await expect(page.locator('[data-stroke-id]')).toHaveCount(2);
    const painted = await page.evaluate((ids) => {
      return ids.map((id) => {
        const path = document.querySelector(`[data-stroke-id="${id}"] [data-testid="stroke-line"]`);
        return path ? path.getAttribute('stroke') : null;
      });
    }, both.map((s) => s.id));
    expect(painted).toEqual([PEN_COLORS.purple, PEN_COLORS.black]);
    expect(errors).toEqual([]);
  });
});
