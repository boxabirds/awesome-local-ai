import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { expectConnected, joinBoard, setCamera, startBoard, watchErrors } from './helpers/live';

/**
 * Story 10 e2e (TC-25 to TC-27): arrows between shapes in two browsers on one
 * board — an arrow follows a shape the other person moved, survives the delete of
 * what it pointed at, and is created safely when that delete races the drag.
 */

const PIN = { x: 0, y: 0, zoom: 1 };

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

async function shapeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="shape-object-"]')].map((element) =>
      String(element.getAttribute('data-testid')).slice('shape-object-'.length),
    ),
  );
}

async function arrowIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="connector-object-"]')].map((element) =>
      String(element.getAttribute('data-testid')).slice('connector-object-'.length),
    ),
  );
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.locator(`[data-testid="${testId}"]`).boundingBox();
  if (box === null) throw new Error(`${testId} is not on screen`);
  return box;
}

const shapeBox = (page: Page, id: string): Promise<Box> => boxOf(page, `shape-object-${id}`);
const centreOf = (box: Box): Point => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** Create a shape with the Shape tool and return its id. */
async function createShape(page: Page, box: Box): Promise<string> {
  const before = new Set(await shapeIds(page));
  await page.keyboard.press('s');
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width, box.y + box.height, { steps: 6 });
  await page.mouse.up();
  let id = '';
  await expect
    .poll(async () => {
      id = (await shapeIds(page)).find((candidate) => !before.has(candidate)) ?? '';
      return id;
    })
    .not.toBe('');
  return id;
}

/** Press L and drag from one point to another; returns the arrow's id, or ''. */
async function dragArrow(
  page: Page,
  from: Point,
  to: Point,
  steps = 8,
): Promise<string> {
  const before = new Set(await arrowIds(page));
  await page.keyboard.press('l');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps });
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
  const created = (await arrowIds(page)).find((candidate) => !before.has(candidate));
  return created ?? '';
}

/**
 * Where an arrow's two ends are drawn, in screen coordinates: the end points are
 * stored in the line's own local space, which the padded, scaled container places
 * back on the board.
 */
async function arrowEnds(page: Page, id: string): Promise<{ from: Point; to: Point }> {
  const ends = await page.evaluate((connectorId) => {
    const root = document.querySelector(`[data-testid="connector-object-${connectorId}"]`);
    const line = root?.querySelector('[data-part="arrow-line"]');
    if (!root || !line) return null;
    const rect = root.getBoundingClientRect();
    const zoom = (window as unknown as { __vidi6: { getCamera(): { zoom: number } } })
      .__vidi6.getCamera().zoom;
    const num = (name: string): number => Number.parseFloat(line.getAttribute(name) ?? '0');
    return {
      from: { x: rect.left + num('x1') * zoom, y: rect.top + num('y1') * zoom },
      to: { x: rect.left + num('x2') * zoom, y: rect.top + num('y2') * zoom },
    };
  }, id);
  if (ends === null) throw new Error(`arrow ${id} is not on ${page.url()}`);
  return ends;
}


/** An arrow's ends and the shapes it hangs off, measured in one pass. */
interface FlowState {
  boxes: Record<string, Box>;
  from: Point;
  to: Point;
}

/**
 * The arrow's two ends and the shapes' boxes read together. Two separate reads
 * can straddle a live update and compare an end against the box it was drawn
 * against a moment ago, which looks exactly like a detached arrow.
 */
