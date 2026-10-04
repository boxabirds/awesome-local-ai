import { test, expect, type Page } from '@playwright/test';
import { setCamera, settle } from './helpers/board';
import {
  openParticipants,
  closeParticipants,
  expectEventually,
  createBoardViaApi,
  createBoardId,
  type Participant,
} from './helpers/participants';
import { seedCheckoutFlowToBoard } from './helpers/seed-checkout';

/**
 * story 10 e2e: shapes, connectors and the "arrows follow when objects move"
 * behaviour.
 *
 * Camera convention: the default camera shows world (0,0) at screen centre
 * (640, 400) at zoom 1, so screen = world + (640, 400).
 */

// --- helpers ---------------------------------------------------------------

async function shapeBox(page: Page, index = 0) {
  const box = await page.locator('[data-vidi6="shape"]').nth(index).boundingBox();
  if (!box) throw new Error(`shape ${index} has no bounding box`);
  return box;
}

async function shapeCount(page: Page): Promise<number> {
  return page.locator('[data-vidi6="shape"]').count();
}

async function connectorCount(page: Page): Promise<number> {
  return page.locator('[data-vidi6="connector"]').count();
}

/** The connector hit-line endpoints in world units. */
async function lineCoords(page: Page, index = 0) {
  return page.locator('[data-vidi6="connector-line"]').nth(index).evaluate((el) => {
    const a = el as SVGLineElement;
    return {
      x1: Number(a.getAttribute('x1')),
      y1: Number(a.getAttribute('y1')),
      x2: Number(a.getAttribute('x2')),
      y2: Number(a.getAttribute('y2')),
    };
  });
}

async function dragShape(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.press('s');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
}

async function connect(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.press('l');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 10 });
  await page.mouse.up();
}

async function dragObjectTo(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 10 });
  await page.mouse.up();
}

/** The rendered text block of a shape label (line count + centre), via Range. */
async function labelTextBlock(page: Page) {
  return page.locator('[data-vidi6="shape-label"]').first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    if (rects.length === 0) return null;
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    return { lines: rects.length, cx: (left + right) / 2, cy: (top + bottom) / 2 };
  });
}

