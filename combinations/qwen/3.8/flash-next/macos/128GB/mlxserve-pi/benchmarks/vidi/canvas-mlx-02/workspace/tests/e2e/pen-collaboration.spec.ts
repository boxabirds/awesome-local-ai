// Story 11 end-to-end, the Pen with two people: what one of them is drawing must not
// be visible while it is being drawn, and what they draw must be on the other board a
// moment after the pen lifts - and then be tidiable.
//
// TC-18 and TC-20 of the design. This is a nightly spec (the file name is what
// playwright.nightly.config.ts matches): it opens a browser context per person and
// waits for the two of them to agree, which is slower and less certain to land on the
// same frame than the rest of the suite, so it is retried for that reason. The
// single-screen half of the story - TC-17, TC-19 - is in `pen.spec.ts`.
//
// The requirement that decided the shape of the tool is the first one here: a stroke is
// written ONCE, when the pen lifts. A pen that sent its points as it went would put
// five thousand updates on the wire for one line, and everybody else would watch a
// drawing being built. So the other screen is watched while the author's pointer is
// down, and must see nothing at all - and then the one update that does arrive has to
// be fast, because a sketch you cannot see your colleague make is not a shared sketch.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { ensureBoard } from './helpers/board.ts';
import { openBoard, newCollaborator, getConnectionState } from './helpers/room.ts';
import { getCamera, type Cam } from './helpers/sticky.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, PEN_THICKNESS_WORLD } from '../../src/shared/config.ts';

interface Point {
  x: number;
  y: number;
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  thickness: string;
  points: number;
}

// The room is allowed a moment; story 3's own convergence allowance is five of them.
const CONVERGE = LIVE_UPDATE_LATENCY_BUDGET_MS * 5;

const screenOf = (cam: Cam, p: Point): Point => ({
  x: (p.x - cam.x) * cam.zoom,
  y: (p.y - cam.y) * cam.zoom,
});

// Only the root element of a stroke carries the object id, so this counts drawings
// rather than the parts a drawing is drawn from.
const strokeEls = (page: Page): Locator => page.locator('[data-testid^="stroke-"][data-object-id]');

async function strokeBoxes(page: Page): Promise<Box[]> {
  return strokeEls(page).evaluateAll((els) =>
    els.map((e) => {
      const el = e as HTMLElement;
      return {
        id: el.dataset.objectId ?? '',
        x: parseFloat(el.dataset.worldX ?? ''),
        y: parseFloat(el.dataset.worldY ?? ''),
        width: parseFloat(el.dataset.worldWidth ?? ''),
        height: parseFloat(el.dataset.worldHeight ?? ''),
        color: el.dataset.color ?? '',
        thickness: el.dataset.thickness ?? '',
        points: parseInt(el.dataset.points ?? '', 10),
      };
    }),
  );
}

const boxOf = async (page: Page, id: string): Promise<Box> => {
  const found = (await strokeBoxes(page)).find((b) => b.id === id);
  if (!found) throw new Error(`stroke ${id} is not on this screen`);
  return found;
};

/** Where the middle of the line is, on screen: the point a click can land on. */
async function pointOnTheLine(page: Page, id: string): Promise<Point> {
  const cam = await getCamera(page);
  const p = await page.locator(`[data-testid="stroke-${id}"]`).evaluate((e) => ({
    x: parseFloat((e as HTMLElement).dataset.onLineX ?? ''),
    y: parseFloat((e as HTMLElement).dataset.onLineY ?? ''),
  }));
  return screenOf(cam, p);
}

