import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { setCamera, openBoard } from './helpers/board';
import {
  TEXT_MAX_AUTO_WIDTH_WORLD,
  TEXT_SIZES,
  TEXT_LINE_HEIGHT,
} from '../../src/shared/config';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import type { TextSnapshot } from '../../src/shared/objects/text';

const editorSelector = '[data-testid="text-editor"]';

async function textObjects(page: Page): Promise<readonly ObjectSnapshot[]> {
  return page.evaluate(
    () => (window as unknown as { __vidi6: { objects(): ObjectSnapshot[] } }).__vidi6.objects()
  );
}

async function firstText(page: Page): Promise<TextSnapshot | undefined> {
  const objs = await textObjects(page);
  return objs.find((o) => o.type === 'text') as TextSnapshot | undefined;
}

/** Activate the Text tool and create a text object at a screen point. */
async function createTextAt(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press('t');
  await page.mouse.click(x, y);
  await expect(page.locator(editorSelector)).toBeVisible();
}

test.describe('text-notes (ui-e2e)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await openBoard(page);
    await setCamera(page, -640, -400, 1);
  });

  test('TC-26: T → click → type → Escape → text at click point, content, size M', async ({
    page,
  }) => {
    await createTextAt(page, 400, 300);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    const text = await firstText(page);
    expect(text).toBeDefined();
    expect(text!.text).toBe('Hello');
    expect(text!.size).toBe('M');
    // Top-left at the world point under (400,300):
    // screenToWorld({x:-640,y:-400,zoom:1},{x:400,y:300}) = (-240,-100).
    expect(text!.x).toBeCloseTo(-240, 0);
    expect(text!.y).toBeCloseTo(-100, 0);
  });

  test('TC-27: long text wraps within the max width', async ({ page }) => {
    await createTextAt(page, 400, 300);
    // Many words → wraps; the width is capped at TEXT_MAX_AUTO_WIDTH_WORLD.
    await page.keyboard.type('word '.repeat(60).trim());
    await page.keyboard.press('Escape');

    const text = await firstText(page);
    expect(text).toBeDefined();
    expect(text!.width).toBeLessThanOrEqual(TEXT_MAX_AUTO_WIDTH_WORLD);
    // It wrapped to more than one line.
    expect(text!.height).toBeGreaterThan(TEXT_SIZES.M * TEXT_LINE_HEIGHT);
  });

  test('TC-28: multi-line text → height grows', async ({ page }) => {
    await createTextAt(page, 400, 300);
    await page.keyboard.type('Line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Line two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Line three');
    await page.keyboard.press('Escape');

    const text = await firstText(page);
    expect(text).toBeDefined();
    // Three explicit lines at M: height ≈ 3 × 20 × 1.3 = 78.
    const oneLine = TEXT_SIZES.M * TEXT_LINE_HEIGHT;
    expect(text!.height).toBeGreaterThanOrEqual(3 * oneLine - 1);
  });

  test('TC-29: drag right handle narrower → words wrap, height grows; only e/w handles', async ({
    page,
  }) => {
    await createTextAt(page, 400, 300);
    await page.keyboard.type('Hello world this is a longer phrase to wrap around');
    await page.keyboard.press('Escape');

    // A single text shows only the horizontal (e/w) handles.
    await expect(page.getByTestId('resize-handle-e')).toBeVisible();
    await expect(page.getByTestId('resize-handle-w')).toBeVisible();
    for (const h of ['n', 's', 'nw', 'ne', 'sw', 'se']) {
      await expect(page.getByTestId(`resize-handle-${h}`)).toHaveCount(0);
    }

    const before = (await firstText(page))!;

    // Drag the east handle to the left (narrower).
    const eBox = await page.getByTestId('resize-handle-e').boundingBox();
    expect(eBox).not.toBeNull();
    await page.mouse.move(eBox!.x + eBox!.width / 2, eBox!.y + eBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(eBox!.x - 150, eBox!.y + eBox!.height / 2, { steps: 8 });
    await page.mouse.up();

    const after = (await firstText(page))!;
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeLessThan(before.width);
    // Narrower → more lines → taller.
    expect(after.height).toBeGreaterThan(before.height);
  });

  test('TC-30: S/M/L buttons change size and remeasure the box', async ({ page }) => {
    await createTextAt(page, 400, 300);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    // The text toolbar is shown (single text selected); M is active.
    await expect(page.getByTestId('text-toolbar')).toBeVisible();
    await expect(page.getByTestId('text-size-M')).toHaveAttribute('aria-pressed', 'true');

    const before = (await firstText(page))!;

    // Switch to L → the box grows.
    await page.getByTestId('text-size-L').click();
    let text = (await firstText(page))!;
    expect(text.size).toBe('L');
    expect(text.height).toBeGreaterThan(before.height);
    await expect(page.getByTestId('text-size-L')).toHaveAttribute('aria-pressed', 'true');

    // Switch to S → the box shrinks below the M height.
    await page.getByTestId('text-size-S').click();
    text = (await firstText(page))!;
    expect(text.size).toBe('S');
    expect(text.height).toBeLessThan(before.height);
    await expect(page.getByTestId('text-size-S')).toHaveAttribute('aria-pressed', 'true');
  });

  test('TC-31: delete via toolbar → object gone, selection cleared', async ({ page }) => {
    await createTextAt(page, 400, 300);
    await page.keyboard.type('Hello');
    await page.keyboard.press('Escape');

    // The text is selected; the toolbar's delete button removes it.
    await page.getByTestId('text-delete').click();

    const objs = await textObjects(page);
    expect(objs.find((o) => o.type === 'text')).toBeUndefined();
    // Selection cleared → no selection overlay.
    await expect(page.getByTestId('selection-bounds')).toHaveCount(0);
  });
});