function approx(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

// --- single-participant tests ----------------------------------------------

test.describe('story 10: shapes and connectors', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    const boardId = await createBoardViaApi(baseURL!);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });
    await setCamera(page, { x: -640, y: -400, zoom: 1 });
    await settle(page);
  });

  // TC-23: a real drag at 100% creates a shape at the dragged rect (±1px).
  test('TC-23: drag (100,100)→(300,220) at 100% creates a 200x120 shape there', async ({ page }) => {
    await dragShape(page, 100, 100, 300, 220);
    await settle(page);

    expect(await shapeCount(page)).toBe(1);
    const box = await shapeBox(page);
    expect(approx(box.x, 100, 2)).toBe(true);
    expect(approx(box.y, 100, 2)).toBe(true);
    expect(approx(box.width, 200, 2)).toBe(true);
    expect(approx(box.height, 120, 2)).toBe(true);
  });

  // TC-24: at 200% zoom a diamond click creates 160x160 centred on the click;
  // a long label wraps and stays centred after resizing via a handle.
  test('TC-24: diamond click at 200% zoom; long label wraps and stays centred on resize', async ({ page }) => {
    await setCamera(page, { x: -320, y: -200, zoom: 2 });
    await settle(page);

    // Diamond kind + click at screen centre (world 0,0)
    await page.keyboard.press('s');
    await page.click('[data-vidi6="shape-kind-diamond"]');
    await page.mouse.click(640, 400);
    await settle(page);

    expect(await shapeCount(page)).toBe(1);
    const box = await shapeBox(page);
    // 160 world x 2 = 320 screen, centred on (640, 400)
    expect(approx(box.x, 480, 2)).toBe(true);
    expect(approx(box.y, 240, 2)).toBe(true);
    expect(approx(box.width, 320, 2)).toBe(true);
    expect(approx(box.height, 320, 2)).toBe(true);

    // Label longer than the shape width
    await page.mouse.dblclick(640, 400);
    await expect(page.locator('[data-vidi6="shape-label-editor"]')).toBeVisible({ timeout: 5000 });
    await page.keyboard.type('Quarterly goals and priorities for the upcoming planning cycle');
    await page.keyboard.press('Escape');
    await settle(page);

    // The label wraps onto several lines and is centred in the shape
    const label = await labelTextBlock(page);
    expect(label).not.toBeNull();
    expect(label!.lines).toBeGreaterThan(1);
    expect(approx(label!.cx, 640, 3)).toBe(true);
    expect(approx(label!.cy, 400, 4)).toBe(true);

    // Resize via the south-east handle (320 → 400 screen wide)
    const se = await page.locator('[data-vidi6="selection-handle"][data-handle="se"]').boundingBox();
    if (!se) throw new Error('se handle has no bounding box');
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
    await page.mouse.down();
    await page.mouse.move(se.x + se.width / 2 + 80, se.y + se.height / 2, { steps: 8 });
    await page.mouse.up();
    await settle(page);

    const boxAfter = await shapeBox(page);
    expect(boxAfter.width).toBeGreaterThan(box.width + 60);

    // The label is still centred in the (wider) shape
    const labelAfter = await labelTextBlock(page);
    expect(labelAfter).not.toBeNull();
    expect(approx(labelAfter!.cx, boxAfter.x + boxAfter.width / 2, 3)).toBe(true);
    expect(approx(labelAfter!.cy, boxAfter.y + boxAfter.height / 2, 4)).toBe(true);
  });

  // The checkout-flow fixture renders fully (4 labelled shapes, 4 connectors
  // incl. the free-ended one) without console errors — "orphaned render".
  test('checkout-flow fixture: shapes and connectors render, incl. the free end', async ({ page, baseURL }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    const boardId = await createBoardViaApi(baseURL!);
    await seedCheckoutFlowToBoard(baseURL!, boardId);
    await page.goto(`/b/${boardId}`);
    await page.waitForSelector('[data-vidi6="board-viewport"]', { timeout: 15000 });
    await setCamera(page, { x: -300, y: -300, zoom: 1 });
    await settle(page);

    await expectEventually(async () => (await shapeCount(page)) === 4, 'four shapes visible');
    await expectEventually(async () => (await connectorCount(page)) === 4, 'four connectors visible');

    // The labels are the fixture's labels
    const labels = await page.locator('[data-vidi6="shape-label"]').allTextContents();
    expect(labels.sort()).toEqual(['Charge card', 'Customer arrives', 'In stock?', 'Order confirmed']);

    // The free-ended connector renders (its "to" end is a plain world point)
    const freeLine = await lineCoords(page, 3);
    expect(Number.isFinite(freeLine.x2)).toBe(true);

    expect(errors).toEqual([]);
  });
});

// --- collaborative tests -----------------------------------------------------

