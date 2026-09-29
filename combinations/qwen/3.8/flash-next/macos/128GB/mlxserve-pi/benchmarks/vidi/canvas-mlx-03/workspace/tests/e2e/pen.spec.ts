// Story 11 — sketch freehand with a pen. Playwright e2e (TC-17, TC-18, TC-19, TC-20),
// workflows "Annotate a cluster", "Shared sketch" and "Tidy up".
//
// These are the pen cases that only a real browser can answer: that a real pointer drag
// paints a preview that keeps up with the hand; that a colleague watching the same board
// sees *nothing* while the stroke is in hand and the whole stroke as soon as it is
// finished; that the armed pen neither pans the board with the wheel nor moves the note it
// was pressed on; and that a stroke selected by its line resizes with its proportions,
// moves, and goes away on every screen when deleted.
//
// The paths come from `tests/fixtures/pen-paths.ts` — the same recorded hand movements the
// unit tests simplify — mapped through the camera onto the screen, so what is dragged is
// what is asserted. Everything is read back in board units off the DOM.
import { test, expect, type Page } from '@playwright/test';
import {
  createSticky,
  noteByTest,
  notes,
  openBoard,
  openSharedBoard,
  originCentre,
  setCamera,
} from './helpers/board.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { screenOf, worldOfScreen, settle, currentZoom } from '../fixtures/checkout-flow.ts';
import { HANDWRITTEN_LOOP, UNDERLINE } from '../fixtures/pen-paths.ts';
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_THICKNESS,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
  PEN_THICKNESS_WORLD,
} from '../../src/shared/config.ts';
import type { Point } from '../../src/shared/geometry.ts';

interface StrokeBox {
  id: string;
  color: string;
  thickness: string;
  selected: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The painted path, as the browser holds it. */
  d: string;
  strokeWidth: string;
}

const strokesOn = (page: Page): Promise<StrokeBox[]> =>
  page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-stroke-id]')) as HTMLElement[];
    return els.map((el) => {
      const path = el.querySelector('[data-testid="stroke-path"]');
      return {
        id: el.dataset.strokeId ?? '',
        color: el.dataset.strokeColor ?? '',
        thickness: el.dataset.strokeThickness ?? '',
        selected: el.dataset.selected ?? '',
        x: parseFloat(el.style.left),
        y: parseFloat(el.style.top),
        w: parseFloat(el.style.width),
        h: parseFloat(el.style.height),
        d: path?.getAttribute('d') ?? '',
        strokeWidth: path?.getAttribute('stroke-width') ?? '',
      };
    });
  });

const strokeCount = (page: Page) => strokesOn(page).then((s) => s.length);

/** The path the pen is painting right now, or null when it is painting nothing. */
const previewD = (page: Page): Promise<string | null> =>
  page.evaluate(() => document.querySelector('[data-testid="pen-preview"]')?.getAttribute('d') ?? null);

/** The board's own cursor, which the pen takes over. */
const viewportCursor = (page: Page) =>
  page.getByTestId('viewport').evaluate((el) => getComputedStyle(el as HTMLElement).cursor);

/** Every point of a board-unit path, where it lands on this screen, in one read. */
function onScreen(page: Page, path: readonly Point[], dx = 0, dy = 0): Promise<Point[]> {
  return page.evaluate(({ path, dx, dy }) => {
    const marker = document.querySelector('[data-testid="origin-marker"]')!.getBoundingClientRect();
    const ox = marker.x + marker.width / 2;
    const oy = marker.y + marker.height / 2;
    const layer = document.querySelector('[data-testid="world-layer"]') as HTMLElement;
    const m = /scale\(([\d.]+)\)/.exec(layer.style.transform);
    const zoom = m ? parseFloat(m[1]!) : 1;
    return path.map((p) => ({ x: ox + (p.x + dx) * zoom, y: oy + (p.y + dy) * zoom }));
  }, { path, dx, dy });
}

/** Drag through a path, one pointer move per point, without releasing. */
async function dragPath(page: Page, points: readonly Point[]): Promise<void> {
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
}

/** Arm the Pen with its toolbar button — unless it is already the armed tool, because
 * re-pressing an armed tool's button is how this board puts a tool away. */