function watchForErrors(page: Page, who: string): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${who}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who}: console ${m.text()}`);
  });
  return errors;
}

/** Open the pen the way a person does. */
async function openPen(page: Page): Promise<void> {
  await page.click('[data-testid="tool-pen"]');
  await page.waitForSelector('[data-testid="pen-tool"]');
}

/**
 * A pen drag that is left held down: press at the start of the path and travel one
 * recorded point at a time. The point of returning it in pieces is that the test gets
 * to look at the OTHER screen between the moves, which is the only way to find out
 * what is being sent while a drawing is being drawn.
 */
async function holdPen(page: Page, path: readonly Point[]): Promise<{
  step: (i: number) => Promise<void>;
  /** Lift the pen, and say when: the other screen is timed from that moment. */
  release: () => Promise<number>;
}> {
  const cam = await getCamera(page);
  await openPen(page);
  const pts = path.map((p) => screenOf(cam, p));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  return {
    step: async (i: number): Promise<void> => {
      await page.mouse.move(pts[i].x, pts[i].y);
    },
    release: async (): Promise<number> => {
      await page.mouse.up();
      return Date.now();
    },
  };
}

/** Pull a resize handle by a screen delta. */
async function dragHandleBy(page: Page, handle: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(`[data-handle="${handle}"]`).boundingBox();
  if (!box) throw new Error(`the ${handle} handle is not on screen`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

/** Drag the line itself by a screen delta: a move, not a resize. */
async function dragLineBy(page: Page, from: Point, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dx * i) / 8, from.y + (dy * i) / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// A wave with a box worth resizing.
function scribble(): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= 24; i++) out.push({ x: -170 + i * 15, y: -20 + Math.sin(i / 2.4) * 70 });
  return out;
}

// TC-18: in-progress strokes are not sent. Priya draws while Sam watches: there is
// nothing new on Sam's screen while the pointer moves, and the finished line is there
// within the budget the settings name - as one stroke, all at once.
test('TC-18 a stroke arrives on the other screen when the pen lifts, and not before', async ({ browser }) => {
  test.setTimeout(180_000);
  const boardId = newBoardId();
  await ensureBoard(boardId);
  const priya = await newCollaborator(browser);
  const sam = await newCollaborator(browser);
  const errors = [...watchForErrors(priya, 'priya'), ...watchForErrors(sam, 'sam')];
  try {
    await openBoard(priya, boardId);
    await openBoard(sam, boardId);

    // The two of them are in the same room, and that is established before anything is
    // concluded from an empty screen: a stroke drawn now is seen over there.
    const warmup = await holdPen(priya, [
      { x: -300, y: -220 },
      { x: -200, y: -180 },
      { x: -100, y: -220 },
    ]);
    await warmup.step(1);
    await warmup.step(2);
    await warmup.release();
    await expect(strokeEls(sam)).toHaveCount(1, { timeout: CONVERGE });
    expect(await getConnectionState(sam)).toBe('connected');

    // Now the drawing that is watched. Priya's pointer goes down and travels; nothing
    // arrives, because a stroke is written when the pen lifts and not before.
    const path = scribble();
    const drag = await holdPen(priya, path);
    let arrivedDuring = false;
    let previewOnSam = false;
    for (let i = 1; i < path.length; i++) {
      await drag.step(i);
      if ((await strokeEls(sam).count()) !== 1) arrivedDuring = true;
      if ((await sam.locator('[data-testid="pen-preview"]').count()) !== 0) previewOnSam = true;
    }
    expect(arrivedDuring).toBe(false); // the drawing was not broadcast point by point
    expect(previewOnSam).toBe(false); // and the line being drawn is Priya's own screen's business
    // Priya is plainly drawing: the preview is there, and it is a line.
    await expect(priya.locator('[data-testid="pen-preview-path"]')).toBeVisible();

    const released = await drag.release();
    // Sam sees the finished stroke within the update budget of the pen lifting. The
    // wait is generous so a slow-but-legal arrival reports its time instead of timing
    // out; the assertion is the time, not the wait.
    await strokeEls(sam).nth(1).waitFor({ state: 'visible', timeout: CONVERGE });
    const elapsed = Date.now() - released;
    expect(elapsed).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

    // It is ONE stroke over there, and it is the same drawing: same box, same colour,
    // same weight. Not a sequence of partial lines that add up to something.
    await expect(strokeEls(sam)).toHaveCount(2);
    const strokeId = await strokeEls(sam).nth(1).evaluate((e) => (e as HTMLElement).dataset.objectId ?? '');
    const mine = await boxOf(priya, strokeId);
    const there = await boxOf(sam, strokeId);
    expect(there.color).toBe(mine.color);
    expect(there.thickness).toBe(mine.thickness);
    expect(there.x).toBeCloseTo(mine.x, 1);
    expect(there.y).toBeCloseTo(mine.y, 1);
    expect(there.width).toBeCloseTo(mine.width, 1);
    expect(there.height).toBeCloseTo(mine.height, 1);
    expect(there.points).toBeGreaterThan(1);
    // The wave is drawn, not the whole drag: the recording was smoothed to the
    // tolerance the settings allow.
    expect(mine.points).toBeLessThanOrEqual(path.length);

    // And the same again for the next stroke, with the first one left exactly where it
    // was: a stroke never moves because somebody else drew one.
    const settled = await boxOf(sam, strokeId);
    const next = await holdPen(
      priya,
      [
        { x: -170, y: 160 },
        { x: 0, y: 170 },
        { x: 180, y: 150 },
      ],
    );
    await next.step(1);
    expect(await strokeEls(sam).count()).toBe(2);
    await next.release();
    await expect(strokeEls(sam)).toHaveCount(3, { timeout: CONVERGE });
    expect(await boxOf(sam, strokeId)).toEqual(settled);

    expect(errors).toEqual([]);
  } finally {
    await priya.close();
    await sam.close();
  }
});

// TC-20: a sketch is an object. Click its line to select it, pull a corner and it keeps
// its proportions, drag the line and the whole drawing goes with it, delete it and it
// is gone from both screens.
test('TC-20 a sketch is selected by its line, resized proportionally, moved and deleted', async ({ browser }) => {
  test.setTimeout(180_000);
  const boardId = newBoardId();
  await ensureBoard(boardId);
  const priya = await newCollaborator(browser);
  const sam = await newCollaborator(browser);
  const errors = [...watchForErrors(priya, 'priya'), ...watchForErrors(sam, 'sam')];
  try {
    await openBoard(priya, boardId);
    await openBoard(sam, boardId);

    const drag = await holdPen(priya, scribble());
    for (let i = 1; i < 25; i++) await drag.step(i);
    await drag.release();
    await expect(strokeEls(sam)).toHaveCount(1, { timeout: CONVERGE });
    const drawn = (await strokeBoxes(priya))[0];

    // The pen is given back before the drawing is tidied: it is a tool, not a mode
    // somebody is caught in.
    await priya.keyboard.press('Escape');
    await expect(priya.locator('[data-testid="pen-tool"]')).toHaveCount(0);
    await expect(priya.locator('[data-testid="pen-toolbar"]')).toHaveCount(0);

    // A click inside the box but nowhere near the line selects nothing: the box around
    // a drawing is not the drawing (TC-16, in a real browser this time).
    const far = await (async () => {
      const cam = await getCamera(priya);
      return screenOf(cam, { x: drawn.x + drawn.width - 1, y: drawn.y + 1 });
    })();
    await priya.mouse.click(far.x, far.y);
    await expect(priya.locator('[data-testid="selection-box"]')).toHaveCount(0);

    // A click ON the line selects it, and it wears a selection of its own.
    const grab = await pointOnTheLine(priya, drawn.id);
    await priya.mouse.click(grab.x, grab.y);
    await expect(priya.locator('[data-testid="selection-box"]')).toHaveCount(1);
    await expect(priya.locator(`[data-testid="stroke-${drawn.id}"]`)).toHaveAttribute('data-selected', 'true');
    await expect(priya.locator(`[data-testid="stroke-selection-${drawn.id}"]`)).toBeVisible();

    // A corner handle: the drawing keeps its proportions, because a sketch that comes
    // out fatter than it went in is a different sketch.
    const aspect = drawn.width / drawn.height;
    await dragHandleBy(priya, 'se', 90, 45);
    const grown = await boxOf(priya, drawn.id);
    expect(grown.width).toBeGreaterThan(drawn.width);
    expect(grown.height).toBeGreaterThan(drawn.height);
    expect(Math.abs(grown.width / grown.height / aspect - 1)).toBeLessThan(0.01);
    // The resize rewrote the box and nothing else: the weight of the pen did not scale
    // up with the picture, and the drawing is the same drawing drawn bigger.
    expect(grown.thickness).toBe(drawn.thickness);
    expect(Number(await priya.locator(`[data-testid="stroke-path-${drawn.id}"]`).getAttribute('stroke-width'))).toBe(
      PEN_THICKNESS_WORLD.medium,
    );
    expect(grown.color).toBe(drawn.color);
    // Sam's board holds the same box.
    await expect(async () => {
      expect((await boxOf(sam, drawn.id)).width).toBeCloseTo(grown.width, 1);
    }).toPass({ timeout: CONVERGE });

    // Drag the line itself and the whole drawing moves - and the size stays.
    const beforeMove = await boxOf(priya, drawn.id);
    const cam = await getCamera(priya);
    await dragLineBy(priya, await pointOnTheLine(priya, drawn.id), -72, 88);
    const moved = await boxOf(priya, drawn.id);
    expect(moved.x).toBeCloseTo(beforeMove.x - 72 / cam.zoom, 1);
    expect(moved.y).toBeCloseTo(beforeMove.y + 88 / cam.zoom, 1);
    expect(moved.width).toBeCloseTo(beforeMove.width, 1);
    expect(moved.height).toBeCloseTo(beforeMove.height, 1);
    await expect(async () => {
      const there = await boxOf(sam, drawn.id);
      expect(there.x).toBeCloseTo(moved.x, 1);
      expect(there.y).toBeCloseTo(moved.y, 1);
    }).toPass({ timeout: CONVERGE });

    // And it is deleted: gone from both screens, selection and all, leaving a board
    // that still works - the proof being that another line can be drawn over the space
    // it left.
    await priya.keyboard.press('Delete');
    await expect(strokeEls(priya)).toHaveCount(0);
    await expect(strokeEls(sam)).toHaveCount(0, { timeout: CONVERGE });
    await expect(priya.locator('[data-testid="selection-box"]')).toHaveCount(0);

    const again = await holdPen(priya, [
      { x: -120, y: -60 },
      { x: 0, y: -20 },
      { x: 120, y: -60 },
    ]);
    await again.step(1);
    await again.release();
    await expect(strokeEls(sam)).toHaveCount(1, { timeout: CONVERGE });

    expect(errors).toEqual([]);
  } finally {
    await priya.close();
    await sam.close();
  }
});