test.describe('story 10: collaborative shapes and connectors', () => {
  let boardId: string;
  let participants: Participant[];

  test.beforeEach(() => {
    boardId = createBoardId();
  });

  test.afterEach(async () => {
    if (participants) await closeParticipants(participants);
  });

  /** Both participants: Dana drags A (400,300→600,400) and B (900,400→1100,500). */
  async function createAB(dana: Participant): Promise<void> {
    await dragShape(dana.page, 400, 300, 600, 400);
    await dragShape(dana.page, 900, 400, 1100, 500);
  }

  // TC-25: Dana connects A→B and drags B past A; Sam's context sees the arrow
  // attached and switching side (delivery time logged, not asserted).
  //
  // World layout: A (-240,-100,200,100), B (260,0,200,100).
  test('TC-25: arrow stays attached and switches side when B is dragged past A', async ({ browser, baseURL }) => {
    participants = await openParticipants(browser, baseURL!, boardId, 2);
    const [dana, sam] = participants;

    await createAB(dana);
    // A centre screen (500,350); B centre screen (1000,450)
    await connect(dana.page, 500, 350, 1000, 450);

    // Sam sees the arrow; it runs A's right side (−40,−50) → B's left side (260,50)
    await expectEventually(async () => (await connectorCount(sam.page)) === 1, "Sam sees the arrow");
    await expectEventually(async () => {
      const c = await lineCoords(sam.page);
      return approx(c.x1, -40, 2) && approx(c.y1, -50, 2) && approx(c.x2, 260, 2) && approx(c.y2, 50, 2);
    }, 'Sam sees A-right → B-left');

    // Dana drags B to the left of A: B centre (1000,450) → (290,450)
    // → B (-450,0,200,100), centre (-350,50)
    await dragObjectTo(dana.page, 1000, 450, 290, 450);

    // Sam's arrow follows: now A's left side (−240,−50) → B's right side (−250,50)
    await expectEventually(async () => {
      const c = await lineCoords(sam.page);
      return approx(c.x1, -240, 2) && approx(c.y1, -50, 2) && approx(c.x2, -250, 2) && approx(c.y2, 50, 2);
    }, "Sam's arrow switched sides and follows B");
  });

  // TC-26: Sam deletes B → the arrow remains with a free end where B's side
  // was, on both screens.
  test('TC-26: deleting B leaves the arrow with a free end on both screens', async ({ browser, baseURL }) => {
    participants = await openParticipants(browser, baseURL!, boardId, 2);
    const [dana, sam] = participants;

    await createAB(dana);
    await connect(dana.page, 500, 350, 1000, 450);
    await expectEventually(async () => (await connectorCount(sam.page)) === 1, 'Sam sees the arrow');

    // Sam selects B (centre 1000,450) and deletes it
    await sam.page.mouse.click(1000, 450);
    await sam.page.keyboard.press('Delete');

    // Both screens: one shape left, the arrow remains, free end at B's left
    // side anchor (world 260,50)
    for (const [name, p] of [['Dana', dana], ['Sam', sam]] as const) {
      await expectEventually(async () => (await shapeCount(p.page)) === 1, `${name}: B is gone`);
      await expectEventually(async () => {
        if ((await connectorCount(p.page)) !== 1) return false;
        const c = await lineCoords(p.page);
        return approx(c.x2, 260, 2) && approx(c.y2, 50, 2);
      }, `${name}: arrow remains with free end where B's side was`);
    }
  });

  // TC-27: delete race — Dana drags an arrow end onto B while Sam deletes B
  // (Sam's WebSocket traffic is delayed to force the overlap). Dana's arrow
  // ends up visible with its end at the fallback; no console errors.
  test('TC-27: delete race — re-attach wins, end lands at the fallback, no errors', async ({ browser, baseURL }) => {
    participants = await openParticipants(browser, baseURL!, boardId, 2);
    const [dana, sam] = participants;

    const errors: string[] = [];
    dana.page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    dana.page.on('pageerror', (err) => errors.push(String(err)));

    await createAB(dana);
    await connect(dana.page, 500, 350, 1000, 450);
    await expectEventually(async () => (await connectorCount(sam.page)) === 1, 'Sam sees the arrow');

    // Dana selects the arrow (midpoint of the line) so its handles show
    await dana.page.mouse.click(750, 400);
    // Sam selects B
    await sam.page.mouse.click(1000, 450);

    // Delay Sam's outbound WebSocket frames so his delete lands after Dana's
    // re-attach on the server
    await sam.context.routeWebSocket('**/api/rooms/**', (route) => {
      const real = route.connectToServer();
      real.onMessage((msg) => {
        route.send(msg);
      });
      route.onMessage((msg) => {
        setTimeout(() => real.send(msg), 1500);
      });
    });

    // Dana starts dragging the "to" handle (B's left side: 900,450) over B
    await dana.page.mouse.move(900, 450);
    await dana.page.mouse.down();
    await dana.page.mouse.move(1000, 450, { steps: 8 });

    // ...while Sam deletes B
    await sam.page.keyboard.press('Delete');

    // Dana releases over B: his re-attach is applied locally and sent
    await dana.page.mouse.up();

    // Convergence on Dana's screen: B is gone, the arrow is still visible with
    // its end at the fallback point (B's left side anchor: world 260,50)
    await expectEventually(async () => (await shapeCount(dana.page)) === 1, 'Dana: B is gone');
    await expectEventually(async () => {
      if ((await connectorCount(dana.page)) !== 1) return false;
      const c = await lineCoords(dana.page);
      return approx(c.x2, 260, 2) && approx(c.y2, 50, 2);
    }, 'Dana: arrow visible with end at the fallback');

    expect(errors).toEqual([]);
  });
});
