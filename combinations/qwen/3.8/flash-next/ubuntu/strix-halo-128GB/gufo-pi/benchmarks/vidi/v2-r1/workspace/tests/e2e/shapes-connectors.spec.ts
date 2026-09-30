/**
 * E2E shapes and connectors tests (TC-23 to TC-27).
 *
 * Proves the Shape tool, Shape rendering, Shape toolbar, Connector tool,
 * Connector rendering, and collaboration in real browsers.
 */
import { expect, test } from '@playwright/test';

import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { openBoard, setCamera } from './helpers/board';
import {
  activateShapeTool,
  activateConnectorTool,
  setShapeKind,
  createShapeByDrag,
  connectObjectsByDrag,
  dblClickShape,
  typeShapeLabel,
  pressEscape,
  getShapeScreenRect,
  getShapeObjectsFromDoc,
  getConnectorObjectsFromDoc,
  waitForShapesStable,
  waitForConnectorsStable,
} from './helpers/shapes-connectors';
import { closeParticipants, openParticipants } from './helpers/participants';

test.describe('Shapes and connectors (story 10)', () => {
  test('TC-23: Shape creation geometry — drag creates exact size, click creates default', async ({ page }) => {
    await openBoard(page);

    // Create a shape by drag from (300,350) to (500,470) — should be ~200x120 at 100% zoom
    await activateShapeTool(page);
    await createShapeByDrag(page, { x: 300, y: 350 }, { x: 500, y: 470 });
    await waitForShapesStable(page);

    const shapes = await getShapeObjectsFromDoc(page);
    expect(shapes.length).toBe(1);
    const s = shapes[0]!;
    // At 100% zoom, the shape world size should be approximately the pixel drag distance
    expect(s.width).toBeGreaterThanOrEqual(195);
    expect(s.width).toBeLessThanOrEqual(205);
    expect(s.height).toBeGreaterThanOrEqual(115);
    expect(s.height).toBeLessThanOrEqual(125);

    // Now create a shape by clicking (no drag) — should get default size
    await activateShapeTool(page);
    await page.waitForTimeout(150);
    // Use mouse.click to create a point-click shape (no drag distance)
    await page.mouse.click(700, 400);
    await waitForShapesStable(page);

    const shapes2 = await getShapeObjectsFromDoc(page);
    expect(shapes2.length).toBe(2);
    // The new shape (default size) may be in any position in the array
    const s2 = shapes2.find((s) => Math.abs(s.width - SHAPE_DEFAULT_SIZE_WORLD) <= 2) ?? shapes2[1]!;
    // Default shape size
    expect(Math.abs(s2.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(2);
    expect(Math.abs(s2.height - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(2);
  });

  test('TC-24: Diamond click at 200% zoom — 160x160 default, label renders', async ({ page }) => {
    await openBoard(page);

    // Set zoom to 200%
    await setCamera(page, { x: 0, y: 0, zoom: 2 });

    // Select diamond shape kind
    await activateShapeTool(page);
    await setShapeKind(page, 'diamond');
    // Wait for shape kind to be reflected in the UI
    await expect(page.getByTestId('shape-kind-diamond')).toHaveAttribute('aria-pressed', 'true');

    // Click to create — should get default size
    await page.mouse.click(400, 400);
    await waitForShapesStable(page);

    const shapes = await getShapeObjectsFromDoc(page);
    expect(shapes.length).toBe(1);
    const s = shapes[0]!;
    expect(s.kind).toBe('diamond');
    expect(Math.abs(s.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.height - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(2);

    // Add a label
    await dblClickShape(page, s.id);
    await typeShapeLabel(page, 'Decision');
    await pressEscape(page);
    await page.waitForTimeout(200);

    // Verify label in model
    const shapesAfter = await getShapeObjectsFromDoc(page);
    expect(shapesAfter[0]!.label).toBe('Decision');
  });

  test('TC-25: Connector end follows shape dragged — arrow stays attached at both ends', async ({ page }) => {
    await openBoard(page);

    // Create two shapes
    await activateShapeTool(page);
    await createShapeByDrag(page, { x: 250, y: 350 }, { x: 380, y: 450 });
    await waitForShapesStable(page);

    await activateShapeTool(page);
    await createShapeByDrag(page, { x: 600, y: 350 }, { x: 730, y: 450 });
    await waitForShapesStable(page);

    const shapes = await getShapeObjectsFromDoc(page);
    expect(shapes.length).toBe(2);

    // Connect them
    await activateConnectorTool(page);
    const rectA = await getShapeScreenRect(page, shapes[0]!.id);
    const rectB = await getShapeScreenRect(page, shapes[1]!.id);
    const centerA = { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 };
    const centerB = { x: rectB.x + rectB.width / 2, y: rectB.y + rectB.height / 2 };
    await connectObjectsByDrag(page, centerA, centerB);
    await waitForConnectorsStable(page);

    let connectors = await getConnectorObjectsFromDoc(page);
    expect(connectors.length).toBe(1);
    expect(connectors[0]!.from.kind).toBe('attached');
    expect(connectors[0]!.to.kind).toBe('attached');

    // Get the arrow screen position before moving
    const arrowLine = page.locator(`[data-connector-id="${connectors[0]!.id}"] line`).nth(1);
    const toXBefore = await arrowLine.getAttribute('x2');

    // Move shape B using select tool
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await page.mouse.move(centerB.x, centerB.y);
    await page.mouse.down();
    await page.mouse.move(centerB.x + 50, centerB.y + 30, { steps: 3 });
    await page.mouse.move(centerB.x + 80, centerB.y + 50, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Arrow endpoint should have moved (follows the shape)
    const toXAfter = await arrowLine.getAttribute('x2');
    expect(toXAfter).not.toBe(toXBefore);

    // Both endpoints still attached
    connectors = await getConnectorObjectsFromDoc(page);
    expect(connectors[0]!.from.kind).toBe('attached');
    expect(connectors[0]!.to.kind).toBe('attached');
  });

  test('TC-26: Deleting shape detaches connector end (arrow remains with free end)', async ({ page }) => {
    await openBoard(page);

    // Create two shapes and a connector
    await activateShapeTool(page);
    await createShapeByDrag(page, { x: 300, y: 350 }, { x: 400, y: 450 });
    await waitForShapesStable(page);

    await activateShapeTool(page);
    await createShapeByDrag(page, { x: 600, y: 350 }, { x: 700, y: 450 });
    await waitForShapesStable(page);

    const shapes = await getShapeObjectsFromDoc(page);
    expect(shapes.length).toBe(2);

    // Connect them
    await activateConnectorTool(page);
    const rectA = await getShapeScreenRect(page, shapes[0]!.id);
    const rectB = await getShapeScreenRect(page, shapes[1]!.id);
    await connectObjectsByDrag(
      page,
      { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 },
      { x: rectB.x + rectB.width / 2, y: rectB.y + rectB.height / 2 },
    );
    await waitForConnectorsStable(page);

    const connectorsBefore = await getConnectorObjectsFromDoc(page);
    expect(connectorsBefore.length).toBe(1);
    expect(connectorsBefore[0]!.from.kind).toBe('attached');

    // Delete shape A
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await page.mouse.click(rectA.x + rectA.width / 2, rectA.y + rectA.height / 2);
    await page.waitForTimeout(100);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);

    // Shape A is gone, shape B remains
    const shapesAfter = await getShapeObjectsFromDoc(page);
    expect(shapesAfter.length).toBe(1);

    // The connector REMAINS (is not deleted) but its 'from' end becomes free
    const connectorsAfter = await getConnectorObjectsFromDoc(page);
    expect(connectorsAfter.length).toBe(1);
    // The deleted shape's end should now be free
    const conn = connectorsAfter[0]!;
    const deletedEnd = conn.from.kind === 'free' ? conn.from : conn.from.objectId === shapes[0]!.id ? conn.from : conn.to;
    expect(deletedEnd.kind).toBe('free');
  });

  test('TC-27: Collaborative — connector follows remote move', async ({ browser }) => {
    const participants = await openParticipants(browser, 2);
    const [alice, bob] = participants;
    if (!alice || !bob) throw new Error('Expected 2 participants');

    // Alice creates two shapes
    await activateShapeTool(alice.page);
    await createShapeByDrag(alice.page, { x: 300, y: 300 }, { x: 420, y: 420 });
    await waitForShapesStable(alice.page);

    await activateShapeTool(alice.page);
    await createShapeByDrag(alice.page, { x: 600, y: 300 }, { x: 720, y: 420 });
    await waitForShapesStable(alice.page);

    const aliceShapes = await getShapeObjectsFromDoc(alice.page);
    expect(aliceShapes.length).toBe(2);

    // Alice connects them
    await activateConnectorTool(alice.page);
    const rectA = await getShapeScreenRect(alice.page, aliceShapes[0]!.id);
    const rectB = await getShapeScreenRect(alice.page, aliceShapes[1]!.id);
    await connectObjectsByDrag(
      alice.page,
      { x: rectA.x + rectA.width / 2, y: rectA.y + rectA.height / 2 },
      { x: rectB.x + rectB.width / 2, y: rectB.y + rectB.height / 2 },
    );
    await waitForConnectorsStable(alice.page);

    // Bob should see both shapes and the connector
    await expect
      .poll(async () => {
        const bobShapes = await getShapeObjectsFromDoc(bob.page);
        const bobConns = await getConnectorObjectsFromDoc(bob.page);
        return bobShapes.length === 2 && bobConns.length === 1;
      }, { timeout: 10_000 })
      .toBe(true);

    // Bob drags shape B to a new position
    const bobRectB = await getShapeScreenRect(bob.page, aliceShapes[1]!.id);
    const centerB = { x: bobRectB.x + bobRectB.width / 2, y: bobRectB.y + bobRectB.height / 2 };
    await bob.page.mouse.move(centerB.x, centerB.y);
    await bob.page.mouse.down();
    await bob.page.mouse.move(centerB.x + 60, centerB.y + 40, { steps: 4 });
    await bob.page.mouse.up();
    await bob.page.waitForTimeout(200);

    // Alice should see shape B moved and connector still attached
    await expect
      .poll(async () => {
        const shapesNow = await getShapeObjectsFromDoc(alice.page);
        const shapeB = shapesNow.find((s) => s.id === aliceShapes[1]!.id);
        const conns = await getConnectorObjectsFromDoc(alice.page);
        return (
          shapeB !== undefined &&
          (Math.abs(shapeB.x - aliceShapes[1]!.x) > 1 || Math.abs(shapeB.y - aliceShapes[1]!.y) > 1) &&
          conns.length === 1 &&
          conns[0]!.from.kind === 'attached' &&
          conns[0]!.to.kind === 'attached'
        );
      }, { timeout: 10_000 })
      .toBe(true);

    await closeParticipants(participants);
  });
});