async function flowState(page: Page, arrowId: string, shapes: string[]): Promise<FlowState> {
  const state = await page.evaluate(
    ({ connectorId, shapeIds }) => {
      const root = document.querySelector(`[data-testid="connector-object-${connectorId}"]`);
      const line = root?.querySelector('[data-part="arrow-line"]');
      if (!root || !line) return null;
      const boxes: Record<string, Box> = {};
      for (const id of shapeIds) {
        const element = document.querySelector(`[data-testid="shape-object-${id}"]`);
        if (!element) return null;
        const r = element.getBoundingClientRect();
        boxes[id] = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
      const rect = root.getBoundingClientRect();
      const zoom = (window as unknown as { __vidi6: { getCamera(): { zoom: number } } })
        .__vidi6.getCamera().zoom;
      const num = (name: string): number => Number.parseFloat(line.getAttribute(name) ?? '0');
      return {
        boxes,
        from: { x: rect.left + num('x1') * zoom, y: rect.top + num('y1') * zoom },
        to: { x: rect.left + num('x2') * zoom, y: rect.top + num('y2') * zoom },
      };
    },
    { connectorId: arrowId, shapeIds: shapes },
  );
  if (state === null) throw new Error(`arrow ${arrowId} or one of its shapes is not on screen`);
  return state;
}

/** `"side the arrow leaves A,side the arrow arrives at B"`, e.g. `"right,left"`. */
async function attachSides(page: Page, arrowId: string, a: string, b: string): Promise<string> {
  const state = await flowState(page, arrowId, [a, b]);
  return `${sideOf(state.boxes[a], state.from)},${sideOf(state.boxes[b], state.to)}`;
}

/** Which side of `box` the point sits on ('off' when it is not on its outline). */
function sideOf(box: Box, point: Point, tolerance = 3): 'left' | 'right' | 'top' | 'bottom' | 'off' {
  const near = (value: number, target: number): boolean => Math.abs(value - target) <= tolerance;
  const insideX = point.x >= box.x - tolerance && point.x <= box.x + box.width + tolerance;
  const insideY = point.y >= box.y - tolerance && point.y <= box.y + box.height + tolerance;
  if (near(point.x, box.x) && insideY) return 'left';
  if (near(point.x, box.x + box.width) && insideY) return 'right';
  if (near(point.y, box.y) && insideX) return 'top';
  if (near(point.y, box.y + box.height) && insideX) return 'bottom';
  return 'off';
}

async function openClients(
  browser: Browser,
  count: number,
): Promise<{ pages: Page[]; close(): Promise<void> }> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  let boardId = '';
  for (let i = 0; i < count; i++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    if (i === 0) {
      boardId = await startBoard(page);
    } else {
      await joinBoard(page, boardId);
    }
    await setCamera(page, PIN);
    await expectConnected(page);
  }
  return {
    pages,
    async close() {
      await Promise.all(contexts.map((context) => context.close()));
    },
  };
}

/** Two shapes side by side, created by Dana and waited for on Sam's screen. */
async function twoShapes(
  dana: Page,
  sam: Page,
): Promise<{ a: string; b: string; aBox: Box; bBox: Box }> {
  const a = await createShape(dana, { x: 160, y: 140, width: 160, height: 100 });
  const b = await createShape(dana, { x: 620, y: 140, width: 160, height: 100 });
  await expect.poll(async () => (await shapeIds(sam)).length).toBe(2);
  return { a, b, aBox: await shapeBox(dana, a), bBox: await shapeBox(dana, b) };
}

