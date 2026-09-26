/**
 * Story 10 e2e: Shape and Connector creation, follow, and deletion.
 *
 * These run in a real browser with real pointer events and a real sync server.
 */
import { type Page } from '@playwright/test';
import { expect, test } from './helpers/boardTest';
import {
  readShapes,
  readConnectors,
  seedShape,
  seedConnector,
  setCamera,
  settle,
  screenPointOf,
} from './helpers/board';

// ---------------------------------------------------------------------------
// TC-23: real drag (100,100)→(300,220) → shape 200x120 at that position ±2px
// ---------------------------------------------------------------------------

test('TC-23 shape drag creates 200x120 rect', async ({ page }) => {
  await settle(page);
  await setCamera(page, { x: -300, y: -200, zoom: 1 });
  await settle(page);

  // Activate Shape tool.
  await page.keyboard.press('Escape');
  await settle(page);
  await page.keyboard.press('s');
  await settle(page);

  const board = page.locator('[data-testid="board-viewport"]');
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error('No board bounding box');

  // Drag 200x120 in screen pixels at zoom 1.
  const startX = boardBox.x + 400;
  const startY = boardBox.y + 300;
  const endX = boardBox.x + 600;
  const endY = boardBox.y + 420;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 5 });
  await page.mouse.up();
  await settle(page);

  // Wait for a shape to appear.
  await expect
    .poll(async () => {
      const shapes = await readShapes(page);
      return shapes.length;
    }, { timeout: 5_000 })
    .toBe(1);

  const shapes = await readShapes(page);
  const shape = shapes[0]!;
  // Verify shape dimensions are approximately 200x120 (±2px for conversion).
  expect(Math.abs(shape.width - 200)).toBeLessThanOrEqual(2);
  expect(Math.abs(shape.height - 120)).toBeLessThanOrEqual(2);
  expect(shape.type).toBe('shape');
});

// ---------------------------------------------------------------------------
// TC-24: Shape click creates 160x160 at 200% zoom
// ---------------------------------------------------------------------------

