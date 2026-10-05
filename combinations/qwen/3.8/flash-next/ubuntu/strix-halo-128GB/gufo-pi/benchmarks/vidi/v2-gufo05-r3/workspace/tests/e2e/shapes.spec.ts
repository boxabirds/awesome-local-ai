/**
 * E2E: drawing a flow in a real browser (story 10, TC-23 and TC-24).
 *
 * These are the cases a component test cannot honestly cover: a drag made of real
 * browser pointer events crossing a real DOM, and text wrapped by a real layout engine.
 * Everything is asserted against the document (`__vidi6.getBoard()`) as well as the
 * screen, because a shape that looks right while the model stored something else would
 * be redrawn the moment a second client looked at it.
 *
 * Positions come from the origin marker rather than an assumed camera, so the test says
 * "wherever the world origin is, the shape covers the rectangle that was dragged".
 *
 * TC-23 is the one case the design wants on all three engines: the chromium project
 * always runs, and `E2E_ALL_BROWSERS=1` adds firefox and webkit projects over the whole
 * suite (see playwright.config.ts and NOTES.md for why they are opt-in on this host).
 */
import { expect, test, type Page } from '@playwright/test';

import { gotoBoard, markerCenter, setCamera, zoomLabelValue } from './helpers/board';
import {
  connectorsOn,
  dragOnBoard,
  objectsOn,
  shapesOn,
  within,
  worldOfPoint,
} from './helpers/flow';
import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_FONT_PX } from '../../src/shared/config';

/** The tool buttons, whether or not their label carries the chosen shape kind. */
const shapeButton = (page: Page): ReturnType<Page['getByRole']> =>
  page.getByRole('button', { name: /^Shape \(S\)/ });
const connectorButton = (page: Page) => page.getByRole('button', { name: /^Connector \(L\)/ });

