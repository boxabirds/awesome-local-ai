/**
 * Story 10, end to end: shapes drawn with a real pointer.
 *
 * TC-23 is the one the design wants in every engine - a drag that starts from the keyboard, goes
 * through the browser's own pointer events and ends as a shape of the size that was dragged out.
 * TC-24 is the 200% case: a click for the default size, a label long enough to wrap, and a resize
 * that must not move the label out of the middle of the shape.
 */
import { test, expect, type Page } from '@playwright/test';

import { SHAPE_DEFAULT_SIZE_WORLD, SHAPE_LABEL_FONT_SIZE_WORLD } from '../../src/shared/config';
import { centredCamera, createShape, drawnBox, labelHeightPx, shapesOn, toScreen } from './helpers/shapes';
import { drag, setCamera } from './helpers/board';

test.use({ actionTimeout: 10_000 });

/** A board of its own, opened with the world origin in the middle of the screen at 100%. */
async function openBoard(page: Page, zoom = 1): Promise<string> {
  const created = await page.request.post('/api/boards');
  expect(created.ok()).toBe(true);
  const { id } = (await created.json()) as { id: string };
  await page.goto(`/b/${id}`);
  await expect(page.getByTestId('board-viewport')).toBeVisible();
  await setCamera(page, centredCamera(zoom));
  return id;
}

/**
 * How far the middle of a shape's label is from the middle of the shape, in the shape's own world
 * units - which is what "the words stay in the middle of the shape" means however it is zoomed.
 */
async function labelDrift(page: Page, id: string): Promise<{ dx: number; dy: number }> {
  return page.locator(`[data-shape-id="${id}"]`).evaluate((el: HTMLElement) => {
    const words = el.querySelector<HTMLElement>('[data-testid="shape-label"]');
    if (!words) throw new Error('the shape has no label to measure');
    return {
      dx: words.offsetLeft + words.offsetWidth / 2 - el.offsetWidth / 2,
      dy: words.offsetTop + words.offsetHeight / 2 - el.offsetHeight / 2,
    };
  });
}

const CENTRE = { x: 640, y: 400 };