test.describe('Connectors e2e', () => {
  test('TC-25: an arrow follows a shape the other person drags past its partner', async ({
    browser,
  }) => {
    const { pages, close } = await openClients(browser, 2);
    const dana = pages[0];
    const sam = pages[1];
    try {
      const { a, b, aBox, bBox } = await twoShapes(dana, sam);

      const id = await dragArrow(dana, centreOf(aBox), centreOf(bBox));
      expect(id).not.toBe('');
      await expect.poll(async () => (await arrowIds(sam)).length).toBe(1);

      // Attached at both ends: out of A's right side, into B's left side.
      await expect(attachSides(sam, id, a, b)).resolves.toBe('right,left');

      // Dana drags B below and to the left of A.
      const start = centreOf(await shapeBox(dana, b));
      await dana.mouse.move(start.x, start.y);
      await dana.mouse.down();
      await dana.mouse.move(start.x - 520, start.y + 280, { steps: 12 });
      await dana.mouse.up();

      // On Sam's screen the arrow is still attached, and on different sides,
      // inside the change-delivery budget the PRD states.
      await expect
        .poll(() => attachSides(sam, id, a, b), { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS })
        .toBe('bottom,top');
      // Dana's own view agrees; the arrow moved with the shape, not with the drag.
      await expect(attachSides(dana, id, a, b)).resolves.toBe('bottom,top');
    } finally {
      await close();
    }
  });

  test('TC-26: deleting the target leaves the arrow, end free where its side was', async ({
    browser,
  }) => {
    const { pages, close } = await openClients(browser, 2);
    const dana = pages[0];
    const sam = pages[1];
    try {
      const { a, b, aBox, bBox } = await twoShapes(dana, sam);
      const id = await dragArrow(dana, centreOf(aBox), centreOf(bBox));
      expect(id).not.toBe('');
      await expect.poll(async () => (await arrowIds(sam)).length).toBe(1);

      // The end sits on the side of B that faced A; that point is where it stays.
      const before = await flowState(sam, id, [b]);
      const anchor = {
        x: before.boxes[b].x,
        y: before.boxes[b].y + before.boxes[b].height / 2,
      };
      expect(Math.abs(before.to.x - anchor.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(before.to.y - anchor.y)).toBeLessThanOrEqual(2);

      const samCentre = centreOf(before.boxes[b]);
      await sam.mouse.click(samCentre.x, samCentre.y);
      await sam.keyboard.press('Delete');

      for (const page of [dana, sam]) {
        await expect.poll(async () => (await shapeIds(page)).includes(b)).toBe(false);
        expect(await arrowIds(page)).toEqual([id]);
        const after = await flowState(page, id, [a]);
        // Free, but not moved: still exactly where B's side was.
        expect(Math.abs(after.to.x - anchor.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(after.to.y - anchor.y)).toBeLessThanOrEqual(2);
        // The other end still hangs off A.
        expect(sideOf(after.boxes[a], after.from)).not.toBe('off');
      }
    } finally {
      await close();
    }
  });

  test('TC-27: a target deleted mid-drag leaves an arrow at its fallback point', async ({
    browser,
  }) => {
    const { pages, close } = await openClients(browser, 2);
    const dana = pages[0];
    const sam = pages[1];
    const danaErrors = watchErrors(dana);
    const samErrors = watchErrors(sam);
    try {
      const { a, b, aBox, bBox } = await twoShapes(dana, sam);
      expect(a).not.toBe('');

      // Dana starts an arrow to B and holds the button over it.
      const release = centreOf(bBox);
      await dana.keyboard.press('l');
      await dana.mouse.move(centreOf(aBox).x, centreOf(aBox).y);
      await dana.mouse.down();
      await dana.mouse.move(release.x, release.y, { steps: 10 });
      await expect(dana.getByTestId('connector-preview')).toBeVisible();

      // Sam deletes B while that drag is still in the air.
      await sam.mouse.click(release.x, release.y);
      await sam.keyboard.press('Delete');
      await expect.poll(async () => (await shapeIds(dana)).includes(b)).toBe(false);

      await dana.mouse.up();

      // Dana's arrow exists and its end sits at the point it was released on.
      await expect
        .poll(async () => (await arrowIds(dana)).length)
        .toBe(1);
      const id = (await arrowIds(dana))[0];
      const ends = await arrowEnds(dana, id);
      expect(Math.abs(ends.to.x - release.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(ends.to.y - release.y)).toBeLessThanOrEqual(2);
      await expect.poll(async () => (await arrowIds(sam)).length).toBe(1);

      expect(danaErrors.errors()).toEqual([]);
      expect(samErrors.errors()).toEqual([]);
    } finally {
      await close();
    }
  });
});
