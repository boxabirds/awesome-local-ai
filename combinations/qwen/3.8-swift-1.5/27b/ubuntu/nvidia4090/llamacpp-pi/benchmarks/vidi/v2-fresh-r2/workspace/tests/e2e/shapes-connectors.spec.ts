/**
 * E2E for story 10: draw shapes and connect them with arrows that follow
 * when moved (TC-23 to TC-27). Real browsers, real `wrangler dev` server,
 * real y-websocket sync.
 *
 * Functional waits use E2E_EVENTUAL_TIMEOUT_MS (story 3); delivery times are
 * logged (via expectEventually), never asserted.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { openParticipants, expectEventually, type Participant } from './helpers/participants';
import { setCamera } from './helpers/board';

const SHAPE = '[data-testid="shape-object"]';
const SHAPE_LABEL = '[data-testid="shape-label"]';
const CONNECTOR = '[data-testid="connector-object"]';

async function closeAll(parts: Participant[]): Promise<void> {
  await Promise.all(parts.map((p) => p.close()));
}

/** The shape tool overlay must be active before drawing. */
async function activateShapeTool(page: Page, kind?: 'rect' | 'ellipse' | 'diamond'): Promise<void> {
  if (kind && kind !== 'rect') {
    // Open the kind menu (the Shape button both activates and toggles the
    // menu) and pick the kind.
    await page.locator('[data-testid="shape-btn"]').click();
    await page.locator(`[data-testid="shape-kind-${kind}"]`).click();
  } else {
    await page.keyboard.press('s');
  }
  await page.locator('[data-testid="shape-tool"]').waitFor();
}