test.describe('shapes with a real pointer', () => {
  test('TC-23 a drag with the shape tool draws the rectangle that was dragged out', async ({
    page,
  }) => {
    await openBoard(page);

    // the keyboard arms the tool, and the board - not the page - takes the pointer
    await page.keyboard.press('s');
    await expect(page.getByTestId('shape-tool-surface')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // screen (740,500) is world (100,100) here, and (940,620) is world (300,220)
    await drag(page, { x: 740, y: 500 }, { x: 940, y: 620 });

    await expect.poll(() => shapesOn(page).then((shapes) => shapes.length)).toBe(1);
    const shape = (await shapesOn(page))[0]!;
    expect(shape.kind).toBe('rect');
    expect(Math.abs(shape.x - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.height - 120)).toBeLessThanOrEqual(1);

    // and the board drew that rectangle, not something else
    const box = await drawnBox(page, shape.id);
    expect(Math.abs(box.left - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.top - 100)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - 200)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - 120)).toBeLessThanOrEqual(1);

    // drawing one shape hands the pointer back and selects what was made
    await expect(page.getByTestId('shape-tool-surface')).toHaveCount(0);
    await expect(page.locator(`[data-shape-id="${shape.id}"]`)).toHaveAttribute(
      'data-selected',
      'true',
    );
  });

  test('TC-23b a click makes the default shape centred on the point that was clicked', async ({
    page,
  }) => {
    await openBoard(page);
    await page.keyboard.press('s');

    const click = toScreen({ x: -200, y: 120 });
    await page.mouse.click(click.x, click.y);

    await expect.poll(() => shapesOn(page).then((shapes) => shapes.length)).toBe(1);
    const shape = (await shapesOn(page))[0]!;
    expect(Math.abs(shape.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.height - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    // centred on the point that was clicked
    expect(Math.abs(shape.x + shape.width / 2 - -200)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y + shape.height / 2 - 120)).toBeLessThanOrEqual(1);
    // and, like a drag, drawing it hands the pointer back to Select
    await expect(page.getByTestId('shape-tool-surface')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('TC-23c Shift keeps the proportions of the shape being dragged', async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press('s');
    await page.keyboard.down('Shift');
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(500, 400, { steps: 5 }); // 200x100 on the screen, which is not a square
    await page.mouse.up();
    await page.keyboard.up('Shift');

    await expect.poll(() => shapesOn(page).then((shapes) => shapes.length)).toBe(1);
    const shape = (await shapesOn(page))[0]!;
    expect(Math.abs(shape.width - shape.height)).toBeLessThanOrEqual(1);
  });
});

// The design asks for TC-23 in chromium, firefox and webkit, and for the rest of the functional
// cases in chromium; the two-pointer cases below are the slow ones and would triple the wall clock
// of every commit for a third engine's opinion of the same DOM.
test.describe('a label and a resize at 200%', () => {
  test('TC-24 a click at 200% makes a default diamond, and its label stays centred when it is resized', async ({
    page,
  }) => {
    await openBoard(page, 2);

    await page.keyboard.press('s');
    await page.getByRole('button', { name: 'Shape kind' }).click();
    await page.getByRole('menuitemradio', { name: 'Diamond' }).click();
    // the menu and the button agree about what the next click draws
    await page.getByRole('button', { name: 'Shape kind' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Diamond' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await page.getByRole('button', { name: 'Shape kind' }).click();

    // one click in the middle of the screen, which is the world origin at this zoom
    await page.mouse.click(CENTRE.x, CENTRE.y);
    await expect.poll(() => shapesOn(page).then((shapes) => shapes.length)).toBe(1);
    const shape = (await shapesOn(page))[0]!;
    expect(shape.kind).toBe('diamond');
    // the default size is a world size: 200% zoom does not make it twice as big
    expect(Math.abs(shape.width - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.height - SHAPE_DEFAULT_SIZE_WORLD)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.x + shape.width / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(shape.y + shape.height / 2)).toBeLessThanOrEqual(1);

    // type into it: double-clicking the shape opens the editor on what is already in it
    const words =
      'The card was declined by the bank, so ask for another one and try the payment again';
    await page.locator(`[data-shape-id="${shape.id}"]`).dblclick();
    const editor = page.getByTestId('shape-label-editor');
    await expect(editor).toBeVisible();
    await editor.fill(words);
    await page.keyboard.press('Escape');
    const label = page.locator(`[data-shape-id="${shape.id}"] [data-testid="shape-label"]`);
    await expect(label).toHaveText(words);

    // the words are longer than the shape is wide, so they took several lines
    // one line of the label is the label's font (a world size) times the stylesheet's line-height of
    // 1.25, and 200% zoom doubles both
    const oneLinePx = SHAPE_LABEL_FONT_SIZE_WORLD * 1.25 * 2;
    expect(await labelHeightPx(page, shape.id)).toBeGreaterThan(oneLinePx * 1.5);

    // make the shape bigger by its corner: the words must not slide out of the middle
    await page.locator(`[data-shape-id="${shape.id}"]`).click();
    const handle = page.locator('[data-handle="se"]');
    const before = await handle.boundingBox();
    if (!before) throw new Error('the resize handle is not on the screen');
    await drag(
      page,
      { x: before.x + before.width / 2, y: before.y + before.height / 2 },
      { x: before.x + before.width / 2 + 160, y: before.y + before.height / 2 + 120 },
    );

    const grown = await shapesOn(page).then((shapes) => shapes.find((s) => s.id === shape.id));
    if (!grown) throw new Error('the shape disappeared while it was being resized');
    expect(grown.width).toBeGreaterThan(shape.width + 40);
    expect(grown.height).toBeGreaterThan(shape.height + 40);
    expect(grown.kind).toBe('diamond');

    // centred means centred: the middle of the words is the middle of the diamond
    const drift = await labelDrift(page, shape.id);
    expect(Math.abs(drift.dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(drift.dy)).toBeLessThanOrEqual(2);
  });

  test('TC-24b a label that needs no new words at all still fits', async ({ page }) => {
    await openBoard(page);
    const id = await createShape(page, {
      kind: 'ellipse',
      x: -120,
      y: -80,
      width: 240,
      height: 160,
      label: 'Take payment',
    });
    const drift = await labelDrift(page, id);
    expect(Math.abs(drift.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(drift.dy)).toBeLessThanOrEqual(1);
    // and the words are drawn inside the shape, not spilling out of it
    expect(await labelHeightPx(page, id)).toBeLessThanOrEqual(160);
  });
});
