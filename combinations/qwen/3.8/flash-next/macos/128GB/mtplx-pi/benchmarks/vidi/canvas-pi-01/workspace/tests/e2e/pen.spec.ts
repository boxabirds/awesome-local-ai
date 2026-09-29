/**
 * Story 11 · task 17 — end-to-end sketching, run in Chromium, Firefox and
 * WebKit against the built app.
 *
 * Three truths belong in a real browser and nowhere else:
 *  - a freehand drag *paints* a line where it was dragged (the preview, the
 *    commit and the world→screen transform are checked against the same pixels);
 *  - a sketch is grabbable where its ink is and *not* grabbable in the empty
 *    middle of a loop, which only a real hit test against a real painted path
 *    can show (jsdom does no hit testing at all);
 *  - a proportional resize carries the drawing with the box at an unchanged ink
 *    width (PRD `pen.resize`).
 *
 * One fact these tests take as given, because it is the app's own choice: a
 * finished sketch comes back *selected*, so its options are reachable without a
 * second gesture. Selection probes therefore clear the selection with a press on
 * empty board first, and assert it is really clear before pressing again.
 */
import { expect, test, type Page } from '@playwright/test';
import { createBoardViaApi, openFreshBoard, waitForBoard } from './helpers/boards';
import { getCamera, settle } from './helpers/board';
import { shapes, shapeLabels } from './helpers/shapes';
import { createNoteAt, readNotes } from './helpers/sticky';
import { drawStroke, dragHandle, strokes, tapAt } from './helpers/pen';
import { makeHandwrittenLoop } from '../fixtures/pen-paths';
import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';

/**
 * The first point along the sketch's own diagonal whose topmost element is the
 * sketch's *ink* (`stroke-hit`, the only paintable part of a sketch that takes a
 * press). Selection lives on the painted line, so a test that means to "click the
 * drawing" has to find a pixel where the drawing actually is — and inside a
 * selected sketch's box its own options row also lives, which is a button, not
 * the ink, so a match on the ancestor chain alone is not enough.
 */
async function inkPointOn(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ([strokeId]) => {
      const node = document.querySelector(`[data-stroke-id="${strokeId}"]`);
      if (node === null) return null;
      const rect = node.getBoundingClientRect();
      for (let i = 1; i < 24; i += 1) {
        const x = rect.left + (rect.width * i) / 24;
        const y = rect.top + (rect.height * i) / 24;
        const hit = document.elementFromPoint(x, y);
        if (hit?.getAttribute('data-testid') === 'stroke-hit') return { x, y };
      }
      return null;
    },
    [id],
  );
}

test('TC-25: a freehand drag paints one sketch where it was dragged', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  // A hand-drawn diagonal with a wobble in it, in screen pixels at zoom 1.
  await drawStroke(page, [
    [150, 150],
    [210, 190],
    [260, 210],
    [310, 260],
    [350, 350],
  ]);

  const drawn = await strokes(page);
  expect(drawn).toHaveLength(1);
  const stroke = drawn[0]!;
  // The painted box is the drag, within a few pixels (the box is padded by half
  // the ink width, which is the only intended difference).
  expect(Math.abs(stroke.left - 150)).toBeLessThanOrEqual(6);
  expect(Math.abs(stroke.top - 150)).toBeLessThanOrEqual(6);
  expect(Math.abs(stroke.width - 200)).toBeLessThanOrEqual(12);
  expect(Math.abs(stroke.height - 200)).toBeLessThanOrEqual(12);
  // The ink reaches all four sides of that box: a line crossing it, not a blob
  // in one corner.
  expect(stroke.inkWidth).toBeGreaterThan(stroke.width * 0.85);
  expect(stroke.inkHeight).toBeGreaterThan(stroke.height * 0.85);
  // …and it is selectable straight away, which is how its options are reached.
  expect(stroke.selected).toBe(true);
  await expect(page.getByTestId('stroke-toolbar')).toHaveCount(1);

  // A pen gesture makes a sketch and nothing else.
  expect(await shapeLabels(page)).toHaveLength(0);
  expect(await shapes(page)).toHaveLength(0);
});

test('TC-25b: the pen stays a pen, so the next sketch starts straight away', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await drawStroke(page, [
    [120, 420],
    [200, 380],
    [280, 430],
  ]);
  await drawStroke(page, [
    [420, 200],
    [470, 260],
    [520, 210],
  ]);

  // Two drags, two sketches — the tool never fell back to Select in between, and
  // the second one started on top of the first sketch's row without picking it up.
  const drawn = await strokes(page);
  expect(drawn).toHaveLength(2);
  expect(drawn[0]!.left).toBeLessThan(drawn[1]!.left);
  await expect(page.getByTestId('pen-tool')).toHaveCount(1);
});

