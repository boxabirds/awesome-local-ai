import { expect, test } from '@playwright/test';
import { newBoardId } from '../../src/shared/board-id';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { sideAnchor } from '../../src/shared/geometry/connector-geometry';
import { CHECKOUT_SHAPES, checkoutFlow, FREE_END } from '../fixtures/checkout-flow';
import { getCamera, nextFrames, openBoard, PIXEL_TOLERANCE, setCamera } from './helpers/board';
import { waitConnected } from './helpers/participants';
import { seedBoard } from './helpers/seed';
import {
  arrows,
  centreOf,
  chooseTool,
  dragBetween,
  drawnArrow,
  rectCentre,
  shapeLocator,
  shapes,
  worldToPage,
} from './helpers/shapes';

/**
 * Story 10 e2e, workflow "Draw a flow" (shape.ui): real layout and real fonts. TC-23, TC-24,
 * plus the checkout-flow fixture rendered from a stored board.
 */

const HALF = 2;
/** Label centring tolerance (px): sub-pixel text layout differs slightly between engines. */
const CENTRE_TOLERANCE_PX = 2;
/** TC-24: how far (screen px) the right handle is dragged. */
const WIDEN_BY_PX = 400;
const LONG_LABEL = 'Payment received?';

test.describe('shape.ui: draw a flow', () => {
  test('TC-23 at 100%, dragging (100,100) → (300,220) creates a 200 × 120 shape exactly there', async ({ page }) => {
    await openBoard(page);
    await chooseTool(page, 's', 'Shape (S)');
    await expect(page.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(300, 220, { steps: 10 });
    // The outline follows the pointer while dragging.
    const preview = page.getByTestId('shape-preview');
    await expect(preview).toBeVisible();
    await page.mouse.up();
    await nextFrames(page);
    await expect(preview).toHaveCount(0);

    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [s] = await shapes(page);
    const cam = await getCamera(page);
    expect(s!.width).toBeCloseTo(200, 6);
    expect(s!.height).toBeCloseTo(120, 6);
    expect(s!.x).toBeCloseTo(100 / cam.zoom + cam.x, 6);
    expect(s!.y).toBeCloseTo(100 / cam.zoom + cam.y, 6);
    expect(s).toMatchObject({ kind: 'rect', fill: 'white', stroke: 'dark', label: '' });

    const box = await shapeLocator(page, s!.id).boundingBox();
    expect(Math.abs(box!.x - 100)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(box!.y - 100)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(box!.width - 200)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    expect(Math.abs(box!.height - 120)).toBeLessThanOrEqual(PIXEL_TOLERANCE);
    // Selected and back on Select.
    await expect(shapeLocator(page, s!.id)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('toolbar', { name: 'Shape' })).toBeVisible();
  });

  test('TC-24 at 200%, a Diamond click is 160 × 160 centred; a long label wraps and stays centred after a resize', async ({
    page,
  }) => {
    await openBoard(page);
    await setCamera(page, { x: -200, y: -150, zoom: 2 });
    await nextFrames(page);
    await chooseTool(page, 's', 'Shape (S)');
    await page.getByRole('menuitemradio', { name: 'Diamond' }).click();
    const click = { x: 640, y: 400 };
    await page.mouse.click(click.x, click.y);
    await expect.poll(async () => (await shapes(page)).length).toBe(1);
    const [d] = await shapes(page);
    const cam = await getCamera(page);
    expect(d!.kind).toBe('diamond');
    expect(d!.width).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    expect(d!.height).toBe(SHAPE_DEFAULT_SIZE_WORLD);
    const centre = rectCentre(d!);
    expect(centre.x).toBeCloseTo(click.x / cam.zoom + cam.x, 6);
    expect(centre.y).toBeCloseTo(click.y / cam.zoom + cam.y, 6);

    const shape = shapeLocator(page, d!.id);
    await shape.dblclick();
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeFocused();
    await page.keyboard.type(LONG_LABEL);
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect.poll(async () => (await shapes(page))[0]!.label).toBe(LONG_LABEL);
    await expect(shape).toHaveAttribute('aria-label', `Diamond: ${LONG_LABEL}`);

    /** The label's rendered text: its line count (by height) and centre. */
    const labelText = async () =>
      shape.getByTestId('shape-label').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
        const rects = Array.from(range.getClientRects());
        const lines = new Set(rects.map((x) => Math.round(x.top))).size;
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, width: r.width, lines, lineHeight };
      });
    const before = await labelText();
    const shapeCentre = await centreOf(shape);
    expect(before.lines).toBeGreaterThan(1);
    expect(Math.abs(before.cx - shapeCentre.x)).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
    expect(Math.abs(before.cy - shapeCentre.y)).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
    // The text stays inside the shape's width.
    const shapeBox = (await shape.boundingBox())!;
    expect(before.width).toBeLessThan(shapeBox.width);

    // Resize via the right handle: wider shape, label re-wrapped onto fewer lines, still centred.
    const handle = page.getByRole('button', { name: 'Resize right' });
    await dragBetween(page, await centreOf(handle), {
      x: (await centreOf(handle)).x + WIDEN_BY_PX,
      y: (await centreOf(handle)).y,
    });
    const [resized] = await shapes(page);
    expect(resized!.width).toBeCloseTo(SHAPE_DEFAULT_SIZE_WORLD + WIDEN_BY_PX / cam.zoom, 0);
    const after = await labelText();
    const resizedCentre = await centreOf(shape);
    expect(after.lines).toBeLessThan(before.lines);
    expect(Math.abs(after.cx - resizedCentre.x)).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
    expect(Math.abs(after.cy - resizedCentre.y)).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
    expect(Math.abs(resizedCentre.x - shapeCentre.x - WIDEN_BY_PX / HALF)).toBeLessThanOrEqual(CENTRE_TOLERANCE_PX);
  });

  test('a stored checkout flow shows its labelled shapes and arrows at their attached sides; restyle from the toolbar', async ({
    page,
    baseURL,
  }) => {
    const boardId = newBoardId();
    const flow = checkoutFlow();
    await seedBoard(baseURL!, boardId, flow.doc);
    await page.goto(`/b/${boardId}`);
    await waitConnected(page);
    await setCamera(page, { x: -150, y: -200, zoom: 1 });
    await nextFrames(page);

    for (const [name, s] of Object.entries(CHECKOUT_SHAPES)) {
      const kindName = { rect: 'Rectangle', ellipse: 'Ellipse', diamond: 'Diamond' }[s.kind];
      await expect(shapeLocator(page, flow.ids[name as keyof typeof flow.ids])).toHaveAttribute(
        'aria-label',
        `${kindName}: ${s.label}`,
      );
    }
    await expect(page.getByTestId('connector-object')).toHaveCount(4);
    const first = await drawnArrow(page, flow.arrows[0]!);
    expect(first).toEqual({
      from: sideAnchor(CHECKOUT_SHAPES.checkout.rect, 'right'),
      to: sideAnchor(CHECKOUT_SHAPES.paid.rect, 'left'),
    });
    const down = await drawnArrow(page, flow.arrows[2]!);
    expect(down).toEqual({
      from: sideAnchor(CHECKOUT_SHAPES.paid.rect, 'bottom'),
      to: sideAnchor(CHECKOUT_SHAPES.retry.rect, 'top'),
    });
    expect((await drawnArrow(page, flow.arrows[3]!))!.to).toEqual(FREE_END);

    // Select Checkout and pick a light blue fill: nothing else about it changes.
    const checkout = shapeLocator(page, flow.ids.checkout);
    await checkout.click();
    await page.getByRole('button', { name: 'Blue fill' }).click();
    await expect.poll(async () => (await shapes(page)).find((s) => s.id === flow.ids.checkout)?.fill).toBe('blue');
    const s = (await shapes(page)).find((x) => x.id === flow.ids.checkout)!;
    expect(s).toMatchObject({ ...CHECKOUT_SHAPES.checkout.rect, label: 'Checkout', stroke: 'dark' });
    await expect(checkout).toHaveAttribute('data-selected', 'true');
    // Clicking near an arrow's line selects it.
    const on = await worldToPage(page, { x: 270, y: 63 });
    await page.mouse.click(on.x, on.y);
    await expect.poll(() => page.evaluate(() => window.__vidi6!.getSelection())).toEqual([flow.arrows[0]]);
    expect((await arrows(page)).length).toBe(4);
  });
});
