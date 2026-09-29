// Story 10 e2e: shapes and connectors (TC-23 to TC-27).
//
// Runs against `wrangler dev` (see playwright.config.ts) in Chromium, Firefox
// and WebKit. Participants are genuine y-websocket clients of the BoardRoom
// Durable Object; world state (shape rects, connector endpoints) is read back
// from each participant's Y.Doc so camera rounding never matters. The shape
// tool, connector tool, kind menu, label editor and selection handles are
// driven through the real UI.

import { expect, test, type Page } from '@playwright/test';
import {
  closeParticipant,
  createFreshBoard,
  expectWithin,
  openParticipant,
} from './helpers/participants';
import { setCamera } from './helpers/board';

/** The home camera of a page (100%, world origin centred). */
async function homeCam(page: Page): Promise<{ x: number; y: number; zoom: number }> {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 800 };
  return { x: -width / 2, y: -height / 2, zoom: 1 };
}

/** World (x,y) → screen px under the given camera. */
function toScreen(cam: { x: number; y: number; zoom: number }, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
}

interface WorldEndpoint {
  kind: 'attached' | 'free';
  objectId?: string;
  x: number;
  y: number;
}

interface WorldConnector {
  id: string;
  from: WorldEndpoint;
  to: WorldEndpoint;
}

interface WorldShape {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The connector objects in the page's Y.Doc, as plain world state.
 * NOTE: the endpoint read below must stay fully inline — Playwright
 * serializes the evaluate callback into the browser.
 */
async function worldConnectors(page: Page): Promise<WorldConnector[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const read = (raw: {
      kind: string;
      objectId?: string | null;
      x?: number;
      y?: number;
      fallback?: { x: number; y: number } | null;
    }): WorldEndpoint =>
      raw.kind === 'free'
        ? { kind: 'free', x: Number(raw.x ?? 0), y: Number(raw.y ?? 0) }
        : {
            kind: 'attached',
            objectId: raw.objectId != null ? String(raw.objectId) : undefined,
            x: Number(raw.fallback?.x ?? 0),
            y: Number(raw.fallback?.y ?? 0),
          };
    const out: WorldConnector[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      if (o.get('type') !== 'connector') continue;
      const from = o.get('from') as unknown as Parameters<typeof read>[0];
      const to = o.get('to') as unknown as Parameters<typeof read>[0];
      out.push({ id: String(key), from: read(from), to: read(to) });
    }
    return out;
  });
}

/** The shape objects in the page's Y.Doc, in insertion order. */
async function worldShapes(page: Page): Promise<WorldShape[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: WorldShape[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      if (o.get('type') !== 'shape') continue;
      out.push({
        id: String(key),
        kind: String(o.get('kind')),
        x: o.get('x') as number,
        y: o.get('y') as number,
        width: o.get('width') as number,
        height: o.get('height') as number,
      });
    }
    return out;
  });
}

/** The rendered connector hit line endpoints (world coords), first connector. */
async function renderedEndpoints(page: Page): Promise<{ x1: number; y1: number; x2: number; y2: number }> {
  return page.locator('[data-testid="connector-hit"]').first().evaluate((el) => {
    const l = el as SVGLineElement;
    return {
      x1: Number(l.getAttribute('x1')),
      y1: Number(l.getAttribute('y1')),
      x2: Number(l.getAttribute('x2')),
      y2: Number(l.getAttribute('y2')),
    };
  });
}

/** Activate the shape tool (toolbar button), optionally choosing a kind. */
async function shapeTool(page: Page, kind?: 'rect' | 'ellipse' | 'diamond'): Promise<void> {
  await page.locator('[data-testid="shape"]').click();
  if (kind !== undefined) {
    await page.locator(`[data-testid="shape-kind-${kind}"]`).click();
  }
  // The tool overlay mounts on the re-render after the click; wait for it so
  // the following pointerdown lands on it (Firefox renders slower).
  await page.locator('[data-testid="shape-tool"]').waitFor();
}

/** Activate the connector tool (toolbar button). */
async function connectorTool(page: Page): Promise<void> {
  await page.locator('[data-testid="connector"]').click();
  await page.locator('[data-testid="connector-tool"]').waitFor();
}