test('TC-26: a sketch is selectable on its ink, but the middle of a loop is a miss', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  // A straight line: its middle is on the ink.
  await drawStroke(page, [
    [150, 150],
    [250, 250],
    [350, 350],
  ]);
  expect(await strokes(page)).toHaveLength(1);

  // Clear the automatic selection, and prove it is clear before probing again.
  await tapAt(page, 640, 520);
  expect((await strokes(page))[0]!.selected).toBe(false);

  await tapAt(page, 250, 250);
  const selected = await strokes(page);
  expect(selected[0]!.selected, 'pressing on the ink selects the sketch').toBe(true);
  // Selection brings the options and the eight handles (PRD `pen.options`).
  await expect(page.getByTestId('stroke-toolbar')).toHaveCount(1);
  await expect(page.getByTestId('stroke-handle-se')).toHaveCount(1);

  // Press on empty board: nothing is selected again.
  await tapAt(page, 640, 520);
  expect((await strokes(page))[0]!.selected, 'pressing off the ink clears it').toBe(false);

  // A closed loop: the middle of its box is far from any ink.
  await drawStroke(page, [
    [430, 120],
    [610, 120],
    [610, 300],
    [430, 300],
    [430, 140],
    [520, 120],
  ]);
  expect(await strokes(page)).toHaveLength(2);
  await tapAt(page, 640, 520);
  expect((await strokes(page)).every((stroke) => !stroke.selected)).toBe(true);

  // The exact centre of the loop's box — inside the bounding box, outside the
  // selection tolerance. PRD `pen.select`: this selects nothing.
  const loop = (await strokes(page))[1]!;
  const centreX = loop.left + loop.width / 2;
  const centreY = loop.top + loop.height / 2;
  await tapAt(page, centreX, centreY);
  const after = await strokes(page);
  expect(
    after.every((stroke) => !stroke.selected),
    'a press inside the box but away from the path selects nothing',
  ).toBe(true);

  // And it is a real miss, not a deselected success: pressing on the loop's ink
  // one moment later does select it.
  await tapAt(page, centreX, loop.top + 3);
  expect((await strokes(page))[1]!.selected).toBe(true);
});

test('TC-27: a proportional resize carries the drawing and leaves the ink width alone', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);

  await drawStroke(page, [
    [160, 180],
    [240, 260],
    [320, 340],
  ]);
  const before = (await strokes(page))[0]!;

  // Back to Select (the pen overlay owns every press while it is active), then
  // pull the bottom-right handle out by 80 px in both axes.
  const moved = await dragHandle(page, 'se', 80, 80);
  expect(moved, 'the resize handle is where the box says it is').toBe(true);

  const after = (await strokes(page))[0]!;
  // The box grew by the pull, and the drawing grew with it: the ink keeps
  // covering the same share of its box, so nothing shrank into a corner.
  expect(after.width).toBeGreaterThan(before.width + 60);
  expect(after.height).toBeGreaterThan(before.height + 60);
  const beforeInk = before.inkWidth / before.inkHeight;
  const afterInk = after.inkWidth / after.inkHeight;
  expect(Math.abs(beforeInk - afterInk)).toBeLessThan(0.12);
  expect(after.inkWidth).toBeGreaterThan(after.width * 0.8);
  expect(after.inkHeight).toBeGreaterThan(after.height * 0.8);

  // A resize is a resize: the same sketch, the same ink token and width.
  expect(after.id).toBe(before.id);
  expect(after.color).toBe(before.color);
  expect(after.thickness).toBe(before.thickness);
  expect(after.strokeWidth).toBeCloseTo(before.strokeWidth, 3);
});

test('TC-27b: a restyled sketch keeps its shape', async ({ page }) => {
  await openFreshBoard(page);
  await settle(page);

  await drawStroke(page, [
    [200, 200],
    [280, 250],
    [360, 200],
  ]);
  const before = (await strokes(page))[0]!;
  expect(before.selected, 'a finished sketch is selectable at once').toBe(true);

  // Back to Select, then use the options beside the sketch itself (the stroke's
  // own toolbar, not the identical swatches in the tool bar).
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  await settle(page);
  await page.getByTestId('stroke-toolbar').getByTestId('pen-color-red').click();
  await settle(page, 4);

  const after = (await strokes(page))[0]!;
  // Only the ink changed: same box, same width, new colour.
  expect(after.color).toBe('red');
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  expect(after.strokeWidth).toBeCloseTo(before.strokeWidth, 3);

  // Nothing about the sketch turned it into a text object.
  expect(await shapeLabels(page)).toHaveLength(0);
});