test.describe('drawing shapes (TC-23, TC-24)', () => {
  test('TC-23 a real drag at 100% draws a shape of exactly the dragged rectangle', async ({ page }) => {
    await gotoBoard(page);
    await page.keyboard.press('s');
    await expect(shapeButton(page)).toHaveAttribute('aria-pressed', 'true');

    await dragOnBoard(page, { x: 100, y: 100 }, { x: 300, y: 220 });

    await expect.poll(() => shapesOn(page).then((s) => s.length), { timeout: 5_000 }).toBe(1);
    const [shape] = await shapesOn(page);

    // ±1px, measured in world units: at 100% the two are the same thing.
    const corner = await worldOfPoint(page, { x: 100, y: 100 });
    expect(within(shape!.x, corner.x, 1), `x ${shape!.x} vs ${corner.x}`).toBe(true);
    expect(within(shape!.y, corner.y, 1), `y ${shape!.y} vs ${corner.y}`).toBe(true);
    expect(within(shape!.width, 200, 1), `width ${shape!.width}`).toBe(true);
    expect(within(shape!.height, 120, 1), `height ${shape!.height}`).toBe(true);

    // Drawing one shape puts the tool back, so the next press selects instead of draws.
    await expect(shapeButton(page)).toHaveAttribute('aria-pressed', 'false');

    // And the shape on the screen sits where the model says it does.
    const body = page.locator(`[data-testid="shape-body-${shape!.id}"]`);
    await expect(body).toBeVisible();
    const painted = await body.boundingBox();
    const origin = await markerCenter(page);
    expect(painted).not.toBeNull();
    expect(within(painted!.x, origin.x + shape!.x, 1)).toBe(true);
    expect(within(painted!.height, shape!.height, 1)).toBe(true);
  });

  test('TC-24 at 200% a clicked diamond is the standard size, and a long label wraps and stays centred', async ({
    page,
  }) => {
    await gotoBoard(page);
    await setCamera(page, { x: -320, y: -200, zoom: 2 });
    expect(await zoomLabelValue(page)).toBe(200);

    await page.keyboard.press('s');
    await page.getByRole('button', { name: 'Shape kind menu' }).click();
    await page.locator('[data-shape-kind="diamond"]').click();
    await expect(shapeButton(page)).toHaveAccessibleName(/Diamond/);

    const click = { x: 640, y: 400 };
    await page.mouse.click(click.x, click.y);
    await expect.poll(() => shapesOn(page).then((s) => s.length), { timeout: 5_000 }).toBe(1);
    const [diamond] = await shapesOn(page);

    // The standard size, in world units, whatever the zoom — and centred on the click.
    const at = await worldOfPoint(page, click);
    expect(diamond!.kind).toBe('diamond');
    expect(within(diamond!.width, SHAPE_DEFAULT_SIZE_WORLD, 1), `width ${diamond!.width}`).toBe(true);
    expect(within(diamond!.height, SHAPE_DEFAULT_SIZE_WORLD, 1), `height ${diamond!.height}`).toBe(true);
    expect(within(diamond!.x + diamond!.width / 2, at.x, 1)).toBe(true);
    expect(within(diamond!.y + diamond!.height / 2, at.y, 1)).toBe(true);

    // A label far wider than the shape: it has to wrap, and stay centred while it does.
    await page.mouse.dblclick(click.x, click.y);
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeVisible({ timeout: 5_000 });
    await editor.click();
    const words = 'Payment approved and the receipt is on its way to your inbox';
    await page.keyboard.type(words, { delay: 5 });
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0, { timeout: 5_000 });

    const label = page.locator(`[data-testid="shape-label-${diamond!.id}"]`);
    await expect(label).toHaveText(words);
    const wrapped = await label.boundingBox();
    expect(wrapped).not.toBeNull();
    // One line is the font size times the label's line-height, doubled by the zoom.
    const oneLine = SHAPE_LABEL_FONT_PX * 1.3 * 2;
    expect(wrapped!.height, `label box is ${wrapped!.height}px tall`).toBeGreaterThan(oneLine * 1.8);

    // Select it and pull the east handle wider: the label re-centres in the new box.
    await page.mouse.click(click.x, click.y);
    const handle = page.locator('[data-resize-handle="e"]');
    await expect(handle).toBeVisible({ timeout: 5_000 });
    const before = (await shapesOn(page))[0]!;
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    await dragOnBoard(page, { x: handleBox!.x + 4, y: handleBox!.y + 4 }, { x: handleBox!.x + 204, y: handleBox!.y + 4 });

    await expect
      .poll(() => shapesOn(page).then((s) => s[0]!.width - before.width), { timeout: 5_000 })
      .toBeGreaterThan(50);

    const grown = (await shapesOn(page))[0]!;
    const bodyBox = await page.locator(`[data-testid="shape-body-${grown.id}"]`).boundingBox();
    const labelBox = await label.boundingBox();
    expect(bodyBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(Math.abs(labelBox!.x + labelBox!.width / 2 - (bodyBox!.x + bodyBox!.width / 2))).toBeLessThanOrEqual(2);
    expect(within(grown.height, before.height, 1), 'the east handle must not change the height').toBe(true);
  });

  test('two shapes and an arrow: the flow holds together (draw a flow)', async ({ page }) => {
    await gotoBoard(page);

    // Two shapes drawn one after the other without touching the toolbar in between:
    // the tool puts itself back after each stroke.
    await page.keyboard.press('s');
    await dragOnBoard(page, { x: 200, y: 300 }, { x: 400, y: 420 });
    await expect.poll(() => shapesOn(page).then((s) => s.length)).toBe(1);
    await page.keyboard.press('s');
    await dragOnBoard(page, { x: 700, y: 300 }, { x: 900, y: 420 });
    await expect.poll(() => shapesOn(page).then((s) => s.length)).toBe(2);

    // Then the arrow between them.
    await page.keyboard.press('l');
    await expect(connectorButton(page)).toHaveAttribute('aria-pressed', 'true');
    await dragOnBoard(page, { x: 300, y: 360 }, { x: 800, y: 360 });
    await expect(connectorButton(page)).toHaveAttribute('aria-pressed', 'false');

    const arrows = await connectorsOn(page);
    expect(arrows).toHaveLength(1);
    const drawn = (await objectsOn(page)).find((o) => o.id === arrows[0]!.id)!;

    // Both ends remember the shape they were let go on — and they are two different
    // shapes, so the arrow has something to point between.
    expect(drawn.from?.kind).toBe('attached');
    expect(drawn.to?.kind).toBe('attached');
    if (drawn.from?.kind !== 'attached' || drawn.to?.kind !== 'attached') return;
    expect(drawn.from.objectId).not.toBe(drawn.to.objectId);
    expect(await page.locator(`[data-testid="connector-line-${arrows[0]!.id}"]`).count()).toBe(1);
  });
});