async function armPen(page: Page): Promise<void> {
  const button = page.getByTestId('pen-tool');
  if ((await button.getAttribute('aria-pressed')) === 'true') return;
  await button.click();
  await settle(page);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Press, drag through `points`, release: one whole stroke. */
async function drawPath(page: Page, points: readonly Point[]): Promise<void> {
  await dragPath(page, points);
  await page.mouse.up();
  await settle(page);
}

/**
 * Start a sampler that runs in the page on *animation frames* — not on pointer events —
 * and records what the stroke in hand looks like at each repaint. The pen promises to keep
 * up with the hand frame by frame, and this is the only way to see a change happen across
 * frames rather than once per gesture.
 */
const startFrameSampler = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: string[]; __sampling: boolean };
    w.__frames = [];
    w.__sampling = true;
    const tick = () => {
      if (!w.__sampling) return;
      const path = document.querySelector('[data-testid="pen-preview"]');
      w.__frames.push(path?.getAttribute('d') ?? '');
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Stop the sampler and hand back what every animation frame showed. */
const stopFrameSampler = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: string[]; __sampling: boolean };
    w.__sampling = false;
    return w.__frames;
  });

test.describe('story 11 pen: draw a stroke (TC-17)', () => {
  test('a real drag paints a preview that keeps up, and the stroke outlives the drag', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);

    await armPen(page);
    // The board stops showing its own cursor: the tool draws a round one instead.
    expect(await viewportCursor(page)).toBe('none');

    // The pen's pointer is on the board as soon as the pointer is over it, before any
    // press, and it is the size of the thickness in use (4 board units at 100% zoom).
    const hover = await screenOf(page, { x: 900, y: 620 });
    await page.mouse.move(hover.x, hover.y);
    await settle(page);
    const dot = page.getByTestId('pen-cursor');
    await expect(dot).toHaveCount(1);
    expect(Number(await dot.getAttribute('r'))).toBeCloseTo(PEN_THICKNESS_WORLD[DEFAULT_PEN_THICKNESS] / 2, 1);

    // A hand-drawn circle, moved into a clear part of the board. The fixture carries a
    // point for every pixel the hand went over; every fourth of those is far more pointer
    // moves than a mouse would ever send, and the recorded stroke is the same shape.
    const every = (p: readonly Point[]): Point[] => p.filter((_, i) => i % 4 === 0);
    const loop = every(await onScreen(page, HANDWRITTEN_LOOP, 320, 0));
    await page.mouse.move(loop[0]!.x, loop[0]!.y);
    await page.mouse.down();
    await startFrameSampler(page);
    const quarter = Math.floor(loop.length / 4);
    for (const p of loop.slice(1, quarter)) await page.mouse.move(p.x, p.y);
    await settle(page);

    // The stroke in hand is on screen and nowhere in the board: the write comes later.
    const first = await previewD(page);
    expect(first).not.toBeNull();
    expect(first!).toContain('Q');
    expect(await strokeCount(page)).toBe(0);

    for (const p of loop.slice(quarter, quarter * 2)) await page.mouse.move(p.x, p.y);
    await settle(page);
    const second = await previewD(page);
    // The preview was redrawn as the hand moved: more line than there was a moment ago.
    expect(second).not.toBeNull();
    expect(second!.length).toBeGreaterThan(first!.length);
    expect(await strokeCount(page)).toBe(0);

    // What the frames held between them: the pointer never went up, and the line it was
    // dragging was different from frame to frame the whole way.
    const frames = await stopFrameSampler(page);
    const painted = frames.filter((d) => d !== '');
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(new Set(painted).size).toBeGreaterThanOrEqual(2);

    for (const p of loop.slice(quarter * 2)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
    await settle(page);

    // The finished stroke is one object, in the colour and thickness the pen was set to.
    const made = await strokesOn(page);
    expect(made.length).toBe(1);
    const stroke = made[0]!;
    expect(stroke.color).toBe(DEFAULT_PEN_COLOR);
    expect(stroke.thickness).toBe(DEFAULT_PEN_THICKNESS);
    expect(stroke.d.startsWith('M')).toBe(true);
    expect(stroke.strokeWidth).toBe(String(PEN_THICKNESS_WORLD.medium));
    // Its box is the box the hand went round, to within a pixel of the wobble.
    const xs = loop.map((p) => p.x);
    const ys = loop.map((p) => p.y);
    const start = await worldOfScreen(page, { x: Math.min(...xs), y: Math.min(...ys) });
    const end = await worldOfScreen(page, { x: Math.max(...xs), y: Math.max(...ys) });
    expect(Math.abs(stroke.x - start.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(stroke.y - start.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(stroke.w - (end.x - start.x))).toBeLessThanOrEqual(4);
    expect(Math.abs(stroke.h - (end.y - start.y))).toBeLessThanOrEqual(4);

    // The preview is gone — the line is the board's now — and it stays: nothing about
    // letting go of the pointer un-draws it.
    await expect(page.getByTestId('pen-preview')).toHaveCount(0);
    await page.waitForTimeout(400);
    expect((await strokesOn(page))[0]!.d).toBe(stroke.d);
    // The pen is still the armed tool, so the next stroke needs no second click.
    await expect(page.getByTestId('pen-tool')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a click is a dot, and the pen keeps drawing stroke after stroke', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);
    await armPen(page);

    const at = await screenOf(page, { x: 300, y: 300 });
    await page.mouse.click(at.x, at.y);
    await settle(page);
    const dots = await strokesOn(page);
    expect(dots.length).toBe(1);
    expect(dots[0]!.w).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 1);
    expect(dots[0]!.h).toBeCloseTo(PEN_THICKNESS_WORLD.medium, 1);
    expect(dots[0]!.d).toContain('L');

    // Without touching the toolbar again, a second and a third stroke are drawn.
    const underline = await onScreen(page, UNDERLINE);
    await drawPath(page, underline);
    const all = await strokesOn(page);
    expect(all.length).toBe(2);
    expect(all[1]!.w).toBeGreaterThan(all[0]!.w);
    await expect(page.getByTestId('pen-tool')).toHaveAttribute('aria-pressed', 'true');

    // Choosing another colour styles what comes next, not what is already drawn.
    await page.getByLabel('Blue pen').click();
    await page.getByRole('button', { name: 'Thick' }).click();
    await settle(page);
    const next = await screenOf(page, { x: 800, y: 700 });
    await page.mouse.click(next.x, next.y);
    await settle(page);
    const three = await strokesOn(page);
    expect(three.length).toBe(3);
    expect(three[2]!.color).toBe('blue');
    expect(three[2]!.thickness).toBe('thick');
    expect(three[1]!.color).toBe(DEFAULT_PEN_COLOR);
    expect(three[1]!.thickness).toBe(DEFAULT_PEN_THICKNESS);
  });

  // The STROKE_MAX_POINTS split (TC-12) is asserted in tests/component/PenTool.test.tsx:
  // it is a matter of how many points the tool recorded, and dragging a real pointer
  // through five thousand points would spend the whole suite's time proving something
  // that is not about the browser at all.
});

test.describe('story 11 pen: what a colleague sees (TC-18)', () => {
  test('nothing during the drag, the whole stroke within the latency budget', async ({
    context,
  }) => {
    const id = newBoardId();
    const priya = await context.newPage();
    const sam = await context.newPage();
    await openSharedBoard(priya, id);
    await openSharedBoard(sam, id);
    await setCamera(priya, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });
    await settle(priya);

    await armPen(priya);
    // Sam is only watching: the board is a board to him, not a drawing surface.
    expect(await strokeCount(sam)).toBe(0);
    expect(await pageHasPreview(sam)).toBe(false);

    const path = await onScreen(priya, UNDERLINE);
    await dragPath(priya, path);
    await settle(priya, 200);
    // Priya is mid-stroke, with half a sentence of line on her screen.
    expect((await previewD(priya)) !== null).toBe(true);
    // Sam sees nothing of it: no stroke, and no preview of hers either.
    expect(await strokeCount(sam)).toBe(0);
    expect(await pageHasPreview(sam)).toBe(false);

    const released = Date.now();
    await priya.mouse.up();
    // The finished stroke reaches him inside the budget the board promises (1s).
    await expect
      .poll(() => strokeCount(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(1);
    const arrived = Date.now();
    expect(arrived - released).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

    // It is the same stroke: same paint, same thickness, same path.
    const hers = (await strokesOn(priya))[0]!;
    const his = (await strokesOn(sam))[0]!;
    expect(his.id).toBe(hers.id);
    expect(his.color).toBe(hers.color);
    expect(his.thickness).toBe(hers.thickness);
    expect(his.d).toBe(hers.d);

    // He is not a drawer: his board shows no preview line and no armed tool.
    await expect(sam.getByTestId('pen-preview')).toHaveCount(0);
    await expect(sam.getByTestId('pen-tool')).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('story 11 pen: navigation and objects under the pen (TC-19)', () => {
  test('the wheel pans the board, and a drag that starts on a note draws without moving it', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);
    // One note to draw over, at a known place.
    const noteScreen = await screenOf(page, { x: 300, y: 320 });
    await createSticky(page, noteScreen.x, noteScreen.y, 'unchanged');
    await setCamera(page, { x: 0, y: 0, zoom: 1 });
    await settle(page);
    const before = await noteByTest(page, 'unchanged');
    if (!before) throw new Error('the note the pen draws over was not created');

    await armPen(page);

    // The wheel still belongs to the board while the pen is armed: it pans, and it does
    // not zoom and does not draw.
    const originBefore = await originCentre(page);
    await page.mouse.move(noteScreen.x + 260, noteScreen.y + 200);
    await page.mouse.wheel(0, 200);
    await settle(page);
    const originAfter = await originCentre(page);
    expect(originAfter.y).toBeLessThan(originBefore.y - 100);
    expect(await currentZoom(page)).toBeCloseTo(1, 2);
    expect(await strokeCount(page)).toBe(0);
    await expect(page.getByTestId('pen-tool')).toHaveAttribute('aria-pressed', 'true');

    // Now a stroke that starts on top of the note: the pen takes the pointer, so the note
    // is neither moved nor opened, and there is a stroke where the drag went.
    const start = await screenOf(page, { x: before.x + 40, y: before.y + 40 });
    const end = await screenOf(page, { x: before.x + 420, y: before.y + 160 });
    await drawPath(page, [start, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 30 }, end]);

    const after = (await notes(page)).find((n) => n.id === before.id)!;
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    expect(after.z).toBe(before.z);
    await expect(page.getByTestId('sticky-text-editor')).toHaveCount(0);
    const made = await strokesOn(page);
    expect(made.length).toBe(1);
    expect(made[0]!.w).toBeGreaterThan(300);
  });
});

test.describe('story 11 stroke: select, resize, move, delete (TC-20)', () => {
  test('a stroke selected by its line keeps its proportions, moves, and dies everywhere', async ({
    context,
  }) => {
    const id = newBoardId();
    const priya = await context.newPage();
    const sam = await context.newPage();
    await openSharedBoard(priya, id);
    await openSharedBoard(sam, id);
    await setCamera(priya, { x: 0, y: 0, zoom: 1 });
    await setCamera(sam, { x: 0, y: 0, zoom: 1 });
    await settle(priya);

    await armPen(priya);
    // A zig-zag 500x100 wide, drawn with four points so its shape is known.
    const zig: Point[] = [
      { x: 200, y: 200 },
      { x: 350, y: 300 },
      { x: 500, y: 200 },
      { x: 700, y: 300 },
    ];
    const screen = await onScreen(priya, zig);
    await drawPath(priya, screen);
    const drawn = (await strokesOn(priya))[0]!;
    await expect.poll(() => strokeCount(sam)).toBe(1);

    // Sam selects it by its box and finds nothing: a drawing is not its bounding box, and
    // the empty corner of this one is 80 units of blank board.
    const offLine = await screenOf(sam, { x: drawn.x + 20, y: drawn.y + drawn.h - 10 });
    await sam.mouse.click(offLine.x, offLine.y);
    await settle(sam);
    expect((await strokesOn(sam))[0]!.selected).toBe('false');
    // A click on the line itself, asked of the browser's own path geometry, does.
    const onLine = await screenOnStroke(sam, drawn.id, 0.2);
    await sam.mouse.click(onLine.x, onLine.y);
    await settle(sam);
    const selected = (await strokesOn(sam))[0]!;
    expect(selected.selected).toBe('true');
    const ratio = drawn.w / drawn.h;

    // Drag the south-east corner handle out: the box grows and keeps its proportions,
    // because a drawing is stretched, never squashed (aspectLocked).
    const handle = await sam.locator('[data-handle="se"]').boundingBox();
    if (!handle) throw new Error('no south-east handle on a selected stroke');
    await sam.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await sam.mouse.down();
    await sam.mouse.move(handle.x + 240, handle.y + 240, { steps: 10 });
    await sam.mouse.up();
    await settle(sam, 200);
    const grown = (await strokesOn(sam))[0]!;
    expect(grown.w).toBeGreaterThan(drawn.w);
    expect(Math.abs(grown.w / grown.h - ratio) / ratio).toBeLessThan(0.01);
    // The line got no thicker for being bigger: the thickness is the pen's, not the box's.
    expect(grown.strokeWidth).toBe(drawn.strokeWidth);
    // Priya sees the same box.
    const seenByPriya = (await strokesOn(priya))[0]!;
    expect(Math.abs(seenByPriya.w - grown.w)).toBeLessThanOrEqual(1);

    // Drag the body: the whole stroke moves by the drag, and stays the same shape. The
    // press goes on the same place on the same line, which the browser locates for the
    // box the stroke has been resized into.
    const grownPoint = await screenOnStroke(sam, drawn.id, 0.2);
    await sam.mouse.move(grownPoint.x, grownPoint.y);
    await sam.mouse.down();
    await sam.mouse.move(grownPoint.x + 90, grownPoint.y + 60, { steps: 8 });
    await sam.mouse.up();
    await settle(sam, 200);
    const moved = (await strokesOn(sam))[0]!;
    expect(Math.abs(moved.x - (grown.x + 90))).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.y - (grown.y + 60))).toBeLessThanOrEqual(2);
    expect(Math.abs(moved.w / moved.h - ratio) / ratio).toBeLessThan(0.01);

    // Delete takes it away on the screen that deleted it, and on the other one too.
    await sam.keyboard.press('Delete');
    await settle(sam);
    expect(await strokeCount(sam)).toBe(0);
    await expect
      .poll(() => strokeCount(priya), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
      .toBe(0);
    // And the pen can draw again on the cleared board.
    await armPen(priya);
    const again = await screenOf(priya, { x: 250, y: 500 });
    await priya.mouse.click(again.x, again.y);
    await settle(priya);
    expect(await strokeCount(priya)).toBe(1);
    await expect.poll(() => strokeCount(sam), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS }).toBe(1);
  });
});

/**
 * Where a fraction of the way along a stroke's painted line lands on the screen, asked of
 * the browser's own path geometry. A click there is a click on the line the viewer sees,
 * at whatever size the stroke has been resized to, without my approximating the curve.
 */
function screenOnStroke(page: Page, id: string, fraction: number): Promise<Point> {
  return page.evaluate(
    ({ id, fraction }) => {
      const svg = document.querySelector(`[data-stroke-id="${id}"]`) as unknown as SVGSVGElement | null;
      if (!svg) throw new Error(`no stroke on this screen to measure`);
      const path = svg.querySelector('[data-testid="stroke-path"]') as unknown as SVGPathElement | null;
      if (!path) throw new Error('the stroke paints nothing');
      const vb = svg.viewBox.baseVal;
      const rect = svg.getBoundingClientRect();
      const p = path.getPointAtLength(path.getTotalLength() * fraction);
      return {
        x: rect.left + ((p.x - vb.x) / vb.width) * rect.width,
        y: rect.top + ((p.y - vb.y) / vb.height) * rect.height,
      };
    },
    { id, fraction },
  );
}

/** Does this page hold a preview path of any tool? Sam never should. */
function pageHasPreview(page: Page): Promise<boolean> {
  return page.evaluate(() => document.querySelectorAll('[data-testid="pen-preview"]').length > 0);
}
