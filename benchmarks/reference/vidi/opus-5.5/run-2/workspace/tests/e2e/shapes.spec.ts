/**
 * Story 10 e2e "Draw a flow" (TC-23, TC-24): the Shape tool and shape labels in real
 * browsers with real layout, against `wrangler dev`.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Camera, Point } from '../../src/client/canvas/camera';
import { SHAPE_DEFAULT_SIZE_WORLD } from '../../src/shared/config';
import { openBoard, setCamera } from './helpers/board';

const CAM: Camera = { x: 0, y: 0, zoom: 1 };
const PX = 1;
const CENTRE_TOLERANCE = 2;

interface RenderedShape {
  id: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function shapes(page: Page): Locator {
  return page.locator('.shape-object');
}

async function renderedShapes(page: Page): Promise<RenderedShape[]> {
  return shapes(page).evaluateAll((els) =>
    els.map((el) => {
      const h = el as HTMLElement;
      return {
        id: h.dataset.id ?? '',
        kind: h.dataset.kind ?? '',
        x: parseFloat(h.style.left),
        y: parseFloat(h.style.top),
        width: parseFloat(h.style.width),
        height: parseFloat(h.style.height),
      };
    }),
  );
}

async function onlyShape(page: Page): Promise<RenderedShape> {
  const list = await renderedShapes(page);
  expect(list).toHaveLength(1);
  return list[0]!;
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

function near(actual: number, expected: number, tolerance = PX): void {
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Screen box of the rendered label text and of the shape. */
async function labelGeometry(page: Page): Promise<{ label: DOMRect; shape: DOMRect; lineCount: number }> {
  return shapes(page).evaluate((el) => {
    const label = el.querySelector('.shape-label') as HTMLElement;
    const lineHeight = parseFloat(getComputedStyle(label).lineHeight);
    const r = label.getBoundingClientRect();
    return { label: r.toJSON(), shape: el.getBoundingClientRect().toJSON(), lineCount: Math.round(r.height / (lineHeight * 2)) };
  });
}

test.describe('shape.ui', () => {
  test('TC-23 S, real drag (100,100)→(300,220) at 100%: a 200×120 rectangle there, selected, Select active', async ({ page }) => {
    await openBoard(page);
    await setCamera(page, CAM);
    await page.keyboard.press('s');
    await expect(page.getByRole('button', { name: 'Shape (S)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('menuitemradio', { name: 'Rectangle' })).toHaveAttribute('aria-checked', 'true');
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(200, 160, { steps: 5 });
    await expect(page.getByTestId('shape-preview')).toBeVisible();
    await page.mouse.move(300, 220, { steps: 5 });
    await page.mouse.up();

    const s = await onlyShape(page);
    expect(s.kind).toBe('rect');
    near(s.x, 100);
    near(s.y, 100);
    near(s.width, 200);
    near(s.height, 120);
    const box = (await shapes(page).boundingBox())!;
    near(box.x, 100);
    near(box.y, 100);
    near(box.width, 200);
    near(box.height, 120);
    await expect(shapes(page)).toHaveAttribute('data-selected', 'true');
    await expect(page.getByRole('button', { name: 'Select (V)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(shapes(page)).toHaveAttribute('data-fill', 'white');
    await expect(page.getByRole('toolbar', { name: 'Shape' })).toBeVisible();
  });

  test('TC-24 at 200%: Diamond click → 160×160 centred; a long label wraps, stays centred, re-wraps on resize', async ({ page }) => {
    await openBoard(page);
    const cam: Camera = { x: 0, y: 0, zoom: 2 };
    await setCamera(page, cam);
    await page.getByRole('button', { name: 'Shape (S)' }).click();
    await page.getByRole('menuitemradio', { name: 'Diamond' }).click();
    await page.mouse.click(600, 400);

    const s = await onlyShape(page);
    expect(s.kind).toBe('diamond');
    near(s.width, SHAPE_DEFAULT_SIZE_WORLD);
    near(s.height, SHAPE_DEFAULT_SIZE_WORLD);
    near(s.x + s.width / 2, 300);
    near(s.y + s.height / 2, 200);
    const box = (await shapes(page).boundingBox())!;
    near(box.width, SHAPE_DEFAULT_SIZE_WORLD * 2);
    near(box.x + box.width / 2, 600);
    near(box.y + box.height / 2, 400);

    const label = 'Payment received and confirmed by the bank?';
    await page.mouse.dblclick(600, 400);
    const editor = page.getByRole('textbox', { name: 'Shape label' });
    await expect(editor).toBeFocused();
    await page.keyboard.type(label);
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(shapes(page)).toHaveAttribute('aria-label', `Diamond: ${label}`);

    const before = await labelGeometry(page);
    expect(before.lineCount).toBeGreaterThan(1); // wraps inside the shape
    expect(before.label.width).toBeLessThanOrEqual(before.shape.width);
    near(before.label.x + before.label.width / 2, before.shape.x + before.shape.width / 2, CENTRE_TOLERANCE);
    near(before.label.y + before.label.height / 2, before.shape.y + before.shape.height / 2, CENTRE_TOLERANCE);

    // Wider via the right handle: fewer lines, still centred.
    const handle = (await page.getByRole('button', { name: 'Resize right' }).boundingBox())!;
    await drag(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, { x: handle.x + handle.width / 2 + 300, y: handle.y + handle.height / 2 });
    await expect.poll(async () => (await onlyShape(page)).width).toBeGreaterThan(SHAPE_DEFAULT_SIZE_WORLD + 100);
    const after = await labelGeometry(page);
    expect(after.lineCount).toBeLessThan(before.lineCount);
    near(after.label.x + after.label.width / 2, after.shape.x + after.shape.width / 2, CENTRE_TOLERANCE);
    near(after.label.y + after.label.height / 2, after.shape.y + after.shape.height / 2, CENTRE_TOLERANCE);
  });
});

test('the shape toolbar of a shape by the left toolbar stays clear of it and usable', async ({ page }) => {
  await openBoard(page);
  await setCamera(page, CAM);
  await page.keyboard.press('s');
  await page.mouse.click(160, 400); // a standard shape centred right next to the left toolbar
  const bar = (await page.getByRole('toolbar', { name: 'Shape' }).boundingBox())!;
  const tools = (await page.getByRole('toolbar', { name: 'Tools' }).boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(tools.x + tools.width);
  await page.getByRole('button', { name: 'White fill' }).click();
  await page.getByRole('button', { name: 'Blue fill' }).click();
  await expect(shapes(page)).toHaveAttribute('data-fill', 'blue');
});