test('TC-17: the line is repainted every frame while drawing, and outlives the gesture', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);
  const loop = makeHandwrittenLoop(160);

  // Sample the preview once per animation frame, from inside the page, while the
  // drag runs. The claim is "updated every frame", so the evidence has to be
  // per-frame: a preview painted once and then frozen fails here even though the
  // finished sketch would look right.
  // Sample the preview once per animation frame for the whole gesture, from inside
  // the page. The claim is "updated every frame", so the evidence has to be
  // per-frame: a preview painted once and then frozen fails here even though the
  // finished sketch would look right. The recorder stops on a flag rather than a
  // frame budget: a budget of 240 frames ran out before the drag had even started
  // on a slower renderer, which measured the harness instead of the app.
  await page.evaluate(() => {
    const w = window as unknown as { __penProbe?: string[]; __penProbeStop?: boolean };
    w.__penProbe = [];
    w.__penProbeStop = false;
    const tick = () => {
      if (w.__penProbeStop === true) return;
      const path = document.querySelector<SVGPathElement>('[data-testid="pen-preview-path"]');
      w.__penProbe?.push(path === null ? '' : (path.getAttribute('d') ?? ''));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await settle(page);
  const first = loop[0]!;
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  // Short hops with a repaint between them, the reason `drawStroke` pauses too:
  // moved in two long batches, the pointer outruns the line being drawn and on a
  // slower renderer no frame ever sees a preview at all.
  for (let i = 6; i < loop.length; i += 6) {
    const point = loop[i]!;
    await page.mouse.move(point.x, point.y, { steps: 3 });
    await settle(page);
  }
  await page.mouse.up();
  const samples = await page.evaluate(() => {
    const w = window as unknown as { __penProbe?: string[]; __penProbeStop?: boolean };
    w.__penProbeStop = true;
    return w.__penProbe ?? [];
  });
  await settle(page, 4);

  const painted = samples.filter((d) => d !== '');
  expect(painted.length, 'a preview line exists during the drag').toBeGreaterThan(0);
  expect(
    new Set(painted).size,
    'the preview line changes on consecutive frames',
  ).toBeGreaterThan(3);
  // And the drawing outlives the gesture: one sketch on the board, no leftover
  // preview on the screen.
  expect(await strokes(page)).toHaveLength(1);
  expect(await page.locator('[data-testid="pen-preview-path"]').count()).toBe(0);
});

test('TC-18: the other person sees nothing mid-stroke, and the sketch straight after', async ({
  context,
}) => {
  // Two pages, one room: the only path between them is the server.
  const pageA = await context.newPage();
  const boardId = await createBoardViaApi(pageA.request);
  await pageA.goto(`/b/${boardId}`);
  await waitForBoard(pageA);
  const pageB = await context.newPage();
  await pageB.goto(`/b/${boardId}`);
  await settle(pageB);

  await pageA.keyboard.press('Escape');
  await pageA.keyboard.press('p');
  await settle(pageA);
  const loop = makeHandwrittenLoop(80);
  await pageA.mouse.move(loop[0]!.x, loop[0]!.y);
  await pageA.mouse.down();
  for (let i = 4; i < loop.length; i += 4) {
    await pageA.mouse.move(loop[i]!.x, loop[i]!.y, { steps: 3 });
  }

  // Still dragging. The watcher's board has neither the finished sketch nor a
  // preview of it: an in-progress line never leaves the drawer's machine.
  expect(await strokes(pageB), 'nothing arrives mid-stroke').toHaveLength(0);
  expect(await pageB.locator('[data-testid="pen-preview-path"]').count()).toBe(0);

  const released = Date.now();
  await pageA.mouse.up();
  await pageB.waitForFunction(
    () => document.querySelectorAll('[data-stroke-id]').length >= 1,
    undefined,
    { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS + 4000 },
  );
  const elapsed = Date.now() - released;
  expect(
    elapsed,
    `the sketch reached the watcher in ${elapsed} ms`,
  ).toBeLessThan(LIVE_UPDATE_LATENCY_BUDGET_MS);
  expect(await strokes(pageB)).toHaveLength(1);
});

test('TC-19: with the Pen active, scroll pans the board and a drag over a note draws on it', async ({
  page,
}) => {
  await openFreshBoard(page);
  await settle(page);
  await createNoteAt(page, 420, 300);
  await page.keyboard.press('Escape'); // leave the editor
  await settle(page);
  await page.keyboard.press('Escape'); // and clear the selection it came with
  await settle(page);
  expect(await readNotes(page)).toHaveLength(1);

  await page.keyboard.press('p');
  await settle(page);
  const start = await getCamera(page);
  await page.mouse.move(700, 500);
  await page.mouse.wheel(0, -240);
  await settle(page, 4);
  const panned = await getCamera(page);
  expect(panned.zoom, 'plain scroll is a pan, not a zoom').toBeCloseTo(1, 6);
  expect(Math.abs(panned.y - start.y), 'the board panned under the pen').toBeGreaterThan(1);

  // A drag that starts on the note draws over it. The note is scenery here: it
  // does not move, and it does not swallow the gesture.
  const note = (await readNotes(page))[0]!;
  const startX = note.left + note.width / 2;
  const startY = note.top + note.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 90, { steps: 12 });
  await page.mouse.up();
  await settle(page, 4);

  expect(await strokes(page), 'a pen drag over a note makes a sketch').toHaveLength(1);
  const after = await readNotes(page);
  expect(after).toHaveLength(1);
  expect(after[0]!.left).toBeCloseTo(note.left, 1);
  expect(after[0]!.top).toBeCloseTo(note.top, 1);
});