/** Drag on the board from world (x1,y1) to (x2,y2) under the home camera. */
async function dragWorld(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const cam = await homeCam(page);
  const a = toScreen(cam, x1, y1);
  const b = toScreen(cam, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

/** Click the board at world (wx, wy) under the home camera. */
async function clickWorld(page: Page, wx: number, wy: number): Promise<void> {
  const cam = await homeCam(page);
  const p = toScreen(cam, wx, wy);
  await page.mouse.click(p.x, p.y);
}

/**
 * Create a shape by dragging from world (x1,y1) to (x2,y2). Playwright can
 * drop a pointerdown under parallel e2e load (same hazard dragBoard handles),
 * so the drag is retried until a new shape lands in the doc.
 */
async function dragShape(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const before = (await worldShapes(page)).length;
  for (let attempt = 0; attempt < 4; attempt++) {
    await shapeTool(page);
    await dragWorld(page, x1, y1, x2, y2);
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if ((await worldShapes(page)).length > before) return;
      await page.waitForTimeout(50);
    }
  }
  throw new Error('dragShape: no shape created after 4 attempts');
}

/** Create a connector by dragging from world (x1,y1) to (x2,y2), with retry. */
async function dragConnector(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  const before = (await worldConnectors(page)).length;
  for (let attempt = 0; attempt < 4; attempt++) {
    await connectorTool(page);
    await dragWorld(page, x1, y1, x2, y2);
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if ((await worldConnectors(page)).length > before) return;
      await page.waitForTimeout(50);
    }
  }
  throw new Error('dragConnector: no connector created after 4 attempts');
}

/**
 * Drag the shape at index by (dx, dy) screen pixels, retrying until the move
 * lands in the doc (a dropped pointerdown under load moves nothing).
 */
async function dragShapeByIndex(page: Page, index: number, dx: number, dy: number): Promise<void> {
  const before = (await worldShapes(page))[index];
  if (before === undefined) throw new Error(`shape ${index} not in doc`);
  const cam = await homeCam(page);
  for (let attempt = 0; attempt < 4; attempt++) {
    const el = page.locator('[data-testid="shape-object"]').nth(index);
    const box = (await el.boundingBox()) ?? undefined;
    if (box === undefined) throw new Error(`shape ${index} has no bounding box`);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 6 });
    await page.mouse.move(cx + dx, cy + dy, { steps: 6 });
    await page.mouse.up();
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const now = (await worldShapes(page))[index];
      if (now !== undefined && (Math.abs(now.x - before.x) * cam.zoom >= Math.abs(dx) - 2 || Math.abs(now.y - before.y) * cam.zoom >= Math.abs(dy) - 2)) {
        return;
      }
      await page.waitForTimeout(50);
    }
  }
  throw new Error(`dragShapeByIndex: shape ${index} did not move after 4 attempts`);
}

/** Select the shape at index and press Delete, retrying on dropped clicks. */
async function deleteShape(page: Page, index: number): Promise<void> {
  const before = (await worldShapes(page)).length;
  for (let attempt = 0; attempt < 4; attempt++) {
    const el = page.locator('[data-testid="shape-object"]').nth(index);
    const box = (await el.boundingBox()) ?? undefined;
    if (box === undefined) return; // already gone
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('Delete');
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      if ((await worldShapes(page)).length < before) return;
      await page.waitForTimeout(50);
    }
  }
  throw new Error('deleteShape: shape not deleted after 4 attempts');
}