/** Draw a shape by dragging from (x1,y1) to (x2,y2) in screen coordinates. */
async function drawShape(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

/** Click to create the standard-size shape centred on (x, y). */
async function clickShape(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

/** Activate the connector tool and drag from (x1,y1) to (x2,y2). */
async function drawConnector(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.keyboard.press('l');
  await page.locator('[data-testid="connector-tool"]').waitFor();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

/** The bounding box of the nth shape on the page (screen coordinates). */
async function shapeBox(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(SHAPE).nth(index).boundingBox();
  if (!box) throw new Error(`shape ${index} not found`);
  return box;
}

/**
 * The connector line's two endpoints in screen coordinates, or null when no
 * connector is rendered. The line coordinates are relative to the connector
 * element's box, so the box origin is added back.
 */
async function connectorEndpoints(page: Page): Promise<{ x: number; y: number }[] | null> {
  return page.evaluate(() => {
    const line = document.querySelector<SVGLineElement>('[data-testid="connector-object"] line');
    if (!line) return null;
    const box = (line.closest('[data-testid="connector-object"]') as HTMLElement).getBoundingClientRect();
    return [
      { x: box.x + parseFloat(line.getAttribute('x1') ?? '0'), y: box.y + parseFloat(line.getAttribute('y1') ?? '0') },
      { x: box.x + parseFloat(line.getAttribute('x2') ?? '0'), y: box.y + parseFloat(line.getAttribute('y2') ?? '0') },
    ];
  });
}

/** Drag the shape at `index` by (dx, dy) screen pixels from its centre. */
async function dragShape(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const box = await shapeBox(page, index);
  const gx = box.x + box.width / 2;
  const gy = box.y + box.height / 2;
  await page.mouse.move(gx, gy);
  await page.mouse.down();
  await page.mouse.move(gx + dx, gy + dy, { steps: 10 });
  await page.mouse.up();
}

test.describe('story 10: shapes and connectors', () => {
  // TC-23: a real drag (100,100)→(300,220) at 100% creates a 200×120 shape
  // at that position (±1px).
  test('TC-23: dragging with the shape tool draws the dragged size at the drag position', async ({
    browser,
  }: { browser: Browser }) => {
    const [p] = await openParticipants(browser, 1);
    try {
      await activateShapeTool(p.page);
      await drawShape(p.page, 100, 100, 300, 220);

      const box = await shapeBox(p.page, 0);
      expect(Math.round(box.x)).toBe(100);
      expect(Math.round(box.y)).toBe(100);
      expect(Math.round(box.width)).toBe(200);
      expect(Math.round(box.height)).toBe(120);
    } finally {
      await closeAll([p]);
    }
  });

  // TC-24: at 200% zoom a Diamond click creates a 160×160 (world) diamond
  // centred on the click; a label longer than the width wraps and stays
  // centred after resizing via a handle.
  test('TC-24: diamond click at 200% zoom; long label wraps and stays centred on resize', async ({
    browser,
  }: { browser: Browser }) => {
    const [p] = await openParticipants(browser, 1);
    const page = p.page;
    try {
      // 200% zoom, centred on the viewport centre.
      await setCamera(page, { x: -320, y: -200, zoom: 2 });
      await activateShapeTool(page, 'diamond');
      await clickShape(page, 640, 400);

      // 160×160 world at zoom 2 → 320×320 screen, centred on (640,400).
      const box = await shapeBox(page, 0);
      expect(Math.round(box.width)).toBe(320);
      expect(Math.round(box.height)).toBe(320);
      expect(Math.round(box.x + box.width / 2)).toBe(640);
      expect(Math.round(box.y + box.height / 2)).toBe(400);

      // Type a label longer than the shape's width.
      await page.locator(SHAPE).nth(0).dblclick();
      const ta = page.locator('[data-testid="shape-label-textarea"]');
      await ta.waitFor();
      await ta.click();
      await page.keyboard.type('This is a very long label that must wrap onto several lines inside the shape');
      await page.keyboard.press('Escape');

      const label = page.locator(SHAPE_LABEL).nth(0);
      await label.waitFor();
      const labelBox = await label.boundingBox();
      const shapeAfter = await shapeBox(page, 0);
      // The label wraps: it is taller than a single 13px line.
      expect(labelBox!.height).toBeGreaterThan(20);
      // …and is contained within the shape width.
      expect(labelBox!.width).toBeLessThanOrEqual(shapeAfter.width + 1);

      // Resize wider via the east handle; the label stays centred.
      const shapeBefore = await shapeBox(page, 0);
      const east = page.locator('[data-testid="resize-handle-e"]');
      await east.waitFor();
      const eastBox = await east.boundingBox();
      await page.mouse.move(eastBox!.x + eastBox!.width / 2, eastBox!.y + eastBox!.height / 2);
      await page.mouse.down();
      await page.mouse.move(eastBox!.x + 100, eastBox!.y + eastBox!.height / 2, { steps: 5 });
      await page.mouse.up();

      const shapeWider = await shapeBox(page, 0);
      expect(shapeWider.width).toBeGreaterThan(shapeBefore.width + 50);
      const labelBox2 = await label.boundingBox();
      expect(Math.round(labelBox2!.x + labelBox2!.width / 2)).toBe(Math.round(shapeWider.x + shapeWider.width / 2));
    } finally {
      await closeAll([p]);
    }
  });

  // TC-25: Dana connects A→B and drags B past A; Sam sees the arrow stay
  // attached and switch sides (delivery time logged, not asserted).
  test('TC-25: the arrow stays attached and switches sides when B is dragged past A', async ({
    browser,
  }: { browser: Browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    try {
      // Dana draws A (300,200)-(420,280) and B (700,200)-(820,280).
      await activateShapeTool(dana.page);
      await drawShape(dana.page, 300, 200, 420, 280);
      await activateShapeTool(dana.page);
      await drawShape(dana.page, 700, 200, 820, 280);
      // Dana connects A→B.
      await drawConnector(dana.page, 360, 240, 760, 240);

      // Sam sees the arrow; endpoints are A's right edge → B's left edge.
      await expectEventually(
        async () => {
          const e = await connectorEndpoints(sam.page);
          return e !== null && Math.abs(e[0].x - 420) < 2 && Math.abs(e[1].x - 700) < 2;
        },
        'Sam sees the arrow A(right)→B(left)',
      );

      // Dana drags B (index 1) left, past A: dx = -(700-140) = -560.
      await dragShape(dana.page, 1, -560, 0);

      // Both screens: the arrow is still attached and switched sides —
      // now A's LEFT edge (300) → B's RIGHT edge (260).
      for (const [name, part] of [['Dana', dana], ['Sam', sam]] as const) {
        await expectEventually(
          async () => {
            const e = await connectorEndpoints(part.page);
            if (!e) return false;
            const xs = e.map((pt) => Math.round(pt.x)).sort((a, b) => a - b);
            return Math.abs(xs[0] - 260) < 2 && Math.abs(xs[1] - 300) < 2;
          },
          `${name} sees the arrow switched sides (260↔300)`,
        );
      }
    } finally {
      await closeAll([dana, sam]);
    }
  });

  // TC-26: Sam deletes B → the arrow remains with a free end where B's side
  // was, on both screens.
  test('TC-26: deleting B leaves the arrow with a free end at B\'s old anchor', async ({
    browser,
  }: { browser: Browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    try {
      // Dana draws A (300,200)-(420,280), B (700,200)-(820,280) and A→B.
      await activateShapeTool(dana.page);
      await drawShape(dana.page, 300, 200, 420, 280);
      await activateShapeTool(dana.page);
      await drawShape(dana.page, 700, 200, 820, 280);
      await drawConnector(dana.page, 360, 240, 760, 240);
      await expectEventually(async () => (await connectorEndpoints(sam.page)) !== null, 'Sam sees the arrow');

      // Sam selects B (the second shape) and deletes it.
      await sam.page.locator(SHAPE).nth(1).click();
      await sam.page.keyboard.press('Delete');

      // Both screens: the arrow remains; its B end is now free at B's old
      // left-edge anchor (700,240); the A end is at A's right edge (420,240).
      for (const [name, part] of [['Dana', dana], ['Sam', sam]] as const) {
        await expectEventually(
          async () => {
            const e = await connectorEndpoints(part.page);
            if (!e) return false;
            const xs = e.map((pt) => Math.round(pt.x)).sort((a, b) => a - b);
            return Math.abs(xs[0] - 420) < 2 && Math.abs(xs[1] - 700) < 2;
          },
          `${name} sees the arrow with a free end at (700,240)`,
        );
      }
      // B itself is gone on both screens.
      await expectEventually(async () => (await dana.page.locator(SHAPE).count()) === 1, 'Dana sees 1 shape');
      await expectEventually(async () => (await sam.page.locator(SHAPE).count()) === 1, 'Sam sees 1 shape');
    } finally {
      await closeAll([dana, sam]);
    }
  });

  // TC-27: delete race — Dana drags an arrow end to B while Sam deletes B.
  // Dana's arrow remains visible with its end at the fallback point, and no
  // console errors are raised.
  test('TC-27: racing a re-attach against a delete keeps the arrow at the fallback end', async ({
    browser,
  }: { browser: Browser }) => {
    const [dana, sam] = await openParticipants(browser, 2);
    try {
      const errors: string[] = [];
      dana.page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      dana.page.on('pageerror', (err) => errors.push(String(err)));

      // Dana draws A (300,200)-(420,280), B (700,200)-(820,280) and an arrow
      // from A to a free point between them (550,240).
      await activateShapeTool(dana.page);
      await drawShape(dana.page, 300, 200, 420, 280);
      await activateShapeTool(dana.page);
      await drawShape(dana.page, 700, 200, 820, 280);
      await drawConnector(dana.page, 360, 240, 550, 240);
      await expectEventually(async () => (await connectorEndpoints(sam.page)) !== null, 'Sam sees the arrow');

      // Dana selects the arrow (a click on its line, empty space) …
      await dana.page.mouse.click(480, 240);
      const dot = dana.page.locator('[data-testid="connector-dot-to"]');
      await dot.waitFor();

      // … and starts dragging the free end toward B. While the drag is in
      // flight (the pointer is down, over B), Sam deletes B — the overlap
      // window that a route delay would widen.
      const dotBox = await dot.boundingBox();
      await dana.page.mouse.move(dotBox!.x + dotBox!.width / 2, dotBox!.y + dotBox!.height / 2);
      await dana.page.mouse.down();
      await dana.page.mouse.move(760, 240, { steps: 6 });

      const deleteB = (async () => {
        await sam.page.locator(SHAPE).nth(1).click();
        await sam.page.keyboard.press('Delete');
      })();

      // Release Dana's drag on B while Sam's delete is in flight.
      await dana.page.mouse.up();
      await deleteB;

      // Dana's arrow is still visible; the dragged end sits at B's old
      // left-edge anchor (700,240) — the stored fallback — and the A end is
      // at A's right edge (420,240).
      await expectEventually(
        async () => {
          const e = await connectorEndpoints(dana.page);
          if (!e) return false;
          const xs = e.map((pt) => Math.round(pt.x)).sort((a, b) => a - b);
          return Math.abs(xs[0] - 420) < 2 && Math.abs(xs[1] - 700) < 2;
        },
        'Dana sees the arrow with its end at the fallback (700,240)',
      );
      // Sam converges to the same rendering.
      await expectEventually(
        async () => {
          const e = await connectorEndpoints(sam.page);
          if (!e) return false;
          const xs = e.map((pt) => Math.round(pt.x)).sort((a, b) => a - b);
          return Math.abs(xs[0] - 420) < 2 && Math.abs(xs[1] - 700) < 2;
        },
        'Sam sees the arrow with its end at the fallback (700,240)',
      );
      expect(errors).toEqual([]);
    } finally {
      await closeAll([dana, sam]);
    }
  });
});