test('TC-20: a sketch is grabbed on its ink, resized proportionally, moved and deleted on both screens', async ({
  context,
}) => {
  const pageA = await context.newPage();
  const boardId = await createBoardViaApi(pageA.request);
  await pageA.goto(`/b/${boardId}`);
  await waitForBoard(pageA);
  const pageB = await context.newPage();
  await pageB.goto(`/b/${boardId}`);
  await settle(pageB);

  await drawStroke(pageA, [
    [180, 160],
    [300, 250],
    [420, 350],
  ]);
  await pageB.waitForFunction(
    () => document.querySelectorAll('[data-stroke-id]').length >= 1,
    undefined,
    { timeout: 10_000 },
  );
  expect(await strokes(pageB)).toHaveLength(1);

  // Select, then press on the ink itself.
  await pageA.keyboard.press('Escape');
  await pageA.keyboard.press('v');
  await settle(pageA);
  const before = (await strokes(pageA))[0]!;
  const onInk = await inkPointOn(pageA, before.id);
  expect(onInk, 'the drawn line has a pixel a press can land on').not.toBeNull();
  await pageA.mouse.click(onInk!.x, onInk!.y);
  await settle(pageA, 4);
  expect(
    (await strokes(pageA))[0]!.selected,
    'a press on the ink selects the sketch',
  ).toBe(true);

  // Pull the bottom-right corner. A corner is proportional: the box grows, the
  // drawing grows with it, and the ink stays the same width. Deliberately no
  // `dragHandle` here: that helper starts with Escape, which in Select mode is a
  // *deselect*, and an unselected sketch has no handles to grab.
  const handle = await pageA
    .getByTestId('stroke-handle-se')
    .boundingBox({ timeout: 4000 });
  expect(handle, 'a selected sketch shows its corner handle').not.toBeNull();
  const from = { x: handle!.x + handle!.width / 2, y: handle!.y + handle!.height / 2 };
  await pageA.mouse.move(from.x, from.y);
  await pageA.mouse.down();
  await pageA.mouse.move(from.x + 45, from.y + 30, { steps: 6 });
  await settle(pageA);
  await pageA.mouse.move(from.x + 90, from.y + 60, { steps: 6 });
  await settle(pageA);
  await pageA.mouse.up();
  await settle(pageA, 4);
  const resized = (await strokes(pageA))[0]!;
  const ratioBefore = before.width / before.height;
  const ratioAfter = resized.width / resized.height;
  expect(
    Math.abs(ratioAfter - ratioBefore) / ratioBefore,
    `aspect ratio held (${ratioBefore.toFixed(3)} -> ${ratioAfter.toFixed(3)})`,
  ).toBeLessThan(0.01);
  expect(resized.strokeWidth).toBeCloseTo(before.strokeWidth, 3);
  expect(resized.width).toBeGreaterThan(before.width);

  // Drag the body: the whole drawing moves, ink width unchanged.
  const onInkAgain = await inkPointOn(pageA, resized.id);
  expect(onInkAgain, 'the resized drawing is still grabbable').not.toBeNull();
  await pageA.mouse.move(onInkAgain!.x, onInkAgain!.y);
  await settle(pageA);
  await pageA.mouse.down();
  await pageA.mouse.move(onInkAgain!.x + 150, onInkAgain!.y + 40, { steps: 10 });
  await pageA.mouse.up();
  await settle(pageA, 4);
  const movedOut = (await strokes(pageA))[0]!;
  expect(movedOut.left, 'the drawing moved').toBeGreaterThan(resized.left + 100);
  expect(movedOut.top, 'the drawing moved').toBeGreaterThan(resized.top + 20);
  expect(movedOut.strokeWidth).toBeCloseTo(before.strokeWidth, 3);

  // Delete removes it for everyone.
  await pageA.keyboard.press('Delete');
  await settle(pageA, 4);
  expect(await strokes(pageA)).toHaveLength(0);
  await pageB.waitForFunction(
    () => document.querySelectorAll('[data-stroke-id]').length === 0,
    undefined,
    { timeout: 10_000 },
  );
  expect(await strokes(pageB)).toHaveLength(0);
});