/** Double-click the shape at index and type a label, ending with Escape. */
async function typeLabel(page: Page, index: number, text: string): Promise<void> {
  const el = page.locator('[data-testid="shape-object"]').nth(index);
  const box = (await el.boundingBox()) ?? undefined;
  if (box === undefined) throw new Error(`shape ${index} has no bounding box`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('[data-testid="shape-editor"] textarea').pressSequentially(text, { delay: 5 });
  await page.keyboard.press('Escape');
}

/** Centre of the selection-overlay handle named `name` (screen px). */
async function handleCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  const el = page.locator(`[data-handle="${name}"]`);
  const box = (await el.boundingBox()) ?? undefined;
  if (box === undefined) throw new Error(`${name} handle not rendered`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('story 10 — shapes and connectors', () => {
  test('TC-23 drag (100,100)→(300,220) at 100% → shape 200x120 at that spot ±1', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      await dragShape(p.page, 100, 100, 300, 220);
      const shapes = await worldShapes(p.page);
      expect(shapes).toHaveLength(1);
      expect(shapes[0].kind).toBe('rect');
      expect(Math.abs(shapes[0].x - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(shapes[0].y - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(shapes[0].width - 200)).toBeLessThanOrEqual(1);
      expect(Math.abs(shapes[0].height - 120)).toBeLessThanOrEqual(1);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-24 200%: diamond click → 160x160 centred; long label wraps; resize keeps it centred', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const p = await openParticipant(browser, boardId);
    try {
      // World (0,0) at screen centre, 200%.
      await setCamera(p.page, { x: -320, y: -200, zoom: 2 });
      await shapeTool(p.page, 'diamond');
      await p.page.mouse.click(640, 400);

      const shapes = await worldShapes(p.page);
      expect(shapes).toHaveLength(1);
      expect(shapes[0].kind).toBe('diamond');
      // 160x160 centred on the click (world 0,0) → rect (-80,-80,160,160).
      expect(Math.abs(shapes[0].x + 80)).toBeLessThanOrEqual(1);
      expect(Math.abs(shapes[0].y + 80)).toBeLessThanOrEqual(1);
      expect(Math.abs(shapes[0].width - 160)).toBeLessThanOrEqual(1);
      expect(Math.abs(shapes[0].height - 160)).toBeLessThanOrEqual(1);

      // A label longer than the shape width wraps inside it.
      await typeLabel(p.page, 0, 'this label is far longer than the shape width and must wrap onto multiple lines');
      const labelBox = await p.page.locator('[data-testid="shape-label"]').boundingBox();
      const shapeBox = (await p.page.locator('[data-testid="shape-object"]').first().boundingBox()) ?? undefined;
      expect(labelBox).not.toBeNull();
      expect(shapeBox).not.toBeNull();
      // The label fills the shape's box and wraps within it (no overflow).
      expect(labelBox!.width).toBeLessThanOrEqual(shapeBox!.width + 1);
      expect(labelBox!.height).toBeLessThanOrEqual(shapeBox!.height + 1);
      // Wrapped: more than one rendered line.
      const lineCount = await p.page.locator('[data-testid="shape-label"]').evaluate((el: HTMLElement) => {
        const style = getComputedStyle(el);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
        return Math.round(el.clientHeight / line);
      });
      expect(lineCount).toBeGreaterThan(1);

      // Drag the east handle wider → the label stays centred.
      const h = await handleCenter(p.page, 'e');
      await p.page.mouse.move(h.x, h.y);
      await p.page.mouse.down();
      await p.page.mouse.move(h.x + 80, h.y, { steps: 6 });
      await p.page.mouse.up();
      const shapeBox2 = (await p.page.locator('[data-testid="shape-object"]').first().boundingBox()) ?? undefined;
      const labelBox2 = await p.page.locator('[data-testid="shape-label"]').boundingBox();
      expect(shapeBox2).not.toBeNull();
      expect(labelBox2).not.toBeNull();
      const cx = shapeBox2!.x + shapeBox2!.width / 2;
      const cy = shapeBox2!.y + shapeBox2!.height / 2;
      expect(Math.abs(labelBox2!.x + labelBox2!.width / 2 - cx)).toBeLessThanOrEqual(2);
      expect(Math.abs(labelBox2!.y + labelBox2!.height / 2 - cy)).toBeLessThanOrEqual(2);
    } finally {
      await closeParticipant(p);
    }
  });

  test('TC-25 Dana connects A→B and drags B past A; Sam sees the sides switch in budget', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      // A at (0,100,200,100); B at (300,100,200,100). Dana creates both.
      await dragShape(dana.page, 0, 100, 200, 200);
      await dragShape(dana.page, 300, 100, 500, 200);
      await dragConnector(dana.page, 100, 150, 400, 150); // A centre → B centre
      // Precondition: everything Dana created has synced to Sam.
      await expectWithin(
        async () =>
          (await worldShapes(sam.page)).length === 2 &&
          (await worldConnectors(sam.page)).length === 1,
        { timeout: 2000, message: 'Sam sees both shapes and the connector' },
      );
      const shapes = await worldShapes(sam.page);
      const aId = shapes[0].id;
      const bId = shapes[1].id;

      // Initially A's right (200,150) → B's left (300,150).
      await expectWithin(
        async () => {
          const r = await renderedEndpoints(sam.page);
          return r.x1 === 200 && r.y1 === 150 && r.x2 === 300 && r.y2 === 150;
        },
        { timeout: 2000, message: 'Sam sees the initial arrow' },
      );

      // Dana drags B left past A (B centre (400,150) → (0,150)).
      await dragShapeByIndex(dana.page, 1, -400, 0);

      await expectWithin(
        async () => {
          const conns = await worldConnectors(sam.page);
          const rendered = await renderedEndpoints(sam.page);
          // Still attached to both objects, and both ends switched sides:
          // A's left (0,150) → B's right (100,150).
          return (
            conns.length === 1 &&
            conns[0].from.objectId === aId &&
            conns[0].to.objectId === bId &&
            Math.abs(rendered.x1 - 0) < 1 &&
            Math.abs(rendered.y1 - 150) < 1 &&
            Math.abs(rendered.x2 - 100) < 1 &&
            Math.abs(rendered.y2 - 150) < 1
          );
        },
        // Sync + re-render under parallel e2e load gets the relaxed budget.
        { timeout: 2000, message: 'Sam sees the switched sides' },
      );
      // Dana's own screen matches as well.
      expect(await renderedEndpoints(dana.page)).toMatchObject({ x1: 0, y1: 150, x2: 100, y2: 150 });
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });

  test('TC-26 Sam deletes B → arrow remains, its end free at the old side, on both screens', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      await dragShape(dana.page, 0, 100, 200, 200); // A
      await dragShape(dana.page, 300, 100, 500, 200); // B
      await dragConnector(dana.page, 100, 150, 400, 150);

      // Precondition: everything Dana created has synced to Sam, so the
      // delete runs against a state where the detach is defined.
      await expectWithin(
        async () =>
          (await worldShapes(sam.page)).length === 2 &&
          (await worldConnectors(sam.page)).length === 1,
        { timeout: 2000, message: 'Sam sees both shapes and the connector' },
      );
      const bId = (await worldShapes(sam.page))[1].id;
      // Sam deletes B (B at (300,100,200,100); the arrow met it at (300,150)).
      await deleteShape(sam.page, 1);

      // Deletion sync gets the same relaxed budget as story 7's delete specs.
      await expectWithin(
        async () => {
          const conns = await worldConnectors(dana.page);
          return (
            conns.length === 1 &&
            conns[0].to.kind === 'free' &&
            conns[0].to.x === 300 &&
            conns[0].to.y === 150
          );
        },
        { timeout: 2000 },
      );
      // Sam's own screen matches too.
      const connsSam = await worldConnectors(sam.page);
      expect(connsSam).toHaveLength(1);
      expect(connsSam[0].to.kind).toBe('free');
      expect(connsSam[0].to.x).toBe(300);
      expect(connsSam[0].to.y).toBe(150);
      expect(bId).toBeTruthy();
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });

  test('TC-27 Dana drags the arrow onto B while Sam deletes B → arrow visible at fallback, no console errors', async ({
    browser,
    request,
  }) => {
    const boardId = await createFreshBoard(request);
    const dana = await openParticipant(browser, boardId);
    const sam = await openParticipant(browser, boardId);
    try {
      const danaErrors: string[] = [];
      dana.page.on('pageerror', (err) => danaErrors.push(String(err)));
      dana.page.on('console', (msg) => {
        if (msg.type() === 'error') danaErrors.push(msg.text());
      });

      await dragShape(dana.page, 0, 100, 200, 200); // A
      await dragShape(dana.page, 300, 100, 500, 200); // B
      await dragConnector(dana.page, 100, 150, 400, 150);

      // Precondition: everything Dana created has synced to Sam before the
      // race starts, so Sam's delete runs against the complete state.
      await expectWithin(
        async () =>
          (await worldShapes(sam.page)).length === 2 &&
          (await worldConnectors(sam.page)).length === 1,
        { timeout: 2000, message: 'Sam sees both shapes and the connector' },
      );

      // Select the arrow on Dana's screen so the end handles render (retry:
      // a dropped pointerdown under load leaves nothing selected).
      for (let attempt = 0; attempt < 4; attempt++) {
        await clickWorld(dana.page, 250, 150); // on the arrow between A and B
        if ((await dana.page.locator('[data-testid="connector-handle-to"]').count()) > 0) break;
      }

      const handle = dana.page.locator('[data-testid="connector-handle-to"]');
      const hb = (await handle.boundingBox()) ?? undefined;
      if (hb === undefined) throw new Error('connector `to` handle not rendered');
      const hx = hb.x + hb.width / 2;
      const hy = hb.y + hb.height / 2;

      // Race: Dana drags the `to` end back onto B while Sam deletes B.
      const bBox = (await sam.page.locator('[data-testid="shape-object"]').nth(1).boundingBox()) ?? undefined;
      if (bBox === undefined) throw new Error('B has no bounding box on Sam screen');
      const bx = bBox.x + bBox.width / 2;
      const by = bBox.y + bBox.height / 2;

      await dana.page.mouse.move(hx, hy);
      await dana.page.mouse.down();
      await Promise.all([
        dana.page.mouse.move(bx, by, { steps: 10 }),
        (async () => {
          await sam.page.waitForTimeout(50); // let Dana's drag start
          await sam.page.mouse.click(bx, by);
          await sam.page.keyboard.press('Delete');
        })(),
      ]);
      await dana.page.mouse.up();

      // Dana's arrow is still visible; its `to` end sits at the fallback /
      // free position by B's old location (world x 300-400, y 150).
      await expectWithin(async () => {
        const conns = await worldConnectors(dana.page);
        const rendered = await renderedEndpoints(dana.page);
        return (
          conns.length === 1 &&
          Math.abs(rendered.y2 - 150) < 1 &&
          rendered.x2 >= 299 &&
          rendered.x2 <= 401
        );
      });
      expect(danaErrors).toHaveLength(0);
    } finally {
      await closeParticipant(dana);
      await closeParticipant(sam);
    }
  });
});