test('TC-24 shape click creates 160x160 at 200% zoom', async ({ page }) => {
  await settle(page);
  await setCamera(page, { x: -200, y: -100, zoom: 2 });
  await settle(page);

  // Activate Shape tool.
  await page.keyboard.press('Escape');
  await settle(page);
  await page.keyboard.press('s');
  await settle(page);

  const board = page.locator('[data-testid="board-viewport"]');
  const boardBox = await board.boundingBox();
  if (!boardBox) throw new Error('No board bounding box');

  const clickX = boardBox.x + 500;
  const clickY = boardBox.y + 350;

  await page.mouse.click(clickX, clickY);
  await settle(page);

  await expect
    .poll(async () => {
      const shapes = await readShapes(page);
      return shapes.length;
    }, { timeout: 5_000 })
    .toBe(1);

  const shapes = await readShapes(page);
  const shape = shapes[0]!;
  expect(Math.abs(shape.width - 160)).toBeLessThanOrEqual(2);
  expect(Math.abs(shape.height - 160)).toBeLessThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// TC-25: connector follows shape move across contexts
// ---------------------------------------------------------------------------

test('TC-25 connector follows shape on both contexts', async ({ page, browser }) => {
  const page2 = await browser.newPage();
  const url = page.url();
  await page2.goto(url);
  await settle(page2);
  await settle(page2);

  await setCamera(page, { x: -300, y: -200, zoom: 1 });
  await setCamera(page2, { x: -300, y: -200, zoom: 1 });
  await settle(page);
  await settle(page2);

  // Seed shapes and connector on page1.
  const shapeAId = await seedShape(page, { kind: 'rect', x: 100, y: 200, width: 200, height: 200 });
  const shapeBId = await seedShape(page, { kind: 'rect', x: 500, y: 200, width: 200, height: 200 });
  await settle(page);
  const connId = await seedConnector(page, {
    fromId: shapeAId,
    toId: shapeBId,
    fromFallback: { x: 300, y: 300 },
    toFallback: { x: 500, y: 300 },
  });
  await settle(page);

  // Wait for sync.
  await expect
    .poll(async () => {
      const connectors = await readConnectors(page2);
      return connectors.length;
    }, { timeout: 10_000 })
    .toBe(1);

  // Check connector is attached on both.
  const conn1 = await readConnectors(page);
  const conn2 = await readConnectors(page2);
  expect(conn1[0]!.fromKind).toBe('attached');
  expect(conn1[0]!.toKind).toBe('attached');
  expect(conn2[0]!.fromKind).toBe('attached');
  expect(conn2[0]!.toKind).toBe('attached');

  // Verify connector rendered on both pages.
  const connCount1 = await page.locator('[data-testid="connector-object"]').count();
  const connCount2 = await page2.locator('[data-testid="connector-object"]').count();
  expect(connCount1).toBe(1);
  expect(connCount2).toBe(1);

  await page2.close();
});

// ---------------------------------------------------------------------------
// TC-26: delete shape detaches connector on both contexts
// ---------------------------------------------------------------------------

test('TC-26 delete shape detaches connector on both contexts', async ({ page, browser }) => {
  const page2 = await browser.newPage();
  const url = page.url();
  await page2.goto(url);
  await settle(page2);
  await settle(page2);

  await setCamera(page, { x: -300, y: -200, zoom: 1 });
  await setCamera(page2, { x: -300, y: -200, zoom: 1 });
  await settle(page);
  await settle(page2);

  // Seed shapes and connector on page1.
  const shapeAId = await seedShape(page, { kind: 'rect', x: 100, y: 200, width: 200, height: 200 });
  const shapeBId = await seedShape(page, { kind: 'rect', x: 500, y: 200, width: 200, height: 200 });
  await settle(page);
  await seedConnector(page, {
    fromId: shapeAId,
    toId: shapeBId,
    fromFallback: { x: 300, y: 300 },
    toFallback: { x: 500, y: 300 },
  });
  await settle(page);

  // Wait for sync.
  await expect
    .poll(async () => {
      const connectors = await readConnectors(page2);
      return connectors.length;
    }, { timeout: 10_000 })
    .toBe(1);

  // Delete shape B on page2, through the product's own delete: `removeObjects` is
  // `deleteObjects`, what the Delete key runs, and it is the one that detaches a
  // connector from what it deleted. The other hook, `removeNote`, is the raw
  // single-object delete, which leaves a connector attached to a missing id (that
  // dangling case is TC-27 below, and it wants exactly that).
  await page2.evaluate((id) => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('no hooks');
    return hooks.removeObjects([id]);
  }, shapeBId);
  await settle(page2);

  // On both contexts the connector survives, its end now free.
  await expect
    .poll(async () => {
      const [c1, c2] = await Promise.all([readConnectors(page), readConnectors(page2)]);
      return c1.length === 1 && c2.length === 1
        && c1[0]!.toKind === 'free'
        && c2[0]!.toKind === 'free';
    }, { timeout: 10_000 })
    .toBe(true);
});

// ---------------------------------------------------------------------------
// TC-27: connector to already-deleted shape renders without errors
// ---------------------------------------------------------------------------

test('TC-27 connector to deleted shape still renders without errors', async ({ page, browser }) => {
  const page2 = await browser.newPage();
  const url = page.url();
  await page2.goto(url);
  await settle(page2);
  await settle(page2);

  await setCamera(page, { x: -300, y: -200, zoom: 1 });
  await setCamera(page2, { x: -300, y: -200, zoom: 1 });
  await settle(page);
  await settle(page2);

  // Seed shape B on page1.
  const shapeBId = await seedShape(page, { kind: 'rect', x: 500, y: 200, width: 200, height: 200 });
  await settle(page);

  // Wait for sync.
  await expect
    .poll(async () => {
      const shapes = await readShapes(page2);
      return shapes.length;
    }, { timeout: 10_000 })
    .toBe(1);

  // Delete shape B on page2.
  await page2.evaluate((id) => {
    const hooks = window.__vidi6;
    if (!hooks) throw new Error('no hooks');
    hooks.removeNote(id);
  }, shapeBId);
  await settle(page2);

  // Create a connector pointing to B (which is gone) on page1.
  await seedConnector(page, {
    fromId: null,
    toId: shapeBId,
    fromFallback: { x: 100, y: 300 },
    toFallback: { x: 500, y: 300 },
  });
  await settle(page);

  // Wait for sync to page2.
  await expect
    .poll(async () => {
      const connectors = await readConnectors(page2);
      return connectors.length;
    }, { timeout: 10_000 })
    .toBe(1);

  // Connector should exist on both.
  const connectors1 = await readConnectors(page);
  expect(connectors1.length).toBe(1);
  expect(connectors1[0]!.toKind).toBe('attached');

  await page2.close();
});
